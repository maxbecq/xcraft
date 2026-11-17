"""Game models and HUD icons of the Dieux, from the concept sculptures (gods.py, units.py, buildings.py).

Usage (from the repo root):
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/dieux/export.py -- public/models public/icons [type ...]
then compress the models as `npm run models` does (node tools/compress-models.mjs public/models/<type>.glb).

The concept materials are procedural (they do not survive glTF): each part gets a flat stand-in of the same colour;
the material named "team" is recoloured per player in game. Meshes are merged per material and decimated.
1 Blender unit = 1 tile, models face -Y, origin on the ground; units are drawn 1.65 times larger in game.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import buildings as B  # noqa: E402
import gods  # noqa: E402
import kit  # noqa: E402
import units  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "public/models"
ICONS = argv[1] if len(argv) > 1 else "public/icons"
ONLY = set(argv[2:])

GOD = 1.3
#: type -> (sculpt, scale, most triangles)
TYPES = {
    "gaia": (gods.gaia, GOD, 24000), "thor": (gods.thor, GOD, 24000), "apollon": (gods.apollon, GOD, 24000), "seth": (gods.seth, GOD, 24000),
    "esprit": (units.esprit, 0.8, 4000), "nain": (units.nain, 0.75, 9000), "minotaure": (units.minotaure, 0.8, 10000), "sphinx": (units.sphinx, 0.85, 10000),
    "asgaard": (B.porte, 1.0, 30000), "branche": (B.branche, 1.0, 14000), "protecteur": (B.protecteur, 0.85, 18000),
    "antre": (B.antre, 1.0, 12000), "puitsdivin": (B.puits, 1.0, 12000), "temple": (B.temple, 0.72, 24000),
}


def flatten():
    """Replace every procedural material with a plain one of its colour (what glTF keeps)."""
    for m in bpy.data.materials:
        spec = kit.FLAT.get(m.name)
        if not spec:
            continue
        color, metallic, rough, emission, strength, alpha = spec
        nt = m.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        b = nt.nodes.new("ShaderNodeBsdfPrincipled")
        o = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(b.outputs[0], o.inputs[0])
        b.inputs["Base Color"].default_value = (*kit.lin(color), 1)
        b.inputs["Metallic"].default_value = metallic
        b.inputs["Roughness"].default_value = rough
        if emission is not None and strength:
            b.inputs["Emission Color"].default_value = (*kit.lin(emission), 1)
            b.inputs["Emission Strength"].default_value = strength
        if alpha < 1:
            b.inputs["Alpha"].default_value = alpha
            m.blend_method = "BLEND" if hasattr(m, "blend_method") else None


def merged(objs, limit):
    """One mesh per material, decimated to stay under `limit` triangles in all."""
    meshes = [o for o in objs if o.type == "MESH"]
    by_mat = {}
    for o in meshes:
        by_mat.setdefault(o.data.materials[0].name if o.data.materials else "", []).append(o)
    out = []
    for name, group in by_mat.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in group:
            o.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        if len(group) > 1:
            bpy.ops.object.join()
        o = bpy.context.active_object
        o.name = name or "part"
        out.append(o)
    tris = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)
    total = sum(tris(o) for o in out)
    if total > limit:
        ratio = limit / total
        for o in out:
            if tris(o) < 200:
                continue
            d = o.modifiers.new("dec", "DECIMATE")
            d.ratio = ratio
            kit._apply(o, d)
    return out, sum(tris(o) for o in out)


def icon(objs, path):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = sc.render.resolution_y = 128
    sc.render.film_transparent = True
    sc.render.use_freestyle = False
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    corners = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    centre = sum(corners, Vector()) / len(corners)
    radius = max((c - centre).length for c in corners)
    cd = bpy.data.cameras.new("cam")
    cd.type = "ORTHO"
    cd.ortho_scale = radius * 1.65
    cam = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(cam)
    d = Vector((math.sin(math.radians(45)) * math.cos(math.radians(35)), -math.cos(math.radians(45)) * math.cos(math.radians(35)), math.sin(math.radians(35))))
    d = Vector((-d.x, d.y, d.z))  # front-left, the side the sculptures were made to be seen from
    cam.location = centre + d * (radius * 4)
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(40), math.radians(-20), math.radians(30))
    sc.collection.objects.link(sun)
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    sc.world = w
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


for typ, (fn, scale, limit) in TYPES.items():
    if ONLY and typ not in ONLY:
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    kit.MATS.clear()
    kit.FLAT.clear()
    p = kit.palette()
    objs = kit.group(fn, p, scale=scale)
    # The icon keeps the painted materials; the game model gets flat ones.
    icon([o for o in objs if o.type == "MESH"], os.path.join(ICONS, f"{typ}.png"))
    bpy.context.scene.render.film_transparent = False
    parts, tris = merged(objs, limit)
    flatten()
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, f"{typ}.glb"), export_format="GLB", use_selection=True, export_apply=True, export_yup=True)
    print(f"DIEUX {typ}: {tris} triangles, {len(parts)} meshes")
