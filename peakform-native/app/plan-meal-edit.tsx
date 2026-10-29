import { useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { RotateCcw, X } from 'lucide-react-native'
import { useRequireAuth } from '../hooks/useRequireAuth'
import { WEEKDAYS, useEditPlanMeal, usePitPlan, useRemovePlanMeal } from '../hooks/usePitCrew'
import { KEYBOARD_DONE_ID, KeyboardDoneBar } from '../components/KeyboardDoneBar'
import { capitalize, formatNumber } from '../lib/format'
import { extractErrorMessage } from '../lib/apiError'
import { hapticSuccess } from '../lib/haptics'
import { colors } from '../theme/tokens'

// Change one day's plan meal: grams per item, drop items, or take the meal
// off that day. Swapping it for something else stays in the chat, which
// checks allergies and diet rules on new foods.

export default function PlanMealEditScreen() {
  useRequireAuth()
  const params = useLocalSearchParams<{ weekday: string; id: string }>()
  const weekday = Number(params.weekday)
  const { data } = usePitPlan()
  const meal = data?.plan?.plan.nutrition?.days.find((d) => d.weekday === weekday)?.meals.find((m) => m.id === params.id)
  const save = useEditPlanMeal()
  const remove = useRemovePlanMeal()
  // Text per item; '0' or empty = dropped.
  const [grams, setGrams] = useState<string[]>(() => meal?.items.map((i) => String(i.grams)) ?? [])

  if (!meal) {
    return (
      <View className="flex-1 bg-surface px-4 pt-6">
        <Stack.Screen options={{ title: 'Edit meal' }} />
        <Text className="text-text-subtle text-footnote">This meal isn't in your plan any more.</Text>
      </View>
    )
  }

  const values = grams.map((g) => Math.max(0, Math.min(2000, parseInt(g, 10) || 0)))
  const scaled = meal.items.map((it, i) => (it.grams ? values[i] / it.grams : 0))
  const total = (k: 'calories' | 'protein_g' | 'carbs_g' | 'fat_g') =>
    meal.items.reduce((n, it, i) => n + it[k] * scaled[i], 0)
  const kept = values.filter((v) => v > 0).length
  const busy = save.isPending || remove.isPending

  function setAt(i: number, v: string) {
    setGrams((prev) => prev.map((g, j) => (j === i ? v.replace(/[^0-9]/g, '') : g)))
  }

  function done() {
    if (!kept) return Alert.alert('Keep at least one item', 'Or remove the meal from this day.')
    save.mutate(
      { weekday, id: meal!.id, grams: values },
      {
        onSuccess: () => {
          hapticSuccess()
          router.back()
        },
        onError: (e) => Alert.alert("Couldn't save", extractErrorMessage(e, 'Please try again.')),
      },
    )
  }

  function removeMeal() {
    Alert.alert(`Remove ${capitalize(meal!.name)} from ${WEEKDAYS[weekday]}?`, 'Other days keep their meals.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          remove.mutate(
            { weekday, id: meal!.id },
            {
              onSuccess: () => router.back(),
              onError: (e) => Alert.alert("Couldn't remove", extractErrorMessage(e, 'Please try again.')),
            },
          ),
      },
    ])
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Edit meal',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} hitSlop={12} className="py-2">
              <Text className="text-text text-body">Cancel</Text>
            </TouchableOpacity>
          ),
          headerRight: () =>
            busy ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <TouchableOpacity onPress={done} hitSlop={12} className="py-2">
                <Text className="text-text text-body font-semibold">Save</Text>
              </TouchableOpacity>
            ),
        }}
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        className="flex-1 bg-surface"
        contentContainerClassName="px-4 pt-4 pb-12 gap-6"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <View>
          <Text className="text-text-subtle text-caption">{WEEKDAYS[weekday]}</Text>
          <Text className="text-text text-headline mt-1">{capitalize(meal.name)}</Text>
          <Text className="text-text-subtle text-footnote mt-1">
            {formatNumber(Math.round(total('calories')))} kcal · {Math.round(total('protein_g'))}p · {Math.round(total('carbs_g'))}c ·{' '}
            {Math.round(total('fat_g'))}f
          </Text>
        </View>

        <View className="bg-surface-raised border border-border rounded-xl overflow-hidden" style={{ borderCurve: 'continuous' }}>
          {meal.items.map((it, i) => {
            const dropped = values[i] === 0
            return (
              <View
                key={`${it.food}-${i}`}
                className="px-4 py-3 flex-row items-center gap-3"
                style={{ borderBottomWidth: i === meal.items.length - 1 ? 0 : 1, borderBottomColor: colors.border }}
              >
                <View className="flex-1">
                  <Text className={`text-footnote ${dropped ? 'text-text-subtle line-through' : 'text-text'}`} numberOfLines={2}>
                    {capitalize(it.food)}
                  </Text>
                  <Text className="text-text-subtle text-caption mt-1">
                    {formatNumber(Math.round(it.calories * scaled[i]))} kcal · {Math.round(it.protein_g * scaled[i])} g protein
                  </Text>
                </View>
                <View className="flex-row items-center bg-surface border border-border rounded-md px-3" style={{ borderCurve: 'continuous' }}>
                  <TextInput
                    value={grams[i]}
                    onChangeText={(v) => setAt(i, v)}
                    keyboardType="number-pad"
                    inputAccessoryViewID={KEYBOARD_DONE_ID}
                    maxLength={4}
                    selectTextOnFocus
                    className="py-3 text-text text-footnote text-right"
                    style={{ minWidth: 44 }}
                  />
                  <Text className="text-text-subtle text-footnote ml-1">g</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setAt(i, dropped ? String(it.grams) : '0')}
                  className="w-11 h-11 items-center justify-center"
                >
                  {dropped ? <RotateCcw size={18} color={colors['text-muted']} /> : <X size={18} color={colors['text-muted']} />}
                </TouchableOpacity>
              </View>
            )
          })}
        </View>
        <Text className="text-text-subtle text-caption -mt-3">
          Changes apply to {WEEKDAYS[weekday]} only. To swap the meal for something else, ask your crew in the chat.
        </Text>

        <TouchableOpacity onPress={removeMeal} disabled={busy} className="py-3 items-center">
          <Text className="text-danger text-footnote font-medium">Remove from {WEEKDAYS[weekday]}</Text>
        </TouchableOpacity>
      </ScrollView>
      <KeyboardDoneBar />
    </>
  )
}
