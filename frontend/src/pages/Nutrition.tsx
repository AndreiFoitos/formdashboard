import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'

// ─── Types ────────────────────────────────────────────────────────────────────

interface NutritionEntry {
  id: string
  meal_name: string | null
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  logged_at: string
}

interface NutritionToday {
  totals: {
    calories: number
    protein_g: number
    carbs_g: number
    fat_g: number
  }
  targets: {
    calories: number | null
    protein_g: number | null
  }
  entries: NutritionEntry[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MEAL_PRESETS = ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Pre-workout', 'Post-workout']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function pct(value: number, target: number | null): number | null {
  if (!target || target === 0) return null
  return Math.min(100, Math.round((value / target) * 100))
}

// ─── Macro Ring ───────────────────────────────────────────────────────────────

function MacroRing({
  value,
  target,
  color,
  size = 56,
}: {
  value: number
  target: number | null
  color: string
  size?: number
}) {
  const radius = (size - 8) / 2
  const circumference = 2 * Math.PI * radius
  const filled = target ? Math.min(1, value / target) : 0
  const offset = circumference - filled * circumference

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#27272a"
        strokeWidth="5"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.7s ease' }}
      />
    </svg>
  )
}

// ─── Macro Card ───────────────────────────────────────────────────────────────

function MacroCard({
  label,
  value,
  target,
  unit,
  color,
}: {
  label: string
  value: number
  target: number | null
  unit: string
  color: string
}) {
  const p = pct(value, target)

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center gap-3">
      <div className="relative shrink-0">
        <MacroRing value={value} target={target} color={color} />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[9px] font-bold text-white">{p != null ? `${p}%` : '—'}</span>
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest">{label}</p>
        <p className="text-white font-semibold text-base leading-tight mt-0.5">
          {Math.round(value)}
          <span className="text-xs text-zinc-500 font-normal ml-1">{unit}</span>
        </p>
        {target && (
          <p className="text-[10px] text-zinc-600 mt-0.5">of {Math.round(target)}{unit}</p>
        )}
      </div>
    </div>
  )
}

// ─── Calorie Bar ──────────────────────────────────────────────────────────────

