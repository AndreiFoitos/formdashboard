# GainRace avatar — Blender guide

> **Automated build (current setup):** `tools/avatar/build_avatar.py` does every step below from a script:
> MPFB human → lean/fat/muscle captures → shape keys on body + clothes → bigger head, cartoon eyes/brows/hair →
> flat-color materials → GLB export → preview renders. Re-run it after changing its config:
>
> ```
> "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python tools/avatar/build_avatar.py -- --out peakform-native/assets/avatar --preview preview.png
> ```
>
> The manual steps below are still the reference for the contract, and for when someone (e.g. an artist) replaces
> parts by hand.

Goal of this first pass: **one male and one female `.glb` that the app can load**, with body
shape keys that follow the user's metrics. It does not need to be final art. It needs to follow
the *contract* below exactly, so the app code keeps working when the art gets better.

The in-app placeholder (`peakform-native/lib/avatar/placeholderModel.ts`) follows the same
contract. Settings → Avatar lab shows how the shape keys will be driven.

---

## 0. The contract (read this first)

| Thing | Rule |
|---|---|
| Files | `avatar_male.glb`, `avatar_female.glb` |
| Scale / origin | 1 unit = 1 meter. Feet on the ground at Z = 0, centered on X/Y |
| Facing | Character faces **−Y** in Blender (front view, Numpad 1, shows the face) |
| Body shape keys | Exactly `Basis`, `fat`, `muscle`, in that order |
| Clothes | Separate objects with **the same shape keys** (`fat`, `muscle`) so they follow the body |
| Object names | `Body`, `Hair`, `Brows`, `Eyes`, `Top`, `Bottom`, `Shoes` (+ later `Head_gorilla`, etc.) |
| Materials | Flat colors only, named `Skin`, `Hair`, `Brows`, `Eyes`, `Iris`, `Top`, `Bottom`, `Shoes`, `Socks`. **No textures for now.** The app replaces them with toon shading and recolors them |
| Budget | Whole character **≤ 15k triangles**, file **≤ 3 MB** |
| Rig | One armature (MPFB "Game engine" rig). Optional for the very first export |
| Compression | **No Draco** (the phone can't decode it) |

---

## 1. Install

1. Install **Blender 4.2 or newer** (blender.org).
2. Edit → Preferences → **Get Extensions** → search **MPFB** → Install.
3. MPFB needs its asset packs (skins, eyes, clothes, hair). In the MPFB sidebar tab
   (press **N** in the viewport → **MPFB** tab) open **Apply assets / Library settings**. It links
   to the download page for the "makehuman system assets" pack. Download it and load the zip through
   MPFB's **Load pack from zip** button.

---

## 2. Make the three body variants

Shape keys are just "the same mesh with the vertices moved". The easiest reliable way to
get them is to generate **three humans with identical topology** and merge them.

In the MPFB tab → **New human → From scratch**, create a human with these sliders (male: gender 1.0; female: gender 0.0):

| Variant | Weight | Muscle | Age | Proportions |
|---|---|---|---|---|
| `Basis` (lean, average) | 0.35 | 0.35 | ~25y | idealistic, max |
| `fat` | **1.0** | 0.35 | same | same |
| `muscle` | 0.35 | **1.0** | same | same |

- Change **only** weight/muscle between variants. Everything else must stay identical, including height.
- Do **not** add a rig, clothes, or hair yet.
- Rename the objects `Basis`, `fat`, `muscle`.
- On each one: Object Data properties (green triangle) → Shape Keys → ▾ menu → **Apply All Shape Keys**
  (bakes MPFB's sliders into plain geometry). Also apply or delete any modifiers except Armature.

**Merge:** select `fat`, then `muscle`, then Shift-click `Basis` last (it must be active) →
Shape Keys ▾ → **Join as Shapes**. Delete the `fat` and `muscle` objects. Rename `Basis` → `Body`.
Drag the `fat` / `muscle` value sliders from 0 to 1 to check it. That's the whole trick.

> If "Join as Shapes" says the vertex counts don't match, one variant got different topology
> (usually a proxy/helper was added). Delete it and regenerate.

---

## 3. Make it look Bitmoji-ish, not realistic

The realism comes from proportions and detail. Remove both. Work on `Body` in **Edit Mode with the
`Basis` shape key selected**. Edits to Basis carry over to the other keys.

**Proportions** (select regions with **L** / box select, and turn on proportional editing with **O**):
- **Head ×1.25–1.35** (scale around the neck). This is the single biggest "Bitmoji" change.
- **Hands ×0.85**, slightly rounder.
- **Feet ×1.1** (chunky sneakers read well at small sizes).
- **Neck** a little shorter; legs very slightly longer.

**Detail reduction:**
- Use MPFB's **low-poly proxy topology** if your asset pack has one, *before* step 2 (all 3 variants must
  use it). Otherwise add a **Decimate** modifier (ratio ~0.3–0.5), check the fat/muscle keys still
  look right, and apply it **before** Join as Shapes (Blender can't apply modifiers to meshes that have shape keys).
- Remove fingernails, toenails and genital geometry if present. Smooth the face: fewer nostril/ear details.
- Shade Smooth (right-click → Shade Auto Smooth).

**Face (the identity carrier):**
- **Eyes:** big and simple. Replace the realistic eyes with a white sphere + a dark iris disc (object `Eyes`, material `Eyes`).
- Brows as simple flat shapes. Mouth as a small simple curve, not a realistic lip mesh.
- Later: your friend models a fully stylized `Head_human` as a separate object. For now the scaled MPFB head is fine.

**Look at it the way the app will:** top-right viewport shading dropdown → Lighting **Flat**, Color
**Material**. That is close to the in-app toon look. If it reads well flat, it will read well in the app.

---

## 4. Hair & clothes

- **Avoid MPFB's default hair.** It uses transparent "hair cards", which look bad in toon shading
  and cost performance. Use a **solid helmet-style hair mesh** instead: model a simple
  one (a sphere, delete the face area, sculpt a little), or grab a stylized low-poly CC0 hair.
- **Clothes need the fat/muscle keys too.** Easiest path: add the MPFB clothes (t-shirt/tank, shorts,
  sneakers without transparency) in **each** of the 3 variants in step 2 *before* merging. MPFB fits them to each body.
  Then run Join as Shapes on the clothes the same way (fat + muscle into the Basis one).
  - Alternative: select the clothing, add a **Surface Deform** modifier bound to `Body`, and
    for each key set `Body`'s key to 1, then Modifier ▾ → **Save as Shape Key**. Name the keys `fat`, `muscle`.
- If skin pokes through the clothes at fat=1 or muscle=1, delete the body faces that are hidden under
  the clothes (e.g. under the shorts). It also saves triangles.

---

## 5. Rig (optional for the first export)

MPFB tab → **Add rig → Game engine** (standard ~50-bone humanoid). Parent the clothes/hair/eyes to it with
automatic weights, or use MPFB's own "add rig" which weights clothes it added.
Keep an **A-pose** (arms ~45° down) as the rest pose.
Animations (idle, run, flex, victory) come in a later pass.

---

## 6. Export

Select everything that belongs to the character → File → Export → **glTF 2.0 (.glb/.gltf)**:

- **Format:** glTF Binary (`.glb`)
- **Include:** ✅ Selected Objects
- **Transform:** ✅ +Y Up
- **Data → Mesh:** ✅ UVs, ✅ Normals, ❌ Tangents, ❌ Vertex Colors, ❌ **Apply Modifiers**
- **Data → Shape Keys:** ✅ Shape Keys, ✅ Shape Key Normals, ❌ Shape Key Tangents
- **Data → Armature / Skinning:** ✅ (if rigged), ✅ Export Deformation Bones Only
- **Data → Compression:** ❌ **Draco OFF**
- **Materials:** Export. **Images:** None
- **Animation:** off for now

Name it `avatar_male.glb` / `avatar_female.glb`.

**Check before sending:**
- [ ] Viewport overlay → Statistics: triangles ≤ 15k
- [ ] File ≤ 3 MB
- [ ] Shape keys are exactly `fat`, `muscle` on Body **and** every clothing piece
- [ ] Dragging fat/muscle to 1 doesn't make skin poke through the clothes
- [ ] Drag the `.glb` into https://gltf-viewer.donmccurdy.com: it loads, and the morph sliders work there too

Drop the files in `peakform-native/assets/avatar/` and tell Claude. The next step is swapping the placeholder for a
GLB loader with the same `fat` / `muscle` / head-slot API.
