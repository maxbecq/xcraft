"""The Plésiosaure made symmetric: Rodin gave it its left wing raised and curled forward, its right one level. Every
face out past the left shoulder is dropped and the right side out past its shoulder mirrored in their place (same
texture), so both wings rest alike and beat alike on the flyer rig (render/godrig.ts RIGS.plesiosaure).
Usage: Blender -b --factory-startup -P tools/meshy/plesiosym.py -- in.glb out.glb
"""
import sys

import bmesh
import bpy
from mathutils import Matrix

src, dst = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
body = next(o for o in bpy.context.scene.objects if o.type == "MESH")
M = body.matrix_world
SHOULDER = 0.15  # |x| of the wings' roots (world)

bm = bmesh.new()
bm.from_mesh(body.data)
left = [f for f in bm.faces if (M @ f.calc_center_median()).x < -SHOULDER]
right = [f for f in bm.faces if (M @ f.calc_center_median()).x > SHOULDER]
dup = bmesh.ops.duplicate(bm, geom=right)
faces = [g for g in dup["geom"] if isinstance(g, bmesh.types.BMFace)]
verts = [g for g in dup["geom"] if isinstance(g, bmesh.types.BMVert)]
# The mirror through the body's middle plane (world x = 0), in the mesh's own frame.
mirror = M.inverted() @ Matrix.Scale(-1, 4, (1, 0, 0)) @ M
bmesh.ops.transform(bm, matrix=mirror, verts=verts)
bmesh.ops.reverse_faces(bm, faces=faces)  # a mirror turns faces inside out
bmesh.ops.delete(bm, geom=left, context="FACES")
bm.to_mesh(body.data)
bm.free()
print("SYM dropped", len(left), "left faces, mirrored", len(faces), "right ones")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB")
