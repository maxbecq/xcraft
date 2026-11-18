"""The second rank of gods (Odin, Athéna, Isis) and the troops they bring (Corbeau, Drake, Élémentaire, Prêtresse).

Rudimentary sculpts, in the style of gods.py and units.py and from the same kit: read at a glance from the game's
camera, to be refined later. Each faces -Y, origin on the ground; gods ~2.1 units tall, troops ~1.
"""
import math

from gods import arm, god_circle, halo, leg, lerp, torso_blobs
from kit import along, ball, box, cyl, face, fist, meta, motes, sheet, skirt, strand, torus


def _figure(p, skin, H=1.86, w=1.0):
    """A standing god's body: torso, neck and arms in one sculpt, head; returns the head centre and the hands."""
    P, C, N = (0, 0, 1.0), (0, 0, 1.42), (0, 0, 1.66)
    LS, LE, LW = (-0.34 * w, 0, 1.6), (-0.46 * w, -0.06, 1.34), (-0.5 * w, -0.16, 1.12)
    RS, RE, RW = (0.34 * w, 0, 1.6), (0.5 * w, -0.08, 1.4), (0.52 * w, -0.2, 1.2)
    ca, ba = arm(LS, LE, LW, w)
    cb, bb = arm(RS, RE, RW, w)
    meta(p[skin], caps=[(N, (0, -0.01, 1.8), 0.075)] + ca + cb, blobs=torso_blobs(P, C, N, w) + ba + bb)
    head = (0, -0.02, H)
    face(p, p[skin], head)
    fist(p, p[skin], LW, facing=(0.3, -1, 0), r=0.055)
    fist(p, p[skin], RW, facing=(-0.3, -1, 0), r=0.055)
    return head, LW, RW


def _legs(p, m, w=1.05):
    c1, b1 = leg((-0.13, 0, 0.97), (-0.17, -0.06, 0.55), (-0.19, -0.05, 0.12), (-0.2, -0.22, 0.05), w)
    c2, b2 = leg((0.13, 0, 0.97), (0.17, -0.02, 0.55), (0.19, 0.0, 0.12), (0.2, -0.18, 0.05), w)
    meta(p[m], caps=c1 + c2, blobs=b1 + b2 + [((0, 0, 1.0), 0.18, (1.15, 0.85, 0.6), (0, 0, 0))])


# ------------------------------------------------------------------ Odin: the one-eyed king, spear and ravens
def odin(p):
    god_circle(p, 0.9)
    _legs(p, "leather")
    head, LW, RW = _figure(p, "skin")
    # mail coat and a long blue cloak
    skirt(p["steel"], 1.25, 0.45, 0.24, 0.36, pleats=10, depth=0.01)
    skirt(p["navy"], 1.68, 0.06, 0.3, 0.52, pleats=14, depth=0.03, gap=2.2)
    meta(p["steel"], blobs=[((0, 0, 1.42), 0.28, (1.05, 0.75, 0.82), (0, 0, 0))])
    torus(p["gold"], 0.22, 0.02, (0, 0, 1.05)).scale = (1.1, 0.85, 1)
    sheet(p["team"], 1, 1, lambda u, t: ((u - 0.5) * 0.2, -0.24 - 0.03 * t, 1.0 - 0.45 * t), cuts=6, thick=0.015)
    # long grey beard, eye patch, winged helm
    meta(p["white"], blobs=[((0, -0.1, 1.72), 0.1, (1.0, 0.7, 1.6), (0.3, 0, 0)), ((0, -0.14, 1.56), 0.07, (0.9, 0.7, 1.4), (0.2, 0, 0))])
    box(p["shadow"], (0.05, 0.012, 0.035), (-0.04, -0.105, head[2] + 0.01))
    ball(p["steel"], 0.13, (0, -0.01, head[2] + 0.06), (1, 1.05, 0.8))
    for s in (-1, 1):
        for k in range(4):
            box(p["white"], (0.02, 0.05, 0.16 - k * 0.025), (s * (0.14 + k * 0.02), 0.03 + k * 0.02, head[2] + 0.12 + k * 0.03), (0, s * math.radians(20 + k * 12), 0), bevel=0.5)
    halo(p, (0, 0.06, head[2] + 0.14), 0.36, "ether")
    # Gungnir, upright in his right hand
    along(p["wood_dark"], (RW[0], RW[1], 0.05), (RW[0], RW[1], 2.5), 0.022)
    cyl(p["gold"], 0.05, 0.25, (RW[0], RW[1], 2.6), v=4, r2=0.0)
    # two ravens on his shoulders
    for s in (-1, 1):
        _raven(p, (s * 0.38, 0.02, 1.72), s)


