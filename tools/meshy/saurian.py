"""Rigs and animates the Humans' saurians (Rodin models, one mesh, Meshy rigs only humanoids), after quadruped.py:
bones placed from the silhouette, each vertex weighted to its nearest bones, clips walk / idle / attack / die.
  ankylo: four legs, a long tail in three bones ending in its club; attack: a sweep of the club.
  allo:   two legs, a tail in three bones, a neck and head, little arms; attack: it rears, lunges and bites, arms out.
The model faces -Y (glTF +Z), feet on the ground; a rider on its back follows the spine.
Usage: Blender -b --factory-startup -P tools/meshy/saurian.py -- ankylo|allo in.glb out.glb [preview.png]
"""
import math
import sys

import bpy
from mathutils import Vector
from mathutils.geometry import intersect_point_line

kind, src, dst, *rest = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
mesh = next(o for o in bpy.context.scene.objects if o.type == "MESH")
bpy.ops.object.select_all(action="DESELECT")
mesh.select_set(True)
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mesh.parent = None

vs = [v.co.copy() for v in mesh.data.vertices]
lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
h = hi.z - lo.z
L = hi.y - lo.y
cx = (lo.x + hi.x) / 2
low = [v for v in vs if v.z < lo.z + 0.08 * h]
cy = sum(v.y for v in low) / len(low)
quad = kind == "ankylo"
feet = {}
for name, sx, sy in ((("fl", -1, -1), ("fr", 1, -1), ("bl", -1, 1), ("br", 1, 1)) if quad else (("l", -1, 0), ("r", 1, 0))):
    pts = [v for v in low if (v.x - cx) * sx > 0 and (sy == 0 or (v.y - cy) * sy > 0)] or low
    feet[name] = Vector((sum(p.x for p in pts) / len(pts), sum(p.y for p in pts) / len(pts), lo.z))
print("feet", {k: tuple(round(c, 3) for c in v) for k, v in feet.items()})

hip_z = lo.z + (0.42 if quad else 0.48) * h
knee_z = lo.z + (0.2 if quad else 0.24) * h
fy = [f.y for f in feet.values()]
front_y, back_y = (min(fy), max(fy)) if quad else (cy - 0.12 * L, cy + 0.05 * L)
snout = min(vs, key=lambda v: v.y)  # the frontmost point: its jaw
tail_end = max(vs, key=lambda v: v.y)

arm = bpy.data.objects.new("Armature", bpy.data.armatures.new("Armature"))
bpy.context.scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
eb = arm.data.edit_bones


def bone(name, a, b, parent=None, connect=False):
    e = eb.new(name)
    e.head, e.tail = a, b
    if parent:
        e.parent = eb[parent]
        e.use_connect = connect
    return e


bone("root", Vector((cx, cy, 0)), Vector((cx, cy, 0.25 * h)))
bone("spine", Vector((cx, back_y, hip_z)), Vector((cx, front_y, hip_z + 0.06 * h)), "root")
chest = Vector((cx, front_y, hip_z + 0.06 * h))
neck_top = Vector((cx, snout.y + 0.22 * (front_y - snout.y), max(snout.z, hip_z) + (0.02 if quad else 0.12) * h))
bone("neck", chest, neck_top, "spine", True)
bone("head", neck_top, Vector((cx, snout.y, snout.z)), "neck", True)
# The tip of its jaw, carrying no skin: the game keeps it out of the foe it bites (render/units.ts keepHeadOut).
bone("snout", Vector((cx, snout.y, snout.z)), Vector((cx, snout.y - 0.02 * L, snout.z)), "head", True)
t0 = Vector((cx, back_y + 0.04 * L, hip_z))
for i in range(3):  # the tail in three, down to its tip (the Ankylosaure's club)
    a = t0.lerp(tail_end, i / 3)
    b = t0.lerp(tail_end, (i + 1) / 3)
    bone(f"tail{i}", a, b, "spine" if i == 0 else f"tail{i - 1}", i > 0)
