import type { World } from './world';

/**
 * A fingerprint of the whole simulated state, compared every few seconds between the two players' games of a network
 * match: every field of every entity (position, health, orders and the orders queued after them, production queues,
 * kits, cooldowns, timers…), every player's resources and research, and the lasting effects on the ground (scans,
 * walls, silences, storms, recalls, bodies, units coming back) and the next id. Taken field by field in the order
 * the simulation set them, which both games share. Static data (`def`) and this tick's events, already counted
 * through their effects, are left out.
 */
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
      for (const x of Object.values(v)) value(x, depth - 1);
    }
  };
  mix(world.tick);
  mix(world.winner ?? -2);
  for (const e of world.entities.values()) {
    for (const [k, v] of Object.entries(e)) if (k !== 'def') value(v, 3);
  }
  for (const p of world.players) value(p, 2);
  for (const lasting of [world.scans, world.walls, world.silences, world.storms, world.clouds, world.recalls, world.strikes, world.phaseGroups, world.corpses]) value(lasting, 3);
  // Private to the World but lasting: units coming back (Gaïa), and the next id (an entity made on one side only).
  const inside = world as unknown as { respawns: unknown; nextId: number };
  value(inside.respawns, 3);
  mix(inside.nextId);
  return h >>> 0;
}
