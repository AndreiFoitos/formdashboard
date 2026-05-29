import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
} from 'react-native'
import { useState, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api } from '../../api/client'
import { useRequireAuth } from '../../hooks/useRequireAuth'
import { CountUp } from '../../components/CountUp'
import { AnimatedBar } from '../../components/AnimatedBar'
import { SkeletonCard } from '../../components/Skeleton'
import { PressableScale } from '../../components/PressableScale'
import { SwipeableRow } from '../../components/SwipeableRow'
import { hapticLight, hapticSuccess, hapticSelection } from '../../lib/haptics'
import { router } from 'expo-router'
import { SettingsIcon } from '../../components/TabIcons'
import { AiDigest } from '../../components/AiDigest'
import { CaffeineCurve, type CurveData } from '../../components/CaffeineCurve'
import { UndoToast } from '../../components/UndoToast'
import { showUndo } from '../../store/undo'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Summary {
  form_score: number | null
  form_score_unlocked: boolean
  sleep_score: number | null
  hrv_score: number | null
  energy_avg: number | null
  water_ml: number | null
  caffeine_mg: number | null
  calories_eaten: number | null
  protein_g: number | null
  trained: boolean
  training_type: string | null
}

interface Goal {
  id: string
  text: string
  done: boolean
  position: number
}

interface Targets {
  water_target_ml: number | null
  protein_target_g: number | null
  calorie_target: number | null
}

interface DashboardData {
  date: string
  summary: Summary
  goals: Goal[]
  targets: Targets
  caffeine: CurveData | undefined
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function pct(value: number | null | undefined, target: number | null | undefined) {
  if (!value || !target) return 0
  return Math.min(100, Math.round((value / target) * 100))
}

// ─── Form Score Card ──────────────────────────────────────────────────────────

function FormScoreCard({ summary }: { summary: Summary | undefined }) {
  if (!summary) return null

  if (!summary.form_score_unlocked) {
    return (
      <View className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5">
        <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-3">
          Form Score
        </Text>
        <Text className="text-white font-semibold text-sm">Calibrating…</Text>
        <Text className="text-zinc-500 text-xs mt-1 leading-5">
          Log 5 days in a row to activate your personalized Form Score.
        </Text>
        <AiDigest />
      </View>
    )
  }

  const score = summary.form_score ?? 0
  const label =
    score >= 80 ? 'Locked in' :
    score >= 60 ? 'On track' :
    score >= 40 ? 'Below baseline' : 'Recovery day'

  const color =
    score >= 80 ? '#22c55e' :
    score >= 60 ? '#eab308' :
    score >= 40 ? '#f97316' : '#ef4444'

  return (
    <View className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5">
      <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-4">
        Form Score
      </Text>
      <View className="flex-row items-center gap-5">
        {/* Score number */}
        <View
          className="w-16 h-16 rounded-full items-center justify-center border-2"
          style={{ borderColor: color }}
        >
          <CountUp value={score} className="text-white text-xl font-bold" />
        </View>

        <View className="flex-1">
          <Text className="text-white font-semibold text-base">{label}</Text>
          <Text className="text-zinc-500 text-xs mt-1">
            {summary.sleep_score != null ? `Sleep ${summary.sleep_score}` : ''}
            {summary.sleep_score != null && summary.hrv_score != null ? ' · ' : ''}
            {summary.hrv_score != null ? `HRV ${summary.hrv_score}` : ''}
          </Text>
        </View>
      </View>

      <AiDigest />
    </View>
  )
}

// ─── Stat Tile ────────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  target,
  unit,
}: {
  label: string
  value: number | null | undefined
  target?: number | null
  unit: string
}) {
  const p = pct(value, target)

  return (
    <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex-1">
      <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">
        {label}
      </Text>
      <Text className="text-white font-semibold text-base">
        {value != null ? (
          <CountUp
            value={Math.round(value)}
            separator
            className="text-white font-semibold text-base"
          />
        ) : (
          '—'
        )}
        <Text className="text-zinc-500 text-xs font-normal"> {unit}</Text>
      </Text>
      {target != null && (
        <>
          <AnimatedBar percent={p} color="#ffffff" height={2} style={{ marginTop: 12 }} />
          <Text className="text-zinc-600 text-xs mt-1">{p}%</Text>
        </>
      )}
    </View>
  )
}

