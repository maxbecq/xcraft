"""Three Human civic buildings modelled in Blender from their chosen Mistral boards (refonte-humains/*-variantes.jpg):
the Grenier à silo (a stone granary joined to a round silo tower), the Conseil des Échevins (a civic hall on open
arcades under a large slate roof and a glass lantern) and the Marché (a small Baltard pavilion of cast iron and glass).
Sober on purpose: big masses that read at the game's size. Pale stone, slate roofs, the team colour on banners and
glowing bands (the blue swatch, which teamSkin repaints). One textured material, `meshy`, from a small painted atlas,
so they take the team colour and the Human skin as the other Meshy buildings. The façade faces -Y here (+Z in the
game), feet at the origin, sized in tiles (the Grenier's size 2 is about 1.9 wide, the Conseil's size 4 about 4.1).
Usage: Blender -b --factory-startup -P tools/meshy/civils.py -- silo|conseil|marche out.glb
then compress.sh.
"""
import math
import sys

import bmesh
import bpy
import numpy as np

kind, dst = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
rng = np.random.default_rng(11)

# --- The atlas: 4 x 4 swatches of painted colour with a little grain. Human buildings are drawn livelier in the game
# (teamSkin `vivid`: saturation x1.35, light x1.3), so these are a shade duller than wanted on screen.
S, CELL = 256, 64
SWATCH = {
    "stone": (0, 0, (0.50, 0.47, 0.42)),
    "stone2": (1, 0, (0.44, 0.42, 0.38)),  # plinths, piers, cornices
    "slate": (2, 0, (0.17, 0.18, 0.22)),
    "blue": (3, 0, (0.10, 0.20, 0.72)),  # the team colour's mask
    "brass": (0, 1, (0.55, 0.38, 0.12)),
    "wood": (1, 1, (0.30, 0.18, 0.10)),
    "iron": (2, 1, (0.13, 0.16, 0.15)),  # Baltard's dark green-grey cast iron
    "glass": (3, 1, (0.50, 0.58, 0.60)),
    "dark": (0, 2, (0.06, 0.06, 0.07)),  # the depth of the arcades and doorways
    "warm": (1, 2, (0.80, 0.48, 0.20)),  # warm windows: render/life.ts lights them
    "cobble": (2, 2, (0.40, 0.39, 0.37)),
}
img = np.zeros((S, S, 4))
img[..., 3] = 1
for name, (cx, cy, col) in SWATCH.items():
    grain = 1 + 0.035 * rng.standard_normal((CELL, CELL, 1))
    # dark at the swatch's foot, light at its head: faces map their height onto it (grime low, light on the tops);
    # Blender's image rows run from the bottom
    shade = np.linspace(0.62, 1.08, CELL)[:, None, None] if name not in ("blue", "warm") else 1
    img[cy * CELL:(cy + 1) * CELL, cx * CELL:(cx + 1) * CELL, :3] = np.clip(np.array(col) * grain * shade, 0, 1)
atlas = bpy.data.images.new("civils_atlas", S, S)
atlas.pixels[:] = img.ravel()
atlas.pack()
mat = bpy.data.materials.new("meshy")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Roughness"].default_value = 0.8
tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
tex.image = atlas
mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
# The lit bands and corners: `team_glow`, which render/models.ts turns into the team colour's glowing veins (as the
# other Human buildings' blue lights).
lit = bpy.data.materials.new("team_glow")
lit.use_nodes = True
lit.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.2, 0.45, 1.0, 1)

parts = []
TOP = {"silo": 3.3, "conseil": 4.2, "marche": 2.8}.get(kind, 3.0)  # the height that maps to the swatches' light head


