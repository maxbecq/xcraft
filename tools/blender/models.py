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


def _noise(rng, size, cells, stretch=(1, 1)):
    """Tileable value noise: a random grid of `cells` (times stretch per axis), bilinear, wrapping."""
    import numpy as np
    gy, gx = cells * stretch[1], cells * stretch[0]
    grid = rng.random((gy, gx))
    y = np.arange(size) * gy / size
    x = np.arange(size) * gx / size
    y0, x0 = np.floor(y).astype(int), np.floor(x).astype(int)
    fy, fx = (y - y0)[:, None], (x - x0)[None, :]
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    y1, x1 = (y0 + 1) % gy, (x0 + 1) % gx
    a = grid[y0][:, x0] * (1 - fx) + grid[y0][:, x1] * fx
    b = grid[y1][:, x0] * (1 - fx) + grid[y1][:, x1] * fx
    return a * (1 - fy) + b * fy


def _fbm(rng, size, base, octaves=4, stretch=(1, 1)):
    total, amp, norm = 0, 1.0, 0
    for o in range(octaves):
        total = total + _noise(rng, size, base * 2 ** o, stretch) * amp
        norm += amp
        amp *= 0.5
    return total / norm


def metal_texture(name, rusty):
    """A tileable 512px plate texture, mostly neutral so the material's colour shows through: brushed metal
    in riveted panels with scratches, grime and rust stains (`rusty`: a rusted plate, pitted and flaking, with
    a little bare metal left)."""
    if name in bpy.data.images:
        return bpy.data.images[name]
    import numpy as np
    S = 512
    rng = np.random.default_rng(7 if rusty else 3)
    brushed = _noise(rng, S, 4, (32, 1)) * 0.5 + _noise(rng, S, 8, (16, 1)) * 0.5
    fine = _fbm(rng, S, 32, 3)
    blotch = _fbm(rng, S, 4, 5)
    grime = _fbm(rng, S, 3, 4)
    lum = 0.84 + 0.1 * (brushed - 0.5) + 0.08 * (fine - 0.5)
    rgb = np.stack([lum, lum, lum], -1)
    # Panel seams every quarter of the tile, rivets along them.
    yy, xx = np.mgrid[0:S, 0:S]
    seam = (np.minimum(yy % 128, 128 - yy % 128) < 2) | (np.minimum(xx % 128, 128 - xx % 128) < 2)
    rivet = np.zeros((S, S), bool)
    for c in (10, 118):
        for k in range(8, 128, 24):
            for (ry, rx) in ((c, k), (k, c)):
                d = (yy % 128 - ry) ** 2 + (xx % 128 - rx) ** 2
                rivet |= d < 9
    rgb[seam] *= 0.45
    rgb[rivet] = rgb[rivet] * 0.6 + 0.35
    # Scratches: short bright strokes.
    for _ in range(140):
        x0, y0 = rng.integers(0, S, 2)
        ang = rng.random() * np.pi
        length = rng.integers(8, 40)
        t = np.arange(length)
        px = (x0 + np.cos(ang) * t).astype(int) % S
        py = (y0 + np.sin(ang) * t).astype(int) % S
        rgb[py, px] = np.minimum(1, rgb[py, px] + 0.18)
    # Rust: stains with darker rims, pitting inside.
    level = 0.42 if rusty else 0.72
    m = np.clip((blotch + 0.25 * fine - level) / 0.1, 0, 1)[..., None]
    rim = np.clip(1 - np.abs(blotch + 0.25 * fine - level - 0.03) / 0.03, 0, 1)[..., None]
    if rusty:
        # On the rust material, stay near neutral: pitting and flakes, bare metal where the rust is gone.
        pits = (fine < 0.32)[..., None]
        rust = np.ones(3) * (0.8 + 0.25 * (fine[..., None] - 0.5))
        rgb = rgb * (1 - m) * np.array([1.25, 1.55, 1.8]) * 0.62 + rust * m
        rgb = np.where(pits & (m > 0.5), rgb * 0.6, rgb)
    else:
        rust = np.array([0.95, 0.52, 0.28]) * (0.75 + 0.5 * fine[..., None])
        rgb = rgb * (1 - m) + rust * m
        rgb = rgb * (1 - 0.35 * rim)
    rgb = rgb * (0.82 + 0.18 * grime[..., None])
    rgb = np.clip(rgb, 0, 1)
    img = bpy.data.images.new(name, S, S)
    # A byte image stores its sRGB values as they are.
    img.colorspace_settings.name = "sRGB"
    img.pixels.foreach_set(np.concatenate([rgb, np.ones((S, S, 1))], -1).astype(np.float32).ravel())
    img.pack()
    return img


def textured(name, color, image, metallic, rough):
    """A material whose base colour is an image texture times `color` (the vertex colours still multiply in
    game, exported alongside)."""
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    b = nodes["Principled BSDF"]
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    m.node_tree.links.new(tex.outputs["Color"], mix.inputs[6])
    mix.inputs[7].default_value = (*linear(color), 1)
    m.node_tree.links.new(mix.outputs[2], b.inputs["Base Color"])
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    MATS[name] = m
    return m


def box_uv(o, scale=1.2):
    """World-scale box projection: each face takes the two coordinates across its main axis, one repeat of
    the texture every `scale` units, so plates keep the same grain on a building and on a bolt."""
    me = o.data
    uv = me.uv_layers.active or me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        n = poly.normal
        axis = max(range(3), key=lambda i: abs(n[i]))
        a, b = [i for i in range(3) if i != axis]
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = (co[a] / scale, co[b] / scale)


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
        "grimy_glow": mat("grimy_glow", 0x5A4A36, emission=0x3A2610),  # light through filthy glass
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
        "carbon": mat("carbon", 0x22262C, metallic=0.5, rough=0.3),
        "graphite": mat("graphite", 0x4A505A, metallic=0.8, rough=0.35),
        "pink_glow": mat("pink_glow", 0xFF5AC8, emission=0xFF20A0),
        # Z: a light steel base, so the rust stains painted in paint() read as orange-brown.
        "zsteel": textured("zsteel", 0x8E8A80, metal_texture("zsteel_tex", False), metallic=0.7, rough=0.55),
        "zrust": textured("zrust", 0x9A5430, metal_texture("zrust_tex", True), metallic=0.25, rough=0.95),
        "zcopper": mat("zcopper", 0xC07038, metallic=0.9, rough=0.35),
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
def crystal(p, mat, base, tilt, length, radius, tip_mat=None):
    """A hexagonal crystal tapering to a faceted point, growing from `base` along `tilt` (x, z rotation in radians);
    the point can be of a paler crystal, as light gathers there."""
    body = cyl(p[mat], radius, length, (0, 0, length / 2), verts=6, r2=radius * 0.78)
    tip = cone(p[tip_mat or mat], radius * 0.78, radius * 2.4, (0, 0, length + radius * 1.2), verts=6)
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
            mat = ("crystal", "crystal_deep", "crystal_deep")[int(r(k + 130) * 3) % 3]
            base = (cx + math.cos(ang) * spread * r(k + 7), cy + math.sin(ang) * spread * r(k + 11), cz - 0.08)
            crystal(p, mat, base, (lean * (0.4 + r(k + 3)), ang + math.pi / 2), length, rad, tip_mat="crystal_pale")
            # A few small crystals huddle at the foot of each big one.
            if j < 3:
                for q in range(2):
                    a2 = ang + (q - 0.5) * 1.1
                    crystal(p, "crystal_pale", (base[0] + math.cos(a2) * rad * 1.6, base[1] + math.sin(a2) * rad * 1.6, base[2]), (lean + 0.5, a2 + math.pi / 2), length * 0.35, rad * 0.45)
    # Rubble and grit round the outcrop.
    for j in range(9):
        k += 1
        ang = r(k) * math.tau
        d = 0.35 + r(k + 17) * 0.45
        o = rock_mesh(p, seed * 31 + j, 1.0, (0, 0, 0), squash=0.6)
        sz = 0.05 + r(k + 23) * 0.08
        o.scale = (sz, sz * 0.8, sz * 0.6)
        o.location = (math.cos(ang) * d, math.sin(ang) * d, 0.0)
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
        o = boulder(p, 60 + i, 1.0, (0, 0, 0), squash=1.0)
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
    # Two levels of dotted light, separate parts so the game turns them (in opposite directions).
    for k, z in enumerate((0.3, 0.62)):
        part = f"psyband_{k}"
        JOINTS[part] = (0, 0, z)
        ring(p["chrome"], 0.8, 0.03, (0, 0, z), seg=24, name=part)
        for i in range(12):
            a = (i + 0.5 * k) / 12 * math.tau
            box(p["cyan_glow"], (0.022, 0.13, 0.04), (math.cos(a) * 0.83, math.sin(a) * 0.83, z), rot=(0, 0, a), name=part)
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


