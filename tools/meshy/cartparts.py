"""The Réservoir de substances made movable from its single Rodin mesh: its faces sorted by where they sit into
named parts render/units.ts moves: the two pullers' legs (`zstep_<serf><leg>`, pivoting at the hip), the four wheels
(`zwheel_N`, on their axles), the vat (`zvat`, swaying), the alchemist on top (`zpumper`), and a brass pump lever by
him built here (`zlever`, pumped as a bomb is thrown). Each part's origin is its pivot.
Usage: Blender -b --factory-startup -P tools/meshy/cartparts.py -- in.glb out.glb [preview.png]
"""
import sys

import bpy
from mathutils import Vector

src, dst, *rest = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
body = next(o for o in bpy.context.scene.objects if o.type == "MESH")
body.name = "body"
M = body.matrix_world
FRONT = -0.18  # forward is -Y: the pullers stand in front of this


def kind(c):
    """Which part a face belongs to, by its centre (world, metres)."""
    if c.y < FRONT and c.z < 0.3:
        return ("leg", 0 if c.x < 0 else 1)
    if c.y > FRONT and c.z < 0.36 and abs(c.x) > 0.27:
        return ("wheel", (0 if c.y < 0.3 else 2) + (0 if c.x < 0 else 1))
    if c.y > 0.45 and c.z > 0.55:
        return ("pumper", 0)
    if abs(c.x) < 0.3 and -0.12 < c.y < 0.45 and c.z > 0.45:
        return ("vat", 0)
    return None


groups = {}
for p in body.data.polygons:
    k = kind(M @ p.center)
    if k:
        groups.setdefault(k, []).append(p.index)
# A puller's two legs: split at the mean x of his leg faces.
for serf in (0, 1):
    idx = groups.pop(("leg", serf), [])
    if not idx:
        continue
    mid = sum((M @ body.data.polygons[i].center).x for i in idx) / len(idx)
    for i in idx:
        groups.setdefault(("step", serf * 10 + (0 if (M @ body.data.polygons[i].center).x < mid else 1)), []).append(i)


def split(name, faces, pivot):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for i in faces:
        body.data.polygons[i].select = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    part = next(o for o in bpy.context.selected_objects if o is not body)
    part.name = name
    vs = [part.matrix_world @ v.co for v in part.data.vertices]
    lo = Vector([min(v[i] for v in vs) for i in range(3)])
    hi = Vector([max(v[i] for v in vs) for i in range(3)])
    at = {"centre": (lo + hi) / 2, "top": Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, hi.z)), "foot": Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))}[pivot]
    bpy.context.scene.cursor.location = at
    bpy.ops.object.select_all(action="DESELECT")
    part.select_set(True)
    bpy.context.view_layer.objects.active = part
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    print("PART", name, len(faces), [round(x, 2) for x in lo], [round(x, 2) for x in hi])
    return part


# Split from the highest face index down would shift nothing: polygons are re-indexed after each separate, so map
# the groups to face centres first and re-find them each time.
centres = {k: [(M @ body.data.polygons[i].center).copy() for i in v] for k, v in groups.items()}
names = {("wheel", n): (f"zwheel_{n}", "centre") for n in range(4)}
names.update({("step", s): (f"zstep_{s // 10}{s % 10}", "top") for s in (0, 1, 10, 11)})
names.update({("vat", 0): ("zvat", "foot"), ("pumper", 0): ("zpumper", "foot")})
for k, cs in centres.items():
    want = {tuple(round(x, 5) for x in c) for c in cs}
    faces = [p.index for p in body.data.polygons if tuple(round(x, 5) for x in (M @ p.center)) in want]
    split(*names[k][:1], faces, names[k][1])

# The pump lever by the alchemist: a brass rod on a pivot at the platform, a knob on top.
pump = bpy.data.objects.get("zpumper")
# Behind him at the cart's back edge, standing above his head: seen from any side, as is its stroke.
base = Vector((0.0, 0.7, 0.58)) if pump is None else Vector((pump.location.x, pump.location.y + 0.15, pump.location.z + 0.02))
m = bpy.data.materials.new("lever_brass")
m.use_nodes = True
pr = m.node_tree.nodes["Principled BSDF"]
pr.inputs["Base Color"].default_value = (0.36, 0.21, 0.05, 1)
pr.inputs["Roughness"].default_value = 0.5
bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.026, depth=0.68, location=base + Vector((0, 0, 0.34)))
rod = bpy.context.object
bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=6, radius=0.055, location=base + Vector((0, 0, 0.7)))
knob = bpy.context.object
bpy.ops.mesh.primitive_cube_add(size=1, location=base)
foot = bpy.context.object
foot.scale = (0.06, 0.06, 0.04)
for o in (rod, knob, foot):
    o.data.materials.append(m)
bpy.ops.object.select_all(action="DESELECT")
for o in (rod, knob, foot):
    o.select_set(True)
bpy.context.view_layer.objects.active = rod
bpy.ops.object.join()
lever = bpy.context.object
lever.name = "zlever"
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
bpy.context.scene.cursor.location = base
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB")

if rest:  # preview: each part in its own colour, from the side and the game's angle
    import math
    cols = [(1, 0.2, 0.2), (0.2, 1, 0.2), (0.2, 0.4, 1), (1, 1, 0.2), (1, 0.2, 1), (0.2, 1, 1), (1, 0.6, 0.1), (0.6, 0.3, 1), (1, 1, 1), (0.5, 0.9, 0.5)]
    for i, o in enumerate([o for o in bpy.context.scene.objects if o.type == "MESH" and o.name != "body"]):
        mt = bpy.data.materials.new(f"c{i}")
        mt.diffuse_color = (*cols[i % len(cols)], 1)
        mt.use_nodes = True
        mt.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*cols[i % len(cols)], 1)
        mt.node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = (*cols[i % len(cols)], 1)
        mt.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.6
        o.data.materials.clear()
        o.data.materials.append(mt)
    s = bpy.context.scene
    s.render.engine = "BLENDER_EEVEE"
    s.render.resolution_x, s.render.resolution_y = 600, 600
    s.world = bpy.data.worlds.new("w")
    s.world.use_nodes = True
    s.world.node_tree.nodes["Background"].inputs[0].default_value = (0.7, 0.7, 0.7, 1)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    s.collection.objects.link(sun)
    sun.data.energy = 3
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    s.collection.objects.link(cam)
    s.camera = cam
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 1.9
    for i, (yaw, pitch) in enumerate(((90, 5), (35, 40))):
        d = Vector((math.sin(math.radians(yaw)) * math.cos(math.radians(pitch)), -math.cos(math.radians(yaw)) * math.cos(math.radians(pitch)), math.sin(math.radians(pitch))))
        cam.location = Vector((0, 0, 0.55)) + d * 5
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        s.render.filepath = rest[0].replace(".png", f"-{i}.png")
        bpy.ops.render.render(write_still=True)
