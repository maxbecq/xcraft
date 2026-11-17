import { type BuildingDef, DEFS, FACTIONS } from '../data';
import { FP } from '../sim/fixed';
import type { World } from '../sim/world';

/**
 * Title screen backdrop: a still scene set up once, with no simulation running (so no fights and no sound).
 * Each side gets its base raised round its headquarters and its army drawn up facing the other near the
 * centre; the renderer's idle animations, ambient effects and the drifting camera bring it to life.
 */
export function stageAttract(world: World): void {
  const cx = world.map.width / 2;
  const cy = world.map.height / 2;
  for (const p of world.players) {
    const f = FACTIONS[p.faction];
    const hq = [...world.entities.values()].find((e) => e.owner === p.id && e.type === f.hq);
    if (!hq) continue;
    const hx = hq.x / FP;
    const hy = hq.y / FP;
    // Base: the pylon first (Isdaris buildings stand in its field), then the rest, each on the nearest free
    // ground round the headquarters, a tile apart so the base breathes.
    const types = [f.pylon, f.supply, f.barracks, f.extractor, ...f.buildable].filter((t, i, a): t is string => !!t && t !== f.hq && a.indexOf(t) === i);
    for (const t of types) {
      const size = (DEFS[t] as BuildingDef).size;
      const spot = (DEFS[t] as BuildingDef).energyRate ? wellNear(world, t, hx, hy) : freeNear(world, t, size, hx, hy);
      if (spot) world.spawn(t, p.id, spot[0] * FP, spot[1] * FP);
    }
    // Army: in ranks a little way from the centre on its base's side, facing the centre (the renderer's default).
    const ax = cx + (hx - cx) * 0.2;
    const ay = cy + (hy - cy) * 0.2;
    const troops = f.army.flatMap(([t, n]) => Array.from({ length: n }, () => t));
    troops.forEach((t, i) => {
      const x = ax + ((i % 4) - 1.5) * 1.3;
      const y = ay + (Math.floor(i / 4) - 1) * 1.3;
      if (world.grid.open(Math.floor(x), Math.floor(y))) world.spawn(t, p.id, Math.round(x * FP), Math.round(y * FP));
    });
  }
}

/** Top-left tile of the free spot nearest (x, y) for a building, with a tile of open ground all round. */
function freeNear(world: World, type: string, size: number, x: number, y: number): [number, number] | null {
  for (let r = 4; r < 18; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = Math.round(x - size / 2) + dx;
        const ty = Math.round(y - size / 2) + dy;
        if (!world.canPlace(type, tx, ty)) continue;
        let clear = true;
        for (let j = ty - 1; j <= ty + size && clear; j++) for (let i = tx - 1; i <= tx + size && clear; i++) clear = world.grid.open(i, j);
        if (clear) return [tx, ty];
      }
    }
  }
  return null;
}

/** The free energy well nearest (x, y), for an extractor. */
function wellNear(world: World, type: string, x: number, y: number): [number, number] | null {
  const wells = [...world.entities.values()].filter((w) => w.type === 'puits' && world.canPlace(type, w.tx, w.ty));
  wells.sort((a, b) => Math.hypot(a.x / FP - x, a.y / FP - y) - Math.hypot(b.x / FP - x, b.y / FP - y));
  return wells[0] ? [wells[0].tx, wells[0].ty] : null;
}
