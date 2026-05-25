import { View } from 'react-native'
import { withLayoutContext } from 'expo-router'
import {
  createMaterialTopTabNavigator,
  type MaterialTopTabNavigationOptions,
} from '@react-navigation/material-top-tabs'
import type { ParamListBase, TabNavigationState } from '@react-navigation/native'
import { BottomNav } from '../../components/BottomNav'
import { OfflineBanner } from '../../components/OfflineBanner'

const { Navigator } = createMaterialTopTabNavigator()

// Bridge the React Navigation material-top-tabs navigator into expo-router's
// file-based routing so each screen in this folder becomes a swipeable tab.
const MaterialTopTabs = withLayoutContext<
  MaterialTopTabNavigationOptions,
  typeof Navigator,
  TabNavigationState<ParamListBase>,
  any
>(Navigator)

export default function TabsLayout() {
  return (
    <View className="flex-1 bg-black">
      <MaterialTopTabs
        tabBarPosition="bottom"
        tabBar={(props) => <BottomNav {...props} />}
        screenOptions={{ swipeEnabled: true, lazy: true }}
      >
        <MaterialTopTabs.Screen name="index" />
        <MaterialTopTabs.Screen name="training" />
        <MaterialTopTabs.Screen name="nutrition" />
        <MaterialTopTabs.Screen name="body" />
        <MaterialTopTabs.Screen name="ask" />
      </MaterialTopTabs>
      <OfflineBanner />
    </View>
  )
}
