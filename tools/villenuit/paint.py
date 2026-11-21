"""Paints a piece of the night city from its plain volumes (blockout.py), on this Mac (Draw Things, FLUX.2 klein,
behind the shared GPU lock of tools/meshy/local3d.py). Two passes, as painters do:
  1. the whole piece at 40 pixels per tile, repainted from the volumes: the layout, the light, the colours;
  2. the detail at 80 pixels per tile: the first pass cut in overlapping parts, each redrawn sharp at twice its size,
     brought back to the first pass's colours (so the parts agree) and joined with a short fade in the overlaps.
No reference picture is given to the model: with one it copies that picture's buildings onto the open ground.

  python3 tools/villenuit/paint.py <name> <sx> <sy> [seed]     # centre in painting space (see blockout.py)
Writes <work>/<name>-{volumes,pass1,pass2}.png; work = $VILLENUIT_WORK or recherches-visuelles/ville-nuit/peinture.
"""
import os
import subprocess
import sys

from PIL import Image, ImageChops, ImageFilter

W, H, PPU = 1536, 1024, 40
WORK = os.environ.get("VILLENUIT_WORK", "recherches-visuelles/ville-nuit/peinture")
# The ground (VILLENUIT_GROUND): nearly black; light, grey-green; or between the two, a neutral grey.
GROUNDS = {
    "sombre": "The ground: wet black stone slabs with thin joints, calm and dark, a few puddles, long sharp vertical reflections of the lights. Very dark.",
    "clair": "The ground: wet grey stone slabs with thin dark joints, every slab clearly visible, glistening with rain under a soft cold grey-green light from the sky, clearly lighter than the black shadows of the buildings; long bright vertical reflections of the shop windows and of the neon signs stretch far across it; a few shallow puddles.",
    "gris": "The ground: wet neutral dark grey stone slabs with thin dark joints, every slab visible, glistening with rain under a dim neutral grey light, no green or teal tint; clearly lighter than the black shadows of the buildings but still a night scene; long bright vertical reflections of the shop windows and of the neon signs stretch far across it; the paving is whole and even everywhere, no hole, no missing slab, no dark patch. The avenues between the paved areas are roads of wet dark asphalt, a fine grainy tarmac darker than the slabs, with stone kerbs along the pavements: a roadway, not water, not a canal.",
}
SCENE = (
    "Dark retro-futuristic industrial megacity at night just after the rain, seen from above at a fixed isometric "
    "game camera. Buildings of weathered, rusted, riveted dark metal and stained concrete, thick pipes, ducts, heavy "
    "cornices, roofs cluttered with air conditioners, fans, water tanks and railings; many tiny windows, a few lit "
    "warm amber; small shop fronts with warm amber light under awnings at the foot of the buildings; a few neon signs "
    "in red, cyan and magenta with simple shapes. " + GROUNDS[os.environ.get("VILLENUIT_GROUND", "sombre")] + " The open "
    "ground is bare: only its slabs, puddles and reflections, nothing stands or lies on it, no pipe, no machine, no "
    "crate. High contrast, moody, gritty realistic matte painting, cinematic concept art. No rain streaks, no falling "
    "rain drops, no smoke, no steam, no people, no vehicles."
)
PASS1 = (
    "Repaint this rough 3D blockout of a city as a finished, highly detailed digital painting. Strictly keep the "
    "layout: every building keeps its exact footprint, place and height; the flat grey areas are open empty ground and "
    "must stay completely empty, with no building, no object and no wall added on them; same camera angle and "
    "framing. " + SCENE
)
PASS2 = (
    "Redraw this blurry low-resolution painting as a sharp, finished painting at full resolution. Keep exactly the "
    "same composition, the same buildings at the same place, the same colours, the same darkness and the same "
    "lights; add only fine realistic detail and texture. " + SCENE
)
# A part with nothing but open ground in it: asked for the least (told to finish a painting, the model builds one).
BARE = (
    "Sharpen this slightly blurry picture of a wet stone-paved ground seen from above at night. Change nothing: the "
    "same slabs, the same joints at the same place, the same colours, the same darkness, the same reflections. Only "
    "make it crisp. Add nothing: no object, no building, no wall, no post, no hole, no people."
)


def klein(src, out, prompt, seed):
    if os.path.exists(out):
        return
    subprocess.check_call(["python3", "tools/meshy/local3d.py", "--gpu", "draw-things-cli", "generate", "--local", "--disable-preview", "--model", "flux_2_klein_4b_q8p.ckpt", "--width", str(W), "--height", str(H), "--seed", str(seed), "--image", src, "--prompt", prompt, "-o", out], stdout=subprocess.DEVNULL)


def like(picture, guide, radius=48):
    """The picture with its broad colours and light brought back to the guide's (its detail kept)."""
    d = ImageChops.subtract(guide.filter(ImageFilter.GaussianBlur(radius)), picture.filter(ImageFilter.GaussianBlur(radius)), 1, 128)
    return ImageChops.add(picture, d, 1, -128)


# After the first pass, the walkable ground set by hand (the model does not hold a tint to a word): how far towards
# grey, and how dark; its bright pixels (the reflections of the lights) left as they are.
TUNE = {"gris": (0.65, 0.8)}


