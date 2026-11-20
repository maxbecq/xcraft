"""Writes public/maps/asteroides.json: islands with broken coasts joined by natural arches, over the void.

The layout is the validated plan (recherches-visuelles/asteroides-carte/plan.png). Player 1's islands and arches are
outlines (polygons); the game copies them by a half turn. Run: python3 tools/maps/asteroides.py
"""
import json, math, random, os

N = 112
S = 112 / 96  # the plan was drawn at 96 tiles
GROW = 1.12  # every island but the start one, grown after the first look
sc = lambda p: (round(p[0] * S), round(p[1] * S))

def terms(seed, k):
    r = random.Random(seed)
    return [(r.uniform(-1, 1), r.uniform(0, 6.283), f) for f in range(2, 2 + k)]

def island(cx, cy, R, seed, rough=0.22, sym=False, n=56):
    t = terms(seed, 7)
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        v = sum(amp / f ** 0.9 * math.cos(f * a + ph) for amp, ph, f in t if not (sym and f % 2))
        r = R * (1 + rough * v)
        pts.append([round(cx + r * math.cos(a), 2), round(cy + r * math.sin(a), 2)])
    return pts

def arch(a, b, w, seed, n=16):
    (ax, ay), (bx, by) = a, b
    L = math.hypot(bx - ax, by - ay)
    ux, uy = (bx - ax) / L, (by - ay) / L
    ax, ay, bx, by = ax - 3 * ux, ay - 3 * uy, bx + 3 * ux, by + 3 * uy  # roots well inside both islands
    L += 6
    t5 = terms(seed, 5)
    left, right = [], []
    for i in range(n + 1):
        t = i / n
        shift = 0.9 * sum(amp / f * math.sin(f * math.pi * t + ph) for amp, ph, f in t5)  # the span winds a little
        half = w / 2 + 2.6 * (2 * t - 1) ** 4 + 0.5 * sum(amp / f * math.cos(2 * f * math.pi * t + ph) for amp, ph, f in t5)
        half = max(w / 2 + 0.15, half)  # never narrower than its width: a 3-wide arch keeps 3 tiles
        cx, cy = ax + ux * L * t - uy * shift, ay + uy * L * t + ux * shift
        left.append([round(cx - uy * half, 2), round(cy + ux * half, 2)])
        right.append([round(cx + uy * half, 2), round(cy - ux * half, 2)])
    return left + right[::-1]

ISL = {  # centre (plan, 96 tiles), radius, seed
    'principale': ((17, 17), 14.5, 11),
    'naturelle': ((16, 45), 9.5, 23),
    'troisième': ((45, 15), 8.5, 37),
    'avant-poste': ((14, 74), 8, 51),
}
ARCHES = [  # from, to (plan, 96 tiles), narrowest width
    ((17, 30), (16, 36), 6),
    ((30, 15), (38, 15), 4),
    ((25, 48), (37, 50), 4),
    ((48, 23), (48, 36), 3),
    ((15, 54), (14, 67), 3),
    ((22, 76), (41, 81), 3),
]
BASES = [
    dict(name='départ', start=True, hq=(13, 13), minerals=[(8, 8), (9, 7), (11, 6), (13, 6), (15, 6), (7, 10), (7, 12), (7, 14)], wells=[(21, 9)]),
    dict(name='naturelle', hq=(14, 42), minerals=[(9, 41), (9, 43), (9, 45), (10, 47), (12, 49), (14, 50)], wells=[(19, 47)]),
    dict(name='troisième', hq=(43, 13), minerals=[(41, 8), (43, 8), (45, 8), (47, 9), (49, 11), (50, 13)], wells=[(44, 19)]),
    dict(name='avant-poste', hq=(12, 72), minerals=[(9, 69), (9, 71), (9, 73), (10, 76), (12, 78)], wells=[(17, 69)]),
]

terrain = [{'shape': 'rect', 'from': [0, 0], 'to': [N - 1, N - 1], 'chasm': True}]
# Arches first: the islands painted over their roots take those tiles back.
for i, (a, b, w) in enumerate(ARCHES):
    terrain.append({'shape': 'polygon', 'points': arch(sc(a), sc(b), w, 300 + i), 'fill': True, 'arch': True})
for k, (c, R, seed) in ISL.items():
    cx, cy = sc(c)
    terrain.append({'shape': 'polygon', 'points': island(cx, cy, R * S * (1 if k == 'principale' else GROW), seed), 'fill': True})
# The rich centre: its own image under the half turn, so painting it twice changes nothing.
terrain.append({'shape': 'polygon', 'points': island(56, 56, 11 * S * GROW, 99, rough=0.3, sym=True), 'fill': True})
bases = []
for b in BASES:
    o = {'name': b['name']}
    if b.get('start'): o['start'] = True
    o.update(hq=list(sc(b['hq'])), minerals=[list(sc(m)) for m in b['minerals']], wells=[list(sc(w)) for w in b['wells']])
    bases.append(o)
# The rich centre holds two bases, one on each player's side of it (a 112-tile map has no single middle spot under a
# half turn, and the AI never takes a base nearer the enemy's start than its own).
bases.append({'name': 'centre', 'hq': [50, 49], 'minerals': [[46, 48], [46, 50], [46, 52], [48, 46], [50, 45]], 'wells': []})

out = {
    'format': 1, 'id': 'asteroides', 'name': 'Astéroïdes',
    'description': 'Des îlots de basalte au-dessus du vide, reliés par des arches de roche : trois routes, un centre riche.',
    'size': N, 'players': [2], 'symmetry': 'rot180', 'biomes': ['asteroides'], 'biomesOnly': True,
    'terrain': terrain, 'bases': bases,
}
here = os.path.dirname(os.path.abspath(__file__))
path = os.path.join(here, '..', '..', 'public', 'maps', 'asteroides.json')
with open(path, 'w') as f:
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    f.write('\n')
print('écrit', os.path.normpath(path))
