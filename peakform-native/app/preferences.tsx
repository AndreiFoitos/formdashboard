import { useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { useRequireAuth } from '../hooks/useRequireAuth'
import { FoodPrefsFields, TrainingPrefsFields } from '../components/preferences/PreferenceFields'
import {
  EMPTY_PREFERENCES,
  type Goal,
  type Preferences,
  usePreferences,
  useSavePreferences,
} from '../hooks/usePreferences'
import { extractErrorMessage } from '../lib/apiError'
import { colors } from '../theme/tokens'

// Settings → Training & food. The same answers onboarding asks for, plus the
// goal. Pit Crew builds plans from these (docs/ai-plans-design.md §3).

const GOALS: { key: Goal; label: string; desc: string }[] = [
  { key: 'cut', label: 'Cut', desc: 'Lose fat' },
  { key: 'maintain', label: 'Maintain', desc: 'Hold weight' },
  { key: 'bulk', label: 'Bulk', desc: 'Gain muscle' },
]

function Heading({ children }: { children: string }) {
  return <Text className="text-text text-headline font-bold mb-4">{children}</Text>
}

export default function PreferencesScreen() {
  useRequireAuth()
  const { data, isLoading } = usePreferences()
  const save = useSavePreferences()
  const [prefs, setPrefs] = useState<Preferences>(EMPTY_PREFERENCES)
  const [patch, setPatch] = useState<Partial<Preferences>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (data) setPrefs(data)
  }, [data])

  function onChange(p: Partial<Preferences>) {
    setPrefs((cur) => ({ ...cur, ...p }))
    setPatch((cur) => ({ ...cur, ...p }))
  }

  const dirty = Object.keys(patch).length > 0

  async function onSave() {
    setError(null)
    try {
      await save.mutateAsync(patch)
      setPatch({})
      router.back()
    } catch (e) {
      setError(extractErrorMessage(e))
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <View className="flex-row items-center px-4 pt-2 pb-4">
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={12}
          className="-ml-1 pr-4 py-2 flex-row items-center gap-1"
        >
          <ChevronLeft size={22} color={colors.text} strokeWidth={2.25} />
          <Text className="text-text-muted text-body font-medium">Back</Text>
        </TouchableOpacity>
        <Text className="text-text text-headline font-bold">Training & food</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors['text-subtle']} className="mt-12" />
      ) : (
        <ScrollView
          className="flex-1 px-4"
          contentContainerClassName="pb-12"
          keyboardShouldPersistTaps="handled"
        >
          <Text className="text-text-subtle text-footnote mb-6">
            Pit Crew builds your training and meal plans from these answers and your logs.
          </Text>

          <Heading>Goal</Heading>
          <View className="flex-row mb-2 gap-2">
            {GOALS.map((g) => {
              const active = prefs.goal === g.key
              return (
                <TouchableOpacity
                  key={g.key}
                  onPress={() => onChange({ goal: active ? null : g.key })}
                  className="flex-1 py-3 rounded-full border items-center"
                  style={{
                    borderCurve: 'continuous',
                    backgroundColor: active ? colors.text : colors.surface,
                    borderColor: active ? colors.text : colors.border,
                  }}
                >
                  <Text className="text-footnote font-semibold" style={{ color: active ? colors.bg : colors.text }}>
                    {g.label}
                  </Text>
                  <Text className="text-caption mt-1" style={{ color: colors['text-subtle'] }}>
                    {g.desc}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
          <Text className="text-text-subtle text-caption mb-8">
            Your calorie target stays as set under Profile & targets.
          </Text>

          <Heading>Training</Heading>
          <TrainingPrefsFields value={prefs} onChange={onChange} />

          <View className="h-10" />
          <Heading>Food</Heading>
          <FoodPrefsFields value={prefs} onChange={onChange} />

          {error && (
            <View className="bg-danger/15 border border-danger/40 rounded-xl px-4 py-3 mt-6" style={{ borderCurve: 'continuous' }}>
              <Text className="text-danger text-footnote">{error}</Text>
            </View>
          )}
        </ScrollView>
      )}

      <View className="px-4 pb-4 pt-2">
        <TouchableOpacity
          onPress={onSave}
          disabled={!dirty || save.isPending}
          className="bg-accent rounded-md py-4 items-center"
          style={{ borderCurve: 'continuous', opacity: !dirty || save.isPending ? 0.4 : 1 }}
        >
          {save.isPending ? (
            <ActivityIndicator color={colors['on-accent']} />
          ) : (
            <Text className="text-on-accent font-semibold text-body">Save</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}
