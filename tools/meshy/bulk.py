"""Makes a rigged Meshy character heavier: each vertex is pushed away from the bones that carry it (weighted by its
skin weights), across the bone's axis, chest and belly widest; then the arms are set further apart (their joints moved
out in the rest pose, the vertices they carry with them), for broad shoulders. The skin weights are kept, and the clips
still fit: pack.py reads their keys as offsets from the rest pose.
Usage: Blender -b --factory-startup -P tools/meshy/bulk.py -- in.glb out.glb [shoulder widening, metres a side]
"""
import sys

import bpy
from mathutils import Vector

src, dst, *more = sys.argv[sys.argv.index("--") + 1:]
WIDEN = float(more[0]) if more else 0.0
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
# Across the bone, sideways (world X) and front to back (world Y): the trunk widened more than deepened; limbs evenly.
GROW = {
    "Hips": (1.45, 1.25), "Spine": (1.65, 1.35), "Spine01": (1.85, 1.4), "Spine02": (2.0, 1.45), "neck": (1.6, 1.4),
    "LeftShoulder": (1.8, 1.5), "RightShoulder": (1.8, 1.5),
    "LeftArm": (1.75, 1.75), "RightArm": (1.75, 1.75), "LeftForeArm": (1.6, 1.6), "RightForeArm": (1.6, 1.6),
    "LeftHand": (1.25, 1.25), "RightHand": (1.25, 1.25),
    "LeftUpLeg": (1.55, 1.55), "RightUpLeg": (1.55, 1.55), "LeftLeg": (1.45, 1.45), "RightLeg": (1.45, 1.45),
}
W = arm.matrix_world
bones = arm.data.bones
# A bone's axis from its head to its first child's head: this importer's tails are absurd (a 22 m forearm).
axis = {}
for b in bones:
    h = W @ b.head_local
    t = W @ (b.children[0].head_local if b.children else b.tail_local)
    axis[b.name] = (h, (t - h).normalized() if (t - h).length > 1e-6 else Vector((0, 0, 1)))
for o in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
    names = {g.index: g.name for g in o.vertex_groups}
    M, Mi = o.matrix_world, o.matrix_world.inverted()
    moved = 0
    for v in o.data.vertices:
        p = M @ v.co
        d = Vector()
        for g in v.groups:
            n = names.get(g.group)
            if n not in GROW or g.weight <= 0:
                continue
            h, a = axis[n]
            off = (p - h) - a * (p - h).dot(a)  # across the bone
            fx, fy = GROW[n]
            d += g.weight * Vector((off.x * (fx - 1), off.y * (fy - 1), off.z * (fx - 1) if abs(a.z) < 0.7 else 0))
        if d.length > 0:
            v.co = Mi @ (p + d)
            moved += 1
    print("BULK", o.name, moved, "vertices")
    # Broad shoulders: the arms' vertices moved out with their joints (the shoulder's own half way).
    if WIDEN:
        for v in o.data.vertices:
            d = 0.0
            for g in v.groups:
                n = names.get(g.group, "")
                side = 1 if n.startswith("Left") else -1 if n.startswith("Right") else 0
                part = 1.0 if any(k in n for k in ("Arm", "Hand")) else 0.5 if "Shoulder" in n else 0.0
                d += g.weight * side * part
            if d:
                v.co = Mi @ (M @ v.co + Vector((d * WIDEN, 0, 0)))
if WIDEN:
    # The arm bones themselves, out by the same (the character's left is +X).
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    k = WIDEN / arm.matrix_world.to_scale().x
    for e in arm.data.edit_bones:
        side = 1 if e.name.startswith("Left") else -1 if e.name.startswith("Right") else 0
        if side and any(t in e.name for t in ("Arm", "Hand")):
            e.head.x += side * k
            e.tail.x += side * k
    bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_animations=True, export_animation_mode="ACTIONS")
