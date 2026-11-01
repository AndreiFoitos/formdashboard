import { Text, View } from 'react-native'
import { Check } from 'lucide-react-native'
import { useCreatine, useTickCreatine } from '../hooks/useCreatine'
import { hapticLight, hapticSuccess } from '../lib/haptics'
import { PressableScale } from './PressableScale'
import { colors } from '../theme/tokens'

/** Home: today's creatine as one tick, only once it's turned on in
 *  Settings → Creatine. Tap again to untick. */
export function CreatineCard() {
  const { data } = useCreatine()
  const tick = useTickCreatine()
  if (!data?.enabled) return null

  const taken = data.taken_today
  const streak = data.streak_days
  const detail = taken
    ? streak > 1 ? `Taken · ${streak} days in a row` : 'Taken today'
    : streak > 0 ? `${streak} ${streak === 1 ? 'day' : 'days'} in a row · tap when you've had it` : "Tap when you've had it"

  return (
    <PressableScale
      onPress={() => {
        taken ? hapticLight() : hapticSuccess()
        tick.mutate(!taken)
      }}
      accessibilityRole="checkbox"
      accessibilityLabel={`Creatine ${data.dose_g} g`}
      accessibilityState={{ checked: taken }}
      className="flex-row items-center gap-3 bg-surface border border-divider rounded-xl px-4 py-3"
      style={{ borderCurve: 'continuous' }}
    >
      <View className="flex-1">
        <Text className="text-text text-footnote font-semibold">Creatine · {data.dose_g} g</Text>
        <Text className="text-text-subtle text-caption mt-1">{detail}</Text>
      </View>
      <View
        className="w-11 h-11 rounded-full items-center justify-center border-2"
        style={{
          borderCurve: 'continuous',
          borderColor: taken ? colors.success : colors.border,
          backgroundColor: taken ? colors.success : 'transparent',
        }}
      >
        {taken && <Check size={22} color={colors.bg} strokeWidth={3} />}
      </View>
    </PressableScale>
  )
}
