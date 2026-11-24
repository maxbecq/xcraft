/**
 * Written strategies for the AI: per faction, a few game plans (gods' order, army aimed at, research, when to attack),
 * one drawn at the start from the game's seed, then bent by what the scouts see (a simple counter table). And the
 * doctrine every strategy shares, from the faults the replay analyser found (src/analysis): engage only when not
 * outnumbered away from home, fall back before being wiped, keep producing, gather reinforcements before sending them,
 * never leave a god alone. AI behaviour only: no rule or statistic of the game changes here.
 */
import BALANCE from '../balance.json';
import { CLASSES, DEFS, type Faction, FACTIONS, reaches, type UnitDef } from '../data';

export interface Strategy {
  /** Key and name shown in reports. */
  id: string;
  name: string;
  /** Army aimed at: unit type and weight (the faction's usual list, ai.army, when absent). */
  army?: Record<string, number>;
  /**
   * Units joining the army only once they can be trained (their buildings and research there): the heavy end of a
   * strategy, out of reach for most of a game. Kept out of `army`, they held a Z strategy's rotation for good.
   */
  later?: Record<string, number>;
  /** Dieux: gods the Porte summons, and from which minute, in order (ai.gods when absent). Each god due keeps its
   * price from the troops until it comes: the strategy's few gods early, the others late (every god early held the
   * troops' minerals, 400 to 700 unspent with the gods idle). */
  gods?: [string, number][];
  /** Researches first, before the faction's usual list. */
  research?: string[];
  /** Buildings wanted on top of the usual ones: [type, from minute]. */
  extra?: [string, number][];
  /**
   * The minute (game clock) the natural is taken and saved for, as an opening in StarCraft: early for the strategies
   * that strike late, late for those that strike early (EXPAND_MINUTE when absent).
   */
  expandMinute?: number;
  /** No wave before this minute (defence aside), its size and growth per wave (the plan's when absent). */
  attackMinute?: number;
  wave?: number;
  waveGrowth?: number;
  /** Isdaris: the minute the next extension (Laboratoire first) keeps its price (6 when absent), and the one the
   * Psycho-assembleur is wanted from (ai.tech when absent). */
  extensionMinute?: number;
  techMinute?: number;
  /** Humans: the share of Légionnaires among the infantry, and one Soigneur per this many units (the plan's when absent). */
  legionShare?: number;
  healerEvery?: number;
}

/** The doctrine, shared by every strategy: tuned by AI-against-AI tournaments, judged by the analyser. */
export interface Doctrine {
  /** A new wave leaves only if its power (hp × dps) is this many times the enemy's known army's. */
  engage: number;
  /** A wave group falls back when its power times this is below the enemy's around it (the old rule: 2). */
  retreat: number;
  /** Reinforcements join a wave out only this many at a time (or all at once when fewer are left to come). */
  regroup: number;
  /** A god or key unit with no escort of this power share near it, enemies close, falls back to the army or home. */
  escort: number;
  /** Dieux: units a god keeps queued with minerals to spare (the old rule: 1 ahead). */
  godQueue: number;
  /** The gods at home fight a raid on the base with the army. */
  godsDefend: boolean;
  /** Dieux: the second- and third-rank gods go out with the waves (else they stay home and summon). */
  godsWave: boolean;
  /** Dieux: the level each god buys as soon as its minerals are there, without the usual margin (1: none). */
  godLevel: number;
  /** Dieux: the minute of the first expansion (0: the usual 7). */
  dieuxExpand: number;
  /** With this many production buildings of a kind, one takes the listed research behind its units (the old rule: 3;
   * the Isdaris Portails, never idle, researched nothing in 40 % of the games). */
  researchHosts: number;
  /** The counter table weighs shooters up against an army of shooters. Off: Isdaris Archers against the Humans'
   * Auxiliaires did worse than the Créatures (tournament 23/11: 11 wins in 32 with it, 17 without). */
  counterRanged: boolean;
}

export const DOCTRINE: Doctrine = { engage: 1, retreat: 1.25, regroup: 4, escort: 0.5, godQueue: 3, godsDefend: true, godsWave: true, godLevel: 3, dieuxExpand: 5, researchHosts: 2, counterRanged: false };

/** Camps whose AI plays its strategies and the doctrine by default, each after a tournament showed a clear gain
 * (23/11, against the AI as it was, 96 games a side: Dieux 71 wins against 51, Isdaris 64 against 56, Z 56 against
 * 30). Not the Humains: theirs showed none (44 against 48), their strategies stay opt-in. */