// ─── Energy Check-in ──────────────────────────────────────────────────────────

const ENERGY_LABELS = ['Crashed', 'Low', 'Okay', 'Good', 'Locked in']

function EnergyCheckin() {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<number | null>(null)
  // The id of the most recent log this card created — used so a re-tap within
  // a few seconds replaces it rather than stacking another entry on the avg.
  const lastLogIdRef = useRef<string | null>(null)

  const { mutateAsync, isPending } = useMutation({
    mutationFn: (level: number) =>
      api.post('/energy/log', { level }).then((r) => r.data as { id: string }),
  })

  const handleTap = async (level: number) => {
    hapticSelection()
    const previousId = lastLogIdRef.current
    setSelected(level)
    try {
      const entry = await mutateAsync(level)
      lastLogIdRef.current = entry.id
      hapticSuccess()
      // Replace the previous in-session log so the avg reflects the latest tap.
      if (previousId) {
        await api.delete(`/energy/${previousId}`).catch(() => {})
      }
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      showUndo({
        label: `Energy logged · ${ENERGY_LABELS[level - 1]}`,
        onUndo: async () => {
          const idToDelete = lastLogIdRef.current
          if (!idToDelete) return
          await api.delete(`/energy/${idToDelete}`)
          lastLogIdRef.current = null
          setSelected(null)
          qc.invalidateQueries({ queryKey: ['dashboard'] })
        },
      })
    } catch {
      setSelected(previousId ? selected : null)
    }
  }

  return (
    <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-zinc-500 text-xs uppercase tracking-widest">
          How's your energy?
        </Text>
        <Text className="text-zinc-600 text-xs">
          {selected ? ENERGY_LABELS[selected - 1] : 'Tap to log'}
        </Text>
      </View>
      <View className="flex-row gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <PressableScale
            key={n}
            onPress={() => handleTap(n)}
            disabled={isPending}
            className="flex-1 py-2.5 rounded-xl border items-center"
            style={{
              backgroundColor: selected === n ? 'white' : '#18181b',
              borderColor: selected === n ? 'white' : '#3f3f46',
              opacity: isPending && selected !== n ? 0.5 : 1,
            }}
          >
            <Text
              className="text-sm font-semibold"
              style={{ color: selected === n ? 'black' : '#71717a' }}
            >
              {n}
            </Text>
          </PressableScale>
        ))}
      </View>
    </View>
  )
}

// ─── Hydration Quick Log ──────────────────────────────────────────────────────

const WATER_PRESETS = [250, 500, 750] as const

