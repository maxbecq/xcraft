import { HQ_MINERAL_GAP } from './data';
import { IMPORTED, parseMap } from './mapcheck';
import { type Dir, type GameMap, RAMP_LENGTH, STEP, type Street, rotateFootprint, rotateTile } from './map';

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
  /** The planet it is played on (render/biome.ts BIOMES id): the map gives it, as a tileset does. */
  biome: string;
  terrain: Shape[];
  /** Streets painted on the ground (player 1's part, turned like the terrain). For the eye only. */
  streets?: Street[];
  bases: BaseSpot[];
}

type Area =
  | { shape: 'octagon'; at: [number, number]; half: number; cut: number; ragged?: number }
  | { shape: 'rect'; from: [number, number]; to: [number, number] }
  | { shape: 'circle'; at: [number, number]; r: number }
  /** A diagonal band: tiles where |x + y·diag − offset| ≤ half (diag 1 or −1). */
  | { shape: 'band'; diag: 1 | -1; offset: number; half: number }
  /** Tiles whose centre lies inside this outline (any shape: an island's broken coast, a natural arch). */
  | { shape: 'polygon'; points: [number, number][] };

/** `biome`: the shape only exists on that planet. */
export type Shape = (
  | (Area & { level: number; chasm?: undefined; fill?: undefined })
  /** `block`: the chasm is a block of buildings (drawn standing on it); for the eye only. */
  | (Area & { chasm: true; block?: boolean; level?: undefined; fill?: undefined })
  /** `arch`: the filled tiles are a natural arch (drawn thin over the void, its vault below); for the eye only. */
  | (Area & { fill: true; arch?: boolean; level?: undefined; chasm?: undefined })
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
      const ok = m.format === 1 && !!m.id && typeof m.biome === 'string' && m.size > 0 && m.players?.length > 0 && m.bases?.filter((b) => b.start).length === 1;
      if (!ok) console.warn(`Carte ignorée (format inconnu ou incomplet) : ${m.id ?? '?'}`);
      return ok;
    })
    .sort((a, b) => (a.id === 'origine' ? -1 : b.id === 'origine' ? 1 : a.name.localeCompare(b.name, 'fr')))
    .map((m) => [m.id, m]),
);
export const DEFAULT_MAP = 'origine';

/** Where an imported map is kept in this browser: one entry per map, its checked JSON. */
const STORE = 'xcraft.carte:';
/** Most imported maps kept. */
export const MAX_IMPORTED = 20;

/** Whether a map came from outside the game (an import, a friend's, a replay's). */
export const isImported = (def: MapFile) => def.id.startsWith(IMPORTED);

/** Maps imported earlier in this browser, checked again (storage can be edited) and listed after the game's own. */
function loadImported(): void {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (!key.startsWith(STORE)) continue;
      const def = parseMap(localStorage.getItem(key) ?? '');
      if (typeof def === 'string' || !isImported(def)) console.warn(`Carte importée illisible, ignorée : ${key}`);
      else MAPS[def.id] = def;
    }
  } catch {
    // no storage (private window, node): none imported
  }
}
loadImported();

/** A checked map made playable for this page (a replay's, a friend's on its way); `keep` also stores it for later pages. False if storage refused it. */
export function addMap(def: MapFile, keep = false): boolean {
  MAPS[def.id] = def;
  if (!keep) return true;
  try {
    localStorage.setItem(STORE + def.id, JSON.stringify(def));
    return true;
  } catch {
    return false;
  }
}

/** Forgets an imported map, here and in storage. */
export function removeMap(id: string): void {
  if (!id.startsWith(IMPORTED)) return;
  delete MAPS[id];
  try {
    localStorage.removeItem(STORE + id);
  } catch {
    // nothing kept
  }
}

/** The map with this id, or the original map (said in the console when an id was given: a network game checks it first). */
/** The main buildings' size (the balancer, 2026-11-22: 4x4, in the 5x5 slots the map files keep). */
export const HQ_SIZE = 4;

