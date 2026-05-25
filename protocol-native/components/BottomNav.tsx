import { useEffect, useState } from 'react'
import { View, Pressable, Text, LayoutChangeEvent } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { MaterialTopTabBarProps } from '@react-navigation/material-top-tabs'
import { TAB_ICONS } from './TabIcons'
import { hapticSelection } from '../lib/haptics'

const LABELS: Record<string, string> = {
  index: 'Today',
  training: 'Training',
  nutrition: 'Nutrition',
  body: 'Body',
  ask: 'Ask',
}

const INDICATOR_WIDTH = 28
const ACTIVE = '#ffffff'
const INACTIVE = '#52525b'

/**
 * Bottom tab bar rendered by the material-top-tabs navigator. Pages swipe
 * underneath it; this bar stays fixed. Shows an icon + label per tab and a
 * sliding indicator that tracks the active tab.
 */
export function BottomNav({ state, navigation }: MaterialTopTabBarProps) {
  const insets = useSafeAreaInsets()
  const [width, setWidth] = useState(0)
  const indicatorX = useSharedValue(0)

  const count = state.routes.length
  const tabWidth = width / count

  useEffect(() => {
    if (!tabWidth) return
    const target = state.index * tabWidth + tabWidth / 2 - INDICATOR_WIDTH / 2
    indicatorX.value = withTiming(target, {
      duration: 260,
      easing: Easing.out(Easing.cubic),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.index, tabWidth])

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.value }],
  }))

  function onLayout(e: LayoutChangeEvent) {
    setWidth(e.nativeEvent.layout.width)
  }

  return (
    <View
      onLayout={onLayout}
      style={{ paddingBottom: Math.max(insets.bottom, 8) }}
      className="bg-zinc-950 border-t border-zinc-900 flex-row pt-2.5"
    >
      {/* Sliding active indicator */}
      {width > 0 && (
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: 0,
              left: 0,
              width: INDICATOR_WIDTH,
              height: 2.5,
              borderRadius: 2,
              backgroundColor: ACTIVE,
            },
            indicatorStyle,
          ]}
        />
      )}

      {state.routes.map((route, index) => {
        const focused = state.index === index
        const color = focused ? ACTIVE : INACTIVE
        const Icon = TAB_ICONS[route.name]
        const label = LABELS[route.name] ?? route.name

        function onPress() {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          })
          if (!focused && !event.defaultPrevented) {
            hapticSelection()
            navigation.navigate(route.name)
          }
        }

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            className="flex-1 items-center justify-center"
            style={{ minHeight: 48, gap: 4 }}
          >
            {Icon ? <Icon color={color} size={23} /> : null}
            <Text style={{ color, fontSize: 11, fontWeight: focused ? '600' : '400' }}>
              {label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}
