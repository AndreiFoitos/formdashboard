import { useMemo, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { ChevronDown, ChevronUp, Minus, Plus, X } from 'lucide-react-native'
import { useRequireAuth } from '../hooks/useRequireAuth'
import { WEEKDAYS, toEditDays, useEditTraining, usePitPlan, type EditExercise } from '../hooks/usePitCrew'
import { useExerciseName } from '../hooks/useExerciseName'
import { ExercisePickerModal } from '../components/ExercisePickerModal'
import { EXERCISE_NAME } from '../lib/exercises'
import { extractErrorMessage } from '../lib/apiError'
import { hapticLight, hapticSuccess } from '../lib/haptics'
import { colors } from '../theme/tokens'

// Edit one session of the Pit Crew plan: name, which day it's on, and its
// exercises. Saves the whole week (PUT /plan-ai/plan/training). Moving onto
// a day that already has a session swaps the two.

const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const NEW_EXERCISE = { sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90, note: '' }

function Stepper({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  format = String,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  format?: (v: number) => string
}) {
  const btn = (icon: React.ReactNode, next: number, disabled: boolean) => (
    <TouchableOpacity
      onPress={() => { hapticLight(); onChange(next) }}
      disabled={disabled}
      className="w-11 h-11 items-center justify-center rounded-full bg-surface-raised"
      style={{ borderCurve: 'continuous', opacity: disabled ? 0.4 : 1 }}
    >
      {icon}
    </TouchableOpacity>
  )
  return (
    <View className="flex-1">
      <Text className="text-text-subtle text-caption mb-1">{label}</Text>
      <View className="flex-row items-center justify-between">
        {btn(<Minus size={16} color={colors.text} />, Math.max(min, value - step), value <= min)}
        <Text className="text-text text-body font-semibold">{format(value)}</Text>
        {btn(<Plus size={16} color={colors.text} />, Math.min(max, value + step), value >= max)}
      </View>
    </View>
  )
}

export default function PlanDayEditScreen() {
  useRequireAuth()
  const params = useLocalSearchParams<{ weekday: string }>()
  const weekday = Number(params.weekday)
  const { data } = usePitPlan()
  const plan = data?.plan
  const displayName = useExerciseName(EXERCISE_NAME)
  const save = useEditTraining()

  const days = useMemo(() => toEditDays(plan?.plan.training.days ?? []), [plan])
  const original = days.find((d) => d.weekday === weekday)
  const [name, setName] = useState(original?.name ?? 'Workout')
  const [target, setTarget] = useState(weekday)
  const [exercises, setExercises] = useState<EditExercise[]>(original?.exercises ?? [])
  // Index being swapped, 'add' for a new one, null = picker closed.
  const [picking, setPicking] = useState<number | 'add' | null>(null)

  const occupant = target !== weekday ? days.find((d) => d.weekday === target) : undefined

  function update(i: number, patch: Partial<EditExercise>) {
    setExercises((prev) => prev.map((e, j) => (j === i ? { ...e, ...patch } : e)))
  }

  function move(i: number, by: number) {
    hapticLight()
    setExercises((prev) => {
      const next = [...prev]
      const [e] = next.splice(i, 1)
      next.splice(i + by, 0, e)
      return next
    })
  }

  function pick(key: string) {
    if (picking === 'add') setExercises((prev) => [...prev, { key, ...NEW_EXERCISE }])
    else if (picking != null) update(picking, { key })
    setPicking(null)
  }

  function submit(week: typeof days) {
    save.mutate(week, {
      onSuccess: () => {
        hapticSuccess()
        router.back()
      },
      onError: (e) => Alert.alert("Couldn't save", extractErrorMessage(e, 'Please try again.')),
    })
  }

  function done() {
    if (!name.trim()) return Alert.alert('Give the session a name')
    if (!exercises.length) return Alert.alert('Add at least one exercise', 'Or make this a rest day.')
    const edited = { weekday: target, name: name.trim(), focus: original?.focus ?? '', exercises }
    const rest = days
      .filter((d) => d.weekday !== weekday && d.weekday !== target)
      .concat(occupant ? [{ ...occupant, weekday }] : [])
    submit([...rest, edited])
  }

  function makeRest() {
    Alert.alert(`Make ${WEEKDAYS[weekday]} a rest day?`, `${original?.name} comes out of your plan.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Make rest day', style: 'destructive', onPress: () => submit(days.filter((d) => d.weekday !== weekday)) },
    ])
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: original ? 'Edit session' : 'New session',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} hitSlop={12} className="py-2">
              <Text className="text-text text-body">Cancel</Text>
            </TouchableOpacity>
          ),
          headerRight: () =>
            save.isPending ? (
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
          <Text className="text-text-subtle text-caption mb-2">Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Push, Legs, Upper…"
            placeholderTextColor={colors['text-subtle']}
            maxLength={40}
            className="bg-surface-raised border border-border rounded-md px-4 py-3 text-text text-body"
            style={{ borderCurve: 'continuous' }}
          />
        </View>

        <View>
          <Text className="text-text-subtle text-caption mb-2">Day</Text>
          <View className="flex-row gap-1">
            {SHORT.map((label, i) => {
              const active = i === target
              return (
                <TouchableOpacity
                  key={label}
                  onPress={() => { hapticLight(); setTarget(i) }}
                  className="flex-1 py-3 rounded-full items-center border"
                  style={{
                    borderCurve: 'continuous',
                    backgroundColor: active ? colors.text : colors['surface-raised'],
                    borderColor: active ? colors.text : colors.border,
                  }}
                >
                  <Text className="text-caption font-semibold" style={{ color: active ? colors.bg : colors['text-muted'] }}>{label}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
          {occupant && (
            <Text className="text-text-subtle text-caption mt-2">
              Swaps with {WEEKDAYS[target]}'s {occupant.name}, which moves to {WEEKDAYS[weekday]}.
            </Text>
          )}
          {target !== weekday && (
            <Text className="text-text-subtle text-caption mt-2">Moving days resets any skip this week.</Text>
          )}
        </View>

        <View>
          <Text className="text-text-subtle text-caption mb-2">Exercises</Text>
          <View className="gap-3">
            {exercises.map((e, i) => (
              <View key={`${e.key}-${i}`} className="bg-surface-raised border border-border rounded-xl p-3 gap-3" style={{ borderCurve: 'continuous' }}>
                <View className="flex-row items-center">
                  <TouchableOpacity onPress={() => setPicking(i)} className="flex-1 pr-2 py-2">
                    <Text className="text-text text-body font-medium" numberOfLines={1}>{displayName(e.key)}</Text>
                    <Text className="text-text-subtle text-caption mt-1">Tap to change</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => move(i, -1)} disabled={i === 0} className="w-11 h-11 items-center justify-center" style={{ opacity: i === 0 ? 0.3 : 1 }}>
                    <ChevronUp size={18} color={colors['text-muted']} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => move(i, 1)} disabled={i === exercises.length - 1} className="w-11 h-11 items-center justify-center" style={{ opacity: i === exercises.length - 1 ? 0.3 : 1 }}>
                    <ChevronDown size={18} color={colors['text-muted']} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setExercises((prev) => prev.filter((_, j) => j !== i))} className="w-11 h-11 items-center justify-center">
                    <X size={18} color={colors['text-muted']} />
                  </TouchableOpacity>
                </View>
                <View className="flex-row gap-4">
                  <Stepper label="Sets" value={e.sets} min={1} max={10} onChange={(v) => update(i, { sets: v })} />
                  <Stepper
                    label="Rest"
                    value={e.rest_seconds}
                    min={15}
                    max={600}
                    step={15}
                    format={(v) => (v < 60 ? `${v}s` : `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`)}
                    onChange={(v) => update(i, { rest_seconds: v })}
                  />
                </View>
                <View className="flex-row gap-4">
                  <Stepper
                    label="Reps from"
                    value={e.reps_min}
                    min={1}
                    max={50}
                    onChange={(v) => update(i, { reps_min: v, reps_max: Math.max(v, e.reps_max) })}
                  />
                  <Stepper
                    label="Reps to"
                    value={e.reps_max}
                    min={1}
                    max={50}
                    onChange={(v) => update(i, { reps_max: v, reps_min: Math.min(v, e.reps_min) })}
                  />
                </View>
              </View>
            ))}
            <TouchableOpacity
              onPress={() => setPicking('add')}
              disabled={exercises.length >= 15}
              className="rounded-xl border border-border bg-surface-raised px-4 py-4 items-center"
              style={{ borderCurve: 'continuous', opacity: exercises.length >= 15 ? 0.4 : 1 }}
            >
              <Text className="text-text text-footnote font-medium">+ Add exercise</Text>
            </TouchableOpacity>
          </View>
        </View>

        {original && (
          <TouchableOpacity onPress={makeRest} className="py-3 items-center">
            <Text className="text-danger text-footnote font-medium">Make {WEEKDAYS[weekday]} a rest day</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {picking != null && <ExercisePickerModal onPick={pick} onClose={() => setPicking(null)} />}
    </>
  )
}
