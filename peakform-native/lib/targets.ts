// Calorie and macro target formulas, shared by onboarding and Settings → Profile.

export type Sex = 'male' | 'female'
export type TrainingFreq = '0-1x' | '2-3x' | '4-5x' | '6x+'
export type GoalKey = 'cut' | 'maintain' | 'bulk'

// Training frequency → activity multiplier for TDEE (Harris-Benedict revised
// activity factors, as adopted across modern sports-nutrition guidance —
// e.g. Mifflin et al. 1990; ISSN position stand 2017).
export const ACTIVITY_MULTIPLIER: Record<TrainingFreq, number> = {
  '0-1x': 1.2,    // sedentary
  '2-3x': 1.375,  // lightly active
  '4-5x': 1.55,   // moderately active
  '6x+':  1.725,  // very active
}

// ─── BMR / TDEE (Mifflin-St Jeor, JADA 2005 + ISSN activity factors) ──────────

export function mifflinStJeorBMR(
  sex: Sex,
  weightKg: number,
  heightCm: number,
  ageYears: number,
): number {
  // BMR (kcal/day) = 10·W + 6.25·H − 5·A + s, where s = +5 (male) / −161 (female)
  const offset = sex === 'male' ? 5 : -161
  return 10 * weightKg + 6.25 * heightCm - 5 * ageYears + offset
}

export function tdee(
  sex: Sex,
  weightKg: number,
  heightCm: number,
  ageYears: number,
  freq: TrainingFreq,
): number {
  return mifflinStJeorBMR(sex, weightKg, heightCm, ageYears) * ACTIVITY_MULTIPLIER[freq]
}

// Pace: the share of bodyweight to lose (cut) or gain (bulk) a week. Mirrors
// backend/services/energy.py PACE_RATES; the server works out the weekly
// suggestions, this is only for onboarding, before there's any data.
// Steady cut 0.5%/week (Helms et al. 2014: 0.5–1%/week keeps lean mass);
// steady bulk 0.25%/week (Iraki et al. 2019: 0.25–0.5%/week off-season).
export type Pace = 'slow' | 'steady' | 'fast'
export const PACES: Pace[] = ['slow', 'steady', 'fast']
export const PACE_RATES: Record<'cut' | 'bulk', Record<Pace, number>> = {
  cut: { slow: 0.0025, steady: 0.005, fast: 0.0075 },
  bulk: { slow: 0.001, steady: 0.0025, fast: 0.004 },
}
export const KCAL_PER_KG = 7700

/** kg a week for a goal and pace: negative on a cut, 0 when maintaining. */
export function paceKgPerWeek(goal: GoalKey, pace: Pace, weightKg: number): number {
  if (goal === 'maintain') return 0
  const kg = PACE_RATES[goal][pace] * weightKg
  return goal === 'cut' ? -kg : kg
}

/** Training days per week (Pit preferences) → the onboarding frequency bucket. */
export function freqFromDays(days: number | null | undefined): TrainingFreq {
  if (days == null) return '2-3x'
  if (days <= 1) return '0-1x'
  if (days <= 3) return '2-3x'
  if (days <= 5) return '4-5x'
  return '6x+'
}

/** The onboarding frequency bucket → a starting days-per-week answer.
 *  Round-trips through freqFromDays, so the calorie maths doesn't shift. */
export function daysFromFreq(freq: TrainingFreq): number {
  return { '0-1x': 1, '2-3x': 3, '4-5x': 4, '6x+': 6 }[freq]
}

/** Daily calorie target for a goal and pace, rounded to 10 kcal, inside the
 *  same safety limits as the server: at least the higher of 1,500 kcal (men) /
 *  1,200 (women), BMR and 75% of maintenance; at most maintenance + 500. */
export function calorieTarget(
  goal: GoalKey,
  pace: Pace,
  sex: Sex,
  weightKg: number,
  heightCm: number,
  ageYears: number,
  freq: TrainingFreq,
): number {
  const bmr = mifflinStJeorBMR(sex, weightKg, heightCm, ageYears)
  const t = bmr * ACTIVITY_MULTIPLIER[freq]
  const floor = Math.max(sex === 'male' ? 1500 : 1200, bmr, 0.75 * t)
  const raw = t + (paceKgPerWeek(goal, pace, weightKg) * KCAL_PER_KG) / 7
  return Math.round(Math.min(Math.max(raw, floor), t + 500) / 10) * 10
}
