"""The four V1 gods, sculpted from primitives, skin bodies and curves. Each faces -Y, ~2.1 units tall (scaled up to building size when staged)."""
import math
import random

from kit import along, ball, body, bolt, box, cyl, face, fist, ico, meta, motes, ring_of, sheet, skirt, strand, torus


def god_circle(p, R=0.75, glyph="ether"):
    torus(p["ether"], R, 0.018, (0, 0, 0.015))
    torus(p["gold"], R * 0.86, 0.014, (0, 0, 0.015))
    ring_of(10, R * 0.93, lambda a, x, y: box(p[glyph], (0.08, 0.025, 0.01), (x, y, 0.02), (0, 0, a)))


def halo(p, centre, R=0.24, glow="ether", tilt=0.0):
    """Science fiction and fantasy at once: a holographic ring of segments behind the head,
    a thin gyroscope ring across it, glyph ticks, and three nodes of light in orbit."""
    cx, cy, cz = centre
    cy += 0.13

    def on_ring(a, r, dy=0.0):
        return (cx + math.cos(a) * r, cy + dy, cz + math.sin(a) * r)
    n = 18
    for i in range(n):
        a0 = i / n * math.tau + tilt
        a1 = a0 + math.tau / n * 0.62
        strand(p[glow], [on_ring(a0 + (a1 - a0) * t, R) for t in (0, 0.5, 1)], 0.008, 0.008, res=3)
    torus(p[glow], R * 0.82, 0.004, (cx, cy, cz), (math.pi / 2, 0, 0), seg=64)
    torus(p["gold"], R * 1.08, 0.006, (cx, cy, cz), (math.pi / 2, 0, 0), seg=64)
    for i in range(36):
        a = i / 36 * math.tau
        L = 0.03 if i % 3 == 0 else 0.014
        box(p[glow] if i % 3 == 0 else p["gold"], (0.006, 0.006, L), on_ring(a, R * 1.08 + L / 2 + 0.005), (0, -a + math.pi / 2, 0), bevel=0.3)
    o = torus(p[glow], R * 0.95, 0.0035, (cx, cy - 0.02, cz), (math.pi / 2 + 0.9, 0.5, 0), seg=64)
    for k in range(3):
        a = k / 3 * math.tau + 0.6 + tilt
        ball(p[glow], 0.016, on_ring(a, R * 1.22))
        ball(p["ether_veil"], 0.035, on_ring(a, R * 1.22))


# ------------------------------------------------------------------ shared anatomy
def lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def torso_blobs(P, C, N, w=1.0, d=1.0):
    px, py, pz = P
    cx, cy, cz = C
    return [((px, py, pz), 0.18 * w, (1.15, 0.85 * d, 0.75), (0, 0, 0)),
            ((cx, cy - 0.01, (pz + cz) / 2 + 0.02), 0.18 * w, (1.0, 0.78 * d, 0.95), (0, 0, 0)),
            ((cx, cy, cz), 0.25 * w, (1.05, 0.72 * d, 0.8), (0, 0, 0)),
            ((cx - 0.1 * w, cy - 0.1 * d, cz + 0.06), 0.11 * w, (1.15, 0.6, 0.75), (0, 0, 0)),
            ((cx + 0.1 * w, cy - 0.1 * d, cz + 0.06), 0.11 * w, (1.15, 0.6, 0.75), (0, 0, 0)),
            ((N[0] - 0.13 * w, N[1] + 0.03, N[2]), 0.085 * w, (1.3, 0.8, 0.55), (0, 0, 0)),
            ((N[0] + 0.13 * w, N[1] + 0.03, N[2]), 0.085 * w, (1.3, 0.8, 0.55), (0, 0, 0))]


def arm(S, E, W, w=1.0):
    caps = [(S, E, 0.068 * w), (E, W, 0.055 * w)]
    blobs = [(S, 0.105 * w, (1, 1, 1.12), (0, 0, 0)),
             (lerp(S, E, 0.5), 0.07 * w, (1, 1, 1.3), (0, 0, 0)),
             (lerp(E, W, 0.25), 0.06 * w, (1, 1, 1.3), (0, 0, 0))]
    return caps, blobs


def leg(Hp, K, A, T, w=1.0):
    caps = [(Hp, K, 0.095 * w), (K, A, 0.062 * w), (A, T, 0.05 * w)]
    blobs = [(lerp(Hp, K, 0.4), 0.1 * w, (1, 1, 1.5), (0, 0, 0)),
             (lerp(K, A, 0.3), 0.07 * w, (1, 1, 1.5), (0, 0, 0))]
    return caps, blobs


