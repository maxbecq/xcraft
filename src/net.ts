import Peer, { type DataConnection } from 'peerjs';
import { commandOk } from './sim/validate';
import type { Command } from './sim/world';

/** The orders' check, the simulation's own (net and replay files share it). */
export { commandOk };

/**
 * Two-player lockstep over WebRTC. Both browsers run the same deterministic simulation; each tick, each side sends
 * the orders it gave, to be carried out a few ticks later on both sides. A tick is only simulated once the other
 * side's orders for it have arrived, so a slow connection stalls the game rather than letting it drift apart.
 * PeerJS's public server only introduces the two browsers to each other.
 *
 * `Lockstep` is the protocol alone (no network: `send` and `receive`), so tests can run two of them over a link that
 * delays, drops and reorders; `connect` plugs it into PeerJS, reconnecting after a cut.
 */
/** The first ticks carry nobody's orders: both sides start them at once. */
export const START = 4;
/** The input delay, in ticks, stays within these; it follows the measured round trip. */
const MIN_DELAY = 2;
const MAX_DELAY = 15;
/** This page's build: two different ones may not simulate alike, so they never play together. */
const VERSION = typeof __COMMIT__ === 'string' ? __COMMIT__ : 'dev';
const OTHER_VERSION = 'Votre ami a une autre version du jeu : rechargez la page (tous les deux).';
/** Room codes avoid letters that read alike (0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * `t`: our orders for tick t; `a`: the first tick of theirs we still miss (everything before it arrived), on every
 * message, so each side forgets what the other has. `h`/`v`: a state fingerprint. `p`/`q`: ping and its echo.
 * `hi`: who this page is and its build, first thing on every connection. `bye`: leaving the match on purpose. `again`: a rematch
 * asked for; `go`: the host's room for it, once both asked.
 */
export type Message = { t: number; c: Command[]; a: number } | { h: number; v: number } | { p: number; a: number } | { q: number } | { hi: string; v?: string } | { bye: 1 } | { again: 1 } | { go: string };

export class Lockstep {
  /** The other side's orders, by tick. */
  private readonly theirs = new Map<number, Command[]>();
  /** Our orders, by the tick they will run at. */
  private readonly ours = new Map<number, Command[]>();
  /** Our orders the other side has not confirmed yet, with when they were last sent. */
  private readonly unacked = new Map<number, { c: Command[]; at: number }>();
  /** Orders given while the delay shrinks, waiting for the next free tick. */
  private held: Command[] = [];
  /** The next tick our orders go to. */
  private next = START;
  /** The first tick of theirs not received yet. */
  private missing = START;
  private readonly mine = new Map<number, number>();
  private readonly their = new Map<number, number>();
  /** Recent round trips, ms. */
  private readonly trips: number[] = [];
  private pinged = -Infinity;
  /** When the other side was last heard from (any message). */
  heard: number;
  /** Ticks between giving an order and carrying it out. */
  delay = START;
  /** The first tick where the two games were found to differ. */
  desync: number | null = null;
  /** The other side left the match on purpose. */
  left = false;

  /** `player`: 0 hosts the room, 1 joins it. */
  constructor(
    readonly player: number,
    private readonly send: (m: Message) => void,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.heard = now();
  }

