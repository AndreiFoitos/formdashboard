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
import { useEffect, useMemo, useState } from 'react'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { extractErrorMessage } from '../lib/apiError'

// ─── Types ────────────────────────────────────────────────────────────────────

type Sex = 'male' | 'female'
type SleepHours = '<6h' | '6-7h' | '7-8h' | '8h+'
type TrainingFreq = '0-1x' | '2-3x' | '4-5x' | '6x+'
type CaffeineHabit = 'none' | '1_coffee' | '2-3' | 'preworkout'

interface FormState {
  username: string
  age: string
  sex: Sex | null
  height_cm: string
  weight_kg: string
  avg_sleep_hours: SleepHours | null
  training_frequency: TrainingFreq | null
  caffeine_habit: CaffeineHabit | null
  protein_target_g: string
  water_target_ml: string
  calorie_target: string
  sleep_hour: number
}

const sleepToHours: Record<SleepHours, number> = {
  '<6h': 5.5,
  '6-7h': 6.5,
  '7-8h': 7.5,
  '8h+': 8.5,
}

// Training frequency → activity multiplier for TDEE (Harris-Benedict revised
// activity factors, as adopted across modern sports-nutrition guidance —
// e.g. Mifflin et al. 1990; ISSN position stand 2017).
const ACTIVITY_MULTIPLIER: Record<TrainingFreq, number> = {
  '0-1x': 1.2,    // sedentary
  '2-3x': 1.375,  // lightly active
  '4-5x': 1.55,   // moderately active
  '6x+':  1.725,  // very active
}

