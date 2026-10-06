import { useState } from 'react'
import { ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { useRequireAuth } from '../hooks/useRequireAuth'
import { WEEKDAYS, usePitPlan } from '../hooks/usePitCrew'
import { useExerciseName } from '../hooks/useExerciseName'
import { EXERCISE_NAME } from '../lib/exercises'
import { colors } from '../theme/tokens'

// The whole Pit Crew week: each day's session and meals. Read-only; logging
// happens from the Today card on the Pit tab.

const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function PlanWeekScreen() {
  useRequireAuth()
  const { data } = usePitPlan()
  const displayName = useExerciseName(EXERCISE_NAME)
  const plan = data?.plan
  const [day, setDay] = useState(() => (new Date().getDay() + 6) % 7)

  const training = plan?.plan.training.days.find((d) => d.weekday === day)
  const meals = plan?.plan.nutrition?.days.find((d) => d.weekday === day)

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-4 pt-2 pb-4">
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={12}
          className="-ml-1 pr-4 py-2 flex-row items-center gap-1"
        >
          <ChevronLeft size={22} color={colors.text} strokeWidth={2.25} />
          <Text className="text-text-muted text-body font-medium">Back</Text>
        </TouchableOpacity>
        <Text className="text-text text-headline font-bold">This week</Text>
      </View>

      <View className="flex-row px-4 mb-4 gap-2">
        {SHORT.map((label, i) => {
          const active = i === day
          const trains = plan?.plan.training.days.some((d) => d.weekday === i)
          return (
            <TouchableOpacity
              key={label}
              onPress={() => setDay(i)}
              className="flex-1 py-2 rounded-full items-center border"
              style={{ borderCurve: 'continuous', backgroundColor: active ? colors.text : colors.surface, borderColor: active ? colors.text : colors.divider }}
            >
              <Text className="text-caption font-semibold" style={{ color: active ? colors.bg : colors['text-muted'] }}>{label}</Text>
              <View
                className="w-1 h-1 rounded-full mt-1"
                style={{ borderCurve: 'continuous', backgroundColor: trains ? (active ? colors.bg : colors.success) : 'transparent' }}
              />
            </TouchableOpacity>
          )
        })}
      </View>

      <ScrollView className="flex-1 px-4" contentContainerClassName="pb-12 gap-4">
        {!plan ? (
          <Text className="text-text-subtle text-footnote">No plan yet.</Text>
        ) : (
          <>
            <View className="bg-surface border border-divider rounded-xl overflow-hidden" style={{ borderCurve: 'continuous' }}>
              <View className="px-4 pt-4 pb-3 border-b border-divider">
                <Text className="text-text-subtle text-caption">{WEEKDAYS[day]}</Text>
                <Text className="text-text text-body font-semibold mt-1">{training ? training.name : 'Rest day'}</Text>
                {!!training?.focus && <Text className="text-text-subtle text-caption mt-1">{training.focus}</Text>}
              </View>
              {training?.exercises.map((e, i) => (
                <View
                  key={e.key}
                  className="px-4 py-3"
                  style={{ borderBottomWidth: i === training.exercises.length - 1 ? 0 : 1, borderBottomColor: colors.divider }}
                >
                  <View className="flex-row justify-between">
                    <Text className="text-text text-footnote font-medium flex-1 pr-2">{displayName(e.key)}</Text>
                    <Text className="text-text-muted text-footnote">
                      {e.sets} × {e.reps_min === e.reps_max ? e.reps_max : `${e.reps_min}–${e.reps_max}`}
                    </Text>
                  </View>
                  <Text className="text-text-subtle text-caption mt-1">
                    {e.start_weight_kg != null ? `Start ${e.start_weight_kg} kg · ` : ''}rest {Math.round(e.rest_seconds / 30) / 2} min
                    {e.note ? ` · ${e.note}` : ''}
                  </Text>
                </View>
              ))}
            </View>

            {meals && (
              <View>
                <View className="flex-row items-end justify-between mb-2">
                  <Text className="text-text-subtle text-caption">Meals</Text>
                  <Text className="text-text-subtle text-caption">
                    {meals.totals.calories} kcal · {Math.round(meals.totals.protein_g)} g protein
                  </Text>
                </View>
                <View className="bg-surface border border-divider rounded-xl overflow-hidden" style={{ borderCurve: 'continuous' }}>
                  {meals.meals.map((m, i) => (
                    <View
                      key={m.id}
                      className="px-4 py-3"
                      style={{ borderBottomWidth: i === meals.meals.length - 1 ? 0 : 1, borderBottomColor: colors.divider }}
                    >
                      <View className="flex-row justify-between">
                        <Text className="text-text text-footnote font-medium flex-1 pr-2">{m.name}</Text>
                        <Text className="text-text-muted text-footnote">{m.totals.calories} kcal</Text>
                      </View>
                      {!!m.prep && <Text className="text-text-muted text-caption mt-1">{m.prep}</Text>}
                      {m.items.map((it) => (
                        <Text key={it.food} className="text-text-subtle text-caption mt-1">
                          {it.food} · {it.grams} g
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
