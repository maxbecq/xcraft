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
#: Pivot points of animated parts (legs, arms), filled by humanoid().
JOINTS = {}


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
    nodes = m.node_tree.nodes
    b = nodes["Principled BSDF"]
    # Base colour times the hand-painted vertex colour (see paint()).
    attr = nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    mix.inputs[6].default_value = (*linear(color), 1)
    m.node_tree.links.new(attr.outputs["Color"], mix.inputs[7])
    m.node_tree.links.new(mix.outputs[2], b.inputs["Base Color"])
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
        "rust": mat("rust", 0x7E4A32, metallic=0.3, rough=0.9),
        "scrap": mat("scrap", 0x7D786C, metallic=0.6, rough=0.6),
        "hazard": mat("hazard", 0xD9A420, rough=0.7),
        "khaki": mat("khaki", 0x8F8460),
        "coat": mat("coat", 0xBDB49A),
        "rubber": mat("rubber", 0x2A2724, rough=0.95),
        "concrete": mat("concrete", 0x8E8a80),
        "glass": mat("glass", 0x9FD8E0, metallic=0.2, rough=0.1),
        "dark_glass": mat("dark_glass", 0x1C2A30, metallic=0.3, rough=0.15),
        "boulder": mat("boulder", 0x8A6E56, rough=0.95),
        "tag": mat("tag", 0xFFFFFF),
        "window_glow": mat("window_glow", 0xFFC870, emission=0xFFA040),
        "lamp_glow": mat("lamp_glow", 0xFFF2C0, emission=0xFFE090),
        "red_glow": mat("red_glow", 0xFF4A3A, emission=0xFF2010),
        "crystal_pale": mat("crystal_pale", 0xA8E8FF, emission=0x2A7AB0, rough=0.15),
        "crystal_deep": mat("crystal_deep", 0x2E86D8, emission=0x0A3A80, rough=0.2),
        "purple_deep": mat("purple_deep", 0xE0C0FF, emission=0xB060FF),
        "crystal_vein": mat("crystal_vein", 0x8FE6FF, emission=0x2AA8FF),
        "ivory": mat("ivory", 0xEDE6D6, rough=0.35),
        "chrome": mat("chrome", 0xC8CCD2, metallic=1.0, rough=0.18),
        "gold": mat("gold", 0xD4AF37, metallic=1.0, rough=0.25),
        "flesh": mat("flesh", 0x8A3A5A, rough=0.55),
        "violet_glow": mat("violet_glow", 0xC890FF, emission=0x9040FF),
        "deadwood": mat("deadwood", 0x5E4A3A, rough=0.95),
        "drygrass": mat("drygrass", 0xB59A5C, rough=1.0),
        "bone": mat("bone", 0xB8AC92, rough=0.95),
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
    _finish(o, m, name)
    # Chamfered edges catch the light, which reads much better than razor-sharp boxes.
    width = min(size) * 0.12
    if width > 0.004:
        mod = o.modifiers.new("bevel", "BEVEL")
        mod.width = min(width, 0.05)
        mod.segments = 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return o


def cyl(m, r, depth, loc, rot=(0, 0, 0), verts=12, r2=None, name="cyl"):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r if r2 is None else r2, depth=depth, location=loc, rotation=rot)
    return _finish(bpy.context.active_object, m, name)


def cone(m, r, depth, loc, rot=(0, 0, 0), verts=8, name="cone"):
    return cyl(m, r, depth, loc, rot, verts, 0, name)


def ball(m, r, loc, scale=(1, 1, 1), seg=10, rings=6, name="ball"):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r, location=loc)
    o = bpy.context.active_object
    o.scale = scale
    _finish(o, m, name)
    for poly in o.data.polygons:
        poly.use_smooth = True
    return o


def soften(o, level=1):
    """Rounds a part (subdivision) and shades it smooth: organic, sculpted shapes instead of blocks."""
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    mod = o.modifiers.new("soft", "SUBSURF")
    mod.levels = level
    mod.render_levels = level
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for poly in o.data.polygons:
        poly.use_smooth = True
    return o


def limb(m, top, bottom, r_top, r_bottom, name="limb"):
    """A tapered, rounded limb between two points."""
    a, b = Vector(top), Vector(bottom)
    d = b - a
    o = cyl(m, r_top, d.length, (a + b) / 2, verts=8, r2=r_bottom, name=name)
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = (-d).to_track_quat("Z", "Y")
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return soften(o)


# ------------------------------------------------------------------ Humans: low tech, scavenged, Mad Max meets Terrans

def humanoid(p, outfit, height=1.0, bulk=1.0, armor=None):
    """A sculpted heroic figure: rounded chest and pelvis, tapered limbs, shoulder balls, gloves and boots.
    Returns the head height. Legs and arms are separate parts pivoting at hip and shoulder, for animation."""
    h = height
    armor = armor or outfit
    for side, x in (("l", -0.08), ("r", 0.08)):
        xb = x * bulk
        limb(outfit, (xb, 0, 0.34 * h), (xb, -0.01, 0.2 * h), 0.065 * bulk, 0.05 * bulk, name=f"leg_{side}")  # thigh
        limb(outfit, (xb, -0.01, 0.2 * h), (xb, 0.0, 0.07), 0.05 * bulk, 0.04 * bulk, name=f"leg_{side}")  # shin
        soften(box(p["rubber"], (0.1 * bulk, 0.17, 0.09), (xb, -0.03, 0.05), name=f"leg_{side}"))  # boot
        ball(armor, 0.045 * bulk, (xb, -0.045, 0.2 * h), scale=(1, 0.7, 1.1), seg=8, rings=5, name=f"leg_{side}")  # knee
        JOINTS[f"leg_{side}"] = (xb, 0, 0.34 * h)
    ball(outfit, 0.15 * bulk, (0, 0, 0.36 * h), scale=(1.05, 0.75, 0.55), seg=12, rings=6)  # pelvis
    soften(box(outfit, (0.3 * bulk, 0.2 * bulk, 0.22 * h), (0, 0, 0.53 * h)))  # chest
    soften(box(p["leather"], (0.3 * bulk, 0.21 * bulk, 0.05), (0, 0, 0.38 * h)))  # belt
    box(p["leather"], (0.05, 0.22 * bulk, 0.22 * h), (0.07, 0, 0.52 * h), rot=(0, 0.5, 0))  # harness strap
    for x in (-0.09, 0.09):
        soften(box(p["leather"], (0.06, 0.05, 0.06), (x * bulk, -0.11 * bulk, 0.38 * h)))  # pouches
    cyl(p["skin"], 0.042, 0.06, (0, 0, 0.66 * h), verts=8)  # neck
    for side, x in (("l", -0.2), ("r", 0.2)):
        xb = x * bulk
        ball(armor, 0.07 * bulk, (xb, 0, 0.6 * h), seg=10, rings=6, name=f"arm_{side}")  # shoulder
        limb(outfit, (xb, 0, 0.6 * h), (xb * 1.05, -0.06, 0.4 * h), 0.05 * bulk, 0.042 * bulk, name=f"arm_{side}")
        ball(p["leather"], 0.045, (xb * 1.05, -0.075, 0.37 * h), scale=(1, 1, 1.15), seg=8, rings=5, name=f"arm_{side}")  # glove
        JOINTS[f"arm_{side}"] = (xb, 0, 0.6 * h)
    ball(p["skin"], 0.088, (0, -0.01, 0.75 * h), scale=(0.92, 1, 1.08), seg=12, rings=8)
    return 0.75 * h


def goggles(p, z, glass="glass"):
    box(p["rubber"], (0.19, 0.04, 0.04), (0, -0.08, z))
    for x in (-0.045, 0.045):
        cyl(p[glass], 0.03, 0.035, (x, -0.1, z), rot=(math.radians(90), 0, 0), verts=8)


def pauldron(p, m, x, z, size=0.11):
    ball(m, size, (x, 0, z), scale=(1.1, 1.0, 0.7), seg=8, rings=5)


