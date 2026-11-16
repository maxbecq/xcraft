"""HUD icons from the Meshy models: a transparent 128 px render from the game's camera angle,
characters posed in their idle clip (Blender's import otherwise shows the bind pose).
Usage: Blender -b --factory-startup -P tools/meshy/icons.py -- public/models public/icons type [type ...]
"""
import math
import os
import sys

import bpy
from mathutils import Vector

models, out, *types = sys.argv[sys.argv.index("--") + 1:]

for name in types:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(models, f"{name}-meshy.glb"))
    scene = bpy.context.scene
    arm = next((o for o in scene.objects if o.type == "ARMATURE"), None)
    idle = bpy.data.actions.get("idle")
    if arm and idle:
        arm.animation_data_create()
        arm.animation_data.action = idle
        if idle.slots:
            arm.animation_data.action_slot = idle.slots[0]
        scene.frame_set(int(idle.frame_range[0]) + 5)
    bpy.context.view_layer.update()
    meshes = [o for o in scene.objects if o.type == "MESH"]
    # Rigged exports carry a helper sphere: frame and show the skinned body only.
    skinned = [o for o in meshes if any(m.type == "ARMATURE" for m in o.modifiers)]
    if skinned:
        for o in meshes:
            o.hide_render = o not in skinned
        meshes = skinned
    corners = []
    for o in meshes:
        ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
        corners += [ev.matrix_world @ v.co for v in ev.to_mesh().vertices]
    lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    centre = (lo + hi) / 2
    radius = (hi - lo).length / 2

    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 128
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = radius * 1.75
    scene.collection.objects.link(cam)
    # The game's camera: from the front-right, 35 degrees down (glTF +Z forward is Blender -Y).
    d = Vector((math.sin(math.radians(35)), -math.cos(math.radians(35)), math.tan(math.radians(35)))).normalized()
    cam.location = centre + d * radius * 4
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(40), math.radians(-20), math.radians(30))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.4
    scene.world = world
    scene.render.filepath = os.path.join(out, f"{name}.png")
    bpy.ops.render.render(write_still=True)
    print("icon", name)
