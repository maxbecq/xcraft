import { RAMP_LENGTH, STEP, type Street } from './map';
import { DEFS, FACTIONS, type Faction } from './data';
import type { BaseSpot, MapFile, PlacedUnit, SeatRules, Shape } from './maps';
import { readTriggers, triggerProblems, type Triggers } from './sim/triggers';

/**
 * A map from outside the game (a file the player imports, a friend's map over the network, the one a replay carries):
 * untrusted data, checked field by field and copied, only what the format knows, before anything builds it. The
 * reason in French when it is refused.
 */

/** Largest map file taken, in characters (the game's own are 2 to 8 KB). */
export const MAP_MAX_CHARS = 64 * 1024;
/** The planets a map may name (render/biome.ts BIOMES; a test keeps the two lists the same). */
export const PLANETS = ['desert', 'lune', 'alien', 'glace', 'volcan', 'asteroides', 'villenuit', 'ville'];
const MIN_SIZE = 32;
const MAX_SIZE = 160;
const MAX_SHAPES = 300;
const MAX_POINTS = 256;
const MAX_BASES = 16;
const MAX_MINERALS = 32;
const MAX_WELLS = 4;
const MAX_CALM = 64;
const MAX_STREETS = 64;
const MAX_SEATS = 4;
/** Starting minerals or energy a map may give a seat. */
const MAX_START = 100_000;
const MAX_FORBID = 300;
const MAX_UNITS = 200;
/** Prefix of an imported map's id: never the id of one of the game's own. */
export const IMPORTED = 'import-';
/** Longest map id, once kept (imported prefix, a friend's copy's suffix): the one bound the waiting room (net.ts) takes too. */
export const MAX_MAP_ID = 40;

