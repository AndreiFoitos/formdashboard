import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { CaffeineCurve } from '../components/CaffeineCurve'
import type { CurveData } from '../components/CaffeineCurve'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Summary {
  form_score: number | null
  form_score_unlocked: boolean
  sleep_score: number | null
  hrv_score: number | null
  water_ml: number | null
  caffeine_mg: number | null
  calories_eaten: number | null
  protein_g: number | null
  trained: boolean
  training_type: string | null
}

interface Targets {
  water_target_ml: number | null
  protein_target_g: number | null
  calorie_target: number | null
}

interface DashboardData {
  date: string
  summary: Summary
  caffeine: CurveData
  targets: Targets
}

// ─── API ──────────────────────────────────────────────────────────────────────

const fetchDashboard = () => api.get<DashboardData>('/dashboard').then(r => r.data)

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

// ─── Greeting ─────────────────────────────────────────────────────────────────

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

// ─── Form Score Card ──────────────────────────────────────────────────────────

function FormScoreCard({ summary }: { summary: Summary | undefined }) {
  if (!summary) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 animate-pulse">
        <div className="h-4 w-24 bg-zinc-800 rounded mb-4" />
        <div className="h-16 w-16 bg-zinc-800 rounded-full" />
      </div>
    )
  }

  if (!summary.form_score_unlocked) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
        <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-3">Form Score</p>
        <div className="flex items-start gap-4">
          <div className="relative w-16 h-16 shrink-0">
            <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
              <circle cx="32" cy="32" r="26" fill="none" stroke="#27272a" strokeWidth="6" />
              <circle cx="32" cy="32" r="26" fill="none" stroke="#3f3f46" strokeWidth="6"
                strokeDasharray="163.36" strokeDashoffset="98" strokeLinecap="round" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="text-[10px] text-zinc-500 font-medium">—</span>
            </span>
          </div>
          <div>
            <p className="text-white font-semibold text-sm">Calibrating…</p>
            <p className="text-zinc-500 text-xs mt-1 leading-relaxed">
              Log 5 days in a row to activate your personalized Form Score.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const score = summary.form_score ?? 0
  const circumference = 163.36
  const offset = circumference - (score / 100) * circumference
  const color = score >= 80 ? '#22c55e' : score >= 60 ? '#eab308' : score >= 40 ? '#f97316' : '#ef4444'

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
      <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-3">Form Score</p>
      <div className="flex items-center gap-5">
        <div className="relative w-16 h-16 shrink-0">
          <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
            <circle cx="32" cy="32" r="26" fill="none" stroke="#27272a" strokeWidth="6" />
            <circle cx="32" cy="32" r="26" fill="none" stroke={color} strokeWidth="6"
              strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="text-lg font-bold text-white">{score}</span>
          </span>
        </div>
        <div className="flex-1">
          <p className="text-white font-semibold">
            {score >= 80 ? 'Locked in' : score >= 60 ? 'On track' : score >= 40 ? 'Below baseline' : 'Recovery day'}
          </p>
          <p className="text-zinc-500 text-xs mt-1">
            {summary.sleep_score != null && `Sleep ${summary.sleep_score} · `}
            {summary.hrv_score != null && `HRV ${summary.hrv_score}`}
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Stat Tile ────────────────────────────────────────────────────────────────

function StatTile({
  label, value, target, unit, icon,
}: {
  label: string
  value: number | null | undefined
  target?: number | null
  unit: string
  icon: React.ReactNode
}) {
  const pct = target && value ? Math.min(100, Math.round((value / target) * 100)) : null

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest">{label}</span>
        <span className="text-zinc-600">{icon}</span>
      </div>
      <p className="text-white font-semibold text-base leading-none">
        {value != null ? value.toLocaleString() : '—'}
        <span className="text-xs text-zinc-500 font-normal ml-1">{unit}</span>
      </p>
      {pct != null && (
        <div className="mt-2.5 h-0.5 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full bg-white rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
        </div>
      )}
      {target && (
        <p className="text-[10px] text-zinc-600 mt-1">
          {pct}% of {target.toLocaleString()}{unit}
        </p>
      )}
    </div>
  )
}

