import { type Faction, FACTIONS } from '../data';
import { type Dir, type GameMap, RAMP_LENGTH, STEP, rotateFootprint, rotateTile } from '../map';
import { CORNERS, type MapFile, buildMap, turnsOf } from '../maps';

/**
 * Map file format 2: a tile grid, made for the editor (format 1, src/maps.ts, is made to be written by hand).
 * The whole map is stored as it is: the editor applies the symmetry while painting, so a reader never turns anything.
 *
 * What the game reads today: nothing of it (the game reads format 1). The editor reads all of it; `toGameMap` gives
 * the game's own map structure (relief, ramps, chasms, base spots), so the editor's view is the game's renderer.
 */
export interface MapFile2 {
  format: 2;
  id: string;
  name: string;
  description?: string;
  /** Side of the (square) map, in tiles. */
  size: number;
  /** The map's one planet (render/biome.ts id). */
  biome: string;
  /** How the editor mirrors what is painted: none, two parts (180°) or four (quarter turns). Information for the reader. */
  symmetry: Symmetry;
  /** One string per row (y), one character per tile (x): '0', '1', '2' a level, 'x' a chasm. */
  tiles: string[];
  ramps: Ramp2[];
  /** Mineral tiles. */
  minerals: [number, number][];
  /** Top-left tiles of energy wells (3×3). */
  wells: [number, number][];
  /** Free base spots (expansions): top-left tile of a headquarters (4×4). The players' starts are in `players`. */
  bases: [number, number][];
  /** One per seat: the map's player count is this list's length. */
  players: Player2[];
  /** Scenery placed by hand (names of public/models/doodads.glb), besides the scenery the game scatters itself. */
  decor: { type: string; at: [number, number]; yaw?: number }[];
  /** Units and buildings there from the start: owner a seat (0…) or -1 (neutral). Units: tile; buildings: top-left tile. */
  units: { type: string; owner: number; at: [number, number] }[];
  /** Reserved for the triggers (docs/declencheurs.md): not read yet. */
  triggers?: unknown[];
}

export type Symmetry = 'none' | 'rot180' | 'rot90';

/** A ramp as in format 1: `at` the tile touching the higher ground, `up` towards it, `width` tiles wide, `level` its foot. */
export interface Ramp2 {
  at: [number, number];
  up: Dir;
  width: number;
  level: number;
}

export interface Player2 {
  race: Faction;
  /** Top-left tile of the starting headquarters (4×4). */
  start: [number, number];
  minerals: number;
  energy: number;
  /** Units, buildings and research this player may not have (DEFS ids). */
  forbid: string[];
}

export const RACES = Object.keys(FACTIONS) as Faction[];
export const MAX_SIZE = 256;
const DIRS: Dir[] = ['N', 'E', 'S', 'W'];
const TURN: Record<Dir, Dir> = { N: 'E', E: 'S', S: 'W', W: 'N' };

export function turnDir(d: Dir, q: number): Dir {
  for (let n = 0; n < q % 4; n++) d = TURN[d];
  return d;
}

/** The quarter turns a symmetry copies a stroke to. */
export function turnsOfSymmetry(s: Symmetry): number[] {
  return s === 'rot90' ? [0, 1, 2, 3] : s === 'rot180' ? [0, 2] : [0];
}

/** The step-0 tiles of a ramp (those touching the higher ground). */
export function rampTop(r: Ramp2): [number, number][] {
  const [dx, dy] = STEP[r.up];
  return Array.from({ length: r.width }, (_, w) => [r.at[0] + (dx === 0 ? w : 0), r.at[1] + (dy === 0 ? w : 0)] as [number, number]);
}

/** Every tile of a ramp. */
export function rampTiles(r: Ramp2): [number, number][] {
  const [dx, dy] = STEP[r.up];
  return rampTop(r).flatMap(([x, y]) => Array.from({ length: RAMP_LENGTH }, (_, k) => [x - dx * k, y - dy * k] as [number, number]));
}

/** A ramp turned q quarter turns round the middle of a map `size` wide. */
export function turnRamp(size: number, r: Ramp2, q: number): Ramp2 {
  const top = rampTop(r).map(([x, y]) => rotateTile(size, x, y, q));
  const at = top.reduce((a, t) => (t[0] + t[1] < a[0] + a[1] ? t : a));
  return { ...r, at, up: turnDir(r.up, q) };
}

