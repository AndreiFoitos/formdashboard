import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native'
import { useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api } from '../../api/client'
import { useRequireAuth } from '../../hooks/useRequireAuth'
import { CountUp } from '../../components/CountUp'
import { AnimatedBar } from '../../components/AnimatedBar'
import { SkeletonCard } from '../../components/Skeleton'
import { PressableScale } from '../../components/PressableScale'
import { hapticLight, hapticSuccess } from '../../lib/haptics'
import { router } from 'expo-router'
import { Play, UserPlus } from 'lucide-react-native'
import { SettingsIcon } from '../../components/TabIcons'
import { AiDigest } from '../../components/AiDigest'
import { CaffeineCurve, type CurveData } from '../../components/CaffeineCurve'
import { UndoToast } from '../../components/UndoToast'
import { showUndo } from '../../store/undo'
import type { RecapRaceData } from '../weekly-recap'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormScoreBreakdown {
  hydration: number
  nutrition: number
  nutrition_protein: number
  nutrition_calories: number
  training: number
  caffeine: number
  streak: number
  weights: {
    hydration: number
    nutrition: number
    training: number
    caffeine: number
    streak: number
  }
  context: {
    hydration: string
    nutrition: string
    training: string
    caffeine: string
    streak: string
  }
}

interface Summary {
  form_score: number | null
  form_score_unlocked: boolean
  score_breakdown: FormScoreBreakdown | null
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

// Label-only map used to surface the lowest-scoring component as a one-line
// hint under the score. The per-component breakdown UI has been intentionally
// pulled — the AI digest is the explanation layer.
const COMPONENT_LABELS: Record<
  'hydration' | 'nutrition' | 'training' | 'caffeine' | 'streak',
  string
> = {
  hydration: 'hydration',
  nutrition: 'nutrition',
  training: 'training',
  caffeine: 'caffeine',
  streak: 'streak',
}

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

  const breakdown = summary.score_breakdown

  // Subtitle: surface the lowest-scoring component as a "focus on" hint.
  // One short line — the AI digest below does the actual explaining.
  let subtitle = 'Your daily habits score'
  if (breakdown) {
    const keys = Object.keys(COMPONENT_LABELS) as (keyof typeof COMPONENT_LABELS)[]
    const ranked = keys
      .map((k) => ({ key: k, score: breakdown[k] }))
      .sort((a, b) => a.score - b.score)
    const lowest = ranked[0]
    const highest = ranked[ranked.length - 1]
    if (lowest && lowest.score < 60) {
      subtitle = `Focus on ${COMPONENT_LABELS[lowest.key]}`
    } else if (lowest && lowest.score >= 80) {
      subtitle = 'All components strong'
    } else if (highest) {
      subtitle = `Holding ${COMPONENT_LABELS[highest.key]}`
    }
  }

  return (
    <View className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5">
      <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-4">
        Form Score
      </Text>
      <View className="flex-row items-center gap-5">
        <View
          className="w-20 h-20 rounded-full items-center justify-center border-2"
          style={{ borderColor: color }}
        >
          <CountUp value={score} className="text-white text-3xl font-bold" />
        </View>

        <View className="flex-1">
          <Text className="text-white font-semibold text-lg">{label}</Text>
          <Text className="text-zinc-400 text-sm mt-1">{subtitle}</Text>
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
      <Text className="text-zinc-400 text-xs uppercase tracking-widest mb-2 font-semibold">
        {label}
      </Text>
      <Text className="text-white font-bold text-2xl">
        {value != null ? (
          <CountUp
            value={Math.round(value)}
            separator
            className="text-white font-bold text-2xl"
          />
        ) : (
          '—'
        )}
        <Text className="text-zinc-500 text-sm font-normal"> {unit}</Text>
      </Text>
      {target != null && (
        <>
          <AnimatedBar percent={p} color="#ffffff" height={4} style={{ marginTop: 12 }} />
          <Text className="text-zinc-500 text-xs mt-1.5 font-medium">{p}%</Text>
        </>
      )}
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
        <Text className="text-zinc-400 text-xs uppercase tracking-widest font-semibold">
          Hydration
        </Text>
        <Text className="text-sm text-zinc-400">
          <Text className="text-white font-bold text-base">{current.toLocaleString()}</Text>
          <Text className="text-zinc-500"> / {target.toLocaleString()}ml</Text>
        </Text>
      </View>

      <AnimatedBar percent={p} color="#38bdf8" height={8} style={{ marginBottom: 14 }} />

      <View className="flex-row gap-2">
        {WATER_PRESETS.map((ml) => (
          <PressableScale
            key={ml}
            onPress={() => handleLog(ml)}
            disabled={isPending}
            className="flex-1 py-3 rounded-xl bg-zinc-800 items-center"
            style={{ opacity: isPending ? 0.6 : 1 }}
          >
            <Text className="text-white text-sm font-semibold">+{ml}ml</Text>
          </PressableScale>
        ))}
      </View>
    </View>
  )
}

