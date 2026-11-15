import { describe, expect, it } from 'vitest';
import { ticks } from '../sim/fixed';
import { createMatch } from '../sim/setup';
import type { World } from '../sim/world';
import { AI, DIFFICULTY } from './ai';

/** Plays until someone wins or the time runs out; returns the winner and the game time in minutes. */
function play(world: World, ais: AI[], minutes: number): { winner: number | null; minutes: number } {
  const limit = ticks(minutes * 60);
  while (world.winner === null && world.tick < limit) world.step(ais.flatMap((ai) => ai.think()));
  return { winner: world.winner, minutes: Math.round((world.tick / ticks(60)) * 10) / 10 };
}

describe('AI', () => {
  it('beats an idle opponent', () => {
    const w = createMatch();
    const r = play(w, [new AI(w, 1)], 20);
    expect(r.winner).toBe(1);
  });

  it('wins more often with a better difficulty, from either side', () => {
    for (const [weak, strong] of [['easy', 'normal'], ['normal', 'hard']]) {
      for (const side of [0, 1]) {
        const w = createMatch();
        w.players[side].handicap = DIFFICULTY[strong];
        w.players[1 - side].handicap = DIFFICULTY[weak];
        expect(play(w, [new AI(w, 0), new AI(w, 1)], 35).winner).toBe(side);
      }
    }
  }, 60_000);

  it('finishes an AI-versus-AI game', () => {
    const w = createMatch();
    const r = play(w, [new AI(w, 0), new AI(w, 1)], 30);
    console.log('AI vs AI:', r, 'units', [...w.entities.values()].filter((e) => e.def.kind === 'unit').length);
    expect(r.winner).not.toBeNull();
  });
});
