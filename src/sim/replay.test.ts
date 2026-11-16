import { describe, expect, it } from 'vitest';
import { AI } from '../ai/ai';
import { ticks } from './fixed';
import { createMatch } from './setup';
import type { Command, World } from './world';

const state = (w: World) => JSON.stringify([...w.entities.values()].map((e) => [e.id, e.type, e.owner, e.x, e.y, e.hp]).concat(w.players.map((p) => [p.minerals, p.energy])));

describe('replays', () => {
  it('rebuild a game from its recorded commands alone', () => {
    for (const factions of [['humains', 'isdaris'], ['isdaris', 'isdaris']] as const) {
      const live = createMatch([...factions]);
      const ais = [new AI(live, 0), new AI(live, 1)];
      const record: [number, Command[]][] = [];
      while (live.tick < ticks(6 * 60)) {
        const cmds = ais.flatMap((ai) => ai.think());
        if (cmds.length) record.push([live.tick, cmds]);
        live.step(cmds);
      }
      // Through JSON, as a saved replay file goes.
      const played = new Map<number, Command[]>(JSON.parse(JSON.stringify(record)));
      const again = createMatch([...factions]);
      while (again.tick < live.tick) again.step(played.get(again.tick) ?? []);
      expect(state(again)).toBe(state(live));
    }
  }, 60_000);
});
