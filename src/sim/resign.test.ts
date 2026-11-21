import { describe, expect, it } from 'vitest';
import { ticks } from './fixed';
import { createMatch } from './setup';

describe('a side that gave up', () => {
  it('leaves the field while its ally plays on (2 v 2), and the match goes on', () => {
    const w = createMatch(['humains', 'humains', 'humains', 'humains'], [0, 1, 0, 1]);
    const mine = (p: number) => [...w.entities.values()].filter((e) => e.owner === p);
    expect(mine(1).length).toBeGreaterThan(0);
    w.step([{ player: 1, kind: 'resign', ids: [] }]);
    while (w.tick < ticks(3)) w.step([]);
    expect(w.players[1].resigned).toBe(true);
    expect(mine(1)).toEqual([]);
    expect(mine(3).length).toBeGreaterThan(0);
    expect(w.winner).toBe(null);
    // Its mining slots are free again: nobody gathers for it.
    expect([...w.entities.values()].some((e) => e.order?.kind === 'gather' && w.players[e.owner]?.resigned)).toBe(false);
  });

  it('in a 1 v 1, ends the match and keeps its town as it stood', () => {
    const w = createMatch();
    w.step([{ player: 1, kind: 'resign', ids: [] }]);
    while (w.winner === null && w.tick < ticks(3)) w.step([]);
    expect(w.winner).toBe(0);
    expect([...w.entities.values()].some((e) => e.owner === 1)).toBe(true);
  });
});

describe('World.hash', () => {
  it('sees a decoy, a Portail second line and a resignation', () => {
    const base = createMatch().hash();
    const unit = (w: ReturnType<typeof createMatch>) => [...w.entities.values()].find((e) => e.owner === 0 && e.def.kind === 'unit')!;
    const a = createMatch();
    unit(a).illusion = true;
    const b = createMatch();
    unit(b).trainLeft2 = 5;
    const c = createMatch();
    c.players[1].resigned = true;
    for (const w of [a, b, c]) expect(w.hash()).not.toBe(base);
  });
});
