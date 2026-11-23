import { describe, expect, it } from 'vitest';
import { DEFS, type UnitDef } from '../data';
import { CLIFF_FOOT } from '../map';
import { FP, ticks } from './fixed';
import { fingerprint } from './fingerprint';
import { createMatch } from './setup';

// Units sunk in the cliffs (équilibreur 22/11): only a unit's centre was tested against the terrain, so its body
// walked half into the rock at a cliff's foot. Now the body keeps out of the band CLIFF_FOOT wide at the foot, where
// the rock's slope is drawn.
describe('cliffs', () => {
  const KEEP = Math.trunc((FP * 45) / 100);
  const BAND = Math.round(CLIFF_FOOT * FP);
  /** Four low tiles in a row, each with a higher plateau north of it and open ground south. */
  const foot = (w: ReturnType<typeof createMatch>): [number, number] => {
    const g = w.grid;
    for (let ty = 2; ty < w.map.height - 3; ty++) {
      for (let tx = 2; tx < w.map.width - 8; tx++) {
        let ok = true;
        for (let i = 0; i < 4 && ok; i++) {
          const l = g.flatLevel(tx + i, ty);
          ok = l >= 0 && g.open(tx + i, ty) && g.open(tx + i, ty + 1) && g.flatLevel(tx + i, ty + 1) === l && g.level(tx + i, ty - 1) > l && !g.canStep(tx + i, ty, tx + i, ty - 1, true);
        }
        if (ok) return [tx, ty];
      }
    }
    throw new Error('no cliff foot');
  };
  const big = Object.keys(DEFS).find((k) => DEFS[k].kind === 'unit' && (DEFS[k] as UnitDef).radius >= 0.6 && !(DEFS[k] as UnitDef).flying && (DEFS[k] as UnitDef).faction === 'humains')!;

  const run = () => {
    const w = createMatch(['humains', 'humains']);
    const [tx, ty] = foot(w);
    const edge = ty * FP;
    const a = w.spawn(big, 0, tx * FP + FP / 2, edge + FP - 30);
    const b = w.spawn(big, 0, (tx + 2) * FP + FP / 2, edge + FP - 30);
    let least = FP;
    // Sent along the foot, hard against the wall, through an idle unit it shoves aside.
    w.step([{ player: 0, kind: 'move', ids: [a.id], x: (tx + 3) * FP + FP / 2, y: edge + 1 }]);
    for (let i = 0; i < 400; i++) {
      w.step([]);
      least = Math.min(least, a.y - edge, b.y - edge);
    }
    return { least, r: BAND + Math.min(a.radius, KEEP), print: fingerprint(w), arrived: a.x > (tx + 3) * FP };
  };

  it('a unit walked along a cliff\'s foot, or shoved against it, keeps its body out of the band at the foot', () => {
    const r = run();
    expect(r.arrived).toBe(true);
    expect(r.least).toBeGreaterThanOrEqual(r.r);
  });

  it('the same game twice: the same fingerprint (lockstep)', () => {
    expect(run().print).toBe(run().print);
  });

  it('a unit already standing in the band (an old replay, a saved game) walks out of it, along the wall or away', () => {
    for (const away of [false, true]) {
      const w = createMatch(['humains', 'humains']);
      const [tx, ty] = foot(w);
      const a = w.spawn(big, 0, tx * FP + FP / 2, ty * FP + 50);
      const [gx, gy] = away ? [tx * FP + FP / 2, (ty + 1) * FP + FP / 2] : [(tx + 3) * FP + FP / 2, ty * FP + 50];
      w.step([{ player: 0, kind: 'move', ids: [a.id], x: gx, y: gy }]);
      for (let i = 0; i < 300 && a.order; i++) w.step([]);
      expect(a.order, `away ${away}`).toBeNull();
      expect(Math.abs(a.x - gx) + (away ? Math.abs(a.y - gy) : 0), `away ${away}`).toBeLessThan(FP);
      expect(a.y - ty * FP).toBeGreaterThanOrEqual(BAND + Math.min(a.radius, KEEP));
    }
  });

  it('Le Col: the widest god walks out of its base, down the ramp from the plateau, to the far side of the map', () => {
    const w = createMatch(['dieux', 'humains'], undefined, 'le-col');
    const god = w.spawn('gaia', 0, 14 * FP, 22 * FP);
    const [gx, gy] = [70 * FP, 52 * FP];
    w.step([{ player: 0, kind: 'move', ids: [god.id], x: gx, y: gy }]);
    for (let i = 0; i < ticks(240) && god.order; i++) w.step([]);
    expect(Math.hypot(god.x - gx, god.y - gy) / FP).toBeLessThan(2);
  });
});
