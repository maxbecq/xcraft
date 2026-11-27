"""The Human civic buildings made with Rodin from their OpenAI boards (Silo, Conseil, Marché, Grand Conseil), their
texture brought to the other Human buildings': the bluish slate of their roofs greyed, so teamSkin repaints only
the banners and bands in the team colour, not whole roofs; the pale stone darkened and warmed, so the Human skin's
brightening does not blow it out to white.
Usage, after tools/meshy/normalize.py and before compress.sh:
Blender -b --factory-startup -P tools/meshy/civils.py -- in.glb out.glb
"""
import sys

import bpy
import numpy as np

src, dst = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for im in bpy.data.images:
    a = np.array(im.pixels[:], dtype=np.float32).reshape(-1, 4)
    c = a[:, :3]
    team = c[:, 2] - np.maximum(c[:, 0] * 1.5, c[:, 1])  # teamSkin's mask, on the stored (sRGB) values
    lum = c @ np.array([0.3, 0.59, 0.11], dtype=np.float32)
    # Slate (bluish, short of the banners' strong blue): to a dark neutral grey with a hint of blue.
    slate = (team > -0.02) & (team < 0.2)
    c[slate] = (lum[slate, None] + (c[slate] - lum[slate, None]) * 0.3) * 0.8
    # Stone and the rest (not team blue, not cyan glass or lights): darker and a little warmer.
    cyan = (c[:, 1] > 0.5) & (c[:, 2] > 0.5) & (c[:, 0] < 0.6 * c[:, 1])
    rest = (team <= -0.02) & ~cyan
    c[rest] *= np.array([0.8, 0.77, 0.71], dtype=np.float32)
    a[:, :3] = c
    im.pixels[:] = a.ravel()
    im.pack()
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_image_format="JPEG", export_jpeg_quality=85)
print("civils", src, "->", dst)
