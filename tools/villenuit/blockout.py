"""The night city in plain volumes, seen exactly as the game's camera sees it (orthographic, 45 degrees of yaw, 35 of
pitch): what the painter repaints tile by tile (paint.py), and the same volumes as a model for the game, which
projects the painting back onto them from the same angle (src/render/painted.ts).
The ground comes from the map itself (tools/villenuit/grid.json, written by scripts/villenuit-grid.test.ts).

Run from the repository:
  blender -b --factory-startup -P tools/villenuit/blockout.py -- tile <sx> <sy> <ppu> <width> <height> out.png
  blender -b --factory-startup -P tools/villenuit/blockout.py -- mask <same> out.png   (the walkable ground in white)
  blender -b --factory-startup -P tools/villenuit/blockout.py -- owner <same> out.png <ox> <oy> <dx> <dy>
  blender -b --factory-startup -P tools/villenuit/blockout.py -- glb out.glb
Painting space: sx = (x - z) / sqrt 2 (screen right), sy = y cos(pitch) - (x + z) / sqrt 2 sin(pitch) (screen up),
in tiles; a tile picture is centred on (sx, sy) at `ppu` pixels per tile.
"""
import json
import math
import random
import sys

import bpy
from mathutils import Vector

PITCH = math.radians(35)
R2 = math.sqrt(2)
MARGIN = 64  # tiles of city drawn beyond the map's edges
DEEP = -16.0  # the lower city's streets, under the viaduct

GLB = "glb" in sys.argv  # the game's copy: the plain volumes, none of the detail the painter needs
g = json.load(open("tools/villenuit/grid.json"))
N = g["size"]
streets = json.load(open("src/maps/ville-nuit.json"))["streets"]
rnd = random.Random(7)

MATS = {
    "asphalt": ((0.10, 0.11, 0.13), 0),
    "lane": ((0.55, 0.45, 0.22), 0),
    "plaza": ((0.19, 0.19, 0.20), 0),
    "seam": ((0.05, 0.05, 0.055), 0),
    "deck": ((0.24, 0.17, 0.12), 0),
    "rim": ((0.9, 0.5, 0.15), 1.5),
    "wall": ((0.16, 0.12, 0.10), 0),
    "wall2": ((0.11, 0.11, 0.12), 0),
    "roof": ((0.26, 0.25, 0.24), 0),
    "clutter": ((0.13, 0.13, 0.14), 0),
    "window": ((1.0, 0.55, 0.16), 2.5),
    "shop": ((1.0, 0.62, 0.22), 3),
    "awning": ((0.40, 0.10, 0.07), 0),
    "red": ((1.0, 0.10, 0.06), 5),
    "cyan": ((0.05, 0.85, 1.0), 5),
    "magenta": ((1.0, 0.10, 0.75), 5),
    "green": ((0.10, 1.0, 0.55), 4),
    "deepfloor": ((0.02, 0.10, 0.10), 0.6),
    "deepwall": ((0.035, 0.05, 0.055), 0),
}
MAT_ID = {k: i for i, k in enumerate(MATS)}
verts, faces, fmat = [], [], []  # everything seen
# `owner` pictures (for paint.py, which paints the city in overlapping pieces): each building in the colour of the
# piece that owns it, the one whose centre is nearest, so that no building is a blend of two paintings of it. After
# the picture's own arguments: the centre of piece (0, 0) in painting space, and the step between pieces.
OWNER = [float(v) for v in sys.argv[-4:]] if "owner" in sys.argv else None
GROUND = ("asphalt", "plaza", "seam", "deck", "lane", "rim")
fown, CUR = [], [(0, 0, 0, 1)]
occ_start = None


def box(x0, z0, x1, z1, h0, h1, mat):
    """A box in game coordinates (x east, z south, h up)."""
    n = len(verts)
    for h in (h0, h1):
        verts.extend([(x0, -z1, h), (x1, -z1, h), (x1, -z0, h), (x0, -z0, h)])
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        faces.append(tuple(n + i for i in f))
        fmat.append(MAT_ID[mat])
        fown.append((0, 0, 0, 1) if mat in GROUND else CUR[0])


def quad(pts, mat):
    n = len(verts)
    verts.extend([(x, -z, h) for x, h, z in pts])
    faces.append((n, n + 1, n + 2, n + 3))
    fmat.append(MAT_ID[mat])
    fown.append((0, 0, 0, 1) if mat in GROUND else CUR[0])


