import { describe, expect, it } from 'vitest';
import { type BuildingDef, DEFS, START, type UnitDef } from '../data';
import { createMap } from '../map';
import { FP, ticks } from './fixed';
import { createMatch } from './setup';
import { type Command, type Entity, World } from './world';

const of = (w: World, owner: number, type: string): Entity[] =>
  [...w.entities.values()].filter((e) => e.owner === owner && e.type === type);

function run(w: World, seconds: number, commands: Command[] = []): void {
  w.step(commands);
  for (let i = 1; i < ticks(seconds); i++) w.step([]);
}

function gatherAll(w: World, owner: number): Command {
  const serfs = of(w, owner, 'serf');
  const field = of(w, -1, 'minerai').sort((a, b) => Math.abs(a.x - serfs[0].x) + Math.abs(a.y - serfs[0].y) - (Math.abs(b.x - serfs[0].x) + Math.abs(b.y - serfs[0].y)))[0];
  return { player: owner, kind: 'smart', ids: serfs.map((s) => s.id), x: field.x, y: field.y, target: field.id };
}

describe('economy', () => {
  it('starts each player with a council, serfs and minerals', () => {
    const w = createMatch();
    for (const p of [0, 1]) {
      expect(of(w, p, 'conseil')).toHaveLength(1);
      expect(of(w, p, 'serf')).toHaveLength(START.serfs);
      expect(w.supply(p)).toEqual({ used: START.serfs, max: 10 });
    }
  });

  it('mines minerals with serfs spreading over the fields', () => {
    const w = createMatch();
    run(w, 60, [gatherAll(w, 0)]);
    const gained = w.players[0].minerals - START.minerals;
    // 6 serfs, 10 per trip, a trip is a few seconds: expect a steady income.
    expect(gained).toBeGreaterThan(400);
    expect(new Set(of(w, 0, 'serf').map((s) => (s.order?.kind === 'gather' ? s.order.target : 0))).size).toBeGreaterThan(3);
  });

  it('sends a builder to a tile outside the site, coming from the west as from the east', () => {
    // A site's west and north edges used to be planned as a tile inside it (tiles are floor(x)): workers coming
    // from the west or north took another way than those from the east or south, which favoured one start.
    for (const [from, side] of [[36, -1], [52, 1]] as const) {
      const w = new World(createMap());
      w.players[0].minerals = 1000;
      const serf = w.spawn('serf', 0, from * FP + FP / 2, 60 * FP + FP / 2);
      w.step([{ player: 0, kind: 'build', ids: [serf.id], type: 'grenier', tx: 44, ty: 60 }]);
      w.step([]);
      const goal = Math.floor(serf.goal!.x / FP);
      expect(side < 0 ? goal < 44 : goal >= 44 + (DEFS.grenier as BuildingDef).size, `from ${from}: goal tile ${goal}`).toBe(true);
    }
  });

  it('builds a granary with one serf, faster with three', () => {
    const time = (n: number) => {
      const w = createMatch();
      w.players[0].minerals = 1000;
      const ids = of(w, 0, 'serf').slice(0, n).map((s) => s.id);
      w.step([{ player: 0, kind: 'build', ids: [ids[0]], type: 'grenier', tx: 18, ty: 18 }]);
      for (let i = 0; i < 40; i++) w.step([]);
      const site = of(w, 0, 'grenier')[0];
      expect(site).toBeDefined();
      w.step([{ player: 0, kind: 'smart', ids: ids.slice(1), x: site.x, y: site.y, target: site.id }]);
      let t = 0;
      while (site.buildLeft > 0 && t < 5000) {
        w.step([]);
        t++;
      }
      expect(site.buildLeft).toBe(0);
      expect(w.supply(0).max).toBe(20);
      expect(w.players[0].minerals).toBe(800);
      return t;
    };
    expect(time(3)).toBeLessThan(time(1) / 2);
  });

  it('refuses to build on a cliff edge or a ramp', () => {
    const w = createMatch();
    expect(w.canPlace('caserne', 28, 16)).toBe(false); // straddles levels 2 and 1
    expect(w.canPlace('grenier', 30, 13)).toBe(false); // on the ramp
    expect(w.canPlace('caserne', 18, 18)).toBe(true);
    expect(w.canPlace('caserne', 12, 12)).toBe(false); // on the council
  });

  it('trains serfs, within supply', () => {
    const w = createMatch();
    w.players[0].minerals = 2000;
    const conseil = of(w, 0, 'conseil')[0];
    const train: Command = { player: 0, kind: 'train', ids: [conseil.id], type: 'serf' };
    w.step([train, train, train, train, train]);
    expect(conseil.queue).toHaveLength(4); // 6 serfs + 4 queued = 10 supply
    expect(w.events.some((e) => e.text.includes('Logistique'))).toBe(true);
    run(w, (DEFS.serf as UnitDef).buildTime * 4 + 1);
    expect(of(w, 0, 'serf')).toHaveLength(10);
  });

  it('produces energy from a mine on an energy well', () => {
    const w = createMatch();
    w.players[0].minerals = 1000;
    const serf = of(w, 0, 'serf')[0];
    w.step([{ player: 0, kind: 'build', ids: [serf.id], type: 'mine', tx: 17, ty: 6 }]);
    run(w, 40);
    const mine = of(w, 0, 'mine')[0];
    expect(mine.buildLeft).toBe(0);
    expect(w.supply(0).used).toBe(START.serfs + 4);
    const before = w.players[0].energy;
    run(w, 10);
    expect(w.players[0].energy - before).toBeGreaterThanOrEqual(20);
  });

  it('stays deterministic with a running economy', () => {
    const play = () => {
      const w = createMatch();
      run(w, 120, [gatherAll(w, 0), gatherAll(w, 1)]);
      return w.hash();
    };
    expect(play()).toBe(play());
  });
});
