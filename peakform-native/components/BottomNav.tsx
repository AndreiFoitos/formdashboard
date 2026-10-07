import { useState } from 'react'
import { Animated, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { MaterialTopTabBarProps } from '@react-navigation/material-top-tabs'
import { TAB_ICONS } from './TabIcons'
import { hapticLight } from '../lib/haptics'
import { TAB_BAR_HEIGHT, TAB_ICON_SIZE, TAB_INDICATOR, TAB_LABEL_GAP, tabBarBottomPadding } from '../theme/layout'
import { colors } from '../theme/tokens'

// The tab bar (DESIGN.md §5): a custom bottom bar on material-top-tabs so pages
// swipe underneath it. Icons + labels, an accent line above the active tab that
// follows the pager while you swipe.

const LABELS: Record<string, string> = {
  index: 'Today',
  training: 'Training',
  nutrition: 'Nutrition',
  body: 'Body',
  ask: 'Pit',
}

export function BottomNav({ state, navigation, position }: MaterialTopTabBarProps) {
  const insets = useSafeAreaInsets()
  const [width, setWidth] = useState(0)

  const count = state.routes.length
  const tabWidth = width / count
  const indices = state.routes.map((_, i) => i)

  // `position` is the pager's live page offset (fractional mid-swipe), so the
  // indicator glides with the finger rather than jumping when the swipe ends.
  const translateX =
    count > 1 && width > 0
      ? position.interpolate({
          inputRange: indices,
          outputRange: indices.map((i) => i * tabWidth + (tabWidth - TAB_INDICATOR.width) / 2),
          extrapolate: 'clamp',
        })
      : 0

  function onLayout(e: LayoutChangeEvent) {
    setWidth(e.nativeEvent.layout.width)
  }

  return (
    <View
      onLayout={onLayout}
      className="bg-bg flex-row"
      style={{
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.divider,
        paddingBottom: tabBarBottomPadding(insets.bottom),
      }}
      accessibilityRole="tablist"
    >
      {width > 0 && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: TAB_INDICATOR.width,
            height: TAB_INDICATOR.height,
            borderRadius: TAB_INDICATOR.height / 2, // radius 'full'
            borderCurve: 'continuous',
            backgroundColor: colors.accent,
            transform: [{ translateX }],
          }}
        />
      )}

      {state.routes.map((route, index) => {
        const focused = state.index === index
        const color = focused ? colors.accent : colors['text-subtle']
        const Icon = TAB_ICONS[route.name]
        const label = LABELS[route.name] ?? route.name

        function onPress() {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
          hapticLight()
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name)
        }

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            className="flex-1 items-center justify-center"
            style={{ height: TAB_BAR_HEIGHT, gap: TAB_LABEL_GAP }}
          >
            {Icon ? <Icon color={color} size={TAB_ICON_SIZE} /> : null}
            <Text className={`text-caption ${focused ? 'font-semibold' : 'font-normal'}`} style={{ color }}>
              {label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}
