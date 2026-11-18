import { describe, expect, it } from 'vitest';
import { FACTIONS } from '../data';
import { ticks } from './fixed';
import { createMatch } from './setup';

describe('bac à sable', () => {
  it('a match with one player runs five minutes without ending', () => {
    const w = createMatch(['humains']);
    for (let i = 0; i < ticks(300); i++) w.step([]);
    expect(w.players.length).toBe(1);
    expect(w.winner).toBeNull();
  });

  it('its tools: money, instant production, the whole map', () => {
    const w = createMatch(['isdaris']);
    const f = FACTIONS.isdaris;
    const hq = [...w.entities.values()].find((e) => e.owner === 0 && e.type === f.hq)!;
    const before = w.players[0].minerals;
    w.step([{ player: 0, kind: 'sandbox', ids: [], tool: 'money' }, { player: 0, kind: 'sandbox', ids: [], tool: 'instant' }, { player: 0, kind: 'sandbox', ids: [], tool: 'reveal' }]);
    expect(w.players[0].minerals).toBe(before + 10000);
    expect(w.players[0].instant && w.players[0].reveal).toBe(true);
    const count = () => [...w.entities.values()].filter((e) => e.owner === 0 && e.type === f.worker).length;
    const workers = count();
    w.step([{ player: 0, kind: 'train', ids: [hq.id], type: f.worker }]);
    w.step([]);
    w.step([]);
    expect(count()).toBe(workers + 1);
  });

  it('the tools do nothing in a match with two players', () => {
    const w = createMatch(['humains', 'z']);
    const before = w.players[0].minerals;
    w.step([{ player: 0, kind: 'sandbox', ids: [], tool: 'money' }, { player: 0, kind: 'sandbox', ids: [], tool: 'instant' }]);
    expect(w.players[0].minerals).toBe(before);
    expect(w.players[0].instant).toBeFalsy();
  });
});
