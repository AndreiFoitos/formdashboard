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

export function createGlbModel(scene: THREE.Object3D): AvatarModel {
  const root = new THREE.Group()
  const body = new THREE.Group() // idle motion lives here; root carries height scale
  root.add(body)
  body.add(scene.clone(true))

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

  return {
    root,
    apply(st) {
      const muscle = Math.min(1, st.muscle + st.effects.pump)
      for (const m of morphs) {
        const inf = m.mesh.morphTargetInfluences!
        inf[m.fat] = st.fat
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
        skin.emissive.set(st.look.skin)
        skin.emissiveIntensity = 0.18 * st.effects.glow
      }
    },
    tick(time, effects) {
      const t = time * effects.energy
      const breath = Math.sin(t * 2.2)
      body.scale.set(1 + breath * 0.006, 1 + breath * 0.003, 1 + breath * 0.009)
      body.position.y = Math.abs(Math.sin(t * 1.1)) * 0.006 * effects.energy
      // No head bone yet, so caffeine jitter shakes the whole body a little.
      body.rotation.z = effects.jitter ? Math.sin(time * 47) * 0.006 : 0
    },
    dispose() {
      materials.forEach((m) => m.dispose())
    },
  }
}
