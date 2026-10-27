import { InputAccessoryView, Keyboard, Platform, Text, TouchableOpacity, View } from 'react-native'

export const KEYBOARD_DONE_ID = 'keyboard-done'

/**
 * iOS number pads have no return key, so once one was up there was no way
 * to put it away and it sat over the rest of the sheet. Inputs opt in with
 * inputAccessoryViewID={KEYBOARD_DONE_ID}; render this once in the screen or
 * modal that holds them.
 */
export function KeyboardDoneBar() {
  if (Platform.OS !== 'ios') return null
  return (
    <InputAccessoryView nativeID={KEYBOARD_DONE_ID}>
      <View className="flex-row justify-end bg-surface-raised border-t border-divider px-4">
        <TouchableOpacity
          onPress={() => Keyboard.dismiss()}
          hitSlop={10}
          className="justify-center"
          style={{ minHeight: 44 }}
          accessibilityRole="button"
        >
          <Text className="text-accent text-body font-semibold">Done</Text>
        </TouchableOpacity>
      </View>
    </InputAccessoryView>
  )
}
