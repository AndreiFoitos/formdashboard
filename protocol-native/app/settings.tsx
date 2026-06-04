import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
} from 'react-native'
import { useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react-native'
import Constants from 'expo-constants'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { removeToken } from '../lib/storage'
import { hapticSuccess } from '../lib/haptics'
import {
  PRIVACY_POLICY_URL,
  TERMS_OF_SERVICE_URL,
  SUPPORT_EMAIL,
} from '../lib/legal'
import {
  disableNudges,
  enablePredictiveNudges,
  getNudgeStatus,
} from '../lib/notifications'

// ─── Section wrapper ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-6">
      <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-3">{title}</Text>
      <View className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        {children}
      </View>
    </View>
  )
}

// ─── Profile & targets ─────────────────────────────────────────────────────────

function hourLabel(h: number): string {
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return `${display}:00 ${period}`
}

function TargetRow({
  label,
  value,
  onChangeText,
  unit,
  placeholder,
}: {
  label: string
  value: string
  onChangeText: (v: string) => void
  unit: string
  placeholder: string
}) {
  return (
    <View className="flex-row items-center justify-between px-4 py-3.5 border-b border-zinc-800">
      <Text className="text-zinc-300 text-sm">{label}</Text>
      <View className="flex-row items-center">
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#52525b"
          keyboardType="number-pad"
          className="text-white text-sm text-right"
          style={{ minWidth: 64 }}
        />
        <Text className="text-zinc-500 text-xs ml-1">{unit}</Text>
      </View>
    </View>
  )
}

function ProfileSection() {
  const { user, updateUser } = useAuthStore()
  const qc = useQueryClient()

  const [username, setUsername] = useState(user?.username ?? '')
  const [protein, setProtein] = useState(
    user?.protein_target_g != null ? String(Math.round(user.protein_target_g)) : '',
  )
  const [water, setWater] = useState(
    user?.water_target_ml != null ? String(user.water_target_ml) : '',
  )
  const [calories, setCalories] = useState(
    user?.calorie_target != null ? String(user.calorie_target) : '',
  )
  const [bedtime, setBedtime] = useState<number>(user?.sleep_hour ?? 23)
  const [saved, setSaved] = useState(false)
  const [usernameError, setUsernameError] = useState<string | null>(null)

  const usernameValid = /^[a-z0-9_]{3,24}$/.test(username)
  const usernameDirty = username !== (user?.username ?? '')

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.put('/users/me', payload).then((r) => r.data),
    onSuccess: (updated) => {
      updateUser(updated)
      hapticSuccess()
      setUsernameError(null)
      // Targets and bedtime feed the Form Score + caffeine curve — refresh them.
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['friends-list'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail
      // 409 from /users/me only fires for username conflicts right now.
      if (err?.response?.status === 409 || typeof msg === 'string' && msg.toLowerCase().includes('username')) {
        setUsernameError(typeof msg === 'string' ? msg : 'Username already taken')
      } else {
        Alert.alert('Save failed', typeof msg === 'string' ? msg : 'Try again')
      }
    },
  })

  function onSave() {
    if (usernameDirty && !usernameValid) {
      setUsernameError('3–24 chars; lowercase letters, numbers, underscores')
      return
    }
    setUsernameError(null)
    save.mutate({
      username: usernameDirty ? username : undefined,
      sleep_hour: bedtime,
      protein_target_g: protein.trim() ? parseFloat(protein) : null,
      water_target_ml: water.trim() ? parseInt(water) : null,
      calorie_target: calories.trim() ? parseInt(calories) : null,
    })
  }

  return (
    <Section title="Profile & Targets">
      {/* Username */}
      <View className="px-4 py-3.5 border-b border-zinc-800">
        <Text className="text-zinc-300 text-sm mb-1">Username</Text>
        <Text className="text-zinc-600 text-xs mb-2">Friends invite you with this handle</Text>
        <View className="flex-row items-center bg-zinc-950 border border-zinc-800 rounded-xl px-3">
          <Text className="text-zinc-500 text-sm">@</Text>
          <TextInput
            value={username}
            onChangeText={(v) => {
              setUsername(v.replace(/^@/, '').toLowerCase())
              setUsernameError(null)
            }}
            placeholder="your_handle"
            placeholderTextColor="#52525b"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={24}
            className="flex-1 py-2.5 text-white text-sm ml-1"
          />
        </View>
        {usernameError && (
          <Text className="text-red-400 text-xs mt-1.5">{usernameError}</Text>
        )}
      </View>

      <TargetRow label="Protein target" value={protein} onChangeText={setProtein} unit="g" placeholder="160" />
      <TargetRow label="Water target" value={water} onChangeText={setWater} unit="ml" placeholder="2800" />
      <TargetRow label="Calorie target" value={calories} onChangeText={setCalories} unit="kcal" placeholder="2400" />

      {/* Bedtime */}
      <View className="flex-row items-center justify-between px-4 py-3.5 border-b border-zinc-800">
        <View className="flex-1 pr-3">
          <Text className="text-zinc-300 text-sm">Bedtime</Text>
          <Text className="text-zinc-600 text-xs mt-0.5">Drives caffeine-at-night scoring</Text>
        </View>
        <View className="flex-row items-center" style={{ gap: 10 }}>
          <TouchableOpacity
            onPress={() => setBedtime((h) => (h + 23) % 24)}
            className="w-8 h-8 rounded-full bg-zinc-800 items-center justify-center"
          >
            <Text className="text-white text-lg leading-5">−</Text>
          </TouchableOpacity>
          <Text className="text-white text-sm font-medium text-center" style={{ width: 76 }}>
            {hourLabel(bedtime)}
          </Text>
          <TouchableOpacity
            onPress={() => setBedtime((h) => (h + 1) % 24)}
            className="w-8 h-8 rounded-full bg-zinc-800 items-center justify-center"
          >
            <Text className="text-white text-lg leading-5">+</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Save */}
      <TouchableOpacity
        onPress={onSave}
        disabled={save.isPending}
        className="px-4 py-4 items-center"
      >
        {save.isPending ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text
            className="text-sm font-semibold"
            style={{ color: saved ? '#22c55e' : '#ffffff' }}
          >
            {saved ? 'Saved ✓' : 'Save changes'}
          </Text>
        )}
      </TouchableOpacity>
    </Section>
  )
}

