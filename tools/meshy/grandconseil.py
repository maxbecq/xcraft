"""The Grand Conseil built from the Conseil des échevins itself: its model and dress as they are, its corner tower's
slate pyramid taken off and a belfry raised on it in the Brussels manner, kept discreet: two stone tiers (tall cyan
windows, a blue band, a cyan clock on each face, slate pinnacles at the corners), an octagonal lantern with cyan
lights and a slate spire with a brass finial.
The belfry is joined to the Conseil's mesh and painted from its texture: six flat swatches (stone, dark stone, slate,
blue, cyan, brass) are painted into texels no face uses, and each part's faces all point at one. So it takes the
team colour and the living Human skin like the rest, and render/models.ts belfryGlow lights its cyan: the windows
and clocks steady (between 43 % and 73 % of the height), the lantern's lights blinking above.
Usage: Blender -b --factory-startup -P tools/meshy/grandconseil.py -- conseil-meshy.glb conseil-dress.glb out.glb
"""
import math
import sys

import bmesh
import bpy

body_src, dress_src, dst = sys.argv[sys.argv.index("--") + 1:][:3]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=body_src)
body = next(o for o in bpy.context.scene.objects if o.type == "MESH")
bpy.ops.import_scene.gltf(filepath=dress_src)
M = body.matrix_world

# --- The swatches, in texels no face of the Conseil uses (found on its UVs: a free run along the bottom right).
SW = {"stone": (104, 95, 80), "dark": (68, 62, 54), "slate": (38, 44, 60), "blue": (22, 52, 92), "cyan": (90, 235, 255), "brass": (110, 80, 40)}
G = 64  # the UV grid the free cells were found on: 8 texels each at 512
CELLS = {k: (36 + 4 * i, 1) for i, k in enumerate(SW)}
img = next(i for i in bpy.data.images if i.size[0] > 0)
W, H = img.size
assert (W, H) == (512, 512), (W, H)
px = list(img.pixels[:])
for k, (cx, cy) in CELLS.items():
    # Painted a cell beyond the swatch on every side, so no blur or mipmap reaches past its colour; colours are
    # sRGB bytes, Blender holds this image's pixels as they are in the file.
    c = [v / 255 for v in SW[k]]
    for y in range((cy - 1) * 8, (cy + 3) * 8):
        for x in range((cx - 1) * 8, (cx + 3) * 8):
            i = (y * W + x) * 4
            px[i:i + 3] = c
img.pixels[:] = px
img.file_format = "PNG"
img.pack()  # the painted pixels are what the export writes, not the texture as it was imported
UV = {k: ((cx + 1) / G, (cy + 1) / G) for k, (cx, cy) in CELLS.items()}

# --- The corner tower: its slate pyramid off (every face above its eaves inside its walls).
TX0, TX1, TY0, TY1, EAVES = -1.75, -0.35, -1.5, -0.1, 3.58
bm = bmesh.new()
bm.from_mesh(body.data)
roof = [f for f in bm.faces if (lambda c: TX0 < c.x < TX1 and TY0 < c.y < TY1 and c.z > EAVES)(M @ f.calc_center_median())]
bmesh.ops.delete(bm, geom=roof, context="FACES")
bm.to_mesh(body.data)
bm.free()
print("ROOF off", len(roof), "faces")
cx, cy, zb = -1.04, -0.82, 3.55  # the tower's middle and the top of its eaves

parts = []


def part(obj, swatch):
    """One of the belfry's parts, all its faces on one swatch (in a UV layer named as the Conseil's, so they join)."""
    name = body.data.uv_layers.active.name
    if obj.data.uv_layers:
        obj.data.uv_layers[0].name = name
    else:
        obj.data.uv_layers.new(name=name)
    for d in obj.data.uv_layers[0].data:
        d.uv = UV[swatch]
    obj.data.materials.append(body.data.materials[0])
    parts.append(obj)
    return obj


def box(sx, sy, sz, x, y, z, swatch, rot=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z), rotation=(0, 0, rot))
    o = bpy.context.object
    o.scale = (sx, sy, sz)
    return part(o, swatch)


def cyl(r, h, x, y, z, swatch, n=8, r2=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=n, radius1=r, radius2=r if r2 is None else r2, depth=h, location=(x, y, z), rotation=rot)
    return part(bpy.context.object, swatch)


