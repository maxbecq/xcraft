"""The Plésiosaure's wings cut out of its single Rodin mesh so they can beat: `zwing_0` (its left, glTF -x) and
`zwing_1` (its right), each with its origin on its shoulder hinge, turning about the body's length (glTF z).
render/units.ts flaps them. Each wing keeps a narrow strip at its root that the body keeps too, so no gap opens at
the shoulder as it beats.
Usage: Blender -b --factory-startup -P tools/meshy/plesioparts.py -- in.glb out.glb
"""
import sys

import bmesh
import bpy

src, dst = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
body = next(o for o in bpy.context.scene.objects if o.type == "MESH")
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
body.name = "body"

ROOT, KEEP, FRONT, TIP = 0.17, 0.21, 0.15, 0.3  # hinge |x|; the body keeps its faces up to KEEP; near the body, wings
# are behind y FRONT (the neck and legs are ahead of it), and out past TIP everything is wing (its tips curve forward)
HINGE = {-1: (-0.05, 0.27), 1: (-0.05, 0.22)}  # (y, z) of each shoulder, measured on the model


def keep_only(o, test):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not test(f.calc_center_median())], context="FACES")
    bm.to_mesh(o.data)
    bm.free()


for i, s in enumerate((-1, 1)):
    wing = body.copy()
    wing.data = body.data.copy()
    bpy.context.scene.collection.objects.link(wing)
    keep_only(wing, lambda c, s=s: s * c.x > ROOT and (c.y < FRONT or s * c.x > TIP))
    wing.name = f"zwing_{i}"
    bpy.context.scene.cursor.location = (s * ROOT, *HINGE[s])
    bpy.ops.object.select_all(action="DESELECT")
    wing.select_set(True)
    bpy.context.view_layer.objects.active = wing
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    print("WING", i, len(wing.data.polygons), "faces")
keep_only(body, lambda c: abs(c.x) <= KEEP or (c.y >= FRONT and abs(c.x) <= TIP))
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB")
