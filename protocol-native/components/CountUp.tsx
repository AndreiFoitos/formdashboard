import { useEffect, useRef, useState } from 'react'
import { Text, TextProps } from 'react-native'
import {
  useSharedValue,
  withTiming,
  useAnimatedReaction,
  runOnJS,
  Easing,
} from 'react-native-reanimated'

type Props = TextProps & {
  value: number
  /** Decimal places to render. Default 0. */
  decimals?: number
  duration?: number
  /** Thousands separators. Default false. */
  separator?: boolean
}

/**
 * Renders a number that animates from its previous value to the new one.
 * Used for stat figures (Form Score, calories, weight) so they tick up on
 * load and re-animate when the underlying data changes.
 */
export function CountUp({
  value,
  decimals = 0,
  duration = 700,
  separator = false,
  ...textProps
}: Props) {
  // Start from 0 so the figure ticks up on first mount (i.e. once data loads),
  // then animates between values on any later change.
  const progress = useSharedValue(0)
  const from = useSharedValue(0)
  const to = useSharedValue(0)
  const [display, setDisplay] = useState(0)
  const prev = useRef(0)

  useEffect(() => {
    if (prev.current === value) return
    from.value = prev.current
    to.value = value
    prev.current = value
    progress.value = 0
    progress.value = withTiming(1, { duration, easing: Easing.out(Easing.cubic) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useAnimatedReaction(
    () => progress.value,
    (p) => {
      runOnJS(setDisplay)(from.value + (to.value - from.value) * p)
    },
  )

  const rounded = Number(display.toFixed(decimals))
  const text = separator ? rounded.toLocaleString() : rounded.toFixed(decimals)

  return <Text {...textProps}>{text}</Text>
}