def boulder(p, seed, size, loc=(0, 0, 0), squash=0.8):
    """A weathered boulder: a finer sphere warped by a few smooth waves and a little grit, then rounded and
    shaded smooth, so it reads as worn stone rather than a cut gem."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=size, location=loc)
    o = bpy.context.active_object
    s1, s2, s3 = seed * 1.7, seed * 2.3, seed * 3.1
    for i, v in enumerate(o.data.vertices):
        c = v.co / max(size, 1e-3)
        k = 1 + 0.24 * math.sin(3.1 * c.x + s1) + 0.18 * math.sin(4.7 * c.y + s2) + 0.14 * math.sin(6.3 * c.z + s3) + 0.06 * math.sin(11 * (c.x + c.z) + s1)
        k += 0.05 * ((((i * 7919 + seed * 104729) % 1000) / 1000) - 0.5)
        v.co = v.co * k
        v.co.z *= squash
        if v.co.z < -size * 0.25:
            v.co.z = -size * 0.25  # flat underside, sitting in the ground
    soften(o, 1)
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


# ---- Street clutter of the dead megacity (city biome).

def crates(p):
    """Two stacked cargo crates and a third knocked over, hazard-striped."""
    box(p["scrap"], (0.6, 0.45, 0.4), (0, 0, 0.2))
    box(p["hazard"], (0.62, 0.05, 0.08), (0, -0.23, 0.3))
    box(p["rust"], (0.45, 0.4, 0.32), (0.04, 0.02, 0.56), rot=(0, 0, 0.2))
    box(p["scrap"], (0.4, 0.35, 0.35), (-0.45, 0.35, 0.15), rot=(0.25, 0.1, 0.9))
    for x in (-0.31, 0.31):
        box(p["dark"], (0.03, 0.47, 0.42), (x, 0, 0.2))  # ribs


def barrier(p):
    """Concrete road barriers, one cracked and tipped over, with a faded hazard band."""
    for k, (x, rz, rx) in enumerate(((-0.35, 0.05, 0), (0.4, 0.4, 1.35))):
        z = 0.2 if rx == 0 else 0.13
        box(p["concrete"], (0.7, 0.2, 0.22), (x, 0, z), rot=(rx, 0, rz))
        box(p["concrete"], (0.7, 0.12, 0.2), (x, 0, z + 0.18 if rx == 0 else z), rot=(rx, 0, rz))
        if k == 0:
            box(p["hazard"], (0.71, 0.13, 0.05), (x, 0, 0.32), rot=(rx, 0, rz))
    box(p["concrete"], (0.18, 0.15, 0.1), (0.05, 0.3, 0.05), rot=(0.3, 0.4, 0.7))  # chunk


def vending(p):
    """A dead street kiosk: a tall box with a cracked, still-glowing alien screen and a slot."""
    box(p["scrap"], (0.45, 0.35, 0.95), (0, 0, 0.48))
    box(p["dark"], (0.5, 0.4, 0.06), (0, 0, 0.98))
    box(p["cyan_glow"], (0.34, 0.02, 0.45), (0, -0.18, 0.62))
    box(p["dark_glass"], (0.12, 0.03, 0.2), (0.08, -0.18, 0.55), rot=(0, 0.3, 0.6))  # crack
    box(p["red_glow"], (0.06, 0.02, 0.03), (-0.12, -0.18, 0.3))
    box(p["dark"], (0.25, 0.04, 0.06), (0.05, -0.18, 0.2))  # slot
    cyl(p["rubber"], 0.03, 0.6, (0.3, 0.1, 0.05), rot=(0, math.radians(90), 0.4), verts=5)  # loose cable


def trash(p):
    """A tipped bin and a heap of black bags."""
    cyl(p["scrap"], 0.16, 0.42, (0.25, 0.15, 0.16), rot=(math.radians(80), 0, 0.5), verts=10)
    for x, y, s in ((-0.1, 0, 0.18), (-0.3, 0.12, 0.15), (-0.15, -0.2, 0.14), (0.05, -0.15, 0.12)):
        ball(p["rubber"], s, (x, y, s * 0.8), scale=(1.1, 1, 0.85), seg=8, rings=5)
    box(p["hazard"], (0.12, 0.08, 0.02), (0.15, -0.3, 0.01), rot=(0, 0, 0.7))


def vent(p):
    """A rooftop-style air vent on the deck: a housing, a grille, a fan and pipes into the plates."""
    box(p["scrap"], (0.6, 0.6, 0.3), (0, 0, 0.15))
    cyl(p["dark"], 0.24, 0.04, (0, 0, 0.31), verts=14)
    for k in range(4):
        box(p["steel"], (0.42, 0.04, 0.02), (0, 0, 0.34), rot=(0, 0, k * math.pi / 4))  # fan blades
    for y in (-0.22, -0.11, 0.0, 0.11, 0.22):
        box(p["steel"], (0.02, 0.5, 0.02), (0.31, y * 0, 0.15 + y * 0.4), rot=(0, 0, math.radians(90)))
    pipe(p["rust"], (-0.3, 0.2, 0.2), (-0.55, 0.2, 0.02), r=0.05)
    pipe(p["rust"], (-0.3, -0.15, 0.12), (-0.5, -0.35, 0.02), r=0.04)


def terminal(p):
    """A broken public terminal on a post, its holo screen flickering magenta."""
    cyl(p["scrap"], 0.08, 0.1, (0, 0, 0.05), verts=8)
    cyl(p["steel"], 0.04, 0.8, (0, 0, 0.45), verts=8)
    box(p["dark"], (0.36, 0.08, 0.26), (0, 0, 0.9), rot=(0.3, 0, 0))
    box(p["purple_glow"], (0.3, 0.02, 0.2), (0, -0.05, 0.91), rot=(0.3, 0, 0))
    box(p["dark_glass"], (0.14, 0.03, 0.1), (-0.07, -0.06, 0.92), rot=(0.3, 0, 0.5))  # shattered corner
    box(p["dark"], (0.1, 0.06, 0.06), (0.3, 0.2, 0.03), rot=(0, 0, 0.8))  # fallen panel


def cables(p):
    """A cable drum and a tangle of thick cables and pipe sections."""
    cyl(p["rust"], 0.26, 0.05, (0, -0.12, 0.26), rot=(math.radians(90), 0, 0), verts=14)
    cyl(p["rust"], 0.26, 0.05, (0, 0.12, 0.26), rot=(math.radians(90), 0, 0), verts=14)
    cyl(p["rubber"], 0.18, 0.22, (0, 0, 0.26), rot=(math.radians(90), 0, 0), verts=12)
    pipe(p["rubber"], (0.1, 0.0, 0.1), (0.6, 0.2, 0.03), r=0.03)
    pipe(p["rubber"], (0.6, 0.2, 0.03), (0.75, -0.2, 0.03), r=0.03)
    cyl(p["scrap"], 0.07, 0.7, (-0.35, 0.35, 0.07), rot=(0, math.radians(90), 0.7), verts=8)
    cyl(p["scrap"], 0.07, 0.5, (-0.4, 0.2, 0.2), rot=(0.3, math.radians(80), 0.5), verts=8)


def rubble(p):
    """Fallen concrete from the towers: broken slabs with bent rebar sticking out."""
    box(p["concrete"], (0.6, 0.45, 0.1), (0, 0, 0.06), rot=(0.1, 0.08, 0.3))
    box(p["concrete"], (0.4, 0.3, 0.1), (0.2, 0.15, 0.17), rot=(0.4, 0.2, 0.9))
    box(p["concrete"], (0.25, 0.2, 0.15), (-0.35, -0.2, 0.07), rot=(0.2, 0.3, 0.2))
    for k in range(3):
        cyl(p["rust"], 0.012, 0.5, (0.1 + k * 0.08, 0.05, 0.25), rot=(0.5 + k * 0.2, 0.4, k), verts=4)


def streetlamp(p):
    """A slim street lamp: a pole on a plinth, a curved arm and a lit hood, a cable box at its foot."""
    cyl(p["dark"], 0.11, 0.12, (0, 0, 0.06), verts=8)
    cyl(p["steel"], 0.035, 1.35, (0, 0, 0.73), verts=8)
    pipe(p["steel"], (0, 0, 1.38), (0.22, 0, 1.48), r=0.03, verts=6)
    pipe(p["steel"], (0.22, 0, 1.48), (0.42, 0, 1.46), r=0.03, verts=6)
    box(p["dark"], (0.26, 0.14, 0.06), (0.42, 0, 1.43))
    box(p["lamp_glow"], (0.2, 0.09, 0.02), (0.42, 0, 1.4))
    box(p["scrap"], (0.1, 0.08, 0.18), (0, -0.07, 0.3))
    box(p["hazard"], (0.08, 0.02, 0.05), (0, -0.115, 0.34))


def techbox(p):
    """A row of street utility cabinets: louvres, a hazard plate, a status light, cables down into the deck."""
    box(p["scrap"], (0.42, 0.28, 0.6), (-0.22, 0, 0.3))
    box(p["steel"], (0.34, 0.26, 0.42), (0.2, 0.01, 0.21))
    for k in range(4):
        box(p["dark"], (0.3, 0.02, 0.025), (-0.22, -0.145, 0.38 + k * 0.05))  # louvres
    box(p["hazard"], (0.12, 0.02, 0.08), (-0.22, -0.145, 0.18))
    ball(p["green_glow"], 0.02, (-0.06, -0.15, 0.52), seg=6, rings=4)
    ball(p["red_glow"], 0.02, (0.3, -0.135, 0.36), seg=6, rings=4)
    box(p["dark"], (0.36, 0.2, 0.03), (0.2, 0.01, 0.43))  # lid
    box(p["dark"], (0.02, 0.1, 0.2), (0.09, -0.14, 0.2), rot=(0, 0, 0.9))  # door hanging open
    pipe(p["rubber"], (0.38, 0.05, 0.1), (0.62, 0.2, 0.02), r=0.025, verts=6)
    pipe(p["rubber"], (-0.44, 0.0, 0.12), (-0.6, -0.15, 0.02), r=0.03, verts=6)


def billboard(p):
    """An old street ad on two legs: a frame, a half-dead screen with coloured bands, a torn corner."""
    for x in (-0.42, 0.42):
        cyl(p["steel"], 0.03, 0.55, (x, 0.04, 0.27), verts=6)
    box(p["dark"], (1.0, 0.08, 0.58), (0, 0.04, 0.82))
    box(p["purple_glow"], (0.86, 0.02, 0.18), (-0.0, -0.005, 0.95))
    box(p["cyan_glow"], (0.5, 0.02, 0.08), (-0.18, -0.005, 0.76))
    box(p["orange_glow"], (0.2, 0.02, 0.12), (0.28, -0.005, 0.72))
    box(p["dark_glass"], (0.3, 0.025, 0.22), (0.3, -0.01, 0.92), rot=(0, 0.25, 0))  # dead pixels
    box(p["dark"], (0.25, 0.04, 0.2), (0.42, -0.2, 0.06), rot=(1.3, 0, 0.5))  # fallen panel
    box(p["scrap"], (1.04, 0.1, 0.05), (0, 0.04, 1.12))  # top rail


def hovercar(p):
    """An abandoned flying car grounded askew: a teardrop body, a cracked canopy, dead thruster pods."""
    body = ball(p["scrap"], 0.5, (0, 0, 0.32), scale=(1.7, 0.85, 0.42), seg=14, rings=8)
    body.rotation_euler = (0.08, -0.06, 0)
    ball(p["dark_glass"], 0.3, (-0.18, 0, 0.5), scale=(1.5, 0.9, 0.55), seg=10, rings=6)
    for x, y in ((-0.55, -0.42), (0.55, -0.42), (-0.55, 0.42), (0.55, 0.42)):
        cyl(p["dark"], 0.16, 0.14, (x, y, 0.12), verts=10)
        cyl(p["scrap"], 0.1, 0.02, (x, y, 0.05), verts=10)
    box(p["red_glow"], (0.04, 0.5, 0.04), (0.84, 0, 0.36))  # tail light, still on
    box(p["cyan_glow"], (0.03, 0.3, 0.03), (-0.85, 0, 0.3))
    box(p["rust"], (0.3, 0.4, 0.05), (0.15, 0.35, 0.48), rot=(0.5, 0, 0.2))  # crumpled panel
    box(p["scrap"], (0.25, 0.12, 0.04), (0.9, 0.55, 0.03), rot=(0, 0, 0.8))  # fallen fin


# ---- Fixtures on the city's cliff walls: the wall stands at y = 0, the fixture juts out towards -y.

def walldoor(p):
    """A service door set in the wall: a steel frame, a half-raised shutter over a dark inside, a lit sign, a step."""
    box(p["steel"], (0.7, 0.08, 0.95), (0, -0.04, 0.48))
    box(p["dark"], (0.56, 0.06, 0.8), (0, -0.07, 0.42))
    box(p["scrap"], (0.56, 0.05, 0.42), (0, -0.09, 0.62))  # shutter, half up
    for k in range(4):
        box(p["dark"], (0.56, 0.06, 0.012), (0, -0.1, 0.46 + k * 0.1))
    box(p["dark"], (0.4, 0.05, 0.1), (0, -0.09, 0.99))
    box(p["cyan_glow"], (0.34, 0.02, 0.06), (0, -0.12, 0.99))
    box(p["hazard"], (0.7, 0.04, 0.04), (0, -0.09, 0.9))
    box(p["concrete"], (0.8, 0.25, 0.06), (0, -0.14, 0.03))  # step
    ball(p["orange_glow"], 0.025, (0.38, -0.1, 0.8), seg=6, rings=4)


def wallpanel(p):
    """Electrical boxes bolted to the wall, conduits climbing out of them, a warning light."""
    box(p["scrap"], (0.32, 0.14, 0.42), (-0.15, -0.07, 0.55))
    box(p["steel"], (0.24, 0.12, 0.3), (0.2, -0.06, 0.45))
    box(p["dark"], (0.26, 0.02, 0.06), (-0.15, -0.15, 0.62))
    box(p["hazard"], (0.1, 0.02, 0.1), (-0.15, -0.15, 0.45))
    box(p["dark"], (0.04, 0.1, 0.2), (0.34, -0.12, 0.45), rot=(0, 0, 0.7))  # door hanging open
    ball(p["green_glow"], 0.018, (0.12, -0.13, 0.55), seg=6, rings=4)
    ball(p["red_glow"], 0.025, (-0.15, -0.15, 0.82), seg=6, rings=4)
    for x in (-0.24, -0.15, -0.06):
        cyl(p["dark"], 0.02, 0.45, (x, -0.04, 0.98), verts=6)  # conduits up the wall
    cyl(p["dark"], 0.025, 0.3, (0.2, -0.04, 0.15), verts=6)  # and down into the deck
    pipe(p["rubber"], (0.3, -0.08, 0.32), (0.45, -0.3, 0.02), r=0.02, verts=5)


def wallpipe(p):
    """A big exhaust duct: out of the wall, a flanged elbow, straight down into the deck through a collar."""
    r = 0.13
    pipe(p["rust"], (0, 0.0, 0.82), (0, -0.32, 0.82), r=r, verts=12)
    pipe(p["rust"], (0, -0.32, 0.82), (0, -0.42, 0.72), r=r, verts=12)  # elbow
    pipe(p["rust"], (0, -0.45, 0.68), (0, -0.45, 0.0), r=r, verts=12)
    for y, z, rot in ((-0.02, 0.82, (math.radians(90), 0, 0)), (-0.3, 0.82, (math.radians(90), 0, 0)), (-0.45, 0.6, (0, 0, 0)), (-0.45, 0.25, (0, 0, 0))):
        cyl(p["steel"], r + 0.03, 0.04, (0, y, z), rot=rot, verts=12)  # flanges
    cyl(p["concrete"], r + 0.08, 0.08, (0, -0.45, 0.04), verts=12)  # collar in the deck
    box(p["steel"], (0.06, 0.3, 0.04), (0.16, -0.2, 0.7))  # bracket
    box(p["hazard"], (0.02, 0.15, 0.08), (r + 0.01, -0.45, 0.4))


def rounded(m, w, h, r, depth, loc, seg=5, name="rounded"):
    """A rounded-rectangle slab standing in the XZ plane (w wide, h tall, corner radius r), depth along Y."""
    pts = []
    for cx, cz, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for k in range(seg + 1):
            a = math.radians(a0 + 90 * k / seg)
            pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    n = len(pts)
    verts = [(x, -depth / 2, z) for x, z in pts] + [(x, depth / 2, z) for x, z in pts]
    faces = [tuple(range(n))[::-1], tuple(range(n, 2 * n))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.location = loc
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    return _finish(o, m, name)


def shopfront(p):
    """A shop window in the wall, old-republic style: one big rounded bay of filthy glass, dim light inside, grime run down from it."""
    rounded(p["steel"], 0.86, 0.62, 0.2, 0.1, (0, -0.02, 0.5))  # frame, half sunk in the wall
    rounded(p["grimy_glow"], 0.74, 0.5, 0.15, 0.02, (0, -0.075, 0.5))  # lit glass
    rounded(p["dark_glass"], 0.3, 0.22, 0.08, 0.02, (0.2, -0.085, 0.42))  # a dead, smashed pane corner
    for x, z, w, h in ((-0.2, 0.36, 0.3, 0.1), (0.05, 0.62, 0.22, 0.07), (-0.27, 0.58, 0.12, 0.14)):
        rounded(p["dark"], w, h, min(w, h) / 2.2, 0.01, (x, -0.088, z))  # smears of filth on the glass
    box(p["dark"], (0.74, 0.03, 0.025), (0, -0.085, 0.47))  # transom bar
    box(p["scrap"], (0.8, 0.1, 0.035), (0, -0.07, 0.2))  # sill
    box(p["dark"], (0.2, 0.15, 0.12), (-0.28, -0.22, 0.06), rot=(0, 0, 0.3))  # junk left out front


DOODADS = {
    "rocks_a": rocks_a, "rocks_b": rocks_b, "pebbles": pebbles, "dead_tree": dead_tree, "dry_bush": dry_bush,
    "tire_pile": tire_pile, "barrels": barrels, "wreck": wreck, "bones": bones, "scrap_pile": scrap_pile,
    "crates": crates, "barrier": barrier, "vending": vending, "trash": trash, "vent": vent, "terminal": terminal,
    "cables": cables, "rubble": rubble, "streetlamp": streetlamp, "techbox": techbox, "billboard": billboard,
    "hovercar": hovercar, "walldoor": walldoor, "wallpanel": wallpanel, "wallpipe": wallpipe, "shopfront": shopfront,
}

def canvas_texture(name):
    """A tileable 256px canvas, near neutral so the material's colour shows through: an over-under plain weave
    (8px threads, one repeat per box_uv tile), uneven slubbed threads and sun-faded patches."""
    if name in bpy.data.images:
        return bpy.data.images[name]
    import numpy as np
    S, T = 256, 8
    rng = np.random.default_rng(11)
    yy, xx = np.mgrid[0:S, 0:S]
    over = ((xx // T + yy // T) % 2) == 0
    h = np.where(over, np.sin(np.pi * (xx % T + 0.5) / T), np.sin(np.pi * (yy % T + 0.5) / T))
    lum = 0.74 + 0.22 * h
    slub = np.where(over, _noise(rng, S, 4, (1, 32)), _noise(rng, S, 4, (32, 1)))
    lum = lum * (0.94 + 0.12 * slub) * (0.86 + 0.2 * _fbm(rng, S, 3, 4))
    rgb = np.clip(np.stack([lum * 1.01, lum, lum * 0.97], -1), 0, 1)
    img = bpy.data.images.new(name, S, S)
    img.colorspace_settings.name = "sRGB"
    img.pixels.foreach_set(np.concatenate([rgb, np.ones((S, S, 1))], -1).astype(np.float32).ravel())
    img.pack()
    return img


def awning(team, linen, front=-1.1, rear=1.1, zf=1.67, zr=1.9, half=1.35, posts=(-1.05, 0.0, 1.05), stripes=7,
           over=0.18, sag=0.17, hang=0.11, scallop=0.08, wave=0.012):
    """Striped canvas laid over two beams: it sags between them (deeper between the posts), its overhangs droop,
    it ripples a little, and a scalloped valance hangs front and back, one tongue per stripe."""
    def z(x, y):
        t = (y - front) / (rear - front)
        h = zf + (zr - zf) * t
        span = abs(math.sin(math.pi * (x - posts[0]) / (posts[1] - posts[0])))
        if 0 <= t <= 1:
            h -= sag * 4 * t * (1 - t) * (0.7 + 0.3 * span)
        else:
            d = (front - y) if t < 0 else (y - rear)
            h -= 0.7 * d + 1.8 * d * d
        dx = max(0.0, abs(x) - abs(posts[-1]))
        return h - 0.9 * dx * dx + wave * math.sin(x * 9 + y * 4) + 0.6 * wave * math.sin(y * 13 - x * 3)
    w = 2 * half / stripes
    nu, nv, nh = 6, 20, 3
    y0, y1 = front - over, rear + over
    rows = [("f", k / nh) for k in range(nh, 0, -1)] + [("c", y0 + (y1 - y0) * j / nv) for j in range(nv + 1)] + [("r", k / nh) for k in range(1, nh + 1)]
    for s in range(stripes):
        verts, faces, cols = [], [], nu + 1
        for kind, v in rows:
            for i in range(cols):
                u = i / nu
                x = -half + (s + u) * w
                drop = (hang + scallop * math.sin(math.pi * u)) * v
                if kind == "c":
                    verts.append((x, v, z(x, v)))
                elif kind == "f":
                    verts.append((x, y0 - 0.04 * v, z(x, y0) - drop))
                else:
                    verts.append((x, y1 + 0.04 * v, z(x, y1) - drop))
        for r in range(len(rows) - 1):
            for i in range(nu):
                a = r * cols + i
                faces.append((a, a + 1, a + cols + 1, a + cols))
        me = bpy.data.meshes.new("awning")
        me.from_pydata(verts, [], faces)
        me.update()
        o = bpy.data.objects.new("awning", me)
        bpy.context.collection.objects.link(o)
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        mod = o.modifiers.new("cloth", "SOLIDIFY")
        mod.thickness = 0.025
        mod.offset = 0
        bpy.ops.object.modifier_apply(modifier=mod.name)
        o.data.materials.append(team if s % 2 == 0 else linen)
        for poly in o.data.polygons:
            poly.use_smooth = True


def glow_vein(p, glow, pts, r=0.02, into=(0, 1, 0)):
    """A thin glass vein of team light in a dark iron gutter (set back into the wall along `into`), brass clamps
    at the ends and about every 40 cm."""
    back = lambda q: (q[0] + into[0] * r, q[1] + into[1] * r, q[2] + into[2] * r)
    last = None
    for a, b in zip(pts, pts[1:]):
        pipe(p["dark"], back(a), back(b), r=r * 1.3, verts=8)
        pipe(glow, a, b, r=r, verts=8)
    for q in pts:
        if last is None or (Vector(q) - Vector(last)).length > 0.4 or q is pts[-1]:
            ball(p["bronze"], r * 2.2, q, seg=8, rings=4)
            last = q


def armillary(p, glow, loc, s=1.0):
    """A brass armillary sphere on a stand, its core lit in the team's colour."""
    x, y, z = loc
    cyl(p["dark"], 0.12 * s, 0.1 * s, (x, y, z + 0.05 * s), verts=10)
    cyl(p["bronze"], 0.03 * s, 0.35 * s, (x, y, z + 0.25 * s), verts=8)
    c = (x, y, z + 0.62 * s)
    ring(p["bronze"], 0.3 * s, 0.02 * s, c, rot=(math.radians(90), 0, 0))
    ring(p["bronze"], 0.3 * s, 0.02 * s, c, rot=(math.radians(90), 0, math.radians(60)))
    ring(p["bronze"], 0.26 * s, 0.022 * s, c, rot=(math.radians(23), 0, 0))
    ball(glow, 0.09 * s, c)