/** A blank map: flat low ground, two players facing each other across the diagonal. */
export function blankMap(size = 96, biome = 'desert'): MapFile2 {
  const player = (start: [number, number]): Player2 => ({ race: 'humains', start, minerals: 200, energy: 0, forbid: [] });
  return {
    format: 2, id: 'nouvelle-carte', name: 'Nouvelle carte', size, biome, symmetry: 'rot180',
    tiles: Array.from({ length: size }, () => '0'.repeat(size)),
    ramps: [], minerals: [], wells: [], bases: [], decor: [], units: [],
    players: [player([10, 10]), player(rotateFootprint(size, 10, 10, 4, 2))],
  };
}

/** The level character of a tile ('x': chasm), or '' off the map. */
export function tileOf(f: MapFile2, x: number, y: number): string {
  return x >= 0 && y >= 0 && x < f.size && y < f.size ? f.tiles[y][x] : '';
}

/** The game's map structure for a format 2 file: the editor's view is the game's own renderer on it. */
export function toGameMap(f: MapFile2): GameMap {
  const n = f.size;
  const map: GameMap = { width: n, height: n, level: new Uint8Array(n * n), ramp: new Array(n * n).fill(null), rampStep: new Uint8Array(n * n) };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const c = f.tiles[y][x];
      if (c === 'x') (map.chasm ??= new Uint8Array(n * n))[y * n + x] = 1;
      else map.level[y * n + x] = Number(c);
    }
  }
  for (const r of f.ramps) {
    const [dx, dy] = STEP[r.up];
    for (const [x, y] of rampTop(r)) {
      for (let k = 0; k < RAMP_LENGTH; k++) {
        const tx = x - dx * k;
        const ty = y - dy * k;
        if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue;
        const i = ty * n + tx;
        map.level[i] = r.level;
        map.ramp[i] = r.up;
        map.rampStep[i] = k;
        if (map.chasm) map.chasm[i] = 0;
      }
    }
  }
  // Base spots: each start is its seat's corner; a free base belongs to the corner of the nearest start (the AI's order).
  const starts = f.players.map((p) => p.start);
  const nearest = (b: [number, number]) => starts.reduce((a, s, i) => (dist(b, s) < dist(b, starts[a]) ? i : a), 0);
  map.sites = [
    ...f.players.map((p, i) => ({ hq: p.start, turn: CORNERS[i], start: true })),
    ...f.bases.map((b) => ({ hq: b, turn: CORNERS[nearest(b)], start: false })),
  ];
  return map;
}

const dist = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

/**
 * A format 1 map as a format 2 file, for `players` seats (default: the most it takes) on planet `biome`: the game's
 * own reader turns it, then the grid is read back. Free corners' starts become free bases.
 */
export function fromFormat1(def: MapFile, biome = def.biomes?.[0] ?? 'desert', players = Math.max(...def.players)): MapFile2 {
  const map = buildMap(def, players, biome);
  const n = def.size;
  const tiles = Array.from({ length: n }, (_, y) =>
    Array.from({ length: n }, (_, x) => (map.chasm?.[y * n + x] ? 'x' : String(map.level[y * n + x]))).join(''),
  );
  // Ramps: runs of step-0 tiles across the slope, one ramp each.
  const ramps: Ramp2[] = [];
  const seen = new Set<number>();
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const up = map.ramp[i];
      if (!up || map.rampStep[i] !== 0 || seen.has(i)) continue;
      const [ax, ay] = STEP[up][0] === 0 ? [1, 0] : [0, 1];
      let w = 0;
      for (;;) {
        const j = (y + ay * w) * n + x + ax * w;
        if (x + ax * w >= n || y + ay * w >= n || map.ramp[j] !== up || map.rampStep[j] !== 0 || map.level[j] !== map.level[i]) break;
        seen.add(j);
        w++;
      }
      ramps.push({ at: [x, y], up, width: w, level: map.level[i] });
    }
  }
  const turns = turnsOf(def, players);
  const key = new Set<string>();
  const once = (list: [number, number][]) => list.filter(([x, y]) => !key.has(`${x},${y}`) && !!key.add(`${x},${y}`));
  const minerals = once(turns.flatMap((q) => def.bases.flatMap((b) => b.minerals.map(([x, y]) => rotateTile(n, x, y, q)))));
  key.clear();
  const wells = once(turns.flatMap((q) => def.bases.flatMap((b) => b.wells.map(([x, y]) => rotateFootprint(n, x, y, 3, q)))));
  const sites = map.sites ?? [];
  const seats = Array.from({ length: players }, (_, i) => sites.find((s) => s.start && s.turn === CORNERS[i])?.hq ?? sites[0].hq);
  return {
    format: 2, id: def.id, name: def.name, description: def.description, size: n, biome,
    symmetry: turns.length === 4 ? 'rot90' : 'rot180',
    tiles, ramps, minerals, wells,
    bases: sites.filter((s) => !seats.includes(s.hq)).map((s) => s.hq),
    players: seats.map((start) => ({ race: 'humains', start, minerals: 200, energy: 0, forbid: [] })),
    decor: [], units: [],
  };
}