# ------------------------------------------------------------------ Thor
def thor(p):
    god_circle(p, 0.9)
    P, C, N, H = (0, 0, 1.0), (0, 0, 1.42), (0, 0, 1.66), (0, -0.02, 1.86)
    LS, LE, LW, LH = (-0.34, 0, 1.6), (-0.48, -0.05, 1.32), (-0.52, -0.14, 1.1), (-0.53, -0.17, 1.03)
    RS, RE, RW, RH = (0.34, 0, 1.6), (0.56, -0.02, 1.8), (0.58, -0.08, 2.06), (0.58, -0.09, 2.14)
    LHp, LK, LA, LT = (-0.13, 0, 0.97), (-0.19, -0.13, 0.56), (-0.21, -0.12, 0.12), (-0.22, -0.3, 0.05)
    RHp, RK, RA, RT = (0.13, 0, 0.97), (0.2, 0.07, 0.55), (0.24, 0.15, 0.12), (0.25, -0.03, 0.05)
    # body of muscle: torso, neck, arms (the legs are in trousers)
    ca, ba = arm(LS, LE, LW)
    cb, bb = arm(RS, RE, RW)
    meta(p["skin"], caps=[(N, (0, -0.01, 1.8), 0.075)] + ca + cb, blobs=torso_blobs(P, C, N) + ba + bb)
    face(p, p["skin"], H)
    halo(p, (H[0], H[1] + 0.06, H[2] + 0.14), 0.38, "bolt")
    # trousers and fur-topped boots, cross-gartered
    c1, b1 = leg(LHp, LK, LA, LT, 1.05)
    c2, b2 = leg(RHp, RK, RA, RT, 1.05)
    meta(p["leather"], caps=c1 + c2, blobs=b1 + b2 + [(P, 0.18, (1.15, 0.85, 0.6), (0, 0, 0))])
    for K, A, T in ((LK, LA, LT), (RK, RA, RT)):
        pts = []
        for i in range(13):
            t = i / 12
            c = lerp(K, A, 0.15 + 0.6 * t)
            a = t * math.tau * 2.2
            pts.append((c[0] + math.cos(a) * 0.072, c[1] + math.sin(a) * 0.072, c[2]))
        strand(p["leather"], pts, 0.009, 0.009, res=4)
        along(p["leather"], lerp(K, A, 0.72), (A[0], A[1], 0.04), 0.075, 0.08)
        meta(p["leather"], caps=[((A[0], A[1], 0.06), (T[0], T[1] - 0.03, 0.05), 0.06)])
        torus(p["fur_light"], 0.085, 0.04, lerp(K, A, 0.72))
        box(p["steel"], (0.11, 0.05, 0.22), lerp(K, A, 0.32), (math.radians(-6), 0, 0), bevel=0.5)
    # sculpted cuirass: the chest again, in plate, edged in gold, a knot-work sun on it
    cx, cy, cz = C
    meta(p["steel"], blobs=[((cx, cy, cz), 0.275, (1.05, 0.74, 0.8), (0, 0, 0)),
                            ((cx - 0.1, cy - 0.12, cz + 0.06), 0.12, (1.15, 0.6, 0.75), (0, 0, 0)),
                            ((cx + 0.1, cy - 0.12, cz + 0.06), 0.12, (1.15, 0.6, 0.75), (0, 0, 0)),
                            ((cx, cy - 0.02, 1.22), 0.205, (1.0, 0.8, 0.7), (0, 0, 0))])
    o = cyl(p["iron"], 0.215, 0.2, (0, 0, 1.1), v=28)
    o.scale = (1.08, 0.82, 1)
    for z, r in ((1.6, 0.19),):
        o = torus(p["gold"], r, 0.016, (0, -0.005, z))
        o.scale = (1.1, 0.82, 1)
    for k in range(3):
        a0 = k * math.tau / 3
        pts = [(math.cos(a0 + t * 2.2) * 0.02 * (1 + 4 * t), -0.265 - 0.01 * t, 1.44 + math.sin(a0 + t * 2.2) * 0.02 * (1 + 4 * t)) for t in (0, 0.25, 0.5, 0.75, 1)]
        strand(p["gold"], pts, 0.008, 0.005, res=4)
    ball(p["ether"], 0.018, (0, -0.27, 1.44))
    for sx in (-1, 1):
        for z in (1.3, 1.4, 1.5):
            ball(p["gold"], 0.011, (sx * 0.22, -0.2, z))
    for i, z in enumerate((1.07, 1.02)):
        o = cyl(p["steel"], 0.23 - i * 0.005, 0.05, (0, 0, z), v=28, r2=0.235 - i * 0.005)
        o.scale = (1.08, 0.82, 1)
    # belt: plates, a round buckle, a pouch
    o = cyl(p["leather"], 0.235, 0.1, (0, 0, 0.96), v=32)
    o.scale = (1.1, 0.84, 1)
    ring_of(10, 0.25, lambda a, x, y: box(p["gold"], (0.05, 0.015, 0.06), (x * 1.08, y * 0.84, 0.96), (0, 0, a + math.pi / 2), bevel=0.5) if y > -0.2 else None)
    cyl(p["gold"], 0.065, 0.03, (0, -0.215, 0.96), rot=(math.pi / 2, 0, 0), v=20)
    torus(p["ether"], 0.04, 0.007, (0, -0.232, 0.96), (math.pi / 2, 0, 0))
    box(p["leather"], (0.1, 0.07, 0.12), (0.24, -0.08, 0.88), (0, 0, -0.5), bevel=0.6)
    box(p["leather"], (0.105, 0.075, 0.05), (0.24, -0.08, 0.93), (0, 0, -0.5), bevel=0.6)
    # mail skirt, leather strips, tabards with embroidered hems
    o = cyl(p["iron"], 0.235, 0.36, (0, 0, 0.75), v=32, r2=0.3)
    o.scale = (1.08, 0.86, 1)
    for k in range(14):
        a = k / 14 * math.tau
        if abs(math.sin(a) + 1) < 0.35 or abs(math.sin(a) - 1) < 0.35:
            continue
        box(p["leather"], (0.065, 0.015, 0.26), (math.cos(a) * 0.28, math.sin(a) * 0.24, 0.8), (0, 0, a + math.pi / 2), bevel=0.4)
        ball(p["gold"], 0.01, (math.cos(a) * 0.29, math.sin(a) * 0.25, 0.9))
    for y, sgn in ((-0.24, -1), (0.23, 1)):
        sheet(p["team"], 1, 1, lambda u, t, y=y, sgn=sgn: ((u - 0.5) * 0.24, y + sgn * 0.05 * t + 0.012 * math.sin(u * 8), 0.92 - 0.58 * t), cuts=10, thick=0.015)
        sheet(p["embroid"], 1, 1, lambda u, t, y=y, sgn=sgn: ((u - 0.5) * 0.245, y + sgn * (0.05 * (0.86 + 0.1 * t) + 0.004) + 0.012 * math.sin(u * 8), 0.92 - 0.58 * (0.86 + 0.1 * t)), cuts=6, thick=0.016)
    # pauldrons: overlapping plates with gold edges and a rivet
    for sx, S in ((-1, LS), (1, RS)):
        for i in range(3):
            r = 0.19 - i * 0.025
            c = (S[0] + sx * (0.02 + i * 0.045), S[1], S[2] + 0.07 - i * 0.075)
            rot = (0, sx * math.radians(28 + i * 9), 0)
            ball(p["steel"], r, c, (1.0, 1.12, 0.42), rot)
            o = torus(p["gold"], r * 0.98, 0.009, c, rot)
            o.scale = (1.0, 1.12, 0.42)
        ball(p["gold"], 0.02, (S[0] + sx * 0.02, S[1] - 0.15, S[2] + 0.1))
    # bracers and gloved fists
    for E, W in ((LE, LW), (RE, RW)):
        along(p["leather"], lerp(E, W, 0.2), lerp(E, W, 1.0), 0.07, 0.062)
        along(p["steel"], lerp(E, W, 0.3), lerp(E, W, 0.85), 0.074, 0.066)
        for t in (0.3, 0.85):
            c = lerp(E, W, t)
            torus(p["gold"], 0.072, 0.008, c, Vector_rot(E, W))
    fist(p, p["leather"], LH, facing=(0, -1, 0), r=0.055, grip_axis=(0, 0, 1))
    fist(p, p["leather"], RH, facing=(0, -1, 0), r=0.055, grip_axis=(0, 0, 1))
    # the hammer
    hx, hy, hz = RH
    along(p["wood_dark"], (hx, hy, hz - 0.36), (hx, hy, hz + 0.5), 0.03, 0.03, v=12)
    pts = [(hx + math.cos(t * 30) * 0.033, hy + math.sin(t * 30) * 0.033, hz - 0.3 + 0.55 * t) for t in [i / 40 for i in range(41)]]
    strand(p["leather"], pts, 0.008, 0.008, res=2)
    torus(p["gold"], 0.04, 0.012, (hx, hy, hz - 0.38))
    torus(p["gold"], 0.03, 0.008, (hx, hy - 0.04, hz - 0.43), (math.pi / 2, 0, 0))
    top = hz + 0.68
    box(p["granite"], (0.58, 0.33, 0.33), (hx, hy, top), bevel=0.22)
    for dx in (-0.31, 0.31):
        box(p["iron"], (0.05, 0.31, 0.31), (hx + dx, hy, top), bevel=0.35)
        torus(p["gold"], 0.13, 0.012, (hx + dx * 1.05, hy, top), (0, math.pi / 2, 0))
    for dx in (-0.2, 0.2):
        box(p["iron"], (0.05, 0.345, 0.345), (hx + dx, hy, top), bevel=0.4)
        for zz in (-0.13, 0.13):
            ball(p["gold"], 0.014, (hx + dx, hy - 0.175, top + zz))
    for k in range(3):
        a0 = k * math.tau / 3 + 0.3
        pts = [(hx + math.cos(a0 + t * 2.3) * 0.015 * (1 + 4 * t), hy - 0.168, top + math.sin(a0 + t * 2.3) * 0.015 * (1 + 4 * t)) for t in (0, 0.25, 0.5, 0.75, 1)]
        strand(p["ether"], pts, 0.006, 0.004, res=4)
    rng = random.Random(4)
    for i in range(6):
        a = rng.uniform(0, math.tau)
        st = (hx + math.cos(a) * 0.3, hy + math.sin(a) * 0.17, top + rng.uniform(-0.1, 0.1))
        e = (hx + math.cos(a) * 0.65, hy + math.sin(a) * 0.45, top + rng.uniform(-0.15, 0.45))
        bolt(p["bolt"], st, e, i, jag=0.05, n=7, r=0.005)
        mid = lerp(st, e, 0.5)
        bolt(p["bolt"], mid, (mid[0] + rng.uniform(-0.15, 0.15), mid[1] + rng.uniform(-0.15, 0.15), mid[2] + 0.15), i + 10, jag=0.03, n=4, r=0.003)
    # helm: cap with a ridge, gold band, nasal, cheek guards, layered wings
    hx2, hy2, hz2 = H
    ball(p["steel"], 0.128, (hx2, hy2 + 0.015, hz2 + 0.05), (1.0, 1.1, 0.85))
    box(p["steel"], (0.025, 0.24, 0.03), (hx2, hy2 + 0.015, hz2 + 0.155), bevel=0.6)
    o = cyl(p["gold"], 0.13, 0.03, (hx2, hy2 + 0.015, hz2 + 0.035), v=28)
    o.scale = (1.0, 1.1, 1)
    box(p["steel"], (0.022, 0.025, 0.09), (hx2, hy2 - 0.125, hz2 - 0.005), bevel=0.5)
    for sx in (-1, 1):
        box(p["steel"], (0.025, 0.08, 0.12), (hx2 + sx * 0.112, hy2 - 0.035, hz2 - 0.04), (0, sx * 0.12, 0), bevel=0.5)
        ball(p["gold"], 0.012, (hx2 + sx * 0.126, hy2 - 0.035, hz2 + 0.0))
        for row in range(2):
            for i in range(6):
                ang = math.radians(30 + i * 11)
                Lf = (0.28 - i * 0.03) * (1 - 0.2 * row)
                box(p["white"], (0.012, 0.045, Lf), (hx2 + sx * (0.14 + math.sin(ang) * Lf * 0.35 + row * 0.01), hy2 + 0.06 + i * 0.025, hz2 + 0.12 + math.cos(ang) * Lf * 0.25),
                    (math.radians(-40), sx * ang, 0), bevel=0.6)
    # beard, moustache, braids; hair down the back
    rng = random.Random(9)
    for i in range(26):
        a = math.radians(-172 + i * 6.6)
        sx_, sy_ = math.cos(a) * 0.1, math.sin(a) * 0.075 - 0.03
        drop = 0.3 + 0.12 * math.sin(i / 25 * math.pi) + rng.uniform(-0.04, 0.04)
        strand(p["copper"], [(hx2 + sx_, hy2 + sy_, hz2 - 0.02), (hx2 + sx_ * 1.15, hy2 + sy_ - 0.06, hz2 - 0.14),
                             (hx2 + sx_ * 0.7 + rng.uniform(-0.02, 0.02), hy2 - 0.17 - rng.uniform(0, 0.03), hz2 - 0.02 - drop)], 0.026, 0.006)
    for x in (-0.045, 0.045):
        strand(p["copper"], [(hx2 + x, hy2 - 0.16, hz2 - 0.25), (hx2 + x * 1.1, hy2 - 0.19, hz2 - 0.38), (hx2 + x * 0.9, hy2 - 0.2, hz2 - 0.52)], 0.026, 0.01)
        for z in (-0.33, -0.44):
            cyl(p["gold"], 0.026, 0.03, (hx2 + x, hy2 - 0.19, hz2 + z), v=12)
    for sx in (-1, 1):
        strand(p["copper"], [(hx2, hy2 - 0.115, hz2 - 0.045), (hx2 + sx * 0.07, hy2 - 0.13, hz2 - 0.05), (hx2 + sx * 0.13, hy2 - 0.1, hz2 - 0.13)], 0.018, 0.005)
    for i in range(12):
        a = math.radians(20 + i * 12.7)
        x, y = math.cos(a) * 0.11, math.sin(a) * 0.1 + 0.02
        strand(p["copper"], [(hx2 + x, hy2 + y, hz2 + 0.02), (hx2 + x * 1.3, hy2 + y + 0.06, hz2 - 0.12), (hx2 + x * 1.2, hy2 + y + 0.1, hz2 - 0.3 - (i % 3) * 0.04)], 0.022, 0.006)
    # fur mantle; a heavy cloak, wind-blown, torn at the hem, with an embroidered border
    rng2 = random.Random(12)
    for i in range(30):
        a = math.radians(-12 + i * 6.8)
        x, y = math.cos(a) * 0.3, math.sin(a) * 0.2 + 0.05
        if y < -0.02:
            continue
        strand(p["fur"], [(x * 0.8, y * 0.8, 1.74), (x * 1.1, y * 1.2, 1.71 + rng2.uniform(-0.02, 0.03)), (x * 1.22, y * 1.45 + 0.04, 1.57 + rng2.uniform(-0.05, 0.02))], 0.065, 0.018)

    def cloak(u, t, off=0.0):
        hem = 0.9 + 0.1 * math.sin(u * 37) * math.sin(u * 11)
        tt = t * hem
        x = (u - 0.5) * (0.78 + 0.6 * tt) + 0.22 * tt * tt
        y = 0.21 + 0.48 * tt ** 1.4 + 0.07 * math.sin(u * math.pi * 6) * tt + off
        return (x, y, 1.64 - 1.46 * tt)
    sheet(p["team"], 1, 1, cloak, cuts=32, thick=0.03)
    sheet(p["embroid"], 1, 1, lambda u, t: cloak(u, 0.8 + 0.06 * t, 0.012), cuts=32, thick=0.012)


