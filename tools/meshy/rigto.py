"""Puts a new, unrigged character mesh (from TRELLIS) on the skeleton and clips of a rigged Meshy model:
the new mesh is sized to the old body's height, its feet on the ground and centred under the hips, then
bound to the armature with automatic weights. The old body is dropped; skeleton and clips are kept.
Usage: Blender -b --factory-startup -P tools/meshy/rigto.py -- rigged.glb mesh.glb out.glb
(both inputs plain glTF: Blender cannot read meshopt.)
"""
import sys

import bpy
from mathutils import Vector

rigged, mesh, dst = sys.argv[sys.argv.index("--") + 1:][:3]


def bounds(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    return Vector([min(p[i] for p in pts) for i in range(3)]), Vector([max(p[i] for p in pts) for i in range(3)])


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=rigged)
for action in bpy.data.actions:
    action.use_fake_user = True
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
arm.data.pose_position = "REST"
bpy.context.view_layer.update()
old = [o for o in bpy.context.scene.objects if o.type == "MESH"]
lo, hi = bounds(old)
hips = arm.matrix_world @ arm.data.bones["Hips"].head_local
for o in old:
    bpy.data.objects.remove(o, do_unlink=True)

before = set(bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=mesh)
new = [o for o in bpy.context.scene.objects if o not in before and o.type == "MESH"]
for o in bpy.context.scene.objects:
    if o not in before and o.type != "MESH":
        o.select_set(False)
bpy.ops.object.select_all(action="DESELECT")
for o in new:
    o.select_set(True)
bpy.context.view_layer.objects.active = new[0]
if len(new) > 1:
    bpy.ops.object.join()
body = bpy.context.active_object
world = body.matrix_world.copy()  # keep the importer's parent transform (glTF y-up turn)
body.parent = None
body.matrix_world = world
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
# Face -y like the rig (TRELLIS does not always): the toes stick out in front, so the feet's middle lies
# ahead of the body's.
nlo, nhi = bounds([body])
feet = [body.matrix_world @ v.co for v in body.data.vertices if (body.matrix_world @ v.co).z < nlo.z + 0.06 * (nhi.z - nlo.z)]
feet_mid = (min(p.y for p in feet) + max(p.y for p in feet)) / 2
if feet_mid > (nlo.y + nhi.y) / 2:
    body.rotation_mode = "XYZ"  # the glTF importer leaves quaternions, which ignore rotation_euler
    body.rotation_euler.z += 3.14159265
    bpy.ops.object.transform_apply(rotation=True)
    print("RIGTO turned to face -y")
nlo, nhi = bounds([body])
k = (hi.z - lo.z) / (nhi.z - nlo.z)
body.scale = (k, k, k)
bpy.ops.object.transform_apply(scale=True)
nlo, nhi = bounds([body])
body.location += Vector((hips.x - (nlo.x + nhi.x) / 2, hips.y - (nlo.y + nhi.y) / 2, lo.z - nlo.z))
bpy.ops.object.transform_apply(location=True)
# Bone heat needs one connected, watertight-ish surface: weld the atlas seams first.
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=0.0005)
bpy.ops.object.mode_set(mode="OBJECT")
body.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type="ARMATURE_AUTO")
weighted = sum(1 for v in body.data.vertices if v.groups)
print(f"RIGTO {body.name}: {len(body.data.polygons)} faces, {weighted}/{len(body.data.vertices)} vertices weighted")
arm.data.pose_position = "POSE"
body.name = "char1"
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_image_format="AUTO", export_animation_mode="ACTIONS")