def serf(p):
    """Scavenger: hard hat with a lamp, goggles, a big scrap pack with an antenna, wrench in hand."""
    head = humanoid(p, p["khaki"])
    goggles(p, head + 0.01)
    ball(p["hazard"], 0.1, (0, 0, head + 0.05), scale=(1.05, 1.05, 0.6), seg=10, rings=5)  # hard hat
    box(p["hazard"], (0.24, 0.24, 0.02), (0, 0, head + 0.03))
    cyl(p["lamp_glow"], 0.025, 0.03, (0, -0.1, head + 0.07), rot=(math.radians(90), 0, 0), verts=8)
    soften(box(p["team"], (0.33, 0.2, 0.05), (0, 0, 0.6)))  # team shoulder band
    soften(box(p["scrap"], (0.24, 0.14, 0.26), (0, 0.16, 0.52)))  # pack
    cyl(p["rust"], 0.07, 0.24, (0.08, 0.22, 0.66), verts=8)
    box(p["hazard"], (0.25, 0.02, 0.04), (0, 0.235, 0.46))
    pipe(p["steel"], (-0.08, 0.2, 0.62), (-0.12, 0.25, 0.95), r=0.008, verts=4)  # antenna
    ball(p["red_glow"], 0.015, (-0.12, 0.25, 0.96), seg=6, rings=4)
    cyl(p["steel"], 0.02, 0.4, (0.21, -0.15, 0.3), rot=(math.radians(-25), 0, 0), verts=6)  # wrench
    box(p["steel"], (0.1, 0.035, 0.06), (0.21, -0.24, 0.48))


def auxiliaire(p):
    """Rifleman: painted chest plate, team pauldrons, gas mask piped to a back tank, scoped pipe rifle."""
    head = humanoid(p, p["khaki"], armor=p["scrap"])
    soften(box(p["team"], (0.3, 0.06, 0.2), (0, -0.1, 0.54)))  # chest plate
    box(p["hazard"], (0.3, 0.065, 0.03), (0, -0.1, 0.45))
    pauldron(p, p["team"], -0.2, 0.64)
    pauldron(p, p["scrap"], 0.2, 0.64)
    ball(p["scrap"], 0.105, (0, 0.01, head + 0.03), scale=(1, 1.05, 0.8), seg=10, rings=5)  # helmet
    soften(box(p["rubber"], (0.13, 0.07, 0.1), (0, -0.08, head - 0.03)))  # gas mask
    cyl(p["scrap"], 0.032, 0.06, (0, -0.14, head - 0.06), rot=(math.radians(90), 0, 0), verts=8)
    cyl(p["green_glow"], 0.06, 0.24, (0, 0.16, 0.54), verts=8)  # back tank
    pipe(p["rubber"], (0.03, -0.12, head - 0.07), (0.1, 0.12, 0.6), r=0.015, verts=4)
    for x in (-0.1, 0.0, 0.1):
        box(p["leather"], (0.06, 0.04, 0.08), (x, -0.13, 0.37))  # ammo pouches
    cyl(p["scrap"], 0.03, 0.62, (0.13, -0.3, 0.5), rot=(math.radians(90), 0, 0), verts=6)  # barrel
    box(p["wood"], (0.05, 0.18, 0.09), (0.13, -0.02, 0.46))  # stock
    cyl(p["steel"], 0.02, 0.14, (0.13, -0.2, 0.56), rot=(math.radians(90), 0, 0), verts=6)  # scope
    cyl(p["green_glow"], 0.045, 0.14, (0.18, -0.2, 0.47), rot=(math.radians(90), 0, 0), verts=8)


def legionnaire(p):
    """Brute in welded scrap armour: spiked pauldrons, bucket helmet with a glowing slit, buzz saw, exhausts."""
    head = humanoid(p, p["rubber"], height=1.08, bulk=1.3, armor=p["scrap"])
    soften(box(p["scrap"], (0.4, 0.09, 0.28), (0, -0.13, 0.58)))
    box(p["hazard"], (0.4, 0.095, 0.04), (0, -0.13, 0.45))
    for x in (-0.3, 0.3):
        pauldron(p, p["team"], x, 0.72, size=0.15)
        for k in (-1, 1):
            cone(p["steel"], 0.03, 0.14, (x * 1.05, k * 0.05, 0.82), verts=5)
    box(p["rust"], (0.18, 0.18, 0.16), (0, 0, head + 0.02))  # bucket helmet
    box(p["red_glow"], (0.13, 0.02, 0.025), (0, -0.091, head + 0.03))  # eye slit
    for x in (-0.08, 0.08):
        cyl(p["scrap"], 0.035, 0.32, (x, 0.15, 0.72), verts=6)
        cyl(p["orange_glow"], 0.036, 0.04, (x, 0.15, 0.89), verts=6)
    cyl(p["steel"], 0.22, 0.025, (0.3, -0.32, 0.45), rot=(0, math.radians(90), 0), verts=16)  # saw
    for k in range(8):
        a = k / 8 * math.tau
        cone(p["steel"], 0.02, 0.05, (0.3, -0.32 + math.cos(a) * 0.23, 0.45 + math.sin(a) * 0.23), rot=(a + math.pi / 2, 0, 0), verts=3)
    cyl(p["hazard"], 0.06, 0.05, (0.3, -0.32, 0.45), rot=(0, math.radians(90), 0), verts=8)
    box(p["scrap"], (0.07, 0.25, 0.07), (0.3, -0.15, 0.45))
    box(p["scrap"], (0.03, 0.2, 0.2), (0.34, -0.3, 0.55))  # saw guard


def soigneur(p):
    """Field medic: long coat, goggles, team armband, tank pack with tubes, injector crossbow."""
    head = humanoid(p, p["coat"])
    soften(box(p["coat"], (0.3, 0.2, 0.22), (0, 0.01, 0.24)))  # coat skirt
    goggles(p, head + 0.01, glass="cyan_glow")
    cone(p["coat"], 0.12, 0.2, (0, 0.01, head + 0.08), verts=8)  # hood
    box(p["team"], (0.08, 0.09, 0.07), (-0.2, -0.03, 0.55))  # armband
    for x in (-0.06, 0.06):
        cyl(p["scrap"], 0.055, 0.3, (x, 0.15, 0.52), verts=8)
        cyl(p["cyan_glow"], 0.02, 0.32, (x, 0.2, 0.52), verts=6)
    pipe(p["rubber"], (0.06, 0.15, 0.68), (0.2, -0.05, 0.5), r=0.012, verts=4)
    box(p["leather"], (0.14, 0.08, 0.1), (-0.17, 0.06, 0.36))  # satchel
    box(p["wood"], (0.05, 0.34, 0.05), (0.14, -0.24, 0.5))  # crossbow
    box(p["scrap"], (0.34, 0.04, 0.03), (0.14, -0.37, 0.5))
    cyl(p["cyan_glow"], 0.025, 0.12, (0.14, -0.43, 0.53), rot=(math.radians(90), 0, 0), verts=6)


def corrugated(m, size, loc, ribs_along="x"):
    """A sheet of corrugated metal: a plate with raised ribs."""
    sx, sy, sz = size
    box(m, size, loc)
    n = max(2, int((sx if ribs_along == "x" else sy) / 0.25))
    for i in range(n):
        t = -0.5 + (i + 0.5) / n
        if ribs_along == "x":
            box(m, (0.06, sy, sz + 0.05), (loc[0] + t * sx, loc[1], loc[2]))
        else:
            box(m, (sx, 0.06, sz + 0.05), (loc[0], loc[1] + t * sy, loc[2]))


def container(p, size, loc, paint):
    sx, sy, sz = size
    box(paint, size, loc)
    for i in range(int(sx / 0.3)):  # ribbed sides
        x = loc[0] - sx / 2 + 0.15 + i * 0.3
        box(paint, (0.05, sy + 0.04, sz - 0.1), (x, loc[1], loc[2]))
    box(p["rust"], (sx + 0.02, sy + 0.02, 0.06), (loc[0], loc[1], loc[2] + sz / 2))
    box(p["rust"], (sx * 0.3, sy + 0.03, sz * 0.25), (loc[0] - sx * 0.25, loc[1], loc[2] - sz * 0.3))  # rust stain


def pipe(m, a, b, r=0.05, verts=8):
    """A cylinder from point a to point b."""
    a, b = Vector(a), Vector(b)
    d = b - a
    o = cyl(m, r, d.length, (a + b) / 2, verts=verts)
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = d.to_track_quat("Z", "Y")
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return o


