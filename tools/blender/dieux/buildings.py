"""The V1 buildings. Fronts face -Y."""
import math
import random

from kit import ball, box, cyl, ico, motes, ring_of, sheet, strand, torus


def rune_ring(p, R, z=0.02, n=12):
    torus(p["ether"], R, 0.022, (0, 0, z))
    ring_of(n, R - 0.14, lambda a, x, y: box(p["ether"], (0.12, 0.03, 0.01), (x, y, z), (0, 0, a)))


def brazier(p, x, y, z=0.0, s=1.0):
    cyl(p["gold"], 0.08 * s, 0.35 * s, (x, y, z + 0.17 * s), v=12, r2=0.05 * s)
    cyl(p["gold"], 0.16 * s, 0.1 * s, (x, y, z + 0.38 * s), v=16, r2=0.1 * s)
    cyl(p["sun"], 0.11 * s, 0.3 * s, (x, y, z + 0.55 * s), v=10, r2=0.0)
    ball(p["sun_veil"], 0.2 * s, (x, y, z + 0.58 * s), (1, 1, 1.4))


def porte(p):
    for i, (r, h) in enumerate([(2.55, 0.2), (2.25, 0.2), (1.95, 0.2)]):
        cyl(p["marble2" if i % 2 == 0 else "marble"], r, h, (0, 0, 0.1 + 0.2 * i), v=8, smooth=False)
    for k in range(3):
        box(p["marble"], (1.3 - k * 0.15, 0.3, 0.2), (0, -2.35 + k * 0.3, 0.1 + 0.2 * k), bevel=0.1)
    rune_ring(p, 1.75, 0.61)
    for x in (-1.05, 1.05):
        box(p["marble"], (0.55, 0.55, 2.6), (x, 0, 1.9), bevel=0.08)
        for dx in (-0.2, 0.2):
            box(p["marble2"], (0.08, 0.58, 2.3), (x + dx, 0, 1.9), bevel=0.3)
        box(p["ether"], (0.05, 0.6, 1.6), (x, 0, 1.95))
        box(p["gold"], (0.7, 0.7, 0.18), (x, 0, 3.22), bevel=0.2)
        box(p["gold"], (0.7, 0.7, 0.14), (x, 0, 0.66), bevel=0.2)
        ball(p["gold"], 0.12, (x, -0.36, 3.22))
    box(p["marble"], (3.0, 0.7, 0.45), (0, 0, 3.52), bevel=0.15)
    box(p["gold"], (3.2, 0.74, 0.1), (0, 0, 3.78), bevel=0.2)
    for x in (-0.9, -0.3, 0.3, 0.9):
        box(p["ether"], (0.18, 0.02, 0.18), (x, -0.36, 3.52), (0, math.radians(45), 0))
    cyl(p["gold"], 0.3, 0.6, (0, 0, 4.12), v=4, r2=0)
    ball(p["ether"], 0.14, (0, 0, 4.6))
    ball(p["ether_veil"], 0.32, (0, 0, 4.6))
    # floating shards over the arch
    rng = random.Random(6)
    for i in range(7):
        a = i / 7 * math.tau
        ico(p["ether_soft"], rng.uniform(0.08, 0.14), (math.cos(a) * 0.9, math.sin(a) * 0.35, 4.3 + rng.uniform(-0.1, 0.25)), 0)
    # the portal: a veil of ether with a slow spiral of light
    cyl(p["ether_veil"], 0.84, 0.05, (0, 0, 1.95), rot=(math.pi / 2, 0, 0), v=40)
    torus(p["gold"], 0.88, 0.05, (0, 0, 1.95), rot=(math.pi / 2, 0, 0))
    for k in range(4):
        pts = []
        for i in range(10):
            t = i / 9
            a = k * math.pi / 2 + t * 2.6
            pts.append((math.cos(a) * 0.8 * t, -0.02, 1.95 + math.sin(a) * 0.8 * t))
        strand(p["ether"], pts, 0.004, 0.025)
    motes(p["ether"], (0, -0.6, 0.6), 0.9, 24, 3, size=0.02, zmin=0.1, zmax=2.4)
    for a in range(4):
        ang = math.pi / 4 + a * math.pi / 2
        x, y = math.cos(ang) * 1.85, math.sin(ang) * 1.85
        cyl(p["marble2"], 0.17, 1.3, (x, y, 1.25), v=4, r2=0.07, smooth=False)
        box(p["ether"], (0.02, 0.02, 0.6), (x, y - 0.12 if y < 0 else y + 0.12, 1.2))
        ball(p["ether"], 0.1, (x, y, 2.1))
        ball(p["ether_veil"], 0.2, (x, y, 2.1))
    for x in (-1.5, 1.5):
        brazier(p, x, -1.9, 0.0, 1.1)
    for x in (-1.05, 1.05):
        sheet(p["team"], 1, 1, lambda u, t, x=x: (x + (u - 0.5) * 0.4, -0.3 - 0.03 * math.sin(t * 6), 3.1 - 1.3 * t), cuts=10)
        box(p["gold"], (0.46, 0.06, 0.05), (x, -0.31, 3.1))


