import { Pressable, PressableProps, ViewStyle } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { hapticLight } from '../lib/haptics'

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

type Props = PressableProps & {
  /** How far to scale down while pressed. Default 0.97. */
  activeScale?: number
  /** Fire a light haptic tick on press-in. Default false. */
  haptic?: boolean
  style?: ViewStyle | ViewStyle[]
}

/**
 * Drop-in replacement for Pressable/TouchableOpacity that dips slightly in
 * scale while held, giving cards and buttons a tactile feel.
 */
export function PressableScale({
  activeScale = 0.97,
  haptic = false,
  style,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: Props) {
  const scale = useSharedValue(1)

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))

  return (
    <AnimatedPressable
      {...rest}
      style={[style, animatedStyle]}
      onPressIn={(e) => {
        scale.value = withTiming(activeScale, { duration: 90 })
        if (haptic) hapticLight()
        onPressIn?.(e)
      }}
      onPressOut={(e) => {
        scale.value = withTiming(1, { duration: 140 })
        onPressOut?.(e)
      }}
    >
      {children}
    </AnimatedPressable>
  )
}
