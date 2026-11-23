"""(aimpose) A grenade launcher held at the hip, ready to fire, on the Meshy rig. Adapted from drillpose.py:
"""
"""A held jackhammer pose on the Meshy rig, as on the Serf's board: leaning forward, knees bent, both hands low on the
haft in front, the right one above. Made with IK on the idle pose, baked into one action, `drill`.
Usage: Blender -b --factory-startup -P tools/meshy/drillpose.py -- <serf idle clip>.glb out.glb [preview.png]
Then pack.py with drill=out.glb (the game plays `drill` while a Serf mines or builds, see render/units.ts holdBit).
"""
import math
import sys

import bpy
from mathutils import Matrix, Vector

src, dst, *rest = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == "ARMATURE")
idle = arm.animation_data.action
# From the rest A-pose (legs straight, facing -Y): the idle clip's first frame stands mid-step.
arm.animation_data.action = None
for b in arm.pose.bones:
    b.matrix_basis.identity()
bpy.context.view_layer.update()
pb = arm.pose.bones
W = arm.matrix_world
world = lambda b: W @ pb[b].head
feet = (world("LeftFoot") + world("RightFoot")) / 2
foot0 = {side: world(f"{side}Foot").copy() for side in ("Left", "Right")}
H = world("Head").z - feet.z
# Forward is -Y (glTF +Z), the character's right is -X.
fwd, right, up = Vector((0, -1, 0)), Vector((-1, 0, 0)), Vector((0, 0, 1))


def empty(name, at):
    e = bpy.data.objects.new(name, None)
    e.location = at
    scene.collection.objects.link(e)
    return e


def ik(bone, target, chain=3):
    # On the hand, its head to the target (use_tail off): the importer gives these bones absurd tails (a 22 m forearm).
    # No pole: the arm keeps bending the way the pre-pose below bends it.
    c = pb[bone].constraints.new("IK")
    c.target = target
    c.use_tail = False
    c.chain_count = chain


def turn(bone, deg, axis="X"):
    # Rotate a bone about its head, in armature space (the object is only scaled: its axes are the world's).
    b = pb[bone]
    pivot = b.head.copy()
    b.matrix = Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-pivot) @ b.matrix
    bpy.context.view_layer.update()


# Pre-bend: knees forward, elbows a little, so the IK below bends them the right way.
# Knees: thigh forward by a, shin back by 2a, foot level again; the hips come down by what the legs lost in height.
A = 6
for side in ("Left", "Right"):
    turn(f"{side}UpLeg", -A)
    turn(f"{side}Leg", 2 * A)
    turn(f"{side}Foot", -A)
legs = (world("LeftUpLeg") - world("LeftLeg")).length + (world("LeftLeg") - world("LeftFoot")).length
drop = legs * (1 - math.cos(math.radians(A)))


# Hands on the haft: the right one above and behind, the left one lower and further forward, the line running on to the
# ground in front of the right foot (the game points the tool along it).
base = world("Hips").copy()
base.z = feet.z
rh = base + up * 0.6 * H + fwd * 0.14 * H + right * 0.09 * H
ground = base + fwd * 0.5 * H + right * 0.05 * H
lh = base + up * 0.62 * H + fwd * 0.3 * H + right * 0.09 * H
ground = rh + (lh - rh) * (rh.z - feet.z) / (rh.z - lh.z)  # the haft's line, on to the ground

# Hips down and back, spine bent forward (armature space: the object is only scaled, its axes are the world's).
hips = pb["Hips"]
hips.matrix = Matrix.Translation((-up * drop) / arm.scale.x) @ hips.matrix
bpy.context.view_layer.update()
for bone, deg in (("Spine02", 4), ("Spine01", 4), ("Spine", 2), ("neck", -6)):
    turn(bone, deg)
