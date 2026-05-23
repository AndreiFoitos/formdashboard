import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ActivityIndicator,
} from 'react-native'
import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api } from '../api/client'
import { useRequireAuth } from '../hooks/useRequireAuth'
import { BottomNav } from '../components/BottomNav'

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
          <Text className="text-white text-xl font-bold">{score}</Text>
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
        {value != null ? Math.round(value).toLocaleString() : '—'}
        <Text className="text-zinc-500 text-xs font-normal"> {unit}</Text>
      </Text>
      {target != null && (
        <>
          {/* Progress bar */}
          <View className="h-0.5 bg-zinc-800 rounded-full mt-3 overflow-hidden">
            <View
              className="h-full bg-white rounded-full"
              style={{ width: `${p}%` }}
            />
          </View>
          <Text className="text-zinc-600 text-xs mt-1">{p}%</Text>
        </>
      )}
    </View>
  )
}

// ─── Energy Check-in ──────────────────────────────────────────────────────────

function EnergyCheckin() {
  const [selected, setSelected] = useState<number | null>(null)
  const [done, setDone] = useState(false)
  const qc = useQueryClient()

  const { mutate, isPending } = useMutation({
    mutationFn: (level: number) => api.post('/energy/log', { level }),
    onSuccess: () => {
      setDone(true)
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setTimeout(() => setDone(false), 3000)
    },
  })

  const labels = ['Crashed', 'Low', 'Okay', 'Good', 'Locked in']

  if (done) {
    return (
      <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex-row items-center gap-3">
        <Text className="text-green-500 text-base">✓</Text>
        <Text className="text-zinc-300 text-sm">Energy logged</Text>
      </View>
    )
  }

  return (
    <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-3">
        How's your energy right now?
      </Text>
      <View className="flex-row gap-2 mb-3">
        {[1, 2, 3, 4, 5].map((n) => (
          <TouchableOpacity
            key={n}
            onPress={() => setSelected(n)}
            className="flex-1 py-2.5 rounded-xl border items-center"
            style={{
              backgroundColor: selected === n ? 'white' : '#18181b',
              borderColor: selected === n ? 'white' : '#3f3f46',
            }}
          >
            <Text
              className="text-sm font-semibold"
              style={{ color: selected === n ? 'black' : '#71717a' }}
            >
              {n}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <View className="flex-row items-center justify-between">
        <Text className="text-zinc-600 text-xs">
          {selected ? labels[selected - 1] : 'Tap to select'}
        </Text>
        <TouchableOpacity
          onPress={() => selected && mutate(selected)}
          disabled={!selected || isPending}
          className="bg-zinc-700 px-3 py-1.5 rounded-lg"
          style={{ opacity: !selected || isPending ? 0.4 : 1 }}
        >
          {isPending ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Text className="text-white text-xs font-medium">Log</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  )
}

// ─── Hydration Quick Log ──────────────────────────────────────────────────────

function HydrationQuickLog({
  waterMl,
  targetMl,
}: {
  waterMl: number | null
  targetMl: number | null
}) {
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
  const p = Math.min(100, Math.round((current / target) * 100))

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

      {/* Progress bar */}
      <View className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-3">
        <View
          className="h-full rounded-full"
          style={{ width: `${p}%`, backgroundColor: '#38bdf8' }}
        />
      </View>

      {logging ? (
        <View className="flex-row gap-2">
          {[250, 500, 750].map((ml) => (
            <TouchableOpacity
              key={ml}
              onPress={() => mutate(ml)}
              className="flex-1 py-2 rounded-xl bg-zinc-800 items-center"
            >
              <Text className="text-white text-xs font-medium">{ml}ml</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            onPress={() => setLogging(false)}
            className="px-3 py-2 rounded-xl bg-zinc-800 items-center"
          >
            <Text className="text-zinc-400 text-xs">✕</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity onPress={() => setLogging(true)}>
          <Text className="text-zinc-400 text-xs font-medium">+ Log water</Text>
        </TouchableOpacity>
      )}
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

        {/* Pending goals */}
        {[...pending, ...done].map((goal, index) => (
          <GoalRow
            key={goal.id}
            goal={goal}
            isLast={index === goals.length - 1}
            onToggle={() => toggleMutation.mutate({ id: goal.id, done: !goal.done })}
            onDelete={() => deleteMutation.mutate(goal.id)}
          />
        ))}
      </View>
    </View>
  )
}

function GoalRow({
  goal,
  isLast,
  onToggle,
  onDelete,
}: {
  goal: Goal
  isLast: boolean
  onToggle: () => void
  onDelete: () => void
}) {
  const [showDelete, setShowDelete] = useState(false)

  return (
    <View
      className="flex-row items-center px-4 py-3"
      style={{ borderBottomWidth: isLast ? 0 : 1, borderBottomColor: '#27272a' }}
    >
      {/* Checkbox */}
      <TouchableOpacity
        onPress={onToggle}
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

      {/* Delete */}
      {showDelete ? (
        <View className="flex-row gap-3">
          <TouchableOpacity onPress={onDelete}>
            <Text className="text-red-400 text-xs">Delete</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowDelete(false)}>
            <Text className="text-zinc-600 text-xs">Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity onPress={() => setShowDelete(true)}>
          <Text className="text-zinc-700 text-sm">···</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

// ─── Dashboard Screen ─────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const { user } = useRequireAuth()
  const qc = useQueryClient()

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
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
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
        <View className="pt-6 pb-5">
          <Text className="text-zinc-500 text-xs uppercase tracking-widest">
            {today}
          </Text>
          <Text className="text-white text-2xl font-bold mt-1">
            {getGreeting()}{firstName ? `, ${firstName}` : ''}
          </Text>
        </View>

        {isLoading ? (
          <ActivityIndicator color="white" style={{ marginTop: 40 }} />
        ) : (
          <View style={{ gap: 12 }}>
            <FormScoreCard summary={summary} />

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

            <GoalsSection goals={goals} />
          </View>
        )}
      </ScrollView>

      <BottomNav />
    </SafeAreaView>
  )
}