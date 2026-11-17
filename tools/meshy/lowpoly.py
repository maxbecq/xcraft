"""Simplifies a Meshy character's shapes in Blender: welds the vertices the UV atlas split apart (UVs stay
per face), then decimates, so small bumps, studs and spikes go and the silhouette reads at game zoom.
Skin weights and every animation are kept.
Usage: Blender -b --factory-startup -P tools/meshy/lowpoly.py -- in.glb out.glb ratio
"""
import sys

import bpy

src, dst, ratio = sys.argv[sys.argv.index("--") + 1:][:3]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for action in bpy.data.actions:
    action.use_fake_user = True
for o in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.0001)
    bpy.ops.object.mode_set(mode="OBJECT")
    before = len(o.data.polygons)
    mod = o.modifiers.new("lowpoly", "DECIMATE")
    mod.ratio = float(ratio)
    mod.use_collapse_triangulate = True
    # The armature modifier must stay last, or the decimation would be applied to the posed mesh.
    while o.modifiers[0].name != "lowpoly":
        bpy.ops.object.modifier_move_up(modifier="lowpoly")
    bpy.ops.object.modifier_apply(modifier="lowpoly")
    print(f"LOWPOLY {o.name}: {before} -> {len(o.data.polygons)} faces")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_image_format="AUTO", export_animation_mode="ACTIONS")
