import { type Faction } from '../data';
import { DEFAULT_MAP, mapFile } from '../maps';
import { seatsOf } from '../mappicker';
import { readReplay, versionNote } from './replay';
import { decodeSeats, seatOf } from './seats';
import { asFaction, SCROLL, stored } from './settings';

/** What this page plays, read once from its address (and the last menu choices): who, where, and how. */
export const params = new URLSearchParams(location.search);
/** The game itself is leaving the page (Quitter, Rejouer, a network banner): no « leave the match? » question then. */
export const page = { leaving: false };
/** `?spectate`: watch the AI play itself, without fog. */
/** Title screen: an AI-versus-AI match plays behind the menu, under a drifting camera. */
/** `?net=host|join&room=ABCD`: a two-player game over the network (the host is player 0). */
export const NET_ROLE = params.get('net');
/** `?sandbox&camp=…&map=…&biome=…`: Bac à sable, one player alone on the map, no opponent, with test switches. */
export const SANDBOX = params.has('sandbox') && !params.has('replay') && !NET_ROLE;
export const ATTRACT = !params.has('spectate') && !params.has('play') && !params.has('replay') && !NET_ROLE && !SANDBOX;
/** `?replay`: plays back the last saved game (or one opened from a file), watched like a spectator. */
export const REPLAY = params.has('replay') ? readReplay(params.get('replay') === 'file' ? 'file' : 'last') : null;
// Asked for a replay but none checks out (dropped, damaged): back to the menus rather than a game nobody asked for.
if (params.has('replay') && !REPLAY) {
  alert('Aucun replay lisible à rejouer.');
  location.replace(location.pathname);
}
// A map this version does not have: played on the original one, which may not follow the game (said before it starts).
if (REPLAY?.lostMap) alert(`Carte « ${REPLAY.lostMap} » inconnue de cette version : le replay se joue sur la carte d'origine et peut ne pas suivre la partie.`);
else if (REPLAY && versionNote(REPLAY)) alert(versionNote(REPLAY));
export const SPECTATE = params.has('spectate') || ATTRACT || !!REPLAY;
/** `?speed=4`: simulation speed multiplier. */
export const SPEED = Math.min(16, Math.max(0.25, Number(params.get('speed')) || 1));
/** Alone against the AI, the game's speed is a setting (never online: both machines must step alike). */
export const SOLO = (params.has('play') || SANDBOX) && !NET_ROLE;
/** Phones and tablets: touch controls, lighter rendering. */
export const TOUCH = matchMedia('(pointer: coarse)').matches;
export const gameSpeed = () => (SOLO ? SCROLL.game : SPEED);

/** Factions: the player's and the AI's, from the URL or the last menu choice. */
/** The map: a replay's, else from the URL, else the last one picked. */
// A replay carrying its map plays on that copy, whatever this browser holds under its id.
export const MAP = REPLAY?.carte ?? mapFile(REPLAY ? (REPLAY.map ?? DEFAULT_MAP) : (params.get('map') ?? stored('xcraft.map')));
/** One player of the match: who plays it (you, an AI difficulty, the network, a replay), its faction and team. */
export interface Slot {
  control: string;
  faction: Faction;
  team: number;
}
/**
 * The players: `?p=you.humains.0,hard.isdaris.1,…` (controller, faction, team for each), else the two-player
 * parameters (`camp` and `adversaire` are player 0's and player 1's factions, also over the network).
 */
export const slots: Slot[] = REPLAY
  ? REPLAY.factions.map((faction, i) => ({ control: 'replay', faction, team: REPLAY.teams?.[i] ?? i }))
  : SANDBOX
    ? [{ control: 'you', faction: asFaction(params.get('camp') ?? stored('xcraft.camp')), team: 0 }]
  : params.has('p')
    ? decodeSeats(params.get('p')!)
    : [
        { control: NET_ROLE ? 'net' : SPECTATE ? (params.get('ai0') ?? 'normal') : 'you', faction: asFaction(params.get('camp') ?? stored('xcraft.camp')), team: 0 },
        { control: NET_ROLE ? 'net' : (params.get(SPECTATE ? 'ai1' : 'ai') ?? 'normal'), faction: asFaction(params.get('adversaire') ?? stored('xcraft.adversaire')), team: 1 },
      ];
// A Bac à sable (or its replay) has one player.
if (slots.length < 2 && !SANDBOX && !REPLAY) slots.push({ control: 'normal', faction: 'humains', team: 1 });
slots.length = Math.min(slots.length, seatsOf(MAP)); // no more players than the map has starts
// Only at a players count the map offers (the counts its checks were made at): AIs fill up to the next one, or the
// seats past the last one go. A network match is a duel the waiting room only offers on maps that take two.
if (!REPLAY && !SANDBOX && !NET_ROLE && !MAP.players.includes(slots.length)) {
  const up = MAP.players.filter((n) => n > slots.length);
  if (up.length) while (slots.length < Math.min(...up)) slots.push({ control: 'normal', faction: 'humains', team: slots.length });
  else slots.length = Math.max(...MAP.players.filter((n) => n < slots.length));
}
// A seat whose race or team the map imposes plays it, whatever was picked (createMatch does the same for the race).
for (const [i, s] of slots.entries()) {
  s.faction = MAP.seats?.[i]?.race ?? s.faction;
  s.team = MAP.seats?.[i]?.team ?? s.team;
}
/** The local player's seat, among the seats kept (a guest online is player 1). */
export const PLAYER = seatOf(slots, NET_ROLE === 'join');
export const factions = slots.map((s) => s.faction);
export const [myFaction, foeFaction = asFaction(stored('xcraft.adversaire'))] = factions; // a Bac à sable has no opponent
