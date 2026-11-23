"""High-definition picture of a camp's console, without running the game.

The page holds only the interface (console, top displays, tools) built like the game builds it, styled by the
game's own src/style.css and fonts, with a sample selection and command card; headless Chrome renders it at
2 to 4 times the pixel density. So any camp's console (humains, isdaris, z, dieux) can be looked at and refined
from its CSS alone, in seconds.

Run:  python3 tools/hud/console.py dieux                 -> docs/consoles/console-dieux.png (1600 x 900 CSS px, x3)
      python3 tools/hud/console.py all --scale 2 --width 1920 --height 1080
      python3 tools/hud/console.py z --crop               -> only the bottom of the screen (console and arches)
      python3 tools/hud/console.py dieux --bg shot.png    -> a game screenshot behind instead of plain ground
"""
import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHROME = os.environ.get('CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')

# A sample selection per camp: the unit shown, its numbers, and command buttons (key, label, icon or None, cost).
SAMPLES = {
    'humains': ('serf', 'Serf', 'Armure 0 Vitesse 2,4 Vue 8', [('S', 'Stop', None, ''), ('B', 'Construire', None, ''), ('V', 'Avancer', None, ''), ('G', 'Récolter', None, ''), ('C', 'Caserne', 'caserne', '150'), ('R', 'Grenier', 'grenier', '100')]),
    'isdaris': ('moissonneur', 'Moissonneur', 'Armure 0 Bouclier 20 Vue 8', [('S', 'Stop', None, ''), ('B', 'Construire', None, ''), ('V', 'Avancer', None, ''), ('G', 'Récolter', None, ''), ('E', 'Émetteur', 'emetteur', '100'), ('P', 'Portail', 'portail', '150')]),
    'z': ('drone', 'Drone', 'Armure 0 Vitesse 2,6 Vue 8', [('S', 'Stop', None, ''), ('B', 'Construire', None, ''), ('V', 'Avancer', None, ''), ('G', 'Récolter', None, ''), ('P', 'Pod', 'pod', '100'), ('F', 'Plateforme', 'plateforme', '150')]),
    'dieux': ('gaia', 'Gaïa', 'Armure 6 Vitesse 2 Vue 11', [('S', 'Stop', None, ''), ('B', 'Construire', None, ''), ('V', 'Avancer', None, ''), ('T', 'Téléportation', None, ''), ('F', 'Flèche de Gaïa', None, ''), ('E', 'Esprit', 'esprit', '75')]),
}


def fonts_link() -> str:
    return '<link rel="stylesheet" href="public/fonts/fonts.css">'


def page(faction: str, bg: str | None) -> str:
    unit, name, stats, cmds = SAMPLES[faction]
    icon = lambda t: f'<img src="public/icons/{t}.png" alt="">'
    buttons = ''.join(
        f'<button class="cmd{" has-icon" if pic else ""}"><kbd>{k}</kbd>{icon(pic) if pic else ""}<span>{label}</span>{f"<small>{cost}</small>" if cost else ""}</button>'
        for k, label, pic, cost in cmds)
    ground = f"url('{bg}') center / cover" if bg else 'radial-gradient(ellipse at 50% 40%, #8a7650, #4a3c26 70%, #2a2216)'
    return f"""<!doctype html><html><head><meta charset="utf-8"><base href="{ROOT.as_uri()}/">{fonts_link()}
<style>{(ROOT / 'src' / 'style.css').read_text().replace("url('/", "url('public/")}</style>
<style>html, body {{ background: {ground}; }} .vcursor {{ display: none; }}</style></head>
<body class="{faction}">
<div class="hud-bar"><span class="res clock">12:34</span><span class="res min"><i></i>1250</span><span class="res nrg"><i></i>480</span><span class="res sup"><i></i>42/60</span></div>
<div class="console">
  <div class="slot map-slot"><canvas class="minimap" width="164" height="164"></canvas></div>
  <div class="hud-panel slot"><canvas class="portrait" hidden></canvas><div class="details">
    <div class="name">{name}</div><div class="hp"><div style="width:82%"></div></div><div class="info">2460 / 3000</div>
    <div class="stats">{stats}</div></div></div>
  <div class="hud-card slot">{buttons}</div>
</div>
<div class="tools"><button class="tool" data-t="menu"><span>☰ Menu</span></button><button class="tool" data-t="army"><span>⚔ Armée</span></button><button class="tool" data-t="home"><span>⌂ Base</span></button></div>
<script>
// The minimap: a diamond of ground with a few bases, as the game draws it.
const c = document.querySelector('.minimap'), g = c.getContext('2d');
g.translate(82, 82); g.rotate(Math.PI / 4);
g.fillStyle = '#5a4a30'; g.fillRect(-56, -56, 112, 112);
g.fillStyle = '#3d6a3a'; g.fillRect(-56, -56, 30, 30); g.fillStyle = '#7a3030'; g.fillRect(26, 26, 30, 30);
g.fillStyle = '#9ad8ff'; for (const [x, y] of [[-40, -10], [10, -44], [40, 8], [-8, 40]]) g.fillRect(x, y, 5, 5);
// The selection portrait: the unit's icon, as the hidden 3D portrait would show it.
document.querySelector('.details').insertAdjacentHTML('beforebegin', '<img class="portrait" src="public/icons/{unit}.png" style="object-fit:contain">');
</script></body></html>"""


def render(faction: str, out: Path, width: int, height: int, scale: float, crop: bool, bg: str | None) -> None:
    with tempfile.NamedTemporaryFile('w', suffix='.html', dir=ROOT, delete=False) as f:  # in the repo, so file:// paths resolve
        f.write(page(faction, bg))
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run([CHROME, '--headless=new', '--hide-scrollbars', '--allow-file-access-from-files', f'--force-device-scale-factor={scale}',
                        f'--window-size={width},{height}', '--virtual-time-budget=6000', f'--screenshot={out}', Path(f.name).as_uri()],
                       check=True, capture_output=True)
    finally:
        os.unlink(f.name)
    if crop:  # the bottom: console plus what rises over it (arches, crests, tools)
        keep = int(330 * scale)
        subprocess.run(['magick', str(out), '-gravity', 'South', '-crop', f'x{keep}+0+0', '+repage', str(out)], check=True)
    print(out)


def main() -> None:
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('faction', choices=[*SAMPLES, 'all'])
    a.add_argument('--width', type=int, default=1600)
    a.add_argument('--height', type=int, default=900)
    a.add_argument('--scale', type=float, default=3, help='pixel density (3 = a 1600 px wide screen becomes 4800 px)')
    a.add_argument('--crop', action='store_true', help='keep only the bottom of the screen')
    a.add_argument('--bg', help='an image behind the interface (path from the repo root), e.g. a game screenshot')
    a.add_argument('--out', help='output file (one camp only); default docs/consoles/console-<camp>.png')
    o = a.parse_args()
    if not Path(CHROME).exists():
        sys.exit(f'Chrome not found at {CHROME} (set CHROME=/path/to/chrome)')
    for faction in SAMPLES if o.faction == 'all' else [o.faction]:
        out = Path(o.out) if o.out and o.faction != 'all' else ROOT / 'docs' / 'consoles' / f'console-{faction}.png'
        render(faction, out, o.width, o.height, o.scale, o.crop, o.bg)


if __name__ == '__main__':
    main()
