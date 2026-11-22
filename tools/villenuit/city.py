"""Paints the whole night city and cuts it into the pictures the game loads (public/textures/villenuit/), on this Mac
(see paint.py for the two passes and their prompts). Hours of work; every picture made is kept, so it can be stopped
and run again.

  python3 tools/villenuit/city.py          # work files in $VILLENUIT_WORK (default recherches-visuelles/ville-nuit/ville)

1. First pass, 40 pixels per map tile: the city in pieces of 1536 x 1024 that overlap, each repainted from its plain
   volumes. Joined into one picture: the ground fades from a piece to the next across their overlap, and each
   building comes whole from one piece, the one that owns it (blockout.py's `owner` picture), never a blend of two
   paintings of it. Then the walkable ground is set (grey, a notch darker: paint.py's tune).
2. Second pass, 80 pixels per map tile, only on the map and a little around it: the first pass in overlapping parts,
   each redrawn sharp at twice its size.
3. The game's pictures: level 0 (80) where the second pass went, level 1 (40) wherever the first pass went, and the
   whole city at 10.
"""
import json
import math
import os
import shutil
import statistics
import subprocess
import sys

os.environ.setdefault("VILLENUIT_GROUND", "gris")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat  # noqa: E402

from paint import BARE, PASS1, PASS2, TUNE, klein, like, ramp, tune  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
WORK = os.environ.get("VILLENUIT_WORK", "recherches-visuelles/ville-nuit/ville")
OUT = "public/textures/villenuit"
PPU, W, H = 40, 1536, 1024
STEP_X, STEP_Y, NX, NY = 1280, 768, 7, 7  # pieces of the first pass, in its pixels
LEFT, TOP = -115.2, 25.6  # the painted area's top left corner in painting space (on the game's grid of pictures)
FULL_W, FULL_H = W + (NX - 1) * STEP_X, H + (NY - 1) * STEP_Y
PART_W, PART_H, PART_X, PART_Y = 768, 512, 640, 432  # parts of the second pass, in first pass pixels
GRID_LEFT, GRID_TOP, SIZE, COLS, ROWS = -153.6, 38.4, 1024, 24, 14  # the game's grid (tiles.py, painted.ts)
SEED = 4
# Flat ground that the painter gave a wall to (a slab's flank, a house front under a pavement's edge), though units
# walk straight across: the street's own asphalt comes back there, taken a few tiles away. Each: the place's outline
# in map tiles, and how many tiles away (x, z) its asphalt is taken.
FLAT = [
    ([(42.6, 56.1), (46, 56.1), (46, 58), (42.6, 58)], (-4, 0)),  # the slab's corner west of the centre's north house
    ([(99, 77.1), (110, 77.1), (116.9, 84), (105.9, 84)], (-13, 0)),  # a house front under the south-east square's edge
    ([(70, 77.1), (82, 77.1), (88.9, 84), (76.9, 84)], (13, 0)),  # another under the centre's south house,
    ([(77.1, 73.5), (84, 73.5), (84, 77.5), (77.1, 77.5)], (0, -6)),  # and beside it
    # the chasm's parapet south-west of the centre, blocks no unit climbs: their flank first, the court below drawn up
    # to the edge, then their tops, plain slabs again
    ([(28.2, 85.9), (46.4, 85.9), (46.4, 86.85), (28.2, 86.85)], (1, 1)),
    ([(27.2, 85), (46.4, 85), (46.4, 86.15), (27.2, 86.15)], (-14, -19)),
]
QUALITY = 60  # WebP: half the weight of 84, nothing lost to the eye at the closest zoom


def near(x, y):
    """How far a first pass pixel is from the map: under 1 on its ground (a diamond on screen), more around it."""
    sx, sy = LEFT + x / PPU, TOP - y / PPU
    return abs(sx) / 84.85 + abs(sy + 48.67) / 48.67


def touches(x, y, w, h, limit):
    return min(near(x + w * a / 4, y + h * b / 4) for a in range(5) for b in range(5)) <= limit


def log(*a):
    print(*a, flush=True)


def blender(mode, sx, sy, out, *more):
    if not os.path.exists(out):
        subprocess.check_call(["python3", "tools/meshy/local3d.py", "--gpu", "blender", "-b", "--factory-startup", "-P", "tools/villenuit/blockout.py", "--", mode, str(sx), str(sy), str(PPU), str(W), str(H), out, *map(str, more)], stdout=subprocess.DEVNULL)


