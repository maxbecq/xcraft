import { existsSync, readFileSync } from 'node:fs';
import { it } from 'vitest';
import { AI } from '../src/ai/ai';
import type { Faction } from '../src/data';
import { fingerprint } from '../src/sim/fingerprint';
import { Grid } from '../src/sim/grid';
import { ticks } from '../src/sim/fixed';
import { createMatch } from '../src/sim/setup';
import { type Command, World } from '../src/sim/world';

// Reference games for a change that must leave the simulation and the AI exactly as they were: each game's final tick,
// winner, world.hash(), full fingerprint, a checksum of the fingerprint taken every 200 ticks and of every command the
// AIs gave, with the time the simulation and the AIs took (average and worst, ms). Run it before and after the change:
// every line but the times must come out the same.
// The fingerprint counts keys and the lasting grids since quality control lot A: its `fingerprint` and `course`
// (which mixes it in) differ from a baseline taken before; compare tick, winner, hash and entities with such a one.
// Games: AI against AI over the four factions and several maps, and a replay file if given (EMPREINTE_REPLAY=path, a
// saved game or a measures file).
// Run: EMPREINTE=1 npx vitest run scripts/empreinte.test.ts --silent=false
const GAMES: [Faction[], string][] = [
  [['humains', 'z'], 'origine'],
  [['isdaris', 'dieux'], 'le-col'],
  [['z', 'isdaris'], 'l-anneau'],
  [['dieux', 'humains'], 'les-ponts'],
  [['isdaris', 'humains'], 'carrefour'],
  [['z', 'dieux'], 'origine'],
];
const LIMIT = ticks(25 * 60);

function play(name: string, world: World, commands: (w: World) => Command[]): void {
  let sum = 2166136261;
  const mix = (v: number) => (sum = Math.imul(sum ^ v, 16777619) >>> 0);
  const time = { sim: 0, simMax: 0, simMaxAt: 0, ai: 0, aiMax: 0, aiMaxAt: 0 };
  const worst: { tick: number; ms: number; into: string }[] = [];
  let before: Record<string, number> = {};
  let callsBefore: Record<string, number> = {};
  while (world.winner === null && world.tick < LIMIT) {
    const t0 = performance.now();
    const cmds = commands(world);
    const t1 = performance.now();
    for (const c of cmds) for (const ch of JSON.stringify(c)) mix(ch.charCodeAt(0));
    world.step(cmds);
    const t2 = performance.now();
    if (process.env.EMPREINTE_PROFIL) {
      // The worst steps of the game, each with what its time went into.
      const now = Object.fromEntries(Object.entries(PROFILE).map(([k, p]) => [k, p.ms]));
      const calls = Object.fromEntries(Object.entries(PROFILE).map(([k, p]) => [k, p.calls]));
      if (t2 - t1 > (worst[worst.length - 1]?.ms ?? 0) || worst.length < 5) {
        worst.push({ tick: world.tick - 1, ms: t2 - t1, into: Object.entries(now).map(([k, ms]) => [k, ms - (before[k] ?? 0)] as [string, number]).filter(([, ms]) => ms >= 0.5).sort((x, y) => y[1] - x[1]).map(([k, ms]) => `${k} ${ms.toFixed(1)}/${calls[k] - (callsBefore[k] ?? 0)}`).join(', ') });
        worst.sort((x, y) => y.ms - x.ms);
        worst.length = Math.min(worst.length, 5);
      }
      before = now;
      callsBefore = calls;
    }
    time.ai += t1 - t0;
    time.sim += t2 - t1;
    if (t1 - t0 > time.aiMax) [time.aiMax, time.aiMaxAt] = [t1 - t0, world.tick];
    if (t2 - t1 > time.simMax) [time.simMax, time.simMaxAt] = [t2 - t1, world.tick];
    if (world.tick % 200 === 0) mix(fingerprint(world));
  }
  const r = (x: number) => Math.round(x * 1000) / 1000;
  console.log('EMPREINTE', name, JSON.stringify({ tick: world.tick, winner: world.winner, hash: world.hash() >>> 0, fingerprint: fingerprint(world) >>> 0, course: sum, entities: world.entities.size }));
  if (process.env.EMPREINTE_PROFIL) {
    console.log('PROFIL', name, Object.entries(PROFILE).filter(([, p]) => p.calls).sort((x, y) => y[1].ms - x[1].ms).map(([k, p]) => `${k} ${p.ms.toFixed(0)} ms/${p.calls}`).join(' · '));
    for (const w of worst) console.log('POINTE', name, `tick ${w.tick}: ${w.ms.toFixed(1)} ms (${w.into})`);
    for (const p of Object.values(PROFILE)) p.ms = p.calls = 0;
  }
  console.log('TEMPS', name, JSON.stringify({ simMsPerTick: r(time.sim / world.tick), simMax: r(time.simMax), simMaxAt: time.simMaxAt, aiMsPerTick: r(time.ai / world.tick), aiMax: r(time.aiMax), aiMaxAt: time.aiMaxAt, totalS: r((time.sim + time.ai) / 1000) }));
}

/** EMPREINTE_PROFIL=1: the time spent inside a few functions of the simulation and the AI (inclusive, ms a game) and
 * their calls, to see where a change pays. The wrappers slow the game: its times then are not to be compared. */
const PROFILE: Record<string, { ms: number; calls: number }> = {};
function profile(proto: object, names: string[]): void {
  for (const name of names) {
    const f = (proto as Record<string, (...a: unknown[]) => unknown>)[name];
    const p = (PROFILE[name] = { ms: 0, calls: 0 });
    Object.defineProperty(proto, name, {
      configurable: true,
      writable: true,
      value(this: unknown, ...args: unknown[]) {
        const t = performance.now();
        try {
          return f.apply(this, args);
        } finally {
          p.ms += performance.now() - t;
          p.calls++;
        }
      },
    });
  }
}

it.skipIf(!process.env.EMPREINTE)('empreintes', () => {
  if (process.env.EMPREINTE_PROFIL) {
    profile(World.prototype, ['nearestDropoff', 'nearestField', 'nearCouncil', 'armorBonus', 'rechargeShields', 'blow', 'powerNetwork', 'canPlace', 'think', 'operate', 'separate', 'see', 'index', 'acquire', 'findPathFor', 'goNear']);
    profile(Grid.prototype, ['findPath', 'nearestDoors', 'nearestOpen', 'lineWalkable']);
    profile(World.prototype, ['plan', 'chase', 'gather', 'construct', 'hit', 'strike', 'judge', 'bury', 'repairOnCreep', 'apply', 'pulse', 'regenerate', 'revive']);
    profile(AI.prototype, ['spot', 'walkable', 'closeToResources', 'research', 'think']);
  }
  const only = process.env.EMPREINTE_GAMES?.split(',');
  for (const [factions, map] of GAMES) {
    const name = `${factions.join('-')}@${map}`;
    if (only && !only.includes(name)) continue;
    const world = createMatch(factions, undefined, map);
    const ais = factions.map((_, i) => new AI(world, i));
    play(name, world, () => ais.flatMap((ai) => ai.think()));
  }
  const file = process.env.EMPREINTE_REPLAY;
  if (file && existsSync(file)) {
    const r = JSON.parse(readFileSync(file, 'utf8'));
    const world = createMatch(r.factions, r.teams, r.map, r.biome);
    r.handicap.forEach((h: number, i: number) => (world.players[i].handicap = h));
    const byTick = new Map<number, Command[]>(r.ticks);
    play('replay', world, (w) => byTick.get(w.tick) ?? []);
  }
}, 3_600_000);
