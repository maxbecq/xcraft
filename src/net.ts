import Peer, { type DataConnection } from 'peerjs';
import type { Command } from './sim/world';

/**
 * Two-player lockstep over WebRTC. Both browsers run the same deterministic simulation; each tick,
 * each side sends the orders it gave, to be carried out `DELAY` ticks later on both sides. A tick is only
 * simulated once the other side's orders for it have arrived, so a slow connection stalls the game
 * rather than letting it drift apart. PeerJS's public server only introduces the two browsers to each other.
 */
export const DELAY = 4;
/** Room codes avoid letters that read alike (0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

type Message = { t: number; c: Command[] } | { h: number; v: number } | { ping: 1 };
/** Silence after which the other side is taken as gone (it pings every 2 s, even from a background tab). */
const TIMEOUT_MS = 10_000;

export type NetStatus = 'waiting' | 'connected' | 'lost' | 'error';

export class Lockstep {
  /** The other side's orders, by tick. */
  private readonly theirs = new Map<number, Command[]>();
  /** Our orders, by the tick they will run at. */
  private readonly ours = new Map<number, Command[]>();
  /** Our state checksums, by tick, until the other side's arrive. */
  private readonly sums = new Map<number, number>();
  private conn: DataConnection | null = null;
  private heard = 0;
  status: NetStatus = 'waiting';
  desync = false;

  /** `player`: 0 hosts the room, 1 joins it. */
  constructor(
    readonly player: number,
    readonly room: string,
    private readonly onStatus: (s: NetStatus, detail?: string) => void,
  ) {
    const peer = player === 0 ? new Peer(peerId(room)) : new Peer();
    peer.on('error', (e) => this.set('error', e.type === 'peer-unavailable' ? 'Partie introuvable : vérifiez le code.' : e.type === 'unavailable-id' ? 'Ce code de partie est déjà pris.' : String(e.message)));
    if (player === 0) peer.on('connection', (c) => (this.conn ? c.close() : this.attach(c)));
    else peer.on('open', () => this.attach(peer.connect(peerId(room), { reliable: true, serialization: 'json' })));
  }

  private attach(c: DataConnection): void {
    this.conn = c;
    c.on('open', () => {
      this.heard = performance.now();
      this.set('connected');
      const beat = setInterval(() => {
        if (this.status !== 'connected') return clearInterval(beat);
        if (performance.now() - this.heard > TIMEOUT_MS) {
          clearInterval(beat);
          this.set('lost');
          return;
        }
        c.send({ ping: 1 } satisfies Message);
      }, 2000);
    });
    c.on('close', () => this.set('lost'));
    c.on('error', () => this.set('lost'));
    c.on('data', (d) => {
      this.heard = performance.now();
      const m = d as Message;
      if ('t' in m) {
        // Trust boundary: the other side only ever orders its own units.
        this.theirs.set(m.t, (Array.isArray(m.c) ? m.c : []).map((cmd) => ({ ...cmd, player: 1 - this.player })));
      } else if ('h' in m) {
        const mine = this.sums.get(m.h);
        if (mine !== undefined && mine !== m.v) this.desync = true;
        this.sums.delete(m.h);
      }
    });
  }

  private set(s: NetStatus, detail?: string): void {
    if (this.status === 'lost' || this.status === 'error') return;
    this.status = s;
    this.onStatus(s, detail);
  }

  /** Whether tick `t` can run: connected, and the other side's orders for it are in. */
  ready(t: number): boolean {
    return this.status === 'connected' && (t < DELAY || this.theirs.has(t));
  }

  /**
   * Runs at tick `t`: sends the orders given since the last tick (they run at `t + DELAY`), and returns
   * both sides' orders for `t`, the host's first, so both browsers apply them in the same order.
   */
  step(t: number, given: Command[]): Command[] {
    const later = given.map((c) => ({ ...c, player: this.player }));
    this.ours.set(t + DELAY, later);
    this.conn?.send({ t: t + DELAY, c: later } satisfies Message);
    const mine = this.ours.get(t) ?? [];
    const theirs = this.theirs.get(t) ?? [];
    this.ours.delete(t);
    this.theirs.delete(t);
    return this.player === 0 ? [...mine, ...theirs] : [...theirs, ...mine];
  }

  /** Compares the game state with the other side's every so often: they should never differ. */
  check(t: number, sum: number): void {
    this.sums.set(t, sum);
    this.conn?.send({ h: t, v: sum } satisfies Message);
  }

  close(): void {
    this.conn?.close();
  }
}

const peerId = (room: string) => `xcraft-game-${room}`;

export function newRoom(): string {
  return Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
}

/** A shareable code holding the room and the match settings: `K7QX-HIL` (host Humains, guest Isdaris, Lune). */
export function matchCode(room: string, factions: [string, string], biome: string, map = 0): string {
  // The map, by its place in the list (both sides run the same site), after the planet; none for the first.
  return `${room}-${factions.map((f) => f[0].toUpperCase()).join('')}${biome[0].toUpperCase()}${map > 0 ? map.toString(36).toUpperCase() : ''}`;
}

/** Reads a code back; null if it is not one. */
export function readCode(code: string, biomes: string[], maps: string[] = []): { room: string; factions: [string, string]; biome: string; map: string } | null {
  const m = /^([A-Z0-9]{4})-?([HIZ])([HIZ])([A-Z])([0-9A-Z]?)$/.exec(code.trim().toUpperCase());
  const biome = m && biomes.find((b) => b[0].toUpperCase() === m[4]);
  if (!m || !biome) return null;
  const f = (c: string) => (c === 'H' ? 'humains' : c === 'Z' ? 'z' : 'isdaris');
  return { room: m[1], factions: [f(m[2]), f(m[3])], biome, map: maps[m[5] ? parseInt(m[5], 36) : 0] ?? maps[0] ?? '' };
}
