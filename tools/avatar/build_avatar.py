"""Build the GainRace avatar GLBs.

Run headless:
  blender --background --python tools/avatar/build_avatar.py -- --out peakform-native/assets/avatar --preview preview.png [--sex male]

Needs Blender 4.2+ with the MPFB extension and the "makehuman system assets" pack installed.

Pipeline, per sex:
  1. MPFB (MakeHuman) gives the BODY + fitted clothes/shoes. The human is re-shaped three times
     (lean basis / max weight / max muscle) and every piece's coordinates are captured each time.
     Topology never changes, so the captures become the `Basis`, `fat`, `muscle` shape keys.
  2. The realistic MakeHuman head is cut off and replaced by a procedural CARTOON head
     (smooth skull, rounded jaw, button nose, ears) with face features drawn on its surface
     (oval eyes with iris/pupil/highlight, lids, brows, smile) and stylized hair. Everything on
     the head is generated from one analytic surface per shape key, so it all follows fat/muscle.
  3. Hands are pulled into mitten-like shapes; skin under clothes is tucked away.
  4. Flat-color materials, GLB export, and toon-shaded preview renders.
"""

import bpy
import addon_utils
import math
import os
import sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree

addon_utils.enable("bl_ext.blender_org.mpfb", default_set=True)
from bl_ext.blender_org.mpfb.services import HumanService, TargetService, LocationService  # noqa: E402
from bl_ext.blender_org.mpfb.entities.objectproperties import HumanObjectProperties  # noqa: E402

# ─── Config ─────────────────────────────────────────────────────────────────

SEXES = {
    "male": {
        "gender": 1.0,
        "clothes": ["male_casualsuit04"],
        "shoes": "shoes05",
        "head": {"scale": 1.0, "jaw": 0.26},
        "hair": "quiff",
    },
    "female": {
        "gender": 0.0,
        "clothes": ["female_sportsuit01"],
        "shoes": "shoes05",
        "head": {"scale": 0.95, "jaw": 0.34},
        "hair": "long",
    },
}

BASE_MACRO = {"age": 0.5, "proportions": 1.0, "height": 0.5, "cupsize": 0.5, "firmness": 0.5}
VARIANTS = {
    "basis": {"weight": 0.4, "muscle": 0.4},
    "fat": {"weight": 1.0, "muscle": 0.4},
    "muscle": {"weight": 0.4, "muscle": 1.0},
}
# MPFB's extremes are mild at avatar size; extrapolate so they read clearly.
EXAGGERATE = {"fat": 1.6, "muscle": 1.35}
BODY_SUBDIV = 1

# Cartoon head half-extents (meters) and how high its centre sits above the neck cut.
HEAD = {"rx": 0.106, "ry": 0.112, "rz": 0.134, "lift": 0.152}

COLORS = {
    "Skin": (0.87, 0.6, 0.43),
    "Hair": (0.16, 0.09, 0.05),
    "Brows": (0.12, 0.07, 0.04),
    "Lash": (0.05, 0.035, 0.03),
    "Eyes": (0.97, 0.97, 0.97),
    "Iris": (0.25, 0.13, 0.06),
    "Pupil": (0.02, 0.02, 0.02),
    "Mouth": (0.42, 0.14, 0.12),
    "Top": (0.15, 0.39, 0.92),
    "Bottom": (0.07, 0.09, 0.15),
    "Shoes": (0.96, 0.96, 0.96),
    "Socks": (0.9, 0.9, 0.9),
}


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = {"out": None, "preview": None, "sex": None}
    for i, a in enumerate(argv):
        if a in ("--out", "--preview", "--sex"):
            args[a[2:]] = argv[i + 1]
    return args


def log(*a):
    print("AVATAR", *a, flush=True)


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def keyed(keys, x):
    """Cosine interpolation through (x, y) keys sorted by x."""
    if x <= keys[0][0]:
        return keys[0][1]
    for (x0, y0), (x1, y1) in zip(keys, keys[1:]):
        if x <= x1:
            u = (x - x0) / (x1 - x0)
            return y0 + (y1 - y0) * (1 - math.cos(u * math.pi)) / 2
    return keys[-1][1]


