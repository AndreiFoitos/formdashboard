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
}

/**
 * Keeps a GL / model-loading failure from taking the whole app down, and shows
 * the message so it can be reported (production builds have no dev red screen).
 */
class AvatarErrorBoundary extends Component<{ children: ReactNode; onError?: (e: Error) => void }, { error: Error | null }> {
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
  { base, source = 'glb', state, style, onFps, onError },
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
  const spin = useRef(0.35)
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
    <View style={style}>
      <AvatarErrorBoundary onError={onError}>
      <Canvas
        frameloop={focused ? 'always' : 'never'}
        camera={{ position: [0, 1.0, 3.9], fov: 30 }}
        onCreated={(s) => {
          s.camera.lookAt(0, 0.95, 0)
          s.gl.setClearColor(0x000000, 0)
        }}
      >
        <ambientLight intensity={1.1} />
        <directionalLight position={[1.5, 3, 2.5]} intensity={2.2} />
        <Suspense fallback={null}>
          {source === 'glb' ? (
            <GlbAvatar key={base} base={base} state={state} spin={spin} onFps={onFps} snapshotFn={snapshotFn} />
          ) : (
            <PlaceholderAvatar key={base} base={base} state={state} spin={spin} onFps={onFps} snapshotFn={snapshotFn} />
          )}
        </Suspense>
      </Canvas>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} {...pan.panHandlers} />
      </AvatarErrorBoundary>
    </View>
  )
})

interface SceneProps {
  base: AvatarBase
  state: AvatarState
  spin: React.MutableRefObject<number>
  onFps?: (fps: number) => void
  snapshotFn: React.MutableRefObject<AvatarCanvasHandle['snapshot']>
}

function GlbAvatar(props: SceneProps) {
  const gltf = useLoader(GLTFLoader, GLB[props.base] as unknown as string)
  const model = useMemo(() => createGlbModel(gltf.scene), [gltf])
  return <AvatarScene model={model} {...props} />
}

function PlaceholderAvatar(props: SceneProps) {
  const model = useMemo(() => createPlaceholderModel(props.base), [props.base])
  return <AvatarScene model={model} {...props} />
}

function AvatarScene({ model, state, spin, onFps, snapshotFn }: SceneProps & { model: AvatarModel }) {
  useEffect(() => () => model.dispose(), [model])
  useEffect(() => model.apply(state), [model, state])

  const { gl, scene, camera } = useThree()
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
