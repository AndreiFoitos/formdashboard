import { useState } from 'react'
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { Check, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react-native'
import {
  WEEKDAYS,
  useBuildPlan,
  useLogPlanMeal,
  usePitPlan,
  usePitToday,
  type Plan,
  type Today,
  type TodayExercise,
} from '../../hooks/usePitCrew'
import { usePreferences } from '../../hooks/usePreferences'
import { openPaywall, usePlan, type ScanUsage } from '../../hooks/usePlan'
import { useExerciseName } from '../../hooks/useExerciseName'
import { EXERCISE_NAME } from '../../lib/exercises'
import { hapticLight } from '../../lib/haptics'
import { ExerciseLogSheet } from './ExerciseLogSheet'

// The Plan segment of the Pit tab: build a plan, then today's workout and
// meals from it. docs/ai-plans-design.md §2.

const SLOT_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <View className={`bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden ${className}`}>{children}</View>
  )
}

function SectionLabel({ children }: { children: string }) {
  return <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">{children}</Text>
}

function quotaLabel(u?: ScanUsage): string | null {
  if (!u) return null
  if (u.window === 'ever') return u.remaining > 0 ? 'Your free plan build' : 'Free plan build used'
  const period = u.window === 'day' ? 'today' : 'this week'
  return `${u.remaining} of ${u.limit} builds left ${period}`
}

// ─── Build button + states ────────────────────────────────────────────────────

function BuildButton({ label, rebuild }: { label: string; rebuild?: boolean }) {
  const build = useBuildPlan()
  const { data: billing } = usePlan()
  const usage = billing?.scans.plan
  const out = usage != null && usage.remaining <= 0

  function start() {
    if (out) return openPaywall('plan')
    const go = () => build.mutate()
    if (rebuild) {
      Alert.alert('Build a new plan?', 'Your current plan will be replaced. It takes a minute or two.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Build', onPress: go },
      ])
    } else go()
  }

  return (
    <View className="items-center">
      <TouchableOpacity
        onPress={start}
        disabled={build.isPending}
        className={`w-full rounded-2xl py-4 items-center ${rebuild ? 'bg-zinc-900 border border-zinc-800' : 'bg-white'}`}
        style={{ opacity: build.isPending ? 0.5 : 1 }}
      >
        {build.isPending ? (
          <ActivityIndicator color={rebuild ? 'white' : 'black'} />
        ) : (
          <Text className={`font-semibold text-base ${rebuild ? 'text-white' : 'text-black'}`}>
            {out ? 'Upgrade for more plans' : label}
          </Text>
        )}
      </TouchableOpacity>
      {quotaLabel(usage) && <Text className="text-zinc-600 text-xs mt-2">{quotaLabel(usage)}</Text>}
    </View>
  )
}

function Intro() {
  const { data: prefs } = usePreferences()
  const missing = prefs && (!prefs.equipment || !prefs.experience || prefs.health_flags === null)
  return (
    <View style={{ gap: 16 }}>
      <Card className="p-5">
        <Text className="text-white text-xl font-bold">Your week, built by your crew</Text>
        <View style={{ gap: 10 }} className="mt-4">
          {[
            'Training from your lifts, equipment and injuries',
            'Meals from foods you already eat, at your calorie target',
            'Weights that go up as you hit your reps',
          ].map((t) => (
            <View key={t} className="flex-row items-start" style={{ gap: 10 }}>
              <Check size={16} color="#a3e635" strokeWidth={3} style={{ marginTop: 2 }} />
              <Text className="text-zinc-300 text-sm flex-1">{t}</Text>
            </View>
          ))}
        </View>
      </Card>
      {missing && (
        <TouchableOpacity onPress={() => router.push('/preferences')}>
          <Card className="p-4 flex-row items-center">
            <View className="flex-1 pr-3">
              <Text className="text-white text-sm font-medium">Tell your crew about you first</Text>
              <Text className="text-zinc-500 text-xs mt-0.5">Equipment, experience, diet and allergies. About a minute.</Text>
            </View>
            <ChevronRight size={18} color="#71717a" />
          </Card>
        </TouchableOpacity>
      )}
      <BuildButton label="Build my plan" />
    </View>
  )
}

function Building() {
  return (
    <Card className="p-5 items-center">
      <ActivityIndicator color="white" />
      <Text className="text-white text-base font-semibold mt-3">Your crew is building your plan</Text>
      <Text className="text-zinc-500 text-sm text-center mt-1">
        Usually a minute or two. You'll get a notification when it's ready.
      </Text>
    </Card>
  )
}

// ─── Today ────────────────────────────────────────────────────────────────────

