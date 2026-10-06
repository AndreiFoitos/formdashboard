import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import NetInfo from '@react-native-community/netinfo'
import { colors } from '../theme/tokens'

/**
 * Slides a thin banner down from the top whenever the device loses
 * connectivity, and retracts it when the connection returns.
 */
export function OfflineBanner() {
  const insets = useSafeAreaInsets()
  const [offline, setOffline] = useState(false)
  const progress = useSharedValue(0)

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      // `isInternetReachable` can be null while unknown — treat only an
      // explicit false (or no connection) as offline to avoid false alarms.
      const isOffline =
        state.isConnected === false || state.isInternetReachable === false
      setOffline(isOffline)
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    progress.value = withTiming(offline ? 1 : 0, { duration: 260 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline])

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * -40 }],
  }))

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          paddingTop: insets.top + 6,
          paddingBottom: 8,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors['surface-raised'],
          zIndex: 50,
        },
        animatedStyle,
      ]}
    >
      <View className="w-2 h-2 rounded-full bg-warning mr-2" />
      <Text className="text-text text-xs font-medium">No connection</Text>
    </Animated.View>
  )
}
