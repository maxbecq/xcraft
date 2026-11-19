import { describe, expect, it } from 'vitest';
import { decodeSeats, encodeSeats } from './seats';

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
