import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Modal,
} from 'react-native'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api } from '../../api/client'
import { useRequireAuth } from '../../hooks/useRequireAuth'
import { SkeletonCard } from '../../components/Skeleton'
import { SwipeableRow } from '../../components/SwipeableRow'
import { PressableScale } from '../../components/PressableScale'
import { hapticSuccess, hapticSelection } from '../../lib/haptics'

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
  { key: 'push',      label: 'Push',      desc: 'Chest · Shoulders · Triceps' },
  { key: 'pull',      label: 'Pull',      desc: 'Back · Biceps · Rear delts' },
  { key: 'legs',      label: 'Legs',      desc: 'Quads · Hamstrings · Glutes' },
  { key: 'upper',     label: 'Upper',     desc: 'Push + Pull combined' },
  { key: 'lower',     label: 'Lower',     desc: 'Full lower body' },
  { key: 'full_body', label: 'Full Body', desc: 'All muscle groups' },
  { key: 'cardio',    label: 'Cardio',    desc: 'Conditioning · Endurance' },
]

const TYPE_COLOURS: Record<string, string> = {
  push:      '#818cf8',
  pull:      '#34d399',
  legs:      '#f472b6',
  upper:     '#60a5fa',
  lower:     '#a78bfa',
  full_body: '#facc15',
  cardio:    '#fb923c',
}