def Vector_rot(a, b):
    from mathutils import Vector
    d = Vector(b) - Vector(a)
    return d.to_track_quat("Z", "Y").to_euler()


# ------------------------------------------------------------------ Gaïa
def gaia(p):
    god_circle(p, 0.95)
    # she rises from a living hill
    ball(p["moss"], 0.75, (0, 0, 0.0), (1, 1, 0.42))
    rng = random.Random(1)
    for i in range(9):
        a = i / 9 * math.tau + 0.2
        strand(p["bark"], [(math.cos(a) * 0.3, math.sin(a) * 0.3, 0.35), (math.cos(a) * 0.62, math.sin(a) * 0.62, 0.22),
                           (math.cos(a + 0.2) * 0.95, math.sin(a + 0.2) * 0.95, 0.02)], 0.07, 0.015)
    for i in range(26):
        a, r = rng.uniform(0, math.tau), rng.uniform(0.35, 0.8)
        z = 0.32 * math.sqrt(max(0, 1 - (r / 0.75) ** 2)) + 0.02
        c = ["bloom_pink", "white", "firefly"][i % 3]
        ball(p[c], 0.03 if c != "white" else 0.035, (math.cos(a) * r, math.sin(a) * r, z))
        ball(p["leaf"], 0.06, (math.cos(a + 0.1) * r, math.sin(a + 0.1) * r, z - 0.01), (1, 0.5, 0.25), (0, 0, a))
    # gown of overlapping leaves, row on row, flowing into the hill
    rngl = random.Random(21)
    for row in range(7):
        z = 1.0 - row * 0.1
        r = 0.16 + row * 0.045
        n = 12 + row * 3
        for i in range(n):
            a = i / n * math.tau + row * 0.25
            c = "leaf" if (i + row) % 4 else "moss"
            ball(p[c], 0.09 + row * 0.008, (math.cos(a) * r, math.sin(a) * r, z - 0.05), (0.55, 0.16, 1.0),
                 (math.radians(rngl.uniform(-8, 8)) + (0.35 if row > 3 else 0.15) * 0, -0.25 * math.cos(a) * 0, a + math.pi / 2))
    cyl(p["moss"], 0.15, 0.6, (0, 0, 0.72), v=24, r2=0.13)
    # body of pale jade: slender torso and arms that melt together, gold veins
    T, Cc, Nn = (0, 0, 1.0), (0, -0.01, 1.28), (0, 0, 1.46)
    ca, ba = arm((-0.2, 0, 1.43), (-0.3, -0.12, 1.2), (-0.1, -0.33, 1.15), 0.68)
    cb, bb = arm((0.2, 0, 1.43), (0.3, -0.12, 1.2), (0.1, -0.33, 1.15), 0.68)
    meta(p["jade"], caps=[(Nn, (0, -0.01, 1.6), 0.055)] + ca + cb, blobs=torso_blobs(T, Cc, Nn, 0.66, 0.9) + ba + bb)
    face(p, p["jade"], (0, -0.015, 1.64), 0.85)
    halo(p, (0, 0.06, 1.84), 0.4, "ether", tilt=0.5)
    for sx in (-1, 1):
        fist(p, p["jade"], (sx * 0.08, -0.36, 1.15), facing=(-sx, -0.3, 0.6), r=0.036)
        strand(p["gold"], [(sx * 0.22, -0.01, 1.42), (sx * 0.28, -0.06, 1.3), (sx * 0.29, -0.12, 1.2), (sx * 0.22, -0.22, 1.17)], 0.006, 0.004, res=3)
    # bodice of small leaves across the chest
    for row in range(3):
        for i in range(7):
            x = (i - 3) * 0.045
            ball(p["leaf"], 0.045, (x, -0.13 + abs(x) * 0.35, 1.36 - row * 0.06), (0.6, 0.2, 1.0), (math.radians(-15), 0, 0))
    o = torus(p["gold"], 0.12, 0.012, (0, -0.015, 1.04))
    o.scale = (1.2, 0.9, 1)
    ball(p["firefly"], 0.065, (0, -0.42, 1.24))
    ball(p["ether_veil"], 0.15, (0, -0.42, 1.24))
    for i in range(3):
        torus(p["ether"], 0.11 + i * 0.03, 0.004, (0, -0.42, 1.24), rot=(i * 1.0, i * 0.7, 0))
    # hair of hanging vines, flowering
    for i in range(16):
        a = math.radians(20 + i * 9.4)
        x, y = math.cos(a) * 0.12, math.sin(a) * 0.1 + 0.02
        end = (x * 3.2, y * 2 + 0.35, 0.25 + (i % 4) * 0.08)
        strand(p["leaf"], [(x * 0.6, y, 1.72), (x * 1.6, y + 0.12, 1.55), (x * 2.4, y + 0.3, 0.95), end], 0.026, 0.01)
        for t in (0.35, 0.6):
            ball(p["leaf"], 0.03, (x * (1.6 + t), y + 0.12 + 0.2 * t, 1.5 - t * 0.6), (0.6, 0.25, 1.0), (0, 0, i))
        ball(p["bloom_pink"] if i % 2 else p["firefly"], 0.022, (x * 2.3, y + 0.28, 1.0 - (i % 3) * 0.1))
    # antler crown of branches in bloom
    for s in (-1, 1):
        base = (s * 0.07, 0, 1.7)
        main = [base, (s * 0.18, 0.02, 1.88), (s * 0.3, 0.05, 2.08), (s * 0.34, 0.08, 2.3)]
        strand(p["bark2"], main, 0.025, 0.008)
        for k, (pt, d) in enumerate([(main[1], (s * 0.32, -0.05, 1.98)), (main[2], (s * 0.48, 0.0, 2.15)), (main[2], (s * 0.2, 0.0, 2.28))]):
            strand(p["bark2"], [pt, d], 0.014, 0.005)
            ball(p["bloom_pink"], 0.035, d)
        ball(p["bloom_pink"], 0.04, main[-1])
    torus(p["gold"], 0.1, 0.012, (0, 0, 1.72), rot=(math.radians(10), 0, 0))
    # staff of living wood
    strand(p["bark2"], [(0.5, -0.1, 0.15), (0.5, -0.12, 1.0), (0.52, -0.1, 1.9), (0.45, -0.1, 2.15), (0.5, -0.14, 2.3)], 0.035, 0.015)
    ball(p["ether"], 0.06, (0.5, -0.12, 2.12))
    ball(p["ether_veil"], 0.14, (0.5, -0.12, 2.12))
    motes(p["firefly"], (0, 0, 0.2), 1.0, 40, 7, size=0.014, zmin=0.1, zmax=2.2)


