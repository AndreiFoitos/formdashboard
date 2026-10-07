import { useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore, type User } from '../../../store/auth'
import { offerCalorieRecompute, useUpdateMe } from '../../../hooks/useUpdateMe'
import { usePreferences, useSavePreferences, type Goal } from '../../../hooks/usePreferences'
import { extractErrorMessage } from '../../../lib/apiError'
import { hapticLight } from '../../../lib/haptics'
import { SettingsGroup } from '../../../components/settings/SettingsGroup'
import { SettingsRow } from '../../../components/settings/SettingsRow'
import { GOAL_DETAIL, GOAL_LABEL, hourLabel } from '../../../components/settings/labels'

// Short pick-one choices in a form sheet (DESIGN.md §5). Tapping an option
// saves it and closes the sheet; a server rejection shows inline.

type Field = 'goal' | 'sex' | 'bedtime'

const TITLES: Record<Field, string> = { goal: 'Goal', sex: 'Sex', bedtime: 'Bedtime' }
const GOALS: Goal[] = ['cut', 'maintain', 'bulk']
const HOURS = Array.from({ length: 24 }, (_, i) => (i + 18) % 24) // evening first

export default function ChooseScreen() {
  const { field } = useLocalSearchParams<{ field: Field }>()
  const user = useAuthStore((s) => s.user)
  const qc = useQueryClient()
  const update = useUpdateMe()
  const { data: prefs } = usePreferences()
  const savePrefs = useSavePreferences()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  const fail = (e: unknown) => {
    setPending(null)
    setError(extractErrorMessage(e, "Couldn't save. Try again."))
  }

  // Goal and sex both move the calorie estimate.
  const recompute = (u: User) =>
    offerCalorieRecompute(
      u,
      qc,
      (kcal) => update.mutate({ calorie_target: kcal }, { onSettled: () => router.back() }),
      () => router.back(),
    )

  function pick(key: string, run: () => void) {
    hapticLight()
    setError(null)
    setPending(key)
    run()
  }

  let rows: React.ReactNode = null
  if (field === 'goal') {
    rows = GOALS.map((g) => (
      <SettingsRow
        key={g}
        title={GOAL_LABEL[g]}
        detail={GOAL_DETAIL[g]}
        checked={prefs?.goal === g}
        loading={pending === g}
        onPress={() =>
          pick(g, () =>
            savePrefs.mutate({ goal: g }, { onSuccess: () => (user ? recompute(user) : router.back()), onError: fail }),
          )
        }
      />
    ))
  } else if (field === 'sex') {
    rows = (['male', 'female'] as const).map((s) => (
      <SettingsRow
        key={s}
        title={s === 'male' ? 'Male' : 'Female'}
        checked={user?.sex === s}
        loading={pending === s}
        onPress={() => pick(s, () => update.mutate({ sex: s }, { onSuccess: recompute, onError: fail }))}
      />
    ))
  } else {
    rows = HOURS.map((h) => (
      <SettingsRow
        key={h}
        title={hourLabel(h)}
        checked={(user?.sleep_hour ?? 23) === h}
        loading={pending === String(h)}
        onPress={() =>
          pick(String(h), () => update.mutate({ sleep_hour: h }, { onSuccess: () => router.back(), onError: fail }))
        }
      />
    ))
  }

  const footer =
    field === 'sex'
      ? 'Used for your calorie estimate and your avatar only.'
      : field === 'bedtime'
        ? 'Caffeine late in the day counts against your Form score relative to this time.'
        : 'Changing your goal can update your calorie target.'

  return (
    <>
      {field === 'bedtime' && <Stack.Screen options={{ sheetAllowedDetents: [0.6, 1] }} />}
      <View className={field === 'bedtime' ? 'flex-1 bg-surface' : 'bg-surface'}>
        <Text className="text-text text-headline text-center pt-6 pb-2">{TITLES[field] ?? ''}</Text>
        <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
          className={field === 'bedtime' ? 'flex-1' : undefined}
          scrollEnabled={field === 'bedtime'}
          contentContainerClassName="px-4 pb-8"
        >
          <SettingsGroup first raised footer={error ? <Text className="text-danger text-footnote">{error}</Text> : footer}>
            {rows}
          </SettingsGroup>
        </ScrollView>
      </View>
    </>
  )
}
