import { type Dir, type GameMap, RAMP_LENGTH, STEP, rotateFootprint, rotateTile } from './map';

/**
 * Maps are files: one JSON per map in public/maps/ (see public/maps/README.md). They are bundled at build time
 * (dropping a file in the folder is enough) and also served as they are.
 */
export interface MapFile {
  format: 1;
  id: string;
  name: string;
  description?: string;
  /** Side of the (square) map, in tiles. */
  size: number;
  /** Player counts the map is made for. */
  players: number[];
  /** How player 0's part is copied for the others: 180° (two parts), quarter turns (four), or 'auto' (two parts for two players, four beyond). */
  symmetry: 'rot180' | 'rot90' | 'auto';
  /** Points near which ragged edges stay straight (default: both ends of every ramp). */
  calm?: [number, number][];
  terrain: Shape[];
  bases: BaseSpot[];
}

type Area =
  | { shape: 'octagon'; at: [number, number]; half: number; cut: number; ragged?: number }
  | { shape: 'rect'; from: [number, number]; to: [number, number] }
  | { shape: 'circle'; at: [number, number]; r: number }
  /** A diagonal band: tiles where |x + y·diag − offset| ≤ half (diag 1 or −1). */
  | { shape: 'band'; diag: 1 | -1; offset: number; half: number };

/** `biome`: the shape only exists on that planet. */
export type Shape = (
  | (Area & { level: number; chasm?: undefined; fill?: undefined })
  | (Area & { chasm: true; level?: undefined; fill?: undefined })
  | (Area & { fill: true; level?: undefined; chasm?: undefined })
  | { shape: 'ramp'; at: [number, number]; up: Dir; width: number; level: number }
) & { biome?: string };

export interface BaseSpot {
  name?: string;
  /** The players' starting spot (exactly one). */
  start?: boolean;
  /** Top-left tile of the headquarters (5×5). */
  hq: [number, number];
  /** Where the first workers stand (default: east of the headquarters). */
  workers?: [number, number];
  minerals: [number, number][];
  /** Top-left tiles of energy wells (3×3). */
  wells: [number, number][];
}

/** Which corner each player starts in, as quarter turns from the top-left: 1 v 1 stays across the map. */
export const CORNERS = [0, 2, 1, 3];

const FILES = import.meta.glob<MapFile>('/public/maps/*.json', { eager: true, import: 'default' });

/** Every valid map, by id: the original map first, then by name. */
export const MAPS: Record<string, MapFile> = Object.fromEntries(
  Object.values(FILES)
    .filter((m) => {
      const ok = m.format === 1 && !!m.id && m.size > 0 && m.players?.length > 0 && m.bases?.filter((b) => b.start).length === 1;
      if (!ok) console.warn(`Carte ignorée (format inconnu ou incomplet) : ${m.id ?? '?'}`);
      return ok;
    })
    .sort((a, b) => (a.id === 'origine' ? -1 : b.id === 'origine' ? 1 : a.name.localeCompare(b.name, 'fr')))
    .map((m) => [m.id, m]),
);
export const DEFAULT_MAP = 'origine';

/** The map with this id, or the original map (said in the console when an id was given: a network game checks it first). */
export function mapFile(id: string | null | undefined): MapFile {
  // Own ids only: a name like `constructor` is not a map.
  const known = !!id && Object.hasOwn(MAPS, id);
  if (id && !known) console.warn(`Carte inconnue : ${id}, remplacée par ${DEFAULT_MAP}`);
  return known ? MAPS[id] : MAPS[DEFAULT_MAP];
}

/** Quarter turns that copy player 0's part for `players` players. */
export function turnsOf(def: MapFile, players: number): number[] {
  return def.symmetry === 'rot90' || (def.symmetry === 'auto' && players > 2) ? [0, 1, 2, 3] : [0, 2];
}

const TURN: Record<Dir, Dir> = { N: 'E', E: 'S', S: 'W', W: 'N' };

function octagon(dx: number, dy: number, half: number, cut: number): boolean {
  return Math.abs(dx) <= half && Math.abs(dy) <= half && Math.abs(dx) + Math.abs(dy) <= 2 * half - cut;
}

/**
 * sin and cos from + − × ÷ alone, which every browser rounds the same (Math.sin need not): the angle brought within
 * a turn, then its series, to well past double precision.
 */
function sine(x: number): number {
  const TURN = 6.283185307179586;
  x -= TURN * Math.round(x / TURN);
  let term = x;
  let sum = x;
  for (let n = 1; n < 14; n++) {
    term *= -(x * x) / (2 * n * (2 * n + 1));
    sum += term;
  }
  return sum;
}
const cosine = (x: number) => sine(x + 1.5707963267948966);

