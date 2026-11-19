import { describe, expect, it } from 'vitest';
import { FACTIONS, type BuildingDef, type UnitDef, DEFS } from '../data';
import { FP, ticks } from './fixed';
import { createMatch } from './setup';

const run = (w: ReturnType<typeof createMatch>, s: number) => {
  for (let i = 0; i < ticks(s); i++) w.step([]);
};

describe('an abandoned building site', () => {
  for (const faction of ['humains', 'isdaris', 'z', 'dieux'] as const) {
    it(`${faction}: its builder sent back to it finishes it`, () => {
      const w = createMatch([faction, 'humains']);
      w.players[0].minerals = w.players[0].energy = 99999;
      const f = FACTIONS[faction];
      const builder = [...w.entities.values()].find((e) => e.owner === 0 && e.def.kind === 'unit' && ((e.def as UnitDef).builder ?? (e.def as UnitDef).worker))!;
      const type = f.supply;
      const def = DEFS[type] as BuildingDef;
      const hq = [...w.entities.values()].find((e) => e.owner === 0 && e.type === f.hq)!;
      // A free spot near the base.
      let spot: [number, number] | undefined;
      for (let r = 6; !spot && r < 20; r++) for (let dx = -r; dx <= r && !spot; dx++) {
        const tx = Math.round(hq.x / FP) + dx;
        const ty = Math.round(hq.y / FP) + r;
        if (w.canPlace(type, tx, ty, 0)) spot = [tx, ty];
      }
      w.step([{ player: 0, kind: 'build', ids: [builder.id], type, tx: spot![0], ty: spot![1] }]);
      let site;
      for (let i = 0; i < ticks(40) && !site; i++) {
        w.step([]);
        site = [...w.entities.values()].find((e) => e.owner === 0 && e.type === type && e.buildLeft > 0);
      }
      expect(site, 'site raised').toBeTruthy();
      run(w, 2);
      // Called away halfway: a site raised by hand waits (the Isdaris, Z and Dieux ones go on by themselves).
      w.step([{ player: 0, kind: 'stop', ids: [builder.id] }]);
      const left = site!.buildLeft;
      run(w, 3);
      const selfBuilt = !!def.warp || !!def.absorbs;
      if (!selfBuilt) expect(site!.buildLeft).toBe(left);
      // A right click (or a tap) on it with the builder.
      w.step([{ player: 0, kind: 'smart', ids: [builder.id], x: site!.x, y: site!.y, target: site!.id }]);
      if (!selfBuilt) expect(builder.order?.kind, 'goes back to build').toBe('construct');
      run(w, def.buildTime + 15);
      expect(site!.buildLeft, `${type} finished`).toBe(0);
    });
  }
});

describe('a building finished', () => {
  it('its builders who stood behind it (out of sight) come round to the front', () => {
    const w = createMatch(['humains', 'humains']);
    w.players[0].minerals = 99999;
    const hq = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'conseil')!;
    let spot: [number, number] | undefined;
    for (let r = 8; !spot && r < 20; r++) for (let d = -r; d <= r && !spot; d++) {
      const [tx, ty] = [Math.round(hq.x / FP) + d, Math.round(hq.y / FP) + r];
      if (w.canPlace('grenier', tx, ty, 0) && w.grid.open(tx - 3, ty - 3)) spot = [tx, ty];
    }
    const serf = w.spawn('serf', 0, (spot![0] - 3) * FP, (spot![1] - 3) * FP);
    w.step([{ player: 0, kind: 'build', ids: [serf.id], type: 'grenier', tx: spot![0], ty: spot![1] }]);
    run(w, (DEFS.grenier as BuildingDef).buildTime + 20);
    const b = [...w.entities.values()].find((e) => e.type === 'grenier' && e.owner === 0)!;
    expect(b.buildLeft).toBe(0);
    expect(serf.x - b.x + (serf.y - b.y)).toBeGreaterThan(0);
  });
});