# ─── MPFB capture ───────────────────────────────────────────────────────────

def asset(kind, name, ext="mhclo"):
    return os.path.join(LocationService.get_user_data(), kind, name, f"{name}.{ext}")


def set_macros(basemesh, gender, variant):
    values = dict(BASE_MACRO, gender=gender, **VARIANTS[variant])
    for k, v in values.items():
        HumanObjectProperties.set_value(k, v, entity_reference=basemesh)
    TargetService.reapply_macro_details(basemesh)
    HumanService.refit(basemesh)
    bpy.context.view_layer.update()


def evaluated(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    coords = [v.co.copy() for v in me.vertices]
    faces = [tuple(p.vertices) for p in me.polygons]
    ev.to_mesh_clear()
    return coords, faces


def capture(sex, cfg):
    macro = TargetService.get_default_macro_info_dict()
    macro.update(BASE_MACRO)
    macro["gender"] = cfg["gender"]
    macro.update(VARIANTS["basis"])
    bm = HumanService.create_human(macro_detail_dict=macro, scale=0.1)

    sources = {"Body": HumanService.add_mhclo_asset(asset("proxymeshes", "proxy741", "proxy"), bm, asset_type="Proxymeshes", subdiv_levels=0, material_type="NONE")}
    for c in cfg["clothes"]:
        sources[f"Clothes:{c}"] = HumanService.add_mhclo_asset(asset("clothes", c), bm, asset_type="Clothes", subdiv_levels=0, material_type="NONE")
    sources["ShoesSrc"] = HumanService.add_mhclo_asset(asset("clothes", cfg["shoes"]), bm, asset_type="Clothes", subdiv_levels=0, material_type="NONE")

    body = sources["Body"]
    for md in list(body.modifiers):  # MPFB's skin-under-clothes masks are too generous; we tuck skin instead
        body.modifiers.remove(md)
    sub = body.modifiers.new("Subdiv", "SUBSURF")
    sub.levels = BODY_SUBDIV
    sub.render_levels = BODY_SUBDIV

    captures = {}
    for variant in VARIANTS:
        set_macros(bm, cfg["gender"], variant)
        for name, obj in sources.items():
            coords, faces = evaluated(obj)
            entry = captures.setdefault(name, {"faces": faces})
            if len(faces) != len(entry["faces"]):
                raise RuntimeError(f"{sex}/{name}: topology changed in variant {variant}")
            entry[variant] = coords
        log(sex, "captured", variant)
    for entry in captures.values():
        for key, k in EXAGGERATE.items():
            entry[key] = [b + (x - b) * k for b, x in zip(entry["basis"], entry[key])]
    return bm, captures


# ─── Mesh helpers ───────────────────────────────────────────────────────────

def vertex_normals(coords, faces):
    me = bpy.data.meshes.new("tmp_normals")
    me.from_pydata([tuple(c) for c in coords], [], faces)
    me.update()
    normals = [Vector(v.normal) for v in me.vertices]
    bpy.data.meshes.remove(me)
    return normals


def islands(faces, vcount):
    parent = list(range(vcount))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for f in faces:
        for i in f[1:]:
            ra, rb = find(f[0]), find(i)
            if ra != rb:
                parent[ra] = rb
    groups = {}
    for fi, f in enumerate(faces):
        groups.setdefault(find(f[0]), []).append(fi)
    return list(groups.values())


def subset(src, face_ids):
    faces = [src["faces"][i] for i in face_ids]
    used = sorted({i for f in faces for i in f})
    remap = {old: new for new, old in enumerate(used)}
    out = {"faces": [tuple(remap[i] for i in f) for f in faces]}
    for variant in VARIANTS:
        out[variant] = [src[variant][i] for i in used]
    return out


def merge(pieces):
    out = {"faces": [], **{v: [] for v in VARIANTS}}
    mats = []
    for data, m in pieces:
        off = len(out["basis"])
        out["faces"] += [tuple(i + off for i in f) for f in data["faces"]]
        for v in VARIANTS:
            out[v] += data[v]
        mats += [m] * len(data["faces"]) if isinstance(m, str) else m
    return out, mats


def grid_faces(cols, rows, wrap=True, bottom_pole=None, top_pole=None):
    """Quads for a (cols x rows) grid where column index grows along +theta and row index along +phi,
    so faces point outward. Optional pole vertices close the ends."""
    faces = []
    ncols = cols if wrap else cols - 1
    for c in range(ncols):
        cn = (c + 1) % cols
        for r in range(rows - 1):
            a, b = c * rows + r, cn * rows + r
            faces.append((a, b, b + 1, a + 1))
        if bottom_pole is not None:
            faces.append((bottom_pole, cn * rows, c * rows))
        if top_pole is not None:
            faces.append((c * rows + rows - 1, cn * rows + rows - 1, top_pole))
    return faces


def tuck_skin(coords, faces, cloth_bvhs, gap=0.006):
    """Skin covered by clothing (a ray along the skin normal hits cloth) is pushed back under it."""
    normals = vertex_normals(coords, faces)
    for p, n in zip(coords, normals):
        for bvh in cloth_bvhs:
            loc = bvh.ray_cast(p - n * 0.02, n, 0.06)[0]
            if loc is None:
                continue
            along = (p - loc).dot(n)
            if along > -gap:
                p -= n * (along + gap)


def inflate(src, amount):
    for v in VARIANTS:
        normals = vertex_normals(src[v], src["faces"])
        src[v] = [p + n * amount for p, n in zip(src[v], normals)]


# ─── Body: neck cut + mitten hands ──────────────────────────────────────────

def neck_frame(body_coords, ground):
    top = max(c.z for c in body_coords)
    height = top - ground
    neck_z = ground + height * 0.855
    ring = [c for c in body_coords if abs(c.z - neck_z) < 0.01 and abs(c.x) < 0.07]
    return {"ground": ground, "height": height, "neck": Vector((0.0, sum(c.y for c in ring) / len(ring), neck_z))}


def hand_frame(coords, idx):
    pts = [coords[i] for i in idx]
    tip = min(pts, key=lambda p: p.z)
    wrist_pts = [p for p in pts if p.z > tip.z + 0.12]
    wrist = sum(wrist_pts, Vector()) / len(wrist_pts)
    return wrist, (tip - wrist).normalized()


def oriented_ellipsoid(frame_fn, ra, rb, rc, cols=16, rows=10):
    """Ellipsoid in a right-handed frame (b, c, a): a = long axis, b = width, c = thickness."""
    rows_ph = [-90 + 180 * (r + 1) / (rows + 1) for r in range(rows)]
    out = {"faces": grid_faces(cols, rows, bottom_pole=cols * rows, top_pole=cols * rows + 1)}
    for v in VARIANTS:
        center, a, b, c = frame_fn(v)
        pts = []
        for ci in range(cols):
            t = math.radians(-180 + 360 * ci / cols)
            for ph in rows_ph:
                f = math.radians(ph)
                pts.append(center + b * (math.sin(t) * math.cos(f) * rb) - c * (math.cos(t) * math.cos(f) * rc) + a * (math.sin(f) * ra))
        pts += [center - a * ra, center + a * ra]
        out[v] = pts
    return out


# ─── Cartoon head ───────────────────────────────────────────────────────────

class CartoonHead:
    """Analytic head surface for one shape-key variant. Angles in degrees:
    theta 0 = straight ahead (-Y), +theta toward +X; phi 0 = equator, +90 = top."""

    def __init__(self, neck, fat, muscle, cfg):
        self.s = cfg["scale"]
        self.jaw = cfg["jaw"]
        self.fat = fat
        self.muscle = muscle
        self.center = neck + Vector((0.0, -0.012, HEAD["lift"] * self.s))

    def local(self, th, ph):
        t, f = math.radians(th), math.radians(ph)
        lower = max(0.0, -math.sin(f))
        upper = max(0.0, math.sin(f))
        front = math.cos(t)
        cheeks = math.exp(-((ph + 24) / 26) ** 2)
        rx = HEAD["rx"] * (1 - self.jaw * lower ** 1.6) * (1 + self.fat * 0.16 * cheeks) * (1 + self.muscle * 0.06 * lower)
        ry = HEAD["ry"] * (1 - 0.2 * lower ** 1.6) * (1 + 0.05 * upper * max(0.0, -front))
        rz = HEAD["rz"]
        p = Vector((math.sin(t) * math.cos(f) * rx, -math.cos(t) * math.cos(f) * ry, math.sin(f) * rz))
        # chin a touch forward; fat adds a soft double chin
        p.y -= (0.012 * lower ** 2 + self.fat * 0.014 * lower ** 1.3) * max(0.0, front) ** 2
        p.z -= self.fat * 0.01 * lower ** 2
        # button nose
        dth = (th + 180) % 360 - 180
        nose = 0.016 * math.exp(-(dth / 8.5) ** 2 - ((ph + 13) / 8) ** 2)
        if nose > 1e-5:
            p += p.normalized() * nose
        return p * self.s

    def point(self, th, ph):
        return self.center + self.local(th, ph)

    def normal(self, th, ph):
        ph = max(-89.0, min(89.0, ph))
        dt = self.local(th + 0.5, ph) - self.local(th - 0.5, ph)
        dp = self.local(th, ph + 0.5) - self.local(th, ph - 0.5)
        n = dt.cross(dp)
        if n.length < 1e-9:
            return self.local(th, ph).normalized()
        n.normalize()
        return n if n.dot(self.local(th, ph)) > 0 else -n

    def on(self, th, ph, lift):
        return self.point(th, ph) + self.normal(th, ph) * lift


def head_mesh(heads, cols=40, rows=26):
    rows_ph = [-90 + 180 * (r + 1) / (rows + 1) for r in range(rows)]
    out = {"faces": grid_faces(cols, rows, bottom_pole=cols * rows, top_pole=cols * rows + 1)}
    for v, h in heads.items():
        pts = [h.point(-180 + 360 * c / cols, ph) for c in range(cols) for ph in rows_ph]
        pts += [h.point(0, -90), h.point(0, 90)]
        out[v] = pts
    return out


def ellipsoid(center_fn, rx, ry, rz, cols=14, rows=9):
    rows_ph = [-90 + 180 * (r + 1) / (rows + 1) for r in range(rows)]
    out = {"faces": grid_faces(cols, rows, bottom_pole=cols * rows, top_pole=cols * rows + 1)}
    for v in VARIANTS:
        c = center_fn(v)
        pts = []
        for ci in range(cols):
            t = math.radians(-180 + 360 * ci / cols)
            for ph in rows_ph:
                f = math.radians(ph)
                pts.append(c + Vector((math.sin(t) * math.cos(f) * rx, -math.cos(t) * math.cos(f) * ry, math.sin(f) * rz)))
        pts += [c + Vector((0, 0, -rz)), c + Vector((0, 0, rz))]
        out[v] = pts
    return out


def decal_ellipse(heads, th0, ph0, a, b, lift, rings=4, segs=24):
    """Filled ellipse (in angle space) lying on the head surface."""
    faces = []
    for sg in range(segs):
        sn = (sg + 1) % segs
        faces.append((0, 1 + sg, 1 + sn))
        for r in range(rings - 1):
            i0, i1 = 1 + r * segs + sg, 1 + r * segs + sn
            faces.append((i0, i0 + segs, i1 + segs, i1))
    out = {"faces": faces}
    for v, h in heads.items():
        pts = [h.on(th0, ph0, lift)]
        for r in range(1, rings + 1):
            rho = r / rings
            for sg in range(segs):
                ang = 2 * math.pi * sg / segs
                pts.append(h.on(th0 + a * rho * math.cos(ang), ph0 + b * rho * math.sin(ang), lift * (1 - 0.25 * rho ** 4)))
        out[v] = pts
    return out


def decal_stroke(heads, path, lift):
    """Ribbon along `path` = [(theta, phi, half_width_deg)], theta ascending. 3 rows: edge / raised middle / edge."""
    n = len(path)
    faces = []
    for i in range(n - 1):
        for r in range(2):
            a = i * 3 + r
            faces.append((a, a + 3, a + 4, a + 1))
    out = {"faces": faces}
    for v, h in heads.items():
        pts = []
        for th, ph, hw in path:
            pts += [h.on(th, ph - hw, lift * 0.6), h.on(th, ph, lift), h.on(th, ph + hw, lift * 0.6)]
        out[v] = pts
    return out


def face_features(heads):
    parts = []
    for side in (1, -1):
        eth, eph = 23 * side, 1.0
        parts.append((decal_ellipse(heads, eth, eph, 9.5, 8.6, 0.0016), "Eyes"))
        parts.append((decal_ellipse(heads, eth - 0.9 * side, eph - 0.5, 6.0, 6.6, 0.0028), "Iris"))
        parts.append((decal_ellipse(heads, eth - 0.9 * side, eph - 0.5, 3.0, 3.3, 0.0036), "Pupil"))
        parts.append((decal_ellipse(heads, eth + 1.6 * side, eph + 2.6, 1.5, 1.6, 0.0044), "Eyes"))
        # upper lid: thick arc hugging the top of the eye white, thicker toward the outer corner
        lid = []
        for i in range(15):
            ang = math.radians(172 - 164 * i / 14)  # theta ascending along the arc
            u = math.cos(ang) * side  # +1 outer corner, -1 inner
            lid.append((eth + 10.2 * math.cos(ang), eph + 9.2 * math.sin(ang), 0.9 + 0.7 * max(0.0, u) * math.sin(ang) + 0.3))
        parts.append((decal_stroke(heads, lid, 0.0034), "Lash"))
        # brow: slight arch, thick at the inner end, tapering outward
        brow = []
        for i in range(11):
            u = i / 10  # theta ascending
            th = eth - 11 + 22 * u
            outer = (th * side - 23 + 11) / 22  # 0 inner .. 1 outer
            brow.append((th, 17.0 + 2.4 * math.sin(math.pi * min(1.0, outer * 1.15)) - 1.2 * outer, 2.6 - 1.2 * outer))
        parts.append((decal_stroke(heads, brow, 0.0038), "Brows"))
    smile = [(th, -33.5 + 4.2 * (th / 12) ** 2, 1.25 - 0.6 * abs(th / 12) ** 2) for th in [-12 + 24 * i / 12 for i in range(13)]]
    parts.append((decal_stroke(heads, smile, 0.0022), "Mouth"))
    return merge(parts)


def hair(heads, style):
    cols, rows = 72, 18
    out = {"faces": grid_faces(cols, rows, top_pole=cols * rows)}

    if style == "quiff":
        line = [(-180, -30), (-125, -16), (-90, 14), (-55, 28), (-20, 40), (0, 42), (20, 40), (55, 28), (90, 14), (125, -16), (180, -30)]
        length = 0.0
    else:  # long, side-swept
        line = [(-180, -86), (-110, -82), (-70, -40), (-45, 12), (-15, 24), (0, 21), (18, 15), (45, 6), (70, -40), (110, -82), (180, -86)]
        length = 0.34

    def thickness(th, ph, r):
        top = max(0.0, math.sin(math.radians(ph)))
        front = max(0.0, math.cos(math.radians(th)))
        if style == "quiff":
            t = 0.006 + 0.03 * top ** 1.2
            t += 0.05 * math.exp(-((th - 10) / 38) ** 2) * math.exp(-((ph - 52) / 18) ** 2)
            t *= 1 + 0.22 * max(0.0, math.sin(math.radians(th) * 9)) * top
        else:
            t = 0.016 + 0.012 * top
            t += 0.012 * front ** 4 * math.exp(-((ph - 22) / 10) ** 2)
            t *= 1 + 0.12 * max(0.0, math.sin(math.radians(th) * 7)) * top
        tuck = 0.2 if r == 0 else (0.65 if r == 1 else 1.0)
        return t * tuck

    for v, h in heads.items():
        pts = []
        for c in range(cols):
            th = -180 + 360 * c / cols
            ph0 = keyed(line, th)
            for r in range(rows):
                t = r / (rows - 1)
                ph = ph0 + (88.0 - ph0) * t ** 0.9
                thick = thickness(th, ph, r)
                if ph < 0 and length > 0:
                    drop = -ph / 90.0
                    p = h.on(th, 0.0, thickness(th, 0.0, r) * (1 + 0.25 * drop))
                    out_dir = Vector((p.x - h.center.x, p.y - h.center.y, 0.0)).normalized()
                    p = p + out_dir * 0.01 * drop - Vector((0, 0, drop * length))
                    if r == 0:
                        p -= out_dir * 0.006  # tuck the hanging ends in
                    pts.append(p)
                else:
                    p = h.on(th, ph, thick)
                    if style == "quiff":  # push the quiff forward a little
                        p.y -= 0.022 * math.exp(-((th - 10) / 38) ** 2) * math.exp(-((ph - 50) / 20) ** 2)
                    pts.append(p)
        pts.append(h.on(0, 89.5, thickness(0, 90, rows)))
        out[v] = pts
    return out


# ─── Parts ──────────────────────────────────────────────────────────────────

def build_parts(sex, cfg, captures):
    grounds = {v: min(p.z for cap in captures.values() for p in cap[v]) for v in VARIANTS}
    frames = {v: neck_frame(captures["Body"][v], grounds[v]) for v in VARIANTS}
    styl = {}
    for name, cap in captures.items():
        styl[name] = {"faces": cap["faces"], **{v: [p - Vector((0, 0, grounds[v])) for p in cap[v]] for v in VARIANTS}}
    for f, g in zip(frames.values(), grounds.values()):
        f["neck"].z -= g

    body_full = styl["Body"]
    base = body_full["basis"]
    height = max(p.z for p in base)

    # Mitten hands (membership from the basis pose, applied to every variant).
    members = {}
    for side in (1, -1):
        arm = [i for i, p in enumerate(base) if p.x * side > 0.22 and p.z > height * 0.38]  # above the knees: arms only
        tip_z = min(base[i].z for i in arm)
        members[side] = [i for i in arm if base[i].z < tip_z + 0.15]
    frames_hand = {v: {side: hand_frame(body_full[v], idx) for side, idx in members.items()} for v in VARIANTS}
    hand_faces = set()
    for side, idx in members.items():
        wrist, axis = frames_hand["basis"][side]
        idx_set = set(idx)
        for fi, f in enumerate(body_full["faces"]):
            if all(i in idx_set and (base[i] - wrist).dot(axis) > 0.012 for i in f):
                hand_faces.add(fi)

    def mitten_frame(v, side):
        wrist, axis = frames_hand[v][side]
        c = Vector((0.0, 1.0, 0.0))
        c = (c - axis * c.dot(axis)).normalized()
        b = c.cross(axis)  # b x c = axis
        grow = 1.08 if v == "fat" else (1.05 if v == "muscle" else 1.0)
        return wrist + axis * 0.06 * grow, axis, b, c

    hs = cfg["head"]["scale"] ** 2  # smaller bodies get smaller mittens
    mittens = [(oriented_ellipsoid(lambda v, s=side: mitten_frame(v, s), 0.068 * hs, 0.04 * hs, 0.026 * hs), "Skin") for side in (1, -1)]

    # Cut the MakeHuman head off just above the neck ring.
    cut = frames["basis"]["neck"].z + 0.004
    keep = [fi for fi, f in enumerate(body_full["faces"]) if fi not in hand_faces and not all(base[i].z > cut for i in f)]
    body = subset(body_full, keep)

    parts = {}
    heads = {v: CartoonHead(frames[v]["neck"], 1.0 if v == "fat" else 0.0, 1.0 if v == "muscle" else 0.0, cfg["head"]) for v in VARIANTS}
    head = head_mesh(heads)
    ears = [
        (ellipsoid(lambda v, s=side: heads[v].on(88 * s, -3, 0.002), 0.011 * cfg["head"]["scale"], 0.02 * cfg["head"]["scale"], 0.03 * cfg["head"]["scale"]), "Skin")
        for side in (1, -1)
    ]
    skin, skin_mats = merge([(body, "Skin"), (head, "Skin")] + ears + mittens)
    parts["Body"] = (skin, "Skin")
    parts["Face"] = face_features(heads)
    parts["Hair"] = (hair(heads, cfg["hair"]), "Hair")

    # Clothes sit a few mm off the skin; skin they cover is tucked behind them.
    cloth = []
    for name, src in styl.items():
        if name.startswith("Clothes:") or name == "ShoesSrc":
            inflate(src, 0.004 if name != "ShoesSrc" else 0.002)
            cloth.append(src)
    for v in VARIANTS:
        tuck_skin(skin[v], skin["faces"], [BVHTree.FromPolygons([tuple(p) for p in c[v]], c["faces"]) for c in cloth])

    tops, bottoms = [], []
    for name, cap in styl.items():
        if not name.startswith("Clothes:"):
            continue
        for isl in islands(cap["faces"], len(cap["basis"])):
            zs = [cap["basis"][i].z for fi in isl for i in cap["faces"][fi]]
            (tops if sum(zs) / len(zs) > height * 0.6 else bottoms).append((subset(cap, isl), "Top"))
    parts["Top"] = (merge(tops)[0], "Top")
    parts["Bottom"] = (merge(bottoms)[0], "Bottom")

    shoes = styl["ShoesSrc"]
    mat_of = {}
    for isl in islands(shoes["faces"], len(shoes["basis"])):
        zmax = max(shoes["basis"][i].z for fi in isl for i in shoes["faces"][fi])
        for fi in isl:
            mat_of[fi] = "Socks" if zmax > height * 0.085 else "Shoes"
    parts["Shoes"] = (shoes, [mat_of[i] for i in range(len(shoes["faces"]))])
    return parts


# ─── Blender objects + export ───────────────────────────────────────────────

def material(name):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    rgb = COLORS[name]
    mat.diffuse_color = (*rgb, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.8
    mat.use_backface_culling = name in ("Skin", "Eyes", "Iris", "Pupil")
    return mat


def make_object(name, data, mats, collection):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(c) for c in data["basis"]], [], data["faces"])
    me.update()
    obj = bpy.data.objects.new(name, me)
    collection.objects.link(obj)

    names = [mats] if isinstance(mats, str) else sorted(set(mats))
    for n in names:
        me.materials.append(material(n))
    if not isinstance(mats, str):
        idx = {n: i for i, n in enumerate(names)}
        me.polygons.foreach_set("material_index", [idx[m] for m in mats])
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))

    obj.shape_key_add(name="Basis", from_mix=False)
    for key in ("fat", "muscle"):
        kb = obj.shape_key_add(name=key, from_mix=False)
        for i, c in enumerate(data[key]):
            kb.data[i].co = c
    return obj


