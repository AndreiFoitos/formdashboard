import { useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { api } from '../../api/client'
import {
  useReminderCheck,
  useReminderSettings,
  useSendTestReminder,
  useSetReminder,
  type LearnedHabits,
  type ReminderCheck,
  type ReminderSettings,
  type TestKind,
} from '../../hooks/useNotificationSettings'
import { extractErrorMessage } from '../../lib/apiError'
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

// ─── Testing (accounts in the backend's REMINDER_TESTERS only) ────────────────

const TEST_ROWS: { kind: TestKind; title: string }[] = [
  { kind: 'meal', title: 'Meal not logged' },
  { kind: 'workout_preview', title: 'Training targets' },
  { kind: 'workout_log', title: 'Log your sets' },
  { kind: 'protein', title: 'Protein check' },
  { kind: 'weigh_in', title: 'Weigh-in' },
  { kind: 'comeback', title: 'After a break' },
]

const STATUS_LABEL: Record<ReminderCheck['checks'][number]['status'], string> = {
  due: 'Due now',
  waiting: 'Not now',
  off: 'Off',
  paused: 'Paused',
  sent: 'Sent today',
}

function TestTools() {
  const check = useReminderCheck(true)
  const send = useSendTestReminder()
  const [sending, setSending] = useState<TestKind | null>(null)

  function sendTest(kind: TestKind) {
    hapticLight()
    setSending(kind)
    send.mutate(kind, {
      onSuccess: (r) => Alert.alert('Sent', `"${r.title}" should arrive in a few seconds. Tap it to check where it opens.`),
      onError: (e) => Alert.alert("Couldn't send", extractErrorMessage(e, 'Please try again.')),
      onSettled: () => setSending(null),
    })
  }

  const data = check.data
  return (
    <>
      <SettingsGroup
        header="Testing: send a test"
        footer="Sends that reminder to this phone right away, with your own numbers where there are any. Tests don't count towards the daily limit."
      >
        {TEST_ROWS.map((t) => (
          <SettingsRow key={t.kind} title={t.title} value="Send" loading={sending === t.kind} onPress={() => sendTest(t.kind)} />
        ))}
      </SettingsGroup>

      <SettingsGroup
        header="Testing: what would fire now"
        footer={data ? `Your time: ${data.local_time} (${data.timezone}). Sent today: ${data.sent_today} of 3. The server checks every 15 minutes.` : undefined}
      >
        {check.isLoading ? (
          <View className="py-3 items-center">
            <ActivityIndicator color={colors['text-subtle']} />
          </View>
        ) : !data ? (
          <Text className="text-text-subtle text-footnote px-4 py-3">{"Couldn't load this. Check again in a moment."}</Text>
        ) : (
          <>
            {data.blocked.map((b) => (
              <SettingsRow key={b} title="On hold" detail={b} />
            ))}
            {data.checks.map((c) => (
              <SettingsRow key={`${c.kind}-${c.label}`} title={c.label} detail={c.reason} value={STATUS_LABEL[c.status]} />
            ))}
          </>
        )}
        <SettingsRow title="Check again" loading={check.isFetching} onPress={() => check.refetch()} />
      </SettingsGroup>
    </>
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
          {data.tester && <TestTools />}
        </>
      )}
    </ScrollView>
  )
}
