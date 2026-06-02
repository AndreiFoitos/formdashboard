import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleepToHours: Record<SleepHours, number> = {
  '<6h': 5.5,
  '6-7h': 6.5,
  '7-8h': 7.5,
  '8h+': 8.5,
}

const ACTIVITY_MULTIPLIER: Record<TrainingFreq, number> = {
  '0-1x': 1.2,
  '2-3x': 1.375,
  '4-5x': 1.55,
  '6x+':  1.725,
}

const USERNAME_RE = /^[a-z0-9_]{3,24}$/

function hourLabel(h: number): string {
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return `${display}:00 ${period}`
}

function mifflinStJeorBMR(sex: Sex, weightKg: number, heightCm: number, ageYears: number): number {
  const offset = sex === 'male' ? 5 : -161
  return 10 * weightKg + 6.25 * heightCm - 5 * ageYears + offset
}

function tdee(sex: Sex, weightKg: number, heightCm: number, ageYears: number, freq: TrainingFreq): number {
  return mifflinStJeorBMR(sex, weightKg, heightCm, ageYears) * ACTIVITY_MULTIPLIER[freq]
}

const DEFICIT_KCAL = 500
const SURPLUS_KCAL = 300

type UsernameState = 'idle' | 'checking' | 'ok' | 'taken' | 'format'