def gear(p, loc, r=0.17, teeth=10):
    """A brass cog flat on a wall facing -y."""
    x, y, z = loc
    ring(p["bronze"], r * 0.82, 0.04, (x, y, z), rot=(math.radians(90), 0, 0))
    cyl(p["dark"], 0.05, 0.06, (x, y - 0.01, z), rot=(math.radians(90), 0, 0), verts=12)
    for i in range(4):
        box(p["bronze"], (r * 1.6, 0.03, 0.03), (x, y, z), rot=(0, i * math.pi / 4, 0))
    for i in range(teeth):
        a = i / teeth * math.tau
        box(p["bronze"], (0.06, 0.05, 0.06), (x + math.cos(a) * r, y, z + math.sin(a) * r), rot=(0, -a, 0))


def ray(origin, d):
    """First hit of a ray in the scene: (location, normal) or None."""
    dg = bpy.context.evaluated_depsgraph_get()
    hit, loc, nor, *_ = bpy.context.scene.ray_cast(dg, Vector(origin), Vector(d))
    return (loc, nor) if hit else None


def roof(x, y):
    h = ray((x, y, 20), (0, 0, -1))
    return h[0].z if h else 0.0


def wall(x, z, d=(0, 1, 0)):
    """Where a ray along d (from outside) meets the wall at height z: its depth along d."""
    d = Vector(d)
    o = Vector((x, 0, z)) if d.y else Vector((0, x, z))
    h = ray(o - d * 20, d)
    return h[0].dot(d) if h else 0.0


