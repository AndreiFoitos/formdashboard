import { useEffect, useState } from 'react'
import { Keyboard, Platform, type View } from 'react-native'

/**
 * How many pixels of `ref`'s view the keyboard covers, measured in window
 * coordinates. Use it as paddingBottom on a screen whose input sits at the
 * bottom.
 *
 * React Native's KeyboardAvoidingView works from its frame relative to its
 * parent, so a view nested under a header, inside the swipeable tabs and
 * above the bottom tab bar (the Pit Crew chat) got the overlap wrong and the
 * keyboard covered the input. Measuring in the window avoids that.
 */
export function useKeyboardOverlap(ref: React.RefObject<View | null>): number {
  const [overlap, setOverlap] = useState(0)

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const show = Keyboard.addListener(showEvt, (e) => {
      ref.current?.measureInWindow((_x, y, _w, h) => {
        // Padding already applied doesn't change the view's own frame, so
        // this stays correct if the keyboard changes size while open.
        setOverlap(Math.max(0, y + h - e.endCoordinates.screenY))
      })
    })
    const hide = Keyboard.addListener(hideEvt, () => {
      setOverlap(0)
    })
    return () => {
      show.remove()
      hide.remove()
    }
  }, [ref])

  return overlap
}
