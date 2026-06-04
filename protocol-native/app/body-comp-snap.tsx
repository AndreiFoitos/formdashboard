import { useRef, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { X } from 'lucide-react-native'
import { api } from '../api/client'
import { PressableScale } from '../components/PressableScale'
import { hapticSuccess } from '../lib/haptics'
import { extractErrorMessage } from '../lib/apiError'

// BF% estimator. Same camera UI as nutrition-snap, but the result lands in
// a review screen with the estimate + cues + save button instead of routing
// forward into another flow. The captured image is sent to Claude once and
// dropped server-side — never persisted.

interface BFEstimate {
  bf_percent_low: number | null
  bf_percent_high: number | null
  bf_percent_midpoint: number | null
  sex_assumed: string
  visible_cues: string[]
  limitations: string[]
  confidence: 'low' | 'medium' | 'high'
  disclaimer: string
}

function PermissionGate({ onRequest }: { onRequest: () => void }) {
  return (
    <View className="flex-1 bg-black items-center justify-center px-8">
      <Text className="text-white text-xl font-semibold text-center mb-2">
        Camera access needed
      </Text>
      <Text className="text-zinc-400 text-sm text-center mb-8">
        We use the camera to estimate body-fat % from a single photo. The image is sent
        to Claude for analysis and not saved on your account.
      </Text>
      <PressableScale haptic onPress={onRequest} className="bg-white rounded-2xl px-6 py-3">
        <Text className="text-black font-semibold">Allow camera</Text>
      </PressableScale>
      <TouchableOpacity onPress={() => router.back()} hitSlop={12} className="mt-4 px-4 py-2.5">
        <Text className="text-zinc-300 text-base font-medium">Cancel</Text>
      </TouchableOpacity>
    </View>
  )
}

function AnalyzingOverlay() {
  return (
    <View className="absolute inset-0 bg-black/85 items-center justify-center" pointerEvents="auto">
      <ActivityIndicator size="large" color="#ffffff" />
      <Text className="text-white text-base font-medium mt-4">Analyzing…</Text>
      <Text className="text-zinc-400 text-xs mt-1">Reviewing the photo</Text>
    </View>
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
  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top', 'bottom']}>
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-zinc-800">
        <TouchableOpacity onPress={onRetake} hitSlop={8}>
          <Text className="text-zinc-400 text-base">‹ Retake</Text>
        </TouchableOpacity>
        <Text className="text-white font-semibold">BF% estimate</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView className="flex-1 px-4 pt-5" contentContainerStyle={{ paddingBottom: 160 }}>
        {hasNumber ? (
          <View className="items-center pb-3">
            <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-1">
              Estimated range
            </Text>
            <Text className="text-white text-5xl font-bold">
              {estimate.bf_percent_low}–{estimate.bf_percent_high}
              <Text className="text-zinc-500 text-2xl font-normal"> %</Text>
            </Text>
            <Text className="text-zinc-500 text-xs mt-1">
              midpoint ~{estimate.bf_percent_midpoint}% · confidence {estimate.confidence}
            </Text>
          </View>
        ) : (
          <View className="items-center pb-3">
            <Text className="text-zinc-300 text-lg font-semibold mb-1">
              Couldn't estimate
            </Text>
            <Text className="text-zinc-500 text-xs text-center">
              The photo wasn't usable. Try again with a clearer pose and lighting.
            </Text>
          </View>
        )}

        {estimate.visible_cues.length > 0 && (
          <View className="mt-6">
            <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">
              What the model saw
            </Text>
            <View className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              {estimate.visible_cues.map((c, i) => (
                <View
                  key={i}
                  className="px-4 py-3 flex-row"
                  style={{
                    borderBottomWidth: i === estimate.visible_cues.length - 1 ? 0 : 1,
                    borderBottomColor: '#27272a',
                  }}
                >
                  <Text className="text-zinc-500 text-xs mr-2 mt-0.5">•</Text>
                  <Text className="text-zinc-300 text-sm flex-1">{c}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {estimate.limitations.length > 0 && (
          <View className="mt-6">
            <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">
              Limitations
            </Text>
            <View className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              {estimate.limitations.map((c, i) => (
                <View
                  key={i}
                  className="px-4 py-3 flex-row"
                  style={{
                    borderBottomWidth: i === estimate.limitations.length - 1 ? 0 : 1,
                    borderBottomColor: '#27272a',
                  }}
                >
                  <Text className="text-zinc-500 text-xs mr-2 mt-0.5">•</Text>
                  <Text className="text-zinc-500 text-sm flex-1">{c}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <Text className="text-zinc-600 text-xs mt-5 leading-5">{estimate.disclaimer}</Text>
      </ScrollView>

      <View className="absolute bottom-0 left-0 right-0 bg-black border-t border-zinc-800 px-4 pt-3 pb-8">
        <TouchableOpacity
          onPress={onSave}
          disabled={!hasNumber || saving}
          className="bg-white rounded-2xl py-4 items-center"
          style={{ opacity: !hasNumber || saving ? 0.4 : 1 }}
        >
          {saving ? (
            <ActivityIndicator color="black" />
          ) : (
            <Text className="text-black font-semibold text-base">
              {hasNumber ? `Save ${estimate.bf_percent_midpoint}% to Body` : 'Retake'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

export default function BodyCompSnapScreen() {
  const [permission, requestPermission] = useCameraPermissions()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BFEstimate | null>(null)
  const cameraRef = useRef<CameraView>(null)
  const qc = useQueryClient()

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

  if (!permission) {
    return (
      <View className="flex-1 bg-black items-center justify-center">
        <ActivityIndicator color="#ffffff" />
      </View>
    )
  }
  if (!permission.granted) return <PermissionGate onRequest={requestPermission} />

  async function handleCapture() {
    if (busy || !cameraRef.current) return
    setBusy(true)
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        skipProcessing: false,
      })
      if (!photo?.uri) throw new Error('Capture failed')

      const formData = new FormData()
      formData.append('image', {
        uri: photo.uri,
        type: 'image/jpeg',
        name: 'body.jpg',
      } as unknown as Blob)

      const { data } = await api.post<BFEstimate>('/body/estimate-bf', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60_000,
      })

      hapticSuccess()
      setResult(data)
    } catch (err: any) {
      const msg =
        err?.response?.status === 503
          ? 'AI service is not configured. Add ANTHROPIC_API_KEY to backend/.env.'
          : extractErrorMessage(err, 'Could not analyze the photo. Try again.')
      Alert.alert("Couldn't analyze", msg)
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <EstimateView
        estimate={result}
        onRetake={() => setResult(null)}
        onSave={() => {
          if (result.bf_percent_midpoint != null) {
            saveMutation.mutate(result.bf_percent_midpoint)
          }
        }}
        saving={saveMutation.isPending}
      />
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top', 'bottom']}>
      <View className="flex-1">
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" mode="picture" />

        <View className="absolute top-0 left-0 right-0 px-4 pt-3 flex-row items-center justify-between">
          <TouchableOpacity
            onPress={() => router.back()}
            className="w-11 h-11 rounded-full bg-black/60 items-center justify-center"
            hitSlop={12}
          >
            <X size={22} color="#ffffff" strokeWidth={2.25} />
          </TouchableOpacity>
          <View className="bg-black/60 rounded-full px-3 py-1.5">
            <Text className="text-white text-xs">Full body · even lighting</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <View className="absolute bottom-0 left-0 right-0 pb-8 pt-6 items-center">
          <Text className="text-white/80 text-xs mb-4">Tap to capture</Text>
          <PressableScale haptic onPress={handleCapture} disabled={busy}>
            <View
              className="w-20 h-20 rounded-full items-center justify-center"
              style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
            >
              <View className="w-16 h-16 rounded-full bg-white" />
            </View>
          </PressableScale>
        </View>

        {busy && <AnalyzingOverlay />}
      </View>
    </SafeAreaView>
  )
}