def tree(p, h=2.4, r=0.15, crown=1.0, seed=1):
    rng = random.Random(seed)
    for k in range(4):
        pts = []
        for i in range(8):
            t = i / 7
            a = k * math.pi / 2 + t * 3.2
            rr = r * (1.2 - 0.6 * t)
            pts.append((math.cos(a) * rr, math.sin(a) * rr, 0.05 + h * t))
        strand(p["bark" if k % 2 else "bark2"], pts, r * 0.9, r * 0.35, res=8)
    for i in range(7):
        a = i / 7 * math.tau + rng.uniform(-0.2, 0.2)
        strand(p["bark"], [(math.cos(a) * 0.12, math.sin(a) * 0.12, 0.35), (math.cos(a) * 0.5, math.sin(a) * 0.5, 0.15),
                           (math.cos(a) * 0.85, math.sin(a) * 0.85, 0.02)], 0.09, 0.015)
    for i in range(4):
        a = i / 4 * math.tau + 0.4
        strand(p["bark2"], [(0, 0, h * 0.75), (math.cos(a) * 0.4, math.sin(a) * 0.4, h * 0.95), (math.cos(a) * 0.65, math.sin(a) * 0.65, h * 1.05)], 0.05, 0.015)
    # crown: many small clumps, mint and spring green, a few in bloom
    for i in range(46):
        a = rng.uniform(0, math.tau)
        u = rng.random()
        rr = (0.15 + 0.55 * math.sqrt(u)) * crown
        z = h + (0.75 - 0.9 * u + rng.uniform(-0.12, 0.12)) * crown * 0.7
        c = "leafglow" if i % 3 else ("leaf" if i % 2 else "bloom_pink")
        size = rng.uniform(0.17, 0.27) * crown * (0.35 if c == "bloom_pink" else 1)
        ball(p[c], size, (math.cos(a) * rr, math.sin(a) * rr, z), (1, 1, 0.7), (0, 0, a))
    for i in range(14):
        a = i / 14 * math.tau + rng.uniform(-0.1, 0.1)
        rr = 0.7 * crown
        strand(p["leafglow"], [(math.cos(a) * rr * 0.8, math.sin(a) * rr * 0.8, h + 0.05), (math.cos(a) * rr, math.sin(a) * rr, h - 0.2),
                               (math.cos(a) * rr * 1.05, math.sin(a) * rr * 1.05, h - rng.uniform(0.6, 1.0) * crown)], 0.03, 0.006)
    for i in range(9):
        a = rng.uniform(0, math.tau)
        rr = rng.uniform(0.4, 0.75) * crown
        top = (math.cos(a) * rr, math.sin(a) * rr, h - 0.05)
        low = (top[0], top[1], h - rng.uniform(0.3, 0.6))
        strand(p["leaf"], [top, low], 0.01, 0.006)
        ball(p["ether"] if i % 3 else p["bloom_pink"], 0.05, low)
    motes(p["ether"], (0, 0, 0.2), 1.0 * crown, 18, seed, size=0.016, zmin=0.2, zmax=h + 0.5)


def branche(p):
    cyl(p["stone"], 0.98, 0.12, (0, 0, 0.06), v=10, smooth=False)
    rune_ring(p, 0.9, 0.125, 8)
    tree(p, 2.3, 0.16, 1.0, 1)
    sheet(p["team"], 1, 1, lambda u, t: (0.24 + 0.03 * math.sin(t * 5), -0.1 + (u - 0.5) * 0.28, 1.3 - 0.5 * t), cuts=8)