function HydrationQuickLog({
  waterMl,
  targetMl,
}: {
  waterMl: number | null
  targetMl: number | null
}) {
  const qc = useQueryClient()

  const { mutateAsync, isPending } = useMutation({
    mutationFn: (ml: number) =>
      api
        .post('/hydration/log', { amount_ml: ml })
        .then((r) => r.data as { id: string; amount_ml: number }),
  })

  const target = targetMl ?? 2500
  const current = waterMl ?? 0
  const p = Math.min(100, Math.round((current / target) * 100))

  const handleLog = async (ml: number) => {
    hapticLight()
    // Optimistic — bump the dashboard cache so the bar moves instantly.
    qc.setQueryData<DashboardData>(['dashboard'], (old) =>
      old
        ? { ...old, summary: { ...old.summary, water_ml: (old.summary.water_ml ?? 0) + ml } }
        : old,
    )
    try {
      const entry = await mutateAsync(ml)
      hapticSuccess()
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      showUndo({
        label: `+${ml.toLocaleString()} ml water`,
        onUndo: async () => {
          await api.delete(`/hydration/${entry.id}`)
          qc.invalidateQueries({ queryKey: ['dashboard'] })
        },
      })
    } catch {
      // Rollback the optimistic bump on failure.
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    }
  }

  return (
    <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-zinc-500 text-xs uppercase tracking-widest">
          Hydration
        </Text>
        <Text className="text-xs text-zinc-400">
          <Text className="text-white font-semibold">{current.toLocaleString()}</Text>
          <Text className="text-zinc-600"> / {target.toLocaleString()}ml</Text>
        </Text>
      </View>

      <AnimatedBar percent={p} color="#38bdf8" height={6} style={{ marginBottom: 12 }} />

      <View className="flex-row gap-2">
        {WATER_PRESETS.map((ml) => (
          <PressableScale
            key={ml}
            onPress={() => handleLog(ml)}
            disabled={isPending}
            className="flex-1 py-2.5 rounded-xl bg-zinc-800 items-center"
            style={{ opacity: isPending ? 0.6 : 1 }}
          >
            <Text className="text-white text-xs font-medium">+{ml}ml</Text>
          </PressableScale>
        ))}
      </View>
    </View>
  )
}

// ─── Goals Section ────────────────────────────────────────────────────────────