# ------------------------------------------------------------------ Apollon
def apollon(p):
    god_circle(p, 0.75)
    L = 0.18  # he floats
    J = [
        (0, 0, 1.0 + L), (0, 0, 1.16 + L), (0, -0.01, 1.36 + L), (0, 0, 1.52 + L), (0, 0, 1.64 + L), (0, -0.01, 1.77 + L),
        (-0.27, 0, 1.55 + L), (-0.38, -0.06, 1.3 + L), (-0.42, -0.16, 1.1 + L), (-0.43, -0.2, 1.02 + L),
        (0.27, 0, 1.55 + L), (0.44, -0.06, 1.76 + L), (0.48, -0.14, 2.02 + L), (0.48, -0.16, 2.1 + L),
        (-0.1, 0, 0.97 + L), (-0.12, 0.02, 0.55 + L), (-0.13, 0.08, 0.15 + L), (-0.13, -0.04, 0.06 + L),
        (0.1, 0, 0.97 + L), (0.14, -0.08, 0.58 + L), (0.15, -0.04, 0.2 + L), (0.16, -0.16, 0.12 + L),
    ]
    E = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (3, 6), (6, 7), (7, 8), (8, 9), (3, 10), (10, 11), (11, 12), (12, 13),
         (0, 14), (14, 15), (15, 16), (16, 17), (0, 18), (18, 19), (19, 20), (20, 21)]
    R = [(0.16, 0.12), (0.15, 0.11), (0.22, 0.15), (0.24, 0.15), 0.065, 0.105,
         0.09, 0.065, 0.05, 0.055, 0.09, 0.065, 0.05, 0.055,
         0.1, 0.07, 0.05, 0.05, 0.1, 0.07, 0.05, 0.05]
    ca, ba = arm(J[6], J[7], J[8], 0.82)
    cb, bb = arm(J[10], J[11], J[12], 0.82)
    c1, b1 = leg(J[14], J[15], J[16], J[17], 0.82)
    c2, b2 = leg(J[18], J[19], J[20], J[21], 0.82)
    meta(p["skin"], caps=[(J[3], J[5], 0.06)] + ca + cb + c1 + c2, blobs=torso_blobs(J[0], J[2], J[3], 0.82, 0.95) + ba + bb + b1 + b2)
    face(p, p["skin"], (0, -0.015, 1.77 + L), 0.88, eye="sun")
    halo(p, (0, 0.08, 1.86 + L), 0.36, "sun", tilt=0.3)
    fist(p, p["skin"], J[9], r=0.042)
    # muscled cuirass of gold, edged and engraved with a sun
    cx, cy, cz = J[2]
    meta(p["gold"], blobs=[((cx, cy, cz), 0.225, (1.05, 0.72, 0.8), (0, 0, 0)),
                           ((cx - 0.085, cy - 0.1, cz + 0.05), 0.1, (1.15, 0.6, 0.75), (0, 0, 0)),
                           ((cx + 0.085, cy - 0.1, cz + 0.05), 0.1, (1.15, 0.6, 0.75), (0, 0, 0)),
                           ((cx, cy - 0.03, cz - 0.17), 0.165, (1.0, 0.82, 0.8), (0, 0, 0))])
    ring_of(12, 0.045, lambda a, x, y: strand(p["sun"], [(x, -0.21, cz + y + 0.04), (x * 2.2, -0.205, cz + y * 2.2 + 0.04)], 0.006, 0.003, res=2))
    ball(p["sun"], 0.025, (0, -0.215, cz + 0.04))
    o = torus(p["white"], 0.155, 0.02, (0, -0.005, cz + 0.2))
    o.scale = (1.15, 0.85, 1)
    # leather strips at hips and shoulders, studded
    for k in range(14):
        a = k / 14 * math.tau
        box(p["leather"], (0.055, 0.014, 0.2), (math.cos(a) * 0.19, math.sin(a) * 0.15, 1.04 + L), (0.0, 0, a + math.pi / 2), bevel=0.4)
        box(p["embroid"], (0.056, 0.015, 0.03), (math.cos(a) * 0.19, math.sin(a) * 0.15, 0.95 + L), (0.0, 0, a + math.pi / 2), bevel=0.4)
    for sx in (-1, 1):
        for k in range(5):
            box(p["leather"], (0.04, 0.012, 0.13), (sx * (0.27 + k * 0.008), -0.08 + k * 0.04, 1.49 + L), (0, sx * 0.35, 0), bevel=0.4)
    # pleated chiton below the strips, a cloak pinned at one shoulder, wind in it
    skirt(p["white"], 1.02 + L, 0.46 + L, 0.16, 0.25, pleats=18, depth=0.016)
    def cloak(u, t, off=0.0):
        hem = 0.92 + 0.08 * math.sin(u * 29)
        tt = t * hem
        return (-0.26 + 0.42 * u - 0.25 * tt * tt, 0.12 + 0.42 * tt ** 1.3 + 0.04 * math.sin(u * 11) + off, 1.6 + L - 1.3 * tt)
    sheet(p["team"], 1, 1, cloak, cuts=24, thick=0.02)
    sheet(p["embroid"], 1, 1, lambda u, t: cloak(u, 0.84 + 0.06 * t, 0.01), cuts=24, thick=0.01)
    cyl(p["gold"], 0.04, 0.02, (-0.2, -0.06, 1.6 + L), rot=(math.pi / 2, 0, 0), v=16)
    ball(p["sun"], 0.012, (-0.2, -0.075, 1.6 + L))
    # sandals laced up the shin
    for (k, a) in ((15, 16), (19, 20)):
        along(p["leather"], J[k], J[a], 0.055, 0.05)
        for z in range(3):
            t = (z + 1) / 4
            c = [J[k][i] + (J[a][i] - J[k][i]) * t for i in range(3)]
            cyl(p["gold"], 0.058, 0.012, tuple(c), v=16)
    # bracers; a small sun in the raised hand, a bow in the other
    along(p["gold"], J[11], J[12], 0.055, 0.05)
    along(p["gold"], J[7], J[8], 0.055, 0.05)
    hx, hy, hz = J[13]
    fist(p, p["skin"], (hx, hy, hz - 0.02), r=0.042)
    ball(p["sun"], 0.11, (hx, hy - 0.03, hz + 0.12))
    for i in range(10):
        a = i / 10 * math.tau
        cyl(p["sun"], 0.02, 0.12, (hx + math.cos(a) * 0.17, hy - 0.03, hz + 0.12 + math.sin(a) * 0.17), rot=(0, -a + math.pi / 2, 0), v=6, r2=0.0)
    bx, by, bz = J[9]
    strand(p["gold"], [(bx - 0.02, by - 0.05, bz - 0.45), (bx - 0.1, by - 0.08, bz - 0.15), (bx, by - 0.02, bz), (bx - 0.1, by - 0.08, bz + 0.15), (bx - 0.02, by - 0.05, bz + 0.45)], 0.018, 0.01)
    strand(p["sun"], [(bx - 0.02, by - 0.05, bz - 0.45), (bx - 0.02, by - 0.05, bz + 0.45)], 0.003, 0.003)
    # golden curls and laurel
    rng = random.Random(3)
    for i in range(30):
        a = rng.uniform(math.radians(10), math.radians(170))
        z = rng.uniform(1.76, 1.9) + L
        ball(p["gold"], 0.034, (math.cos(a) * 0.095, math.sin(a) * 0.085 + 0.0, z))
    for i in range(10):
        a = math.radians(15 + i * 15)
        x, y = math.cos(a) * 0.09, math.sin(a) * 0.08
        strand(p["gold"], [(x, y, 1.82 + L), (x * 1.3, y * 1.4 + 0.03, 1.72 + L), (x * 1.2, y * 1.6 + 0.05, 1.6 + L - (i % 3) * 0.03)], 0.024, 0.008)
    ring_of(16, 0.115, lambda a, x, y: ball(p["leaf"], 0.032, (x, y, 1.86 + L), (1, 0.45, 0.35), (0, 0.5, a)) if y > -0.09 else None)
    # the sun disc behind him: a gold ring, long and short rays
    cz = 1.78 + L
    torus(p["gold"], 0.46, 0.025, (0, 0.2, cz), rot=(math.pi / 2, 0, 0))
    torus(p["gold"], 0.36, 0.012, (0, 0.2, cz), rot=(math.pi / 2, 0, 0))
    for i in range(24):
        a = i / 24 * math.tau
        Ln = 0.26 if i % 2 == 0 else 0.13
        cyl(p["sun"] if i % 2 == 0 else p["gold"], 0.03, Ln, (math.cos(a) * (0.46 + Ln / 2), 0.2, cz + math.sin(a) * (0.46 + Ln / 2)),
            rot=(0, -a + math.pi / 2, 0), v=4, r2=0.0, smooth=False)
    motes(p["sun"], (0, 0.1, 0.3), 0.9, 26, 9, size=0.012, zmin=0.2, zmax=2.4)