def ladder(p, x, y, z0, z1, along="x"):
    w = 0.12
    for s in (-w, w):
        pipe(p["scrap"], (x + (s if along == "x" else 0), y + (0 if along == "x" else s), z0), (x + (s if along == "x" else 0), y + (0 if along == "x" else s), z1), r=0.018, verts=5)
    z = z0 + 0.15
    while z < z1:
        box(p["scrap"], (2 * w if along == "x" else 0.025, 0.025 if along == "x" else 2 * w, 0.025), (x, y, z))
        z += 0.18


def window(p, size, loc):
    """A lit window: dark frame around a warm glow."""
    box(p["dark"], (size[0] + 0.06, size[1] + 0.02, size[2] + 0.06), loc)
    box(p["window_glow"], (size[0], size[1] + 0.04, size[2]), loc)


def lamp(p, loc):
    cyl(p["dark"], 0.06, 0.08, loc, verts=8)
    ball(p["lamp_glow"], 0.07, (loc[0], loc[1], loc[2] - 0.06), seg=8, rings=4)


def sandbags(p, cx, cy, r, a0, a1, n, z=0.2):
    for i in range(n):
        a = a0 + (a1 - a0) * (i + 0.5) / n
        ball(p["khaki"], 0.22, (cx + math.cos(a) * r, cy + math.sin(a) * r, z), scale=(1.25, 0.7, 0.45), seg=8, rings=4)
        if i % 2 == 0:
            ball(p["khaki"], 0.2, (cx + math.cos(a + 0.12) * r, cy + math.sin(a + 0.12) * r, z + 0.18), scale=(1.2, 0.7, 0.45), seg=8, rings=4)


def tag(p, loc, size, facing="-y"):
    """A quad flush on a wall where the game paints a graffiti (material "tag", UV 0..1)."""
    rot = {"-y": (math.radians(90), 0, 0), "+x": (math.radians(90), 0, math.radians(90))}[facing]
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = (size[0] * 1.3, size[1] * 1.3, 1)
    return _finish(o, p["tag"], "tag")


def plate_floor(p, size):
    """Base pad: concrete with welded steel plates and hazard edges."""
    box(p["concrete"], (size, size, 0.2), (0, 0, 0.1))
    for i, (x, y) in enumerate(((-0.25, -0.25), (0.25, -0.25), (0.25, 0.25), (-0.25, 0.25))):
        box(p["scrap"] if i % 2 else p["rust"], (size * 0.45, size * 0.45, 0.04), (x * size, y * size, 0.21))
    for s in (-1, 1):
        box(p["hazard"], (size, 0.1, 0.05), (0, s * (size / 2 - 0.05), 0.22))


def conseil(p):
    """Command post: stacked containers, a watchtower, antenna mast, pipes, lit windows and tyre fires."""
    plate_floor(p, 4.9)
    container(p, (3.2, 1.3, 1.1), (-0.4, 0.6, 0.85), p["team"])
    container(p, (3.0, 1.3, 1.1), (0.2, -0.75, 0.85), p["rust"])
    container(p, (2.4, 1.3, 1.0), (-0.1, 0.0, 1.95), p["scrap"])
    corrugated(p["rust"], (2.6, 1.5, 0.05), (-0.1, 0.0, 2.5))
    box(p["hazard"], (0.9, 0.06, 0.65), (0.2, -1.42, 0.65))  # door
    box(p["dark"], (0.7, 0.07, 0.55), (0.2, -1.43, 0.62))
    lamp(p, (0.2, -1.5, 1.15))
    for x in (-1.0, -0.4, 0.8):
        window(p, (0.32, 0.04, 0.22), (x, -1.42, 1.1))
    window(p, (0.7, 0.04, 0.25), (-0.1, -0.66, 2.05))
    # Catwalk along the upper container, with a railing.
    box(p["scrap"], (2.6, 0.35, 0.05), (-0.1, -0.85, 1.42))
    for i in range(6):
        pipe(p["scrap"], (-1.35 + i * 0.5, -1.0, 1.42), (-1.35 + i * 0.5, -1.0, 1.75), r=0.02, verts=5)
    pipe(p["scrap"], (-1.35, -1.0, 1.75), (1.15, -1.0, 1.75), r=0.02, verts=5)
    ladder(p, 1.45, -1.3, 0.25, 1.45)
    # Watchtower on stilts with a searchlight.
    for x, y in ((1.35, 1.0), (2.05, 1.0), (1.35, 1.7), (2.05, 1.7)):
        cyl(p["scrap"], 0.05, 2.6, (x, y, 1.4), verts=6)
    pipe(p["rust"], (1.35, 1.0, 0.6), (2.05, 1.7, 2.0), r=0.025, verts=5)
    pipe(p["rust"], (2.05, 1.0, 0.6), (1.35, 1.7, 2.0), r=0.025, verts=5)
    box(p["team"], (1.0, 1.0, 0.55), (1.7, 1.35, 2.85))
    window(p, (0.6, 0.04, 0.18), (1.7, 0.84, 2.9))
    corrugated(p["rust"], (1.2, 1.2, 0.06), (1.7, 1.35, 3.2))
    ladder(p, 2.15, 1.35, 0.25, 2.6, along="y")
    cyl(p["steel"], 0.1, 0.18, (1.25, 0.9, 3.0), rot=(math.radians(70), 0, 0), verts=10)  # searchlight
    cyl(p["lamp_glow"], 0.08, 0.02, (1.25, 0.82, 2.97), rot=(math.radians(70), 0, 0), verts=10)
    # Antenna mast, dish and a blinking-red tip.
    cyl(p["steel"], 0.03, 2.4, (-1.5, 1.4, 3.1), verts=6)
    for z in (2.4, 3.0, 3.6):
        box(p["steel"], (0.3, 0.02, 0.02), (-1.5, 1.4, z))
    cone(p["scrap"], 0.38, 0.2, (-1.2, 1.4, 3.6), rot=(0, math.radians(-60), 0), verts=12)
    ball(p["red_glow"], 0.05, (-1.5, 1.4, 4.32), seg=6, rings=4)
    # Pipes from the tank to the containers.
    cyl(p["team"], 0.32, 0.9, (-1.95, -0.6, 0.65), verts=12)
    pipe(p["scrap"], (-1.95, -0.6, 1.0), (-1.95, -0.1, 1.0), r=0.05)
    pipe(p["scrap"], (-1.95, -0.1, 1.0), (-1.95, -0.1, 1.6), r=0.05)
    pipe(p["scrap"], (-1.95, -0.1, 1.6), (-1.3, -0.1, 1.6), r=0.05)
    # Sandbags, tyre stacks with a fire, barrels.
    sandbags(p, 0.2, -1.6, 1.1, math.radians(200), math.radians(250), 3)
    sandbags(p, 0.2, -1.6, 1.1, math.radians(290), math.radians(340), 3)
    for x, y in ((-2.0, -1.9), (-1.4, -2.0), (2.0, -1.9)):
        for k in range(3):
            cyl(p["rubber"], 0.25, 0.12, (x, y, 0.32 + k * 0.13), verts=10)
    cone(p["orange_glow"], 0.16, 0.35, (-1.4, -2.0, 0.85), verts=6)
    for x in (1.0, 1.35):
        cyl(p["hazard"], 0.16, 0.45, (x, -2.0, 0.45), verts=10)
    box(p["team"], (0.5, 0.03, 0.32), (-1.25, 1.4, 3.75))  # flag
    tag(p, (-0.75, -1.44, 0.55), (0.8, 0.32))
    tag(p, (1.12, 0.0, 1.95), (0.9, 0.36), "+x")


