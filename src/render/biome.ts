import {
  AdditiveBlending, BoxGeometry, type BufferGeometry, CanvasTexture, DoubleSide, Color, CylinderGeometry, Euler, Group, type Material, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, NoColorSpace, PlaneGeometry, Quaternion, RepeatWrapping, SRGBColorSpace, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DECK_SLAB } from '../terrain';
import { Grid } from '../sim/grid';
import { expansion } from '../sim/setup';
import type { World } from '../sim/world';

/** Look of a planet: ground and cliff palette, light, sky and glowing ground veins. Rendering only. */
export interface Biome {
  id: string;
  name: string;
  /** Ground colour per cliff level (low, mid, high). */
  levels: [Color, Color, Color];
  patch: Color;
  sand: Color;
  ramp: Color;
  rock: Color;
  rockDark: Color;
  /** Glow in the ground's cracks, or null for none. */
  veins: Color | null;
  sun: { color: number; intensity: number };
  sky: { color: number; ground: number; intensity: number };
  background: number;
  exposure: number;
  /** Multiplies the colours of scenery (rocks, wrecks…). */
  decorTint: Color;
  /** Height of sand dunes over the open ground, if any. */
  dunes?: number;
  /** Scattered stones in plain grey. */
  greyStones?: boolean;
  /** Built world instead of natural ground ('city': metal decks, wall cladding, neon, a void below). */
  style?: 'city';
  /**
   * Chasms on natural ground (the city has its own void): how deep the floor lies, in levels; its colour; a glow
   * from below (or none); and a smooth, glossy floor (ice).
   */
  chasm: { depth: number; floor: Color; glow?: Color; glossy?: boolean };
}

export const BIOMES: Record<string, Biome> = {
  desert: {
    id: 'desert',
    name: 'Désert',
    levels: [new Color(0xb08f5e), new Color(0xa48a62), new Color(0xbcad8c)],
    patch: new Color(0x6e5a3e),
    sand: new Color(0xd2b47e),
    ramp: new Color(0xc9a878),
    rock: new Color(0x9a7a5e),
    rockDark: new Color(0x4a382c),
    veins: null,
    sun: { color: 0xffe2b8, intensity: 3.2 },
    sky: { color: 0xb8c8e8, ground: 0x4a3820, intensity: 1.1 },
    background: 0x0d0f12,
    exposure: 1.05,
    decorTint: new Color(1, 1, 1),
    // A shallow crevasse: a short drop of rock onto dark, stony sand.
    chasm: { depth: 1.4, floor: new Color(0x5a4028) },
  },
  // The desert's shapes under a black sky: grey regolith, dark maria, a hard white sun.
  lune: {
    id: 'lune',
    name: 'Lune',
    levels: [new Color(0x8d8f93), new Color(0x7f8185), new Color(0xa6a8ac)],
    patch: new Color(0x4d525c),
    sand: new Color(0xb9bbbf),
    ramp: new Color(0x96989c),
    rock: new Color(0x7a7c80),
    rockDark: new Color(0x2c2d31),
    veins: null,
    sun: { color: 0xf2f4ff, intensity: 3.6 },
    sky: { color: 0x9aa4bc, ground: 0x1a1b1f, intensity: 0.7 },
    background: 0x030306,
    exposure: 1.0,
    decorTint: new Color(0.8, 0.82, 0.88),
    dunes: 1.0,
    greyStones: true,
    // A rille: a shallow trench of dark regolith.
    chasm: { depth: 1.4, floor: new Color(0x4a4c52) },
  },
  alien: {
    id: 'alien',
    name: 'Monde étrange',
    levels: [new Color(0x2a2a3c), new Color(0x323047), new Color(0x403a56)],
    patch: new Color(0x16182a),
    sand: new Color(0x4a3d66),
    ramp: new Color(0x3c3654),
    rock: new Color(0x4e3f66),
    rockDark: new Color(0x16121f),
    veins: new Color(0x2ef2d0),
    sun: { color: 0xa8c8ff, intensity: 2.4 },
    sky: { color: 0x7a5cc8, ground: 0x10301c, intensity: 0.9 },
    background: 0x07040e,
    exposure: 1.1,
    decorTint: new Color(0.55, 0.5, 0.75),
    // A rift: a shallow trench, its floor tinged with the cracks' colour.
    chasm: { depth: 1.4, floor: new Color(0x1c2a34) },
  },
  // Frozen world: blue-white ice, snow drifts for dunes, pale light in the cracks.
  glace: {
    id: 'glace',
    name: 'Planète de glace',
    levels: [new Color(0xb8c8d8), new Color(0xc6d4e2), new Color(0xe2eaf2)],
    patch: new Color(0x7f9ab4),
    sand: new Color(0xf2f6fa),
    ramp: new Color(0xd0dce8),
    rock: new Color(0x8aa4bc),
    rockDark: new Color(0x2e4258),
    veins: new Color(0x6ad0ff),
    sun: { color: 0xe8f2ff, intensity: 3.0 },
    sky: { color: 0xa8c4e8, ground: 0x30485e, intensity: 1.0 },
    background: 0x0a1220,
    exposure: 1.0,
    decorTint: new Color(0.82, 0.92, 1.05),
    dunes: 0.6,
    greyStones: true,
    // A glacier in a hollow: a smooth sheet of blue ice a level and a half down.
    chasm: { depth: 1.6, floor: new Color(0x6aa2c8), glow: new Color(0x1c5a8a), glossy: true },
  },
  // An abandoned megacity: decks of riveted plates over a void, neon in the seams, rain-dark steel.
  ville: {
    id: 'ville',
    name: 'Ville futuriste',
    levels: [new Color(0x3a404a), new Color(0x4a505a), new Color(0x5a606a)],
    patch: new Color(0x2e333b),
    sand: new Color(0x585e68),
    ramp: new Color(0x5a5f68),
    rock: new Color(0x50565e),
    rockDark: new Color(0x16181c),
    veins: new Color(0x2ee8ff),
    sun: { color: 0xc8d4ff, intensity: 2.2 },
    sky: { color: 0x8a6ad0, ground: 0x10141c, intensity: 1.0 },
    background: 0x05040c,
    exposure: 1.15,
    decorTint: new Color(0.7, 0.72, 0.8),
    style: 'city',
    chasm: { depth: 6, floor: new Color(0x050409) }, // unused: the lower city fills the void (cityUnderdeck)
  },
};

/** Biome from `?biome=`, else the last one chosen in the menu, else the desert. */
export function pickBiome(params: URLSearchParams): Biome {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem('xcraft.biome');
  } catch {
    // storage unavailable: fine
  }
  return BIOMES[params.get('biome') ?? stored ?? 'desert'] ?? BIOMES.desert;
}

/**
 * The city's void: far below the decks, the lights of the lower city (windows, neon, traffic streaks)
 * through a haze, seen past the map's edges. Render only.
 */
