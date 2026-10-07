import { View } from 'react-native'
import { withLayoutContext } from 'expo-router'
import {
  createMaterialTopTabNavigator,
  type MaterialTopTabNavigationOptions,
} from '@react-navigation/material-top-tabs'
import type { ParamListBase, TabNavigationState } from '@react-navigation/native'
import { BottomNav } from '../../components/BottomNav'
import { useTabSwipeStore } from '../../store/tabSwipe'

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
    </View>
  )
}