export const ON_BY_DEFAULT: Faction[] = ['dieux', 'isdaris', 'z'];

/** The AI before strategies: the usual lists, no doctrine (for comparison and the older tests). */
export const LEGACY: Doctrine = { engage: 0, retreat: 2, regroup: 1, escort: 0, godQueue: 1, godsDefend: false, godsWave: true, godLevel: 1, dieuxExpand: 0, researchHosts: 3, counterRanged: false };

const USUAL: Strategy = { id: 'classique', name: 'Classique' };
/** The natural's minute (game clock) of a strategy that names none, the usual one included. */
export const EXPAND_MINUTE = 5;

export const STRATEGIES: Record<Faction, Strategy[]> = {
  dieux: [
    {
      id: 'marteau',
      name: 'Marteau nordique',
      // Odin early for the Drakes and Corbeaux, Frigg for the Walkyries: a fast, hard-hitting army.
      gods: [['thor', 0], ['seth', 3], ['odin', 6], ['athena', 9], ['frigg', 12], ['isis', 18], ['hades', 20], ['osiris', 22], ['apollon', 24]],
      army: { nain: 4, drake: 2, corbeau: 1, walkyrie: 2, sphinx: 1 },
      research: ['dmelee1', 'darmor1', 'offrandes', 'dranged1', 'dmelee2'],
      expandMinute: 5,
      attackMinute: 6,
      wave: 8,
      waveGrowth: 4,
    },
    {
      id: 'phalange',
      name: 'Phalange grecque',
      // Apollon and Athéna: Minotaures and Élémentaires, then Hadès for the Titans; a heavy army, later.
      gods: [['thor', 0], ['apollon', 3], ['seth', 5], ['athena', 7], ['odin', 10], ['hades', 12], ['isis', 18], ['osiris', 20], ['frigg', 22]],
      army: { minotaure: 3, elembase: 3, titan: 2, nain: 2 },
      research: ['dmelee1', 'darmor1', 'celerite', 'dmelee2', 'darmor2'],
      expandMinute: 4,
      attackMinute: 8,
      wave: 10,
      waveGrowth: 4,
    },
    {
      id: 'sables',
      name: 'Sables d’Égypte',
      // Seth, Isis, Osiris: Sphinx at range, Prêtresses, Immortels; strikes late with a big army.
      gods: [['thor', 0], ['seth', 2], ['apollon', 5], ['isis', 7], ['odin', 9], ['osiris', 11], ['athena', 18], ['hades', 20], ['frigg', 22]],
      army: { sphinx: 3, pretresse: 2, immortel: 2, nain: 2, minotaure: 1 },
      research: ['dranged1', 'darmor1', 'offrandes', 'dranged2', 'darmor2'],
      expandMinute: 3,
      attackMinute: 9,
      wave: 12,
      waveGrowth: 4,
    },
    {
      id: 'pantheon',
      name: 'Panthéon',
      // The usual gods' order, the whole arsenal in the army.
      army: { nain: 3, minotaure: 2, sphinx: 2, elembase: 2, drake: 1, pretresse: 1, corbeau: 1, walkyrie: 1, titan: 1, immortel: 1 },
      expandMinute: 4,
      attackMinute: 7,
    },
  ],
  isdaris: [
    {
      id: 'tir',
      name: 'Tir psychique',
      // Archers first, the Laboratoire early for the Druides and the Portail's attack: at range, against the infantry.
      army: { archer: 5, creature: 2, druide: 2 },
      research: ['portailatk1', 'portailarmor1', 'portailatk2', 'deflagration'],
      extensionMinute: 3,
      expandMinute: 4,
      attackMinute: 7,
    },
    {
      id: 'essaim',
      name: 'Essaim',
      // Créatures in numbers with Enfouissement and Archers behind them, an early strike (the Psycho-assembleur and the
      // Orbe de commandement sooner for the Assassins cost it every second game: 21 wins in 48).
      army: { creature: 4, archer: 3, druide: 1 },
      research: ['portailatk1', 'enfouissement', 'portailarmor1', 'portailatk2'],
      extensionMinute: 4,
      expandMinute: 5,
      attackMinute: 6,
      wave: 10,
    },
    {
      id: 'mages',
      name: 'Mages',
      // Druides and Archers behind a few Créatures, Déflagration early; a later, harder strike.
      army: { druide: 3, archer: 3, creature: 2 },
      research: ['deflagration', 'portailatk1', 'portailarmor1', 'silence', 'portailatk2'],
      extensionMinute: 3,
      expandMinute: 3,
      attackMinute: 8,
      wave: 10,
    },
  ],
  z: [
    {
      id: 'artillerie',
      name: 'Artillerie',
      // Hexapodes with rockets and Octopodes, held back for big waves from minute 10 (light socles early, Quadripodes and
      // drones de combat in waves of 12 to 16, won 22 of 48 against the AI as it was: dropped).
      // Octopodes (Intelligence suprême, Centre d'optimisation, then their research) only once they can come.
      army: { hexapode: 4, quadripode: 2 },
      later: { octopode: 2 },
      research: ['lanceroquettes', 'rhexapode', 'rhexapode2', 'zdist1', 'roctopode'],
      expandMinute: 3,
      attackMinute: 10,
      wave: 16,
    },
    {
      id: 'blindes',
      name: 'Blindés',
      // Hexapodes, Octopodes and Mastodontes behind a few Quadripodes: slower, heavier waves.
      // Octopodes and Mastodontes only once they can come: in the games of 23/11 they never did (no Centre
      // d'optimisation in 11 minutes), and the waves left with Quadripodes alone.
      army: { hexapode: 3, quadripode: 2 },
      later: { octopode: 2, mastodonte: 2 },
      research: ['rhexapode', 'lanceroquettes', 'zblindage1', 'rhexapode2', 'rmastodonte', 'roctopode'],
      expandMinute: 3.5,
      attackMinute: 9,
      wave: 14,
    },
    {
      id: 'siege',
      name: 'Siège',
      // The heavy army of Blindés, armour first, held back for one big late wave (Coléoptères in the air won 20 of 48
      // against the AI as it was, Mastodontes from minute 7 as many: both dropped).
      army: { hexapode: 3, quadripode: 2 },
      later: { octopode: 2, mastodonte: 2 },
      research: ['zblindage1', 'rhexapode', 'lanceroquettes', 'zblindage2', 'rmastodonte', 'roctopode'],
      expandMinute: 2.5,
      attackMinute: 11,
      wave: 18,
    },
  ],
  humains: [
    {
      id: 'legion',
      name: 'Légion',
      // Légionnaires for half the infantry, melee research first, an early strike.
      legionShare: 0.5,
      research: ['melee1', 'armor1', 'ranged1', 'melee2'],
      expandMinute: 6,
      attackMinute: 5,
    },
    {
      id: 'bastion',
      name: 'Bastion',
      // The Auxiliaires' line with more Soigneurs, armour and range researched first, one bigger wave later.
      healerEvery: 3,
      research: ['armor1', 'ranged1', 'armor2', 'ranged2'],
      expandMinute: 3.5,
      attackMinute: 8,
      wave: 14,
    },
    {
      id: 'creaturium',
      name: 'Créaturium',
      // The Créaturium early for its saurians and Belluaires, behind the usual infantry.
      techMinute: 5,
      research: ['ranged1', 'armor1', 'croissance', 'melee1'],
      expandMinute: 4.5,
      attackMinute: 7,
      wave: 12,
    },
  ],
};