def protecteur(p):
    cyl(p["marble2"], 1.2, 0.18, (0, 0, 0.09), v=8, smooth=False)
    rune_ring(p, 1.1, 0.19, 10)
    tree(p, 2.8, 0.2, 1.2, 2)
    torus(p["gold"], 0.38, 0.05, (0, 0, 1.6))
    torus(p["gold"], 1.05, 0.035, (0, 0, 3.0), (0.15, 0.1, 0))
    torus(p["gold"], 0.85, 0.025, (0, 0, 3.15), (-0.2, 0.15, 0))
    cyl(p["ether"], 0.16, 0.6, (0, 0, 4.1), v=6, r2=0, smooth=False)
    cyl(p["ether"], 0.16, 0.3, (0, 0, 3.65), v=6, r2=0, rot=(math.pi, 0, 0), smooth=False)
    ball(p["ether_veil"], 0.4, (0, 0, 3.9))
    for i in range(5):
        a = i / 5 * math.tau + 0.4
        x, y = math.cos(a) * 1.0, math.sin(a) * 1.0
        box(p["marble"], (0.24, 0.16, 0.7), (x, y, 0.5), (0, 0, a), bevel=0.15)
        box(p["ether"], (0.03, 0.17, 0.4), (math.cos(a) * 1.12, math.sin(a) * 1.12, 0.52), (0, 0, a))
        ico(p["ether_soft"], 0.07, (x, y, 1.05), 0)
    sheet(p["team"], 1, 1, lambda u, t: (0.3 + 0.03 * math.sin(t * 5), -0.1 + (u - 0.5) * 0.34, 1.5 - 0.6 * t), cuts=8)


