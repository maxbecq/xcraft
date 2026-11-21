"""Cuts a painted piece of the night city (paint.py) into the tiles the game loads zone by zone
(src/render/painted.ts): public/textures/villenuit/0/<col>_<row>.webp at 80 pixels per map tile, 1/ at 40, and
base.webp, the whole city at 10. One grid for all, in painting space (see blockout.py).

  python3 tools/villenuit/tiles.py <painting.png> <sx> <sy>     # the painting's centre; 80 pixels per map tile
A tile the painting only covers in part keeps what it had elsewhere (pieces are added one after the other).
"""
import json
import os
import sys

from PIL import Image

PPU, SIZE = 80, 1024
COLS, ROWS = 24, 14
LEFT, TOP = -COLS * SIZE / PPU / 2, 3 * SIZE / PPU  # the grid's top left corner in painting space
OUT = "public/textures/villenuit"
Image.MAX_IMAGE_PIXELS = None


def main(path, sx, sy):
    art = Image.open(path).convert("RGB")
    # the painting's top left corner, in level 0 pixels of the whole grid
    x0, y0 = round((sx - LEFT) * PPU - art.width / 2), round((TOP - sy) * PPU - art.height / 2)
    manifest_path = f"{OUT}/tiles.json"
    old = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    have = {"0": old.get("0", []), "1": old.get("1", [])}
    for level in (0, 1):
        size = SIZE << level  # level 0 pixels a tile of this level covers
        os.makedirs(f"{OUT}/{level}", exist_ok=True)
        for r in range(y0 // size, (y0 + art.height - 1) // size + 1):
            for c in range(x0 // size, (x0 + art.width - 1) // size + 1):
                name = f"{c}_{r}"
                f = f"{OUT}/{level}/{name}.webp"
                tile = Image.open(f).convert("RGB") if os.path.exists(f) else Image.new("RGB", (SIZE, SIZE), (2, 2, 4))
                box = (max(x0, c * size), max(y0, r * size), min(x0 + art.width, (c + 1) * size), min(y0 + art.height, (r + 1) * size))
                part = art.crop((box[0] - x0, box[1] - y0, box[2] - x0, box[3] - y0))
                if level:
                    part = part.resize((max(1, part.width >> level), max(1, part.height >> level)), Image.LANCZOS)
                tile.paste(part, ((box[0] - c * size) >> level, (box[1] - r * size) >> level))
                tile.save(f, quality=84, method=6)
                if name not in have[str(level)]:
                    have[str(level)].append(name)
    f = f"{OUT}/base.webp"
    base = Image.open(f).convert("RGB") if os.path.exists(f) else Image.new("RGB", (COLS * SIZE // 8, ROWS * SIZE // 8), (2, 2, 4))
    base.paste(art.resize((art.width // 8, art.height // 8), Image.LANCZOS), (x0 // 8, y0 // 8))
    base.save(f, quality=84, method=6)
    json.dump({"ppu": PPU, "size": SIZE, "left": LEFT, "top": TOP, "cols": COLS, "rows": ROWS, **have}, open(manifest_path, "w"))
    print("ok", {k: len(v) for k, v in have.items()})


if __name__ == "__main__":
    main(sys.argv[1], float(sys.argv[2]), float(sys.argv[3]))
