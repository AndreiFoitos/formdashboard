import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { useAdaptiveCalories, useSuggestionAction } from '../hooks/useAdaptiveCalories'
import { extractErrorMessage } from '../lib/apiError'
import { formatNumber } from '../lib/format'
import { hapticSuccess } from '../lib/haptics'
import { showUndo } from '../store/undo'
import { colors } from '../theme/tokens'

// This week's calorie suggestion (backend services/adaptive_calories.py),
// shown at the top of Nutrition until the user uses or keeps it. Nothing
// changes until they tap Use.

export function CalorieSuggestionCard() {
  const { data } = useAdaptiveCalories()
  const action = useSuggestionAction()
  const s = data?.suggestion
  if (!s || s.new_kcal == null) return null
  const id = s.id
  const next = formatNumber(s.new_kcal)
  const fail = (e: unknown) => Alert.alert("Couldn't update", extractErrorMessage(e, 'Please try again.'))

  function use() {
    action.mutate(
      { id, action: 'accept' },
      {
        onSuccess: () => {
          hapticSuccess()
          showUndo({
            label: `Target set to ${next} kcal`,
            onUndo: () => action.mutateAsync({ id, action: 'undo' }).then(() => undefined, fail),
          })
        },
        onError: fail,
      },
    )
  }

  return (
    <View className="bg-surface border border-divider rounded-xl p-4 gap-2" style={{ borderCurve: 'continuous' }}>
      <Text className="text-text-subtle text-caption">New calorie target</Text>
      <Text className="text-text text-headline">
        {s.old_kcal != null ? `${formatNumber(s.old_kcal)} → ${next} kcal` : `${next} kcal`}
      </Text>
      <Text className="text-text-muted text-footnote">{s.reason}</Text>
      <View className="flex-row gap-2 mt-2">
        <TouchableOpacity
          onPress={use}
          disabled={action.isPending}
          className="flex-1 bg-accent rounded-md items-center justify-center py-3"
          style={{ borderCurve: 'continuous', minHeight: 44 }}
        >
          {action.isPending && action.variables?.action === 'accept' ? (
            <ActivityIndicator color={colors['on-accent']} />
          ) : (
            <Text className="text-on-accent text-footnote font-semibold">Use {next} kcal</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => action.mutate({ id, action: 'dismiss' }, { onError: fail })}
          disabled={action.isPending}
          className="flex-1 border border-border rounded-md items-center justify-center py-3"
          style={{ borderCurve: 'continuous', minHeight: 44 }}
        >
          <Text className="text-text text-footnote font-semibold">
            {s.old_kcal != null ? `Keep ${formatNumber(s.old_kcal)}` : 'Not now'}
          </Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity onPress={() => router.push('/settings/calories')} hitSlop={10} className="self-start py-2">
        <Text className="text-text-muted text-footnote">How it's worked out</Text>
      </TouchableOpacity>
    </View>
  )
}
