import { type BuildingDef, DEFS, FACTIONS, type Faction, START } from '../data';
import { createMap, rotateFootprint } from '../map';
import { FP } from './fixed';
import { World } from './world';

/** Player 0's layout; player 1 gets the same, rotated 180°. Tiles are top-left corners. */
const MAIN = { conseil: [12, 12] as const, serfs: [17, 14] as const };
const FIELDS: [number, number][] = [
  // main base
  [7, 9], [7, 10], [7, 11], [7, 12], [8, 8], [9, 7], [10, 7], [11, 7],
  // natural expansion
  [33, 25], [34, 26], [35, 27], [35, 28], [35, 29], [34, 30], [33, 31],
];
const WELLS: [number, number][] = [[17, 6], [26, 33]];
/** Council spot at the natural expansion. */
const NATURAL: [number, number] = [27, 26];
/** Which corner each player starts in, as quarter turns from the top-left: 1 v 1 stays across the map. */
export const CORNERS = [0, 2, 1, 3];

/** Natural expansion council spot (top-left tile) for a player. */
export function expansion(world: World, owner: number): [number, number] {
  return rotateFootprint(world.map.width, ...NATURAL, 5, CORNERS[owner]);
}

/**
 * A new match on the V1 map, two to four players (each its faction's headquarters and workers in its own
 * corner); `teams[i]` puts player i in a team (default: everyone alone).
 */
export function createMatch(factions: Faction[] = ['humains', 'humains'], teams?: number[], chasms = false): World {
  const world = new World(createMap(factions.length, chasms), factions.length);
  const w = world.map.width;
  const corner = (owner: number, tx: number, ty: number, size: number): [number, number] => rotateFootprint(w, tx, ty, size, CORNERS[owner]);

  for (let owner = 0; owner < factions.length; owner++) {
    for (const [tx, ty] of FIELDS) world.spawn('minerai', -1, ...px(corner(owner, tx, ty, 1)));
    for (const [tx, ty] of WELLS) world.spawn('puits', -1, ...px(corner(owner, tx, ty, 3)));
    const f = FACTIONS[factions[owner]];
    world.players[owner].faction = factions[owner];
    const hq = DEFS[f.hq] as BuildingDef;
    world.spawn(f.hq, owner, ...px(corner(owner, ...MAIN.conseil, hq.size)));
    for (let i = 0; i < START.serfs; i++) {
      const [tx, ty] = corner(owner, MAIN.serfs[0] + (i % 2), MAIN.serfs[1] + Math.floor(i / 2), 1);
      world.spawn(f.worker, owner, tx * FP + FP / 2, ty * FP + FP / 2);
    }
    world.players[owner].minerals = START.minerals;
    world.players[owner].energy = START.energy;
  }
  if (teams) world.setTeams(teams);
  return world;
}

const px = ([tx, ty]: [number, number]): [number, number] => [tx * FP, ty * FP];