  /**
   * Trust boundary: everything the other side sends is checked for shape and kept within bounds before it is used,
   * whatever a modified page might send. A message that fails is ignored (orders not taken stall the game, and the
   * other side is then counted absent).
   */
  receive(raw: unknown): void {
    if (!isRecord(raw)) return this.reject('not an object', raw);
    const m = raw;
    if ('t' in m) {
      const t = m.t;
      // Never past what our own orders allow: the other side cannot run a tick before ours for it arrived, so an honest
      // one stays within its delay of `next`; the store is bounded by how far this side has played, not by what came.
      if (!int(t) || t > this.next + WINDOW) return this.reject('tick out of reach', m);
      if (t >= this.missing && !this.theirs.has(t)) {
        if (!Array.isArray(m.c) || m.c.length > MAX_ORDERS || !m.c.every((c) => commandOk(c))) return this.reject('malformed orders', m);
        // The other side only ever orders its own units.
        this.theirs.set(t, (m.c as Command[]).map((cmd) => ({ ...cmd, player: 1 - this.player })));
        while (this.theirs.has(this.missing)) this.missing++;
      } // else sent again: a resend crossing an ack, still a sign of life
    } else if ('h' in m) {
      // Only recent fingerprints (one every 100 ticks), a few at a time.
      if (!int(m.h) || !int(m.v) || Math.abs(m.h - this.missing) > 1000) return this.reject('malformed fingerprint', m);
      this.their.set(m.h, m.v);
      if (this.their.size > 16) this.their.delete(this.their.keys().next().value!);
      this.compare(m.h);
    } else if ('p' in m) {
      if (typeof m.p !== 'number' || !Number.isFinite(m.p)) return this.reject('malformed ping', m);
      this.send({ q: m.p });
    } else if ('q' in m) {
      if (typeof m.q !== 'number') return this.reject('malformed echo', m);
      const trip = this.now() - m.q;
      if (trip >= 0 && trip < 60_000) {
        // Only our own pings come back; a stale one still says the other side is there.
        this.trips.push(trip);
        if (this.trips.length > 8) this.trips.shift();
        // The orders must arrive before their tick comes, a full round trip later at worst: the slowest recent one, plus a tick.
        this.delay = Math.min(MAX_DELAY, Math.max(MIN_DELAY, Math.ceil(Math.max(...this.trips) / 50) + 1));
      }
    } else if ('bye' in m) this.left = true;
    else return this.reject('unknown kind', m);
    // Only a message that checked out counts as a sign of life, and frees what it acknowledges: never past what we
    // have sent, so a wild value cannot empty what is still owed.
    this.heard = this.now();
    if (int(m.a) && m.a <= this.next) for (const t of this.unacked.keys()) if (t < m.a) this.unacked.delete(t);
  }

  /** Messages refused so far; only the first few are logged, so a flood cannot fill the console. */
  rejected = 0;
  private reject(why: string, m: unknown): void {
    if (++this.rejected <= 5) console.warn(`Message ignoré (${why}) :`, JSON.stringify(m)?.slice(0, 200));
  }

  /** The other side's match runs: its first orders came (before, its page may still be loading). */
  get started(): boolean {
    return this.missing > START || this.theirs.size > 0;
  }

  /** Whether tick `t` can run: the other side's orders for it are in. */
  ready(t: number): boolean {
    return t < START || this.theirs.has(t);
  }

  /**
   * Runs at tick `t`: sends the orders given since the last tick (they run `delay` ticks later), and returns both
   * sides' orders for `t`, the host's first, so both browsers apply them in the same order.
   */
  step(t: number, given: Command[]): Command[] {
    // Shaped as the other side checks it, and as it reads it off the wire (JSON): an order with too many units goes in
    // parts, one it would refuse is dropped here too, so both sides always run the very same batch.
    for (const c of given) {
      const wire = JSON.parse(JSON.stringify({ ...c, player: this.player }));
      const ids: unknown[] = Array.isArray(wire.ids) ? wire.ids : [];
      for (let i = 0; i === 0 || i < ids.length; i += MAX_IDS) {
        const part = Array.isArray(wire.ids) ? { ...wire, ids: ids.slice(i, i + MAX_IDS) } : wire;
        if (commandOk(part)) this.held.push(part);
        else this.reject('own order the other side would refuse', part);
      }
    }
    // A shorter delay than the ticks already filled: the orders wait for the next free tick, so none runs early.
    if (t + this.delay >= this.next) {
      const at = Math.max(this.next, t + this.delay);
      // A longer delay: the ticks skipped get no orders, and say so.
      for (; this.next < at; this.next++) this.post(this.next, []);
      // At most what the other side takes for one tick; the rest goes on the next.
      this.post(this.next++, this.held.slice(0, MAX_ORDERS));
      this.held = this.held.slice(MAX_ORDERS);
    }
    const mine = this.ours.get(t) ?? [];
    const theirs = this.theirs.get(t) ?? [];
    this.ours.delete(t);
    this.theirs.delete(t);
    return this.player === 0 ? [...mine, ...theirs] : [...theirs, ...mine];
  }

  private post(t: number, c: Command[]): void {
    this.ours.set(t, c);
    this.unacked.set(t, { c, at: this.now() });
    this.send({ t, c, a: this.missing });
  }

