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


# ------------------------------------------------------------------ Humans: low tech, scavenged, Mad Max meets Terrans

def humanoid(p, outfit, height=1.0, bulk=1.0):
    """Boots, legs, torso, arms and head. Returns the head height."""
    h = height
    # Legs and arms are separate parts, pivoting at hip and shoulder, so the game can animate them.
    for side, x in (("l", -0.07), ("r", 0.07)):
        box(p["rubber"], (0.1 * bulk, 0.13, 0.08), (x * bulk, -0.02, 0.04), name=f"leg_{side}")  # boot
        box(outfit, (0.09 * bulk, 0.1, 0.24 * h), (x * bulk, 0, 0.19 * h), name=f"leg_{side}")
        JOINTS[f"leg_{side}"] = (x * bulk, 0, 0.31 * h)
    box(outfit, (0.26 * bulk, 0.17 * bulk, 0.3 * h), (0, 0, 0.45 * h))
    box(p["leather"], (0.27 * bulk, 0.18 * bulk, 0.045), (0, 0, 0.32 * h))
    for side, x in (("l", -0.175), ("r", 0.175)):
        box(outfit, (0.07 * bulk, 0.08, 0.27 * h), (x * bulk, -0.03, 0.46 * h), rot=(0.35, 0, 0), name=f"arm_{side}")
        JOINTS[f"arm_{side}"] = (x * bulk, 0, 0.58 * h)
    ball(p["skin"], 0.085, (0, 0, 0.7 * h))
    return 0.7 * h


def goggles(p, z, glass="glass"):
    box(p["rubber"], (0.18, 0.04, 0.035), (0, -0.07, z))
    for x in (-0.04, 0.04):
        cyl(p[glass], 0.028, 0.03, (x, -0.09, z), rot=(math.radians(90), 0, 0), verts=8)


def serf(p):
    """Scavenger: khaki overalls, goggles, scrap backpack, big wrench."""
    head = humanoid(p, p["khaki"])
    goggles(p, head + 0.02)
    box(p["team"], (0.19, 0.18, 0.04), (0, 0, head + 0.06))  # bandana
    box(p["scrap"], (0.2, 0.12, 0.22), (0, 0.13, 0.5))  # scrap pack
    cyl(p["rust"], 0.06, 0.2, (0.07, 0.2, 0.62), verts=8)  # tin can
    box(p["hazard"], (0.21, 0.02, 0.04), (0, 0.195, 0.45))
    cyl(p["steel"], 0.02, 0.42, (0.2, -0.14, 0.42), rot=(math.radians(-30), 0, 0), verts=6)  # wrench
    box(p["steel"], (0.08, 0.03, 0.06), (0.2, -0.25, 0.6))


def auxiliaire(p):
    """Rifleman: mismatched plates, gas mask, pipe rifle with a chemical tank."""
    head = humanoid(p, p["khaki"])
    box(p["team"], (0.25, 0.05, 0.2), (0, -0.09, 0.5))  # painted chest plate
    box(p["rust"], (0.1, 0.12, 0.06), (0.18, 0, 0.6))  # odd shoulder plate
    ball(p["scrap"], 0.1, (0, 0.01, head + 0.03), scale=(1, 1, 0.75), seg=8, rings=5)  # helmet
    box(p["rubber"], (0.12, 0.06, 0.09), (0, -0.08, head - 0.02))  # gas mask
    cyl(p["scrap"], 0.03, 0.06, (0, -0.13, head - 0.05), rot=(math.radians(90), 0, 0), verts=8)  # filter
    cyl(p["scrap"], 0.03, 0.58, (0.12, -0.3, 0.5), rot=(math.radians(90), 0, 0), verts=6)  # pipe barrel
    box(p["wood"], (0.05, 0.16, 0.08), (0.12, -0.02, 0.46))  # stock
    cyl(p["green_glow"], 0.045, 0.14, (0.17, -0.18, 0.5), rot=(math.radians(90), 0, 0), verts=8)  # chem tank


