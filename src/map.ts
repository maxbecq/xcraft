export type Dir = 'N' | 'E' | 'S' | 'W';

/** Tile grid. x grows east (+X), y grows south (+Z). One tile = one world unit. */
export interface GameMap {
  width: number;
  height: number;
  /** Cliff level of each tile: 0 (low ground) to 2 (high ground). */
  level: Uint8Array;
  /** Ramp tiles climb from their level to level + 1 towards this side. */
  ramp: (Dir | null)[];
  /** Position along a ramp: 0 is the tile touching the higher ground. */
  rampStep: Uint8Array;
}

export const LEVEL_HEIGHT = 1.25;
/** Ramps are this many tiles long, for a gentle slope. */
export const RAMP_LENGTH = 4;
/** Corner heights are integers in 1/SUB of a level (so ramps can climb in steps). */
export const SUB = 12;

export const STEP: Record<Dir, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

/** Square with cut corners, centred on (0,0). */
function octagon(dx: number, dy: number, half: number, cut: number): boolean {
  return Math.abs(dx) <= half && Math.abs(dy) <= half && Math.abs(dx) + Math.abs(dy) <= 2 * half - cut;
}

/** Quarter turns clockwise of a direction. */
const TURN: Record<Dir, Dir> = { N: 'E', E: 'S', S: 'W', W: 'N' };

/**
 * The V1 map: one base in the top-left corner, copied by rotation for every player — by 180° for two
 * players (the original map), by quarter turns for four (bases in all four corners).
 */
export function createMap(players = 2): GameMap {
  const width = 96;
  const height = 96;
  const map: GameMap = {
    width, height, level: new Uint8Array(width * height), ramp: new Array(width * height).fill(null), rampStep: new Uint8Array(width * height),
  };
  const turns = players > 2 ? [0, 1, 2, 3] : [0, 2];

  // Paints a tile and its rotated copies for the other players.
  const set = (x: number, y: number, level: number, ramp: Dir | null = null, step = 0) => {
    for (const q of turns) {
      const [rx, ry] = rotateTile(width, x, y, q);
      let r = ramp;
      for (let k = 0; k < q && r; k++) r = TURN[r];
      const i = ry * width + rx;
      map.level[i] = level;
      map.ramp[i] = r;
      map.rampStep[i] = step;
    }
  };
  /** A ramp RAMP_LENGTH tiles long, starting at (x, y) next to the higher ground on side `up`, `width` tiles wide. */
  const ramp = (x: number, y: number, up: Dir, across: number, level: number) => {
    const [dx, dy] = STEP[up];
    for (let k = 0; k < RAMP_LENGTH; k++) {
      for (let w = 0; w < across; w++) {
        const tx = x - dx * k + (dx === 0 ? w : 0);
        const ty = y - dy * k + (dy === 0 ? w : 0);
        set(tx, ty, level, up, k);
      }
    }
  };
  const paint = (test: (x: number, y: number) => boolean, level: number) => {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (test(x, y)) set(x, y, level);
  };

  paint((x, y) => octagon(x - 20, y - 20, 17, 8), 1); // natural expansion plateau
  paint((x, y) => octagon(x - 14, y - 14, 10, 5), 2); // main base
  paint((x, y) => octagon(x - 47.5, y - 47.5, 6, 3), 1); // centre hill

  ramp(25, 13, 'W', 3, 1); // main -> natural
  ramp(19, 38, 'N', 3, 0); // natural -> low ground (south)
  ramp(38, 19, 'W', 3, 0); // natural -> low ground (east)
  ramp(46, 41, 'S', 4, 0); // low ground -> centre hill

  return map;
}

/** A tile turned `q` quarter turns clockwise around the centre of a square map `size` tiles wide. */
export function rotateTile(size: number, x: number, y: number, q: number): [number, number] {
  for (let k = 0; k < q % 4; k++) [x, y] = [size - 1 - y, x];
  return [x, y];
}

/** The top-left tile of a `s`×`s` footprint turned `q` quarter turns clockwise. */
export function rotateFootprint(size: number, tx: number, ty: number, s: number, q: number): [number, number] {
  for (let k = 0; k < q % 4; k++) [tx, ty] = [size - ty - s, tx];
  return [tx, ty];
}

export function tileAt(map: GameMap, x: number, y: number): { level: number; ramp: Dir | null } | null {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
  const i = y * map.width + x;
  return { level: map.level[i], ramp: map.ramp[i] };
}

/** Corner heights of a tile in 1/SUB level units, in order [nw, ne, se, sw]. */
export function cornerLevels(map: GameMap, x: number, y: number): [number, number, number, number] {
  const i = y * map.width + x;
  const step = map.rampStep[i];
  // Along a ramp: the high side of step k sits k/RAMP_LENGTH below the upper level.
  const hi = (map.level[i] + 1) * SUB - (step * SUB) / RAMP_LENGTH;
  const lo = map.ramp[i] ? hi - SUB / RAMP_LENGTH : map.level[i] * SUB;
  switch (map.ramp[i]) {
    case 'N': return [hi, hi, lo, lo];
    case 'S': return [lo, lo, hi, hi];
    case 'E': return [lo, hi, hi, lo];
    case 'W': return [hi, lo, lo, hi];
    default: return [lo, lo, lo, lo];
  }
}