def grenier(p):
    """Supply depot: welded drums under a team-painted tank, with a ladder, valves and a pipe."""
    plate_floor(p, 1.9)
    for x, y in ((-0.45, -0.45), (0.45, -0.45), (0.45, 0.45), (-0.45, 0.45)):
        cyl(p["rust"], 0.3, 0.75, (x, y, 0.6), verts=12)
        cyl(p["scrap"], 0.31, 0.05, (x, y, 0.8), verts=12)
        cyl(p["scrap"], 0.31, 0.05, (x, y, 0.42), verts=12)
    cyl(p["team"], 0.75, 0.7, (0, 0, 1.33), verts=16)
    for z in (1.08, 1.58):
        cyl(p["scrap"], 0.77, 0.05, (0, 0, z), verts=16)  # straps
    cyl(p["hazard"], 0.76, 0.08, (0, 0, 1.33), verts=16)
    cone(p["scrap"], 0.8, 0.3, (0, 0, 1.83), verts=16)
    cyl(p["steel"], 0.06, 0.2, (0, 0, 2.05), verts=8)  # vent
    ladder(p, 0.0, -0.78, 0.25, 1.7)
    cyl(p["red_glow"], 0.07, 0.03, (0.55, -0.55, 1.2), rot=(math.radians(90), 0, math.radians(45)), verts=10)  # valve wheel
    pipe(p["scrap"], (0.5, 0.5, 1.1), (0.9, 0.9, 0.3), r=0.04)
    lamp(p, (0.0, -0.8, 1.85))
    tag(p, (0.45, -0.765, 0.62), (0.4, 0.2))


def caserne(p):
    """Barracks: a scrap bunker behind sandbags, with firing slits, spotlights, barbed wire and a flag."""
    plate_floor(p, 2.9)
    box(p["scrap"], (2.4, 2.4, 1.1), (0, 0, 0.75))
    for i in range(4):  # welded plates on the walls
        box(p["rust"], (0.5, 0.04, 0.4), (-0.8 + i * 0.55, -1.21, 0.55 + (i % 2) * 0.3))
    corrugated(p["team"], (2.6, 2.6, 0.08), (0, 0, 1.35))
    box(p["hazard"], (2.62, 2.62, 0.06), (0, 0, 1.28))
    box(p["dark"], (0.9, 0.1, 0.8), (0, -1.22, 0.6))  # gate
    for x in (-0.22, 0.22):
        box(p["rust"], (0.4, 0.12, 0.78), (x, -1.23, 0.6))
    box(p["hazard"], (1.0, 0.12, 0.1), (0, -1.23, 1.05))
    for x in (-0.85, 0.85):
        window(p, (0.4, 0.04, 0.08), (x, -1.21, 0.95))  # firing slits
        lamp(p, (x, -1.3, 1.2))
    for i in range(11):  # sandbag ring
        a = i / 11 * math.tau
        x, y = math.cos(a) * 1.38, math.sin(a) * 1.38
        if y < -1.0 and abs(x) < 0.7:
            continue  # keep the gate clear
        ball(p["khaki"], 0.24, (x, y, 0.3), scale=(1.2, 0.7, 0.45), seg=8, rings=4)
        ball(p["khaki"], 0.22, (x * 0.98, y * 0.98, 0.48), scale=(1.15, 0.7, 0.45), seg=8, rings=4)
    for x, y in ((-1.2, -1.2), (1.2, -1.2), (1.2, 1.2), (-1.2, 1.2)):
        cone(p["steel"], 0.06, 0.45, (x, y, 1.6), verts=5)  # spikes
    for s in (-1, 1):  # barbed wire along the roof edge
        pipe(p["steel"], (-1.25, s * 1.25, 1.5), (1.25, s * 1.25, 1.5), r=0.012, verts=4)
        pipe(p["steel"], (s * 1.25, -1.25, 1.5), (s * 1.25, 1.25, 1.5), r=0.012, verts=4)
    box(p["scrap"], (0.5, 0.5, 0.35), (-0.6, 0.6, 1.55))  # roof vent
    for i in range(3):
        box(p["dark"], (0.4, 0.02, 0.04), (-0.6, 0.34, 1.45 + i * 0.1))
    cyl(p["steel"], 0.03, 1.4, (0.9, 0.9, 2.05), verts=6)
    box(p["team"], (0.55, 0.03, 0.35), (1.17, 0.9, 2.55))  # flag
    cyl(p["steel"], 0.1, 0.16, (0.7, -0.9, 1.5), rot=(math.radians(-70), 0, 0), verts=10)  # spotlight
    cyl(p["lamp_glow"], 0.08, 0.02, (0.7, -0.97, 1.47), rot=(math.radians(-70), 0, 0), verts=10)
    tag(p, (-0.72, -1.235, 0.5), (0.6, 0.28))
    tag(p, (1.215, 0.25, 0.7), (0.9, 0.4), "+x")


def mine(p):
    """Energy rig: lattice derrick, pumpjack, storage tank, gas flare and glowing pipelines."""
    cyl(p["concrete"], 1.45, 0.3, (0, 0, 0.15), verts=20)
    box(p["hazard"], (2.6, 0.1, 0.05), (0, -1.3, 0.31))
    legs = ((-0.6, -0.6), (0.6, -0.6), (0.6, 0.6), (-0.6, 0.6))
    top = 3.0
    for x, y in legs:  # derrick legs leaning in to a point
        pipe(p["scrap"], (x * 1.0, y * 1.0, 0.3), (x * 0.25, y * 0.25, top), r=0.05, verts=6)
    for z in (0.9, 1.5, 2.1, 2.6):
        f = 1 - (z - 0.3) / (top - 0.3) * 0.75
        corners = [(x * f, y * f, z) for x, y in legs]
        for i in range(4):
            pipe(p["rust"], corners[i], corners[(i + 1) % 4], r=0.025, verts=5)
    box(p["team"], (0.6, 0.6, 0.25), (0, 0, top + 0.1))
    ball(p["red_glow"], 0.06, (0, 0, top + 0.3), seg=6, rings=4)
    pipe(p["steel"], (0, 0, 0.3), (0, 0, top), r=0.04, verts=6)  # drill string
    # Pumpjack: base, walking beam, horse head, counterweight.
    box(p["scrap"], (0.2, 0.2, 0.8), (0.95, -0.55, 0.7))
    box(p["hazard"], (1.3, 0.12, 0.12), (0.85, -0.55, 1.12), rot=(0, math.radians(12), 0))
    box(p["scrap"], (0.18, 0.2, 0.35), (0.25, -0.55, 1.12))
    cyl(p["rust"], 0.22, 0.14, (1.45, -0.55, 0.55), rot=(math.radians(90), 0, 0), verts=12)
    # Storage tank and generator.
    cyl(p["team"], 0.38, 0.9, (-0.85, 0.75, 0.75), verts=14)
    cyl(p["scrap"], 0.4, 0.05, (-0.85, 0.75, 1.2), verts=14)
    box(p["rust"], (0.5, 0.5, 0.45), (-0.95, -0.7, 0.52))
    for i in range(3):
        box(p["dark"], (0.02, 0.4, 0.04), (-0.69, -0.7, 0.42 + i * 0.1))
    # Gas flare with its flame.
    pipe(p["scrap"], (1.0, 0.9, 0.3), (1.0, 0.9, 2.0), r=0.05)
    cone(p["orange_glow"], 0.1, 0.35, (1.0, 0.9, 2.2), verts=6)
    # Glowing energy pipes into the ground.
    pipe(p["purple_glow"], (0.3, 0.4, 0.35), (-0.85, 0.75, 0.35), r=0.09)
    pipe(p["purple_glow"], (-0.3, -0.2, 0.35), (-0.95, -0.7, 0.35), r=0.07)
    lamp(p, (0.0, -0.95, 1.2))
    tag(p, (-0.95, -0.96, 0.55), (0.42, 0.21))


# Mineral fields: outcrops where crystal veins break through slabs of rock, not crystals sitting on the ground.
def crystal(p, mat, base, tilt, length, radius):
    """A hexagonal crystal with a pointed tip, growing from `base` along `tilt` (x, z rotation in radians)."""
    body = cyl(p[mat], radius, length, (0, 0, length / 2), verts=6)
    tip = cone(p[mat], radius, radius * 2.2, (0, 0, length + radius * 1.1), verts=6)
    for o in (body, tip):
        # Bake the offset into the mesh so both pieces pivot around the crystal's base.
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
        o.rotation_euler = (tilt[0], 0, tilt[1])
        o.location = base
    # Rotation and location are applied when the model is joined.
    return body, tip


def slab(p, seed, size, loc, tilt):
    """A broken plate of rock pushed up through the ground, partly buried."""
    o = rock_mesh(p, seed, 1.0, (0, 0, 0), squash=1.0)
    o.scale = size
    o.rotation_euler = tilt
    o.location = loc
    return o


def vein(p, a, b, w=0.025):
    """A thin glowing seam of crystal running over the rock."""
    return pipe(p["crystal_vein"], a, b, r=w, verts=4)