// ─── Weekly Race Card ─────────────────────────────────────────────────────────
//
// Replaces the old Sunday-Recap-headlines card. Two visual modes:
//   - Hero    (Sun-Mon): "WEEKLY RACE · NEW", winner name, crew + total stats,
//                        large Play button. The 'event' moment.
//   - Compact (Tue-Sat): single-line "Replay last week's race ▶". Stays
//                        available all week per the spec.
// Both tap → push '/weekly-recap' which opens the cinematic full-screen modal.

function WeeklyRaceCard() {
  const { data } = useQuery<RecapRaceData>({
    queryKey: ['friends-recap-race', 0],
    queryFn: () => api.get('/friends/recap/race?week_offset=0').then((r) => r.data),
  })

  // Query not resolved yet — the dashboard skeletons cover this moment.
  if (!data) return null

  const crew = data.crew
  const weekShort = formatWeekShort(data.week_start, data.week_end)
  const dow = new Date().getDay() // 0 = Sun, 1 = Mon
  const isHeroDay = dow === 0 || dow === 1

  // ── Solo (you only, no accepted friends) ────────────────────────────────
  // Nothing to race yet. The card stays visible as an invite entry point so
  // there's always a path into the feature.
  if (crew.length < 2) {
    return (
      <PressableScale
        haptic
        onPress={() => router.push('/friends')}
        style={{
          backgroundColor: '#18181b',
          borderColor: '#27272a',
          borderWidth: 1,
          borderRadius: 16,
          padding: 16,
        }}
      >
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-zinc-500 text-xs uppercase tracking-[2px]">
            Weekly Race
          </Text>
          <Text className="text-zinc-600 text-[10px]">{weekShort}</Text>
        </View>
        <Text className="text-white text-base font-semibold">
          Race your friends
        </Text>
        <Text className="text-zinc-500 text-xs mt-1">
          Add friends to see who moves the most weight each week.
        </Text>
        <View
          className="flex-row items-center justify-center gap-2 mt-3 py-2.5 rounded-xl"
          style={{ backgroundColor: '#27272a' }}
        >
          <UserPlus size={14} color="#fafafa" />
          <Text className="text-white text-sm font-semibold">Find friends</Text>
        </View>
      </PressableScale>
    )
  }

  // Winner = crew[0] (backend sorts by total_kg descending).
  const winner = crew[0]
  const totalCrewKg = crew.reduce((sum, m) => sum + m.total_kg, 0)

  // ── Quiet week (crew exists but nobody logged a lift) ───────────────────
  // Honest muted strip. Still tappable so the entry point always works —
  // the recap just animates flat lines.
  if (totalCrewKg === 0) {
    return (
      <PressableScale
        haptic
        onPress={() => router.push('/weekly-recap')}
        style={{
          backgroundColor: '#18181b',
          borderColor: '#27272a',
          borderWidth: 1,
          borderRadius: 16,
          paddingVertical: 12,
          paddingHorizontal: 16,
        }}
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <Play size={14} color="#71717a" fill="#71717a" />
            <Text className="text-zinc-400 text-sm font-medium">
              Quiet week — no lifts logged
            </Text>
          </View>
          <Text className="text-zinc-600 text-[10px]">{weekShort}</Text>
        </View>
      </PressableScale>
    )
  }

  if (isHeroDay) {
    return (
      <PressableScale
        haptic
        onPress={() => router.push('/weekly-recap')}
        style={{
          backgroundColor: '#18181b',
          borderColor: '#3f3f46',
          borderWidth: 1,
          borderRadius: 16,
          padding: 16,
        }}
      >
        <View className="flex-row items-center justify-between mb-3">
          <View className="flex-row items-center gap-2">
            <Text className="text-zinc-500 text-xs uppercase tracking-[2px]">
              Weekly Race
            </Text>
            <View
              className="px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: '#dc2626' }}
            >
              <Text className="text-white text-[9px] font-bold tracking-wider">
                NEW
              </Text>
            </View>
          </View>
          <Text className="text-zinc-600 text-[10px]">
            {formatWeekShort(data.week_start, data.week_end)}
          </Text>
        </View>

        <Text className="text-white text-base font-semibold">
          @{winner.username ?? winner.name} took the week
        </Text>
        <Text className="text-zinc-500 text-xs mt-1">
          {totalCrewKg.toLocaleString()} kg moved by crew of {data.crew.length}
        </Text>

        <View
          className="flex-row items-center justify-center gap-2 mt-3 py-2.5 rounded-xl"
          style={{ backgroundColor: '#fafafa' }}
        >
          <Play size={14} color="#000" fill="#000" />
          <Text className="text-black text-sm font-semibold">Watch</Text>
        </View>
      </PressableScale>
    )
  }

  // Tue-Sat compact "replay" treatment.
  return (
    <PressableScale
      haptic
      onPress={() => router.push('/weekly-recap')}
      style={{
        backgroundColor: '#18181b',
        borderColor: '#27272a',
        borderWidth: 1,
        borderRadius: 16,
        paddingVertical: 12,
        paddingHorizontal: 16,
      }}
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Play size={14} color="#fafafa" fill="#fafafa" />
          <Text className="text-white text-sm font-medium">
            Replay last week's race
          </Text>
        </View>
        <Text className="text-zinc-600 text-[10px]">
          {formatWeekShort(data.week_start, data.week_end)}
        </Text>
      </View>
    </PressableScale>
  )
}