def add(o, pick, smooth=False):
    """Paints every face of `o` with the swatch pick(face centre, normal) names (a string: the same for all)."""
    me = o.data
    if pick == "lit":
        me.materials.clear()
        me.materials.append(lit)
        parts.append(o)
        return o
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    me.materials.clear()
    me.materials.append(mat)
    for p in me.polygons:
        name = pick if isinstance(pick, str) else pick(o.matrix_world @ p.center, o.matrix_world.to_3x3() @ p.normal)
        cx, cy, _ = SWATCH[name]
        jx = rng.uniform(0.2, 0.8)
        for li in p.loop_indices:
            z = (o.matrix_world @ me.vertices[me.loops[li].vertex_index].co).z
            jy = 0.06 + 0.88 * min(1.0, max(0.0, z / TOP)) ** 0.6  # each corner by its own height: a gradient up the wall
            uv[li].uv = ((cx + jx) * CELL / S, (cy + jy) * CELL / S)
        p.use_smooth = smooth
    parts.append(o)
    return o


def box(x0, x1, y0, y1, z0, z1, pick):
    bpy.ops.mesh.primitive_cube_add(size=1, location=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    o = bpy.context.object
    o.scale = (x1 - x0, y1 - y0, z1 - z0)
    bpy.ops.object.transform_apply(scale=True)
    return add(o, pick)


def mesh(name, verts, faces, pick):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return add(o, pick)


def gable(x0, x1, y0, y1, z0, z1, along="y", over=0.06, pick="slate", ends="stone"):
    """A pitched roof, its ridge along `along`, eaves at z0 overhanging by `over`, ridge at z1; its gable ends walled."""
    if along == "y":
        xm = (x0 + x1) / 2
        a, b = x0 - over, x1 + over
        v = [(a, y0 - over, z0), (xm, y0 - over, z1), (b, y0 - over, z0), (a, y1 + over, z0), (xm, y1 + over, z1), (b, y1 + over, z0)]
        # the eave's slope runs past the wall by `over`: the roof drops below z0 there
        drop = over * (z1 - z0) / ((x1 - x0) / 2)
        v = [(x, y, z - drop if z == z0 else z) for x, y, z in v]
        mesh("roof", v, [(0, 1, 4, 3), (1, 2, 5, 4), (0, 3, 5, 2)], pick)
        # the walled gables, under the roof
        mesh("gable", [(x0, y0, z0), (xm, y0, z1 - 0.03), (x1, y0, z0), (x0, y1, z0), (xm, y1, z1 - 0.03), (x1, y1, z0)], [(0, 2, 1), (3, 4, 5)], ends)
    else:
        ym = (y0 + y1) / 2
        drop = over * (z1 - z0) / ((y1 - y0) / 2)
        v = [(x0 - over, y0 - over, z0 - drop), (x0 - over, ym, z1), (x0 - over, y1 + over, z0 - drop),
             (x1 + over, y0 - over, z0 - drop), (x1 + over, ym, z1), (x1 + over, y1 + over, z0 - drop)]
        mesh("roof", v, [(0, 3, 4, 1), (1, 4, 5, 2), (0, 2, 5, 3)], pick)
        mesh("gable", [(x0, y0, z0), (x0, ym, z1 - 0.03), (x0, y1, z0), (x1, y0, z0), (x1, ym, z1 - 0.03), (x1, y1, z0)], [(0, 1, 2), (3, 5, 4)], ends)


def hip(cx, cy, w, d, z0, z1, top=0.0, pick="slate"):
    """A hipped roof (a frustum, or a pyramid when top is 0) over a w x d rectangle."""
    tw, td = w * top / 2, d * top / 2
    w, d = w / 2, d / 2
    v = [(cx - w, cy - d, z0), (cx + w, cy - d, z0), (cx + w, cy + d, z0), (cx - w, cy + d, z0)]
    if top:
        v += [(cx - tw, cy - td, z1), (cx + tw, cy - td, z1), (cx + tw, cy + td, z1), (cx - tw, cy + td, z1)]
        f = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7), (3, 2, 1, 0)]
    else:
        v += [(cx, cy, z1)]
        f = [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (3, 2, 1, 0)]
    return mesh("hip", v, f, pick)