def legionnaire(p):
    """Brute in welded scrap armour, spiked pauldrons, buzz saw and smoking exhausts."""
    head = humanoid(p, p["rubber"], height=1.08, bulk=1.25)
    box(p["scrap"], (0.34, 0.08, 0.26), (0, -0.12, 0.52))
    box(p["hazard"], (0.34, 0.085, 0.04), (0, -0.12, 0.4))
    for x in (-0.24, 0.24):
        box(p["team"], (0.16, 0.2, 0.08), (x, 0, 0.66), rot=(0, x * 1.2, 0))  # pauldrons
        cone(p["steel"], 0.035, 0.12, (x * 1.1, 0, 0.75), verts=5)  # spikes
    box(p["rust"], (0.16, 0.16, 0.14), (0, 0, head + 0.02))  # bucket helmet
    box(p["dark_glass"], (0.12, 0.02, 0.03), (0, -0.081, head + 0.03))  # visor slit
    for x in (-0.07, 0.07):
        cyl(p["scrap"], 0.03, 0.28, (x, 0.14, 0.65), verts=6)  # exhausts
        cyl(p["orange_glow"], 0.032, 0.04, (x, 0.14, 0.8), verts=6)
    cyl(p["steel"], 0.21, 0.025, (0.27, -0.3, 0.45), rot=(0, math.radians(90), 0), verts=14)  # buzz saw
    cyl(p["hazard"], 0.06, 0.05, (0.27, -0.3, 0.45), rot=(0, math.radians(90), 0), verts=8)
    box(p["scrap"], (0.06, 0.22, 0.06), (0.27, -0.14, 0.45))


def soigneur(p):
    """Field medic: dirty coat, goggles, team armband, back tank and injector crossbow."""
    head = humanoid(p, p["coat"])
    goggles(p, head + 0.02, glass="cyan_glow")
    box(p["team"], (0.08, 0.09, 0.07), (-0.19, -0.03, 0.55))  # armband
    cyl(p["scrap"], 0.07, 0.3, (0, 0.14, 0.5), verts=8)  # back tank
    cyl(p["cyan_glow"], 0.02, 0.32, (0.08, 0.13, 0.5), verts=6)
    box(p["wood"], (0.05, 0.34, 0.05), (0.13, -0.24, 0.5))  # crossbow stock
    box(p["scrap"], (0.32, 0.04, 0.03), (0.13, -0.37, 0.5))
    cyl(p["cyan_glow"], 0.025, 0.1, (0.13, -0.42, 0.53), rot=(math.radians(90), 0, 0), verts=6)  # injector bolt


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


def conseil(p):
    """Command post: stacked shipping containers, a watchtower, antenna mast and tyre walls."""
    box(p["concrete"], (4.9, 4.9, 0.2), (0, 0, 0.1))
    container(p, (3.2, 1.3, 1.1), (-0.4, 0.6, 0.75), p["team"])
    container(p, (3.0, 1.3, 1.1), (0.2, -0.75, 0.75), p["rust"])
    container(p, (2.4, 1.3, 1.0), (-0.1, 0.0, 1.85), p["scrap"])
    box(p["hazard"], (0.9, 0.06, 0.6), (0.2, -1.42, 0.6))  # door panel
    box(p["dark_glass"], (0.7, 0.04, 0.25), (-0.1, -0.66, 2.0))  # window
    # Watchtower on stilts.
    for x, y in ((1.35, 1.0), (2.05, 1.0), (1.35, 1.7), (2.05, 1.7)):
        cyl(p["scrap"], 0.05, 2.6, (x, y, 1.3), verts=6)
    box(p["team"], (1.0, 1.0, 0.55), (1.7, 1.35, 2.75))
    corrugated(p["rust"], (1.2, 1.2, 0.06), (1.7, 1.35, 3.1))
    # Antenna and dish.
    cyl(p["steel"], 0.03, 2.2, (-1.5, 1.4, 2.9), verts=6)
    cone(p["scrap"], 0.35, 0.2, (-1.5, 1.4, 4.0), rot=(math.radians(-60), 0, 0), verts=10)
    cyl(p["orange_glow"], 0.05, 0.05, (-1.5, 1.4, 4.02), verts=6)
    # Tyre stacks and barrels.
    for x, y in ((-2.0, -1.9), (-1.4, -2.0), (2.0, -1.9)):
        for k in range(3):
            cyl(p["rubber"], 0.25, 0.12, (x, y, 0.27 + k * 0.13), verts=10)
    for x in (1.0, 1.35):
        cyl(p["hazard"], 0.16, 0.45, (x, -2.0, 0.42), verts=10)
    cyl(p["orange_glow"], 0.14, 0.05, (-1.4, -2.0, 0.67), verts=8)  # fire in the tyres


