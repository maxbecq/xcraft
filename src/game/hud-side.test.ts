import { describe, expect, it } from 'vitest';
import { followed } from './hud-side';

/** What followed reads: three sides, a building of side 2, a mineral field (no side), the picked ids. */
function hud(selected: number[], spectator: boolean, shown = 0) {
  const entities = new Map([
    [10, { owner: 2 }],
    [11, { owner: -1 }],
    [12, { owner: 1 }],
  ]);
  return { world: { entities, players: [{}, {}, {}] }, player: 0, spectator, shown, input: { selected: new Set(selected) } } as unknown as Parameters<typeof followed>[0];
}

describe('the side the top bar shows', () => {
  it('a spectator sees the side of what is picked', () => {
    expect(followed(hud([10], true))).toBe(2);
    expect(followed(hud([11, 12], true))).toBe(1);
  });
  it('nothing picked, or only something of no side: the side shown last', () => {
    expect(followed(hud([], true, 2))).toBe(2);
    expect(followed(hud([11], true, 1))).toBe(1);
    expect(followed(hud([], true))).toBe(0);
  });
  it('a player always sees their own, whatever is picked', () => {
    expect(followed(hud([10], false))).toBe(0);
    expect(followed(hud([12], false, 2))).toBe(0);
  });
});
