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

// Settings → Training & food. The same answers onboarding asks for, plus the
// goal. Pit Crew builds plans from these (docs/ai-plans-design.md §3).

const GOALS: { key: Goal; label: string; desc: string }[] = [
  { key: 'cut', label: 'Cut', desc: 'Lose fat' },
  { key: 'maintain', label: 'Maintain', desc: 'Hold weight' },
  { key: 'bulk', label: 'Bulk', desc: 'Gain muscle' },
]

function Heading({ children }: { children: string }) {
  return <Text className="text-white text-lg font-bold mb-4">{children}</Text>
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
    <SafeAreaView className="flex-1 bg-black" edges={['top', 'bottom']}>
      <View className="flex-row items-center px-4 pt-2 pb-4">
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={12}
          className="-ml-1 pr-4 py-2 flex-row items-center"
          style={{ gap: 2 }}
        >
          <ChevronLeft size={22} color="#d4d4d8" strokeWidth={2.25} />
          <Text className="text-zinc-300 text-base font-medium">Back</Text>
        </TouchableOpacity>
        <Text className="text-white text-xl font-bold">Training & food</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator color="#71717a" className="mt-10" />
      ) : (
        <ScrollView
          className="flex-1 px-4"
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text className="text-zinc-500 text-sm mb-6">
            Pit Crew builds your training and meal plans from these answers and your logs.
          </Text>

          <Heading>Goal</Heading>
          <View className="flex-row mb-2" style={{ gap: 8 }}>
            {GOALS.map((g) => {
              const active = prefs.goal === g.key
              return (
                <TouchableOpacity
                  key={g.key}
                  onPress={() => onChange({ goal: active ? null : g.key })}
                  className="flex-1 py-3 rounded-2xl border items-center"
                  style={{
                    backgroundColor: active ? 'white' : '#18181b',
                    borderColor: active ? 'white' : '#3f3f46',
                  }}
                >
                  <Text className="text-sm font-semibold" style={{ color: active ? 'black' : 'white' }}>
                    {g.label}
                  </Text>
                  <Text className="text-xs mt-0.5" style={{ color: active ? '#52525b' : '#71717a' }}>
                    {g.desc}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
          <Text className="text-zinc-600 text-xs mb-8">
            Your calorie target stays as set under Profile & Targets.
          </Text>

          <Heading>Training</Heading>
          <TrainingPrefsFields value={prefs} onChange={onChange} />

          <View className="h-10" />
          <Heading>Food</Heading>
          <FoodPrefsFields value={prefs} onChange={onChange} />

          {error && (
            <View className="bg-red-950 border border-red-900 rounded-2xl px-4 py-3 mt-6">
              <Text className="text-red-400 text-sm">{error}</Text>
            </View>
          )}
        </ScrollView>
      )}

      <View className="px-4 pb-4 pt-2">
        <TouchableOpacity
          onPress={onSave}
          disabled={!dirty || save.isPending}
          className="bg-white rounded-2xl py-4 items-center"
          style={{ opacity: !dirty || save.isPending ? 0.4 : 1 }}
        >
          {save.isPending ? (
            <ActivityIndicator color="black" />
          ) : (
            <Text className="text-black font-semibold text-base">Save</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}
