"""The Char Pégase made movable from its single Rodin mesh, and narrower: squeezed across by NARROW (it read too wide
beside a Légionnaire), then its turret and big cannon cut out as `zturret` (turning on its own axis, render/units.ts
aims it at its foe; its muzzle, the cannon's mouth, kept in its `tip` extra) and its two side fans as `zrotor_0` and
`zrotor_1` (spinning on their own axles in flight, after Décollage).
Usage: Blender -b --factory-startup -P tools/meshy/pegaseparts.py -- in.glb out.glb [preview.png]
"""
import sys

import bpy
from mathutils import Vector

src, dst, *rest = sys.argv[sys.argv.index("--") + 1:]
NARROW = 0.82
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
body = next(o for o in bpy.context.scene.objects if o.type == "MESH")
body.name = "body"
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for v in body.data.vertices:
    v.co.x *= NARROW


def cut(name, test):
    faces = [p.index for p in body.data.polygons if test(p.center)]
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for i in faces:
        body.data.polygons[i].select = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    part = next(o for o in bpy.context.selected_objects if o is not body)
    part.name = name
    vs = [v.co for v in part.data.vertices]
    lo = Vector([min(v[i] for v in vs) for i in range(3)])
    hi = Vector([max(v[i] for v in vs) for i in range(3)])
    print("PART", name, len(faces), [round(x, 2) for x in lo], [round(x, 2) for x in hi])
    return part, lo, hi


xs = [v.co.x for v in body.data.vertices]
half = max(abs(min(xs)), abs(max(xs)))
turret, lo, hi = cut("zturret", lambda c: c.z > 0.52 and abs(c.x) < 0.42 and c.y < 0.6)
# Its axis: the middle of its base ring (the part behind the cannon), its muzzle the cannon's front.
axis = Vector(((lo.x + hi.x) / 2, (lo.y * 0.35 + hi.y * 0.65), lo.z))
muzzle = min(turret.data.vertices, key=lambda v: v.co.y).co.copy()
muzzle.x = axis.x
for i, sx in enumerate((-1, 1)):
    fan, flo, fhi = cut(f"zrotor_{i}", lambda c, sx=sx: c.x * sx > half - 0.2 * NARROW)
    bpy.context.scene.cursor.location = (flo + fhi) / 2
    bpy.ops.object.select_all(action="DESELECT")
    fan.select_set(True)
    bpy.context.view_layer.objects.active = fan
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.context.scene.cursor.location = axis
bpy.ops.object.select_all(action="DESELECT")
turret.select_set(True)
bpy.context.view_layer.objects.active = turret
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
# The muzzle in the turret's own frame, glTF axes (x, z up, -y forward -> x, y, z).
m = muzzle - axis
turret["tip"] = [m.x, m.z, -m.y]
print("AXIS", [round(x, 3) for x in axis], "TIP", [round(x, 3) for x in turret["tip"]])
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_extras=True)
