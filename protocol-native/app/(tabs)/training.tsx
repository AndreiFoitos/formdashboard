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
import { Award, Trophy, X } from 'lucide-react-native'
import { api } from '../../api/client'
import { useRequireAuth } from '../../hooks/useRequireAuth'
import { SkeletonCard } from '../../components/Skeleton'
import { PressableScale } from '../../components/PressableScale'
import { hapticSuccess, hapticSelection, hapticLight } from '../../lib/haptics'
import { TrustedShield } from '../../components/icons/TrustedShield'
import { SusFace } from '../../components/icons/SusFace'

// ─── Exercise catalogue ───────────────────────────────────────────────────────

type Exercise = { key: string; name: string }
type Group = { name: string; colour: string; exercises: Exercise[] }

const GROUPS: Group[] = [
  {
    name: 'Chest',
    colour: '#f87171',
    exercises: [
      { key: 'bench_press',           name: 'Bench Press' },
      { key: 'incline_bench',         name: 'Incline Bench' },
      { key: 'decline_bench',         name: 'Decline Bench' },
      { key: 'dumbbell_press',        name: 'Dumbbell Press' },
      { key: 'incline_db_press',      name: 'Incline DB Press' },
      { key: 'decline_db_press',      name: 'Decline DB Press' },
      { key: 'machine_chest_press',   name: 'Machine Chest Press' },
      { key: 'pec_deck',              name: 'Pec Deck' },
      { key: 'chest_fly',             name: 'Chest Fly' },
      { key: 'cable_fly',             name: 'Cable Fly' },
      { key: 'low_cable_fly',         name: 'Low Cable Fly' },
      { key: 'svend_press',           name: 'Svend Press' },
      { key: 'push_up',               name: 'Push-up' },
      { key: 'incline_push_up',       name: 'Incline Push-up' },
      { key: 'deficit_push_up',       name: 'Deficit Push-up' },
      { key: 'chest_dip',             name: 'Chest Dip' },
      { key: 'landmine_press',        name: 'Landmine Press' },
    ],
  },
  {
    name: 'Back',
    colour: '#34d399',
    exercises: [
      { key: 'deadlift',              name: 'Deadlift' },
      { key: 'sumo_deadlift',         name: 'Sumo Deadlift' },
      { key: 'trap_bar_deadlift',     name: 'Trap-bar Deadlift' },
      { key: 'rack_pull',             name: 'Rack Pull' },
      { key: 'barbell_row',           name: 'Barbell Row' },
      { key: 'pendlay_row',           name: 'Pendlay Row' },
      { key: 'seal_row',              name: 'Seal Row' },
      { key: 'tbar_row',              name: 'T-bar Row' },
      { key: 'one_arm_db_row',        name: 'One-arm DB Row' },
      { key: 'meadows_row',           name: 'Meadows Row' },
      { key: 'cable_row',             name: 'Cable Row' },
      { key: 'wide_cable_row',        name: 'Wide-grip Cable Row' },
      { key: 'pull_up',               name: 'Pull-up' },
      { key: 'chin_up',               name: 'Chin-up' },
      { key: 'weighted_pull_up',      name: 'Weighted Pull-up' },
      { key: 'lat_pulldown',          name: 'Lat Pulldown' },
      { key: 'neutral_grip_pulldown', name: 'Neutral-grip Pulldown' },
      { key: 'straight_arm_pulldown', name: 'Straight-arm Pulldown' },
      { key: 'shrug',                 name: 'Shrug' },
      { key: 'db_shrug',              name: 'DB Shrug' },
      { key: 'back_extension',        name: 'Back Extension' },
      { key: 'good_morning',          name: 'Good Morning' },
      { key: 'hip_thrust_back',       name: 'Hip Thrust (back-focus)' },
    ],
  },
  {
    name: 'Legs',
    colour: '#f472b6',
    exercises: [
      { key: 'squat',                 name: 'Back Squat' },
      { key: 'front_squat',           name: 'Front Squat' },
      { key: 'high_bar_squat',        name: 'High-bar Squat' },
      { key: 'low_bar_squat',         name: 'Low-bar Squat' },
      { key: 'box_squat',             name: 'Box Squat' },
      { key: 'pause_squat',           name: 'Pause Squat' },
      { key: 'goblet_squat',          name: 'Goblet Squat' },
      { key: 'bulgarian_split_squat', name: 'Bulgarian Split Squat' },
      { key: 'walking_lunge',         name: 'Walking Lunge' },
      { key: 'reverse_lunge',         name: 'Reverse Lunge' },
      { key: 'step_up',               name: 'Step-up' },
      { key: 'pistol_squat',          name: 'Pistol Squat' },
      { key: 'leg_press',             name: 'Leg Press' },
      { key: 'hack_squat',            name: 'Hack Squat' },
      { key: 'belt_squat',            name: 'Belt Squat' },
      { key: 'romanian_dl',           name: 'Romanian Deadlift' },
      { key: 'stiff_leg_dl',          name: 'Stiff-leg Deadlift' },
      { key: 'single_leg_rdl',        name: 'Single-leg RDL' },
      { key: 'leg_curl',              name: 'Lying Leg Curl' },
      { key: 'seated_leg_curl',       name: 'Seated Leg Curl' },
      { key: 'nordic_curl',           name: 'Nordic Curl' },
      { key: 'leg_extension',         name: 'Leg Extension' },
      { key: 'sissy_squat',           name: 'Sissy Squat' },
      { key: 'hip_thrust',            name: 'Hip Thrust' },
      { key: 'glute_bridge',          name: 'Glute Bridge' },
      { key: 'cable_kickback',        name: 'Cable Kickback' },
      { key: 'hip_abduction',         name: 'Hip Abduction' },
      { key: 'calf_raise',            name: 'Standing Calf Raise' },
      { key: 'seated_calf_raise',     name: 'Seated Calf Raise' },
      { key: 'donkey_calf_raise',     name: 'Donkey Calf Raise' },
    ],
  },
  {
    name: 'Shoulders',
    colour: '#60a5fa',
    exercises: [
      { key: 'overhead_press',        name: 'Overhead Press' },
      { key: 'push_press',            name: 'Push Press' },
      { key: 'seated_ohp',            name: 'Seated OHP' },
      { key: 'db_shoulder_press',     name: 'DB Shoulder Press' },
      { key: 'arnold_press',          name: 'Arnold Press' },
      { key: 'machine_shoulder_press',name: 'Machine Shoulder Press' },
      { key: 'lateral_raise',         name: 'Lateral Raise' },
      { key: 'cable_lateral_raise',   name: 'Cable Lateral Raise' },
      { key: 'leaning_lateral_raise', name: 'Leaning Lateral Raise' },
      { key: 'front_raise',           name: 'Front Raise' },
      { key: 'plate_front_raise',     name: 'Plate Front Raise' },
      { key: 'rear_delt_fly',         name: 'Rear Delt Fly' },
      { key: 'reverse_pec_deck',      name: 'Reverse Pec Deck' },
      { key: 'face_pull',             name: 'Face Pull' },
      { key: 'upright_row',           name: 'Upright Row' },
      { key: 'handstand_push_up',     name: 'Handstand Push-up' },
    ],
  },
  {
    name: 'Arms',
    colour: '#a78bfa',
    exercises: [
      { key: 'bicep_curl',            name: 'Barbell Curl' },
      { key: 'db_curl',               name: 'DB Curl' },
      { key: 'hammer_curl',           name: 'Hammer Curl' },
      { key: 'preacher_curl',         name: 'Preacher Curl' },
      { key: 'incline_db_curl',       name: 'Incline DB Curl' },
      { key: 'cable_curl',            name: 'Cable Curl' },
      { key: 'spider_curl',           name: 'Spider Curl' },
      { key: 'concentration_curl',    name: 'Concentration Curl' },
      { key: 'reverse_curl',          name: 'Reverse Curl' },
      { key: 'zottman_curl',          name: 'Zottman Curl' },
      { key: 'tricep_extension',      name: 'Skullcrusher' },
      { key: 'overhead_tri_extension',name: 'Overhead Tri Extension' },
      { key: 'tricep_pushdown',       name: 'Tricep Pushdown' },
      { key: 'rope_pushdown',         name: 'Rope Pushdown' },
      { key: 'tricep_dip',            name: 'Tricep Dip' },
      { key: 'close_grip_bench',      name: 'Close-grip Bench' },
      { key: 'jm_press',              name: 'JM Press' },
      { key: 'kickback',              name: 'Tricep Kickback' },
      { key: 'wrist_curl',            name: 'Wrist Curl' },
      { key: 'reverse_wrist_curl',    name: 'Reverse Wrist Curl' },
      { key: 'farmer_carry',          name: 'Farmer Carry' },
    ],
  },
  {
    name: 'Core',
    colour: '#facc15',
    exercises: [
      { key: 'plank',                 name: 'Plank' },
      { key: 'side_plank',            name: 'Side Plank' },
      { key: 'cable_crunch',          name: 'Cable Crunch' },
      { key: 'hanging_leg_raise',     name: 'Hanging Leg Raise' },
      { key: 'hanging_knee_raise',    name: 'Hanging Knee Raise' },
      { key: 'ab_wheel',              name: 'Ab Wheel Rollout' },
      { key: 'sit_up',                name: 'Sit-up' },
      { key: 'decline_sit_up',        name: 'Decline Sit-up' },
      { key: 'russian_twist',         name: 'Russian Twist' },
      { key: 'pallof_press',          name: 'Pallof Press' },
      { key: 'wood_chop',             name: 'Cable Wood Chop' },
      { key: 'dead_bug',              name: 'Dead Bug' },
      { key: 'bird_dog',              name: 'Bird Dog' },
      { key: 'l_sit',                 name: 'L-sit Hold' },
      { key: 'dragon_flag',           name: 'Dragon Flag' },
    ],
  },
]