function typeColour(type: string) {
  return TYPE_COLOURS[type] ?? '#71717a'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function intensityLabel(n: number) {
  return ['', 'Easy', 'Light', 'Moderate', 'Hard', 'Max'][n] ?? ''
}

// ─── Log Modal ────────────────────────────────────────────────────────────────

function LogModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()

  const [type,      setType]      = useState<string | null>(null)
  const [duration,  setDuration]  = useState('')
  const [intensity, setIntensity] = useState<number | null>(null)
  const [sets,      setSets]      = useState('')
  const [notes,     setNotes]     = useState('')
  const [step,      setStep]      = useState<'type' | 'details'>('type')

  const { mutate, isPending } = useMutation({
    mutationFn: (body: object) => api.post('/training/log', body),
    onSuccess: () => {
      hapticSuccess()
      qc.invalidateQueries({ queryKey: ['training-history'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      onClose()
    },
  })

  function handleLog() {
    if (!type) return
    mutate({
      type,
      duration_min: duration ? parseInt(duration) : null,
      intensity:    intensity ?? null,
      volume_sets:  sets     ? parseInt(sets)     : null,
      notes:        notes.trim() || null,
    })
  }

  const selectedType = TRAINING_TYPES.find(t => t.key === type)

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-zinc-950">
        {/* Handle */}
        <View className="items-center pt-3 pb-2">
          <View className="w-10 h-1 bg-zinc-700 rounded-full" />
        </View>

        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-zinc-800">
          <View className="flex-row items-center gap-3">
            {step === 'details' && (
              <TouchableOpacity onPress={() => setStep('type')}>
                <Text className="text-zinc-400 text-sm">← Back</Text>
              </TouchableOpacity>
            )}
            <Text className="text-white font-semibold">
              {step === 'type' ? 'Log Workout' : `Log ${selectedType?.label}`}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose}>
            <Text className="text-zinc-400 text-sm">✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView className="flex-1 px-4 pt-4" keyboardShouldPersistTaps="handled">

          {/* Step 1 — Type */}
          {step === 'type' && (
            <View style={{ gap: 8 }}>
              {TRAINING_TYPES.map(t => (
                <TouchableOpacity
                  key={t.key}
                  onPress={() => { setType(t.key); setStep('details') }}
                  className="flex-row items-center gap-3 px-4 py-4 rounded-2xl border border-zinc-800 bg-zinc-900"
                >
                  <View
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: typeColour(t.key) }}
                  />
                  <View>
                    <Text className="text-white text-sm font-medium">{t.label}</Text>
                    <Text className="text-zinc-500 text-xs mt-0.5">{t.desc}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Step 2 — Details */}
          {step === 'details' && (
            <View style={{ gap: 20 }}>

              {/* Duration */}
              <View>
                <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-1.5">
                  Duration
                </Text>
                <View>
                  <TextInput
                    value={duration}
                    onChangeText={setDuration}
                    placeholder="60"
                    placeholderTextColor="#52525b"
                    keyboardType="number-pad"
                    className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 text-white text-sm"
                  />
                  <Text className="absolute right-4 top-4 text-zinc-500 text-sm">min</Text>
                </View>
              </View>

              {/* Intensity */}
              <View>
                <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">
                  Intensity
                </Text>
                <View className="flex-row gap-2">
                  {[1, 2, 3, 4, 5].map(n => (
                    <TouchableOpacity
                      key={n}
                      onPress={() => { hapticSelection(); setIntensity(n) }}
                      className="flex-1 py-3 rounded-2xl border items-center"
                      style={{
                        backgroundColor: intensity === n ? 'white' : '#18181b',
                        borderColor: intensity === n ? 'white' : '#3f3f46',
                      }}
                    >
                      <Text
                        className="text-sm font-semibold"
                        style={{ color: intensity === n ? 'black' : '#71717a' }}
                      >
                        {n}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {intensity && (
                  <Text className="text-zinc-500 text-xs mt-1.5">
                    {intensityLabel(intensity)}
                  </Text>
                )}
              </View>

              {/* Sets */}
              <View>
                <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-1.5">
                  Total Sets{' '}
                  <Text className="text-zinc-700 normal-case">(optional)</Text>
                </Text>
                <TextInput
                  value={sets}
                  onChangeText={setSets}
                  placeholder="e.g. 18"
                  placeholderTextColor="#52525b"
                  keyboardType="number-pad"
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 text-white text-sm"
                />
              </View>

              {/* Notes */}
              <View>
                <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-1.5">
                  Notes{' '}
                  <Text className="text-zinc-700 normal-case">(optional)</Text>
                </Text>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Bench 100kg × 5, squat felt heavy…"
                  placeholderTextColor="#52525b"
                  multiline
                  numberOfLines={3}
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 text-white text-sm"
                  style={{ minHeight: 80, textAlignVertical: 'top' }}
                />
              </View>

              <TouchableOpacity
                onPress={handleLog}
                disabled={isPending}
                className="bg-white rounded-2xl py-4 items-center mb-10"
                style={{ opacity: isPending ? 0.4 : 1 }}
              >
                {isPending ? (
                  <ActivityIndicator color="black" />
                ) : (
                  <Text className="text-black font-semibold text-base">Log Workout</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  )
}

// ─── Session Card ─────────────────────────────────────────────────────────────

function SessionCard({
  log,
  isLast,
}: {
  log: TrainingLog
  isLast: boolean
}) {
  const colour = typeColour(log.type)
  const label  = TRAINING_TYPES.find(t => t.key === log.type)?.label ?? log.type

  return (
    <View
      className="flex-row items-start gap-3 px-4 py-4 bg-zinc-900"
      style={{ borderBottomWidth: isLast ? 0 : 1, borderBottomColor: '#27272a' }}
    >
      {/* Colour dot */}
      <View className="mt-1.5">
        <View className="w-2 h-2 rounded-full" style={{ backgroundColor: colour }} />
      </View>

      {/* Content */}
      <View className="flex-1">
        <View className="flex-row items-baseline justify-between">
          <Text className="text-white text-sm font-semibold">{label}</Text>
          <Text className="text-zinc-500 text-xs ml-2">{formatDate(log.date)}</Text>
        </View>
        <View className="flex-row flex-wrap gap-x-3 mt-1">
          {log.duration_min != null && (
            <Text className="text-zinc-500 text-xs">{log.duration_min} min</Text>
          )}
          {log.intensity != null && (
            <Text className="text-zinc-500 text-xs">
              Intensity {log.intensity} · {intensityLabel(log.intensity)}
            </Text>
          )}
          {log.volume_sets != null && (
            <Text className="text-zinc-500 text-xs">{log.volume_sets} sets</Text>
          )}
        </View>
        {log.notes && (
          <Text className="text-zinc-600 text-xs mt-1.5 leading-5" numberOfLines={2}>
            {log.notes}
          </Text>
        )}
      </View>
    </View>
  )
}

// ─── Weekly Bar ───────────────────────────────────────────────────────────────

function WeeklyBar({ logs }: { logs: TrainingLog[] }) {
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)

  const recent = logs.filter(l => new Date(l.date) >= sevenDaysAgo)

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const today = new Date().getDay()
  const mondayOffset = (today + 6) % 7

  const dayData = days.map((label, i) => {
    const d = new Date()
    d.setDate(d.getDate() - mondayOffset + i)
    const iso = d.toISOString().slice(0, 10)
    const session = recent.find(l => l.date === iso)
    return { label, iso, session }
  })

  return (
    <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-4">
        This Week
      </Text>
      <View className="flex-row items-end gap-1">
        {dayData.map(({ label, iso, session }) => {
          const isToday = iso === new Date().toISOString().slice(0, 10)
          const colour = session ? typeColour(session.type) : null

          return (
            <View key={label} className="flex-1 items-center" style={{ gap: 6 }}>
              <View
                style={{
                  width: '100%',
                  height: session ? 32 : 8,
                  borderRadius: 4,
                  backgroundColor: colour ? `${colour}40` : '#27272a',
                  borderWidth: colour ? 1 : 0,
                  borderColor: colour ? `${colour}60` : 'transparent',
                }}
              />
              <Text
                className="text-xs font-medium"
                style={{ color: isToday ? 'white' : '#52525b', fontSize: 9 }}
              >
                {label}
              </Text>
            </View>
          )
        })}
      </View>
      <Text className="text-zinc-600 text-xs mt-3">
        {recent.length} session{recent.length !== 1 ? 's' : ''} this week
      </Text>
    </View>
  )
}

// ─── Training Screen ──────────────────────────────────────────────────────────

export default function TrainingScreen() {
  const { user } = useRequireAuth()
  const [showLog, setShowLog] = useState(false)
  const qc = useQueryClient()

  const { data: history = [], isLoading, refetch, isRefetching } = useQuery<TrainingLog[]>({
    queryKey: ['training-history'],
    queryFn: () => api.get('/training/history?limit=30').then(r => r.data),
    enabled: !!user,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/training/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['training-history'] }),
  })

  // Group by date
  const grouped: Record<string, TrainingLog[]> = {}
  for (const log of history) {
    if (!grouped[log.date]) grouped[log.date] = []
    grouped[log.date].push(log)
  }
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor="#ffffff"
          />
        }
      >
        {/* Header */}
        <View className="pt-6 pb-5 flex-row items-end justify-between">
          <View>
            <Text className="text-zinc-500 text-xs uppercase tracking-widest">{today}</Text>
            <Text className="text-white text-2xl font-bold mt-1">Training</Text>
          </View>
          <PressableScale
            haptic
            onPress={() => setShowLog(true)}
            className="bg-white px-4 py-2 rounded-2xl"
          >
            <Text className="text-black text-sm font-semibold">+ Log</Text>
          </PressableScale>
        </View>

        {isLoading ? (
          <View style={{ gap: 12, marginTop: 4 }}>
            <SkeletonCard height={88} />
            <SkeletonCard height={64} />
            <SkeletonCard height={64} />
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <WeeklyBar logs={history} />

            <Text className="text-zinc-500 text-xs uppercase tracking-widest">
              History
            </Text>

            {history.length === 0 ? (
              <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 items-center">
                <Text className="text-zinc-400 text-sm font-medium">
                  No sessions logged yet
                </Text>
                <Text className="text-zinc-600 text-xs mt-1 mb-4">
                  Start tracking your training
                </Text>
                <TouchableOpacity
                  onPress={() => setShowLog(true)}
                  className="bg-zinc-800 px-4 py-2 rounded-2xl"
                >
                  <Text className="text-white text-sm font-medium">
                    Log your first session →
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                {sortedDates.map(date => (
                  grouped[date].map((log, i) => {
                    const isLast =
                      date === sortedDates[sortedDates.length - 1] &&
                      i === grouped[date].length - 1
                    return (
                      <SwipeableRow
                        key={log.id}
                        onDelete={() => deleteMutation.mutate(log.id)}
                      >
                        <SessionCard log={log} isLast={isLast} />
                      </SwipeableRow>
                    )
                  })
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {showLog && <LogModal onClose={() => setShowLog(false)} />}
    </SafeAreaView>
  )
}