import { AdditiveBlending, BoxGeometry, CanvasTexture, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, RepeatWrapping, SRGBColorSpace } from 'three';

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

/** Facade of an abandoned tower: rows of dark windows, a few still lit, some broken, stains running down. */
function facade(seed: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  let r = seed * 7919 + 13;
  const rand = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  g.fillStyle = '#2a2d34';
  g.fillRect(0, 0, 64, 256);
  for (let y = 4; y < 256; y += 10) {
    for (let x = 3; x < 64; x += 8) {
      const v = rand();
      g.fillStyle = v > 0.94 ? '#ffd27a' : v > 0.9 ? '#7ae8ff' : v > 0.75 ? '#0a0b0e' : '#15171c';
      g.fillRect(x, y, 5, 6);
    }
  }
  g.globalAlpha = 0.35;
  for (let i = 0; i < 12; i++) {
    g.fillStyle = '#0c0d10';
    g.fillRect(rand() * 64, rand() * 128, 2 + rand() * 4, 40 + rand() * 120);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * The dead city round the battlefield: towers rising out of the void beyond the map's edges, broken at the top,
 * with antennas and a few lit windows, and walkways reaching from the platforms' edge across the void to them.
 */
export function cityScape(width: number, height: number, deck: number): Group {
  const city = new Group();
  city.userData.noPick = true;
  let r = 4242;
  const rand = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  const steel = new MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.7, metalness: 0.6 });
  const rail = new MeshStandardMaterial({ color: 0x5a606a, roughness: 0.6, metalness: 0.7 });
  const neon = [0x2ee8ff, 0xff4fd8, 0xffb04a].map((c) => new MeshBasicMaterial({ color: c }));
  const facades = [1, 2, 3, 4, 5].map((k) => new MeshStandardMaterial({ map: facade(k), emissiveMap: facade(k), emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.8 }));
  const add = (m: Mesh) => (city.add(m), m);
  // Spots round the map, beyond its edges.
  const spots: [number, number, number, number][] = []; // x, z, edge x, edge z (where a walkway may start)
  for (let t = 6; t < width; t += 9 + rand() * 6) {
    spots.push([t, -5 - rand() * 8, t, 0], [t, height + 5 + rand() * 8, t, height]);
  }
  for (let t = 6; t < height; t += 9 + rand() * 6) {
    spots.push([-5 - rand() * 8, t, 0, t], [width + 5 + rand() * 8, t, width, t]);
  }
  for (const [x, z, ex, ez] of spots) {
    const w = 2.5 + rand() * 3;
    const d = 2.5 + rand() * 3;
    // Towers between the camera and the map (south and east) stop below the decks, so they never hide the game.
    const front = x > width || z > height;
    const top = front ? -1.5 - rand() * 4 : 4 + rand() * 18;
    const base = -30;
    const tower = add(new Mesh(new BoxGeometry(w, top - base, d), facades[Math.floor(rand() * facades.length)]));
    tower.position.set(x, (top + base) / 2, z);
    // Broken crown: a stub of floors and bare girders at a slant, an antenna, a dead neon sign.
    const stub = add(new Mesh(new BoxGeometry(w * (0.4 + rand() * 0.4), 1 + rand() * 2, d * (0.4 + rand() * 0.4)), steel));
    stub.position.set(x + (rand() - 0.5) * w * 0.4, top + 0.6, z + (rand() - 0.5) * d * 0.4);
    stub.rotation.z = (rand() - 0.5) * 0.3;
    for (let k = 0; k < (front ? 0 : 3); k++) {
      const girder = add(new Mesh(new BoxGeometry(0.12, 1.5 + rand() * 2.5, 0.12), rail));
      girder.position.set(x + (rand() - 0.5) * w, top + 1, z + (rand() - 0.5) * d);
      girder.rotation.set((rand() - 0.5) * 0.6, 0, (rand() - 0.5) * 0.6);
    }
    if (!front && rand() > 0.4) {
      const antenna = add(new Mesh(new CylinderGeometry(0.04, 0.06, 3 + rand() * 4, 5), rail));
      antenna.position.set(x, top + 2.5, z);
    }
    if (!front && rand() > 0.5) {
      const sign = add(new Mesh(new BoxGeometry(0.12, 1.5 + rand(), 0.5 + rand() * 0.8), neon[Math.floor(rand() * neon.length)]));
      sign.position.set(x + (x < 0 ? w / 2 + 0.1 : x > width ? -w / 2 - 0.1 : 0), top - 2 - rand() * 4, z + (z < 0 ? d / 2 + 0.1 : z > height ? -d / 2 - 0.1 : 0));
    }
    // Some towers are still linked to the platforms by a walkway, a few of them broken off halfway.
    if (rand() > 0.45) {
      const len = Math.hypot(x - ex, z - ez);
      const reach = rand() > 0.75 ? len * (0.4 + rand() * 0.3) : len;
      const yaw = Math.atan2(x - ex, z - ez);
      const walk = new Group();
      const plank = new Mesh(new BoxGeometry(1.2, 0.12, reach), steel);
      plank.position.z = reach / 2;
      walk.add(plank);
      for (const side of [-0.6, 0.6]) {
        const bar = new Mesh(new BoxGeometry(0.05, 0.05, reach), rail);
        bar.position.set(side, 0.55, reach / 2);
        walk.add(bar);
        for (let k = 0; k < reach; k += 1.5) {
          const post = new Mesh(new BoxGeometry(0.05, 0.55, 0.05), rail);
          post.position.set(side, 0.3, k);
          walk.add(post);
        }
      }
      const strip = new Mesh(new BoxGeometry(0.06, 0.02, reach), neon[0]);
      strip.position.set(0, 0.07, reach / 2);
      walk.add(strip);
      walk.position.set(ex, deck, ez);
      walk.rotation.y = yaw;
      city.add(walk);
    }
  }
  return city;
}