const STEPS = [
  { title: 'Pick a username',  subtitle: 'Friends invite you with this @ handle.' },
  { title: 'Your stats',       subtitle: 'Used to calculate protein, water, and calorie targets.' },
  { title: 'Your baseline',    subtitle: 'Calibrates your Form Score from day one.' },
  { title: 'Your targets',     subtitle: 'Pre-filled from your stats. You can edit any of these later in Settings.' },
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

function hourLabel(h: number): string {
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return `${display}:00 ${period}`
}

// ─── BMR / TDEE (Mifflin-St Jeor, JADA 2005 + ISSN activity factors) ──────────

function mifflinStJeorBMR(
  sex: Sex,
  weightKg: number,
  heightCm: number,
  ageYears: number,
): number {
  // BMR (kcal/day) = 10·W + 6.25·H − 5·A + s, where s = +5 (male) / −161 (female)
  const offset = sex === 'male' ? 5 : -161
  return 10 * weightKg + 6.25 * heightCm - 5 * ageYears + offset
}

function tdee(
  sex: Sex,
  weightKg: number,
  heightCm: number,
  ageYears: number,
  freq: TrainingFreq,
): number {
  return mifflinStJeorBMR(sex, weightKg, heightCm, ageYears) * ACTIVITY_MULTIPLIER[freq]
}

// Cut: 500 kcal/day deficit ≈ 0.45 kg/week (ACSM position stand, Donnelly et al. 2009).
// Bulk: 300 kcal/day surplus — conservative lean-mass-gain target backed by
//   Aragon & Schoenfeld (J Int Soc Sports Nutr 2013) and Helms et al. (2014).
const DEFICIT_KCAL = 500
const SURPLUS_KCAL = 300

// ─── Step 1 — Username ────────────────────────────────────────────────────────

const USERNAME_RE = /^[a-z0-9_]{3,24}$/

type UsernameState = 'idle' | 'checking' | 'ok' | 'taken' | 'format'

function Step1Username({
  value,
  state,
  onChange,
}: {
  value: string
  state: UsernameState
  onChange: (v: string) => void
}) {
  return (
    <View>
      <View
        className="flex-row items-center bg-zinc-900 border rounded-2xl px-4 py-1"
        style={{ borderColor: state === 'taken' || state === 'format' ? '#7f1d1d' : '#3f3f46' }}
      >
        <Text className="text-zinc-500 text-base">@</Text>
        <TextInput
          value={value}
          onChangeText={(v) => onChange(v.replace(/^@/, '').toLowerCase())}
          placeholder="your_handle"
          placeholderTextColor="#52525b"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={24}
          className="flex-1 py-3 text-white text-base ml-1"
        />
        {state === 'checking' && <ActivityIndicator color="#71717a" />}
        {state === 'ok' && (
          <Text className="text-green-500 text-sm font-medium">Available</Text>
        )}
      </View>
      <Text
        className="text-xs mt-2"
        style={{
          color:
            state === 'taken' || state === 'format' ? '#f87171' : '#71717a',
        }}
      >
        {state === 'taken'
          ? 'That handle is taken — try another.'
          : '3–24 chars; lowercase letters, numbers, underscores only.'}
      </Text>
    </View>
  )
}

// ─── Step 2 — Stats ───────────────────────────────────────────────────────────

function Step2Stats({
  form,
  onChangeString,
  onChangeSex,
}: {
  form: FormState
  onChangeString: (key: 'age' | 'height_cm' | 'weight_kg', value: string) => void
  onChangeSex: (sex: Sex) => void
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
      {/* Sex */}
      <View>
        <Text className="text-zinc-400 text-xs uppercase tracking-widest mb-1.5">
          Biological sex
        </Text>
        <View className="flex-row gap-2">
          {(['male', 'female'] as Sex[]).map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => onChangeSex(s)}
              className="flex-1 py-3 rounded-2xl border items-center"
              style={{
                backgroundColor: form.sex === s ? 'white' : '#18181b',
                borderColor: form.sex === s ? 'white' : '#3f3f46',
              }}
            >
              <Text
                className="text-sm font-semibold capitalize"
                style={{ color: form.sex === s ? 'black' : '#a1a1aa' }}
              >
                {s}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text className="text-zinc-600 text-xs mt-1.5">
          Used for BMR / calorie estimates only.
        </Text>
      </View>

      {fields.map((f) => (
        <View key={f.key}>
          <Text className="text-zinc-400 text-xs uppercase tracking-widest mb-1.5">
            {f.label}
          </Text>
          <View>
            <TextInput
              value={form[f.key]}
              onChangeText={(v) => onChangeString(f.key, v)}
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
    </View>
  )
}

// ─── Step 4 — Targets ─────────────────────────────────────────────────────────

interface CalorieOption {
  key: 'cut' | 'maintain' | 'bulk'
  label: string
  desc: string
  kcal: number
}

function CalorieGoalChips({
  options,
  selected,
  onPick,
}: {
  options: CalorieOption[]
  selected: CalorieOption['key'] | null
  onPick: (o: CalorieOption) => void
}) {
  return (
    <View>
      <Text className="text-zinc-400 text-xs uppercase tracking-widest mb-2">
        Suggested calorie goals
      </Text>
      <View style={{ gap: 8 }}>
        {options.map((o) => {
          const active = selected === o.key
          return (
            <TouchableOpacity
              key={o.key}
              onPress={() => onPick(o)}
              className="flex-row items-center justify-between px-4 py-3 rounded-2xl border"
              style={{
                backgroundColor: active ? 'white' : '#18181b',
                borderColor: active ? 'white' : '#3f3f46',
              }}
            >
              <View className="flex-1 pr-3">
                <Text
                  className="text-sm font-semibold"
                  style={{ color: active ? 'black' : 'white' }}
                >
                  {o.label}
                </Text>
                <Text
                  className="text-xs mt-0.5"
                  style={{ color: active ? '#52525b' : '#71717a' }}
                >
                  {o.desc}
                </Text>
              </View>
              <Text
                className="text-sm font-bold"
                style={{ color: active ? 'black' : 'white' }}
              >
                {o.kcal.toLocaleString()} kcal
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>
      <Text className="text-zinc-600 text-xs mt-2">
        Mifflin-St Jeor BMR × your training-day activity factor. Cut: −500 kcal/day (~0.45 kg/week loss). Bulk: +300 kcal/day (lean-mass focus).
      </Text>
    </View>
  )
}

function Step4Targets({
  form,
  options,
  selectedGoal,
  onChange,
  onChangeBedtime,
  onPickGoal,
}: {
  form: FormState
  options: CalorieOption[] | null
  selectedGoal: CalorieOption['key'] | null
  onChange: (key: 'protein_target_g' | 'water_target_ml' | 'calorie_target', value: string) => void
  onChangeBedtime: (delta: 1 | -1) => void
  onPickGoal: (o: CalorieOption) => void
}) {
  return (
    <View style={{ gap: 20 }}>
      {/* Protein */}
      <View>
        <Text className="text-zinc-400 text-xs uppercase tracking-widest mb-1.5">Protein</Text>
        <View>
          <TextInput
            value={form.protein_target_g}
            onChangeText={(v) => onChange('protein_target_g', v)}
            placeholder="160"
            placeholderTextColor="#52525b"
            keyboardType="number-pad"
            className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 text-white text-sm"
          />
          <Text className="absolute right-4 top-4 text-zinc-500 text-sm">g</Text>
        </View>
      </View>

      {/* Water */}
      <View>
        <Text className="text-zinc-400 text-xs uppercase tracking-widest mb-1.5">Water</Text>
        <View>
          <TextInput
            value={form.water_target_ml}
            onChangeText={(v) => onChange('water_target_ml', v)}
            placeholder="2800"
            placeholderTextColor="#52525b"
            keyboardType="number-pad"
            className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 text-white text-sm"
          />
          <Text className="absolute right-4 top-4 text-zinc-500 text-sm">ml</Text>
        </View>
      </View>

      {/* Calorie goal pickers */}
      {options && (
        <CalorieGoalChips
          options={options}
          selected={selectedGoal}
          onPick={onPickGoal}
        />
      )}

      {/* Calorie target input */}
      <View>
        <Text className="text-zinc-400 text-xs uppercase tracking-widest mb-1.5">
          Calorie target
        </Text>
        <View>
          <TextInput
            value={form.calorie_target}
            onChangeText={(v) => onChange('calorie_target', v)}
            placeholder="2400"
            placeholderTextColor="#52525b"
            keyboardType="number-pad"
            className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 text-white text-sm"
          />
          <Text className="absolute right-4 top-4 text-zinc-500 text-sm">kcal</Text>
        </View>
      </View>

      {/* Bedtime */}
      <View>
        <Text className="text-zinc-400 text-xs uppercase tracking-widest mb-1.5">
          Bedtime
        </Text>
        <View className="flex-row items-center justify-between bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3">
          <Text className="text-zinc-600 text-xs flex-1 pr-3">
            Drives caffeine-at-night scoring
          </Text>
          <View className="flex-row items-center" style={{ gap: 10 }}>
            <TouchableOpacity
              onPress={() => onChangeBedtime(-1)}
              className="w-8 h-8 rounded-full bg-zinc-800 items-center justify-center"
            >
              <Text className="text-white text-lg leading-5">−</Text>
            </TouchableOpacity>
            <Text className="text-white text-sm font-medium text-center" style={{ width: 76 }}>
              {hourLabel(form.sleep_hour)}
            </Text>
            <TouchableOpacity
              onPress={() => onChangeBedtime(1)}
              className="w-8 h-8 rounded-full bg-zinc-800 items-center justify-center"
            >
              <Text className="text-white text-lg leading-5">+</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  )
}

// ─── Onboarding Screen ────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const { user, updateUser } = useAuthStore()
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [usernameState, setUsernameState] = useState<UsernameState>('idle')
  const [selectedGoal, setSelectedGoal] = useState<CalorieOption['key'] | null>(null)

  const [form, setForm] = useState<FormState>({
    username: user?.username ?? '',
    age: '',
    sex: user?.sex ?? null,
    height_cm: '',
    weight_kg: '',
    avg_sleep_hours: null,
    training_frequency: null,
    caffeine_habit: null,
    protein_target_g: '',
    water_target_ml: '',
    calorie_target: '',
    sleep_hour: user?.sleep_hour ?? 23,
  })

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function autoFillTargets(weight: number | null) {
    if (!weight) return
    setForm((prev) => ({
      ...prev,
      protein_target_g: prev.protein_target_g || String(Math.round(weight * 2)),
      water_target_ml: prev.water_target_ml || String(Math.round(weight * 35)),
    }))
  }

  function bumpBedtime(delta: 1 | -1) {
    setForm((prev) => ({
      ...prev,
      // Wrap so 11 PM → 12 AM works in both directions.
      sleep_hour: (prev.sleep_hour + delta + 24) % 24,
    }))
  }

  // Compute calorie suggestions once all inputs are present.
  const calorieOptions: CalorieOption[] | null = useMemo(() => {
    const age = parseInt(form.age)
    const heightCm = parseFloat(form.height_cm)
    const weightKg = parseFloat(form.weight_kg)
    if (
      !form.sex ||
      !form.training_frequency ||
      !age || !heightCm || !weightKg ||
      age <= 0 || heightCm <= 0 || weightKg <= 0
    ) {
      return null
    }
    const t = tdee(form.sex, weightKg, heightCm, age, form.training_frequency)
    return [
      { key: 'cut',      label: 'Cut',      desc: 'Lose fat (~0.45 kg/week)', kcal: Math.round((t - DEFICIT_KCAL) / 10) * 10 },
      { key: 'maintain', label: 'Maintain', desc: 'Hold current weight',     kcal: Math.round(t / 10) * 10 },
      { key: 'bulk',     label: 'Bulk',     desc: 'Lean gain (~0.25 kg/week)', kcal: Math.round((t + SURPLUS_KCAL) / 10) * 10 },
    ]
  }, [form.sex, form.training_frequency, form.age, form.height_cm, form.weight_kg])

  function pickGoal(o: CalorieOption) {
    setSelectedGoal(o.key)
    setField('calorie_target', String(o.kcal))
  }

  // Debounced username availability check.
  useEffect(() => {
    if (step !== 0) return
    const u = form.username
    if (!u) {
      setUsernameState('idle')
      return
    }
    if (!USERNAME_RE.test(u)) {
      setUsernameState('format')
      return
    }
    setUsernameState('checking')
    const handle = setTimeout(async () => {
      try {
        const { data } = await api.get('/users/username-available', {
          params: { username: u },
        })
        setUsernameState(data.available ? 'ok' : 'taken')
      } catch {
        setUsernameState('idle')
      }
    }, 350)
    return () => clearTimeout(handle)
  }, [form.username, step])

  function canAdvance() {
    if (step === 0) return usernameState === 'ok'
    if (step === 1) return form.sex !== null
    if (step === 2)
      return (
        form.avg_sleep_hours !== null &&
        form.training_frequency !== null &&
        form.caffeine_habit !== null
      )
    return true
  }

  async function handleNext() {
    if (step < STEPS.length - 1) {
      setError(null)
      setLoading(true)
      try {
        if (step === 0 && form.username) {
          await api.put('/users/me/onboarding', {
            step: 'username',
            data: { username: form.username },
          })
          updateUser({ username: form.username })
        }
        if (step === 1) {
          await api.put('/users/me/onboarding', {
            step: 'stats',
            data: {
              age: form.age ? parseInt(form.age) : null,
              height_cm: form.height_cm ? parseFloat(form.height_cm) : null,
              weight_kg: form.weight_kg ? parseFloat(form.weight_kg) : null,
              sex: form.sex,
            },
          })
          autoFillTargets(form.weight_kg ? parseFloat(form.weight_kg) : null)
        }
        setStep((s) => s + 1)
      } catch (err: any) {
        setError(extractErrorMessage(err))
      } finally {
        setLoading(false)
      }
    } else {
      // Final step — persist targets, then submit baseline + complete.
      setLoading(true)
      setError(null)
      try {
        await api.put('/users/me/onboarding', {
          step: 'targets',
          data: {
            protein_target_g: form.protein_target_g ? parseFloat(form.protein_target_g) : null,
            water_target_ml: form.water_target_ml ? parseInt(form.water_target_ml) : null,
            calorie_target: form.calorie_target ? parseInt(form.calorie_target) : null,
            sleep_hour: form.sleep_hour,
          },
        })
        await api.post('/users/me/baseline', {
          age: form.age ? parseInt(form.age) : null,
          height_cm: form.height_cm ? parseFloat(form.height_cm) : null,
          weight_kg: form.weight_kg ? parseFloat(form.weight_kg) : null,
          avg_sleep_hours: form.avg_sleep_hours
            ? sleepToHours[form.avg_sleep_hours]
            : null,
          training_frequency: form.training_frequency,
          caffeine_habit: form.caffeine_habit,
        })
        updateUser({ onboarding_complete: true })
        router.replace('/')
      } catch (err: any) {
        setError(extractErrorMessage(err))
      } finally {
        setLoading(false)
      }
    }
  }

  const isLast = step === STEPS.length - 1
  const canSkip = step === 3 // targets — allow Skip on final since defaults are sane

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
            <Step1Username
              value={form.username}
              state={usernameState}
              onChange={(v) => setField('username', v)}
            />
          )}
          {step === 1 && (
            <Step2Stats
              form={form}
              onChangeString={(key, value) => setField(key, value as any)}
              onChangeSex={(s) => setField('sex', s)}
            />
          )}
          {step === 2 && <Step3Baseline form={form} onChange={setField} />}
          {step === 3 && (
            <Step4Targets
              form={form}
              options={calorieOptions}
              selectedGoal={selectedGoal}
              onChange={(key, value) => setField(key, value as any)}
              onChangeBedtime={bumpBedtime}
              onPickGoal={pickGoal}
            />
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
              <Text className="text-zinc-500 text-sm">Skip — use defaults</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
