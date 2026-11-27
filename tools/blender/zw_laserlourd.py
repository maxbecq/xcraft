"""The Z Laser lourd's module (board A, « Accélérateur », chosen 27/11): a boxy riveted rust-orange breech with cooling
fins, a cyan window and two antennae, on a turntable and a round base with a cyan rim; in front, one thick barrel of
stacked cyan focusing rings between dark collars, a wide muzzle with a cyan lens. Each ring is an object of its own,
zring_<k> from the breech out (k = 0..4), on a material of its own (zring), so the game can light them one after the
other as the shot charges. +Z forward, base on y = 0, module units like zw_laser.
Usage: Blender -b --factory-startup -P tools/blender/zw_laserlourd.py -- out.glb
"""
import math
import sys

import bpy

out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, rgb, metal=0.5, rough=0.6, glow=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*rgb, 1)
    p.inputs["Metallic"].default_value = metal
    p.inputs["Roughness"].default_value = rough
    if glow:
        p.inputs["Emission Color"].default_value = (*rgb, 1)
        p.inputs["Emission Strength"].default_value = glow
    return m


RUST = mat("rust", (0.22, 0.042, 0.004), 0.05, 0.8)
RUST2 = mat("rust_dark", (0.06, 0.016, 0.004), 0.1, 0.8)
STEEL = mat("steel", (0.05, 0.05, 0.06), 0.5, 0.55)
CYAN = mat("glow", (0.15, 0.95, 0.9), 0.0, 0.3, 1.2)
RING = mat("zring", (0.15, 0.95, 0.9), 0.0, 0.25, 1.2)
# Blender's glTF export keys Y-up from Blender's Z-up: build in Blender axes (Z up, -Y forward becomes glTF +Z).
FWD = -1


def add(obj, material, name=None, bevel=0.0):
    obj.data.materials.append(material)
    if name:
        obj.name = obj.data.name = name
    if bevel:
        mod = obj.modifiers.new("b", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier="b")
    for f in obj.data.polygons:
        f.use_smooth = False
    return obj


def box(x, y, z, sx, sy, sz, material, bevel=0.012, name=None):
    bpy.ops.mesh.primitive_cube_add(location=(x, FWD * y, z))
    o = bpy.context.object
    o.scale = (sx / 2, sy / 2, sz / 2)
    bpy.ops.object.transform_apply(scale=True)
    return add(o, material, name, bevel)


def cyl(x, y, z, r, depth, material, axis="Z", verts=24, name=None, bevel=0.0):
    rot = {"Z": (0, 0, 0), "Y": (math.pi / 2, 0, 0), "X": (0, math.pi / 2, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=(x, FWD * y, z), rotation=rot)
    o = bpy.context.object
    bpy.ops.object.transform_apply(rotation=True)
    return add(o, material, name, bevel)


def torus(x, y, z, R, r, material, axis="Y", name=None):
    rot = {"Z": (0, 0, 0), "Y": (math.pi / 2, 0, 0)}[axis]
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=28, minor_segments=8, location=(x, FWD * y, z), rotation=rot)
    o = bpy.context.object
    bpy.ops.object.transform_apply(rotation=True)
    return add(o, material, name)


# Base and turntable.
cyl(0, 0, 0.03, 0.27, 0.06, STEEL, verts=32, bevel=0.01)
torus(0, 0, 0.045, 0.27, 0.012, CYAN, axis="Z")
cyl(0, 0, 0.1, 0.17, 0.08, STEEL, verts=24, bevel=0.01)
# Breech: a riveted box with side armour, a darker hood, cooling fins at its front, a cyan window, two antennae.
Y0 = -0.05  # its middle (forward is +y here)
box(0, Y0, 0.31, 0.42, 0.4, 0.32, RUST, 0.025)
box(0, Y0 - 0.02, 0.49, 0.34, 0.3, 0.06, RUST2, 0.015)
for s in (-1, 1):
    box(s * 0.235, Y0 - 0.05, 0.31, 0.06, 0.28, 0.26, RUST2, 0.015)
    for k in range(5):
        box(s * 0.2, Y0 + 0.13 + k * 0.0, 0.2 + k * 0.05, 0.05, 0.12, 0.012, STEEL, 0.0)
    for k in range(3):  # rivets
        cyl(s * 0.268, Y0 - 0.15 + k * 0.1, 0.42, 0.012, 0.01, STEEL, axis="X", verts=8)
box(0, Y0 - 0.12, 0.525, 0.11, 0.08, 0.03, CYAN, 0.006)
for s in (-1, 1):
    cyl(s * 0.12, Y0 - 0.16, 0.6, 0.007, 0.2, STEEL, verts=6)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.018, location=(s * 0.12, FWD * (Y0 - 0.16), 0.71), segments=10, ring_count=6)
    add(bpy.context.object, CYAN)
# Barrel: a dark core, the breech's collar, five cyan rings between dark collars, a wide muzzle with its lens.
Z = 0.31
cyl(0, 0.38, Z, 0.07, 0.56, STEEL, axis="Y", verts=20)
cyl(0, 0.18, Z, 0.12, 0.06, STEEL, axis="Y", verts=24, bevel=0.008)
for k in range(5):
    y = 0.25 + k * 0.075
    cyl(0, y, Z, 0.105, 0.034, RING, axis="Y", verts=24, name=f"zring_{k}", bevel=0.006)
    cyl(0, y + 0.0375, Z, 0.098, 0.036, STEEL, axis="Y", verts=20)
cyl(0, 0.64, Z, 0.115, 0.05, STEEL, axis="Y", verts=24, bevel=0.01)
cyl(0, 0.668, Z, 0.085, 0.01, CYAN, axis="Y", verts=24, name="zlens")
# One mesh per material for the fixed parts (few draw calls); the rings and the lens stay apart.
for m in (RUST, RUST2, STEEL, CYAN):
    parts = [o for o in bpy.context.scene.objects if o.type == "MESH" and not o.name.startswith(("zring_", "zlens")) and o.data.materials[0] == m]
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    parts[0].name = parts[0].data.name = f"zl_{m.name}"
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_extras=True)
print("OK", out)
