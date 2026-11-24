import { describe, expect, it } from 'vitest';
import { DEFS, type BuildingDef } from '../data';
import { type Dir, type GameMap } from '../map';
import { FP, tileOf, ticks } from './fixed';
import { World } from './world';

/**
 * A plateau (rows above CLIFF, level 1) over low ground (level 0), joined by a two-tile ramp far east. A worker that
 * mined a field at the cliff's foot, with its headquarters on the plateau above, kept the goal of its way to the field
 * (point 109): goNear never planned the way back, follow said it had arrived, and it walked straight into the cliff
 * until movement cleared the goal ten ticks later.
 */
const [W, H, CLIFF, RAMP_X] = [48, 40, 20, 34];
function plateauMap(): GameMap {
  const level = new Uint8Array(W * H);
  const ramp: (Dir | null)[] = new Array(W * H).fill(null);
  const rampStep = new Uint8Array(W * H);
  for (let y = 0; y < CLIFF; y++) level.fill(1, y * W, (y + 1) * W);
  for (let y = CLIFF; y < CLIFF + 4; y++)
    for (let x = RAMP_X; x < RAMP_X + 2; x++) {
      ramp[y * W + x] = 'N';
      rampStep[y * W + x] = y - CLIFF;
    }
  return { width: W, height: H, level, ramp, rampStep };
}

describe('a worker back from a field below the cliff its headquarters stands on', () => {
  it('takes the ramp, never pressing against the cliff', () => {
    const w = new World(plateauMap(), 2);
    const size = (DEFS.conseil as BuildingDef).size;
    w.spawn('conseil', 0, (10 + size / 2) * FP, (12 + size / 2) * FP);
    const field = w.spawn('minerai', -1, 12 * FP, (CLIFF + 1) * FP);
    const serf = w.spawn('serf', 0, 12 * FP + FP / 2, (CLIFF + 3) * FP + FP / 2);
    w.step([{ player: 0, kind: 'smart', ids: [serf.id], x: field.x, y: field.y, target: field.id }]);
    const carrying = () => serf.order?.kind === 'gather' && serf.order.phase === 'return';
    while (w.tick < ticks(30) && !carrying()) w.step([]);
    expect(carrying()).toBe(true);
    const minerals = w.players[0].minerals;
    let blocked = 0;
    let ramp = false;
    while (w.tick < ticks(90) && w.players[0].minerals === minerals) {
      w.step([]);
      blocked = Math.max(blocked, serf.blockedTicks);
      const [tx, ty] = [tileOf(serf.x), tileOf(serf.y)];
      if (tx >= RAMP_X && tx < RAMP_X + 2 && ty >= CLIFF && ty < CLIFF + 4) ramp = true;
    }
    expect(w.players[0].minerals).toBeGreaterThan(minerals);
    expect(ramp).toBe(true);
    expect(blocked).toBe(0);
  });
});
