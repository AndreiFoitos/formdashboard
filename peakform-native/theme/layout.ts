// Clearances for fixed and floating elements (DESIGN.md §4). Content that runs
// under a fixed footer, or must stay clear of floating controls, pads by these —
// never by a raw number. Each one is built from the §3 line heights and §4 steps
// the element itself uses, so they move together.

import { fontSize } from './tokens'

const line = (size: keyof typeof fontSize) => parseInt(fontSize[size][1].lineHeight, 10)

// Full-width py-4 button with a text-body label.
const BUTTON_HEIGHT = 16 + line('body') + 16

// Absolute bottom footer: border-t + pt-3 above the content, pb-8 below. The
// pb-8 is what clears the home indicator — these footers use a fixed bottom
// padding rather than the safe-area inset, so the inset isn't added here.
const FOOTER_CHROME = 1 + 12 + 32

/** Bottom padding for a scroll view under a footer holding one full-width button. */
export const FOOTER_CLEARANCE = FOOTER_CHROME + BUTTON_HEIGHT

/** Bottom padding under a footer with a totals row (caption + mb-1 + title, then mb-3) above its button. */
export const TOTALS_FOOTER_CLEARANCE = FOOTER_CLEARANCE + line('caption') + 4 + line('title') + 12

/** Weekly recap: the close and replay controls sit this far from the top/bottom edge. */
export const RECAP_CONTROL_OFFSET = 48

const RECAP_CLOSE_HEIGHT = 22 // X icon
const RECAP_REPLAY_HEIGHT = 12 + line('footnote') + 12 // py-3 + text-footnote label

/** Weekly recap: padding that keeps the podium header and hint clear of the floating controls, plus a 4pt gap. */
export const RECAP_OVERLAY_CLEARANCE = {
  top: RECAP_CONTROL_OFFSET + RECAP_CLOSE_HEIGHT + 4,
  bottom: RECAP_CONTROL_OFFSET + RECAP_REPLAY_HEIGHT + 4,
} as const
