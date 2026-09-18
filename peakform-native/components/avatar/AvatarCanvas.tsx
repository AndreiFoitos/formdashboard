import '../../lib/avatar/textDecoderPolyfill'
import { Component, forwardRef, Suspense, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react'
import { PanResponder, Text, View, type ViewStyle } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber/native'
import { GLView } from 'expo-gl'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { AvatarBase } from '../../lib/avatar/bodyParams'
import type { AvatarModel, AvatarState } from '../../lib/avatar/model'
import { createPlaceholderModel } from '../../lib/avatar/placeholderModel'
import { createGlbModel } from '../../lib/avatar/glbModel'

const GLB = {
  male: require('../../assets/avatar/avatar_male.glb'),
  female: require('../../assets/avatar/avatar_female.glb'),
}

// Emote clips (~3.5 MB each) — only loaded by canvases that play an emote.
const EMOTES_GLB = {
  male: require('../../assets/avatar/emotes_male.glb'),
  female: require('../../assets/avatar/emotes_female.glb'),
}

export type AvatarSource = 'glb' | 'placeholder'

export interface AvatarCanvasHandle {
  /** Renders one frame and returns a PNG file URI (for race markers etc). */
  snapshot(): Promise<string | null>
}

interface Props {
  base: AvatarBase
  /** 'glb' = MakeHuman model (default), 'placeholder' = procedural test body. */
  source?: AvatarSource
  state: AvatarState
  style?: ViewStyle
  /** Called roughly once a second with the measured frame rate. */
  onFps?: (fps: number) => void
  /** Called when rendering or loading the model throws (the canvas shows the error instead of crashing). */
  onError?: (error: Error) => void
  /** 'full' = whole body, 'head' = face close-up (header badge, race markers). */
  framing?: AvatarFraming
  /** false = render only when inputs change (no idle animation, no GPU work while static). */
  animate?: boolean
  /** false = no drag-to-turn; touches pass through to parents (e.g. a button). */
  interactive?: boolean
  /** Shown instead of the verbose error panel (small badges). */
  errorFallback?: ReactNode
  /** Fires after the model is loaded and `state` has been applied (used for snapshots). */
  onReady?: () => void
  /** Emote id to loop (MakeHuman model only). `undefined` = never load emote clips. */
  emote?: string | null
}

export type AvatarFraming = 'full' | 'head'

const FRAMING = {
  full: { position: [0, 1.0, 3.9], target: [0, 0.95, 0], fov: 30, spin: 0.35 },
  head: { position: [0, 0, 0.85], target: [0, 0, 0], fov: 30, spin: 0 },
} as const

// Head centre (chin to top of hair) at heightScale 1, measured from the GLBs.
const HEAD_CENTER_Y: Record<AvatarBase, number> = { male: 1.665, female: 1.53 }

/**
 * Keeps a GL / model-loading failure from taking the whole app down, and shows
 * the message so it can be reported (production builds have no dev red screen).
 */
class AvatarErrorBoundary extends Component<{ children: ReactNode; onError?: (e: Error) => void; fallback?: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error('[AvatarCanvas]', error)
    this.props.onError?.(error)
  }
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback !== undefined) return this.props.fallback
    return (
      <View style={{ flex: 1, padding: 12, justifyContent: 'center' }}>
        <Text style={{ color: '#f87171', fontSize: 13, fontWeight: '600', marginBottom: 4 }}>3D avatar failed</Text>
        <Text selectable style={{ color: '#d4d4d8', fontSize: 11 }}>
          {String(error.message || error)}
        </Text>
        <Text selectable style={{ color: '#71717a', fontSize: 9, marginTop: 6 }} numberOfLines={8}>
          {String(error.stack ?? '')}
        </Text>
      </View>
    )
  }
}

/**
 * Live 3D avatar. Only mount this on screens that need it (editor, profile,
 * level-up, podium) — everywhere else use a cached snapshot image.
 * Rendering stops while the screen is not focused.
 */
