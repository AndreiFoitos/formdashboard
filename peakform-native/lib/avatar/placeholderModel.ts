// Procedural placeholder avatar — stands in for the Blender/MakeHuman GLB.
//
// It deliberately mirrors the real asset contract so the rendering code does
// not change when the GLB lands:
//   • every body mesh carries two shape keys, index 0 = "fat", 1 = "muscle"
//     (driven through `morphTargetInfluences`, exactly like GLB shape keys)
//   • clothes are separate meshes that carry the SAME shape keys, so they
//     follow the body instead of clipping
//   • the head is a swappable slot (human / gorilla)
//
// Pure three.js — no React Native imports — so it can be rendered in a browser
// for quick visual checks.

import * as THREE from 'three'
import type { AvatarBase, DailyEffects } from './bodyParams'
import { getToonRamp, toonMaterial as toon, type AvatarModel, type AvatarState } from './model'

type Morph = { fat: number; muscle: number }
type Vec2 = [number, number]
/** [t, base, fatDelta, muscleDelta] */
type Key = [number, number, number?, number?]

const FAT_KEY = 0
const MUSCLE_KEY = 1

// ─── Profile helpers ────────────────────────────────────────────────────────

/** Cosine-interpolated profile through keypoints, evaluated at a morph state. */
function profile(keys: Key[], t: number, m: Morph, scale = 1): number {
  const val = (k: Key) => (k[1] + (k[2] ?? 0) * m.fat + (k[3] ?? 0) * m.muscle) * scale
  if (t <= keys[0][0]) return val(keys[0])
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const a = keys[i - 1]
      const b = keys[i]
      const u = (t - a[0]) / (b[0] - a[0])
      const s = (1 - Math.cos(u * Math.PI)) / 2
      return val(a) + (val(b) - val(a)) * s
    }
  }
  return val(keys[keys.length - 1])
}

interface TubeFrame {
  /** Axis start/end in the XY plane (all tubes lie in XY; depth is Z). */
  a: Vec2
  b: Vec2
  z?: number
  rx: number
  rzFront: number
  rzBack: number
}

type TubeSpec = (t: number, m: Morph) => TubeFrame

const BASE: Morph = { fat: 0, muscle: 0 }
const FAT: Morph = { fat: 1, muscle: 0 }
const MUSCLE: Morph = { fat: 0, muscle: 1 }

function tubePositions(spec: TubeSpec, m: Morph, rows: number, cols: number, t0: number, t1: number, inflate: number) {
  const out = new Float32Array((rows + 1) * (cols + 1) * 3)
  let o = 0
  for (let i = 0; i <= rows; i++) {
    const t = t0 + (t1 - t0) * (i / rows)
    const f = spec(t, m)
    const dx = f.b[0] - f.a[0]
    const dy = f.b[1] - f.a[1]
    const len = Math.hypot(dx, dy) || 1
    // u = normalize(cross(dir, +Z)) keeps winding consistent for any XY axis.
    const ux = dy / len
    const uy = -dx / len
    const cx = f.a[0] + dx * t
    const cy = f.a[1] + dy * t
    const cz = f.z ?? 0
    const pad = f.rx > 1e-4 ? inflate : 0
    for (let j = 0; j <= cols; j++) {
      const th = (j / cols) * Math.PI * 2
      const c = Math.cos(th)
      const s = Math.sin(th)
      const rx = f.rx + pad
      const rz = (s > 0 ? f.rzFront : f.rzBack) + pad
      out[o++] = cx + ux * c * rx
      out[o++] = cy + uy * c * rx
      out[o++] = cz + s * rz
    }
  }
  return out
}

function normalsFor(positions: Float32Array, index: THREE.BufferAttribute, rows: number, cols: number) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setIndex(index)
  g.computeVertexNormals()
  const n = g.getAttribute('normal').array as Float32Array
  // Average the duplicated seam column so toon bands don't show a hard line.
  for (let i = 0; i <= rows; i++) {
    const a = i * (cols + 1) * 3
    const b = (i * (cols + 1) + cols) * 3
    for (let k = 0; k < 3; k++) {
      const avg = (n[a + k] + n[b + k]) / 2
      n[a + k] = avg
      n[b + k] = avg
    }
  }
  return new THREE.BufferAttribute(n, 3)
}

