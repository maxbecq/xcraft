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

#: The look picked on 2026-11-18 (recherches-visuelles/dieux/planches/selection.jpg): palette slots a model's sculpt
#: uses, swapped for another material. Models listed here also get their painted materials baked into a texture.
MARBLE = {"skin": "statue", "white": "statue2", "leather": "gold", "embroid": "gold"}
LOOKS = {
    "apollon": {**MARBLE, "leaf": "gold"},
    "minotaure": {"fur": "statue", "fur_light": "statue2", "jackal": "statue2", "leather": "gold", "steel": "gold", "bark": "gold"},
    "temple": {"marble": "statue", "marble2": "statue2"},
}
BAKE_SIZE = 1024


def bake(parts, typ):
    """Every painted part but the team colour and the lights joined into one mesh, unwrapped, and its procedural
    materials baked into one colour texture: the game keeps the marble veins, brush grain and painted cavities."""
    keep = [o for o in parts if o.data.materials and (o.data.materials[0].name == "team" or o.data.materials[0].name in kit.GLOWS)]
    body = [o for o in parts if o not in keep]
    if not body:
        return parts
    bpy.ops.object.select_all(action="DESELECT")
    for o in body:
        o.select_set(True)
    bpy.context.view_layer.objects.active = body[0]
    if len(body) > 1:
        bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = "body"
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 16
    sc.render.bake.margin = 6
    mats = list(o.data.materials)
    specs = [kit.FLAT.get(m.name, (0, 0.0, 0.8, None, 0, 1)) for m in mats]

    def target(name, data):
        img = bpy.data.images.new(f"{typ}_{name}", BAKE_SIZE, BAKE_SIZE, is_data=data)
        for m in mats:
            node = m.node_tree.nodes.new("ShaderNodeTexImage")
            node.image = img
            m.node_tree.nodes.active = node
        return img
    # colour: metal counts as its own colour (a diffuse bake of metal comes out black)
    for m in mats:
        m.node_tree.nodes["Principled BSDF"].inputs["Metallic"].default_value = 0.0
    albedo = target("albedo", False)
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"})
    # glTF metal-roughness map (green roughness, blue metal), one flat value per painted material
    for m, (_, metallic, rough, *_r) in zip(mats, specs):
        nt = m.node_tree
        e = nt.nodes.new("ShaderNodeEmission")
        e.inputs["Color"].default_value = (0, rough, metallic, 1)
        out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
        nt.links.new(e.outputs[0], out.inputs["Surface"])
    mr = target("metalrough", True)
    bpy.ops.object.bake(type="EMIT")
    mat = bpy.data.materials.new("body")
    mat.use_nodes = True
    nt = mat.node_tree
    b = nt.nodes["Principled BSDF"]
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = albedo
    nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    t2 = nt.nodes.new("ShaderNodeTexImage")
    t2.image = mr
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(t2.outputs["Color"], sep.inputs[0])
    nt.links.new(sep.outputs["Green"], b.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], b.inputs["Metallic"])
    o.data.materials.clear()
    o.data.materials.append(mat)
    albedo.pack()
    mr.pack()
    return keep + [o]


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
    kit.GLOWS.clear()
    p = kit.palette()
    for slot, name in LOOKS.get(typ, {}).items():
        p[slot] = p[name]
    objs = kit.group(fn, p, scale=scale)
    # The icon keeps the painted materials; the game model gets flat ones.
    icon([o for o in objs if o.type == "MESH"], os.path.join(ICONS, f"{typ}.png"))
    bpy.context.scene.render.film_transparent = False
    parts, tris = merged(objs, limit)
    if typ in LOOKS:
        parts = bake(parts, typ)
    flatten()
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, f"{typ}.glb"), export_format="GLB", use_selection=True, export_apply=True, export_yup=True, export_image_format="JPEG", export_image_quality=88)
    print(f"DIEUX {typ}: {tris} triangles, {len(parts)} meshes")
