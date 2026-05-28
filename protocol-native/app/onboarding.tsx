import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useState } from 'react'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import {
  isHealthKitPlatform,
  requestHealthPermissions,
  runHealthKitBackfill,
} from '../lib/healthkit'

type AppleHealthStatus = 'idle' | 'connecting' | 'connected' | 'error'

// ─── Types ────────────────────────────────────────────────────────────────────

type Goal = 'bulk' | 'cut' | 'maintain' | 'recomp'
type SleepHours = '<6h' | '6-7h' | '7-8h' | '8h+'
type TrainingFreq = '0-1x' | '2-3x' | '4-5x' | '6x+'
type CaffeineHabit = 'none' | '1_coffee' | '2-3' | 'preworkout'
type EnergyRating = 1 | 2 | 3 | 4 | 5

interface FormState {
  goal: Goal | null
  age: string
  height_cm: string
  weight_kg: string
  avg_sleep_hours: SleepHours | null
  training_frequency: TrainingFreq | null
  caffeine_habit: CaffeineHabit | null
  energy_rating: EnergyRating | null
}

const sleepToHours: Record<SleepHours, number> = {
  '<6h': 5.5,
  '6-7h': 6.5,
  '7-8h': 7.5,
  '8h+': 8.5,
}

const STEPS = [
  { title: "What's your goal?",  subtitle: 'This shapes your targets and scoring.' },
  { title: 'Your stats',          subtitle: 'Used to calculate protein and water targets.' },
  { title: 'Your baseline',       subtitle: 'Calibrates your Form Score from day one.' },
  { title: 'Connect a device',    subtitle: 'Optional — adds sleep and HRV data.' },
]

// ─── Shared UI ────────────────────────────────────────────────────────────────

function OptionButton({
  selected,
  onPress,
  children,
}: {
  selected: boolean
  onPress: () => void
  children: React.ReactNode
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className="w-full px-4 py-4 rounded-2xl border mb-2"
      style={{
        backgroundColor: selected ? 'white' : '#18181b',
        borderColor: selected ? 'white' : '#3f3f46',
      }}
    >
      {children}
    </TouchableOpacity>
  )
}

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <View className="flex-row justify-center gap-1.5 mb-8">
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={{
            height: 4,
            width: i <= current ? 24 : 12,
            borderRadius: 2,
            backgroundColor: i <= current ? 'white' : '#3f3f46',
          }}
        />
      ))}
    </View>
  )
}

// ─── Step 1 — Goal ────────────────────────────────────────────────────────────

function Step1Goal({
  value,
  onChange,
}: {
  value: Goal | null
  onChange: (v: Goal) => void
}) {
  const goals: { key: Goal; label: string; desc: string }[] = [
    { key: 'bulk',     label: 'Bulk',     desc: 'Build muscle, accept some fat gain' },
    { key: 'cut',      label: 'Cut',      desc: 'Lose fat, preserve as much muscle as possible' },
    { key: 'maintain', label: 'Maintain', desc: 'Hold current body composition' },
    { key: 'recomp',   label: 'Recomp',   desc: 'Build muscle and lose fat simultaneously' },
  ]

  return (
    <View>
      {goals.map((g) => (
        <OptionButton key={g.key} selected={value === g.key} onPress={() => onChange(g.key)}>
          <Text
            className="text-sm font-semibold"
            style={{ color: value === g.key ? 'black' : 'white' }}
          >
            {g.label}
          </Text>
          <Text
            className="text-xs mt-0.5"
            style={{ color: value === g.key ? '#52525b' : '#71717a' }}
          >
            {g.desc}
          </Text>
        </OptionButton>
      ))}
    </View>
  )
}

// ─── Step 2 — Stats ───────────────────────────────────────────────────────────

