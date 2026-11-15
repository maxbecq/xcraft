"""Builds Xcraft's low-poly models and HUD icons in Blender, headless.

Usage (from the repo root):
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/models.py -- public/models public/icons [type ...]

Conventions: 1 Blender unit = 1 tile, Z up, models face -Y (glTF turns that into +Z, the game's forward),
origin on the ground at the footprint centre. Faces using the material named "team" are recoloured per player in game.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "public/models"
ICONS = argv[1] if len(argv) > 1 else "public/icons"
ONLY = set(argv[2:])

MATS = {}


def linear(hex_color):
    """sRGB hex to linear RGB, as Blender and glTF expect."""
    out = []
    for i in (16, 8, 0):
        c = ((hex_color >> i) & 255) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return out


def mat(name, color, emission=None, metallic=0.0, rough=0.8):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*linear(color), 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    if emission is not None:
        b.inputs["Emission Color"].default_value = (*linear(emission), 1)
        b.inputs["Emission Strength"].default_value = 1.5
    MATS[name] = m
    return m


def palette():
    return {
        "team": mat("team", 0x3A7BD5, rough=0.6),
        "skin": mat("skin", 0xE8C4A0),
        "cloth": mat("cloth", 0x9A7650),
        "dark": mat("dark", 0x4A423A),
        "leather": mat("leather", 0x5A3B22),
        "bronze": mat("bronze", 0xB08A3C, metallic=0.8, rough=0.35),
        "steel": mat("steel", 0x9AA3AB, metallic=0.9, rough=0.3),
        "wood": mat("wood", 0x7A5634),
        "stone": mat("stone", 0xC9BEA2),
        "stone_dark": mat("stone_dark", 0x8A8070),
        "linen": mat("linen", 0xE8E0CC),
        "thatch": mat("thatch", 0xC2A25A),
        "green_glow": mat("green_glow", 0x6CFF7A, emission=0x3CFF5A),
        "orange_glow": mat("orange_glow", 0xFFB040, emission=0xFF7A10),
        "cyan_glow": mat("cyan_glow", 0x7FF5FF, emission=0x30D8FF),
        "purple_glow": mat("purple_glow", 0xB27BFF, emission=0x7A30FF),
        "crystal": mat("crystal", 0x56C8FF, emission=0x0F5A99, rough=0.2),
        "rock": mat("rock", 0x6E655A),
    }


def _finish(o, m, name):
    o.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    o.data.materials.clear()
    o.data.materials.append(m)
    return o


def box(m, size, loc, rot=(0, 0, 0), name="box"):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    return _finish(o, m, name)


def cyl(m, r, depth, loc, rot=(0, 0, 0), verts=12, r2=None, name="cyl"):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r if r2 is None else r2, depth=depth, location=loc, rotation=rot)
    return _finish(bpy.context.active_object, m, name)


def cone(m, r, depth, loc, rot=(0, 0, 0), verts=8, name="cone"):
    return cyl(m, r, depth, loc, rot, verts, 0, name)


def ball(m, r, loc, scale=(1, 1, 1), seg=10, rings=6, name="ball"):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r, location=loc)
    o = bpy.context.active_object
    o.scale = scale
    return _finish(o, m, name)


# ------------------------------------------------------------------ units

def humanoid(p, tunic, height=1.0, bulk=1.0):
    """Legs, torso, arms and head. Returns the shoulder height."""
    h = height
    for x in (-0.07, 0.07):
        box(p["dark"], (0.09 * bulk, 0.1, 0.3 * h), (x * bulk, 0, 0.15 * h))
    box(tunic, (0.26 * bulk, 0.17 * bulk, 0.3 * h), (0, 0, 0.45 * h))
    box(p["leather"], (0.27 * bulk, 0.18 * bulk, 0.04), (0, 0, 0.32 * h))
    for x in (-0.175, 0.175):
        box(tunic, (0.07 * bulk, 0.08, 0.27 * h), (x * bulk, -0.03, 0.46 * h), rot=(0.35, 0, 0))
    ball(p["skin"], 0.085, (0, 0, 0.7 * h))
    return 0.58 * h


def serf(p):
    humanoid(p, p["cloth"])
    cone(p["team"], 0.1, 0.14, (0, 0, 0.8), verts=6)  # hood
    box(p["linen"], (0.18, 0.12, 0.16), (0, 0.13, 0.48))  # sack on the back
    cyl(p["wood"], 0.018, 0.5, (0.2, -0.12, 0.42), rot=(math.radians(-30), 0, 0), verts=6)  # pick handle
    box(p["steel"], (0.2, 0.03, 0.04), (0.2, -0.24, 0.63))  # pick head


def auxiliaire(p):
    humanoid(p, p["team"])
    box(p["bronze"], (0.24, 0.05, 0.2), (0, -0.09, 0.5))  # breastplate
    ball(p["bronze"], 0.1, (0, 0, 0.74), scale=(1, 1, 0.8))  # helmet
    box(p["team"], (0.03, 0.18, 0.06), (0, 0.01, 0.83))  # crest
    # Chemical rifle held forward, with a glowing vial.
    cyl(p["steel"], 0.025, 0.55, (0.12, -0.3, 0.5), rot=(math.radians(90), 0, 0), verts=8)
    cyl(p["green_glow"], 0.04, 0.12, (0.12, -0.12, 0.56), rot=(math.radians(90), 0, 0), verts=8)


def legionnaire(p):
    humanoid(p, p["team"], height=1.08, bulk=1.25)
    box(p["steel"], (0.33, 0.06, 0.24), (0, -0.12, 0.52))  # heavy plate
    ball(p["steel"], 0.11, (0, 0, 0.78), scale=(1, 1, 0.85))
    for x in (-0.06, 0.06):  # alchemical tubes on the back
        cyl(p["orange_glow"], 0.025, 0.3, (x, 0.13, 0.55), verts=6)
    # Portable saw, held forward.
    cyl(p["steel"], 0.2, 0.025, (0.24, -0.28, 0.45), rot=(0, math.radians(90), 0), verts=16)
    cyl(p["dark"], 0.05, 0.06, (0.24, -0.28, 0.45), rot=(0, math.radians(90), 0), verts=8)


def soigneur(p):
    humanoid(p, p["linen"])
    box(p["team"], (0.06, 0.19, 0.3), (0.06, 0, 0.47), rot=(0, math.radians(25), 0))  # sash
    cone(p["linen"], 0.11, 0.18, (0, 0, 0.82), verts=8)  # hood
    box(p["leather"], (0.14, 0.08, 0.1), (-0.15, 0.06, 0.36))  # satchel
    for x in (-0.19, -0.15, -0.11):
        cyl(p["cyan_glow"], 0.018, 0.08, (x, 0.06, 0.44), verts=6)
    # Energy crossbow.
    box(p["wood"], (0.05, 0.36, 0.05), (0.12, -0.24, 0.5))
    box(p["steel"], (0.32, 0.04, 0.03), (0.12, -0.38, 0.5))


# ------------------------------------------------------------------ buildings

def conseil(p):
    """Council of Aldermen: a stepped temple with a team-coloured roof and braziers."""
    box(p["stone_dark"], (4.9, 4.9, 0.3), (0, 0, 0.15))
    box(p["stone"], (4.4, 4.4, 0.2), (0, 0, 0.4))
    box(p["stone"], (3.0, 2.6, 1.5), (0, 0, 1.25))
    for i in range(5):
        for x, y in ((-1.9 + i * 0.95, -1.9), (-1.9 + i * 0.95, 1.9), (-1.9, -1.9 + i * 0.95), (1.9, -1.9 + i * 0.95)):
            cyl(p["linen"], 0.13, 1.6, (x, y, 1.3), verts=10)
    box(p["stone"], (4.2, 4.2, 0.2), (0, 0, 2.2))
    # Gabled roof: two slanted planes meeting at a ridge along X.
    for side in (-1, 1):
        box(p["team"], (4.4, 2.45, 0.14), (0, side * 1.08, 2.78), rot=(-side * math.radians(24), 0, 0))
    box(p["dark"], (0.8, 0.1, 1.0), (0, -1.31, 1.0))  # door
    for x in (-1.5, 1.5):  # braziers
        cyl(p["bronze"], 0.18, 0.5, (x, -2.25, 0.75), verts=8, r2=0.25)
        cone(p["orange_glow"], 0.16, 0.35, (x, -2.25, 1.15), verts=6)


def grenier(p):
    cyl(p["wood"], 0.78, 1.2, (0, 0, 0.6), verts=12)
    cyl(p["team"], 0.8, 0.12, (0, 0, 1.0), verts=12)
    cone(p["thatch"], 0.95, 0.8, (0, 0, 1.6), verts=12)
    box(p["dark"], (0.35, 0.1, 0.55), (0, -0.76, 0.28))


def caserne(p):
    box(p["stone"], (2.8, 2.8, 1.3), (0, 0, 0.65))
    for i in range(6):
        t = -1.25 + i * 0.5
        for x, y in ((t, -1.3), (t, 1.3), (-1.3, t), (1.3, t)):
            box(p["stone_dark"], (0.25, 0.25, 0.3), (x, y, 1.45))
    box(p["dark"], (0.8, 0.2, 0.9), (0, -1.35, 0.45))  # gate
    for x in (-0.9, 0.9):
        cyl(p["wood"], 0.035, 1.6, (x, -1.0, 2.0), verts=6)
        box(p["team"], (0.45, 0.03, 0.6), (x + 0.23, -1.0, 2.45))  # banner
    box(p["team"], (2.2, 2.2, 0.08), (0, 0, 1.32))  # courtyard roof


def mine(p):
    cyl(p["stone_dark"], 1.45, 0.5, (0, 0, 0.25), verts=16)
    box(p["stone"], (1.1, 1.1, 2.0), (0, 0, 1.4))
    box(p["team"], (1.25, 1.25, 0.25), (0, 0, 2.5))
    for x, y in ((-0.9, -0.9), (0.9, -0.9), (0.9, 0.9), (-0.9, 0.9)):  # derrick legs
        cyl(p["wood"], 0.05, 2.6, (x * 0.8, y * 0.8, 1.3), verts=6)
    cyl(p["purple_glow"], 0.12, 1.4, (0.95, -0.4, 0.9), verts=8)
    cyl(p["purple_glow"], 0.12, 1.0, (-0.95, 0.5, 0.75), verts=8)
    cyl(p["steel"], 0.35, 0.08, (0, -0.6, 1.9), rot=(math.radians(90), 0, 0), verts=12)  # gear


def minerai(p):
    for x, y, h, r, tilt in ((0, 0, 0.95, 0.2, 0), (0.2, 0.1, 0.65, 0.15, 0.35), (-0.18, 0.12, 0.55, 0.14, -0.4), (0.05, -0.2, 0.5, 0.13, 0.3)):
        cone(p["crystal"], r, h, (x, y, h / 2), rot=(tilt, tilt * 0.5, 0), verts=5)
    ball(p["rock"], 0.32, (0, 0, 0.02), scale=(1.2, 1.2, 0.35), seg=7, rings=4)


def puits(p):
    cyl(p["rock"], 1.45, 0.16, (0, 0, 0.08), verts=14)
    cyl(p["purple_glow"], 0.9, 0.18, (0, 0, 0.1), verts=14)
    for i in range(7):
        a = i / 7 * math.tau
        ball(p["rock"], 0.22, (math.cos(a) * 1.25, math.sin(a) * 1.25, 0.12), scale=(1, 0.8, 0.6), seg=6, rings=4)


MODELS = {
    "serf": serf, "auxiliaire": auxiliaire, "legionnaire": legionnaire, "soigneur": soigneur,
    "conseil": conseil, "grenier": grenier, "caserne": caserne, "mine": mine, "minerai": minerai, "puits": puits,
}


# ------------------------------------------------------------------ export

def build(name, fn):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    fn(palette())
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    model = bpy.context.active_object
    model.name = name
    bpy.ops.object.shade_flat()
    return model


def export(model, path):
    bpy.ops.object.select_all(action="DESELECT")
    model.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True)


def icon(model, path):
    """Renders a transparent 128px icon from the game's camera angle."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 128
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    corners = [model.matrix_world @ Vector(c) for c in model.bound_box]
    centre = sum(corners, Vector()) / 8
    radius = max((c - centre).length for c in corners)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = radius * 2.1
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    direction = Vector((math.sin(math.radians(45)) * math.cos(math.radians(35)), -math.cos(math.radians(45)) * math.cos(math.radians(35)), math.sin(math.radians(35))))
    # Look at the model's front-right, like the in-game camera sees a unit walking towards it.
    direction = Vector((direction.x, -abs(direction.y), direction.z))
    cam.location = centre + direction * (radius * 4)
    cam.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(40), math.radians(-20), math.radians(30))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    scene.world = world
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


os.makedirs(OUT, exist_ok=True)
os.makedirs(ICONS, exist_ok=True)
for name, fn in MODELS.items():
    if ONLY and name not in ONLY:
        continue
    model = build(name, fn)
    export(model, os.path.join(OUT, f"{name}.glb"))
    icon(model, os.path.join(ICONS, f"{name}.png"))
    print(f"MODEL {name}: {len(model.data.polygons)} faces")
