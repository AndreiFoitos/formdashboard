import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleepToHours: Record<SleepHours, number> = {
  '<6h': 5.5,
  '6-7h': 6.5,
  '7-8h': 7.5,
  '8h+': 8.5,
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

function Step1Goal({
  value,
  onChange,
}: {
  value: Goal | null
  onChange: (v: Goal) => void
}) {
  const goals: { key: Goal; label: string; desc: string }[] = [
    { key: 'bulk', label: 'Bulk', desc: 'Build muscle, accept some fat gain' },
    { key: 'cut', label: 'Cut', desc: 'Lose fat, preserve as much muscle as possible' },
    { key: 'maintain', label: 'Maintain', desc: 'Hold current body composition' },
    { key: 'recomp', label: 'Recomp', desc: 'Build muscle and lose fat simultaneously' },
  ]
  return (
    <div className="space-y-3">
      {goals.map((g) => (
        <OptionButton key={g.key} selected={value === g.key} onClick={() => onChange(g.key)}>
          <span className="text-sm font-semibold">{g.label}</span>
          <span className={`block text-xs mt-0.5 ${value === g.key ? 'text-zinc-600' : 'text-zinc-500'}`}>
            {g.desc}
          </span>
        </OptionButton>
      ))}
    </div>
  )
}

function Step2Stats({
  form,
  onChange,
}: {
  form: FormState
  onChange: (k: keyof FormState, v: string) => void
}) {
  const fields: { key: 'age' | 'height_cm' | 'weight_kg'; label: string; unit: string; placeholder: string; type: string }[] = [
    { key: 'age', label: 'Age', unit: 'yrs', placeholder: '25', type: 'number' },
    { key: 'height_cm', label: 'Height', unit: 'cm', placeholder: '180', type: 'number' },
    { key: 'weight_kg', label: 'Weight', unit: 'kg', placeholder: '80', type: 'number' },
  ]

  return (
    <div className="space-y-4">
      {fields.map((f) => (
        <div key={f.key}>
          <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-widest">
            {f.label}
          </label>
          <div className="relative">
            <input
              type={f.type}
              value={form[f.key]}
              onChange={(e) => onChange(f.key, e.target.value)}
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

      {/* Energy rating */}
      <div>
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-widest mb-2">
          Rate your energy last week
        </p>
        <div className="flex gap-2">
          {([1, 2, 3, 4, 5] as EnergyRating[]).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange('energy_rating', n)}
              className={`flex-1 py-3 rounded-xl border text-sm font-semibold transition-all duration-150 ${
                form.energy_rating === n
                  ? 'bg-white text-black border-white'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-600 hover:text-white'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex justify-between mt-1 px-1">
          <span className="text-xs text-zinc-600">Crashed</span>
          <span className="text-xs text-zinc-600">Locked in</span>
        </div>
      </div>
    </div>
  )
}

function Step4Device() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-400 mb-4">
        Connect a wearable to unlock sleep and HRV data. You can always do this later in Settings.
      </p>
      {[
        { key: 'oura', label: 'Oura Ring', desc: 'Sleep, HRV, readiness', soon: true },
        { key: 'apple_health', label: 'Apple Health', desc: 'Steps, sleep, heart rate', soon: true },
      ].map((d) => (
        <div
          key={d.key}
          className="w-full text-left px-4 py-3.5 rounded-xl border border-zinc-800 bg-zinc-900 opacity-50"
        >
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-semibold text-white">{d.label}</span>
              <span className="block text-xs text-zinc-500 mt-0.5">{d.desc}</span>
            </div>
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest border border-zinc-700 px-2 py-0.5 rounded-full">
              Soon
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

const STEPS = [
  { title: "What's your goal?", subtitle: 'This shapes your targets and scoring.' },
  { title: 'Your stats', subtitle: 'Used to calculate protein and water targets.' },
  { title: 'Your baseline', subtitle: "Calibrates your Form Score from day one." },
  { title: 'Connect a device', subtitle: 'Optional — adds sleep and HRV data.' },
]

export function Onboarding() {
  const navigate = useNavigate()
  const { updateUser } = useAuthStore()
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  function setStringField(key: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function canAdvance() {
    if (step === 0) return form.goal !== null
    if (step === 1) return true // stats optional
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
        // Persist each step as we go
        if (step === 0 && form.goal) {
          await api.put('/users/me/onboarding', { step: 'goal', data: { goal: form.goal } })
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
          avg_sleep_hours: form.avg_sleep_hours ? sleepToHours[form.avg_sleep_hours] : null,
          training_frequency: form.training_frequency,
          caffeine_habit: form.caffeine_habit,
          energy_rating: form.energy_rating,
          device_connected: 'none',
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
            <Step1Goal value={form.goal} onChange={(v) => setField('goal', v)} />
          )}
          {step === 1 && (
            <Step2Stats form={form} onChange={setStringField} />
          )}
          {step === 2 && (
            <Step3Baseline form={form} onChange={setField} />
          )}
          {step === 3 && <Step4Device />}
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

          {/* Allow skipping devices step or stats */}
          {(step === 1 || step === 3) && (
            <button
              onClick={handleNext}
              disabled={loading}
              className="w-full text-zinc-500 text-sm py-2 hover:text-zinc-300 transition-colors"
            >
              {step === 3 ? 'Skip for now' : 'Skip'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}