def _raven(p, at, s=1, k=1.0):
    x, y, z = at
    ball(p["shadow"], 0.07 * k, (x, y, z + 0.06 * k), (0.8, 1.3, 0.8))
    ball(p["shadow"], 0.045 * k, (x, y - 0.09 * k, z + 0.11 * k))
    cyl(p["gold"], 0.015 * k, 0.06 * k, (x, y - 0.14 * k, z + 0.105 * k), rot=(math.pi / 2, 0, 0), v=6, r2=0.0)
    ball(p["ether"], 0.008 * k, (x + s * 0.02 * k, y - 0.11 * k, z + 0.12 * k))


# ------------------------------------------------------------------ Athéna: gold armour, crested helm, shield, spear
def athena(p):
    god_circle(p, 0.8)
    _legs(p, "skin", 0.9)
    skirt(p["white"], 1.2, 0.08, 0.2, 0.42, pleats=22, depth=0.02)
    head, LW, RW = _figure(p, "skin", 1.84, 0.88)
    meta(p["gold"], blobs=[((0, 0, 1.4), 0.27, (1.0, 0.74, 0.85), (0, 0, 0)), ((0, -0.02, 1.2), 0.2, (1.0, 0.8, 0.6), (0, 0, 0))])
    for s in (-1, 1):
        ball(p["gold"], 0.11, (s * 0.32, 0, 1.6), (1, 1.1, 0.5), (0, s * 0.4, 0))
    sheet(p["team"], 1, 1, lambda u, t: ((u - 0.5) * 0.18, -0.22 - 0.02 * t, 1.1 - 0.5 * t), cuts=6, thick=0.015)
    # Corinthian helm pushed up, high crest in the team colour
    ball(p["gold"], 0.13, (0, 0, head[2] + 0.07), (1, 1.1, 0.85))
    sheet(p["team"], 1, 1, lambda u, t: (0, -0.16 + 0.34 * u, head[2] + 0.18 + 0.16 * math.sin(u * math.pi) * (1 - t * 0.6)), cuts=10, thick=0.03)
    halo(p, (0, 0.06, head[2] + 0.16), 0.36, "sun")
    # round shield on the left arm, the gorgon in its centre; spear in the right hand
    o = cyl(p["gold"], 0.36, 0.04, (LW[0] - 0.08, LW[1] - 0.05, LW[2] + 0.05), rot=(math.pi / 2, 0, math.radians(-20)), v=32)
    torus(p["bronze_skin"], 0.3, 0.02, (LW[0] - 0.09, LW[1] - 0.08, LW[2] + 0.05), rot=(math.pi / 2, 0, math.radians(-20)))
    ball(p["jade"], 0.08, (LW[0] - 0.1, LW[1] - 0.1, LW[2] + 0.05), (1, 0.5, 1))
    along(p["wood_dark"], (RW[0], RW[1], 0.1), (RW[0], RW[1] + 0.02, 2.55), 0.02)
    cyl(p["gold"], 0.045, 0.22, (RW[0], RW[1] + 0.02, 2.65), v=4, r2=0.0)
    # her owl on the shield's rim
    ball(p["sand"], 0.06, (LW[0] - 0.3, LW[1] - 0.05, LW[2] + 0.42), (1, 0.9, 1.2))
    ball(p["sand"], 0.045, (LW[0] - 0.3, LW[1] - 0.07, LW[2] + 0.5))
    for x in (-0.018, 0.018):
        ball(p["amber"], 0.012, (LW[0] - 0.3 + x, LW[1] - 0.11, LW[2] + 0.51))