/** World heights of a tile's corners, in order [nw, ne, se, sw]. */
export function cornerHeights(map: GameMap, x: number, y: number): [number, number, number, number] {
  return cornerLevels(map, x, y).map((l) => (l / SUB) * LEVEL_HEIGHT) as [number, number, number, number];
}

/** Corner offsets, in corner order [nw, ne, se, sw]. */
const CORNER_DIR: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

/**
 * Plateau corners on a staircase cliff are cut diagonally when drawn, so diagonal cliffs look straight.
 * Returns the removed corner (0..3, see cornerLevels) or -1. Rendering only: pathing stays on tiles.
 */
export function cutCorner(map: GameMap, x: number, y: number): number {
  const t = tileAt(map, x, y);
  if (!t || t.ramp) return -1;
  const lowerFlat = (tx: number, ty: number) => {
    const n = tileAt(map, tx, ty);
    return !!n && !n.ramp && n.level < t.level;
  };
  let found = -1;
  for (let c = 0; c < 4; c++) {
    const [dx, dy] = CORNER_DIR[c];
    const h = tileAt(map, x + dx, y);
    const v = tileAt(map, x, y + dy);
    if (!lowerFlat(x + dx, y) || !lowerFlat(x, y + dy) || !lowerFlat(x + dx, y + dy) || h!.level !== v!.level) continue;
    if (found >= 0) return -1; // a thin spike: leave it square
    found = c;
  }
  return found;
}

/** Level the cut part of a tile drops to. */
export function cutLevel(map: GameMap, x: number, y: number, corner: number): number {
  return tileAt(map, x + CORNER_DIR[corner][0], y)!.level;
}

/** Is local point (u, v) of a tile inside the triangle removed at `corner`? */
export function inCut(corner: number, u: number, v: number): boolean {
  switch (corner) {
    case 0: return u + v < 1;
    case 1: return u > v;
    case 2: return u + v > 1;
    case 3: return v > u;
    default: return false;
  }
}

/** Ground height under a world point (in tiles), for rendering. */
/** Rendering only: extra ground relief (dunes) at a tile corner, set with the planet's look. */
let relief: ((vx: number, vz: number) => number) | null = null;
/** Relief per tile corner, computed once per map (heightAt asks for it every frame for every unit). */
const reliefCache = new WeakMap<GameMap, Float32Array>();
export function setRelief(f: ((vx: number, vz: number) => number) | null): void {
  relief = f;
}

/** The relief at a tile corner: none along cliffs and on ramps, so they keep their shape. */
export function reliefAt(map: GameMap, vx: number, vz: number): number {
  if (!relief) return 0;
  let cache = reliefCache.get(map);
  if (!cache) {
    cache = new Float32Array((map.width + 1) * (map.height + 1));
    for (let z = 0; z <= map.height; z++) for (let x = 0; x <= map.width; x++) cache[z * (map.width + 1) + x] = computeRelief(map, x, z);
    reliefCache.set(map, cache);
  }
  return cache[Math.min(map.height, Math.max(0, vz)) * (map.width + 1) + Math.min(map.width, Math.max(0, vx))];
}

function computeRelief(map: GameMap, vx: number, vz: number): number {
  for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [-1, -1], [1, 0], [0, 1], [1, 1], [-1, 1], [1, -1]]) {
    const t = tileAt(map, Math.min(map.width - 1, Math.max(0, vx + dx)), Math.min(map.height - 1, Math.max(0, vz + dy)));
    if (!t || t.ramp || t.level !== tileAt(map, Math.min(map.width - 1, vx), Math.min(map.height - 1, vz))?.level) return 0;
  }
  // Plateaus are where bases go (main base on level 2, expansions on level 1): only a gentle swell there.
  const level = tileAt(map, Math.min(map.width - 1, vx), Math.min(map.height - 1, vz))!.level;
  return relief!(vx, vz) * [1, 0.35, 0.2][Math.min(2, level)];
}

export function heightAt(map: GameMap, x: number, y: number): number {
  const tx = Math.min(map.width - 1, Math.max(0, Math.floor(x)));
  const ty = Math.min(map.height - 1, Math.max(0, Math.floor(y)));
  const u = Math.min(1, Math.max(0, x - tx));
  const v = Math.min(1, Math.max(0, y - ty));
  const cut = cutCorner(map, tx, ty);
  if (cut >= 0 && inCut(cut, u, v)) return cutLevel(map, tx, ty, cut) * LEVEL_HEIGHT;
  const [nw, ne, se, sw] = cornerHeights(map, tx, ty);
  const r = relief ? [reliefAt(map, tx, ty), reliefAt(map, tx + 1, ty), reliefAt(map, tx + 1, ty + 1), reliefAt(map, tx, ty + 1)] : [0, 0, 0, 0];
  return ((nw + r[0]) * (1 - u) + (ne + r[1]) * u) * (1 - v) + ((sw + r[3]) * (1 - u) + (se + r[2]) * u) * v;
}