// ─── Quick Hydration ──────────────────────────────────────────────────────────

function HydrationQuickLog({ waterMl, targetMl }: { waterMl: number | null; targetMl: number | null }) {
  const qc = useQueryClient()
  const [logging, setLogging] = useState(false)

  const { mutate } = useMutation({
    mutationFn: (ml: number) => api.post('/hydration/log', { amount_ml: ml }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setLogging(false)
    },
  })

  const target = targetMl ?? 2500
  const current = waterMl ?? 0
  const pct = Math.min(100, Math.round((current / target) * 100))
  const presets = [250, 500, 750]

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest">Hydration</p>
        <p className="text-xs text-zinc-400">
          <span className="text-white font-semibold">{current.toLocaleString()}</span>
          <span className="text-zinc-600"> / {target.toLocaleString()}ml</span>
        </p>
      </div>
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-3">
        <div className="h-full bg-sky-400 rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>
      {logging ? (
        <div className="flex gap-2">
          {presets.map((ml) => (
            <button
              key={ml}
              onClick={() => mutate(ml)}
              className="flex-1 py-2 rounded-lg bg-zinc-800 text-white text-xs font-medium hover:bg-zinc-700 transition-colors"
            >
              {ml}ml
            </button>
          ))}
          <button
            onClick={() => setLogging(false)}
            className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-xs hover:bg-zinc-700 transition-colors"
          >
            ✕
          </button>
        </div>
      ) : (
        <button onClick={() => setLogging(true)} className="text-xs font-medium text-zinc-400 hover:text-white transition-colors">
          + Log water
        </button>
      )}
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export function Dashboard() {
  const { user } = useAuthStore()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboard,
    refetchInterval: 5 * 60 * 1000,
  })

  // Day rollover: if cached data is from a previous day, force a fresh fetch
  useEffect(() => {
    if (data && data.date !== todayISO()) {
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    }
  }, [data, qc])

  const summary  = data?.summary
  const caffeine = data?.caffeine
  const targets  = data?.targets

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  const firstName = user?.name?.split(' ')[0] ?? null

  return (
    <div className="min-h-screen bg-black text-white pb-24">
      <header className="px-4 pt-14 pb-5">
        <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest">{today}</p>
        <h1 className="text-2xl font-bold mt-1">
          {getGreeting()}{firstName ? `, ${firstName}` : ''}
        </h1>
      </header>

      <main className="px-4 space-y-3">
        <FormScoreCard summary={summary} />

        <div className="grid grid-cols-2 gap-3">
          <StatTile
            label="Water" value={summary?.water_ml ?? null}
            target={targets?.water_target_ml} unit="ml"
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a7 7 0 0 1 7 7c0 4-3.5 7-7 13C8.5 16 5 13 5 9a7 7 0 0 1 7-7z" /></svg>}
          />
          <StatTile
            label="Protein"
            value={summary?.protein_g != null ? Math.round(summary.protein_g) : null}
            target={targets?.protein_target_g != null ? Math.round(targets.protein_target_g) : null}
            unit="g"
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 6.5h11M6.5 17.5h11M4 12h16" /></svg>}
          />
          <StatTile
            label="Calories" value={summary?.calories_eaten ?? null}
            target={targets?.calorie_target} unit="kcal"
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M2 12h20" /></svg>}
          />
        </div>

        {summary?.trained && (
          <div className="flex items-center gap-2.5 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
            <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
            <p className="text-sm text-zinc-300">
              Trained today
              {summary.training_type && <span className="text-zinc-500 ml-1.5">· {summary.training_type}</span>}
            </p>
          </div>
        )}

        <HydrationQuickLog
          waterMl={summary?.water_ml ?? null}
          targetMl={targets?.water_target_ml ?? null}
        />

        <CaffeineCurve data={caffeine} isLoading={isLoading} />
      </main>
    </div>
  )
}