function ExerciseRow({
  ex,
  name,
  last,
  onPress,
}: {
  ex: TodayExercise
  name: string
  last: boolean
  onPress: () => void
}) {
  const done = ex.logged_today.length > 0
  const w = ex.suggestion.weight_kg
  return (
    <TouchableOpacity
      onPress={onPress}
      className="px-4 py-3 flex-row items-center"
      style={{ borderBottomWidth: last ? 0 : 1, borderBottomColor: '#27272a' }}
    >
      <View className="flex-1 pr-3">
        <Text className={`text-sm font-medium ${done ? 'text-zinc-500' : 'text-white'}`}>{name}</Text>
        <Text className="text-zinc-500 text-xs mt-0.5">
          {ex.sets} × {ex.reps_min === ex.reps_max ? ex.reps_max : `${ex.reps_min}–${ex.reps_max}`}
          {w != null ? ` · ${w} kg` : ex.basis === 'bodyweight' ? ' · bodyweight' : ''}
        </Text>
      </View>
      {done ? (
        <View className="flex-row items-center" style={{ gap: 4 }}>
          <Check size={16} color="#a3e635" strokeWidth={3} />
          <Text className="text-lime-400 text-xs font-medium">{ex.logged_today.length} sets</Text>
        </View>
      ) : (
        <View className="bg-white rounded-full px-3 py-1.5">
          <Text className="text-black text-xs font-semibold">Log</Text>
        </View>
      )}
    </TouchableOpacity>
  )
}

