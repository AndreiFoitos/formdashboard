// Body metrics → avatar morph influences.
//
// Pure TS (no React Native imports) so it can be unit-tested or reused on the
// web. The 3D model exposes shape keys ("fat", "muscle"); this file decides how
// strongly each one applies. Nothing here is persisted — it is recomputed from
// the latest metrics, and the user's stored avatar only records what they chose
// to *apply* (level-up flow).

export type AvatarBase = 'male' | 'female'

export interface BodyInputs {
  sex: AvatarBase
  age: number
  heightCm: number
  weightKg: number
  /** Measured body fat. When missing we estimate it from BMI. */
  bodyFatPct?: number | null
}

export interface BodyParams {
  /** 0..1 influence of the "fat" shape key. Capped below 1 on purpose. */
  fat: number
  /** 0..1 influence of the "muscle" shape key. */
  muscle: number
  /** Uniform-ish scale applied to the whole figure. */
  heightScale: number
  /** 0 at ≤30y → 1 at ≥70y. Reserved for opt-in cosmetics (grey hair). */
  age: number
  // Derived numbers, surfaced for debugging / the methodology page.
  bmi: number
  bodyFatPct: number
  bodyFatEstimated: boolean
  ffmi: number
}

// Hard caps keep the silhouette stylized and flattering at the extremes.
const FAT_CAP = 0.85

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const remap = (v: number, from0: number, from1: number) => clamp((v - from0) / (from1 - from0), 0, 1)

/** Deurenberg (1991): BF% = 1.20·BMI + 0.23·age − 10.8·male − 5.4 */
export function estimateBodyFat(bmi: number, age: number, sex: AvatarBase): number {
  return clamp(1.2 * bmi + 0.23 * age - 10.8 * (sex === 'male' ? 1 : 0) - 5.4, 3, 60)
}

export function computeBodyParams(input: BodyInputs): BodyParams {
  const heightM = clamp(input.heightCm, 120, 230) / 100
  const weight = clamp(input.weightKg, 30, 250)
  const age = clamp(input.age, 13, 100)
  const bmi = weight / (heightM * heightM)

  const bodyFatEstimated = input.bodyFatPct == null
  const bodyFatPct = bodyFatEstimated
    ? estimateBodyFat(bmi, age, input.sex)
    : clamp(input.bodyFatPct as number, 3, 60)

  // Height-normalized fat-free mass index (Kouri et al. 1995).
  const leanKg = weight * (1 - bodyFatPct / 100)
  const ffmi = leanKg / (heightM * heightM) + 6.1 * (1.8 - heightM)

  const male = input.sex === 'male'
  const fatNorm = remap(bodyFatPct, male ? 10 : 18, male ? 38 : 46)
  const fat = fatNorm * FAT_CAP
  // Heavier people carry more lean mass too, but it reads as size, not
  // definition — damp the muscle key as fat rises so it doesn't look "jacked".
  const muscle = remap(ffmi, male ? 18.5 : 15.5, male ? 25.5 : 22) * (1 - 0.4 * fatNorm)

  return {
    fat,
    muscle,
    heightScale: clamp(heightM / (male ? 1.78 : 1.65), 0.88, 1.12),
    age: remap(age, 30, 70),
    bmi,
    bodyFatPct,
    bodyFatEstimated,
    ffmi,
  }
}

/**
 * Level-up trigger: true when the freshly computed body differs enough from
 * the body the user last applied to be worth a "your avatar leveled up" moment.
 */
export function hasVisibleBodyChange(
  applied: Pick<BodyParams, 'fat' | 'muscle'>,
  next: Pick<BodyParams, 'fat' | 'muscle'>,
  threshold = 0.08,
): boolean {
  return Math.abs(applied.fat - next.fat) >= threshold || Math.abs(applied.muscle - next.muscle) >= threshold
}

// ─── Daily state layer ──────────────────────────────────────────────────────
// Each habit signal owns one visual channel so any combination stacks without
// bespoke art. Curated combos (signature effects + unlocks) sit on top later.

export interface DailySignals {
  trained: boolean
  waterHit: boolean
  highCaffeine: boolean
}

export interface DailyEffects {
  /** Added to the muscle influence until midnight. */
  pump: number
  /** 0..1 skin glow (emissive). */
  glow: number
  /** 0..1 head/eye jitter. */
  jitter: number
  /** Idle animation speed multiplier. */
  energy: number
}

export function computeDailyEffects(s: DailySignals): DailyEffects {
  return {
    pump: s.trained ? 0.18 : 0,
    glow: s.waterHit ? 1 : 0,
    jitter: s.highCaffeine ? 1 : 0,
    energy: 1 + (s.trained ? 0.25 : 0) + (s.highCaffeine ? 0.6 : 0),
  }
}
