import type { World } from './world';

/**
 * A fingerprint of the whole simulated state, compared every few seconds between the two players' games of a network
 * match: every field of every entity (position, health, orders and the orders queued after them, production queues,
 * kits, cooldowns, timers…), every player's resources and research, and the lasting effects on the ground (scans,
 * walls, silences, storms, recalls, bodies, units coming back) and the next id. Static data (`def`) and this tick's
 * events, already counted through their effects, are left out.
 * Every object counts by its keys as well as its values, keys in sorted order (two research tables with the same levels
 * under other names differ); and the lasting grids count too: the tiles blocked (walls, buildings) and each player's
 * explored tiles.
 */

/** Each key's own number, worked out once. */
const KEYS = new Map<string, number>();
function keyOf(k: string): number {
  let n = KEYS.get(k);
  if (n === undefined) {
    n = 2166136261;
    for (let i = 0; i < k.length; i++) n = Math.imul(n ^ k.charCodeAt(i), 16777619);
    KEYS.set(k, n);
  }
  return n;
}
export function fingerprint(world: World): number {
  let h = 2166136261;
  const mix = (v: number) => {
    h = Math.imul(h ^ v, 16777619);
  };
  const value = (v: unknown, depth: number): void => {
    if (typeof v === 'number') {
      mix(v | 0);
      if (!Number.isInteger(v)) mix((v * 4096) | 0); // a fraction counts too
    } else if (typeof v === 'string') {
      mix(v.length);
      for (let i = 0; i < v.length; i++) mix(v.charCodeAt(i));
    } else if (typeof v === 'boolean') mix(v ? 3 : 5);
    else if (v === null || v === undefined) mix(7);
    else if (depth > 0 && Array.isArray(v)) {
      mix(v.length);
      for (const x of v) value(x, depth - 1);
    } else if (depth > 0 && typeof v === 'object') {
      fields(v as Record<string, unknown>, depth - 1);
    }
  };
  const fields = (o: Record<string, unknown>, depth: number, skip?: string): void => {
    const keys = Object.keys(o).sort();
    mix(keys.length);
    for (const k of keys) {
      if (k === skip) continue;
      mix(keyOf(k));
      value(o[k], depth);
    }
  };
  const tiles = (t: ArrayLike<number>) => {
    mix(t.length);
    for (let i = 0; i < t.length; i++) mix(t[i]);
  };
  mix(world.tick);
  mix(world.winner ?? -2);
  for (const e of world.entities.values()) fields(e as unknown as Record<string, unknown>, 3, 'def');
  for (const p of world.players) value(p, 2);
  tiles(world.grid.blocked);
  for (const v of world.vision) tiles(v.tiles);
  for (const lasting of [world.scans, world.walls, world.silences, world.storms, world.clouds, world.recalls, world.strikes, world.phaseGroups, world.corpses, world.tunnels, world.redeploys, world.rains]) value(lasting, 3);
  // Private to the World but lasting: units coming back (Gaïa), and the next id (an entity made on one side only).
  const inside = world as unknown as { respawns: unknown; nextId: number };
  value(inside.respawns, 3);
  mix(inside.nextId);
  // A map's triggers: their variables and what they remember (a match without any has none, its print unchanged).
  if (world.scenario) value(world.scenario.state(), 4);
  return h >>> 0;
}