  /** Compares the game state with the other side's every so often: they should never differ. */
  check(t: number, sum: number): void {
    this.mine.set(t, sum);
    if (this.mine.size > 16) this.mine.delete(this.mine.keys().next().value!); // the other side's never came
    this.send({ h: t, v: sum });
    this.compare(t);
  }

  private compare(t: number): void {
    const a = this.mine.get(t);
    const b = this.their.get(t);
    if (a === undefined || b === undefined) return;
    if (a !== b && this.desync === null) this.desync = t;
    this.mine.delete(t);
    this.their.delete(t);
  }

  /** Called often (a few times a second at least): pings every second, sends again what seems lost. */
  poll(): void {
    const now = this.now();
    if (now - this.pinged >= 1000) {
      this.pinged = now;
      this.send({ p: now, a: this.missing });
    }
    const late = Math.max(250, 1.5 * Math.max(0, ...this.trips));
    for (const [t, u] of this.unacked) if (now - u.at > late) this.resend(t, u, now);
  }

  /** A new connection: everything not confirmed goes again at once. */
  reconnected(): void {
    const now = this.now();
    this.heard = now;
    for (const [t, u] of this.unacked) this.resend(t, u, now);
  }

  private resend(t: number, u: { c: Command[]; at: number }, now: number): void {
    u.at = now;
    this.send({ t, c: u.c, a: this.missing });
  }
}

/**
 * Who says hello on a new channel: the other side (its first page, or the same page back), a page of another version
 * while none is known yet (the match cannot be), or a stranger once the other side is known (any other page with the
 * code, whatever its version): that channel alone is turned away, the match goes on.
 */
export function greeting(them: string | null, m: Record<string, unknown>, version = VERSION): 'ok' | 'other-version' | 'stranger' {
  if (them !== null) return m.hi === them && m.v === version ? 'ok' : 'stranger';
  return typeof m.hi === 'string' && m.v === version ? 'ok' : 'other-version';
}

/** Without a word from the other side for this long, the match ends (by forfeit, or with no winner when the link is cut). */
export const FORFEIT_MS = 60_000;
/** Shorter waits go unsaid: a hiccup, not a problem. */
const QUIET_MS = 2000;

/**
 * What a match waiting on the other side says. A cut comes first: a friend whose page closed while it was still loading
 * is not waited for forever. Before its first orders (and no cut), its match is only loading; a short wait goes unsaid;
 * a long one counts down (`left`, seconds), then ends: with no winner when the link is cut, else by forfeit.
 */
export function waitVerdict(started: boolean, cutSince: number, stalledSince: number, now: number): { say: 'loading' | 'nothing' | 'waiting' | 'cut-over' | 'forfeit'; left: number } {
  if (!started && !cutSince) return { say: 'loading', left: 0 };
  const since = cutSince || stalledSince;
  const waited = since ? now - since : 0;
  if (waited < QUIET_MS) return { say: 'nothing', left: 0 };
  const left = Math.ceil((FORFEIT_MS - waited) / 1000);
  return { say: left > 0 ? 'waiting' : cutSince ? 'cut-over' : 'forfeit', left };
}

/** 'again': the other side wants a rematch; 'go': both do, the detail is the new room. */
export type NetStatus = 'waiting' | 'connecting' | 'connected' | 'reconnecting' | 'left' | 'error' | 'again' | 'go';
/** Silence after which the link is taken as cut (each side pings every second, even from a background tab). */
const SILENCE_MS = 5000;
/** A first connection to a room nobody has opened is tried again for this long. */
const FIND_MS = 60_000;

/**
 * Plays `player`'s side of the match in `room` over PeerJS. A cut link is mended: the host keeps its room open and
 * takes the same guest back, the guest calls again; the orders lost meanwhile are sent again. `onStatus` hears every
 * change; 'left' (the other side quit, or another page took its place) and 'error' are final.
 */
