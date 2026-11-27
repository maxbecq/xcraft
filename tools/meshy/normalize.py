"""Normalise a Meshy .glb for the game: one mesh, feet on the ground at the origin, facing the
game's forward, scaled to a target height, texture shrunk for the web.
Usage: Blender -b --factory-startup -P tools/meshy/normalize.py -- in.glb out.glb height [texture_px] [faces]
With FOOTPRINT=<width> in the environment (buildings), the model is scaled to fit that square footprint,
and height is only a maximum.
"""
import os
import sys

import bpy

src, dst, height, *rest = sys.argv[sys.argv.index("--") + 1:]
height = float(height)
tex_px = int(rest[0]) if rest else 1024
faces = int(rest[1]) if len(rest) > 1 else 0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
o = bpy.context.view_layer.objects.active
o.parent = None
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Glb from Meshy faces glTF +Z, which is already the game's forward: only size and placement change.
xs = [v.co.x for v in o.data.vertices]
ys = [v.co.y for v in o.data.vertices]
zs = [v.co.z for v in o.data.vertices]
s = height / (max(zs) - min(zs))
if os.environ.get("FOOTPRINT"):
    s = min(s, float(os.environ["FOOTPRINT"]) / max(max(xs) - min(xs), max(ys) - min(ys)))
cx, cy, z0 = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, min(zs)
for v in o.data.vertices:
    v.co.x = (v.co.x - cx) * s
    v.co.y = (v.co.y - cy) * s
    v.co.z = (v.co.z - z0) * s

if faces and len(o.data.polygons) > faces:
    d = o.modifiers.new("decimate", "DECIMATE")
    d.ratio = faces / len(o.data.polygons)
    bpy.ops.object.modifier_apply(modifier=d.name)

for img in bpy.data.images:
    if img.size[0] > tex_px:
        img.scale(tex_px, tex_px)
        img.pack()
for m in bpy.data.materials:
    m.name = "meshy"
    # Rodin's "Shaded" material is its texture as emission on black: lit by nothing, it skips the team colour.
    nodes = m.node_tree.nodes if m.use_nodes else []
    bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf and not bsdf.inputs["Base Color"].is_linked and bsdf.inputs["Emission Color"].is_linked:
        m.node_tree.links.new(bsdf.inputs["Emission Color"].links[0].from_socket, bsdf.inputs["Base Color"])
        m.node_tree.links.remove(bsdf.inputs["Emission Color"].links[0])
        bsdf.inputs["Emission Strength"].default_value = 0
        bsdf.inputs["Roughness"].default_value = 0.8

bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_image_format="JPEG", export_jpeg_quality=85, export_apply=True)
print(f"normalised {src} -> {dst}: {len(o.data.polygons)} faces, scale {s:.4f}")
