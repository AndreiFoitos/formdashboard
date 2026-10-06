import {
  Alert,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { formatNumber } from '../lib/format'
import { useEffect, useMemo, useState } from 'react'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ChevronLeft } from 'lucide-react-native'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { removeToken } from '../lib/storage'
import { extractErrorMessage } from '../lib/apiError'
import { FEATURES } from '../lib/featureFlags'
import { AvatarCanvas } from '../components/avatar/AvatarCanvas'
import { bodyFromMetrics, DEFAULT_LOOK, toState } from '../lib/avatar/config'
import { FoodPrefsFields, TrainingPrefsFields } from '../components/preferences/PreferenceFields'
import { EMPTY_PREFERENCES, type Goal, type Preferences } from '../hooks/usePreferences'
import { NOTIFICATION_REASONS } from '../components/NotificationsCard'
import { enablePredictiveNudges } from '../lib/notifications'
import { Bell } from 'lucide-react-native'
import { colors } from '../theme/tokens'
import { DEFICIT_KCAL, SURPLUS_KCAL, tdee, type Sex, type TrainingFreq } from '../lib/targets'
import { unitsFor, useUnits, useUnitsStore, type UnitSystem, type Units } from '../lib/units'

// ─── Types ────────────────────────────────────────────────────────────────────

type SleepHours = '<6h' | '6-7h' | '7-8h' | '8h+'
type CaffeineHabit = 'none' | '1_coffee' | '2-3' | 'preworkout'

interface FormState {
  username: string
  age: string
  sex: Sex | null
  // Height, weight and water hold what the user typed, in their unit system
  // (Settings → Units, also switchable on the stats step). metricStats() and
  // the submit code convert to cm / kg / ml for the API. In imperial,
  // height_cm holds feet and height_in the remaining inches.
  height_cm: string
  height_in: string
  weight_kg: string
  avg_sleep_hours: SleepHours | null
  training_frequency: TrainingFreq | null
  caffeine_habit: CaffeineHabit | null
  protein_target_g: string
  water_target_ml: string
  calorie_target: string
  /** True once the user hand-edits a target, so recomputing from weight stops. */
  targets_edited: boolean
  sleep_hour: number
}

const sleepToHours: Record<SleepHours, number> = {
  '<6h': 5.5,
  '6-7h': 6.5,
  '7-8h': 7.5,
  '8h+': 8.5,
}

