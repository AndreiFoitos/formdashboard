import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api } from '../../api/client'
import { useRequireAuth } from '../../hooks/useRequireAuth'
import { CountUp } from '../../components/CountUp'
import { AnimatedBar } from '../../components/AnimatedBar'
import { SwipeableRow } from '../../components/SwipeableRow'
import { useUnits } from '../../lib/units'
import { formatNumber } from '../../lib/format'
import { colors } from '../../theme/tokens'
import { SkeletonCard } from '../../components/Skeleton'
import { PressableScale } from '../../components/PressableScale'
import { hapticLight, hapticSuccess } from '../../lib/haptics'
import { router } from 'expo-router'
import { Play, UserPlus, Settings } from 'lucide-react-native'
import { AvatarBadge } from '../../components/avatar/AvatarBadge'
import { FEATURES } from '../../lib/featureFlags'
import { effectsForToday } from '../../lib/avatar/config'
import { useRewards } from '../../hooks/useRewards'
import { UnlockModal } from '../../components/avatar/UnlockModal'
import { AiDigest } from '../../components/AiDigest'
import { NotificationsCard } from '../../components/NotificationsCard'
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
      <View className="bg-surface border border-divider rounded-xl p-5" style={{ borderCurve: 'continuous' }}>
        <Text className="text-text-subtle text-caption mb-3">
          Form score
        </Text>
        <Text className="text-text font-semibold text-footnote">Calibrating…</Text>
        <Text className="text-text-subtle text-caption mt-1">
          Log 5 days in a row to activate your personalized form score.
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
    score >= 80 ? colors.score.high :
    score >= 60 ? colors.score.midHigh :
    score >= 40 ? colors.score.midLow : colors.score.low

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
    <View className="bg-surface border border-divider rounded-xl p-5" style={{ borderCurve: 'continuous' }}>
      <View className="flex-row items-center justify-between mb-4">
        <Text className="text-text-subtle text-caption">
          Form score
        </Text>
        <TouchableOpacity onPress={() => router.push('/trends')} hitSlop={10} className="flex-row items-center gap-1">
          <Text className="text-text-muted text-caption font-medium">Trends</Text>
          <Text className="text-text-subtle text-caption">›</Text>
        </TouchableOpacity>
      </View>
      <View className="flex-row items-center gap-5">
        <View
          className="w-20 h-20 rounded-full items-center justify-center border-2"
          style={{ borderCurve: 'continuous', borderColor: color }}
        >
          <CountUp value={score} className="text-text text-display font-bold" />
        </View>

        <View className="flex-1">
          <Text className="text-text font-semibold text-headline">{label}</Text>
          <Text className="text-text-muted text-footnote mt-1">{subtitle}</Text>
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
    <View className="bg-surface border border-divider rounded-xl p-4 flex-1" style={{ borderCurve: 'continuous' }}>
      <Text className="text-text-muted text-caption mb-2 font-semibold">
        {label}
      </Text>
      <Text className="text-text font-bold text-title">
        {value != null ? (
          <CountUp
            value={Math.round(value)}
            separator
            className="text-text font-bold text-title"
          />
        ) : (
          '—'
        )}
        <Text className="text-text-subtle text-footnote font-normal"> {unit}</Text>
      </Text>
      {target != null && (
        <>
          <View className="mt-3">
            <AnimatedBar percent={p} color={colors.accent} height={4} />
          </View>
          <Text className="text-text-subtle text-caption mt-2 font-medium">{p}%</Text>
        </>
      )}
    </View>
  )
}

// ─── Hydration Quick Log ──────────────────────────────────────────────────────

// Presets per unit system; imperial ones are 8/16/24 fl oz.
const WATER_PRESETS = { metric: [250, 500, 750], imperial: [8, 16, 24] } as const