/** A 32-bit hash (FNV-1a) of a few numbers and words: the same game, the same draw. */
export function hash(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const c of parts.join('|')) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** The strategy a player draws: by the game's seed and its seat, or the one named. */
export function pickStrategy(faction: Faction, seed: number, player: number, named?: string): Strategy {
  const list = STRATEGIES[faction] ?? [USUAL];
  if (named === USUAL.id) return USUAL;
  return list.find((s) => s.id === named) ?? list[hash(seed, player, faction) % list.length];
}

/** Units of the strategy's army, as [type, weight]; the faction's usual list when it names none. */
export function armyOf(faction: Faction, s: Strategy, unlocked?: (t: string) => boolean): [string, number][] {
  if (!s.army) return FACTIONS[faction].army;
  return [...Object.entries(s.army), ...Object.entries(s.later ?? {}).filter(([t]) => unlocked?.(t))];
}

/** What the scouts have seen of the enemy's army: types and how many. */
export type Seen = Map<string, number>;

/**
 * The counter table: the army's weights bent by the enemy seen. Flyers seen: units that hit them count three times
 * more, a third as much for those that cannot. Otherwise each weight times how well the unit's damage fits the classes
 * seen (fiches 2010), against its best. Units without classes keep their weight.
 */
export function counter(army: [string, number][], seen: Seen, ranged = true): [string, number][] {
  let total = 0;
  let air = 0;
  const cls = new Map<number, number>();
  for (const [t, n] of seen) {
    const d = DEFS[t] as UnitDef | undefined;
    if (!d || d.kind !== 'unit' || d.worker) continue;
    total += n;
    if (d.flying) air += n;
    const i = CLASSES.indexOf(d.cls ?? 'BL');
    cls.set(i, (cls.get(i) ?? 0) + n);
  }
  if (!total) return army;
  const flyers = air * 3 >= total;
  // Mostly shooters seen (Auxiliaires, Archers): our own shooters count twice, melee half (Créatures charging a line of
  // Auxiliaires lost the Isdaris their games against the Humans).
  let shooting = 0;
  for (const [t, n] of seen) if ((DEFS[t] as UnitDef | undefined)?.kind === 'unit' && !(DEFS[t] as UnitDef).worker && ((DEFS[t] as UnitDef).attack?.range ?? 0) >= 3) shooting += n;
  const shooters = ranged && shooting * 2 >= total;
  return army.map(([t, wgt]) => {
    const a = (DEFS[t] as UnitDef).attack;
    if (flyers && a) return [t, reaches(a, true) ? wgt * 3 : wgt / 3];
    if (shooters && a) wgt = a.range >= 3 ? wgt * 2 : wgt / 2;
    if (!a?.vs) return [t, wgt];
    let fit = 0;
    for (const [i, n] of cls) fit += n * a.vs[i];
    return [t, (wgt * 2 * fit) / total / Math.max(...a.vs)];
  });
}