function Step2Stats({
  form,
  onChange,
}: {
  form: FormState
  onChange: (key: keyof FormState, value: string) => void
}) {
  const fields: {
    key: 'age' | 'height_cm' | 'weight_kg'
    label: string
    unit: string
    placeholder: string
  }[] = [
    { key: 'age',       label: 'Age',    unit: 'yrs', placeholder: '25' },
    { key: 'height_cm', label: 'Height', unit: 'cm',  placeholder: '180' },
    { key: 'weight_kg', label: 'Weight', unit: 'kg',  placeholder: '80' },
  ]

  return (
    <View style={{ gap: 16 }}>
      {fields.map((f) => (
        <View key={f.key}>
          <Text className="text-zinc-400 text-xs uppercase tracking-widest mb-1.5">
            {f.label}
          </Text>
          <View>
            <TextInput
              value={form[f.key]}
              onChangeText={(v) => onChange(f.key, v)}
              placeholder={f.placeholder}
              placeholderTextColor="#52525b"
              keyboardType="decimal-pad"
              className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 text-white text-sm"
            />
            <Text className="absolute right-4 top-4 text-zinc-500 text-sm">{f.unit}</Text>
          </View>
        </View>
      ))}
    </View>
  )
}

// ─── Step 3 — Baseline ────────────────────────────────────────────────────────

