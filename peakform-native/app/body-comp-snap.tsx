import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  ScrollView,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera'
import * as Speech from 'expo-speech'
import { setAudioModeAsync } from 'expo-audio'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { RotateCcw, SwitchCamera, X } from 'lucide-react-native'
import { api } from '../api/client'
import { PressableScale } from '../components/PressableScale'
import { hapticLight, hapticMedium, hapticSuccess } from '../lib/haptics'
import { extractErrorMessage } from '../lib/apiError'
import { handleLimitError, usePlan, useSetPlan, type ScanUsage } from '../hooks/usePlan'
import { ScanLimitCard, ScanQuotaPill } from '../components/ScanQuota'
import { colors } from '../theme/tokens'
import { footerBottomPadding, footerClearance } from '../theme/layout'

// BF% estimator, three-angle version. The user props the phone up, steps
// back, and a spoken countdown walks them through front → side → back while
// the app captures each pose hands-free. All three photos go to Claude in ONE
// request (the backend labels each view) and are dropped server-side — never
// persisted. The result lands in a review screen with the estimate + cues +
// save button.

interface BFEstimate {
  bf_percent_low: number | null
  bf_percent_high: number | null
  bf_percent_midpoint: number | null
  sex_assumed: string
  visible_cues: string[]
  limitations: string[]
  confidence: 'low' | 'medium' | 'high'
  disclaimer: string
  views_used?: number
}

type View3 = 'front' | 'side' | 'back'

const VIEWS: { key: View3; label: string; say: string }[] = [
  { key: 'front', label: 'Front', say: 'Face the camera. Arms slightly away from your sides.' },
  { key: 'side', label: 'Side', say: 'Turn to your side. Cross your arms over your chest.' },
  { key: 'back', label: 'Back', say: 'Turn your back to the camera. Arms slightly away from your sides.' },
]

// Countdown before the first pose — time to walk from the phone to the spot.
// A single-pose retake gets less because the user is already in place.
const STEP_BACK_SECONDS = 6
const RETAKE_STEP_BACK_SECONDS = 4
const POSE_SECONDS = 3

// The API downscales anything bigger than ~1568px on the long edge anyway,
// so resizing here costs nothing in accuracy and cuts each upload from
// several MB to a few hundred KB.
const MAX_EDGE = 1568

class Cancelled extends Error {}

function PermissionGate({ onRequest }: { onRequest: () => void }) {
  return (
    <View className="flex-1 bg-bg items-center justify-center px-8">
      <Text className="text-text text-headline font-semibold text-center mb-2">
        Camera access needed
      </Text>
      <Text className="text-text-muted text-footnote text-center mb-8">
        We use the camera to estimate body-fat % from three quick photos. The images are
        sent to Claude for analysis and not saved on your account.
      </Text>
      <PressableScale haptic onPress={onRequest} className="bg-accent rounded-md px-6 py-3" style={{ borderCurve: 'continuous' }}>
        <Text className="text-on-accent font-semibold">Allow camera</Text>
      </PressableScale>
      <TouchableOpacity onPress={() => router.back()} hitSlop={12} className="mt-4 px-4 py-3">
        <Text className="text-text-muted text-body font-medium">Cancel</Text>
      </TouchableOpacity>
    </View>
  )
}

function AnalyzingOverlay({ count }: { count: number }) {
  return (
    <View className="absolute inset-0 bg-bg/85 items-center justify-center" pointerEvents="auto">
      <ActivityIndicator size="large" color={colors.text} />
      <Text className="text-text text-body font-medium mt-4">Analyzing…</Text>
      <Text className="text-text-muted text-caption mt-1">
        Reviewing {count === 1 ? 'the photo' : `${count} angles`}
      </Text>
    </View>
  )
}

