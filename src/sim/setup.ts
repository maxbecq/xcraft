import { DEFS, START } from '../data';
import { createMap } from '../map';
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
/** Natural expansion council spot (top-left tile) for each player. */
export const EXPANSIONS: [number, number][] = [NATURAL, [96 - NATURAL[0] - 5, 96 - NATURAL[1] - 5]];

/** A new two-player match on the V1 map. */
export function createMatch(): World {
  const world = new World(createMap());
  const { width: w, height: h } = world.map;
  const mirror = (owner: number, tx: number, ty: number, size: number): [number, number] =>
    owner === 0 ? [tx, ty] : [w - tx - size, h - ty - size];

  for (const owner of [0, 1]) {
    for (const [tx, ty] of FIELDS) world.spawn('minerai', -1, ...px(mirror(owner, tx, ty, 1)));
    for (const [tx, ty] of WELLS) world.spawn('puits', -1, ...px(mirror(owner, tx, ty, 3)));
    world.spawn('conseil', owner, ...px(mirror(owner, ...MAIN.conseil, DEFS.conseil.kind === 'building' ? DEFS.conseil.size : 5)));
    for (let i = 0; i < START.serfs; i++) {
      const [tx, ty] = mirror(owner, MAIN.serfs[0] + (i % 2), MAIN.serfs[1] + Math.floor(i / 2), 1);
      world.spawn('serf', owner, tx * FP + FP / 2, ty * FP + FP / 2);
    }
    world.players[owner].minerals = START.minerals;
    world.players[owner].energy = START.energy;
  }
  return world;
}

const px = ([tx, ty]: [number, number]): [number, number] => [tx * FP, ty * FP];
