"""Flattens a Meshy unit texture into a few clean colour masses, for readable soldiers at game zoom.

Every texel is sorted into team blue, bare steel, dark (leather, straps, cloth), skin or other, then
repainted with that class's single tone, keeping only a soft shading from the original. Small light
islands inside the blue (trims, specks) are swallowed by the blue: a texel only ever turns blue, when
enough of its neighbourhood is blue, so the atlas's unrelated islands barely bleed into each other.
Bright saturated colours (a red gem, a glowing vial, a lamp) are kept as they are and never swallowed.

Usage: python3 tools/meshy/flatten.py in.webp out.webp
"""
import colorsys
import sys

from PIL import Image, ImageFilter

BLUE, STEEL, DARK, SKIN, OTHER, COPPER, IVORY, KHAKI = range(8)
TONES = {
    BLUE: (34, 78, 196),  # read as team paint by the game (blue well above red and green)
    STEEL: (150, 154, 160),  # neutral grey: the game polishes it as bare steel
    DARK: (52, 40, 32),
    SKIN: (214, 160, 120),
    COPPER: (178, 102, 50),  # the alchemists' brass and copper
    IVORY: (226, 216, 196),
    KHAKI: (122, 116, 64),  # olive drab uniforms
}


def vivid(r, g, b):
    """A bright, saturated colour other than the team blue and the orange-brown of skin and copper: a glow,
    a vial, a gem, a lamp. Never repainted, never swallowed."""
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    hue = h * 360
    if 75 < hue < 170 and s > 0.27 and v > 0.5:
        return True  # greens: no soldier is painted green
    if 45 < hue <= 75 and s < 0.46 and v > 0.58:
        return True  # a pale yellow-green vial's glass; khaki cloth is darker or more saturated
    if s < 0.45 or v < 0.55 or 190 < hue < 255:
        return False
    return not 10 < hue < 45 or (v > 0.9 and s > 0.75)  # orange too when it glows


def classify(r, g, b):
    lum = 0.3 * r + 0.59 * g + 0.11 * b
    chroma = max(r, g, b) - min(r, g, b)
    if b - max(r * 1.5, g) > 18 or (b > 38 and b > r + 14 and b > g + 8):
        return BLUE  # the plates' shaded navy too, or it would turn brown
    if vivid(r, g, b):
        return OTHER  # before the pale and warm tests below: a light yellow-green vial passed as ivory
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    if 45 < h * 360 <= 75 and s > 0.3 and v > 0.3:
        return KHAKI
    if (g > r + 20 and g > b + 15) or (r > 140 and g < 70 and b < 70):
        return OTHER  # green vials and glows, red gems and lamps: kept as painted
    if r > 150 and r > g + 25 and g > b + 15 and lum > 120 and r - g < 70:
        return SKIN if r - b < 120 else OTHER
    if chroma < 24 and lum > 70:
        return STEEL
    if lum > 165 and r >= b:
        return IVORY
    if r > 120 and r - g > 40 and lum > 85:
        return COPPER
    if lum < 120 or (r > b and chroma >= 24):
        return DARK  # leather, straps, khaki and brown cloth, black
    return OTHER


def main(src, dst):
    im = Image.open(src).convert("RGB")
    w, h = im.size
    px = im.load()
    cls = [[classify(*px[x, y]) for x in range(w)] for y in range(h)]
    # Small islands inside the blue (specks, emblems) go blue when most of their neighbourhood is blue.
    # Steel trims round the plates are then eaten from the blue outwards, a few texels per pass: polished,
    # they caught the sand's colour and read as beige specks on the shoulders. Skin is never swallowed.
    for passes, box, cut, kinds in ((1, 4, 140, (STEEL, DARK)), (4, 1, 70, (STEEL,))):
        for _ in range(passes):
            blue = Image.new("L", (w, h))
            blue.putdata([255 if cls[y][x] == BLUE else 0 for y in range(h) for x in range(w)])
            share = blue.filter(ImageFilter.BoxBlur(box)).load()
            for y in range(h):
                for x in range(w):
                    if cls[y][x] in kinds and share[x, y] > cut:
                        cls[y][x] = BLUE
    # Soft shading: the original's brightness, blurred, relative to its class's mean.
    lum = im.convert("L").filter(ImageFilter.GaussianBlur(1.5)).load()
    sums, counts = [0.0] * 8, [0] * 8
    for y in range(h):
        for x in range(w):
            c = cls[y][x]
            sums[c] += lum[x, y]
            counts[c] += 1
    mean = [s / n if n else 1 for s, n in zip(sums, counts)]
    out = Image.new("RGB", (w, h))
    o = out.load()
    for y in range(h):
        for x in range(w):
            c = cls[y][x]
            if c == OTHER:
                o[x, y] = px[x, y]
                continue
            shade = max(0.7, min(1.25, 1 + 0.45 * (lum[x, y] / mean[c] - 1)))
            o[x, y] = tuple(min(255, int(v * shade)) for v in TONES[c])
    # Lossless, over a 256-colour palette (plenty for flat masses): lossy WebP halves the colour resolution,
    # and small glows bled into their dark neighbours.
    out.quantize(256, method=Image.Quantize.MAXCOVERAGE).convert("RGB").save(dst, lossless=True, method=6, quality=100)
    print(f"{src} -> {dst}: " + ", ".join(f"{n} {counts[i] * 100 // (w * h)}%" for i, n in enumerate(["blue", "steel", "dark", "skin", "other", "copper", "ivory", "khaki"])))


if __name__ == "__main__":
    main(*sys.argv[1:3])
