import { describe, expect, it } from 'vitest';
import { createMap } from '../map';
import { type BuildingDef, DEFS, type UnitDef } from '../data';
import { FP, ticks } from './fixed';
import { type Entity, World } from './world';

const at = (tx: number, ty: number) => [tx * FP + FP / 2, ty * FP + FP / 2] as const;
const run = (w: World, seconds: number) => {
  for (let i = 0; i < ticks(seconds); i++) w.step([]);
};
const tiles = (e: Entity) => [Math.round(e.x / FP), Math.round(e.y / FP)];

describe('hold position', () => {
  it('stays put when an enemy shows up beyond reach, and shoots one within reach', () => {
    const w = new World(createMap());
    const guard = w.spawn('auxiliaire', 0, ...at(40, 60));
    w.step([{ player: 0, kind: 'hold', ids: [guard.id] }]);
    const start = [guard.x, guard.y];
    // In sight (8) but out of reach (4): a plain idle soldier would walk up to it.
    const far = w.spawn('serf', 1, ...at(46, 60));
    run(w, 4);
    expect([guard.x, guard.y]).toEqual(start);
    expect(far.hp).toBe(far.maxHp);
    // Within reach: it fires, still without moving.
    const near = w.spawn('serf', 1, ...at(43, 60));
    run(w, 4);
    expect(near.hp).toBeLessThan(near.maxHp);
    expect([guard.x, guard.y]).toEqual(start);
  });

  it('ends with the next move', () => {
    const w = new World(createMap());
    const guard = w.spawn('auxiliaire', 0, ...at(40, 60));
    w.step([{ player: 0, kind: 'hold', ids: [guard.id] }]);
    expect(guard.stand).toBe(true);
    w.step([{ player: 0, kind: 'move', ids: [guard.id], x: at(44, 60)[0], y: at(44, 60)[1] }]);
    expect(guard.stand).toBe(false);
  });
});

describe('patrol', () => {
  it('walks back and forth between where it stood and the point', () => {
    const w = new World(createMap());
    const scout = w.spawn('auxiliaire', 0, ...at(40, 60));
    const [x, y] = at(48, 60);
    w.step([{ player: 0, kind: 'patrol', ids: [scout.id], x, y }]);
    let far = 0;
    let back = 0;
    for (let i = 0; i < ticks(30); i++) {
      w.step([]);
      const [tx] = tiles(scout);
      if (tx >= 47) far++;
      if (far && tx <= 41) back++;
    }
    expect(far).toBeGreaterThan(0);
    expect(back).toBeGreaterThan(0);
    expect(scout.order?.kind).toBe('attackMove'); // still patrolling
  });
});

