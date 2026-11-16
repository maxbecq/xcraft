"""Pack a rigged Meshy character for the game: the animated .glb plus clips taken from other
.glb files with the same skeleton, texture shrunk, one file out. Clips are renamed to the roles the
game plays (idle, walk, attack, fire, work, carry, die).
Usage: Blender -b --factory-startup -P tools/meshy/pack.py -- out.glb texture_px main.glb
       [role:Meshy_Clip_Name ...] [role=extra.glb ...]
"""
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1:]
dst, tex_px, main = args[0], int(args[1]), args[2]
renames = dict(a.split(":", 1) for a in args[3:] if ":" in a)
extras = [a for a in args[3:] if "=" in a]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=main)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
for role, name in renames.items():
    action = next(a for a in bpy.data.actions if a.name.startswith(name))
    action.name = role
    action.use_fake_user = True
# The rig's own clip (bind pose) is not a role: drop it.
for action in [a for a in bpy.data.actions if a.name not in renames]:
    bpy.data.actions.remove(action)
keep = set(bpy.context.scene.objects)
for extra in extras:
    clip, path = extra.split("=")
    before = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    for action in set(bpy.data.actions) - before:
        action.name = clip
        action.use_fake_user = True
    for o in set(bpy.context.scene.objects) - keep:
        bpy.data.objects.remove(o, do_unlink=True)

# Blender 4.4+ layered actions: an action imported with another armature keeps that armature's
# slot ("OBArmature.001"); renamed to this armature, the exporter writes every action as a clip.
# (NLA_TRACKS export wrote each clip as the rest pose.)
arm.animation_data_create()
arm.animation_data.action = None
for action in bpy.data.actions:
    for slot in action.slots:
        slot.name_display = arm.name

for img in bpy.data.images:
    if img.size[0] > tex_px:
        img.scale(tex_px, tex_px)
        img.pack()
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_image_format="JPEG", export_jpeg_quality=85,
                          export_animation_mode="ACTIONS")
print("packed", dst, [a.name for a in bpy.data.actions])