export function cityAbyss(width: number, height: number): Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#05040c';
  g.fillRect(0, 0, 512, 512);
  let r = 12345;
  const rand = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  const colours = ['#ffd27a', '#ff4fd8', '#2ee8ff', '#ff8a3a', '#b8c8ff'];
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = colours[Math.floor(rand() * colours.length)];
    g.globalAlpha = 0.25 + rand() * 0.75;
    g.fillRect(rand() * 512, rand() * 512, 1 + rand() * 2, 1 + rand() * 2);
  }
  for (let i = 0; i < 60; i++) {
    g.strokeStyle = colours[Math.floor(rand() * 3)];
    g.globalAlpha = 0.35;
    g.lineWidth = 1;
    const x = rand() * 512;
    const y = rand() * 512;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rand() > 0.5 ? 60 : 0), y + (rand() > 0.5 ? 0 : 60));
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(6, 6);
  t.colorSpace = SRGBColorSpace;
  const abyss = new Mesh(new PlaneGeometry(width * 8, height * 8).rotateX(-Math.PI / 2), new MeshBasicMaterial({ map: t, color: 0x9a8acc, blending: AdditiveBlending, transparent: true, depthWrite: false }));
  abyss.position.set(width / 2, -30, height / 2);
  abyss.userData.noPick = true;
  return abyss;
}

// ---------------------------------------------------------------- the dead megacity (render only)

/** Seeded random numbers, 0..1. */
function rng(seed: number): () => number {
  let r = seed;
  return () => (r = (r * 9301 + 49297) % 233280) / 233280;
}

const hash = (n: number) => {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * How bright a neon is now: mostly on, with stutters and short outages ('buzz'), or a slow beacon ('blink').
 * Lights of the same material flicker together, so each sign or lamp group gets its own seed.
 */
function flickerLevel(kind: 'buzz' | 'blink', seed: number, t: number): number {
  if (kind === 'blink') return (t * 0.5 + seed) % 1 < 0.25 ? 1 : 0.3;
  // Gentle: a rare short stutter, and now and then a dip of a second, never fully off.
  const h = hash(Math.floor(t * 10 + seed * 31) + seed * 1000);
  const dip = hash(Math.floor(t * 0.4 + seed * 7)) < 0.06 && hash(Math.floor(t * 6 + seed)) < 0.5;
  return dip ? 0.45 : h < 0.02 ? 0.6 : 1;
}

/** A glowing material that flickers (its merged mesh updates the colour before each draw). */
function flicker<M extends MeshBasicMaterial>(m: M, kind: 'buzz' | 'blink', seed: number): M {
  m.userData.flicker = { kind, seed, base: m.color.clone() };
  return m;
}

/**
 * Static scenery collected by material and merged into one mesh each at the end: thousands of railing posts,
 * slabs and windows in a few dozen draw calls.
 */
class Batch {
  private readonly parts = new Map<Material, BufferGeometry[]>();
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler(0, 0, 0, 'YXZ');
  private readonly p = new Vector3();
  private readonly one = new Vector3(1, 1, 1);

  add(geo: BufferGeometry, mat: Material, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0): void {
    this.q.setFromEuler(this.e.set(rx, ry, rz, 'YXZ'));
    const g = geo.clone().applyMatrix4(this.m.compose(this.p.set(x, y, z), this.q, this.one));
    const list = this.parts.get(mat);
    if (list) list.push(g);
    else this.parts.set(mat, [g]);
  }

  into(group: Group): Group {
    for (const [mat, list] of this.parts) {
      const mesh = new Mesh(mergeGeometries(list), mat);
      const f = mat.userData.flicker as { kind: 'buzz' | 'blink'; seed: number; base: Color } | undefined;
      if (f) {
        const c = (mat as MeshBasicMaterial).color;
        mesh.onBeforeRender = () => c.copy(f.base).multiplyScalar(flickerLevel(f.kind, f.seed, performance.now() / 1000));
      }
      mesh.userData.noPick = true;
      group.add(mesh);
    }
    this.parts.clear();
    return group;
  }
}

const canvas = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
};

const texture = (c: HTMLCanvasElement, repeat = false): CanvasTexture => {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  return t;
};

