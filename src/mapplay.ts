import { type Faction, FACTIONS } from './data';
import { CORNERS, type MapFile } from './maps';
import { FP } from './sim/fixed';
import { createMatch } from './sim/setup';
import type { World } from './sim/world';

/**
 * Whether a map from outside the game can be played, as src/maps.test.ts checks the game's own, quickly (no AI, no
 * ticks): for every player count, each player has its headquarters, every start reaches the others and every base
 * spot on foot, every free spot has room for a headquarters, every resource stands on flat ground near a base and
 * can be walked up to. Null if it can, else why not (in French). Its format is checked first (mapcheck.ts checkMap).
 */
export function unplayable(def: MapFile): string | null {
  try {
    for (const players of def.players) {
      const why = check(def, players) ?? starts(def, players);
      if (why) return `À ${players} joueurs : ${why}`;
    }
    return null;
  } catch {
    return 'la carte ne se construit pas.';
  }
}

/** Every camp's first units where createMatch puts them: within the map, walkers on open ground (Codex, 2026-11-26:
 * the Humains' alone were built, and Gaïa came out past the map's edge). */
function starts(def: MapFile, players: number): string | null {
  for (const f of Object.keys(FACTIONS) as Faction[]) {
    const m = createMatch(Array(players).fill(f), undefined, def, def.biome);
    const [W, H] = [m.map.width * FP, m.map.height * FP];
    for (const e of m.entities.values()) {
      if (e.owner < 0 || e.def.kind !== 'unit') continue;
      const off = e.x < 0 || e.y < 0 || e.x >= W || e.y >= H;
      if (off || (!('flying' in e.def && e.def.flying) && !m.grid.open(Math.floor(e.x / FP), Math.floor(e.y / FP)))) return `les premières unités des ${FACTIONS[f].name} sont hors de la carte ou sur un sol fermé (${Math.floor(e.x / FP)}, ${Math.floor(e.y / FP)}).`;
    }
  }
  return null;
}

function check(def: MapFile, players: number): string | null {
  const w = createMatch(Array(players).fill('humains'), undefined, def, def.biome);
  const hqs = [...w.entities.values()].filter((e) => e.type === 'conseil');
  if (hqs.length !== players) return "un départ n'a pas la place pour un QG.";
  const W = w.map.width;
  // Walking starts from a free tile round the first headquarters.
  const ring: [number, number][] = [];
  for (let y = hqs[0].ty - 1; y <= hqs[0].ty + 4; y++) for (let x = hqs[0].tx - 1; x <= hqs[0].tx + 4; x++) ring.push([x, y]);
  const out = ring.find(([x, y]) => w.grid.inside(x, y) && w.grid.open(x, y));
  if (!out) return `le départ en (${hqs[0].tx}, ${hqs[0].ty}) est enfermé.`;
  const from = reach(w, ...out);
  // No two things on one tile: createMatch puts them where the file says, overlapping or not.
  const taken = new Map<number, string>();
  for (const e of w.entities.values()) {
    const size = e.def.kind === 'resource' ? (e.type === 'puits' ? 3 : 1) : e.type === 'conseil' ? 4 : 0;
    const what = e.type === 'puits' ? 'le puits' : e.type === 'minerai' ? 'le minerai' : 'le QG';
    for (let y = e.ty; y < e.ty + size; y++) {
      for (let x = e.tx; x < e.tx + size; x++) {
        if (w.map.chasm?.[y * W + x]) return `${what} en (${e.tx}, ${e.ty}) est au-dessus d'un gouffre.`;
        const other = taken.get(y * W + x);
        if (other) return `${what} en (${e.tx}, ${e.ty}) chevauche ${other}.`;
        taken.set(y * W + x, `${what} en (${e.tx}, ${e.ty})`);
      }
    }
  }
  // A building's footprint is not walked on: what counts is a tile next to it.
  const beside = (tx: number, ty: number, size: number) => {
    for (let y = ty - 1; y <= ty + size; y++) for (let x = tx - 1; x <= tx + size; x++) if (x >= 0 && y >= 0 && x < W && y < w.map.height && from[y * W + x]) return true;
    return false;
  };
  for (const h of hqs) if (!beside(h.tx, h.ty, 4)) return `le départ en (${h.tx}, ${h.ty}) ne rejoint pas les autres à pied.`;
  for (const s of w.map.sites!) {
    // A start holds its headquarters (walked round, not through); a free spot is walked onto.
    const held = hqs.some((h) => h.tx === s.hq[0] && h.ty === s.hq[1]);
    if (held ? !beside(s.hq[0], s.hq[1], 4) : !from[(s.hq[1] + 2) * W + s.hq[0] + 2]) return `la base en (${s.hq[0]}, ${s.hq[1]}) n'est pas reliée aux départs.`;
    if (!(s.start && CORNERS.indexOf(s.turn) < players) && !w.canPlace('conseil', s.hq[0], s.hq[1], 0)) return `pas la place pour un QG à la base en (${s.hq[0]}, ${s.hq[1]}).`;
  }
  for (const e of w.entities.values()) {
    if (e.def.kind !== 'resource') continue;
    const size = e.type === 'puits' ? 3 : 1;
    const what = e.type === 'puits' ? 'le puits' : 'le minerai';
    if (w.grid.flatLevel(e.tx + (size >> 1), e.ty + (size >> 1)) < 0) return `${what} en (${e.tx}, ${e.ty}) n'est pas sur un sol plat.`;
    if (!w.map.sites!.some((s) => Math.hypot(s.hq[0] + 2 - (e.tx + size / 2), s.hq[1] + 2 - (e.ty + size / 2)) < 12)) return `${what} en (${e.tx}, ${e.ty}) est trop loin de toute base.`;
    if (!beside(e.tx, e.ty, size)) return `${what} en (${e.tx}, ${e.ty}) ne s'atteint pas à pied.`;
  }
  // The units the match starts with (workers, a faction's own): on the map, and able to walk to the others.
  for (const e of w.entities.values()) {
    if (e.def.kind !== 'unit') continue;
    const [x, y] = [Math.floor(e.x / FP), Math.floor(e.y / FP)];
    const where = `${e.def.name} du joueur ${e.owner + 1} en (${x}, ${y})`;
    if (!w.grid.inside(x, y)) return `${where} est hors de la carte.`;
    if (!(e.def as { flying?: boolean }).flying && !from[y * W + x]) return `${where} ne rejoint pas les autres à pied.`;
  }
  return null;
}

/** Tiles a ground unit reaches from (x, y), walking round what stands on the map (headquarters, resources). */
function reach(w: World, x: number, y: number): Uint8Array {
  const g = w.grid;
  const seen = new Uint8Array(g.width * g.height);
  const todo = [y * g.width + x];
  seen[todo[0]] = 1;
  while (todo.length) {
    const i = todo.pop()!;
    const [ax, ay] = [i % g.width, Math.floor(i / g.width)];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = (ay + dy) * g.width + ax + dx;
      if (g.inside(ax + dx, ay + dy) && !seen[j] && g.canStep(ax, ay, ax + dx, ay + dy)) { // round buildings and resources, as a unit
        seen[j] = 1;
        todo.push(j);
      }
    }
  }
  return seen;
}
