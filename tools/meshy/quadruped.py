"""Rigs a four-legged Meshy model (Meshy only rigs humanoids) and animates it: a trot (diagonal legs together),
idle breathing, a bite and a fall, exported as clips walk / idle / attack / die.
The model faces -Y (glTF +Z), feet on the ground. Leg feet are found from the lowest vertices; each vertex is
weighted to its nearest bones (inverse distance), which holds up on Meshy's non-manifold meshes where
Blender's heat weighting fails.
Usage: Blender -b --factory-startup -P tools/meshy/quadruped.py -- in.glb out.glb
"""
import math
import sys

import bpy
from mathutils import Vector
from mathutils.geometry import intersect_point_line

src, dst = sys.argv[sys.argv.index("--") + 1:]
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
mid_y = (lo.y + hi.y) / 2

# Feet: the lowest vertices, in four groups (left / right of the middle, front / back of the body's centre).
low = [v for v in vs if v.z < lo.z + 0.1 * h]
cx = (lo.x + hi.x) / 2
cy = sum(v.y for v in low) / len(low)
feet = {}
for name, sx, sy in (("fl", -1, -1), ("fr", 1, -1), ("bl", -1, 1), ("br", 1, 1)):
    pts = [v for v in low if (v.x - cx) * sx > 0 and (v.y - cy) * sy > 0] or low
    feet[name] = Vector((sum(p.x for p in pts) / len(pts), sum(p.y for p in pts) / len(pts), lo.z))
print("feet", {k: tuple(round(c, 3) for c in v) for k, v in feet.items()})

hip_z = lo.z + 0.5 * h
knee_z = lo.z + 0.24 * h
front_y = (feet["fl"].y + feet["fr"].y) / 2
back_y = (feet["bl"].y + feet["br"].y) / 2
head = max(vs, key=lambda v: v.z)  # top of the head (ears / crest)

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


bone("root", Vector((cx, mid_y, 0)), Vector((cx, mid_y, 0.25 * h)))
bone("spine", Vector((cx, back_y, hip_z)), Vector((cx, front_y, hip_z + 0.05 * h)), "root")
bone("neck", Vector((cx, front_y, hip_z + 0.05 * h)), Vector((cx, head.y + 0.05 * h, head.z - 0.15 * h)), "spine", True)
bone("head", Vector((cx, head.y + 0.05 * h, head.z - 0.15 * h)), Vector((cx, head.y - 0.12 * h, head.z)), "neck", True)
bone("tail", Vector((cx, back_y + 0.05 * h, hip_z)), Vector((cx, hi.y, hip_z + 0.35 * h)), "spine")
for name, f in feet.items():
    hip = Vector((cx + (f.x - cx) * 0.6, f.y, hip_z))
    knee = Vector((f.x, f.y + (0.04 if name[0] == "f" else -0.04) * h, knee_z))
    bone(f"{name}_up", hip, knee, "spine")
    bone(f"{name}_low", knee, f, f"{name}_up", True)
bpy.ops.object.mode_set(mode="OBJECT")

# Weights: each vertex to its two nearest bones, by inverse distance; legs only below the hips.
segs = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm.data.bones if b.name != "root"}
for n in segs:
    mesh.vertex_groups.new(name=n)
for v in mesh.data.vertices:
    p = v.co
    ds = []
    for n, (a, b) in segs.items():
        if n.endswith(("_up", "_low")) and p.z > hip_z + 0.05 * h:
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

# Animations (30 fps). Leg bones point down: turning about their X axis swings them forward / back.
scene = bpy.context.scene
scene.render.fps = 30
arm.animation_data_create()
for pb in arm.pose.bones:
    pb.rotation_mode = "XYZ"


def clip(name, frames, pose):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data.action = act
    for f in range(frames + 1):
        t = f / frames
        for pb in arm.pose.bones:
            pb.rotation_euler = (0, 0, 0)
            pb.location = (0, 0, 0)
        pose(t)
        for pb in arm.pose.bones:
            pb.keyframe_insert("rotation_euler", frame=f + 1)
            if pb.name == "root":
                pb.keyframe_insert("location", frame=f + 1)
    return act


P = arm.pose.bones
TAU = 2 * math.pi


def walk(t):
    for name, off in (("fl", 0), ("br", 0), ("fr", 0.5), ("bl", 0.5)):
        ph = TAU * (t + off)
        P[f"{name}_up"].rotation_euler.x = 0.5 * math.sin(ph)
        P[f"{name}_low"].rotation_euler.x = -0.6 * max(0, math.cos(ph))  # the knee folds while the paw comes forward
    P["root"].location.y = 0.03 * h * abs(math.sin(TAU * t))
    P["spine"].rotation_euler.x = 0.04 * math.sin(2 * TAU * t)
    P["neck"].rotation_euler.x = 0.08 * math.sin(2 * TAU * t)
    P["tail"].rotation_euler.z = 0.25 * math.sin(TAU * t)


def idle(t):
    P["spine"].rotation_euler.x = 0.025 * math.sin(TAU * t)
    P["neck"].rotation_euler.z = 0.15 * math.sin(TAU * t)
    P["head"].rotation_euler.x = 0.06 * math.sin(2 * TAU * t)
    P["tail"].rotation_euler.z = 0.3 * math.sin(TAU * t)


def attack(t):
    k = math.sin(math.pi * t)  # 0 -> 1 -> 0
    P["spine"].rotation_euler.x = -0.12 * k
    P["neck"].rotation_euler.x = -0.5 * k
    P["head"].rotation_euler.x = 0.4 * k
    for n in ("bl", "br"):
        P[f"{n}_up"].rotation_euler.x = -0.35 * k
    for n in ("fl", "fr"):
        P[f"{n}_up"].rotation_euler.x = 0.3 * k


def die(t):
    k = min(1.0, t * 1.4)
    P["root"].rotation_euler.z = 1.5 * k  # on its side
    P["root"].location.y = -0.15 * h * k
    for n in ("fl", "fr", "bl", "br"):
        P[f"{n}_low"].rotation_euler.x = -0.8 * k
    P["neck"].rotation_euler.x = 0.4 * k


clips = [clip("walk", 18, walk), clip("idle", 60, idle), clip("attack", 15, attack), clip("die", 30, die)]
arm.animation_data.action = None
for a in clips:
    for s in a.slots:
        s.name_display = arm.name

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_image_format="JPEG", export_jpeg_quality=85,
                          export_animation_mode="ACTIONS")
print("quadruped", dst, [a.name for a in clips])