# ------------------------------------------------------------------ Isis: wings of gold, horned sun crown, ankh
def isis(p):
    god_circle(p, 0.85, "turq")
    skirt(p["white"], 1.25, 0.05, 0.18, 0.36, pleats=26, depth=0.012)
    skirt(p["lapis"], 1.28, 0.95, 0.2, 0.26, pleats=12, depth=0.01)
    head, LW, RW = _figure(p, "bronze_skin", 1.84, 0.82)
    meta(p["white"], blobs=[((0, 0, 1.4), 0.24, (1.0, 0.72, 0.85), (0, 0, 0))])
    torus(p["gold"], 0.2, 0.03, (0, -0.01, 1.58)).scale = (1.2, 0.9, 1)
    sheet(p["team"], 1, 1, lambda u, t: ((u - 0.5) * 0.16, -0.2 - 0.02 * t, 1.2 - 0.55 * t), cuts=6, thick=0.015)
    # vulture headdress, horns and the sun disk
    ball(p["lapis"], 0.13, (0, 0.02, head[2] + 0.03), (1.05, 1.1, 0.9))
    for s in (-1, 1):
        strand(p["gold"], [(s * 0.06, 0, head[2] + 0.12), (s * 0.18, 0, head[2] + 0.22), (s * 0.14, 0, head[2] + 0.38), (s * 0.06, 0, head[2] + 0.42)], 0.018, 0.008)
    cyl(p["sun"], 0.13, 0.03, (0, 0, head[2] + 0.3), rot=(math.pi / 2, 0, 0), v=32)
    halo(p, (0, 0.1, head[2] + 0.3), 0.42, "turq")
    # wings of feathers spread from her arms, gold and turquoise rows
    for s in (-1, 1):
        for row, (m, L) in enumerate((("gold", 0.95), ("turq", 0.8), ("lapis", 0.62))):
            sheet(p[m], 1, 1, lambda u, t, s=s, row=row, L=L: (s * (0.3 + u * L), 0.12 + 0.05 * row, 1.62 - 0.08 * row - u * 0.25 - t * (0.55 - 0.12 * row) * (1 - 0.4 * u)), cuts=10, thick=0.012)
    # the ankh in her right hand
    along(p["gold"], (RW[0], RW[1] - 0.02, RW[2] - 0.25), (RW[0], RW[1] - 0.02, RW[2] + 0.12), 0.018)
    torus(p["gold"], 0.06, 0.016, (RW[0], RW[1] - 0.02, RW[2] + 0.2), rot=(math.pi / 2, 0, 0)).scale = (0.8, 1, 1.2)
    box(p["gold"], (0.18, 0.03, 0.03), (RW[0], RW[1] - 0.02, RW[2] + 0.12))


# ------------------------------------------------------------------ the troops
def corbeau(p):
    """Odin's raven, wings spread in flight."""
    _raven(p, (0, 0, 0.35), 1, 2.4)
    for s in (-1, 1):
        sheet(p["shadow"], 1, 1, lambda u, t, s=s: (s * (0.1 + u * 0.42), 0.02 + t * 0.14, 0.58 + math.sin(u * math.pi) * 0.08 - u * 0.05), cuts=8, thick=0.015)
    sheet(p["shadow"], 1, 1, lambda u, t: ((u - 0.5) * (0.06 + 0.12 * t), 0.12 + t * 0.2, 0.5), cuts=6, thick=0.015)
    ball(p["team"], 0.03, (0, 0.05, 0.62))
    motes(p["ether"], (0, 0, 0.5), 0.25, 5, 3, size=0.01, zmin=0.4, zmax=0.7)