for name, f in feet.items():
    hip = Vector((cx + (f.x - cx) * 0.6, f.y + (0 if quad else 0.04 * L), hip_z))
    knee = Vector((f.x, f.y + (0.04 * h if quad and name[0] == "f" else -0.04 * h if quad else -0.06 * L), knee_z))
    bone(f"{name}_up", hip, knee, "spine")
    bone(f"{name}_low", knee, f, f"{name}_up", True)
if not quad:
    for name, sx in (("al", -1), ("ar", 1)):  # little arms under the chest
        a = Vector((cx + sx * 0.08 * (hi.x - lo.x), front_y - 0.02 * L, hip_z - 0.02 * h))
        bone(name, a, a + Vector((0, -0.08 * L, -0.12 * h)), "spine")
bpy.ops.object.mode_set(mode="OBJECT")

segs = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm.data.bones if b.name not in ("root", "snout")}
for n in segs:
    mesh.vertex_groups.new(name=n)
legs = {n for n in segs if n.endswith(("_up", "_low"))}
for v in mesh.data.vertices:
    p = v.co
    ds = []
    for n, (a, b) in segs.items():
        if n in legs and p.z > hip_z + 0.04 * h:
            continue
        if n in ("al", "ar") and p.z > hip_z + 0.05 * h:
            continue
        q, t = intersect_point_line(p, a, b)
        q = a if t < 0 else b if t > 1 else q
        ds.append(((p - q).length + 1e-4, n))
    ds.sort()
    best = ds[:2]
    w = [1 / d ** 4 for d, _ in best]
    s = sum(w)
    for (d, n), wi in zip(best, w):
        mesh.vertex_groups[n].add([v.index], wi / s, "REPLACE")
mod = mesh.modifiers.new("Armature", "ARMATURE")
mod.object = arm
mesh.parent = arm

scene = bpy.context.scene
scene.render.fps = 30
arm.animation_data_create()
for pb in arm.pose.bones:
    pb.rotation_mode = "XYZ"
P = arm.pose.bones
TAU = 2 * math.pi


def clip(name, frames, pose):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data.action = act
    for f in range(frames + 1):
        for pb in arm.pose.bones:
            pb.rotation_euler = (0, 0, 0)
            pb.location = (0, 0, 0)
        pose(f / frames)
        for pb in arm.pose.bones:
            pb.keyframe_insert("rotation_euler", frame=f + 1)
            if pb.name == "root":
                pb.keyframe_insert("location", frame=f + 1)
    return act


def tail(z, x=0.0):
    for i in range(3):
        P[f"tail{i}"].rotation_euler.z = z * (0.6 + 0.3 * i)
        P[f"tail{i}"].rotation_euler.x = x


def walk(t):
    if quad:  # heavy: diagonal pairs, short steps, the body rolling and the club swinging
        for name, off in (("fl", 0), ("br", 0), ("fr", 0.5), ("bl", 0.5)):
            ph = TAU * (t + off)
            P[f"{name}_up"].rotation_euler.x = 0.35 * math.sin(ph)
            P[f"{name}_low"].rotation_euler.x = -0.45 * max(0, math.cos(ph))
        P["root"].location.y = 0.02 * h * abs(math.sin(TAU * t))
        P["spine"].rotation_euler.y = 0.05 * math.sin(TAU * t)
        tail(0.22 * math.sin(TAU * t))
    else:  # strides on two legs, the tail swinging as a balance, the head bobbing against the steps
        for name, off in (("l", 0), ("r", 0.5)):
            ph = TAU * (t + off)
            P[f"{name}_up"].rotation_euler.x = 0.55 * math.sin(ph)
            P[f"{name}_low"].rotation_euler.x = -0.7 * max(0, math.cos(ph))
        P["root"].location.y = 0.008 * h * abs(math.sin(TAU * t))  # a stride, not a hop
        P["spine"].rotation_euler.y = 0.06 * math.sin(TAU * t)
        P["neck"].rotation_euler.x = 0.08 * math.sin(2 * TAU * t)
        tail(-0.28 * math.sin(TAU * t), 0.05 * math.sin(2 * TAU * t))


