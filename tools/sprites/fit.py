"""Cuts out a painted sprite (flat white background) and fits it onto its reference render's silhouette (same box),
then crops both to what they cover and writes public/sprites/<type>.png, <type>-ref.png, <type>-depth.png, <type>.json.

Usage: python3 tools/sprites/fit.py BAKE_DIR PAINTED.png TYPE OUT_DIR
"""
import json
import sys
from collections import deque

from PIL import Image, ImageFilter

bake, painted, kind, out = sys.argv[1:5]
ref = Image.open(f"{bake}/{kind}-ref.png").convert("RGBA")
depth = Image.open(f"{bake}/{kind}-depth.png").convert("RGBA")
meta = json.load(open(f"{bake}/{kind}.json"))

# Background: flood fill from the borders through near-white pixels.
p = Image.open(painted).convert("RGB")
w, h = p.size
px = p.load()
bg = bytearray(w * h)
q = deque((x, y) for x in range(w) for y in (0, h - 1))
q.extend((x, y) for y in range(h) for x in (0, w - 1))
while q:
    x, y = q.popleft()
    i = y * w + x
    if bg[i]:
        continue
    r, g, b = px[x, y]
    if min(r, g, b) < 225 or max(r, g, b) - min(r, g, b) > 25:
        continue
    bg[i] = 1
    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
        if 0 <= nx < w and 0 <= ny < h and not bg[ny * w + nx]:
            q.append((nx, ny))
alpha = Image.frombytes("L", (w, h), bytes(0 if v else 255 for v in bg)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
cut = p.convert("RGBA")
cut.putalpha(alpha)
cut = cut.crop(alpha.point(lambda a: 255 if a > 128 else 0).getbbox())

# Onto the reference's box.
box = ref.getchannel("A").point(lambda a: 255 if a > 128 else 0).getbbox()
fitted = Image.new("RGBA", ref.size, (0, 0, 0, 0))
fitted.alpha_composite(cut.resize((box[2] - box[0], box[3] - box[1]), Image.LANCZOS), (box[0], box[1]))

# Crop everything to the union of what is drawn, plus a margin; the origin pixel moves with it.
m = 8
u = fitted.getchannel("A").getbbox()
c = (max(0, min(u[0], box[0]) - m), max(0, min(u[1], box[1]) - m), min(ref.width, max(u[2], box[2]) + m), min(ref.height, max(u[3], box[3]) + m))
for im, name in ((fitted, kind), (ref, f"{kind}-ref"), (depth, f"{kind}-depth")):
    im.crop(c).save(f"{out}/{name}.png", optimize=True)
meta.update(w=c[2] - c[0], h=c[3] - c[1], ax=meta["ax"] - c[0], ay=meta["ay"] - c[1])
json.dump(meta, open(f"{out}/{kind}.json", "w"))
print(kind, meta)
