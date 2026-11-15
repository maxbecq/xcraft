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
      const g = Math.max(0, Math.min(255, shade(at(x, y), x / size, y / size) * 200));
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
export function groundTextures(): [Texture, Texture] {
  const height = (u: number, v: number) => {
    const base = fbm(u, v, 5, 4, 11);
    const cracks = 1 - Math.min(1, Math.abs(fbm(u, v, 3, 6, 23) - 0.5) * 18);
    const pebble = fbm(u, v, 2, 48, 37);
    return base * 0.6 - cracks * 0.25 + (pebble > 0.72 ? (pebble - 0.72) * 3 : 0);
  };
  const shade = (h: number, u: number, v: number) => 0.82 + h * 0.35 + (fbm(u, v, 3, 16, 41) - 0.5) * 0.18;
  return bake(512, height, shade, 6);
}

/** Layered rock for cliff faces: horizontal strata broken by noise. u runs along the cliff, v up it. */
export function rockTextures(): [Texture, Texture] {
  const height = (u: number, v: number) => {
    const n = fbm(u, v, 5, 4, 53);
    const strata = Math.sin((v + n * 0.15) * Math.PI * 2 * 6) * 0.5 + 0.5;
    return n * 0.7 + strata * 0.35 + fbm(u, v, 2, 32, 61) * 0.15;
  };
  const shade = (h: number) => 0.7 + h * 0.45;
  return bake(512, height, shade, 9);
}
