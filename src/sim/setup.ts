import { type BuildingDef, DEFS, FACTIONS, type Faction, START } from '../data';
import { rotateFootprint } from '../map';
import { CORNERS, DEFAULT_MAP, type MapFile, buildMap, hqSlot, mapFile, turnsOf } from '../maps';
import { FP } from './fixed';
import { Scenario } from './scenario';
import { World } from './world';

export { CORNERS };

/**
 * Base spots a player can expand to, best first: its own quarter's in the map file's order, then the others
 * (other quarters', and the starts of empty seats) nearest its start first. Spots nearer another player's start
 * than its own are left out: they are someone else's.
 */
export function expansions(world: World, owner: number): [number, number][] {
  const sites = world.map.sites ?? [];
  const turn = CORNERS[owner];
  const seated = new Set(world.players.map((p) => CORNERS[p.id]));
  const home = sites.find((s) => s.start && s.turn === turn)?.hq ?? [0, 0];
  const own = sites.filter((s) => s.turn === turn && !s.start);
  const d = (s: { hq: [number, number] }, from = home) => Math.abs(s.hq[0] - from[0]) + Math.abs(s.hq[1] - from[1]);
  const others = sites.filter((s) => s.start && s.turn !== turn && seated.has(s.turn)).map((s) => s.hq);
  const far = sites.filter((s) => s.turn !== turn && !(s.start && seated.has(s.turn)) && others.every((o) => d(s, o) >= d(s)));
  // Equally far: the one left of the line from home to the map's middle (the map file's order is the same from every
  // corner, so the two sides of a four-player map came in one order for one corner and the other for its opposite).
  const half = ((DEFS[FACTIONS[world.players[owner].faction]?.hq] as BuildingDef | undefined)?.size ?? 0) / 2;
  const [mx, my] = [world.map.width / 2 - home[0] - half, world.map.height / 2 - home[1] - half];
  const left = (s: { hq: [number, number] }) => (mx * (s.hq[1] - home[1]) - my * (s.hq[0] - home[0]) < 0 ? 0 : 1);
  return [...own, ...far.sort((a, b) => d(a) - d(b) || left(a) - left(b))].map((s) => s.hq);
}

/** A player's start headquarters spot (top-left tile), from the map file. */
export function startSite(world: World, owner: number): [number, number] | undefined {
  return (world.map.sites ?? []).find((s) => s.start && s.turn === CORNERS[owner])?.hq;
}

/** The natural expansion's headquarters spot (top-left tile) for a player. */
export function expansion(world: World, owner: number): [number, number] {
  return expansions(world, owner)[0];
}

/**
 * A new match on a map (an id from public/maps/), two to four players, each with its faction's headquarters and
 * workers on its start; `teams[i]` puts player i in a team (default: everyone alone). `biome` picks the shapes
 * meant for that planet only.
 */
export function createMatch(factions: Faction[] = ['humains', 'humains'], teams?: number[], mapId: string | MapFile = DEFAULT_MAP, biome = ''): World {
  const def = typeof mapId === 'string' ? mapFile(mapId) : mapId; // a map not listed (yet): an imported one being checked
  factions = seatFactions(def, factions);
  const world = new World(buildMap(def, factions.length, biome), factions.length);
  const w = world.map.width;
  const at = (q: number, tx: number, ty: number, size: number): [number, number] => rotateFootprint(w, tx, ty, size, q);
  const start = def.bases.find((b) => b.start)!;
  // All minerals, then all wells, of a quarter: ids in the same order as the original map always had.
  // Resources a turn brings onto themselves (a ring round the middle) are placed once.
  const placed = new Set<string>();
  const put = (type: string, [tx, ty]: [number, number]) => {
    if (placed.has(`${tx},${ty}`)) return;
    placed.add(`${tx},${ty}`);
    world.spawn(type, -1, ...px([tx, ty]));
  };
  const resources = (q: number) => {
    for (const b of def.bases) for (const [tx, ty] of b.minerals) put('minerai', at(q, tx, ty, 1));
    for (const b of def.bases) for (const [tx, ty] of b.wells) put('puits', at(q, tx, ty, 3));
  };

  for (let owner = 0; owner < factions.length; owner++) {
    const q = CORNERS[owner];
    resources(q);
    const f = FACTIONS[factions[owner]];
    world.players[owner].faction = factions[owner];
    const hq = DEFS[f.hq] as BuildingDef;
    // In the map's 5x5 slot, the 4x4 at its corner farthest from the minerals (the balancer, 2026-11-22).
    world.spawn(f.hq, owner, ...px(at(q, ...hqSlot(def, start.hq), hq.size)));
    const [wx, wy] = start.workers ?? [start.hq[0] + 5, start.hq[1] + 2];
    for (let i = 0; i < START.serfs; i++) {
      const [tx, ty] = at(q, wx + (i % 2), wy + Math.floor(i / 2), 1);
      world.spawn(f.worker, owner, tx * FP + FP / 2, ty * FP + FP / 2);
    }
    // Dieux: Gaïa is there from the start, by the workers.
    for (const [i, type] of (f.start ?? []).entries()) {
      const [tx, ty] = at(q, wx + 3 + i * 3, wy + 1, 1);
      world.spawn(type, owner, tx * FP + FP / 2, ty * FP + FP / 2);
    }
    const rules = def.seats?.[owner];
    world.players[owner].minerals = rules?.minerals ?? START.minerals;
    world.players[owner].energy = rules?.energy ?? START.energy;
    if (rules?.forbid?.length) world.players[owner].forbid = rules.forbid;
  }
  // Quarters nobody starts in keep their resources: free bases to take.
  for (const q of turnsOf(def, factions.length)) if (!CORNERS.slice(0, factions.length).includes(q)) resources(q);
  // Units and buildings the map places, after everything else (a map without any keeps its ids as they were).
  for (const u of def.units ?? []) {
    if (u.owner >= factions.length) continue;
    const d = DEFS[u.type];
    if (d.kind === 'unit') world.spawn(u.type, u.owner, u.at[0] * FP + FP / 2, u.at[1] * FP + FP / 2);
    else world.spawn(u.type, u.owner, ...px(u.at));
  }
  // Teams a map imposes win over the caller's, as its races do (the game's page does the same: config.ts).
  if (def.seats?.some((s) => s.team !== undefined)) teams = factions.map((_, i) => def.seats?.[i]?.team ?? teams?.[i] ?? i);
  if (teams) world.setTeams(teams);
  if (def.triggers?.triggers.length) world.scenario = new Scenario(def.triggers);
  return world;
}

/** The factions as the map has them: a seat's imposed race over the one picked. */
export function seatFactions(def: MapFile, factions: Faction[]): Faction[] {
  return factions.map((f, i) => def.seats?.[i]?.race ?? f);
}

const px = ([tx, ty]: [number, number]): [number, number] => [tx * FP, ty * FP];
