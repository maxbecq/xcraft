"""The Caserne volante's rotors, at its roof's four corners: the rotors Rodin modelled (loose parts beyond the
building's walls) cut off, and four built here in their place, their size kept: a brass duct ring (`zduct_N`, still)
and a hub with four blades (`zrotor_N`, which render/units.ts spins: still on the ground, racing in flight).
Usage: Blender -b --factory-startup -P tools/meshy/rotors.py -- in.glb out.glb
"""
import math
import sys

import bpy

src, dst = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
body = next(o for o in bpy.context.scene.objects if o.type == "MESH")
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.separate(type="LOOSE")
bpy.ops.object.mode_set(mode="OBJECT")
parts = [p for p in bpy.context.scene.objects if p.type == "MESH"]
WALL = 0.66  # the building's half width; the rotors and their arms reach out past it
keep, cut, tops = [], 0, []
for p in parts:
    xs = [(p.matrix_world @ v.co).x for v in p.data.vertices]
    ys = [(p.matrix_world @ v.co).y for v in p.data.vertices]
    if max(abs(min(xs)), abs(max(xs)), abs(min(ys)), abs(max(ys))) > WALL + 0.04:
        tops.append(max((p.matrix_world @ v.co).z for v in p.data.vertices))
        bpy.data.objects.remove(p, do_unlink=True)
        cut += 1
    else:
        keep.append(p)
bpy.ops.object.select_all(action="DESELECT")
for p in keep:
    p.select_set(True)
bpy.context.view_layer.objects.active = keep[0]
bpy.ops.object.join()
body = bpy.context.object
body.name = "body"
zs = [(body.matrix_world @ v.co).z for v in body.data.vertices]
xs = [(body.matrix_world @ v.co).x for v in body.data.vertices]
roof = sorted(tops)[len(tops) // 2]  # where Rodin's rotors were: level with the roof
half = max(abs(min(xs)), abs(max(xs)))


def material(name, color, metal, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Metallic"].default_value = metal
    p.inputs["Roughness"].default_value = rough
    return m


BRASS = material("rotor_brass", (0.36, 0.21, 0.05), 0.2, 0.5)
IRON = material("rotor_iron", (0.03, 0.03, 0.035), 0.0, 0.7)
R = 0.36  # the rotor's radius: Rodin's discs were about 0.75 across
for i, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
    cx, cy, cz = sx * half, sy * half, roof
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=0.035, major_segments=24, minor_segments=6, location=(cx, cy, cz))
    duct = bpy.context.object
    duct.name = f"zduct_{i}"
    duct.data.materials.append(BRASS)
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.06, depth=0.1, location=(cx, cy, cz))
    hub = bpy.context.object
    hub.data.materials.append(IRON)
    blades = [hub]
    for k in range(4):
        a = k * math.pi / 2
        bpy.ops.mesh.primitive_cube_add(size=1, location=(cx + math.cos(a) * R * 0.5, cy + math.sin(a) * R * 0.5, cz), rotation=(0.35, 0, a))
        b = bpy.context.object
        b.scale = (R * 0.92, 0.07, 0.012)
        b.data.materials.append(BRASS)
        blades.append(b)
    bpy.ops.object.select_all(action="DESELECT")
    for b in blades:
        b.select_set(True)
    bpy.context.view_layer.objects.active = hub
    bpy.ops.object.join()
    rotor = bpy.context.object
    rotor.name = f"zrotor_{i}"
    # Its origin on its axis, so the game spins it in place.
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.context.scene.cursor.location = (cx, cy, cz)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
print("ROTORS cut", cut, "parts; roof", round(roof, 3), "corners at", round(half, 3))
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB")
