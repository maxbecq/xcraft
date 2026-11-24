"""The Bourdon's two propellers (also the Dirigeable's, which wears its model), made to turn: Rodin's blades are not
flat nor apart from the arms round them, so they are cut off (every face in a slab across the disc, out of the hub),
and two clean four-blade propellers built in their place, their size kept: `zrotor_0` and `zrotor_1`, their origin on
their hub, spinning about the balloon's long axis (glTF x). render/units.ts turns them while the airship moves and
lets them run down when it stops.
Usage: Blender -b --factory-startup -P tools/meshy/bourdonprops.py -- in.glb out.glb
"""
import math
import sys

import bmesh
import bpy

src, dst = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
body = next(o for o in bpy.context.scene.objects if o.type == "MESH")
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
body.name = "body"

# (hub x, y, z, blade length), measured on the model: the bow propeller high on the balloon, the stern one under it.
HUBS = [(-0.497, -0.276, 0.86, 0.2), (0.46, 0.295, 0.612, 0.25)]
bm = bmesh.new()
bm.from_mesh(body.data)
cut = []
for f in bm.faces:
    c = f.calc_center_median()
    for x, y, z, r in HUBS:
        d = math.hypot(c.y - y, c.z - z)
        if abs(c.x - x) < 0.05 and 0.05 < d < r + 0.03:
            cut.append(f)
            break
bmesh.ops.delete(bm, geom=cut, context="FACES")
bm.to_mesh(body.data)
bm.free()
print("CUT", len(cut), "faces")


def material(name, color, metal, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Metallic"].default_value = metal
    p.inputs["Roughness"].default_value = rough
    return m


WOOD = material("prop_wood", (0.09, 0.07, 0.05), 0.0, 0.8)  # Rodin's blades: dark weathered wood
IRON = material("prop_iron", (0.025, 0.025, 0.03), 0.0, 0.7)
for i, (x, y, z, r) in enumerate(HUBS):
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.045, depth=0.07, location=(x, y, z), rotation=(0, math.pi / 2, 0))
    hub = bpy.context.object
    hub.data.materials.append(IRON)
    parts = [hub]
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        # A blade: a flat paddle out along its arm, pitched about it, wider at its tip.
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y + math.cos(a) * r * 0.55, z + math.sin(a) * r * 0.55))
        b = bpy.context.object
        b.rotation_mode = "YXZ"  # pitched about its own length first, then turned round the hub
        b.rotation_euler = (a, 0.4, 0)
        b.scale = (0.012, r * 0.9, 0.06)
        b.data.materials.append(WOOD)
        parts.append(b)
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = hub
    bpy.ops.object.join()
    rotor = bpy.context.object
    rotor.name = f"zrotor_{i}"
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.context.scene.cursor.location = (x, y, z)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB")
