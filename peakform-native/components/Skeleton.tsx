import { useEffect } from 'react'
import { View, ViewStyle, DimensionValue } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from 'react-native-reanimated'
import { colors } from '../theme/tokens'

type BlockProps = {
  width?: DimensionValue
  height?: number
  radius?: number
  style?: ViewStyle
}

/** A single shimmering placeholder block. */
export function SkeletonBlock({ width = '100%', height = 16, radius = 8, style }: BlockProps) {
  const shimmer = useSharedValue(0)

  useEffect(() => {
    shimmer.value = withRepeat(
      withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(shimmer.value, [0, 1], [0.4, 0.9]),
  }))

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, borderCurve: 'continuous', backgroundColor: colors['surface-raised'] },
        animatedStyle,
        style,
      ]}
    />
  )
}

/** A card-shaped skeleton used while a screen's primary data loads. */
export function SkeletonCard({ height = 96 }: { height?: number }) {
  return (
    <View className="bg-surface border border-divider rounded-xl p-4 gap-3" style={{ borderCurve: 'continuous' }}>
      <SkeletonBlock width="40%" height={10} />
      <SkeletonBlock width="70%" height={height >= 96 ? 22 : 16} />
      <SkeletonBlock width="100%" height={6} />
    </View>
  )
}