def kind(x, z):
    """0 ground, 1 buildings, 2 the open chasm. Past the edges: an avenue that reaches the edge goes on, the rest is city."""
    if 0 <= x < N and 0 <= z < N:
        return g["kind"][z * N + x]
    cx, cz = min(N - 1, max(0, x)), min(N - 1, max(0, z))
    if (cx == x or cz == z) and g["kind"][cz * N + cx] == 0 and max(g["corners"][(cz * N + cx) * 4:(cz * N + cx) * 4 + 4]) < 0.01:
        return 0
    return 1


def corners(x, z):
    if 0 <= x < N and 0 <= z < N:
        return g["corners"][(z * N + x) * 4:(z * N + x) * 4 + 4]
    return [0, 0, 0, 0]


def on_street(x, z):
    """Distance to the nearest street's centre line over its half width (< 1 inside), and along which axis it runs."""
    best = (9, 0)
    for turn in (0, 1):
        for s in streets:
            (ax, az), (bx, bz) = s["points"]
            if turn:
                ax, az, bx, bz = N - ax, N - az, N - bx, N - bz
            if az == bz:
                lo, hi = sorted((ax, bx))
                if (lo <= x <= hi) or lo <= 0 and x < 0 or hi >= N and x > N:
                    best = min(best, (abs(z - az) / (s["width"] / 2), 0))
            else:
                lo, hi = sorted((az, bz))
                if lo <= z <= hi:
                    best = min(best, (abs(x - ax) / (s["width"] / 2), 1))
    return best


SQUARES = [t for t in json.load(open("src/maps/ville-nuit.json"))["terrain"] if t["shape"] == "octagon" and t.get("fill")]


def in_square(x, z):
    """Inside a square (the map's octagons, and their turned copies): paved, the streets stop at its edge."""
    for t in SQUARES:
        for cx, cz in (t["at"], [N - 1 - t["at"][0], N - 1 - t["at"][1]]):
            dx, dz = abs(x - cx), abs(z - cz)
            if dx <= t["half"] and dz <= t["half"] and dx + dz <= 2 * t["half"] - t["cut"]:
                return True
    return False


# The ground, tile by tile; a wall wherever it drops to a lower neighbour, a slab's edge over the open chasm.
LO, HI = -MARGIN, N + MARGIN
for z in range(LO, HI):
    for x in range(LO, HI):
        k = kind(x, z)
        if k != 0 or (GLB and (x < -2 or z < -2 or x >= N + 2 or z >= N + 2)):
            continue
        nw, ne, se, sw = corners(x, z)
        top = max(nw, ne, se, sw)
        d, axis = on_street(x + 0.5, z + 0.5)
        mat = "deck" if top > 0.3 else "plaza" if in_square(x, z) or d >= 0.75 else "asphalt"  # pavements along the avenues
        quad([(x, nw, z), (x, sw, z + 1), (x + 1, se, z + 1), (x + 1, ne, z)], mat)
        # the two sides the camera sees: south (+z) and east (+x)
        for (dx, dz, a, b, pa, pb) in ((0, 1, sw, se, (x, z + 1), (x + 1, z + 1)), (1, 0, se, ne, (x + 1, z + 1), (x + 1, z))):
            kn = kind(x + dx, z + dz)
            if kn == 1:
                continue
            cn = corners(x + dx, z + dz)
            low = min(a, b) - 0.5 if kn == 2 else min(cn)
            if kn == 2 or low < min(a, b) - 0.01:
                quad([(pa[0], low, pa[1]), (pb[0], low, pb[1]), (pb[0], b, pb[1]), (pa[0], a, pa[1])], "wall")
                if top > 0.3:  # a deck's lit rim
                    quad([(pa[0], a - 0.08, pa[1]), (pb[0], b - 0.08, pb[1]), (pb[0], b + 0.02, pb[1]), (pa[0], a + 0.02, pa[1])], "rim")
        if top > 0.3 and kind(x, z + 1) == 2 and x % 6 == 0:  # the viaduct's piers
            box(x + 0.1, z + 0.2, x + 0.9, z + 0.9, DEEP, top - 0.5, "deepwall")
        # paving seams, as thin slabs just over the ground
        if mat != "asphalt" and nw == ne == se == sw and -8 <= x < N + 8 and -8 <= z < N + 8:
            box(x - 0.015, z, x + 0.015, z + 1, top, top + 0.008, "seam")
            box(x, z - 0.015, x + 1, z + 0.015, top, top + 0.008, "seam")