// ─── Smart nudges ──────────────────────────────────────────────────────────────

interface PatternSlot {
  log_type: 'hydration' | 'stimulant'
  weekday: number
  slot_minute: number
  time_label: string
  confidence: number
  sample_count: number
  suggested_amount_ml: number | null
  suggested_substance: string | null
  suggested_caffeine_mg: number | null
}

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function formatTime12h(slotMin: number): string {
  const h = Math.floor(slotMin / 60)
  const m = slotMin % 60
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return `${display}:${m.toString().padStart(2, '0')} ${period}`
}

function slotSummary(s: PatternSlot): string {
  if (s.log_type === 'hydration') {
    return s.suggested_amount_ml ? `${s.suggested_amount_ml} ml water` : 'Water'
  }
  const label = s.suggested_substance
    ? s.suggested_substance.charAt(0).toUpperCase() + s.suggested_substance.slice(1)
    : 'Coffee'
  return s.suggested_caffeine_mg ? `${label} (${s.suggested_caffeine_mg} mg)` : label
}

function NudgesSection() {
  const qc = useQueryClient()

  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['nudge-status'],
    queryFn: getNudgeStatus,
  })

  // Only fetch patterns when nudges are enabled — saves a roundtrip.
  const { data: slots, isLoading: slotsLoading } = useQuery<PatternSlot[]>({
    queryKey: ['notif-patterns'],
    queryFn: () => api.get('/notifications/patterns').then((r) => r.data),
    enabled: !!status?.granted,
  })

  const enable = useMutation({
    mutationFn: enablePredictiveNudges,
    onSuccess: (result) => {
      if (result.enabled) {
        hapticSuccess()
        qc.invalidateQueries({ queryKey: ['notif-patterns'] })
      } else if (result.reason === 'permission_denied') {
        Alert.alert(
          'Notifications blocked',
          'Open Settings and allow notifications for Protocol to turn this on.',
        )
      }
      refetchStatus()
    },
  })

  const disable = useMutation({
    mutationFn: disableNudges,
    onSuccess: () => {
      refetchStatus()
      qc.removeQueries({ queryKey: ['notif-patterns'] })
    },
  })

  const enabled = !!status?.granted
  const busy = enable.isPending || disable.isPending

  // Show at most 6 slots in the preview — the rest is in the full list
  // (which we don't surface yet; this is just a "what we'd nudge" preview).
  const previewSlots = (slots ?? []).slice(0, 6)

  return (
    <Section title="Smart nudges">
      <View className="flex-row items-center justify-between px-4 py-4 border-b border-zinc-800">
        <View className="flex-1 pr-3">
          <Text className="text-white text-sm font-semibold">Predictive log reminders</Text>
          <Text className="text-zinc-500 text-xs mt-0.5">
            Notifies you when you usually log water or coffee. Tap the notification
            action to log it without opening the app.
          </Text>
        </View>
        {busy ? (
          <ActivityIndicator color="white" />
        ) : enabled ? (
          <TouchableOpacity onPress={() => disable.mutate()}>
            <Text className="text-red-400 text-sm font-medium">Turn off</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={() => enable.mutate()}
            className="bg-white px-3 py-1.5 rounded-lg"
          >
            <Text className="text-black text-xs font-semibold">Turn on</Text>
          </TouchableOpacity>
        )}
      </View>

      {enabled && (
        <View className="px-4 py-3.5">
          <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">
            Detected patterns
          </Text>
          {slotsLoading ? (
            <ActivityIndicator color="#71717a" />
          ) : previewSlots.length === 0 ? (
            <Text className="text-zinc-500 text-xs">
              Not enough log history yet. Patterns appear after ~3 weeks of consistent logging.
            </Text>
          ) : (
            previewSlots.map((s, i) => (
              <View
                key={`${s.log_type}-${s.weekday}-${s.slot_minute}`}
                className="flex-row items-center justify-between py-1.5"
                style={{ borderTopWidth: i === 0 ? 0 : 0.5, borderColor: '#27272a' }}
              >
                <Text className="text-zinc-300 text-sm">
                  {WEEKDAY_SHORT[s.weekday]} {formatTime12h(s.slot_minute)}
                </Text>
                <Text className="text-zinc-500 text-xs">{slotSummary(s)}</Text>
              </View>
            ))
          )}
        </View>
      )}
    </Section>
  )
}

