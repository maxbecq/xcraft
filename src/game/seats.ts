/** The players of a match as the menus put them in the URL (`p=control.faction.team,…`), and back. */
import type { Faction } from '../data';
import { asFaction } from './settings';

export interface Seat {
  control: string;
  faction: Faction;
  team: number;
}

/** The `p` parameter for the seated sides: with two, each its own team whatever was picked; with more, as chosen. */
export function encodeSeats(seated: Seat[]): string {
  const teams = seated.length > 2 && !seated.every((x) => x.team === seated[0].team);
  return seated.map((x, i) => `${x.control}.${x.faction}.${teams ? x.team : i}`).join(',');
}

/** The seats in `p` (four at most). Team 0 is a team like any other: only a missing or unreadable one falls back to
 * the seat's own number. */
export function decodeSeats(p: string): Seat[] {
  return p
    .split(',')
    .slice(0, 4)
    .map((s, i) => {
      const [control, faction, team] = s.split('.');
      const n = team === undefined || team === '' ? NaN : Number(team);
      return { control: control || 'normal', faction: asFaction(faction), team: Number.isInteger(n) && n >= 0 ? n : i };
    });
}