def traced_vein(p, glow, a, b, d, pad=0.03, step=0.025, r=0.02, tol=0.06):
    """A glow vein that hugs a wall: rays cast along d from points on the line a-b. Small bumps in the masonry
    are ignored; where the wall really steps in or out (over `tol`) the vein turns a right angle round the edge,
    like pipework clamped to the stone. Collinear points merge."""
    a, b, d = Vector(a), Vector(b), Vector(d).normalized()
    n = max(2, int((b - a).length / step))
    runs, pts, prev = [], [], None
    for i in range(n + 1):
        o = a + (b - a) * (i / n) - d * 20
        h = ray(o, d)
        if not h:
            if len(pts) > 1:
                runs.append(pts)
            pts, prev = [], None
            continue
        depth = h[0].dot(d) - pad
        if prev is not None and abs(depth - prev[1]) <= tol:
            depth = prev[1]
        q = o + d * (depth - o.dot(d))
        if prev is not None and abs(depth - prev[1]) > tol:
            if abs(depth - prev[1]) > 0.7:  # off the building: start a new run
                if len(pts) > 1:
                    runs.append(pts)
                pts = []
            else:
                m = (prev[0] + q) / 2
                pts.append(m + d * (prev[1] - m.dot(d)))
                pts.append(m + d * (depth - m.dot(d)))
        pts.append(q)
        prev = (q, depth)
    if len(pts) > 1:
        runs.append(pts)
    for pts in runs:
        if (pts[-1] - pts[0]).length < 0.3:
            continue  # a scrap of wall between gaps: a stub of vein there reads as noise
        out = [pts[0]]
        for j in range(1, len(pts) - 1):
            u, v = pts[j] - out[-1], pts[j + 1] - pts[j]
            if u.length < 1e-4 or v.length < 1e-4 or u.normalized().dot(v.normalized()) < 0.999:
                out.append(pts[j])
        out.append(pts[-1])
        glow_vein(p, glow, [tuple(q) for q in out], r=r, into=tuple(d))


def dress_conseil(p, glow):
    Y, X, NX = (0, 1, 0), (-1, 0, 0), (1, 0, 0)
    traced_vein(p, glow, (-1.9, 0, 1.02), (1.9, 0, 1.02), Y)
    for x in (-1.9, 1.9):
        traced_vein(p, glow, (x, 0, 0.1), (x, 0, 1.02), Y)
    traced_vein(p, glow, (0, -1.7, 1.02), (0, 1.7, 1.02), X)
    traced_vein(p, glow, (0, -1.7, 1.02), (0, 1.7, 1.02), NX)
    gear(p, (1.3, wall(1.3, 1.5) - 0.03, 1.5), r=0.3, teeth=14)
    armillary(p, glow, (-0.4, -0.3, roof(-0.4, -0.3)), 1.6)


def dress_caserne(p, glow):
    Y, X, NX = (0, 1, 0), (-1, 0, 0), (1, 0, 0)
    traced_vein(p, glow, (-1.25, 0, 0.98), (1.25, 0, 0.98), Y)
    for x in (-1.2, 1.2):
        traced_vein(p, glow, (x, 0, 0.35), (x, 0, 0.98), Y)
    traced_vein(p, glow, (0, -1.15, 0.98), (0, 1.15, 0.98), X)
    traced_vein(p, glow, (0, -1.15, 0.98), (0, 1.15, 0.98), NX)
    gear(p, (0.75, wall(0.75, 1.3) - 0.03, 1.3), r=0.2, teeth=12)
    armillary(p, glow, (-0.6, 0.0, roof(-0.6, 0.0)), 1.2)


def band(p, glow, z, hx, hy, z0=0.15, corners=True, tol=0.06):
    """The usual dressing: a vein round the front and both sides at height z (the building spans +-hx, +-hy),
    and down the two front corners to the ground."""
    Y, X, NX = (0, 1, 0), (-1, 0, 0), (1, 0, 0)
    traced_vein(p, glow, (-hx, 0, z), (hx, 0, z), Y, tol=tol)
    traced_vein(p, glow, (0, -hy, z), (0, hy, z), X, tol=tol)
    traced_vein(p, glow, (0, -hy, z), (0, hy, z), NX, tol=tol)
    if corners:
        for x in (-hx + 0.08, hx - 0.08):
            traced_vein(p, glow, (x, 0, z0), (x, 0, z), Y, tol=tol)


def front_gear(p, x, z, r=0.17, teeth=10):
    gear(p, (x, wall(x, z) - 0.03, z), r=r, teeth=teeth)


def dress_grenier(p, glow):
    band(p, glow, 0.62, 0.9, 0.86)
    front_gear(p, 0.55, 0.95, 0.13, 9)