interface CalorieOption {
  key: 'cut' | 'maintain' | 'bulk'
  label: string
  desc: string
  kcal: number
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-1.5 justify-center mb-10">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1 rounded-full transition-all duration-300 ${
            i < current ? 'w-6 bg-white' : i === current ? 'w-6 bg-white' : 'w-3 bg-zinc-700'
          }`}
        />
      ))}
    </div>
  )
}

function OptionButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-4 py-3.5 rounded-xl border text-sm font-medium transition-all duration-150 ${
        selected
          ? 'bg-white text-black border-white'
          : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-600 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

// ─── Steps ────────────────────────────────────────────────────────────────────

function Step1Username({
  value,
  state,
  onChange,
}: {
  value: string
  state: UsernameState
  onChange: (v: string) => void
}) {
  const borderColor =
    state === 'taken' || state === 'format' ? 'border-red-900' : 'border-zinc-800'
  return (
    <div className="space-y-2">
      <div className={`flex items-center bg-zinc-900 border ${borderColor} rounded-xl px-4`}>
        <span className="text-zinc-500 text-base">@</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/^@/, '').toLowerCase())}
          placeholder="your_handle"
          autoCapitalize="none"
          autoCorrect="off"
          maxLength={24}
          className="flex-1 ml-1 py-3 bg-transparent text-white text-base placeholder-zinc-600 focus:outline-none"
        />
        {state === 'checking' && (
          <span className="text-zinc-500 text-xs">Checking…</span>
        )}
        {state === 'ok' && (
          <span className="text-green-500 text-xs font-medium">Available</span>
        )}
      </div>
      <p
        className={`text-xs ${
          state === 'taken' || state === 'format' ? 'text-red-400' : 'text-zinc-500'
        }`}
      >
        {state === 'taken'
          ? 'That handle is taken — try another.'
          : '3–24 chars; lowercase letters, numbers, underscores only.'}
      </p>
    </div>
  )
}

function Step2Stats({
  form,
  onChangeString,
  onChangeSex,
}: {
  form: FormState
  onChangeString: (k: 'age' | 'height_cm' | 'weight_kg', v: string) => void
  onChangeSex: (s: Sex) => void
}) {
  const fields: { key: 'age' | 'height_cm' | 'weight_kg'; label: string; unit: string; placeholder: string }[] = [
    { key: 'age', label: 'Age', unit: 'yrs', placeholder: '25' },
    { key: 'height_cm', label: 'Height', unit: 'cm', placeholder: '180' },
    { key: 'weight_kg', label: 'Weight', unit: 'kg', placeholder: '80' },
  ]

  return (
    <div className="space-y-4">
      {/* Sex */}
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-widest">
          Biological sex
        </label>
        <div className="grid grid-cols-2 gap-2">
          {(['male', 'female'] as Sex[]).map((s) => (
            <OptionButton
              key={s}
              selected={form.sex === s}
              onClick={() => onChangeSex(s)}
            >
              <span className="capitalize">{s}</span>
            </OptionButton>
          ))}
        </div>
        <p className="text-xs text-zinc-600 mt-1.5">Used for BMR / calorie estimates only.</p>
      </div>

      {fields.map((f) => (
        <div key={f.key}>
          <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-widest">
            {f.label}
          </label>
          <div className="relative">
            <input
              type="number"
              value={form[f.key]}
              onChange={(e) => onChangeString(f.key, e.target.value)}
              placeholder={f.placeholder}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors pr-12"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">
              {f.unit}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

function Step3Baseline({
  form,
  onChange,
}: {
  form: FormState
  onChange: <K extends keyof FormState>(k: K, v: FormState[K]) => void
}) {
  return (
    <div className="space-y-6">
      {/* Sleep */}
      <div>
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-widest mb-2">
          Average sleep last week
        </p>
        <div className="grid grid-cols-2 gap-2">
          {(['<6h', '6-7h', '7-8h', '8h+'] as SleepHours[]).map((s) => (
            <OptionButton
              key={s}
              selected={form.avg_sleep_hours === s}
              onClick={() => onChange('avg_sleep_hours', s)}
            >
              {s}
            </OptionButton>
          ))}
        </div>
      </div>

      {/* Training freq */}
      <div>
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-widest mb-2">
          Training sessions per week
        </p>
        <div className="grid grid-cols-2 gap-2">
          {(['0-1x', '2-3x', '4-5x', '6x+'] as TrainingFreq[]).map((t) => (
            <OptionButton
              key={t}
              selected={form.training_frequency === t}
              onClick={() => onChange('training_frequency', t)}
            >
              {t}
            </OptionButton>
          ))}
        </div>
      </div>

      {/* Caffeine */}
      <div>
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-widest mb-2">
          Daily caffeine habit
        </p>
        <div className="space-y-2">
          {(
            [
              { key: 'none', label: 'None' },
              { key: '1_coffee', label: '1 coffee' },
              { key: '2-3', label: '2–3 coffees' },
              { key: 'preworkout', label: 'Pre-workout user' },
            ] as { key: CaffeineHabit; label: string }[]
          ).map((c) => (
            <OptionButton
              key={c.key}
              selected={form.caffeine_habit === c.key}
              onClick={() => onChange('caffeine_habit', c.key)}
            >
              {c.label}
            </OptionButton>
          ))}
        </div>
      </div>
    </div>
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
  onChange: (k: 'protein_target_g' | 'water_target_ml' | 'calorie_target', v: string) => void
  onChangeBedtime: (delta: 1 | -1) => void
  onPickGoal: (o: CalorieOption) => void
}) {
  return (
    <div className="space-y-5">
      {/* Protein */}
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-widest">
          Protein
        </label>
        <div className="relative">
          <input
            type="number"
            value={form.protein_target_g}
            onChange={(e) => onChange('protein_target_g', e.target.value)}
            placeholder="160"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-600 pr-12"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">g</span>
        </div>
      </div>

      {/* Water */}
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-widest">
          Water
        </label>
        <div className="relative">
          <input
            type="number"
            value={form.water_target_ml}
            onChange={(e) => onChange('water_target_ml', e.target.value)}
            placeholder="2800"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-600 pr-12"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">ml</span>
        </div>
      </div>

      {/* Calorie suggestions */}
      {options && (
        <div>
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-widest mb-2">
            Suggested calorie goals
          </p>
          <div className="space-y-2">
            {options.map((o) => {
              const active = selectedGoal === o.key
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => onPickGoal(o)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${
                    active
                      ? 'bg-white text-black border-white'
                      : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-600'
                  }`}
                >
                  <span className="text-left">
                    <span className="block text-sm font-semibold">{o.label}</span>
                    <span className={`block text-xs mt-0.5 ${active ? 'text-zinc-600' : 'text-zinc-500'}`}>
                      {o.desc}
                    </span>
                  </span>
                  <span className="text-sm font-bold">{o.kcal.toLocaleString()} kcal</span>
                </button>
              )
            })}
          </div>
          <p className="text-xs text-zinc-600 mt-2">
            Mifflin-St Jeor BMR × your training-day activity factor. Cut: −500 kcal/day (~0.45 kg/week loss). Bulk: +300 kcal/day (lean-mass focus).
          </p>
        </div>
      )}

      {/* Calorie target */}
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-widest">
          Calorie target
        </label>
        <div className="relative">
          <input
            type="number"
            value={form.calorie_target}
            onChange={(e) => onChange('calorie_target', e.target.value)}
            placeholder="2400"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-600 pr-14"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">kcal</span>
        </div>
      </div>

      {/* Bedtime */}
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-widest">
          Bedtime
        </label>
        <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
          <span className="text-zinc-600 text-xs pr-3 flex-1">
            Drives caffeine-at-night scoring
          </span>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => onChangeBedtime(-1)}
              className="w-8 h-8 rounded-full bg-zinc-800 text-white text-lg leading-5 hover:bg-zinc-700"
            >
              −
            </button>
            <span className="text-white text-sm font-medium text-center" style={{ width: 76 }}>
              {hourLabel(form.sleep_hour)}
            </span>
            <button
              type="button"
              onClick={() => onChangeBedtime(1)}
              className="w-8 h-8 rounded-full bg-zinc-800 text-white text-lg leading-5 hover:bg-zinc-700"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

