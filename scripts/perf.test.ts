import { it } from 'vitest';
import { AI } from '../src/ai/ai';
import type { Faction } from '../src/data';
import { FP, ticks } from '../src/sim/fixed';
import { createMatch } from '../src/sim/setup';
import { World } from '../src/sim/world';
import { Grid } from '../src/sim/grid';
// CPU cost of the simulation and the AI, and a fingerprint of the end state (it must not change when optimising).
// Run: PERF=1 npx vitest run scripts/perf.test.ts
const fingerprint = (w: World) => {
  let h = w.tick;
  for (const e of w.entities.values()) h = (Math.imul(h, 31) + e.id * 7 + e.x * 3 + e.y * 5 + e.hp) | 0;
  for (const p of w.players) h = (Math.imul(h, 31) + p.minerals + p.energy * 3) | 0;
  return h;
};
it.skipIf(!process.env.PERF)('perf', () => {
  // PROFILE=1: time spent in each World method (self time not separated: nested calls count in both).
  const spent = new Map<string, number>();
  let paths = 0;
  let pathMs = 0;
  let slow = 0;
  if (process.env.PROFILE) {
    const gp = Grid.prototype as unknown as { findPath: (...a: number[]) => number[] };
    const find = gp.findPath;
    gp.findPath = function (this: Grid, ...a: number[]) {
      const t0 = performance.now();
      const r = find.apply(this, a);
      const d = performance.now() - t0;
      if (d > 10) process.stdout.write(`\nSLOWPATH ${d.toFixed(1)}ms ${a.join(',')} len ${r.length}\n`);
      paths++;
      pathMs += d;
      if (d > 1) slow++;
      return r;
    };
    const proto = World.prototype as unknown as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const f = proto[name];
      if (name === 'constructor' || typeof f !== 'function') continue;
      proto[name] = function (this: { tick: number }, ...args: unknown[]) {
        if (process.env.AT && this.tick !== Number(process.env.AT)) return (f as (...x: unknown[]) => unknown).apply(this, args);
        const a = performance.now();
        try {
          return (f as (...x: unknown[]) => unknown).apply(this, args);
        } finally {
          spent.set(name, (spent.get(name) ?? 0) + performance.now() - a);
        }
      };
    }
  }
  const run = (label: string, w: World, seconds: number) => {
    const ais = w.players.map((p) => new AI(w, p.id));
    let sim = 0;
    let ai = 0;
    let peak = 0;
    let peakAt = 0;
    let peakAi = 0;
    const n = ticks(seconds);
    for (let t = 0; t < n && w.winner === null; t++) {
      const a = performance.now();
      const cmds = ais.flatMap((x) => x.think());
      const b = performance.now();
      w.step(cmds);
      const c = performance.now();
      ai += b - a;
      sim += c - b;
      if (c - a > peak) [peak, peakAt, peakAi] = [c - a, w.tick, b - a];
    }
    const units = [...w.entities.values()].filter((e) => e.def.kind === 'unit').length;
    process.stdout.write(`\nPERF ${label}: sim ${((sim * 1000) / w.tick).toFixed(0)} µs/tick, ai ${((ai * 1000) / w.tick).toFixed(0)} µs/tick, peak ${peak.toFixed(1)} ms (tick ${peakAt}, ai ${peakAi.toFixed(1)} ms), units ${units}, ticks ${w.tick}, fp ${fingerprint(w)}\n`);
  };
  if (!process.env.BATTLE) for (const pair of [['humains', 'isdaris'], ['z', 'humains']] as [Faction, Faction][]) run(`game ${pair.join('-')} 12 min`, createMatch(pair), 12 * 60);
  // A big fight in the middle of the map: 100 soldiers a side.
  const w = createMatch(['humains', 'isdaris']);
  for (let i = 0; i < 100; i++) {
    w.spawn('auxiliaire', 0, (44 + (i % 10)) * FP, (52 + Math.floor(i / 10)) * FP);
    w.spawn(i % 2 ? 'creature' : 'archer', 1, (56 + (i % 10)) * FP, (52 + Math.floor(i / 10)) * FP);
  }
  run('battle 200 units 40 s', w, 40);
  if (paths) process.stdout.write(`\nPATHS ${paths} searches, ${pathMs.toFixed(0)} ms, ${slow} over 1 ms\n`);
  if (spent.size) process.stdout.write(`\nPROFILE ${[...spent].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${k} ${v.toFixed(0)}ms`).join(' | ')}\n`);
}, 600_000);