/**
 * Where a main building goes in a map file's 5x5 slot: of the corners a 4x4 may take, the one nearest the file's
 * minerals (tile to tile) that is still HQ_MINERAL_GAP away, so the miners' trips stay as short as they were (none that far:
 * the farthest), the slot's own corner first on a tie; chosen in the file's frame, then turned like the rest, so the
 * same from every corner of the map.
 */
export function hqSlot(def: MapFile, [tx, ty]: [number, number]): [number, number] {
  const minerals = def.bases.flatMap((b) => b.minerals);
  const corners: { at: [number, number]; d: number }[] = [];
  for (let oy = 0; oy <= 5 - HQ_SIZE; oy++) {
    for (let ox = 0; ox <= 5 - HQ_SIZE; ox++) {
      let d = Infinity;
      for (const [mx, my] of minerals) d = Math.min(d, Math.max(Math.max(tx + ox - mx, mx - (tx + ox + HQ_SIZE - 1), 0), Math.max(ty + oy - my, my - (ty + oy + HQ_SIZE - 1), 0)));
      corners.push({ at: [tx + ox, ty + oy], d });
    }
  }
  const fit = corners.filter((c) => c.d >= HQ_MINERAL_GAP);
  return (fit.length ? fit.reduce((a, c) => (c.d < a.d ? c : a)) : corners.reduce((a, c) => (c.d > a.d ? c : a))).at;
}

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

/** A point (not a tile: a position in tile units) turned by q quarter turns, as rotateTile turns a tile's centre. */
function turnPoint(size: number, x: number, y: number, q: number): [number, number] {
  const [rx, ry] = rotateTile(size, x - 0.5, y - 0.5, q);
  return [rx + 0.5, ry + 0.5];
}

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
      case 'polygon': {
        // Even-odd rule on the tile's centre: + − × ÷ and comparisons only, the same in every browser.
        const px = x + 0.5;
        const py = y + 0.5;
        let inPoly = false;
        const p = a.points;
        for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
          const [xi, yi] = p[i];
          const [xj, yj] = p[j];
          if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inPoly = !inPoly;
        }
        return inPoly;
      }
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
    if (s.fill && s.arch) map.arch ??= new Uint8Array(width * height);
    if (s.chasm && s.block) map.block ??= new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!inside(s, x, y)) continue;
        each(x, y, (i) => {
          if (s.chasm) {
            map.chasm![i] = 1;
            if (map.block) map.block[i] = s.block ? 1 : 0;
          } else if (s.fill) {
            if (map.chasm) map.chasm[i] = 0;
            if (map.block) map.block[i] = 0;
            if (s.arch) map.arch![i] = 1;
            else if (map.arch) map.arch[i] = 0; // an island painted over an arch's root is island
          } else {
            map.level[i] = s.level;
            map.ramp[i] = null;
            map.rampStep[i] = 0;
          }
        });
      }
    }
  }
  // Streets: player 1's, and each turned copy.
  if (def.streets) {
    map.streets = turns.flatMap((q) => def.streets!.map((s) => ({ width: s.width, points: s.points.map(([x, y]) => turnPoint(width, x, y, q)) })));
  }
  // A base in the very middle turns onto itself: one spot, shared by everyone (turn -1).
  // Matched by the file's 5x5 slot, before the 4x4 corner is picked: a shared middle slot turned stays one site.
  map.sites = [];
  const slots: [number, number][] = [];
  for (const turn of turns) {
    for (const b of def.bases) {
      const slot = rotateFootprint(width, ...b.hq, 5, turn);
      const at = slots.findIndex((s) => s[0] === slot[0] && s[1] === slot[1]);
      if (at >= 0) map.sites[at].turn = -1;
      else {
        slots.push(slot);
        map.sites.push({ hq: rotateFootprint(width, ...hqSlot(def, b.hq), HQ_SIZE, turn), turn, start: !!b.start });
      }
    }
  }
  return map;
}