def idle(t):
    P["spine"].rotation_euler.x = 0.02 * math.sin(TAU * t)
    P["neck"].rotation_euler.z = (0.08 if quad else 0.2) * math.sin(TAU * t)
    P["head"].rotation_euler.x = 0.05 * math.sin(2 * TAU * t)
    tail(0.15 * math.sin(TAU * t))


def attack(t):
    if quad:  # the club drawn to one side, then swept hard across, the body turning into the blow
        w = -math.sin(math.pi * min(1, t / 0.35)) * 0.6 if t < 0.35 else 0
        s = math.sin(math.pi * min(1, max(0, (t - 0.3) / 0.45))) * 1.2
        tail(w + s if t >= 0.3 else w)
        P["spine"].rotation_euler.z = -0.12 * (s / 1.2)
        P["bl_up"].rotation_euler.x = 0.15 * (s / 1.2)
    else:  # rears up, lunges down and bites, arms reaching
        up = math.sin(math.pi * min(1, t / 0.45))
        bite = math.sin(math.pi * min(1, max(0, (t - 0.35) / 0.5)))
        P["spine"].rotation_euler.x = -0.35 * up + 0.15 * bite
        P["neck"].rotation_euler.x = -0.3 * up + 0.28 * bite
        P["head"].rotation_euler.x = 0.25 * bite
        for n in ("al", "ar"):
            P[n].rotation_euler.x = -0.9 * max(up, bite)
        tail(0, 0.25 * up)
        P["root"].location.y = 0.05 * h * up


def die(t):
    k = min(1.0, t * 1.4)
    P["root"].rotation_euler.z = 1.5 * k  # over on its side
    P["root"].location.y = -0.12 * h * k
    for n in legs:
        if n.endswith("_low"):
            P[n].rotation_euler.x = -0.7 * k
    P["neck"].rotation_euler.x = 0.4 * k
    tail(0.3 * k)


clips = [clip("walk", 22 if quad else 20, walk), clip("idle", 60, idle), clip("attack", 24 if quad else 20, attack), clip("die", 30, die)]
arm.animation_data.action = None
for a in clips:
    for s in a.slots:
        s.name_display = arm.name
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_image_format="JPEG", export_jpeg_quality=85, export_animation_mode="ACTIONS")
print("SAURIAN", kind, dst, [a.name for a in clips])

if rest:  # preview: frames of walk and attack, from the side
    s = bpy.context.scene
    s.render.engine = "BLENDER_EEVEE"
    s.render.resolution_x, s.render.resolution_y = 400, 300
    s.world = bpy.data.worlds.new("w")
    s.world.use_nodes = True
    s.world.node_tree.nodes["Background"].inputs[0].default_value = (0.75, 0.75, 0.75, 1)
    s.world.node_tree.nodes["Background"].inputs[1].default_value = 1.5
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    s.collection.objects.link(cam)
    s.camera = cam
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = L * 1.3
    d = Vector((math.sin(math.radians(70)), -math.cos(math.radians(70)), 0.35)).normalized()
    cam.location = Vector((cx, cy, h * 0.5)) + d * 6
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    n = 0
    for a, fr in ((clips[0], (1, 6, 11, 16)), (clips[2], (1, 8, 13, 18))):
        arm.animation_data.action = a
        if a.slots:
            arm.animation_data.action_slot = a.slots[0]
        for f in fr:
            s.frame_set(f)
            s.render.filepath = rest[0].replace(".png", f"-{n}.png")
            bpy.ops.render.render(write_still=True)
            n += 1
