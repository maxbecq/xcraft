import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, NoColorSpace, type Texture } from 'three';

// Procedural textures, generated once at start: no image files to ship.

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Tileable value noise on a `period`-cell grid. */
function valueNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const h = (a: number, b: number) => hash(((a % period) + period) % period, ((b % period) + period) % period, seed);
  const a = h(xi, yi) + (h(xi + 1, yi) - h(xi, yi)) * u;
  const b = h(xi, yi + 1) + (h(xi + 1, yi + 1) - h(xi, yi + 1)) * u;
  return a + (b - a) * v;
}

/** Tileable fractal noise over [0,1)², in 0..1. */
export function fbm(u: number, v: number, octaves: number, base: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const p = base << o;
    sum += valueNoise(u * p, v * p, p, seed + o) * amp;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Albedo (greyscale, around 1) and normal map from a height function over a tileable square. */
function bake(size: number, height: (u: number, v: number) => number, shade: (h: number, u: number, v: number) => number, strength: number): [Texture, Texture] {
  const hmap = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) hmap[y * size + x] = height(x / size, y / size);
  const albedo = document.createElement('canvas');
  const normal = document.createElement('canvas');
  albedo.width = albedo.height = normal.width = normal.height = size;
  const a = albedo.getContext('2d')!.createImageData(size, size);
  const n = normal.getContext('2d')!.createImageData(size, size);
  const at = (x: number, y: number) => hmap[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Half-posterized: flat painted patches instead of photographic grain.
      const raw = shade(at(x, y), x / size, y / size);
      const g = Math.max(0, Math.min(255, (raw * 0.45 + (Math.round(raw * 7) / 7) * 0.55) * 200));
      a.data[i] = a.data[i + 1] = a.data[i + 2] = g;
      a.data[i + 3] = 255;
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      n.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      n.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      n.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      n.data[i + 3] = 255;
    }
  }
  albedo.getContext('2d')!.putImageData(a, 0, 0);
  normal.getContext('2d')!.putImageData(n, 0, 0);
  const tex = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new CanvasTexture(c);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.minFilter = LinearMipmapLinearFilter;
    t.anisotropy = 8;
    t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    return t;
  };
  return [tex(albedo, true), tex(normal, false)];
}

/** Dry, cracked wasteland ground with pebbles. */
/** Metal deck plates for the city: a grid of panels with seams, rivets, dents and wear. */
function plateHeight(u: number, v: number): number {
  const cells = 8;
  const fx = (u * cells) % 1;
  const fy = (v * cells) % 1;
  const seam = Math.min(fx, 1 - fx, fy, 1 - fy) < 0.025 ? -0.45 : 0;
  const rivet = [0.08, 0.92].some((a) => [0.08, 0.92].some((b) => Math.hypot(fx - a, fy - b) < 0.025)) ? 0.35 : 0;
  // Every other panel is a tread plate; wear and dents everywhere.
  const tread = (Math.floor(u * cells) + Math.floor(v * cells)) % 3 === 0 && Math.sin((u + v) * 260) > 0.6 ? 0.08 : 0;
  return seam + rivet + tread + fbm(u, v, 4, 6, 11) * 0.25 - fbm(u, v, 2, 40, 37) * 0.08;
}

export function groundTextures(style?: string): [Texture, Texture] {
  if (style === 'city') return bake(512, plateHeight, (h, u, v) => 0.7 + h * 0.35 + (fbm(u, v, 3, 5, 41) - 0.5) * 0.35, 5);
  const height = (u: number, v: number) => {
    const base = fbm(u, v, 5, 4, 11);
    const cracks = 1 - Math.min(1, Math.abs(fbm(u, v, 3, 6, 23) - 0.5) * 18);
    const pebble = fbm(u, v, 2, 48, 37);
    return base * 0.6 - cracks * 0.25 + (pebble > 0.72 ? (pebble - 0.72) * 3 : 0);
  };
  // Directional brush strokes on top of the relief.
  const shade = (h: number, u: number, v: number) => 0.84 + h * 0.3 + (fbm(u * 0.6 + v * 0.2, v * 2.2, 3, 8, 41) - 0.5) * 0.22;
  return bake(512, height, shade, 6);
}

/** White where the ground texture has cracks: used to make glowing veins on strange worlds. */
export function crackMask(style?: string): Texture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (style === 'city') {
        // Neon strips in some of the deck seams, flickering out in patches (an abandoned city).
        const fx = ((x / size) * 8) % 1;
        const fy = ((y / size) * 8) % 1;
        const seam = Math.min(fx, 1 - fx, fy, 1 - fy) < 0.012 ? 1 : 0;
        // Red: the seams. Green: broad patches where they are still lit (the shader samples it at another scale).
        img.data[i] = seam * 255;
        img.data[i + 1] = Math.min(1, Math.max(0, (fbm(x / size, y / size, 4, 2, 71) - 0.5) * 3)) * 255;
        img.data[i + 2] = 0;
        img.data[i + 3] = 255;
        continue;
      }
      const crack = 1 - Math.min(1, Math.abs(fbm(x / size, y / size, 3, 6, 23) - 0.5) * 30);
      // Red: thin cracks. Green: broad patches deciding where the cracks glow (sampled at another scale).
      img.data[i] = Math.pow(Math.max(0, crack), 2) * 255;
      img.data[i + 1] = fbm(x / size, y / size, 4, 2, 71) * 255;
      img.data[i + 2] = 0;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = NoColorSpace;
  return t;
}

/** Layered rock for cliff faces: horizontal strata broken by noise. u runs along the cliff, v up it. */
export function rockTextures(style?: string): [Texture, Texture] {
  if (style === 'city') {
    // Wall cladding: tall panels between ribs, with vents and grime streaks running down.
    const wall = (u: number, v: number) => {
      const fx = (u * 6) % 1;
      const fy = (v * 3) % 1;
      const rib = fx < 0.06 ? 0.5 : 0;
      const joint = fy < 0.03 ? -0.4 : 0;
      const vent = fx > 0.4 && fx < 0.75 && fy > 0.5 && fy < 0.8 && Math.sin(v * 3 * 40 * Math.PI) > 0 ? -0.25 : 0;
      return rib + joint + vent + fbm(u, v, 3, 8, 53) * 0.2;
    };
    return bake(512, wall, (h, u) => 0.6 + h * 0.4 - fbm(u, u * 0.3, 2, 20, 61) * 0.2, 6);
  }
  const height = (u: number, v: number) => {
    const n = fbm(u, v, 5, 4, 53);
    const strata = Math.sin((v + n * 0.15) * Math.PI * 2 * 6) * 0.5 + 0.5;
    return n * 0.7 + strata * 0.35 + fbm(u, v, 2, 32, 61) * 0.15;
  };
  const shade = (h: number) => 0.7 + h * 0.45;
  return bake(512, height, shade, 9);
}
