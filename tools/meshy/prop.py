"""Normalise a Meshy weapon: longest axis along +Z with the thin (muzzle) end forward, grip at
the origin (a third of the way from the stock), given length, texture shrunk.
Usage: Blender -b --factory-startup -P tools/meshy/prop.py -- in.glb out.glb length [texture_px]
"""
import sys

import bpy
from mathutils import Matrix, Vector

src, dst, length, *rest = sys.argv[sys.argv.index("--") + 1:]
tex_px = int(rest[0]) if rest else 512
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
o = bpy.context.view_layer.objects.active
o.parent = None
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
pts = [v.co.copy() for v in o.data.vertices]
lo = Vector([min(p[i] for p in pts) for i in range(3)])
hi = Vector([max(p[i] for p in pts) for i in range(3)])
axis = max(range(3), key=lambda i: hi[i] - lo[i])
span = hi[axis] - lo[axis]

def thickness(end):
    sel = [p for p in pts if (p[axis] - lo[axis] if end == 0 else hi[axis] - p[axis]) < span * 0.15]
    return sum(max(p[i] for p in sel) - min(p[i] for p in sel) for i in range(3) if i != axis)

forward = 1 if thickness(1) < thickness(0) else -1  # the muzzle is thinner than the stock
# Rotate so that `axis * forward` becomes +Z (Blender Z up is glTF Y, so build it in glTF terms after).
d = Vector((0, 0, 0))
d[axis] = forward
rot = d.rotation_difference(Vector((0, -1, 0))).to_matrix().to_4x4()  # Blender -Y = glTF +Z
o.data.transform(rot)
pts = [v.co.copy() for v in o.data.vertices]
lo = Vector([min(p[i] for p in pts) for i in range(3)])
hi = Vector([max(p[i] for p in pts) for i in range(3)])
s = float(length) / (hi.y - lo.y)
grip = Vector(((lo.x + hi.x) / 2, hi.y - (hi.y - lo.y) / 3, (lo.z + hi.z) / 2))
o.data.transform(Matrix.Scale(s, 4) @ Matrix.Translation(-grip))
for img in bpy.data.images:
    if img.size[0] > tex_px:
        img.scale(tex_px, tex_px)
        img.pack()
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_image_format="JPEG", export_jpeg_quality=85)
print("prop", dst, "axis", axis, "forward", forward, "faces", len(o.data.polygons))