def dress_mine(p, glow):
    band(p, glow, 0.72, 1.05, 1.15)
    front_gear(p, -0.6, 1.0, 0.16)


def dress_forge(p, glow):
    band(p, glow, 0.95, 1.3, 1.0)
    front_gear(p, 0.75, 1.4, 0.18, 11)
    armillary(p, glow, (-0.2, 0.2, roof(-0.2, 0.2)), 1.0)


def dress_fortin(p, glow):
    band(p, glow, 0.62, 0.9, 0.8)
    front_gear(p, 0.55, 1.15, 0.13, 9)


def dress_tour(p, glow):
    band(p, glow, 1.15, 0.88, 0.9)
    front_gear(p, 0.45, 1.75, 0.13, 9)


def dress_metallurgie(p, glow):
    band(p, glow, 0.62, 1.35, 0.92)
    front_gear(p, -0.85, 1.05, 0.16)


def dress_alchimisterie(p, glow):
    band(p, glow, 0.8, 1.25, 1.18, tol=0.14)
    front_gear(p, 0.8, 1.25, 0.16)


def dress_creaturium(p, glow):
    band(p, glow, 0.5, 1.38, 1.26, corners=False, tol=0.3)
    armillary(p, glow, (0.0, 0.0, roof(0.0, 0.0)), 1.1)


#: Meshy buildings dressed with Blender parts: veins of team light fitted to their walls by ray casts and a
#: little brass mechanism. Only the parts are exported (`<type>-dress.glb`); the game adds them to the model.
DRESS = {
    "conseil": dress_conseil, "caserne": dress_caserne, "grenier": dress_grenier, "mine": dress_mine, "forge": dress_forge,
    "fortin": dress_fortin, "tour": dress_tour, "metallurgie": dress_metallurgie, "alchimisterie": dress_alchimisterie,
    "creaturium": dress_creaturium,
}


def dress(name, fn):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    p = palette()
    bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, f"{name}-meshy.glb"))
    shell = set(bpy.context.scene.objects)
    bpy.context.view_layer.update()
    fn(p, mat("team_glow", 0x3A7BD5, emission=0x3A7BD5))
    for o in shell:
        bpy.data.objects.remove(o)
    return [join([o for o in bpy.context.scene.objects if o.type == "MESH"], f"{name}-dress")]


def marche(p):
    """Market (notice: trade and the economy): a stone floor under a team-striped canvas awning on timber posts,
    a stone counter with a brass balance, crates, sacks, amphorae and a small alchemical still. A touch of the
    camp's alchemical engineering: thin veins of team light along the beam, posts and counter, a cog on the
    counter and a brass armillary sphere on a mast."""
    box(p["stone_dark"], (2.8, 2.8, 0.16), (0, 0, 0.08))
    box(p["stone"], (2.5, 2.5, 0.06), (0, 0, 0.19))
    for x, y in ((-1.05, -1.05), (1.05, -1.05), (1.05, 1.05), (-1.05, 1.05), (0, -1.05), (0, 1.05)):
        cyl(p["wood"], 0.07, 1.5, (x, y, 0.95), verts=8)
    canvas = canvas_texture("canvas_tex")
    # "team_canvas" is recoloured per player in game, keeping its weave.
    awning(textured("team_canvas", 0x3A7BD5, canvas, 0.0, 0.9), textured("linen_canvas", 0xDDD2B8, canvas, 0.0, 0.9))
    box(p["wood"], (2.7, 0.08, 0.08), (0, -1.1, 1.62))
    box(p["wood"], (2.7, 0.08, 0.08), (0, 1.1, 1.85))
    # "team_glow" lights up in the player's colour in game.
    glow = mat("team_glow", 0x3A7BD5, emission=0x3A7BD5)
    glow_vein(p, glow, [(-1.3, -1.165, 1.6), (1.3, -1.165, 1.6)])
    for x in (-1.05, 1.05):
        glow_vein(p, glow, [(x, -1.14, 1.56), (x, -1.14, 0.24)])
    glow_vein(p, glow, [(-0.68, -0.795, 0.76), (0.68, -0.795, 0.76)], r=0.016)
    gear(p, (-0.52, -0.79, 0.5))
    cyl(p["bronze"], 0.035, 0.6, (1.05, 1.05, 1.98), verts=8)
    armillary(p, glow, (1.05, 1.05, 2.22), 0.75)
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


def baliste(p):
    """Baliste plasma: a levitating Art Deco gun platform, a fan of ion barrels, cyan levitation rings; front -y."""
    ball(p["coat"], 0.55, (0, 0.05, 0.45), scale=(1, 1.3, 0.45), seg=16, rings=8)
    ring(p["cyan_glow"], 0.45, 0.04, (0, 0.05, 0.22), seg=20)
    ring(p["gold"], 0.58, 0.03, (0, 0.05, 0.45), seg=20)
    box(p["team"], (0.1, 0.9, 0.06), (0, 0.05, 0.68))
    for i, x in enumerate((-0.16, -0.05, 0.05, 0.16)):
        cyl(p["chrome"], 0.04, 0.7, (x, -0.55, 0.62 + (i % 2) * 0.05), rot=(math.radians(90), 0, 0), verts=8)
    cyl(p["gold"], 0.2, 0.18, (0, -0.25, 0.62), rot=(math.radians(90), 0, 0), verts=12)
    ball(p["cyan_glow"], 0.07, (0, -0.92, 0.65))


def espion(p):
    """Espion: a small chrome scout drone, a teardrop with fins and a cyan eye; front -y."""
    ball(p["chrome"], 0.25, (0, 0, 0.3), scale=(0.8, 1.4, 0.7), seg=14, rings=8)
    ball(p["cyan_glow"], 0.08, (0, -0.32, 0.32))
    fins(p, p["gold"], 3, 0.18, 0.3, 0.12, width=0.25)
    ring(p["team"], 0.22, 0.025, (0, 0.05, 0.3), rot=(math.radians(90), 0, 0), seg=16)


def dragon(p):
    """Dragon: the Chimère made for space, a long flying wing with two plasma concentrators on its sides; front -y."""
    ball(p["coat"], 0.3, (0, 0, 0.35), scale=(0.9, 2.4, 0.5), seg=16, rings=8)
    box(p["coat"], (1.6, 0.4, 0.05), (0, 0.15, 0.32), rot=(0, 0, 0))
    for sx in (-1, 1):
        cyl(p["gold"], 0.1, 0.8, (sx * 0.75, -0.1, 0.35), rot=(math.radians(90), 0, 0), verts=10)
        ball(p["cyan_glow"], 0.08, (sx * 0.75, -0.52, 0.35))
        box(p["team"], (0.25, 0.3, 0.06), (sx * 0.45, 0.2, 0.36))
    box(p["gold"], (0.05, 0.4, 0.25), (0, 0.55, 0.5))


def voyageur(p):
    """Voyageur: a large unarmed flying generator, a ringed sphere with a glowing core and Art Deco fins."""
    ball(p["coat"], 0.55, (0, 0, 0.6), seg=18, rings=10)
    ring(p["gold"], 0.75, 0.06, (0, 0, 0.6), seg=28)
    ring(p["chrome"], 0.68, 0.04, (0, 0, 0.6), rot=(math.radians(90), 0, 0), seg=28)
    ball(p["cyan_glow"], 0.12, (0, -0.42, 0.6))
    fins(p, p["team"], 6, 0.5, 0.6, 0.5, width=0.2)


def behemoth(p):
    """Béhémoth: a flying fortress, a stepped Art Deco hull with towers, rows of lights and heavy cannons; front -y."""
    ball(p["coat"], 0.9, (0, 0, 0.6), scale=(1, 1.6, 0.4), seg=20, rings=10)
    for z, sz in ((0.85, 0.9), (1.05, 0.6), (1.22, 0.35)):
        box(p["coat"], (sz, sz * 1.6, 0.2), (0, 0.1, z))
    ring(p["gold"], 0.95, 0.05, (0, 0, 0.6), seg=32)
    for sx in (-1, 1):
        cyl(p["chrome"], 0.08, 1.0, (sx * 0.45, -1.1, 0.75), rot=(math.radians(90), 0, 0), verts=10)
        box(p["team"], (0.08, 1.2, 0.1), (sx * 0.62, 0.1, 0.9))
        for k in range(5):
            ball(p["window_glow"], 0.04, (sx * 0.7, -0.6 + k * 0.3, 0.7))
    cone(p["gold"], 0.12, 0.6, (0, 0.3, 1.6), verts=8)
    ball(p["cyan_glow"], 0.2, (0, 0, 0.18))


def orbecommandement(p):
    """Orbe de commandement: a great luminous orb held in a gold ring above a stepped ivory base."""
    for sz, z in ((2.7, 0.12), (2.1, 0.35), (1.4, 0.55)):
        box(p["ivory"], (sz, sz, 0.22), (0, 0, z))
    for k in range(4):
        a = k / 4 * math.tau + math.pi / 4
        pipe(p["gold"], (math.cos(a) * 0.9, math.sin(a) * 0.9, 0.6), (math.cos(a) * 0.55, math.sin(a) * 0.55, 1.8), r=0.07, verts=8)
    ring(p["gold"], 0.62, 0.07, (0, 0, 1.8), seg=28)
    ball(p["cyan_glow"], 0.48, (0, 0, 1.8), seg=18, rings=10)
    fins(p, p["team"], 4, 1.15, 0.5, 0.4, width=0.3)


