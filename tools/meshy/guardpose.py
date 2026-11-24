"""(guardpose) The Belluaire's fencing guard and its trident thrust, on the Meshy rig: feet wide apart, the left one
forward, knees bent, the weight on both legs; the trident held like a pole arm, the right hand back at the hip and the
left one forward on the shaft, the points forward. Two-bone IK on bone heads (this importer's bone tails are absurd),
as in aimpose.py. `guard` bakes one pose into `aim` (the game holds it at rest and under the walk's legs); `thrust`
bakes `attack`: guard, a lunge with both arms driven forward, held a moment, back to guard, over the attack's 1.75 s
(the game drives it by the cooldown: the flame starts with the lunge).
Usage: Blender -b --factory-startup -P tools/meshy/guardpose.py -- <idle clip>.glb out.glb guard|thrust [preview.png]
"""
import math
import sys

import bpy
from mathutils import Matrix, Vector

src, dst, mode, *rest = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == "ARMATURE")
arm.animation_data.action = None
pb = arm.pose.bones
W = arm.matrix_world
fwd, right, up = Vector((0, -1, 0)), Vector((-1, 0, 0)), Vector((0, 0, 1))  # forward is -Y (glTF +Z)


def update():
    bpy.context.view_layer.update()


def world(b):
    return W @ pb[b].head


def rest_pose():
    for b in pb:
        b.rotation_mode = "QUATERNION"
        b.matrix_basis.identity()
    update()


rest_pose()
feet = (world("LeftFoot") + world("RightFoot")) / 2
foot0 = {s: world(f"{s}Foot").copy() for s in ("Left", "Right")}
H = world("Head").z - feet.z
REST = {b.name: b.matrix.copy() for b in pb}


def turn(bone, deg, axis="X"):
    b = pb[bone]
    pivot = b.head.copy()
    b.matrix = Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-pivot) @ b.matrix
    update()


def reach(a, f, h, target):
    """Two-bone IK in armature space on bone heads: a's head stays, h's head goes to target (world)."""
    t = W.inverted() @ target
    A, F, Hd = pb[a], pb[f], pb[h]
    S, E, X = A.head.copy(), F.head.copy(), Hd.head.copy()
    l1, l2 = (E - S).length, (X - E).length
    d = min((t - S).length, (l1 + l2) * 0.999)
    u = (t - S).normalized()
    perp = (E - S) - u * (E - S).dot(u)
    perp = perp.normalized() if perp.length > 1e-6 else Vector((0, -1, 0))
    alpha = math.acos(max(-1, min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))))
    E2 = S + (u * math.cos(alpha) + perp * math.sin(alpha)) * l1
    q = (E - S).rotation_difference(E2 - S)
    A.matrix = Matrix.Translation(S) @ q.to_matrix().to_4x4() @ Matrix.Translation(-S) @ A.matrix
    update()
    E, X = F.head.copy(), Hd.head.copy()
    q = (X - E).rotation_difference(t - E)
    F.matrix = Matrix.Translation(E) @ q.to_matrix().to_4x4() @ Matrix.Translation(-E) @ F.matrix
    update()


def level(bone):
    """A foot back to its rest orientation (flat on the ground), where the leg put it."""
    m = pb[bone].matrix
    pb[bone].matrix = Matrix.Translation(m.translation) @ REST[bone].to_3x3().to_4x4()
    update()