/** A soft round glow, white in the middle: light pools on the ground and halos round neon. */
let glowTexture: CanvasTexture | null = null;
function glow(color: number, opacity = 1): MeshBasicMaterial {
  if (!glowTexture) {
    const [c, g] = canvas(64, 64);
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    glowTexture = texture(c);
  }
  return new MeshBasicMaterial({ map: glowTexture, color, opacity, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
}

/** World size of one repeat of the facade texture (8 windows across, 25 floors up). */
const FACADE_U = 4;
const FACADE_V = 12;

/** Facade of an abandoned tower: colour (dark windows, stains running down) and glow (the few windows still lit). */
function facade(seed: number): MeshStandardMaterial {
  const [c, g] = canvas(64, 256);
  const [e, ge] = canvas(64, 256);
  const rand = rng(seed * 7919 + 13);
  g.fillStyle = '#2a2d34';
  g.fillRect(0, 0, 64, 256);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, 64, 256);
  // Lit windows come in clusters (a lived-in floor), the rest dark or broken.
  for (let y = 4; y < 256; y += 10) {
    const floorLit = rand() > 0.86;
    for (let x = 3; x < 64; x += 8) {
      const v = rand();
      const lit = (floorLit && v > 0.5) || v > 0.975;
      const col = lit ? (rand() > 0.3 ? '#ffd27a' : rand() > 0.5 ? '#7ae8ff' : '#ff6ad8') : v > 0.7 ? '#0a0b0e' : '#15171c';
      g.fillStyle = col;
      g.fillRect(x, y, 5, 6);
      if (lit) {
        ge.fillStyle = col;
        ge.fillRect(x, y, 5, 6);
      }
    }
  }
  g.globalAlpha = 0.35;
  for (let i = 0; i < 14; i++) {
    g.fillStyle = '#0c0d10';
    g.fillRect(rand() * 64, rand() * 200, 2 + rand() * 4, 40 + rand() * 120);
  }
  return new MeshStandardMaterial({ map: texture(c, true), emissiveMap: texture(e, true), emissive: 0xffffff, emissiveIntensity: 0.7, roughness: 0.8, metalness: 0.3 });
}

/** Scales a BoxGeometry's UVs so a repeating texture keeps the same world size on every face. */
function boxUv(geo: BoxGeometry, w: number, h: number, d: number, U: number, V: number): BoxGeometry {
  const uv = geo.getAttribute('uv');
  const faces: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  faces.forEach(([fu, fv], f) => {
    for (let i = f * 4; i < f * 4 + 4; i++) uv.setXY(i, uv.getX(i) * (fu / U), uv.getY(i) * (fv / V));
  });
  return geo;
}

/** A broken neon sign in an alien script: glyphs of strokes and dots, some tubes dead, on a dark plate. */
function alienSign(seed: number, color: string, vertical = false): CanvasTexture {
  const [c, g] = vertical ? canvas(48, 160) : canvas(128, 48);
  const rand = rng(seed * 7919 + 3);
  g.fillStyle = '#0b0c12';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#30323c';
  g.lineWidth = 2;
  g.strokeRect(2, 2, c.width - 4, c.height - 4);
  g.lineWidth = 3;
  g.lineCap = 'round';
  const glyphs = vertical ? 6 : 5;
  for (let k = 0; k < glyphs; k++) {
    // Glyph cell origin, along the sign's long side.
    const [x0, y0] = vertical ? [14, 8 + k * 25] : [10 + k * 23, 10];
    for (let s = 0; s < 3 + Math.floor(rand() * 2); s++) {
      // One tube in four is dead.
      g.strokeStyle = rand() < 0.25 ? '#2a2a33' : color;
      g.shadowColor = color;
      g.shadowBlur = 6;
      g.beginPath();
      g.moveTo(x0 + rand() * 18, y0 + rand() * 18);
      if (rand() > 0.5) g.quadraticCurveTo(x0 + rand() * 18, y0 + rand() * 20, x0 + rand() * 18, y0 + rand() * 18);
      else g.lineTo(x0 + rand() * 18, y0 + rand() * 18);
      g.stroke();
    }
    if (rand() > 0.6) {
      g.fillStyle = color;
      g.fillRect(x0 + 8, y0 + 21, 3, 3);
    }
  }
  return texture(c);
}

const NEON = ['#2ee8ff', '#ff4fd8', '#ffb04a', '#7aff8a', '#ff4a5a'];
const NEON_HEX = [0x2ee8ff, 0xff4fd8, 0xffb04a, 0x7aff8a, 0xff4a5a];

/** Sign materials, each with its own flicker. */
function signs(count: number, vertical: boolean, seed: number): MeshBasicMaterial[] {
  // Only one sign in three flickers; the others hold steady.
  return Array.from({ length: count }, (_, i) => {
    const m = new MeshBasicMaterial({ map: alienSign(seed + i, NEON[i % NEON.length], vertical), side: DoubleSide });
    return i % 3 === 0 ? flicker(m, 'buzz', seed + i * 1.37) : m;
  });
}

/** Metal grating for walkways: a grid of dark slots in steel. */
function grating(): MeshStandardMaterial {
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#4a505a';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#16181d';
  for (let y = 2; y < 64; y += 8) for (let x = 2; x < 64; x += 8) g.fillRect(x, y, 6, 5);
  return new MeshStandardMaterial({ map: texture(c, true), roughness: 0.55, metalness: 0.7 });
}

/**
 * The dead city round the battlefield (after SC2's platform maps): round industrial towers with bands of light and
 * square towers stepping back as they rise, broken at the top, rising out of the void beyond the map's edges;
 * grated walkways with edge lights reach from the platforms to some of them, and flying traffic streams past.
 * Towers between the camera and the map (south and east) stop below the decks, so they never hide the game.
 */
export function cityScape(width: number, height: number, deck: number): Group {
  const city = new Group();
  city.userData.noPick = true;
  const b = new Batch();
  const rand = rng(4242);
  const steel = new MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.6, metalness: 0.7 });
  const darkSteel = new MeshStandardMaterial({ color: 0x1e2128, roughness: 0.7, metalness: 0.6 });
  const rail = new MeshStandardMaterial({ color: 0x5a606a, roughness: 0.5, metalness: 0.8 });
  const grate = grating();
  const bands = [0xffb04a, 0xdfe8ff, 0x2ee8ff].map((c) => new MeshBasicMaterial({ color: c }));
  const beacon = flicker(new MeshBasicMaterial({ color: 0xff3020 }), 'blink', 0.3);
  const beaconGlow = flicker(glow(0xff3020, 0.9), 'blink', 0.3);
  const edgeLight = flicker(new MeshBasicMaterial({ color: 0xffc060 }), 'buzz', 71);
  const facades = [1, 2, 3, 4, 5].map(facade);
  const vSigns = signs(5, true, 20);
  const hSigns = signs(5, false, 40);
  const halos = NEON_HEX.map((c) => glow(c, 0.55));

  const spots: [number, number, number, number][] = []; // x, z, edge x, edge z (where a walkway may start)
  for (let t = 6; t < width; t += 9 + rand() * 6) spots.push([t, -5 - rand() * 8, t, 0], [t, height + 5 + rand() * 8, t, height]);
  for (let t = 6; t < height; t += 9 + rand() * 6) spots.push([-5 - rand() * 8, t, 0, t], [width + 5 + rand() * 8, t, width, t]);
  // A second, farther row on the far sides (north and west), for depth.
  for (let t = 0; t < width + 20; t += 7 + rand() * 6) spots.push([t - 10, -18 - rand() * 10, NaN, NaN]);
  for (let t = 0; t < height + 20; t += 7 + rand() * 6) spots.push([-18 - rand() * 10, t - 10, NaN, NaN]);

  const base = -30;
  for (const [x, z, ex, ez] of spots) {
    const front = x > width || z > height;
    const far = Number.isNaN(ex);
    const top = front ? -1.5 - rand() * 4 : (far ? 10 : 4) + rand() * 20;
    const h = top - base;
    // Face turned towards the map: where signs hang.
    const toward = x < 0 ? Math.PI / 2 : x > width ? -Math.PI / 2 : z < 0 ? 0 : Math.PI;
    let face: number; // distance from the axis to that face
    if (rand() < 0.45) {
      // Round industrial tower: a drum of windows ringed by bands of light, a heavy cap.
      const r = 1.3 + rand() * 1.4;
      face = r;
      const body = new CylinderGeometry(r, r, h, 18, 1, true);
      const uv = body.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ((Math.PI * 2 * r) / FACADE_U), uv.getY(i) * (h / FACADE_V));
      b.add(body, facades[Math.floor(rand() * facades.length)], x, (top + base) / 2, z);
      const step = 2.5 + rand() * 2;
      const band = bands[Math.floor(rand() * bands.length)];
      for (let y = top - 0.8; y > base + 4; y -= step) b.add(new CylinderGeometry(r + 0.06, r + 0.06, 0.16, 18, 1, true), rand() < 0.2 ? darkSteel : band, x, y, z);
      for (let y = top - 2; y > base + 4; y -= step * 2) b.add(new CylinderGeometry(r + 0.18, r + 0.18, 0.35, 18), darkSteel, x, y, z);
      b.add(new CylinderGeometry(r + 0.2, r + 0.25, 0.6, 18), darkSteel, x, top + 0.3, z);
      b.add(new CylinderGeometry(r * 0.6, r * 0.75, 0.5, 14), steel, x, top + 0.85, z);
      // Radial ribs on the cap, as on SC2's fuel towers.
      for (let k = 0; k < 6; k++) b.add(new BoxGeometry(0.1, 0.15, r * 1.5), rail, x, top + 1.15, z, (k * Math.PI) / 6);
      if (!front) b.add(new CylinderGeometry(0.05, 0.08, 2 + rand() * 4, 5), rail, x + r * 0.4, top + 2, z);
    } else {
      // Square tower stepping back in tiers, ledges at each setback, rooftop plant, broken girders.
      let w = 2.5 + rand() * 3;
      let d = 2.5 + rand() * 3;
      face = d / 2;
      const tiers = front ? 1 : 1 + Math.floor(rand() * 3);
      let y0 = base;
      const mat = facades[Math.floor(rand() * facades.length)];
      for (let k = 0; k < tiers; k++) {
        const y1 = k === tiers - 1 ? top : y0 + (top - y0) * (0.55 + rand() * 0.2);
        const th = y1 - y0;
        b.add(boxUv(new BoxGeometry(w, th, d), w, th, d, FACADE_U, FACADE_V), mat, x, (y0 + y1) / 2, z);
        b.add(new BoxGeometry(w + 0.2, 0.25, d + 0.2), darkSteel, x, y1 + 0.12, z);
        if (rand() < 0.5) b.add(new BoxGeometry(w + 0.04, 0.12, d + 0.04), bands[Math.floor(rand() * bands.length)], x, y1 - 0.3, z);
        y0 = y1;
        if (k < tiers - 1) {
          w *= 0.65 + rand() * 0.15;
          d *= 0.65 + rand() * 0.15;
        }
      }
      if (!front) {
        for (let k = 0; k < 2 + Math.floor(rand() * 3); k++) {
          b.add(new BoxGeometry(0.4 + rand() * 0.6, 0.4 + rand() * 0.4, 0.4 + rand() * 0.6), steel, x + (rand() - 0.5) * w * 0.6, top + 0.45, z + (rand() - 0.5) * d * 0.6);
        }
        if (rand() < 0.5) b.add(new CylinderGeometry(0.35, 0.35, 0.8, 10), rail, x + w * 0.25, top + 0.65, z - d * 0.2);
        for (let k = 0; k < 3; k++) {
          b.add(new BoxGeometry(0.12, 1.5 + rand() * 2.5, 0.12), rail, x + (rand() - 0.5) * w, top + 1, z + (rand() - 0.5) * d, 0, (rand() - 0.5) * 0.6, (rand() - 0.5) * 0.6);
        }
        if (rand() < 0.6) b.add(new CylinderGeometry(0.04, 0.06, 3 + rand() * 4, 5), rail, x, top + 2.5, z);
      }
    }
    if (!front) {
      // Aircraft warning light on top.
      b.add(new BoxGeometry(0.2, 0.2, 0.2), beacon, x, top + 1.6, z);
      b.add(new PlaneGeometry(1.6, 1.6), beaconGlow, x, top + 1.6, z, Math.PI / 4);
      // Signs on the face turned to the battlefield: a tall vertical one, or a big billboard.
      const fx = x + Math.sin(toward) * (face + 0.12);
      const fz = z + Math.cos(toward) * (face + 0.12);
      const pick = rand();
      if (pick < 0.55) {
        const i = Math.floor(rand() * vSigns.length);
        const sh = 2.5 + rand() * 2.5;
        const y = top - sh / 2 - 1 - rand() * 6;
        b.add(new PlaneGeometry(sh * 0.3, sh), vSigns[i], fx, y, fz, toward);
        b.add(new PlaneGeometry(sh * 0.9, sh * 1.4), halos[i % halos.length], fx + Math.sin(toward) * 0.05, y, fz + Math.cos(toward) * 0.05, toward);
      } else if (pick < 0.8) {
        const i = Math.floor(rand() * hSigns.length);
        const y = top - 2.5 - rand() * 8;
        b.add(new PlaneGeometry(3.6, 1.35), hSigns[i], fx, y, fz, toward);
        b.add(new PlaneGeometry(6, 3), halos[i % halos.length], fx + Math.sin(toward) * 0.05, y, fz + Math.cos(toward) * 0.05, toward);
      }
    }
    // Grated walkways reach from the platforms to some towers, a few broken off halfway.
    if (!far && rand() > 0.45) {
      const len = Math.hypot(x - ex, z - ez) - face;
      const reach = rand() > 0.75 ? len * (0.4 + rand() * 0.3) : len;
      const yaw = Math.atan2(x - ex, z - ez);
      const dx = Math.sin(yaw);
      const dz = Math.cos(yaw);
      const at = (s: number, side: number, y = 0): [number, number, number] => [ex + dx * s + dz * side, deck + y, ez + dz * s - dx * side];
      const plank = boxUv(new BoxGeometry(1.4, 0.12, reach), 1.4, 0.12, reach, 1, 1);
      b.add(plank, grate, ...at(reach / 2, 0, -0.06), yaw);
      for (const side of [-0.7, 0.7]) {
        b.add(new BoxGeometry(0.06, 0.06, reach), rail, ...at(reach / 2, side, 0.55), yaw);
        b.add(new BoxGeometry(0.1, 0.16, reach), darkSteel, ...at(reach / 2, side, -0.1), yaw);
        for (let k = 0.3; k < reach; k += 1.2) {
          b.add(new BoxGeometry(0.05, 0.55, 0.05), rail, ...at(k, side, 0.28));
          b.add(new BoxGeometry(0.08, 0.05, 0.08), edgeLight, ...at(k, side, 0.03));
        }
      }
      // Trusses under the walkway, down to a crossbeam every few metres.
      for (let k = 1.5; k < reach; k += 3) {
        b.add(new BoxGeometry(1.4, 0.15, 0.15), darkSteel, ...at(k, 0, -0.6), yaw);
        for (const side of [-0.6, 0.6]) b.add(new BoxGeometry(0.08, 0.6, 0.08), darkSteel, ...at(k, side, -0.35));
      }
    }
  }
  b.into(city);
  // Flying traffic past the far sides and through the void.
  city.add(traffic([[-40, -4], [width + 40, -4]], 2, 3), traffic([[width + 40, -9], [-40, -9]], 6, 4));
  city.add(traffic([[-4, height + 40], [-4, -40]], 0.5, 3), traffic([[-11, -40], [-11, height + 40]], 4, 4));
  return city;
}

