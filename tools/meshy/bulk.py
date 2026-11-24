"""Makes a rigged Meshy character heavier without moving its joints: each vertex is pushed away from the bones that
carry it (weighted by its skin weights), across the bone's axis, chest and belly widest. The skeleton, the skin
weights and every clip are kept, so the clips taken from the same rig still fit.
Usage: Blender -b --factory-startup -P tools/meshy/bulk.py -- in.glb out.glb
"""
import sys

import bpy
from mathutils import Vector

src, dst = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
# Across the bone, sideways (world X) and front to back (world Y): the trunk widened more than deepened; limbs evenly.
GROW = {
    "Hips": (1.3, 1.15), "Spine": (1.4, 1.2), "Spine01": (1.5, 1.22), "Spine02": (1.6, 1.25), "neck": (1.3, 1.15),
    "LeftShoulder": (1.4, 1.3), "RightShoulder": (1.4, 1.3),
    "LeftArm": (1.45, 1.45), "RightArm": (1.45, 1.45), "LeftForeArm": (1.35, 1.35), "RightForeArm": (1.35, 1.35),
    "LeftHand": (1.2, 1.2), "RightHand": (1.2, 1.2),
    "LeftUpLeg": (1.3, 1.3), "RightUpLeg": (1.3, 1.3), "LeftLeg": (1.22, 1.22), "RightLeg": (1.22, 1.22),
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
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_animations=True, export_animation_mode="ACTIONS")
