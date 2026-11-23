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
  /** Dieux: gods the Porte summons, and from which minute, in order (ai.gods when absent). Each god due keeps its
   * price from the troops until it comes: the strategy's few gods early, the others late (every god early held the
   * troops' minerals, 400 to 700 unspent with the gods idle). */
  gods?: [string, number][];
  /** Researches first, before the faction's usual list. */
  research?: string[];
  /** Buildings wanted on top of the usual ones: [type, from minute]. */
  extra?: [string, number][];
  /** No wave before this minute (defence aside), its size and growth per wave (the plan's when absent). */
  attackMinute?: number;
  wave?: number;
  waveGrowth?: number;
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
}

export const DOCTRINE: Doctrine = { engage: 1, retreat: 1.25, regroup: 4, escort: 0.5, godQueue: 3, godsDefend: true, godsWave: true, godLevel: 3, dieuxExpand: 5 };

/** The AI before strategies: the usual lists, no doctrine (for comparison and the older tests). */
export const LEGACY: Doctrine = { engage: 0, retreat: 2, regroup: 1, escort: 0, godQueue: 1, godsDefend: false, godsWave: true, godLevel: 1, dieuxExpand: 0 };

const USUAL: Strategy = { id: 'classique', name: 'Classique' };

export const STRATEGIES: Record<Faction, Strategy[]> = {
  dieux: [
    {
      id: 'marteau',
      name: 'Marteau nordique',
      // Odin early for the Drakes and Corbeaux, Frigg for the Walkyries: a fast, hard-hitting army.
      gods: [['thor', 0], ['seth', 3], ['odin', 6], ['athena', 9], ['frigg', 12], ['isis', 18], ['hades', 20], ['osiris', 22], ['apollon', 24]],
      army: { nain: 4, drake: 2, corbeau: 1, walkyrie: 2, sphinx: 1 },
      research: ['dmelee1', 'darmor1', 'offrandes', 'dranged1', 'dmelee2'],
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
      attackMinute: 9,
      wave: 12,
      waveGrowth: 4,
    },
    {
      id: 'pantheon',
      name: 'Panthéon',
      // The usual gods' order, the whole arsenal in the army.
      army: { nain: 3, minotaure: 2, sphinx: 2, elembase: 2, drake: 1, pretresse: 1, corbeau: 1, walkyrie: 1, titan: 1, immortel: 1 },
      attackMinute: 7,
    },
  ],
  isdaris: [USUAL],
  z: [USUAL],
  humains: [USUAL],
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
export function armyOf(faction: Faction, s: Strategy): [string, number][] {
  return s.army ? Object.entries(s.army) : FACTIONS[faction].army;
}

/** What the scouts have seen of the enemy's army: types and how many. */
export type Seen = Map<string, number>;

/**
 * The counter table: the army's weights bent by the enemy seen. Flyers seen: units that hit them count three times
 * more, a third as much for those that cannot. Otherwise each weight times how well the unit's damage fits the classes
 * seen (fiches 2010), against its best. Units without classes keep their weight.
 */
export function counter(army: [string, number][], seen: Seen): [string, number][] {
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
  return army.map(([t, wgt]) => {
    const a = (DEFS[t] as UnitDef).attack;
    if (flyers && a) return [t, reaches(a, true) ? wgt * 3 : wgt / 3];
    if (!a?.vs) return [t, wgt];
    let fit = 0;
    for (const [i, n] of cls) fit += n * a.vs[i];
    return [t, (wgt * 2 * fit) / total / Math.max(...a.vs)];
  });
}

/** The usual gods' order (ai.gods). */
export const USUAL_GODS = BALANCE.ai.gods as [string, number][];
