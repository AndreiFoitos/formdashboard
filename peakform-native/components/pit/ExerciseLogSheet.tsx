import { useState } from 'react'
import { ActivityIndicator, Alert, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { X } from 'lucide-react-native'
import { useLogPlanExercise, type TodayExercise } from '../../hooks/usePitCrew'
import { hapticLight, hapticSuccess } from '../../lib/haptics'
import { extractErrorMessage } from '../../lib/apiError'

// Log one exercise from today's plan. Sets come pre-filled with the
// suggested weight and reps; edit what you actually did, then save. Goes
// through the normal /training/log-exercise endpoint, tagged source "plan".

interface Row {
  reps: string
  weight: string
}

export function ExerciseLogSheet({
  exercise,
  name,
  onClose,
}: {
  exercise: TodayExercise
  name: string
  onClose: () => void
}) {
  const { suggestion } = exercise
  const [rows, setRows] = useState<Row[]>(() =>
    Array.from({ length: exercise.sets }, () => ({
      reps: String(suggestion.reps),
      weight: suggestion.weight_kg != null ? String(suggestion.weight_kg) : '',
    })),
  )
  const log = useLogPlanExercise()

  function update(i: number, field: keyof Row, value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  }

  function save() {
    const sets = rows
      .map((r) => ({
        reps: r.reps ? parseInt(r.reps, 10) : null,
        weight_kg: r.weight ? parseFloat(r.weight.replace(',', '.')) : null,
      }))
      .filter((s) => s.reps || s.weight_kg)
    if (!sets.length) return
    log.mutate(
      { type: exercise.key, sets },
      {
        onSuccess: () => {
          hapticSuccess()
          onClose()
        },
        onError: (e) => Alert.alert("Couldn't save", extractErrorMessage(e)),
      },
    )
  }

  const valid = rows.some((r) => r.reps || r.weight)

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-zinc-950">
        <View className="items-center pt-3 pb-2">
          <View className="w-10 h-1 bg-zinc-700 rounded-full" />
        </View>
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-zinc-800">
          <View className="flex-1 pr-3">
            <Text className="text-white font-semibold">{name}</Text>
            <Text className="text-zinc-500 text-xs mt-0.5">
              Plan: {exercise.sets} × {exercise.reps_min}–{exercise.reps_max} · rest {Math.round(exercise.rest_seconds / 60 * 2) / 2} min
            </Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={12}
            className="w-10 h-10 -mr-1 rounded-full bg-zinc-900 border border-zinc-800 items-center justify-center"
          >
            <X size={20} color="#e4e4e7" strokeWidth={2.25} />
          </TouchableOpacity>
        </View>

        <ScrollView className="flex-1 px-4 pt-4" keyboardShouldPersistTaps="handled">
          <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3 mb-4">
            <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-1.5">Today's target</Text>
            <Text className="text-white text-sm">{suggestion.reason}</Text>
            {exercise.last.length > 0 && (
              <Text className="text-zinc-500 text-xs mt-2">
                Last time: {exercise.last.map((s) => `${s.weight_kg ?? '–'} kg × ${s.reps ?? '–'}`).join('  ·  ')}
              </Text>
            )}
            {!!exercise.note && <Text className="text-zinc-400 text-xs mt-2">{exercise.note}</Text>}
          </View>

          <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">What you did</Text>
          <View style={{ gap: 8 }}>
            {rows.map((r, i) => (
              <View key={i} className="flex-row items-center gap-2">
                <Text className="text-zinc-500 text-xs w-8">#{i + 1}</Text>
                <TextInput
                  value={r.reps}
                  onChangeText={(v) => update(i, 'reps', v)}
                  placeholder="reps"
                  placeholderTextColor="#52525b"
                  keyboardType="number-pad"
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-3 text-white text-sm"
                />
                <Text className="text-zinc-600 text-xs">×</Text>
                <TextInput
                  value={r.weight}
                  onChangeText={(v) => update(i, 'weight', v)}
                  placeholder={exercise.basis === 'bodyweight' ? 'bodyweight' : 'kg'}
                  placeholderTextColor="#52525b"
                  keyboardType="decimal-pad"
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-3 text-white text-sm"
                />
                {rows.length > 1 && (
                  <TouchableOpacity
                    onPress={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                    hitSlop={8}
                    className="px-2"
                  >
                    <Text className="text-zinc-600 text-base">−</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
          <TouchableOpacity
            onPress={() => {
              hapticLight()
              setRows((prev) => [...prev, { ...(prev[prev.length - 1] ?? { reps: '', weight: '' }) }])
            }}
            className="mt-3 py-3 rounded-xl border border-dashed border-zinc-700 items-center"
          >
            <Text className="text-zinc-400 text-sm">+ Add set</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={save}
            disabled={!valid || log.isPending}
            className="bg-white rounded-2xl py-4 items-center mt-5 mb-10"
            style={{ opacity: !valid || log.isPending ? 0.4 : 1 }}
          >
            {log.isPending ? (
              <ActivityIndicator color="black" />
            ) : (
              <Text className="text-black font-semibold text-base">Save</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  )
}