def trone(p):
    """Trône d'Altar Sargon: a stepped ziggurat crowned by a tall gold throne-spire and a halo of light."""
    for sz, z in ((3.7, 0.15), (3.0, 0.45), (2.3, 0.75), (1.6, 1.05)):
        box(p["ivory"], (sz, sz, 0.3), (0, 0, z))
        box(p["gold"], (sz + 0.04, sz + 0.04, 0.04), (0, 0, z + 0.15))
    box(p["gold"], (0.7, 0.5, 1.4), (0, 0.2, 1.9))
    box(p["ivory"], (0.6, 0.15, 1.9), (0, 0.5, 2.1))
    cone(p["gold"], 0.25, 1.2, (0, 0.2, 3.2), verts=8)
    ring(p["cyan_glow"], 0.55, 0.04, (0, 0.2, 3.0), seg=24)
    for sx in (-1, 1):
        box(p["team"], (0.12, 3.0, 0.1), (sx * 1.5, 0, 0.62))


def deflecteur(p):
    """Déflecteur: an Émetteur turned shield of invisibility: a tall chrome mast with three bent vanes and a pale veil."""
    cyl(p["ivory"], 0.8, 0.25, (0, 0, 0.12), verts=16)
    cyl(p["chrome"], 0.08, 1.8, (0, 0, 1.1), verts=10)
    for k in range(3):
        a = k / 3 * math.tau
        box(p["gold"], (0.05, 0.5, 0.9), (math.cos(a) * 0.3, math.sin(a) * 0.3, 1.3), rot=(0.25, 0, a))
    ball(p["crystal_pale"], 0.25, (0, 0, 2.05))
    box(p["team"], (0.05, 0.4, 0.2), (0.78, 0, 0.18))


# ------------------------------------------------------------------ Z: a nest of metal insects, rusted steel, hydraulics and live wires

def shell(m, r, loc, scale=(1, 1, 1), seg=8, rings=4):
    """A faceted armour shell: a low-poly sphere left flat-shaded, riveted plates rather than a smooth carapace."""
    o = ball(m, r, loc, scale, seg, rings)
    for poly in o.data.polygons:
        poly.use_smooth = False
    return o


def connector(p, at, toward, r):
    """A cable end: a steel sleeve along the cable, a copper ring at its mouth, so no wire ends bare."""
    at, toward = Vector(at), Vector(toward)
    d = toward - at
    d = d.normalized() if d.length > 1e-6 else Vector((0, 0, 1))
    pipe(p["zsteel"], at, at + d * r * 4, r=r * 1.7, verts=6)
    pipe(p["zcopper"], at + d * r * 0.6, at + d * r * 1.3, r=r * 1.9, verts=6)


def cable(p, a, b, sag=0.15, r=0.02):
    """A live wire: black rubber sheath hanging between two points, a connector at both ends."""
    a, b = Vector(a), Vector(b)
    n = 4
    pts = [a.lerp(b, k / n) - Vector((0, 0, sag * 4 * (k / n) * (1 - k / n))) for k in range(n + 1)]
    for u, v in zip(pts, pts[1:]):
        pipe(p["rubber"], u, v, r=r, verts=5)
    connector(p, a, pts[1], r)
    connector(p, b, pts[-2], r)


def piston(p, a, b, r):
    """A hydraulic jack: a steel sleeve and a bright chrome rod, pinned at both ends."""
    a, b = Vector(a), Vector(b)
    mid = a.lerp(b, 0.55)
    pipe(p["zsteel"], a, mid, r=r, verts=6)
    cyl(p["graphite"], r * 1.25, r * 0.6, mid, verts=6)  # gland where the rod leaves the sleeve
    pipe(p["chrome"], mid, b, r=r * 0.55, verts=6)
    for q in (a, b):
        ball(p["zsteel"], r * 1.3, q, seg=6, rings=3)


def joint_leg(p, base, knee, foot, r=0.035, part=None):
    """An insect leg built like a crane: a square rusted femur pushed by a hydraulic jack, an axle at the knee,
    a steel shin ending in a claw. With `part` ("zleg_<pair>_<side>"), the femur is its own object pivoting at
    the hip and the shin ("zshin_<pair>_<side>") its child pivoting at the knee, for the walk and for
    unfolding the leg straight."""
    before = set(bpy.context.scene.objects)
    base, knee, foot = Vector(base), Vector(knee), Vector(foot)
    shell(p["zsteel"], r * 1.6, base, seg=6, rings=3)
    pipe(p["zrust"], base, knee, r=r, verts=4)
    up = Vector((0, 0, r * 2.2))
    piston(p, base + up * 0.6 + (base - knee) * 0.15, base.lerp(knee, 0.75) + up, r * 0.5)
    yaw = math.atan2(knee.y - base.y, knee.x - base.x) + math.pi / 2
    cyl(p["zsteel"], r * 1.4, r * 2.6, knee, rot=(0, math.pi / 2, yaw), verts=8)
    cyl(p["zcopper"], r * 0.7, r * 2.9, knee, rot=(0, math.pi / 2, yaw), verts=6)  # axle caps
    if r >= 0.035:
        cable(p, base + Vector((0, 0, -r)), knee + Vector((0, 0, -r)), sag=r * 2.5, r=r * 0.3)
    femur = set(bpy.context.scene.objects) - before
    pipe(p["zsteel"], knee, foot + Vector((0, 0, r * 2)), r=r * 0.7, verts=4)
    cyl(p["zsteel"], r, r * 0.8, foot + Vector((0, 0, r * 2)), verts=6)  # ankle collar
    cone(p["zsteel"], r * 0.9, r * 3, (foot.x, foot.y, foot.z + r * 1.5), rot=(math.pi, 0, 0), verts=4)
    shin = set(bpy.context.scene.objects) - before - femur
    if part:
        for o in femur:
            o.name = part
        JOINTS[part] = tuple(base)
        child = part.replace("zleg_", "zshin_") if part.startswith("zleg_") else part + "_tip"
        for o in shin:
            o.name = child
        JOINTS[child] = tuple(knee)


def legs(p, n, rx, ry, z, reach, lift, r=0.035):
    """n pairs of legs along the body (front -y), splayed out and slightly forward or back."""
    for i in range(n):
        t = 0 if n == 1 else i / (n - 1) - 0.5
        y = t * ry * 2
        for s in (-1, 1):
            base = (s * rx, y, z)
            knee = (s * (rx + reach * 0.55), y + t * reach * 0.6, z + lift)
            foot = (s * (rx + reach), y + t * reach * 1.1, 0.0)
            joint_leg(p, base, knee, foot, r, part=f"zleg_{i}_{'l' if s < 0 else 'r'}")


def gun(p, loc, length=0.3, barrels=1, r=0.025):
    """A gun pod: a riveted breech, barrels with muzzle brakes, an ammo feed wire."""
    x, y, z = loc
    w = 0.12 + 0.05 * barrels
    box(p["zsteel"], (w, 0.16, 0.1), (x, y, z))
    box(p["hazard"], (w + 0.01, 0.03, 0.06), (x, y + 0.05, z + 0.02))
    for k in range(barrels):
        bx = x + (k - (barrels - 1) / 2) * r * 2.6
        cyl(p["graphite"], r, length, (bx, y - length / 2 - 0.05, z), rot=(math.radians(90), 0, 0), verts=6)
        cyl(p["zsteel"], r * 1.5, length * 0.12, (bx, y - length - 0.03, z), rot=(math.radians(90), 0, 0), verts=6)
    box(p["cyan_glow"], (w * 0.6, 0.02, 0.02), (x, y - 0.085, z + 0.035))
    cable(p, (x + w / 2, y + 0.06, z - 0.02), (x + w / 2 + 0.03, y + 0.16, z - 0.12), sag=0.03, r=0.01)


def eyes(p, x, y, z, n=2, r=0.03, spread=0.06):
    """A cluster of red sensor lenses in steel sockets."""
    for k in range(n):
        ex = x + (k - (n - 1) / 2) * spread
        cyl(p["zsteel"], r * 1.4, r, (ex, y + r * 0.3, z), rot=(math.radians(90), 0, 0), verts=6)
        ball(p["red_glow"], r, (ex, y, z), seg=6, rings=4)


def cell(p, loc, r=0.06, h=0.18, rot=(0, 0, 0)):
    """A power cell: a steel can with a glowing cyan band."""
    cyl(p["zsteel"], r, h, loc, rot=rot, verts=8)
    cyl(p["cyan_glow"], r * 1.05, h * 0.2, loc, rot=rot, verts=8)


def drone(p):
    """Drone: a small rusted bug on four jacked legs, pincer mandibles for harvesting, a power cell on its back."""
    shell(p["zsteel"], 0.18, (0, 0.05, 0.3), scale=(1, 1.3, 0.6))
    box(p["zrust"], (0.16, 0.14, 0.12), (0, -0.17, 0.3), rot=(0.2, 0, 0))  # head
    eyes(p, 0, -0.245, 0.32, n=2, r=0.022, spread=0.06)
    box(p["team"], (0.1, 0.18, 0.03), (0, 0.0, 0.41))  # dorsal plate
    cell(p, (0, 0.18, 0.4), r=0.05, h=0.16, rot=(math.radians(90), 0, 0))
    cable(p, (0.04, 0.1, 0.42), (0.05, -0.12, 0.38), sag=0.04, r=0.008)
    pipe(p["graphite"], (0, -0.2, 0.36), (0.04, -0.28, 0.5), r=0.006, verts=4)  # antenna
    ball(p["red_glow"], 0.012, (0.04, -0.28, 0.5), seg=4, rings=3)
    for s in (-1, 1):
        pipe(p["zsteel"], (s * 0.05, -0.22, 0.27), (s * 0.1, -0.34, 0.2), r=0.018, verts=4)
        pipe(p["zrust"], (s * 0.1, -0.34, 0.2), (s * 0.05, -0.42, 0.13), r=0.014, verts=4)  # pincer
    legs(p, 2, 0.12, 0.1, 0.28, 0.2, 0.08, r=0.022)