/**
 * Reads an untrusted file (an import): a format 2 file checked field by field, or a format 1 file converted.
 * Throws a message in French on anything wrong.
 */
export function parseMap(json: unknown, maps1?: (def: MapFile) => MapFile2): MapFile2 {
  const f = json as Omit<Partial<MapFile2>, 'format'> & { format?: number };
  if (!f || typeof f !== 'object') throw new Error('Fichier illisible : pas un objet JSON.');
  if (f.format === 1) {
    if (!maps1) throw new Error('Format 1 non pris en charge ici.');
    return maps1(json as MapFile);
  }
  if (f.format !== 2) throw new Error(`Format inconnu : ${String(f.format)}.`);
  const n = f.size;
  if (!Number.isInteger(n) || n! < 16 || n! > MAX_SIZE) throw new Error(`Taille invalide (16 à ${MAX_SIZE}).`);
  const size = n!;
  const pt = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((v) => Number.isInteger(v) && v >= 0 && v < size);
  const list = <T>(v: unknown, ok: (x: T) => boolean, what: string): T[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.length > size * size || !v.every(ok)) throw new Error(`Champ « ${what} » invalide.`);
    return v;
  };
  if (!Array.isArray(f.tiles) || f.tiles.length !== size || !f.tiles.every((r) => typeof r === 'string' && r.length === size && /^[012x]*$/.test(r))) {
    throw new Error(`« tiles » : ${size} lignes de ${size} caractères parmi 0, 1, 2, x.`);
  }
  const ramps = list<Ramp2>(f.ramps, (r) => pt(r?.at) && DIRS.includes(r.up) && Number.isInteger(r.width) && r.width >= 1 && r.width <= 12 && [0, 1].includes(r.level), 'ramps');
  const players = list<Player2>(f.players, (p) => RACES.includes(p?.race) && pt(p.start) && Number.isFinite(p.minerals) && Number.isFinite(p.energy) && Array.isArray(p.forbid) && p.forbid.every((s) => typeof s === 'string'), 'players');
  if (players.length < 1 || players.length > 4) throw new Error('De 1 à 4 joueurs.');
  return {
    format: 2,
    id: typeof f.id === 'string' && /^[a-z0-9-]{1,40}$/.test(f.id) ? f.id : 'carte-importee',
    name: typeof f.name === 'string' ? f.name.slice(0, 60) : 'Carte importée',
    description: typeof f.description === 'string' ? f.description.slice(0, 400) : undefined,
    size,
    biome: typeof f.biome === 'string' ? f.biome : 'desert',
    symmetry: f.symmetry === 'rot90' || f.symmetry === 'rot180' ? f.symmetry : 'none',
    tiles: f.tiles,
    ramps,
    minerals: list<[number, number]>(f.minerals, pt, 'minerals'),
    wells: list<[number, number]>(f.wells, pt, 'wells'),
    bases: list<[number, number]>(f.bases, pt, 'bases'),
    players,
    decor: list<MapFile2['decor'][number]>(f.decor, (d) => typeof d?.type === 'string' && pt(d.at), 'decor'),
    units: list<MapFile2['units'][number]>(f.units, (u) => typeof u?.type === 'string' && Number.isInteger(u.owner) && u.owner >= -1 && u.owner < players.length && pt(u.at), 'units'),
    triggers: Array.isArray(f.triggers) ? f.triggers : undefined,
  };
}
