// MakeHuman-based avatar loaded from assets/avatar/avatar_{male,female}.glb
// (built by tools/avatar/build_avatar.py).
//
// Contract with the GLB: every mesh has morph targets named "fat" and "muscle";
// materials are named Skin / Hair / Brows / Lash / Eyes / Iris / Pupil / Mouth / Top / Bottom / Shoes / Socks
// and get swapped for toon materials so the look can be recolored at runtime.

import * as THREE from 'three'
import { toonMaterial, type AvatarModel, type AvatarLook } from './model'

type SlotName = 'Skin' | 'Hair' | 'Brows' | 'Lash' | 'Eyes' | 'Iris' | 'Pupil' | 'Mouth' | 'Top' | 'Bottom' | 'Shoes' | 'Socks'

const FIXED_COLORS: Partial<Record<SlotName, string>> = {
  Eyes: '#f7f7f7',
  Iris: '#5a3a22',
  Pupil: '#0a0a0a',
  Lash: '#1a1411',
  Mouth: '#7a3a33',
  Socks: '#e8e8e8',
}

const lookColor = (slot: SlotName, look: AvatarLook): string | undefined =>
  ({ Skin: look.skin, Hair: look.hair, Brows: look.hair, Top: look.top, Bottom: look.bottom, Shoes: look.shoes } as Partial<Record<SlotName, string>>)[slot]

let haloTexture: THREE.DataTexture | null = null
/** Soft radial falloff used for auras (white; tinted by material color). */
function getHaloTexture() {
  if (haloTexture) return haloTexture
  const n = 64
  const px = new Uint8Array(n * n * 4)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5
      const dy = (y + 0.5) / n - 0.5
      const r = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2)
      const a = Math.pow(1 - r, 1.8)
      const i = (y * n + x) * 4
      px[i] = px[i + 1] = px[i + 2] = 255
      px[i + 3] = Math.round(a * 255)
    }
  }
  haloTexture = new THREE.DataTexture(px, n, n, THREE.RGBAFormat)
  haloTexture.magFilter = THREE.LinearFilter
  haloTexture.minFilter = THREE.LinearFilter
  haloTexture.needsUpdate = true
  return haloTexture
}

const TIRED_TINT = new THREE.Color('#9ca3af')

export function createGlbModel(scene: THREE.Object3D): AvatarModel {
  const root = new THREE.Group()
  const body = new THREE.Group() // idle motion lives here; root carries height scale
  root.add(body)
  const avatar = scene.clone(true)
  body.add(avatar)

  // Aura: one glow behind the body and a tighter one behind the head (header
  // badge / race faces only show the head). Kept facing the camera in tick().
  const bounds = new THREE.Box3().setFromObject(avatar)
  const headY = bounds.max.y - 0.17
  const haloMat = new THREE.MeshBasicMaterial({
    map: getHaloTexture(),
    transparent: true,
    depthWrite: false,
    opacity: 0.9,
  })
  const halos = new THREE.Group()
  const bodyHalo = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.3), haloMat)
  bodyHalo.position.set(0, bounds.max.y * 0.52, -0.35)
  const headHalo = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), haloMat)
  headHalo.position.set(0, headY, -0.25)
  halos.add(bodyHalo, headHalo)
  halos.visible = false
  let tired = false

  const materials = new Map<string, THREE.MeshToonMaterial>()
  const morphs: { mesh: THREE.Mesh; fat: number; muscle: number }[] = []

  body.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    const dict = mesh.morphTargetDictionary
    if (dict && dict.fat != null && dict.muscle != null) {
      morphs.push({ mesh, fat: dict.fat, muscle: dict.muscle })
    }
    const swap = (m: THREE.Material) => {
      let toon = materials.get(m.name)
      if (!toon) {
        toon = toonMaterial(FIXED_COLORS[m.name as SlotName] ?? '#cccccc')
        toon.name = m.name
        toon.side = m.side
        materials.set(m.name, toon)
      }
      return toon
    }
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material)
  })
  // Added after the toon swap above so the halos keep their glow material.
  body.add(halos)

  return {
    root,
    apply(st) {
      const x = st.extras ?? {}
      const def = x.definition ?? 0
      const fat = Math.max(0, st.fat - 0.12 * def)
      const muscle = Math.min(1, st.muscle + st.effects.pump + (x.pumpBoost ?? 0) + 0.1 * def)
      for (const m of morphs) {
        const inf = m.mesh.morphTargetInfluences!
        inf[m.fat] = fat
        inf[m.muscle] = muscle
      }
      const hs = st.heightScale
      root.scale.set(0.5 + hs * 0.5, hs, 0.5 + hs * 0.5)

      for (const [name, mat] of materials) {
        const c = lookColor(name as SlotName, st.look)
        if (c) mat.color.set(c)
      }
      materials.get('Brows')?.color.multiplyScalar(0.7)
      const skin = materials.get('Skin')
      if (skin) {
        tired = !!x.tired
        if (tired) skin.color.lerp(TIRED_TINT, 0.3)
        skin.emissive.set(st.look.skin)
        skin.emissiveIntensity = 0.18 * st.effects.glow
      }
      const iris = materials.get('Iris')
      if (iris) {
        iris.color.set(x.eyeColor ?? FIXED_COLORS.Iris!)
        iris.emissive.set(x.eyeColor ?? '#000000')
        iris.emissiveIntensity = x.eyeColor ? 0.6 : 0
      }
      halos.visible = !!x.aura
      if (x.aura) haloMat.color.set(x.aura)
    },
    tick(time, effects) {
      // Auras always face the camera, whichever way the avatar is turned.
      halos.rotation.y = -root.rotation.y
      const t = time * effects.energy * (tired ? 0.55 : 1)
      const breath = Math.sin(t * 2.2)
      body.scale.set(1 + breath * 0.006, 1 + breath * 0.003, 1 + breath * 0.009)
      body.position.y = Math.abs(Math.sin(t * 1.1)) * 0.006 * effects.energy
      // No head bone yet, so caffeine jitter shakes the whole body a little.
      body.rotation.z = effects.jitter ? Math.sin(time * 47) * 0.006 : 0
    },
    dispose() {
      materials.forEach((m) => m.dispose())
      haloMat.dispose()
      bodyHalo.geometry.dispose()
      headHalo.geometry.dispose()
    },
  }
}
