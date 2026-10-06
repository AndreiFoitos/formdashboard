// Clearances for fixed and floating elements (DESIGN.md §4). Content that runs
// under a fixed footer, or must stay clear of floating controls, pads by these —
// never by a raw number. Each one is built from the §3 line heights and §4 steps
// the element itself uses, plus the safe-area inset, so they move together.

import type { EdgeInsets } from 'react-native-safe-area-context'
import { fontSize } from './tokens'

const line = (size: keyof typeof fontSize) => parseInt(fontSize[size][1].lineHeight, 10)

// Full-width py-4 button with a text-body label.
const BUTTON_HEIGHT = 16 + line('body') + 16

/** Bottom padding of a footer fixed to the bottom edge: the home-indicator inset, or 16 on devices without one. */
export const footerBottomPadding = (bottomInset: number) => Math.max(bottomInset, 16)

// Footer chrome above the button: border-t + pt-3.
const FOOTER_TOP = 1 + 12

/** Bottom padding for a scroll view under a footer holding one full-width button. */
export const footerClearance = (bottomInset: number) =>
  FOOTER_TOP + BUTTON_HEIGHT + footerBottomPadding(bottomInset)

/** Bottom padding under a footer with a totals row (caption + mb-1 + title, then mb-3) above its button. */
export const totalsFooterClearance = (bottomInset: number) =>
  footerClearance(bottomInset) + line('caption') + 4 + line('title') + 12

// Weekly recap floating controls sit one step-2 gap inside the safe area.
const RECAP_EDGE_GAP = 8
const RECAP_CLOSE_HEIGHT = 22 // X icon
const RECAP_REPLAY_HEIGHT = 12 + line('footnote') + 12 // py-3 + text-footnote label

/** Weekly recap: where the close (top) and replay (bottom) controls sit. */
export const recapControlOffset = (insets: Pick<EdgeInsets, 'top' | 'bottom'>) => ({
  top: insets.top + RECAP_EDGE_GAP,
  bottom: insets.bottom + RECAP_EDGE_GAP,
})

/** Weekly recap: padding that keeps the podium header and hint clear of the floating controls, plus a 4pt gap. */
export const recapOverlayClearance = (insets: Pick<EdgeInsets, 'top' | 'bottom'>) => {
  const offset = recapControlOffset(insets)
  return {
    top: offset.top + RECAP_CLOSE_HEIGHT + 4,
    bottom: offset.bottom + RECAP_REPLAY_HEIGHT + 4,
  }
}
