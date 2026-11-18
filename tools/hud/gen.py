"""Generates a camp's console materials locally with Draw Things (no account, no cost), then prepares them for CSS:
cut-outs on transparency, seamless tiles, WebP.

Needs: brew install --cask draw-things && brew install draw-things-cli, a model (FLUX.2 [klein] 4B, Apache 2.0:
draw-things-cli models ensure --model flux_2_klein_4b_q8p.ckpt), ImageMagick.

Run:  python3 tools/hud/gen.py dieux               -> every material, 3 seeds each, raw images in recherches-visuelles/<camp>/generations/
      python3 tools/hud/gen.py dieux arche-carte --seeds 5
      python3 tools/hud/gen.py dieux --pick arche-carte=2 mur=1   -> prepares the chosen seeds into public/hud/<camp>/
      python3 tools/hud/gen.py dieux --column arche-commandes=2:845  -> colonne.webp: the right column of that picture,
          its right half from x (the shaft's axis, in the generated image) mirrored into a whole symmetric column
About 35 s an image on an M1 Max.
"""
import argparse
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# Visual research lives in the main checkout (not in a worktree), out of git: see .gitignore.
RESEARCH = Path(subprocess.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()).parent / 'recherches-visuelles'
MODEL = 'flux_2_klein_4b_q8p.ckpt'
LOOK = ('stylized hand-painted fantasy game art, cartoon-like with clean simple shapes and soft cel shading, painterly brush textures, '
        'warm ivory stone with pale gold trims, magical: faint glowing turquoise runes and a soft ethereal halo of light, '
        'not photorealistic, game interface asset')
LOOK_Z = ('stylized hand-painted sci-fi game art, cartoon-like with clean simple shapes and soft cel shading, painterly brush textures, '
          'rusted industrial machinery, gunmetal steel and orange rust, a few small glowing cyan lights, not photorealistic, game interface asset')
CUT = 'strict front orthographic elevation view, symmetrical, isolated on a plain pure white background, nothing behind it'

# name: (width, height, prompt, how to prepare: 'cut' = remove the white background, 'tile' = seamless both ways, 'tile-x' = seamless sideways,
# 'plain' = as it is, sized to cover its box)
MATERIALS = {
    'dieux': {
        'mur': (2048, 256, f'A long low horizontal strip of weathered ancient limestone wall, dressed ashlar blocks in regular courses, warm ivory and pale grey stone, fine chisel marks, a little moss in the joints, orthographic front view, {LOOK}', 'plain'),
        'arche-carte': (1024, 832, f'A single wide Romanesque round stone arch, perfect semicircle of carved limestone voussoirs with a keystone, springing from two very short Corinthian columns with acanthus capitals, the arch almost as wide as tall, ivy climbing one column and draping over the arch, {CUT}, {LOOK}', 'cut'),
        'arche-commandes': (1024, 576, f'A very wide and low segmental stone arch of carved limestone voussoirs with a keystone, its span five times wider than its supports, resting on two slender Corinthian columns with acanthus capitals at the far left and far right edges, thin ivy draping over one end, {CUT}, {LOOK}', 'cut'),
        'frise': (1536, 256, f'Seamless horizontal frieze band of small Romanesque blind arches on carved corbels, a Lombard band, limestone, a course of dressed stones above, a few ivy tendrils, orthographic front view, {LOOK}', 'tile-x'),
    },
    # Z: the machines' consoles, in the rusted, riveted steel of their buildings, with hydraulics and plugged cables.
    'z': {
        'plaques': (1024, 1024, f'Seamless texture of riveted steel armour plates, worn grey-brown gunmetal panels with rows of round rivets along the seams, patches of orange-brown rust and streaks of grime running down, scratches on the edges, orthographic flat front view, evenly lit, {LOOK_Z}', 'tile'),
        'hublot': (1024, 1024, f'A single heavy round porthole frame of thick rusted riveted steel, an empty dark circular opening in the middle, a ring of big bolts around it, two small hydraulic pistons on its sides, copper-ended cables plugged into it, {CUT}, {LOOK_Z}', 'cut'),
    },
}


def raw(camp: str, name: str, seed: int) -> Path:
    return RESEARCH / camp / 'generations' / f'{name}-{seed}.png'


def generate(camp: str, name: str, seeds: int) -> None:
    w, h, prompt, _ = MATERIALS[camp][name]
    for seed in range(1, seeds + 1):
        out = raw(camp, name, seed)
        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['draw-things-cli', 'generate', '--local', '--disable-preview', '--model', MODEL, '--width', str(w), '--height', str(h),
                        '--seed', str(seed), '--prompt', prompt, '-o', str(out)], check=True, capture_output=True)
        print(out)


