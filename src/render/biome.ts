import { Color } from 'three';

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