export function connect(player: number, room: string, onStatus: (s: NetStatus, detail?: string) => void): { lock: Lockstep; leave: () => void; again: () => void; lost: () => void } {
  let conn: DataConnection | null = null;
  const lock = new Lockstep(player, (m) => {
    sendOn(conn, m);
  });
  /** This page, and the other side's page once known: a page reloaded is a new one, its game started over. */
  const me = Math.random().toString(36).slice(2);
  let them: string | null = null;
  let status: NetStatus = player === 0 ? 'waiting' : 'connecting';
  const set = (s: NetStatus, detail?: string) => {
    if (status === 'left' || status === 'error' || (s === status && !detail)) return;
    status = s;
    onStatus(s, detail);
  };
  const peer = player === 0 ? new Peer(peerId(room)) : new Peer();
  const began = performance.now();
  const again = new Rematch(player);
  const go = (room: string | null) => {
    if (!room) return;
    if (player === 0) sendOn(conn, { go: room } satisfies Message);
    onStatus('go', room);
  };
  let dialed = -Infinity;
  /** The guest's call under way; when a guest first knocked at the host without getting in; the network blamed once. */
  let calling: DataConnection | null = null;
  let knocked = 0;
  let blamed = false;
  const dial = () => {
    dialed = performance.now();
    if (calling && calling !== conn) calling.close();
    attach((calling = peer.connect(peerId(room), { reliable: true, serialization: 'json' })));
  };
  const drop = (c: DataConnection) => {
    if (c !== conn) return;
    conn = null;
    c.close();
    set('reconnecting');
  };
  const attach = (c: DataConnection) => {
    if (player === 0 && them === null) knocked ||= performance.now();
    c.on('open', () => sendOn(c, { hi: me, v: VERSION } satisfies Message));
    c.on('data', (d) => {
      if (!isRecord(d)) return;
      const m = d;
      if ('hi' in m) {
        const who = greeting(them, m);
        if (who === 'other-version') {
          c.close();
          return set('error', OTHER_VERSION);
        }
        if (who === 'stranger') {
          c.close();
          // The host only ever takes its own guest back; to the guest, a new host page means the match is gone.
          if (player === 1) set('left', "L'hôte a quitté la partie.");
          return;
        }
        them = m.hi as string;
        if (conn && conn !== c) conn.close();
        conn = c;
        lock.reconnected();
        set('connected');
      } else if (c !== conn) return;
      else if ('again' in m) {
        onStatus('again');
        go(again.theyAsk());
      } else if ('go' in m) go(again.take(m.go));
      else {
        lock.receive(m);
        if (lock.left) set('left', "L'adversaire a quitté la partie.");
      }
    });
    c.on('close', () => drop(c));
    c.on('error', () => drop(c));
  };
  peer.on('error', (e) => {
    if (e.type === 'unavailable-id') set('error', 'Ce code de partie est déjà pris.');
    else if (e.type === 'invalid-id') set('error', 'Code de partie invalide : vérifiez le lien ou le code.');
    else if (e.type === 'browser-incompatible') set('error', 'Ce navigateur ne permet pas le jeu en ligne.');
    else if (e.type === 'peer-unavailable' && them === null && performance.now() - began > FIND_MS) set('error', 'Partie introuvable : vérifiez le lien ou le code.');
    else if (e.type === 'peer-unavailable' && them === null) set('connecting', "L'hôte n'est pas encore là, nouvel essai…");
    // Anything else (the introduction server unreachable, a call that failed): the watch below tries again.
  });
  if (player === 0) peer.on('connection', attach);
  else peer.on('open', dial);
  // The watch: cut links, calls again, pings. A worker's clock, so it keeps time in a background tab.
  const stop = every(250, () => {
    if (status === 'left' || status === 'error') return stop();
    if (peer.disconnected && !peer.destroyed) peer.reconnect();
    if (conn && performance.now() - lock.heard > SILENCE_MS) drop(conn);
    if (!conn && player === 1 && peer.open && performance.now() - dialed > 3000) dial();
    // Never connected after a while of calling, or of a guest knocking: the network is in the way.
    if (them === null && !blamed && ((player === 1 && peer.open && performance.now() - began > DIRECT_MS) || (player === 0 && knocked && performance.now() - knocked > DIRECT_MS))) {
      blamed = true;
      set(player === 0 ? 'waiting' : 'connecting', NO_DIRECT);
    }
    if (conn) lock.poll();
  });
  return {
    lock,
    /** Leaving on purpose: the other side is told at once. */
    again: () => {
      sendOn(conn, { again: 1 } satisfies Message);
      go(again.ask());
    },
    /** The other side is gone after the end: whatever comes later starts no rematch. */
    lost: () => again.lost(),
    leave: () => {
      // Not to a side that has already gone: its channel is closing.
      if (status !== 'left') sendOn(conn, { bye: 1 } satisfies Message);
      stop();
      peer.destroy();
    },
  };
}