/**
 * The enemy as the AI believes it (an SC2-like read of the scouting): every few seconds each type seen now is raised to
 * its count, and kept at its most once out of sight. Fading what is out of sight (half in 3 min) cost the Isdaris 4
 * wins in 96 against the 0.9.147 AI, half in 11 min one: an army seen once is still there.
 * `now` may hold units guessed from the buildings seen (one that trains flyers: a few of them).
 */
export function remember(seen: Seen, now: Seen): void {
  for (const [t, n] of now) seen.set(t, Math.max(n, seen.get(t) ?? 0));
}

/** How sure the AI is of its read: none with nothing seen, half at CONFIDENT units, nearly all with many more. */
export const CONFIDENT = 8;
export function confidence(seen: Seen): number {
  let total = 0;
  for (const [t, n] of seen) if ((DEFS[t] as UnitDef | undefined)?.kind === 'unit' && !(DEFS[t] as UnitDef).worker) total += n;
  return total / (total + CONFIDENT);
}

/**
 * The army's weights turned towards the counters as far as the read is sure: the plan's own weights blended with the
 * counter table's (both at the plan's total), by the confidence. A strategy keeps its units; only their shares move.
 */
export function adapt(army: [string, number][], seen: Seen, ranged = true): [string, number][] {
  const c = confidence(seen);
  if (!c) return army;
  const bent = counter(army, seen, ranged);
  const sum = (l: [string, number][]) => l.reduce((n, [, wgt]) => n + wgt, 0) || 1;
  const [a, b] = [sum(army), sum(bent)];
  return army.map(([t, wgt], i) => [t, (1 - c) * wgt + (c * bent[i][1] * a) / b]);
}

/**
 * How well a unit's weapon fits the enemy as read: its mean damage over the units seen against its best, 0 against a
 * flyer it cannot hit; 1 with nothing seen or no weapon.
 */
export function fitSeen(type: string, seen: Seen): number {
  const a = (DEFS[type] as UnitDef | undefined)?.attack;
  if (!a) return 1;
  let total = 0;
  let fit = 0;
  for (const [t, n] of seen) {
    const d = DEFS[t] as UnitDef | undefined;
    if (!d || d.kind !== 'unit' || d.worker) continue;
    total += n;
    if (!reaches(a, !!d.flying)) continue;
    fit += a.vs?.length ? (n * (a.vs[Math.max(0, CLASSES.indexOf(d.cls ?? 'BL'))] ?? 0)) / Math.max(1, ...a.vs) : n;
  }
  return total ? fit / total : 1;
}

/** The usual gods' order (ai.gods). */
export const USUAL_GODS = BALANCE.ai.gods as [string, number][];
