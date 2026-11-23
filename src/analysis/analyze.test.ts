import { describe, expect, it } from 'vitest';
import { AI } from '../ai/ai';
import { FACTIONS } from '../data';
import type { Replay } from '../game/replay';
import { FP, TICK_RATE } from '../sim/fixed';
import { createMatch } from '../sim/setup';
import type { Command, World } from '../sim/world';
import { Analyzer, analyzeReplay, type FaultKind, reportMarkdown } from './analyze';

const run = (w: World, seconds: number, a: Analyzer, cmds: (w: World) => Command[] = () => []) => {
  const end = w.tick + seconds * TICK_RATE;
  while (w.tick < end && w.winner === null) {
    w.step(cmds(w));
    a.observe();
  }
};
const kinds = (a: Analyzer, p: number) => new Set(a.finish().faults.filter((f) => f.player === p).map((f) => f.kind));

describe('analyse de partie', () => {
  it('relève des ouvriers sans ordre et des ressources qui dorment', () => {
    const w = createMatch(['humains', 'humains']);
    w.players[0].minerals = 2000;
    const a = new Analyzer(w);
    run(w, 70, a);
    const k = kinds(a, 0);
    expect(k.has('ouvriers-inactifs')).toBe(true);
    expect(k.has('ressources-accumulees')).toBe(true);
    // Player 2 has 200 minerals only: no hoard.
    expect(kinds(a, 1).has('ressources-accumulees')).toBe(false);
  });

  it('relève une base perdue jamais remplacée, pas une base remplacée', () => {
    const w = createMatch(['humains', 'humains']);
    const [hx, hy] = [10, 30];
    const extra = w.spawn('conseil', 0, hx * FP, hy * FP);
    const a = new Analyzer(w);
    run(w, 5, a);
    w.remove(extra);
    run(w, 70, a);
    const lost = a.finish().faults.filter((f) => f.kind === 'base-perdue');
    expect(lost.map((f) => f.player)).toEqual([0]);
  });

  it('relève un dieu isolé, un combat en infériorité et l’absence de repli', () => {
    const w = createMatch(['dieux', 'humains']);
    const [cx, cy] = [(w.map.width / 2) * FP, (w.map.height / 2) * FP];
    const god = w.spawn(FACTIONS.dieux.gods![0], 0, cx, cy);
    const foes = Array.from({ length: 16 }, (_, i) => w.spawn('legionnaire', 1, cx + (2 + (i % 3)) * FP, cy + ((i % 4) - 2) * FP));
    const a = new Analyzer(w);
    let sent = false;
    run(w, 40, a, () => (sent ? [] : ((sent = true), [{ player: 1, kind: 'attack', ids: foes.map((e) => e.id), x: god.x, y: god.y, target: god.id }])));
    const k: Set<FaultKind> = kinds(a, 0);
    expect(k.has('unite-cle-exposee')).toBe(true);
    expect(k.has('combat-en-inferiorite')).toBe(true);
    expect(k.has('pas-de-repli')).toBe(true);
    expect(kinds(a, 1).has('combat-en-inferiorite')).toBe(false);
  });

  it('relève des renforts envoyés un par un, pas un groupe perdu d’un coup', () => {
    for (const oneByOne of [true, false]) {
      const w = createMatch(['isdaris', 'humains']);
      const [cx, cy] = [(w.map.width / 2) * FP, (w.map.height / 2) * FP];
      for (let i = 0; i < 12; i++) w.spawn('auxiliaire', 1, cx + (i % 4) * FP, cy + Math.floor(i / 4) * FP);
      const a = new Analyzer(w);
      const send = (n: number): Command[] => {
        const ids = Array.from({ length: n }, (_, i) => w.spawn('creature', 0, cx - 8 * FP, cy + (i % 4) * FP).id);
        return [{ player: 0, kind: 'attack', ids, x: cx, y: cy }];
      };
      // One Créature every 6 s, or the eight at once.
      run(w, 60, a, (w) => (oneByOne ? (w.tick % (6 * TICK_RATE) === 0 && w.tick < 48 * TICK_RATE ? send(1) : []) : w.tick === 1 ? send(8) : []));
      expect(kinds(a, 0).has('renforts-goutte-a-goutte')).toBe(oneByOne);
    }
  });

  it('rejoue un replay et trouve la même chose que pendant la partie', () => {
    const factions = ['z', 'isdaris'] as const;
    const live = createMatch([...factions]);
    const ais = [new AI(live, 0), new AI(live, 1)];
    const a = new Analyzer(live);
    const record: [number, Command[]][] = [];
    while (live.tick < 8 * 60 * TICK_RATE && live.winner === null) {
      const cmds = ais.flatMap((ai) => ai.think());
      if (cmds.length) record.push([live.tick, cmds]);
      live.step(cmds);
      a.observe();
    }
    const done = a.finish();
    const replay: Replay = JSON.parse(JSON.stringify({ v: 1, factions, biome: '', handicap: [100, 100], ticks: record, endTick: live.tick }));
    const again = analyzeReplay(replay);
    expect(again.ticks).toBe(done.ticks);
    expect(again.faults).toEqual(done.faults);
    expect(again.notes).toEqual(done.notes);
    expect(again.timeline.length).toBe(Math.floor(live.tick / (10 * TICK_RATE)));
    for (const f of done.faults) expect(f.tick).toBeLessThanOrEqual(done.ticks);
    const md = reportMarkdown(again);
    expect(md).toContain('## J1 (');
    expect(md).toContain('### Tactique et stratégie');
  }, 120_000);
});
