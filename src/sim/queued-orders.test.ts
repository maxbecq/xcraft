import { describe, expect, it } from 'vitest';
import { createMap } from '../map';
import { FP } from './fixed';
import { fingerprint } from './fingerprint';
import { createMatch } from './setup';
import { type Command, type Entity, World } from './world';

const at = (tx: number, ty: number) => [tx * FP + FP / 2, ty * FP + FP / 2] as const;

/** A worker walking with one more move queued with Shift, and a building of `type` beside it, both player 0's. */
function setup(type: string, faction: 'humains' | 'z' = 'humains') {
  const w = new World(createMap());
  w.players[0].faction = faction;
  const worker = w.spawn(faction === 'z' ? 'drone' : 'serf', 0, ...at(40, 60));
  const building = w.spawn(type, 0, 44 * FP, 64 * FP);
  if (faction === 'humains') w.spawn('grenier', 0, 30 * FP, 64 * FP); // supply, or a unit is refused for want of it
  w.step([{ player: 0, kind: 'move', ids: [worker.id], x: at(48, 60)[0], y: at(48, 60)[1] }]);
  w.step([{ player: 0, kind: 'move', ids: [worker.id], x: at(48, 70)[0], y: at(48, 70)[1], queue: true }]);
  return { w, worker, building };
}
const queued = (e: Entity) => e.next.length;

describe('Shift-queued orders through a production or a purchase (rule of 0.9.52)', () => {
  // Each: the building, what is bought there with the worker selected along, without Shift.
  const purchases: [string, string, 'humains' | 'z', (ids: number[]) => Command][] = [
    ['a research at the Forge', 'forge', 'humains', (ids) => ({ player: 0, kind: 'train', ids, type: 'melee1' })],
    ['a trade at the Marché', 'marche', 'humains', (ids) => ({ player: 0, kind: 'trade', ids, sell: 'minerals' })],
    ['a unit at the Caserne', 'caserne', 'humains', (ids) => ({ player: 0, kind: 'train', ids, type: 'auxiliaire' })],
    ['a Z weapon research', 'armement', 'z', (ids) => ({ player: 0, kind: 'train', ids, type: 'laser' })],
    ['a rally point for the building', 'caserne', 'humains', (ids) => ({ player: 0, kind: 'rally', ids, x: at(30, 30)[0], y: at(30, 30)[1] })],
  ];
  for (const [what, type, faction, cmd] of purchases) {
    for (const rich of [true, false])
      it(`stay through ${what}, ${rich ? 'paid' : 'refused (nothing to pay with)'}`, () => {
        const { w, worker, building } = setup(type, faction);
        expect(queued(worker)).toBe(1);
        w.players[0].minerals = w.players[0].energy = rich ? 10_000 : 0;
        w.step([cmd([worker.id, building.id])]);
        // Paid, it did happen (queued, traded or rallied); refused, it did not.
        const happened = building.queue.length > 0 || w.players[0].minerals !== (rich ? 10_000 : 0) || w.players[0].energy !== (rich ? 10_000 : 0) || building.rally !== null;
        expect(happened).toBe(rich || what.startsWith('a rally'));
        expect(queued(worker)).toBe(1);
        expect(worker.order?.kind).toBe('move');
      });
  }

  it('stay through a cancel at the building', () => {
    const { w, worker, building } = setup('caserne');
    w.players[0].minerals = w.players[0].energy = 10_000;
    w.step([{ player: 0, kind: 'train', ids: [building.id], type: 'auxiliaire' }]);
    w.step([{ player: 0, kind: 'cancel', ids: [worker.id, building.id] }]);
    expect(building.queue).toEqual([]);
    expect(queued(worker)).toBe(1);
  });

  it('go when the worker itself is given a new order without Shift', () => {
    const { w, worker } = setup('caserne');
    w.step([{ player: 0, kind: 'move', ids: [worker.id], x: at(40, 60)[0], y: at(40, 60)[1] }]);
    expect(queued(worker)).toBe(0);
  });
});