# ------------------------------------------------------------------ Seth
def seth(p):
    god_circle(p, 0.8, glyph="amber")
    # tall and lean; the jackal head grows from the same body
    J = [
        (0, 0, 1.05), (0, 0, 1.22), (0, -0.01, 1.42), (0, 0, 1.58), (0, -0.02, 1.72), (0, -0.04, 1.86),
        (-0.26, 0, 1.6), (-0.44, -0.08, 1.42), (-0.56, -0.2, 1.5), (-0.6, -0.24, 1.53),
        (0.26, 0, 1.6), (0.38, -0.04, 1.33), (0.42, -0.14, 1.14), (0.43, -0.16, 1.07),
        (-0.11, 0, 1.02), (-0.13, -0.02, 0.56), (-0.14, 0.02, 0.12), (-0.14, -0.12, 0.05),
        (0.11, 0, 1.02), (0.13, -0.04, 0.56), (0.14, 0, 0.12), (0.15, -0.14, 0.05),
        (0, -0.18, 1.83), (0, -0.3, 1.79),  # 22-23 snout
    ]
    E = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (3, 6), (6, 7), (7, 8), (8, 9), (3, 10), (10, 11), (11, 12), (12, 13),
         (0, 14), (14, 15), (15, 16), (16, 17), (0, 18), (18, 19), (19, 20), (20, 21), (5, 22), (22, 23)]
    R = [(0.15, 0.11), (0.14, 0.1), (0.21, 0.14), (0.24, 0.14), 0.065, 0.1,
         0.085, 0.06, 0.048, 0.05, 0.085, 0.06, 0.048, 0.05,
         0.095, 0.065, 0.048, 0.045, 0.095, 0.065, 0.048, 0.045, 0.06, 0.03]
    ca, ba = arm(J[6], J[7], J[8], 0.8)
    cb, bb = arm(J[10], J[11], J[12], 0.8)
    c1, b1 = leg(J[14], J[15], J[16], J[17], 0.78)
    c2, b2 = leg(J[18], J[19], J[20], J[21], 0.78)
    meta(p["bronze_skin"], caps=[(J[3], J[4], 0.06)] + ca + cb + c1 + c2, blobs=torso_blobs(J[0], J[2], J[3], 0.8, 0.9) + ba + bb + b1 + b2)
    fist(p, p["bronze_skin"], J[13], r=0.04)
    halo(p, (0, 0.06, 2.04), 0.38, "amber", tilt=0.15)
    # a jackal's head of black fur: skull, long muzzle, jaw, tall ears with gold inside, amber eyes
    meta(p["jackal"], caps=[((0, -0.08, 1.86), (0, -0.3, 1.8), 0.05), ((0, -0.08, 1.82), (0, -0.27, 1.77), 0.035), ((0, -0.02, 1.74), (0, -0.04, 1.86), 0.06)],
         blobs=[((0, -0.03, 1.88), 0.1, (0.95, 1.1, 0.95), (0, 0, 0)), ((0, -0.13, 1.9), 0.05, (1.5, 0.8, 0.5), (0, 0, 0))], res=0.01)
    ball(p["shadow"], 0.018, (0, -0.32, 1.8))
    for sx in (-1, 1):
        cyl(p["jackal"], 0.05, 0.3, (sx * 0.055, 0.0, 2.06), rot=(math.radians(-12), sx * math.radians(12), 0), v=5, r2=0.0, smooth=False)
        cyl(p["gold"], 0.025, 0.17, (sx * 0.058, -0.02, 2.04), rot=(math.radians(-12), sx * math.radians(12), 0), v=5, r2=0.0, smooth=False)
        ball(p["shadow"], 0.02, (sx * 0.045, -0.12, 1.895))
        ball(p["amber"], 0.012, (sx * 0.047, -0.133, 1.895))
        torus(p["gold"], 0.022, 0.006, (sx * 0.095, -0.02, 1.83), rot=(0, math.pi / 2, 0))
        strand(p["gold"], [(sx * 0.03, -0.14, 1.86), (sx * 0.05, -0.2, 1.84), (sx * 0.04, -0.27, 1.8)], 0.005, 0.003, res=2)
    # broad collar over the shoulders
    for i, (c, r) in enumerate((("gold", 0.29), ("lapis", 0.265), ("turq", 0.24), ("gold", 0.215), ("lapis", 0.19))):
        ball(p[c], r, (0, 0, 1.62 - i * 0.01), (1, 0.82, 0.24))
    for i in range(22):
        a = math.radians(190 + i * 7.5)
        ball(p["turq"] if i % 2 else p["gold"], 0.014, (math.cos(a) * 0.29, math.sin(a) * 0.24, 1.57))
    # pleated kilt with a jewelled front panel, a long cloak of night behind
    skirt(p["white"], 1.08, 0.58, 0.16, 0.25, pleats=20, depth=0.015)
    cyl(p["gold"], 0.16, 0.06, (0, 0, 1.08), v=24)
    box(p["lapis"], (0.1, 0.02, 0.4), (0, -0.25, 0.86), (math.radians(-8), 0, 0), bevel=0.3)
    for z in (0.72, 0.84, 0.96):
        box(p["gold"], (0.11, 0.025, 0.02), (0, -0.255 + (1 - z) * 0.03, z), bevel=0.3)
    sheet(p["navy"], 1, 1, lambda u, t: ((u - 0.5) * (0.55 + 0.35 * t), 0.14 + 0.3 * t ** 1.6 + 0.04 * math.sin(u * 14) * t, 1.62 - 1.55 * t), cuts=24, thick=0.025)
    # arm rings, anklets
    for (a, b_) in ((6, 7), (10, 11)):
        c = [(J[a][i] + J[b_][i]) / 2 for i in range(3)]
        cyl(p["gold"], 0.07, 0.05, tuple(c), v=16)
    for k in (16, 20):
        cyl(p["gold"], 0.055, 0.04, (J[k][0], J[k][1], J[k][2] + 0.06), v=16)
    # the was-sceptre in the right hand; the left weaves the storm
    hx, hy, hz = J[13]
    along(p["gold"], (hx, hy, 0.02), (hx, hy, 2.25), 0.022, 0.022, v=10)
    box(p["gold"], (0.05, 0.16, 0.06), (hx, hy - 0.07, 2.27), (math.radians(-22), 0, 0))
    box(p["amber"], (0.03, 0.02, 0.02), (hx, hy - 0.15, 2.3))
    for k in range(3):
        pts = []
        for i in range(14):
            t = i / 13
            a = t * math.tau * 1.4 + k * 2.1
            r = 0.6 + 0.25 * t
            pts.append((math.cos(a) * r, math.sin(a) * r, 0.1 + 1.8 * t))
        for q in range(len(pts) - 1):
            for t in (0.0, 0.33, 0.66):
                a_, b_ = pts[q], pts[q + 1]
                ball(p["sand"], 0.005 + 0.003 * ((q + k) % 3), tuple(a_[i] + (b_[i] - a_[i]) * t for i in range(3)))
    motes(p["sand"], (0, 0, 0.1), 0.95, 90, 11, size=0.007, zmin=0.0, zmax=2.0)
    lx, ly, lz = J[9]
    motes(p["amber"], (lx, ly, lz - 0.1), 0.15, 10, 13, size=0.01, zmin=0, zmax=0.3)
    for i in range(4):
        a = i / 4 * math.tau + 0.5
        x, y, z = math.cos(a) * 0.7, math.sin(a) * 0.7, 1.3 + 0.25 * math.sin(i * 1.7)
        box(p["stone"], (0.14, 0.04, 0.2), (x, y, z), (0.2, 0, a + math.pi / 2))
        box(p["amber"], (0.08, 0.045, 0.02), (x, y, z + 0.03), (0.2, 0, a + math.pi / 2))
        box(p["amber"], (0.02, 0.045, 0.1), (x, y, z - 0.02), (0.2, 0, a + math.pi / 2))


GODS = [(gaia, "Gaïa"), (thor, "Thor"), (apollon, "Apollon"), (seth, "Seth")]