/**
 * The rematch at the end of a network match: each side asks (only from the end screen), then the host names a new room
 * and tells the guest. A guest takes a room only from the host, once it asked itself, and only once; a host takes none.
 */
export class Rematch {
  private asked = false;
  private theyAsked = false;
  private done = false;
  constructor(private readonly player: number) {}
  /** We ask: the room to go to when that makes both (on the host's side), else null. */
  ask(): string | null {
    this.asked = true;
    return this.room();
  }
  /** They ask: as `ask`. */
  theyAsk(): string | null {
    this.theyAsked = true;
    return this.room();
  }
  /** A room the other side sent: the one to go to, or null when it is not for us to take. */
  take(room: unknown): string | null {
    if (this.player !== 1 || !this.asked || this.done || typeof room !== 'string' || readRoom(room) !== room) return null;
    this.done = true;
    return room;
  }
  /** The other side is gone: no rematch any more. */
  lost(): void {
    this.done = true;
  }
  private room(): string | null {
    if (this.player !== 0 || !this.asked || !this.theyAsked || this.done) return null;
    this.done = true;
    return newRoom();
  }
}

/**
 * Calls `fn` every `ms` on a worker's clock: browsers slow a background tab's own timers to once a second or less,
 * not a worker's. Falls back to a plain timer. Returns the stop.
 */