describe('group arrival', () => {
  it('a spread-out group fans out round the point instead of piling onto it', () => {
    const w = new World(createMap());
    const group = [w.spawn('auxiliaire', 0, ...at(30, 52)), w.spawn('auxiliaire', 0, ...at(30, 60)), w.spawn('auxiliaire', 0, ...at(30, 68)), w.spawn('auxiliaire', 0, ...at(36, 60))];
    const [x, y] = at(50, 60);
    w.step([{ player: 0, kind: 'move', ids: group.map((e) => e.id), x, y }]);
    run(w, 20);
    for (const e of group) expect(e.order).toBeNull();
    // Each stands on its own spot: no two closer than a body width.
    for (const a of group) for (const b of group) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.radius + b.radius - FP / 8);
    // And they keep their north-to-south order.
    const ys = [group[0].y, group[1].y, group[2].y];
    expect(ys[0]).toBeLessThan(ys[2]);
  });

  it('gives two mirrored groups mirrored slots (no side of the map favoured)', () => {
    const w = new World(createMap());
    const W = w.map.width * FP;
    const H = w.map.height * FP;
    const spots = [[30, 52], [30, 60], [31, 68], [36, 61], [33, 56], [28, 63]];
    const a = spots.map(([x, y]) => w.spawn('auxiliaire', 0, x * FP, y * FP));
    const b = spots.map(([x, y]) => w.spawn('auxiliaire', 1, W - x * FP, H - y * FP));
    w.step([{ player: 0, kind: 'move', ids: a.map((e) => e.id), x: 50 * FP, y: 60 * FP }]);
    w.step([{ player: 1, kind: 'move', ids: b.map((e) => e.id), x: W - 50 * FP, y: H - 60 * FP }]);
    const slot = (e: Entity) => (e.order?.kind === 'move' ? [e.order.x, e.order.y] : []);
    a.forEach((e, i) => {
      const [x, y] = slot(e);
      const [mx, my] = slot(b[i]);
      expect([W - mx, H - my]).toEqual([x, y]);
    });
  });

  it('is the same for the same orders (no hidden randomness)', () => {
    const play = () => {
      const w = new World(createMap());
      const ids = [w.spawn('auxiliaire', 0, ...at(30, 52)), w.spawn('auxiliaire', 0, ...at(31, 66)), w.spawn('legionnaire', 0, ...at(35, 58))].map((e) => e.id);
      w.step([{ player: 0, kind: 'move', ids, x: at(50, 60)[0], y: at(50, 60)[1] }]);
      run(w, 15);
      return ids.map((id) => [w.entities.get(id)!.x, w.entities.get(id)!.y]);
    };
    expect(play()).toEqual(play());
  });
});

describe('production across several buildings', () => {
  it('each click goes to the least busy one, a full one is skipped, the error only when all are full', () => {
    const w = new World(createMap());
    w.players[0].minerals = 99999;
    w.spawn('conseil', 0, 10 * FP, 10 * FP); // supply
    w.spawn('grenier', 0, 30 * FP, 10 * FP);
    const a = w.spawn('caserne', 0, 20 * FP, 20 * FP);
    const b = w.spawn('caserne', 0, 30 * FP, 20 * FP);
    const train = () => w.step([{ player: 0, kind: 'train', ids: [a.id, b.id], type: 'auxiliaire' }]);
    for (let i = 0; i < 5; i++) train();
    expect([a.queue.length, b.queue.length].sort()).toEqual([2, 3]);
    for (let i = 0; i < 5; i++) train();
    expect([a.queue.length, b.queue.length]).toEqual([5, 5]);
    expect(w.events.some((e) => e.text === "File d'attente pleine.")).toBe(false);
    train();
    expect(w.events.some((e) => e.text === "File d'attente pleine.")).toBe(true);
  });
});

describe('not enough supply', () => {
  it('says so at every click, for each faction', async () => {
    const { createMatch } = await import('./setup');
    const { FACTIONS } = await import('../data');
    for (const faction of ['humains', 'isdaris', 'z', 'dieux'] as const) {
      const w = createMatch([faction, 'humains']);
      w.players[0].minerals = 99999;
      const f = FACTIONS[faction];
      const home = [...w.entities.values()].find((e) => e.owner === 0 && e.type === (f.workerFrom ?? f.hq))!;
      // A full supply: workers until no room is left, then two clicks.
      while (w.supply(0).used < w.supply(0).max) w.spawn(f.worker, 0, home.x, home.y + 6 * FP);
      for (let i = 0; i < 2; i++) {
        w.step([{ player: 0, kind: 'train', ids: [home.id], type: f.worker }]);
        expect(w.events.map((e) => e.text).join()).toMatch(/Logistique insuffisante : construisez des /);
      }
    }
  });
});

