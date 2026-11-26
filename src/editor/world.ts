import { DEFS, FACTIONS, START } from '../data';
import type { GameMap } from '../map';
import { FP } from '../sim/fixed';
import { World } from '../sim/world';
import type { MapFile2 } from './format2';

/**
 * A still world for the editor's view: resources, each seat's headquarters and workers, and the units and buildings
 * placed by hand. Built through the simulation's own spawn (nothing in src/sim changes); never stepped.
 * Returns what could not be placed (an unknown type, a building off the map).
 */
export function previewWorld(f: MapFile2, map: GameMap): { world: World; skipped: string[] } {
  const world = new World(map, f.players.length);
  const skipped: string[] = [];
  const put = (type: string, owner: number, [tx, ty]: [number, number]) => {
    const def = DEFS[type];
    if (!def || def.kind === 'upgrade') return skipped.push(type);
    const size = def.kind === 'unit' ? 0 : def.size;
    if (tx + size > map.width || ty + size > map.height) return skipped.push(type);
    try {
      if (size) world.spawn(type, owner, tx * FP, ty * FP);
      else world.spawn(type, owner, tx * FP + FP / 2, ty * FP + FP / 2);
    } catch {
      skipped.push(type);
    }
  };
  for (const m of f.minerals) put('minerai', -1, m);
  for (const w of f.wells) put('puits', -1, w);
  f.players.forEach((p, i) => {
    const race = FACTIONS[p.race || 'humains']; // a race left to the player: shown as Humains
    world.players[i].faction = p.race || 'humains';
    world.players[i].minerals = p.minerals;
    world.players[i].energy = p.energy;
    put(race.hq, i, p.start);
    // The workers east of the headquarters, as the game puts them (setup.ts: hq slot + 5, 2 rows of two).
    for (let k = 0; k < START.serfs; k++) put(race.worker, i, [p.start[0] + 5 + (k % 2), p.start[1] + Math.floor(k / 2)]);
    for (const [k, type] of (race.start ?? []).entries()) put(type, i, [p.start[0] + 8 + k * 3, p.start[1] + 1]);
  });
  for (const u of f.units) put(u.type, u.owner, u.at);
  return { world, skipped };
}