/** Closed-or-open tube whose fat/muscle extremes become morph targets. */
function morphTube(
  spec: TubeSpec,
  { rows = 24, cols = 20, t0 = 0, t1 = 1, inflate = 0 } = {},
): THREE.BufferGeometry {
  const idx: number[] = []
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j
      const b = a + cols + 1
      idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const index = new THREE.BufferAttribute(new Uint16Array(idx), 1)
  const base = tubePositions(spec, BASE, rows, cols, t0, t1, inflate)
  const fat = tubePositions(spec, FAT, rows, cols, t0, t1, inflate)
  const muscle = tubePositions(spec, MUSCLE, rows, cols, t0, t1, inflate)

  const geo = new THREE.BufferGeometry()
  geo.setIndex(index)
  geo.setAttribute('position', new THREE.BufferAttribute(base, 3))
  geo.setAttribute('normal', normalsFor(base, index, rows, cols))
  geo.morphAttributes.position = [new THREE.BufferAttribute(fat, 3), new THREE.BufferAttribute(muscle, 3)]
  geo.morphAttributes.normal = [normalsFor(fat, index, rows, cols), normalsFor(muscle, index, rows, cols)]
  geo.morphTargetsRelative = false
  return geo
}

// ─── Body specs (male / female bases) ───────────────────────────────────────

interface BodyShape {
  torso: Key[]
  belly: Key[]
  arm: Key[]
  leg: Key[]
  neck: Key[]
  hipX: Key[]
}

const MALE: BodyShape = {
  torso: [[0, 0], [0.06, 0.15, 0.07, 0.005], [0.32, 0.138, 0.11, 0.01], [0.62, 0.165, 0.065, 0.03], [0.86, 0.19, 0.02, 0.065], [0.95, 0.145, 0.01, 0.045], [1, 0]],
  belly: [[0, 0], [0.12, 0, 0.03], [0.32, 0, 0.13], [0.5, 0, 0.075, 0.004], [0.7, 0.004, 0.012, 0.035], [0.86, 0, 0, 0.01], [1, 0]],
  arm: [[0, 0], [0.06, 0.05, 0.028, 0.032], [0.25, 0.048, 0.034, 0.038], [0.5, 0.039, 0.022, 0.012], [0.68, 0.043, 0.014, 0.022], [0.97, 0.03, 0.006, 0.006], [1, 0]],
  leg: [[0, 0], [0.04, 0.078, 0.03, 0.02], [0.22, 0.075, 0.048, 0.032], [0.5, 0.052, 0.028, 0.014], [0.62, 0.048, 0.012, 0.008], [0.75, 0.05, 0.012, 0.02], [0.97, 0.034, 0.004, 0.004], [1, 0]],
  neck: [[0, 0], [0.15, 0.055, 0.014, 0.028], [0.85, 0.048, 0.01, 0.012], [1, 0]],
  hipX: [[0, 0.085, 0.03, 0.004]],
}

const FEMALE: BodyShape = {
  torso: [[0, 0], [0.06, 0.168, 0.08, 0.004], [0.32, 0.122, 0.105, 0.008], [0.62, 0.148, 0.06, 0.018], [0.86, 0.165, 0.02, 0.045], [0.95, 0.125, 0.01, 0.03], [1, 0]],
  belly: [[0, 0], [0.12, 0, 0.03], [0.32, 0, 0.11], [0.5, 0, 0.06], [0.68, 0.034, 0.018, 0.012], [0.8, 0.012, 0.005, 0.004], [1, 0]],
  arm: [[0, 0], [0.06, 0.042, 0.028, 0.024], [0.25, 0.04, 0.034, 0.028], [0.5, 0.033, 0.022, 0.01], [0.68, 0.036, 0.013, 0.016], [0.97, 0.026, 0.006, 0.005], [1, 0]],
  leg: [[0, 0], [0.04, 0.085, 0.034, 0.018], [0.22, 0.08, 0.05, 0.028], [0.5, 0.052, 0.028, 0.012], [0.62, 0.046, 0.012, 0.007], [0.75, 0.047, 0.012, 0.016], [0.97, 0.031, 0.004, 0.003], [1, 0]],
  neck: [[0, 0], [0.15, 0.046, 0.012, 0.02], [0.85, 0.04, 0.008, 0.008], [1, 0]],
  hipX: [[0, 0.095, 0.03, 0.003]],
}

