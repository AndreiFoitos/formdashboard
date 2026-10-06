import { router } from 'expo-router'
import { useRequireAuth } from '../../hooks/useRequireAuth'
import { TrainingPrefsFields } from '../../components/preferences/PreferenceFields'
import { AutosavePreferences } from '../../components/preferences/AutosavePreferences'
import { SettingsGroup } from '../../components/settings/SettingsGroup'
import { SettingsRow } from '../../components/settings/SettingsRow'

// Settings → Training preferences. The same answers onboarding asks for; the
// Pit builds training plans from them (docs/ai-plans-design.md §3).

export default function TrainingPreferencesScreen() {
  useRequireAuth()
  return (
    <AutosavePreferences
      intro="Your training plan is built from these answers and your logs. Changes save right away."
      footer={
        <SettingsGroup>
          <SettingsRow title="Nutrition preferences" onPress={() => router.push('/settings/nutrition')} />
        </SettingsGroup>
      }
    >
      {(value, onChange) => <TrainingPrefsFields value={value} onChange={onChange} />}
    </AutosavePreferences>
  )
}