function MealRow({ meal, last }: { meal: Today['meals'][number]; last: boolean }) {
  const [open, setOpen] = useState(false)
  const log = useLogPlanMeal()

  function toggleLogged() {
    hapticLight()
    if (meal.logged) {
      Alert.alert('Remove this meal from today?', 'Its entries will be deleted from your food log.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => log.mutate({ id: meal.id, undo: true }) },
      ])
    } else {
      log.mutate({ id: meal.id }, { onError: () => Alert.alert("Couldn't log that meal", 'Please try again.') })
    }
  }

  return (
    <View style={{ borderBottomWidth: last ? 0 : 1, borderBottomColor: '#27272a' }}>
      <View className="px-4 py-3 flex-row items-center">
        <TouchableOpacity className="flex-1 pr-3" onPress={() => setOpen((o) => !o)}>
          <Text className="text-zinc-500 text-[11px] uppercase tracking-wider">{SLOT_LABEL[meal.slot]}</Text>
          <Text className={`text-sm font-medium mt-0.5 ${meal.logged ? 'text-zinc-500' : 'text-white'}`}>{meal.name}</Text>
          <View className="flex-row items-center mt-0.5" style={{ gap: 4 }}>
            <Text className="text-zinc-500 text-xs">
              {meal.totals.calories} kcal · {Math.round(meal.totals.protein_g)} g protein
            </Text>
            {open ? <ChevronUp size={12} color="#71717a" /> : <ChevronDown size={12} color="#71717a" />}
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={toggleLogged}
          disabled={log.isPending}
          hitSlop={8}
          className={`rounded-full px-3 py-1.5 ${meal.logged ? 'bg-zinc-800' : 'bg-white'}`}
        >
          {log.isPending ? (
            <ActivityIndicator size="small" color={meal.logged ? 'white' : 'black'} />
          ) : meal.logged ? (
            <View className="flex-row items-center" style={{ gap: 4 }}>
              <Check size={14} color="#a3e635" strokeWidth={3} />
              <Text className="text-lime-400 text-xs font-semibold">Logged</Text>
            </View>
          ) : (
            <Text className="text-black text-xs font-semibold">Log</Text>
          )}
        </TouchableOpacity>
      </View>
      {open && (
        <View className="px-4 pb-3" style={{ gap: 4 }}>
          {meal.items.map((i) => (
            <View key={i.food} className="flex-row justify-between">
              <Text className="text-zinc-400 text-xs flex-1 pr-2">
                {i.food} · {i.grams} g
              </Text>
              <Text className="text-zinc-500 text-xs">{i.calories} kcal</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

function TodayCard({ today, plan }: { today: Today; plan: Plan }) {
  const displayName = useExerciseName(EXERCISE_NAME)
  const [logging, setLogging] = useState<TodayExercise | null>(null)
  const w = today.workout
  const loggedKcal = today.meals.filter((m) => m.logged).reduce((n, m) => n + m.totals.calories, 0)

  return (
    <View style={{ gap: 16 }}>
      <View>
        <SectionLabel>{`Today · ${WEEKDAYS[today.weekday]}`}</SectionLabel>
        {w ? (
          <Card>
            <View className="px-4 pt-4 pb-3 border-b border-zinc-800">
              <Text className="text-white text-base font-semibold">{w.name}</Text>
              {!!w.focus && <Text className="text-zinc-500 text-xs mt-0.5">{w.focus}</Text>}
            </View>
            {w.exercises.map((ex, i) => (
              <ExerciseRow
                key={ex.key}
                ex={ex}
                name={displayName(ex.key)}
                last={i === w.exercises.length - 1}
                onPress={() => setLogging(ex)}
              />
            ))}
          </Card>
        ) : (
          <Card className="p-4">
            <Text className="text-white text-base font-semibold">Rest day</Text>
            {today.next_workout && (
              <Text className="text-zinc-500 text-sm mt-1">
                Next: {today.next_workout.name} on {WEEKDAYS[today.next_workout.weekday]}.
              </Text>
            )}
          </Card>
        )}
      </View>

      {today.meals.length > 0 && today.targets && (
        <View>
          <View className="flex-row items-end justify-between mb-2">
            <Text className="text-zinc-500 text-xs uppercase tracking-widest">Meals</Text>
            <Text className="text-zinc-500 text-xs">
              {loggedKcal} / {today.targets.kcal} kcal logged from plan
            </Text>
          </View>
          <Card>
            {today.meals.map((m, i) => (
              <MealRow key={m.id} meal={m} last={i === today.meals.length - 1} />
            ))}
          </Card>
        </View>
      )}

      {!plan.meal_plan_enabled && (
        <Card className="p-4">
          <Text className="text-zinc-300 text-sm">
            Meal plans are off because of one of your health answers. Food changes are best made with your doctor
            or a dietitian, so your crew plans your training only.
          </Text>
        </Card>
      )}

      {logging && (
        <ExerciseLogSheet exercise={logging} name={displayName(logging.key)} onClose={() => setLogging(null)} />
      )}
    </View>
  )
}

// ─── Why this plan ────────────────────────────────────────────────────────────

function WhyCard({ plan }: { plan: Plan }) {
  const [open, setOpen] = useState(false)
  const t = plan.targets
  return (
    <Card>
      <TouchableOpacity onPress={() => setOpen((o) => !o)} className="px-4 py-4 flex-row items-center justify-between">
        <Text className="text-white text-sm font-medium">Why this plan?</Text>
        {open ? <ChevronUp size={18} color="#71717a" /> : <ChevronDown size={18} color="#71717a" />}
      </TouchableOpacity>
      {open && (
        <View className="px-4 pb-4" style={{ gap: 10 }}>
          <Text className="text-zinc-300 text-sm leading-6">{plan.rationale}</Text>
          {plan.meal_plan_enabled && (
            <Text className="text-zinc-500 text-xs leading-5">
              Daily target {t.kcal} kcal, {t.protein_g} g protein, {t.carbs_g} g carbs, {t.fat_g} g fat
              {t.tdee ? `. Estimated maintenance ${t.tdee} kcal (${t.tdee_source === 'measured' ? 'from your logs and weigh-ins' : 'from a formula'}).` : '.'}
            </Text>
          )}
          {[...t.notes, ...t.warnings].map((n) => (
            <Text key={n} className="text-amber-400 text-xs">{n}</Text>
          ))}
        </View>
      )}
    </Card>
  )
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function PlanPanel() {
  const state = usePitPlan()
  const plan = state.data?.plan ?? null
  const today = usePitToday(plan?.id)

  const refreshing = state.isRefetching || today.isRefetching
  function refresh() {
    state.refetch()
    if (plan) today.refetch()
  }

  return (
    <ScrollView
      className="flex-1 px-4"
      contentContainerStyle={{ paddingBottom: 40, gap: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#71717a" />}
    >
      {state.isLoading ? (
        <ActivityIndicator color="#71717a" style={{ marginTop: 40 }} />
      ) : (
        <>
          {state.data?.building && <Building />}
          {state.data?.last_error && (
            <Card className="p-4 border-red-900">
              <Text className="text-red-400 text-sm">{state.data.last_error}</Text>
            </Card>
          )}
          {!plan && !state.data?.building && <Intro />}
          {plan && (
            <>
              {today.data ? (
                <TodayCard today={today.data} plan={plan} />
              ) : (
                <ActivityIndicator color="#71717a" style={{ marginTop: 24 }} />
              )}
              <TouchableOpacity onPress={() => router.push('/plan-week')}>
                <Card className="px-4 py-4 flex-row items-center justify-between">
                  <View>
                    <Text className="text-white text-sm font-medium">This week</Text>
                    <Text className="text-zinc-500 text-xs mt-0.5">
                      {plan.plan.days_per_week} training days{plan.meal_plan_enabled ? ' and every meal' : ''}
                    </Text>
                  </View>
                  <ChevronRight size={18} color="#71717a" />
                </Card>
              </TouchableOpacity>
              <WhyCard plan={plan} />
              {!state.data?.building && <BuildButton label="Build a new plan" rebuild />}
            </>
          )}
          <Text className="text-zinc-600 text-[11px] leading-4 text-center px-2">
            Pit Crew plans are general fitness guidance, not medical advice. Talk to a doctor before big changes to
            how you eat or train, especially with a health condition.
          </Text>
        </>
      )}
    </ScrollView>
  )
}
