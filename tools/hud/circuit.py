"""The faint circuit under the Z console's screens: a tileable SVG routed like a real board. Chips with pins on both
long sides, buses of parallel traces leaving them, running straight and turning with 45° chamfers, never crossing,
ending in vias; a few thick power rails.

Run:  python3 tools/hud/circuit.py   -> public/hud/z/circuit.svg
"""
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
W, H = 480, 280  # one tile, CSS px
P = 6  # trace pitch = pin pitch
C = 2  # occupancy cell
random.seed(7)
taken: set[tuple[int, int]] = set()


def cells(pts: list[tuple[float, float]], r: float) -> set[tuple[int, int]]:
    out = set()
    rc = int(r // C) + 1
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = int(max(abs(x1 - x0), abs(y1 - y0)) / C) + 1
        for k in range(n + 1):
            cx, cy = int((x0 + (x1 - x0) * k / n) // C), int((y0 + (y1 - y0) * k / n) // C)
            for dy in range(-rc, rc + 1):
                for dx in range(-rc, rc + 1):
                    out.add(((cx + dx) % (W // C), (cy + dy) % (H // C)))
    return out


def route(x: float, y: float, d: tuple[int, int], legs: int) -> list[tuple[float, float]]:
    """Straight runs and 90° turns, each corner cut by a 45° chamfer as on a real board."""
    pts = [(x, y)]
    turn = random.randint(0, 1)
    for k in range(legs):
        n = P * random.randint(3, 9)
        x, y = x + d[0] * n, y + d[1] * n
        if k == legs - 1:
            pts.append((x, y))
            break
        # Alternate the turns' side, so a bus zigzags on rather than coiling up.
        nd = (-d[1], d[0]) if k % 2 == turn else (d[1], -d[0])
        ch = P * 2
        pts.append((x - d[0] * ch, y - d[1] * ch))
        x, y = x + nd[0] * ch, y + nd[1] * ch
        pts.append((x, y))
        d = nd
    return pts


def offset(pts: list[tuple[float, float]], o: float) -> list[tuple[float, float]]:
    """The route shifted sideways by o, mitred at the corners, so parallel traces keep their pitch."""
    def nrm(a, b):
        dx, dy = b[0] - a[0], b[1] - a[1]
        l = (dx * dx + dy * dy) ** 0.5
        return -dy / l, dx / l
    out = []
    for i, (x, y) in enumerate(pts):
        n1 = nrm(pts[i - 1], pts[i]) if i else nrm(pts[0], pts[1])
        n2 = nrm(pts[i], pts[i + 1]) if i < len(pts) - 1 else n1
        k = o / (1 + n1[0] * n2[0] + n1[1] * n2[1])
        out.append((x + (n1[0] + n2[0]) * k, y + (n1[1] + n2[1]) * k))
    return out


traces, vias, chips = [], [], []


def bus(x: float, y: float, d: tuple[int, int], k: int, w: float, skip: float = 0) -> bool:
    base = route(x, y, d, random.randint(2, 3))
    lines = [offset(base, (i - (k - 1) / 2) * P) for i in range(k)]
    # A bus out of a chip starts on its pins: the first few px are not checked against the chip itself.
    occ = [cells([(l[0][0] + d[0] * skip, l[0][1] + d[1] * skip), *l[1:]], w / 2 + 1) for l in lines]
    if any(c & taken for c in occ):
        return False
    for l, c in zip(lines, occ):
        taken.update(c)
        traces.append((l, w))
        vias.append(l[-1])
        if skip:
            vias.pop()  # out of a chip: the far end only
            vias.append(l[-1])
        taken.update(cells([l[-1], l[-1]], 4))
    return True


for _ in range(60):
    if len(chips) >= 5:
        break
    w, h = P * random.randint(4, 8), random.choice([16, 22])
    x, y = random.randrange(10, W - w - 10, P), random.randrange(14, H - h - 14, P)
    box = cells([(x - 10, y - 10), (x + w + 10, y - 10), (x + w + 10, y + h + 10), (x - 10, y + h + 10), (x - 10, y - 10)], 6)
    inner = {(cx, cy) for cx in range((x - 2) // C, (x + w + 2) // C) for cy in range((y - 6) // C, (y + h + 6) // C)}
    if (box | inner) & taken:
        continue
    taken.update(inner)
    chips.append((x, y, w, h))
    for side in (-1, 1):
        for _ in range(8):
            k = random.randint(2, min(5, w // P))
            first = random.randint(0, w // P - k)
            cx = x + P * (first + (k - 1) / 2 + 0.5)
            if bus(cx, y - 6 if side < 0 else y + h + 6, (0, side), k, 1.6, skip=4):
                break
for _ in range(1500):
    d = random.choice([(1, 0), (-1, 0), (0, 1), (0, -1)])
    x, y = random.randrange(0, W, P), random.randrange(0, H, P)
    if random.random() < 0.1:
        bus(x, y, d, 1, 3.2)
    else:
        bus(x, y, d, random.randint(1, 4), 1.6)

# Drawn nine times, shifted by the tile size, so it wraps without a seam.
g = []
for ox in (-W, 0, W):
    for oy in (-H, 0, H):
        for pts, w in traces:
            g.append(f'<polyline stroke-width="{w}" points="{" ".join(f"{x + ox:.1f},{y + oy:.1f}" for x, y in pts)}"/>')
        for x, y in vias:
            g.append(f'<circle class="v" cx="{x + ox:.1f}" cy="{y + oy:.1f}" r="2.2"/>')
        for x, y, w, h in chips:
            for px in range(x + P // 2, x + w, P):
                g.append(f'<rect class="f" x="{px - 1.2 + ox}" y="{y - 6 + oy}" width="2.4" height="{h + 12}"/>')
            g.append(f'<rect class="c" x="{x + ox}" y="{y + oy}" width="{w}" height="{h}" rx="1.5"/>')
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
       '<style>polyline{fill:none;stroke:#6ff4ff;stroke-linejoin:round;stroke-linecap:round}'
       '.v{fill:#071216;stroke:#6ff4ff;stroke-width:1.2}.f{fill:#6ff4ff}.c{fill:#06161a;stroke:#6ff4ff;stroke-width:1}</style>'
       f'<g opacity="0.16">{"".join(g)}</g></svg>')
out = ROOT / 'public' / 'hud' / 'z' / 'circuit.svg'
out.write_text(svg)
print(out, len(traces), 'traces', len(chips), 'chips')
