"""The Phalangiste's grenade launcher, built from primitives after its board (phalangiste-final.png, variant B): two
short thick barrels side by side, a revolving drum under them, a glowing cyan cell on the side, dark iron and brass.
Written as a held prop (models.ts arm): muzzle along glTF +Z (Blender -Y), the grip at the origin, ~0.85 long like
the prop it replaces. A few hundred triangles, three plain materials (no texture), lit like the body that holds it.
Usage: Blender -b --factory-startup -P tools/meshy/lancegrenades.py -- public/models/lancegrenades-meshy.glb
"""
import math
import sys

import bpy

dst = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, color, metal, rough, glow=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Metallic"].default_value = metal
    p.inputs["Roughness"].default_value = rough
    if glow:
        p.inputs["Emission Color"].default_value = (*glow, 1)
        p.inputs["Emission Strength"].default_value = 2.5
    return m


# Painted dark iron, not metal: the game's bright environment map turned any metallic iron silver-white; linear
# colours, dark once models.ts lifts Human weapons ×1.4.
IRON = material("iron", (0.018, 0.018, 0.022), 0.0, 0.8)
BRASS = material("brass", (0.26, 0.15, 0.04), 0.2, 0.55)
CELL = material("cell", (0.25, 0.85, 1.0), 0.0, 0.3, glow=(0.15, 0.75, 1.0))
parts = []


def tube(r, length, y, x=0.0, z=0.0, mat=IRON, sides=10):
    """A cylinder lying along the barrel (Blender Y), centred at y."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=r, depth=length, location=(x, y, z), rotation=(math.pi / 2, 0, 0))
    o = bpy.context.object
    o.data.materials.append(mat)
    parts.append(o)
    return o


def block(sx, sy, sz, x, y, z, mat=IRON, tilt=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z), rotation=(tilt, 0, 0))
    o = bpy.context.object
    o.scale = (sx, sy, sz)
    o.data.materials.append(mat)
    parts.append(o)
    return o


# Receiver: a squat iron box from the grip forward, a brass band round it.
block(0.13, 0.36, 0.12, 0, -0.1, 0.05)
block(0.135, 0.04, 0.125, 0, -0.2, 0.05, BRASS)
# Two short thick barrels side by side, brass rings at the muzzles and at their roots.
for x in (-0.042, 0.042):
    tube(0.042, 0.24, -0.39, x, 0.07)
    tube(0.049, 0.035, -0.495, x, 0.07, BRASS)
    tube(0.047, 0.03, -0.29, x, 0.07, BRASS)
    tube(0.022, 0.02, -0.515, x, 0.07, IRON, 8)  # the bore's dark mouth
# The revolving drum under the barrels: a fat cylinder, brass end caps.
tube(0.088, 0.17, -0.17, 0, -0.085, IRON, 12)
for y in (-0.255, -0.17, -0.085):
    tube(0.091, 0.016, y, 0, -0.085, BRASS, 12)
# The cyan power cell on the right side, in a brass cradle.
tube(0.026, 0.11, -0.08, 0.085, 0.06, CELL, 10)
for y in (-0.14, -0.02):
    tube(0.032, 0.014, y, 0.085, 0.06, BRASS, 10)
# Pistol grip under the origin, the stock behind it, a front handle under the barrels for the left hand.
block(0.05, 0.06, 0.13, 0, 0.0, -0.05, IRON, tilt=-0.3)
block(0.09, 0.26, 0.09, 0, 0.15, 0.03)
block(0.1, 0.03, 0.1, 0, 0.28, 0.03, BRASS)
block(0.045, 0.05, 0.11, 0, -0.33, -0.03, IRON, tilt=0.25)

bpy.ops.object.select_all(action="DESELECT")
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
o = bpy.context.object
o.name = "lancegrenades"
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.shade_flat()
# Its flat faces, seen edge-on by the high camera, went white under the rim light models.ts arm gives held props.
o["noRim"] = True
tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_yup=True, export_extras=True)
print("LAUNCHER", tris, "triangles")
