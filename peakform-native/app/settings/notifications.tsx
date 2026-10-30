import { ActivityIndicator, ScrollView, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { api } from '../../api/client'
import { useReminderSettings, useSetReminder, type LearnedHabits, type ReminderSettings } from '../../hooks/useNotificationSettings'
import { formatNumber } from '../../lib/format'
import { hapticLight } from '../../lib/haptics'
import { useUnits, type Units } from '../../lib/units'
import { SettingsGroup } from '../../components/settings/SettingsGroup'
import { SettingsRow } from '../../components/settings/SettingsRow'
import { minuteLabel } from '../../components/settings/labels'
import { colors } from '../../theme/tokens'

// Settings → Reminders: a switch per kind of reminder, and the habits they
// are timed by (backend services/behavior.py, read through
// GET /notifications/settings). The water and coffee times come from the
// older /notifications/patterns.

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MEAL_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' }

interface PatternSlot {
  log_type: 'hydration' | 'stimulant'
  weekday: number
  slot_minute: number
  suggested_amount_ml: number | null
  suggested_substance: string | null
  suggested_caffeine_mg: number | null
}

function slotSummary(s: PatternSlot, u: Units): string {
  if (s.log_type === 'hydration') {
    return s.suggested_amount_ml ? `${formatNumber(u.water(s.suggested_amount_ml))} ${u.waterUnit} water` : 'Water'
  }
  const label = s.suggested_substance
    ? s.suggested_substance.charAt(0).toUpperCase() + s.suggested_substance.slice(1)
    : 'Coffee'
  return s.suggested_caffeine_mg ? `${label} (${s.suggested_caffeine_mg} mg)` : label
}

function everyLabel(days: number): string {
  if (days <= 1) return 'Daily'
  if (days >= 6) return 'Weekly'
  return `Every ${formatNumber(days)} days`
}

function pausedDetail(description: string, until: string | null): string {
  if (!until) return description
  const date = new Date(until).toLocaleDateString(undefined, { weekday: 'long' })
  return `Paused until ${date}: the last few went unopened. ${description}`
}

function Learned({ habits }: { habits: LearnedHabits }) {
  const { meals, training, weigh_in } = habits
  const empty = meals.length === 0 && !training && !weigh_in
  return (
    <SettingsGroup
      header="What the app has learned"
      footer="From your last 4 weeks of logs. Reminders only cover things you usually do, and only once you're later than usual."
    >
      {empty ? (
        <Text className="text-text-subtle text-footnote px-4 py-3">
          Not enough logs yet. After a week or two of regular logging, your usual times show up here.
        </Text>
      ) : (
        <>
          {meals.map((m) => (
            <SettingsRow
              key={m.meal}
              title={MEAL_LABEL[m.meal]}
              detail={`Reminder after ${minuteLabel(m.remind_minute)} if it's not logged`}
              value={`About ${minuteLabel(m.usual_minute)}`}
            />
          ))}
          {training && (
            <SettingsRow
              title="Training"
              detail={
                training.weekdays.length
                  ? training.weekdays.map((d) => WEEKDAY_SHORT[d]).join(', ')
                  : `${training.sessions} sessions in 4 weeks, no fixed days`
              }
              value={`About ${minuteLabel(training.start_minute)}`}
            />
          )}
          {weigh_in && (
            <SettingsRow title="Weigh-in" detail={everyLabel(weigh_in.every_days)} value={`About ${minuteLabel(weigh_in.usual_minute)}`} />
          )}
        </>
      )}
    </SettingsGroup>
  )
}

function WaterCoffeeTimes() {
  const u = useUnits()
  const { data: slots, isLoading } = useQuery<PatternSlot[]>({
    queryKey: ['notif-patterns'],
    queryFn: () => api.get('/notifications/patterns').then((r) => r.data),
  })
  // A preview, not the full list.
  const preview = (slots ?? []).slice(0, 6)
  return (
    <SettingsGroup header="Water and coffee times">
      {isLoading ? (
        <View className="py-3 items-center">
          <ActivityIndicator color={colors['text-subtle']} />
        </View>
      ) : preview.length === 0 ? (
        <Text className="text-text-subtle text-footnote px-4 py-3">
          Not enough log history yet. Times appear after about 3 weeks of regular logging.
        </Text>
      ) : (
        preview.map((s) => (
          <SettingsRow
            key={`${s.log_type}-${s.weekday}-${s.slot_minute}`}
            title={`${WEEKDAY_SHORT[s.weekday]} ${minuteLabel(s.slot_minute)}`}
            value={slotSummary(s, u)}
          />
        ))
      )}
    </SettingsGroup>
  )
}

function Switches({ data }: { data: ReminderSettings }) {
  const set = useSetReminder()
  return (
    <SettingsGroup
      first
      footer="At most 3 a day, never before 8:00 AM or in the hour before your bedtime. A kind you keep ignoring pauses for a week by itself."
    >
      {data.categories.map((c) => (
        <SettingsRow
          key={c.key}
          title={c.title}
          detail={c.enabled ? pausedDetail(c.description, c.paused_until) : c.description}
          switchValue={c.enabled}
          onSwitch={(enabled) => {
            hapticLight()
            set.mutate({ key: c.key, enabled })
          }}
        />
      ))}
    </SettingsGroup>
  )
}

export default function RemindersScreen() {
  const { data, isLoading } = useReminderSettings()
  const waterCoffeeOn = data?.categories.find((c) => c.key === 'water_coffee')?.enabled ?? true
  return (
    <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} className="flex-1 bg-bg" contentContainerClassName="px-4 pt-4 pb-12" contentInsetAdjustmentBehavior="automatic">
      {isLoading || !data ? (
        <View className="mt-6 items-center">
          <ActivityIndicator color={colors['text-subtle']} />
        </View>
      ) : (
        <>
          <Switches data={data} />
          <Learned habits={data.habits} />
          {waterCoffeeOn && <WaterCoffeeTimes />}
          <SettingsGroup>
            <SettingsRow title="How reminders work" onPress={() => router.push('/methodology/reminders')} />
          </SettingsGroup>
        </>
      )}
    </ScrollView>
  )
}
