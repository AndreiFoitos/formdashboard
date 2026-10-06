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

// Cut: 500 kcal/day deficit ≈ 0.45 kg/week (ACSM position stand, Donnelly et al. 2009).
// Bulk: 300 kcal/day surplus — conservative lean-mass-gain target backed by
//   Aragon & Schoenfeld (J Int Soc Sports Nutr 2013) and Helms et al. (2014).
export const DEFICIT_KCAL = 500
export const SURPLUS_KCAL = 300

/** Training days per week (Pit preferences) → the onboarding frequency bucket. */
export function freqFromDays(days: number | null | undefined): TrainingFreq {
  if (days == null) return '2-3x'
  if (days <= 1) return '0-1x'
  if (days <= 3) return '2-3x'
  if (days <= 5) return '4-5x'
  return '6x+'
}

/** Daily calorie target for a goal, rounded to 10 kcal. */
export function calorieTarget(
  goal: GoalKey,
  sex: Sex,
  weightKg: number,
  heightCm: number,
  ageYears: number,
  freq: TrainingFreq,
): number {
  const t = tdee(sex, weightKg, heightCm, ageYears, freq)
  const kcal = goal === 'cut' ? t - DEFICIT_KCAL : goal === 'bulk' ? t + SURPLUS_KCAL : t
  return Math.round(kcal / 10) * 10
}
