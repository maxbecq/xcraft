"""The night city's map (public/maps/ville-nuit.json): a whole city of building blocks (impassable, like cliffs and
chasms elsewhere) cut by wide avenues and squares, with raised decks for the bases and a viaduct over the lower city.
Only player 1's part (top left) is described; the game copies it by a half turn for player 2.
Run from the repository: python3 tools/maps/ville-nuit.py"""
import json

N = 120
terrain = []
streets = []


def area(x0, y0, x1, y1):
    return {"shape": "rect", "from": [x0, y0], "to": [x1, y1]}


def ground(x0, y0, x1, y1, level):
    """Cut out of the blocks: open ground at this level."""
    terrain.append({**area(x0, y0, x1, y1), "fill": True})
    terrain.append({**area(x0, y0, x1, y1), "level": level})


def ramp(at, up, width, level):
    """A ramp (4 tiles) from `level` up to level + 1 towards `up`; `at` is its tile touching the high ground."""
    dx, dy = {"N": (0, -1), "S": (0, 1), "E": (1, 0), "W": (-1, 0)}[up]
    tiles = [(at[0] - dx * k + (w if dx == 0 else 0), at[1] - dy * k + (w if dy == 0 else 0)) for k in range(4) for w in range(width)]
    xs, ys = [t[0] for t in tiles], [t[1] for t in tiles]
    terrain.append({**area(min(xs), min(ys), max(xs), max(ys)), "fill": True})
    terrain.append({"shape": "ramp", "at": list(at), "up": up, "width": width, "level": level})


def street(points, width):
    streets.append({"points": [list(p) for p in points], "width": width})


# Everything starts as blocks of buildings.
terrain.append({**area(0, 0, N - 1, N - 1), "chasm": True, "block": True})

# Avenues, 10 tiles wide: two across the whole map (and their turned copies), two between them north to south, and
# the central cross with its octagonal square (the market).
ground(0, 34, N - 1, 43, 0)
ground(34, 34, 43, 85, 0)
ground(34, 55, 85, 64, 0)
ground(55, 34, 64, 85, 0)
terrain.append({"shape": "octagon", "at": [59, 59], "half": 13, "cut": 7, "fill": True})
terrain.append({"shape": "octagon", "at": [59, 59], "half": 13, "cut": 7, "level": 0})
street([(0, 39), (N, 39)], 10)
street([(39, 34), (39, 86)], 10)
street([(34, 60), (86, 60)], 10)
street([(60, 34), (60, 86)], 10)

# The start: a deck (level 1) in the corner, the headquarters on a terrace above it (level 2); ramps terrace -> deck
# and deck -> the avenue.
ground(2, 2, 31, 31, 1)
ground(2, 2, 24, 24, 2)
ramp((25, 9), "W", 5, 1)
ramp((9, 25), "N", 5, 1)
ramp((15, 32), "N", 6, 0)

# The natural expansion: a small square off the avenues, west.
ground(2, 44, 33, 72, 0)

# Along the north edge: the third base on a deck, then the lower city's chasm crossed by a viaduct (level 1, 8 wide)
# to a forward deck in the far corner.
ground(47, 2, 72, 31, 1)
ramp((57, 32), "N", 6, 0)
terrain.append({**area(73, 0, 90, 33), "chasm": True})
ground(73, 13, 90, 20, 1)
ground(91, 2, 117, 31, 1)
ramp((101, 32), "N", 6, 0)
street([(47, 16.5), (117, 16.5)], 6)

# Minerals in the shape of the other maps' main bases (relative to the headquarters' top-left tile).
ARC = [(-5, 1), (-5, 0), (-5, -1), (-5, -2), (-5, -3), (-4, -4), (-3, -5), (-2, -5), (-1, -5), (0, -5)]  # 10 fields a base (the balancer, 2026-11-26)
bases = [
    {"name": "départ", "start": True, "hq": [12, 12], "minerals": [[12 + dx, 12 + dy] for dx, dy in ARC], "wells": [[17, 6]]},
    {"name": "naturelle", "hq": [12, 56], "minerals": [[6, 53 + k] for k in range(10)], "wells": [[19, 64]]},
    {"name": "troisième", "hq": [58, 14], "minerals": [[56 + k, 8] for k in range(10)], "wells": [[66, 20]]},
    {"name": "avancée", "hq": [102, 14], "minerals": [[100 + k, 8] for k in range(10)], "wells": [[95, 21]]},
]

out = {
    "format": 1,
    "id": "ville-nuit",
    "name": "Ville de nuit",
    "description": "Une ville entière sous la pluie : des avenues entre les immeubles, un marché au centre, un viaduc au-dessus de la ville basse.",
    "size": N,
    "players": [2],
    "symmetry": "rot180",
    "biomes": ["villenuit"],
    "biomesOnly": True,
    "terrain": terrain,
    "streets": streets,
    "bases": bases,
}
open("public/maps/ville-nuit.json", "w").write(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
print("ok", len(terrain), "formes")
