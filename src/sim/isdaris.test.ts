import { describe, expect, it } from 'vitest';
import { AI } from '../ai/ai';
import { createMap } from '../map';
import { FP, ticks } from './fixed';
import { createMatch } from './setup';
import { type Entity, World } from './world';

const of = (w: World, owner: number, type: string): Entity[] => [...w.entities.values()].filter((e) => e.owner === owner && e.type === type);
const at = (tx: number, ty: number) => [tx * FP + FP / 2, ty * FP + FP / 2] as const;
const run = (w: World, seconds: number) => {
  for (let i = 0; i < ticks(seconds); i++) w.step([]);
};

describe('Isdaris', () => {
  it('start with an obelisk and harvester robots', () => {
    const w = createMatch(['isdaris', 'humains']);
    expect(of(w, 0, 'obelisque')).toHaveLength(1);
    expect(of(w, 0, 'moissonneur')).toHaveLength(6);
    expect(w.supply(0).max).toBe(15);
    expect(of(w, 1, 'conseil')).toHaveLength(1);
  });

  it('beam buildings down without a builder, but only inside a power field', () => {
    const w = createMatch(['isdaris', 'humains']);
    w.players[0].minerals = 2000;
    const robot = of(w, 0, 'moissonneur')[0];
    // Too far from the obelisk's field.
    expect(w.canPlace('portail', 30, 30, 0)).toBe(false);
    w.step([{ player: 0, kind: 'build', ids: [robot.id], type: 'portail', tx: 18, ty: 18 }]);
    run(w, 6);
    const gate = of(w, 0, 'portail')[0];
    expect(gate).toBeDefined();
    expect(robot.order?.kind).not.toBe('construct'); // the robot is free at once
    run(w, 55);
    expect(gate.buildLeft).toBe(0);
    expect(gate.shield).toBe(gate.maxShield);
  });

  it('power only through emitters linked to the obelisk', () => {
    const w = createMatch(['isdaris', 'humains']);
    const [ob] = of(w, 0, 'obelisque');
    const otx = Math.floor(ob.x / FP);
    const oty = Math.floor(ob.y / FP);
    const far = (dx: number) => w.canPlace('emetteur', otx + dx, oty, 0);
    // Zones of 9 (obelisk) and 7 (emitter) touch up to 16 tiles apart; further, it cannot be placed.
    expect(far(19)).toBe(false);
    const a = w.spawn('emetteur', 0, (otx + 14) * FP + FP, oty * FP + FP);
    const b = w.spawn('emetteur', 0, (otx + 27) * FP + FP, oty * FP + FP);
    expect(w.powerNetwork(0)).toContain(b);
    expect(w.powered(0, b.x + 3 * FP, b.y)).toBe(true);
    w.remove(a); // the link in the middle goes: the far emitter is cut off
    expect(w.powerNetwork(0)).not.toContain(b);
    expect(w.powered(0, b.x + 3 * FP, b.y)).toBe(false);
  });

  it('cannot build the other faction’s buildings', () => {
    const w = createMatch(['isdaris', 'humains']);
    w.players[0].minerals = 2000;
    const robot = of(w, 0, 'moissonneur')[0];
    w.step([{ player: 0, kind: 'build', ids: [robot.id], type: 'caserne', tx: 18, ty: 18 }]);
    run(w, 10);
    expect(of(w, 0, 'caserne')).toHaveLength(0);
  });

  it('absorb damage with shields, which recharge out of combat', () => {
    const w = new World(createMap());
    const archer = w.spawn('archer', 0, ...at(40, 60));
    archer.shield = 20;
    archer.hp = 70;
    const legion = w.spawn('legionnaire', 1, ...at(41, 60));
    run(w, 1.5);
    expect(archer.shield).toBe(0);
    w.remove(legion);
    const hp = archer.hp;
    run(w, 20);
    expect(archer.hp).toBe(hp); // no hp regeneration for archers
    expect(archer.shield).toBeGreaterThan(20);
  });

  it('creatures regenerate their health', () => {
    const w = new World(createMap());
    const c = w.spawn('creature', 0, ...at(40, 60));
    c.hp = 20;
    run(w, 10);
    expect(c.hp).toBeGreaterThan(40);
  });

  it('can be played by the AI, and Humans versus Isdaris and Isdaris mirror games end', () => {
    for (const factions of [['isdaris', 'humains'], ['humains', 'isdaris'], ['isdaris', 'isdaris']] as const) {
      const w = createMatch([...factions]);
      const ais = [new AI(w, 0), new AI(w, 1)];
      while (w.winner === null && w.tick < ticks(35 * 60)) w.step(ais.flatMap((a) => a.think()));
      console.log(`${factions.join(' vs ')}: winner ${w.winner} at ${(w.tick / ticks(60)).toFixed(1)} min`);
      expect(w.winner).not.toBeNull();
    }
  }, 90_000);

  it('beats an idle opponent as Isdaris', () => {
    const w = createMatch(['humains', 'isdaris']);
    const ai = new AI(w, 1);
    while (w.winner === null && w.tick < ticks(25 * 60)) w.step(ai.think());
    expect(w.winner).toBe(1);
  }, 30_000);
});