def outcrop(p, seed, slabs, clusters, shards):
    r = lambda k: ((seed * 7919 + k * 104729) % 1000) / 1000
    for i, (size, loc, tilt) in enumerate(slabs):
        slab(p, seed * 10 + i, size, loc, tilt)
    k = 0
    for (cx, cy, cz), n, spread, lean in clusters:
        for j in range(n):
            k += 1
            ang = r(k) * math.tau
            length = 0.2 + r(k + 50) * 0.5 * (1.2 if j == 0 else 0.8)
            rad = 0.05 + r(k + 90) * 0.07
            mat = ("crystal", "crystal_pale", "crystal_deep")[int(r(k + 130) * 3) % 3]
            base = (cx + math.cos(ang) * spread * r(k + 7), cy + math.sin(ang) * spread * r(k + 11), cz - 0.08)
            crystal(p, mat, base, (lean * (0.4 + r(k + 3)), ang + math.pi / 2), length, rad)
    for j in range(shards):
        k += 1
        ang = r(k) * math.tau
        d = 0.45 + r(k + 5) * 0.4
        crystal(p, "crystal_pale", (math.cos(ang) * d, math.sin(ang) * d, 0.0), (1.3, r(k + 9) * math.tau), 0.1 + r(k + 13) * 0.12, 0.03)


def minerai(p):
    outcrop(p, 1,
            [((0.55, 0.35, 0.22), (-0.15, 0.1, 0.05), (0.2, -0.3, 0.4)), ((0.4, 0.3, 0.18), (0.35, -0.15, 0.02), (-0.25, 0.2, -0.5))],
            [((0.05, -0.05, 0.15), 6, 0.18, 0.55), ((-0.35, 0.25, 0.1), 3, 0.1, 0.7)], 4)
    vein(p, (-0.5, 0.0, 0.12), (0.1, 0.2, 0.22))
    vein(p, (0.2, -0.3, 0.12), (0.55, -0.05, 0.1))


def minerai_1(p):
    outcrop(p, 2,
            [((0.65, 0.3, 0.2), (0.0, 0.0, 0.0), (-0.15, 0.25, 0.9)), ((0.3, 0.25, 0.16), (-0.45, -0.2, 0.0), (0.3, 0.1, 0.2))],
            [((0.1, 0.05, 0.15), 5, 0.2, 0.45), ((-0.4, -0.15, 0.08), 2, 0.08, 0.8)], 5)
    vein(p, (-0.55, 0.1, 0.1), (0.4, -0.1, 0.18))


def minerai_2(p):
    outcrop(p, 3,
            [((0.5, 0.4, 0.25), (0.1, 0.1, 0.05), (0.35, -0.2, 0.3)), ((0.35, 0.3, 0.2), (-0.35, -0.1, 0.0), (-0.3, 0.3, -0.7)), ((0.25, 0.2, 0.14), (0.4, -0.35, 0.0), (0.2, 0.2, 1.2))],
            [((0.0, 0.0, 0.2), 7, 0.22, 0.4), ((0.4, -0.3, 0.08), 2, 0.06, 0.9)], 3)
    vein(p, (-0.45, 0.2, 0.15), (0.45, 0.05, 0.25))
    vein(p, (0.0, -0.4, 0.1), (0.15, 0.3, 0.22))


def minerai_3(p):
    outcrop(p, 4,
            [((0.6, 0.45, 0.18), (0.0, 0.0, 0.0), (0.1, 0.15, 0.2))],
            [((0.15, 0.1, 0.12), 4, 0.12, 0.6), ((-0.25, -0.15, 0.1), 4, 0.12, 0.5)], 6)
    vein(p, (-0.5, -0.2, 0.08), (0.5, 0.25, 0.12))


def puits(p):
    """An energy well: a crater with a raised, broken rim, glowing fissures and a sunken pool of light."""
    cyl(p["rock"], 1.3, 0.1, (0, 0, -0.02), verts=18)  # basin floor
    cyl(p["purple_glow"], 0.75, 0.08, (0, 0, 0.03), verts=16)
    cyl(p["purple_deep"], 0.38, 0.1, (0, 0, 0.05), verts=12)
    for i in range(11):  # rim of slabs leaning outwards
        a = i / 11 * math.tau + 0.2
        size = 0.32 + (i % 3) * 0.08
        o = rock_mesh(p, 60 + i, 1.0, (0, 0, 0), squash=1.0)
        o.scale = (size, size * 0.7, size * 0.9)
        o.rotation_euler = (0.5 * math.cos(a), 0.5 * math.sin(a), a)
        o.location = (math.cos(a) * 1.25, math.sin(a) * 1.25, 0.1)
    for i in range(7):  # fissures running out from the pool
        a = i / 7 * math.tau + 0.4
        pipe(p["purple_glow"], (math.cos(a) * 0.7, math.sin(a) * 0.7, 0.04), (math.cos(a + 0.15) * 1.45, math.sin(a + 0.15) * 1.45, 0.02), r=0.035, verts=4)
    for i in range(5):  # crystal growths around the rim
        a = i / 5 * math.tau
        crystal(p, "purple_glow", (math.cos(a) * 1.0, math.sin(a) * 1.0, 0.0), (0.6, a + math.pi / 2), 0.25 + (i % 2) * 0.15, 0.06)


# ------------------------------------------------------------------ Isdaris: 1930s-50s science fiction, Art Deco, light

def ring(m, major, minor, loc, rot=(0, 0, 0), seg=24, name="ring"):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=seg, minor_segments=6, location=loc, rotation=rot)
    return _finish(bpy.context.active_object, m, name)


def fins(p, m, n, radius, z, height, depth=0.04, width=0.25, tilt=0.0):
    """Art Deco fins radiating around an axis."""
    for i in range(n):
        a = i / n * math.tau
        box(m, (depth, width, height), (math.cos(a) * radius, math.sin(a) * radius, z), rot=(0, tilt, a))


def moissonneur(p):
    """Harvester robot: a hovering chrome disc with a glowing ring, two collector arms and an antigravity glow."""
    ball(p["ivory"], 0.22, (0, 0, 0.42), scale=(1.2, 1.2, 0.55), seg=16, rings=8)
    ring(p["cyan_glow"], 0.25, 0.025, (0, 0, 0.4))
    ball(p["chrome"], 0.11, (0, -0.05, 0.52), scale=(1, 1, 0.8), seg=12, rings=6)  # sensor dome
    cyl(p["cyan_glow"], 0.04, 0.02, (0, -0.15, 0.53), rot=(math.radians(90), 0, 0), verts=10)  # eye
    for s in (-1, 1):
        pipe(p["chrome"], (s * 0.2, -0.05, 0.38), (s * 0.28, -0.25, 0.22), r=0.025, verts=6)
        cone(p["gold"], 0.04, 0.12, (s * 0.28, -0.27, 0.18), rot=(math.radians(160), 0, 0), verts=6)
    box(p["team"], (0.06, 0.18, 0.04), (0, 0.18, 0.46))  # tail fin
    cyl(p["cyan_glow"], 0.12, 0.03, (0, 0, 0.18), verts=14)  # antigravity glow


def archer(p):
    """Slender warrior in ivory armour with gold trims, a crested helmet with a glowing visor, a long plasma rifle."""
    head = humanoid(p, p["ivory"], height=1.12, bulk=0.88, armor=p["gold"])
    soften(box(p["gold"], (0.28, 0.05, 0.03), (0, -0.09, 0.62)))  # collar trim
    for s in (-1, 1):
        box(p["team"], (0.04, 0.22, 0.2), (s * 0.2, 0.02, 0.72), rot=(0.3, 0, 0))  # shoulder fins
    ball(p["ivory"], 0.1, (0, 0, head + 0.03), scale=(0.9, 1.1, 1.15), seg=12, rings=6)  # helmet
    box(p["gold"], (0.02, 0.2, 0.12), (0, 0.02, head + 0.12))  # crest
    box(p["cyan_glow"], (0.14, 0.02, 0.03), (0, -0.095, head + 0.02))  # visor
    cyl(p["chrome"], 0.028, 0.7, (0.13, -0.32, 0.55), rot=(math.radians(90), 0, 0), verts=8)  # rifle
    for k in range(3):
        ring(p["cyan_glow"], 0.045, 0.012, (0.13, -0.42 - k * 0.09, 0.55), rot=(math.radians(90), 0, 0), seg=12)
    box(p["gold"], (0.05, 0.14, 0.08), (0.13, -0.06, 0.52))
    cone(p["team"], 0.14, 0.5, (0, 0.1, 0.42), rot=(math.radians(-8), 0, 0), verts=4)  # cape


