import { DEFS, type Faction, FACTIONS, START } from '../data';
import { type Dir, type GameMap, RAMP_LENGTH, STEP, rotateFootprint, rotateTile } from '../map';
import { CORNERS, type MapFile, type Shape, buildMap, hqSlot, turnsOf } from '../maps';
import { PLANETS } from '../mapcheck';

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
  /** The race the map imposes on this seat, or '' for the player's pick. */
  race: Faction | '';
  /** Top-left tile of the starting headquarters (4×4). */
  start: [number, number];
  minerals: number;
  energy: number;
  /** Units, buildings and research this player may not have (DEFS ids). */
  forbid: string[];
  /** The team the map puts this player in (0 to 3); none: picked in the game's menu. */
  team?: number;
}

export const RACES = Object.keys(FACTIONS) as Faction[];
/** The scenery one may place: the pieces of public/models/doodads.glb (a test keeps the two lists the same). */
export const DECOR = ['barrels', 'barrier', 'billboard', 'bones', 'cables', 'crates', 'dead_tree', 'dry_bush', 'hovercar', 'pebbles', 'rocks_a', 'rocks_b', 'rubble', 'scrap_pile', 'shopfront', 'streetlamp', 'techbox', 'terminal', 'tire_pile', 'trash', 'vending', 'vent', 'walldoor', 'wallpanel', 'wallpipe', 'wreck'];
/** Starting minerals or energy, as the game takes (mapcheck.ts). */
const MAX_START = 100_000;
const known = (t: unknown, kinds: string[]) => typeof t === 'string' && Object.hasOwn(DEFS, t) && kinds.includes(DEFS[t].kind);
/** As the game's own map files (mapcheck.ts), so every map made here can be exported for the game. */
export const MAX_SIZE = 160;
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
  const player = (start: [number, number]): Player2 => ({ race: '', start, minerals: START.minerals, energy: START.energy, forbid: [] });
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
export function fromFormat1(def: MapFile, biome = def.biome, players = Math.max(...def.players)): MapFile2 {
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
    players: seats.map((start, i) => {
      const s = def.seats?.[i];
      return { race: s?.race ?? '', start, minerals: s?.minerals ?? START.minerals, energy: s?.energy ?? START.energy, forbid: [...(s?.forbid ?? [])], ...(s?.team === undefined ? {} : { team: s.team }) };
    }),
    decor: [], units: (def.units ?? []).filter((u) => u.owner < players).map((u) => ({ ...u, at: [...u.at] as [number, number] })),
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
  if ('triggers' in f) throw new Error('Les déclencheurs ne sont pas encore pris en charge.');
  const n = f.size;
  if (!Number.isInteger(n) || n! < 32 || n! > MAX_SIZE) throw new Error(`Taille invalide (32 à ${MAX_SIZE}).`);
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
  const players = list<Player2>(f.players, (p) => (p?.race === '' || RACES.includes(p?.race)) && pt(p.start) && [p.minerals, p.energy].every((v) => Number.isInteger(v) && v >= 0 && v <= MAX_START) && Array.isArray(p.forbid) && p.forbid.length <= 300 && p.forbid.every((t) => known(t, ['unit', 'building', 'upgrade'])) && (p.team === undefined || (Number.isInteger(p.team) && p.team >= 0 && p.team <= 3)), 'players');
  if (players.length < 1 || players.length > 4) throw new Error('De 1 à 4 joueurs.');
  return {
    format: 2,
    id: typeof f.id === 'string' && /^[a-z0-9-]{1,40}$/.test(f.id) ? f.id : 'carte-importee',
    name: typeof f.name === 'string' ? f.name.slice(0, 60) : 'Carte importée',
    description: typeof f.description === 'string' ? f.description.slice(0, 400) : undefined,
    size,
    biome: PLANETS.includes(f.biome as string) ? f.biome! : 'desert',
    symmetry: f.symmetry === 'rot90' || f.symmetry === 'rot180' ? f.symmetry : 'none',
    tiles: f.tiles,
    ramps,
    minerals: list<[number, number]>(f.minerals, pt, 'minerals'),
    wells: list<[number, number]>(f.wells, pt, 'wells'),
    bases: list<[number, number]>(f.bases, pt, 'bases'),
    players,
    decor: list<MapFile2['decor'][number]>(f.decor, (d) => DECOR.includes(d?.type) && pt(d.at) && (d.yaw === undefined || (typeof d.yaw === 'number' && Number.isFinite(d.yaw) && Math.abs(d.yaw) <= 7)), 'decor'),
    units: list<MapFile2['units'][number]>(f.units, (u) => known(u?.type, ['unit', 'building']) && Number.isInteger(u.owner) && u.owner >= -1 && u.owner < players.length && pt(u.at), 'units'),
  };
}

