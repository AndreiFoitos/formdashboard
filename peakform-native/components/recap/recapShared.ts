import { unitsFor, useUnitsStore } from '../../lib/units'
// Shared primitives for the Weekly Race recap (race canvas + podium).
// Keeping color + timing here guarantees the line race and the podium agree
// on a member's color and that the canvas animation matches the screen's
// phase clock.

import { colors } from '../../theme/tokens'

// Deterministic palette — same friend → same color every week. Order matters.
export const PALETTE = [
  colors.racer.sky,
  colors.racer.emerald,
  colors.racer.amber,
  colors.racer.rose,
  colors.racer.violet,
  colors.racer.coral,
] as const

export function colorForUser(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) {
    h = ((h << 5) - h + userId.charCodeAt(i)) | 0
  }
  return PALETTE[Math.abs(h) % PALETTE.length]
}

/** Axis label for a kg total, in the user's unit (k-abbreviated). */
export function formatKg(kg: number): string {
  const n = unitsFor(useUnitsStore.getState().system).weight(kg, 0)
  if (n >= 10000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return `${Math.round(n)}`
}

// ─── Race timing ────────────────────────────────────────────────────────────
// One source of truth, imported by both RaceCanvas (the withTiming driver) and
// weekly-recap.tsx (the phase auto-advance clock). Per-day pacing × 7 days.
export const RACE_PER_DAY_MS = 2000
export const RACE_DURATION_MS = 7 * RACE_PER_DAY_MS