function StepPills({ current, done }: { current: View3 | null; done: Partial<Record<View3, string>> }) {
  return (
    <View className="flex-row justify-center gap-2">
      {VIEWS.map((v) => {
        const active = v.key === current
        const finished = !!done[v.key]
        return (
          <View
            key={v.key}
            className="rounded-full px-3 py-2"
            style={{
              borderCurve: 'continuous',
              backgroundColor: active ? colors.text : finished ? `${colors.text}59` : `${colors.bg}99`,
            }}
          >
            <Text
              className="text-caption font-semibold"
              style={{ color: active ? colors.bg : colors.text }}
            >
              {finished && !active ? '✓ ' : ''}
              {v.label}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

function IntroCard({ onStart, usage }: { onStart: () => void; usage?: ScanUsage }) {
  if (usage?.remaining === 0) {
    return (
      <View className="absolute left-0 right-0 bottom-0 pb-8">
        <ScanLimitCard kind="bf" usage={usage} />
      </View>
    )
  }
  const tips = [
    'Prop your phone up at about waist height.',
    'Step back 2–3 m until your whole body is in frame.',
    'Follow the voice: front, side, then back.',
  ]
  return (
    <View className="absolute left-0 right-0 bottom-0 px-4 pb-8">
      <View className="bg-bg/80 border border-divider rounded-xl p-5" style={{ borderCurve: 'continuous' }}>
        <View className="flex-row items-center justify-between mb-1">
          <Text className="text-text text-headline font-semibold">3-angle scan</Text>
          <ScanQuotaPill kind="bf" usage={usage} />
        </View>
        <Text className="text-text-muted text-caption mb-4">
          Three angles give a more reliable estimate than one. Takes about 20 seconds.
        </Text>
        {tips.map((t, i) => (
          <View key={i} className="flex-row mb-3">
            <Text className="text-text-subtle text-footnote w-5">{i + 1}.</Text>
            <Text className="text-text text-footnote flex-1">{t}</Text>
          </View>
        ))}
        <Text className="text-text-subtle text-caption mt-1 mb-4">
          Fitted clothing or shirtless, even lighting, plain background. Turn your volume up.
        </Text>
        <PressableScale haptic onPress={onStart} className="bg-accent rounded-md py-4 items-center" style={{ borderCurve: 'continuous' }}>
          <Text className="text-on-accent font-semibold text-body">Start scan</Text>
        </PressableScale>
      </View>
    </View>
  )
}

function ReviewView({
  shots,
  onRetakeView,
  onRestart,
  onAnalyze,
  busy,
}: {
  shots: Partial<Record<View3, string>>
  onRetakeView: (v: View3) => void
  onRestart: () => void
  onAnalyze: () => void
  busy: boolean
}) {
  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-divider">
        <TouchableOpacity onPress={onRestart} hitSlop={8} disabled={busy}>
          <Text className="text-text-muted text-body">‹ Start over</Text>
        </TouchableOpacity>
        <Text className="text-text font-semibold">Check your photos</Text>
        <View style={{ width: 80 }} />
      </View>

      <View className="flex-1 px-4 pt-6">
        <Text className="text-text-muted text-footnote mb-5">
          Your whole body should be visible in each shot. Tap a photo to retake just that one.
        </Text>
        <View className="flex-row gap-3">
          {VIEWS.map((v) => (
            <TouchableOpacity
              key={v.key}
              className="flex-1"
              onPress={() => onRetakeView(v.key)}
              disabled={busy}
              activeOpacity={0.8}
            >
              <View
                className="rounded-xl overflow-hidden bg-surface border border-divider"
                style={{ borderCurve: 'continuous', aspectRatio: 3 / 4 }}
              >
                {shots[v.key] && (
                  <Image source={{ uri: shots[v.key] }} style={{ flex: 1 }} resizeMode="cover" />
                )}
                <View className="absolute bottom-1.5 right-1.5 w-7 h-7 rounded-full bg-bg/60 items-center justify-center" style={{ borderCurve: 'continuous' }}>
                  <RotateCcw size={14} color={colors.text} />
                </View>
              </View>
              <Text className="text-text-muted text-caption text-center mt-2 font-medium">{v.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View className="px-4 pt-3 pb-8 border-t border-divider">
        <PressableScale
          haptic
          onPress={onAnalyze}
          disabled={busy}
          className="bg-accent rounded-md py-4 items-center" style={{ borderCurve: 'continuous' }}
        >
          <Text className="text-on-accent font-semibold text-body">Analyze</Text>
        </PressableScale>
      </View>

      {busy && <AnalyzingOverlay count={VIEWS.length} />}
    </SafeAreaView>
  )
}

function EstimateView({
  estimate,
  onRetake,
  onSave,
  saving,
}: {
  estimate: BFEstimate
  onRetake: () => void
  onSave: () => void
  saving: boolean
}) {
  const hasNumber =
    estimate.bf_percent_low != null && estimate.bf_percent_high != null
  const insets = useSafeAreaInsets()
  const angles = estimate.views_used && estimate.views_used > 1 ? ` · ${estimate.views_used} angles` : ''
  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-divider">
        <TouchableOpacity onPress={onRetake} hitSlop={8}>
          <Text className="text-text-muted text-body">‹ Retake</Text>
        </TouchableOpacity>
        <Text className="text-text font-semibold">BF% estimate</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView className="flex-1 px-4 pt-5" contentContainerStyle={{ paddingBottom: footerClearance(insets.bottom) }}>
        {hasNumber ? (
          <View className="items-center pb-3">
            <Text className="text-text-subtle text-caption mb-1">
              Estimated range
            </Text>
            <Text className="text-text text-hero font-bold">
              {estimate.bf_percent_low}–{estimate.bf_percent_high}
              <Text className="text-text-subtle text-title font-normal"> %</Text>
            </Text>
            <Text className="text-text-subtle text-caption mt-1">
              midpoint ~{estimate.bf_percent_midpoint}% · confidence {estimate.confidence}
              {angles}
            </Text>
          </View>
        ) : (
          <View className="items-center pb-3">
            <Text className="text-text-muted text-headline font-semibold mb-1">
              Couldn't estimate
            </Text>
            <Text className="text-text-subtle text-caption text-center">
              The photos weren't usable. Try again with a clearer pose and lighting.
            </Text>
          </View>
        )}

        {estimate.visible_cues.length > 0 && (
          <View className="mt-6">
            <Text className="text-text-subtle text-caption mb-2">
              What the model saw
            </Text>
            <View className="bg-surface border border-divider rounded-xl overflow-hidden" style={{ borderCurve: 'continuous' }}>
              {estimate.visible_cues.map((c, i) => (
                <View
                  key={i}
                  className="px-4 py-3 flex-row"
                  style={{
                    borderBottomWidth: i === estimate.visible_cues.length - 1 ? 0 : 1,
                    borderBottomColor: colors.divider,
                  }}
                >
                  <Text className="text-text-subtle text-caption mr-2 mt-1">•</Text>
                  <Text className="text-text-muted text-footnote flex-1">{c}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {estimate.limitations.length > 0 && (
          <View className="mt-6">
            <Text className="text-text-subtle text-caption mb-2">
              Limitations
            </Text>
            <View className="bg-surface border border-divider rounded-xl overflow-hidden" style={{ borderCurve: 'continuous' }}>
              {estimate.limitations.map((c, i) => (
                <View
                  key={i}
                  className="px-4 py-3 flex-row"
                  style={{
                    borderBottomWidth: i === estimate.limitations.length - 1 ? 0 : 1,
                    borderBottomColor: colors.divider,
                  }}
                >
                  <Text className="text-text-subtle text-caption mr-2 mt-1">•</Text>
                  <Text className="text-text-subtle text-footnote flex-1">{c}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <Text className="text-text-subtle text-caption mt-5">{estimate.disclaimer}</Text>
      </ScrollView>

      <View className="absolute bottom-0 left-0 right-0 bg-bg border-t border-divider px-4 pt-3" style={{ paddingBottom: footerBottomPadding(insets.bottom) }}>
        <TouchableOpacity
          onPress={onSave}
          disabled={!hasNumber || saving}
          className="bg-accent rounded-md py-4 items-center"
          style={{ borderCurve: 'continuous', opacity: !hasNumber || saving ? 0.4 : 1 }}
        >
          {saving ? (
            <ActivityIndicator color={colors['on-accent']} />
          ) : (
            <Text className="text-on-accent font-semibold text-body">
              {hasNumber ? `Save ${estimate.bf_percent_midpoint}% to Body` : 'Retake'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

async function shrink(uri: string, width?: number, height?: number): Promise<string> {
  const portrait = (height ?? 0) >= (width ?? 0)
  const resize = portrait ? { height: MAX_EDGE } : { width: MAX_EDGE }
  if (Math.max(width ?? Infinity, height ?? Infinity) <= MAX_EDGE) return uri
  const out = await manipulateAsync(uri, [{ resize }], { compress: 0.8, format: SaveFormat.JPEG })
  return out.uri
}

type Phase = 'intro' | 'capturing' | 'review'

export default function BodyCompSnapScreen() {
  const [permission, requestPermission] = useCameraPermissions()
  const [phase, setPhase] = useState<Phase>('intro')
  const [facing, setFacing] = useState<CameraType>('front')
  const [currentView, setCurrentView] = useState<View3 | null>(null)
  const [instruction, setInstruction] = useState('')
  const [count, setCount] = useState<number | null>(null)
  const [shots, setShots] = useState<Partial<Record<View3, string>>>({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BFEstimate | null>(null)
  const cameraRef = useRef<CameraView>(null)
  const cameraReady = useRef(false)
  // Bumped on every start/cancel; a running sequence bails as soon as the
  // id it started with is no longer current.
  const runId = useRef(0)
  const qc = useQueryClient()
  const { data: plan } = usePlan()
  const refreshPlan = useSetPlan()

  const saveMutation = useMutation({
    mutationFn: (bf: number) =>
      api.post('/body/metrics', { body_fat_pct: bf }),
    onSuccess: () => {
      hapticSuccess()
      qc.invalidateQueries({ queryKey: ['body-history'] })
      router.back()
    },
    onError: (err: any) => {
      Alert.alert("Couldn't save", extractErrorMessage(err, 'Try again in a moment.'))
    },
  })

  const cancelSequence = useCallback(() => {
    runId.current += 1
    Speech.stop()
    setCount(null)
    setCurrentView(null)
    setInstruction('')
  }, [])

  // Stop talking when the screen goes away, and abort a running sequence if
  // the app is backgrounded — the camera session dies with it anyway.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' && phase === 'capturing') {
        cancelSequence()
        setPhase(Object.keys(shots).length === VIEWS.length ? 'review' : 'intro')
      }
    })
    return () => sub.remove()
  }, [phase, shots, cancelSequence])

  useEffect(() => () => {
    runId.current += 1
    Speech.stop()
  }, [])

  // The camera unmounts on the review screen; a single-view retake mounts a
  // fresh one that must report ready again before we capture.
  useEffect(() => {
    if (phase === 'review') cameraReady.current = false
  }, [phase])

  if (!permission) {
    return (
      <View className="flex-1 bg-bg items-center justify-center">
        <ActivityIndicator color={colors.text} />
      </View>
    )
  }
  if (!permission.granted) return <PermissionGate onRequest={requestPermission} />

  async function runSequence(views: View3[], stepBackSeconds: number) {
    const id = ++runId.current
    const alive = () => {
      if (runId.current !== id) throw new Cancelled()
    }
    const wait = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)).then(alive)
    // Resolves when the utterance finishes; the timeout covers the rare case
    // where the engine never fires a callback.
    const say = (text: string) =>
      new Promise<void>((resolve) => {
        const fallback = setTimeout(resolve, 1500 + text.length * 90)
        const done = () => {
          clearTimeout(fallback)
          resolve()
        }
        Speech.speak(text, { rate: 1.0, onDone: done, onStopped: done, onError: done })
      }).then(alive)
    const countdown = async (from: number, speakFrom: number) => {
      for (let n = from; n >= 1; n--) {
        setCount(n)
        hapticLight()
        if (n <= speakFrom) Speech.speak(String(n), { rate: 1.1 })
        await wait(1000)
      }
      setCount(null)
    }

    setPhase('capturing')
    try {
      // Speak through the silent switch and duck (not stop) the user's music.
      await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers' }).catch(() => {})

      setInstruction('Step back until your whole body is in the frame')
      await say('Step back until your whole body is in the frame.')
      await countdown(stepBackSeconds, 0)

      for (const key of views) {
        const v = VIEWS.find((x) => x.key === key)!
        setCurrentView(key)
        setInstruction(v.say)
        await say(v.say)
        await countdown(POSE_SECONDS, POSE_SECONDS)

        for (let i = 0; !cameraReady.current && i < 30; i++) await wait(100)
        const photo = await cameraRef.current?.takePictureAsync({ quality: 0.8 })
        alive()
        if (!photo?.uri) throw new Error('Capture failed')
        hapticMedium()
        const uri = await shrink(photo.uri, photo.width, photo.height)
        alive()
        setShots((s) => ({ ...s, [key]: uri }))
        if (key !== views[views.length - 1]) await say('Got it.')
      }

      setCurrentView(null)
      setInstruction('')
      hapticSuccess()
      Speech.speak('All done. Come back and check your photos.')
      setPhase('review')
    } catch (err) {
      if (err instanceof Cancelled) return
      cancelSequence()
      setPhase('intro')
      Alert.alert("Couldn't take the photo", extractErrorMessage(err, 'Try again.'))
    }
  }

  function startFull() {
    setShots({})
    runSequence(VIEWS.map((v) => v.key), STEP_BACK_SECONDS)
  }

  function abort() {
    cancelSequence()
    setPhase(Object.keys(shots).length === VIEWS.length ? 'review' : 'intro')
  }

  async function handleAnalyze() {
    if (busy) return
    setBusy(true)
    try {
      const formData = new FormData()
      for (const v of VIEWS) {
        const uri = shots[v.key]
        if (!uri) continue
        formData.append('images', {
          uri,
          type: 'image/jpeg',
          name: `${v.key}.jpg`,
        } as unknown as Blob)
        formData.append('views', v.key)
      }

      const { data } = await api.post<BFEstimate>('/body/estimate-bf', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 90_000,
      })

      hapticSuccess()
      setResult(data)
      refreshPlan()
    } catch (err: any) {
      if (handleLimitError(err)) {
        refreshPlan()
        return
      }
      const msg =
        err?.response?.status === 503
          ? 'AI service is not configured. Add ANTHROPIC_API_KEY to backend/.env.'
          : extractErrorMessage(err, 'Could not analyze the photos. Try again.')
      Alert.alert("Couldn't analyze", msg)
    } finally {
      setBusy(false)
    }
  }

  function restart() {
    setResult(null)
    setShots({})
    setPhase('intro')
  }

  if (result) {
    return (
      <EstimateView
        estimate={result}
        onRetake={restart}
        onSave={() => {
          if (result.bf_percent_midpoint != null) {
            saveMutation.mutate(result.bf_percent_midpoint)
          }
        }}
        saving={saveMutation.isPending}
      />
    )
  }

  if (phase === 'review') {
    return (
      <ReviewView
        shots={shots}
        onRetakeView={(v) => runSequence([v], RETAKE_STEP_BACK_SECONDS)}
        onRestart={restart}
        onAnalyze={handleAnalyze}
        busy={busy}
      />
    )
  }

  const capturing = phase === 'capturing'

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <View className="flex-1">
        <CameraView
          ref={cameraRef}
          style={{ flex: 1 }}
          facing={facing}
          mode="picture"
          onCameraReady={() => {
            cameraReady.current = true
          }}
          onMountError={() => {
            cameraReady.current = false
          }}
        />

        <View className="absolute top-0 left-0 right-0 px-4 pt-3 flex-row items-center justify-between">
          <TouchableOpacity
            onPress={capturing ? abort : () => router.back()}
            className="w-11 h-11 rounded-full bg-bg/60 items-center justify-center" style={{ borderCurve: 'continuous' }}
            hitSlop={12}
          >
            <X size={22} color={colors.text} strokeWidth={2.25} />
          </TouchableOpacity>
          {capturing ? (
            <StepPills current={currentView} done={shots} />
          ) : (
            <View className="bg-bg/60 rounded-full px-3 py-2" style={{ borderCurve: 'continuous' }}>
              <Text className="text-text text-caption">Full body · even lighting</Text>
            </View>
          )}
          {capturing ? (
            <View style={{ width: 44 }} />
          ) : (
            <TouchableOpacity
              onPress={() => {
                cameraReady.current = false
                setFacing((f) => (f === 'front' ? 'back' : 'front'))
              }}
              className="w-11 h-11 rounded-full bg-bg/60 items-center justify-center" style={{ borderCurve: 'continuous' }}
              hitSlop={12}
            >
              <SwitchCamera size={20} color={colors.text} strokeWidth={2.25} />
            </TouchableOpacity>
          )}
        </View>

        {capturing && (
          <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
            {count != null && (
              // Off the type scale on purpose (DESIGN.md §3): a self-timer countdown
              // over the live camera, read from 2–3 m away while posing.
              <Text
                className="text-text font-bold"
                style={{
                  fontSize: 160,
                  lineHeight: 176,
                  textShadowColor: `${colors.bg}99`,
                  textShadowRadius: 16,
                }}
              >
                {count}
              </Text>
            )}
          </View>
        )}

        {capturing && instruction !== '' && (
          <View className="absolute left-0 right-0 bottom-0 px-6 pb-12 items-center" pointerEvents="none">
            <View className="bg-bg/70 rounded-xl px-5 py-4" style={{ borderCurve: 'continuous' }}>
              <Text className="text-text text-title font-semibold text-center">{instruction}</Text>
            </View>
          </View>
        )}

        {phase === 'intro' && <IntroCard onStart={startFull} usage={plan?.scans.bf} />}
      </View>
    </SafeAreaView>
  )
}