/** Flying cars streaming along a lane (two points, at height y): dark hulls with head and tail lights. */
function traffic(lane: [[number, number], [number, number]], y: number, count: number): Group {
  const g = new Group();
  const [[x0, z0], [x1, z1]] = lane;
  const len = Math.hypot(x1 - x0, z1 - z0);
  const yaw = Math.atan2(x1 - x0, z1 - z0);
  const hull = new MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.4, metalness: 0.8 });
  const head = new MeshBasicMaterial({ color: 0xfff0d0 });
  const tail = new MeshBasicMaterial({ color: 0xff3030 });
  const halo = glow(0xffe0b0, 0.7);
  const rand = rng(Math.floor(x0 * 13 + z0 * 7 + y * 3) + 99);
  for (let i = 0; i < count; i++) {
    const car = new Group();
    car.add(new Mesh(new BoxGeometry(0.5, 0.18, 1.0), hull));
    const cab = new Mesh(new BoxGeometry(0.4, 0.14, 0.45), hull);
    cab.position.set(0, 0.14, -0.05);
    car.add(cab);
    const h = new Mesh(new BoxGeometry(0.4, 0.06, 0.04), head);
    h.position.z = 0.51;
    const t = new Mesh(new BoxGeometry(0.4, 0.06, 0.04), tail);
    t.position.z = -0.51;
    const hl = new Mesh(new PlaneGeometry(1.2, 1.2), halo);
    hl.position.z = 0.7;
    hl.rotation.x = -Math.PI / 2;
    car.add(h, t, hl);
    car.rotation.y = yaw;
    const speed = 3 + rand() * 3;
    const phase = rand() * len;
    const bob = rand() * 6;
    const lift = (rand() - 0.5) * 1.2;
    // Moves itself before each draw: no hook in the game loop needed.
    car.children[0].onBeforeRender = () => {
      const now = performance.now() / 1000;
      const s = (phase + now * speed) % len;
      car.position.set(x0 + ((x1 - x0) * s) / len, y + lift + Math.sin(now * 0.8 + bob) * 0.15, z0 + ((z1 - z0) * s) / len);
    };
    car.position.set(x0 + ((x1 - x0) * phase) / len, y + lift, z0 + ((z1 - z0) * phase) / len);
    car.traverse((o) => (o.userData.noPick = true));
    g.add(car);
  }
  // The cars move: keep them drawn (their bounding spheres would be tested at the old place).
  g.traverse((o) => (o.frustumCulled = false));
  return g;
}