def cyl(x, y, z0, z1, r, pick, n=20, r2=None):
    """A vertical cylinder (or a cone when r2 is given) from z0 to z1."""
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=n, radius=r, depth=z1 - z0, location=(x, y, (z0 + z1) / 2))
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=n, radius1=r, radius2=r2, depth=z1 - z0, location=(x, y, (z0 + z1) / 2))
    return add(bpy.context.object, pick, smooth=r2 is None)


def arch(x, y, w, z0, z1, pick, depth=0.02):
    """An arched opening on a wall facing -Y at `y`: a rectangle with a half disc on top, `depth` proud of the wall."""
    r = w / 2
    box(x - r, x + r, y - depth, y, z0, z1 - r, pick)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=r, depth=depth, location=(x, y - depth / 2, z1 - r), rotation=(math.pi / 2, 0, 0))
    o = bpy.context.object
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if (o.matrix_world @ v.co).z < z1 - r - 1e-4], context="VERTS")
    bm.to_mesh(o.data)
    bm.free()
    return add(o, pick)


def banner(x, y, z0, z1, w=0.14, face=-1):
    """A team-coloured banner hung on a wall facing -Y (face -1) or +X/-X (face +-2), on a brass rod."""
    t = 0.015
    if abs(face) == 1:
        box(x - w / 2, x + w / 2, y - t, y, z0, z1, "blue")
        box(x - w / 2 - 0.02, x + w / 2 + 0.02, y - t - 0.02, y, z1, z1 + 0.025, "brass")
    else:
        s = 1 if face > 0 else -1
        x0, x1 = (x, x + t) if s > 0 else (x - t, x)
        box(x0, x1, y - w / 2, y + w / 2, z0, z1, "blue")
        box(min(x0, x1) - 0.01, max(x0, x1) + 0.01, y - w / 2 - 0.02, y + w / 2 + 0.02, z1, z1 + 0.025, "brass")


def frame(x0, x1, y0, y1, z0, z1, t=0.05):
    """A lit band round a rectangle, as four thin bars: a solid slab would spread its halo (render/models.ts veinHalo,
    a shell pushed 0.13 out along the normals) over the whole roof."""
    box(x0, x1, y0, y0 + t, z0, z1, "lit")
    box(x0, x1, y1 - t, y1, z0, z1, "lit")
    box(x0, x0 + t, y0 + t, y1 - t, z0, z1, "lit")
    box(x1 - t, x1, y0 + t, y1 - t, z0, z1, "lit")


def glow(x, y, z0, z1, w=0.05):
    """A vertical glowing strip in the team colour, w square, as the other Human buildings' lit corners."""
    box(x - w / 2, x + w / 2, y - w / 2, y + w / 2, z0, z1, "lit")


def ring(x, y, z, r, h, pick="lit"):
    """A band round a tower, a little proud of it."""
    cyl(x, y, z, z + h, r + 0.015, pick, n=24)


