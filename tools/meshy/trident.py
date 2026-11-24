"""The Belluaire's fire trident, built from primitives after its board (belluaire-final.png): a long dark shaft with
brass rings and two glowing cyan cells, a gilded crossbar and three prongs whose points are burner nozzles (the flame,
render/effects.ts flameJet, leaves the held prop's tip). Written as a held prop (models.ts arm): points along glTF +Z
(Blender -Y), the right hand's grip at the origin, the shaft running back behind it. Plain materials, no texture.
Usage: Blender -b --factory-startup -P tools/meshy/trident.py -- public/models/trident-meshy.glb
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
        p.inputs["Emission Strength"].default_value = 0.6  # dimmer than the launcher's: two long cells bloomed the whole shaft white
    return m


# Painted, not metal: the game's bright environment map turned metallic faces silver-white (lancegrenades.py); linear
# colours, lifted ×1.4 by models.ts for Human weapons.
IRON = material("iron", (0.025, 0.02, 0.018), 0.0, 0.8)
BRASS = material("brass", (0.36, 0.21, 0.05), 0.2, 0.5)
CELL = material("cell", (0.1, 0.5, 0.65), 0.0, 0.3, glow=(0.15, 0.75, 1.0))
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


# The shaft, from its butt behind the hand to the crossbar, brass rings along it.
tube(0.022, 1.62, -0.31, sides=8)
for y in (0.48, 0.0, -0.36, -0.78):
    tube(0.03, 0.035, y, mat=BRASS, sides=8)
tube(0.036, 0.06, 0.5, mat=BRASS, sides=8)  # the butt cap
# Two cyan cells on the shaft, in brass cradles, as on the board.
for y in (-0.55, -0.95):
    tube(0.03, 0.12, y, mat=CELL, sides=8)
    for d in (-0.07, 0.07):
        tube(0.034, 0.015, y + d, mat=BRASS, sides=8)
# The gilded head: a socket, a crossbar, three prongs; each prong ends in a dark nozzle.
tube(0.04, 0.12, -1.16, mat=BRASS, sides=8)
block(0.34, 0.05, 0.05, 0, -1.23, 0, BRASS)
for x, length in ((-0.15, 0.24), (0.0, 0.3), (0.15, 0.24)):
    tube(0.022, length, -1.25 - length / 2, x, mat=BRASS, sides=6)
    tube(0.03, 0.05, -1.25 - length - 0.02, x, mat=IRON, sides=8)
for x in (-0.15, 0.15):  # the side prongs rise from the crossbar's ends
    block(0.045, 0.045, 0.05, x, -1.23, 0, BRASS)

bpy.ops.object.select_all(action="DESELECT")
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
o = bpy.context.object
o.name = "trident"
# Three quarters of the board's length: at full length its head went through a foe in reach and its flame started
# past it (the Belluaire fights at arm's length).
o.scale = (0.75, 0.75, 0.75)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.shade_flat()
# Its flat faces, seen edge-on by the high camera, went white under the rim light models.ts arm gives held props.
o["noRim"] = True
tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_yup=True, export_extras=True)
print("TRIDENT", tris, "triangles")
