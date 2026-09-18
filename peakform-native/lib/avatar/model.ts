// Shared avatar contract. Both the procedural placeholder and the MakeHuman GLB
// (tools/avatar/build_avatar.py) implement `AvatarModel`, so screens don't care
// which one is rendering.

import * as THREE from 'three'
import type { DailyEffects } from './bodyParams'
import type { AvatarExtras } from './rewards'

export type HeadStyle = 'human' | 'gorilla'

export interface AvatarLook {
  skin: string
  hair: string
  top: string
  bottom: string
  shoes: string
  head: HeadStyle
}

export interface AvatarState {
  fat: number
  muscle: number
  heightScale: number
  look: AvatarLook
  effects: DailyEffects
  /** Reward visuals: aura, eye color, tired look, definition. */
  extras?: AvatarExtras
}

export interface AvatarModel {
  root: THREE.Object3D
  /** Push body + look into the scene graph. Cheap; call whenever inputs change. */
  apply(state: AvatarState): void
  /** Idle animation. `time` in seconds. */
  tick(time: number, effects: DailyEffects): void
  dispose(): void
}

let toonRamp: THREE.DataTexture | null = null

/** 3-step light ramp shared by every toon material. */
export function getToonRamp() {
  if (toonRamp) return toonRamp
  const px = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255])
  toonRamp = new THREE.DataTexture(px, 3, 1, THREE.RGBAFormat)
  toonRamp.minFilter = THREE.NearestFilter
  toonRamp.magFilter = THREE.NearestFilter
  toonRamp.generateMipmaps = false
  toonRamp.needsUpdate = true
  return toonRamp
}

export const toonMaterial = (color: string) => new THREE.MeshToonMaterial({ color, gradientMap: getToonRamp() })
