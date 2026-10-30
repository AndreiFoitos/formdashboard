import type { Goal } from '../../hooks/usePreferences'
import type { Pace } from '../../lib/targets'

export const GOAL_LABEL: Record<Goal, string> = { cut: 'Cut', maintain: 'Maintain', bulk: 'Bulk' }
export const GOAL_DETAIL: Record<Goal, string> = {
  cut: 'Lose fat',
  maintain: 'Hold weight',
  bulk: 'Gain muscle',
}

export const PACE_LABEL: Record<Pace, string> = { slow: 'Slow', steady: 'Steady', fast: 'Fast' }
/** What each pace trades off, per goal. The kg/week figure is added by the caller. */
export const PACE_DETAIL: Record<'cut' | 'bulk', Record<Pace, string>> = {
  cut: {
    slow: 'Easiest to stick to, keeps the most strength',
    steady: 'Recommended for most people',
    fast: 'Hungrier, more muscle at risk',
  },
  bulk: {
    slow: 'Least fat gain',
    steady: 'Recommended for most people',
    fast: 'Faster size, more fat with it',
  },
}

/** 23 → "11:00 PM". */
/** Minute of the day → "1:10 PM". */
export function minuteLabel(min: number): string {
  const h = Math.floor(min / 60) % 24
  const m = min % 60
  const display = h % 12 === 0 ? 12 : h % 12
  return `${display}:${m.toString().padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export function hourLabel(h: number): string {
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return `${display}:00 ${period}`
}
