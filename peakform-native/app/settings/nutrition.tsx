import { useRequireAuth } from '../../hooks/useRequireAuth'
import { FoodPrefsFields } from '../../components/preferences/PreferenceFields'
import { AutosavePreferences } from '../../components/preferences/AutosavePreferences'

// Settings → Nutrition preferences. The Pit builds meal plans from these.

export default function NutritionPreferencesScreen() {
  useRequireAuth()
  return (
    <AutosavePreferences intro="Your meal plan is built from these answers and your logs. Changes save right away.">
      {(value, onChange) => <FoodPrefsFields value={value} onChange={onChange} />}
    </AutosavePreferences>
  )
}