export function every(ms: number, fn: () => void): () => void {
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms})`], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = fn;
    return () => worker.terminate();
  } catch {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }
}


const peerId = (room: string) => `xcraft-game-${room}`;

/** How far ahead of the first missing tick the other side's orders may be: its delay, plus what loss may leave out. */
const WINDOW = 8 * MAX_DELAY;
/** Orders in one tick: well above anything a player can give. */
const MAX_ORDERS = 64;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const int = (v: unknown): v is number => Number.isSafeInteger(v);
/** A waiting room's message: factions, maps and planets are plain ids (they go into the match's address). */
function lobbyOk(m: Record<string, unknown>): m is LobbyMessage {
  const id = (v: unknown) => typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v);
  const setupOk = (s: unknown) => isRecord(s) && Array.isArray(s.camps) && s.camps.length === 2 && s.camps.every(id) && id(s.map) && id(s.biome);
  return 'setup' in m ? setupOk(m.setup) : 'go' in m ? setupOk(m.go) : 'camp' in m ? id(m.camp) : false;
}

/** Sends only on a channel still open: some browsers (Safari) throw, uncaught, on one closing. */
function sendOn(c: DataConnection | null, m: unknown): void {
  if (!c?.open || c.dataChannel?.readyState !== 'open') return;
  try {
    c.send(m);
  } catch {
    // closed in between: the watch sees the silence
  }
}

export function newRoom(): string {
  return Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
}

/** A room code read from what the friend sent: the code itself, or the whole link. Null if neither. */
export function readRoom(text: string): string | null {
  const t = text.trim().toUpperCase();
  const m = /[?&]AMI=([A-Z0-9]{4})\b/.exec(t) ?? /^([A-Z0-9]{4})$/.exec(t);
  return m && [...m[1]].every((c) => ALPHABET.includes(c)) ? m[1] : null;
}

/** The match two friends set up together: each side's faction (the host's first), the map and the planet. */
export interface LobbySetup {
  camps: [string, string];
  map: string;
  biome: string;
}
/** The host owns the setup and sends it whole on every change; the guest only says its faction; `go` starts the match, with the setup both pages load. */
type LobbyMessage = { setup: LobbySetup } | { camp: string } | { go: LobbySetup } | { v: string };
/** 'trouble': not working yet but still trying (the detail says why); 'error': given up. */
export type LobbyStatus = 'waiting' | 'here' | 'gone' | 'trouble' | 'error';
/**
 * The introduction server only passes the two browsers each other's addresses; they then connect directly. Some
 * networks (a strict firewall, a box that will not loop back) never let that through, and the browser just keeps
 * checking without ever failing: said after this long.
 */
const DIRECT_MS = 15_000;
export const NO_DIRECT = "La connexion directe entre vos deux navigateurs n'aboutit pas : un réseau ou un pare-feu la bloque sans doute. Essayez un autre réseau (le partage de connexion d'un téléphone, par exemple), puis Réessayer.";
const NO_SERVER = 'Serveur de mise en relation injoignable, nouvel essai…';

/**
 * The waiting room, on the title screen: the host opens it, the guest comes in by the link or the code. The guest
 * may arrive before the room is open, or come back after a cut: it keeps calling, a call that does not open within
 * 8 s is dropped and made again. The host takes in one guest at a time.
 */
export function openLobby(
  room: string,
  host: boolean,
  on: { status: (s: LobbyStatus, detail?: string) => void; message: (m: LobbyMessage) => void },
): { send: (m: LobbyMessage) => void; close: () => void } {
  let conn: DataConnection | null = null;
  /** The guest's call under way, and when it was made; the host's: when a guest last knocked without getting in. */
  let calling: DataConnection | null = null;
  let calledAt = 0;
  let knocked = 0;
  let said = false;
  const peer = host ? new Peer(`xcraft-lobby-${room}`) : new Peer();
  const began = performance.now();
  const attach = (c: DataConnection) => {
    if (host && !conn) knocked ||= performance.now();
    c.on('open', () => {
      if (conn?.open && conn !== c) return c.close(); // the room is full
      conn = c;
      calling = null;
      knocked = 0;
      said = false;
      sendOn(c, { v: VERSION });
      on.status('here');
    });
    c.on('data', (d) => {
      if (c !== conn || !isRecord(d)) return;
      const m = d;
      if (!('v' in m)) {
        if (lobbyOk(m)) on.message(m);
        return;
      }
      if (m.v === VERSION) return;
      // Turned away, and said so on both sides; the host's room stays open for the friend once reloaded.
      conn = null;
      c.close();
      on.status('error', OTHER_VERSION);
    });
    const gone = () => {
      if (c !== conn) return;
      conn = null;
      on.status(host ? 'waiting' : 'gone');
      if (!host) setTimeout(dial, 2000);
    };
    c.on('close', gone);
    c.on('error', gone);
  };
  const dial = () => {
    if (conn || peer.destroyed || !peer.open) return;
    calling?.close();
    calledAt = performance.now();
    attach((calling = peer.connect(`xcraft-lobby-${room}`, { reliable: true, serialization: 'json' })));
  };
  peer.on('error', (e) => {
    if (e.type === 'unavailable-id') on.status('error', 'Ce code de partie est encore pris (une ancienne page ?) : Réessayer en ouvre un autre.');
    else if (e.type === 'invalid-id') on.status('error', 'Code de partie invalide : vérifiez le lien ou le code.');
    else if (e.type === 'browser-incompatible') on.status('error', 'Ce navigateur ne permet pas le jeu en ligne.');
    else if (e.type === 'peer-unavailable' && performance.now() - began > 60_000) on.status('error', 'Partie introuvable : vérifiez le lien ou le code.');
    else if (e.type === 'peer-unavailable') {
      calling = null;
      setTimeout(dial, 2000);
    } else if (!conn && ['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(e.type)) on.status('trouble', NO_SERVER);
  });
  if (host) {
    peer.on('open', () => on.status('waiting'));
    peer.on('connection', attach);
  } else peer.on('open', dial);
  const watch = setInterval(() => {
    if (peer.destroyed) return;
    if (peer.disconnected) peer.reconnect();
    if (conn) return;
    const now = performance.now();
    if (!host && calling && now - calledAt > 8000) dial();
    // Called, or knocked, for a while without a connection: the network is in the way.
    if (!said && ((host && knocked && now - knocked > DIRECT_MS) || (!host && calling && now - began > DIRECT_MS))) {
      said = true;
      on.status('trouble', NO_DIRECT);
    }
  }, 1000);
  return {
    send: (m) => sendOn(conn, m),
    close: () => {
      clearInterval(watch);
      peer.destroy();
    },
  };
}