def period_crop(src: Path) -> tuple[int, int, int, int]:
    """Box (x, y, w, h) of a whole number of horizontal repeats in the middle of a frieze on a white ground: rows
    that vary (not the plain ground) give the height; the period is the lag where the brightness profile best matches itself."""
    from PIL import Image
    g = Image.open(src).convert('L')
    W, H = g.size
    px = g.load()
    def textured(y: int) -> bool:  # a row of the frieze, not of the plain ground round it: bright or not, it varies
        v = [px[x, y] for x in range(W // 4, 3 * W // 4, 3)]
        mean = sum(v) / len(v)
        return sum((a - mean) ** 2 for a in v) / len(v) > 120
    rows = [y for y in range(H) if textured(y)]
    y0, y1 = rows[0], rows[-1] + 1
    prof = [sum(px[x, y] for y in range(y0, y1, 2)) for x in range(W)]
    lo, hi = W // 8, W - W // 8  # away from the frieze's ends
    def diff(lag: int) -> float:
        return sum(abs(prof[x] - prof[x + lag]) for x in range(lo, hi - lag)) / (hi - lag - lo)
    period = min(range(W // 40, W // 5), key=diff)
    n = (hi - lo) // period
    return lo, y0, n * period, y1 - y0


def prepare(camp: str, name: str, seed: int) -> None:
    src, how = raw(camp, name, seed), MATERIALS[camp][name][3]
    out = ROOT / 'public' / 'hud' / camp / f'{name}.webp'
    out.parent.mkdir(parents=True, exist_ok=True)
    # The model inks every edge (cartoon "ligne claire"): a closing wipes thin dark lines, mixed back at 60 % they fade
    # to a soft painted edge.
    m = ['magick', str(src), '(', '+clone', '-morphology', 'Close', 'Disk:2', ')', '-compose', 'blend', '-define', 'compose:args=60', '-composite', '-compose', 'over']
    if how == 'cut':
        # The white ground, filled from the four corners, becomes transparent; the edge eaten by a pixel against white fringes.
        m += ['-alpha', 'set', '-fuzz', '12%', '-fill', 'none']
        for c in ('0,0', '%[fx:w-1],0', '0,%[fx:h-1]', '%[fx:w-1],%[fx:h-1]'):
            m += ['-draw', f'color {c} floodfill']
        m += ['-channel', 'A', '-morphology', 'Erode', 'Disk:1', '+channel', '-trim', '+repage']
    elif how == 'tile-x':
        # A run of arches repeats sideways: crop a whole number of periods, so the strip repeats without a seam.
        x0, y0, w, h = period_crop(src)
        m += ['-crop', f'{w}x{h}+{x0}+{y0}', '+repage']
    elif how == 'tile':
        # Seamless: the image shifted by half (whose borders now meet cleanly) laid over itself, the original kept in
        # the middle where the shifted copy has its seam.
        w, h = (int(v) for v in subprocess.run(['magick', 'identify', '-format', '%w %h', str(src)], capture_output=True, text=True, check=True).stdout.split())
        m += ['(', '+clone', '-roll', f'+{w // 2}+{h // 2}', ')', '(', '-size', f'{w}x{h}', 'xc:', '-fx', 'min(1,1.6*max(abs(2*i/w-1),abs(2*j/h-1)))', ')', '-composite']
    m += ['-quality', '88', str(out)]
    subprocess.run(m, check=True)
    print(out)


def column(camp: str, name: str, seed: int, axis: int) -> None:
    """A clean column cut from an arch picture: the right half of its right column, from the shaft's axis, mirrored."""
    tmp = ROOT / 'public' / 'hud' / camp / f'{name}.webp'
    prepare(camp, name, seed)  # cut out of its white ground first (trimmed: the axis moves by the trim's offset)
    off = int(subprocess.run(['magick', str(raw(camp, name, seed)), '-fuzz', '12%', '-trim', '-format', '%X', 'info:'], capture_output=True, text=True, check=True).stdout.lstrip('+') or 0)
    out = tmp.with_name('colonne.webp')
    subprocess.run(['magick', str(tmp), '-crop', f'60x10000+{axis - off}+0', '+repage', '(', '+clone', '-flop', ')', '+swap', '+append', '-trim', '+repage', '-quality', '88', str(out)], check=True)
    tmp.unlink()
    print(out)


def main() -> None:
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('camp', choices=MATERIALS)
    a.add_argument('names', nargs='*', help='materials to generate (default: all)')
    a.add_argument('--seeds', type=int, default=3)
    a.add_argument('--column', metavar='NAME=SEED:AXIS', help='cut colonne.webp out of that arch picture')
    a.add_argument('--pick', nargs='*', metavar='NAME=SEED', help='prepare these generated images for the game instead')
    o = a.parse_args()
    if o.column:
        name, rest = o.column.split('=')
        seed, axis = rest.split(':')
        column(o.camp, name, int(seed), int(axis))
        return
    if o.pick:
        for p in o.pick:
            name, seed = p.split('=')
            prepare(o.camp, name, int(seed))
        return
    for name in o.names or MATERIALS[o.camp]:
        generate(o.camp, name, o.seeds)


if __name__ == '__main__':
    main()