def tune(picture, mask, grey, dim):
    lum = picture.convert("L")
    r, _, b = picture.split()
    ground = mask.filter(ImageFilter.GaussianBlur(3))
    # the coloured reflections keep their colour: the warm ones, and the frankly blue ones (a cyan sign's; the wet
    # slabs' own faint blue is the tint to take out)
    warm = ImageChops.subtract(r, b).filter(ImageFilter.GaussianBlur(2)).point(lambda v: min(255, max(0, v - 24) * 8))
    cold = ImageChops.subtract(b, r).filter(ImageFilter.GaussianBlur(2)).point(lambda v: min(255, max(0, v - 60) * 8))
    plain = ImageChops.multiply(ImageChops.invert(ImageChops.lighter(warm, cold)), ground)
    picture = Image.composite(Image.blend(picture, Image.merge("RGB", (lum, lum, lum)), grey), picture, plain)
    # darker, but for what shines
    dull = lum.point(lambda v: 255 - min(255, max(0, v - 90) * 4))
    return Image.composite(picture.point(lambda v: int(v * dim)), picture, ImageChops.multiply(dull, plain))


def ramp(n, lo, hi, fade):
    """A weight along one side: 0 before lo - fade/2, 1 inside, 0 after hi + fade/2 (lo/hi None: no fade at that end)."""
    def at(i):
        a = 1 if lo is None else min(1, max(0, (i - lo) / fade + 0.5))
        b = 1 if hi is None else min(1, max(0, (hi - i) / fade + 0.5))
        return int(255 * min(a, b))
    return [at(i) for i in range(n)]


def main(name, sx, sy, seed=3):
    os.makedirs(WORK, exist_ok=True)
    f = lambda k: f"{WORK}/{name}-{k}.png"
    if not os.path.exists(f("volumes")):
        subprocess.check_call(["blender", "-b", "--factory-startup", "-P", "tools/villenuit/blockout.py", "--", "tile", str(sx), str(sy), str(PPU), str(W), str(H), f("volumes")], stdout=subprocess.DEVNULL)
    if not os.path.exists(f("mask")):
        subprocess.check_call(["blender", "-b", "--factory-startup", "-P", "tools/villenuit/blockout.py", "--", "mask", str(sx), str(sy), str(PPU), str(W), str(H), f("mask")], stdout=subprocess.DEVNULL)
    # the ground a unit walks on, away from the walls (three quarters of a tile): there the second pass may only add grain
    open_ground = Image.open(f("mask")).convert("L").filter(ImageFilter.GaussianBlur(12)).point(lambda v: 255 if v > 250 else 0)
    klein(f("volumes"), f("pass1"), PASS1, seed)
    first = Image.open(f("pass1")).convert("RGB")
    ground_kind = os.environ.get("VILLENUIT_GROUND", "sombre")
    if ground_kind in TUNE:
        first = tune(first, Image.open(f("mask")).convert("L"), *TUNE[ground_kind])
        first.save(f("pass1-tuned"))
    big = Image.new("RGB", (2 * W, 2 * H))
    FADE = 96
    for j in range(3):
        for i in range(3):
            x, y = i * W // 4, j * H // 4  # in the first pass
            part = first.crop((x, y, x + W // 2, y + H // 2)).resize((W, H), Image.LANCZOS)
            part.save(f(f"in-{i}{j}"))
            ground = open_ground.crop((x, y, x + W // 2, y + H // 2)).resize((W, H), Image.BILINEAR)
            bare = ground.histogram()[255] > 0.995 * W * H
            klein(f(f"in-{i}{j}"), f(f"out-{i}{j}"), BARE if bare else PASS2, seed + 10 + i + 3 * j)
            out = like(Image.open(f(f"out-{i}{j}")).convert("RGB"), part)
            # what the second pass built on the open ground (a pipe, a crate) goes: the first pass's ground comes back there
            built = ImageChops.difference(out.filter(ImageFilter.GaussianBlur(5)), part.filter(ImageFilter.GaussianBlur(5))).convert("L")
            built = built.point(lambda v: 255 if v > (7 if bare else 12) else 0).filter(ImageFilter.MaxFilter(31)).filter(ImageFilter.GaussianBlur(10))
            out = Image.composite(part.filter(ImageFilter.UnsharpMask(3, 80, 2)), out, ImageChops.multiply(built, ground))
            # each part keeps the middle of its overlaps with its neighbours
            wx = ramp(W, None if i == 0 else W // 4, None if i == 2 else 3 * W // 4, FADE)
            wy = ramp(H, None if j == 0 else H // 4, None if j == 2 else 3 * H // 4, FADE)
            mx = Image.new("L", (W, 1)); mx.putdata(wx)
            my = Image.new("L", (1, H)); my.putdata(wy)
            mask = ImageChops.multiply(mx.resize((W, H)), my.resize((W, H)))
            big.paste(out, (2 * x, 2 * y), mask)
    big.save(f("pass2"))
    print("ok", f("pass2"))


if __name__ == "__main__":
    main(sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), *(int(a) for a in sys.argv[4:5]))
