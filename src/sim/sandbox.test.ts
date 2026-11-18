import { describe, expect, it } from 'vitest';
import { FACTIONS } from '../data';
import { ticks } from './fixed';
import { createMatch } from './setup';
import type { Command, SandboxTool } from './world';

const turn = (tool: SandboxTool, on = true): Command => ({ player: 0, kind: 'sandbox', ids: [], tool, on });

describe('bac à sable', () => {
  it('a match with one player runs five minutes without ending, a normal match: fog, costs and times as usual', () => {
    const w = createMatch(['humains']);
    const p = w.players[0];
    expect(p.unlimited || p.instant || p.reveal).toBeFalsy();
    for (let i = 0; i < ticks(300); i++) w.step([]);
    expect(w.players.length).toBe(1);
    expect(w.winner).toBeNull();
    expect(p.minerals).toBeLessThan(99999);
  });

  it('its options, turned on and off: unlimited resources, instant production, the whole map', () => {
    const w = createMatch(['isdaris']);
    const f = FACTIONS.isdaris;
    const hq = [...w.entities.values()].find((e) => e.owner === 0 && e.type === f.hq)!;
    w.step([turn('unlimited'), turn('instant'), turn('reveal')]);
    const p = w.players[0];
    expect(p.minerals).toBe(99999);
    expect(p.instant && p.reveal).toBe(true);
    const count = () => [...w.entities.values()].filter((e) => e.owner === 0 && e.type === f.worker).length;
    const workers = count();
    w.step([{ player: 0, kind: 'train', ids: [hq.id], type: f.worker }]);
    w.step([]);
    w.step([]);
    expect(count()).toBe(workers + 1);
    expect(p.minerals).toBe(99999); // topped up again
    w.step([turn('unlimited', false), turn('instant', false), turn('reveal', false)]);
    expect(p.unlimited || p.instant || p.reveal).toBe(false);
  });

  it('the options do nothing in a match with two players', () => {
    const w = createMatch(['humains', 'z']);
    const before = w.players[0].minerals;
    w.step([turn('unlimited'), turn('instant')]);
    expect(w.players[0].minerals).toBe(before);
    expect(w.players[0].instant).toBeFalsy();
  });
});
