"""Puts a Z walker's knees back where its legs bend, in a model compressed before pivots.py existed: compress.sh had
moved each shin's origin (zshin_<pair>_<l|r>, the knee the game's leg IK turns it about) to the middle of its mesh.
The knee is found again the way concepts-z/splitknee.py first placed it, from the leg as it stands (its femur, the
zleg_<pair>_<l|r> it hangs from, and the shin), the cut telling which of its two ways was used (across the height, shin and femur part on a level):
- cut across the reach (a spider leg): the knee is the middle of the vertices round the leg's highest point;
- cut across the height (a leg hanging under its hip): the middle of the vertices at the cut's height.
Given the uncompressed source (`source.glb`, its legs as they are now), its knees are taken as they are instead.
`seam=<shin>,...`: those shins' knees on their joint, at the vertex they share with their femur nearest the joint's middle (the
Octopode's zshin_2_l: its femur, cut shorter at the hip later, no longer reaches the knee the source gives it).
Run on the model written back without meshopt (its quantised positions kept, which Blender reads); then pivots.py
and compress.sh as for any model.
Usage: Blender -b --factory-startup -P tools/meshy/zknees.py -- in.glb out.glb [source.glb] [seam=<shin>,...]
"""
import re
import sys

import bpy
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree

args = sys.argv[sys.argv.index("--") + 1:]
src, dst = args[:2]
seams = {n for a in args[2:] if a.startswith("seam=") for n in a[5:].split(",")}
args = [a for a in args if not a.startswith("seam=")]
SHIN = re.compile(r"^zshin_\d+_[lr]$")
bpy.ops.wm.read_factory_settings(use_empty=True)
known = {}
if len(args) > 2:
    bpy.ops.import_scene.gltf(filepath=args[2])
    known = {o.name: o.matrix_world.translation.copy() for o in bpy.context.scene.objects if SHIN.match(o.name)}
    bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)


def unique(points):
    """The leg's vertices once each (the cut left the seam's in both parts)."""
    return list({tuple(round(c, 4) for c in p): p for p in points}.values())


for shin in [o for o in bpy.context.scene.objects if o.type == "MESH" and SHIN.match(o.name)]:
    leg = bpy.data.objects[shin.name.replace("zshin_", "zleg_")]
    femur = [c for c in [leg, *leg.children_recursive] if c.type == "MESH" and not SHIN.match(c.name)]
    if shin.name in seams:
        pts = [c.matrix_world @ v.co for c in femur for v in c.data.vertices]
        tree = KDTree(len(pts))
        for i, p in enumerate(pts):
            tree.insert(p, i)
        tree.balance()
        ws = [shin.matrix_world @ v.co for v in shin.data.vertices]
        span = max((a - ws[0]).length for a in ws)
        seam = [w for w in ws if tree.find(w)[2] < 1e-3 * span]
        assert len(seam) >= 3, f"{shin.name}: no joint with its femur ({len(seam)} vertices)"
        # The shared vertex nearest their middle: the shin turns on a point of the joint itself, which stays shut.
        mid = sum(seam, Vector()) / len(seam)
        knee, how = min(seam, key=lambda w: (w - mid).length), f"seam {len(seam)}"
    elif shin.name in known:
        knee, how = known[shin.name], "source"
    else:
        H = leg.matrix_world.translation.copy()
        ws = unique([c.matrix_world @ v.co for c in [*femur, shin] for v in c.data.vertices])
        fc = [c.matrix_world @ p.center for c in femur for p in c.data.polygons]
        sc = [shin.matrix_world @ p.center for p in shin.data.polygons]
        # The foot: the leg's lowest vertex, the first in its order then; a flat sole has several, the order lost
        # (compression reorders them): each is tried, and the knee most of them give kept.
        low = min(c.z for c in ws)
        knees = []
        for F in [c for c in ws if c.z < low + 0.002]:
            h = Vector((F.x - H.x, F.y - H.y, 0)).normalized()
            out = lambda c: (c - H).dot(h)
            if max(c.z for c in sc) >= min(c.z for c in fc):
                reach = out(F)
                top = max((c for c in ws if 0.15 * reach < out(c) < 0.85 * reach), key=lambda c: c.z)
                near = [c for c in ws if (c - top).length < 0.15 * (top - F).length]
                how = "reach"
            else:
                cut = (max(c.z for c in sc) + min(c.z for c in fc)) / 2
                near = [c for c in ws if abs(c.z - cut) < 0.03 * (H.z - F.z)]
                how = "height"
            knees.append(sum(near, Vector()) / len(near))
        agree = lambda k: sum((k - o).length < 0.01 for o in knees)
        knee = max(knees, key=agree)
        how += f" {agree(knee)}/{len(knees)}"
    local = shin.matrix_world.inverted() @ knee
    shin.data.transform(Matrix.Translation(-local))
    shin.matrix_basis = shin.matrix_basis @ Matrix.Translation(local)
    print("KNEE", shin.name, how, [round(c, 4) for c in knee])
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_extras=True)
