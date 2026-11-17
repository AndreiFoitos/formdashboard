import { useRef, useState } from 'react'
import { ActivityIndicator, Alert, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { X } from 'lucide-react-native'
import { api } from '../../api/client'
import { useLogPlanExercise, type Suggestion, type TodayExercise } from '../../hooks/usePitCrew'
import { attachmentQuery, type ExerciseProgression } from '../../hooks/useProgression'
import { hapticLight, hapticSuccess } from '../../lib/haptics'
import { extractErrorMessage } from '../../lib/apiError'
import { cleanReps, cleanWeight, useUnits } from '../../lib/units'
import { attachmentsFor, isPerDumbbell, loggingHint, UNILATERAL } from '../../lib/exercises'
import { AttachmentPicker } from '../AttachmentPicker'
import { KEYBOARD_DONE_ID, KeyboardDoneBar } from '../KeyboardDoneBar'
import { TargetBadge } from '../TargetBadge'
import { colors } from '../../theme/tokens'

// Log one exercise from today's plan. Sets come pre-filled with the
// suggested weight and reps; edit what you actually did, then save. Goes
// through the normal /training/log-exercise endpoint, tagged source "plan".
// Cable exercises open on the attachment used last; switching it asks for
// that attachment's target (with the plan's rep range and sets) and
// re-fills the sets, since a rope and a triangle are different weights.

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
  const u = useUnits()
  const rowsFor = (s: Pick<Suggestion, 'weight_kg' | 'reps'>): Row[] =>
    Array.from({ length: exercise.sets }, () => ({
      reps: String(s.reps),
      weight: s.weight_kg != null ? String(u.lift(s.weight_kg)) : '',
    }))
  const [rows, setRows] = useState<Row[]>(() => rowsFor(exercise.suggestion))
  const log = useLogPlanExercise()
  const perDb = isPerDumbbell(exercise.key)

  const attachments = attachmentsFor(exercise.key)
  const planAttachment = exercise.attachment ?? null
  const [attachment, setAttachment] = useState<string | null>(planAttachment)
  // The target for another attachment than the plan's, once switched.
  const [switched, setSwitched] = useState<Suggestion | null>(null)
  const [switching, setSwitching] = useState(false)
  const suggestion = switched ?? exercise.suggestion
  // Two quick taps: only the last pick's target fills the sets.
  const latestPick = useRef<string | null>(planAttachment)

  async function pickAttachment(a: string | null) {
    setAttachment(a)
    latestPick.current = a
    if (a === planAttachment) {
      setSwitching(false)
      setSwitched(null)
      setRows(rowsFor(exercise.suggestion))
      return
    }
    setSwitching(true)
    try {
      const plan = `reps_min=${exercise.reps_min}&reps_max=${exercise.reps_max}&sets=${exercise.sets}`
      const { data } = await api.get<ExerciseProgression>(
        `/training/progression/${exercise.key}${attachmentQuery(a)}&${plan}`,
      )
      if (latestPick.current !== a) return
      setSwitched(data.target)
      setRows(rowsFor(data.target))
    } catch {
      // Keep the sets as they are; the pick still saves.
    } finally {
      if (latestPick.current === a) setSwitching(false)
    }
  }

  function update(i: number, field: keyof Row, value: string) {
    const clean = field === 'reps' ? cleanReps(value) : cleanWeight(value)
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: clean } : r)))
  }

  function save() {
    const sets = rows
      .map((r) => ({
        reps: r.reps ? parseInt(r.reps, 10) : null,
        weight_kg: r.weight && Number.isFinite(parseFloat(r.weight)) ? u.weightToKg(parseFloat(r.weight)) : null,
      }))
      .filter((s) => s.reps || s.weight_kg)
    if (!sets.length) return
    log.mutate(
      { type: exercise.key, sets, attachment: attachments.length ? attachment : null },
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
      <View className="flex-1 bg-surface">
        <View className="items-center pt-3 pb-2">
          <View className="w-10 h-1 bg-border rounded-full" style={{ borderCurve: 'continuous' }} />
        </View>
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-divider">
          <View className="flex-1 pr-3">
            <Text className="text-text font-semibold">{name}</Text>
            <Text className="text-text-subtle text-caption mt-1">
              Plan: {exercise.sets} × {exercise.reps_min}–{exercise.reps_max} · rest {Math.round(exercise.rest_seconds / 60 * 2) / 2} min
            </Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={12}
            className="w-10 h-10 -mr-1 rounded-full bg-surface-raised border border-border items-center justify-center" style={{ borderCurve: 'continuous' }}
          >
            <X size={20} color={colors.text} strokeWidth={2.25} />
          </TouchableOpacity>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          className="flex-1 px-4 pt-4"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
        >
          {attachments.length > 0 && (
            <View className="mb-4">
              <Text className="text-text-subtle text-caption mb-2">Attachment</Text>
              <AttachmentPicker options={attachments} value={attachment} onChange={pickAttachment} disabled={switching} />
            </View>
          )}

          <View className="bg-surface-raised border border-border rounded-xl p-3 mb-4" style={{ borderCurve: 'continuous' }}>
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-text-subtle text-caption">Today's target</Text>
              {suggestion.kind !== 'first' && <TargetBadge kind={suggestion.kind} />}
            </View>
            <Text className="text-text text-footnote">{suggestion.reason}</Text>
            {!switched && exercise.last.length > 0 && (
              <Text className="text-text-subtle text-caption mt-2">
                Last time: {exercise.last.map((s) => `${s.weight_kg != null ? u.liftLabel(s.weight_kg) : '–'} × ${s.reps ?? '–'}`).join('  ·  ')}
              </Text>
            )}
            {!!exercise.note && <Text className="text-text-muted text-caption mt-2">{exercise.note}</Text>}
          </View>

          <View className="flex-row items-baseline justify-between mb-2">
            <Text className="text-text-subtle text-caption">What you did</Text>
            {!!loggingHint(exercise.key) && <Text className="text-text-subtle text-caption">{loggingHint(exercise.key)}</Text>}
          </View>
          <View className="gap-2">
            {rows.map((r, i) => (
              <View key={i} className="flex-row items-center gap-2">
                <Text className="text-text-subtle text-caption w-8">#{i + 1}</Text>
                <TextInput
                  value={r.reps}
                  onChangeText={(v) => update(i, 'reps', v)}
                  placeholder={UNILATERAL.has(exercise.key) ? 'reps/side' : 'reps'}
                  placeholderTextColor={colors['text-subtle']}
                  keyboardType="number-pad"
                  inputAccessoryViewID={KEYBOARD_DONE_ID}
                  maxLength={3}
                  className="flex-1 bg-surface-raised border border-border rounded-md px-3 py-3 text-text text-footnote" style={{ borderCurve: 'continuous' }}
                />
                <Text className="text-text-subtle text-caption">×</Text>
                <TextInput
                  value={r.weight}
                  onChangeText={(v) => update(i, 'weight', v)}
                  placeholder={exercise.basis === 'bodyweight' ? 'bodyweight' : perDb ? `${u.weightUnit} each` : u.weightUnit}
                  placeholderTextColor={colors['text-subtle']}
                  keyboardType="decimal-pad"
                  inputAccessoryViewID={KEYBOARD_DONE_ID}
                  className="flex-1 bg-surface-raised border border-border rounded-md px-3 py-3 text-text text-footnote" style={{ borderCurve: 'continuous' }}
                />
                {rows.length > 1 && (
                  <TouchableOpacity
                    onPress={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                    hitSlop={8}
                    className="px-2"
                  >
                    <Text className="text-text-subtle text-body">−</Text>
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
            className="mt-3 py-3 rounded-md border border-dashed border-border items-center" style={{ borderCurve: 'continuous' }}
          >
            <Text className="text-text-muted text-footnote">+ Add set</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={save}
            disabled={!valid || log.isPending || switching}
            className="bg-accent rounded-md py-4 items-center mt-5 mb-12"
            style={{ borderCurve: 'continuous', opacity: !valid || log.isPending || switching ? 0.4 : 1 }}
          >
            {log.isPending ? (
              <ActivityIndicator color={colors['on-accent']} />
            ) : (
              <Text className="text-on-accent font-semibold text-body">Save</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
        <KeyboardDoneBar />
      </View>
    </Modal>
  )
}
