"""Cuts out a painted sprite (flat background: white, or the plain beige of the 2D concepts) and fits it onto its reference render's silhouette (same box),
then crops both to what they cover and writes public/sprites/<type>.png, <type>-ref.png, <type>-depth.png, <type>.json.

Usage: python3 tools/sprites/fit.py BAKE_DIR PAINTED.png TYPE OUT_DIR [TOLERANCE]
"""
import json
import sys
from collections import deque

from PIL import Image, ImageFilter

bake, painted, kind, out = sys.argv[1:5]
tol = int(sys.argv[5]) if len(sys.argv) > 5 else 30
ref = Image.open(f"{bake}/{kind}-ref.png").convert("RGBA")
depth = Image.open(f"{bake}/{kind}-depth.png").convert("RGBA")
meta = json.load(open(f"{bake}/{kind}.json"))

# Background: flood fill from the borders through pixels near the corners' colour.
p = Image.open(painted).convert("RGB")
w, h = p.size
px = p.load()
corners = [px[x, y] for x in (2, w - 3) for y in (2, h - 3)]
key = tuple(sorted(c[i] for c in corners)[1] for i in range(3))
near = lambda x, y: sum(abs(a - b) for a, b in zip(px[x, y], key)) <= tol * 3


def shade(x, y):
    """The background in shadow (the concept's cast shadow on its ground): the same colour, only darker."""
    r = [a / max(b, 1) for a, b in zip(px[x, y], key)]
    k = sum(r) / 3
    return 0.45 < k < 1 and max(r) - min(r) < 0.07

bg = bytearray(w * h)
q = deque((x, y) for x in range(w) for y in (0, h - 1))
q.extend((x, y) for y in range(h) for x in (0, w - 1))
while q:
    x, y = q.popleft()
    i = y * w + x
    if bg[i]:
        continue
    if not near(x, y) and not shade(x, y):
        continue
    bg[i] = 1
    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
        if 0 <= nx < w and 0 <= ny < h and not bg[ny * w + nx]:
            q.append((nx, ny))
# Holes: closed patches of background colour (between an arm and the body), when large enough not to be a highlight.
seen = bytearray(w * h)
for y0 in range(h if sum(key) > 700 else 0):  # white backgrounds only: a beige one matches the lights inside
    for x0 in range(w):
        i0 = y0 * w + x0
        if bg[i0] or seen[i0] or not near(x0, y0):
            continue
        patch, q = [], deque([(x0, y0)])
        seen[i0] = 1
        while q:
            x, y = q.popleft()
            patch.append(y * w + x)
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                j = ny * w + nx
                if 0 <= nx < w and 0 <= ny < h and not seen[j] and not bg[j] and near(nx, ny):
                    seen[j] = 1
                    q.append((nx, ny))
        if len(patch) > w * h // 2000:
            for j in patch:
                bg[j] = 1
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
