import { AdditiveBlending, CanvasTexture, Color, Mesh, MeshBasicMaterial, PlaneGeometry, RepeatWrapping, SRGBColorSpace } from 'three';

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
  },
  // An abandoned megacity: decks of riveted plates over a void, neon in the seams, rain-dark steel.
  ville: {
    id: 'ville',
    name: 'Ville futuriste',
    levels: [new Color(0x3a404a), new Color(0x4a505a), new Color(0x5a606a)],
    patch: new Color(0x23272e),
    sand: new Color(0x6a6f78),
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
