import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid,
} from 'recharts'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'

// ─── Types ────────────────────────────────────────────────────────────────────

interface BodyMetric {
  id: string
  date: string
  weight_kg: number | null
  body_fat_pct: number | null
  source: string
  logged_at: string
}

interface BodyStats {
  current_weight_kg: number | null
  current_body_fat_pct: number | null
  weight_change_7d: number | null
  weight_change_30d: number | null
  bf_change_7d: number | null
  bf_change_30d: number | null
  lowest_weight_kg: number | null
  highest_weight_kg: number | null
  total_entries: number
}

interface BodyHistory {
  entries: BodyMetric[]
  stats: BodyStats | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDateFull(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function trendArrow(change: number | null): { arrow: string; color: string; label: string } | null {
  if (change === null) return null
  if (Math.abs(change) < 0.05) return { arrow: '→', color: '#71717a', label: 'stable' }
  if (change > 0) return { arrow: '↑', color: '#f97316', label: `+${change.toFixed(1)}` }
  return { arrow: '↓', color: '#22c55e', label: change.toFixed(1) }
}

function trendArrowBF(change: number | null): { arrow: string; color: string; label: string } | null {
  if (change === null) return null
  if (Math.abs(change) < 0.1) return { arrow: '→', color: '#71717a', label: 'stable' }
  if (change > 0) return { arrow: '↑', color: '#f97316', label: `+${change.toFixed(1)}%` }
  return { arrow: '↓', color: '#22c55e', label: `${change.toFixed(1)}%` }
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs">
      <p className="text-zinc-400 mb-0.5">{label}</p>
      <p className="text-white font-semibold">{payload[0]?.value?.toFixed(1)}{unit}</p>
    </div>
  )
}

// ─── Trend Card ───────────────────────────────────────────────────────────────

function TrendCard({
  label,
  value,
  unit,
  change7d,
  change30d,
  icon,
  isWeight = true,
}: {
  label: string
  value: number | null
  unit: string
  change7d: number | null
  change30d: number | null
  icon: React.ReactNode
  isWeight?: boolean
}) {
  const trend7d = isWeight ? trendArrow(change7d) : trendArrowBF(change7d)
  const trend30d = isWeight ? trendArrow(change30d) : trendArrowBF(change30d)

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest">{label}</span>
        <span className="text-zinc-600">{icon}</span>
      </div>
      <p className="text-2xl font-bold text-white leading-none mb-3">
        {value != null ? value.toFixed(1) : '—'}
        <span className="text-sm text-zinc-500 font-normal ml-1">{unit}</span>
      </p>
      <div className="flex gap-4">
        {trend7d && (
          <div>
            <p className="text-[10px] text-zinc-600 mb-0.5">7d</p>
            <p className="text-xs font-semibold" style={{ color: trend7d.color }}>
              {trend7d.arrow} {trend7d.label}
            </p>
          </div>
        )}
        {trend30d && (
          <div>
            <p className="text-[10px] text-zinc-600 mb-0.5">30d</p>
            <p className="text-xs font-semibold" style={{ color: trend30d.color }}>
              {trend30d.arrow} {trend30d.label}
            </p>
          </div>
        )}
        {!trend7d && !trend30d && (
          <p className="text-xs text-zinc-600">Log more to see trends</p>
        )}
      </div>
    </div>
  )
}

// ─── Weight Chart ─────────────────────────────────────────────────────────────

