import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AreaChart, Area, XAxis, YAxis, ReferenceLine,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { api } from '../api/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CurvePoint {
  time: string
  time_label: string
  caffeine_mg: number
  in_past: boolean
  zone: 'low' | 'optimal' | 'elevated' | 'high'
}

export interface CurveData {
  curve: CurvePoint[]
  current_mg: number
  caffeine_at_bedtime: number
  sleep_impact: string
  total_today_mg: number
}

interface Substance {
  key: string
  label: string
  caffeine_mg: number
  half_life: number
}

// ─── Zone colours ─────────────────────────────────────────────────────────────

function zoneColour(mg: number) {
  if (mg < 50)  return '#52525b'
  if (mg < 200) return '#22c55e'
  if (mg < 300) return '#f59e0b'
  return '#ef4444'
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

function CurveTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const mg = payload[0]?.value as number
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs">
      <p className="text-zinc-400 mb-0.5">{label}</p>
      <p className="text-white font-semibold">{mg}mg</p>
    </div>
  )
}

// ─── Log Sheet ────────────────────────────────────────────────────────────────

function LogSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [customMg, setCustomMg] = useState('')

  const { data: substances = [] } = useQuery<Substance[]>({
    queryKey: ['substances'],
    queryFn: () => api.get('/stimulants/substances').then(r => r.data),
    staleTime: Infinity,
  })

  const { mutate, isPending } = useMutation({
    mutationFn: (body: { substance: string; caffeine_mg?: number }) =>
      api.post('/stimulants/log', body),
    onSuccess: () => {
      // Invalidate dashboard so summary + caffeine curve both refresh
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      onClose()
    },
  })

  function handleLog() {
    if (!selected) return
    const body: { substance: string; caffeine_mg?: number } = { substance: selected }
    if (selected === 'custom' && customMg) {
      body.caffeine_mg = parseInt(customMg)
    }
    mutate(body)
  }

  const selectedSubstance = substances.find(s => s.key === selected)
  const presets = substances.filter(s => s.key !== 'custom')

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-950 border-t border-zinc-800 rounded-t-2xl px-4 pt-5 pb-10">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-white font-semibold">Log Stimulant</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors text-sm">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          {presets.map(s => (
            <button
              key={s.key}
              onClick={() => setSelected(s.key)}
              className={`text-left px-4 py-3 rounded-xl border transition-all duration-150 ${
                selected === s.key
                  ? 'bg-white text-black border-white'
                  : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-600'
              }`}
            >
              <p className="text-sm font-medium">{s.label}</p>
              <p className={`text-xs mt-0.5 ${selected === s.key ? 'text-zinc-600' : 'text-zinc-500'}`}>
                {s.caffeine_mg}mg caffeine
              </p>
            </button>
          ))}

          <button
            onClick={() => setSelected('custom')}
            className={`text-left px-4 py-3 rounded-xl border transition-all duration-150 ${
              selected === 'custom'
                ? 'bg-white text-black border-white'
                : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-600'
            }`}
          >
            <p className="text-sm font-medium">Custom</p>
            <p className={`text-xs mt-0.5 ${selected === 'custom' ? 'text-zinc-600' : 'text-zinc-500'}`}>
              Enter mg manually
            </p>
          </button>
        </div>

        {selected === 'custom' && (
          <div className="mb-4">
            <div className="relative">
              <input
                type="number"
                value={customMg}
                onChange={e => setCustomMg(e.target.value)}
                placeholder="e.g. 150"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-500 pr-12"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">mg</span>
            </div>
          </div>
        )}

        {selectedSubstance && selected !== 'custom' && (
          <p className="text-xs text-zinc-500 mb-4">
            {selectedSubstance.caffeine_mg}mg · half-life {selectedSubstance.half_life}h
          </p>
        )}

        <button
          onClick={handleLog}
          disabled={!selected || isPending || (selected === 'custom' && !customMg)}
          className="w-full bg-white text-black font-semibold text-sm py-3 rounded-xl hover:bg-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isPending ? 'Logging…' : 'Log'}
        </button>
      </div>
    </>
  )
}

// ─── Caffeine Curve Card ──────────────────────────────────────────────────────

interface CaffeineCurveProps {
  data: CurveData | undefined
  isLoading: boolean
}

export function CaffeineCurve({ data, isLoading }: CaffeineCurveProps) {
  const [showLog, setShowLog] = useState(false)

  if (isLoading) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 animate-pulse">
        <div className="h-4 w-28 bg-zinc-800 rounded mb-4" />
        <div className="h-24 bg-zinc-800 rounded" />
      </div>
    )
  }

  const curve = data?.curve ?? []
  const currentMg = data?.current_mg ?? 0
  const colour = zoneColour(currentMg)

  const nowIndex = curve.findIndex(p => !p.in_past)
  const tickIndices = new Set(curve.map((_, i) => i).filter(i => i % 4 === 0))

  return (
    <>
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-1">Caffeine</p>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold text-white">{currentMg}</span>
              <span className="text-sm text-zinc-500">mg active</span>
              <span
                className="text-xs font-medium px-1.5 py-0.5 rounded-full ml-1"
                style={{ color: colour, backgroundColor: `${colour}20` }}
              >
                {currentMg < 50 ? 'low' : currentMg < 200 ? 'optimal' : currentMg < 300 ? 'elevated' : 'high'}
              </span>
            </div>
          </div>
          <button
            onClick={() => setShowLog(true)}
            className="text-xs font-medium text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg transition-colors"
          >
            + Log
          </button>
        </div>

        {curve.length > 0 ? (
          <ResponsiveContainer width="100%" height={110}>
            <AreaChart data={curve} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="caffeineGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={colour} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={colour} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="time_label"
                tick={{ fontSize: 9, fill: '#52525b' }}
                tickLine={false}
                axisLine={false}
                interval={(_, i) => tickIndices.has(i) ? 0 : 1}
              />
              <YAxis hide domain={[0, 'auto']} />
              <ReferenceLine y={50}  stroke="#52525b" strokeDasharray="3 3" strokeWidth={1} />
              <ReferenceLine y={200} stroke="#f59e0b" strokeDasharray="3 3" strokeWidth={1} />
              <ReferenceLine y={300} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1} />
              {nowIndex > 0 && (
                <ReferenceLine
                  x={curve[nowIndex]?.time_label}
                  stroke="#ffffff"
                  strokeWidth={1}
                  strokeDasharray="4 2"
                />
              )}
              <Tooltip content={<CurveTooltip />} />
              <Area
                type="monotone"
                dataKey="caffeine_mg"
                stroke={colour}
                strokeWidth={2}
                fill="url(#caffeineGrad)"
                dot={false}
                activeDot={{ r: 3, fill: colour, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-24 flex items-center justify-center">
            <p className="text-sm text-zinc-600">No caffeine logged today</p>
          </div>
        )}

        {data && (
          <p className="text-[11px] text-zinc-500 mt-2 leading-relaxed">
            {data.sleep_impact}
            {data.caffeine_at_bedtime > 0 && (
              <span className="text-zinc-600"> · {data.caffeine_at_bedtime}mg at bedtime</span>
            )}
          </p>
        )}
      </div>

      {showLog && <LogSheet onClose={() => setShowLog(false)} />}
    </>
  )
}