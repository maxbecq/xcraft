import { describe, expect, it } from 'vitest';
import { parseReplay, REPLAY_MAX_BYTES } from './replay';

const good = { v: 1, map: 'origine', factions: ['humains', 'z'], teams: [0, 1], biome: 'glace', handicap: [100, 100], ticks: [[3, [{ player: 0, kind: 'stop', ids: [1] }]], [9, [{ player: 1, kind: 'stop', ids: [2] }]]] };
const text = (r: object) => JSON.stringify(r);
const refused = (r: object | string) => typeof parseReplay(typeof r === 'string' ? r : text(r)) === 'string';

describe('replays read from storage or a file', () => {
  it('a well-formed replay is read as it is', () => {
    expect(parseReplay(text(good))).toEqual(good);
  });

  it('refuses what is not a replay of this version', () => {
    expect(refused('not json')).toBe(true);
    expect(refused({ ...good, v: 2 })).toBe(true);
    expect(refused('null')).toBe(true);
  });

  it('refuses ticks that are not pairs of a tick ≥ 0 and commands, in order', () => {
    expect(refused({ ...good, ticks: [[3, {}]] })).toBe(true);
    expect(refused({ ...good, ticks: [[-1, []]] })).toBe(true);
    expect(refused({ ...good, ticks: [[1.5, []]] })).toBe(true);
    expect(refused({ ...good, ticks: [[9, []], [3, []]] })).toBe(true);
    expect(refused({ ...good, ticks: [[3, [], 1]] })).toBe(true);
  });

  it('refuses a command from a player the replay does not have', () => {
    expect(refused({ ...good, ticks: [[3, [{ player: 2, kind: 'stop', ids: [] }]]] })).toBe(true);
    expect(refused({ ...good, ticks: [[3, [{ player: -1, kind: 'stop', ids: [] }]]] })).toBe(true);
  });

  it('refuses unknown sides, and teams or handicaps not one per side', () => {
    expect(refused({ ...good, factions: ['humains', 'orcs'] })).toBe(true);
    expect(refused({ ...good, factions: [] })).toBe(true);
    expect(refused({ ...good, teams: [0] })).toBe(true);
    expect(refused({ ...good, teams: [0, 'a'] })).toBe(true);
    expect(refused({ ...good, handicap: [100] })).toBe(true);
  });

  it('an unknown map falls back to the original one, a missing biome to the desert', () => {
    const r = parseReplay(text({ ...good, map: 'nulle-part', biome: 3 }));
    expect(typeof r).toBe('object');
    expect((r as { map?: string }).map).toBeUndefined();
    expect((r as { biome: string }).biome).toBe('desert');
  });

  it('refuses a file too big to be a replay', () => {
    expect(refused('x'.repeat(REPLAY_MAX_BYTES + 1))).toBe(true);
  });
});