def spot(x, z):
    """A point of the flat ground (map tiles) in first pass pixels."""
    return ((x - z) / math.sqrt(2) - LEFT) * PPU, (TOP + (x + z) / math.sqrt(2) * math.sin(math.radians(35))) * PPU


def flat(first):
    out, where = first.copy(), Image.new("L", first.size)
    for outline, (dx, dz) in FLAT:
        points = [spot(x, z) for x, z in outline]
        x0, y0 = (int(min(p[k] for p in points)) - 16 for k in (0, 1))
        x1, y1 = (int(max(p[k] for p in points)) + 16 for k in (0, 1))
        mask = Image.new("L", (x1 - x0, y1 - y0))
        ImageDraw.Draw(mask).polygon([(x - x0, y - y0) for x, y in points], fill=255)
        mask = mask.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(3))  # soft, inside the outline
        ox, oy = (round(a - b) for a, b in zip(spot(dx, dz), spot(0, 0)))
        out.paste(first.crop((x0 + ox, y0 + oy, x1 + ox, y1 + oy)), (x0, y0), mask)
        where.paste(255, (x0, y0), mask)
    return out, where


def main():
    os.makedirs(WORK, exist_ok=True)
    f = lambda name: f"{WORK}/{name}.png"
    pieces = [(i, j) for j in range(NY) for i in range(NX) if touches(i * STEP_X, j * STEP_Y, W, H, 1.25)]
    parts = []
    for b in range(-(-(FULL_H - PART_H) // PART_Y) + 1):
        for a in range(-(-(FULL_W - PART_W) // PART_X) + 1):
            x, y = min(a * PART_X, FULL_W - PART_W), min(b * PART_Y, FULL_H - PART_H)
            if touches(x, y, PART_W, PART_H, 1.1):
                parts.append((a, b, x, y))
    log(len(pieces), "pieces,", len(parts), "parts")

    # 1. The first pass.
    centre = lambda i, j: (LEFT + (i * STEP_X + W / 2) / PPU, TOP - (j * STEP_Y + H / 2) / PPU)
    for n, (i, j) in enumerate(pieces):
        sx, sy = centre(i, j)
        blender("tile", sx, sy, f(f"p{i}{j}-volumes"))
        blender("mask", sx, sy, f(f"p{i}{j}-mask"))
        blender("owner", sx, sy, f(f"p{i}{j}-owner"), *centre(0, 0), STEP_X / PPU, STEP_Y / PPU)
        klein(f(f"p{i}{j}-volumes"), f(f"p{i}{j}-pass1"), PASS1, SEED)
        log("piece", n + 1, "/", len(pieces))

    if not os.path.exists(f("first")):
        kept = set(pieces)
        ground = {p: Image.open(f(f"p{p[0]}{p[1]}-mask")).convert("L") for p in pieces}
        # the pieces' ground brought to one brightness, so that none stands out as a lighter or darker rectangle
        light = {p: ImageStat.Stat(Image.open(f(f"p{p[0]}{p[1]}-pass1")).convert("L"), ground[p]).mean[0] for p in pieces if ground[p].histogram()[255] > 0.03 * W * H}
        target = statistics.median(light.values())
        first, mask = Image.new("RGB", (FULL_W, FULL_H)), Image.new("L", (FULL_W, FULL_H))
        painted = {}
        for i, j in pieces:
            gain = min(1.3, max(0.75, target / light.get((i, j), target)))
            painted[i, j] = Image.open(f(f"p{i}{j}-pass1")).convert("RGB").point(lambda v: min(255, int(v * gain)))
        # each piece's broad light brought to the mean of the pieces that share its place: no rectangle lighter than
        # the next in the far city (at a sixteenth of the size: only the broad light counts)
        mean, count = Image.new("RGB", (FULL_W // 16, FULL_H // 16)), Image.new("L", (FULL_W // 16, FULL_H // 16))
        for (i, j), picture in painted.items():  # a running mean: the nth picture at a place weighs 1/n there
            box = (i * STEP_X // 16, j * STEP_Y // 16, (i * STEP_X + W) // 16, (j * STEP_Y + H) // 16)
            seen = count.crop(box)
            mean.paste(picture.resize((W // 16, H // 16), Image.BOX), box, seen.point(lambda v: 255 // (v + 1)))
            count.paste(seen.point(lambda v: v + 1), box)
        for i, j in pieces:
            guide = mean.crop((i * STEP_X // 16, j * STEP_Y // 16, (i * STEP_X + W) // 16, (j * STEP_Y + H) // 16)).resize((W, H), Image.BILINEAR)
            painted[i, j] = like(painted[i, j], guide, 160)
        for i, j in pieces:
            wx = ramp(W, (W - STEP_X) // 2 if (i - 1, j) in kept else None, None, 192)
            wy = ramp(H, (H - STEP_Y) // 2 if (i, j - 1) in kept else None, None, 192)
            mx = Image.new("L", (W, 1)); mx.putdata(wx)
            my = Image.new("L", (1, H)); my.putdata(wy)
            first.paste(painted[i, j], (i * STEP_X, j * STEP_Y), ImageChops.multiply(mx.resize((W, H)), my.resize((W, H))))
            mask.paste(ground[i, j], (i * STEP_X, j * STEP_Y))
        for i, j in pieces:  # each building whole, from the piece that owns it
            r, g, _ = Image.open(f(f"p{i}{j}-owner")).convert("RGB").split()
            mine = ImageChops.multiply(r.point(lambda v: 255 if abs(v - 20 - 20 * i) <= 3 else 0), g.point(lambda v: 255 if abs(v - 20 - 20 * j) <= 3 else 0))
            # a tower too tall for its piece is cut by the piece's side: there it melts into the neighbour's
            ex = Image.new("L", (W, 1)); ex.putdata(ramp(W, 48 if (i - 1, j) in kept else None, W - 48 if (i + 1, j) in kept else None, 96))
            ey = Image.new("L", (1, H)); ey.putdata(ramp(H, 48 if (i, j - 1) in kept else None, H - 48 if (i, j + 1) in kept else None, 96))
            mine = ImageChops.multiply(mine.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(1.5)), ImageChops.multiply(ex.resize((W, H)), ey.resize((W, H))))
            first.paste(painted[i, j], (i * STEP_X, j * STEP_Y), mine)
        first.save(f("first-raw"))
        mask.save(f("mask"))
        tune(first, mask, *TUNE[os.environ["VILLENUIT_GROUND"]]).save(f("first"))
    (first, flattened), mask = flat(Image.open(f("first")).convert("RGB")), Image.open(f("mask")).convert("L")
    open_ground = mask.filter(ImageFilter.GaussianBlur(12)).point(lambda v: 255 if v > 250 else 0)

    # 2. The second pass.
    for n, (a, b, x, y) in enumerate(parts):
        new = first.crop((x, y, x + PART_W, y + PART_H)).resize((W, H), Image.LANCZOS)
        if os.path.exists(f(f"d{a}_{b}-out")):  # painted from a first pass that has changed since: again
            old = like(Image.open(f(f"d{a}_{b}-in")).convert("RGB"), new)
            if ImageChops.difference(old.filter(ImageFilter.GaussianBlur(4)), new.filter(ImageFilter.GaussianBlur(4))).convert("L").getextrema()[1] > 24:
                os.remove(f(f"d{a}_{b}-out"))
        if not os.path.exists(f(f"d{a}_{b}-out")):
            new.save(f(f"d{a}_{b}-in"))
            ground = open_ground.crop((x, y, x + PART_W, y + PART_H))
            klein(f(f"d{a}_{b}-in"), f(f"d{a}_{b}-out"), BARE if ground.histogram()[255] > 0.995 * PART_W * PART_H else PASS2, SEED + 10 + a + 3 * b)
        log("part", n + 1, "/", len(parts))

    # 3. The game's pictures. Level 0 in work files first (lossless while the parts are laid one over the other).
    tiles = f"{WORK}/tiles"
    shutil.rmtree(tiles, ignore_errors=True)
    os.makedirs(tiles)
    ox, oy = round((LEFT - GRID_LEFT) * 2 * PPU), round((GRID_TOP - TOP) * 2 * PPU)  # the painted area in level 0 pixels of the grid
    here = {(a, b) for a, b, _, _ in parts}
    for a, b, x, y in parts:
        part = first.crop((x, y, x + PART_W, y + PART_H)).resize((W, H), Image.LANCZOS)
        ground = open_ground.crop((x, y, x + PART_W, y + PART_H)).resize((W, H), Image.BILINEAR)
        bare = ground.histogram()[255] > 0.995 * W * H
        out = like(Image.open(f(f"d{a}_{b}-out")).convert("RGB"), part)
        # what the second pass built on the open ground goes: the first pass's ground comes back there (paint.py)
        built = ImageChops.difference(out.filter(ImageFilter.GaussianBlur(5)), part.filter(ImageFilter.GaussianBlur(5))).convert("L")
        built = built.point(lambda v: 255 if v > (7 if bare else 12) else 0).filter(ImageFilter.MaxFilter(31)).filter(ImageFilter.GaussianBlur(10))
        # and nothing of the second pass stays where the ground was made flat again: it builds its wall anew
        again = flattened.crop((x, y, x + PART_W, y + PART_H)).resize((W, H), Image.BILINEAR)
        out = Image.composite(part.filter(ImageFilter.UnsharpMask(3, 80, 2)), out, ImageChops.multiply(built, ground))
        out = Image.composite(part, out, again)  # left soft: sharpened, a patch of coarse grain shows in the smooth street
        wx = ramp(W, (PART_W - PART_X) if (a - 1, b) in here else None, None, 160)
        wy = ramp(H, (PART_H - PART_Y) if (a, b - 1) in here else None, None, 120)
        mx = Image.new("L", (W, 1)); mx.putdata(wx)
        my = Image.new("L", (1, H)); my.putdata(wy)
        weight = ImageChops.multiply(mx.resize((W, H)), my.resize((W, H)))
        gx, gy = ox + 2 * x, oy + 2 * y
        for r in range(gy // SIZE, (gy + H - 1) // SIZE + 1):
            for c in range(gx // SIZE, (gx + W - 1) // SIZE + 1):
                t = f"{tiles}/{c}_{r}.png"
                if os.path.exists(t):
                    tile = Image.open(t).convert("RGB")
                else:  # a picture starts as the first pass, twice as big
                    fx, fy = (c * SIZE - ox) // 2, (r * SIZE - oy) // 2
                    tile = first.crop((fx, fy, fx + SIZE // 2, fy + SIZE // 2)).resize((SIZE, SIZE), Image.LANCZOS)
                tile.paste(out, (gx - c * SIZE, gy - r * SIZE), weight)
                tile.save(t, compress_level=1)
    for level in ("0", "1"):
        os.makedirs(f"{OUT}/{level}", exist_ok=True)
        for old in os.listdir(f"{OUT}/{level}"):
            os.remove(f"{OUT}/{level}/{old}")
    have = {"0": [], "1": []}
    for name in sorted(os.listdir(tiles)):
        Image.open(f"{tiles}/{name}").save(f"{OUT}/0/{name[:-4]}.webp", quality=QUALITY, method=6)
        have["0"].append(name[:-4])
    for r in range(ROWS // 2):
        for c in range(COLS // 2):
            fx, fy = c * SIZE - ox // 2, r * SIZE - oy // 2  # level 1 pixels are the first pass's
            tile = first.crop((fx, fy, fx + SIZE, fy + SIZE))
            if not tile.getbbox():
                continue
            for k in range(4):  # where the second pass went, its picture at half size
                child = f"{tiles}/{2 * c + k % 2}_{2 * r + k // 2}.png"
                if os.path.exists(child):
                    tile.paste(Image.open(child).convert("RGB").resize((SIZE // 2, SIZE // 2), Image.LANCZOS), (k % 2 * SIZE // 2, k // 2 * SIZE // 2))
            tile.save(f"{OUT}/1/{c}_{r}.webp", quality=QUALITY, method=6)
            have["1"].append(f"{c}_{r}")
    base = Image.new("RGB", (COLS * SIZE // 8, ROWS * SIZE // 8), (2, 2, 4))
    base.paste(first.resize((FULL_W // 4, FULL_H // 4), Image.LANCZOS), (ox // 8, oy // 8))
    base.save(f"{OUT}/base.webp", quality=QUALITY, method=6)
    json.dump({"ppu": 2 * PPU, "size": SIZE, "left": GRID_LEFT, "top": GRID_TOP, "cols": COLS, "rows": ROWS, **have}, open(f"{OUT}/tiles.json", "w"))
    log("done", {k: len(v) for k, v in have.items()})


if __name__ == "__main__":
    main()
