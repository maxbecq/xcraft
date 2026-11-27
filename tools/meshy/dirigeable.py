"""The Dirigeable, a model of its own (it wore the Bourdon's, only larger, and the two were taken for one another):
a long horizontal gas envelope of ochre canvas on brass hoops, a blue band round its middle and blue tail fins
(both repainted in the team colour), a dark wooden gondola slung under it on struts, its cabin windows and a
detection lamp under its bow lit cyan, and the Bourdon's two propellers (same hub, four pitched wooden blades) at the
gondola's stern on outriggers, `zrotor_0` and `zrotor_1`, spinning about the long axis as render/units.ts turns them.
Its bow is +x (models.ts turns it to face +Z, as the Bourdon). One textured material, `meshy`, from a small painted
atlas built here, so it takes the team colour and the Human skin as the other Meshy models.
Usage: Blender -b --factory-startup -P tools/meshy/dirigeable.py -- out.glb
then tools/meshy/pivots.py and compress.sh.
"""
import math
import sys

import bmesh
import bpy
import numpy as np

dst = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
rng = np.random.default_rng(7)

# --- The atlas: 4 x 2 swatches of painted colour, each with a little grain and grime so it sits by the painted models.
S, CELL = 256, 64
SWATCH = {  # name: (column, row, colour)
    "cloth": (0, 0, (0.56, 0.43, 0.25)),  # ochre canvas: the Bourdon is ivory and blue
    "cloth2": (1, 0, (0.48, 0.36, 0.20)),  # the gores' seams, a shade darker
    "blue": (2, 0, (0.10, 0.20, 0.72)),  # the team colour's mask (teamSkin repaints this blue)
    "brass": (3, 0, (0.55, 0.38, 0.12)),
    "wood": (0, 1, (0.20, 0.12, 0.07)),
    "iron": (1, 1, (0.08, 0.08, 0.09)),
    "glow": (2, 1, (0.35, 0.95, 1.00)),
}
img = np.zeros((S, S, 4))
img[..., 3] = 1
for name, (cx, cy, col) in SWATCH.items():
    grain = 1 + 0.03 * rng.standard_normal((CELL, CELL, 1))
    shade = np.linspace(1.06, 0.9, CELL)[:, None, None]  # lighter at the top of the swatch, grime below
    img[cy * CELL:(cy + 1) * CELL, cx * CELL:(cx + 1) * CELL, :3] = np.clip(np.array(col) * grain * shade, 0, 1)
atlas = bpy.data.images.new("dirigeable_atlas", S, S)
atlas.pixels[:] = img.ravel()
atlas.pack()
mat = bpy.data.materials.new("meshy")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Roughness"].default_value = 0.75
tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
tex.image = atlas
mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])


def paint(o, pick):
    """Every face of `o` to the middle of the swatch pick(face centre, normal) names (flat colour, painted grain)."""
    me = o.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    me.materials.clear()
    me.materials.append(mat)
    for p in me.polygons:
        cx, cy, _ = SWATCH[pick(o.matrix_world @ p.center, p.normal)]
        # Spread over the swatch's middle by the face's own place, so the grain shows, kept off its edges.
        jx, jy = rng.uniform(0.2, 0.8, 2)
        for li in p.loop_indices:
            uv[li].uv = ((cx + jx) * CELL / S, (cy + jy) * CELL / S)  # Blender images run from the bottom row


parts = []


def add(o, pick):
    paint(o, pick)
    parts.append(o)
    return o


ENV_L, ENV_R, ENV_Z = 1.25, 0.42, 1.0  # the envelope's half-length, radius and height of its axis


def radius_at(x):
    return ENV_R * math.sqrt(max(0.0, 1 - (x / ENV_L) ** 2))


# --- The envelope: a long ellipsoid, a little fuller at the bow; its gores in two shades, a blue band round its middle.
# Its poles on its long axis: rings across it (a straight band) and gores along it.
bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=24, radius=1, location=(0, 0, ENV_Z), rotation=(0, math.pi / 2, 0))
env = bpy.context.object
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)  # its origin stays on its axis
env.scale = (ENV_L, ENV_R, ENV_R)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
for v in env.data.vertices:  # the stern drawn finer, the bow kept round
    if v.co.x < 0:
        k = 1 - 0.25 * (-v.co.x / ENV_L) ** 2
        v.co.y *= k
        v.co.z *= k  # the mesh's own frame: its axis at z 0
bpy.ops.object.shade_smooth()


def env_pick(c, n):
    if abs(c.x) < 0.14:
        return "blue"
    gore = int((math.atan2(c.z - ENV_Z, c.y) + math.pi) / (2 * math.pi) * 16)
    return "cloth2" if gore % 2 else "cloth"


add(env, env_pick)

# Brass hoops round it, and a brass ridge along its top.
for x in (-0.85, -0.45, 0.45, 0.85):
    r = radius_at(x) * (1 - 0.25 * (-x / ENV_L) ** 2 if x < 0 else 1) + 0.008
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=0.014, major_segments=32, minor_segments=6, location=(x, 0, ENV_Z), rotation=(0, math.pi / 2, 0))
    add(bpy.context.object, lambda c, n: "brass")
bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.018, depth=ENV_L, location=(0.2, 0, ENV_Z + ENV_R - 0.01), rotation=(0, math.pi / 2, 0))
add(bpy.context.object, lambda c, n: "brass")

# --- Four tail fins in a cross at the stern, blue, on brass edges.
for k, (dy, dz) in enumerate(((0, 1), (0, -1), (1, 0), (-1, 0))):
    bpy.ops.mesh.primitive_cube_add(size=1)
    f = bpy.context.object
    f.scale = (0.42, 0.016, 0.26) if dy == 0 else (0.42, 0.26, 0.016)
    f.location = (-1.0, dy * 0.27, ENV_Z + dz * 0.27)
    bpy.ops.object.transform_apply(scale=True)
    me = f.data  # swept back: its outer edge shorter and further aft
    for v in me.vertices:
        out = (v.co.z * dz if dy == 0 else v.co.y * dy) > 0
        if out:
            v.co.x = -0.02 + (v.co.x + 0.0) * 0.55 - 0.1
    add(f, lambda c, n: "blue")

# --- The gondola: a long dark wooden cabin under the envelope, a band of cyan windows, a brass keel; struts up.
GZ = 0.38
bpy.ops.mesh.primitive_cube_add(size=1, location=(0.15, 0, GZ))
g = bpy.context.object
g.scale = (0.78, 0.24, 0.17)
bpy.ops.object.transform_apply(scale=True)
bm = bmesh.new()
bm.from_mesh(g.data)
bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.035, segments=2)
bm.to_mesh(g.data)
bm.free()
add(g, lambda c, n: "glow" if abs(n.z) < 0.3 and 0.4 < c.z < 0.44 and abs(n.y) > 0.7 else ("brass" if c.z < GZ - 0.07 else "wood"))
# Window band: thin glowing strips along each side.
for side in (-1, 1):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0.18, side * 0.123, GZ + 0.03))
    w = bpy.context.object
    w.scale = (0.6, 0.006, 0.05)
    add(w, lambda c, n: "glow")
# Struts from the cabin's roof to the envelope's belly.
for x in (-0.15, 0.45):
    for side in (-1, 1):
        top = ENV_Z - radius_at(x) * 0.85
        bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.015, depth=top - (GZ + 0.085) + 0.04, location=(x, side * 0.09, (top + GZ + 0.085) / 2))
        add(bpy.context.object, lambda c, n: "iron")
# The detection lamp under the bow: a brass housing and a cyan lens looking down and ahead.
bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.07, depth=0.08, location=(0.5, 0, GZ - 0.13), rotation=(0, math.pi / 2, 0))
add(bpy.context.object, lambda c, n: "brass")
bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=0.055, location=(0.55, 0, GZ - 0.13))
add(bpy.context.object, lambda c, n: "glow")

# --- Engines on outriggers at the gondola's stern, each with the Bourdon's propeller turning behind it.
HUBS = []
for side in (-1, 1):
    y, z = side * 0.42, GZ + 0.04
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.018, depth=0.32, location=(-0.3, side * 0.27, z), rotation=(math.pi / 2, 0, 0))
    add(bpy.context.object, lambda c, n: "iron")
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.06, depth=0.24, location=(-0.3, y, z), rotation=(0, math.pi / 2, 0))
    add(bpy.context.object, lambda c, n: "brass")
    HUBS.append((-0.46, y, z, 0.2))

env_obj = parts[0]
bpy.ops.object.select_all(action="DESELECT")
for p in parts:
    p.select_set(True)
bpy.context.view_layer.objects.active = env_obj
bpy.ops.object.join()
body = bpy.context.object
body.name = "body"


def material(name, color, metal, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Metallic"].default_value = metal
    p.inputs["Roughness"].default_value = rough
    return m


# The Bourdon's propellers, as tools/meshy/bourdonprops.py builds them.
WOOD = material("prop_wood", (0.09, 0.07, 0.05), 0.0, 0.8)
IRON = material("prop_iron", (0.025, 0.025, 0.03), 0.0, 0.7)
for i, (x, y, z, r) in enumerate(HUBS):
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.045, depth=0.07, location=(x, y, z), rotation=(0, math.pi / 2, 0))
    hub = bpy.context.object
    hub.data.materials.append(IRON)
    blades = [hub]
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y + math.cos(a) * r * 0.55, z + math.sin(a) * r * 0.55))
        b = bpy.context.object
        b.rotation_mode = "YXZ"
        b.rotation_euler = (a, 0.4, 0)
        b.scale = (0.012, r * 0.9, 0.06)
        b.data.materials.append(WOOD)
        blades.append(b)
    bpy.ops.object.select_all(action="DESELECT")
    for b in blades:
        b.select_set(True)
    bpy.context.view_layer.objects.active = hub
    bpy.ops.object.join()
    rotor = bpy.context.object
    rotor.name = f"zrotor_{i}"
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.context.scene.cursor.location = (x, y, z)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
print("DIRIGEABLE", len(body.data.polygons), "faces")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB")