# The lower city under the open chasm: a glowing floor far below, and towers rising from it that stay under the decks.
for z in range(LO, HI, 3):
    for x in range(LO, HI, 3):
        if any(kind(x + i, z + j) == 2 for i in range(3) for j in range(3)):
            box(x, z, x + 3, z + 3, DEEP - 0.1, DEEP, "deepfloor")
            if rnd.random() < 0.55 and all(kind(x + i, z + j) == 2 for i in range(3) for j in range(3)):
                h = DEEP + rnd.uniform(4, 13)
                box(x + 0.3, z + 0.3, x + 2.6, z + 2.6, DEEP, h, "deepwall")
                for _ in range(10):
                    u, v = rnd.uniform(0.4, 2.3), rnd.uniform(DEEP + 0.5, h - 0.4)
                    if rnd.random() < 0.5:
                        box(x + u, z + 2.6, x + u + 0.12, z + 2.62, v, v + 0.2, "window")
                    else:
                        box(x + 2.6, z + u, x + 2.62, z + u + 0.12, v, v + 0.2, "window")


def playable(x, z):
    return 0 <= x < N and 0 <= z < N and g["kind"][z * N + x] != 1


SIGNS = ["red", "cyan", "magenta", "green", "red", "cyan"]


def clip(poly, a, b, c):
    """The part of a convex polygon (points x, z) where a x + b z >= c."""
    out = []
    for i, p in enumerate(poly):
        q = poly[(i + 1) % len(poly)]
        dp, dq = a * p[0] + b * p[1] - c, a * q[0] + b * q[1] - c
        if dp >= 0:
            out.append(p)
        if (dp >= 0) != (dq >= 0):
            t = dp / (dp - dq)
            out.append((p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])))
    return out


def area(poly):
    return sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(poly, poly[1:] + poly[:1])) / 2


def sides(poly):
    """Each side of a convex polygon: its start, its unit direction, its unit normal pointing out, its length."""
    s = 1 if area(poly) > 0 else -1
    out = []
    for p, q in zip(poly, poly[1:] + poly[:1]):
        length = math.hypot(q[0] - p[0], q[1] - p[1])
        if length > 1e-6:
            t = ((q[0] - p[0]) / length, (q[1] - p[1]) / length)
            out.append((p, t, (s * t[1], -s * t[0]), length))
    return out


def inset(poly, d):
    for p, t, n, _ in sides(poly):
        poly = clip(poly, -n[0], -n[1], -(n[0] * p[0] + n[1] * p[1]) + d)
        if len(poly) < 3:
            return []
    return poly if abs(area(poly)) > 0.15 else []


def inside(poly, x, z, margin=0.0):
    return all((x - p[0]) * n[0] + (z - p[1]) * n[1] <= -margin for p, t, n, _ in sides(poly))


def prism(poly, h0, h1, mat):
    """A convex polygon (x, z) raised from h0 to h1."""
    pts = [(x, -z) for x, z in poly]
    if sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(pts, pts[1:] + pts[:1])) < 0:
        pts.reverse()
    n, k = len(verts), len(pts)
    verts.extend([(x, y, h0) for x, y in pts] + [(x, y, h1) for x, y in pts])
    faces.append(tuple(n + k + i for i in range(k)))
    faces.append(tuple(n + k - 1 - i for i in range(k)))
    for i in range(k):
        j = (i + 1) % k
        faces.append((n + i, n + j, n + k + j, n + k + i))
    fmat.extend([MAT_ID[mat]] * (k + 2))
    fown.extend([(0, 0, 0, 1) if mat in GROUND else CUR[0]] * (k + 2))


def panel(p, t, n, u0, u1, v0, v1, mat, off=0.02, lean=0.0):
    """A flat piece on a wall: from u0 to u1 along the side starting at p, from height v0 to v1, `off` out of the wall
    (`lean`: its foot that much further out, an awning)."""
    a = (p[0] + t[0] * u0 + n[0] * off, p[1] + t[1] * u0 + n[1] * off)
    b = (p[0] + t[0] * u1 + n[0] * off, p[1] + t[1] * u1 + n[1] * off)
    quad([(a[0] + n[0] * lean, v0, a[1] + n[1] * lean), (b[0] + n[0] * lean, v0, b[1] + n[1] * lean), (b[0], v1, b[1]), (a[0], v1, a[1])], mat)


