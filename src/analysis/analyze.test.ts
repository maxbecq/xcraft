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

  it('relève un groupe tué entier à la première salve, loin de chez lui', () => {
    const w = createMatch(['isdaris', 'humains']);
    const [cx, cy] = [(w.map.width / 2) * FP, (w.map.height / 2) * FP];
    for (let i = 0; i < 12; i++) w.spawn('auxiliaire', 1, cx + (i % 4) * FP, cy + Math.floor(i / 4) * FP);
    w.spawn('creature', 0, cx - 2 * FP, cy + FP);
    const a = new Analyzer(w);
    run(w, 20, a);
    const k = kinds(a, 0);
    expect(k.has('combat-en-inferiorite')).toBe(true);
    expect(k.has('pas-de-repli')).toBe(true);
  });

  // Codex, 2026-11-26 (final review): one group per player and tick was kept, so a second one wiped the same tick
  // elsewhere went unseen.
  it.each([11, 7.5])('relève deux groupes tués entiers au même moment, à deux endroits (%s cases du milieu)', (half) => {
    const w = createMatch(['isdaris', 'humains']);
    const [cx, cy] = [(w.map.width / 2) * FP, (w.map.height / 2) * FP];
    const doomed = [-half * FP, half * FP].map((ox) => {
      for (let i = 0; i < 12; i++) w.spawn('auxiliaire', 1, cx + ox + (i % 4) * FP, cy + Math.floor(i / 4) * FP);
      return w.spawn('creature', 0, cx + ox - 2 * FP, cy + FP);
    });
    const a = new Analyzer(w);
    // Both killed in the same tick (in a game, two volleys landing together).
    run(w, 20, a, (w) => {
      if (w.tick === 1) for (const c of doomed) w.hurt(c, 100000);
      return [];
    });
    const fights = a.finish().faults.filter((f) => f.player === 0 && f.kind === 'combat-en-inferiorite');
    expect(fights).toHaveLength(2);
  });

  // Codex, 2026-11-26 (final review 3, point 8): the second group wiped took the place of the fight remembered, and a
  // third group fighting 15 tiles from it, 30 from the first, kept that judged engagement alive: never judged itself.
  it('juge un troisième combat voisin de deux groupes tués entiers', () => {
    const w = createMatch(['isdaris', 'humains']);
    const [cx, cy] = [(w.map.width / 2) * FP, (w.map.height / 2) * FP];
    const groups = [-15, 0, 12].map((ox) => {
      for (let i = 0; i < 12; i++) w.spawn('auxiliaire', 1, cx + ox * FP + (i % 4) * FP, cy + Math.floor(i / 4) * FP);
      return [0, 1].map((k) => w.spawn('creature', 0, cx + ox * FP - 2 * FP, cy + k * FP));
    });
    // The third holds out (its fight is judged 5 s in): hit points enough, its worth unchanged.
    for (const c of groups[2]) Object.assign(c, { hp: 1e7, maxHp: 1e7 });
    const a = new Analyzer(w);
    run(w, 20, a, (w) => {
      if (w.tick === 1) for (const c of [...groups[0], ...groups[1]]) w.hurt(c, 100000);
      return [];
    });
    const fights = a.finish().faults.filter((f) => f.player === 0 && f.kind === 'combat-en-inferiorite');
    expect(fights).toHaveLength(3);
    expect(fights.some((f) => (f.x ?? 0) > cx / FP + 6)).toBe(true);
  });

  it('ferme les états d’un joueur au moment où il abandonne, la partie continuant avec son allié', () => {
    const w = createMatch(['humains', 'humains', 'humains', 'humains'], [0, 0, 1, 1]);
    w.players[0].minerals = 2000;
    const a = new Analyzer(w);
    run(w, 1, a);
    run(w, 1, a, () => (w.players[0].resigned ? [] : [{ player: 0, kind: 'resign', ids: [] }]));
    run(w, 100, a);
    expect(w.winner).toBeNull();
    const floats = a.finish().faults.filter((f) => f.player === 0 && f.kind === 'ressources-accumulees');
    expect(floats).toEqual([]);
  });

  it('lit un ancien replay sans fin enregistrée jusqu’à la victoire, jouée après le dernier ordre', () => {
    // The Z AI against an idle side, silent its last 5 s (11 000 on): the win at 11 101, some ticks after its last
    // order. Ordering to the end, the win came the tick after it once attack-moves replanned where they stood (point
    // 115), and nothing was left to play past the last order.
    const live = createMatch(['z', 'humains']);
    const ai = new AI(live, 0);
    const record: [number, Command[]][] = [];
    while (live.tick < 20 * 60 * TICK_RATE && live.winner === null) {
      const cmds = live.tick < 11000 ? ai.think() : [];
      if (cmds.length) record.push([live.tick, cmds]);
      live.step(cmds);
    }
    expect(live.winner).toBe(0);
    expect(record[record.length - 1][0] + 1).toBeLessThan(live.tick);
    const replay: Replay = JSON.parse(JSON.stringify({ v: 1, factions: ['z', 'humains'], biome: '', handicap: [100, 100], ticks: record }));
    const again = analyzeReplay(replay);
    expect(again.winner).toBe(0);
    expect(again.ticks).toBe(live.tick);
    expect(again.truncated).toBeUndefined();
    // Cut before the win: played on to REPLAY_TAIL past its last order, and told as cut short.
    const cut = analyzeReplay({ ...replay, ticks: record.slice(0, 1) }, Infinity);
    expect(cut.winner).toBeNull();
    expect(cut.truncated).toBe(true);
    expect(reportMarkdown(cut)).toContain('analyse tronquée');
  }, 120_000);

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
