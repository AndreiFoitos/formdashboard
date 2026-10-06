import { useEffect, useState } from 'react'
import { Modal, Text, TouchableOpacity, View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { useAuthStore } from '../store/auth'
import { getToken, setToken } from '../lib/storage'
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from '../lib/legal'

// One-time notice for a substantive privacy policy change, which the policy
// itself promises ("surface a notice in-app at next sign-in"). Shown once per
// user per device to accounts created before the change; newer accounts
// agreed to the current version at signup.
//
// For the next substantive change: bump POLICY_VERSION to the new
// "Last updated" date in gainrace-legal/privacy.html and rewrite POINTS.

const POLICY_VERSION = '2026-10-04'

const POINTS = [
  'Pit Crew, the new training and meal planner, uses your logs plus your optional training and food answers, including the optional health questions.',
  'A summary of that data is sent to Anthropic (Claude) to build your plans and answer the Pit Crew chat. The chat is saved until you start a new one or delete your account.',
  'Pit Crew plans are general fitness guidance, not medical advice.',
]

function seenKey(userId: string) {
  return `policy_seen_${userId}`
}

export function PolicyUpdateNotice() {
  const user = useAuthStore((s) => s.user)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!user?.onboarding_complete || !user.created_at) return
    if (new Date(user.created_at) >= new Date(`${POLICY_VERSION}T00:00:00Z`)) return
    let cancelled = false
    getToken(seenKey(user.id))
      .then((seen) => {
        if (!cancelled && seen !== POLICY_VERSION) setVisible(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user?.id, user?.onboarding_complete, user?.created_at])

  function dismiss() {
    setVisible(false)
    if (user) setToken(seenKey(user.id), POLICY_VERSION).catch(() => {})
  }

  if (!visible) return null

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View className="flex-1 bg-bg/70 items-center justify-center px-6">
        <View className="w-full bg-surface border border-divider rounded-xl p-6" style={{ borderCurve: 'continuous' }}>
          <Text className="text-text text-headline font-bold">We've updated our Privacy Policy and Terms</Text>
          <Text className="text-text-subtle text-caption mt-1">Effective {POLICY_VERSION}</Text>
          <View className="mt-4 gap-3">
            {POINTS.map((p) => (
              <View key={p} className="flex-row gap-2">
                <Text className="text-text-subtle text-footnote">•</Text>
                <Text className="text-text-muted text-footnote flex-1">{p}</Text>
              </View>
            ))}
          </View>
          <Text className="text-text-subtle text-caption mt-4">
            Health answers are optional, and you can change or clear them under Settings → Training & food.
          </Text>
          <View className="flex-row mt-4 gap-4">
            <TouchableOpacity onPress={() => WebBrowser.openBrowserAsync(PRIVACY_POLICY_URL)} hitSlop={8}>
              <Text className="text-text text-footnote font-medium underline">Privacy policy</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => WebBrowser.openBrowserAsync(TERMS_OF_SERVICE_URL)} hitSlop={8}>
              <Text className="text-text text-footnote font-medium underline">Terms</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={dismiss} className="bg-accent rounded-md py-4 items-center mt-6" style={{ borderCurve: 'continuous' }}>
            <Text className="text-on-accent font-semibold text-body">Got it</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}