function GoalsSection({ goals }: { goals: Goal[] }) {
  const qc = useQueryClient()
  const [newText, setNewText] = useState('')
  const [adding, setAdding] = useState(false)

  const addMutation = useMutation({
    mutationFn: (text: string) => api.post('/goals/', { text }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setNewText('')
      setAdding(false)
    },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      api.put(`/goals/${id}`, { done }),
    onMutate: async ({ id, done }) => {
      await qc.cancelQueries({ queryKey: ['dashboard'] })
      const prev = qc.getQueryData<DashboardData>(['dashboard'])
      qc.setQueryData<DashboardData>(['dashboard'], (old) =>
        old
          ? { ...old, goals: old.goals.map((g) => (g.id === id ? { ...g, done } : g)) }
          : old,
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['dashboard'], ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['dashboard'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/goals/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard'] }),
  })

  const pending = goals.filter((g) => !g.done)
  const done = goals.filter((g) => g.done)

  return (
    <View>
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-zinc-500 text-xs uppercase tracking-widest">
          Today's Goals
        </Text>
        <TouchableOpacity onPress={() => setAdding(true)}>
          <Text className="text-zinc-400 text-xs">+ Add</Text>
        </TouchableOpacity>
      </View>

      <View className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        {/* Add input */}
        {adding && (
          <View className="flex-row items-center px-4 py-3 border-b border-zinc-800">
            <TextInput
              value={newText}
              onChangeText={setNewText}
              placeholder="New goal…"
              placeholderTextColor="#52525b"
              autoFocus
              className="flex-1 text-white text-sm"
              onSubmitEditing={() => newText.trim() && addMutation.mutate(newText.trim())}
            />
            <TouchableOpacity
              onPress={() => newText.trim() && addMutation.mutate(newText.trim())}
              disabled={!newText.trim() || addMutation.isPending}
              className="bg-zinc-700 px-3 py-1.5 rounded-lg ml-2"
              style={{ opacity: !newText.trim() ? 0.4 : 1 }}
            >
              <Text className="text-white text-xs font-medium">
                {addMutation.isPending ? '…' : 'Add'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setAdding(false); setNewText('') }}
              className="ml-2"
            >
              <Text className="text-zinc-500 text-xs">✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Empty state */}
        {goals.length === 0 && !adding && (
          <View className="px-4 py-8 items-center">
            <Text className="text-zinc-500 text-sm">No goals yet</Text>
            <TouchableOpacity onPress={() => setAdding(true)} className="mt-1">
              <Text className="text-zinc-400 text-xs">Add your first goal →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Goals — swipe a row left to delete */}
        {[...pending, ...done].map((goal, index) => (
          <SwipeableRow
            key={goal.id}
            onDelete={() => deleteMutation.mutate(goal.id)}
          >
            <GoalRow
              goal={goal}
              isLast={index === goals.length - 1}
              onToggle={() => {
                hapticLight()
                toggleMutation.mutate({ id: goal.id, done: !goal.done })
              }}
            />
          </SwipeableRow>
        ))}
      </View>
    </View>
  )
}

function GoalRow({
  goal,
  isLast,
  onToggle,
}: {
  goal: Goal
  isLast: boolean
  onToggle: () => void
}) {
  return (
    <View
      className="flex-row items-center px-4 py-3 bg-zinc-900"
      style={{ borderBottomWidth: isLast ? 0 : 1, borderBottomColor: '#27272a' }}
    >
      {/* Checkbox */}
      <TouchableOpacity
        onPress={onToggle}
        hitSlop={8}
        className="w-4 h-4 rounded border mr-3 items-center justify-center"
        style={{
          backgroundColor: goal.done ? 'white' : 'transparent',
          borderColor: goal.done ? 'white' : '#52525b',
        }}
      >
        {goal.done && (
          <Text style={{ fontSize: 9, color: 'black', fontWeight: 'bold' }}>✓</Text>
        )}
      </TouchableOpacity>

      {/* Text */}
      <Text
        className="flex-1 text-sm"
        style={{
          color: goal.done ? '#52525b' : '#e4e4e7',
          textDecorationLine: goal.done ? 'line-through' : 'none',
        }}
      >
        {goal.text}
      </Text>
    </View>
  )
}

// ─── Sunday Recap Card ────────────────────────────────────────────────────────

interface RecapHeadlines {
  top_volume?: { user: { name: string }; total_volume_kg: number } | null
  most_consistent?: { user: { name: string }; days_trained: number } | null
  most_pr?: { user: { name: string }; pr_count: number } | null
  most_sus?: { user: { name: string }; votes: number; threshold: number } | null
}
interface RecapResponse {
  circle_size: number
  headlines: RecapHeadlines
  me: { total_volume_kg: number; rank: number; days_trained: number } | null
}

function SundayRecapCard() {
  const { data } = useQuery<RecapResponse>({
    queryKey: ['friends-recap'],
    queryFn: () => api.get('/friends/recap').then((r) => r.data),
    // Only fetch when card actually renders (Sunday/Monday) — query stays cold otherwise
  })

  if (!data || data.circle_size === 0) return null

  const lines = [
    data.headlines.top_volume     && { icon: '🏋️', text: `${data.headlines.top_volume.user.name} moved ${data.headlines.top_volume.total_volume_kg.toLocaleString()} kg` },
    data.headlines.most_consistent && { icon: '📅', text: `${data.headlines.most_consistent.user.name} trained ${data.headlines.most_consistent.days_trained} days` },
    data.headlines.most_pr        && { icon: '📈', text: `${data.headlines.most_pr.user.name} hit ${data.headlines.most_pr.pr_count} PR${data.headlines.most_pr.pr_count === 1 ? '' : 's'}` },
    data.headlines.most_sus       && { icon: '🤨', text: `${data.headlines.most_sus.user.name} is sus (${data.headlines.most_sus.votes} / ${data.headlines.most_sus.threshold})` },
  ].filter(Boolean) as { icon: string; text: string }[]

  if (lines.length === 0) return null

  return (
    <PressableScale
      haptic
      onPress={() => router.push('/friends')}
      style={{ backgroundColor: '#18181b', borderColor: '#27272a', borderWidth: 1, borderRadius: 16, padding: 16 }}
    >
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-zinc-500 text-xs uppercase tracking-widest">Sunday Recap</Text>
        {data.me && (
          <Text className="text-zinc-500 text-xs">Rank #{data.me.rank}</Text>
        )}
      </View>
      <View style={{ gap: 6 }}>
        {lines.map((l, i) => (
          <View key={i} className="flex-row items-center gap-2">
            <Text style={{ fontSize: 14 }}>{l.icon}</Text>
            <Text className="text-zinc-200 text-sm flex-1">{l.text}</Text>
          </View>
        ))}
      </View>
      <Text className="text-zinc-500 text-xs mt-3">Tap to open friends →</Text>
    </PressableScale>
  )
}

// ─── Dashboard Screen ─────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const { user } = useRequireAuth()
  const qc = useQueryClient()

  // Recap card surfaces Sun/Mon — the week that just wrapped is freshest then
  const dow = new Date().getDay() // 0=Sun, 1=Mon
  const showRecap = dow === 0 || dow === 1

  const { data, isLoading, refetch, isRefetching } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard').then((r) => r.data),
    refetchInterval: 5 * 60 * 1000,
    enabled: !!user, // don't fetch until auth is confirmed
  })

  const onRefresh = useCallback(() => {
    refetch()
  }, [refetch])

  const summary = data?.summary
  const goals = data?.goals ?? []
  const targets = data?.targets

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  const firstName = user?.name?.split(' ')[0] ?? null

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        // Pull-to-refresh — not available in the web version but expected on mobile
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={onRefresh}
            tintColor="#ffffff"
          />
        }
      >
        {/* Header */}
        <View className="pt-6 pb-5 flex-row items-start justify-between">
          <View className="flex-1">
            <Text className="text-zinc-500 text-xs uppercase tracking-widest">
              {today}
            </Text>
            <Text className="text-white text-2xl font-bold mt-1">
              {getGreeting()}{firstName ? `, ${firstName}` : ''}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/settings')}
            hitSlop={8}
            className="mt-1 p-2 -mr-2"
          >
            <SettingsIcon color="#a1a1aa" size={22} />
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <View style={{ gap: 12 }}>
            <SkeletonCard height={96} />
            <View className="flex-row gap-3">
              <View className="flex-1"><SkeletonCard height={80} /></View>
              <View className="flex-1"><SkeletonCard height={80} /></View>
            </View>
            <View className="flex-row gap-3">
              <View className="flex-1"><SkeletonCard height={80} /></View>
              <View className="flex-1"><SkeletonCard height={80} /></View>
            </View>
            <SkeletonCard height={80} />
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <FormScoreCard summary={summary} />

            {showRecap && <SundayRecapCard />}

            {/* 2-column stat grid */}
            <View className="flex-row gap-3">
              <StatTile
                label="Water"
                value={summary?.water_ml}
                target={targets?.water_target_ml}
                unit="ml"
              />
              <StatTile
                label="Protein"
                value={summary?.protein_g != null ? Math.round(summary.protein_g) : null}
                target={targets?.protein_target_g != null ? Math.round(targets.protein_target_g) : null}
                unit="g"
              />
            </View>

            <View className="flex-row gap-3">
              <StatTile
                label="Calories"
                value={summary?.calories_eaten}
                target={targets?.calorie_target}
                unit="kcal"
              />
              <StatTile
                label="Energy"
                value={summary?.energy_avg != null ? Math.round(summary.energy_avg * 10) / 10 : null}
                unit="/ 5"
              />
            </View>

            {/* Trained badge */}
            {summary?.trained && (
              <View className="flex-row items-center gap-2.5 bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3">
                <View className="w-2 h-2 rounded-full bg-green-500" />
                <Text className="text-zinc-300 text-sm">
                  Trained today
                  {summary.training_type ? (
                    <Text className="text-zinc-500"> · {summary.training_type}</Text>
                  ) : null}
                </Text>
              </View>
            )}

            <EnergyCheckin />

            <HydrationQuickLog
              waterMl={summary?.water_ml ?? null}
              targetMl={targets?.water_target_ml ?? null}
            />

            <CaffeineCurve data={data?.caffeine} isLoading={false} />

            <GoalsSection goals={goals} />
          </View>
        )}
      </ScrollView>

      <UndoToast />
    </SafeAreaView>
  )
}