/** The terrain of a map file for `players` players on planet `biome`. */
export function buildMap(def: MapFile, players = 2, biome = ''): GameMap {
  const width = def.size;
  const height = def.size;
  const map: GameMap = {
    width, height, level: new Uint8Array(width * height), ramp: new Array(width * height).fill(null), rampStep: new Uint8Array(width * height),
  };
  const turns = turnsOf(def, players);
  const shapes = def.terrain.filter((s) => !s.biome || s.biome === biome);
  const calm =
    def.calm ??
    shapes.flatMap((s) => {
      if (s.shape !== 'ramp') return [];
      const [dx, dy] = STEP[s.up];
      const [ax, ay] = [dx === 0 ? Math.floor(s.width / 2) : 0, dy === 0 ? Math.floor(s.width / 2) : 0];
      return [[s.at[0] + dx + ax, s.at[1] + dy + ay], [s.at[0] - dx * RAMP_LENGTH + ax, s.at[1] - dy * RAMP_LENGTH + ay]] as [number, number][];
    });

  const each = (x: number, y: number, f: (i: number, q: number) => void) => {
    for (const q of turns) {
      const [rx, ry] = rotateTile(width, x, y, q);
      f(ry * width + rx, q);
    }
  };
  const inside = (a: Area, x: number, y: number): boolean => {
    switch (a.shape) {
      case 'octagon': {
        const [cx, cy] = a.at;
        let off = 0;
        if (a.ragged !== undefined && !calm.some(([rx, ry]) => Math.abs(x - rx) + Math.abs(y - ry) < 6)) {
          // sin(3t + φ)·1.1 + sin(7t + 2φ)·0.7 round the angle t of (x, y), without Math.atan2 or Math.sin: the angle
          // taken k times is (cos t + i sin t)^k, from √, × and ÷ alone, which every browser rounds the same.
          const dx = x - cx;
          const dy = y - cy;
          const r = Math.sqrt(dx * dx + dy * dy);
          const [c, s] = r ? [dx / r, dy / r] : [1, 0];
          const times = (k: number) => {
            let [re, im] = [1, 0];
            for (let n = 0; n < k; n++) [re, im] = [re * c - im * s, re * s + im * c];
            return [re, im];
          };
          const [c3, s3] = times(3);
          const [c7, s7] = times(7);
          off = Math.round((s3 * cosine(a.ragged) + c3 * sine(a.ragged)) * 1.1 + (s7 * cosine(2 * a.ragged) + c7 * sine(2 * a.ragged)) * 0.7);
        }
        return octagon(x - cx, y - cy, a.half + off, a.cut);
      }
      case 'rect':
        return x >= a.from[0] && x <= a.to[0] && y >= a.from[1] && y <= a.to[1];
      case 'circle':
        return (x - a.at[0]) * (x - a.at[0]) + (y - a.at[1]) * (y - a.at[1]) <= a.r * a.r;
      case 'band':
        return Math.abs(x + y * a.diag - a.offset) <= a.half;
    }
  };

  for (const s of shapes) {
    if (s.shape === 'ramp') {
      const [dx, dy] = STEP[s.up];
      for (let k = 0; k < RAMP_LENGTH; k++) {
        for (let w = 0; w < s.width; w++) {
          const tx = s.at[0] - dx * k + (dx === 0 ? w : 0);
          const ty = s.at[1] - dy * k + (dy === 0 ? w : 0);
          each(tx, ty, (i, q) => {
            let r: Dir = s.up;
            for (let n = 0; n < q; n++) r = TURN[r];
            map.level[i] = s.level;
            map.ramp[i] = r;
            map.rampStep[i] = k;
          });
        }
      }
      continue;
    }
    if (s.chasm) map.chasm ??= new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!inside(s, x, y)) continue;
        each(x, y, (i) => {
          if (s.chasm) map.chasm![i] = 1;
          else if (s.fill) {
            if (map.chasm) map.chasm[i] = 0;
          } else {
            map.level[i] = s.level;
            map.ramp[i] = null;
            map.rampStep[i] = 0;
          }
        });
      }
    }
  }
  // A base in the very middle turns onto itself: one spot, shared by everyone (turn -1).
  map.sites = [];
  for (const turn of turns) {
    for (const b of def.bases) {
      const hq = rotateFootprint(width, b.hq[0], b.hq[1], 5, turn);
      const same = map.sites.find((s) => s.hq[0] === hq[0] && s.hq[1] === hq[1]);
      if (same) same.turn = -1;
      else map.sites.push({ hq, turn, start: !!b.start });
    }
  }
  return map;
}