def dronecombat(p):
    """Drone de combat: the worker bug with a light machine gun on a turret ring instead of mandibles."""
    shell(p["zsteel"], 0.19, (0, 0.05, 0.32), scale=(1, 1.3, 0.6))
    box(p["zrust"], (0.16, 0.14, 0.12), (0, -0.18, 0.31), rot=(0.2, 0, 0))
    eyes(p, 0, -0.255, 0.33, n=3, r=0.018, spread=0.045)
    box(p["team"], (0.1, 0.16, 0.03), (0, 0.12, 0.43))
    cyl(p["zsteel"], 0.09, 0.04, (0, -0.02, 0.43), verts=8)  # turret ring
    gun(p, (0, -0.02, 0.5), length=0.28)
    legs(p, 2, 0.12, 0.1, 0.3, 0.22, 0.09, r=0.022)


def quadripode(p):
    """Quadripode: a light, fast four-legged walker, a slim plated body high on long hydraulic legs, exhausts
    at the back, a gun at the front."""
    shell(p["zsteel"], 0.22, (0, 0.05, 0.62), scale=(0.9, 1.5, 0.5))
    box(p["zrust"], (0.2, 0.2, 0.15), (0, -0.28, 0.6), rot=(0.15, 0, 0))
    eyes(p, 0, -0.39, 0.63, n=2, r=0.025, spread=0.09)
    box(p["team"], (0.08, 0.36, 0.03), (0, 0.08, 0.74))
    for s in (-1, 1):
        pipe(p["graphite"], (s * 0.08, 0.3, 0.62), (s * 0.1, 0.46, 0.78), r=0.03, verts=6)  # exhaust
        cyl(p["orange_glow"], 0.024, 0.02, (s * 0.1, 0.46, 0.79), rot=(0.9, 0, 0), verts=6)
        cable(p, (s * 0.15, -0.1, 0.62), (s * 0.15, 0.2, 0.62), sag=0.05, r=0.01)
    gun(p, (0, -0.3, 0.75), length=0.3)
    legs(p, 2, 0.14, 0.18, 0.58, 0.42, 0.18, r=0.03)


def hexapode(p):
    """Hexapode: a heavy six-legged walker under overlapping armour plates, cooling fins, wires hanging
    between the plates, an asymmetric sensor mast."""
    shell(p["zsteel"], 0.36, (0, 0.05, 0.62), scale=(1, 1.35, 0.55), seg=10, rings=5)
    for k in range(4):  # overlapping dorsal plates
        y = -0.24 + k * 0.17
        box(p["zrust"] if k % 2 else p["zsteel"], (0.5 - abs(k - 1.5) * 0.06, 0.2, 0.05), (0, y, 0.82 - abs(k - 1.5) * 0.03), rot=(0.25, 0, 0))
    box(p["team"], (0.3, 0.12, 0.04), (0, 0.38, 0.8), rot=(0.4, 0, 0))
    for k in range(5):  # cooling fins on the flank
        box(p["graphite"], (0.02, 0.05, 0.14), (0.36, -0.12 + k * 0.07, 0.62))
    box(p["zrust"], (0.3, 0.24, 0.2), (0, -0.42, 0.58), rot=(0.15, 0, 0))  # head
    eyes(p, 0, -0.55, 0.6, n=3, r=0.03, spread=0.08)
    pipe(p["zsteel"], (0.12, -0.4, 0.68), (0.2, -0.5, 1.02), r=0.015, verts=4)  # mast, one side only
    ball(p["red_glow"], 0.03, (0.2, -0.5, 1.02), seg=6, rings=4)
    for s in (-1, 1):
        cable(p, (s * 0.2, -0.3, 0.8), (s * 0.3, 0.25, 0.78), sag=0.12, r=0.014)
    gun(p, (0, -0.35, 0.92), length=0.35)
    legs(p, 3, 0.26, 0.28, 0.55, 0.5, 0.22, r=0.04)


def coleoptere(p):
    """Coléoptère: a flying beetle, armoured wing cases spread over framed glass wings, two ducted fans below."""
    shell(p["zsteel"], 0.28, (0, 0.05, 0.5), scale=(0.9, 1.5, 0.6), seg=10, rings=5)
    box(p["zrust"], (0.22, 0.2, 0.17), (0, -0.42, 0.5), rot=(0.15, 0, 0))
    eyes(p, 0, -0.53, 0.52, n=2, r=0.028, spread=0.1)
    for s in (-1, 1):
        o = shell(p["team"], 0.3, (s * 0.24, 0.1, 0.62), scale=(0.5, 1.2, 0.18), seg=8, rings=4)  # wing case
        o.rotation_euler = (0, s * 0.5, s * 0.25)
        box(p["dark_glass"], (0.55, 0.3, 0.01), (s * 0.5, 0.22, 0.6), rot=(0, s * -0.15, s * 0.35))  # wing
        for dy in (-0.15, 0.15):  # frame
            box(p["zsteel"], (0.56, 0.02, 0.02), (s * 0.5, 0.22 + dy, 0.6), rot=(0, s * -0.15, s * 0.35))
        box(p["cyan_glow"], (0.5, 0.012, 0.012), (s * 0.5, 0.22, 0.61), rot=(0, s * -0.15, s * 0.35))
        ring(p["zsteel"], 0.08, 0.02, (s * 0.14, 0.22, 0.27), seg=10)  # ducted fan
        cyl(p["cyan_glow"], 0.06, 0.02, (s * 0.14, 0.22, 0.27), verts=8)
        cable(p, (s * 0.1, -0.1, 0.42), (s * 0.14, 0.2, 0.3), sag=0.04, r=0.01)
    gun(p, (0, -0.3, 0.36), length=0.3)


def intelligence(p):
    """Intelligence centrale: the nest's mind folded under rusted, faceted shells, asymmetric like a crouching
    insect, server fins on its flank, a red eye cluster, antennae masts, and live wires spilling into the creep."""
    cyl(p["graphite"], 2.3, 0.3, (0, 0, 0.15), verts=10)
    for k, (r, z, sx) in enumerate(((1.9, 0.9, 1.0), (1.55, 1.55, 0.92), (1.1, 2.1, 0.85))):
        o = shell(p["zsteel"] if k != 1 else p["zrust"], r, (0.15 * k, 0.1 * k, z), scale=(sx, 1.15, 0.5), seg=10, rings=5)
        o.rotation_euler = (0, 0, 0.3 * k)
        ring(p["cyan_glow"], r * 0.98, 0.03, (0.15 * k, 0.1 * k, z - 0.05), seg=20)
    for k in range(5):  # dorsal plates in team colour
        a = k / 5 * math.tau + 0.4
        box(p["team"], (0.5, 0.9, 0.08), (math.cos(a) * 1.2, math.sin(a) * 1.2, 1.35), rot=(0.4 * math.sin(a), -0.4 * math.cos(a), a))
    for k in range(6):  # server fins
        box(p["graphite"], (0.06, 0.7, 0.6), (1.75, 0.3 + k * 0.0, 0.85), rot=(0, 0, 0.15 * k - 0.4))
    eyes(p, 0.35, -0.85, 2.15, n=3, r=0.12, spread=0.3)  # the mind's eyes
    for s, h in ((-1, 1.4), (1, 1.0)):  # antennae masts
        pipe(p["zsteel"], (s * 0.4, -0.8, 2.2), (s * 0.9, -1.8, 2.2 + h), r=0.05, verts=4)
        for t in (0.4, 0.7):
            q = Vector((s * 0.4, -0.8, 2.2)).lerp(Vector((s * 0.9, -1.8, 2.2 + h)), t)
            box(p["zsteel"], (0.3, 0.03, 0.03), q)
        ball(p["red_glow"], 0.07, (s * 0.9, -1.8, 2.2 + h), seg=6, rings=4)
    for k in range(9):  # live wires into the ground
        a = k / 9 * math.tau + 0.2
        cable(p, (math.cos(a) * 1.7, math.sin(a) * 1.7, 0.75), (math.cos(a + 0.3) * 2.5, math.sin(a + 0.3) * 2.5, 0.05), sag=0.25, r=0.06)
    for x, y in ((-2.0, 1.2), (1.8, 1.5), (-1.4, -1.9)):  # relay pylons
        cyl(p["zsteel"], 0.15, 0.6, (x, y, 0.4), verts=6)
        for z in (0.55, 0.7):
            ring(p["zcopper"], 0.13, 0.03, (x, y, z), seg=10)
        ball(p["cyan_glow"], 0.1, (x, y, 0.8), seg=6, rings=4)


def pod(p):
    """Pod: a riveted steel cocoon on cable roots, copper coils around its waist, a cyan seam where the supply
    cells charge, a beacon on top."""
    for k in range(6):
        a = k / 6 * math.tau
        cable(p, (math.cos(a) * 0.4, math.sin(a) * 0.4, 0.55), (math.cos(a + 0.4) * 0.95, math.sin(a + 0.4) * 0.95, 0.04), sag=0.1, r=0.05)
    shell(p["zsteel"], 0.6, (0, 0, 0.95), scale=(0.85, 0.85, 1.15), seg=10, rings=6)
    for z in (0.65, 0.95, 1.25):
        ring(p["zrust"], 0.53 - abs(z - 0.95) * 0.3, 0.04, (0, 0, z), seg=12)
    ring(p["zcopper"], 0.5, 0.025, (0, 0, 0.82), seg=16)
    ring(p["zcopper"], 0.5, 0.025, (0, 0, 0.88), seg=16)
    box(p["cyan_glow"], (0.04, 0.04, 0.8), (0.05, -0.5, 0.95), rot=(0.12, 0, 0))  # seam
    box(p["team"], (0.3, 0.05, 0.25), (0.25, 0.45, 1.05), rot=(-0.2, 0, 0.5))
    cone(p["zsteel"], 0.12, 0.35, (0, 0, 1.75), verts=6)
    ball(p["red_glow"], 0.06, (0, 0, 1.95), seg=6, rings=4)