def drake(p):
    """A heavy winged drake: scaled body, long neck and tail, wings half spread, fire in its jaws."""
    meta(p["copper"], caps=[((0, 0.05, 0.55), (0, -0.45, 0.95), 0.12), ((0, -0.45, 0.95), (0, -0.62, 0.92), 0.1),
                            ((0, 0.3, 0.52), (0, 0.8, 0.35), 0.1), ((0, 0.8, 0.35), (0.15, 1.15, 0.25), 0.05)],
         blobs=[((0, 0.1, 0.55), 0.32, (1.0, 1.4, 0.85), (0, 0, 0)), ((0, -0.66, 0.93), 0.11, (0.9, 1.5, 0.8), (0, 0, 0))])
    for x, y in ((-0.2, -0.15), (0.2, -0.15), (-0.2, 0.35), (0.2, 0.35)):
        along(p["copper"], (x, y, 0.5), (x * 1.1, y, 0.05), 0.07, 0.05)
        box(p["horn"], (0.1, 0.14, 0.05), (x * 1.1, y - 0.05, 0.03), bevel=0.6)
    for s in (-1, 1):
        sheet(p["leather"], 1, 1, lambda u, t, s=s: (s * (0.15 + u * 0.75), 0.0 + t * 0.45 * (1 - 0.5 * u), 0.85 + math.sin(u * math.pi) * 0.2 - t * 0.1), cuts=10, thick=0.02)
        strand(p["horn"], [(s * 0.06, -0.62, 1.0), (s * 0.12, -0.55, 1.12), (s * 0.14, -0.45, 1.18)], 0.025, 0.006)
        ball(p["amber"], 0.02, (s * 0.06, -0.76, 0.97))
    for k in range(5):
        cyl(p["horn"], 0.035, 0.1, (0, -0.2 + k * 0.18, 0.86 - abs(k - 1) * 0.03), v=4, r2=0.0)
    ball(p["sun"], 0.06, (0, -0.84, 0.88))
    ball(p["sun_veil"], 0.12, (0, -0.88, 0.88))
    sheet(p["team"], 1, 1, lambda u, t: ((u - 0.5) * 0.3, 0.1 + t * 0.2, 0.84), cuts=4, thick=0.015)


def elementaire(p):
    """The fire form: a small figure of flames round a burning core."""
    meta(p["amber"], caps=[((0, 0, 0.15), (0, 0, 0.6), 0.12)], blobs=[((0, 0, 0.75), 0.13, (1, 1, 1.1), (0, 0, 0))])
    for s in (-1, 1):
        strand(p["sun"], [(s * 0.1, 0, 0.6), (s * 0.24, -0.08, 0.5), (s * 0.28, -0.16, 0.6)], 0.045, 0.015)
    for k in range(9):
        a = k / 9 * math.tau
        strand(p["sun" if k % 2 else "amber"], [(math.cos(a) * 0.12, math.sin(a) * 0.1, 0.25 + (k % 3) * 0.15), (math.cos(a) * 0.08, math.sin(a) * 0.08 + 0.05, 0.75 + (k % 3) * 0.08), (math.cos(a) * 0.02, 0.08, 1.0 + (k % 3) * 0.05)], 0.04, 0.004)
    ball(p["ether"], 0.05, (0, -0.06, 0.62))
    torus(p["team"], 0.16, 0.02, (0, 0, 0.12))
    motes(p["sun"], (0, 0, 0.4), 0.35, 12, 5, size=0.015, zmin=0.2, zmax=1.1)


def pretresse(p):
    """Isis's priestess: white robe, lapis headdress, an ankh staff."""
    skirt(p["white"], 0.62, 0.02, 0.1, 0.22, pleats=16, depth=0.01)
    meta(p["bronze_skin"], caps=[((0, 0, 0.62), (0, 0, 0.82), 0.075), ((-0.12, 0, 0.78), (-0.16, -0.1, 0.58), 0.03), ((0.12, 0, 0.78), (0.16, -0.12, 0.62), 0.03)],
         blobs=[((0, 0, 0.92), 0.075, (0.9, 1, 1.1), (0, 0, 0))])
    meta(p["white"], blobs=[((0, 0, 0.72), 0.1, (1.0, 0.75, 0.9), (0, 0, 0))])
    ball(p["lapis"], 0.085, (0, 0.01, 0.95), (1.05, 1.1, 0.9))
    for x in (-0.08, 0.08):
        box(p["lapis"], (0.04, 0.03, 0.16), (x, 0.02, 0.86))
    torus(p["gold"], 0.09, 0.012, (0, 0, 0.82))
    sheet(p["team"], 1, 1, lambda u, t: ((u - 0.5) * 0.1, -0.11 - 0.01 * t, 0.6 - 0.25 * t), cuts=4, thick=0.01)
    along(p["gold"], (0.16, -0.12, 0.03), (0.16, -0.12, 1.0), 0.012)
    torus(p["turq"], 0.04, 0.01, (0.16, -0.12, 1.06), rot=(math.pi / 2, 0, 0))
    ball(p["ether"], 0.02, (0.16, -0.12, 1.06))