/** The format 1 bounds the game checks (mapcheck.ts). */
const MAX_SHAPES = 300;
const MAX_BASES = 16;
const MAX_MINERALS = 32;
const MAX_WELLS = 4;

/**
 * A format 2 map as a format 1 file the game imports (mapcheck.ts): relief, ramps, chasms, bases, minerals and wells.
 * Format 1 describes player 1's part and turns it for the others, so the part kept is one tile of each turned group
 * (the first in reading order): a symmetric map comes out the same, a lopsided one comes out symmetric (said in
 * `notes`, with what format 1 cannot hold). Throws, in French, when the map does not fit format 1's bounds.
 */
export function toFormat1(f: MapFile2): { map: MapFile; notes: string[] } {
  const notes: string[] = [];
  const n = f.size;
  if (n < 32 || n > MAX_SIZE) throw new Error(`Taille ${n} : le jeu prend de 32 à ${MAX_SIZE} tuiles.`);
  const symmetry = f.symmetry === 'none' ? 'rot180' : f.symmetry;
  if (f.symmetry === 'none') notes.push('Sans symétrie : la carte est rendue symétrique à 180° depuis la part du joueur 1.');
  const turns = turnsOfSymmetry(symmetry);
  const gm = toGameMap(f);
  const key = ([x, y]: [number, number]) => y * n + x;
  /** The first of a group of turned copies, in reading order: the one kept. */
  const first = (orbit: [number, number][]) => orbit.reduce((a, p) => (key(p) < key(a) ? p : a));
  const tileOrbit = (x: number, y: number) => turns.map((q) => rotateTile(n, x, y, q));
  const footOrbit = ([x, y]: [number, number], s: number) => turns.map((q) => rotateFootprint(n, x, y, s, q));
  const same = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];

  // Relief: rectangles over the kept tiles of each kind (ramps are drawn by their own shapes, after).
  const kind = (i: number) => (gm.ramp[i] ? -1 : gm.chasm?.[i] ? 3 : gm.level[i]);
  const terrain: Shape[] = [];
  let lopsided = false;
  for (const k of [1, 2, 3]) {
    const todo = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const orbit = tileOrbit(x, y);
        if (!same(first(orbit), [x, y])) continue;
        if (orbit.some((p) => kind(key(p)) !== kind(y * n + x))) lopsided = true;
        if (kind(y * n + x) === k) todo[y * n + x] = 1;
      }
    }
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (!todo[y * n + x]) continue;
        let w = 1;
        while (x + w < n && todo[y * n + x + w]) w++;
        let h = 1;
        while (y + h < n && Array.from({ length: w }, (_, d) => todo[(y + h) * n + x + d]).every(Boolean)) h++;
        for (let yy = y; yy < y + h; yy++) todo.fill(0, yy * n + x, yy * n + x + w);
        const rect = { shape: 'rect' as const, from: [x, y] as [number, number], to: [x + w - 1, y + h - 1] as [number, number] };
        terrain.push(k === 3 ? { ...rect, chasm: true } : { ...rect, level: k });
      }
    }
  }
  // Ramps: one of each turned group.
  const kept: Ramp2[] = [];
  const sameRamp = (a: Ramp2, b: Ramp2) => same(a.at, b.at) && a.up === b.up && a.width === b.width && a.level === b.level;
  for (const r of f.ramps) {
    if (kept.some((k) => turns.some((q) => sameRamp(turnRamp(n, k, q), r)))) continue;
    kept.push(r);
    if (!turns.every((q) => f.ramps.some((o) => sameRamp(o, turnRamp(n, r, q))))) lopsided = true;
  }
  terrain.push(...kept.map((r) => ({ shape: 'ramp' as const, at: r.at, up: r.up, width: r.width, level: r.level })));
  if (terrain.length > MAX_SHAPES) throw new Error(`Relief trop morcelé pour le jeu : ${terrain.length} formes (${MAX_SHAPES} au plus).`);
  if (lopsided && f.symmetry !== 'none') notes.push('Relief ou rampes pas tout à fait symétriques : la part du joueur 1 fait foi.');

  // Bases: player 1's start, then one free base of each turned group (other seats' starts come from turning the first).
  const start = f.players[0].start;
  const starts = footOrbit(start, 4);
  f.players.forEach((p, i) => {
    if (i && turns.includes(CORNERS[i]) && !same(p.start, rotateFootprint(n, start[0], start[1], 4, CORNERS[i]))) notes.push(`Départ du joueur ${i + 1} : placé par symétrie depuis celui du joueur 1.`);
  });
  const free: [number, number][] = [];
  for (const b of f.bases) {
    const orbit = footOrbit(b, 4);
    if (starts.some((s) => orbit.some((o) => same(o, s))) || free.some((k) => orbit.some((o) => same(o, k)))) continue;
    free.push(first(orbit));
  }
  const spots = [start, ...free];
  if (spots.length > MAX_BASES) throw new Error(`Trop de bases pour le jeu : ${spots.length} (${MAX_BASES} au plus).`);
  const bases = spots.map((hq, i) => ({ ...(i === 0 ? { start: true } : {}), hq, minerals: [] as [number, number][], wells: [] as [number, number][] }));
  // Each kept mineral and well to the nearest base with room (the game reads them all alike: the grouping only bounds a base's share).
  const centre = (hq: [number, number]) => [hq[0] + 2, hq[1] + 2];
  const give = (p: [number, number], list: 'minerals' | 'wells', max: number, what: string) => {
    const byDistance = [...bases].sort((a, b) => {
      const [ax, ay] = centre(a.hq);
      const [bx, by] = centre(b.hq);
      return Math.abs(ax - p[0]) + Math.abs(ay - p[1]) - (Math.abs(bx - p[0]) + Math.abs(by - p[1]));
    });
    const room = byDistance.find((b) => b[list].length < max);
    if (!room) throw new Error(`Trop de ${what} pour le jeu (${max} par base au plus).`);
    room[list].push(p);
  };
  const seen = new Set<number>();
  for (const m of f.minerals) {
    const p = first(tileOrbit(...m));
    if (!seen.has(key(p)) && seen.add(key(p))) give(p, 'minerals', MAX_MINERALS, 'minerai');
  }
  seen.clear();
  for (const w of f.wells) {
    const p = first(footOrbit(w, 3));
    if (!seen.has(key(p)) && seen.add(key(p))) give(p, 'wells', MAX_WELLS, 'puits');
  }
  const map: MapFile = {
    format: 1,
    id: f.id.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32) || 'carte-editeur',
    name: f.name.replace(/[<>"&]/g, '').slice(0, 40) || 'Carte de l\'éditeur',
    ...(f.description ? { description: f.description.replace(/[<>"&]/g, '').slice(0, 200) } : {}),
    size: n,
    players: symmetry === 'rot90' ? [2, 3, 4] : [2],
    symmetry,
    biome: PLANETS.includes(f.biome) ? f.biome : 'desert',
    terrain,
    bases: [],
  };
  // The game puts a 4×4 headquarters in a 5×5 slot, at the slot's corner nearest the minerals (maps.ts hqSlot): the
  // slot is the one whose pick is this map's headquarters, when there is one.
  map.bases = bases.map((b) => {
    const slots = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([ox, oy]) => [Math.min(n - 5, Math.max(0, b.hq[0] - ox)), Math.min(n - 5, Math.max(0, b.hq[1] - oy))] as [number, number]);
    const slot = slots.find((s) => same(hqSlot({ ...map, bases }, s), b.hq));
    if (!slot) notes.push(`QG en ${b.hq[0]}, ${b.hq[1]} : décalé d'une tuile par le jeu.`);
    return { ...b, hq: slot ?? slots[0] };
  });
  if (f.players.length > 1 && symmetry === 'rot180' && f.players.length > 2) notes.push('Symétrie 2 parts : la carte se joue à 2.');
  // Per seat: the race imposed, the starting resources and what is forbidden, when not the game's defaults.
  const seats = f.players.map((p) => ({
    ...(p.race ? { race: p.race } : {}),
    ...(p.minerals !== START.minerals ? { minerals: Math.max(0, Math.round(p.minerals)) } : {}),
    ...(p.energy !== START.energy ? { energy: Math.max(0, Math.round(p.energy)) } : {}),
    ...(p.forbid.length ? { forbid: [...new Set(p.forbid)] } : {}),
    ...(p.team === undefined ? {} : { team: p.team }),
  }));
  if (seats.some((s) => Object.keys(s).length)) map.seats = seats;
  if (f.units.length) map.units = f.units.map((u) => ({ type: u.type, owner: u.owner, at: u.at }));
  if (f.decor.length) notes.push('Pas encore lu par le jeu : le décor posé à la main.');
  return { map, notes };
}