interface HydrationEntry {
  id: string
  amount_ml: number
  source: string
  logged_at: string
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function HydrationQuickLog({
  waterMl,
  targetMl,
}: {
  waterMl: number | null
  targetMl: number | null
}) {
  const u = useUnits()
  const qc = useQueryClient()
  // Entries were never listed here, so once the undo toast expired a mistyped
  // log was permanent. Collapsed by default to keep the card compact.
  const [showLog, setShowLog] = useState(false)

  const todayQ = useQuery<{ entries: HydrationEntry[] }>({
    queryKey: ['hydration-today'],
    queryFn: () => api.get('/hydration/today').then((r) => r.data),
    enabled: showLog,
  })

  const removeEntry = useMutation({
    mutationFn: (id: string) => api.delete(`/hydration/${id}`),
    onSuccess: () => {
      hapticSuccess()
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['hydration-today'] })
    },
  })

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
      qc.invalidateQueries({ queryKey: ['hydration-today'] })
      showUndo({
        label: `+${u.waterLabel(ml)} water`,
        onUndo: async () => {
          await api.delete(`/hydration/${entry.id}`)
          qc.invalidateQueries({ queryKey: ['dashboard'] })
          qc.invalidateQueries({ queryKey: ['hydration-today'] })
        },
      })
    } catch {
      // Rollback the optimistic bump on failure.
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    }
  }

  return (
    <View className="bg-surface border border-divider rounded-xl p-4" style={{ borderCurve: 'continuous' }}>
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-text-muted text-caption font-semibold">
          Hydration
        </Text>
        <Text className="text-footnote text-text-muted">
          <Text className="text-text font-bold text-body">{formatNumber(u.water(current))}</Text>
          <Text className="text-text-subtle"> / {u.waterLabel(target)}</Text>
        </Text>
      </View>

      <View className="mb-4">
        <AnimatedBar percent={p} color={colors.data.water} height={8} />
      </View>

      <View className="flex-row gap-2">
        {WATER_PRESETS[u.system].map((amount) => (
          <PressableScale
            key={amount}
            onPress={() => handleLog(u.waterToMl(amount))}
            disabled={isPending}
            className="flex-1 py-3 rounded-md bg-surface-raised items-center"
            style={{ borderCurve: 'continuous', opacity: isPending ? 0.6 : 1 }}
          >
            <Text className="text-text text-footnote font-semibold">+{amount} {u.waterUnit}</Text>
          </PressableScale>
        ))}
      </View>

      {/* Today's entries — swipe any row to delete it, for when the undo
          toast has already gone. */}
      <TouchableOpacity
        onPress={() => setShowLog((v: boolean) => !v)}
        className="mt-3 pt-3 border-t border-divider"
        accessibilityRole="button"
        accessibilityState={{ expanded: showLog }}
      >
        <Text className="text-text-subtle text-caption">
          {showLog ? 'Hide today’s log ▾' : 'Today’s log ▸'}
        </Text>
      </TouchableOpacity>

      {showLog && (
        <View className="mt-2 rounded-xl overflow-hidden border border-divider" style={{ borderCurve: 'continuous' }}>
          {(todayQ.data?.entries ?? []).length === 0 ? (
            <Text className="text-text-subtle text-caption px-3 py-3">
              {todayQ.isLoading ? 'Loading…' : 'Nothing logged yet today.'}
            </Text>
          ) : (
            (todayQ.data?.entries ?? []).map((entry, i, arr) => (
              <SwipeableRow key={entry.id} onDelete={() => removeEntry.mutate(entry.id)}>
                <View
                  className="flex-row items-center justify-between bg-surface px-3 py-3"
                  style={{
                    borderBottomWidth: i === arr.length - 1 ? 0 : 1,
                    borderBottomColor: colors.divider,
                  }}
                >
                  <Text className="text-text-muted text-caption">
                    {u.waterLabel(entry.amount_ml)}
                    {entry.source && entry.source !== 'water'
                      ? ` · ${entry.source.replace(/_/g, ' ')}`
                      : ''}
                  </Text>
                  <Text className="text-text-subtle text-caption">{timeLabel(entry.logged_at)}</Text>
                </View>
              </SwipeableRow>
            ))
          )}
        </View>
      )}
    </View>
  )
}