# ------------------------------------------------------------------ third rank
def frigg(p):
    """Frigg, lady of the clouds: she floats on a cloud, veiled, a distaff of light."""
    for k in range(7):
        a = k / 7 * math.tau
        ball(p["white"], 0.28, (math.cos(a) * 0.38, math.sin(a) * 0.38, 0.32), (1, 1, 0.55))
    ball(p["white"], 0.4, (0, 0, 0.4), (1, 1, 0.5))
    skirt(p["lapis"], 1.3, 0.45, 0.2, 0.42, pleats=20, depth=0.02)
    head, LW, RW = _figure(p, "skin", 1.84, 0.82)
    meta(p["lapis"], blobs=[((0, 0, 1.4), 0.24, (1.0, 0.72, 0.85), (0, 0, 0))])
    sheet(p["white"], 1, 1, lambda u, t: (math.cos(u * math.pi) * 0.2, 0.05 + math.sin(u * math.pi) * 0.12, head[2] + 0.12 - t * 1.1), cuts=10, thick=0.012)
    sheet(p["team"], 1, 1, lambda u, t: ((u - 0.5) * 0.16, -0.2 - 0.02 * t, 1.2 - 0.5 * t), cuts=6, thick=0.015)
    torus(p["gold"], 0.11, 0.015, (0, 0, head[2] + 0.1))
    halo(p, (0, 0.06, head[2] + 0.14), 0.36, "ether")
    along(p["gold"], (RW[0], RW[1], RW[2] - 0.3), (RW[0], RW[1], RW[2] + 0.5), 0.016)
    ball(p["ether"], 0.06, (RW[0], RW[1], RW[2] + 0.55))
    ball(p["ether_veil"], 0.14, (RW[0], RW[1], RW[2] + 0.55))
    motes(p["ether"], (0, 0, 0.6), 0.9, 20, 11, size=0.012, zmin=0.2, zmax=2.2)


def hades(p):
    """Hadès, lord below: dark armour, a crown of black flames, the bident, a three-headed shadow at his feet."""
    god_circle(p, 0.9, "amber")
    _legs(p, "iron")
    skirt(p["shadow"], 1.6, 0.05, 0.3, 0.55, pleats=16, depth=0.03, gap=1.6)
    head, LW, RW = _figure(p, "bronze_skin")
    meta(p["iron"], blobs=[((0, 0, 1.42), 0.29, (1.05, 0.76, 0.82), (0, 0, 0)), ((0, -0.02, 1.2), 0.21, (1.0, 0.8, 0.6), (0, 0, 0))])
    for s in (-1, 1):
        ball(p["iron"], 0.13, (s * 0.34, 0, 1.62), (1, 1.1, 0.55), (0, s * 0.4, 0))
        cyl(p["horn"], 0.03, 0.18, (s * 0.38, 0, 1.75), rot=(0, s * 0.5, 0), v=6, r2=0.0)
    sheet(p["team"], 1, 1, lambda u, t: ((u - 0.5) * 0.2, -0.25 - 0.03 * t, 1.0 - 0.45 * t), cuts=6, thick=0.015)
    meta(p["shadow"], blobs=[((0, -0.08, 1.72), 0.09, (1.0, 0.7, 1.4), (0.3, 0, 0))])
    for k in range(7):
        a = math.radians(-60 + k * 20)
        strand(p["amber"], [(math.sin(a) * 0.1, 0.0, head[2] + 0.1), (math.sin(a) * 0.14, 0.0, head[2] + 0.25 + (k % 2) * 0.06)], 0.025, 0.004)
    halo(p, (0, 0.06, head[2] + 0.16), 0.38, "amber")
    along(p["iron"], (RW[0], RW[1], 0.1), (RW[0], RW[1], 2.45), 0.025)
    for x in (-0.06, 0.06):
        cyl(p["iron"], 0.025, 0.25, (RW[0] + x, RW[1], 2.55), v=4, r2=0.0)
    box(p["iron"], (0.16, 0.03, 0.03), (RW[0], RW[1], 2.43))
    for k, x in enumerate((-0.5, -0.3, -0.1)):
        ball(p["shadow"], 0.09, (x - 0.2, -0.45, 0.3 + 0.04 * k), (0.9, 1.3, 0.9))
        ball(p["amber"], 0.015, (x - 0.2, -0.56, 0.33 + 0.04 * k))


