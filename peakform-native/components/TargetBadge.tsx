import { Text, View } from 'react-native'
import { KIND_COLOUR, KIND_LABEL, type TargetKind } from '../hooks/useProgression'

/** "+1 rep" / "+ weight" / "Stalled" pill for a progressive overload
 *  target (backend services/progression.py). Training tab and Pit plan. */
export function TargetBadge({ kind }: { kind: TargetKind }) {
  return (
    <View className="rounded-full px-2 py-1" style={{ borderCurve: 'continuous', backgroundColor: `${KIND_COLOUR[kind]}22` }}>
      <Text className="text-caption font-semibold" style={{ color: KIND_COLOUR[kind] }}>
        {KIND_LABEL[kind]}
      </Text>
    </View>
  )
}