function Step3Baseline({
  form,
  onChange,
}: {
  form: FormState
  onChange: <K extends keyof FormState>(key: K, value: FormState[K]) => void
}) {
  return (
    <View style={{ gap: 24 }}>
      {/* Sleep */}
      <View>
        <Text className="text-zinc-400 text-xs uppercase tracking-widest mb-2">
          Average sleep last week
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {(['<6h', '6-7h', '7-8h', '8h+'] as SleepHours[]).map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => onChange('avg_sleep_hours', s)}
              className="px-4 py-3 rounded-2xl border"
              style={{
                backgroundColor: form.avg_sleep_hours === s ? 'white' : '#18181b',
                borderColor: form.avg_sleep_hours === s ? 'white' : '#3f3f46',
              }}
            >
              <Text
                className="text-sm font-medium"
                style={{ color: form.avg_sleep_hours === s ? 'black' : '#a1a1aa' }}
              >
                {s}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Training frequency */}
      <View>
        <Text className="text-zinc-400 text-xs uppercase tracking-widest mb-2">
          Training sessions per week
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {(['0-1x', '2-3x', '4-5x', '6x+'] as TrainingFreq[]).map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => onChange('training_frequency', t)}
              className="px-4 py-3 rounded-2xl border"
              style={{
                backgroundColor: form.training_frequency === t ? 'white' : '#18181b',
                borderColor: form.training_frequency === t ? 'white' : '#3f3f46',
              }}
            >
              <Text
                className="text-sm font-medium"
                style={{ color: form.training_frequency === t ? 'black' : '#a1a1aa' }}
              >
                {t}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Caffeine */}
      <View>
        <Text className="text-zinc-400 text-xs uppercase tracking-widest mb-2">
          Daily caffeine habit
        </Text>
        {(
          [
            { key: 'none',       label: 'None' },
            { key: '1_coffee',   label: '1 coffee' },
            { key: '2-3',        label: '2–3 coffees' },
            { key: 'preworkout', label: 'Pre-workout user' },
          ] as { key: CaffeineHabit; label: string }[]
        ).map((c) => (
          <OptionButton
            key={c.key}
            selected={form.caffeine_habit === c.key}
            onPress={() => onChange('caffeine_habit', c.key)}
          >
            <Text
              className="text-sm font-medium"
              style={{ color: form.caffeine_habit === c.key ? 'black' : 'white' }}
            >
              {c.label}
            </Text>
          </OptionButton>
        ))}
      </View>

      {/* Energy rating */}
      <View>
        <Text className="text-zinc-400 text-xs uppercase tracking-widest mb-2">
          Rate your energy last week
        </Text>
        <View className="flex-row gap-2">
          {([1, 2, 3, 4, 5] as EnergyRating[]).map((n) => (
            <TouchableOpacity
              key={n}
              onPress={() => onChange('energy_rating', n)}
              className="flex-1 py-3 rounded-2xl border items-center"
              style={{
                backgroundColor: form.energy_rating === n ? 'white' : '#18181b',
                borderColor: form.energy_rating === n ? 'white' : '#3f3f46',
              }}
            >
              <Text
                className="text-sm font-semibold"
                style={{ color: form.energy_rating === n ? 'black' : '#71717a' }}
              >
                {n}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View className="flex-row justify-between mt-1 px-1">
          <Text className="text-zinc-600 text-xs">Crashed</Text>
          <Text className="text-zinc-600 text-xs">Locked in</Text>
        </View>
      </View>
    </View>
  )
}

// ─── Step 4 — Device ──────────────────────────────────────────────────────────

function Step4Device({
  appleStatus,
  onConnectApple,
}: {
  appleStatus: AppleHealthStatus
  onConnectApple: () => void
}) {
  const appleSupported = isHealthKitPlatform()
  const appleDisabled = !appleSupported || appleStatus === 'connecting' || appleStatus === 'connected'

  return (
    <View style={{ gap: 12 }}>
      <Text className="text-zinc-400 text-sm leading-6 mb-2">
        Connect a wearable to unlock sleep and HRV data. You can always do this later in Settings.
      </Text>

      {/* Oura — not yet */}
      <View className="flex-row items-center justify-between px-4 py-4 rounded-2xl border border-zinc-800 bg-zinc-900 opacity-50">
        <View>
          <Text className="text-white text-sm font-semibold">Oura Ring</Text>
          <Text className="text-zinc-500 text-xs mt-0.5">Sleep, HRV, readiness</Text>
        </View>
        <View className="border border-zinc-700 px-2 py-0.5 rounded-full">
          <Text className="text-zinc-500 text-xs uppercase tracking-widest">Soon</Text>
        </View>
      </View>

      {/* Apple Health */}
      <TouchableOpacity
        onPress={onConnectApple}
        disabled={appleDisabled}
        className="flex-row items-center justify-between px-4 py-4 rounded-2xl border bg-zinc-900"
        style={{
          borderColor: appleStatus === 'connected' ? '#22c55e' : '#3f3f46',
          opacity: appleSupported ? 1 : 0.5,
        }}
      >
        <View>
          <Text className="text-white text-sm font-semibold">Apple Health</Text>
          <Text className="text-zinc-500 text-xs mt-0.5">Steps, sleep, heart rate</Text>
        </View>

        {appleStatus === 'connecting' ? (
          <ActivityIndicator color="white" />
        ) : appleStatus === 'connected' ? (
          <View className="bg-green-950 border border-green-800 px-2 py-0.5 rounded-full">
            <Text className="text-green-400 text-xs uppercase tracking-widest">Connected</Text>
          </View>
        ) : appleSupported ? (
          <Text className="text-zinc-300 text-sm font-medium">Connect →</Text>
        ) : (
          <View className="border border-zinc-700 px-2 py-0.5 rounded-full">
            <Text className="text-zinc-500 text-xs uppercase tracking-widest">iOS only</Text>
          </View>
        )}
      </TouchableOpacity>

      {appleStatus === 'error' && (
        <Text className="text-red-400 text-xs">
          Couldn't read Apple Health. You can try again later in Settings.
        </Text>
      )}
    </View>
  )
}

// ─── Onboarding Screen ────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const { updateUser } = useAuthStore()
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [appleStatus, setAppleStatus] = useState<AppleHealthStatus>('idle')

  async function connectAppleHealth() {
    setAppleStatus('connecting')
    try {
      await requestHealthPermissions()
      await runHealthKitBackfill(14)
      setAppleStatus('connected')
    } catch {
      setAppleStatus('error')
    }
  }

  const [form, setForm] = useState<FormState>({
    goal: null,
    age: '',
    height_cm: '',
    weight_kg: '',
    avg_sleep_hours: null,
    training_frequency: null,
    caffeine_habit: null,
    energy_rating: null,
  })

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function canAdvance() {
    if (step === 0) return form.goal !== null
    if (step === 2)
      return (
        form.avg_sleep_hours !== null &&
        form.training_frequency !== null &&
        form.caffeine_habit !== null &&
        form.energy_rating !== null
      )
    return true
  }

  async function handleNext() {
    if (step < STEPS.length - 1) {
      setError(null)
      setLoading(true)
      try {
        if (step === 0 && form.goal) {
          await api.put('/users/me/onboarding', {
            step: 'goal',
            data: { goal: form.goal },
          })
        }
        if (step === 1) {
          await api.put('/users/me/onboarding', {
            step: 'stats',
            data: {
              age: form.age ? parseInt(form.age) : null,
              height_cm: form.height_cm ? parseFloat(form.height_cm) : null,
              weight_kg: form.weight_kg ? parseFloat(form.weight_kg) : null,
            },
          })
        }
        setStep((s) => s + 1)
      } catch {
        setError('Something went wrong. Please try again.')
      } finally {
        setLoading(false)
      }
    } else {
      // Final step — submit baseline and complete onboarding
      setLoading(true)
      setError(null)
      try {
        await api.post('/users/me/baseline', {
          goal: form.goal,
          age: form.age ? parseInt(form.age) : null,
          height_cm: form.height_cm ? parseFloat(form.height_cm) : null,
          weight_kg: form.weight_kg ? parseFloat(form.weight_kg) : null,
          avg_sleep_hours: form.avg_sleep_hours
            ? sleepToHours[form.avg_sleep_hours]
            : null,
          training_frequency: form.training_frequency,
          caffeine_habit: form.caffeine_habit,
          energy_rating: form.energy_rating,
          device_connected: appleStatus === 'connected' ? 'apple_health' : 'none',
        })
        updateUser({ onboarding_complete: true })
        router.replace('/')
      } catch {
        setError('Something went wrong. Please try again.')
      } finally {
        setLoading(false)
      }
    }
  }

  const isLast = step === STEPS.length - 1
  const canSkip = step === 1 || step === 3

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          className="flex-1 px-6"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {/* Top bar */}
          <View className="flex-row items-center justify-between pt-4 pb-6">
            {step > 0 ? (
              <TouchableOpacity onPress={() => setStep((s) => s - 1)}>
                <Text className="text-zinc-400 text-sm">← Back</Text>
              </TouchableOpacity>
            ) : (
              <View />
            )}
            <Text className="text-zinc-600 text-xs font-medium">
              {step + 1} / {STEPS.length}
            </Text>
          </View>

          <StepDots current={step} total={STEPS.length} />

          {/* Step header */}
          <Text className="text-white text-2xl font-bold mb-1">
            {STEPS[step].title}
          </Text>
          <Text className="text-zinc-500 text-sm mb-8">
            {STEPS[step].subtitle}
          </Text>

          {/* Step content */}
          {step === 0 && (
            <Step1Goal value={form.goal} onChange={(v) => setField('goal', v)} />
          )}
          {step === 1 && (
            <Step2Stats
              form={form}
              onChange={(key, value) => setField(key, value as any)}
            />
          )}
          {step === 2 && <Step3Baseline form={form} onChange={setField} />}
          {step === 3 && (
            <Step4Device appleStatus={appleStatus} onConnectApple={connectAppleHealth} />
          )}

          {/* Error */}
          {error && (
            <View className="bg-red-950 border border-red-900 rounded-2xl px-4 py-3 mt-4">
              <Text className="text-red-400 text-sm">{error}</Text>
            </View>
          )}
        </ScrollView>

        {/* Footer */}
        <View className="px-6 pb-8 pt-2" style={{ gap: 8 }}>
          <TouchableOpacity
            onPress={handleNext}
            disabled={loading || !canAdvance()}
            className="bg-white rounded-2xl py-4 items-center"
            style={{ opacity: loading || !canAdvance() ? 0.4 : 1 }}
          >
            {loading ? (
              <ActivityIndicator color="black" />
            ) : (
              <Text className="text-black font-semibold text-base">
                {isLast ? 'Finish setup' : 'Continue'}
              </Text>
            )}
          </TouchableOpacity>

          {canSkip && (
            <TouchableOpacity
              onPress={handleNext}
              disabled={loading}
              className="py-2 items-center"
            >
              <Text className="text-zinc-500 text-sm">
                {step === 3 ? 'Skip for now' : 'Skip'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}