/** Concrete of a parking deck: stains and oil, and on 'stall' a painted bay line. */
function parkingFloor(seed: number, stall: boolean, shade = 1): MeshStandardMaterial {
  const [c, g] = canvas(64, 64);
  const rand = rng(seed);
  g.fillStyle = '#464950';
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = rand() > 0.5 ? '#3c3f46' : '#51545b';
    g.fillRect(rand() * 64, rand() * 64, 2, 2);
  }
  g.globalAlpha = 0.5;
  g.fillStyle = '#25272c';
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.ellipse(rand() * 64, rand() * 64, 4 + rand() * 8, 3 + rand() * 5, rand() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  if (stall) {
    g.fillStyle = rand() > 0.5 ? '#c8c2a8' : '#c9a23a';
    g.fillRect(1, 4, 3, 56);
    g.fillRect(4, 58, 18, 3);
  }
  return new MeshStandardMaterial({ map: texture(c, true), color: new Color().setRGB(shade, shade, shade * 1.08, SRGBColorSpace), roughness: 0.9 });
}

/** Black and yellow hazard stripes for slab edges. */
function hazardStripes(): MeshStandardMaterial {
  const [c, g] = canvas(64, 16);
  g.fillStyle = '#1a1a1c';
  g.fillRect(0, 0, 64, 16);
  g.fillStyle = '#c9a020';
  for (let x = -16; x < 64; x += 16) {
    g.beginPath();
    g.moveTo(x, 16);
    g.lineTo(x + 8, 0);
    g.lineTo(x + 16, 0);
    g.lineTo(x + 8, 16);
    g.fill();
  }
  return new MeshStandardMaterial({ map: texture(c), roughness: 0.8 });
}

/** Shop floor or mall paving: square tiles. */
function tileFloor(shade: number): MeshStandardMaterial {
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#5a5650';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#3a3834';
  for (let k = 0; k < 64; k += 16) {
    g.fillRect(k, 0, 1, 64);
    g.fillRect(0, k, 64, 1);
  }
  return new MeshStandardMaterial({ map: texture(c, true), color: new Color().setRGB(shade, shade, shade, SRGBColorSpace), roughness: 0.4, metalness: 0.2 });
}

/** What a storey of the lower city holds, seen through its open front onto the chasm. */
type Storey = 'shops' | 'glass' | 'parking';

/**
 * The lower city under the chasms: storeys of the megacity, stacked. Each level is a plain slab whose opening
 * shrinks with depth, so from above every level shows one clean band, darker the deeper it is. A storey is a
 * row of shops (lit windows, awnings, signs), an office floor behind a glass wall, or a car park; the bottom
 * deck is a street. Built per chasm on its bounding rectangle; the slabs reach on under the playable deck.
 * Render only.
 */
