import { useRef, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { X } from 'lucide-react-native'
import { api } from '../api/client'
import { PressableScale } from '../components/PressableScale'
import { hapticSuccess } from '../lib/haptics'
import { extractErrorMessage } from '../lib/apiError'

// ─── Permission Gate ──────────────────────────────────────────────────────────

interface PermissionGateProps {
  onRequest: () => void
  // canAskAgain is false once the user has tapped "Don't allow" — iOS won't
  // re-show the system prompt. We hide the Allow button and surface a deep-link
  // to Settings instead so the user isn't stuck.
  canAskAgain: boolean
}

function PermissionGate({ onRequest, canAskAgain }: PermissionGateProps) {
  return (
    <View className="flex-1 bg-black items-center justify-center px-8">
      <Text className="text-white text-xl font-semibold text-center mb-2">
        Camera access needed
      </Text>
      <Text className="text-zinc-400 text-sm text-center mb-8">
        {canAskAgain
          ? 'PeakForm uses the camera to identify your meal and estimate calories. The photo is not saved.'
          : 'Camera was denied. Open Settings to allow camera access for PeakForm, then come back.'}
      </Text>
      {canAskAgain ? (
        <PressableScale
          haptic
          onPress={onRequest}
          className="bg-white rounded-2xl px-6 py-3"
        >
          <Text className="text-black font-semibold">Allow camera</Text>
        </PressableScale>
      ) : (
        <PressableScale
          haptic
          onPress={() => Linking.openSettings()}
          className="bg-white rounded-2xl px-6 py-3"
        >
          <Text className="text-black font-semibold">Open Settings</Text>
        </PressableScale>
      )}
      <TouchableOpacity onPress={() => router.back()} hitSlop={12} className="mt-4 px-4 py-2.5">
        <Text className="text-zinc-300 text-base font-medium">Cancel</Text>
      </TouchableOpacity>
    </View>
  )
}

// ─── Analyzing Overlay ────────────────────────────────────────────────────────

function AnalyzingOverlay() {
  return (
    <View
      className="absolute inset-0 bg-black/85 items-center justify-center"
      pointerEvents="auto"
    >
      <ActivityIndicator size="large" color="#ffffff" />
      <Text className="text-white text-base font-medium mt-4">Analyzing your meal…</Text>
      <Text className="text-zinc-400 text-xs mt-1">Identifying ingredients and portions</Text>
    </View>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NutritionSnapScreen() {
  const [permission, requestPermission] = useCameraPermissions()
  const [busy, setBusy] = useState(false)
  const cameraRef = useRef<CameraView>(null)

  // Permission states: null = loading, granted false = denied, true = good to go.
  if (!permission) {
    return (
      <View className="flex-1 bg-black items-center justify-center">
        <ActivityIndicator color="#ffffff" />
      </View>
    )
  }
  if (!permission.granted) {
    return (
      <PermissionGate
        onRequest={requestPermission}
        canAskAgain={permission.canAskAgain}
      />
    )
  }

  async function handleCapture() {
    if (busy || !cameraRef.current) return
    setBusy(true)
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.6,
        skipProcessing: false,
      })
      if (!photo?.uri) throw new Error('Capture failed')

      const formData = new FormData()
      formData.append('image', {
        uri: photo.uri,
        type: 'image/jpeg',
        name: 'meal.jpg',
      } as unknown as Blob)

      const { data: estimate } = await api.post('/nutrition/estimate/photo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60_000,
      })

      hapticSuccess()
      router.replace({
        pathname: '/nutrition-confirm',
        params: { estimate: JSON.stringify(estimate) },
      })
    } catch (err: any) {
      const msg =
        err?.response?.status === 503
          ? 'AI service is not configured. Add ANTHROPIC_API_KEY to backend/.env.'
          : extractErrorMessage(
              err,
              'Could not analyze the photo. Try again or type the meal in manually.',
            )
      Alert.alert("Couldn't analyze meal", msg)
      setBusy(false)
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top', 'bottom']}>
      <View className="flex-1">
        <CameraView
          ref={cameraRef}
          style={{ flex: 1 }}
          facing="back"
          mode="picture"
        />

        {/* Top bar — close button */}
        <View className="absolute top-0 left-0 right-0 px-4 pt-3 flex-row items-center justify-between">
          <TouchableOpacity
            onPress={() => router.back()}
            className="w-11 h-11 rounded-full bg-black/60 items-center justify-center"
            hitSlop={12}
          >
            <X size={22} color="#ffffff" strokeWidth={2.25} />
          </TouchableOpacity>
          <View className="bg-black/60 rounded-full px-3 py-1.5">
            <Text className="text-white text-xs">Center your plate in frame</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* Bottom bar — shutter + hint */}
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