def export_glb(objects, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    wanted = {
        "filepath": path,
        "export_format": "GLB",
        "use_selection": True,
        "export_yup": True,
        "export_apply": False,
        "export_texcoords": False,
        "export_normals": True,
        "export_tangents": False,
        "export_morph": True,
        "export_morph_normal": True,
        "export_morph_tangent": False,
        "export_skins": False,
        "export_animations": False,
        "export_draco_mesh_compression_enable": False,
        "export_materials": "EXPORT",
        "export_image_format": "NONE",
        "export_extras": False,
        "export_cameras": False,
        "export_lights": False,
    }
    kwargs = {k: v for k, v in wanted.items() if k in props}
    bpy.ops.export_scene.gltf(**kwargs)


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


# ─── Preview render (toon shaded, like the app) ─────────────────────────────

def toon_material(src):
    name = f"toon_{src.name}"
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    diff = nodes.new("ShaderNodeBsdfDiffuse")
    s2r = nodes.new("ShaderNodeShaderToRGB")
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.0, (0.55, 0.52, 0.6, 1)
    els[1].position, els[1].color = 0.08, (0.8, 0.78, 0.82, 1)
    e = els.new(0.3)
    e.color = (1, 1, 1, 1)
    rgb = nodes.new("ShaderNodeRGB")
    rgb.outputs[0].default_value = (*COLORS[src.name], 1)
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    sock_in = [s for s in mix.inputs if s.type == "RGBA"]
    sock_out = [s for s in mix.outputs if s.type == "RGBA"][0]
    mix.inputs[0].default_value = 1.0
    emit = nodes.new("ShaderNodeEmission")
    links.new(diff.outputs[0], s2r.inputs[0])
    links.new(s2r.outputs[0], ramp.inputs[0])
    links.new(rgb.outputs[0], sock_in[0])
    links.new(ramp.outputs[0], sock_in[1])
    links.new(sock_out, emit.inputs[0])
    links.new(emit.outputs[0], out.inputs[0])
    return m


def render_preview(built, path):
    scene = bpy.context.scene
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    scene.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else "BLENDER_EEVEE_NEXT"
    scene.view_settings.view_transform = "Standard"
    scene.render.use_freestyle = True
    scene.render.line_thickness_mode = "ABSOLUTE"
    scene.render.line_thickness = 1.3
    for ls in bpy.context.view_layer.freestyle_settings.linesets:
        ls.linestyle.color = (0.08, 0.06, 0.06)
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.13, 0.13, 0.15, 1)
    scene.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(55), math.radians(-25), math.radians(-30))
    scene.collection.objects.link(sun)

    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.camera = cam
    for objs in built.values():
        for o in objs:
            o.hide_render = True

    def lineup(sex, states, rots, spacing):
        coll = bpy.data.collections.new(f"Preview_{sex}")
        scene.collection.children.link(coll)
        x = 0.0
        for rot in rots:
            for fat, muscle in states:
                for o in built[sex]:
                    c = o.copy()
                    c.data = o.data.copy()
                    for i, slot in enumerate(c.data.materials):
                        c.data.materials[i] = toon_material(slot)
                    coll.objects.link(c)
                    c.data.shape_keys.key_blocks["fat"].value = fat
                    c.data.shape_keys.key_blocks["muscle"].value = muscle
                    c.rotation_euler = (0, 0, math.radians(rot))
                    c.hide_render = False
                    c.location = (x, 0, 0)
                x += spacing
        return coll, x - spacing

    root, ext = os.path.splitext(path)
    for sex in built:
        coll, width = lineup(sex, [(0, 0), (1, 0), (0, 1), (0.85, 1)], [0, -35], 0.8)
        scene.render.resolution_x, scene.render.resolution_y = 2400, 800
        cam_data.ortho_scale = max(width + 0.9, 2.15 * 2400 / 800)
        cam.location = (width / 2, -10, 0.98)
        scene.render.filepath = f"{root}_{sex}{ext}"
        bpy.ops.render.render(write_still=True)
        bpy.data.collections.remove(coll)

        coll, width = lineup(sex, [(0, 0), (1, 0)], [0, -35], 0.5)
        top = max((o.matrix_world @ Vector(b)).z for o in built[sex] for b in o.bound_box)
        scene.render.resolution_x, scene.render.resolution_y = 1800, 560
        cam_data.ortho_scale = width + 0.5
        cam.location = (width / 2, -10, top - 0.19)
        scene.render.filepath = f"{root}_{sex}_head{ext}"
        bpy.ops.render.render(write_still=True)
        bpy.data.collections.remove(coll)


