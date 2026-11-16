"""Pack a rigged Meshy character for the game: the animated .glb plus clips taken from other
.glb files with the same skeleton, texture shrunk, one file out.
Usage: Blender -b --factory-startup -P tools/meshy/pack.py -- out.glb texture_px main.glb [clip=extra.glb ...]
"""
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1:]
dst, tex_px, main, extras = args[0], int(args[1]), args[2], args[3:]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=main)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
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

# One NLA track per action so the exporter writes each as its own clip.
arm.animation_data_create()
arm.animation_data.action = None
for action in bpy.data.actions:
    track = arm.animation_data.nla_tracks.new()
    track.name = action.name
    track.strips.new(action.name, int(action.frame_range[0]), action)

for img in bpy.data.images:
    if img.size[0] > tex_px:
        img.scale(tex_px, tex_px)
        img.pack()
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_image_format="JPEG", export_jpeg_quality=85,
                          export_animation_mode="NLA_TRACKS")
print("packed", dst, [a.name for a in bpy.data.actions])
