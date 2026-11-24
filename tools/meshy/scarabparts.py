"""The Scarabée's moving parts, built on its Rodin model: iron track links on the outside of each track (`ztread_<side>_<i>`,
render/units.ts runs them round the track's loop as it rolls; the loop in the `zloop` extra of `ztracks`) and its
assault gun, a small brass turret sunk into its roof with two short barrels (`zturret`, its muzzle in its `tip` extra;
render/units.ts shows it once Scarabée d'assaut is researched and turns it to its foe).
Usage: Blender -b --factory-startup -P tools/meshy/scarabparts.py -- in.glb out.glb [preview.png]
"""
import math
import sys

import bpy
from mathutils import Vector

src, dst, *rest = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
body = next(o for o in bpy.context.scene.objects if o.type == "MESH")
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
vs = [v.co for v in body.data.vertices]
X = max(abs(v.x) for v in vs)


def material(name, color, metal, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Metallic"].default_value = metal
    p.inputs["Roughness"].default_value = rough
    return m


IRON = material("tread_iron", (0.025, 0.022, 0.02), 0.0, 0.75)
BRASS = material("gun_brass", (0.36, 0.21, 0.05), 0.2, 0.5)
STEEL = material("gun_steel", (0.05, 0.05, 0.055), 0.0, 0.6)

# The track's loop, in the side plane (y along, z up): straights between two wheels, at the track's own height.
side = [v for v in vs if abs(v.x) > X - 0.1 and v.z < 0.42]  # the track, not the hull above it
y0, y1 = min(v.y for v in side), max(v.y for v in side)
z0, z1 = min(v.z for v in side), max(v.z for v in side)
r = (z1 - z0) / 2
loop = [y0 + r, y1 - r, (z0 + z1) / 2, r, X + 0.012]  # front wheel y, back wheel y, axle z, radius, outer x
holder = bpy.data.objects.new("ztracks", None)
bpy.context.scene.collection.objects.link(holder)
holder["zloop"] = loop
perim = 2 * (loop[1] - loop[0]) + 2 * math.pi * r
N = max(8, int(perim / 0.11))
for s, sx in enumerate((-1, 1)):
    for i in range(N):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(sx * loop[4], 0, 0))
        c = bpy.context.object
        c.scale = (0.02, 0.07, 0.035)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        c.name = f"ztread_{s}_{i}"
        c.data.materials.append(IRON)
        c.parent = holder
print("TRACKS", [round(x, 3) for x in loop], "links a side", N)

# The roof's top over its middle, a little ahead: where the turret sinks in.
top = max(v.z for v in vs if abs(v.x) < 0.15 and -0.35 < v.y < 0.05)
base = Vector((0, -0.15, top - 0.05))
parts = []
bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=0.17, depth=0.12, location=base + Vector((0, 0, 0.04)))
parts.append(bpy.context.object)
parts[-1].data.materials.append(BRASS)
bpy.ops.mesh.primitive_uv_sphere_add(segments=14, ring_count=7, radius=0.14, location=base + Vector((0, 0, 0.1)))
dome = bpy.context.object
dome.scale = (1, 1, 0.6)
dome.data.materials.append(BRASS)
parts.append(dome)
for x in (-0.045, 0.045):
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.022, depth=0.26, location=base + Vector((x, -0.2, 0.12)), rotation=(math.pi / 2, 0, 0))
    parts.append(bpy.context.object)
    parts[-1].data.materials.append(STEEL)
bpy.ops.object.select_all(action="DESELECT")
for p in parts:
    p.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
gun = bpy.context.object
gun.name = "zturret"
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
bpy.context.scene.cursor.location = base
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
gun["tip"] = [0.0, 0.12, 0.33]  # glTF frame (x, y up, z forward): the barrels' mouths
print("TURRET at", [round(x, 3) for x in base])
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_extras=True)