const HEAD: Key[] = [[0, 0], [0.1, 0.11], [0.35, 0.168, 0.042], [0.6, 0.185, 0.014], [0.85, 0.15], [1, 0]]
const HEAD_Y: Vec2 = [1.43, 1.85]
const TORSO_Y: Vec2 = [0.8, 1.4]
const NECK_PIVOT_Y = 1.45

function bodySpecs(shape: BodyShape) {
  const torso: TubeSpec = (t, m) => {
    const rx = profile(shape.torso, t, m)
    return { a: [0, TORSO_Y[0]], b: [0, TORSO_Y[1]], rx, rzBack: rx * 0.62, rzFront: rx * 0.62 + profile(shape.belly, t, m) }
  }
  const neck: TubeSpec = (t, m) => {
    const rx = profile(shape.neck, t, m)
    return { a: [0, 1.34], b: [0, 1.5], rx, rzBack: rx * 0.9, rzFront: rx * 0.9 }
  }
  const armAxis = (side: 1 | -1, m: Morph): { a: Vec2; b: Vec2 } => {
    const shoulderX = profile(shape.torso, 0.86, m) - 0.025
    const a: Vec2 = [side * shoulderX, 1.3]
    return { a, b: [a[0] + side * 0.1, 0.76] }
  }
  const arm = (side: 1 | -1): TubeSpec => (t, m) => {
    const rx = profile(shape.arm, t, m)
    return { ...armAxis(side, m), rx, rzBack: rx * 0.95, rzFront: rx * 0.95 }
  }
  const hand = (side: 1 | -1): TubeSpec => (t, m) => {
    const { a, b } = armAxis(side, m)
    const dx = (b[0] - a[0]) / 0.545
    const dy = (b[1] - a[1]) / 0.545
    const r = profile([[0, 0], [0.3, 1], [0.7, 0.9], [1, 0]], t, m)
    return { a: [b[0] - dx * 0.01, b[1] - dy * 0.01], b: [b[0] + dx * 0.12, b[1] + dy * 0.12], rx: 0.022 * r, rzFront: 0.042 * r, rzBack: 0.036 * r }
  }
  const legAxis = (side: 1 | -1, m: Morph): { a: Vec2; b: Vec2 } => {
    const hx = profile(shape.hipX, 0, m)
    return { a: [side * hx, 0.86], b: [side * 0.1, 0.1] }
  }
  const leg = (side: 1 | -1): TubeSpec => (t, m) => {
    const rx = profile(shape.leg, t, m)
    return { ...legAxis(side, m), rx, rzBack: rx * 0.95, rzFront: rx * 0.95 }
  }
  const foot = (side: 1 | -1): TubeSpec => (t, m) => {
    const r = profile([[0, 0.35], [0.15, 1], [0.65, 0.95], [1, 0]], t, m)
    return { a: [side * 0.1, 0], b: [side * 0.1, 0.12], z: 0.03, rx: 0.052 * r, rzFront: 0.13 * r, rzBack: 0.06 * r }
  }
  return { torso, neck, arm, hand, leg, foot }
}

const headSpec = (inflate = 0): TubeSpec => (t, m) => {
  const rx = profile(HEAD, t, m) + (t > 0 && t < 1 ? inflate : 0)
  return { a: [0, HEAD_Y[0]], b: [0, HEAD_Y[1]], rx, rzBack: rx * 1.02, rzFront: rx }
}

// ─── Public model API ───────────────────────────────────────────────────────

