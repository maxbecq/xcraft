import { describe, expect, it } from 'vitest';
import { AI } from '../ai/ai';
import { fingerprint } from './fingerprint';
import { createMatch } from './setup';
import type { Command, World } from './world';

/** Two AIs play `ticks`; the orders are kept so the same game can be played again. */
function game(ticks: number): { world: World; log: Map<number, Command[]> } {
  const world = createMatch(['humains', 'z']);
  const ais = [new AI(world, 0), new AI(world, 1)];
  const log = new Map<number, Command[]>();
  while (world.tick < ticks) {
    const cmds = ais.flatMap((ai) => ai.think());
    if (cmds.length) log.set(world.tick, cmds);
    world.step(cmds);
  }
  return { world, log };
}
function again(log: Map<number, Command[]>, ticks: number): World {
  const world = createMatch(['humains', 'z']);
  while (world.tick < ticks) world.step(log.get(world.tick) ?? []);
  return world;
}

describe('the state fingerprint', () => {
  const ticks = 2400; // two minutes: armies, queues, research under way
  const { world, log } = game(ticks);
  const same = fingerprint(world);

  it('is the same for the same game played twice', () => {
    expect(fingerprint(again(log, ticks))).toBe(same);
  });

  it('tells apart two games differing in one detail the old fingerprint missed', () => {
    const other = again(log, ticks);
    const all = [...other.entities.values()];
    const check = (what: string, change: () => () => void) => {
      const undo = change();
      expect(fingerprint(other), what).not.toBe(same);
      undo();
      expect(fingerprint(other), `${what}, undone`).toBe(same);
    };
    const producer = all.find((e) => e.queue.length > 0) ?? all.find((e) => e.def.kind === 'building')!;
    check('a production queue of the same length, another unit in it', () => {
      const was = [...producer.queue];
      producer.queue = producer.queue.length ? [...producer.queue.slice(0, -1), 'autre'] : ['autre'];
      if (!was.length) producer.queue = ['x'];
      return () => (producer.queue = was);
    });
    const unit = all.find((e) => e.def.kind === 'unit')!;
    check('a cooldown', () => {
      unit.cooldown += 1;
      return () => (unit.cooldown -= 1);
    });
    check('an ability cooldown', () => {
      unit.abilityCd += 1;
      return () => (unit.abilityCd -= 1);
    });
    check('a kit', () => {
      const was = unit.kits;
      unit.kits = [...was, 'test'];
      return () => (unit.kits = was);
    });
    check('an order queued after the current one', () => {
      const was = unit.next;
      unit.next = [...was, { kind: 'move', x: 1, y: 2, arrive: 0 } as (typeof was)[number]];
      return () => (unit.next = was);
    });
    check('a lasting effect on the ground', () => {
      other.silences.push({ x: 1, y: 2, r: 3, until: 4 });
      return () => other.silences.pop();
    });
    check('a body left on the ground', () => {
      other.corpses.push({ x: 1, y: 2, tick: 3, owner: 0, type: 'serf' });
      return () => other.corpses.pop();
    });
    const inside = other as unknown as { respawns: { owner: number; type: string; at: number }[]; nextId: number };
    check('a unit coming back', () => {
      inside.respawns.push({ owner: 0, type: 'serf', at: 9 });
      return () => inside.respawns.pop();
    });
    check('the next id', () => {
      inside.nextId++;
      return () => inside.nextId--;
    });
    check('a research level', () => {
      const p = other.players[0];
      const was = p.upgrades;
      p.upgrades = { ...was, armor: was.armor + 1 };
      return () => (p.upgrades = was);
    });
  });

  it('stays cheap: it runs every 100 ticks', () => {
    // Best of 9 series: a loaded machine only slows some series, a real complexity jump slows them all.
    const series = Array.from({ length: 9 }, () => {
      const t0 = performance.now();
      for (let i = 0; i < 10; i++) fingerprint(world);
      return (performance.now() - t0) / 10;
    });
    const each = Math.min(...series);
    console.log(`fingerprint: ${each.toFixed(3)} ms, ${world.entities.size} entities`);
    // About 0.35 ms on an idle machine: 3 ms leaves room for load, not for a 10x slowdown.
    expect(each).toBeLessThan(3);
  });
});
