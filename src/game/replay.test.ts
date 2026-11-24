import { describe, expect, it } from 'vitest';
import { AI } from '../ai/ai';
import { MAPS, mapFile } from '../maps';
import { commandOk } from '../net';
import { createMatch } from '../sim/setup';
import { GAME_VERSION, measuresFile, parseReplay, type Replay, REPLAY_MAX_BYTES, replaySource, versionNote, withReplayBiome } from './replay';

const good = { v: 1, map: 'origine', factions: ['humains', 'z'], teams: [0, 1], biome: 'glace', handicap: [100, 100], ticks: [[3, [{ player: 0, kind: 'stop', ids: [1] }]], [9, [{ player: 1, kind: 'stop', ids: [2] }]]] };
const text = (r: object) => JSON.stringify(r);
const refused = (r: object | string) => typeof parseReplay(typeof r === 'string' ? r : text(r)) === 'string';

describe('replays read from storage or a file', () => {
  it('a well-formed replay is read as it is', () => {
    expect(parseReplay(text(good))).toEqual(good);
  });

  it('keeps a stop tick and reason after the last order, and reads older replays without them', () => {
    expect(parseReplay(text({ ...good, endTick: 40, end: 'left' }))).toEqual({ ...good, endTick: 40, end: 'left' });
    expect(parseReplay(text({ ...good, endTick: 9, end: 'nope' }))).toEqual(good);
    // The AIs' seed: kept when it is one, dropped otherwise (older replays have none and stay readable).
    expect(parseReplay(text({ ...good, seed: 123456 }))).toEqual({ ...good, seed: 123456 });
    expect(parseReplay(text({ ...good, seed: -1 }))).toEqual(good);
    expect(parseReplay(text({ ...good, seed: 'x' }))).toEqual(good);
    expect(parseReplay(text({ ...good, endTick: 2.5 }))).toEqual(good);
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
    expect((r as { lostMap?: string }).lostMap).toBe('nulle-part');
    expect((r as { biome: string }).biome).toBe('desert');
  });

  it('refuses more sides than the map it plays on has starts', () => {
    const four = { factions: ['humains', 'z', 'dieux', 'isdaris'], teams: [0, 1, 2, 3], handicap: [100, 100, 100, 100] };
    expect(refused({ ...good, ...four, map: 'le-col' })).toBe(true);
    expect(refused({ ...good, ...four, map: 'origine' })).toBe(false);
    expect(refused({ ...good, factions: ['humains', 'z', 'z'], teams: [0, 1, 1], handicap: [100, 100, 100], map: 'l-anneau' })).toBe(true);
    expect(refused({ ...good, ...four, map: 'nulle-part' })).toBe(false); // played on the original map, which has four
  });

  it('refuses an order of the wrong shape, and handicaps out of range', () => {
    const one = (c: object) => ({ ...good, ticks: [[3, [{ player: 0, ...c }]]] });
    expect(refused(one({ kind: 'move', ids: [1], x: 1, y: 2 }))).toBe(false);
    expect(refused(one({ kind: 'move', ids: [1], x: 'a', y: 2 }))).toBe(true);
    expect(refused(one({ kind: 'move', ids: Array(2000).fill(1), x: 1, y: 2 }))).toBe(true);
    expect(refused(one({ kind: 'nope', ids: [] }))).toBe(true);
    expect(refused(one({ kind: 'constructor', ids: [] }))).toBe(true);
    // The Bac à sable's switches: in its own replays (one player) only.
    const sandbox = { kind: 'sandbox', ids: [], tool: 'reveal', on: true };
    expect(refused(one(sandbox))).toBe(true);
    expect(refused({ ...one(sandbox), factions: ['humains'], teams: [0], handicap: [100] })).toBe(false);
    // A switch the simulation does not know: refused there too (it would have been dropped without a word).
    expect(refused({ ...one({ ...sandbox, tool: 'fog' }), factions: ['humains'], teams: [0], handicap: [100] })).toBe(true);
    // Positions and places in a queue are whole numbers, as the simulation takes them.
    expect(refused(one({ kind: 'move', ids: [1], x: 1.5, y: 2 }))).toBe(true);
    expect(refused(one({ kind: 'cancel', ids: [1], slot: 0.5 }))).toBe(true);
    // An AI giving up: in a replay, never from the network.
    expect(refused(one({ kind: 'resign', ids: [] }))).toBe(false);
    expect(commandOk({ player: 0, kind: 'resign', ids: [] })).toBe(false);
    // Nor alone, in a Bac à sable's replay: the simulation would ignore it.
    expect(refused({ ...one({ kind: 'resign', ids: [] }), factions: ['humains'], teams: [0], handicap: [100] })).toBe(true);
    for (const h of [-1, 1e9, 50.5, NaN]) expect(refused({ ...good, handicap: [100, h] })).toBe(true);
  });

  it('refuses a file too big to be a replay', () => {
    expect(refused('x'.repeat(REPLAY_MAX_BYTES + 1))).toBe(true);
  });

  it('opens the replay of a whole AI match: every order the AIs give passes the check', () => {
    const world = createMatch(['humains', 'z', 'dieux', 'isdaris'], [0, 1, 2, 3], 'origine');
    const ais = world.players.map((p) => new AI(world, p.id));
    const bad: unknown[] = [];
    while (world.tick < 20 * 60 * 8 && world.winner === null) {
      const cmds = ais.flatMap((ai) => ai.think());
      for (const c of cmds) if (!commandOk(JSON.parse(JSON.stringify(c)), false, true)) bad.push(c);
      world.step(cmds);
    }
    expect(bad.slice(0, 3)).toEqual([]);
  });

  it('says when a replay comes from another version of the game, whose rules may differ', () => {
    const r = (version?: unknown) => parseReplay(text({ ...good, version })) as Replay;
    expect(versionNote(r(GAME_VERSION))).toBe(null);
    expect(versionNote(r('0.9.10'))).toContain('0.9.10');
    expect(versionNote(r())).toContain('antérieure');
    expect(r('<b>x</b>').version).toBeUndefined(); // shown on screen: never markup
  });

  it("plays on the replay's own planet, whatever the address or the settings say", () => {
    const params = new URLSearchParams('replay&speed=2&biome=volcan');
    const p = withReplayBiome(params, parseReplay(text(good)) as Replay);
    expect(p.get('biome')).toBe('glace');
    expect(p.get('speed')).toBe('2');
    expect(withReplayBiome(params, null).get('biome')).toBe('volcan');
  });

  it('takes no inherited name for a side, a map or a planet', () => {
    expect(refused({ ...good, factions: ['humains', 'constructor'] })).toBe(true);
    expect(refused({ ...good, factions: ['humains', '__proto__'] })).toBe(true);
    const r = parseReplay(text({ ...good, map: 'constructor' })) as Replay;
    expect(r.map).toBeUndefined();
    expect(r.lostMap).toBe('constructor');
    expect(mapFile('constructor')).toBe(MAPS.origine);
    expect(mapFile('toString')).toBe(MAPS.origine);
  });

  it('saves a replay being watched as its file was: whole, with its own map', () => {
    expect(replaySource(parseReplay(text(good)) as Replay)).toEqual(good);
    const lost = replaySource(parseReplay(text({ ...good, map: 'nulle-part' })) as Replay);
    expect(lost).toEqual({ ...good, map: 'nulle-part' });
    expect((parseReplay(text(lost)) as Replay).lostMap).toBe('nulle-part'); // opened again: the same
  });
});

describe('measures file (telemetry and replay in one)', () => {
  it('is named by the sides and the local time, holds both, and opens as the replay alone', () => {
    const perf = { v: 1, frames: 1200, gap: { p50: 16.7 } };
    const f = measuresFile(good as Replay, perf, new Date(2026, 10, 20, 9, 5));
    expect(f.name).toBe('xcraft-mesures-humains-z-2026-11-20T09h05.json');
    const both = JSON.parse(f.text);
    expect(both.perf).toEqual(perf);
    const { perf: _, ...replay } = both;
    expect(replay).toEqual(good);
    expect(parseReplay(f.text)).toEqual(good); // « Ouvrir un replay » takes it, the telemetry left out
  });
});