function WeightChart({
  entries,
  field,
  unit,
  color,
  label,
}: {
  entries: BodyMetric[]
  field: 'weight_kg' | 'body_fat_pct'
  unit: string
  color: string
  label: string
}) {
  const data = entries
    .filter(e => e[field] != null)
    .map(e => ({
      date: formatDate(e.date),
      value: e[field] as number,
    }))

  if (data.length < 2) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-1">{label} trend</p>
        <div className="h-24 flex items-center justify-center">
          <p className="text-xs text-zinc-600">Log at least 2 entries to see a chart</p>
        </div>
      </div>
    )
  }

  const values = data.map(d => d.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const padding = (max - min) * 0.2 || 1
  const domainMin = Math.floor(min - padding)
  const domainMax = Math.ceil(max + padding)

  // Show only every N-th tick for readability
  const tickStep = Math.ceil(data.length / 5)
  const tickIndices = new Set(data.map((_, i) => i).filter(i => i % tickStep === 0 || i === data.length - 1))

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-4">{label} trend</p>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data} margin={{ top: 5, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 9, fill: '#52525b' }}
            tickLine={false}
            axisLine={false}
            interval={(_, i) => tickIndices.has(i) ? 0 : 1}
          />
          <YAxis
            domain={[domainMin, domainMax]}
            tick={{ fontSize: 9, fill: '#52525b' }}
            tickLine={false}
            axisLine={false}
            width={28}
          />
          <Tooltip content={<ChartTooltip unit={unit} />} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={data.length < 15 ? { r: 2.5, fill: color, strokeWidth: 0 } : false}
            activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Log Sheet ────────────────────────────────────────────────────────────────

function LogSheet({ onClose, currentWeight }: { onClose: () => void; currentWeight: number | null }) {
  const qc = useQueryClient()
  const { user } = useAuthStore()

  const [weight, setWeight] = useState(currentWeight ? currentWeight.toFixed(1) : '')
  const [bodyFat, setBodyFat] = useState('')

  const { mutate, isPending } = useMutation({
    mutationFn: (body: object) => api.post('/body/metrics', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['body-history'] })
      onClose()
    },
  })

  function handleLog() {
    const payload: { weight_kg?: number; body_fat_pct?: number } = {}
    if (weight) payload.weight_kg = parseFloat(weight)
    if (bodyFat) payload.body_fat_pct = parseFloat(bodyFat)
    if (!payload.weight_kg && !payload.body_fat_pct) return
    mutate(payload)
  }

  const hasValue = weight || bodyFat

  // BMI preview
  const bmiVal =
    weight && user?.height_cm
      ? (parseFloat(weight) / Math.pow(user.height_cm / 100, 2)).toFixed(1)
      : null

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-950 border-t border-zinc-800 rounded-t-2xl px-4 pt-5 pb-10">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-white font-semibold">Log Body Metrics</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">✕</button>
        </div>

        <div className="space-y-4 mb-5">
          {/* Weight */}
          <div>
            <label className="block text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-1.5">
              Weight
            </label>
            <div className="relative">
              <input
                type="number"
                step="0.1"
                value={weight}
                onChange={e => setWeight(e.target.value)}
                placeholder={currentWeight ? currentWeight.toFixed(1) : '80.0'}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors pr-12"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">kg</span>
            </div>
            {bmiVal && (
              <p className="text-[11px] text-zinc-600 mt-1.5">
                BMI: {bmiVal}
              </p>
            )}
          </div>

          {/* Body Fat */}
          <div>
            <label className="block text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-1.5">
              Body Fat <span className="text-zinc-700 normal-case">(optional)</span>
            </label>
            <div className="relative">
              <input
                type="number"
                step="0.1"
                value={bodyFat}
                onChange={e => setBodyFat(e.target.value)}
                placeholder="15.0"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors pr-8"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">%</span>
            </div>
          </div>
        </div>

        <button
          onClick={handleLog}
          disabled={!hasValue || isPending}
          className="w-full bg-white text-black font-semibold text-sm py-3 rounded-xl hover:bg-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </>
  )
}

// ─── History List ─────────────────────────────────────────────────────────────

function HistoryRow({
  metric,
  onDelete,
}: {
  metric: BodyMetric
  onDelete: () => void
}) {
  const [confirm, setConfirm] = useState(false)

  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-zinc-500">{formatDateFull(metric.date)}</p>
        <div className="flex gap-4 mt-0.5">
          {metric.weight_kg != null && (
            <span className="text-sm font-semibold text-white">
              {metric.weight_kg.toFixed(1)}
              <span className="text-xs text-zinc-500 font-normal ml-0.5">kg</span>
            </span>
          )}
          {metric.body_fat_pct != null && (
            <span className="text-sm font-semibold text-white">
              {metric.body_fat_pct.toFixed(1)}
              <span className="text-xs text-zinc-500 font-normal ml-0.5">% BF</span>
            </span>
          )}
        </div>
      </div>

      {confirm ? (
        <div className="flex gap-2 shrink-0">
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
          className="text-zinc-700 hover:text-zinc-400 transition-colors text-sm shrink-0"
        >
          ···
        </button>
      )}
    </div>
  )
}

// ─── Range Selector ───────────────────────────────────────────────────────────

function RangeButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 ${
        active
          ? 'bg-white text-black'
          : 'text-zinc-500 hover:text-zinc-300 bg-zinc-900 border border-zinc-800'
      }`}
    >
      {children}
    </button>
  )
}

// ─── Body Page ────────────────────────────────────────────────────────────────

export function Body() {
  const [showLog, setShowLog] = useState(false)
  const [range, setRange] = useState<30 | 60 | 90>(90)
  const qc = useQueryClient()

  const { data, isLoading } = useQuery<BodyHistory>({
    queryKey: ['body-history', range],
    queryFn: () => api.get(`/body/history?days=${range}`).then(r => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/body/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['body-history'] }),
  })

  const entries = data?.entries ?? []
  const stats = data?.stats ?? null

  const hasWeight = entries.some(e => e.weight_kg != null)
  const hasBF = entries.some(e => e.body_fat_pct != null)

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  return (
    <>
      <div className="min-h-screen bg-black text-white pb-24">
        {/* Header */}
        <header className="px-4 pt-14 pb-5 flex items-end justify-between">
          <div>
            <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest">{today}</p>
            <h1 className="text-2xl font-bold mt-1">Body</h1>
          </div>
          <button
            onClick={() => setShowLog(true)}
            className="bg-white text-black text-sm font-semibold px-4 py-2 rounded-xl hover:bg-zinc-100 transition-colors"
          >
            + Log
          </button>
        </header>

        <main className="px-4 space-y-3">

          {/* Trend cards */}
          {isLoading ? (
            <div className="grid grid-cols-2 gap-3">
              {[0, 1].map(i => (
                <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 animate-pulse">
                  <div className="h-3 w-16 bg-zinc-800 rounded mb-3" />
                  <div className="h-7 w-20 bg-zinc-800 rounded mb-3" />
                  <div className="h-3 w-24 bg-zinc-800 rounded" />
                </div>
              ))}
            </div>
          ) : stats ? (
            <div className="grid grid-cols-2 gap-3">
              <TrendCard
                label="Weight"
                value={stats.current_weight_kg}
                unit="kg"
                change7d={stats.weight_change_7d}
                change30d={stats.weight_change_30d}
                isWeight={true}
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="5" r="2" />
                    <path d="M12 7v8m-4-5 4 2 4-2M9 20l3-5 3 5" />
                  </svg>
                }
              />
              <TrendCard
                label="Body Fat"
                value={stats.current_body_fat_pct}
                unit="%"
                change7d={stats.bf_change_7d}
                change30d={stats.bf_change_30d}
                isWeight={false}
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a7 7 0 0 1 7 7c0 4-3.5 7-7 13C8.5 16 5 13 5 9a7 7 0 0 1 7-7z" />
                  </svg>
                }
              />
            </div>
          ) : null}

          {/* Empty state */}
          {!isLoading && entries.length === 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-center">
              <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-3">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="5" r="2" />
                  <path d="M12 7v8m-4-5 4 2 4-2M9 20l3-5 3 5" />
                </svg>
              </div>
              <p className="text-sm text-zinc-400 font-medium">No body metrics yet</p>
              <p className="text-xs text-zinc-600 mt-1 mb-4">
                Track your weight and body fat to see trends over time
              </p>
              <button
                onClick={() => setShowLog(true)}
                className="text-sm font-medium text-white bg-zinc-800 hover:bg-zinc-700 px-4 py-2 rounded-xl transition-colors"
              >
                Log your first entry →
              </button>
            </div>
          )}

          {/* Charts */}
          {!isLoading && entries.length > 0 && (
            <>
              {/* Range selector */}
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest">
                  {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
                </p>
                <div className="flex gap-1.5">
                  {([30, 60, 90] as const).map(r => (
                    <RangeButton key={r} active={range === r} onClick={() => setRange(r)}>
                      {r}d
                    </RangeButton>
                  ))}
                </div>
              </div>

              {hasWeight && (
                <WeightChart
                  entries={entries}
                  field="weight_kg"
                  unit="kg"
                  color="#ffffff"
                  label="Weight"
                />
              )}

              {hasBF && (
                <WeightChart
                  entries={entries}
                  field="body_fat_pct"
                  unit="%"
                  color="#a78bfa"
                  label="Body Fat"
                />
              )}

              {/* Range stats */}
              {stats && stats.lowest_weight_kg != null && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                  <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-3">
                    {range}-day range
                  </p>
                  <div className="flex gap-6">
                    <div>
                      <p className="text-[10px] text-zinc-600 mb-0.5">Low</p>
                      <p className="text-sm font-semibold text-white">
                        {stats.lowest_weight_kg?.toFixed(1)}
                        <span className="text-xs text-zinc-500 font-normal ml-0.5">kg</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-600 mb-0.5">High</p>
                      <p className="text-sm font-semibold text-white">
                        {stats.highest_weight_kg?.toFixed(1)}
                        <span className="text-xs text-zinc-500 font-normal ml-0.5">kg</span>
                      </p>
                    </div>
                    {stats.highest_weight_kg != null && stats.lowest_weight_kg != null && (
                      <div>
                        <p className="text-[10px] text-zinc-600 mb-0.5">Variance</p>
                        <p className="text-sm font-semibold text-white">
                          {(stats.highest_weight_kg - stats.lowest_weight_kg).toFixed(1)}
                          <span className="text-xs text-zinc-500 font-normal ml-0.5">kg</span>
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Log history */}
              <div>
                <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-3">
                  History
                </p>
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden divide-y divide-zinc-800/60">
                  {[...entries].reverse().map(metric => (
                    <HistoryRow
                      key={metric.id}
                      metric={metric}
                      onDelete={() => deleteMutation.mutate(metric.id)}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      {showLog && (
        <LogSheet
          onClose={() => setShowLog(false)}
          currentWeight={stats?.current_weight_kg ?? null}
        />
      )}
    </>
  )
}