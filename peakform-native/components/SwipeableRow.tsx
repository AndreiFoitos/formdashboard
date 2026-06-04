import { useRef } from 'react'
import { Text, View, Pressable } from 'react-native'
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable'
import Reanimated, {
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated'
import { hapticMedium, hapticSuccess, hapticWarning } from '../lib/haptics'

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

function LeftAction({
  translation,
  label,
  onPress,
}: {
  translation: SharedValue<number>
  label: string
  onPress: () => void
}) {
  // Mirror of RightAction but anchored to the left edge — translation.value
  // is positive while the row is being swiped right, so we subtract
  // ACTION_WIDTH to keep the button visually pinned.
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: translation.value - ACTION_WIDTH }],
  }))

  return (
    <View style={{ width: ACTION_WIDTH }}>
      <Reanimated.View style={[{ flex: 1 }, style]}>
        <Pressable
          onPress={onPress}
          style={{
            flex: 1,
            backgroundColor: '#16a34a',
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
  /** Label shown in the revealed delete action. Default "Delete". */
  label?: string
  /** Optional left-side action (swipe right to reveal). Used on Nutrition
   *  entries to save an ingredient. */
  onSave?: () => void
  /** Label shown in the revealed save action. Default "Save". */
  saveLabel?: string
}

/**
 * Wraps a list row so it can be swiped left to reveal a red Delete action,
 * and optionally swiped right to reveal a green Save action.
 * Tapping the action confirms it (an explicit tap guards against accidental
 * actions from a stray swipe).
 */
export function SwipeableRow({
  children,
  onDelete,
  label = 'Delete',
  onSave,
  saveLabel = 'Save',
}: Props) {
  const ref = useRef<SwipeableMethods>(null)
  const opened = useRef(false)

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      rightThreshold={40}
      leftThreshold={onSave ? 40 : undefined}
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
      renderLeftActions={
        onSave
          ? (_progress, translation) => (
              <LeftAction
                translation={translation}
                label={saveLabel}
                onPress={() => {
                  hapticSuccess()
                  ref.current?.close()
                  onSave()
                }}
              />
            )
          : undefined
      }
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
