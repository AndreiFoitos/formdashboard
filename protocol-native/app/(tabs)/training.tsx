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
import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import Svg, { Polyline, Circle, Line as SvgLine } from 'react-native-svg'
import { api } from '../../api/client'
import { useRequireAuth } from '../../hooks/useRequireAuth'
import { SkeletonCard } from '../../components/Skeleton'
import { PressableScale } from '../../components/PressableScale'
import { hapticSuccess, hapticSelection, hapticLight } from '../../lib/haptics'

// ─── Exercise catalogue ───────────────────────────────────────────────────────

type Exercise = { key: string; name: string }
type Group = { name: string; colour: string; exercises: Exercise[] }

const GROUPS: Group[] = [
  {
    name: 'Chest',
    colour: '#f87171',
    exercises: [
      { key: 'bench_press',     name: 'Bench Press' },
      { key: 'incline_bench',   name: 'Incline Bench' },
      { key: 'dumbbell_press',  name: 'Dumbbell Press' },
      { key: 'chest_fly',       name: 'Chest Fly' },
      { key: 'push_up',         name: 'Push-up' },
    ],
  },
  {
    name: 'Back',
    colour: '#34d399',
    exercises: [
      { key: 'deadlift',       name: 'Deadlift' },
      { key: 'barbell_row',    name: 'Barbell Row' },
      { key: 'pull_up',        name: 'Pull-up' },
      { key: 'lat_pulldown',   name: 'Lat Pulldown' },
      { key: 'cable_row',      name: 'Cable Row' },
    ],
  },
  {
    name: 'Legs',
    colour: '#f472b6',
    exercises: [
      { key: 'squat',           name: 'Squat' },
      { key: 'front_squat',     name: 'Front Squat' },
      { key: 'leg_press',       name: 'Leg Press' },
      { key: 'romanian_dl',     name: 'Romanian Deadlift' },
      { key: 'leg_curl',        name: 'Leg Curl' },
      { key: 'leg_extension',   name: 'Leg Extension' },
      { key: 'calf_raise',      name: 'Calf Raise' },
    ],
  },
  {
    name: 'Shoulders',
    colour: '#60a5fa',
    exercises: [
      { key: 'overhead_press', name: 'Overhead Press' },
      { key: 'lateral_raise',  name: 'Lateral Raise' },
      { key: 'rear_delt_fly',  name: 'Rear Delt Fly' },
      { key: 'face_pull',      name: 'Face Pull' },
    ],
  },
  {
    name: 'Arms',
    colour: '#a78bfa',
    exercises: [
      { key: 'bicep_curl',      name: 'Bicep Curl' },
      { key: 'hammer_curl',     name: 'Hammer Curl' },
      { key: 'tricep_extension',name: 'Tricep Extension' },
      { key: 'tricep_pushdown', name: 'Tricep Pushdown' },
      { key: 'tricep_dip',      name: 'Tricep Dip' },
    ],
  },
  {
    name: 'Core',
    colour: '#facc15',
    exercises: [
      { key: 'plank',             name: 'Plank' },
      { key: 'cable_crunch',      name: 'Cable Crunch' },
      { key: 'hanging_leg_raise', name: 'Hanging Leg Raise' },
    ],
  },
]

const ALL_EXERCISES: Exercise[] = GROUPS.flatMap(g => g.exercises)
const EXERCISE_NAME: Record<string, string> = Object.fromEntries(
  ALL_EXERCISES.map(e => [e.key, e.name]),
)

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrainingLog {
  id: string
  date: string
  type: string
  duration_min: number | null
  intensity: number | null
  volume_sets: number | null
  weight_kg: number | null
  reps: number | null
  notes: string | null
  logged_at: string
}

interface VolumeWeek {
  week_start: string
  week_end: string
  total_volume_kg: number
  days: { date: string; volume_kg: number }[]
}

