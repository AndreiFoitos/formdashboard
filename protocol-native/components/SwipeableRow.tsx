import { useRef } from 'react'
import { Text, View, Pressable } from 'react-native'
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable'
import Reanimated, {
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated'
import { hapticMedium, hapticWarning } from '../lib/haptics'

const ACTION_WIDTH = 88

function RightAction({
  translation,
  label,
  onPress,
}: {
  translation: SharedValue<number>
  label: string
  onPress: () => void
}) {
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: translation.value + ACTION_WIDTH }],
  }))

  return (
    <View style={{ width: ACTION_WIDTH }}>
      <Reanimated.View style={[{ flex: 1 }, style]}>
        <Pressable
          onPress={onPress}
          style={{
            flex: 1,
            backgroundColor: '#dc2626',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text className="text-white text-xs font-semibold">{label}</Text>
        </Pressable>
      </Reanimated.View>
    </View>
  )
}

type Props = {
  children: React.ReactNode
  onDelete: () => void
  /** Label shown in the revealed action. Default "Delete". */
  label?: string
}

/**
 * Wraps a list row so it can be swiped left to reveal a red Delete action.
 * Tapping the action confirms the delete (an explicit tap guards against
 * accidental data loss from a stray swipe).
 */
export function SwipeableRow({ children, onDelete, label = 'Delete' }: Props) {
  const ref = useRef<SwipeableMethods>(null)
  const opened = useRef(false)

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      rightThreshold={40}
      renderRightActions={(_progress, translation) => (
        <RightAction
          translation={translation}
          label={label}
          onPress={() => {
            hapticWarning()
            ref.current?.close()
            onDelete()
          }}
        />
      )}
      onSwipeableWillOpen={() => {
        if (!opened.current) hapticMedium()
        opened.current = true
      }}
      onSwipeableClose={() => {
        opened.current = false
      }}
    >
      {children}
    </ReanimatedSwipeable>
  )
}