def antre(p):
    """The chosen board (retouches/antre-2, redone 2026-11-19): a grassy Art Nouveau mound on a square stone base,
    a tall gilded arch glowing warm from inside as its readable front, bronze whiplash vines, turquoise blossoms."""
    import bpy
    from kit import _fin, glow, paint
    bronze = paint("bronze", 0x9A7240, metallic=0.7, rough=0.5, kind="metal", dark=0.5, light=1.15, grain=0.2)
    grass = paint("grass", 0x74AC4A, kind="leaf", rough=0.95, dark=0.55, light=1.18, grain=0.3)
    jamb = paint("jamb", 0x7C6E60, kind="stone", rough=0.9, grain=0.25, scale=2.0)
    door = glow("doorglow", 0xFFB032, 4.0)
    R, H, N = 1.42, 1.95, 3.2
    rnd = random.Random(7)

    def rim(a):  # a rounded square: the mound fills its 3-tile footprint
        return R / (abs(math.cos(a)) ** N + abs(math.sin(a)) ** N) ** (1 / N)

    def on(a, rho, lift=0.0):  # a point on the mound at azimuth a (-pi/2 = front), rho 0 (top) .. 1 (rim)
        r = rim(a) * rho
        return (r * math.cos(a), r * math.sin(a), 0.08 + H * (1 - rho ** 1.5) ** 1.15 + lift)

    # the mound, built as one dome mesh (nothing under the ground)
    na, nr = 72, 18
    verts = [(0.0, 0.0, 0.08 + H)] + [on(i / na * math.tau, j / nr) for j in range(1, nr + 1) for i in range(na)]
    faces = [(0, 1 + i, 1 + (i + 1) % na) for i in range(na)]
    for j in range(nr - 1):
        for i in range(na):
            q, w = 1 + j * na, 1 + (j + 1) * na
            faces.append((q + i, w + i, w + (i + 1) % na, q + (i + 1) % na))
    me = bpy.data.meshes.new("mound")
    me.from_pydata(verts, [], faces)
    o = bpy.data.objects.new("mound", me)
    bpy.context.scene.collection.objects.link(o)
    _fin(o, grass, True)
    # square base, its corners in stone
    box(p["granite"], (3.0, 3.0, 0.1), (0, 0, 0.05), bevel=0.15)
    for x in (-1.36, 1.36):
        for y in (-1.36, 1.36):
            box(p["granite"], (0.3, 0.3, 0.2), (x, y, 0.1), (0, 0, rnd.uniform(-0.3, 0.3)), bevel=0.3)
    # grass tufts around the rim
    for i in range(40):
        a = i / 40 * math.tau + rnd.uniform(-0.04, 0.04)
        if abs(a - 1.5 * math.pi) < 0.3:
            continue
        x, y, _ = on(a, 0.98)
        ico(p["leaf"] if i % 2 else grass, 0.14, (x, y, 0.17), 1)
    # the doorway: a stone portal jutting from the slope, its opening glowing
    yf = -1.3
    box(jamb, (0.84, 0.9, 0.86), (0, yf + 0.45, 0.5), bevel=0.15)
    cyl(jamb, 0.42, 0.9, (0, yf + 0.45, 0.86), (math.pi / 2, 0, 0), v=32)
    box(p["shadow"], (0.74, 0.04, 0.8), (0, yf + 0.01, 0.5))
    box(door, (0.64, 0.06, 0.72), (0, yf - 0.01, 0.46))
    cyl(door, 0.32, 0.06, (0, yf - 0.01, 0.82), (math.pi / 2, 0, 0), v=32)
    box(p["stone"], (0.56, 0.36, 0.03), (0, yf - 0.16, 0.12), bevel=0.3)
    # gilded Art Nouveau arch: twin jambs rising into a pointed whiplash crest
    z0 = yf - 0.05
    for sx in (-1, 1):
        strand(p["gold"], [(sx * 0.46, z0, 0.1), (sx * 0.48, z0, 0.62), (sx * 0.44, z0, 1.06),
                           (sx * 0.24, z0, 1.36), (sx * 0.03, z0 + 0.02, 1.5)], 0.075, 0.05)
        strand(p["gold"], [(sx * 0.03, z0 + 0.02, 1.5), (sx * 0.07, z0 + 0.1, 1.66), (sx * 0.2, z0 + 0.2, 1.7), (sx * 0.26, z0 + 0.26, 1.6)], 0.04, 0.014)
        strand(p["gold"], [(sx * 0.5, z0, 0.95), (sx * 0.7, z0 + 0.1, 1.02), (sx * 0.76, z0 + 0.18, 0.88), (sx * 0.66, z0 + 0.14, 0.8)], 0.035, 0.012)
        strand(p["gold"], [(sx * 0.5, z0, 0.32), (sx * 0.68, z0 + 0.06, 0.26), (sx * 0.74, z0 + 0.12, 0.38), (sx * 0.64, z0 + 0.1, 0.44)], 0.032, 0.012)
    ball(p["gold"], 0.09, (0, z0 + 0.02, 1.5))
    box(p["team"], (0.4, 0.05, 0.13), (0, z0 - 0.03, 1.2))
    # bronze whiplash vines climbing the mound, gold-tipped
    for i in range(14):
        a0 = -math.pi / 2 + (0.62 + (i // 2) * 0.68) * (1 if i % 2 else -1) + rnd.uniform(-0.12, 0.12)
        sway, top = rnd.choice((-1, 1)) * rnd.uniform(0.25, 0.45), rnd.uniform(0.1, 0.4)
        pts = [on(a0 + sway * math.sin(t * 6.0), 1.0 - t * (1.0 - top), 0.02) for t in [k / 9 for k in range(10)]]
        strand(bronze, pts, 0.05, 0.016)
        x, y, z = pts[-1]
        ball(p["gold"], 0.04, (x, y, z + 0.01))
    # blossoms: glowing turquoise, pale cream and peach
    cream = paint("cream", 0xF4ECD8, kind="cloth", dark=0.7, grain=0.1)
    peach = paint("peach", 0xF0A060, kind="cloth", dark=0.6, grain=0.1)
    for i in range(110):
        a = rnd.uniform(0, math.tau)
        rho = math.sqrt(rnd.uniform(0.01, 0.95))
        x, y, z = on(a, rho, 0.025)
        if abs(x) < 0.85 and y < -0.55:
            continue  # keep the portal clear
        m = p["ether"] if i % 2 == 0 else (cream if i % 3 == 1 else peach)
        for k in range(5):
            b = k / 5 * math.tau
            ball(m, 0.06, (x + 0.065 * math.cos(b), y + 0.065 * math.sin(b), z), (1, 1, 0.5), seg=8)
        ball(p["gold"], 0.025, (x, y, z + 0.02), seg=8)
    motes(p["ether"], (0, -0.2, 0.0), 1.1, 12, 3, size=0.016, zmin=0.4, zmax=1.9)


def puits(p):
    cyl(p["marble2"], 1.3, 0.18, (0, 0, 0.09), v=8, smooth=False)
    cyl(p["marble"], 0.9, 0.55, (0, 0, 0.45), v=8, smooth=False)
    ring_of(8, 0.92, lambda a, x, y: box(p["ether"], (0.2, 0.02, 0.05), (x, y, 0.45), (0, 0, a + math.pi / 2)), math.pi / 8)
    torus(p["gold"], 0.86, 0.07, (0, 0, 0.73), seg=8)
    cyl(p["ether"], 0.78, 0.04, (0, 0, 0.7), v=32)
    cyl(p["ether_veil"], 0.45, 2.4, (0, 0, 1.9), v=24, r2=0.08)
    for k in range(3):
        pts = [(math.cos(k * 2.1 + t * 7) * (0.5 - 0.35 * t), math.sin(k * 2.1 + t * 7) * (0.5 - 0.35 * t), 0.8 + 2.4 * t) for t in [i / 11 for i in range(12)]]
        strand(p["ether"], pts, 0.018, 0.004, res=8)
    for i in range(3):
        a = i / 3 * math.tau + 0.5
        strand(p["gold"], [(math.cos(a) * 0.95, math.sin(a) * 0.95, 0.75), (math.cos(a) * 0.9, math.sin(a) * 0.9, 1.7), (math.cos(a) * 0.3, math.sin(a) * 0.3, 2.9)], 0.045, 0.02)
    ico(p["ether_soft"], 0.2, (0, 0, 3.15), 0)
    torus(p["gold"], 0.3, 0.02, (0, 0, 3.15), (0.4, 0, 0))
    motes(p["ether"], (0, 0, 0.8), 0.6, 20, 8, size=0.018, zmin=0.0, zmax=2.5)
    box(p["team"], (0.5, 0.04, 0.2), (0, -0.92, 0.4))


def temple(p):
    for i, r in enumerate([2.05, 1.8]):
        cyl(p["marble2" if i == 0 else "marble"], r, 0.2, (0, 0, 0.1 + 0.2 * i), v=8, smooth=False)
    for k in range(2):
        box(p["marble"], (1.0, 0.3, 0.2), (0, -2.0 + k * 0.25, 0.1 + 0.2 * k), bevel=0.1)
    n = 8
    for i in range(n):
        a = i / n * math.tau + math.pi / 8
        x, y = math.cos(a) * 1.42, math.sin(a) * 1.42
        cyl(p["marble"], 0.17, 1.7, (x, y, 1.25), v=12, r2=0.14)
        ring_of(6, 0.165, lambda b, cx, cy, x=x, y=y: box(p["marble2"], (0.03, 0.03, 1.5), (x + cx, y + cy, 1.25)))
        box(p["gold"], (0.4, 0.4, 0.12), (x, y, 2.14))
        box(p["gold"], (0.36, 0.36, 0.08), (x, y, 0.45))
    cyl(p["marble2"], 1.7, 0.22, (0, 0, 2.3), v=8, smooth=False)
    ring_of(8, 1.72, lambda a, x, y: box(p["ether"], (0.3, 0.02, 0.06), (x, y, 2.3), (0, 0, a + math.pi / 2)), math.pi / 8)
    ball(p["marble"], 1.32, (0, 0, 2.38), (1, 1, 0.72))
    for i in range(8):
        a = i / 8 * math.tau
        strand(p["gold"], [(math.cos(a) * 1.33, math.sin(a) * 1.33, 2.42), (math.cos(a) * 1.1, math.sin(a) * 1.1, 2.95),
                           (math.cos(a) * 0.55, math.sin(a) * 0.55, 3.27), (0, 0, 3.34)], 0.025, 0.015)
    cyl(p["gold"], 0.12, 0.4, (0, 0, 3.5), v=8, r2=0.04)
    ball(p["ether"], 0.12, (0, 0, 3.8))
    ball(p["ether_veil"], 0.3, (0, 0, 3.8))
    ball(p["ether"], 0.32, (0, 0, 1.1))
    ball(p["ether_veil"], 0.6, (0, 0, 1.1))
    for i in range(3):
        torus(p["gold"], 0.45 + i * 0.08, 0.012, (0, 0, 1.1), (i * 0.9, i * 0.5, 0))
    cyl(p["navy"], 0.95, 0.05, (0, 0, 0.42), v=8, smooth=False)
    rune_ring(p, 0.9, 0.46, 8)
    for x in (-1.0, 1.0):
        brazier(p, x, -1.8, 0.0, 0.9)
    sheet(p["team"], 1, 1, lambda u, t: ((u - 0.5) * 0.5, -1.62, 2.18 - 0.7 * t), cuts=8)
