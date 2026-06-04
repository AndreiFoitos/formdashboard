import { useEffect } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useUndoStore } from '../store/undo'
import { hapticLight } from '../lib/haptics'

export function UndoToast() {
  const insets = useSafeAreaInsets()
  const current = useUndoStore((s) => s.current)
  const dismiss = useUndoStore((s) => s.dismiss)

  const progress = useSharedValue(0)

  // Auto-dismiss timer — reset whenever a new toast appears.
  useEffect(() => {
    if (!current) {
      progress.value = withTiming(0, { duration: 180 })
      return
    }
    progress.value = withTiming(1, { duration: 220 })
    const t = setTimeout(dismiss, current.durationMs)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.key])

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 32 }],
  }))

  if (!current) return null

  const handleUndo = async () => {
    hapticLight()
    const { onUndo } = current
    dismiss()
    await onUndo()
  }

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: insets.bottom + 16,
          zIndex: 60,
        },
        animatedStyle,
      ]}
    >
      <View
        className="flex-row items-center justify-between bg-zinc-800 border border-zinc-700 rounded-2xl px-4 py-3"
        style={{
          shadowColor: '#000',
          shadowOpacity: 0.3,
          shadowOffset: { width: 0, height: 6 },
          shadowRadius: 10,
          elevation: 6,
        }}
      >
        <Text className="text-zinc-200 text-sm flex-1" numberOfLines={1}>
          {current.label}
        </Text>
        <TouchableOpacity onPress={handleUndo} hitSlop={8} className="ml-3">
          <Text className="text-white text-sm font-semibold uppercase tracking-wider">
            Undo
          </Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  )
}