// ─── About / Legal ─────────────────────────────────────────────────────────────

function LegalRow({
  label,
  onPress,
  showBorder = true,
}: {
  label: string
  onPress: () => void
  showBorder?: boolean
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className={`px-4 py-4 ${showBorder ? 'border-b border-zinc-800' : ''}`}
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-white text-sm">{label}</Text>
        <Text className="text-zinc-500 text-base">›</Text>
      </View>
    </TouchableOpacity>
  )
}

function AboutSection() {
  // expoConfig is the source of truth at runtime — version and buildNumber
  // come from app.json (production) or eas-update overrides (in OTA-pushed
  // builds). Constants.nativeBuildVersion is the iOS CFBundleVersion.
  const version = Constants.expoConfig?.version ?? '—'
  const build =
    Constants.expoConfig?.ios?.buildNumber ?? Constants.nativeBuildVersion ?? '—'

  return (
    <Section title="About">
      <LegalRow
        label="Privacy Policy"
        onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
      />
      <LegalRow
        label="Terms of Service"
        onPress={() => Linking.openURL(TERMS_OF_SERVICE_URL)}
      />
      <LegalRow
        label="Contact support"
        onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
        showBorder={false}
      />
      <View className="px-4 py-3 border-t border-zinc-800">
        <Text className="text-zinc-500 text-xs">
          Version {version} (build {build})
        </Text>
      </View>
    </Section>
  )
}

// ─── Delete account (Apple Guideline 5.1.1(v)) ─────────────────────────────────