export function cityUnderdeck(map: { width: number; height: number; chasm?: Uint8Array }, deck: number): Group {
  const under = new Group();
  under.userData.noPick = true;
  const chasm = map.chasm;
  if (!chasm) return under;
  const W = map.width;
  const H = map.height;
  const b = new Batch();
  const rand = rng(777);
  const LEVELS = 4;
  const floors = Array.from({ length: LEVELS }, (_, k) => (deck * (k + 1)) / LEVELS); // slab tops, top to bottom
  const SLAB = 0.25;
  const STEP = 1.4; // how much wider each level's opening is than the one below
  const MARGIN = 2.5; // how far the slabs reach under the playable deck

  // The chasms, as bounding rectangles of their connected tiles.
  const seen = new Uint8Array(W * H);
  const holes: [number, number, number, number][] = [];
  for (let i = 0; i < W * H; i++) {
    if (!chasm[i] || seen[i]) continue;
    let [x0, y0, x1, y1] = [W, H, 0, 0];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % W;
      const y = (j / W) | 0;
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = (y + dy) * W + x + dx;
        if (x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H && chasm[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    holes.push([x0, y0, x1 + 1, y1 + 1]);
  }

  // The deeper the level, the darker everything on it, lights included (the decks above shade it).
  const DEPTH_LIGHT = [1, 0.5, 0.25, 0.12];
  const SHADE = [0.4, 0.2, 0.1, 0.05];
  const mats = DEPTH_LIGHT.map((f, k) => {
    const lit = (hex: number) => new Color(hex).multiplyScalar(f);
    const stripes = hazardStripes();
    stripes.color.setScalar(Math.max(f, 0.2));
    return {
      concrete: new MeshStandardMaterial({ color: lit(0x34363c), roughness: 0.9 }),
      back: new MeshStandardMaterial({ color: lit(0x1c1e24), roughness: 0.9 }),
      steel: new MeshStandardMaterial({ color: lit(0x5a606a), roughness: 0.4, metalness: 0.8 }),
      stripes,
      parkingFloor: parkingFloor(k * 10 + 4, true, SHADE[k]),
      shopFloor: tileFloor(SHADE[k] * 1.2),
      street: parkingFloor(k * 10 + 1, false, SHADE[k]),
      glassWall: new MeshStandardMaterial({ color: lit(0x1a2a3a), roughness: 0.12, metalness: 0.9, emissive: lit(0x0a1824) }),
      office: new MeshBasicMaterial({ color: lit(0xcfe6ff) }),
      shops: [0xffc870, 0xff6ad8, 0x6ae8ff, 0xffe0b0].map((c) => new MeshBasicMaterial({ color: lit(c) })),
      awnings: [0x8a2a3a, 0x2a5a6a, 0x6a5a2a].map((c) => new MeshStandardMaterial({ color: lit(c), roughness: 0.8 })),
      dead: new MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.2, metalness: 0.6 }),
      pools: [0xffb060, 0xff6ad8, 0x6ae8ff, 0xffe0b0].map((c) => glow(c, 0.5 * f)),
      tube: new MeshBasicMaterial({ color: lit(0xdfffff) }),
      paints: [0x6a2a2a, 0x2a3a5a, 0x7a7468, 0x2a2c30].map((c) => new MeshStandardMaterial({ color: lit(c), roughness: 0.5, metalness: 0.6 })),
      signs: signs(3, false, 60 + k * 3).map((m) => (m.color.setScalar(f), (m.userData.flicker?.base as Color | undefined)?.setScalar(f), m)),
    };
  });
  const TYPES: Storey[] = ['shops', 'glass', 'parking'];

  /** The four sides of a rectangle (half sizes a, c round cx, cz), each with its inward normal. */
  const sides = (cx: number, cz: number, a: number, c: number) =>
    [
      { x: cx, z: cz - c, len: 2 * a, nx: 0, nz: 1 },
      { x: cx, z: cz + c, len: 2 * a, nx: 0, nz: -1 },
      { x: cx - a, z: cz, len: 2 * c, nx: 1, nz: 0 },
      { x: cx + a, z: cz, len: 2 * c, nx: -1, nz: 0 },
    ].map((s) => ({ ...s, yaw: Math.atan2(s.nx, s.nz), along: s.nz !== 0 }));
  /** A box laid along a side: `l` along it, `d` across it, `h` tall, at offset t along and `o` inwards. */
  const along = (s: ReturnType<typeof sides>[number], l: number, h: number, d: number, m: Material, t: number, y: number, o = 0) => {
    const px = s.x + (s.along ? t : 0) + s.nx * o;
    const pz = s.z + (s.along ? 0 : t) + s.nz * o;
    b.add(new BoxGeometry(s.along ? l : d, h, s.along ? d : l), m, px, y, pz);
  };

  holes.forEach(([x0, y0, x1, y1], n) => {
    const cx = (x0 + x1) / 2;
    const cz = (y0 + y1) / 2;
    const hx = (x1 - x0) / 2;
    const hz = (y1 - y0) / 2;
    const A = hx + MARGIN;
    const C = hz + MARGIN;
    for (let k = 0; k < LEVELS; k++) {
      const M = mats[k];
      const top = floors[k];
      const ceiling = k === 0 ? -DECK_SLAB : floors[k - 1] - SLAB;
      const storey = ceiling - top;
      const bottom = k === LEVELS - 1;
      const type = bottom ? 'street' : TYPES[(k + n) % TYPES.length];
      // Opening of this level, and of the one above (where this storey's front stands).
      const a = bottom ? 0 : hx - STEP * (k + 1);
      const c = bottom ? 0 : hz - STEP * (k + 1);
      const pa = hx - STEP * k;
      const pc = hz - STEP * k;
      const floorMat = type === 'shops' ? M.shopFloor : type === 'parking' ? M.parkingFloor : M.street;
      // The slab: a frame round the opening (or a whole deck at the bottom).
      const slab = (w: number, d: number, x: number, z: number) => b.add(boxUv(new BoxGeometry(w, SLAB, d), w, SLAB, d, 1, 1), floorMat, x, top - SLAB / 2, z);
      if (bottom) slab(2 * A, 2 * C, cx, cz);
      else {
        slab(2 * A, C - c, cx, cz - (C + c) / 2);
        slab(2 * A, C - c, cx, cz + (C + c) / 2);
        slab(A - a, 2 * c, cx - (A + a) / 2, cz);
        slab(A - a, 2 * c, cx + (A + a) / 2, cz);
        // Its edge onto the opening: a plain fascia, hazard-striped on a car park.
        for (const s of sides(cx, cz, a, c)) along(s, s.len, SLAB + 0.04, 0.05, type === 'parking' ? M.stripes : M.steel, 0, top - SLAB / 2, -0.02);
      }
      // The storey's front, set back under the slab above, facing the chasm.
      for (const s of sides(cx, cz, pa + 0.3, pc + 0.3)) {
        const half = s.len / 2;
        along(s, s.len + 0.6, storey, 0.1, M.back, 0, top + storey / 2, -0.4);
        if (type === 'shops') {
          // A row of shopfronts: lit windows (some dead), awnings, a sign over some.
          for (let t = -half + 0.9; t < half - 0.7; t += 1.7) {
            const lit = rand() > 0.25;
            const i = Math.floor(rand() * M.shops.length);
            along(s, 1.4, storey * 0.62, 0.04, lit ? M.shops[i] : M.dead, t, top + storey * 0.34, -0.3);
            along(s, 0.1, storey, 0.1, M.steel, t + 0.8, top + storey / 2, -0.25);
            if (rand() < 0.6) along(s, 1.4, 0.04, 0.35, M.awnings[Math.floor(rand() * M.awnings.length)], t, top + storey * 0.7, -0.1);
            if (lit) b.add(new PlaneGeometry(1.6, 1.2), M.pools[i], s.x + (s.along ? t : 0) + s.nx * 0.5, top + 0.02, s.z + (s.along ? 0 : t) + s.nz * 0.5, 0, -Math.PI / 2);
            if (rand() < 0.3) {
              const p = s.along ? [s.x + t, s.z + s.nz * -0.27] : [s.x + s.nx * -0.27, s.z + t];
              b.add(new PlaneGeometry(1.1, 0.3), M.signs[Math.floor(rand() * M.signs.length)], p[0], top + storey * 0.85, p[1], s.yaw);
            }
          }
        } else if (type === 'glass') {
          // An office floor behind a glass wall: mullions, a few panels still lit.
          along(s, s.len, storey - 0.05, 0.05, M.glassWall, 0, top + storey / 2, -0.25);
          for (let t = -half; t <= half; t += 0.8) along(s, 0.05, storey, 0.08, M.steel, t, top + storey / 2, -0.22);
          for (let t = -half + 0.4; t < half; t += 0.8) if (rand() < 0.3) along(s, 0.7, storey * 0.5, 0.02, M.office, t, top + storey * 0.5, -0.21);
        } else if (type === 'parking') {
          // A car park: pillars along the front, strip lights, cars nosed in.
          for (let t = -half + 0.5; t < half; t += 2) along(s, 0.25, storey, 0.25, M.concrete, t, top + storey / 2, 0);
          for (let t = -half + 1.5; t < half - 0.5; t += 2) if (rand() < 0.5) along(s, 0.7, 0.05, 0.08, M.tube, t, ceiling - 0.1, 0.3);
        }
      }
      // Cars on the band of floor this level shows (car park and street), parked along the front.
      if (type === 'parking' || type === 'street') {
        for (const s of sides(cx, cz, pa - 0.4, pc - 0.4)) {
          for (let t = -s.len / 2 + 0.6; t < s.len / 2 - 0.6; t += 0.7) {
            if (rand() > (type === 'parking' ? 0.45 : 0.2)) continue;
            const yaw = s.yaw + (type === 'parking' ? 0 : Math.PI / 2) + (rand() - 0.5) * 0.15;
            const px = s.x + (s.along ? t : 0);
            const pz = s.z + (s.along ? 0 : t);
            b.add(new BoxGeometry(0.42, 0.16, 0.78), M.paints[Math.floor(rand() * M.paints.length)], px, top + 0.1, pz, yaw);
            b.add(new BoxGeometry(0.36, 0.13, 0.4), M.dead, px, top + 0.24, pz, yaw);
          }
        }
      }
      if (bottom) {
        // The street at the bottom: a few pools of light.
        for (let p = 0; p < 4; p++) b.add(new PlaneGeometry(2.4, 2.4), M.pools[p], cx + (rand() - 0.5) * hx, top + 0.02, cz + (rand() - 0.5) * hz, 0, -Math.PI / 2);
      }
    }
  });
  return b.into(under);
}