def build(lunge):
    """The guard (lunge 0) or the thrust at full stretch (lunge 1); returns the hands' targets."""
    rest_pose()
    # Knees and elbows pre-bent the way the IK must bend them.
    for s in ("Left", "Right"):
        turn(f"{s}UpLeg", -8)
        turn(f"{s}Leg", 16)
    # Hips down (knees bent) and, lunging, forward over the front foot.
    drop = (0.12 + 0.04 * lunge) * H
    hips = pb["Hips"]
    hips.matrix = Matrix.Translation((-up * drop + fwd * (0.03 + 0.17 * lunge) * H) / arm.scale.x) @ hips.matrix
    update()
    # Feet wide: the left one forward towards the threat, the right one back and out.
    lf = foot0["Left"] + fwd * 0.2 * H - right * 0.05 * H
    rf = foot0["Right"] - fwd * 0.16 * H + right * 0.06 * H
    for s, at in (("Left", lf), ("Right", rf)):
        for _ in range(3):
            reach(f"{s}UpLeg", f"{s}Leg", f"{s}Foot", at)
        level(f"{s}Foot")
    # Trunk: the right shoulder drawn back behind the shaft, leaning in, more when lunging.
    turn("Spine01", -28, "Z")
    for bone, deg in (("Spine", 4 + 9 * lunge), ("Spine01", 5 + 10 * lunge), ("Spine02", 4), ("neck", -9 - 10 * lunge)):
        turn(bone, deg)
    turn("LeftArm", -65, "Z")
    turn("RightArm", 65, "Z")
    turn("LeftArm", 25)
    turn("RightArm", 25)
    base = world("Hips").copy()
    base.z = feet.z
    rh = base + up * 0.5 * H + fwd * (0.0 + 0.36 * lunge) * H + right * 0.13 * H
    lh = base + up * 0.58 * H + fwd * (0.3 + 0.4 * lunge) * H + right * 0.01 * H
    for _ in range(10):
        reach("RightArm", "RightForeArm", "RightHand", rh)
        reach("LeftArm", "LeftForeArm", "LeftHand", lh)
    return rh, lh


def key(frame):
    for b in pb:
        b.keyframe_insert("location", frame=frame)
        b.keyframe_insert("rotation_quaternion", frame=frame)
        b.keyframe_insert("scale", frame=frame)


arm.animation_data_create()
act = bpy.data.actions.new("aim" if mode == "guard" else "attack")
arm.animation_data.action = act
FPS = scene.render.fps
if mode == "guard":
    rh, lh = build(0)
    key(1)
    key(2)
else:
    # Seconds into the attack's cooldown: the lunge is quick, held while the flame burns, then a slower recovery.
    for sec, lunge in ((0.0, 0.15), (0.12, 1.0), (0.4, 1.0), (0.85, 0.0), (1.75, 0.0)):
        rh, lh = build(lunge)
        key(1 + round(sec * FPS))
    rh, lh = build(1.0)
for a in [a for a in bpy.data.actions if a is not act]:
    bpy.data.actions.remove(a)
dg = bpy.context.evaluated_depsgraph_get()
print("POSE", mode, "H", round(H, 3), "hands", [[round(v, 3) for v in W @ pb[h].head] for h in ("RightHand", "LeftHand")], "targets", [[round(v, 3) for v in t] for t in (rh, lh)])
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_animations=True, export_animation_mode="ACTIONS")

if rest:  # preview from the game's camera angle, the trident's line through both hands
    d = (lh - rh).normalized()
    a, b = rh - d * 0.35 * H, rh + d * 0.95 * H
    bpy.ops.mesh.primitive_cylinder_add(radius=0.012 * H, depth=(b - a).length, location=(a + b) / 2)
    bpy.context.object.rotation_euler = (b - a).to_track_quat("Z", "Y").to_euler()
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = H * 1.6
    scene.collection.objects.link(cam)
    scene.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(40), math.radians(-20), math.radians(30))
    scene.collection.objects.link(sun)
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 600
    scene.render.film_transparent = True
    # Two views: from the game's camera (high, in front and to the side) and from the left side.
    for i, (yaw, pitch) in enumerate(((35, 50), (90, 8))):
        v = Vector((math.sin(math.radians(yaw)) * math.cos(math.radians(pitch)), -math.cos(math.radians(yaw)) * math.cos(math.radians(pitch)), math.sin(math.radians(pitch))))
        cam.location = feet + up * 0.45 * H + v * H * 4
        cam.rotation_euler = (-v).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = rest[0].replace(".png", f"-{i}.png")
        bpy.ops.render.render(write_still=True)