interface ExerciseProgress {
  exercise: string
  progression: {
    date: string
    top_weight_kg: number | null
    top_reps: number | null
    total_volume_kg: number
    sets: number
  }[]
  logs: TrainingLog[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

// ─── Volume chart ─────────────────────────────────────────────────────────────

function VolumeChart({ data }: { data: VolumeWeek | undefined }) {
  const days = data?.days ?? []
  const total = data?.total_volume_kg ?? 0
  const max = Math.max(1, ...days.map(d => d.volume_kg))
  const today = todayISO()

  return (
    <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <View className="flex-row items-end justify-between mb-4">
        <View>
          <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-1">
            This Week
          </Text>
          <View className="flex-row items-baseline gap-1.5">
            <Text className="text-white text-2xl font-bold">
              {total.toLocaleString()}
            </Text>
            <Text className="text-zinc-500 text-sm">kg moved</Text>
          </View>
        </View>
      </View>

      <View className="flex-row items-end gap-1.5" style={{ height: 80 }}>
        {days.map((d, i) => {
          const h = Math.max(4, (d.volume_kg / max) * 72)
          const isToday = d.date === today
          const hasVol = d.volume_kg > 0
          return (
            <View key={d.date} className="flex-1 items-center" style={{ gap: 6 }}>
              <View
                style={{
                  width: '100%',
                  height: h,
                  borderRadius: 4,
                  backgroundColor: hasVol ? '#ffffff' : '#27272a',
                  opacity: hasVol ? (isToday ? 1 : 0.7) : 1,
                }}
              />
              <Text
                style={{
                  color: isToday ? 'white' : '#52525b',
                  fontSize: 9,
                  fontWeight: '500',
                }}
              >
                {DAY_LABELS[i]}
              </Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}

// ─── PR progression chart ────────────────────────────────────────────────────

function PRChart({
  data,
  exerciseKey,
  onPickExercise,
}: {
  data: ExerciseProgress | undefined
  exerciseKey: string
  onPickExercise: () => void
}) {
  const points = data?.progression.filter(p => p.top_weight_kg != null) ?? []
  const last = points[points.length - 1]
  const pr = points.reduce<typeof points[0] | null>(
    (best, p) => (best == null || (p.top_weight_kg! > (best.top_weight_kg ?? 0)) ? p : best),
    null,
  )

  const W = 300
  const H = 80
  const padX = 8
  const padY = 8

  const chart = useMemo(() => {
    if (points.length < 2) return null
    const weights = points.map(p => p.top_weight_kg!)
    const minW = Math.min(...weights)
    const maxW = Math.max(...weights)
    const range = Math.max(1, maxW - minW)
    const stepX = (W - padX * 2) / (points.length - 1)
    return points.map((p, i) => ({
      x: padX + i * stepX,
      y: padY + (1 - (p.top_weight_kg! - minW) / range) * (H - padY * 2),
      w: p.top_weight_kg!,
    }))
  }, [points])

  return (
    <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-zinc-500 text-xs uppercase tracking-widest">
          PR Progression
        </Text>
        <TouchableOpacity
          onPress={onPickExercise}
          className="flex-row items-center gap-1 px-3 py-1 rounded-full border border-zinc-700"
        >
          <Text className="text-white text-xs font-medium">
            {EXERCISE_NAME[exerciseKey] ?? exerciseKey}
          </Text>
          <Text className="text-zinc-500 text-xs">▾</Text>
        </TouchableOpacity>
      </View>

      {chart ? (
        <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <SvgLine x1={padX} x2={W - padX} y1={H - padY} y2={H - padY} stroke="#27272a" strokeWidth={1} />
          <Polyline
            points={chart.map(c => `${c.x},${c.y}`).join(' ')}
            fill="none"
            stroke="#ffffff"
            strokeWidth={1.5}
          />
          {chart.map((c, i) => (
            <Circle key={i} cx={c.x} cy={c.y} r={2.5} fill="#ffffff" />
          ))}
        </Svg>
      ) : (
        <View style={{ height: H }} className="items-center justify-center">
          <Text className="text-zinc-600 text-xs">
            {points.length === 1 ? 'Log one more session to see progression' : 'No data yet'}
          </Text>
        </View>
      )}

      <View className="flex-row gap-4 mt-3">
        {pr && (
          <View>
            <Text className="text-zinc-500 text-xs">PR</Text>
            <Text className="text-white text-sm font-semibold">
              {pr.top_weight_kg}kg × {pr.top_reps}
            </Text>
          </View>
        )}
        {last && (
          <View>
            <Text className="text-zinc-500 text-xs">Last</Text>
            <Text className="text-white text-sm font-semibold">
              {last.top_weight_kg}kg × {last.top_reps}
            </Text>
          </View>
        )}
      </View>
    </View>
  )
}

// ─── Exercise picker modal ───────────────────────────────────────────────────

function ExercisePickerModal({
  onPick,
  onClose,
}: {
  onPick: (key: string) => void
  onClose: () => void
}) {
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-zinc-950">
        <View className="items-center pt-3 pb-2">
          <View className="w-10 h-1 bg-zinc-700 rounded-full" />
        </View>
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-zinc-800">
          <Text className="text-white font-semibold">Pick exercise</Text>
          <TouchableOpacity onPress={onClose}>
            <Text className="text-zinc-400 text-sm">✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView className="flex-1 px-4 pt-4" contentContainerStyle={{ paddingBottom: 24 }}>
          {GROUPS.map(g => (
            <View key={g.name} className="mb-4">
              <View className="flex-row items-center gap-2 mb-2">
                <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: g.colour }} />
                <Text className="text-zinc-500 text-xs uppercase tracking-widest">{g.name}</Text>
              </View>
              <View style={{ gap: 6 }}>
                {g.exercises.map(e => (
                  <TouchableOpacity
                    key={e.key}
                    onPress={() => { hapticSelection(); onPick(e.key) }}
                    className="px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-800"
                  >
                    <Text className="text-white text-sm">{e.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  )
}

// ─── Log modal ────────────────────────────────────────────────────────────────

type SetRow = { reps: string; weight: string }

function LogExerciseModal({
  exerciseKey,
  onClose,
}: {
  exerciseKey: string
  onClose: () => void
}) {
  const qc = useQueryClient()

  // Pull recent logs for this exercise so we can show "last session" and prefill.
  const { data: history } = useQuery<ExerciseProgress>({
    queryKey: ['exercise-history', exerciseKey],
    queryFn: () => api.get(`/training/by-exercise/${exerciseKey}?days=30`).then(r => r.data),
  })

  const lastSession = useMemo(() => {
    if (!history?.logs?.length) return null
    const lastDate = history.logs[history.logs.length - 1].date
    return history.logs.filter(l => l.date === lastDate)
  }, [history])

  const lastWeight = lastSession?.[0]?.weight_kg ?? null
  const lastReps   = lastSession?.[0]?.reps ?? null

  const [sets, setSets] = useState<SetRow[]>([
    { reps: lastReps != null ? String(lastReps) : '', weight: lastWeight != null ? String(lastWeight) : '' },
  ])
  const [notes, setNotes] = useState('')

  const { mutate, isPending } = useMutation({
    mutationFn: (body: object) => api.post('/training/log-exercise', body),
    onSuccess: () => {
      hapticSuccess()
      qc.invalidateQueries({ queryKey: ['training-volume'] })
      qc.invalidateQueries({ queryKey: ['exercise-history'] })
      qc.invalidateQueries({ queryKey: ['training-history'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      onClose()
    },
  })

  function updateSet(i: number, field: 'reps' | 'weight', value: string) {
    setSets(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  }

  function addSet() {
    hapticLight()
    setSets(prev => [...prev, { reps: prev[prev.length - 1]?.reps ?? '', weight: prev[prev.length - 1]?.weight ?? '' }])
  }

  function removeSet(i: number) {
    if (sets.length === 1) return
    setSets(prev => prev.filter((_, idx) => idx !== i))
  }

  function handleSave() {
    const cleanSets = sets
      .map(s => ({
        weight_kg: s.weight ? parseFloat(s.weight) : null,
        reps:      s.reps   ? parseInt(s.reps)     : null,
      }))
      .filter(s => s.weight_kg != null || s.reps != null)

    if (cleanSets.length === 0) return

    mutate({
      type: exerciseKey,
      sets: cleanSets,
      notes: notes.trim() || null,
    })
  }

  const hasValidSet = sets.some(s => s.reps || s.weight)

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-zinc-950">
        <View className="items-center pt-3 pb-2">
          <View className="w-10 h-1 bg-zinc-700 rounded-full" />
        </View>

        <View className="flex-row items-center justify-between px-4 py-3 border-b border-zinc-800">
          <Text className="text-white font-semibold">
            {EXERCISE_NAME[exerciseKey] ?? exerciseKey}
          </Text>
          <TouchableOpacity onPress={onClose}>
            <Text className="text-zinc-400 text-sm">✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView className="flex-1 px-4 pt-4" keyboardShouldPersistTaps="handled">
          {/* Last session reference */}
          {lastSession && lastSession.length > 0 && (
            <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3 mb-4">
              <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-1.5">
                Last session
              </Text>
              <Text className="text-zinc-300 text-sm">
                {lastSession.map((s, i) =>
                  `${s.weight_kg ?? '–'}kg × ${s.reps ?? '–'}`
                ).join('  ·  ')}
              </Text>
            </View>
          )}

          {/* Sets */}
          <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">Sets</Text>

          <View style={{ gap: 8 }}>
            {sets.map((s, i) => (
              <View key={i} className="flex-row items-center gap-2">
                <Text className="text-zinc-500 text-xs w-8">#{i + 1}</Text>
                <TextInput
                  value={s.reps}
                  onChangeText={v => updateSet(i, 'reps', v)}
                  placeholder="reps"
                  placeholderTextColor="#52525b"
                  keyboardType="number-pad"
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-3 text-white text-sm"
                />
                <Text className="text-zinc-600 text-xs">×</Text>
                <TextInput
                  value={s.weight}
                  onChangeText={v => updateSet(i, 'weight', v)}
                  placeholder="kg"
                  placeholderTextColor="#52525b"
                  keyboardType="decimal-pad"
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-3 text-white text-sm"
                />
                {sets.length > 1 && (
                  <TouchableOpacity
                    onPress={() => removeSet(i)}
                    hitSlop={8}
                    className="px-2"
                  >
                    <Text className="text-zinc-600 text-base">−</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>

          <TouchableOpacity
            onPress={addSet}
            className="mt-3 py-3 rounded-xl border border-dashed border-zinc-700 items-center"
          >
            <Text className="text-zinc-400 text-sm">+ Add set</Text>
          </TouchableOpacity>

          {/* Notes */}
          <View className="mt-5">
            <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-1.5">
              Notes <Text className="text-zinc-700 normal-case">(optional)</Text>
            </Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Felt heavy, paused on chest…"
              placeholderTextColor="#52525b"
              multiline
              className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-white text-sm"
              style={{ minHeight: 70, textAlignVertical: 'top' }}
            />
          </View>

          <TouchableOpacity
            onPress={handleSave}
            disabled={!hasValidSet || isPending}
            className="bg-white rounded-2xl py-4 items-center mt-5 mb-10"
            style={{ opacity: !hasValidSet || isPending ? 0.4 : 1 }}
          >
            {isPending ? (
              <ActivityIndicator color="black" />
            ) : (
              <Text className="text-black font-semibold text-base">Save</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  )
}

// ─── Exercise row ─────────────────────────────────────────────────────────────

function ExerciseRow({
  exercise,
  pr,
  onPress,
  isLast,
}: {
  exercise: Exercise
  pr: { weight_kg: number; reps: number } | null
  onPress: () => void
  isLast: boolean
}) {
  return (
    <PressableScale
      haptic
      onPress={onPress}
      style={{
        backgroundColor: '#18181b',
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: '#27272a',
      }}
    >
      <View className="flex-row items-center justify-between px-4 py-4">
        <Text className="text-white text-sm font-medium">{exercise.name}</Text>
        {pr ? (
          <Text className="text-zinc-500 text-xs">
            {pr.weight_kg}kg × {pr.reps}
          </Text>
        ) : (
          <Text className="text-zinc-700 text-xs">—</Text>
        )}
      </View>
    </PressableScale>
  )
}

// ─── Training screen ──────────────────────────────────────────────────────────

export default function TrainingScreen() {
  const { user } = useRequireAuth()

  const [selectedExercise, setSelectedExercise] = useState('bench_press')
  const [logExercise, setLogExercise] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)

  const volumeQ = useQuery<VolumeWeek>({
    queryKey: ['training-volume'],
    queryFn: () => api.get('/training/volume-weekly').then(r => r.data),
    enabled: !!user,
  })

  const prQ = useQuery<ExerciseProgress>({
    queryKey: ['exercise-history', selectedExercise],
    queryFn: () => api.get(`/training/by-exercise/${selectedExercise}?days=90`).then(r => r.data),
    enabled: !!user,
  })

  // For PR badges on each row — pull history once and compute per-exercise max.
  const allHistoryQ = useQuery<TrainingLog[]>({
    queryKey: ['training-history'],
    queryFn: () => api.get('/training/history?limit=500').then(r => r.data),
    enabled: !!user,
  })

  // Tiny query to light up the badge dot on the Friends pill when invites are waiting.
  const friendsQ = useQuery<{ pending_in: unknown[] }>({
    queryKey: ['friends-list'],
    queryFn: () => api.get('/friends').then(r => r.data),
    enabled: !!user,
    staleTime: 30 * 1000,
  })
  const pendingInvites = friendsQ.data?.pending_in?.length ?? 0

  const prByExercise = useMemo(() => {
    const map: Record<string, { weight_kg: number; reps: number }> = {}
    for (const log of allHistoryQ.data ?? []) {
      if (log.weight_kg == null || log.reps == null) continue
      const existing = map[log.type]
      if (!existing || log.weight_kg > existing.weight_kg) {
        map[log.type] = { weight_kg: log.weight_kg, reps: log.reps }
      }
    }
    return map
  }, [allHistoryQ.data])

  const isLoading = volumeQ.isLoading || allHistoryQ.isLoading
  const isRefetching = volumeQ.isRefetching || prQ.isRefetching || allHistoryQ.isRefetching

  function refetchAll() {
    volumeQ.refetch()
    prQ.refetch()
    allHistoryQ.refetch()
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetchAll} tintColor="#ffffff" />
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
            onPress={() => router.push('/friends')}
            className="bg-zinc-900 border border-zinc-800 px-3 py-2 rounded-2xl"
          >
            <View className="flex-row items-center gap-1.5">
              <Text className="text-white text-xs font-semibold">Friends</Text>
              {pendingInvites > 0 && (
                <View
                  style={{
                    minWidth: 16,
                    height: 16,
                    paddingHorizontal: 4,
                    borderRadius: 8,
                    backgroundColor: '#ef4444',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: 'white', fontSize: 10, fontWeight: '700' }}>
                    {pendingInvites}
                  </Text>
                </View>
              )}
            </View>
          </PressableScale>
        </View>

        {isLoading ? (
          <View style={{ gap: 12 }}>
            <SkeletonCard height={140} />
            <SkeletonCard height={160} />
            <SkeletonCard height={240} />
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <VolumeChart data={volumeQ.data} />

            <PRChart
              data={prQ.data}
              exerciseKey={selectedExercise}
              onPickExercise={() => setShowPicker(true)}
            />

            {/* Exercise list grouped by muscle */}
            {GROUPS.map(g => (
              <View key={g.name}>
                <View className="flex-row items-center gap-2 mt-2 mb-2">
                  <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: g.colour }} />
                  <Text className="text-zinc-500 text-xs uppercase tracking-widest">{g.name}</Text>
                </View>
                <View className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                  {g.exercises.map((e, i) => (
                    <ExerciseRow
                      key={e.key}
                      exercise={e}
                      pr={prByExercise[e.key] ?? null}
                      onPress={() => setLogExercise(e.key)}
                      isLast={i === g.exercises.length - 1}
                    />
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {showPicker && (
        <ExercisePickerModal
          onPick={(key) => { setSelectedExercise(key); setShowPicker(false) }}
          onClose={() => setShowPicker(false)}
        />
      )}

      {logExercise && (
        <LogExerciseModal
          exerciseKey={logExercise}
          onClose={() => setLogExercise(null)}
        />
      )}
    </SafeAreaView>
  )
}
