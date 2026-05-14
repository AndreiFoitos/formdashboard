import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrainingLog {
  id: string
  date: string
  type: string
  duration_min: number | null
  intensity: number | null
  volume_sets: number | null
  notes: string | null
  logged_at: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TRAINING_TYPES = [
  { key: 'push',      label: 'Push',       desc: 'Chest · Shoulders · Triceps' },
  { key: 'pull',      label: 'Pull',       desc: 'Back · Biceps · Rear delts' },
  { key: 'legs',      label: 'Legs',       desc: 'Quads · Hamstrings · Glutes' },
  { key: 'upper',     label: 'Upper',      desc: 'Push + Pull combined' },
  { key: 'lower',     label: 'Lower',      desc: 'Full lower body' },
  { key: 'full_body', label: 'Full Body',  desc: 'All muscle groups' },
  { key: 'cardio',    label: 'Cardio',     desc: 'Conditioning · Endurance' },
]

const TYPE_COLOURS: Record<string, string> = {
  push:      '#818cf8', // indigo
  pull:      '#34d399', // emerald
  legs:      '#f472b6', // pink
  upper:     '#60a5fa', // blue
  lower:     '#a78bfa', // violet
  full_body: '#facc15', // yellow
  cardio:    '#fb923c', // orange
}

function typeColour(type: string) {
  return TYPE_COLOURS[type] ?? '#71717a'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  const d = new Date(iso)
  const today    = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (d.toDateString() === today.toDateString())     return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function intensityLabel(n: number) {
  return ['', 'Easy', 'Light', 'Moderate', 'Hard', 'Max'][n] ?? ''
}

// ─── Log Sheet ────────────────────────────────────────────────────────────────

interface LogSheetProps {
  onClose: () => void
}

function LogSheet({ onClose }: LogSheetProps) {
  const qc = useQueryClient()

  const [type,       setType]       = useState<string | null>(null)
  const [duration,   setDuration]   = useState('')
  const [intensity,  setIntensity]  = useState<number | null>(null)
  const [sets,       setSets]       = useState('')
  const [notes,      setNotes]      = useState('')
  const [step,       setStep]       = useState<'type' | 'details'>('type')

  const { mutate, isPending } = useMutation({
    mutationFn: (body: object) => api.post('/training/log', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['training-history'] })
      qc.invalidateQueries({ queryKey: ['summary'] })
      onClose()
    },
  })

  function handleLog() {
    if (!type) return
    mutate({
      type,
      duration_min:  duration  ? parseInt(duration)  : null,
      intensity:     intensity ?? null,
      volume_sets:   sets      ? parseInt(sets)      : null,
      notes:         notes.trim() || null,
    })
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-950 border-t border-zinc-800 rounded-t-2xl px-4 pt-5 pb-10 max-h-[85vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            {step === 'details' && (
              <button
                onClick={() => setStep('type')}
                className="text-zinc-500 hover:text-white transition-colors text-sm"
              >
                ←
              </button>
            )}
            <h3 className="text-white font-semibold">
              {step === 'type' ? 'Log Workout' : `Log ${TRAINING_TYPES.find(t => t.key === type)?.label}`}
            </h3>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">✕</button>
        </div>

        {/* Step 1 — Type selection */}
        {step === 'type' && (
          <div className="space-y-2">
            {TRAINING_TYPES.map(t => (
              <button
                key={t.key}
                onClick={() => { setType(t.key); setStep('details') }}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-zinc-800 bg-zinc-900 hover:border-zinc-600 transition-all duration-150 text-left"
              >
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: typeColour(t.key) }}
                />
                <div>
                  <p className="text-sm font-medium text-white">{t.label}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{t.desc}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Step 2 — Details */}
        {step === 'details' && (
          <div className="space-y-5">

            {/* Duration */}
            <div>
              <label className="block text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-2">
                Duration
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={duration}
                  onChange={e => setDuration(e.target.value)}
                  placeholder="60"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors pr-14"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">min</span>
              </div>
            </div>

            {/* Intensity */}
            <div>
              <label className="block text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-2">
                Intensity
              </label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    onClick={() => setIntensity(n)}
                    className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-all duration-150 ${
                      intensity === n
                        ? 'bg-white text-black border-white'
                        : 'bg-zinc-900 text-zinc-500 border-zinc-800 hover:border-zinc-600 hover:text-white'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              {intensity && (
                <p className="text-xs text-zinc-500 mt-1.5">{intensityLabel(intensity)}</p>
              )}
            </div>

            {/* Sets */}
            <div>
              <label className="block text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-2">
                Total Sets <span className="text-zinc-700 normal-case">(optional)</span>
              </label>
              <input
                type="number"
                value={sets}
                onChange={e => setSets(e.target.value)}
                placeholder="e.g. 18"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-2">
                Notes <span className="text-zinc-700 normal-case">(optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Bench 100kg × 5, squat felt heavy…"
                rows={3}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors resize-none"
              />
            </div>

            <button
              onClick={handleLog}
              disabled={isPending}
              className="w-full bg-white text-black font-semibold text-sm py-3 rounded-xl hover:bg-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isPending ? 'Logging…' : 'Log Workout'}
            </button>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Session Card ─────────────────────────────────────────────────────────────

function SessionCard({
  log,
  onDelete,
}: {
  log: TrainingLog
  onDelete: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  const colour = typeColour(log.type)
  const label  = TRAINING_TYPES.find(t => t.key === log.type)?.label ?? log.type

  return (
    <div className="flex items-start gap-3 px-4 py-4">
      {/* Colour dot */}
      <div className="mt-1 shrink-0">
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colour }} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-semibold text-white">{label}</p>
          <p className="text-xs text-zinc-500 shrink-0 ml-2">{formatDate(log.date)}</p>
        </div>
        <div className="flex gap-3 mt-1 flex-wrap">
          {log.duration_min && (
            <span className="text-xs text-zinc-500">{log.duration_min} min</span>
          )}
          {log.intensity && (
            <span className="text-xs text-zinc-500">
              Intensity {log.intensity} · {intensityLabel(log.intensity)}
            </span>
          )}
          {log.volume_sets && (
            <span className="text-xs text-zinc-500">{log.volume_sets} sets</span>
          )}
        </div>
        {log.notes && (
          <p className="text-xs text-zinc-600 mt-1.5 leading-relaxed line-clamp-2">{log.notes}</p>
        )}
      </div>

      {/* Delete */}
      <div className="shrink-0">
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

// ─── Weekly volume bar ────────────────────────────────────────────────────────

function WeeklyBar({ logs }: { logs: TrainingLog[] }) {
  // Count sessions by type in the last 7 days
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)

  const recent = logs.filter(l => new Date(l.date) >= sevenDaysAgo)

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const today = new Date().getDay() // 0 = Sun
  const mondayOffset = (today + 6) % 7 // days since Monday

  const dayData = days.map((label, i) => {
    const d = new Date()
    d.setDate(d.getDate() - mondayOffset + i)
    const iso = d.toISOString().slice(0, 10)
    const session = recent.find(l => l.date === iso)
    return { label, iso, session }
  })

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-4">
        This Week
      </p>
      <div className="flex items-end justify-between gap-1">
        {dayData.map(({ label, iso, session }) => {
          const isToday = iso === new Date().toISOString().slice(0, 10)
          const colour  = session ? typeColour(session.type) : null

          return (
            <div key={label} className="flex-1 flex flex-col items-center gap-1.5">
              <div
                className={`w-full rounded-md transition-all duration-300 ${
                  session ? 'h-8' : 'h-2'
                } ${!session ? 'bg-zinc-800' : ''}`}
                style={session ? { backgroundColor: `${colour}40`, border: `1px solid ${colour}60` } : {}}
              />
              <span
                className={`text-[9px] font-medium ${
                  isToday ? 'text-white' : 'text-zinc-600'
                }`}
              >
                {label}
              </span>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-zinc-600 mt-3">
        {recent.length} session{recent.length !== 1 ? 's' : ''} this week
      </p>
    </div>
  )
}

// ─── Training Page ────────────────────────────────────────────────────────────

export function Training() {
  const [showLog, setShowLog] = useState(false)
  const qc = useQueryClient()

  const { data: history = [], isLoading } = useQuery<TrainingLog[]>({
    queryKey: ['training-history'],
    queryFn: () => api.get('/training/history?limit=30').then(r => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/training/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['training-history'] }),
  })

  // Group by date for display
  const grouped: Record<string, TrainingLog[]> = {}
  for (const log of history) {
    if (!grouped[log.date]) grouped[log.date] = []
    grouped[log.date].push(log)
  }
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  return (
    <>
      <div className="min-h-screen bg-black text-white pb-24">
        {/* Header */}
        <header className="px-4 pt-14 pb-5 flex items-end justify-between">
          <div>
            <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
            <h1 className="text-2xl font-bold mt-1">Training</h1>
          </div>
          <button
            onClick={() => setShowLog(true)}
            className="bg-white text-black text-sm font-semibold px-4 py-2 rounded-xl hover:bg-zinc-100 transition-colors"
          >
            + Log
          </button>
        </header>

        <main className="px-4 space-y-3">
          {/* Weekly overview */}
          <WeeklyBar logs={history} />

          {/* History */}
          <div>
            <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-3">
              History
            </p>

            {isLoading && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 text-center">
                <p className="text-sm text-zinc-600">Loading…</p>
              </div>
            )}

            {!isLoading && history.length === 0 && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-center">
                <p className="text-sm text-zinc-400 font-medium">No sessions logged yet</p>
                <p className="text-xs text-zinc-600 mt-1 mb-4">Start tracking your training</p>
                <button
                  onClick={() => setShowLog(true)}
                  className="text-sm font-medium text-white bg-zinc-800 hover:bg-zinc-700 px-4 py-2 rounded-xl transition-colors"
                >
                  Log your first session →
                </button>
              </div>
            )}

            {!isLoading && history.length > 0 && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden divide-y divide-zinc-800/60">
                {sortedDates.map(date => (
                  <div key={date}>
                    {grouped[date].map(log => (
                      <SessionCard
                        key={log.id}
                        log={log}
                        onDelete={() => deleteMutation.mutate(log.id)}
                      />
                    ))}
                  </div>
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