const STEPS = [
  { title: 'Pick a username',  subtitle: 'Friends invite you with this @ handle.' },
  { title: 'Your stats',       subtitle: 'Used to calculate protein, water, and calorie targets.' },
  { title: 'Your baseline',    subtitle: 'Calibrates your Form Score from day one.' },
  { title: 'Your targets',     subtitle: 'Pre-filled from your stats. You can edit any of these later in Settings.' },
]

export function Onboarding() {
  const navigate = useNavigate()
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

  function setStringField(key: keyof FormState, value: string) {
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
      sleep_hour: (prev.sleep_hour + delta + 24) % 24,
    }))
  }

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
      { key: 'cut',      label: 'Cut',      desc: 'Lose fat (~0.45 kg/week)',  kcal: Math.round((t - DEFICIT_KCAL) / 10) * 10 },
      { key: 'maintain', label: 'Maintain', desc: 'Hold current weight',       kcal: Math.round(t / 10) * 10 },
      { key: 'bulk',     label: 'Bulk',     desc: 'Lean gain (~0.25 kg/week)', kcal: Math.round((t + SURPLUS_KCAL) / 10) * 10 },
    ]
  }, [form.sex, form.training_frequency, form.age, form.height_cm, form.weight_kg])

  function pickGoal(o: CalorieOption) {
    setSelectedGoal(o.key)
    setField('calorie_target', String(o.kcal))
  }

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
      } catch {
        setError('Something went wrong. Please try again.')
      } finally {
        setLoading(false)
      }
    } else {
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
          avg_sleep_hours: form.avg_sleep_hours ? sleepToHours[form.avg_sleep_hours] : null,
          training_frequency: form.training_frequency,
          caffeine_habit: form.caffeine_habit,
        })
        updateUser({ onboarding_complete: true })
        navigate('/')
      } catch {
        setError('Something went wrong. Please try again.')
      } finally {
        setLoading(false)
      }
    }
  }

  function handleBack() {
    if (step > 0) setStep((s) => s - 1)
  }

  const isLast = step === STEPS.length - 1
  const canSkip = step === 3

  return (
    <div className="min-h-screen bg-black flex flex-col px-4 py-12">
      <div className="w-full max-w-sm mx-auto flex-1 flex flex-col">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            {step > 0 ? (
              <button
                onClick={handleBack}
                className="text-zinc-500 hover:text-white transition-colors text-sm"
              >
                ← Back
              </button>
            ) : (
              <div />
            )}
            <span className="text-xs text-zinc-600 font-medium">
              {step + 1} / {STEPS.length}
            </span>
          </div>

          <StepDots current={step} total={STEPS.length} />

          <h1 className="text-2xl font-bold text-white">{STEPS[step].title}</h1>
          <p className="text-sm text-zinc-500 mt-1">{STEPS[step].subtitle}</p>
        </div>

        {/* Step content */}
        <div className="flex-1">
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
              onChangeString={setStringField}
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
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-red-400 bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2 mt-4">
            {error}
          </p>
        )}

        {/* Footer CTA */}
        <div className="mt-8 space-y-3">
          <button
            onClick={handleNext}
            disabled={loading || !canAdvance()}
            className="w-full bg-white text-black font-semibold text-sm py-3 rounded-xl hover:bg-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Saving…' : isLast ? 'Finish setup' : 'Continue'}
          </button>

          {canSkip && (
            <button
              onClick={handleNext}
              disabled={loading}
              className="w-full text-zinc-500 text-sm py-2 hover:text-zinc-300 transition-colors"
            >
              Skip — use defaults
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