class Refused extends Error {}
const refuse = (why: string): never => {
  throw new Refused(why);
};
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A whole number in [lo, hi]. */
function int(v: unknown, lo: number, hi: number, what: string): number {
  if (!Number.isInteger(v) || (v as number) < lo || (v as number) > hi) refuse(`${what} : un nombre entier de ${lo} à ${hi} est attendu.`);
  return v as number;
}
/** A number (fractions allowed: polygon points, octagon centres) in [lo, hi]. */
function num(v: unknown, lo: number, hi: number, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) refuse(`${what} : un nombre de ${lo} à ${hi} est attendu.`);
  return v as number;
}
function text(v: unknown, max: number, what: string): string {
  // Shown in the menus' markup (a card's title attribute too): none of the characters that could open a tag or an attribute.
  if (typeof v !== 'string' || v.length > max || /[<>"&]/.test(v)) refuse(`${what} : un texte de ${max} caractères au plus, sans < > " ni &, est attendu.`);
  return v as string;
}
function list(v: unknown, max: number, what: string, min = 0): unknown[] {
  if (!Array.isArray(v) || v.length < min || v.length > max) refuse(`${what} : une liste de ${min} à ${max} éléments est attendue.`);
  return v as unknown[];
}
function only(o: Record<string, unknown>, keys: string[], what: string): void {
  const extra = Object.keys(o).find((k) => !keys.includes(k));
  if (extra !== undefined) refuse(`${what} : champ inconnu « ${extra.slice(0, 30)} ».`);
}
/** A tile [x, y] inside the map (a footprint of `foot` tiles must fit). */
function tile(v: unknown, size: number, what: string, foot = 1): [number, number] {
  const p = list(v, 2, what, 2);
  return [int(p[0], 0, size - foot, `${what} (x)`), int(p[1], 0, size - foot, `${what} (y)`)];
}
/** A point [x, y] within the map's square (fractions allowed). */
function point(v: unknown, size: number, what: string): [number, number] {
  const p = list(v, 2, what, 2);
  return [num(p[0], 0, size, `${what} (x)`), num(p[1], 0, size, `${what} (y)`)];
}

/** An optional true/false field, copied only when given. */
function flag(v: Record<string, unknown>, k: string, what: string): Record<string, boolean> {
  if (v[k] === undefined) return {};
  if (typeof v[k] !== 'boolean') refuse(`${what} : « ${k} » vaut true ou false.`);
  return { [k]: v[k] as boolean };
}

function shape(v: unknown, size: number, n: number): Shape {
  const what = `Forme ${n + 1}`;
  if (!isRecord(v)) return refuse(`${what} : un objet est attendu.`);
  const biome = v.biome === undefined ? undefined : PLANETS.includes(v.biome as string) ? (v.biome as string) : refuse(`${what} : planète inconnue.`);
  const tail = biome ? { biome } : {};
  if (v.shape === 'ramp') {
    only(v, ['shape', 'at', 'up', 'width', 'level', 'biome'], what);
    if (!['N', 'E', 'S', 'W'].includes(v.up as string)) refuse(`${what} : « up » vaut N, E, S ou W.`);
    const ramp = { shape: 'ramp' as const, at: tile(v.at, size, `${what}, at`), up: v.up as 'N', width: int(v.width, 1, 12, `${what}, width`), level: int(v.level, 0, 1, `${what}, level`), ...tail };
    // Every tile it covers on the map (maps.ts buildMap paints them all), not its anchor only.
    const [dx, dy] = STEP[ramp.up];
    for (let k = 0; k < RAMP_LENGTH; k++) {
      for (let w = 0; w < ramp.width; w++) {
        const [x, y] = [ramp.at[0] - dx * k + (dx === 0 ? w : 0), ramp.at[1] - dy * k + (dy === 0 ? w : 0)];
        if (x < 0 || y < 0 || x >= size || y >= size) refuse(`${what} : la rampe sort de la carte.`);
      }
    }
    return ramp;
  }
  // Every other shape is an area that raises the ground, digs a chasm or fills one.
  const kinds = ['level', 'chasm', 'fill'].filter((k) => v[k] !== undefined);
  if (kinds.length !== 1) refuse(`${what} : il faut exactement un de « level », « chasm » ou « fill ».`);
  const effect =
    kinds[0] === 'level' ? { level: int(v.level, 0, 2, `${what}, level`) }
    : kinds[0] === 'chasm' ? (v.chasm === true ? { chasm: true as const, ...flag(v, 'block', what) } : refuse(`${what} : « chasm » vaut true.`))
    : v.fill === true ? { fill: true as const, ...flag(v, 'arch', what) }
    : refuse(`${what} : « fill » vaut true.`);
  const common = ['shape', 'level', 'chasm', 'fill', 'biome', ...(kinds[0] === 'fill' ? ['arch'] : kinds[0] === 'chasm' ? ['block'] : [])];
  let area;
  switch (v.shape) {
    case 'octagon':
      only(v, [...common, 'at', 'half', 'cut', 'ragged'], what);
      area = { shape: 'octagon' as const, at: point(v.at, size, `${what}, at`), half: num(v.half, 0, size, `${what}, half`), cut: num(v.cut, 0, size, `${what}, cut`), ...(v.ragged === undefined ? {} : { ragged: num(v.ragged, -1000, 1000, `${what}, ragged`) }) };
      break;
    case 'rect':
      only(v, [...common, 'from', 'to'], what);
      area = { shape: 'rect' as const, from: tile(v.from, size, `${what}, from`), to: tile(v.to, size, `${what}, to`) };
      break;
    case 'circle':
      only(v, [...common, 'at', 'r'], what);
      area = { shape: 'circle' as const, at: point(v.at, size, `${what}, at`), r: num(v.r, 0, size, `${what}, r`) };
      break;
    case 'band':
      only(v, [...common, 'diag', 'offset', 'half'], what);
      if (v.diag !== 1 && v.diag !== -1) refuse(`${what} : « diag » vaut 1 ou -1.`);
      area = { shape: 'band' as const, diag: v.diag as 1 | -1, offset: num(v.offset, -2 * size, 2 * size, `${what}, offset`), half: num(v.half, 0, size, `${what}, half`) };
      break;
    case 'polygon':
      only(v, [...common, 'points'], what);
      area = { shape: 'polygon' as const, points: list(v.points, MAX_POINTS, `${what}, points`, 3).map((p, i) => point(p, size, `${what}, point ${i + 1}`)) };
      break;
    default:
      return refuse(`${what} : forme inconnue (octagon, rect, circle, band, polygon ou ramp).`);
  }
  return { ...area, ...effect, ...tail } as Shape;
}

function street(v: unknown, size: number, n: number): Street {
  const what = `Rue ${n + 1}`;
  if (!isRecord(v)) return refuse(`${what} : un objet est attendu.`);
  only(v, ['points', 'width'], what);
  return { points: list(v.points, MAX_POINTS, `${what}, points`, 2).map((p, i) => point(p, size, `${what}, point ${i + 1}`)), width: num(v.width, 1, 20, `${what}, width`) };
}

function base(v: unknown, size: number, n: number): BaseSpot {
  const what = `Base ${n + 1}`;
  if (!isRecord(v)) return refuse(`${what} : un objet est attendu.`);
  only(v, ['name', 'start', 'hq', 'workers', 'minerals', 'wells'], what);
  if (v.start !== undefined && typeof v.start !== 'boolean') refuse(`${what} : « start » vaut true ou false.`);
  return {
    ...(v.name === undefined ? {} : { name: text(v.name, 40, `${what}, name`) }),
    ...(v.start ? { start: true } : {}),
    hq: tile(v.hq, size, `${what}, hq`, 5),
    ...(v.workers === undefined ? {} : { workers: tile(v.workers, size, `${what}, workers`) }),
    minerals: list(v.minerals, MAX_MINERALS, `${what}, minerals`).map((p, i) => tile(p, size, `${what}, minerai ${i + 1}`)),
    wells: list(v.wells, MAX_WELLS, `${what}, wells`).map((p, i) => tile(p, size, `${what}, puits ${i + 1}`, 3)),
  };
}

function seat(v: unknown, n: number): SeatRules {
  const what = `Joueur ${n + 1}`;
  if (!isRecord(v)) return refuse(`${what} : un objet est attendu.`);
  only(v, ['race', 'minerals', 'energy', 'forbid', 'team'], what);
  if (v.race !== undefined && !Object.hasOwn(FACTIONS, v.race as string)) refuse(`${what} : race inconnue (${Object.keys(FACTIONS).join(', ')}).`);
  const forbid = v.forbid === undefined ? undefined : list(v.forbid, MAX_FORBID, `${what}, forbid`).map((t, i) => {
    if (typeof t !== 'string' || !Object.hasOwn(DEFS, t) || DEFS[t].kind === 'resource') refuse(`${what}, interdit ${i + 1} : unité, bâtiment ou recherche inconnu.`);
    return t as string;
  });
  if (forbid && new Set(forbid).size !== forbid.length) refuse(`${what} : un interdit en double.`);
  return {
    ...(v.race === undefined ? {} : { race: v.race as Faction }),
    ...(v.minerals === undefined ? {} : { minerals: int(v.minerals, 0, MAX_START, `${what}, minerals`) }),
    ...(v.energy === undefined ? {} : { energy: int(v.energy, 0, MAX_START, `${what}, energy`) }),
    ...(forbid?.length ? { forbid } : {}),
    ...(v.team === undefined ? {} : { team: int(v.team, 0, MAX_SEATS - 1, `${what}, team`) }),
  };
}

/** A triggers table (sim/triggers.ts): its shape and bounds, then every reference (a region, variable or trigger named must exist). */
function triggers(v: unknown, size: number, players: number): Triggers {
  try {
    const t = readTriggers(v, size, players);
    const wrong = triggerProblems(t, size, players);
    if (wrong.length) throw new Error(`Déclencheurs : ${wrong[0].replace(/\.$/, '')}`);
    return t;
  } catch (e) {
    return refuse(`« triggers » : ${(e as Error).message}`);
  }
}

function placed(v: unknown, size: number, n: number): PlacedUnit {
  const what = `Unité placée ${n + 1}`;
  if (!isRecord(v)) return refuse(`${what} : un objet est attendu.`);
  only(v, ['type', 'owner', 'at'], what);
  const d = typeof v.type === 'string' && Object.hasOwn(DEFS, v.type) ? DEFS[v.type] : undefined;
  if (!d || (d.kind !== 'unit' && d.kind !== 'building')) return refuse(`${what} : unité ou bâtiment inconnu.`);
  return { type: v.type as string, owner: int(v.owner, -1, MAX_SEATS - 1, `${what}, owner`), at: tile(v.at, size, `${what}, at`, d.kind === 'building' ? d.size : 1) };
}

/** A checked copy of a map, or why it is refused. `id` keeps its own (the game's maps, a replay's) or takes the imported prefix. */
export function checkMap(v: unknown, prefix = true): MapFile | string {
  try {
    if (!isRecord(v)) return refuse("Ce n'est pas une carte Xcraft (un objet JSON est attendu).");
    only(v, ['format', 'id', 'name', 'description', 'size', 'players', 'symmetry', 'biome', 'calm', 'terrain', 'streets', 'bases', 'seats', 'units', 'triggers'], 'Carte');
    if (v.format !== 1) refuse('Format de carte inconnu (« format » vaut 1).');
    // A file's own id up to 32; once kept, the prefix and maybe a friend's copy's suffix (maps.ts receiveMap) come on top,
    // within MAX_MAP_ID in all.
    if (typeof v.id !== 'string' || v.id.length > MAX_MAP_ID || !/^[a-z0-9-]+$/.test(v.id)) refuse('« id » : de 1 à 32 lettres minuscules, chiffres ou tirets.');
    const own = (v.id as string).startsWith(IMPORTED);
    if (!own && (v.id as string).length > 32) refuse('« id » : de 1 à 32 lettres minuscules, chiffres ou tirets.');
    const id = prefix && !own ? IMPORTED + (v.id as string) : (v.id as string);
    const size = int(v.size, MIN_SIZE, MAX_SIZE, '« size »');
    const players = list(v.players, 3, '« players »', 1).map((p) => int(p, 2, 4, '« players »'));
    if (new Set(players).size !== players.length) refuse('« players » : chaque nombre de joueurs une seule fois.');
    if (!['rot180', 'rot90', 'auto'].includes(v.symmetry as string)) refuse('« symmetry » vaut rot180, rot90 ou auto.');
    if (!PLANETS.includes(v.biome as string)) refuse(`« biome » : planète inconnue (${PLANETS.join(', ')}).`);
    const bases = list(v.bases, MAX_BASES, '« bases »', 1).map((b, i) => base(b, size, i));
    if (bases.filter((b) => b.start).length !== 1) refuse('Il faut exactement une base de départ (« start »: true).');
    return {
      format: 1,
      id,
      name: text(v.name, 40, '« name »') || refuse('« name » ne peut pas être vide.'),
      ...(v.description === undefined ? {} : { description: text(v.description, 200, '« description »') }),
      size,
      players,
      symmetry: v.symmetry as MapFile['symmetry'],
      biome: v.biome as string,
      ...(v.calm === undefined ? {} : { calm: list(v.calm, MAX_CALM, '« calm »').map((p, i) => point(p, size, `« calm » ${i + 1}`)) }),
      terrain: list(v.terrain, MAX_SHAPES, '« terrain »').map((s, i) => shape(s, size, i)),
      ...(v.streets === undefined ? {} : { streets: list(v.streets, MAX_STREETS, '« streets »').map((s, i) => street(s, size, i)) }),
      bases,
      ...(v.seats === undefined ? {} : { seats: list(v.seats, MAX_SEATS, '« seats »').map((p, i) => seat(p, i)) }),
      ...(v.units === undefined ? {} : { units: list(v.units, MAX_UNITS, '« units »').map((u, i) => placed(u, size, i)) }),
      ...(v.triggers === undefined ? {} : { triggers: triggers(v.triggers, size, Math.max(...players)) }),
    };
  } catch (e) {
    if (e instanceof Refused) return e.message;
    throw e;
  }
}

/** A map file's text, checked: the map, or why it is refused. */
export function parseMap(json: string): MapFile | string {
  if (json.length > MAP_MAX_CHARS) return `Fichier trop gros pour une carte (${Math.ceil(MAP_MAX_CHARS / 1024)} Ko au plus).`;
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return "Ce fichier n'est pas du JSON lisible.";
  }
  const def = checkMap(v);
  // What is kept and sent is the checked copy written again (numbers may grow: 1e-6 is 0.000001): it must read back.
  if (typeof def !== 'string' && JSON.stringify(def).length > MAP_MAX_CHARS) return `Carte trop grosse une fois relue (${Math.ceil(MAP_MAX_CHARS / 1024)} Ko au plus).`;
  return def;
}

/** Eight hex digits that tell two maps apart by what they hold, not their id (FNV-1a over the checked copy): both sides of a network game compare them. */
export function mapPrint(def: MapFile): string {
  const s = JSON.stringify({ ...def, id: '' });
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}