describe('rally point', () => {
  it('the order the card button gives (as a right click) sets it on the ground, or on a mineral field to mine', () => {
    const w = new World(createMap());
    const a = w.spawn('caserne', 0, 20 * FP, 20 * FP);
    const field = w.spawn('minerai', -1, 30 * FP, 20 * FP);
    w.step([{ player: 0, kind: 'smart', ids: [a.id], x: 25 * FP, y: 22 * FP }]);
    expect(a.rally).toEqual({ x: 25 * FP, y: 22 * FP });
    expect(a.rallyTarget).toBe(0);
    w.step([{ player: 0, kind: 'smart', ids: [a.id], x: field.x + 300, y: field.y - 200, target: field.id }]);
    expect(a.rallyTarget).toBe(field.id);
    expect(a.rally).toEqual({ x: field.x, y: field.y }); // the thing's middle, not the spot clicked on it
  });

  it('every building that trains units takes one (its flag is drawn from it); one that trains none takes none', () => {
    const producers = Object.entries(DEFS).filter(([, d]) => d.kind === 'building' && (d as BuildingDef).trains?.length).map(([t]) => t);
    expect(producers).toEqual(expect.arrayContaining(['conseil', 'caserne', 'casernevolante', 'portail', 'nanoassembleur', 'obelisque', 'intelligence', 'plateforme', 'asgaard']));
    for (const t of [...producers, 'trone', 'orbecommandement']) {
      const w = new World(createMap());
      const b = w.spawn(t, 0, 20 * FP, 20 * FP);
      w.step([{ player: 0, kind: 'smart', ids: [b.id], x: 30 * FP, y: 24 * FP }]);
      expect(b.rally, t).toEqual(producers.includes(t) ? { x: 30 * FP, y: 24 * FP } : null);
    }
  });

  describe('a unit out of the building goes by what the rally point is on', () => {
    const setup = () => {
      const w = new World(createMap());
      const b = w.spawn('caserne', 0, 20 * FP, 20 * FP);
      const rally = (x: number, y: number, target?: Entity) => w.step([{ player: 0, kind: 'smart', ids: [b.id], x, y, target: target?.id }]);
      return { w, b, rally };
    };

    it('open ground: to the spot', () => {
      const { w, b, rally } = setup();
      rally(26 * FP, 23 * FP);
      const u = w.spawn('legionnaire', 0, 22 * FP, 22 * FP);
      w.rallyOn(u, b);
      expect(u.order).toMatchObject({ kind: 'move', x: 26 * FP, y: 23 * FP });
    });

    it('a mineral field: a worker mines it, a soldier goes beside it', () => {
      const { w, b, rally } = setup();
      const field = w.spawn('minerai', -1, 28 * FP, 20 * FP);
      rally(field.x, field.y, field);
      const serf = w.spawn('serf', 0, 22 * FP, 22 * FP);
      w.rallyOn(serf, b);
      expect(serf.order).toMatchObject({ kind: 'gather', target: field.id });
      const soldier = w.spawn('legionnaire', 0, 22 * FP, 22 * FP);
      w.rallyOn(soldier, b);
      expect(soldier.order?.kind).toBe('move');
      const o = soldier.order as { x: number; y: number };
      // On the side facing the Caserne, a tile out from the field's edge.
      expect(o.x).toBeLessThan(field.x);
      expect(Math.abs(o.x - field.x)).toBeGreaterThan(FP);
    });

    it('another resource (a well): even a worker goes beside it', () => {
      const { w, b, rally } = setup();
      const well = w.spawn('puits', -1, 30 * FP, 20 * FP);
      rally(well.x, well.y, well);
      const serf = w.spawn('serf', 0, 22 * FP, 22 * FP);
      w.rallyOn(serf, b);
      expect(serf.order?.kind).toBe('move');
    });

    it('a friendly unit: followed wherever it goes', () => {
      const { w, b, rally } = setup();
      const lead = w.spawn('legionnaire', 0, 26 * FP, 22 * FP);
      rally(lead.x, lead.y, lead);
      const u = w.spawn('legionnaire', 0, 22 * FP, 22 * FP);
      w.rallyOn(u, b);
      expect(u.order).toMatchObject({ kind: 'follow', target: lead.id });
      w.step([{ player: 0, kind: 'move', ids: [lead.id], x: 34 * FP, y: 22 * FP }]);
      run(w, 8);
      expect(u.order?.kind).toBe('follow');
      expect(Math.abs(u.x - lead.x)).toBeLessThan(3 * FP);
      expect(b.rally).toEqual({ x: lead.x, y: lead.y }); // the flag moves with it
    });

    it('a friendly building: beside it', () => {
      const { w, b, rally } = setup();
      const other = w.spawn('caserne', 0, 30 * FP, 20 * FP);
      rally(other.x, other.y, other);
      const u = w.spawn('legionnaire', 0, 22 * FP, 22 * FP);
      w.rallyOn(u, b);
      expect(u.order?.kind).toBe('move');
      expect((u.order as { x: number }).x).toBeLessThan(other.x - FP);
    });

    it('an enemy: attacked', () => {
      const { w, b, rally } = setup();
      const foe = w.spawn('legionnaire', 1, 25 * FP, 22 * FP);
      rally(foe.x, foe.y, foe);
      expect(b.rallyTarget).toBe(foe.id);
      const u = w.spawn('legionnaire', 0, 22 * FP, 22 * FP);
      w.rallyOn(u, b);
      expect(u.order).toMatchObject({ kind: 'attack', target: foe.id });
    });

    it('a thing gone by then: its last known place', () => {
      const { w, b, rally } = setup();
      const lead = w.spawn('legionnaire', 0, 26 * FP, 22 * FP);
      rally(lead.x, lead.y, lead);
      w.step([{ player: 0, kind: 'move', ids: [lead.id], x: 29 * FP, y: 22 * FP }]);
      run(w, 3);
      const last = { x: lead.x, y: lead.y };
      w.remove(lead);
      run(w, 1);
      const u = w.spawn('legionnaire', 0, 22 * FP, 22 * FP);
      w.rallyOn(u, b);
      expect(u.order).toMatchObject({ kind: 'move', x: last.x, y: last.y });
    });
  });
});

