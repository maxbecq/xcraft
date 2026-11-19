"""Cuts out a painted sprite (flat background: white, or the plain beige of the 2D concepts) and fits it onto its reference render's silhouette (same box),
then crops both to what they cover and writes public/sprites/<type>.png, <type>-ref.png, <type>-depth.png, <type>.json.

Usage: python3 tools/sprites/fit.py BAKE_DIR PAINTED.png TYPE OUT_DIR [TOLERANCE]
       python3 tools/sprites/fit.py --base BASE_TYPE PAINTED.png TYPE OUT_DIR [TOLERANCE]
The second form is for an upgrade painted over a building's sprite (the Pod supérieur over the Pod): no model of its
own is baked; its base is sized and placed on the base building's sprite (the width of the bottom band of each), it
grows upwards past it, and it takes the base building's depth.
"""
import json
import sys
from collections import deque

from PIL import Image, ImageFilter

upgrade = sys.argv[1] == "--base"
args = sys.argv[2:] if upgrade else sys.argv[1:]
bake, painted, kind, out = args[:4]
tol = int(args[4]) if len(args) > 4 else 30
if upgrade:
    base = bake
    ref = Image.open(f"{out}/{base}.png").convert("RGBA")
    depth = Image.open(f"{out}/{base}-depth.png").convert("RGBA")
    meta = json.load(open(f"{out}/{base}.json"))
else:
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

if upgrade:
    def band(im):
        """Left, right and bottom of the lowest band of what is drawn, as high as a third of its width: the base
        (measured on the width, not the height, which the upgrade's towers change)."""
        a = im.getchannel("A").point(lambda v: 255 if v > 128 else 0)
        b = a.getbbox()
        top = b[3] - (b[2] - b[0]) // 3
        f = a.crop((0, top, im.width, b[3])).getbbox()
        return f[0], f[2], b[3]
    l0, r0, b0 = band(ref)
    l1, r1, b1 = band(cut)
    k = (r0 - l0) / (r1 - l1)
    cut = cut.resize((round(cut.width * k), round(cut.height * k)), Image.LANCZOS)
    x = round((l0 + r0) / 2 - (l1 + r1) / 2 * k)
    y = round(b0 - b1 * k)
    # A canvas holding both, the base building's pixels where they were (its origin moves with the padding).
    pl, pt = max(0, -x), max(0, -y)
    size = (max(ref.width, x + cut.width) + pl, max(ref.height, y + cut.height) + pt)
    fitted = Image.new("RGBA", size, (0, 0, 0, 0))
    fitted.alpha_composite(cut, (x + pl, y + pt))
    grown = Image.new("RGBA", size, (0, 0, 0, 0))
    grown.alpha_composite(depth, (pl, pt))
    m = 8
    c = fitted.getchannel("A").getbbox()
    c = (max(0, c[0] - m), max(0, c[1] - m), min(size[0], c[2] + m), min(size[1], c[3] + m))
    fitted.crop(c).save(f"{out}/{kind}.png", optimize=True)
    grown.crop(c).save(f"{out}/{kind}-depth.png", optimize=True)
    meta.update(w=c[2] - c[0], h=c[3] - c[1], ax=meta["ax"] + pl - c[0], ay=meta["ay"] + pt - c[1])
    json.dump(meta, open(f"{out}/{kind}.json", "w"))
    print(kind, meta, "scale", round(k, 3))
    sys.exit(0)

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
