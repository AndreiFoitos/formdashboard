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
import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import Svg, { Polyline, Circle, Line as SvgLine } from 'react-native-svg'
import { Award, Trophy, X } from 'lucide-react-native'
import { api } from '../../api/client'
import { useExerciseName } from '../../hooks/useExerciseName'
import { useRequireAuth } from '../../hooks/useRequireAuth'
import { SkeletonCard } from '../../components/Skeleton'
import { openPaywall } from '../../hooks/usePlan'
import { PressableScale } from '../../components/PressableScale'
import { hapticSuccess, hapticSelection, hapticLight } from '../../lib/haptics'
import { TrustedShield } from '../../components/icons/TrustedShield'
import { SusFace } from '../../components/icons/SusFace'
import { ALL_EXERCISES, EXERCISE_NAME, GROUPS, type Exercise, type Group } from '../../lib/exercises'
import {
  KIND_COLOUR,
  KIND_LABEL,
  PROGRESSION_KEY,
  targetHeadline,
  useProgression,
  useProgressionOverview,
  type ExerciseProgression,
} from '../../hooks/useProgression'
import { UndoToast } from '../../components/UndoToast'
import { showUndo } from '../../store/undo'
import { colors } from '../../theme/tokens'

// ─── Exercise catalogue ───────────────────────────────────────────────────────

// Inverted index for fast 'what muscle group is this key?' lookups. Built
// once at module load; custom exercise keys fall through to the runtime
// CustomExercise list (passed into groupForKey below).
const HARDCODED_KEY_TO_GROUP: Record<string, string> = Object.fromEntries(
  GROUPS.flatMap(g => g.exercises.map(e => [e.key, g.name])),
)

const WEEKDAY_LABEL_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

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
  /** Days actually covered after the plan's history window was applied. */
  window_days: number
  /** True when the plan cut the requested range short. */
  clamped: boolean
}

type RangeDays = 7 | 30 | 90 | 365

interface SessionExercise {
  type: string
  sets: number
  top_weight_kg: number | null
  top_reps: number | null
}

interface TrainingSession {
  date: string
  exercises: SessionExercise[]
  exercise_count: number
  set_count: number
  volume_kg: number
  top_lift: { type: string; weight_kg: number; reps: number } | null
  duration_min: number | null
}

interface SessionsResponse {
  sessions: TrainingSession[]
  window_days: number
  clamped: boolean
  has_more: boolean
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
    <View className="bg-surface border border-divider rounded-xl p-4" style={{ borderCurve: 'continuous' }}>
      <View className="flex-row items-end justify-between mb-4">
        <View>
          <Text className="text-text-muted text-caption mb-2 font-semibold">
            This week
          </Text>
          <View className="flex-row items-baseline gap-2">
            <Text className="text-text text-hero">
              {total.toLocaleString()}
            </Text>
            <Text className="text-text-muted text-body">kg moved</Text>
          </View>
        </View>
      </View>