describe('cancelling from the queue', () => {
  const setup = () => {
    const w = new World(createMap());
    w.players[0].minerals = w.players[0].energy = 5000;
    w.spawn('conseil', 0, 10 * FP, 10 * FP); // supply
    w.spawn('grenier', 0, 30 * FP, 10 * FP);
    const b = w.spawn('caserne', 0, 20 * FP, 20 * FP);
    for (const t of ['auxiliaire', 'legionnaire', 'auxiliaire']) w.step([{ player: 0, kind: 'train', ids: [b.id], type: t }]);
    run(w, 1);
    return { w, b, p: w.players[0] };
  };

  it('takes out the one clicked, refunded, the one in progress going on', () => {
    const { w, b, p } = setup();
    const [left, m] = [b.trainLeft, p.minerals];
    w.step([{ player: 0, kind: 'cancel', ids: [b.id], slot: 1 }]);
    expect(b.queue).toEqual(['auxiliaire', 'auxiliaire']);
    expect(p.minerals - m).toBe((DEFS.legionnaire as UnitDef).cost.minerals);
    expect(b.trainLeft).toBe(left - 1);
  });

  it('the one in progress taken out, the next starts with its whole time', () => {
    const { w, b } = setup();
    w.step([{ player: 0, kind: 'cancel', ids: [b.id], slot: 0 }]);
    expect(b.queue).toEqual(['legionnaire', 'auxiliaire']);
    expect(b.trainLeft).toBe(w.trainTime(b, 'legionnaire') - 1);
  });

  it('without a place, the last one, as before; a place out of the queue does nothing', () => {
    const { w, b } = setup();
    w.step([{ player: 0, kind: 'cancel', ids: [b.id] }]);
    expect(b.queue).toEqual(['auxiliaire', 'legionnaire']);
    w.step([{ player: 0, kind: 'cancel', ids: [b.id], slot: 5 }]);
    w.step([{ player: 0, kind: 'cancel', ids: [b.id], slot: -1 }]);
    expect(b.queue).toEqual(['auxiliaire', 'legionnaire']);
  });
});