function DeleteAccountSection() {
  const { user, clearAuth } = useAuthStore()
  const [step, setStep] = useState<'idle' | 'confirming' | 'submitting'>('idle')
  const [typed, setTyped] = useState('')

  const email = user?.email ?? ''
  // Compare on trimmed-lowercase since iOS keyboards capitalize the first letter
  // and add a trailing space on autocomplete.
  const matches = typed.trim().toLowerCase() === email.toLowerCase() && email.length > 0

  async function submit() {
    if (!matches) return
    setStep('submitting')
    try {
      await api.delete('/users/me', {
        data: { email_confirmation: typed.trim() },
      })
      await removeToken('refresh_token')
      clearAuth()
      router.replace('/login')
    } catch (e: any) {
      const detail = e?.response?.data?.detail
      Alert.alert(
        'Delete failed',
        typeof detail === 'string' ? detail : 'Could not delete your account. Try again or contact support.',
      )
      setStep('confirming')
    }
  }

  if (step === 'idle') {
    return (
      <TouchableOpacity
        onPress={() =>
          Alert.alert(
            'Delete your account?',
            'This permanently deletes your account, all logs, friendships, photos, and AI history. You cannot undo this.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Continue',
                style: 'destructive',
                onPress: () => setStep('confirming'),
              },
            ],
          )
        }
        className="px-4 py-4"
      >
        <Text className="text-red-400 text-sm font-medium">Delete account</Text>
      </TouchableOpacity>
    )
  }

  return (
    <View className="px-4 py-4">
      <Text className="text-red-300 text-sm font-semibold mb-1">
        Type your email to confirm
      </Text>
      <Text className="text-zinc-500 text-xs mb-3">
        Account: <Text className="text-zinc-300">{email || '—'}</Text>
      </Text>
      <TextInput
        value={typed}
        onChangeText={setTyped}
        placeholder="Type your email"
        placeholderTextColor="#52525b"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        editable={step !== 'submitting'}
        className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-white text-sm mb-3"
      />
      <View className="flex-row" style={{ gap: 8 }}>
        <TouchableOpacity
          onPress={() => {
            setStep('idle')
            setTyped('')
          }}
          disabled={step === 'submitting'}
          className="flex-1 bg-zinc-800 rounded-xl py-3 items-center"
        >
          <Text className="text-white text-sm font-medium">Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={submit}
          disabled={!matches || step === 'submitting'}
          className="flex-1 rounded-xl py-3 items-center"
          style={{ backgroundColor: matches && step !== 'submitting' ? '#dc2626' : '#3f3f46' }}
        >
          {step === 'submitting' ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white text-sm font-semibold">Delete forever</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  )
}

// ─── Settings Screen ─────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const { user, clearAuth } = useAuthStore()

  function signOut() {
    Alert.alert('Sign out', 'You can sign back in anytime.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await removeToken('refresh_token')
          clearAuth()
          router.replace('/login')
        },
      },
    ])
  }

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center px-4 pt-2 pb-4">
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} className="-ml-1 pr-4 py-2 flex-row items-center" style={{ gap: 2 }}>
          <ChevronLeft size={22} color="#d4d4d8" strokeWidth={2.25} />
          <Text className="text-zinc-300 text-base font-medium">Back</Text>
        </TouchableOpacity>
        <Text className="text-white text-xl font-bold">Settings</Text>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <ProfileSection />

        <NudgesSection />

        <Section title="How it works">
          <TouchableOpacity
            onPress={() => router.push('/methodology')}
            className="px-4 py-4"
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text className="text-white text-sm font-medium">How is this calculated?</Text>
                <Text className="text-zinc-500 text-xs mt-0.5">
                  Form Score, DOTS, caffeine curve, sus threshold, PR detection — formulas and sources.
                </Text>
              </View>
              <Text className="text-zinc-500 text-base">›</Text>
            </View>
          </TouchableOpacity>
        </Section>

        <Section title="Account">
          <View className="px-4 py-4 border-b border-zinc-800">
            <Text className="text-zinc-500 text-xs">Signed in as</Text>
            <Text className="text-white text-sm mt-0.5">{user?.email ?? '—'}</Text>
          </View>
          <TouchableOpacity onPress={signOut} className="px-4 py-4 border-b border-zinc-800">
            <Text className="text-red-400 text-sm font-medium">Sign out</Text>
          </TouchableOpacity>
          <DeleteAccountSection />
        </Section>

        <AboutSection />
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
