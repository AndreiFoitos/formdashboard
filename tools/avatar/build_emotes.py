"""Retarget Mixamo emote clips onto the GainRace avatar skeleton.

Run headless (after build_avatar.py has produced the avatar GLBs):
  blender --background --python tools/avatar/build_emotes.py -- \
      --clips C:/Users/Admin/Documents/GainRace-mixamo/emotes \
      --avatars peakform-native/assets/avatar \
      --out peakform-native/assets/avatar \
      [--preview preview_dir] [--only wave,backflip]

Input: Mixamo FBX files named <emote_id>.fbx, downloaded "Without Skin" at 30 fps.
Output: emotes_male.glb / emotes_female.glb — skeleton + one animation per emote
(named by id). The app plays them on the avatar with THREE.AnimationMixer; tracks
target bones by name, and both rigs use Mixamo bone names.

Retargeting: Mixamo clips are authored for a T-pose rest, our rig rests in an
A-pose. For each bone we first find the rotation that makes the target bone
point where the source bone points at rest (e.g. lifts our A-pose arm to
horizontal), then apply the source's world-space motion on top. So the target
bone always points where the source bone points. Hips motion is scaled by the
hip-height ratio and kept in place (no horizontal travel). Raw Mixamo
files stay outside the repo.
"""

import math
import os
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

FPS = 30
SEXES = ("male", "female")


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = {"clips": None, "avatars": None, "out": None, "preview": None, "only": None}
    for i, a in enumerate(argv):
        if a.startswith("--") and a[2:] in args:
            args[a[2:]] = argv[i + 1]
    return args


def log(*a):
    print("EMOTES", *a, flush=True)


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)


def import_new(op, **kw):
    before = set(bpy.data.objects)
    op(**kw)
    return [o for o in bpy.data.objects if o not in before]


def lateral_frame(arm):
    """World rotation whose columns are (character left, up, forward) for a rig."""
    b = arm.data.bones
    mw = arm.matrix_world
    left = (mw @ b["mixamorig:LeftUpLeg"].head_local) - (mw @ b["mixamorig:RightUpLeg"].head_local)
    up = Vector((0, 0, 1))
    left = (left - up * left.dot(up)).normalized()
    fwd = up.cross(left).normalized()
    return Matrix((left, up, fwd)).transposed()


def hierarchy(arm):
    out = []

    def walk(bone):
        out.append(bone.name)
        for c in bone.children:
            walk(c)

    for root in [b for b in arm.data.bones if b.parent is None]:
        walk(root)
    return out


def retarget(src, tgt, clip_id):
    """Bake src's current action onto tgt as a new action named clip_id."""
    scene = bpy.context.scene
    act = src.animation_data.action
    f0, f1 = (int(round(x)) for x in act.frame_range)

    src_mw3 = src.matrix_world.to_3x3().normalized()
    tgt_mw = tgt.matrix_world
    tgt_mw3_inv = tgt_mw.to_3x3().normalized().inverted()
    # Aligns source world directions with the target's (both should face -Y, but be safe).
    align = lateral_frame(tgt) @ lateral_frame(src).inverted()

    shared = [n for n in hierarchy(tgt) if n in src.data.bones]
    src_rest_rot = {n: (src_mw3 @ src.data.bones[n].matrix_local.to_3x3()).normalized() for n in shared}
    tgt_rest = {b.name: b.matrix_local.copy() for b in tgt.data.bones}
    tgt_rest_rot_w = {n: (tgt_mw.to_3x3() @ tgt_rest[n].to_3x3()).normalized() for n in shared}

    # Per bone: rotation taking the target's rest direction onto the source's
    # rest direction (T-pose vs A-pose). Applied before the source's motion.
    def rest_dir(arm, bone):
        b = arm.data.bones[bone]
        return (arm.matrix_world.to_3x3() @ (b.tail_local - b.head_local)).normalized()

    to_src_rest = {}
    for n in shared:
        src_dir = align @ rest_dir(src, n)
        tgt_dir = rest_dir(tgt, n)
        to_src_rest[n] = tgt_dir.rotation_difference(src_dir).to_matrix()

    hips = "mixamorig:Hips"
    src_hips_rest = src.matrix_world @ src.data.bones[hips].head_local
    tgt_hips_rest = tgt_mw @ tgt.data.bones[hips].head_local
    scale = tgt_hips_rest.z / max(1e-6, src_hips_rest.z)

    new_act = bpy.data.actions.new(clip_id)
    tgt.animation_data_create()
    tgt.animation_data.action = new_act
    for pb in tgt.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)

    order = hierarchy(tgt)
    prev_q = {}
    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        pose_arm = {}  # target armature-space pose matrices, parents first
        for name in order:
            bone = tgt.data.bones[name]
            parent_pose = pose_arm[bone.parent.name] if bone.parent else Matrix.Identity(4)
            local_rest = tgt_rest[bone.parent.name].inverted() @ tgt_rest[name] if bone.parent else tgt_rest[name]
            natural = parent_pose @ local_rest  # where the bone sits with an identity basis

            if name in src_rest_rot:
                src_pose_rot = (src_mw3 @ src.pose.bones[name].matrix.to_3x3()).normalized()
                delta = align @ (src_pose_rot @ src_rest_rot[name].inverted()) @ align.inverted()
                want_rot_arm = tgt_mw3_inv @ (delta @ to_src_rest[name] @ tgt_rest_rot_w[name])
                want = want_rot_arm.to_4x4()
                want.translation = natural.translation
                if name == hips:
                    src_hips_now = src.matrix_world @ src.pose.bones[name].head
                    offset_w = align @ ((src_hips_now - src_hips_rest) * scale)
                    # Emotes play in place on the podium: keep up/down (jumps,
                    # crouches, flips), drop travel across the floor.
                    offset_w.x = offset_w.y = 0.0
                    want.translation = natural.translation + tgt_mw3_inv @ offset_w
                basis = natural.inverted() @ want
            else:
                basis = Matrix.Identity(4)

            pose_arm[name] = natural @ basis
            pb = tgt.pose.bones[name]
            q = basis.to_quaternion()
            if name in prev_q and prev_q[name].dot(q) < 0:
                q = Quaternion((-q.w, -q.x, -q.y, -q.z))  # keep quaternion signs continuous
            prev_q[name] = q
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=f - f0)
            if name == hips:
                pb.location = basis.translation
                pb.keyframe_insert("location", frame=f - f0)

    # Park the baked action on its own NLA track so the exporter emits one animation per emote.
    ad = tgt.animation_data
    track = ad.nla_tracks.new()
    track.name = clip_id
    track.strips.new(clip_id, 0, new_act)
    ad.action = None
    for pb in tgt.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    return f1 - f0 + 1