describe('an invalid command changes nothing', () => {
  // Twin matches: one given the command, the other nothing; the whole state must stay the same.
  const invalid: [string, (w: World) => Command][] = [];
  const own = (w: World, player: number, kind: 'unit' | 'building') => [...w.entities.values()].find((e) => e.owner === player && e.def.kind === kind)!;
  invalid.push(
    ['moving the other player\'s units', (w) => ({ player: 0, kind: 'move', ids: [own(w, 1, 'unit').id], x: at(30, 30)[0], y: at(30, 30)[1] })],
    ['stopping the other player\'s units', (w) => ({ player: 0, kind: 'stop', ids: [own(w, 1, 'unit').id] })],
    ['holding with the other player\'s units', (w) => ({ player: 0, kind: 'hold', ids: [own(w, 1, 'unit').id] })],
    ['ids of nothing', () => ({ player: 0, kind: 'move', ids: [99_999], x: 1000, y: 1000 })],
    ['training at the other player\'s building', (w) => ({ player: 0, kind: 'train', ids: [own(w, 1, 'building').id], type: 'serf' })],
    ['training an unknown type', (w) => ({ player: 0, kind: 'train', ids: [own(w, 0, 'building').id], type: 'nope' })],
    ['training another faction\'s unit', (w) => ({ player: 0, kind: 'train', ids: [own(w, 0, 'building').id], type: 'drone' })],
    ['building with no worker named', (w) => ({ player: 0, kind: 'build', ids: [own(w, 0, 'building').id], type: 'caserne', tx: 30, ty: 30 })],
    ['building another faction\'s building', (w) => ({ player: 0, kind: 'build', ids: [own(w, 0, 'unit').id], type: 'armement', tx: 30, ty: 30 })],
    ['a trade with no Marché', (w) => ({ player: 0, kind: 'trade', ids: [own(w, 0, 'building').id], sell: 'minerals' })],
    ['a move to a point that is not a number', (w) => ({ player: 0, kind: 'move', ids: [own(w, 0, 'unit').id], x: NaN, y: 1 })],
    ['a move to a fractional point', (w) => ({ player: 0, kind: 'move', ids: [own(w, 0, 'unit').id], x: 1.5, y: 1 })],
    ['ids that are not a list', () => ({ player: 0, kind: 'stop', ids: 'all' as unknown as number[] })],
    ['a cancel at an empty queue', (w) => ({ player: 0, kind: 'cancel', ids: [own(w, 0, 'building').id] })],
    ['an unload with nobody inside', (w) => ({ player: 0, kind: 'unload', ids: [own(w, 0, 'building').id] })],
    ['an unknown ability', (w) => ({ player: 0, kind: 'ability', ids: [own(w, 0, 'unit').id], name: 'nope' })],
    ['a Z weapon bought by the Humains', (w) => ({ player: 0, kind: 'arm', ids: [own(w, 0, 'unit').id], weapon: 'laser' })],
    ['a Z evolution asked by the Humains', (w) => ({ player: 0, kind: 'evolve', ids: [own(w, 0, 'building').id] })],
    ['a sandbox tool in a two-player match', () => ({ player: 0, kind: 'sandbox', ids: [], tool: 'unlimited', on: true })],
    ['an unknown kind of order', (w) => ({ player: 0, kind: 'nope', ids: [own(w, 0, 'unit').id] }) as unknown as Command],
  );
  it('(a valid command does change it: the check can tell)', () => {
    const a = createMatch(['humains', 'z']);
    const b = createMatch(['humains', 'z']);
    const unit = [...a.entities.values()].find((e) => e.owner === 0 && e.def.kind === 'unit')!;
    a.step([{ player: 0, kind: 'move', ids: [unit.id], x: at(30, 30)[0], y: at(30, 30)[1] }]);
    b.step([]);
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  for (const [what, cmd] of invalid)
    it(`: ${what}`, () => {
      const a = createMatch(['humains', 'z']);
      const b = createMatch(['humains', 'z']);
      for (let i = 0; i < 40; i++) [a, b].forEach((w) => w.step([])); // settled: workers at work
      a.step([cmd(a)]);
      b.step([]);
      expect(fingerprint(a)).toBe(fingerprint(b));
      for (let i = 0; i < 100; i++) [a, b].forEach((w) => w.step([])); // and nothing comes of it later
      expect(fingerprint(a)).toBe(fingerprint(b));
    });
});