# ------------------------------------------------------------------------------------------------------------------
if kind == "silo":
    # A stone granary, gable to the front, joined to a round silo tower on its right: taller than the Grenier.
    hx0, hx1, hy0, hy1 = -1.02, 0.2, -0.86, 0.78
    box(hx0 - 0.04, hx1 + 0.04, hy0 - 0.04, hy1 + 0.04, 0, 0.14, "stone2")  # plinth
    box(hx0, hx1, hy0, hy1, 0.14, 1.08, "stone")
    gable(hx0, hx1, hy0, hy1, 1.08, 1.82, along="y", over=0.08)
    xm = (hx0 + hx1) / 2
    arch(xm, hy0, 0.38, 0.14, 0.78, "wood")  # the door
    box(xm - 0.24, xm + 0.24, hy0 - 0.03, hy0, 0.78, 0.83, "stone2")
    arch(xm, hy0, 0.2, 1.16, 1.44, "warm")  # a lit loft window in the gable
    banner(hx0 + 0.15, hy0, 0.42, 0.98, w=0.16)
    banner(hx1 - 0.15, hy0, 0.42, 0.98, w=0.16)
    frame(hx0 - 0.02, hx1 + 0.02, hy0 - 0.02, hy1 + 0.02, 0.99, 1.04)  # a glowing band under the eaves
    frame(hx0 - 0.06, hx1 + 0.06, hy0 - 0.06, hy1 + 0.06, 0.14, 0.18)  # and one on the plinth
    for x in (hx0, hx1):
        glow(x, hy0, 0.14, 1.04)
    # The silo tower.
    tx, ty, tr = 0.55, -0.02, 0.47
    cyl(tx, ty, 0, 0.16, tr + 0.05, "stone2", n=24)
    ring(tx, ty, 0.16, tr, 0.04)
    cyl(tx, ty, 0.16, 2.5, tr, "stone", n=24)
    ring(tx, ty, 1.95, tr, 0.1)
    for z in (0.75, 1.35):
        ring(tx, ty, z, tr, 0.05, "stone2")
    cyl(tx, ty, 2.5, 2.58, tr + 0.07, "stone2", n=24)
    cyl(tx, ty, 2.58, 3.35, tr + 0.08, "slate", n=24, r2=0.0)
    cyl(tx, ty, 3.3, 3.42, 0.025, "brass", n=8)
    # a round hatch low on its front and a brass chute from it into the granary
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.11, depth=0.05, location=(tx + 0.12, ty - tr + 0.0, 0.5), rotation=(math.pi / 2, 0, 0))
    add(bpy.context.object, "iron")
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.05, depth=0.42, location=(0.12, -0.1, 1.55), rotation=(0, math.pi / 2, 0))
    add(bpy.context.object, "brass", smooth=True)
    banner(tx, ty - tr, 1.42, 1.9, w=0.18)

