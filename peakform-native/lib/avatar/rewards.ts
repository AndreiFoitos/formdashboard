// Avatar rewards (combos + milestones). The backend (services/avatar_rewards.py)
// decides what is earned; this file only knows how rewards LOOK.

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary'
export type EquipSlot = 'aura' | 'frame' | 'eyes'

export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#a1a1aa',
  rare: '#38bdf8',
  epic: '#c084fc',
  legendary: '#facc15',
}

export interface RewardNew {
  key: string
  name: string
  rarity: Rarity
  reward: string | null
  golden: boolean
  has_art: boolean
  /** Emotes unlocked together with this reward. */
  emotes: string[]
}

export interface DexCombo {
  id: string
  name: string
  rarity: Rarity
  recipe: string
  reward: string | null
  has_art: boolean
  secret: boolean
  found: boolean
  days: number
  golden: boolean
  active_today: boolean
  emote: string | null
  emote_golden: string | null
}

export interface DexMilestone {
  id: string
  name: string
  rarity: Rarity
  description: string
  reward: string
  has_art: boolean
  unlocked: boolean
  progress: number | null
  target: number
  needs_trusted: boolean
  blocked_by_trust: boolean
  evaluated: boolean
  emote: string | null
  emote_golden: string | null
}

export interface RewardsPayload {
  today: { combos: string[] }
  owned: string[]
  new: RewardNew[]
  trusted: boolean
  /** Won last week's race: wears the champion crown this week. */
  champion: boolean
  free_emotes: string[]
  dex: { combos: DexCombo[]; milestones: DexMilestone[] }
}

export interface Equipped {
  aura?: string | null
  frame?: string | null
  eyes?: string | null
  /** Podium emote id; null = random free emote each time. */
  emote?: string | null
}

/** Extra visuals on top of body + look (see glbModel.apply). */
export interface AvatarExtras {
  aura?: string | null
  eyeColor?: string | null
  tired?: boolean
  /** 0..1: leaner/more defined look (Shredder). */
  definition?: number
  /** Extra muscle on top of the training pump (Bulk Szn). */
  pumpBoost?: number
}

// ─── Item catalog (visual side) ──────────────────────────────────────────────

interface ItemInfo {
  name: string
  slot?: EquipSlot
  color?: string
}

export const ITEMS: Record<string, ItemInfo> = {
  eyes_demon: { name: 'Demon eyes', slot: 'eyes', color: '#ef4444' },
  eyes_demon_gold: { name: 'Golden demon eyes', slot: 'eyes', color: '#facc15' },
  aura_blue: { name: 'Blue aura', slot: 'aura', color: '#38bdf8' },
  aura_flame: { name: 'Flame aura', slot: 'aura', color: '#f97316' },
  aura_flame_blue: { name: 'Blue flame aura', slot: 'aura', color: '#3b82f6' },
  frame_shredded: { name: 'Shredded frame', slot: 'frame', color: '#ef4444' },
  frame_shredded_gold: { name: 'Golden shredded frame', slot: 'frame', color: '#facc15' },
  frame_pr: { name: 'PR medal frame', slot: 'frame', color: '#eab308' },
  frame_pr_gold: { name: 'PR machine frame', slot: 'frame', color: '#fde047' },
  frame_trusted: { name: 'Certified frame', slot: 'frame', color: '#38bdf8' },
  colorway_aqua: { name: 'Aqua outfit colors' },
  colorway_aqua_gold: { name: 'Aqua outfit colors (golden)' },
  colorway_gold: { name: 'Gold outfit colors' },
  colorway_gold_gold: { name: 'Gold outfit colors (golden)' },
  aura_blue_gold: { name: 'Blue aura (golden)', slot: 'aura', color: '#7dd3fc' },
  // Items waiting on 3D art — earned and stored now, shown once the art ships.
  head_gorilla: { name: 'Gorilla head' },
  top_stringer: { name: 'Stringer tank top' },
  head_crown: { name: 'Crown' },
  hand_shaker: { name: 'Shaker bottle' },
  wrist_wraps: { name: 'Wrist wraps' },
  lifting_belt: { name: 'Lifting belt' },
  beard_million: { name: 'The Million Beard' },
  headband_gym_rat: { name: 'Gym Rat headband' },
  gold_chain: { name: 'Gold chain' },
  crown_champion: { name: 'Champion crown' },
  hand_gallon: { name: 'Gallon jug' },
}

export const itemName = (id: string | null | undefined) => (id ? ITEMS[id]?.name ?? id : '')

/** Colors that only appear in the editor once their colorway is owned. */
export const EXCLUSIVE_PALETTE: { colorway: string; top: string; bottom: string; shoes: string }[] = [
  { colorway: 'colorway_aqua', top: '#06b6d4', bottom: '#0e7490', shoes: '#67e8f9' },
  { colorway: 'colorway_gold', top: '#d4a017', bottom: '#8a6d1d', shoes: '#f5d061' },
]

export function ownedForSlot(owned: string[], slot: EquipSlot): string[] {
  return owned.filter((id) => ITEMS[id]?.slot === slot)
}

// What each combo does to the avatar on the day it's active.
const TODAY_EFFECT: Record<string, AvatarExtras> = {
  gorilla_mode: { aura: '#b45309', eyeColor: '#ef4444' }, // gorilla head shows once its art ships
  pre_workout_demon: { eyeColor: '#ef4444' },
  bulk_szn: { pumpBoost: 0.15 },
  shredder: { definition: 1 },
  rest_day_royalty: { aura: '#fde68a' },
  hydro_homie: { aura: '#22d3ee' },
  protein_goblin: { aura: '#84cc16' },
  clean_machine: { aura: '#38bdf8' },
  perfect_day: { aura: '#facc15' },
  too_wired: { tired: true },
}

/**
 * Today's combo effects stack on top of what's equipped. `todayCombos` is
 * sorted by rarity (backend), so the rarest combo's aura wins.
 */
export function extrasFor(todayCombos: string[], equipped?: Equipped | null): AvatarExtras {
  const out: AvatarExtras = {
    aura: equipped?.aura ? ITEMS[equipped.aura]?.color ?? null : null,
    eyeColor: equipped?.eyes ? ITEMS[equipped.eyes]?.color ?? null : null,
  }
  let auraFromToday = false
  for (const id of todayCombos) {
    const fx = TODAY_EFFECT[id]
    if (!fx) continue
    if (fx.aura && !auraFromToday) {
      out.aura = fx.aura
      auraFromToday = true
    }
    if (fx.eyeColor) out.eyeColor = fx.eyeColor
    if (fx.tired) out.tired = true
    if (fx.definition) out.definition = Math.max(out.definition ?? 0, fx.definition)
    if (fx.pumpBoost) out.pumpBoost = Math.max(out.pumpBoost ?? 0, fx.pumpBoost)
  }
  return out
}

export function frameColor(frame?: string | null): string | null {
  return frame ? ITEMS[frame]?.color ?? null : null
}
