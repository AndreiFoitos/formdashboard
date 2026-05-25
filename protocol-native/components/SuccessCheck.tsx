import { useEffect } from 'react'
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withSequence,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated'
import Svg, { Circle, Path } from 'react-native-svg'

const AnimatedCircle = Animated.createAnimatedComponent(Circle)
const AnimatedPath = Animated.createAnimatedComponent(Path)

type Props = {
  size?: number
  color?: string
}

/**
 * An animated checkmark that pops in: the ring scales up, then the tick
 * draws itself. Shown when a quick-log action succeeds.
 */
export function SuccessCheck({ size = 22, color = '#22c55e' }: Props) {
  const ring = useSharedValue(0)
  const tick = useSharedValue(0)

  const CIRCUMFERENCE = 2 * Math.PI * 10
  const TICK_LEN = 14

  useEffect(() => {
    ring.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) })
    tick.value = withDelay(
      200,
      withSequence(withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) })),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRCUMFERENCE * (1 - ring.value),
  }))

  const tickProps = useAnimatedProps(() => ({
    strokeDashoffset: TICK_LEN * (1 - tick.value),
  }))

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <AnimatedCircle
        cx={12}
        cy={12}
        r={10}
        stroke={color}
        strokeWidth={2}
        fill="none"
        strokeDasharray={CIRCUMFERENCE}
        animatedProps={ringProps}
        transform="rotate(-90 12 12)"
      />
      <AnimatedPath
        d="M7 12.5 L10.5 16 L17 8.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        strokeDasharray={TICK_LEN}
        animatedProps={tickProps}
      />
    </Svg>
  )
}