def creature(p):
    """Vat-grown horror: a lump of muscle with a random number of blade-tipped arms, glowing veins."""
    ball(p["flesh"], 0.26, (0, 0, 0.3), scale=(1.1, 1.2, 0.85), seg=12, rings=8)
    ball(p["flesh"], 0.14, (0, -0.2, 0.34), scale=(1, 1, 0.8), seg=10, rings=6)
    for k in range(5):
        a = -0.6 + k * 0.3
        s = -1 if k % 2 else 1
        base = (s * 0.18, -0.05 + a * 0.2, 0.32)
        tip = (s * 0.42, -0.25 + a * 0.3, 0.12 + (k % 3) * 0.08)
        pipe(p["flesh"], base, tip, r=0.04, verts=5)
        cone(p["bone"], 0.03, 0.18, tip, rot=(math.radians(150), 0, s * 0.6), verts=4)
    for k in range(4):
        pipe(p["violet_glow"], (0.05 * k - 0.08, 0.1, 0.5), (0.1 * k - 0.15, -0.15, 0.4), r=0.012, verts=4)
    box(p["team"], (0.12, 0.06, 0.04), (0, 0.24, 0.45))  # implant tag


def druide(p):
    """Psychic master: a flared robe, a tall crested headpiece, gold bands and an orb of energy above the hand."""
    head = humanoid(p, p["ivory"], height=1.1, bulk=0.9, armor=p["gold"])
    cone(p["team"], 0.3, 0.55, (0, 0, 0.27), verts=10)  # flared robe
    for z in (0.12, 0.3):
        ring(p["gold"], 0.3 - z * 0.45, 0.015, (0, 0, z))
    cone(p["gold"], 0.09, 0.32, (0, 0.02, head + 0.18), verts=8)  # headpiece
    ring(p["cyan_glow"], 0.12, 0.012, (0, 0.02, head + 0.12), rot=(math.radians(90), 0, 0))  # halo
    ball(p["violet_glow"], 0.07, (0.24, -0.18, 0.75), seg=10, rings=6)  # energy orb
    ring(p["violet_glow"], 0.1, 0.01, (0.24, -0.18, 0.75), rot=(0.6, 0.3, 0))


def obelisque(p):
    """Command obelisk: stepped plinth, a tapering spire with light strips, a floating beam ring at the top."""
    for i, (sz, z) in enumerate(((4.8, 0.15), (4.0, 0.45), (3.0, 0.75))):
        box(p["ivory"] if i % 2 == 0 else p["chrome"], (sz, sz, 0.3), (0, 0, z))
        box(p["gold"], (sz + 0.04, sz + 0.04, 0.05), (0, 0, z + 0.15))
    cyl(p["ivory"], 0.95, 3.6, (0, 0, 2.7), verts=4, r2=0.35).rotation_euler = (0, 0, 0)
    for k in range(4):  # vertical light strips on each face
        a = k / 4 * math.tau + math.pi / 4
        box(p["cyan_glow"], (0.06, 0.08, 3.0), (math.cos(a) * 0.5, math.sin(a) * 0.5, 2.5), rot=(0, -0.16 * math.cos(a - math.pi / 4) * 0, a))
    fins(p, p["team"], 4, 1.2, 1.5, 1.2, width=0.6)
    ring(p["gold"], 0.6, 0.06, (0, 0, 4.7))
    ring(p["cyan_glow"], 0.45, 0.035, (0, 0, 5.05))
    ball(p["cyan_glow"], 0.16, (0, 0, 4.7), seg=12, rings=6)
    for x, y in ((-2.1, -2.1), (2.1, -2.1), (2.1, 2.1), (-2.1, 2.1)):  # corner lamps
        cyl(p["chrome"], 0.08, 0.6, (x, y, 0.6), verts=8)
        ball(p["cyan_glow"], 0.1, (x, y, 0.95), seg=8, rings=4)


def emetteur(p):
    """Emitter pylon: a slender gold-and-ivory mast with fins and a glowing halo that projects the power field."""
    cyl(p["ivory"], 0.7, 0.25, (0, 0, 0.12), verts=8)
    cyl(p["chrome"], 0.16, 1.9, (0, 0, 1.1), verts=8, r2=0.08)
    fins(p, p["gold"], 3, 0.18, 0.8, 1.1, width=0.4)
    fins(p, p["team"], 3, 0.32, 0.45, 0.5, width=0.35)
    ring(p["cyan_glow"], 0.45, 0.04, (0, 0, 2.0))
    ball(p["cyan_glow"], 0.12, (0, 0, 2.15), seg=10, rings=5)


def reservepsy(p):
    """Psy reserve, sober like the other Isdaris buildings: a low ivory drum with chrome bands, a flat pale shell
    over it, a thin cyan seam where the stored energy shows, and the team colour on two plain pylons."""
    cyl(p["ivory"], 0.92, 0.22, (0, 0, 0.11), verts=24)
    cyl(p["ivory"], 0.78, 0.42, (0, 0, 0.43), verts=24)
    ring(p["chrome"], 0.8, 0.03, (0, 0, 0.3), seg=24)
    ring(p["chrome"], 0.8, 0.03, (0, 0, 0.62), seg=24)
    cyl(p["cyan_glow"], 0.79, 0.04, (0, 0, 0.67), verts=24)  # energy seam
    ball(p["concrete"], 0.74, (0, 0, 0.68), scale=(1, 1, 0.32), seg=24, rings=8)  # flat shell
    for s in (-1, 1):
        box(p["ivory"], (0.16, 0.16, 0.8), (s * 0.85, 0, 0.4))
        box(p["team"], (0.17, 0.05, 0.5), (s * 0.85, -0.08, 0.45))


def portail(p):
    """Gate: a great gold arch on a stepped base, filled with a sheet of light where warriors arrive."""
    for sz, z in ((2.9, 0.12), (2.3, 0.35)):
        box(p["ivory"], (sz, sz, 0.24), (0, 0, z))
    ring(p["gold"], 1.05, 0.14, (0, 0, 1.4), rot=(math.radians(90), 0, 0), seg=28)
    ring(p["chrome"], 0.88, 0.05, (0, 0, 1.4), rot=(math.radians(90), 0, 0), seg=28)
    cyl(p["cyan_glow"], 0.85, 0.04, (0, 0, 1.4), rot=(math.radians(90), 0, 0), verts=24)  # energy sheet
    for s in (-1, 1):
        box(p["ivory"], (0.35, 0.5, 1.3), (s * 1.0, 0, 0.95))
        box(p["team"], (0.06, 0.52, 1.0), (s * 1.18, 0, 1.0))
        box(p["cyan_glow"], (0.06, 0.06, 0.9), (s * 0.82, -0.26, 0.95))
    cone(p["gold"], 0.12, 0.5, (0, 0, 2.7), verts=8)


def recepteur(p):
    """Receptor on an energy well: three curved chrome arms converging over the well, a beam of light rising."""
    cyl(p["ivory"], 1.4, 0.25, (0, 0, 0.12), verts=18)
    ring(p["gold"], 1.35, 0.05, (0, 0, 0.26))
    for k in range(3):
        a = k / 3 * math.tau
        pipe(p["chrome"], (math.cos(a) * 1.1, math.sin(a) * 1.1, 0.25), (math.cos(a) * 0.5, math.sin(a) * 0.5, 1.6), r=0.09, verts=8)
        box(p["team"], (0.05, 0.3, 0.5), (math.cos(a) * 0.95, math.sin(a) * 0.95, 0.65), rot=(0, 0.5, a))
    ring(p["chrome"], 0.5, 0.07, (0, 0, 1.6))
    cyl(p["violet_glow"], 0.18, 1.6, (0, 0, 1.0), verts=10)  # beam
    ball(p["violet_glow"], 0.25, (0, 0, 1.75), seg=12, rings=6)


# ------------------------------------------------------------------ doodads (scenery, render only)