elif kind == "conseil":
    # A civic hall on open arcades: a long stone body, five arches across its front, a big slate roof with its ridge
    # across, a glass lantern lit in the team colour on the ridge, short pinnacles at the gables, banners. No battlements.
    x0, x1, y0, y1 = -1.95, 1.95, -1.2, 1.4
    box(x0 - 0.1, x1 + 0.1, y0 - 0.45, y1 + 0.1, 0, 0.1, "cobble")  # its forecourt and footing
    box(x0 - 0.04, x1 + 0.04, y0 - 0.04, y1 + 0.04, 0.1, 0.22, "stone2")
    box(x0, x1, y0, y1, 0.22, 1.62, "stone")
    for i in range(5):
        x = -1.52 + i * 0.76
        arch(x, y0, 0.5, 0.22, 1.18, "dark", depth=0.015)
        if i:  # a pier between two arches
            box(x - 0.43, x - 0.33, y0 - 0.06, y0, 0.22, 1.24, "stone2")
    for x in (x0, x1):  # corner buttresses
        box(x - 0.1, x + 0.1, y0 - 0.1, y0 + 0.1, 0.22, 1.7, "stone2")
        box(x - 0.1, x + 0.1, y1 - 0.1, y1 + 0.1, 0.22, 1.7, "stone2")
    box(x0 + 0.1, x1 - 0.1, y0 - 0.04, y0, 1.3, 1.4, "lit")  # the glowing band above the arcades
    frame(x0 - 0.06, x1 + 0.06, y0 - 0.06, y1 + 0.06, 0.22, 0.27)  # and one round its footing
    for x in (x0, x1):  # lit corners on the buttresses
        glow(x + (0.1 if x > 0 else -0.1), y0 - 0.1, 0.27, 1.7)
    box(x0 + 0.1, x1 - 0.1, (y0 + y1) / 2 - 0.03, (y0 + y1) / 2 + 0.03, 2.74, 2.8, "lit")  # a glowing ridge
    box(x0 - 0.02, x1 + 0.02, y0 - 0.06, y1 + 0.06, 1.56, 1.66, "stone2")  # cornice
    banner(x0, -0.3, 0.55, 1.45, w=0.22, face=-2)
    banner(x1, -0.3, 0.55, 1.45, w=0.22, face=2)
    for x in (-1.84, 1.84):
        box(x - 0.11, x + 0.11, y0 - 0.12, y0 - 0.1, 0.5, 1.5, "blue")  # tall banners on the corner buttresses
    # side doors and warm windows on the gable ends
    for x, s in ((x0, -1), (x1, 1)):
        for y in (0.45,):
            xx = x + s * 0.012
            box(min(x, xx), max(x, xx), y - 0.14, y + 0.14, 0.22, 0.72, "wood")
        for y in (-0.55, 0.45):
            box(min(x, x + s * 0.012), max(x, x + s * 0.012), y - 0.08, y + 0.08, 1.0, 1.36, "warm")
    gable(x0, x1, y0, y1, 1.66, 2.75, along="x", over=0.1)
    for x in (x0 - 0.02, x1 + 0.02):  # pinnacles at the gables' apexes
        cyl(x, (y0 + y1) / 2, 2.55, 2.75, 0.1, "stone2", n=8)
        cyl(x, (y0 + y1) / 2, 2.75, 3.3, 0.1, "slate", n=8, r2=0.0)
    # dormers on the front slope
    for x in (-1.05, 1.05):
        box(x - 0.2, x + 0.2, -0.95, -0.35, 1.7, 2.22, "stone")
        box(x - 0.11, x + 0.11, -0.965, -0.95, 1.78, 2.1, "warm")
        gable(x - 0.2, x + 0.2, -0.95, -0.35, 2.22, 2.46, along="y", over=0.03)
    # the lantern on the ridge: a glass box glowing in the team colour, a slate spire with a brass finial
    cx, cy = 0.0, (y0 + y1) / 2
    box(cx - 0.46, cx + 0.46, cy - 0.46, cy + 0.46, 2.45, 2.62, "stone2")
    box(cx - 0.38, cx + 0.38, cy - 0.38, cy + 0.38, 2.62, 3.3, "blue")
    for dx in (-0.38, 0.0, 0.38):  # its stone mullions
        for dy in (-0.38, 0.38):
            box(cx + dx - 0.045, cx + dx + 0.045, cy + dy - 0.045, cy + dy + 0.045, 2.62, 3.3, "stone2")
            box(cx + dy - 0.045, cx + dy + 0.045, cy + dx - 0.045, cy + dx + 0.045, 2.62, 3.3, "stone2")
    box(cx - 0.46, cx + 0.46, cy - 0.46, cy + 0.46, 3.3, 3.4, "stone2")
    hip(cx, cy, 0.92, 0.92, 3.4, 4.15)
    cyl(cx, cy, 4.1, 4.25, 0.03, "brass", n=8)

