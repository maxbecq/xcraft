"""Keeps the pivots of a model's moving parts through compression. compress.sh quantises positions with meshopt, which
moves each mesh node's origin to the middle of its mesh (it folds the dequantising offset and scale into the node):
a part render/units.ts or life.ts turns or moves by its node (a rotor, a turret, a track link, the Réservoir's wheels,
legs, vat, pump and lever, an armillary) then turned about the wrong point, or was put in the wrong place.
Each such part becomes an empty node under its own name, holding its transform, its parent and its extras, with its
mesh moved into a child `<name>_geo` at no offset: compression then shifts only that child.
Run on the built model, before compress.sh.
Usage: Blender -b --factory-startup -P tools/meshy/pivots.py -- in.glb out.glb
"""
import re
import sys

import bpy

src, dst = sys.argv[sys.argv.index("--") + 1:][:2]
MOVING = re.compile(r"^(zrotor|zduct|zmast|zturret|ztread|zwheel|zstep|zvat|zpumper|zlever|zwing|armillaryb?)(_\d+)*$")
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
done = 0
for o in [o for o in bpy.context.scene.objects if o.type == "MESH" and MOVING.match(o.name)]:
    name = o.name
    pivot = bpy.data.objects.new(name + "_pivot", None)
    bpy.context.scene.collection.objects.link(pivot)
    pivot.parent = o.parent
    pivot.matrix_parent_inverse = o.matrix_parent_inverse.copy()
    pivot.matrix_basis = o.matrix_basis.copy()
    for k in o.keys():
        pivot[k] = o[k]
        del o[k]
    for c in list(o.children):
        w = c.matrix_world.copy()
        c.parent = pivot
        c.matrix_world = w
    o.parent = pivot
    o.matrix_parent_inverse.identity()
    o.matrix_basis.identity()
    o.name = name + "_geo"
    pivot.name = name
    done += 1
print("PIVOTS", done)
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_extras=True)