def rock_mesh(p, seed, size, loc=(0, 0, 0), squash=0.7):
    """A lumpy boulder: a low-poly sphere with each vertex pushed in or out."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=size, location=loc)
    o = bpy.context.active_object
    for i, v in enumerate(o.data.vertices):
        k = 0.75 + 0.5 * (((i * 7919 + seed * 104729) % 1000) / 1000)
        v.co = v.co * k
        v.co.z *= squash
    return _finish(o, p["boulder"], "rock")


def rocks_a(p):
    rock_mesh(p, 1, 0.5, (0, 0, 0.15))
    rock_mesh(p, 2, 0.28, (0.45, 0.2, 0.05))


def rocks_b(p):
    rock_mesh(p, 3, 0.8, (0, 0, 0.25), squash=0.55)
    rock_mesh(p, 4, 0.35, (-0.6, -0.3, 0.05))
    rock_mesh(p, 5, 0.22, (0.5, -0.5, 0.0))


def pebbles(p):
    for i, (x, y) in enumerate(((0, 0), (0.3, 0.15), (-0.25, 0.2), (0.1, -0.3), (-0.3, -0.2))):
        rock_mesh(p, 10 + i, 0.09 + (i % 3) * 0.04, (x, y, 0.02))


def dead_tree(p):
    cyl(p["deadwood"], 0.09, 1.4, (0, 0, 0.7), verts=6, r2=0.05)
    for k, (rx, rz, h) in enumerate(((0.6, 0.3, 0.9), (-0.7, 1.9, 1.1), (0.5, 3.6, 0.7))):
        b = cyl(p["deadwood"], 0.04, 0.6, (0, 0, 0), verts=5, r2=0.015)
        b.rotation_euler = (rx, 0, rz)
        b.location = (math.sin(rz) * 0.2, -math.cos(rz) * 0.2, h + 0.15)


def dry_bush(p):
    for k in range(7):
        a = k / 7 * math.tau
        b = cyl(p["drygrass"], 0.03, 0.4, (0, 0, 0), verts=4, r2=0.005)
        b.rotation_euler = (0.6, 0, a)
        b.location = (math.sin(a) * 0.08, -math.cos(a) * 0.08, 0.15)


def tire_pile(p):
    for k, (x, y, z, rx) in enumerate(((0, 0, 0.1, 0), (0.15, 0.1, 0.25, 0.3), (-0.3, 0.25, 0.08, 1.4))):
        t = cyl(p["rubber"], 0.28, 0.14, (x, y, z), rot=(rx, 0, 0), verts=12)


def barrels(p):
    cyl(p["rust"], 0.17, 0.5, (0, 0, 0.25), verts=10)
    cyl(p["hazard"], 0.17, 0.5, (0.36, 0.05, 0.25), verts=10)
    cyl(p["rust"], 0.17, 0.5, (0.15, 0.32, 0.17), rot=(math.radians(90), 0, 0.4), verts=10)


def wreck(p):
    """A burnt-out car hulk."""
    box(p["rust"], (1.6, 0.8, 0.35), (0, 0, 0.3))
    box(p["rust"], (0.8, 0.72, 0.3), (-0.1, 0, 0.62))
    box(p["dark_glass"], (0.75, 0.74, 0.18), (-0.1, 0, 0.62))
    for x, y in ((-0.55, -0.42), (0.55, -0.42), (0.55, 0.42)):
        cyl(p["rubber"], 0.2, 0.12, (x, y, 0.18), rot=(math.radians(90), 0, 0), verts=10)
    box(p["scrap"], (0.3, 0.1, 0.05), (0.7, 0.45, 0.05), rot=(0, 0, 0.6))


def bones(p):
    ball(p["bone"], 0.16, (0, 0, 0.1), scale=(1.3, 1, 0.8), seg=8, rings=5)  # skull
    for k in range(4):
        cyl(p["bone"], 0.03, 0.5, (0.3, -0.2 + k * 0.13, 0.04), rot=(0, math.radians(90), 0.3 * k), verts=5)


def scrap_pile(p):
    box(p["scrap"], (0.7, 0.5, 0.25), (0, 0, 0.12), rot=(0.1, 0.05, 0.3))
    box(p["rust"], (0.5, 0.06, 0.4), (0.15, 0.1, 0.3), rot=(0.4, 0.3, 0.8))
    cyl(p["scrap"], 0.06, 0.8, (-0.2, 0.1, 0.25), rot=(0.2, 1.3, 0.4), verts=6)
    box(p["hazard"], (0.3, 0.3, 0.05), (-0.25, -0.2, 0.28), rot=(0.5, 0.2, 0.1))


DOODADS = {
    "rocks_a": rocks_a, "rocks_b": rocks_b, "pebbles": pebbles, "dead_tree": dead_tree, "dry_bush": dry_bush,
    "tire_pile": tire_pile, "barrels": barrels, "wreck": wreck, "bones": bones, "scrap_pile": scrap_pile,
}

def marche(p):
    """Market (notice: trade and the economy): a stone floor under a team-striped awning on timber posts,
    a stone counter with a brass balance, crates, sacks, amphorae and a small alchemical still."""
    box(p["stone_dark"], (2.8, 2.8, 0.16), (0, 0, 0.08))
    box(p["stone"], (2.5, 2.5, 0.06), (0, 0, 0.19))
    for x, y in ((-1.05, -1.05), (1.05, -1.05), (1.05, 1.05), (-1.05, 1.05), (0, -1.05), (0, 1.05)):
        cyl(p["wood"], 0.07, 1.5, (x, y, 0.95), verts=8)
    # Striped awning: alternating team and linen slats, sloping to the front.
    for i in range(7):
        x = -1.15 + i * 0.383
        box(p["team"] if i % 2 == 0 else p["linen"], (0.385, 2.5, 0.05), (x, 0, 1.75), rot=(math.radians(-9), 0, 0))
    box(p["wood"], (2.7, 0.08, 0.08), (0, -1.1, 1.62))
    box(p["wood"], (2.7, 0.08, 0.08), (0, 1.1, 1.85))
    # Stone counter with a brass balance.
    box(p["stone"], (1.4, 0.45, 0.6), (0, -0.55, 0.52))
    box(p["wood"], (1.5, 0.5, 0.05), (0, -0.55, 0.84))
    cyl(p["bronze"], 0.03, 0.4, (0, -0.55, 1.07), verts=8)
    box(p["bronze"], (0.5, 0.03, 0.03), (0, -0.55, 1.27))
    for x in (-0.24, 0.24):
        cyl(p["bronze"], 0.09, 0.03, (x, -0.55, 1.12), verts=12)
    # Goods: crates, sacks, amphorae.
    for x, y, s in ((-0.85, 0.6, 0.38), (-0.45, 0.75, 0.3), (-0.8, 0.2, 0.3)):
        box(p["wood"], (s, s, s), (x, y, 0.22 + s / 2))
    for x, y in ((0.5, 0.6), (0.75, 0.35), (0.85, 0.75)):
        ball(p["cloth"], 0.2, (x, y, 0.38), scale=(1, 1, 1.2))
    for x, y in ((0.3, 0.95), (0.95, -0.2)):
        ball(p["rust"], 0.14, (x, y, 0.42), scale=(1, 1, 1.6))
        cyl(p["rust"], 0.05, 0.16, (x, y, 0.72), verts=8)
    # A small still: a copper pot with a glowing flask.
    cyl(p["bronze"], 0.16, 0.3, (-0.7, -0.55, 0.37), verts=12)
    ball(p["green_glow"], 0.1, (-0.7, -0.55, 0.6))
    pipe(p["bronze"], (-0.7, -0.55, 0.65), (-0.95, -0.2, 0.9), r=0.025)
    lamp(p, (1.0, -1.1, 1.45))
    tag(p, (0.0, -0.785, 0.55), (0.5, 0.25))


def cuve(p):
    """Réservoir de substances (notice): a heavy copper vat of glowing reagents on a timber sledge, with
    pipes, valves and a little crane holding a bomb ready to throw; the front is -y."""
    box(p["wood"], (0.9, 1.3, 0.12), (0, 0, 0.16))
    for x in (-0.38, 0.38):
        box(p["wood"], (0.1, 1.45, 0.1), (x, 0, 0.07))  # runners
    for x, y in ((-0.48, -0.42), (0.48, -0.42), (-0.48, 0.42), (0.48, 0.42)):
        cyl(p["rust"], 0.17, 0.08, (x, y, 0.17), rot=(0, math.radians(90), 0), verts=12)  # wheels
    cyl(p["bronze"], 0.4, 0.62, (0, 0.08, 0.55), verts=16)
    cyl(p["scrap"], 0.42, 0.05, (0, 0.08, 0.36), verts=16)
    cyl(p["scrap"], 0.42, 0.05, (0, 0.08, 0.76), verts=16)
    cyl(p["team"], 0.41, 0.1, (0, 0.08, 0.6), verts=16)
    ball(p["green_glow"], 0.34, (0, 0.08, 0.86), scale=(1, 1, 0.35))
    cone(p["bronze"], 0.12, 0.25, (0, 0.08, 1.02), verts=10)
    pipe(p["bronze"], (0.3, 0.3, 0.8), (0.3, 0.55, 0.3), r=0.035)
    pipe(p["bronze"], (-0.3, -0.15, 0.75), (-0.3, -0.5, 0.95), r=0.03)
    ball(p["green_glow"], 0.07, (-0.3, -0.52, 0.98))
    cyl(p["red_glow"], 0.05, 0.03, (0.41, -0.05, 0.6), rot=(0, math.radians(90), 0), verts=10)  # valve
    pipe(p["wood"], (0.25, -0.35, 0.22), (0.25, -0.55, 0.85), r=0.035)  # crane arm
    ball(p["orange_glow"], 0.08, (0.25, -0.58, 0.8))


def scarabee(p):
    """Scarabée (notice): a slow amphibious armoured wagon shaped like a beetle, firing slits along its sides,
    six stubby wheels and a hatch on top; the front is -y."""
    for x in (-0.5, 0.5):
        for y in (-0.45, 0.0, 0.45):
            cyl(p["rubber"], 0.2, 0.14, (x, y, 0.2), rot=(0, math.radians(90), 0), verts=12)
    box(p["rust"], (0.95, 1.4, 0.3), (0, 0, 0.42))
    ball(p["scrap"], 0.62, (0, 0.05, 0.6), scale=(0.85, 1.25, 0.6), seg=12, rings=8)
    box(p["team"], (0.08, 1.3, 0.12), (0, 0.05, 0.98))  # ridge stripe
    ball(p["rust"], 0.3, (0, -0.72, 0.5), scale=(1.1, 0.8, 0.7))  # head
    for x in (-0.12, 0.12):
        ball(p["orange_glow"], 0.05, (x, -0.95, 0.55))  # lamps
    for y in (-0.3, 0.1, 0.45):
        for x in (-0.53, 0.53):
            box(p["dark"], (0.04, 0.2, 0.05), (x, y, 0.7))  # firing slits
    cyl(p["scrap"], 0.16, 0.08, (0, 0.25, 1.0), verts=12)  # hatch
    pipe(p["scrap"], (0.3, 0.6, 0.7), (0.35, 0.8, 1.0), r=0.04)  # exhaust


MODELS = {
    "scarabee": scarabee,
    "cuve": cuve,
    "marche": marche,
    "serf": serf, "auxiliaire": auxiliaire, "legionnaire": legionnaire, "soigneur": soigneur,
    "conseil": conseil, "grenier": grenier, "caserne": caserne, "mine": mine, "minerai": minerai, "puits": puits,
    "minerai_1": minerai_1, "minerai_2": minerai_2, "minerai_3": minerai_3,
    "moissonneur": moissonneur, "archer": archer, "creature": creature, "druide": druide,
    "obelisque": obelisque, "emetteur": emetteur, "reservepsy": reservepsy, "portail": portail, "recepteur": recepteur,
}


# ------------------------------------------------------------------ export

def paint(o):
    """Hand-painted look baked into vertex colours: dark feet, lit tops, light edge wear, uneven strokes."""
    me = o.data
    if "Col" in me.color_attributes:
        me.color_attributes.remove(me.color_attributes["Col"])
    col = me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
    zs = [v.co.z for v in me.vertices]
    z0, z1 = min(zs), max(zs)
    span = max(z1 - z0, 1e-3)
    for poly in me.polygons:
        n = poly.normal
        verts = [me.vertices[i].co for i in poly.vertices]
        edges = [(verts[i] - verts[(i + 1) % len(verts)]).length for i in range(len(verts))]
        axes = sorted((abs(n.x), abs(n.y), abs(n.z)))
        # Thin slanted faces are the bevels: paint them as worn, light-catching edges.
        bevel = min(edges) < 0.06 and axes[2] < 0.97 and axes[1] > 0.2
        rnd = ((poly.index * 7919) % 1000) / 1000
        stroke = 0.94 + rnd * 0.12
        warm = (rnd - 0.5) * 0.06
        for li in poly.loop_indices:
            z = me.vertices[me.loops[li].vertex_index].co.z
            h = (z - z0) / span
            shade = (0.72 + 0.34 * h) * stroke
            if n.z > 0.7:
                shade += 0.1
            if bevel:
                shade += 0.28
            col.data[li].color = (min(1, shade * (1 + warm)), min(1, shade), min(1, shade * (1 - warm)), 1)
    me.color_attributes.active_color = col


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    paint(o)  # parts keep their own flat or smooth shading
    return o


def build(name, fn):
    """Joins the model into a body plus its animated parts; returns all of them."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    JOINTS.clear()
    fn(palette())
    parts = []
    for part, pivot in JOINTS.items():
        pieces = [o for o in bpy.context.scene.objects if o.type == "MESH" and o not in parts and o.name.split(".")[0] == part]
        if not pieces:
            continue
        o = join(pieces, part)
        bpy.context.scene.cursor.location = pivot
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
        parts.append(o)
    # Graffiti quads stay separate objects, so the game can paint a different tag on each.
    tags = [o for o in bpy.context.scene.objects if o.type == "MESH" and o.name.split(".")[0] == "tag"]
    for i, t in enumerate(tags):
        t.name = f"tag_{i}"
    rest = [o for o in bpy.context.scene.objects if o.type == "MESH" and o not in parts and o not in tags]
    body = join(rest, name)
    return [body, *parts, *tags]


