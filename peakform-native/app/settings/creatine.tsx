import { ActivityIndicator, Alert, ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import { useCreatine, useCreatineSettings } from '../../hooks/useCreatine'
import { useRequireAuth } from '../../hooks/useRequireAuth'
import { extractErrorMessage } from '../../lib/apiError'
import { hapticLight } from '../../lib/haptics'
import { SettingsGroup } from '../../components/settings/SettingsGroup'
import { SettingsRow } from '../../components/settings/SettingsRow'
import { colors } from '../../theme/tokens'

// Settings → Creatine: turn the daily tick on Home on, and set the dose.
// Backend routers/creatine.py; the reminder lives in Reminders.

const DOSES = [3, 5, 10]

export default function CreatineScreen() {
  useRequireAuth()
  const { data } = useCreatine()
  const save = useCreatineSettings()

  function update(body: { enabled?: boolean; dose_g?: number }) {
    hapticLight()
    save.mutate(body, { onError: (e) => Alert.alert("Couldn't save", extractErrorMessage(e)) })
  }

  if (!data) {
    return (
      <View className="flex-1 bg-bg items-center pt-6">
        <ActivityIndicator color={colors['text-subtle']} />
      </View>
    )
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} className="flex-1 bg-bg" contentContainerClassName="px-4 pt-4 pb-12" contentInsetAdjustmentBehavior="automatic">
      <SettingsGroup
        first
        footer="Adds a tick to Home. Same dose every day, so there's nothing to log: tap it once you've had it. Each day you tick counts towards your streak."
      >
        <SettingsRow title="Track creatine" switchValue={data.enabled} onSwitch={(enabled) => update({ enabled })} />
      </SettingsGroup>

      {data.enabled && (
        <>
          <SettingsGroup
            header="Daily dose"
            footer="3 to 5 g a day is the usual dose, at any time of day. What matters is taking it every day."
          >
            {DOSES.map((g) => (
              <SettingsRow key={g} title={`${g} g`} checked={data.dose_g === g} onPress={() => update({ dose_g: g })} />
            ))}
          </SettingsGroup>
          <SettingsGroup footer="Once you've ticked it on a few days, a reminder comes when you're later than usual, and once in the evening if it's still not ticked.">
            <SettingsRow title="Reminders" onPress={() => router.push('/settings/notifications')} />
          </SettingsGroup>
        </>
      )}
    </ScrollView>
  )
}
