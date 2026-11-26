import { describe, expect, it } from 'vitest';
import { ticks } from '../sim/fixed';
import { createMatch } from '../sim/setup';
import { AI } from './ai';

// Codex, 2026-11-26 (third final review): a map that denies an AI its headquarters (MapFile.seats forbid) left it
// saving its minerals, its Casernes idle, for an expansion it could never raise.
describe('an AI the map denies its headquarters', () => {
  it('never saves for an expansion', () => {
    const w = createMatch(['humains', 'humains']);
    w.players[0].forbid = ['conseil'];
    const ai = new AI(w, 0);
    const turn = ai as unknown as { place(ctx: { saving: boolean }): void };
    const place = turn.place.bind(ai);
    let saved = 0;
    turn.place = (ctx) => {
      if (ctx.saving) saved++;
      place(ctx);
    };
    while (w.tick < ticks(12 * 60)) w.step(ai.think());
    expect(saved).toBe(0);
  }, 120_000);
});