# ─── Main ───────────────────────────────────────────────────────────────────

def main():
    args = parse_args()
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)

    built = {}
    for sex, cfg in SEXES.items():
        if args["sex"] and args["sex"] != sex:
            continue
        bm, captures = capture(sex, cfg)
        parts = build_parts(sex, cfg, captures)

        for child in list(bm.children):
            bpy.data.objects.remove(child, do_unlink=True)
        bpy.data.objects.remove(bm, do_unlink=True)

        coll = bpy.data.collections.new(f"avatar_{sex}")
        bpy.context.scene.collection.children.link(coll)
        objs = [make_object(name, data, mats, coll) for name, (data, mats) in parts.items() if data["faces"]]
        built[sex] = objs
        log(sex, "parts", {o.name: tri_count(o) for o in objs}, "total tris", sum(tri_count(o) for o in objs))

        if args["out"]:
            os.makedirs(args["out"], exist_ok=True)
            path = os.path.abspath(os.path.join(args["out"], f"avatar_{sex}.glb"))
            export_glb(objs, path)
            log(sex, "exported", path, os.path.getsize(path), "bytes")

        for o in objs:  # free the plain names for the next sex's export
            o.name = f"{sex}_{o.name}"

    if args["preview"]:
        render_preview(built, os.path.abspath(args["preview"]))
        log("preview", args["preview"])


main()