// ─── Weekly Race Card ─────────────────────────────────────────────────────────
//
// Replaces the old Sunday-Recap-headlines card. Two visual modes:
//   - Hero    (Sun-Mon): "Weekly race · New", winner name, crew + total stats,
//                        large Play button. The 'event' moment.
//   - Compact (Tue-Sat): single-line "Replay last week's race ▶". Stays
//                        available all week per the spec.
// Both tap → push '/weekly-recap' which opens the cinematic full-screen modal.

function WeeklyRaceCard() {
  const u = useUnits()
  const { data, isLoading, isError, refetch } = useQuery<RecapRaceData>({
    queryKey: ['friends-recap-race', 0],
    queryFn: () => api.get('/friends/recap/race?week_offset=0').then((r) => r.data),
  })

  // A failed fetch used to fall through the `!data` check and render nothing
  // at all, so the race card simply disappeared with no way to tell whether
  // the feature was broken, empty, or hidden on purpose. Say so instead.
  if (isError) {
    return (
      <PressableScale
        haptic
        onPress={() => refetch()}
        className="bg-surface border border-divider rounded-xl p-4" style={{ borderCurve: 'continuous' }}
      >
        <Text className="text-text-subtle text-caption mb-2">
          Weekly race
        </Text>
        <Text className="text-text-muted text-footnote">
          Couldn't load this week's race. Tap to retry.
        </Text>
      </PressableScale>
    )
  }

  // Query not resolved yet — the dashboard skeletons cover this moment.
  if (isLoading || !data) return null

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
        className="bg-surface border border-divider rounded-xl p-4" style={{ borderCurve: 'continuous' }}
      >
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-text-subtle text-caption">
            Weekly race
          </Text>
          <Text className="text-text-subtle text-caption">{weekShort}</Text>
        </View>
        <Text className="text-text text-body font-semibold">
          Race your friends
        </Text>
        <Text className="text-text-subtle text-caption mt-1">
          Add friends to see who moves the most weight each week.
        </Text>
        <View
          className="flex-row items-center justify-center gap-2 mt-3 py-3 rounded-md"
          style={{ borderCurve: 'continuous', backgroundColor: colors['surface-raised'] }}
        >
          <UserPlus size={14} color={colors.text} />
          <Text className="text-text text-footnote font-semibold">Find friends</Text>
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
        className="bg-surface border border-divider rounded-xl px-4 py-3" style={{ borderCurve: 'continuous' }}
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <Play size={14} color={colors['text-subtle']} fill={colors['text-subtle']} />
            <Text className="text-text-muted text-footnote font-medium">
              Quiet week — no lifts logged
            </Text>
          </View>
          <Text className="text-text-subtle text-caption">{weekShort}</Text>
        </View>
      </PressableScale>
    )
  }

  if (isHeroDay) {
    return (
      <PressableScale
        haptic
        onPress={() => router.push('/weekly-recap')}
        className="bg-surface border border-border rounded-xl p-4" style={{ borderCurve: 'continuous' }}
      >
        <View className="flex-row items-center justify-between mb-3">
          <View className="flex-row items-center gap-2">
            <Text className="text-text-subtle text-caption">
              Weekly race
            </Text>
            <View
              className="px-2 py-1 rounded-full"
              style={{ borderCurve: 'continuous', backgroundColor: colors.accent }}
            >
              <Text className="text-on-accent text-caption font-bold">
                New
              </Text>
            </View>
          </View>
          <Text className="text-text-subtle text-caption">
            {formatWeekShort(data.week_start, data.week_end)}
          </Text>
        </View>

        <Text className="text-text text-body font-semibold">
          @{winner.username ?? winner.name} took the week
        </Text>
        <Text className="text-text-subtle text-caption mt-1">
          {u.weightLabel(totalCrewKg, 0)} moved by crew of {data.crew.length}
        </Text>

        <View
          className="flex-row items-center justify-center gap-2 mt-3 py-3 rounded-md"
          style={{ borderCurve: 'continuous', backgroundColor: colors.accent }}
        >
          <Play size={14} color={colors['on-accent']} fill={colors['on-accent']} />
          <Text className="text-on-accent text-footnote font-semibold">Watch</Text>
        </View>
      </PressableScale>
    )
  }

  // Tue-Sat compact "replay" treatment.
  return (
    <PressableScale
      haptic
      onPress={() => router.push('/weekly-recap')}
      className="bg-surface border border-divider rounded-xl px-4 py-3" style={{ borderCurve: 'continuous' }}
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Play size={14} color={colors.text} fill={colors.text} />
          <Text className="text-text text-footnote font-medium">
            Replay last week's race
          </Text>
        </View>
        <Text className="text-text-subtle text-caption">
          {formatWeekShort(data.week_start, data.week_end)}
        </Text>
      </View>
    </PressableScale>
  )
}