function formatWeekShort(startISO: string, endISO: string): string {
  const s = new Date(startISO + 'T00:00:00')
  const e = new Date(endISO + 'T00:00:00')
  const sm = s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const em = e.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${sm} — ${em}`
}

// ─── Dashboard Screen ─────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const { user } = useRequireAuth()

  // Weekly Race card surfaces every day — the card itself switches between
  // hero (Sun-Mon) and compact (Tue-Sat) treatment.

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
            <Text className="text-zinc-400 text-xs uppercase tracking-widest font-semibold">
              {today}
            </Text>
            <Text className="text-white text-3xl font-bold mt-1.5">
              {getGreeting()}{firstName ? `, ${firstName}` : ''}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/settings')}
            hitSlop={12}
            className="mt-1 p-2 -mr-2"
          >
            <SettingsIcon color="#d4d4d8" size={26} />
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

            <WeeklyRaceCard />

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

            <StatTile
              label="Calories"
              value={summary?.calories_eaten}
              target={targets?.calorie_target}
              unit="kcal"
            />

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

            <HydrationQuickLog
              waterMl={summary?.water_ml ?? null}
              targetMl={targets?.water_target_ml ?? null}
            />

            <CaffeineCurve data={data?.caffeine} isLoading={false} />
          </View>
        )}
      </ScrollView>

      <UndoToast />
    </SafeAreaView>
  )
}