export interface PlaceholderAvatar {
  base: AvatarBase
  root: THREE.Group
  /** Everything above the hips — breathes during idle. */
  upper: THREE.Group
  headGroup: THREE.Group
  humanHead: THREE.Group
  gorillaHead: THREE.Group
  morphMeshes: THREE.Mesh[]
  materials: Record<'skin' | 'hair' | 'top' | 'bottom' | 'shoes' | 'eye' | 'gorilla' | 'gorillaFace', THREE.MeshToonMaterial>
  dispose(): void
}

export function createPlaceholderAvatar(base: AvatarBase): PlaceholderAvatar {
  const shape = base === 'male' ? MALE : FEMALE
  const s = bodySpecs(shape)
  const materials = {
    skin: toon('#c68a5e'),
    hair: toon('#2b1d14'),
    top: toon('#1f2937'),
    bottom: toon('#111827'),
    shoes: toon('#f4f4f5'),
    eye: new THREE.MeshToonMaterial({ color: '#111111', gradientMap: getToonRamp() }),
    gorilla: toon('#2d2c30'),
    gorillaFace: toon('#6e5c52'),
  }
  const geometries: THREE.BufferGeometry[] = []
  const morphMeshes: THREE.Mesh[] = []

  const root = new THREE.Group()
  const upper = new THREE.Group()
  root.add(upper)

  const addMorph = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material) => {
    geometries.push(geo)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.morphTargetInfluences = [0, 0]
    parent.add(mesh)
    morphMeshes.push(mesh)
    return mesh
  }

  // Body
  addMorph(upper, morphTube(s.torso, { rows: 30, cols: 26 }), materials.skin)
  addMorph(upper, morphTube(s.neck, { rows: 8, cols: 16 }), materials.skin)
  for (const side of [1, -1] as const) {
    addMorph(upper, morphTube(s.arm(side), { rows: 22, cols: 16 }), materials.skin)
    addMorph(upper, morphTube(s.hand(side), { rows: 10, cols: 12 }), materials.skin)
    addMorph(root, morphTube(s.leg(side), { rows: 24, cols: 16 }), materials.skin)
    addMorph(root, morphTube(s.foot(side), { rows: 10, cols: 16 }), materials.shoes)
  }

  // Clothes — same specs, inflated, partial ranges. They inherit the shape keys.
  addMorph(upper, morphTube(s.torso, { rows: 22, cols: 26, t0: 0.2, t1: 0.9, inflate: 0.012 }), materials.top)
  addMorph(root, morphTube(s.torso, { rows: 8, cols: 26, t0: 0, t1: 0.3, inflate: 0.016 }), materials.bottom)
  for (const side of [1, -1] as const) {
    addMorph(root, morphTube(s.leg(side), { rows: 10, cols: 16, t0: 0.02, t1: 0.42, inflate: 0.014 }), materials.bottom)
  }

  // Head slot
  // Pivot at the neck so idle/jitter rotations nod the head instead of
  // swinging it around the feet.
  const headGroup = new THREE.Group()
  headGroup.position.y = NECK_PIVOT_Y
  upper.add(headGroup)
  const headInner = new THREE.Group()
  headInner.position.y = -NECK_PIVOT_Y
  headGroup.add(headInner)

  const humanHead = new THREE.Group()
  headInner.add(humanHead)
  addMorph(humanHead, morphTube(headSpec(), { rows: 20, cols: 22 }), materials.skin)
  const hairTop = morphTube(headSpec(0.014), { rows: 10, cols: 22, t0: base === 'male' ? 0.62 : 0.5, t1: 1 })
  addMorph(humanHead, hairTop, materials.hair)
  if (base === 'female') {
    const backHair = new THREE.SphereGeometry(1, 18, 14)
    geometries.push(backHair)
    const m = new THREE.Mesh(backHair, materials.hair)
    m.scale.set(0.2, 0.24, 0.12)
    m.position.set(0, 1.56, -0.08)
    humanHead.add(m)
  }

  const sphere = new THREE.SphereGeometry(1, 14, 10)
  geometries.push(sphere)
  const blob = (parent: THREE.Object3D, mat: THREE.Material, pos: [number, number, number], scale: [number, number, number]) => {
    const m = new THREE.Mesh(sphere, mat)
    m.position.set(...pos)
    m.scale.set(...scale)
    parent.add(m)
    return m
  }
  for (const side of [1, -1]) {
    blob(humanHead, materials.eye, [side * 0.062, 1.655, 0.172], [0.02, 0.028, 0.012])
    blob(humanHead, materials.hair, [side * 0.065, 1.705, 0.168], [0.034, 0.008, 0.012])
  }

  const gorillaHead = new THREE.Group()
  headInner.add(gorillaHead)
  blob(gorillaHead, materials.gorilla, [0, 1.65, 0], [0.2, 0.215, 0.19])
  blob(gorillaHead, materials.gorillaFace, [0, 1.585, 0.13], [0.125, 0.085, 0.085])
  blob(gorillaHead, materials.gorillaFace, [0, 1.67, 0.13], [0.11, 0.06, 0.06])
  blob(gorillaHead, materials.gorilla, [0, 1.715, 0.15], [0.15, 0.03, 0.055])
  for (const side of [1, -1]) {
    blob(gorillaHead, materials.eye, [side * 0.052, 1.675, 0.185], [0.018, 0.016, 0.01])
    blob(gorillaHead, materials.gorillaFace, [side * 0.195, 1.66, 0], [0.04, 0.05, 0.025])
    blob(gorillaHead, materials.eye, [side * 0.028, 1.6, 0.212], [0.014, 0.009, 0.006])
  }
  gorillaHead.visible = false

  return {
    base,
    root,
    upper,
    headGroup,
    humanHead,
    gorillaHead,
    morphMeshes,
    materials,
    dispose() {
      geometries.forEach((g) => g.dispose())
      Object.values(materials).forEach((m) => m.dispose())
    },
  }
}