def reach(side, target):
    # Two-bone IK on bone heads only (shoulder, elbow, wrist), in armature space: Blender's IK reads the bones' tails,
    # which this importer leaves absurd (a 22 m forearm). The elbow keeps the side it bends to now.
    inv = W.inverted()
    t = inv @ target
    a, f, h = pb[f"{side}Arm"], pb[f"{side}ForeArm"], pb[f"{side}Hand"]
    S, E, Hd = a.head.copy(), f.head.copy(), h.head.copy()
    l1, l2 = (E - S).length, (Hd - E).length
    d = min((t - S).length, (l1 + l2) * 0.999)
    u = (t - S).normalized()
    perp = (E - S) - u * (E - S).dot(u)
    perp = perp.normalized() if perp.length > 1e-6 else Vector((0, 0, -1))
    alpha = math.acos(max(-1, min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))))
    E2 = S + (u * math.cos(alpha) + perp * math.sin(alpha)) * l1
    q = (E - S).rotation_difference(E2 - S)
    a.matrix = Matrix.Translation(S) @ q.to_matrix().to_4x4() @ Matrix.Translation(-S) @ a.matrix
    bpy.context.view_layer.update()
    E, Hd = f.head.copy(), h.head.copy()
    q = (Hd - E).rotation_difference(t - E)
    f.matrix = Matrix.Translation(E) @ q.to_matrix().to_4x4() @ Matrix.Translation(-E) @ f.matrix
    bpy.context.view_layer.update()


# Torso turned to its right, the left shoulder forward, as when both hands hold a haft on the right side.
turn("Spine01", -34, "Z")
turn("LeftShoulder", -20, "Z")
# Arms swung from the A-pose to the front, elbows a little bent, so the IK starts from the right side.
turn("LeftArm", -65, "Z")
turn("RightArm", 65, "Z")
turn("LeftArm", 25)
turn("RightArm", 25)
# IK last, on the bent body: hands to the haft.
for _ in range(10):
    for side, at in (("Right", rh), ("Left", lh)):
        reach(side, at)
bpy.context.view_layer.update()

dg = bpy.context.evaluated_depsgraph_get()
ev = arm.evaluated_get(dg)
print("HANDS", [[round(v, 3) for v in ev.matrix_world @ ev.pose.bones[h].head] for h in ("RightHand", "LeftHand")], [[round(v, 3) for v in t] for t in (rh, lh)])
# Bake the visual pose into `drill` (two keys, the game loops it; the jackhammer's shudder is played in code).
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode="POSE")
bpy.ops.pose.select_all(action="SELECT")
f0 = 1
bpy.ops.nla.bake(frame_start=f0, frame_end=f0 + 1, only_selected=True, visual_keying=True, clear_constraints=True, bake_types={"POSE"})
bpy.ops.object.mode_set(mode="OBJECT")
drill = arm.animation_data.action
drill.name = "aim"
for a in [a for a in bpy.data.actions if a is not drill]:
    bpy.data.actions.remove(a)
for o in [o for o in scene.objects if o.type == "EMPTY"]:
    bpy.data.objects.remove(o, do_unlink=True)
print("POSE H", round(H, 3), "rh", [round(v, 3) for v in rh], "lh", [round(v, 3) for v in lh])
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_animations=True, export_animation_mode="ACTIONS")

if rest:  # preview from the game's camera angle, with the tool line drawn as a thin cylinder
    d = ground - rh
    bpy.ops.mesh.primitive_cylinder_add(radius=0.012 * H, depth=d.length, location=rh + d / 2)
    bpy.context.object.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    scene.frame_set(f0)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = H * 1.4
    scene.collection.objects.link(cam)
    scene.camera = cam
    v = Vector((math.sin(math.radians(35)), -math.cos(math.radians(35)), math.tan(math.radians(35)))).normalized()
    centre = feet + up * 0.45 * H
    cam.location = centre + v * H * 4
    cam.rotation_euler = (-v).to_track_quat("-Z", "Y").to_euler()
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(40), math.radians(-20), math.radians(30))
    scene.collection.objects.link(sun)
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 600
    scene.render.film_transparent = True
    scene.render.filepath = rest[0]
    bpy.ops.render.render(write_still=True)