def export(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True, export_vertex_color="ACTIVE")


def icon(objs, path):
    """Renders a transparent 128px icon from the game's camera angle."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 128
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    corners = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    centre = sum(corners, Vector()) / len(corners)
    radius = max((c - centre).length for c in corners)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = radius * 1.65
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    direction = Vector((math.sin(math.radians(45)) * math.cos(math.radians(35)), -math.cos(math.radians(45)) * math.cos(math.radians(35)), math.sin(math.radians(35))))
    # Look at the model's front-right, like the in-game camera sees a unit walking towards it.
    direction = Vector((direction.x, -abs(direction.y), direction.z))
    cam.location = centre + direction * (radius * 4)
    cam.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 6
    sun.rotation_euler = (math.radians(40), math.radians(-20), math.radians(30))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.3
    scene.world = world
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def export_doodads(path):
    """All scenery pieces in one file, one named mesh each, laid side by side."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    p = palette()
    for i, (name, fn) in enumerate(DOODADS.items()):
        before = set(bpy.context.scene.objects)
        fn(p)
        parts = [o for o in bpy.context.scene.objects if o not in before]
        bpy.ops.object.select_all(action="DESELECT")
        for o in parts:
            o.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        bpy.ops.object.join()
        o = bpy.context.active_object
        o.name = name
        o.data.name = name
        bpy.ops.object.shade_flat()
        paint(o)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True, export_vertex_color="ACTIVE")
    print(f"DOODADS {len(DOODADS)}")


os.makedirs(OUT, exist_ok=True)
os.makedirs(ICONS, exist_ok=True)
for name, fn in MODELS.items():
    if ONLY and name not in ONLY:
        continue
    objs = build(name, fn)
    export(objs, os.path.join(OUT, f"{name}.glb"))
    icon(objs, os.path.join(ICONS, f"{name}.png"))
    print(f"MODEL {name}: {sum(len(o.data.polygons) for o in objs)} faces, parts {[o.name for o in objs[1:]]}")
if not ONLY or "doodads" in ONLY:
    export_doodads(os.path.join(OUT, "doodads.glb"))