/** Push body + look into the scene graph. Cheap; call whenever inputs change. */
export function applyAvatarState(avatar: PlaceholderAvatar, st: AvatarState) {
  const muscle = Math.min(1, st.muscle + st.effects.pump)
  for (const mesh of avatar.morphMeshes) {
    const inf = mesh.morphTargetInfluences!
    inf[FAT_KEY] = st.fat
    inf[MUSCLE_KEY] = muscle
  }
  const hs = st.heightScale
  avatar.root.scale.set(0.5 + hs * 0.5, hs, 0.5 + hs * 0.5)

  const m = avatar.materials
  m.skin.color.set(st.look.skin)
  m.hair.color.set(st.look.hair)
  m.top.color.set(st.look.top)
  m.bottom.color.set(st.look.bottom)
  m.shoes.color.set(st.look.shoes)
  // Hydration channel: faint warm glow on skin.
  m.skin.emissive.set(st.look.skin)
  m.skin.emissiveIntensity = 0.18 * st.effects.glow
  // Caffeine channel: gorilla eyes go red.
  m.eye.color.set(st.effects.jitter > 0 && st.look.head === 'gorilla' ? '#ff2d2d' : '#111111')

  avatar.humanHead.visible = st.look.head === 'human'
  avatar.gorillaHead.visible = st.look.head === 'gorilla'
}

/** Idle animation. `time` in seconds. */
export function tickAvatar(avatar: PlaceholderAvatar, time: number, effects: DailyEffects) {
  const t = time * effects.energy
  const breath = Math.sin(t * 2.2)
  avatar.upper.scale.set(1 + breath * 0.008, 1 + breath * 0.004, 1 + breath * 0.012)
  avatar.root.position.y = Math.abs(Math.sin(t * 1.1)) * 0.006 * effects.energy

  const jit = effects.jitter
  avatar.headGroup.rotation.z = Math.sin(t * 1.3) * 0.02 + (jit ? Math.sin(time * 47) * 0.012 : 0)
  avatar.headGroup.rotation.y = jit ? Math.sin(time * 31) * 0.015 : 0
}

/** Placeholder wrapped in the shared AvatarModel interface. */
export function createPlaceholderModel(base: AvatarBase): AvatarModel {
  const avatar = createPlaceholderAvatar(base)
  return {
    root: avatar.root,
    apply: (state) => applyAvatarState(avatar, state),
    tick: (time, effects) => tickAvatar(avatar, time, effects),
    dispose: () => avatar.dispose(),
  }
}