function parseNum(v: string): number | null {
  const n = parseFloat(v.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** The typed stats in cm / kg, whatever the unit system. */
function metricStats(form: FormState, u: Units): { heightCm: number | null; weightKg: number | null } {
  const w = parseNum(form.weight_kg)
  let heightCm: number | null
  if (u.system === 'imperial') {
    const ft = parseNum(form.height_cm)
    heightCm = ft != null ? u.heightToCm(ft * 12 + (parseNum(form.height_in) ?? 0)) : null
  } else {
    heightCm = parseNum(form.height_cm)
  }
  return { heightCm, weightKg: w != null ? u.weightToKg(w) : null }
}

const STEPS = [
  { title: 'Pick a username',  subtitle: 'Friends invite you with this @ handle.' },
  { title: 'Your stats',       subtitle: 'Used to calculate protein, water, and calorie targets.' },
  { title: 'Your baseline',    subtitle: 'Calibrates your Form score from day one.' },
  { title: 'Your targets',     subtitle: 'Pre-filled from your stats. You can edit any of these later in Settings.' },
  { title: 'Your training',    subtitle: 'So Pit Crew can build a plan that fits. Skip anything you’d rather not answer.' },
  { title: 'Your food',        subtitle: 'Used for your meal plan. You can change all of this in Settings.' },
  { title: 'Stay on track',    subtitle: 'GainRace works best with notifications on. You can change this any time in Settings.' },
]

// Steps from here on are optional Pit Crew preferences. Your account is fully
// set up before them, so quitting the app here loses nothing that matters.
const TARGETS_STEP = 3
// Last step: explain notifications, then ask. iOS shows its prompt only once,
// so it should come with a reason, not at app launch.
const NOTIF_STEP = 6

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
      className="w-full px-4 py-4 rounded-xl border mb-2"
      style={{
        borderCurve: 'continuous',
        backgroundColor: selected ? colors.text : colors.surface,
        borderColor: selected ? colors.text : colors.border,
      }}
    >
      {children}
    </TouchableOpacity>
  )
}

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <View className="flex-row justify-center gap-2 mb-8">
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          className="rounded-full"
          style={{
            borderCurve: 'continuous',
            height: 4,
            width: i <= current ? 24 : 12,
            backgroundColor: i <= current ? colors.accent : colors.border,
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

// ─── Step 1 — Username ────────────────────────────────────────────────────────

const USERNAME_RE = /^[a-z0-9_]{3,24}$/

type UsernameState = 'idle' | 'checking' | 'ok' | 'taken' | 'reserved' | 'format'

// States that should paint the field red.
const BAD_USERNAME = new Set<UsernameState>(['taken', 'reserved', 'format'])

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
        className="flex-row items-center bg-surface-raised border rounded-md px-4 py-1"
        style={{ borderCurve: 'continuous', borderColor: BAD_USERNAME.has(state) ? colors.danger : colors.border }}
      >
        <Text className="text-text-subtle text-body">@</Text>
        <TextInput
          value={value}
          onChangeText={(v) => onChange(v.replace(/^@/, '').toLowerCase())}
          placeholder="your_handle"
          placeholderTextColor={colors['text-subtle']}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={24}
          className="flex-1 py-3 text-text text-body ml-1"
        />
        {state === 'checking' && <ActivityIndicator color={colors['text-subtle']} />}
        {state === 'ok' && (
          <Text className="text-success text-footnote font-medium">Available</Text>
        )}
      </View>
      <Text
        className="text-caption mt-2"
        style={{ color: BAD_USERNAME.has(state) ? colors.danger : colors['text-subtle'] }}
      >
        {state === 'taken'
          ? 'That handle is taken — try another.'
          : state === 'reserved'
            ? 'That handle is reserved — pick another.'
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
  onChangeUnits,
}: {
  form: FormState
  onChangeString: (key: 'age' | 'height_cm' | 'height_in' | 'weight_kg', value: string) => void
  onChangeSex: (sex: Sex) => void
  onChangeUnits: (system: UnitSystem) => void
}) {
  const u = useUnits()
  const imperial = u.system === 'imperial'
  const fields: {
    key: 'age' | 'height_cm' | 'weight_kg'
    label: string
    unit: string
    placeholder: string
    /** Imperial height: a second input for inches. */
    second?: { key: 'height_in'; unit: string; placeholder: string }
  }[] = [
    { key: 'age',       label: 'Age',    unit: 'yrs', placeholder: '25' },
    imperial
      ? { key: 'height_cm', label: 'Height', unit: 'ft', placeholder: '5', second: { key: 'height_in', unit: 'in', placeholder: '11' } }
      : { key: 'height_cm', label: 'Height', unit: 'cm', placeholder: '180' },
    { key: 'weight_kg', label: 'Weight', unit: u.weightUnit, placeholder: imperial ? '175' : '80' },
  ]

  const fieldsView = (
    <View className="gap-4" style={{ flex: 1 }}>
      {/* Sex */}
      <View>
        <Text className="text-text-muted text-caption mb-2">
          Biological sex
        </Text>
        <View className="flex-row gap-2">
          {(['male', 'female'] as Sex[]).map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => onChangeSex(s)}
              className="flex-1 py-3 rounded-full border items-center"
              style={{
                borderCurve: 'continuous',
                backgroundColor: form.sex === s ? colors.text : colors.surface,
                borderColor: form.sex === s ? colors.text : colors.border,
              }}
            >
              <Text
                className="text-footnote font-semibold capitalize"
                style={{ color: form.sex === s ? colors.bg : colors['text-muted'] }}
              >
                {s}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text className="text-text-subtle text-caption mt-2">
          Used for BMR / calorie estimates only.
        </Text>
      </View>

      {/* Units — the same setting as Settings → Units */}
      <View className="flex-row gap-2">
        {(['metric', 'imperial'] as UnitSystem[]).map((sys) => (
          <TouchableOpacity
            key={sys}
            onPress={() => onChangeUnits(sys)}
            className="flex-1 py-3 rounded-full border items-center"
            style={{
              borderCurve: 'continuous',
              backgroundColor: u.system === sys ? colors.text : colors.surface,
              borderColor: u.system === sys ? colors.text : colors.border,
            }}
          >
            <Text className="text-footnote font-semibold" style={{ color: u.system === sys ? colors.bg : colors['text-muted'] }}>
              {sys === 'metric' ? 'Metric' : 'Imperial'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {fields.map((f) => (
        <View key={f.key}>
          <Text className="text-text-muted text-caption mb-2">
            {f.label}
          </Text>
          <View className="flex-row gap-2">
            {[{ key: f.key, unit: f.unit, placeholder: f.placeholder }, ...(f.second ? [f.second] : [])].map((input) => (
              <View key={input.key} className="flex-1">
                <TextInput
                  value={form[input.key]}
                  onChangeText={(v) => onChangeString(input.key, v)}
                  placeholder={input.placeholder}
                  placeholderTextColor={colors['text-subtle']}
                  keyboardType="decimal-pad"
                  className="bg-surface-raised border border-border rounded-md px-4 py-4 text-text text-footnote" style={{ borderCurve: 'continuous' }}
                />
                <Text className="absolute right-4 top-4 text-text-subtle text-footnote">{input.unit}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  )

  if (!FEATURES.avatar) return fieldsView

  return (
    <View className="flex-row gap-3">
      {fieldsView}
      <StatsAvatarPreview form={form} />
    </View>
  )
}

/** Live 3D avatar that reshapes as the user types their stats. */
function StatsAvatarPreview({ form }: { form: FormState }) {
  const u = useUnits()
  const age = parseNum(form.age)
  const { heightCm: height, weightKg: weight } = metricStats(form, u)
  const base = form.sex ?? 'male'
  const state = useMemo(
    () => toState(DEFAULT_LOOK, bodyFromMetrics({ sex: base, age, heightCm: height, weightKg: weight })),
    [base, age, height, weight],
  )
  return (
    <View
      className="rounded-xl bg-surface overflow-hidden"
      style={{ borderCurve: 'continuous', width: 124, height: 330, opacity: form.sex ? 1 : 0.55 }}
    >
      <AvatarCanvas base={base} state={state} interactive={false} style={{ flex: 1 }} errorFallback={null} />
      {!form.sex && (
        <Text className="absolute bottom-2 self-center text-text-subtle text-caption">Pick your sex</Text>
      )}
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
    <View className="gap-6">
      {/* Sleep */}
      <View>
        <Text className="text-text-muted text-caption mb-2">
          Average sleep last week
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {(['<6h', '6-7h', '7-8h', '8h+'] as SleepHours[]).map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => onChange('avg_sleep_hours', s)}
              className="px-4 py-3 rounded-full border"
              style={{
                borderCurve: 'continuous',
                backgroundColor: form.avg_sleep_hours === s ? colors.text : colors.surface,
                borderColor: form.avg_sleep_hours === s ? colors.text : colors.border,
              }}
            >
              <Text
                className="text-footnote font-medium"
                style={{ color: form.avg_sleep_hours === s ? colors.bg : colors['text-muted'] }}
              >
                {s}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Training frequency */}
      <View>
        <Text className="text-text-muted text-caption mb-2">
          Training sessions per week
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {(['0-1x', '2-3x', '4-5x', '6x+'] as TrainingFreq[]).map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => onChange('training_frequency', t)}
              className="px-4 py-3 rounded-full border"
              style={{
                borderCurve: 'continuous',
                backgroundColor: form.training_frequency === t ? colors.text : colors.surface,
                borderColor: form.training_frequency === t ? colors.text : colors.border,
              }}
            >
              <Text
                className="text-footnote font-medium"
                style={{ color: form.training_frequency === t ? colors.bg : colors['text-muted'] }}
              >
                {t}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Caffeine */}
      <View>
        <Text className="text-text-muted text-caption mb-2">
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
              className="text-footnote font-medium"
              style={{ color: form.caffeine_habit === c.key ? colors.bg : colors.text }}
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
  const u = useUnits()
  return (
    <View>
      <Text className="text-text-muted text-caption mb-2">
        Suggested calorie goals
      </Text>
      <View className="gap-2">
        {options.map((o) => {
          const active = selected === o.key
          return (
            <TouchableOpacity
              key={o.key}
              onPress={() => onPick(o)}
              className="flex-row items-center justify-between px-4 py-3 rounded-xl border"
              style={{
                borderCurve: 'continuous',
                backgroundColor: active ? colors.text : colors.surface,
                borderColor: active ? colors.text : colors.border,
              }}
            >
              <View className="flex-1 pr-3">
                <Text
                  className="text-footnote font-semibold"
                  style={{ color: active ? colors.bg : colors.text }}
                >
                  {o.label}
                </Text>
                <Text
                  className="text-caption mt-1"
                  style={{ color: colors['text-subtle'] }}
                >
                  {o.desc}
                </Text>
              </View>
              <Text
                className="text-footnote font-bold"
                style={{ color: active ? colors.bg : colors.text }}
              >
                {formatNumber(o.kcal)} kcal
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>
      <Text className="text-text-subtle text-caption mt-2">
        Mifflin-St Jeor BMR × your training-day activity factor. Cut: −500 kcal/day (~{u.weightLabel(0.45)}/week loss). Bulk: +300 kcal/day (lean-mass focus).
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
  const u = useUnits()
  return (
    <View className="gap-5">
      {/* Protein */}
      <View>
        <Text className="text-text-muted text-caption mb-2">Protein</Text>
        <View>
          <TextInput
            value={form.protein_target_g}
            onChangeText={(v) => onChange('protein_target_g', v)}
            placeholder="160"
            placeholderTextColor={colors['text-subtle']}
            keyboardType="number-pad"
            className="bg-surface-raised border border-border rounded-md px-4 py-4 text-text text-footnote" style={{ borderCurve: 'continuous' }}
          />
          <Text className="absolute right-4 top-4 text-text-subtle text-footnote">g</Text>
        </View>
      </View>

      {/* Water */}
      <View>
        <Text className="text-text-muted text-caption mb-2">Water</Text>
        <View>
          <TextInput
            value={form.water_target_ml}
            onChangeText={(v) => onChange('water_target_ml', v)}
            placeholder={String(u.water(2800))}
            placeholderTextColor={colors['text-subtle']}
            keyboardType="number-pad"
            className="bg-surface-raised border border-border rounded-md px-4 py-4 text-text text-footnote" style={{ borderCurve: 'continuous' }}
          />
          <Text className="absolute right-4 top-4 text-text-subtle text-footnote">{u.waterUnit}</Text>
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
        <Text className="text-text-muted text-caption mb-2">
          Calorie target
        </Text>
        <View>
          <TextInput
            value={form.calorie_target}
            onChangeText={(v) => onChange('calorie_target', v)}
            placeholder="2400"
            placeholderTextColor={colors['text-subtle']}
            keyboardType="number-pad"
            className="bg-surface-raised border border-border rounded-md px-4 py-4 text-text text-footnote" style={{ borderCurve: 'continuous' }}
          />
          <Text className="absolute right-4 top-4 text-text-subtle text-footnote">kcal</Text>
        </View>
      </View>

      {/* Bedtime */}
      <View>
        <Text className="text-text-muted text-caption mb-2">
          Bedtime
        </Text>
        <View className="flex-row items-center justify-between bg-surface border border-divider rounded-xl px-4 py-3" style={{ borderCurve: 'continuous' }}>
          <Text className="text-text-subtle text-caption flex-1 pr-3">
            Drives caffeine-at-night scoring
          </Text>
          <View className="flex-row items-center gap-3">
            <TouchableOpacity
              onPress={() => onChangeBedtime(-1)}
              className="w-8 h-8 rounded-full bg-surface-raised items-center justify-center" style={{ borderCurve: 'continuous' }}
            >
              <Text className="text-text text-headline">−</Text>
            </TouchableOpacity>
            <Text className="text-text text-footnote font-medium text-center" style={{ width: 76 }}>
              {hourLabel(form.sleep_hour)}
            </Text>
            <TouchableOpacity
              onPress={() => onChangeBedtime(1)}
              className="w-8 h-8 rounded-full bg-surface-raised items-center justify-center" style={{ borderCurve: 'continuous' }}
            >
              <Text className="text-text text-headline">+</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  )
}

// ─── Onboarding Screen ────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const { user, updateUser, clearAuth } = useAuthStore()

  // Onboarding is the only screen a signed-in-but-unonboarded user can reach,
  // so signing out is the only way back to the login screen.
  function confirmSignOut() {
    Alert.alert('Sign out?', 'Your account stays — you can finish setting up next time you sign in.', [
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
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [usernameState, setUsernameState] = useState<UsernameState>('idle')
  const [selectedGoal, setSelectedGoal] = useState<CalorieOption['key'] | null>(null)
  const [prefs, setPrefs] = useState<Preferences>(EMPTY_PREFERENCES)
  // Only what the user touched is sent, so a skipped step writes nothing.
  const [prefsPatch, setPrefsPatch] = useState<Partial<Preferences>>({})

  function patchPrefs(patch: Partial<Preferences>) {
    setPrefs((p) => ({ ...p, ...patch }))
    setPrefsPatch((p) => ({ ...p, ...patch }))
  }

  const [form, setForm] = useState<FormState>({
    username: user?.username ?? '',
    age: '',
    sex: user?.sex ?? null,
    height_cm: '',
    height_in: '',
    weight_kg: '',
    avg_sleep_hours: null,
    training_frequency: null,
    caffeine_habit: null,
    protein_target_g: '',
    water_target_ml: '',
    calorie_target: '',
    targets_edited: false,
    sleep_hour: user?.sleep_hour ?? 23,
  })

  const u = useUnits()

  /** Switch unit systems, converting whatever has been typed so far. */
  function switchUnits(next: UnitSystem) {
    if (next === u.system) return
    const nu = unitsFor(next)
    const { heightCm, weightKg } = metricStats(form, u)
    const water = parseNum(form.water_target_ml)
    const inches = heightCm != null ? nu.height(heightCm) : null
    setForm((prev) => ({
      ...prev,
      weight_kg: weightKg != null ? String(nu.weight(weightKg)) : '',
      height_cm: inches == null ? '' : next === 'imperial' ? String(Math.floor(inches / 12)) : String(inches),
      height_in: inches != null && next === 'imperial' ? String(inches % 12) : '',
      water_target_ml: water != null ? String(nu.water(u.waterToMl(water))) : prev.water_target_ml,
    }))
    useUnitsStore.getState().setSystem(next)
  }

  // Only the two weight-derived targets. calorie_target is never recomputed by
  // autoFillTargets, so picking a calorie goal must not pin protein and water.
  const TARGET_KEYS = ['protein_target_g', 'water_target_ml']

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
      // Hand-editing a target pins it, so going back and fixing your weight
      // no longer silently overwrites a number you chose.
      ...(TARGET_KEYS.includes(key as string) ? { targets_edited: true } : null),
    }))
  }

  // Targets derive from bodyweight, so they must follow it. The old version
  // used `prev.protein_target_g || ...`, which locked in whatever the FIRST
  // weight produced — correcting a typo left the derived targets stale.
  // Anything the user typed by hand is still theirs and is left alone.
  function autoFillTargets(weight: number | null) {
    if (!weight) return
    setForm((prev) => ({
      ...prev,
      protein_target_g: prev.targets_edited
        ? prev.protein_target_g
        : String(Math.round(weight * 2)),
      water_target_ml: prev.targets_edited
        ? prev.water_target_ml
        : String(u.water(weight * 35)),
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
    const { heightCm, weightKg } = metricStats(form, u)
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
      { key: 'cut',      label: 'Cut',      desc: `Lose fat (~${u.weightLabel(0.45)}/week)`, kcal: Math.round((t - DEFICIT_KCAL) / 10) * 10 },
      { key: 'maintain', label: 'Maintain', desc: 'Hold current weight',     kcal: Math.round(t / 10) * 10 },
      { key: 'bulk',     label: 'Bulk',     desc: `Lean gain (~${u.weightLabel(0.25)}/week)`, kcal: Math.round((t + SURPLUS_KCAL) / 10) * 10 },
    ]
  }, [form.sex, form.training_frequency, form.age, form.height_cm, form.height_in, form.weight_kg, u.system])

  // The goal used to be thrown away once it had set calorie_target. Keep it
  // for Pit Crew; if the user typed their own number instead of tapping a
  // chip, read the goal off that number (±150 kcal of maintenance = maintain).
  function goalFromTargets(): Goal | null {
    if (selectedGoal) return selectedGoal
    const kcal = parseInt(form.calorie_target)
    const maintain = calorieOptions?.find((o) => o.key === 'maintain')?.kcal
    if (!kcal || !maintain) return null
    if (kcal < maintain - 150) return 'cut'
    if (kcal > maintain + 150) return 'bulk'
    return 'maintain'
  }

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
        // The server distinguishes reserved handles (admin, gainrace, ...)
        // from ones simply already in use; surface that difference.
        setUsernameState(
          data.available ? 'ok' : data.reason === 'reserved' ? 'reserved' : 'taken',
        )
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
    if (step === NOTIF_STEP) {
      setLoading(true)
      // Whatever the answer, onboarding ends here; the Today card covers
      // anyone who says no.
      await enablePredictiveNudges().catch(() => null)
      setLoading(false)
      router.replace('/')
      return
    }
    if (step > TARGETS_STEP) {
      await savePrefsStep()
      return
    }
    if (step < TARGETS_STEP) {
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
              height_cm: metricStats(form, u).heightCm,
              weight_kg: metricStats(form, u).weightKg,
              sex: form.sex,
            },
          })
          autoFillTargets(metricStats(form, u).weightKg)
        }
        setStep((s) => s + 1)
      } catch (err: any) {
        setError(extractErrorMessage(err))
      } finally {
        setLoading(false)
      }
    } else {
      // Targets step — persist targets, then submit baseline + complete.
      setLoading(true)
      setError(null)
      try {
        // MEDIUM-21: write sensible defaults rather than null on Skip. A null
        // calorie target leaves the Form Score "_score_calories" branch
        // permanently at the neutral 50 until the user finds Settings and
        // fixes it manually — they're unlikely to.
        const weight = metricStats(form, u).weightKg
        const calorieDefault =
          form.sex === 'female' ? 2000 : 2500
        await api.put('/users/me/onboarding', {
          step: 'targets',
          data: {
            protein_target_g: form.protein_target_g
              ? parseFloat(form.protein_target_g)
              : weight
                ? Math.round(weight * 2)
                : 140,
            water_target_ml: form.water_target_ml
              ? u.waterToMl(parseInt(form.water_target_ml))
              : weight
                ? Math.round(weight * 35)
                : 2500,
            calorie_target: form.calorie_target
              ? parseInt(form.calorie_target)
              : calorieDefault,
            sleep_hour: form.sleep_hour,
          },
        })
        await api.post('/users/me/baseline', {
          age: form.age ? parseInt(form.age) : null,
          height_cm: metricStats(form, u).heightCm,
          weight_kg: metricStats(form, u).weightKg,
          avg_sleep_hours: form.avg_sleep_hours
            ? sleepToHours[form.avg_sleep_hours]
            : null,
          training_frequency: form.training_frequency,
          caffeine_habit: form.caffeine_habit,
        })
        const goal = goalFromTargets()
        if (goal) {
          // Not worth blocking setup over: the user can set it in Settings.
          api.put('/plan-ai/preferences', { goal }).catch(() => {})
        }
        // Re-read the profile so the store carries the targets we just wrote.
        // Settings seeds its fields from the store; without this it renders
        // empty and a plain "Save changes" used to wipe these values.
        try {
          const { data: me } = await api.get('/users/me')
          updateUser({ ...me, onboarding_complete: true })
        } catch {
          updateUser({ onboarding_complete: true })
        }
        setStep((s) => s + 1)
      } catch (err: any) {
        setError(extractErrorMessage(err))
      } finally {
        setLoading(false)
      }
    }
  }

  // Training/Food steps: save whatever was answered, then move on. A failed
  // save doesn't trap the user in onboarding; Settings can fix it later.
  async function savePrefsStep() {
    setLoading(true)
    setError(null)
    try {
      if (Object.keys(prefsPatch).length > 0) {
        await api.put('/plan-ai/preferences', prefsPatch)
        setPrefsPatch({})
      }
    } catch {
      // fall through
    } finally {
      setLoading(false)
    }
    if (step < STEPS.length - 1) setStep((s) => s + 1)
    else router.replace('/')
  }

  async function skipPrefsStep() {
    setPrefsPatch({})
    if (step < STEPS.length - 1) setStep((s) => s + 1)
    else router.replace('/')
  }

  const isPrefsStep = step > TARGETS_STEP && step < NOTIF_STEP
  const canSkip = step === TARGETS_STEP // targets — allow Skip since defaults are sane

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          className="flex-1 px-6"
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="pb-12"
        >
          {/* Top bar */}
          <View className="flex-row items-center justify-between pt-4 pb-6">
            {step > 0 && step !== TARGETS_STEP + 1 ? (
              <TouchableOpacity onPress={() => setStep((s) => s - 1)} hitSlop={12} className="-ml-1 px-2 py-2 flex-row items-center gap-1">
                <ChevronLeft size={22} color={colors.text} strokeWidth={2.25} />
                <Text className="text-text-muted text-body font-medium">Back</Text>
              </TouchableOpacity>
            ) : step === TARGETS_STEP + 1 ? (
              <View />
            ) : (
              /* Step 0 has nothing behind it, and onboarding is the only route
                 a signed-in-but-unonboarded user can reach — without this the
                 screen is a dead end with no way out but deleting the app. */
              <TouchableOpacity onPress={confirmSignOut} hitSlop={12} className="-ml-1 px-2 py-2">
                <Text className="text-text-muted text-body font-medium">Sign out</Text>
              </TouchableOpacity>
            )}
            <Text className="text-text-subtle text-caption font-medium">
              {step + 1} / {STEPS.length}
            </Text>
          </View>

          <StepDots current={step} total={STEPS.length} />

          {/* Step header */}
          <Text className="text-text text-title font-bold mb-1">
            {STEPS[step].title}
          </Text>
          <Text className="text-text-subtle text-footnote mb-8">
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
              onChangeUnits={switchUnits}
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
          {step === 4 && <TrainingPrefsFields value={prefs} onChange={patchPrefs} />}
          {step === 5 && <FoodPrefsFields value={prefs} onChange={patchPrefs} />}
          {step === NOTIF_STEP && (
            <View className="gap-4">
              {NOTIFICATION_REASONS.map((r) => (
                <View key={r} className="flex-row items-start bg-surface border border-divider rounded-xl p-4 gap-3" style={{ borderCurve: 'continuous' }}>
                  <Bell size={18} color={colors.accent} />
                  <Text className="text-text text-footnote flex-1">{r}</Text>
                </View>
              ))}
              <Text className="text-text-subtle text-caption">
                Reminders adapt to when you actually log, and you can turn them off in Settings.
              </Text>
            </View>
          )}

          {/* Error */}
          {error && (
            <View className="bg-danger/15 border border-danger/40 rounded-xl px-4 py-3 mt-4" style={{ borderCurve: 'continuous' }}>
              <Text className="text-danger text-footnote">{error}</Text>
            </View>
          )}
        </ScrollView>

        {/* Footer */}
        <View className="px-6 pb-8 pt-2 gap-2">
          <TouchableOpacity
            onPress={handleNext}
            disabled={loading || !canAdvance()}
            className="bg-accent rounded-md py-4 items-center"
            style={{ borderCurve: 'continuous', opacity: loading || !canAdvance() ? 0.4 : 1 }}
          >
            {loading ? (
              <ActivityIndicator color={colors['on-accent']} />
            ) : (
              <Text className="text-on-accent font-semibold text-body">
                {step === NOTIF_STEP ? 'Turn on notifications' : step === TARGETS_STEP ? 'Save and continue' : 'Continue'}
              </Text>
            )}
          </TouchableOpacity>

          {isPrefsStep && (
            <TouchableOpacity onPress={skipPrefsStep} disabled={loading} className="py-2 items-center">
              <Text className="text-text-subtle text-footnote">Skip for now</Text>
            </TouchableOpacity>
          )}

          {step === NOTIF_STEP && (
            <TouchableOpacity onPress={() => router.replace('/')} disabled={loading} className="py-2 items-center">
              <Text className="text-text-subtle text-footnote">Not now</Text>
            </TouchableOpacity>
          )}

          {canSkip && (
            <TouchableOpacity
              onPress={handleNext}
              disabled={loading}
              className="py-2 items-center"
            >
              <Text className="text-text-subtle text-footnote">Skip — use defaults</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