def osiris(p):
    """Osiris, judge of the dead: green skin, mummy wrappings, the white crown with plumes, crook and flail."""
    god_circle(p, 0.9, "jade")
    meta(p["white"], caps=[((-0.13, 0, 0.97), (-0.15, 0, 0.1), 0.1), ((0.13, 0, 0.97), (0.15, 0, 0.1), 0.1)],
         blobs=[((0, 0, 0.6), 0.25, (1.1, 0.9, 1.8), (0, 0, 0))])
    for z in range(8):
        torus(p["sand"], 0.24 - abs(z - 4) * 0.01, 0.012, (0, 0, 0.2 + z * 0.12)).scale = (1.1, 0.9, 1)
    head, LW, RW = _figure(p, "jade")
    meta(p["white"], blobs=[((0, 0, 1.4), 0.26, (1.0, 0.74, 0.85), (0, 0, 0))])
    torus(p["gold"], 0.22, 0.035, (0, -0.01, 1.6)).scale = (1.2, 0.9, 1)
    sheet(p["team"], 1, 1, lambda u, t: ((u - 0.5) * 0.18, -0.24 - 0.02 * t, 1.1 - 0.5 * t), cuts=6, thick=0.015)
    cyl(p["white"], 0.11, 0.35, (0, 0, head[2] + 0.25), v=24, r2=0.05)
    ball(p["white"], 0.06, (0, 0, head[2] + 0.43))
    for s in (-1, 1):
        sheet(p["white"], 1, 1, lambda u, t, s=s: (s * (0.12 + 0.03 * u), 0.0, head[2] + 0.05 + t * 0.4), cuts=4, thick=0.01)
    halo(p, (0, 0.08, head[2] + 0.2), 0.4, "jade")
    strand(p["gold"], [(LW[0] + 0.05, LW[1], LW[2] - 0.2), (LW[0] + 0.05, LW[1], LW[2] + 0.4), (LW[0] - 0.03, LW[1], LW[2] + 0.5), (LW[0] - 0.08, LW[1], LW[2] + 0.42)], 0.016, 0.014)
    along(p["gold"], (RW[0], RW[1], RW[2] - 0.1), (RW[0], RW[1], RW[2] + 0.35), 0.016)
    for k in range(3):
        strand(p["lapis"], [(RW[0], RW[1], RW[2] + 0.35), (RW[0] + 0.05 + k * 0.03, RW[1] - 0.05, RW[2] + 0.2)], 0.012, 0.01)


def walkyrie(p):
    """A valkyrie in flight: winged helm, mail, white wings, the double sword."""
    meta(p["skin"], caps=[((0, 0, 0.45), (0, 0, 0.72), 0.07), ((-0.1, 0, 0.68), (-0.2, -0.1, 0.52), 0.03), ((0.1, 0, 0.68), (0.22, -0.12, 0.6), 0.03)],
         blobs=[((0, 0, 0.82), 0.07, (0.9, 1, 1.1), (0, 0, 0))])
    skirt(p["steel"], 0.6, 0.3, 0.08, 0.14, pleats=10, depth=0.008)
    ball(p["steel"], 0.075, (0, 0, 0.85), (1, 1.05, 0.8))
    for s in (-1, 1):
        box(p["white"], (0.015, 0.04, 0.09), (s * 0.08, 0.02, 0.9), (0, s * 0.4, 0))
        sheet(p["white"], 1, 1, lambda u, t, s=s: (s * (0.08 + u * 0.45), 0.08 + t * 0.12, 0.72 + math.sin(u * math.pi) * 0.1 - t * 0.25 * (1 - 0.5 * u)), cuts=8, thick=0.012)
    meta(p["leather"], blobs=[((0, 0, 0.3), 0.06, (1, 1, 2.5), (0, 0, 0))])
    along(p["steel"], (0.22, -0.12, 0.35), (0.22, -0.12, 0.9), 0.012)
    box(p["gold"], (0.1, 0.02, 0.02), (0.22, -0.12, 0.62))
    sheet(p["team"], 1, 1, lambda u, t: ((u - 0.5) * 0.08, -0.09, 0.62 - 0.2 * t), cuts=4, thick=0.01)


