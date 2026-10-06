import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, AppState, Linking, Text, TouchableOpacity, View } from 'react-native'
import { Bell } from 'lucide-react-native'
import { useAuthStore } from '../store/auth'
import { getToken, setToken } from '../lib/storage'
import { enablePredictiveNudges, getNudgeStatus, registerIfGranted } from '../lib/notifications'
import { hapticSuccess } from '../lib/haptics'
import { colors } from '../theme/tokens'

// What notifications do for you, shown before asking. Shared by the last
// onboarding step and the Today card so both say the same thing.
export const NOTIFICATION_REASONS = [
  'Reminders at the times you usually log water and coffee, with a Log button right in the notification',
  'When your Pit Crew plan is ready, and your weekly check-in on Sunday',
  "When a friend sets a PR or passes you in the weekly race",
]

const SNOOZE_DAYS = 14

function dismissKey(userId: string) {
  return `notif_card_dismissed_${userId}`
}

/** Today-screen card for users who haven't allowed notifications. "Not now"
 *  hides it for two weeks. If iOS won't prompt again (they said no once), the
 *  button opens iPhone Settings instead, and the card rechecks when the app
 *  comes back to the foreground. */
export function NotificationsCard() {
  const user = useAuthStore((s) => s.user)
  const [state, setState] = useState<'hidden' | 'ask' | 'settings'>('hidden')
  const [busy, setBusy] = useState(false)
  const shown = useRef(false)

  const check = useCallback(async () => {
    if (!user) return
    const status = await getNudgeStatus()
    if (status.granted) {
      // Allowed in iPhone Settings while the card was up: register now.
      if (shown.current) registerIfGranted().catch(() => {})
      shown.current = false
      return setState('hidden')
    }
    const dismissed = await getToken(dismissKey(user.id)).catch(() => null)
    if (dismissed && Date.now() - Number(dismissed) < SNOOZE_DAYS * 86_400_000) return setState('hidden')
    shown.current = true
    setState(status.canAskAgain ? 'ask' : 'settings')
  }, [user?.id])

  useEffect(() => {
    check()
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check()
    })
    return () => sub.remove()
  }, [check])

  async function turnOn() {
    if (state === 'settings') {
      Linking.openSettings()
      return
    }
    setBusy(true)
    const r = await enablePredictiveNudges()
    setBusy(false)
    if (r.enabled) {
      hapticSuccess()
      setState('hidden')
    } else {
      check()
    }
  }

  function notNow() {
    if (user) setToken(dismissKey(user.id), String(Date.now())).catch(() => {})
    setState('hidden')
  }

  if (state === 'hidden') return null

  return (
    <View className="bg-surface border border-divider rounded-xl p-4 mb-4" style={{ borderCurve: 'continuous' }}>
      <View className="flex-row items-center gap-3">
        <Bell size={18} color={colors.accent} />
        <Text className="text-text text-body font-semibold flex-1">Turn on notifications</Text>
      </View>
      <View className="mt-3 gap-2">
        {NOTIFICATION_REASONS.map((r) => (
          <Text key={r} className="text-text-muted text-caption">• {r}</Text>
        ))}
      </View>
      <View className="flex-row mt-4 gap-2">
        <TouchableOpacity hitSlop={10} onPress={turnOn} disabled={busy} className="bg-accent rounded-full px-4 py-2" style={{ borderCurve: 'continuous' }}>
          {busy ? (
            <ActivityIndicator size="small" color={colors['on-accent']} />
          ) : (
            <Text className="text-on-accent text-footnote font-semibold">
              {state === 'settings' ? 'Open Settings' : 'Turn on'}
            </Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity hitSlop={10} onPress={notNow} className="rounded-full px-4 py-2 border border-border" style={{ borderCurve: 'continuous' }}>
          <Text className="text-text-muted text-footnote font-semibold">Not now</Text>
        </TouchableOpacity>
      </View>
      {state === 'settings' && (
        <Text className="text-text-subtle text-caption mt-3">
          Notifications were turned off for GainRace. Allow them under Settings → GainRace → Notifications.
        </Text>
      )}
    </View>
  )
}
