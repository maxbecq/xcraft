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

  it('Rappel brings the army units near the target back beside the Obélisque after a channel', () => {
    const w = createMatch(['isdaris', 'humains']);
    const [ob] = of(w, 0, 'obelisque');
    const p = w.players[0];
    p.energy = 250;
    const army = [w.spawn('archer', 0, ...at(40, 60)), w.spawn('druide', 0, ...at(41, 61)), w.spawn('creature', 0, ...at(44, 60))];
    const far = w.spawn('archer', 0, ...at(50, 60)); // beyond the 5-tile radius
    const robot = w.spawn('moissonneur', 0, ...at(40, 61)); // workers stay
    w.step([{ player: 0, kind: 'ability', ids: [ob.id], x: army[0].x, y: army[0].y }]);
    expect(p.energy).toBe(150);
    expect(w.teleports).toEqual([expect.objectContaining({ phase: 'start', owner: 0, ids: army.map((e) => e.id) })]);
    // Channelling: they cannot move nor take orders.
    w.step([{ player: 0, kind: 'move', ids: [army[0].id], x: 60 * FP, y: 60 * FP }]);
    w.step([{ player: 0, kind: 'ability', ids: [ob.id], x: far.x, y: far.y }]); // recharging
    expect(p.energy).toBe(150);
    run(w, 3.5);
    expect(army[0].x).toBe(at(40, 60)[0]);
    let ended = false;
    for (let i = 0; i < ticks(1) && !ended; i++) {
      w.step([]);
      ended = w.teleports.some((t) => t.phase === 'end');
    }
    expect(ended).toBe(true);
    const beside = (e: Entity) => Math.abs(e.x - ob.x) <= 4 * FP && Math.abs(e.y - ob.y) <= 4 * FP;
    expect(army.every(beside)).toBe(true);
    expect(new Set(army.map((e) => `${e.x},${e.y}`)).size).toBe(3); // spread on different tiles
    expect(beside(far)).toBe(false);
    expect(beside(robot)).toBe(false);
    // Dazed a moment, then free.
    w.step([{ player: 0, kind: 'move', ids: [army[0].id], x: 30 * FP, y: 30 * FP }]);
    expect(army[0].order).toBeNull();
    run(w, 4.5);
    w.step([{ player: 0, kind: 'move', ids: [army[0].id], x: 30 * FP, y: 30 * FP }]);
    expect(army[0].order?.kind).toBe('move');
  });

  it('Rappel costs nothing without units in the zone, and needs 100 energy', () => {
    const w = createMatch(['isdaris', 'humains']);
    const [ob] = of(w, 0, 'obelisque');
    const archer = w.spawn('archer', 0, ...at(40, 60));
    w.players[0].energy = 99;
    w.step([{ player: 0, kind: 'ability', ids: [ob.id], x: archer.x, y: archer.y }]);
    expect(w.recalls).toHaveLength(0);
    w.players[0].energy = 100;
    w.step([{ player: 0, kind: 'ability', ids: [ob.id], x: 70 * FP, y: 70 * FP }]);
    expect(w.recalls).toHaveLength(0);
    expect(w.players[0].energy).toBe(100);
    expect(ob.abilityCd).toBe(0);
  });

  it('the AI recalls a wave that is losing far from home', () => {
    const w = createMatch(['isdaris', 'humains']);
    const ai = new AI(w, 0);
    w.players[0].energy = 300;
    while (w.tick < 8) w.step([]);
    const wave = [0, 1, 2].map((i) => w.spawn('archer', 0, ...at(60 + i, 60)));
    for (const e of wave) {
      ai['wave'].add(e.id);
      e.shield = 0; // battered
      e.hp = 30;
    }
    for (let i = 0; i < 4; i++) w.spawn('legionnaire', 1, ...at(63 + (i % 2), 59 + (i >> 1)));
    w.step([]); // vision updated
    w.step([]); // tick 10: the AI's turn
    const cast = ai.think().find((c) => c.kind === 'ability');
    expect(cast).toMatchObject({ ids: [of(w, 0, 'obelisque')[0].id] });
    w.step([cast!]);
    expect(wave.every((e) => e.held > 0)).toBe(true);
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
