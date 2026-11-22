/**
 * The orders' shape, one check for every way an order comes in: from the other side of a network game, from a replay
 * file, and in the simulation itself (World.apply), so none accepts what another drops. What an order may do (whose
 * units, what it costs) stays the simulation's to decide.
 */

/** Units in one order: well above anything a player can give. */
export const MAX_IDS = 1024;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Every number of an order is a whole one: positions in fixed point, tiles, ids, a place in a queue. */
const int = (v: unknown): v is number => Number.isSafeInteger(v) && Math.abs(v as number) < 2 ** 31;
const word = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 40;
/** Each order's fields by kind (mirrors `Command` in sim/world.ts): n a whole number, s a short string, b a flag, ? optional. */
const FIELDS: Record<string, Record<string, string>> = {
  move: { x: 'n', y: 'n', queue: 'b?' },
  smart: { x: 'n', y: 'n', target: 'n?', queue: 'b?' },
  rally: { x: 'n', y: 'n', target: 'n?' },
  stop: {},
  hold: {},
  patrol: { x: 'n', y: 'n', queue: 'b?' },
  build: { type: 's', tx: 'n', ty: 'n', queue: 'b?' },
  train: { type: 's', weapon: 's?' },
  arm: { weapon: 's' },
  evolve: {},
  cancel: { slot: 'n?' },
  unload: { unit: 'n?' },
  ability: { x: 'n?', y: 'n?', name: 's?' },
  trade: { sell: 's' },
  attack: { x: 'n', y: 'n', target: 'n?', queue: 'b?' },
  autocast: { name: 's', on: 'b' },
};
/** The Bac à sable's switches: one-player matches (and their replays) only, never online. */
const SANDBOX_FIELDS = { tool: 's', on: 'b' };
const SANDBOX_TOOLS = ['unlimited', 'instant', 'reveal'];

/**
 * Whether an order has the shape the simulation expects; anything else never reaches it. `sandbox`: the Bac à sable's
 * switches are allowed too. `replay`: an AI giving up too (a replay file, the simulation; never from the network,
 * where nobody gives up a game between friends).
 */
export function commandOk(c: unknown, sandbox = false, replay = false): boolean {
  if (!isRecord(c) || typeof c.kind !== 'string') return false;
  const fields = sandbox && c.kind === 'sandbox' ? SANDBOX_FIELDS : replay && c.kind === 'resign' ? {} : Object.hasOwn(FIELDS, c.kind) ? FIELDS[c.kind] : null;
  if (!fields) return false;
  if (!Array.isArray(c.ids) || c.ids.length > MAX_IDS || !c.ids.every(int)) return false;
  if (c.kind === 'trade' && c.sell !== 'minerals' && c.sell !== 'energy') return false;
  if (c.kind === 'sandbox' && !SANDBOX_TOOLS.includes(c.tool as string)) return false;
  // Both coordinates or neither (an aimed power).
  if ((c.x === undefined) !== (c.y === undefined)) return false;
  return Object.entries(fields).every(([k, t]) => {
    const v = c[k];
    if (t.endsWith('?') && v === undefined) return true;
    return t[0] === 'n' ? int(v) : t[0] === 's' ? word(v) : typeof v === 'boolean';
  });
}