def titan(p):
    """A demigod of bronze, crowned with lightning, a bolt in the raised hand."""
    meta(p["bronze_skin"], caps=[((0, 0, 0.6), (0, 0, 1.05), 0.16), ((-0.2, 0, 1.0), (-0.3, -0.1, 0.7), 0.06), ((0.2, 0, 1.0), (0.32, -0.05, 1.3), 0.06),
                                 ((-0.1, 0, 0.6), (-0.13, 0, 0.08), 0.08), ((0.1, 0, 0.6), (0.13, 0, 0.08), 0.08)],
         blobs=[((0, 0, 1.2), 0.11, (0.9, 1, 1.1), (0, 0, 0)), ((0, 0, 0.92), 0.22, (1.1, 0.8, 0.9), (0, 0, 0))])
    skirt(p["white"], 0.7, 0.35, 0.16, 0.22, pleats=14, depth=0.01)
    meta(p["gold"], blobs=[((0, 0, 0.95), 0.2, (1.1, 0.8, 0.85), (0, 0, 0))])
    for k in range(5):
        a = math.radians(-50 + k * 25)
        strand(p["bolt"], [(math.sin(a) * 0.1, 0.0, 1.28), (math.sin(a) * 0.15, 0.0, 1.42)], 0.015, 0.004)
    strand(p["bolt"], [(0.32, -0.05, 1.32), (0.36, -0.05, 1.5), (0.3, -0.05, 1.6), (0.36, -0.05, 1.78)], 0.025, 0.008)
    sheet(p["team"], 1, 1, lambda u, t: ((u - 0.5) * 0.14, -0.17, 0.85 - 0.3 * t), cuts=4, thick=0.012)


def immortel(p):
    """A giant mummy, wrapped and hunched, a cloud of green rot round it."""
    meta(p["sand"], caps=[((0, 0.05, 0.55), (0, -0.05, 1.05), 0.2), ((-0.25, 0, 0.98), (-0.35, -0.2, 0.6), 0.08), ((0.25, 0, 0.98), (0.35, -0.22, 0.62), 0.08),
                          ((-0.13, 0, 0.55), (-0.16, 0, 0.06), 0.1), ((0.13, 0, 0.55), (0.16, 0, 0.06), 0.1)],
         blobs=[((0, -0.12, 1.15), 0.12, (0.9, 1, 1.0), (0, 0, 0))])
    for z in range(10):
        torus(p["white"], 0.21 - abs(z - 5) * 0.01, 0.012, (0, 0, 0.15 + z * 0.09)).scale = (1.1, 0.95, 1)
    for x in (-0.04, 0.04):
        ball(p["jade"], 0.016, (x, -0.23, 1.17))
    torus(p["gold"], 0.13, 0.02, (0, -0.02, 1.0))
    sheet(p["team"], 1, 1, lambda u, t: ((u - 0.5) * 0.16, -0.22, 0.9 - 0.3 * t), cuts=4, thick=0.012)
    motes(p["jade"], (0, 0, 0.6), 0.55, 18, 13, size=0.03, zmin=0.1, zmax=1.2)


def fontaine(p):
    """The Fontaine d'eau du Nil: a basin of carved stone round a lotus fountain of light."""
    cyl(p["marble"], 0.85, 0.3, (0, 0, 0.15), v=40)
    cyl(p["turq"], 0.75, 0.05, (0, 0, 0.29), v=40)
    torus(p["gold"], 0.85, 0.03, (0, 0, 0.3))
    cyl(p["marble2"], 0.16, 0.7, (0, 0, 0.6), v=20, r2=0.1)
    for k in range(8):
        a = k / 8 * math.tau
        ball(p["lapis"], 0.12, (math.cos(a) * 0.16, math.sin(a) * 0.16, 1.0), (0.5, 0.2, 1.0), (0.6, 0, a + math.pi / 2))
    ball(p["ether"], 0.08, (0, 0, 1.1))
    for k in range(6):
        a = k / 6 * math.tau
        strand(p["ether_soft"], [(0, 0, 1.1), (math.cos(a) * 0.35, math.sin(a) * 0.35, 1.0), (math.cos(a) * 0.6, math.sin(a) * 0.6, 0.35)], 0.025, 0.01)
    for k in range(4):
        a = k / 4 * math.tau + 0.4
        box(p["team"], (0.12, 0.04, 0.1), (math.cos(a) * 0.86, math.sin(a) * 0.86, 0.22), (0, 0, a))
    motes(p["ether"], (0, 0, 0.6), 0.8, 14, 17, size=0.015, zmin=0.3, zmax=1.4)