def grenier(p):
    """Supply depot: a tower of welded drums with a team-painted tank on top."""
    box(p["concrete"], (1.9, 1.9, 0.15), (0, 0, 0.075))
    for x, y in ((-0.45, -0.45), (0.45, -0.45), (0.45, 0.45), (-0.45, 0.45)):
        cyl(p["rust"], 0.3, 0.75, (x, y, 0.52), verts=10)
        cyl(p["scrap"], 0.31, 0.05, (x, y, 0.7), verts=10)
    cyl(p["team"], 0.75, 0.7, (0, 0, 1.25), verts=12)
    cyl(p["hazard"], 0.76, 0.08, (0, 0, 1.0), verts=12)
    cone(p["scrap"], 0.8, 0.3, (0, 0, 1.75), verts=12)
    cyl(p["steel"], 0.04, 0.6, (0.5, -0.5, 2.0), verts=6)


def caserne(p):
    """Barracks: a bunker of scrap walls behind sandbags, with a corrugated roof and spikes."""
    box(p["concrete"], (2.9, 2.9, 0.15), (0, 0, 0.075))
    box(p["scrap"], (2.4, 2.4, 1.1), (0, 0, 0.7))
    corrugated(p["team"], (2.6, 2.6, 0.08), (0, 0, 1.3))
    box(p["dark"], (0.9, 0.1, 0.8), (0, -1.22, 0.55))  # gate
    box(p["hazard"], (1.0, 0.12, 0.1), (0, -1.23, 1.0))
    for i in range(11):  # sandbag ring
        a = i / 11 * math.tau
        x, y = math.cos(a) * 1.35, math.sin(a) * 1.35
        if y < -1.0 and abs(x) < 0.6:
            continue  # keep the gate clear
        ball(p["khaki"], 0.24, (x, y, 0.25), scale=(1.2, 0.7, 0.45), seg=8, rings=4)
    for x, y in ((-1.2, -1.2), (1.2, -1.2), (1.2, 1.2), (-1.2, 1.2)):
        cone(p["steel"], 0.06, 0.45, (x, y, 1.55), verts=5)  # spikes
    cyl(p["steel"], 0.03, 1.2, (0.9, 0.9, 1.9), verts=6)
    box(p["team"], (0.5, 0.03, 0.32), (1.15, 0.9, 2.3))  # flag


def mine(p):
    """Energy rig: a lattice derrick over the well, a pumpjack and glowing pipes."""
    cyl(p["concrete"], 1.45, 0.3, (0, 0, 0.15), verts=16)
    legs = ((-0.6, -0.6), (0.6, -0.6), (0.6, 0.6), (-0.6, 0.6))
    for x, y in legs:  # leaning derrick legs
        cyl(p["scrap"], 0.05, 2.8, (x * 0.7, y * 0.7, 1.6), rot=(y * 0.25, -x * 0.25, 0), verts=6)
    for z in (1.0, 1.8, 2.5):
        s = 1.2 - z * 0.3
        box(p["rust"], (s, 0.06, 0.06), (0, -s / 2, z))
        box(p["rust"], (s, 0.06, 0.06), (0, s / 2, z))
    box(p["team"], (0.6, 0.6, 0.25), (0, 0, 3.05))
    # Pumpjack.
    box(p["scrap"], (0.25, 0.25, 0.7), (0.9, -0.6, 0.65))
    box(p["hazard"], (1.2, 0.12, 0.12), (0.75, -0.6, 1.05), rot=(0, math.radians(15), 0))
    box(p["rust"], (0.5, 0.5, 0.45), (-0.9, 0.7, 0.52))  # generator
    cyl(p["purple_glow"], 0.12, 1.5, (0.3, 0.95, 0.4), rot=(0, math.radians(90), 0), verts=8)
    cyl(p["purple_glow"], 0.1, 1.2, (-0.95, -0.2, 0.4), rot=(math.radians(90), 0, 0), verts=8)


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

MODELS = {
    "serf": serf, "auxiliaire": auxiliaire, "legionnaire": legionnaire, "soigneur": soigneur,
    "conseil": conseil, "grenier": grenier, "caserne": caserne, "mine": mine, "minerai": minerai, "puits": puits,
}


# ------------------------------------------------------------------ export

def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    bpy.ops.object.shade_flat()
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
    rest = [o for o in bpy.context.scene.objects if o.type == "MESH" and o not in parts]
    body = join(rest, name)
    return [body, *parts]


def export(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True)


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
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True)
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