/** The recap covers the last completed Mon–Sun week (backend
 *  `_recap_week_bounds`): on Sunday that's this week, otherwise last week.
 *  Say which, so "Sep 28 – Oct 4" on a Tuesday doesn't read as a wrong range. */
function formatWeekShort(startISO: string, endISO: string): string {
  const s = new Date(startISO + 'T00:00:00')
  const e = new Date(endISO + 'T00:00:00')
  const sm = s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const em = e.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const which = e.getTime() >= today.getTime() ? 'This week' : 'Last week'
  return `${which} · ${sm} – ${em}`
}

// ─── Dashboard Screen ─────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const u = useUnits()
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
  const avatarEffects = useMemo(
    () => effectsForToday(summary, targets?.water_target_ml),
    [summary?.trained, summary?.water_ml, summary?.caffeine_mg, targets?.water_target_ml],
  )

  // Combos are recorded by the rewards endpoint, so re-sync whenever today's
  // logged numbers change (e.g. after logging water or a workout).
  const rewards = useRewards()
  const summaryKey = summary
    ? [summary.trained, summary.water_ml, summary.caffeine_mg, summary.protein_g, summary.calories_eaten].join('|')
    : ''
  useEffect(() => {
    if (FEATURES.avatar && summaryKey) rewards.refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryKey])

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="px-4 pb-6"
        // Pull-to-refresh — not available in the web version but expected on mobile
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={onRefresh}
            tintColor={colors.text}
          />
        }
      >
        {/* Header */}
        <View className="pt-6 pb-5 flex-row items-start justify-between">
          {FEATURES.avatar && (
            <View className="mr-3 mt-1">
              <AvatarBadge
                size={48}
                effects={avatarEffects}
                todayCombos={rewards.data?.today.combos}
                champion={rewards.data?.champion}
                onPress={() => router.push('/avatar-edit')}
              />
            </View>
          )}
          <View className="flex-1">
            <Text className="text-text-muted text-caption font-semibold">
              {today}
            </Text>
            <Text className="text-text text-title font-bold mt-2">
              {getGreeting()}{firstName ? `, ${firstName}` : ''}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/settings')}
            hitSlop={12}
            className="mt-1 p-2 -mr-2"
            accessibilityLabel="Settings"
          >
            <Settings color={colors.text} size={24} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        <NotificationsCard />

        {isLoading ? (
          <View className="gap-3">
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
          <View className="gap-3">
            <FormScoreCard summary={summary} />

            <WeeklyRaceCard />

            {/* 2-column stat grid */}
            <View className="flex-row gap-3">
              <StatTile
                label="Water"
                value={summary?.water_ml != null ? u.water(summary.water_ml) : null}
                target={targets?.water_target_ml != null ? u.water(targets.water_target_ml) : null}
                unit={u.waterUnit}
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
              <View className="flex-row items-center gap-3 bg-surface border border-divider rounded-xl px-4 py-3" style={{ borderCurve: 'continuous' }}>
                <View className="w-2 h-2 rounded-full bg-success" style={{ borderCurve: 'continuous' }} />
                <Text className="text-text-muted text-footnote">
                  Trained today
                  {summary.training_type ? (
                    <Text className="text-text-subtle"> · {summary.training_type}</Text>
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
      {FEATURES.avatar && <UnlockModal items={rewards.data?.new ?? []} />}
    </SafeAreaView>
  )
}