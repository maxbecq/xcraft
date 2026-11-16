"""Keys the black out of each Forge upgrade emblem and stamps its level (1 to 3 pips): public/icons/<line><level>.png.
Usage: python3 tools/meshy/upgrade-icons.py
"""
from PIL import Image, ImageDraw

for line in ("melee", "ranged", "armor"):
    base = Image.open(f"tools/meshy/out/{line}-icon.png").convert("RGBA").resize((128, 128), Image.LANCZOS)
    # The emblem was painted on black: near-black becomes transparent, with a soft edge.
    px = base.load()
    for y in range(128):
        for x in range(128):
            r, g, b, _ = px[x, y]
            px[x, y] = (r, g, b, max(0, min(255, (max(r, g, b) - 18) * 6)))
    for level in (1, 2, 3):
        im = base.copy()
        d = ImageDraw.Draw(im)
        for i in range(level):
            x = 128 - 14 - i * 13
            d.rectangle((x - 5, 110, x + 5, 122), fill=(255, 216, 96, 255), outline=(20, 16, 8, 255), width=2)
        im.save(f"public/icons/{line}{level}.png")
        print("icon", f"{line}{level}")
