"""Gives a sprite painted over another building's (fit.py --base) the depth of its own model once baked
(bake.html), the model fitted on the picture by their bases (the width of their bottom band, as fit.py does): the
model under the picture gets the same fit in game, printed here for SPRITE_PROXY in src/render/sprites.ts.

Usage: python3 tools/sprites/depth.py TYPE BAKE_DIR OUT_DIR [GAME_SCALE]
GAME_SCALE: the model's size in game against the picture's (the Intelligence suprême's model is drawn 1.1 times
larger, which its picture's SPRITE_SCALE undoes).
"""
import json
import math
import os
import sys

from PIL import Image

kind, bake, out = sys.argv[1:4]
g = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
RANGE = 16  # src/render/sprites.ts DEPTH_RANGE
PITCH = math.radians(35)  # src/camera.ts
sprite = json.load(open(f"{out}/{kind}.json"))
baked = json.load(open(f"{bake}/{kind}.json"))
ref = Image.open(f"{bake}/{kind}-ref.png").convert("RGBA")
src = Image.open(f"{bake}/{kind}-depth.png").convert("RGBA")
pic = Image.open(f"{out}/{kind}.png").convert("RGBA")


def band(im):
    a = im.getchannel("A").point(lambda v: 255 if v > 128 else 0)
    b = a.getbbox()
    f = a.crop((0, b[3] - (b[2] - b[0]) // 3, im.width, b[3])).getbbox()
    return f[0], f[2], b[3]


# In the picture's pixels: the model, drawn g times larger than the picture's scale, must cover the picture's base.
l0, r0, b0 = band(pic)
l1, r1, b1 = band(ref)
s = (r0 - l0) / (r1 - l1)  # image scale of the model onto the picture
fx, fy = (l0 + r0) / 2 - (l1 + r1) / 2 * s, b0 - b1 * s


def overlap(s, fx, fy, q=4):
    """Intersection over union of the model's silhouette, so placed, and the picture's (at 1/q resolution)."""
    W, H = pic.width // q, pic.height // q
    a = pic.getchannel("A").resize((W, H)).point(lambda v: 1 if v > 128 else 0)
    m = Image.new("L", (W, H), 0)
    r = ref.getchannel("A").resize((max(1, round(ref.width * s / q)), max(1, round(ref.height * s / q))))
    m.paste(r.point(lambda v: 1 if v > 128 else 0), (round(fx / q), round(fy / q)))
    A, M = list(a.getdata()), list(m.getdata())
    inter = sum(x & y for x, y in zip(A, M))
    return inter / max(1, sum(x | y for x, y in zip(A, M)))


# SILHOUETTE=1: refine the fit on the whole silhouette (towers included), not only the base.
if os.environ.get("SILHOUETTE"):
    best = (overlap(s, fx, fy), s, fx, fy)
    for step in (12, 6, 3, 1.5):
        improved = True
        while improved:
            improved = False
            _, bs, bx, by = best
            for ds, dx, dy in ((1.03, 0, 0), (1 / 1.03, 0, 0), (1, step, 0), (1, -step, 0), (1, 0, step), (1, 0, -step)):
                c = overlap(bs * ds, bx + dx, by + dy)
                if c > best[0] + 1e-4:
                    best, improved = (c, bs * ds, bx + dx, by + dy), True
    _, s, fx, fy = best
print("overlap", round(overlap(s, fx, fy), 3))
# Depth: the baked depth scaled by s about the image origin, its values by s too.
w, h = src.size
px = src.load()
canvas = Image.new("RGBA", (sprite["w"], sprite["h"]), (0, 0, 0, 0))
cp = canvas.load()
for y in range(canvas.height):
    for x in range(canvas.width):
        u, v = (x - fx) / s, (y - fy) / s
        if not (0 <= u < w and 0 <= v < h):
            continue
        r, gg, _, a = px[int(u), int(v)]
        if a < 128:
            continue
        d = ((r + gg / 255) / 255 - 0.5) * RANGE * s
        e = min(max(d / RANGE + 0.5, 0), 1) * 255
        cp[x, y] = (int(e), int((e % 1) * 255), 0, 255)
canvas.save(f"{out}/{kind}-depth.png", optimize=True)
# The model in game: its origin moves from the picture's origin pixel to where the fit puts the baked origin.
ox, oy = baked["ax"] * s + fx - sprite["ax"], baked["ay"] * s + fy - sprite["ay"]
ppu = sprite["ppu"]
# Screen right is ground (1, 0, -1)/√2 (YAW π/4); a ground step away from the camera, (-1, 0, -1)/√2, rises sin(PITCH) on screen.
right, away = ox / ppu, -oy / ppu / math.sin(PITCH)
dx = (right - away) / math.sqrt(2)
dz = (-right - away) / math.sqrt(2)
print(f"  {kind}: {{ scale: {s / g:.3f}, x: {dx / g:.3f}, z: {dz / g:.3f} }},")
