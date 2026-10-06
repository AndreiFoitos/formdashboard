import type { Goal } from '../../hooks/usePreferences'

export const GOAL_LABEL: Record<Goal, string> = { cut: 'Cut', maintain: 'Maintain', bulk: 'Bulk' }
export const GOAL_DETAIL: Record<Goal, string> = {
  cut: 'Lose fat',
  maintain: 'Hold weight',
  bulk: 'Gain muscle',
}

/** 23 → "11:00 PM". */
export function hourLabel(h: number): string {
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return `${display}:00 ${period}`
}
