import { ActivityIndicator, ScrollView, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useAuthStore } from '../../store/auth'
import { useAdaptiveCalories, type EnergyEstimate } from '../../hooks/useAdaptiveCalories'
import { usePreferences, useSavePreferences } from '../../hooks/usePreferences'
import { formatNumber } from '../../lib/format'
import { hapticLight } from '../../lib/haptics'
import { useUnits, type Units } from '../../lib/units'
import { SettingsGroup } from '../../components/settings/SettingsGroup'
import { SettingsRow } from '../../components/settings/SettingsRow'
import { GOAL_LABEL, PACE_LABEL } from '../../components/settings/labels'
import { colors } from '../../theme/tokens'

// Settings → Calories: the target, the weekly suggestions switch, goal and
// pace, and how the app's burn estimate is worked out (backend
// services/energy.py, read through GET /calories/adaptive).

const kcal = (v: number | null | undefined) => (v != null ? `${formatNumber(v)} kcal` : '–')

function rateLabel(est: EnergyEstimate, u: Units): string | undefined {
  if (!est.rate_kg_week) return undefined
  return `About ${u.weightLabel(Math.abs(est.rate_kg_week))} a week`
}

function Breakdown({ est }: { est: EnergyEstimate }) {
  const u = useUnits()
  const burnDetail =
    est.measured_tdee == null
      ? 'From a formula until there are enough logs'
      : est.confidence >= 1
        ? 'From your food logs and weigh-ins'
        : `${Math.round(est.confidence * 100)}% from your logs, the rest from a formula`
  const logsDetail = `${est.logged_days} days of food logged, ${est.weigh_ins} weigh-ins in the last 4 weeks`
  const days =
    est.training_days_source === 'logged'
      ? `${formatNumber(est.training_days, 1)} training days a week logged in the last 4 weeks`
      : `${formatNumber(est.training_days)} training days a week, as you told us (your logs count after 2 weeks)`
  const formulaDetail =
    est.bmr_method === 'katch'
      ? `Lean mass at ${est.body_fat_pct}% body fat, ${days}`
      : `Age, height, weight, ${days}`
  const trend = est.weight_trend_kg_week
  const footer = [
    ...est.notes,
    est.floor != null && est.ceiling != null
      ? `Targets always stay between ${formatNumber(est.floor)} and ${formatNumber(est.ceiling)} kcal for you.`
      : null,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <SettingsGroup header="How it's worked out" footer={footer || undefined}>
      <SettingsRow title="Daily burn" detail={burnDetail} value={kcal(est.tdee)} />
      <SettingsRow
        title="From your logs"
        detail={est.measured_tdee == null ? `${logsDetail}. Needs 10 days and 4 weigh-ins over 2 weeks.` : logsDetail}
        value={est.measured_tdee != null ? kcal(est.measured_tdee) : 'Not yet'}
      />
      <SettingsRow title="From the formula" detail={formulaDetail} value={kcal(est.formula_tdee)} />
      {trend != null && (
        <SettingsRow
          title="Weight trend"
          value={`${trend > 0 ? '+' : trend < 0 ? '−' : ''}${u.weightLabel(Math.abs(trend))} a week`}
        />
      )}
      <SettingsRow title="Target for your goal" detail={rateLabel(est, u)} value={kcal(est.target_kcal)} />
    </SettingsGroup>
  )
}

export default function CaloriesScreen() {
  const user = useAuthStore((s) => s.user)
  const { data: prefs } = usePreferences()
  const savePrefs = useSavePreferences()
  const { data, isLoading } = useAdaptiveCalories()
  const edit = () => router.push({ pathname: '/settings/edit/[field]', params: { field: 'calories' } })
  const choose = (field: string) => router.push({ pathname: '/settings/choose/[field]', params: { field } })

  const enabled = prefs?.adaptive_calories ?? data?.enabled ?? true
  const available = data?.available ?? true
  const goal = prefs?.goal ?? null
  const footer = !available
    ? 'Calorie suggestions are off because of your age or a health answer. Talk to your doctor or a dietitian about changes.'
    : !goal
      ? 'Pick a goal to get weekly suggestions.'
      : enabled
        ? 'Each Monday GainRace checks your target against your weigh-ins, food logs, body fat and training, and offers a new one on Nutrition. Nothing changes until you accept it.'
        : 'Your target stays as it is. Typing your own number turns suggestions off.'

  return (
    <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} className="flex-1 bg-bg" contentContainerClassName="px-4 pt-4 pb-12" contentInsetAdjustmentBehavior="automatic">
      <SettingsGroup first footer={footer}>
        <SettingsRow title="Daily target" value={kcal(user?.calorie_target)} onPress={edit} />
        <SettingsRow
          title="Weekly suggestions"
          switchValue={available && enabled}
          disabled={!available || savePrefs.isPending}
          onSwitch={(v) => {
            hapticLight()
            savePrefs.mutate({ adaptive_calories: v })
          }}
        />
      </SettingsGroup>

      <SettingsGroup header="Goal">
        <SettingsRow title="Goal" value={goal ? GOAL_LABEL[goal] : 'Not set'} onPress={() => choose('goal')} />
        {(goal === 'cut' || goal === 'bulk') && (
          <SettingsRow title="Pace" value={PACE_LABEL[prefs?.pace ?? 'steady']} onPress={() => choose('pace')} />
        )}
      </SettingsGroup>

      {isLoading ? (
        <View className="mt-6 items-center">
          <ActivityIndicator color={colors['text-subtle']} />
        </View>
      ) : data?.estimate.tdee ? (
        <Breakdown est={data.estimate} />
      ) : null}

      <SettingsGroup>
        <SettingsRow title="How this works" onPress={() => router.push('/methodology/calories')} />
      </SettingsGroup>
    </ScrollView>
  )
}