def disc(cx, cz, r, n=28):
    return [(cx + r * math.cos(2 * math.pi * i / n), cz + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def rounded(poly_rect, r):
    """A rectangle whose corner towards the camera (south-east) is a quarter circle."""
    (x0, z0), (x1, z1) = poly_rect
    arc = [(x1 - r + r * math.cos(a), z1 - r + r * math.sin(a)) for a in [math.pi / 2 * i / 8 for i in range(9)]]
    return [(x0, z0), (x1, z0)] + arc + [(x0, z1)]


def planes(tiles, straight):
    """The half planes that bound a set of block tiles: where they make a stair along a diagonal, one straight face
    at 45 degrees through the stair, kept inside the tiles (never over ground a unit walks on); `straight`: the
    plain sides too."""
    out = []
    for x, z in tiles:
        w, e, n, s = kind(x - 1, z) != 1, kind(x + 1, z) != 1, kind(x, z - 1) != 1, kind(x, z + 1) != 1
        if w and n:
            out.append((1, 1, x + z + 1))
        if n and e:
            out.append((-1, 1, z - x))
        if e and s:
            out.append((-1, -1, -(x + z + 1)))
        if s and w:
            out.append((1, -1, x - z))
        if straight and not ((w and n) or (n and e) or (e and s) or (s and w)):
            out.extend(([(1, 0, x)] if w else []) + ([(-1, 0, -(x + 1))] if e else []) + ([(0, 1, z)] if n else []) + ([(0, -1, -(z + 1))] if s else []))
    return out


def allowed(x, z):
    """How high a building may rise on this tile: the ground a player sees behind it (away from the camera, towards
    -x -z) stays in view but for a tile and a half. None: nothing playable behind, no limit."""
    for s in range(1, 200):
        if x - s < -2 and z - s < -2:
            return None
        if playable(x - s, z - s):
            return max(corners(x - s, z - s)) + 1.3 + 0.62 * (s - 1) * R2
    return None


parcels = {}
rotundas = []


def dress(poly, floor, top, first, far):
    """A tier's walls: lit and dark windows on the sides the camera sees, a ledge every floor or two, a cornice."""
    if GLB:
        prism(poly, floor, top, "wall")
        return
    body = inset(poly, 0.06) or poly
    prism(body, floor, top - 0.07, "wall" if first else rnd.choice(["wall", "wall2"]))
    prism(poly, top - 0.07, top, "wall2")
    prism(inset(poly, 0.08) or poly, top, top + 0.04, "roof")
    v = floor + 1.35
    while v < top - 0.5:
        prism(inset(poly, 0.02) or poly, v, v + 0.05, "wall2")
        v += 1.44
    if far:
        return
    for p, t, n, length in sides(body):
        if n[0] + n[1] < 0.25:
            continue
        v = floor + (0.92 if first else 0.2)
        while v < top - 0.32:
            u = 0.14
            while u < length - 0.22:
                r = rnd.random()
                if r < 0.5:
                    panel(p, t, n, u, u + 0.1, v, v + 0.15, "window" if r < 0.2 else "clutter")
                u += 0.24
            v += 0.36


def building(lot, tiles, far, key):
    if OWNER:
        x, z = sum(p[0] for p in lot) / len(lot), sum(p[1] for p in lot) / len(lot)
        sx, sy = (x - z) / R2, 2.5 - (x + z) / R2 * math.sin(PITCH)
        CUR[0] = ((20 + 20 * round((sx - OWNER[0]) / OWNER[2])) / 255, (20 + 20 * round((OWNER[1] - sy) / OWNER[3])) / 255, 0, 1)
    raise_building(lot, tiles, far, key)
    CUR[0] = (0, 0, 0, 1)


def raise_building(lot, tiles, far, key):
    """One building on a convex lot (a polygon inside the block tiles `tiles`)."""
    if GLB and all(x < -2 or z < -2 or x >= N + 2 or z >= N + 2 for x, z in tiles):
        return  # past the edges no unit passes behind anything: the game shows the painting on flat ground there
    allow = {t: allowed(*t) for t in tiles}
    near = {(x + i, z + j) for x, z in tiles for i in (-1, 0, 1) for j in (-1, 0, 1)}
    around = [max(corners(x, z)) for x, z in near if kind(x, z) == 0]
    gmin, ground = min(around or [0]), max(around or [0])
    xs, zs = [t[0] for t in tiles], [t[1] for t in tiles]
    inmap = 0 <= min(xs) and max(xs) < N and 0 <= min(zs) and max(zs) < N
    dist = max(-min(xs), -min(zs), max(xs) - N, max(zs) - N, 0)
    if key not in parcels:  # neighbouring lots build alike
        parcels[key] = (rnd.choice([4.5, 6, 7.5, 9, 12, 15, 19]), rnd.choice([0, 0, 6, 12, 20, 30]), rnd.random())
    tall, tower, style = parcels[key]
    want = tall * rnd.uniform(0.85, 1.15) + (0 if inmap else dist * 0.35)
    if all(a is None for a in allow.values()):
        want += tower * rnd.uniform(0.6, 1.1)
    want += gmin

    def cap(t):
        """The limit for what stands at x + z >= t: the further towards the camera, the higher."""
        return min([a for (x, z), a in allow.items() if a is not None and x + z + 1 >= t] or [99])

    # a pavement under the lot; what a diagonal face leaves of the stair of tiles is ground like the square's
    for x, z in tiles:
        quad([(x, gmin, z), (x, gmin, z + 1), (x + 1, gmin, z + 1), (x + 1, gmin, z)], "plaza")
    prism(lot, gmin - 0.4, gmin + 0.07, "plaza")
    base = inset(lot, 0.1)
    if not base:
        return
    ss = sorted(x + z + 1 for x, z in tiles)
    m = math.sqrt(abs(area(base)))
    rect = len(lot) == 4 and all(abs(p[0] - round(p[0])) + abs(p[1] - round(p[1])) < 1e-6 for p in lot)
    if rect and m >= 3 and style > 0.7 and not far:
        base = rounded(((min(xs) + 0.1, min(zs) + 0.1), (max(xs) + 0.9, max(zs) + 0.9)), min(max(xs) - min(xs), max(zs) - min(zs)) * rnd.uniform(0.3, 0.48) + 0.4)
    # tiers: each one stands nearer the camera than the one below (the cut runs along the screen, unseen from the
    # camera), as high as the ground behind allows, and steps back a little on the faces the camera sees
    tiers = []  # (polygon, top)
    for k, (q, part) in enumerate(((0, 0.45), (0.3, 0.7), (0.55, 0.88), (0.75, 1.0))):
        t = ss[int(q * (len(ss) - 1))]
        top = min(gmin + (want - gmin) * part, cap(t))
        if not tiers:
            tiers.append((base, max(top, ground + 0.9)))
            continue
        if top < tiers[-1][1] + 0.7:
            continue
        p = clip(base, 1, 1, t - 0.5)
        for c, _, n, _ in sides(base):
            if n[0] + n[1] > 0.25 and len(p) >= 3:
                p = clip(p, -n[0], -n[1], -(n[0] * c[0] + n[1] * c[1]) + 0.1 * m * len(tiers) / 3 + 0.15)
        if len(p) >= 3 and abs(area(p)) > 1.5:
            tiers.append((p, top))
    # a round tower in circular steps instead of the last tier, where there is room for one
    poly, top = tiers[-1]
    cx, cz = sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly)
    r = min((c[0] - cx) * n[0] + (c[1] - cz) * n[1] for c, _, n, _ in sides(poly)) - 0.1
    below = tiers[-2][1] if len(tiers) > 1 else None
    if style < 0.5 and r >= 1.0 and below is not None and top - below > 1.8 and not far:
        tiers.pop()
        for kr, part in ((1.0, 0.5), (0.84, 0.78), (0.62, 1.0)):
            tiers.append((disc(cx, cz, r * kr), below + (top - below) * part))
    # a rotunda behind a long diagonal face that looks at the camera: a round tower in circular steps, as wide as the
    # block lets it be (it may stand on the next lot of its block)
    for c, t, n, length in sides(base):
        if far or style > 0.8 or n[0] < 0.6 or n[1] < 0.6 or length < 3.2:
            continue
        best = None
        for k in range(-8, int(length * 2) + 9):
            r = 3.2
            while r >= 1.1:
                rx, rz = c[0] + t[0] * k / 2 - n[0] * (r + 0.05), c[1] + t[1] * k / 2 - n[1] * (r + 0.05)
                if all(kind(math.floor(q[0]), math.floor(q[1])) == 1 for q in disc(rx, rz, r + 0.12, 16)):
                    break
                r -= 0.15
            if r >= 1.1 and (best is None or r > best[0] + 0.01):
                best = (r, rx, rz)
        if best is None or any(math.hypot(best[1] - x, best[2] - z) < best[0] + q for q, x, z in rotundas):
            continue
        rotundas.append(best)
        r, rx, rz = best
        # each step stands against the face, nearer the camera than the one below: it may rise higher
        low, high = gmin - 0.4, gmin
        for kr, part in ((1.0, 0.4), (0.8, 0.7), (0.6, 1.0)):
            qx, qz, qr = rx + n[0] * r * (1 - kr), rz + n[1] * r * (1 - kr), r * kr
            under = [a for a in (allowed(x, z) for x in range(math.floor(qx - qr), math.ceil(qx + qr)) for z in range(math.floor(qz - qr), math.ceil(qz + qr))) if a is not None]
            high = max(min([gmin + (want + 4 - gmin) * part] + under), high + 0.7, tiers[0][1] + 0.5)
            dress(disc(qx, qz, qr), low, high, kr == 1.0, False)
            low = high
        prism(disc(qx, qz, qr * 0.3, 10), high, high + 0.5, "clutter")
        box(qx - 0.04, qz - 0.04, qx + 0.04, qz + 0.04, high, high + 2.5, "clutter")
    floor = gmin - 0.4
    for i, (poly, top) in enumerate(tiers):
        dress(poly, floor, top, i == 0, far)
        if not far:
            # roof clutter: air units, tanks, ducts; a mast on a tower
            bx, bz = [p[0] for p in poly], [p[1] for p in poly]
            nxt = tiers[i + 1][0] if i + 1 < len(tiers) else None
            for _ in range(int(abs(area(poly)) * 0.45) + 1):
                u, v, sz = rnd.uniform(min(bx), max(bx)), rnd.uniform(min(bz), max(bz)), rnd.uniform(0.18, 0.4)
                if not inside(poly, u, v, 0.35) or (nxt and inside(nxt, u, v, -0.4)):
                    continue
                if rnd.random() < 0.25:
                    prism(disc(u, v, sz * 0.7, 10), top, top + rnd.uniform(0.3, 0.7), "clutter")
                else:
                    box(u - sz / 2, v - sz / 2, u + sz / 2, v + sz / 2, top, top + rnd.uniform(0.12, 0.35), "clutter")
            if nxt is None and top - ground > 8:
                box(cx - 0.05, cz - 0.05, cx + 0.05, cz + 0.05, top, top + rnd.uniform(1.5, 4), "clutter")
        floor = top
    if far:
        return
    # shops at the foot of the faces that give on open ground: a lit front under an awning; here and there a neon sign
    poly, top = tiers[0]
    for p, t, n, length in sides(inset(poly, 0.06) or poly):
        if n[0] + n[1] < 0.25:
            continue
        u = 0.15
        while u < length - 0.7:
            s = min(rnd.uniform(0.8, 1.5), length - u - 0.1)
            mx, mz = p[0] + t[0] * (u + s / 2) + n[0] * 0.7, p[1] + t[1] * (u + s / 2) + n[1] * 0.7
            if kind(math.floor(mx), math.floor(mz)) == 0:
                gh = max(corners(math.floor(mx), math.floor(mz))) + 0.07
                if top - gh > 0.8:
                    panel(p, t, n, u, u + s, gh + 0.08, gh + 0.5, "shop", 0.03)
                    panel(p, t, n, u - 0.05, u + s + 0.05, gh + 0.56, gh + 0.68, "awning", 0.02, 0.3)
                if rnd.random() < 0.35 and top - gh > 1.8:
                    sh = min(rnd.uniform(0.6, 2.2), top - gh - 1.0)
                    panel(p, t, n, u + s / 2 - 0.1, u + s / 2 + 0.1, gh + 0.85, gh + 0.85 + sh, rnd.choice(SIGNS), 0.06)
            u += s + rnd.uniform(0.05, 0.4)
    # a tall neon screen on a tower's face
    if len(tiers) > 1 and tiers[-1][1] - ground > 5 and rnd.random() < 0.7:
        poly, top = tiers[1]
        seen = [sd for sd in sides(inset(poly, 0.06) or poly) if sd[2][0] + sd[2][1] > 0.9 and sd[3] > 0.5]
        if seen:
            p, t, n, length = rnd.choice(seen)
            wd = min(0.5, length * 0.6)
            panel(p, t, n, length / 2 - wd / 2, length / 2 + wd / 2, tiers[0][1] + 0.4, tiers[0][1] + 0.4 + min(3.0, (top - tiers[0][1]) * 0.6), rnd.choice(SIGNS), 0.06)


# Lots. Near the map, first whole parcels: the block tiles of a square of 7 tiles, as one convex polygon (its stairs of
# tiles made straight diagonal faces); then what is left, cut into rectangles, greedily; big coarse ones far away.
taken = set()
CELL = 7
NEAR = range(-22, N + 22)
cells = []  # each block of buildings (tiles that touch), its bounding box cut into equal parts of 7 tiles at most
seen = set()
for z0 in NEAR:
    for x0 in NEAR:
        if (x0, z0) in seen or kind(x0, z0) != 1:
            continue
        todo, block = [(x0, z0)], []
        seen.add((x0, z0))
        while todo:
            x, z = todo.pop()
            block.append((x, z))
            for t in ((x + 1, z), (x - 1, z), (x, z + 1), (x, z - 1)):
                if t not in seen and t[0] in NEAR and t[1] in NEAR and kind(*t) == 1:
                    seen.add(t)
                    todo.append(t)
        bx, bz = [t[0] for t in block], [t[1] for t in block]
        nx, nz = -(-(max(bx) + 1 - min(bx)) // CELL), -(-(max(bz) + 1 - min(bz)) // CELL)
        ex = [min(bx) + round(i * (max(bx) + 1 - min(bx)) / nx) for i in range(nx + 1)]
        ez = [min(bz) + round(i * (max(bz) + 1 - min(bz)) / nz) for i in range(nz + 1)]
        cells.extend((ex[i], ez[j], ex[i + 1], ez[j + 1], set(block)) for j in range(nz) for i in range(nx))
for cx, cz, cx1, cz1, block in cells:
    if True:
        cell = [(x, z) for z in range(cz, cz1) for x in range(cx, cx1)]
        tiles = [t for t in cell if t in block]
        if len(tiles) < 6:
            continue
        # the diagonal faces alone first (a stair that is not quite at 45 degrees: the face runs behind it, and leaves
        # a tile or two for a small building in front); then with the plain sides too
        for straight in (False, True):
            lot = [(cx, cz), (cx1, cz), (cx1, cz1), (cx, cz1)]
            for a, b, c in planes(tiles, straight):
                lot = clip(lot, a, b, c)
                if len(lot) < 3:
                    break
            if len(lot) >= 3 and abs(area(lot)) >= 6 and not any(kind(x, z) != 1 and inside(lot, x + 0.5, z + 0.5, -0.01) for x, z in cell):
                break
        else:
            continue
        tiles = [(x, z) for x, z in tiles if inside(lot, x + 0.5, z + 0.5, -0.05)]
        taken.update(tiles)
        building(lot, tiles, False, (cx, cz))
for z in range(LO, HI):
    for x in range(LO, HI):
        if (x, z) in taken or kind(x, z) != 1:
            continue
        far = max(-x, -z, x - N, z - N) > 22
        w = d = 1
        mw, md = (rnd.randint(5, 9), rnd.randint(5, 9)) if far else (rnd.randint(4, 8), rnd.randint(4, 8))
        while w < mw and x + w < HI and kind(x + w, z) == 1 and (x + w, z) not in taken:
            w += 1
        while d < md and z + d < HI and all(kind(x + i, z + d) == 1 and (x + i, z + d) not in taken for i in range(w)):
            d += 1
        tiles = [(x + i, z + j) for i in range(w) for j in range(d)]
        taken.update(tiles)
        lot = [(x, z), (x + w, z), (x + w, z + d), (x, z + d)]
        for a, b, c in planes(tiles, False):
            lot = clip(lot, a, b, c)
        if len(lot) >= 3:
            building(lot, tiles, far, (x // CELL, z // CELL, far))

mesh = bpy.data.meshes.new("city")
mesh.from_pydata(verts, [], faces)
for name, (col, glow) in MATS.items():
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    if "mask" in sys.argv:  # the ground a unit may stand on in white, all the rest black
        col, glow = ((1, 1, 1), 1) if name in ("asphalt", "plaza", "seam", "deck", "lane") else ((0, 0, 0), 0)
        b.inputs["Specular IOR Level"].default_value = 0
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Roughness"].default_value = 0.35 if name in ("asphalt", "plaza", "deck") else 0.8
    if glow:
        b.inputs["Emission Color"].default_value = (*col, 1)
        b.inputs["Emission Strength"].default_value = glow
    mesh.materials.append(m)
mesh.polygons.foreach_set("material_index", fmat)
if OWNER:
    own = mesh.color_attributes.new("own", "FLOAT_COLOR", "FACE")
    own.data.foreach_set("color", [c for f in fown for c in f])
    for m in mesh.materials:  # nothing but the owner's colour, unlit
        nodes, links = m.node_tree.nodes, m.node_tree.links
        nodes.clear()
        attr, out = nodes.new("ShaderNodeAttribute"), nodes.new("ShaderNodeOutputMaterial")
        attr.attribute_name = "own"
        emit = nodes.new("ShaderNodeEmission")
        links.new(attr.outputs["Color"], emit.inputs["Color"])
        links.new(emit.outputs["Emission"], out.inputs["Surface"])
mesh.update()
obj = bpy.data.objects.new("city", mesh)
scene = bpy.context.scene
scene.collection.objects.link(obj)
for o in list(scene.objects):
    if o is not obj:
        bpy.data.objects.remove(o)

args = sys.argv[sys.argv.index("--") + 1:]
if args[0] == "glb":
    # The game's copy: the volumes only (what hides a unit and takes the fog), nothing emissive or paper-thin.
    keep = {MAT_ID[k] for k in ("asphalt", "plaza", "deck", "wall", "wall2", "roof", "deepfloor")}
    quad([(LO, -0.03, LO), (LO, -0.03, HI), (HI, -0.03, HI), (HI, -0.03, LO)], "plaza")
    mesh.clear_geometry()
    mesh.from_pydata(verts, [], faces)
    mesh.polygons.foreach_set("material_index", fmat)
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index not in keep], context="FACES")
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.001)
    bmesh.ops.dissolve_limit(bm, angle_limit=0.01, verts=bm.verts, edges=bm.edges)  # flat ground: a few big faces
    bm.to_mesh(mesh)
    while len(mesh.materials) > 1:
        mesh.materials.pop()
    mesh.polygons.foreach_set("material_index", [0] * len(mesh.polygons))
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=args[1], export_format="GLB", use_selection=True, export_normals=False, export_texcoords=False, export_materials="NONE", export_yup=True)
else:
    sx, sy, ppu, W, H = float(args[1]), float(args[2]), float(args[3]), int(args[4]), int(args[5])
    # the ground point (h = 0) under the picture's centre
    a, b = sx * R2, -sy * R2 / math.sin(PITCH)  # x - z, x + z
    tx, tz = (a + b) / 2, (b - a) / 2
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = max(W, H) / ppu
    cam.data.clip_start, cam.data.clip_end = 1, 1000
    off = Vector((math.sin(math.pi / 4) * math.cos(PITCH), -math.cos(math.pi / 4) * math.cos(PITCH), math.sin(PITCH))) * 400
    cam.location = Vector((tx, -tz, 0)) + off
    cam.rotation_euler = (-off).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    MASK = args[0] in ("mask", "owner")
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy, sun.data.color, sun.data.angle = 0 if MASK else 2.0, (0.7, 0.8, 1.0), 0.2
    sun.rotation_euler = (math.radians(50), 0, math.radians(200))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.04, 0.06, 0.09, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0 if MASK else 1.5
    scene.world = world
    scene.render.engine = "BLENDER_EEVEE"
    try:
        scene.eevee.use_raytracing = True  # the lights of the shops and signs reach the wet ground
        scene.eevee.ray_tracing_options.resolution_scale = "2"
        scene.eevee.use_gtao = True
    except Exception as e:
        print("eevee:", e)
    scene.view_settings.view_transform = "Raw" if OWNER else "Standard"
    if OWNER:  # exact colours: no smoothing of the edges
        scene.render.filter_size = 0.01
        scene.eevee.taa_render_samples = 1
        scene.display_settings.display_device = "sRGB"
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = W, H, 100
    scene.render.filepath = args[6]
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
