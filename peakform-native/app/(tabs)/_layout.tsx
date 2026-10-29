import { View } from 'react-native'
import { withLayoutContext } from 'expo-router'
import {
  createMaterialTopTabNavigator,
  type MaterialTopTabNavigationOptions,
} from '@react-navigation/material-top-tabs'
import type { ParamListBase, TabNavigationState } from '@react-navigation/native'
import { BottomNav } from '../../components/BottomNav'
import { useEffect } from 'react'
import { useIsFocused } from '@react-navigation/native'
import { useTabSwipeStore } from '../../store/tabSwipe'
import { useTourStore } from '../../store/tour'
import { SpotlightTour } from '../../components/SpotlightTour'

const { Navigator } = createMaterialTopTabNavigator()

// Bridge the React Navigation material-top-tabs navigator into expo-router's
// file-based routing so each screen in this folder becomes a swipeable tab
// (DESIGN.md §5). OfflineBanner and PolicyUpdateNotice live in the root layout.
const MaterialTopTabs = withLayoutContext<
  MaterialTopTabNavigationOptions,
  typeof Navigator,
  TabNavigationState<ParamListBase>,
  any
>(Navigator)

export default function TabsLayout() {
  // A row swipe or horizontal scroll inside a tab holds a lock; tab swiping
  // pauses until it's released (store/tabSwipe.ts).
  const swipeLocked = useTabSwipeStore((s) => s.locks > 0)

  // The app tour, queued by onboarding or Settings, starts once the tabs are
  // the screen on top (not while onboarding still covers them).
  const focused = useIsFocused()
  const tourPending = useTourStore((s) => s.pending)
  useEffect(() => {
    if (!focused || !tourPending) return
    const t = setTimeout(() => useTourStore.getState().start(), 800)
    return () => clearTimeout(t)
  }, [focused, tourPending])

  return (
    <View className="flex-1 bg-bg">
      <MaterialTopTabs
        tabBarPosition="bottom"
        tabBar={(props) => <BottomNav {...props} />}
        screenOptions={{ swipeEnabled: !swipeLocked, lazy: true }}
      >
        <MaterialTopTabs.Screen name="index" />
        <MaterialTopTabs.Screen name="training" />
        <MaterialTopTabs.Screen name="nutrition" />
        <MaterialTopTabs.Screen name="body" />
        <MaterialTopTabs.Screen name="ask" />
      </MaterialTopTabs>
      <SpotlightTour />
    </View>
  )
}