export const AvatarCanvas = forwardRef<AvatarCanvasHandle, Props>(function AvatarCanvas(
  { base, source = 'glb', state, style, onFps, onError, framing = 'full', animate = true, interactive = true, errorFallback, onReady, emote },
  ref,
) {
  const [focused, setFocused] = useState(true)
  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      return () => setFocused(false)
    }, []),
  )

  // Drag to turn. The overlay owns touches so the GL view never has to.
  const view = FRAMING[framing]
  const spin = useRef<number>(view.spin)
  const spinStart = useRef(0)
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          spinStart.current = spin.current
        },
        onPanResponderMove: (_, g) => {
          spin.current = spinStart.current + g.dx * 0.012
        },
      }),
    [],
  )

  const snapshotFn = useRef<AvatarCanvasHandle['snapshot']>(async () => null)
  useImperativeHandle(ref, () => ({ snapshot: () => snapshotFn.current() }), [])

  return (
    <View style={style} pointerEvents={interactive ? 'auto' : 'none'}>
      <AvatarErrorBoundary onError={onError} fallback={errorFallback}>
      <Canvas
        frameloop={!focused ? 'never' : animate ? 'always' : 'demand'}
        camera={{ position: [...view.position], fov: view.fov }}
        onCreated={(s) => {
          s.gl.setClearColor(0x000000, 0)
        }}
      >
        <CameraRig framing={framing} base={base} heightScale={state.heightScale} />
        <ambientLight intensity={1.1} />
        <directionalLight position={[1.5, 3, 2.5]} intensity={2.2} />
        <Suspense fallback={null}>
          {source === 'glb' ? (
            emote !== undefined ? (
              <GlbEmoteAvatar key={base} base={base} state={state} spin={spin} onFps={onFps} onReady={onReady} snapshotFn={snapshotFn} emote={emote} />
            ) : (
              <GlbAvatar key={base} base={base} state={state} spin={spin} onFps={onFps} onReady={onReady} snapshotFn={snapshotFn} />
            )
          ) : (
            <PlaceholderAvatar key={base} base={base} state={state} spin={spin} onFps={onFps} onReady={onReady} snapshotFn={snapshotFn} />
          )}
        </Suspense>
      </Canvas>
      {interactive && <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} {...pan.panHandlers} />}
      </AvatarErrorBoundary>
    </View>
  )
})

/** Aims the camera; the head close-up follows the avatar's height. */
function CameraRig({ framing, base, heightScale }: { framing: AvatarFraming; base: AvatarBase; heightScale: number }) {
  const { camera, invalidate, size } = useThree()
  const aspect = size.width / Math.max(1, size.height)
  useEffect(() => {
    const v = FRAMING[framing]
    const y = framing === 'head' ? HEAD_CENTER_Y[base] * heightScale : 0
    // Full body in a narrow view: back off until the A-pose arm span (~1.3m) fits.
    const fitZ = 0.65 / (Math.tan(((v.fov / 2) * Math.PI) / 180) * aspect)
    const z = framing === 'full' ? Math.max(v.position[2], fitZ) : v.position[2]
    camera.position.set(v.position[0], v.position[1] + y + (framing === 'head' ? 0.01 : 0), z)
    camera.lookAt(v.target[0], v.target[1] + y, v.target[2])
    invalidate()
  }, [camera, invalidate, framing, base, heightScale, aspect])
  return null
}

interface SceneProps {
  base: AvatarBase
  state: AvatarState
  spin: React.MutableRefObject<number>
  onFps?: (fps: number) => void
  onReady?: () => void
  snapshotFn: React.MutableRefObject<AvatarCanvasHandle['snapshot']>
}

function GlbAvatar(props: SceneProps) {
  const gltf = useLoader(GLTFLoader, GLB[props.base] as unknown as string)
  const model = useMemo(() => createGlbModel(gltf.scene), [gltf])
  return <AvatarScene model={model} {...props} />
}

function GlbEmoteAvatar({ emote, ...props }: SceneProps & { emote: string | null }) {
  const gltf = useLoader(GLTFLoader, GLB[props.base] as unknown as string)
  const clips = useLoader(GLTFLoader, EMOTES_GLB[props.base] as unknown as string)
  const model = useMemo(() => createGlbModel(gltf.scene), [gltf])
  useEffect(() => {
    model.setEmote?.(emote ? clips.animations.find((a) => a.name === emote) ?? null : null)
  }, [model, clips, emote])
  return <AvatarScene model={model} {...props} />
}

function PlaceholderAvatar(props: SceneProps) {
  const model = useMemo(() => createPlaceholderModel(props.base), [props.base])
  return <AvatarScene model={model} {...props} />
}

function AvatarScene({ model, state, spin, onFps, onReady, snapshotFn }: SceneProps & { model: AvatarModel }) {
  useEffect(() => () => model.dispose(), [model])
  const { gl, scene, camera, invalidate } = useThree()
  useEffect(() => {
    model.apply(state)
    invalidate() // needed when the canvas only renders on demand
    onReady?.()
    // onReady is intentionally not a dependency: it should fire per applied state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, state, invalidate])

  useEffect(() => {
    snapshotFn.current = async () => {
      gl.render(scene, camera)
      const snap = await GLView.takeSnapshotAsync(gl.getContext() as never, { format: 'png' })
      return typeof snap.uri === 'string' ? snap.uri : null
    }
  }, [gl, scene, camera, snapshotFn])

  const frames = useRef({ count: 0, since: 0 })
  useFrame((s) => {
    const time = s.clock.elapsedTime
    model.tick(time, state.effects)
    model.root.rotation.y = spin.current

    const f = frames.current
    f.count++
    if (time - f.since >= 1) {
      onFps?.(Math.round(f.count / (time - f.since)))
      f.count = 0
      f.since = time
    }
  })

  return <primitive object={model.root} />
}