function CalorieBar({ calories, target }: { calories: number; target: number | null }) {
  const p = pct(calories, target) ?? 0
  const over = target && calories > target

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest">Calories</p>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="text-2xl font-bold text-white">{calories.toLocaleString()}</span>
            {target && (
              <span className="text-sm text-zinc-500">/ {target.toLocaleString()} kcal</span>
            )}
          </div>
        </div>
        {over && (
          <span className="text-xs font-medium text-orange-400 bg-orange-950/40 border border-orange-900/40 px-2 py-1 rounded-full">
            +{(calories - target!).toLocaleString()} over
          </span>
        )}
      </div>
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${Math.min(100, p)}%`,
            backgroundColor: over ? '#f97316' : '#ffffff',
          }}
        />
      </div>
      {target && (
        <p className="text-[10px] text-zinc-600 mt-1.5">{p}% of daily target</p>
      )}
    </div>
  )
}

// ─── Log Sheet ────────────────────────────────────────────────────────────────

function LogSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()

  const [mealName, setMealName] = useState('')
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')

  const { mutate, isPending } = useMutation({
    mutationFn: (body: object) => api.post('/nutrition/log', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nutrition-today'] })
      qc.invalidateQueries({ queryKey: ['summary'] })
      onClose()
    },
  })

  function handleLog() {
    mutate({
      meal_name: mealName.trim() || null,
      calories: calories ? parseInt(calories) : null,
      protein_g: protein ? parseFloat(protein) : null,
      carbs_g: carbs ? parseFloat(carbs) : null,
      fat_g: fat ? parseFloat(fat) : null,
    })
  }

  const hasAnyValue = calories || protein || carbs || fat

  // Auto-estimate calories from macros if calories field is empty
  const estimatedCals =
    !calories && (protein || carbs || fat)
      ? Math.round(
          (parseFloat(protein || '0') * 4) +
          (parseFloat(carbs || '0') * 4) +
          (parseFloat(fat || '0') * 9)
        )
      : null

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-950 border-t border-zinc-800 rounded-t-2xl px-4 pt-5 pb-10 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-white font-semibold">Log Meal</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">✕</button>
        </div>

        {/* Meal name presets */}
        <div className="mb-4">
          <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-2">Meal</p>
          <div className="flex gap-2 flex-wrap mb-2">
            {MEAL_PRESETS.map(preset => (
              <button
                key={preset}
                onClick={() => setMealName(mealName === preset ? '' : preset)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-all duration-150 ${
                  mealName === preset
                    ? 'bg-white text-black border-white'
                    : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-600 hover:text-white'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={mealName}
            onChange={e => setMealName(e.target.value)}
            placeholder="Or type a name…"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
          />
        </div>

        {/* Macro inputs */}
        <div className="space-y-3 mb-5">
          {/* Calories */}
          <div>
            <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-1.5">Calories</p>
            <div className="relative">
              <input
                type="number"
                value={calories}
                onChange={e => setCalories(e.target.value)}
                placeholder={estimatedCals ? `~${estimatedCals} (estimated)` : 'e.g. 450'}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors pr-16"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">kcal</span>
            </div>
          </div>

          {/* Macros row */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Protein', value: protein, set: setProtein, unit: 'g', color: '#818cf8' },
              { label: 'Carbs', value: carbs, set: setCarbs, unit: 'g', color: '#34d399' },
              { label: 'Fat', value: fat, set: setFat, unit: 'g', color: '#fbbf24' },
            ].map(({ label, value, set, unit, color }) => (
              <div key={label}>
                <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-1.5">
                  {label}
                </p>
                <div className="relative">
                  <input
                    type="number"
                    value={value}
                    onChange={e => set(e.target.value)}
                    placeholder="0"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none transition-colors pr-6"
                    style={{ borderColor: value ? `${color}60` : undefined }}
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 text-xs">{unit}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Estimated calories note */}
        {estimatedCals != null && estimatedCals > 0 && (
          <p className="text-xs text-zinc-500 mb-4 -mt-1">
            ~{estimatedCals} kcal estimated from macros
            <button
              onClick={() => setCalories(String(estimatedCals))}
              className="text-zinc-400 hover:text-white ml-2 underline"
            >
              use this
            </button>
          </p>
        )}

        <button
          onClick={handleLog}
          disabled={!hasAnyValue || isPending}
          className="w-full bg-white text-black font-semibold text-sm py-3 rounded-xl hover:bg-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isPending ? 'Logging…' : 'Log Meal'}
        </button>
      </div>
    </>
  )
}

// ─── Entry Row ────────────────────────────────────────────────────────────────

function EntryRow({
  entry,
  onDelete,
}: {
  entry: NutritionEntry
  onDelete: () => void
}) {
  const [confirm, setConfirm] = useState(false)

  return (
    <div className="flex items-start gap-3 px-4 py-4 group">
      {/* Time dot */}
      <div className="mt-1.5 shrink-0">
        <div className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-medium text-white truncate">
            {entry.meal_name ?? 'Unnamed meal'}
          </p>
          <p className="text-xs text-zinc-500 shrink-0 ml-2">{formatTime(entry.logged_at)}</p>
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
          {entry.calories != null && (
            <span className="text-xs text-zinc-400">
              {entry.calories.toLocaleString()} kcal
            </span>
          )}
          {entry.protein_g != null && (
            <span className="text-xs text-indigo-400">{Math.round(entry.protein_g)}g protein</span>
          )}
          {entry.carbs_g != null && (
            <span className="text-xs text-emerald-400">{Math.round(entry.carbs_g)}g carbs</span>
          )}
          {entry.fat_g != null && (
            <span className="text-xs text-yellow-400">{Math.round(entry.fat_g)}g fat</span>
          )}
        </div>
      </div>

      {/* Delete */}
      <div className="shrink-0 pt-0.5">
        {confirm ? (
          <div className="flex gap-2">
            <button
              onClick={onDelete}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirm(false)}
              className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirm(true)}
            className="text-zinc-700 hover:text-zinc-400 transition-colors text-sm"
          >
            ···
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Macro Split Bar ─────────────────────────────────────────────────────────

function MacroSplitBar({ protein, carbs, fat }: { protein: number; carbs: number; fat: number }) {
  const total = protein * 4 + carbs * 4 + fat * 9
  if (total === 0) return null

  const proteinPct = Math.round((protein * 4 / total) * 100)
  const carbsPct = Math.round((carbs * 4 / total) * 100)
  const fatPct = 100 - proteinPct - carbsPct

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-3">
        Macro Split
      </p>
      <div className="flex h-2 rounded-full overflow-hidden gap-px mb-2.5">
        <div className="rounded-l-full transition-all duration-700" style={{ width: `${proteinPct}%`, backgroundColor: '#818cf8' }} />
        <div className="transition-all duration-700" style={{ width: `${carbsPct}%`, backgroundColor: '#34d399' }} />
        <div className="rounded-r-full transition-all duration-700" style={{ width: `${Math.max(0, fatPct)}%`, backgroundColor: '#fbbf24' }} />
      </div>
      <div className="flex gap-4">
        {[
          { label: 'Protein', pct: proteinPct, color: '#818cf8' },
          { label: 'Carbs', pct: carbsPct, color: '#34d399' },
          { label: 'Fat', pct: Math.max(0, fatPct), color: '#fbbf24' },
        ].map(({ label, pct, color }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <span className="text-xs text-zinc-400">{label}</span>
            <span className="text-xs font-medium text-white">{pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Nutrition Page ───────────────────────────────────────────────────────────

export function Nutrition() {
  const [showLog, setShowLog] = useState(false)
  const { user } = useAuthStore()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery<NutritionToday>({
    queryKey: ['nutrition-today'],
    queryFn: () => api.get('/nutrition/today').then(r => r.data),
    refetchInterval: 5 * 60 * 1000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/nutrition/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nutrition-today'] }),
  })

  const totals = data?.totals ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  const targets = data?.targets ?? { calories: user?.calorie_target ?? null, protein_g: user?.protein_target_g ?? null }
  const entries = data?.entries ?? []

  return (
    <>
      <div className="min-h-screen bg-black text-white pb-24">
        {/* Header */}
        <header className="px-4 pt-14 pb-5 flex items-end justify-between">
          <div>
            <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
            <h1 className="text-2xl font-bold mt-1">Nutrition</h1>
          </div>
          <button
            onClick={() => setShowLog(true)}
            className="bg-white text-black text-sm font-semibold px-4 py-2 rounded-xl hover:bg-zinc-100 transition-colors"
          >
            + Log
          </button>
        </header>

        <main className="px-4 space-y-3">
          {/* Calorie bar */}
          {isLoading ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 animate-pulse">
              <div className="h-3 w-20 bg-zinc-800 rounded mb-3" />
              <div className="h-7 w-32 bg-zinc-800 rounded mb-3" />
              <div className="h-1.5 bg-zinc-800 rounded-full" />
            </div>
          ) : (
            <CalorieBar calories={totals.calories} target={targets.calories} />
          )}

          {/* Macro cards */}
          {isLoading ? (
            <div className="grid grid-cols-3 gap-2">
              {[0, 1, 2].map(i => (
                <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 animate-pulse">
                  <div className="h-14 w-14 bg-zinc-800 rounded-full mb-2" />
                  <div className="h-3 w-12 bg-zinc-800 rounded" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <MacroCard
                label="Protein"
                value={totals.protein_g}
                target={targets.protein_g}
                unit="g"
                color="#818cf8"
              />
              <MacroCard
                label="Carbs"
                value={totals.carbs_g}
                target={null}
                unit="g"
                color="#34d399"
              />
              <MacroCard
                label="Fat"
                value={totals.fat_g}
                target={null}
                unit="g"
                color="#fbbf24"
              />
            </div>
          )}

          {/* Macro split */}
          {!isLoading && (totals.protein_g > 0 || totals.carbs_g > 0 || totals.fat_g > 0) && (
            <MacroSplitBar
              protein={totals.protein_g}
              carbs={totals.carbs_g}
              fat={totals.fat_g}
            />
          )}

          {/* Meal entries */}
          <div>
            <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-3">
              Today's Meals
            </p>

            {isLoading && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 text-center">
                <p className="text-sm text-zinc-600">Loading…</p>
              </div>
            )}

            {!isLoading && entries.length === 0 && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-center">
                <p className="text-sm text-zinc-400 font-medium">Nothing logged yet</p>
                <p className="text-xs text-zinc-600 mt-1 mb-4">Track your meals to hit your targets</p>
                <button
                  onClick={() => setShowLog(true)}
                  className="text-sm font-medium text-white bg-zinc-800 hover:bg-zinc-700 px-4 py-2 rounded-xl transition-colors"
                >
                  Log your first meal →
                </button>
              </div>
            )}

            {!isLoading && entries.length > 0 && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden divide-y divide-zinc-800/60">
                {entries.map(entry => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    onDelete={() => deleteMutation.mutate(entry.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      {showLog && <LogSheet onClose={() => setShowLog(false)} />}
    </>
  )
}