def assimilateur(p):
    """Assimilateur: a steel spider clamped over the energy well on three jacked legs, a pump body with copper
    coils drinking the light, pipes running down."""
    cyl(p["graphite"], 1.25, 0.2, (0, 0, 0.1), verts=9)
    for k in range(3):
        a = k / 3 * math.tau + 0.3
        joint_leg(p, (math.cos(a) * 0.5, math.sin(a) * 0.5, 1.4), (math.cos(a) * 1.25, math.sin(a) * 1.25, 1.7), (math.cos(a) * 1.35, math.sin(a) * 1.35, 0.15), r=0.09)
        box(p["team"], (0.08, 0.35, 0.3), (math.cos(a) * 0.95, math.sin(a) * 0.95, 1.55), rot=(0, 0.6, a))
        b = a + math.pi / 3
        pipe(p["zrust"], (math.cos(b) * 0.4, math.sin(b) * 0.4, 1.2), (math.cos(b) * 0.55, math.sin(b) * 0.55, 0.2), r=0.06, verts=6)
        cyl(p["zsteel"], 0.11, 0.06, (math.cos(b) * 0.55, math.sin(b) * 0.55, 0.23), verts=6)  # flange into the well
        cyl(p["zsteel"], 0.09, 0.06, (math.cos(b) * 0.4, math.sin(b) * 0.4, 1.18), verts=6)
    shell(p["zsteel"], 0.55, (0, 0, 1.45), scale=(1, 1, 0.75), seg=10, rings=5)
    cyl(p["purple_glow"], 0.16, 1.2, (0, 0, 0.7), verts=10)  # drawn energy
    for z in (1.05, 1.13, 1.21):
        ring(p["zcopper"], 0.24, 0.035, (0, 0, z), seg=12)
    ring(p["cyan_glow"], 0.5, 0.03, (0, 0, 1.3), seg=18)
    cone(p["zsteel"], 0.15, 0.5, (0.15, 0.1, 2.05), verts=6)
    ball(p["red_glow"], 0.05, (0.15, 0.1, 2.32), seg=6, rings=4)


def plateforme(p):
    """Plate-forme: a flat assembly deck with hazard edges, two jacked robot arms welding a socle, cable trays."""
    box(p["zsteel"], (2.8, 2.8, 0.25), (0, 0, 0.12))
    box(p["graphite"], (2.2, 2.2, 0.12), (0, 0, 0.3))
    for k in range(4):  # landing neon lines
        box(p["cyan_glow"], (1.8, 0.04, 0.02), (0, -0.75 + k * 0.5, 0.37))
    for s in (-1, 1):
        box(p["hazard"], (0.15, 2.6, 0.03), (s * 1.27, 0, 0.26))
    box(p["team"], (2.82, 0.2, 0.27), (0, 1.3, 0.13))
    for k, (x, y, h, reach) in enumerate(((-1.1, 1.0, 1.6, 1.2), (1.15, 0.9, 1.1, 0.8))):
        cyl(p["zrust"], 0.2, 0.4, (x, y, 0.55), verts=8)
        # Each arm is animated (zarm_<k>, its forearm zarm_<k>_tip with the welding spark) while a socle is built.
        joint_leg(p, (x, y, 0.75), (x * 0.8, y - reach * 0.3, 0.75 + h), (x * 0.3, y - reach, 0.9), r=0.07, part=f"zarm_{k}")
        ball(p["orange_glow"], 0.08, (x * 0.3, y - reach, 0.85), seg=6, rings=4, name=f"zarm_{k}_tip")  # welding spark
    cable(p, (-1.3, 1.25, 0.3), (0.1, -0.1, 0.6), sag=0.2, r=0.035)


def armement(p):
    """Centre d'armement: an armoured hive block of rusted plates, vents, a rack of barrels on its back and a
    twin gun being tested on its flank."""
    box(p["zsteel"], (2.5, 2.2, 1.0), (0, 0.1, 0.5))
    shell(p["zrust"], 1.1, (0, 0.1, 1.0), scale=(1.1, 0.95, 0.5), seg=10, rings=5)
    for k in range(5):
        cyl(p["graphite"], 0.07, 1.6, (-0.8 + k * 0.4, 0.75, 1.55), rot=(math.radians(70), 0, 0), verts=6)  # barrels
    box(p["team"], (2.52, 0.12, 0.4), (0, -1.0, 0.6))
    box(p["hazard"], (2.52, 0.13, 0.08), (0, -1.0, 0.86))
    for x in (-0.9, -0.3, 0.3):
        box(p["cyan_glow"], (0.3, 0.03, 0.05), (x, -1.0, 0.98))
    for k in range(4):  # vents
        box(p["graphite"], (0.04, 0.5, 0.06), (-1.27, -0.2, 0.3 + k * 0.12))
    cyl(p["zsteel"], 0.3, 0.3, (0.9, -0.5, 1.5), verts=8)
    gun(p, (0.9, -0.5, 1.75), length=0.7, barrels=2, r=0.05)
    cable(p, (-1.2, -0.6, 0.9), (-1.4, -1.3, 0.05), sag=0.15, r=0.07)
    cable(p, (0.6, -0.4, 1.1), (0.85, -0.45, 1.55), sag=0.08, r=0.03)


def tourelle(p):
    """Tourelle: a steel tower on three clawed, jacked feet, its head a twin heavy machine gun with an ammo box
    and a red sensor eye."""
    for k in range(3):
        a = k / 3 * math.tau + 0.5
        joint_leg(p, (math.cos(a) * 0.25, math.sin(a) * 0.25, 0.9), (math.cos(a) * 0.7, math.sin(a) * 0.7, 1.0), (math.cos(a) * 0.85, math.sin(a) * 0.85, 0.05), r=0.06)
    cyl(p["zrust"], 0.25, 1.0, (0, 0, 0.6), verts=6, r2=0.18)
    box(p["team"], (0.3, 0.06, 0.3), (0, 0.24, 0.7))
    shell(p["zsteel"], 0.32, (0, 0, 1.35), scale=(1, 1.2, 0.7))
    gun(p, (0, -0.2, 1.4), length=0.75, barrels=2, r=0.04)
    box(p["hazard"], (0.22, 0.22, 0.16), (-0.3, 0.1, 1.35))  # ammo box
    eyes(p, 0.18, -0.32, 1.55, n=1, r=0.05)


MODELS = {
    "baliste": baliste, "espion": espion, "dragon": dragon, "voyageur": voyageur, "behemoth": behemoth,
    "orbecommandement": orbecommandement, "trone": trone, "deflecteur": deflecteur,
    "scarabee": scarabee,
    "cuve": cuve,
    "marche": marche,
    "serf": serf, "auxiliaire": auxiliaire, "legionnaire": legionnaire, "soigneur": soigneur,
    "conseil": conseil, "grenier": grenier, "caserne": caserne, "mine": mine, "minerai": minerai, "puits": puits,
    "minerai_1": minerai_1, "minerai_2": minerai_2, "minerai_3": minerai_3,
    "moissonneur": moissonneur, "archer": archer, "creature": creature, "druide": druide,
    "obelisque": obelisque, "emetteur": emetteur, "reservepsy": reservepsy, "portail": portail, "recepteur": recepteur,
    "drone": drone, "dronecombat": dronecombat, "quadripode": quadripode, "hexapode": hexapode, "coleoptere": coleoptere,
    "intelligence": intelligence, "pod": pod, "assimilateur": assimilateur, "plateforme": plateforme, "armement": armement, "tourelle": tourelle,
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
        slot = o.material_slots[poly.material_index].name if poly.material_index < len(o.material_slots) else ""
        stone = slot.startswith(("boulder", "rock"))
        steel = slot.startswith(("zsteel", "zrust"))
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            z = me.vertices[vi].co.z
            h = (z - z0) / span
            shade = (0.72 + 0.34 * h) * stroke
            if stone:
                # Stone: strata, speckled grit, and darker hollows.
                co = me.vertices[vi].co
                shade *= 0.6 + 0.14 * math.sin(co.z * 22 + co.x * 3) + 0.28 * (((vi * 2654435761) % 1000) / 1000)
            if n.z > 0.7:
                shade += 0.1
            if bevel:
                shade += 0.28
            if steel:
                # Rust: stains that gather low and run down in streaks, worn bright metal on the edges.
                co = me.vertices[vi].co
                streak = 0.5 + 0.5 * math.sin(co.x * 31 + co.y * 17 + math.sin(co.z * 9) * 2)
                grain = ((vi * 2654435761) % 1000) / 1000
                rust = min(1, max(0, (1 - h) * 0.7 + streak * 0.35 + grain * 0.3 - 0.55 - (0.4 if bevel else 0)))
                col.data[li].color = (min(1, shade), min(1, shade * (1 - 0.42 * rust)), min(1, shade * (1 - 0.65 * rust)), 1)
                continue
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
    box_uv(o)
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
    # Z legs: each shin hangs from its femur, so it follows the femur and bends at the knee.
    by_name = {o.name: o for o in parts}
    for o in parts:
        upper = o.name.replace("zshin_", "zleg_") if o.name.startswith("zshin_") else o.name[: -len("_tip")] if o.name.endswith("_tip") else None
        if upper in by_name:
            femur = by_name[upper]
            world = o.matrix_world.copy()
            o.parent = femur
            o.matrix_world = world
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
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True, export_vertex_color="ACTIVE", export_image_format="JPEG", export_jpeg_quality=85)


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
        # The joined object takes the active part's transform: bake it, or a rotated first part tips the prop over.
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
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
for name, fn in DRESS.items():
    if ONLY and f"{name}-dress" not in ONLY:
        continue
    objs = dress(name, fn)
    export(objs, os.path.join(OUT, f"{name}-dress.glb"))
    print(f"DRESS {name}: {sum(len(o.data.polygons) for o in objs)} faces")
if not ONLY or "doodads" in ONLY:
    export_doodads(os.path.join(OUT, "doodads.glb"))