def export_emotes(tgt, path):
    bpy.ops.object.select_all(action="DESELECT")
    tgt.select_set(True)
    bpy.context.view_layer.objects.active = tgt
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    wanted = {
        "filepath": path,
        "export_format": "GLB",
        "use_selection": True,
        "export_yup": True,
        "export_animations": True,
        "export_animation_mode": "NLA_TRACKS",
        "export_force_sampling": True,
        "export_frame_step": 1,
        "export_def_bones": True,
        "export_optimize_animation_size": True,
        "export_skins": True,
        "export_morph": False,
        "export_materials": "NONE",
        "export_draco_mesh_compression_enable": False,
    }
    bpy.ops.export_scene.gltf(**{k: v for k, v in wanted.items() if k in props})


def render_checks(tgt, meshes, clip_frames, out_dir, sex):
    """One strip per emote: the avatar at 20/40/60/80% through the clip."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "OBJECT"
    scene.display.shading.show_object_outline = True
    scene.render.resolution_x, scene.render.resolution_y = 320, 420
    for m in meshes:
        m.color = (0.35, 0.55, 0.95, 1)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 2.6
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (1.2, -8, 1.05)
    cam.rotation_euler = (math.radians(90), 0, math.radians(8))
    scene.camera = cam
    os.makedirs(out_dir, exist_ok=True)
    ad = tgt.animation_data
    for track in ad.nla_tracks:
        for t in ad.nla_tracks:
            t.mute = t != track
        n = clip_frames[track.name]
        for k, frac in enumerate((0.2, 0.4, 0.6, 0.8)):
            scene.frame_set(int(n * frac))
            scene.render.filepath = os.path.join(out_dir, f"{sex}_{track.name}_{k}.png")
            bpy.ops.render.render(write_still=True)
    for t in ad.nla_tracks:
        t.mute = False


def main():
    args = parse_args()
    bpy.context.scene.render.fps = FPS
    clip_files = sorted(f for f in os.listdir(args["clips"]) if f.lower().endswith(".fbx"))
    if args["only"]:
        keep = set(args["only"].split(","))
        clip_files = [f for f in clip_files if f[:-4] in keep]

    for sex in SEXES:
        clear_scene()
        avatar = import_new(bpy.ops.import_scene.gltf, filepath=os.path.join(args["avatars"], f"avatar_{sex}.glb"))
        tgt = next(o for o in avatar if o.type == "ARMATURE")
        meshes = [o for o in avatar if o.type == "MESH"]
        clip_frames = {}
        for fname in clip_files:
            clip_id = fname[:-4]
            src_objs = import_new(bpy.ops.import_scene.fbx, filepath=os.path.join(args["clips"], fname))
            src = next(o for o in src_objs if o.type == "ARMATURE")
            clip_frames[clip_id] = retarget(src, tgt, clip_id)
            for o in src_objs:
                bpy.data.objects.remove(o, do_unlink=True)
            log(sex, clip_id, clip_frames[clip_id], "frames")

        if args["out"]:
            path = os.path.abspath(os.path.join(args["out"], f"emotes_{sex}.glb"))
            export_emotes(tgt, path)
            log(sex, "exported", path, os.path.getsize(path), "bytes")
        if args["preview"]:
            render_checks(tgt, meshes, clip_frames, os.path.abspath(args["preview"]), sex)
            log(sex, "previews", args["preview"])


main()