elif kind == "marche":
    # A small Baltard pavilion: a stone plinth, a square hall of cast-iron columns and glass, a two-tier slate roof with
    # glowing team bands at the eaves, a small lantern; crates and barrels at the door. Size 3, drawn about 2.4 wide.
    h = 1.08  # half width of the glass hall
    box(-h - 0.14, h + 0.14, -h - 0.14, h + 0.14, 0, 0.14, "stone2")
    box(-h + 0.03, h - 0.03, -h + 0.03, h - 0.03, 0.14, 1.28, "glass")
    cols = [-h, -h / 3, h / 3, h]
    for a in cols:  # cast-iron columns round the hall, their capitals in brass
        for x, y in ((a, -h), (a, h), (-h, a), (h, a)):
            box(x - 0.045, x + 0.045, y - 0.045, y + 0.045, 0.14, 1.28, "iron")
            box(x - 0.065, x + 0.065, y - 0.065, y + 0.065, 1.2, 1.26, "brass")
    for s in (-1, 1):  # iron sills and lintels between them
        box(-h, h, s * h - 0.04, s * h + 0.04, 0.14, 0.3, "iron")
        box(s * h - 0.04, s * h + 0.04, -h, h, 0.14, 0.3, "iron")
        box(-h, h, s * h - 0.05, s * h + 0.05, 1.26, 1.36, "iron")
        box(s * h - 0.05, s * h + 0.05, -h, h, 1.26, 1.36, "iron")
    for a in ((cols[0] + cols[1]) / 2, 0.0, (cols[2] + cols[3]) / 2):  # the bays' arched tops, in iron
        for x, y, face in ((a, -h, "y"), (a, h, "y"), (-h, a, "x"), (h, a, "x")):
            if face == "y":
                box(x - 0.3, x + 0.3, y - 0.05, y + 0.05, 1.06, 1.12, "iron")
            else:
                box(x - 0.05, x + 0.05, y - 0.3, y + 0.3, 1.06, 1.12, "iron")
    # the front middle bay open: its doorway dark, warm light inside
    box(-0.3, 0.3, -h - 0.002, -h + 0.04, 0.3, 1.06, "dark")
    box(-0.16, 0.16, -h + 0.04, -h + 0.06, 0.4, 0.8, "warm")
    frame(-h - 0.12, h + 0.12, -h - 0.12, h + 0.12, 1.36, 1.44, t=0.06)  # the eaves' glowing band
    frame(-h - 0.16, h + 0.16, -h - 0.16, h + 0.16, 0.1, 0.14)  # and one round the plinth
    for x in (-h, h):  # lit corner columns
        for y in (-h, h):
            glow(x + 0.03 * (1 if x > 0 else -1), y + 0.03 * (1 if y > 0 else -1), 0.14, 1.28, w=0.045)
    hip(0, 0, 2 * h + 0.3, 2 * h + 0.3, 1.44, 1.66, top=0.55)
    box(-0.6, 0.6, -0.6, 0.6, 1.66, 1.98, "glass")  # the clerestory
    for x in (-0.6, -0.2, 0.2, 0.6):
        for y in (-0.6, 0.6):
            box(x - 0.035, x + 0.035, y - 0.035, y + 0.035, 1.66, 1.98, "iron")
            box(y - 0.035, y + 0.035, x - 0.035, x + 0.035, 1.66, 1.98, "iron")
    frame(-0.68, 0.68, -0.68, 0.68, 1.98, 2.05)
    hip(0, 0, 1.36, 1.36, 2.05, 2.32, top=0.3)
    box(-0.14, 0.14, -0.14, 0.14, 2.32, 2.48, "glass")  # the little lantern
    hip(0, 0, 0.36, 0.36, 2.48, 2.64)
    cyl(0, 0, 2.62, 2.74, 0.02, "brass", n=8)
    for x in (-h - 0.04, h + 0.04):  # banners on the front corners
        box(x - 0.08, x + 0.08, -h - 0.1, -h - 0.08, 0.5, 1.12, "blue")
    # crates and barrels by the door
    box(-0.78, -0.52, -h - 0.42, -h - 0.18, 0.14, 0.36, "wood")
    box(-0.74, -0.56, -h - 0.38, -h - 0.22, 0.36, 0.52, "wood")
    for x in (0.52, 0.76):
        cyl(x, -h - 0.3, 0.14, 0.44, 0.11, "wood", n=12)
        ring(x, -h - 0.3, 0.36, 0.11, 0.03, "iron")
else:
    raise SystemExit(f"unknown building {kind}")

bpy.ops.object.select_all(action="DESELECT")
for p in parts:
    p.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
body = bpy.context.object
body.name = "body"
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
print(kind.upper(), len(body.data.polygons), "faces", [round(c, 2) for c in body.dimensions])
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB")