/**
 * Street furniture of the dead city on the playable decks (render only, never in the way): railings along the
 * chasms and the map's edge, street lamps with their pools of light, benches, bollards and broken neon signs
 * in alien scripts. Nothing tall along the south and east edges, where it would stand between camera and game.
 */
export function cityStreets(map: { width: number; height: number; chasm?: Uint8Array; level: Uint8Array }, heightAt: (x: number, z: number) => number): Group {
  const streets = new Group();
  streets.userData.noPick = true;
  if (!map.chasm) return streets;
  const b = new Batch();
  const metal = new MeshStandardMaterial({ color: 0x4a505a, roughness: 0.5, metalness: 0.8 });
  const dark = new MeshStandardMaterial({ color: 0x1c1f26, roughness: 0.8 });
  const bulbs = [new MeshBasicMaterial({ color: 0xffd9a0 }), flicker(new MeshBasicMaterial({ color: 0xffd9a0 }), 'buzz', 12.1), new MeshBasicMaterial({ color: 0x9ae8ff })];
  const pools = [glow(0xffb060, 0.5), flicker(glow(0xffb060, 0.5), 'buzz', 12.1), glow(0x7ad8ff, 0.45)];
  const boards = signs(8, false, 1);
  const halos = NEON_HEX.map((c) => glow(c, 0.5));
  const stripe = flicker(new MeshBasicMaterial({ color: 0x2ee8ff }), 'buzz', 17.5);
  const rand = rng(31337);
  const chasm = (x: number, y: number) => x >= 0 && y >= 0 && x < map.width && y < map.height && map.chasm![y * map.width + x] === 1;
  const outside = (x: number, y: number) => x < 0 || y < 0 || x >= map.width || y >= map.height;
  const put = (geo: BufferGeometry, m: Material, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) => b.add(geo, m, x, heightAt(x, z) + y, z, ry, rx, rz);

  let n = 0;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (chasm(x, y)) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const edgeOfMap = outside(nx, ny);
        if (!chasm(nx, ny) && !edgeOfMap) continue;
        // A railing along the drop: a post and two rails, some bent or missing.
        if (rand() < 0.12) continue;
        const ex = x + 0.5 + dx * 0.45;
        const ez = y + 0.5 + dy * 0.45;
        const along = dx === 0;
        put(new BoxGeometry(0.05, 0.5, 0.05), metal, ex, 0.25, ez);
        for (const h of [0.25, 0.48]) put(new BoxGeometry(along ? 1 : 0.03, 0.03, along ? 0.03 : 1), metal, ex, h, ez, 0, 0, rand() < 0.1 ? (rand() - 0.5) * 0.5 : 0);
        // A thin neon strip along the chasm's lip, dead in places.
        if (!edgeOfMap && rand() < 0.6) put(new BoxGeometry(along ? 1 : 0.04, 0.03, along ? 0.04 : 1), stripe, x + 0.5 + dx * 0.49, 0.02, y + 0.5 + dy * 0.49);
        // Nothing tall on the south and east edges of the map (between the camera and the game).
        if (edgeOfMap && (dx > 0 || dy > 0)) continue;
        if (++n % 5 !== 0) continue;
        const ix = x + 0.5 - dx * 0.2;
        const iz = y + 0.5 - dy * 0.2;
        const pick = rand();
        if (pick < 0.45) {
          // Street lamp leaning out over the edge; one in five dead.
          put(new CylinderGeometry(0.03, 0.05, 1.6, 6), metal, ix, 0.8, iz);
          put(new BoxGeometry(0.4, 0.03, 0.03), metal, ix + dx * 0.15, 1.58, iz + dy * 0.15, Math.atan2(dy, -dx));
          if (rand() > 0.2) {
            const w = Math.floor(rand() * bulbs.length);
            put(new BoxGeometry(0.14, 0.05, 0.14), bulbs[w], ix + dx * 0.3, 1.54, iz + dy * 0.3);
            put(new PlaneGeometry(2.2, 2.2), pools[w], ix + dx * 0.2, 0.03, iz + dy * 0.2, 0, -Math.PI / 2);
          }
        } else if (pick < 0.65) {
          // Bench with its back to the drop, a bollard beside it.
          put(new BoxGeometry(along ? 0.7 : 0.25, 0.06, along ? 0.25 : 0.7), dark, ix, 0.22, iz);
          put(new BoxGeometry(along ? 0.7 : 0.04, 0.22, along ? 0.04 : 0.7), dark, ix + dx * 0.11, 0.36, iz + dy * 0.11);
          for (const s of [-0.28, 0.28]) put(new BoxGeometry(0.05, 0.2, 0.05), metal, ix + (along ? s : 0), 0.1, iz + (along ? 0 : s));
          put(new CylinderGeometry(0.06, 0.07, 0.35, 8), metal, ix + (along ? 0.55 : 0), 0.17, iz + (along ? 0 : 0.55));
        } else {
          // A broken neon sign on its post, askew, facing the street.
          put(new CylinderGeometry(0.03, 0.03, 1.2, 6), metal, ix, 0.6, iz);
          const i = Math.floor(rand() * boards.length);
          const yaw = Math.atan2(-dx, -dy);
          put(new PlaneGeometry(0.9, 0.34), boards[i], ix, 1.35, iz, yaw, 0, (rand() - 0.5) * 0.25);
          put(new PlaneGeometry(1.8, 0.9), halos[i % halos.length], ix + dx * 0.03, 1.35, iz + dy * 0.03, yaw);
        }
      }
    }
  }
  return b.into(streets);
}

