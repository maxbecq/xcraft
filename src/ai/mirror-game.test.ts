import { describe, expect, it } from 'vitest';
import type { Faction } from '../data';
import { FP } from '../sim/fixed';
import { CORNERS, createMatch } from '../sim/setup';
import type { World } from '../sim/world';
import { AI } from './ai';

/**
 * Whole AI games from opposite corners: the same two factions, the same seats, the corners swapped. Tick by tick, the
 * second game is the first turned half round: every entity at the turned spot, with the same hit points and order.
 * Before, many rules leaned one way whatever the corner (units out of a building down and right, a Pod's add-on east
 * first, a worker picked by its distance to a site's top-left tile, two units on one spot split along a direction
 * from their ids, a disc of sight round an even-sized building's middle a tile off, the AI's points rounded down…),
 * and the corner a faction started from changed how its games went.
 */
describe('AI games turned with the map', () => {
  const cases: [Faction, Faction, string, number][] = [
    ['dieux', 'z', 'origine', 12000],
    ['z', 'isdaris', 'carrefour', 9000],
  ];
  for (const [a, b, map, ticks] of cases) {
    it(`${a} against ${b} on ${map}: the same game from the other corners`, () => {
      const saved = [...CORNERS];
      // CORNERS is read while a match is made and while the AI thinks (its expansions): swapped around both.
      const seated = <T>(corners: number[], f: () => T): T => {
        CORNERS.splice(0, CORNERS.length, ...corners);
        try {
          return f();
        } finally {
          CORNERS.splice(0, CORNERS.length, ...saved);
        }
      };
      const turned = saved.map((q) => (q + 2) % 4);
      const game = (corners: number[]) =>
        seated(corners, () => {
          const w = createMatch([a, b], undefined, map);
          return { w, corners, ais: [new AI(w, 0), new AI(w, 1)] };
        });
      const step = (g: { w: World; corners: number[]; ais: AI[] }) => seated(g.corners, () => g.w.step(g.ais.flatMap((ai) => ai.think())));
      const g1 = game(saved);
      const g2 = game(turned);
      const S = g1.w.map.width * FP;
      // The start's entities by place (resources of empty quarters come in the map file's order, not turned); later
      // ones are made in the same order in both games.
      const twin = new Map<number, number>();
      for (const e of g1.w.entities.values()) {
        const o = [...g2.w.entities.values()].find((o) => o.type === e.type && o.x === S - e.x && o.y === S - e.y);
        expect(o, `${e.type} ${e.id}`).toBeDefined();
        twin.set(e.id, o!.id);
      }
      const show = (e: { type: string; owner: number; x: number; y: number; hp: number; order: { kind: string } | null } | undefined, turn: boolean) =>
        e ? `${e.type}@${e.owner} ${turn ? S - e.x : e.x},${turn ? S - e.y : e.y} hp${e.hp} ${e.order?.kind ?? '-'}` : 'none';
      for (let t = 0; t < ticks && g1.w.winner === null; t++) {
        step(g1);
        step(g2);
        expect(g2.w.entities.size).toBe(g1.w.entities.size);
        for (const e of g1.w.entities.values()) {
          const a1 = show(e, false);
          const a2 = show(g2.w.entities.get(twin.get(e.id) ?? e.id), true);
          if (a1 !== a2) expect(`tick ${g1.w.tick} ${a2}`).toBe(`tick ${g1.w.tick} ${a1}`);
        }
      }
      expect(g2.w.winner).toBe(g1.w.winner);
      expect(g2.w.players.map((p) => p.minerals)).toEqual(g1.w.players.map((p) => p.minerals));
    }, 120_000);
  }
});
