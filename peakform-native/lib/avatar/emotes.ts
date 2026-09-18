// Podium emotes. Clips are baked into assets/avatar/emotes_{male,female}.glb by
// tools/avatar/build_emotes.py (animation name = emote id). Which ones a user
// owns comes from the backend (services/avatar_rewards.py).

export const EMOTE_NAMES: Record<string, string> = {
  // free
  wave: 'Wave',
  clap: 'Clap',
  cheer: 'Cheer',
  fist_pump: 'Fist pump',
  thumbs_up: 'Thumbs up',
  salute: 'Salute',
  point: 'Point',
  victory_jump: 'Victory jump',
  blow_kiss: 'Blow a kiss',
  bicep_curl: 'Bicep curl',
  // unlockable
  beast_mode: 'Beast mode',
  shadow_boxing: 'Shadow boxing',
  cow_milking: 'Cow milking',
  drop_kick: 'Drop kick',
  rumba_dancing: 'Rumba',
  silly_dancing: 'Silly dance',
  breakdance: 'Breakdance',
  shake_chug: 'Shake chug',
  shrugging: 'Shrug',
  singing: 'Singing',
  hip_hop: 'Hip-hop',
  loser: 'Loser "L"',
  victory_pose: 'Victory pose',
  entry: 'Grand entrance',
  backflip: 'Backflip',
  dismiss: 'Not impressed',
  king_pose: 'King pose',
  taunt: 'Taunt',
  swing_dancing: 'Swing dance',
}

export const FREE_EMOTES = ['wave', 'clap', 'cheer', 'fist_pump', 'thumbs_up', 'salute', 'point', 'victory_jump', 'blow_kiss', 'bicep_curl']

export const ALL_EMOTES = Object.keys(EMOTE_NAMES)

export const emoteName = (id: string | null | undefined) => (id ? EMOTE_NAMES[id] ?? id : '')

/** Deterministic "random" free emote, so a replay can reshuffle by changing the seed. */
export function randomFreeEmote(seed: string): string {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return FREE_EMOTES[Math.abs(h) % FREE_EMOTES.length]
}