/** Pixels per tile in the street map. */
const ROAD_PX = 8;

/**
 * Streets of the city, painted on the decks: the ways a player walks (headquarters to natural expansion, to the
 * centre, and from one expansion to the next), found on the walking grid, kept off cliff edges and mineral fields,
 * smoothed into curves. A texture over the whole map: red = asphalt, green = dashed centre line, blue = edge lines.
 * Also returns the street centre lines (tile units), for the props along them. Render only: the simulation never sees it.
 */
export function cityRoads(world: World): { texture: CanvasTexture; streets: [number, number][][] } {
  const map = world.map;
  const W = map.width;
  const H = map.height;
  const grid = new Grid(map);
  // Extra cost near drops (a street keeps off the edge) and round resources.
  const penalty = new Float32Array(W * H);
  const level = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H || map.chasm?.[y * W + x] ? -1 : map.ramp[y * W + x] ? -2 : map.level[y * W + x]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const l = level(x, y);
      if (l === -2) continue; // ramps: the way up
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (level(x + dx, y + dy) !== l && level(x + dx, y + dy) !== -2) penalty[y * W + x] = Math.max(penalty[y * W + x], 3 - Math.max(Math.abs(dx), Math.abs(dy)));
    }
  }
  for (const e of world.entities.values()) {
    if (e.def.kind !== 'resource') continue;
    for (let dy = -3; dy <= 4; dy++) for (let dx = -3; dx <= 4; dx++) if (e.tx + dx >= 0 && e.ty + dy >= 0 && e.tx + dx < W && e.ty + dy < H) penalty[(e.ty + dy) * W + e.tx + dx] += 6;
  }

  /** Cheapest walk from a to b (8 neighbours), as tile centres. */
  const route = ([ax, ay]: [number, number], [bx, by]: [number, number]): [number, number][] => {
    // Doubles: costs compared in float32 round differently each way and the search never settles.
    const cost = new Float64Array(W * H).fill(Infinity);
    const from = new Int32Array(W * H).fill(-1);
    const heap: [number, number][] = [];
    const push = (i: number, c: number) => {
      heap.push([c, i]);
      for (let k = heap.length - 1; k > 0; ) {
        const p = (k - 1) >> 1;
        if (heap[p][0] <= heap[k][0]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let k = 0; ; ) {
          const l = 2 * k + 1;
          const r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    const start = ay * W + ax;
    const goal = by * W + bx;
    cost[start] = 0;
    push(start, 0);
    while (heap.length) {
      const [c, i] = pop();
      if (i === goal) break;
      if (c > cost[i]) continue;
      const x = i % W;
      const y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || !grid.canStep(x, y, x + dx, y + dy)) continue;
          const j = (y + dy) * W + x + dx;
          const nc = c + (dx && dy ? 1.414 : 1) * (1 + penalty[j]);
          if (nc < cost[j]) {
            cost[j] = nc;
            from[j] = i;
            push(j, nc);
          }
        }
      }
    }
    const path: [number, number][] = [];
    for (let i = goal; i >= 0; i = from[i]) path.unshift([(i % W) + 0.5, ((i / W) | 0) + 0.5]);
    return path[0] && path[0][0] === ax + 0.5 && path[0][1] === ay + 0.5 ? path : [];
  };

  /** Fewer points, then corners cut twice (Chaikin), so the street curves. */
  const smooth = (path: [number, number][]): [number, number][] => {
    let p = path.filter((_, i) => i % 3 === 0 || i === path.length - 1);
    for (let it = 0; it < 3; it++) {
      const q: [number, number][] = [p[0]];
      for (let i = 0; i < p.length - 1; i++) {
        const [x0, y0] = p[i];
        const [x1, y1] = p[i + 1];
        q.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25], [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
      }
      q.push(p[p.length - 1]);
      p = q;
    }
    return p;
  };

  const hq = new Map<number, [number, number]>();
  for (const e of world.entities.values()) {
    if (e.def.kind === 'building' && (e.def as { dropoff?: boolean }).dropoff && !hq.has(e.owner)) {
      const half = Math.floor((e.def as { size: number }).size / 2);
      hq.set(e.owner, [e.tx + half, e.ty + half]);
    }
  }
  const players = world.players.map((p) => p.id);
  const nat = players.map((id) => {
    const [tx, ty] = expansion(world, id);
    return [tx + 2, ty + 2] as [number, number];
  });
  const centre: [number, number] = [Math.floor(W / 2), Math.floor(H / 2)];
  const ways: [number, number][][] = [];
  players.forEach((id, i) => {
    const home = hq.get(id);
    if (home) ways.push(route(home, nat[i]));
    ways.push(route(nat[i], centre));
    if (players.length > 1) ways.push(route(nat[i], nat[(i + 1) % players.length]));
  });

  const streets = ways.filter((w) => w.length > 1).map(smooth);
  const layer = (draw: (g: CanvasRenderingContext2D) => void) => {
    const [c, g] = canvas(W * ROAD_PX, H * ROAD_PX);
    g.scale(ROAD_PX, ROAD_PX);
    g.lineCap = g.lineJoin = 'round';
    g.strokeStyle = '#fff';
    for (const way of streets) {
      g.beginPath();
      g.moveTo(...way[0]);
      for (const p of way) g.lineTo(...p);
      draw(g);
    }
    return g.getImageData(0, 0, c.width, c.height).data;
  };
  const asphalt = layer((g) => ((g.lineWidth = 2.6), g.stroke()));
  const edges = layer((g) => {
    g.lineWidth = 2.3;
    g.stroke();
    g.globalCompositeOperation = 'destination-out';
    g.lineWidth = 2.05;
    g.stroke();
    g.globalCompositeOperation = 'source-over';
  });
  const dashes = layer((g) => {
    g.lineWidth = 0.12;
    g.lineCap = 'butt';
    g.setLineDash([0.7, 0.6]);
    g.stroke();
  });
  const inner = layer((g) => ((g.lineWidth = 2.05), g.stroke()));
  const [out, o] = canvas(W * ROAD_PX, H * ROAD_PX);
  const img = o.createImageData(out.width, out.height);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = asphalt[i + 3];
    img.data[i + 1] = dashes[i + 3];
    // Where streets meet, one's edge line must not cut across the other's asphalt.
    img.data[i + 2] = inner[i + 3] > 128 ? 0 : edges[i + 3];
    img.data[i + 3] = 255;
  }
  o.putImageData(img, 0, 0);
  const t = new CanvasTexture(out);
  t.flipY = false;
  t.colorSpace = NoColorSpace;
  return { texture: t, streets };
}
