// Saved avatar settings (users.avatar on the backend, schemas/avatar.py) and
// the rules that turn settings + metrics + today's habits into what we render.

import { computeBodyParams, computeDailyEffects, hasVisibleBodyChange, type AvatarBase, type BodyParams, type DailyEffects } from './bodyParams'
import type { AvatarLook, AvatarState } from './model'
import { extrasFor, type AvatarExtras, type Equipped } from './rewards'

export type LookColors = Omit<AvatarLook, 'head'>

export interface AvatarBodyWeights {
  fat: number
  muscle: number
  height_scale: number
  applied_at?: string | null
}

export interface AvatarConfig {
  v: 1
  look: LookColors
  /** The body the user last applied (level-up). Missing until first save. */
  body?: AvatarBodyWeights | null
  frozen?: boolean
  share_body?: boolean
  /** Unlocked cosmetics in use (server checks ownership on save). */
  equipped?: Equipped | null
}

/** What friends receive (routers/friends.py public_avatar). */
export interface PublicAvatar {
  look: LookColors
  body?: Omit<AvatarBodyWeights, 'applied_at'>
  equipped?: Equipped | null
}

export const DEFAULT_LOOK: LookColors = {
  skin: '#e0ac85',
  hair: '#3b2416',
  top: '#2563eb',
  bottom: '#111827',
  shoes: '#f4f4f5',
}

export const PALETTE: Record<keyof LookColors, string[]> = {
  skin: ['#f6d7bf', '#eab98f', '#e0ac85', '#c68a5e', '#9a6440', '#6e4428', '#4a2c1a'],
  hair: ['#0f0c0a', '#3b2416', '#6b4226', '#a8733f', '#d9b36a', '#b8b8b8', '#b3362b'],
  top: ['#2563eb', '#111827', '#f4f4f5', '#dc2626', '#16a34a', '#f59e0b', '#7c3aed', '#db2777'],
  bottom: ['#111827', '#1e3a5f', '#52525b', '#3f2a1d', '#f4f4f5', '#14532d'],
  shoes: ['#f4f4f5', '#111827', '#dc2626', '#2563eb', '#a8a29e'],
}

// Neutral body used for friends who don't share theirs.
const NEUTRAL_BODY = { fat: 0.15, muscle: 0.3, heightScale: 1 }

export const NO_EFFECTS: DailyEffects = computeDailyEffects({ trained: false, waterHit: false, highCaffeine: false })

export interface MetricsInput {
  sex: AvatarBase
  age?: number | null
  heightCm?: number | null
  weightKg?: number | null
  bodyFatPct?: number | null
}

export function bodyFromMetrics(m: MetricsInput): BodyParams {
  return computeBodyParams({
    sex: m.sex,
    age: m.age ?? 25,
    heightCm: m.heightCm ?? (m.sex === 'male' ? 178 : 165),
    weightKg: m.weightKg ?? (m.sex === 'male' ? 78 : 62),
    bodyFatPct: m.bodyFatPct,
  })
}

export interface ResolvedBody {
  fat: number
  muscle: number
  heightScale: number
  /** Metrics moved the body enough to offer a "level up". */
  levelUpAvailable: boolean
}

/** Which body to show: the applied one, unless nothing was applied yet. */
export function resolveBody(config: AvatarConfig | null | undefined, current: BodyParams): ResolvedBody {
  const applied = config?.body
  if (!applied) {
    return { fat: current.fat, muscle: current.muscle, heightScale: current.heightScale, levelUpAvailable: false }
  }
  const moved =
    hasVisibleBodyChange(applied, current) || Math.abs(applied.height_scale - current.heightScale) >= 0.03
  return {
    fat: applied.fat,
    muscle: applied.muscle,
    heightScale: applied.height_scale,
    levelUpAvailable: !config?.frozen && moved,
  }
}

export function appliedBody(current: BodyParams): AvatarBodyWeights {
  const r = (n: number) => Math.round(n * 1000) / 1000
  return {
    fat: r(current.fat),
    muscle: r(current.muscle),
    height_scale: r(current.heightScale),
    applied_at: new Date().toISOString().slice(0, 10),
  }
}

// Caffeine at/above this reads as "high" for the jitter effect. Deliberately
// no reward attached — it's a visual state only.
const HIGH_CAFFEINE_MG = 200

export interface TodaySummary {
  trained?: boolean | null
  water_ml?: number | null
  caffeine_mg?: number | null
}

export function effectsForToday(summary?: TodaySummary | null, waterTargetMl?: number | null): DailyEffects {
  if (!summary) return NO_EFFECTS
  return computeDailyEffects({
    trained: !!summary.trained,
    waterHit: !!waterTargetMl && (summary.water_ml ?? 0) >= waterTargetMl,
    highCaffeine: (summary.caffeine_mg ?? 0) >= HIGH_CAFFEINE_MG,
  })
}

export function toState(
  look: LookColors,
  body: { fat: number; muscle: number; heightScale: number },
  effects: DailyEffects = NO_EFFECTS,
  extras?: AvatarExtras,
): AvatarState {
  return { fat: body.fat, muscle: body.muscle, heightScale: body.heightScale, look: { ...look, head: 'human' }, effects, extras }
}

export function stateForFriend(avatar: PublicAvatar | null | undefined): AvatarState {
  const body = avatar?.body
    ? { fat: avatar.body.fat, muscle: avatar.body.muscle, heightScale: avatar.body.height_scale }
    : NEUTRAL_BODY
  // Friends show their equipped cosmetics (not today's combo effects).
  return toState(avatar?.look ?? DEFAULT_LOOK, body, NO_EFFECTS, extrasFor([], avatar?.equipped))
}
