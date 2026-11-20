import { describe, expect, it } from 'vitest';
import { AI } from '../ai/ai';
import type { Faction } from '../data';
import { MAPS } from '../maps';
import { ticks } from './fixed';
import { fingerprint } from './fingerprint';
import { createMatch } from './setup';
import type { Command, World } from './world';

/** Every 30 s of play, where a replay is checked against the live game. */
const EVERY = ticks(30);

interface Played {
  record: [number, Command[]][];
  /** The live game's fingerprint at each checkpoint. */
  marks: Map<number, number>;
  world: World;
}

/**
 * AIs play `seconds` of a match; every order is recorded, and the state fingerprinted every 30 s. `batch`: the orders
 * are held and given together every so many ticks, so that one tick carries several players' orders.
 */
function play(factions: Faction[], teams: number[] | undefined, map: string, seconds: number, batch = 1): Played {
  const world = createMatch(factions, teams, map);
  const ais = world.players.map((p) => new AI(world, p.id));
  const record: [number, Command[]][] = [];
  const marks = new Map<number, number>();
  let held: Command[] = [];
  while (world.tick < ticks(seconds) && world.winner === null) {
    if (world.tick % EVERY === 0) marks.set(world.tick, fingerprint(world));
    held.push(...ais.flatMap((ai) => ai.think()));
    const cmds = world.tick % batch === 0 ? held : [];
    if (cmds === held) held = [];
    if (cmds.length) record.push([world.tick, cmds]);
    world.step(cmds);
  }
  marks.set(world.tick, fingerprint(world));
  return { record, marks, world };
}

/** The same match from its recorded orders alone, through JSON as a saved replay file goes; `shuffle` reorders each tick's orders. */
function replay(factions: Faction[], teams: number[] | undefined, map: string, p: Played, shuffle?: (c: Command[]) => Command[]): Map<number, number> {
  const orders = new Map<number, Command[]>(JSON.parse(JSON.stringify(p.record)));
  const world = createMatch(factions, teams, map);
  const marks = new Map<number, number>();
  const end = Math.max(...p.marks.keys());
  while (world.tick < end) {
    if (world.tick % EVERY === 0) marks.set(world.tick, fingerprint(world));
    const cmds = orders.get(world.tick) ?? [];
    world.step(shuffle ? shuffle(cmds) : cmds);
  }
  marks.set(world.tick, fingerprint(world));
  return marks;
}

/** The first checkpoint where two runs part, or null. */
const parting = (a: Map<number, number>, b: Map<number, number>) => [...a].find(([t, h]) => b.get(t) !== h)?.[0] ?? null;

describe('replays checked every 30 s of play', () => {
  // Slow (about 30 s for the whole file): minutes of AI play per case, then the same again from the orders.
  const cases: [string, Faction[], number[] | undefined, string, number][] = [
    ...Object.keys(MAPS).map((map, i): [string, Faction[], number[] | undefined, string, number] => {
      const all: Faction[] = ['humains', 'isdaris', 'z', 'dieux'];
      return [`on ${map}`, [all[i % 4], all[(i + 3) % 4]], undefined, map, 240];
    }),
    ['Dieux against Dieux', ['dieux', 'dieux'], undefined, 'origine', 300],
    ['three players, two against one, Dieux among them', ['dieux', 'z', 'humains'], [0, 1, 0], 'carrefour', 360],
    ['four players, two against two', ['humains', 'dieux', 'isdaris', 'z'], [0, 1, 0, 1], 'carrefour', 360],
  ];
  for (const [name, factions, teams, map, seconds] of cases)
    it(`match at every checkpoint ${name}`, () => {
      const live = play(factions, teams, map, seconds);
      expect(live.record.length).toBeGreaterThan(20); // the AIs did play
      expect(parting(live.marks, replay(factions, teams, map, live))).toBeNull();
    }, 120_000);
});

describe('determinism', () => {
  it('the same match played twice in one run gives the same state at every checkpoint (no state left over between matches)', () => {
    const factions: Faction[] = ['dieux', 'z', 'isdaris', 'humains'];
    const a = play(factions, [0, 0, 1, 1], 'carrefour', 240);
    const b = play(factions, [0, 0, 1, 1], 'carrefour', 240);
    expect(b.record).toEqual(a.record);
    expect(parting(a.marks, b.marks)).toBeNull();
  }, 120_000);

  it("one tick's orders from different players can be put in another order without changing the game", () => {
    // Each tick's orders, grouped by player, the players taken last to first (each player's own orders kept in order).
    const byPlayerReversed = (cmds: Command[]) => [...new Set(cmds.map((c) => c.player))].reverse().flatMap((p) => cmds.filter((c) => c.player === p));
    const factions: Faction[] = ['humains', 'z'];
    const live = play(factions, undefined, 'origine', 300, 20);
    const mixed = live.record.filter(([, c]) => new Set(c.map((x) => x.player)).size > 1).length;
    expect(mixed).toBeGreaterThan(0); // ticks with both players' orders exist
    expect(parting(live.marks, replay(factions, undefined, 'origine', live, byPlayerReversed))).toBeNull();
  }, 120_000);
});