      <View className="flex-row items-end gap-2" style={{ height: 96 }}>
        {days.map((d, i) => {
          const h = Math.max(4, (d.volume_kg / max) * 72)
          const isToday = d.date === today
          const hasVol = d.volume_kg > 0
          return (
            <View key={d.date} className="flex-1 items-center gap-2">
              <View
                style={{
                  width: '100%',
                  height: h,
                  borderRadius: 4,
                  borderCurve: 'continuous',
                  backgroundColor: hasVol ? colors.data.volume : colors['surface-raised'],
                  opacity: hasVol ? (isToday ? 1 : 0.7) : 1,
                }}
              />
              <Text
                className="text-caption"
                style={{ color: isToday ? colors.text : colors['text-subtle'] }}
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
  const displayName = useExerciseName(EXERCISE_NAME)
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
    <View className="bg-surface border border-divider rounded-xl p-4" style={{ borderCurve: 'continuous' }}>
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-text-subtle text-caption">
          PR progression
        </Text>
        <TouchableOpacity
          onPress={onPickExercise}
          className="flex-row items-center gap-1 px-3 py-1 rounded-full border border-border" style={{ borderCurve: 'continuous' }}
        >
          <Text className="text-text text-caption font-medium">
            {displayName(exerciseKey)}
          </Text>
          <Text className="text-text-subtle text-caption">▾</Text>
        </TouchableOpacity>
      </View>

      {chart ? (
        <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <SvgLine x1={padX} x2={W - padX} y1={H - padY} y2={H - padY} stroke={colors.divider} strokeWidth={1} />
          <Polyline
            points={chart.map(c => `${c.x},${c.y}`).join(' ')}
            fill="none"
            stroke={colors.text}
            strokeWidth={1.5}
          />
          {chart.map((c, i) => (
            <Circle key={i} cx={c.x} cy={c.y} r={2.5} fill={colors.text} />
          ))}
        </Svg>
      ) : (
        <View style={{ height: H }} className="items-center justify-center">
          <Text className="text-text-subtle text-caption">
            {points.length === 1 ? 'Log one more session to see progression' : 'No data yet'}
          </Text>
        </View>
      )}

      <View className="flex-row gap-4 mt-3">
        {pr && (
          <View>
            <Text className="text-text-subtle text-caption">PR</Text>
            <Text className="text-text text-footnote font-semibold">
              {pr.top_weight_kg}kg × {pr.top_reps}
            </Text>
          </View>
        )}
        {last && (
          <View>
            <Text className="text-text-subtle text-caption">Last</Text>
            <Text className="text-text text-footnote font-semibold">
              {last.top_weight_kg}kg × {last.top_reps}
            </Text>
          </View>
        )}
      </View>
    </View>
  )
}

// ─── Exercise picker modal ───────────────────────────────────────────────────

interface CustomExerciseRow {
  id: string
  key: string
  name: string
  group_name: string
  created_at: string
}

/** ↑ kg when an exercise is ready for more weight, Stalled when stuck. */
function ProgressBadge({
  info,
}: {
  info?: { ready_for_weight: boolean; stalled: boolean }
}) {
  if (!info || (!info.ready_for_weight && !info.stalled)) return null
  const colour = info.stalled ? colors.warning : colors.success
  return (
    <View className="rounded-full px-2 py-1" style={{ borderCurve: 'continuous', backgroundColor: `${colour}22` }}>
      <Text className="text-caption font-semibold" style={{ color: colour }}>
        {info.stalled ? 'Stalled' : '↑ kg'}
      </Text>
    </View>
  )
}

function ExercisePickerModal({
  onPick,
  onClose,
  filterGroup,
}: {
  onPick: (key: string) => void
  onClose: () => void
  /**
   * When set, the picker only shows exercises (hardcoded + custom) belonging
   * to this muscle group. Drives the tile-tap flow on the Training tab.
   */
  filterGroup?: string
}) {
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  // If we're filtering to one group, default the new-custom-exercise group
  // to that group so the user doesn't have to re-pick.
  const [newGroup, setNewGroup] = useState<string>(filterGroup ?? 'Chest')
  const { data: progress } = useProgressionOverview()

  const customQ = useQuery<CustomExerciseRow[]>({
    queryKey: ['custom-exercises'],
    queryFn: () => api.get('/training/custom-exercises').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  })

  const createMutation = useMutation({
    mutationFn: (body: { name: string; group_name: string }) =>
      api.post('/training/custom-exercises', body).then((r) => r.data),
    onSuccess: () => {
      hapticSuccess()
      qc.invalidateQueries({ queryKey: ['custom-exercises'] })
      setNewName('')
      setCreating(false)
    },
  })

  // Merge custom exercises into the right hardcoded group; anything tagged
  // 'Other' or unmatched gets its own section at the bottom.
  const customByGroup = useMemo(() => {
    const map: Record<string, CustomExerciseRow[]> = {}
    for (const c of customQ.data ?? []) {
      (map[c.group_name] ??= []).push(c)
    }
    return map
  }, [customQ.data])

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-surface">
        <View className="items-center pt-3 pb-2">
          <View className="w-10 h-1 bg-border rounded-full" style={{ borderCurve: 'continuous' }} />
        </View>
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-divider">
          <Text className="text-text font-semibold">
            {filterGroup ? `Pick ${filterGroup.toLowerCase()} exercise` : 'Pick exercise'}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={12}
            className="w-10 h-10 -mr-1 rounded-full bg-surface-raised border border-border items-center justify-center" style={{ borderCurve: 'continuous' }}
          >
            <X size={20} color={colors.text} strokeWidth={2.25} />
          </TouchableOpacity>
        </View>
        <ScrollView
          className="flex-1 px-4 pt-4"
          contentContainerClassName="pb-6"
          keyboardShouldPersistTaps="handled"
        >
          {/* Custom-exercise creation block. Stays at the top so it's
              discoverable; expands inline rather than launching another modal. */}
          {!creating ? (
            <TouchableOpacity
              onPress={() => setCreating(true)}
              className="rounded-xl border border-border bg-surface-raised px-4 py-3 mb-4" style={{ borderCurve: 'continuous' }}
            >
              <Text className="text-text text-footnote font-medium">+ New custom exercise</Text>
              <Text className="text-text-subtle text-caption mt-1">
                Add a movement we don't have in the catalogue.
              </Text>
            </TouchableOpacity>
          ) : (
            <View className="bg-surface-raised border border-border rounded-xl p-3 mb-4" style={{ borderCurve: 'continuous' }}>
              <TextInput
                value={newName}
                onChangeText={setNewName}
                placeholder="Exercise name"
                placeholderTextColor={colors['text-subtle']}
                maxLength={80}
                className="bg-surface-raised border border-border rounded-md px-3 py-3 text-text text-footnote mb-2" style={{ borderCurve: 'continuous' }}
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
                {GROUPS.map((g) => {
                  const active = newGroup === g.name
                  return (
                    <TouchableOpacity
                      key={g.name}
                      onPress={() => setNewGroup(g.name)}
                      className="px-3 py-2 rounded-full border"
                      style={{
                        borderCurve: 'continuous',
                        backgroundColor: active ? g.colour : colors.surface,
                        borderColor: active ? g.colour : colors.border,
                      }}
                    >
                      <Text
                        className="text-caption font-medium"
                        style={{ color: active ? colors.bg : colors['text-muted'] }}
                      >
                        {g.name}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
                {/* Other bucket as a non-coloured chip */}
                <TouchableOpacity
                  onPress={() => setNewGroup('Other')}
                  className="px-3 py-2 rounded-full border"
                  style={{
                    borderCurve: 'continuous',
                    backgroundColor: newGroup === 'Other' ? colors.text : colors.surface,
                    borderColor: newGroup === 'Other' ? colors.text : colors.border,
                  }}
                >
                  <Text
                    className="text-caption font-medium"
                    style={{ color: newGroup === 'Other' ? colors.bg : colors['text-muted'] }}
                  >
                    Other
                  </Text>
                </TouchableOpacity>
              </ScrollView>
              <View className="flex-row mt-3 gap-2">
                <TouchableOpacity
                  onPress={() => { setCreating(false); setNewName('') }}
                  className="flex-1 py-2 rounded-md bg-surface-raised border border-border items-center" style={{ borderCurve: 'continuous' }}
                >
                  <Text className="text-text-muted text-footnote">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    const trimmed = newName.trim()
                    if (!trimmed) return
                    createMutation.mutate({ name: trimmed, group_name: newGroup })
                  }}
                  disabled={!newName.trim() || createMutation.isPending}
                  className="flex-1 py-2 rounded-md bg-accent items-center"
                  style={{ borderCurve: 'continuous', opacity: !newName.trim() || createMutation.isPending ? 0.4 : 1 }}
                >
                  {createMutation.isPending ? (
                    <ActivityIndicator color={colors['on-accent']} />
                  ) : (
                    <Text className="text-on-accent text-footnote font-semibold">Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {GROUPS.filter((g) => !filterGroup || g.name === filterGroup).map((g) => {
            const customs = customByGroup[g.name] ?? []
            return (
              <View key={g.name} className="mb-4">
                {!filterGroup && (
                  <View className="flex-row items-center gap-2 mb-2">
                    <View className="w-1.5 h-1.5 rounded-full" style={{ borderCurve: 'continuous', backgroundColor: g.colour }} />
                    <Text className="text-text-subtle text-caption">{g.name}</Text>
                  </View>
                )}
                <View className="gap-2">
                  {g.exercises.map((e) => (
                    <TouchableOpacity
                      key={e.key}
                      onPress={() => { hapticSelection(); onPick(e.key) }}
                      className="px-4 py-3 rounded-xl bg-surface border border-divider flex-row items-center justify-between" style={{ borderCurve: 'continuous' }}
                    >
                      <Text className="text-text text-footnote">{e.name}</Text>
                      <ProgressBadge info={progress?.[e.key]} />
                    </TouchableOpacity>
                  ))}
                  {customs.map((c) => (
                    <TouchableOpacity
                      key={c.id}
                      onPress={() => { hapticSelection(); onPick(c.key) }}
                      className="px-4 py-3 rounded-xl bg-surface border border-divider flex-row items-center justify-between" style={{ borderCurve: 'continuous' }}
                    >
                      <Text className="text-text text-footnote">{c.name}</Text>
                      <View className="flex-row items-center gap-2">
                        <ProgressBadge info={progress?.[c.key]} />
                        <Text className="text-text-subtle text-caption">Custom</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )
          })}

          {/* 'Other' bucket only shows when we're not filtering — those exercises
              don't belong to any of the coloured groups. */}
          {!filterGroup && (customByGroup['Other']?.length ?? 0) > 0 && (
            <View className="mb-4">
              <View className="flex-row items-center gap-2 mb-2">
                <View className="w-1.5 h-1.5 rounded-full" style={{ borderCurve: 'continuous', backgroundColor: colors.muscle.other }} />
                <Text className="text-text-subtle text-caption">Other</Text>
              </View>
              <View className="gap-2">
                {customByGroup['Other'].map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    onPress={() => { hapticSelection(); onPick(c.key) }}
                    className="px-4 py-3 rounded-xl bg-surface border border-divider flex-row items-center justify-between" style={{ borderCurve: 'continuous' }}
                  >
                    <Text className="text-text text-footnote">{c.name}</Text>
                    <View className="flex-row items-center gap-2">
                      <ProgressBadge info={progress?.[c.key]} />
                      <Text className="text-text-subtle text-caption">Custom</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
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
  const displayName = useExerciseName(EXERCISE_NAME)

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
    {
      reps: lastReps != null ? String(lastReps) : '',
      weight: lastWeight != null ? String(lastWeight) : '',
    },
  ])
  const [notes, setNotes] = useState('')

  // Progressive overload target: pre-fill the sets with it. The old pre-fill
  // read history in useState's initialiser, before the query had loaded, so
  // the sheet usually opened empty; this waits for the data and stops once
  // the user edits anything.
  const progression = useProgression(exerciseKey)
  const target = progression.data?.target
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (touched) return
    if (target?.sets.length) {
      setSets(target.sets.map(t => ({
        reps: String(t.reps),
        weight: t.weight_kg != null ? String(t.weight_kg) : '',
      })))
    } else if (progression.isFetched && lastSession?.length) {
      setSets(lastSession.map(l => ({
        reps: l.reps != null ? String(l.reps) : '',
        weight: l.weight_kg != null ? String(l.weight_kg) : '',
      })))
    }
  }, [target, lastSession, progression.isFetched, touched])

  function invalidateTraining() {
    qc.invalidateQueries({ queryKey: ['training-volume'] })
    qc.invalidateQueries({ queryKey: ['exercise-history'] })
    qc.invalidateQueries({ queryKey: ['training-history'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    qc.invalidateQueries({ queryKey: PROGRESSION_KEY })
  }

  const { mutate, isPending } = useMutation({
    mutationFn: (body: object) => api.post('/training/log-exercise', body),
    onSuccess: async (res) => {
      hapticSuccess()
      invalidateTraining()
      onClose()
      // "Saved · Next time: 82.5 kg × 8", with Undo deleting what was just logged.
      const ids: string[] = (res.data ?? []).map((l: { id: string }) => l.id)
      let label = 'Saved'
      try {
        const { data } = await api.get<ExerciseProgression>(`/training/progression/${exerciseKey}`)
        const nxt = data.next ?? data.target
        if (nxt && nxt.kind !== 'first') {
          label = nxt.kind === 'stall'
            ? 'Saved · Stalled: next time add a set or go lighter'
            : `Saved · Next time: ${targetHeadline(nxt)}`
        }
      } catch {}
      showUndo({
        label,
        durationMs: 7000,
        onUndo: async () => {
          await Promise.all(ids.map(id => api.delete(`/training/${id}`).catch(() => {})))
          invalidateTraining()
        },
      })
    },
  })

  function updateSet(i: number, field: 'reps' | 'weight', value: string) {
    setTouched(true)
    setSets(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  }

  function addSet() {
    setTouched(true)
    hapticLight()
    setSets(prev => [...prev, {
      reps: prev[prev.length - 1]?.reps ?? '',
      weight: prev[prev.length - 1]?.weight ?? '',
    }])
  }

  function removeSet(i: number) {
    if (sets.length === 1) return
    setTouched(true)
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
      <View className="flex-1 bg-surface">
        <View className="items-center pt-3 pb-2">
          <View className="w-10 h-1 bg-border rounded-full" style={{ borderCurve: 'continuous' }} />
        </View>

        <View className="flex-row items-center justify-between px-4 py-3 border-b border-divider">
          <Text className="text-text font-semibold">
            {displayName(exerciseKey)}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={12}
            className="w-10 h-10 -mr-1 rounded-full bg-surface-raised border border-border items-center justify-center" style={{ borderCurve: 'continuous' }}
          >
            <X size={20} color={colors.text} strokeWidth={2.25} />
          </TouchableOpacity>
        </View>

        <ScrollView className="flex-1 px-4 pt-4" keyboardShouldPersistTaps="handled">
          {/* Progressive overload target */}
          {target && target.kind !== 'first' && (
            <View className="bg-surface-raised border border-border rounded-xl p-3 mb-3" style={{ borderCurve: 'continuous' }}>
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-text-subtle text-caption">Next target</Text>
                <View className="rounded-full px-2 py-1" style={{ borderCurve: 'continuous', backgroundColor: `${KIND_COLOUR[target.kind]}22` }}>
                  <Text className="text-caption font-semibold" style={{ color: KIND_COLOUR[target.kind] }}>
                    {KIND_LABEL[target.kind]}
                  </Text>
                </View>
              </View>
              <Text className="text-text text-headline font-bold">{targetHeadline(target)}</Text>
              <Text className="text-text-muted text-caption mt-1">{target.reason}</Text>
              <Text className="text-text-subtle text-caption mt-2">
                Rep range {target.range[0]}–{target.range[1]} · sets below are pre-filled, edit what you actually did
              </Text>
            </View>
          )}

          {/* Last session reference */}
          {lastSession && lastSession.length > 0 && (
            <View className="bg-surface-raised border border-border rounded-xl p-3 mb-4" style={{ borderCurve: 'continuous' }}>
              <Text className="text-text-subtle text-caption mb-2">
                Last session
              </Text>
              <Text className="text-text-muted text-footnote">
                {lastSession.map((s, i) =>
                  `${s.weight_kg ?? '–'}kg × ${s.reps ?? '–'}`
                ).join('  ·  ')}
              </Text>
            </View>
          )}

          {/* Sets */}
          <Text className="text-text-subtle text-caption mb-2">Sets</Text>

          <View className="gap-2">
            {sets.map((s, i) => (
              <View key={i} className="flex-row items-center gap-2">
                <Text className="text-text-subtle text-caption w-8">#{i + 1}</Text>
                <TextInput
                  value={s.reps}
                  onChangeText={v => updateSet(i, 'reps', v)}
                  placeholder="reps"
                  placeholderTextColor={colors['text-subtle']}
                  keyboardType="number-pad"
                  className="flex-1 bg-surface-raised border border-border rounded-md px-3 py-3 text-text text-footnote" style={{ borderCurve: 'continuous' }}
                />
                <Text className="text-text-subtle text-caption">×</Text>
                <TextInput
                  value={s.weight}
                  onChangeText={v => updateSet(i, 'weight', v)}
                  placeholder="kg"
                  placeholderTextColor={colors['text-subtle']}
                  keyboardType="decimal-pad"
                  className="flex-1 bg-surface-raised border border-border rounded-md px-3 py-3 text-text text-footnote" style={{ borderCurve: 'continuous' }}
                />
                {sets.length > 1 && (
                  <TouchableOpacity
                    onPress={() => removeSet(i)}
                    hitSlop={8}
                    className="px-2"
                  >
                    <Text className="text-text-subtle text-body">−</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>

          <TouchableOpacity
            onPress={addSet}
            className="mt-3 py-3 rounded-md border border-dashed border-border items-center" style={{ borderCurve: 'continuous' }}
          >
            <Text className="text-text-muted text-footnote">+ Add set</Text>
          </TouchableOpacity>

          {/* Notes */}
          <View className="mt-5">
            <Text className="text-text-subtle text-caption mb-2">
              Notes <Text className="text-text-subtle">(optional)</Text>
            </Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Felt heavy, paused on chest…"
              placeholderTextColor={colors['text-subtle']}
              multiline
              className="bg-surface-raised border border-border rounded-xl px-4 py-3 text-text text-footnote"
              style={{ borderCurve: 'continuous', minHeight: 70, textAlignVertical: 'top' }}
            />
          </View>

          <TouchableOpacity
            onPress={handleSave}
            disabled={!hasValidSet || isPending}
            className="bg-accent rounded-xl py-4 items-center mt-5 mb-12"
            style={{ borderCurve: 'continuous', opacity: !hasValidSet || isPending ? 0.4 : 1 }}
          >
            {isPending ? (
              <ActivityIndicator color={colors['on-accent']} />
            ) : (
              <Text className="text-on-accent font-semibold text-body">Save</Text>
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
        backgroundColor: colors.surface,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: colors.divider,
      }}
    >
      <View className="flex-row items-center justify-between px-4 py-4">
        <Text className="text-text text-footnote font-medium">{exercise.name}</Text>
        {pr ? (
          <Text className="text-text-subtle text-caption">
            {pr.weight_kg}kg × {pr.reps}
          </Text>
        ) : (
          <Text className="text-text-subtle text-caption">—</Text>
        )}
      </View>
    </PressableScale>
  )
}

// ─── Weekly Race card (always-on crew leaderboard) ──────────────────────────

interface RaceRow {
  user: { id: string; name: string; username: string | null }
  total_volume_kg: number
  dots_volume: number | null
  days_trained: number
  is_trusted: boolean
  is_sus: boolean
  is_me: boolean
  rank: number
}
interface LeaderboardPayload {
  week_start: string
  week_end: string
  rows: RaceRow[]
}

function WeeklyRaceCard() {
  const { data, isLoading } = useQuery<LeaderboardPayload>({
    queryKey: ['friends-leaderboard', null],
    queryFn: () => api.get('/friends/leaderboard').then((r) => r.data),
  })

  if (isLoading) return <SkeletonCard height={140} />

  const rows = data?.rows ?? []
  const meRow = rows.find((r) => r.is_me) ?? null
  // Empty / solo state — surface the social pull without the full UI.
  if (rows.length <= 1) {
    return (
      <View className="bg-surface border border-divider rounded-xl p-4" style={{ borderCurve: 'continuous' }}>
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-text-subtle text-caption">Weekly race</Text>
        </View>
        <Text className="text-text-muted text-footnote">
          {meRow ? `You've moved ${meRow.total_volume_kg.toLocaleString()} kg this week.` : 'No volume logged yet this week.'}
        </Text>
        <Text className="text-text-subtle text-caption mt-1">
          Add friends to race them on weekly weight moved.
        </Text>
        <TouchableOpacity
          onPress={() => router.push('/friends')}
          className="mt-3 self-start bg-surface-raised px-3 py-2 rounded-md" style={{ borderCurve: 'continuous' }}
        >
          <Text className="text-text text-caption font-medium">+ Invite friends</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // Show the top 3 always, then append "you" if you're not already in the top 3.
  const topThree = rows.slice(0, 3)
  const meBelowFold = meRow && !topThree.some((r) => r.is_me)
  const maxVol = Math.max(1, rows[0].total_volume_kg)

  return (
    <PressableScale
      haptic
      onPress={() => router.push('/friends')}
      className="bg-surface border border-divider rounded-xl p-4" style={{ borderCurve: 'continuous' }}
    >
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-text-subtle text-caption">Weekly race</Text>
        <Text className="text-text-subtle text-caption">
          Crew of {rows.length} · resets Sunday →
        </Text>
      </View>

      <View className="gap-2">
        {topThree.map((row) => (
          <RaceRowView key={row.user.id} row={row} maxVol={maxVol} />
        ))}
        {meBelowFold && meRow && (
          <>
            <View className="flex-row items-center my-1">
              <View className="flex-1 h-px bg-divider" />
              <Text className="text-text-subtle text-caption mx-2">···</Text>
              <View className="flex-1 h-px bg-divider" />
            </View>
            <RaceRowView row={meRow} maxVol={maxVol} />
          </>
        )}
      </View>
    </PressableScale>
  )
}

function RaceRowView({ row, maxVol }: { row: RaceRow; maxVol: number }) {
  const medal = row.rank === 1 ? { Icon: Trophy, color: colors.medal.gold }
              : row.rank === 2 ? { Icon: Award,  color: colors.medal.silver }
              : row.rank === 3 ? { Icon: Award,  color: colors.medal.bronze }
              : null
  const pct = (row.total_volume_kg / maxVol) * 100
  return (
    <View>
      <View className="flex-row items-center gap-2">
        <View className="w-6 items-center">
          {medal
            ? <medal.Icon size={14} color={medal.color} strokeWidth={2} />
            : <Text className="text-text-subtle text-caption">{row.rank}</Text>}
        </View>
        <View className="flex-row items-center flex-1 gap-2">
          <Text className="text-footnote flex-shrink" style={{ color: row.is_me ? colors.text : colors['text-muted'], fontWeight: row.is_me ? '700' : '500' }} numberOfLines={1}>
            {row.user.name}{row.is_me ? ' (you)' : ''}
          </Text>
          {row.is_trusted && <TrustedShield size={12} />}
          {row.is_sus && <SusFace size={12} />}
        </View>
        <View className="items-end" style={{ minWidth: 68 }}>
          <Text className="text-caption tabular-nums" style={{ color: row.is_me ? colors.text : colors['text-muted'], fontWeight: '600' }}>
            {row.total_volume_kg.toLocaleString()}
            <Text className="text-text-subtle text-caption font-normal"> kg</Text>
          </Text>
          <Text className="text-caption tabular-nums mt-1" style={{ color: row.is_me ? colors['text-muted'] : colors['text-subtle'] }}>
            {row.dots_volume != null ? row.dots_volume.toLocaleString() : '—'}
            <Text className="text-text-subtle text-caption"> DOTS</Text>
          </Text>
        </View>
      </View>
      <View
        className="mt-1 rounded-full overflow-hidden"
        style={{ borderCurve: 'continuous', height: 3, backgroundColor: colors['surface-raised'] }}
      >
        <View
          style={{
            width: `${pct}%`,
            height: '100%',
            backgroundColor: row.is_me ? colors.accent : colors['text-subtle'],
          }}
        />
      </View>
    </View>
  )
}

// ─── Training screen ──────────────────────────────────────────────────────────

// ─── Muscle-group tiles + split detection ───────────────────────────────────

interface UserSplitRow {
  weekday: number   // Mon=0..Sun=6
  group_name: string
  confidence: number
  sample_count: number
  updated_at: string
}

interface LastSessionForGroup {
  date: string
  exerciseName: string
  weightKg: number | null
  reps: number | null
}

function groupForKey(
  key: string,
  customMap: Record<string, string>,
): string | null {
  return HARDCODED_KEY_TO_GROUP[key] ?? customMap[key] ?? null
}

function nameForKey(
  key: string,
  customNames: Record<string, string>,
): string {
  return EXERCISE_NAME[key] ?? customNames[key] ?? key.replace(/_/g, ' ')
}

function daysAgo(iso: string): number {
  const d = new Date(iso)
  const today = new Date()
  // Strip time so 'logged 3 hours ago today' reads as 0 days, not negative.
  d.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)))
}

function MuscleGroupTile({
  group,
  last,
  isToday,
  onPress,
}: {
  group: Group
  last: LastSessionForGroup | null
  isToday: boolean
  onPress: () => void
}) {
  const daysSince = last ? daysAgo(last.date) : null

  return (
    <PressableScale
      haptic
      onPress={onPress}
      className="flex-1 bg-surface border border-divider rounded-xl p-4"
      style={{ borderCurve: 'continuous', minHeight: 96 }}
    >
      <View className="flex-row items-center mb-2 gap-2">
        <View className="w-2 h-2 rounded-full" style={{ borderCurve: 'continuous', backgroundColor: group.colour }} />
        <Text className="text-text text-footnote font-semibold">{group.name}</Text>
        {isToday && (
          <View
            className="ml-auto px-2 py-1 rounded-md"
            style={{ borderCurve: 'continuous', backgroundColor: `${group.colour}33` }}
          >
            <Text className="text-caption font-bold" style={{ color: group.colour }}>
              Today
            </Text>
          </View>
        )}
      </View>

      {last ? (
        <>
          <Text className="text-text-muted text-caption" numberOfLines={1}>
            {last.exerciseName}
          </Text>
          <Text className="text-text-subtle text-caption mt-1" numberOfLines={1}>
            {last.weightKg ?? '–'}kg × {last.reps ?? '–'}
          </Text>
          <Text className="text-text-subtle text-caption mt-1">
            {daysSince === 0 ? 'today' : `${daysSince}d ago`}
          </Text>
        </>
      ) : (
        <Text className="text-text-subtle text-caption mt-1">No sessions yet</Text>
      )}
      {/* Today's-split accent ring. An overlay rather than a thicker border so
          the content lines up with the other tiles. */}
      {isToday && (
        <View
          pointerEvents="none"
          className="absolute -inset-px border-2 border-accent rounded-xl"
          style={{ borderCurve: 'continuous' }}
        />
      )}
    </PressableScale>
  )
}

const WEEK_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** The whole detected week at a glance, so the split is findable on any day. */
function SplitWeekStrip({
  split,
  todayWeekday,
}: {
  split: UserSplitRow[]
  todayWeekday: number
}) {
  if (!split.length) return null
  const byDay = new Map(split.map(r => [r.weekday, r]))

  return (
    <View className="bg-surface border border-divider rounded-xl p-4" style={{ borderCurve: 'continuous' }}>
      <Text className="text-text-subtle text-caption mb-3">
        Your weekly split
      </Text>
      <View className="flex-row gap-1">
        {WEEK_SHORT.map((label, i) => {
          const row = byDay.get(i)
          const colour = row ? GROUPS.find(g => g.name === row.group_name)?.colour ?? colors['text-subtle'] : colors.divider
          const isToday = i === todayWeekday
          return (
            <View
              key={label}
              className="flex-1 items-center rounded-md py-2"
              style={{
                borderCurve: 'continuous',
                backgroundColor: row ? `${colour}1A` : colors.surface,
                borderWidth: 1,
                borderColor: isToday ? `${colors.text}55` : row ? `${colour}44` : colors.divider,
              }}
            >
              <Text className="text-caption font-semibold" style={{ color: isToday ? colors.text : colors['text-subtle'] }}>
                {label}
              </Text>
              <Text
                className="text-caption mt-1 text-center"
                numberOfLines={1}
                style={{ color: row ? colour : colors['text-subtle'] }}
              >
                {row ? row.group_name : 'Rest'}
              </Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}

function TodaysSplitBanner({
  todaysGroup,
  weekdayLabel,
}: {
  todaysGroup: { group_name: string; confidence: number } | null
  weekdayLabel: string
}) {
  // Previously this returned null whenever today had no detected group, so on
  // a rest day — or before detection had ever run — the split was invisible
  // with no hint it existed. The week strip below always renders once any
  // split is known.
  if (!todaysGroup) return null
  const match = GROUPS.find(g => g.name === todaysGroup.group_name)
  const colour = match?.colour ?? colors['text-muted']
  return (
    <View
      className="rounded-xl px-4 py-3 flex-row items-center"
      style={{
        borderCurve: 'continuous',
        backgroundColor: `${colour}1A`,
        borderWidth: 1,
        borderColor: `${colour}44`,
      }}
    >
      <View className="rounded-full mr-3" style={{ borderCurve: 'continuous', width: 10, height: 10, backgroundColor: colour }} />
      <View className="flex-1">
        <Text className="text-text text-footnote font-semibold">
          Today's usual: {todaysGroup.group_name}
        </Text>
        <Text className="text-text-subtle text-caption mt-1">
          {weekdayLabel} pattern · {Math.round(todaysGroup.confidence * 100)}% of recent {weekdayLabel}s
        </Text>
      </View>
    </View>
  )
}

// ─── 1RM card ────────────────────────────────────────────────────────────────

interface OneRMEstimate {
  exercise: string
  mean: number
  epley: number | null
  brzycki: number | null
  lombardi: number | null
  source: { weight_kg: number; reps: number; date: string; log_id: string }
}

function OneRMCard() {
  const { data, isLoading } = useQuery<{ estimates: OneRMEstimate[] }>({
    queryKey: ['one-rm'],
    queryFn: () => api.get('/training/one-rm?days=90').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  })

  const displayName = useExerciseName(EXERCISE_NAME)
  const top = (data?.estimates ?? []).slice(0, 5)

  return (
    <View className="bg-surface border border-divider rounded-xl p-4" style={{ borderCurve: 'continuous' }}>
      <View className="flex-row items-baseline justify-between mb-2">
        <Text className="text-text-subtle text-caption">
          Estimated 1RM
        </Text>
        <Text className="text-text-subtle text-caption">last 90 days</Text>
      </View>

      {/* The card used to show only numbers, with nothing saying what a 1RM
          is or where the figure came from. */}
      <TouchableOpacity onPress={() => router.push('/methodology/one-rm')} className="mb-3">
        <Text className="text-text-subtle text-caption">
          The heaviest single you could probably lift today, estimated from the
          sets you logged — no max-out needed.{' '}
          <Text className="text-text-muted font-medium">How? ›</Text>
        </Text>
      </TouchableOpacity>

      {isLoading ? (
        <ActivityIndicator color={colors['text-subtle']} />
      ) : top.length === 0 ? (
        <Text className="text-text-subtle text-caption">
          Log a few weighted sets to see your estimated max.
        </Text>
      ) : (
        <View className="gap-2">
          {top.map((row) => (
            <View
              key={row.exercise}
              className="flex-row items-center justify-between"
            >
              <View className="flex-1 pr-2">
                <Text className="text-text text-footnote" numberOfLines={1}>
                  {displayName(row.exercise)}
                </Text>
                <Text className="text-text-subtle text-caption mt-1">
                  from {row.source.weight_kg}kg × {row.source.reps}
                </Text>
              </View>
              <Text className="text-text text-footnote font-semibold">
                {row.mean}
                <Text className="text-text-subtle text-caption font-normal"> kg</Text>
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

// ─── Range picker ─────────────────────────────────────────────────────────────
//
// Drives both the per-exercise chart and the session list. Ranges past the
// plan's history window still render, but the server clamps them and says so —
// showing a shorter chart than the button promised, silently, is worse than a
// one-line explanation.

const RANGES: { days: RangeDays; label: string }[] = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 365, label: '1y' },
]

function RangePicker({
  value,
  onChange,
  clamped,
  windowDays,
}: {
  value: RangeDays
  onChange: (d: RangeDays) => void
  clamped?: boolean
  windowDays?: number
}) {
  return (
    <View>
      <View className="flex-row gap-2">
        {RANGES.map(r => {
          const active = r.days === value
          return (
            <TouchableOpacity
              key={r.days}
              onPress={() => onChange(r.days)}
              className="flex-1 py-2 rounded-full border items-center"
              style={{
                borderCurve: 'continuous',
                backgroundColor: active ? colors.text : colors.surface,
                borderColor: active ? colors.text : colors.border,
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text
                className="text-caption font-semibold"
                style={{ color: active ? colors.bg : colors['text-muted'] }}
              >
                {r.label}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>
      {clamped && windowDays != null && (
        <TouchableOpacity onPress={() => openPaywall()} className="mt-2">
          <Text className="text-text-subtle text-caption">
            Your plan stores {windowDays} days of history — showing that.{' '}
            <Text className="text-footnote font-semibold text-accent">Upgrade for more ›</Text>
          </Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

// ─── Session history ──────────────────────────────────────────────────────────

function sessionDateLabel(iso: string): string {
  const n = daysAgo(iso)
  if (n === 0) return 'Today'
  if (n === 1) return 'Yesterday'
  // Parse as local, not UTC: new Date('2026-09-18') is UTC midnight, which
  // renders as the previous day for anyone behind UTC.
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

function SessionRow({
  session,
  nameForKey,
}: {
  session: TrainingSession
  nameForKey: (key: string) => string
}) {
  const [open, setOpen] = useState(false)
  const summary = session.exercises
    .map(e => nameForKey(e.type))
    .slice(0, 3)
    .join(', ')
  const extra = session.exercise_count - Math.min(3, session.exercises.length)

  return (
    <View className="border-b border-divider">
      <TouchableOpacity
        onPress={() => setOpen(o => !o)}
        className="px-4 py-4"
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View className="flex-row items-center justify-between">
          <Text className="text-text text-footnote font-medium">
            {sessionDateLabel(session.date)}
          </Text>
          <Text className="text-text-subtle text-caption">
            {Math.round(session.volume_kg).toLocaleString()} kg {open ? '▾' : '▸'}
          </Text>
        </View>
        <Text className="text-text-subtle text-caption mt-1" numberOfLines={open ? undefined : 1}>
          {session.exercise_count} exercises · {session.set_count} sets
          {summary ? ` · ${summary}` : ''}
          {extra > 0 && !open ? ` +${extra}` : ''}
        </Text>
      </TouchableOpacity>

      {open && (
        <View className="px-4 pb-4 gap-2">
          {session.exercises.map(e => (
            <View key={e.type} className="flex-row items-center justify-between">
              <Text className="text-text-muted text-caption flex-1 pr-3" numberOfLines={1}>
                {nameForKey(e.type)}
              </Text>
              <Text className="text-text-subtle text-caption">
                {e.sets} {e.sets === 1 ? 'set' : 'sets'}
                {e.top_weight_kg != null
                  ? ` · top ${e.top_weight_kg}kg×${e.top_reps ?? '?'}`
                  : ''}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

function SessionHistory({
  data,
  isLoading,
  nameForKey,
}: {
  data: SessionsResponse | undefined
  isLoading: boolean
  nameForKey: (key: string) => string
}) {
  if (isLoading) return <SkeletonCard height={200} />

  const sessions = data?.sessions ?? []

  return (
    <View className="bg-surface border border-divider rounded-xl overflow-hidden" style={{ borderCurve: 'continuous' }}>
      <View className="px-4 pt-4 pb-2">
        <Text className="text-text-subtle text-caption">History</Text>
      </View>
      {sessions.length === 0 ? (
        <View className="px-4 pb-4">
          <Text className="text-text-subtle text-footnote">
            No sessions in this range. Log a lift and it'll show up here.
          </Text>
        </View>
      ) : (
        sessions.map(sess => (
          <SessionRow key={sess.date} session={sess} nameForKey={nameForKey} />
        ))
      )}
      {data?.has_more && (
        <View className="px-4 py-3">
          <Text className="text-text-subtle text-caption">
            Showing your most recent {sessions.length} sessions.
          </Text>
        </View>
      )}
    </View>
  )
}

export default function TrainingScreen() {
  const { user } = useRequireAuth()

  const [selectedExercise, setSelectedExercise] = useState('bench_press')
  // Chart range. The server clamps this to the plan's history window and
  // reports back when it had to, so the picker can say why.
  const [rangeDays, setRangeDays] = useState<RangeDays>(90)
  const [logExercise, setLogExercise] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  // When set, opens a group-filtered picker. Tapping a muscle-group tile
  // assigns this; picking an exercise out of it routes to LogExerciseModal.
  const [pickerForGroup, setPickerForGroup] = useState<string | null>(null)

  const volumeQ = useQuery<VolumeWeek>({
    queryKey: ['training-volume'],
    queryFn: () => api.get('/training/volume-weekly').then(r => r.data),
    enabled: !!user,
  })

  const prQ = useQuery<ExerciseProgress>({
    queryKey: ['exercise-history', selectedExercise, rangeDays],
    queryFn: () =>
      api.get(`/training/by-exercise/${selectedExercise}?days=${rangeDays}`).then(r => r.data),
    enabled: !!user,
  })

  // Training history, grouped into sessions, newest first.
  const sessionsQ = useQuery<SessionsResponse>({
    queryKey: ['training-sessions', rangeDays],
    queryFn: () => api.get(`/training/sessions?days=${rangeDays}&limit=30`).then(r => r.data),
    enabled: !!user,
  })

  // For PR badges on each row — pull history once and compute per-exercise max.
  const allHistoryQ = useQuery<TrainingLog[]>({
    queryKey: ['training-history'],
    queryFn: () => api.get('/training/history?limit=500').then(r => r.data),
    enabled: !!user,
  })

  // Auto-detected weekly split. Backend job updates this nightly; we just read.
  // Split detection runs nightly (03:45 UTC). Asking for a refresh when we
  // have nothing on file means a user with history sees their split right
  // away instead of waiting up to a day for the job — which is why this
  // feature looked missing entirely.
  const [splitRefreshed, setSplitRefreshed] = useState(false)
  const splitQ = useQuery<{ split: UserSplitRow[] }>({
    queryKey: ['training-split', splitRefreshed],
    queryFn: () =>
      api.get(`/training/split${splitRefreshed ? '?refresh=true' : ''}`).then(r => r.data),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    if (!splitRefreshed && splitQ.data && splitQ.data.split.length === 0) {
      setSplitRefreshed(true)
    }
  }, [splitQ.data, splitRefreshed])

  // Custom exercises — used to resolve custom_<uuid> keys to a muscle group
  // for the tile last-session lookup.
  const customExercisesQ = useQuery<{ exercises: { id: string; name: string; group_name: string }[] }>({
    queryKey: ['custom-exercises'],
    queryFn: () => api.get('/training/custom-exercises').then(r => r.data),
    enabled: !!user,
    staleTime: 60 * 1000,
  })

  // key → muscle group, key → display name, both unioned across hardcoded
  // + custom. Memoised so the tile pass stays O(N) in logs, not O(N×customs).
  const customKeyToGroup = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const ex of customExercisesQ.data?.exercises ?? []) {
      out[`custom_${ex.id}`] = ex.group_name
    }
    return out
  }, [customExercisesQ.data])

  const customKeyToName = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const ex of customExercisesQ.data?.exercises ?? []) {
      out[`custom_${ex.id}`] = ex.name
    }
    return out
  }, [customExercisesQ.data])

  // Most-recent training session per muscle group. allHistoryQ is already
  // sorted desc by date+logged_at, so first hit wins.
  const lastByGroup = useMemo<Record<string, LastSessionForGroup>>(() => {
    const out: Record<string, LastSessionForGroup> = {}
    for (const log of allHistoryQ.data ?? []) {
      const g = groupForKey(log.type, customKeyToGroup)
      if (!g || out[g]) continue
      out[g] = {
        date: log.date,
        exerciseName: nameForKey(log.type, customKeyToName),
        weightKg: log.weight_kg,
        reps: log.reps,
      }
    }
    return out
  }, [allHistoryQ.data, customKeyToGroup, customKeyToName])

  // Today's detected group, if any. Python's weekday() matches JS's
  // (getDay() + 6) % 7 — both end up Mon=0..Sun=6.
  const todayWeekday = (new Date().getDay() + 6) % 7
  const todaysSplit = useMemo(() => {
    return (splitQ.data?.split ?? []).find(s => s.weekday === todayWeekday) ?? null
  }, [splitQ.data, todayWeekday])

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
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-6"
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetchAll} tintColor={colors.text} />
        }
      >
        {/* Header */}
        <View className="pt-6 pb-5 flex-row items-end justify-between">
          <View>
            <Text className="text-text-muted text-caption font-semibold">{today}</Text>
            <Text className="text-text text-title font-bold mt-2">Training</Text>
          </View>
          <View className="flex-row gap-2">
            <PressableScale
              haptic
              onPress={() => router.push('/friends')}
              className="bg-surface border border-divider px-3 py-2 rounded-xl" style={{ borderCurve: 'continuous' }}
            >
              <View className="flex-row items-center gap-2">
                <Text className="text-text text-caption font-semibold">Friends</Text>
                {pendingInvites > 0 && (
                  <View
                    className="bg-danger px-1 rounded-full items-center justify-center"
                    style={{ borderCurve: 'continuous', minWidth: 16, height: 16 }}
                  >
                    <Text className="text-text text-caption font-bold">
                      {pendingInvites}
                    </Text>
                  </View>
                )}
              </View>
            </PressableScale>
          </View>
        </View>

        {isLoading ? (
          <View className="gap-3">
            <SkeletonCard height={140} />
            <SkeletonCard height={160} />
            <SkeletonCard height={240} />
          </View>
        ) : (
          <View className="gap-3">
            {/* Weekly race — the social hook for the tab. Sits above your
                personal volume so the comparison frames the rest. */}
            <WeeklyRaceCard />

            <VolumeChart data={volumeQ.data} />

            <RangePicker
              value={rangeDays}
              onChange={setRangeDays}
              clamped={prQ.data?.clamped || sessionsQ.data?.clamped}
              windowDays={prQ.data?.window_days ?? sessionsQ.data?.window_days}
            />

            <PRChart
              data={prQ.data}
              exerciseKey={selectedExercise}
              onPickExercise={() => setShowPicker(true)}
            />

            <OneRMCard />

            <SessionHistory
              data={sessionsQ.data}
              isLoading={sessionsQ.isLoading}
              nameForKey={(k) => nameForKey(k, customKeyToName)}
            />

            {/* Muscle-group tiles. Tap one to open a group-filtered picker;
                pick an exercise → opens LogExerciseModal. The detected split
                banner + per-tile Today chip drive the 'where do I lift today'
                signal that used to live nowhere on this screen. */}
            <View className="mt-2">
              <TodaysSplitBanner
                todaysGroup={todaysSplit}
                weekdayLabel={WEEKDAY_LABEL_FULL[todayWeekday]}
              />
              <View className={todaysSplit ? 'mt-3' : undefined}>
                <SplitWeekStrip
                  split={splitQ.data?.split ?? []}
                  todayWeekday={todayWeekday}
                />
              </View>
              <View className={todaysSplit ? 'mt-3 gap-3' : 'gap-3'}>
                {/* Render in pairs so each row is two tiles. */}
                {Array.from({ length: Math.ceil(GROUPS.length / 2) }, (_, rowIdx) => (
                  <View key={rowIdx} className="flex-row gap-3">
                    {GROUPS.slice(rowIdx * 2, rowIdx * 2 + 2).map(g => (
                      <MuscleGroupTile
                        key={g.name}
                        group={g}
                        last={lastByGroup[g.name] ?? null}
                        isToday={todaysSplit?.group_name === g.name}
                        onPress={() => setPickerForGroup(g.name)}
                      />
                    ))}
                    {/* Pad the final row to keep tile widths consistent when
                        GROUPS.length is odd. */}
                    {GROUPS.slice(rowIdx * 2, rowIdx * 2 + 2).length === 1 && (
                      <View style={{ flex: 1 }} />
                    )}
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {showPicker && (
        <ExercisePickerModal
          onPick={(key) => { setSelectedExercise(key); setShowPicker(false) }}
          onClose={() => setShowPicker(false)}
        />
      )}

      {pickerForGroup && (
        <ExercisePickerModal
          filterGroup={pickerForGroup}
          onPick={(key) => { setPickerForGroup(null); setLogExercise(key) }}
          onClose={() => setPickerForGroup(null)}
        />
      )}

      {logExercise && (
        <LogExerciseModal
          exerciseKey={logExercise}
          onClose={() => setLogExercise(null)}
        />
      )}
      <UndoToast />
    </SafeAreaView>
  )
}