# First tier: a stone block, a blue band, two tall cyan windows on each face, a dark cornice, slate pinnacles.
T1, H1 = 0.9, 0.75
box(T1, T1, H1, cx, cy, zb + H1 / 2, "stone")
box(T1 + 0.03, T1 + 0.03, 0.06, cx, cy, zb + 0.16, "blue")
box(T1 + 0.1, T1 + 0.1, 0.08, cx, cy, zb + H1 + 0.04, "dark")
for a in range(4):
    nx, ny = math.cos(a * math.pi / 2), math.sin(a * math.pi / 2)
    for s in (-0.16, 0.16):
        x, y = cx + nx * (T1 / 2 + 0.005) - ny * s, cy + ny * (T1 / 2 + 0.005) + nx * s
        box(0.02 if nx else 0.13, 0.13 if nx else 0.02, 0.36, x, y, zb + 0.46, "cyan")
        box(0.03 if nx else 0.17, 0.17 if nx else 0.03, 0.04, x + nx * 0.005, y + ny * 0.005, zb + 0.66, "dark")  # lintel
for sx in (-1, 1):
    for sy in (-1, 1):
        # Quoins up each corner, standing a little proud, and a slate pinnacle on top of each.
        box(0.12, 0.12, H1, cx + sx * (T1 / 2 - 0.04), cy + sy * (T1 / 2 - 0.04), zb + H1 / 2, "dark")
        cyl(0.07, 0.34, cx + sx * T1 / 2, cy + sy * T1 / 2, zb + H1 + 0.25, "slate", n=6, r2=0.0)
box(T1 + 0.03, T1 + 0.03, 0.035, cx, cy, zb + 0.72 - 0.035, "dark")  # a string course under the cornice
# Second tier, narrower: a cyan clock on each face in a dark ring.
T2, Z2, H2 = 0.66, zb + H1 + 0.08, 0.55
box(T2, T2, H2, cx, cy, Z2 + H2 / 2, "stone")
box(T2 + 0.08, T2 + 0.08, 0.07, cx, cy, Z2 + H2 + 0.035, "dark")
for sx in (-1, 1):
    for sy in (-1, 1):
        box(0.09, 0.09, H2, cx + sx * (T2 / 2 - 0.03), cy + sy * (T2 / 2 - 0.03), Z2 + H2 / 2, "dark")
for a in range(4):
    nx, ny = math.cos(a * math.pi / 2), math.sin(a * math.pi / 2)
    rot = (0, math.pi / 2, 0) if nx else (math.pi / 2, 0, 0)
    cyl(0.15, 0.03, cx + nx * (T2 / 2 + 0.01), cy + ny * (T2 / 2 + 0.01), Z2 + 0.3, "dark", n=12, rot=rot)
    cyl(0.11, 0.03, cx + nx * (T2 / 2 + 0.025), cy + ny * (T2 / 2 + 0.025), Z2 + 0.3, "cyan", n=12, rot=rot)
# The lantern: an octagon of dark stone, a cyan light in each of its faces, under a slate spire and a brass finial.
ZL = Z2 + H2 + 0.07
cyl(0.27, 0.42, cx, cy, ZL + 0.21, "dark", n=8, rot=(0, 0, math.pi / 8))
for k in range(8):
    a = k * math.pi / 4
    box(0.03, 0.07, 0.22, cx + math.cos(a) * 0.255, cy + math.sin(a) * 0.255, ZL + 0.22, "cyan", rot=a)
cyl(0.31, 0.05, cx, cy, ZL + 0.445, "dark", n=8, rot=(0, 0, math.pi / 8))
cyl(0.3, 1.0, cx, cy, ZL + 0.97, "slate", n=8, r2=0.0, rot=(0, 0, math.pi / 8))
cyl(0.02, 0.3, cx, cy, ZL + 1.55, "brass", n=6)
bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=6, radius=0.05, location=(cx, cy, ZL + 1.5))
part(bpy.context.object, "brass")

# Into the Conseil's mesh: one mesh, one material.
bpy.ops.object.select_all(action="DESELECT")
for p in parts:
    p.select_set(True)
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
print("BELFRY", len(parts), "parts; top", round(ZL + 1.7, 2))
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_extras=True)
