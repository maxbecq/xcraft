"""The Caserne volante built from the Caserne itself: its model and its dress as they are, and a rotor on each of its
four corner turrets: a short iron mast, a brass duct ring (`zduct_N`, still) and a hub with four blades (`zrotor_N`,
its origin on its axis, which render/units.ts spins: idling on the ground, racing in flight).
Usage: Blender -b --factory-startup -P tools/meshy/casernerotors.py -- caserne-meshy.glb caserne-dress.glb out.glb
"""
import math
import sys

import bpy

body_src, dress_src, dst = sys.argv[sys.argv.index("--") + 1:][:3]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=body_src)
bpy.ops.import_scene.gltf(filepath=dress_src)
body = next(o for o in bpy.context.scene.objects if o.type == "MESH" and o.data.materials and o.data.materials[0].name == "meshy")
vs = [body.matrix_world @ v.co for v in body.data.vertices]


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
R = 0.42  # the rotor's radius: reaching in over the roof's edge, clear of the tank in its middle
MAST = 0.14
for i, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
    # The turret's top: the highest points out in that corner, their middle.
    q = [v for v in vs if sx * v.x > 0.75 and sy * v.y > 0.6 and v.z > 1.2]
    zt = max(v.z for v in q)
    top = [v for v in q if v.z > zt - 0.06]
    cx = (min(v.x for v in top) + max(v.x for v in top)) / 2
    cy = (min(v.y for v in top) + max(v.y for v in top)) / 2
    cz = zt + MAST
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.05, depth=MAST + 0.1, location=(cx, cy, zt + (MAST - 0.1) / 2))
    bpy.context.object.name = f"zmast_{i}"
    bpy.context.object.data.materials.append(IRON)
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=0.04, major_segments=24, minor_segments=6, location=(cx, cy, cz))
    duct = bpy.context.object
    duct.name = f"zduct_{i}"
    duct.data.materials.append(BRASS)
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.07, depth=0.1, location=(cx, cy, cz))
    hub = bpy.context.object
    hub.data.materials.append(IRON)
    blades = [hub]
    for k in range(4):
        a = k * math.pi / 2
        bpy.ops.mesh.primitive_cube_add(size=1, location=(cx + math.cos(a) * R * 0.5, cy + math.sin(a) * R * 0.5, cz), rotation=(0.35, 0, a))
        b = bpy.context.object
        b.scale = (R * 0.92, 0.08, 0.014)
        b.data.materials.append(BRASS)
        blades.append(b)
    bpy.ops.object.select_all(action="DESELECT")
    for b in blades:
        b.select_set(True)
    bpy.context.view_layer.objects.active = hub
    bpy.ops.object.join()
    rotor = bpy.context.object
    rotor.name = f"zrotor_{i}"
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.context.scene.cursor.location = (cx, cy, cz)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    print("ROTOR", i, "on the turret at", round(cx, 3), round(cy, 3), round(zt, 3))
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_extras=True)
