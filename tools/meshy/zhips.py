"""Puts each Z walker leg's hip (zleg_<pair>_<l|r>, the point the game's leg IK turns the femur about) where the femur
meets the hull: splitlegs.py (concepts-z) left it inside the femur, a step out from the hull, so the femur's root swung
off the hull as the leg moved and the leg looked loose from the body. The new hip is the middle of the femur's vertices
lying on the hull (or nearest it); the leg's meshes and the shin keep their place.
Run before pivots.py (with zknees.py's output for a model compressed without pivots).
Usage: Blender -b --factory-startup -P tools/meshy/zhips.py -- in.glb out.glb
"""
import re
import sys

import bpy
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree

src, dst = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
LEG = re.compile(r"^zleg_\d+_[lr]$")
legs = [o for o in bpy.context.scene.objects if LEG.match(o.name)]


def in_leg(o):
    while o:
        if LEG.match(o.name):
            return True
        o = o.parent
    return False


hull = [c.matrix_world @ v.co for c in bpy.context.scene.objects if c.type == "MESH" and not in_leg(c) for v in c.data.vertices]
tree = KDTree(len(hull))
for i, p in enumerate(hull):
    tree.insert(p, i)
tree.balance()
for leg in legs:
    femur = [c for c in [leg, *leg.children_recursive] if c.type == "MESH" and not c.name.startswith("zshin_")
             and not any(p.name.startswith("zshin_") for p in c.children_recursive) and not (c.parent and c.parent.name.startswith("zshin_"))]
    ws = [c.matrix_world @ v.co for c in femur for v in c.data.vertices]
    span = max((w - ws[0]).length for w in ws)
    gaps = [(tree.find(w)[2], w) for w in ws]
    least = min(g for g, _ in gaps)
    touch = [w for g, w in gaps if g <= least + 0.03 * span]
    hip = sum(touch, Vector()) / len(touch)
    M = leg.matrix_world.copy()
    kids = [(c, c.matrix_world.copy()) for c in leg.children]
    local = M.inverted() @ hip
    if leg.type == "MESH":
        leg.data.transform(Matrix.Translation(-local))
    leg.matrix_world = M @ Matrix.Translation(local)
    for c, mw in kids:
        c.matrix_world = mw
    print("HIP", leg.name, len(touch), round(least, 4), [round(x, 3) for x in M.translation], "->", [round(x, 3) for x in hip])
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_extras=True)