const ALL_EXERCISES: Exercise[] = GROUPS.flatMap(g => g.exercises)
const EXERCISE_NAME: Record<string, string> = Object.fromEntries(
  ALL_EXERCISES.map(e => [e.key, e.name]),
)
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
          <Text className="text-zinc-400 text-xs uppercase tracking-widest mb-1.5 font-semibold">
            This Week
          </Text>
          <View className="flex-row items-baseline gap-1.5">
            <Text className="text-white text-4xl font-bold">
              {total.toLocaleString()}
            </Text>
            <Text className="text-zinc-400 text-base">kg moved</Text>
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

interface CustomExerciseRow {
  id: string
  key: string
  name: string
  group_name: string
  created_at: string
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
      <View className="flex-1 bg-zinc-950">
        <View className="items-center pt-3 pb-2">
          <View className="w-10 h-1 bg-zinc-700 rounded-full" />
        </View>
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-zinc-800">
          <Text className="text-white font-semibold">
            {filterGroup ? `Pick ${filterGroup.toLowerCase()} exercise` : 'Pick exercise'}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={12}
            className="w-10 h-10 -mr-1 rounded-full bg-zinc-900 border border-zinc-800 items-center justify-center"
          >
            <X size={20} color="#e4e4e7" strokeWidth={2.25} />
          </TouchableOpacity>
        </View>
        <ScrollView
          className="flex-1 px-4 pt-4"
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Custom-exercise creation block. Stays at the top so it's
              discoverable; expands inline rather than launching another modal. */}
          {!creating ? (
            <TouchableOpacity
              onPress={() => setCreating(true)}
              className="rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 mb-4"
            >
              <Text className="text-white text-sm font-medium">+ New custom exercise</Text>
              <Text className="text-zinc-500 text-xs mt-0.5">
                Add a movement we don't have in the catalogue.
              </Text>
            </TouchableOpacity>
          ) : (
            <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3 mb-4">
              <TextInput
                value={newName}
                onChangeText={setNewName}
                placeholder="Exercise name"
                placeholderTextColor="#52525b"
                maxLength={80}
                className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-white text-sm mb-2"
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {GROUPS.map((g) => {
                  const active = newGroup === g.name
                  return (
                    <TouchableOpacity
                      key={g.name}
                      onPress={() => setNewGroup(g.name)}
                      className="px-3 py-1.5 rounded-full border"
                      style={{
                        backgroundColor: active ? g.colour : '#18181b',
                        borderColor: active ? g.colour : '#3f3f46',
                      }}
                    >
                      <Text
                        className="text-xs font-medium"
                        style={{ color: active ? 'black' : '#a1a1aa' }}
                      >
                        {g.name}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
                {/* Other bucket as a non-coloured chip */}
                <TouchableOpacity
                  onPress={() => setNewGroup('Other')}
                  className="px-3 py-1.5 rounded-full border"
                  style={{
                    backgroundColor: newGroup === 'Other' ? 'white' : '#18181b',
                    borderColor: newGroup === 'Other' ? 'white' : '#3f3f46',
                  }}
                >
                  <Text
                    className="text-xs font-medium"
                    style={{ color: newGroup === 'Other' ? 'black' : '#a1a1aa' }}
                  >
                    Other
                  </Text>
                </TouchableOpacity>
              </ScrollView>
              <View className="flex-row mt-3" style={{ gap: 8 }}>
                <TouchableOpacity
                  onPress={() => { setCreating(false); setNewName('') }}
                  className="flex-1 py-2 rounded-xl bg-zinc-950 border border-zinc-800 items-center"
                >
                  <Text className="text-zinc-300 text-sm">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    const trimmed = newName.trim()
                    if (!trimmed) return
                    createMutation.mutate({ name: trimmed, group_name: newGroup })
                  }}
                  disabled={!newName.trim() || createMutation.isPending}
                  className="flex-1 py-2 rounded-xl bg-white items-center"
                  style={{ opacity: !newName.trim() || createMutation.isPending ? 0.4 : 1 }}
                >
                  {createMutation.isPending ? (
                    <ActivityIndicator color="black" />
                  ) : (
                    <Text className="text-black text-sm font-semibold">Save</Text>
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
                    <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: g.colour }} />
                    <Text className="text-zinc-500 text-xs uppercase tracking-widest">{g.name}</Text>
                  </View>
                )}
                <View style={{ gap: 6 }}>
                  {g.exercises.map((e) => (
                    <TouchableOpacity
                      key={e.key}
                      onPress={() => { hapticSelection(); onPick(e.key) }}
                      className="px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-800"
                    >
                      <Text className="text-white text-sm">{e.name}</Text>
                    </TouchableOpacity>
                  ))}
                  {customs.map((c) => (
                    <TouchableOpacity
                      key={c.id}
                      onPress={() => { hapticSelection(); onPick(c.key) }}
                      className="px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-800 flex-row items-center justify-between"
                    >
                      <Text className="text-white text-sm">{c.name}</Text>
                      <Text className="text-zinc-600 text-[10px] uppercase tracking-widest">custom</Text>
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
                <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#a8a29e' }} />
                <Text className="text-zinc-500 text-xs uppercase tracking-widest">Other</Text>
              </View>
              <View style={{ gap: 6 }}>
                {customByGroup['Other'].map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    onPress={() => { hapticSelection(); onPick(c.key) }}
                    className="px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-800 flex-row items-center justify-between"
                  >
                    <Text className="text-white text-sm">{c.name}</Text>
                    <Text className="text-zinc-600 text-[10px] uppercase tracking-widest">custom</Text>
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
    setSets(prev => [...prev, {
      reps: prev[prev.length - 1]?.reps ?? '',
      weight: prev[prev.length - 1]?.weight ?? '',
    }])
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
          <TouchableOpacity
            onPress={onClose}
            hitSlop={12}
            className="w-10 h-10 -mr-1 rounded-full bg-zinc-900 border border-zinc-800 items-center justify-center"
          >
            <X size={20} color="#e4e4e7" strokeWidth={2.25} />
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
      <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-zinc-500 text-xs uppercase tracking-widest">Weekly Race</Text>
        </View>
        <Text className="text-zinc-300 text-sm">
          {meRow ? `You've moved ${meRow.total_volume_kg.toLocaleString()} kg this week.` : 'No volume logged yet this week.'}
        </Text>
        <Text className="text-zinc-600 text-xs mt-1">
          Add friends to race them on weekly weight moved.
        </Text>
        <TouchableOpacity
          onPress={() => router.push('/friends')}
          className="mt-3 self-start bg-zinc-800 px-3 py-1.5 rounded-xl"
        >
          <Text className="text-white text-xs font-medium">+ Invite friends</Text>
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
      style={{
        backgroundColor: '#18181b',
        borderWidth: 1,
        borderColor: '#27272a',
        borderRadius: 16,
        padding: 16,
      }}
    >
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-zinc-500 text-xs uppercase tracking-widest">Weekly Race</Text>
        <Text className="text-zinc-600 text-[10px]">
          Crew of {rows.length} · resets Sunday →
        </Text>
      </View>

      <View style={{ gap: 6 }}>
        {topThree.map((row) => (
          <RaceRowView key={row.user.id} row={row} maxVol={maxVol} />
        ))}
        {meBelowFold && meRow && (
          <>
            <View className="flex-row items-center my-1">
              <View className="flex-1 h-px bg-zinc-800" />
              <Text className="text-zinc-700 text-[10px] mx-2">···</Text>
              <View className="flex-1 h-px bg-zinc-800" />
            </View>
            <RaceRowView row={meRow} maxVol={maxVol} />
          </>
        )}
      </View>
    </PressableScale>
  )
}

function RaceRowView({ row, maxVol }: { row: RaceRow; maxVol: number }) {
  const medal = row.rank === 1 ? { Icon: Trophy, color: '#FCD34D' }
              : row.rank === 2 ? { Icon: Award,  color: '#D1D5DB' }
              : row.rank === 3 ? { Icon: Award,  color: '#B45309' }
              : null
  const pct = (row.total_volume_kg / maxVol) * 100
  return (
    <View>
      <View className="flex-row items-center gap-2">
        <View className="w-6 items-center">
          {medal
            ? <medal.Icon size={14} color={medal.color} strokeWidth={2} />
            : <Text className="text-zinc-500 text-xs">{row.rank}</Text>}
        </View>
        <View className="flex-row items-center flex-1" style={{ gap: 6 }}>
          <Text className="text-sm flex-shrink" style={{ color: row.is_me ? 'white' : '#d4d4d8', fontWeight: row.is_me ? '700' : '500' }} numberOfLines={1}>
            {row.user.name}{row.is_me ? ' (you)' : ''}
          </Text>
          {row.is_trusted && <TrustedShield size={12} />}
          {row.is_sus && <SusFace size={12} />}
        </View>
        <View className="items-end" style={{ minWidth: 68 }}>
          <Text className="text-xs tabular-nums" style={{ color: row.is_me ? 'white' : '#a1a1aa', fontWeight: '600' }}>
            {row.total_volume_kg.toLocaleString()}
            <Text className="text-zinc-600 text-[9px] font-normal"> kg</Text>
          </Text>
          <Text className="text-[10px] tabular-nums mt-0.5" style={{ color: row.is_me ? '#d4d4d8' : '#71717a' }}>
            {row.dots_volume != null ? row.dots_volume.toLocaleString() : '—'}
            <Text className="text-zinc-700 text-[9px]"> DOTS</Text>
          </Text>
        </View>
      </View>
      <View
        className="mt-1 rounded-full overflow-hidden"
        style={{ height: 3, backgroundColor: '#27272a' }}
      >
        <View
          style={{
            width: `${pct}%`,
            height: '100%',
            backgroundColor: row.is_me ? '#ffffff' : '#52525b',
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
      style={{
        flex: 1,
        backgroundColor: '#18181b',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: isToday ? group.colour : '#27272a',
        padding: 14,
        minHeight: 96,
        // Today's-split tile gets a coloured halo. Keeps the visual hierarchy
        // clear without screaming the colour at full opacity.
        shadowColor: isToday ? group.colour : undefined,
        shadowOpacity: isToday ? 0.5 : 0,
        shadowRadius: isToday ? 6 : 0,
        shadowOffset: { width: 0, height: 0 },
      }}
    >
      <View className="flex-row items-center mb-2" style={{ gap: 6 }}>
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: group.colour,
          }}
        />
        <Text className="text-white text-sm font-semibold">{group.name}</Text>
        {isToday && (
          <View
            style={{
              marginLeft: 'auto',
              backgroundColor: `${group.colour}33`,
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 6,
            }}
          >
            <Text
              style={{ color: group.colour, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 }}
            >
              TODAY
            </Text>
          </View>
        )}
      </View>

      {last ? (
        <>
          <Text className="text-zinc-300 text-xs" numberOfLines={1}>
            {last.exerciseName}
          </Text>
          <Text className="text-zinc-500 text-[11px] mt-0.5" numberOfLines={1}>
            {last.weightKg ?? '–'}kg × {last.reps ?? '–'}
          </Text>
          <Text className="text-zinc-600 text-[10px] mt-1">
            {daysSince === 0 ? 'today' : `${daysSince}d ago`}
          </Text>
        </>
      ) : (
        <Text className="text-zinc-600 text-xs mt-1">No sessions yet</Text>
      )}
    </PressableScale>
  )
}

function TodaysSplitBanner({
  todaysGroup,
  weekdayLabel,
}: {
  todaysGroup: { group_name: string; confidence: number } | null
  weekdayLabel: string
}) {
  if (!todaysGroup) return null
  const match = GROUPS.find(g => g.name === todaysGroup.group_name)
  const colour = match?.colour ?? '#a1a1aa'
  return (
    <View
      className="rounded-2xl px-4 py-3 flex-row items-center"
      style={{
        backgroundColor: `${colour}1A`,
        borderWidth: 1,
        borderColor: `${colour}44`,
      }}
    >
      <View
        style={{
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: colour,
          marginRight: 10,
        }}
      />
      <View className="flex-1">
        <Text className="text-white text-sm font-semibold">
          Today's usual: {todaysGroup.group_name}
        </Text>
        <Text className="text-zinc-500 text-[11px] mt-0.5">
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

  const top = (data?.estimates ?? []).slice(0, 5)

  return (
    <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <View className="flex-row items-baseline justify-between mb-2">
        <Text className="text-zinc-500 text-xs uppercase tracking-widest">
          Estimated 1RM
        </Text>
        <Text className="text-zinc-600 text-[10px]">last 90 days</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator color="#71717a" />
      ) : top.length === 0 ? (
        <Text className="text-zinc-500 text-xs">
          Log a few weighted sets to see your estimated max.
        </Text>
      ) : (
        <View style={{ gap: 6 }}>
          {top.map((row) => (
            <View
              key={row.exercise}
              className="flex-row items-center justify-between"
            >
              <View className="flex-1 pr-2">
                <Text className="text-white text-sm" numberOfLines={1}>
                  {EXERCISE_NAME[row.exercise] ?? row.exercise}
                </Text>
                <Text className="text-zinc-600 text-[10px] mt-0.5">
                  from {row.source.weight_kg}kg × {row.source.reps}
                </Text>
              </View>
              <Text className="text-white text-sm font-semibold">
                {row.mean}
                <Text className="text-zinc-500 text-[10px] font-normal"> kg</Text>
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

export default function TrainingScreen() {
  const { user } = useRequireAuth()

  const [selectedExercise, setSelectedExercise] = useState('bench_press')
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

  // Auto-detected weekly split. Backend job updates this nightly; we just read.
  const splitQ = useQuery<{ split: UserSplitRow[] }>({
    queryKey: ['training-split'],
    queryFn: () => api.get('/training/split').then(r => r.data),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  })

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
            <Text className="text-zinc-400 text-xs uppercase tracking-widest font-semibold">{today}</Text>
            <Text className="text-white text-3xl font-bold mt-1.5">Training</Text>
          </View>
          <View className="flex-row" style={{ gap: 8 }}>
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
        </View>

        {isLoading ? (
          <View style={{ gap: 12 }}>
            <SkeletonCard height={140} />
            <SkeletonCard height={160} />
            <SkeletonCard height={240} />
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {/* Weekly race — the social hook for the tab. Sits above your
                personal volume so the comparison frames the rest. */}
            <WeeklyRaceCard />

            <VolumeChart data={volumeQ.data} />

            <PRChart
              data={prQ.data}
              exerciseKey={selectedExercise}
              onPickExercise={() => setShowPicker(true)}
            />

            <OneRMCard />

            {/* Muscle-group tiles. Tap one to open a group-filtered picker;
                pick an exercise → opens LogExerciseModal. The detected split
                banner + per-tile TODAY chip drive the 'where do I lift today'
                signal that used to live nowhere on this screen. */}
            <View className="mt-2">
              <TodaysSplitBanner
                todaysGroup={todaysSplit}
                weekdayLabel={WEEKDAY_LABEL_FULL[todayWeekday]}
              />
              <View style={{ marginTop: todaysSplit ? 12 : 0, gap: 10 }}>
                {/* Render in pairs so each row is two tiles. */}
                {Array.from({ length: Math.ceil(GROUPS.length / 2) }, (_, rowIdx) => (
                  <View key={rowIdx} className="flex-row" style={{ gap: 10 }}>
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
    </SafeAreaView>
  )
}
