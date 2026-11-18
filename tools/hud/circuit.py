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


traces, vias, chips, owned = [], [], [], []


def chamfer(pts: list[tuple[float, float]], c: float) -> list[tuple[float, float]]:
    """Each inner corner cut by a 45° chamfer of c px, as on a real board."""
    out = [pts[0]]
    for (x0, y0), (x1, y1), (x2, y2) in zip(pts, pts[1:], pts[2:]):
        l1, l2 = max(abs(x1 - x0), abs(y1 - y0)), max(abs(x2 - x1), abs(y2 - y1))
        k = min(c, l1 / 2, l2 / 2)
        out.append((x1 - (x1 - x0) / l1 * k, y1 - (y1 - y0) / l1 * k))
        out.append((x1 + (x2 - x1) / l2 * k, y1 + (y2 - y1) / l2 * k))
    return [*out, pts[-1]]


def lay(base: list[tuple[float, float]], k: int, w: float, skip: float = 0, via: bool = True, own: frozenset = frozenset()) -> bool:
    """k parallel traces along base; skip: the first px not checked (they start on a chip); own: the cells of the trace
    a branch leaves, which it may touch (and no other)."""
    base = [q for i, q in enumerate(base) if not i or abs(q[0] - base[i - 1][0]) + abs(q[1] - base[i - 1][1]) > 0.5]
    if len(base) < 2:
        return False
    lines = [offset(base, (i - (k - 1) / 2) * P) for i in range(k)]
    def trimmed(l):
        dx, dy = l[1][0] - l[0][0], l[1][1] - l[0][1]
        n = (dx * dx + dy * dy) ** 0.5
        return [(l[0][0] + dx / n * skip, l[0][1] + dy / n * skip), *l[1:]] if skip else l
    occ = [cells(trimmed(l), w / 2 + 1) for l in lines]
    if any((c - own) & taken for c in occ):
        return False
    for l, c in zip(lines, occ):
        taken.update(c)
        traces.append((l, w))
        owned.append(frozenset(c))
        if via:
            vias.append(l[-1])
            taken.update(cells([l[-1], l[-1]], 4))
    return True


# Chips first, spread over the tile.
for _ in range(300):
    if len(chips) >= 8:
        break
    w, h = P * random.randint(4, 8), random.choice([16, 22])
    x, y = random.randrange(10, W - w - 10, P), random.randrange(18, H - h - 18, P)
    box = cells([(x - 14, y - 16), (x + w + 14, y - 16), (x + w + 14, y + h + 16), (x - 14, y + h + 16), (x - 14, y - 16)], 6)
    inner = {(cx, cy) for cx in range((x - 2) // C, (x + w + 2) // C) for cy in range((y - 4) // C, (y + h + 4) // C)}
    if (box | inner) & taken:
        continue
    taken.update(inner)
    chips.append((x, y, w, h))
pin = lambda ch, side: ch[1] - 8 if side < 0 else ch[1] + ch[3] + 8
# A connected board: buses from chip to chip, out of one's pins and into the other's.
for a in chips:
    for b in sorted((c for c in chips if c is not a), key=lambda c: abs(c[0] - a[0]) + abs(c[1] - a[1]))[:3]:
        side = -1 if b[1] < a[1] else 1
        k = min(a[2] // P, b[2] // P, random.randint(2, 4))
        for _ in range(8):
            ax = a[0] + P * (random.randint(0, a[2] // P - k) + (k - 1) / 2 + 0.5)
            bx = b[0] + P * (random.randint(0, b[2] // P - k) + (k - 1) / 2 + 0.5)
            y0, y1 = pin(a, side), pin(b, -side)
            if (y1 - y0) * side < P * 5:
                break
            my = round((y0 + (y1 - y0) * random.uniform(0.3, 0.7)) / P) * P
            if lay(chamfer([(ax, y0), (ax, my), (bx, my), (bx, y1)], P * 2), k, 1.6, via=False):
                break
# A few more buses out of the chips' pins.
for ch in chips:
    for side in (-1, 1):
        for _ in range(6):
            k = random.randint(2, min(4, ch[2] // P))
            cx = ch[0] + P * (random.randint(0, ch[2] // P - k) + (k - 1) / 2 + 0.5)
            if lay(route(cx, pin(ch, side), (0, side), random.randint(2, 3)), k, 1.6):
                break
# Branches off the straight runs, out sideways, ending in vias; a few thick power lines.
for _ in range(8000):
    if len(traces) >= 110:
        break
    ti = random.randrange(len(traces))
    pts, tw = traces[ti]
    j = random.randrange(len(pts) - 1)
    (x0, y0), (x1, y1) = pts[j], pts[j + 1]
    if abs(x1 - x0) > 0.5 and abs(y1 - y0) > 0.5:
        continue  # a chamfer: no branch at 45°
    n = max(abs(x1 - x0), abs(y1 - y0))
    if n < P * 4:
        continue
    f = P * random.randint(2, int(n / P) - 2) / n
    px, py = x0 + (x1 - x0) * f, y0 + (y1 - y0) * f
    ax, ay = (x1 - x0) / n, (y1 - y0) / n
    d = random.choice([(-ay, ax), (ay, -ax)])
    d = (round(d[0]), round(d[1]))
    lay(route(px, py, d, random.randint(1, 3)), 1, 3.2 if random.random() < 0.1 else 1.6, own=owned[ti])

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
                g.append(f'<rect class="f" x="{px - 1.2 + ox}" y="{y - 8 + oy}" width="2.4" height="{h + 16}"/>')
            g.append(f'<rect class="c" x="{x + ox}" y="{y + oy}" width="{w}" height="{h}" rx="1.5"/>')
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
       '<style>polyline{fill:none;stroke:#6ff4ff;stroke-linejoin:round;stroke-linecap:round}'
       '.v{fill:#071216;stroke:#6ff4ff;stroke-width:1.2}.f{fill:#6ff4ff}.c{fill:#06161a;stroke:#6ff4ff;stroke-width:1}</style>'
       f'<g opacity="0.16">{"".join(g)}</g></svg>')
out = ROOT / 'public' / 'hud' / 'z' / 'circuit.svg'
out.write_text(svg)
print(out, len(traces), 'traces', len(chips), 'chips')
