import { useEffect } from 'react'
import { View, ViewStyle } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated'

type Props = {
  /** Fill amount, 0–100. */
  percent: number
  color: string
  /** Track height in px. Default 6. */
  height?: number
  trackColor?: string
  duration?: number
  style?: ViewStyle
}

/**
 * A horizontal progress bar whose fill animates to `percent` whenever it
 * changes (including the initial 0 → value sweep on mount).
 */
export function AnimatedBar({
  percent,
  color,
  height = 6,
  trackColor = '#27272a',
  duration = 700,
  style,
}: Props) {
  const width = useSharedValue(0)

  useEffect(() => {
    width.value = withTiming(Math.max(0, Math.min(100, percent)), {
      duration,
      easing: Easing.out(Easing.cubic),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [percent])

  const animatedStyle = useAnimatedStyle(() => ({
    width: `${width.value}%`,
  }))

  return (
    <View
      style={[
        { height, backgroundColor: trackColor, borderRadius: height / 2, overflow: 'hidden' },
        style,
      ]}
    >
      <Animated.View
        style={[{ height: '100%', borderRadius: height / 2, backgroundColor: color }, animatedStyle]}
      />
    </View>
  )
}
