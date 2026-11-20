import { describe, expect, it } from 'vitest';
import { createMatch } from '../sim/setup';
import type { World } from '../sim/world';
import { decodeSeats, encodeSeats, type Seat } from './seats';

describe('seats from the menus to the match', () => {
  it('teams chosen in a four-player game reach the match, Équipe 1 (team 0) included on any seat', () => {
    const p = encodeSeats([
      { control: 'you', faction: 'humains', team: 0 },
      { control: 'normal', faction: 'z', team: 1 },
      { control: 'normal', faction: 'isdaris', team: 0 },
      { control: 'hard', faction: 'dieux', team: 1 },
    ]);
    expect(decodeSeats(p).map((s) => s.team)).toEqual([0, 1, 0, 1]);
    expect(decodeSeats(p).map((s) => s.faction)).toEqual(['humains', 'z', 'isdaris', 'dieux']);
  });

  it('two players are each their own team, whatever was picked', () => {
    const p = encodeSeats([{ control: 'you', faction: 'humains', team: 0 }, { control: 'normal', faction: 'z', team: 0 }]);
    expect(decodeSeats(p).map((s) => s.team)).toEqual([0, 1]);
  });

  it('a missing or unreadable team falls back to the seat number', () => {
    expect(decodeSeats('you.humains,normal.z.x,normal.isdaris.').map((s) => s.team)).toEqual([0, 1, 2]);
  });
});

describe('from the menu to the end of the match', () => {
  /** What the menu does (game/menus.ts launch), then the match page (main.ts): the open seats into `p`, back into players and teams. */
  const toMatch = (menu: Seat[]) => {
    const seats = decodeSeats(encodeSeats(menu.filter((s) => s.control !== 'none')));
    return createMatch(
      seats.map((s) => s.faction),
      seats.map((s) => s.team),
      'carrefour',
    );
  };
  /** Takes every building of these players off the map, as if destroyed, and lets the match judge (it does every 20 ticks). */
  const ruin = (w: World, players: number[]) => {
    for (const e of [...w.entities.values()]) if (players.includes(e.owner) && e.def.kind === 'building') w.entities.delete(e.id);
    for (let i = 0; i < 20; i++) w.step([]);
  };
  /** The banner's rule (hud.ts, end of the match): a victory when the winner is on the local player's team. */
  const won = (w: World, local: number) => w.winner !== null && w.players[w.winner]?.team === w.players[local].team;

  it('an ally seated after the first seat, in Équipe 1, wins for the local player whose own buildings are gone', () => {
    const w = toMatch([
      { control: 'you', faction: 'humains', team: 0 },
      { control: 'normal', faction: 'z', team: 1 },
      { control: 'normal', faction: 'dieux', team: 0 },
      { control: 'hard', faction: 'isdaris', team: 1 },
    ]);
    expect(w.players.map((p) => p.team)).toEqual([0, 1, 0, 1]);
    ruin(w, [0]);
    expect(w.winner).toBeNull(); // the ally still stands
    ruin(w, [1, 3]);
    expect(w.winner).toBe(2);
    expect(won(w, 0)).toBe(true);
    expect(won(w, 1)).toBe(false);
  });

  it('a closed seat is left out, and the players after it keep their teams', () => {
    const w = toMatch([
      { control: 'you', faction: 'z', team: 1 },
      { control: 'none', faction: 'humains', team: 0 },
      { control: 'normal', faction: 'isdaris', team: 0 },
      { control: 'normal', faction: 'dieux', team: 1 },
    ]);
    expect(w.players.map((p) => [p.faction, p.team])).toEqual([['z', 1], ['isdaris', 0], ['dieux', 1]]);
    ruin(w, [1]);
    expect(w.winner).not.toBeNull();
    expect(won(w, 0)).toBe(true); // the local player and its ally (seat 3) are the last team standing
  });

  it('two players are always opposed, even when the menu put them in the same team', () => {
    const w = toMatch([
      { control: 'you', faction: 'humains', team: 2 },
      { control: 'normal', faction: 'z', team: 2 },
    ]);
    expect(w.players[0].team).not.toBe(w.players[1].team);
    ruin(w, [1]);
    expect(w.winner).toBe(0);
    expect(won(w, 0)).toBe(true);
  });

  it('everyone left without buildings at once: no winner, and no victory for anyone', () => {
    const w = toMatch([
      { control: 'you', faction: 'humains', team: 0 },
      { control: 'normal', faction: 'z', team: 1 },
    ]);
    ruin(w, [0, 1]);
    expect(w.winner).toBe(-1);
    expect(won(w, 0)).toBe(false);
    expect(won(w, 1)).toBe(false);
  });
});
