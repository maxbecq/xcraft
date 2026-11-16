// Faction data (Humans, Isdaris), from XC Mod 1.53 (SC2) where it exists.
// Times are in SC "Normal" seconds; the simulation runs at "Faster" (see GAME_SPEED).
// Every balance number (hp, costs, damage, ability timings, AI thresholds) lives in balance.json, owned by the
// balance designer (see BALANCE.md); this file holds what each thing is and does.

import BALANCE from './balance.json';

export type Faction = 'humains' | 'isdaris';

export interface Cost {
  minerals: number;
  energy: number;
}

export interface Attack {
  damage: number;
  /** Extra range beyond touching, in tiles (melee: ~0.1). */
  range: number;
  cooldown: number;
  /** Damage modifier against mechanical targets (buildings count as mechanical). */
  vsMechanical?: number;
  /** Hits flying units (default: ranged attacks do, melee ones do not). */
  air?: boolean;
  /** Hits ground units and buildings (default: true). */
  ground?: boolean;
}

/** Can this attack reach that target, flying or not? */
export function reaches(a: Attack, flying: boolean): boolean {
  return flying ? (a.air ?? a.range >= 1) : a.ground !== false;
}

export interface UnitDef {
  kind: 'unit';
  name: string;
  /** Buildings needed (finished, by count) before it can be trained. */
  requires?: Record<string, number>;
  hp: number;
  armor: number;
  speed: number;
  radius: number;
  sight: number;
  supply: number;
  cost: Cost;
  buildTime: number;
  attack?: Attack;
  /** HP restored per second to a nearby wounded ally. */
  heal?: number;
  worker?: boolean;
  /** Psychic shield points, absorbed before hp and recharging out of combat. */
  shield?: number;
  /** HP regained per second. */
  regen?: number;
  /** Inertia: acceleration at the start and braking at the end of a move, in tiles per second squared (none: full speed at once). */
  accel?: number;
  /** Permanently invisible: enemies only see it within range of one of their detectors. */
  cloaked?: boolean;
  /** A machine (vehicle, robot): takes `vsMechanical` bonuses like buildings, armoured by Blindage véhicules. */
  mechanical?: boolean;
  /** A tamed saurian, armoured by Peau épaisse. */
  beast?: boolean;
  /** Flies: straight over cliffs and buildings, out of reach of melee and ground-only weapons. */
  flying?: boolean;
  /** Reveals invisible enemies within this radius (tiles). */
  detector?: number;
  /** Active ability (key of ABILITIES). */
  ability?: string;
  faction: Faction;
  hotkey: string;
}

export interface BuildingDef {
  kind: 'building';
  name: string;
  /** Buildings needed (finished, by count) before it can be built. */
  requires?: Record<string, number>;
  hp: number;
  armor: number;
  /** Footprint, in tiles (square). */
  size: number;
  sight: number;
  /** Supply provided (positive) or used (negative). */
  supply: number;
  cost: Cost;
  buildTime: number;
  trains?: string[];
  /** Workers drop resources here. */
  dropoff?: boolean;
  /** Must sit on an energy well; then produces energy per second. */
  energyRate?: number;
  shield?: number;
  /** Isdaris: materialised from orbit, it builds itself (the worker is free at once). */
  warp?: boolean;
  /** Isdaris: radius (tiles) of the power field it projects; other warped buildings must stand inside one. */
  power?: number;
  /** Isdaris: must be placed inside a power field. */
  needsPower?: boolean;
  /** Recharges the shields of friendly units within this radius (tiles), fast. */
  shieldAura?: number;
  /** Defensive building: shoots enemy units in range. */
  attack?: Attack;
  /** Reveals invisible enemies within this radius (tiles). */
  detector?: number;
  /** Bunker: how many units can shelter inside. */
  bunker?: number;
  /** Buildings this one can turn into, in place, through its production queue (paying the new one's cost). */
  morphs?: string[];
  /** Not placed by workers: only reached by turning another building into it. */
  morphOnly?: boolean;
  /** Upgrades researched here (keys of DEFS, kind 'upgrade'), through the production queue. */
  researches?: string[];
  /** Active ability (key of ABILITIES), aimed at a point of the map. */
  ability?: string;
  faction: Faction;
  hotkey: string;
}

export interface ResourceDef {
  kind: 'resource';
  name: string;
  size: number;
  amount: number;
}

/** One level of a Forge upgrade line, researched in the building's queue. */
export interface UpgradeDef {
  kind: 'upgrade';
  name: string;
  line: UpgradeLine;
  level: number;
  cost: Cost;
  buildTime: number;
  /** Finished buildings needed first, by type and count (SC-like tech tree; the mod has none). */
  requires?: Record<string, number>;
  /** What it does, for the tooltip (one-off research). */
  effect?: string;
  faction: Faction;
  hotkey: string;
}

/**
 * melee and ranged: +10 % of the weapon's base damage per level (at least +1); armor: +1 per level for foot
 * soldiers, vehicles: for machines, skin: for saurians. Any other line is a one-off research named like its line.
 */
export type UpgradeLine = string;

export type Def = UnitDef | BuildingDef | ResourceDef | UpgradeDef;

/** Active abilities: one per Human soldier. Times in "Normal" seconds. */
export interface AbilityDef {
  name: string;
  hotkey: string;
  cooldown: number;
  duration: number;
  /** Energy taken from the player's stock (building abilities). */
  energy?: number;
  /** Research needed before it can be used. */
  research?: string;
}

export const ABILITIES: Record<string, AbilityDef> = {
  /** Auxiliaire: costs 10 hp, attacks and moves 50 % faster. */
  stimulant: { name: 'Stimulant', hotkey: 'T', ...BALANCE.abilities.stimulant },
  /** Légionnaire: runs twice as fast to close in. */
  charge: { name: 'Charge', hotkey: 'C', ...BALANCE.abilities.charge },
  /** Soigneur (notice, mod « Peau de roc »): an ally within 4 tiles takes 5 less damage per hit. */
  peauderoc: { name: 'Peau de roc', hotkey: 'R', ...BALANCE.abilities.peauderoc },
  /** Forge (notice): its telescope reveals a zone and detects invisible units there, for 50 energy. */
  observation: { name: 'Observation céleste', hotkey: 'O', research: 'observation', ...BALANCE.abilities.observation },
  /**
   * Obélisque (mod « Rappel », a Prisme ability): after a 4 s channel, up to 8 army units within 5 tiles of
   * the target point appear around the Obélisque, then stay dazed 4 s. 100 energy as in the mod; the cooldown
   * is ours (the Prisme took 100 s to regain its 100 energy). `duration` is the channel.
   */
  rappel: { name: 'Rappel', hotkey: 'R', ...BALANCE.abilities.rappel },
};
export const OBSERVATION = BALANCE.rules.observation;
export const RAPPEL = BALANCE.rules.rappel;
export const SKIN_RANGE = BALANCE.rules.peauDeRoc.range;
export const SKIN_REDUCTION = BALANCE.rules.peauDeRoc.reduction;
export const STIM_HP = BALANCE.rules.stimulantHp;

/** Buildings each level needs, SC-like: level 2 a second Caserne, level 3 also a Tour alchimistique. */
const UPGRADE_REQUIRES: (Record<string, number> | undefined)[] = [undefined, { caserne: 2 }, { caserne: 2, tour: 1 }];

/** What each thing is; its numbers come from balance.json (merged into DEFS below). */
const BASE: Record<string, object> = {
  serf: { kind: 'unit', name: 'Serf', radius: 0.375, worker: true, faction: 'humains', hotkey: 'S' },
  auxiliaire: { kind: 'unit', name: 'Auxiliaire', radius: 0.375, ability: 'stimulant', faction: 'humains', hotkey: 'A' },
  legionnaire: { kind: 'unit', name: 'Légionnaire-scieur', radius: 0.375, ability: 'charge', faction: 'humains', hotkey: 'L' },
  soigneur: { kind: 'unit', name: 'Soigneur', radius: 0.375, ability: 'peauderoc', faction: 'humains', hotkey: 'O' },
  // Mod: grenades alchimiques, 30 (20 against living targets: nearly all units), +10 here against buildings.
  phalangiste: { kind: 'unit', name: 'Phalangiste', radius: 0.4, requires: { forge: 1 }, faction: 'humains', hotkey: 'P' },
  conseil: { kind: 'building', name: 'Conseil des Échevins', size: 5, trains: ['serf'], dropoff: true, faction: 'humains', hotkey: 'C' },
  grenier: { kind: 'building', name: 'Grenier', size: 2, faction: 'humains', hotkey: 'G' },
  caserne: { kind: 'building', name: 'Caserne', size: 3, trains: ['auxiliaire', 'legionnaire', 'soigneur', 'phalangiste', 'belluaire'], faction: 'humains', hotkey: 'K' },
  mine: { kind: 'building', name: 'Mine', size: 3, faction: 'humains', hotkey: 'M' },
  // Mod: « Guilde métallurgique » (the notice's Forge).
  forge: {
    kind: 'building', name: 'Forge', size: 3, ability: 'observation', faction: 'humains', hotkey: 'F',
    researches: ['melee1', 'melee2', 'melee3', 'ranged1', 'ranged2', 'ranged3', 'armor1', 'armor2', 'armor3', 'vehicles1', 'vehicles2', 'vehicles3', 'skin1', 'skin2', 'skin3', 'canonsscies', 'cuirasse', 'scieassaut', 'lamesempoisonnees', 'observation'],
  },
  // Notice: « Marché », trade one resource for the other at a poor rate, and economic research (mod: « Guilde des dresseurs-marchands »).
  marche: { kind: 'building', name: 'Marché', size: 3, requires: { caserne: 1 }, researches: ['croissance', 'pillage', 'entrainementgroupe'], faction: 'humains', hotkey: 'R' },
  // Mod: « Fortin », a bunker for four: soldiers inside are out of reach and shoot one tile farther.
  fortin: { kind: 'building', name: 'Fortin', size: 2, requires: { caserne: 1 }, faction: 'humains', hotkey: 'B' },
  // Mod: « Tour anti-air », a detector with a rocket launcher against flying units only (40, range 8).
  tour: { kind: 'building', name: 'Tour alchimistique', size: 2, faction: 'humains', hotkey: 'T' },
  // Notice: « Métallurgie », the vehicle workshop (mod « Machinerie », needing the Guilde métallurgique, here the Forge).
  metallurgie: { kind: 'building', name: 'Métallurgie', size: 3, requires: { forge: 1 }, trains: ['bourdon', 'pegase'], researches: ['charlourd'], faction: 'humains', hotkey: 'M' },
  // Notice: « Bourdon », a propeller airship: detector, short-range anti-vehicle grenades, good against buildings and flyers
  // (mod « Dirigeable d'appui », which had no weapon: ours is provisional).
  bourdon: { kind: 'unit', name: 'Bourdon', radius: 0.45, flying: true, mechanical: true, faction: 'humains', hotkey: 'B' },
  // Notice: « Char Pégase », a massive tank whose « Incineratus » cannon wrecks vehicles and buildings (mod « Pegasus », ground mode).
  pegase: { kind: 'unit', name: 'Char Pégase', radius: 0.9, mechanical: true, faction: 'humains', hotkey: 'P' },
  // Notice: « Alchimisterie », the alchemy tier: Alchimistes (mod: needs the Guilde alchimistique, here the Forge).
  alchimisterie: { kind: 'building', name: 'Alchimisterie', size: 3, requires: { forge: 1 }, trains: ['alchimiste'], researches: ['armeschimiques'], faction: 'humains', hotkey: 'A' },
  // Notice: « Alchimiste », a fragile support that detects hidden units; mod: cocktail instable, 15 (+5 against living targets).
  alchimiste: { kind: 'unit', name: 'Alchimiste', radius: 0.375, faction: 'humains', hotkey: 'A' },
  // Notice: « Créaturium », where the belluaires train saurians (mod: needs the Guilde des dresseurs-marchands, here a Caserne).
  creaturium: { kind: 'building', name: 'Créaturium', size: 3, requires: { caserne: 1 }, trains: ['plesiosaure', 'ankylosaure', 'allosaure'], researches: ['oeilpercant', 'dressageallosaures'], faction: 'humains', hotkey: 'C' },
  // Notice: « Plésiosaure », a flying saurian with a heavy ballista against ground infantry (mod « Rodactylus »).
  plesiosaure: { kind: 'unit', name: 'Plésiosaure', radius: 0.6, flying: true, beast: true, faction: 'humains', hotkey: 'P' },
  // Notice: « Ankylosaure », slow and armoured, its spiked tail smashes buildings (mod « Kylosaurus »: 60, -30 light, +30 structures).
  ankylosaure: { kind: 'unit', name: 'Ankylosaure', radius: 0.9, beast: true, faction: 'humains', hotkey: 'A' },
  // Notice: « Allosaure », a huge flesh-eater that devours infantry (mod « Carnosaurus »: 60, -30 mechanical).
  allosaure: { kind: 'unit', name: 'Allosaure', radius: 0.9, beast: true, requires: { creaturium: 1, dressageallosaures: 1 }, faction: 'humains', hotkey: 'L' },
  // Notice: « Belluaire », a halberdier on a reptile, deadly to infantry, nearly useless against machines; trained in the
  // Caserne once a Créaturium stands (mod: a flamethrower, 15 +25 against living targets).
  belluaire: { kind: 'unit', name: 'Belluaire', radius: 0.45, requires: { creaturium: 1 }, faction: 'humains', hotkey: 'B' },
  ...upgrades('melee', 'Attaque corps à corps', 'C'),
  ...upgrades('ranged', 'Attaque à distance', 'D'),
  ...upgrades('armor', 'Armure infanterie', 'A'),
  ...upgrades('vehicles', 'Blindage véhicules', 'V', { metallurgie: 1 }),
  ...upgrades('skin', 'Peau épaisse', 'P', { creaturium: 1 }),
  // One-off research from the notice (costs and times in balance.json; the mod's where it has them).
  canonsscies: research('Canons sciés', 'N', 'Auxiliaires : +1 de portée.', { caserne: 1 }),
  cuirasse: research('Cuirasse', 'U', 'Légionnaires-scieurs : +1 d\'armure.', { caserne: 1 }),
  scieassaut: research("Scie d'assaut", 'S', 'Légionnaires-scieurs : bonus contre les machines et les bâtiments.', { caserne: 1 }),
  lamesempoisonnees: research('Lames empoisonnées', 'L', 'Belluaires : leurs coups empoisonnent les unités organiques.', { creaturium: 1 }),
  observation: research('Observation céleste', 'B', 'Les Forges peuvent observer une zone de la carte.'),
  croissance: research('Croissance économique', 'C', 'Serfs et unités de la Caserne : +10 % de points de vie.'),
  pillage: research('Pillage', 'P', 'Chaque bâtiment ennemi détruit rapporte une part de son coût.'),
  entrainementgroupe: research('Entraînement groupé', 'E', 'Unités de la Caserne formées 25 % plus vite.'),
  armeschimiques: research('Armes chimiques', 'C', 'Les cocktails des Alchimistes touchent une zone.'),
  oeilpercant: research('Œil perçant', 'O', 'Les Plésiosaures détectent les unités invisibles.'),
  dressageallosaures: research("Dressage d'allosaures", 'D', "Permet de dresser des Allosaures."),
  charlourd: research('Char lourd', 'L', 'Chars Pégase : +15 dégâts, +2 armure.'),

  // ---------------------------------------------------------------- Isdaris
  moissonneur: { kind: 'unit', name: 'Robot moissonneur', radius: 0.375, worker: true, mechanical: true, faction: 'isdaris', hotkey: 'S' },
  archer: { kind: 'unit', name: 'Archer', radius: 0.375, faction: 'isdaris', hotkey: 'A' },
  creature: { kind: 'unit', name: 'Créature', radius: 0.3, faction: 'isdaris', hotkey: 'C' },
  druide: { kind: 'unit', name: 'Druide', radius: 0.375, faction: 'isdaris', hotkey: 'D' },
  // Mod: « Sombre ». Shield 70 instead of the mod's 210: it still one-shots workers, but 4 auxiliaires win once it is detected.
  assassin: { kind: 'unit', name: 'Assassin', radius: 0.375, cloaked: true, faction: 'isdaris', hotkey: 'X' },
  obelisque: { kind: 'building', name: 'Obélisque', size: 5, trains: ['moissonneur'], dropoff: true, warp: true, ability: 'rappel', faction: 'isdaris', hotkey: 'O' },
  emetteur: { kind: 'building', name: 'Émetteur', size: 2, warp: true, morphs: ['pylonesanglant'], faction: 'isdaris', hotkey: 'E' },
  // Mod: an Émetteur turned into a « Pylône sanglant » (annihilateur de matière: 200 every 6.6 s, range 10, ground only).
  // The mod asks for an Orbe de commandement, not in the game yet: a Nano-assembleur stands in.
  pylonesanglant: { kind: 'building', name: 'Pylône sanglant', size: 2, requires: { nanoassembleur: 1 }, warp: true, morphOnly: true, faction: 'isdaris', hotkey: 'P' },
  reservepsy: { kind: 'building', name: 'Réserve psy', size: 2, warp: true, needsPower: true, faction: 'isdaris', hotkey: 'P' },
  portail: { kind: 'building', name: 'Portail', size: 3, trains: ['archer', 'creature', 'druide', 'assassin'], warp: true, needsPower: true, faction: 'isdaris', hotkey: 'T' },
  recepteur: { kind: 'building', name: 'Récepteur', size: 3, warp: true, morphs: ['recepteurarme'], faction: 'isdaris', hotkey: 'R' },
  // Mod: « Récepteur armé », the Récepteur with a plasma arc (as the Orbe's), still drawing energy.
  recepteurarme: { kind: 'building', name: 'Récepteur armé', size: 3, warp: true, morphOnly: true, faction: 'isdaris', hotkey: 'A' },
  // Mod: « Orbe plasmique ».
  orbe: { kind: 'building', name: 'Orbe plasma', size: 2, warp: true, needsPower: true, faction: 'isdaris', hotkey: 'B' },
  // Mod: « Nano-assembleur » (needs a gateway), here making the Chasseur Discobole (its red upgrade in the mod).
  nanoassembleur: { kind: 'building', name: 'Nano-assembleur', size: 3, requires: { portail: 1 }, trains: ['discobole', 'chimere'], warp: true, needsPower: true, faction: 'isdaris', hotkey: 'N' },
  // Mod: disque de plasma, 40 (30 against massive targets and buildings).
  discobole: { kind: 'unit', name: 'Chasseur Discobole', radius: 0.5, mechanical: true, faction: 'isdaris', hotkey: 'D' },

  // Mod: « Chimère » (green Nano-assembleur), a flying hunter: ion blaster, 21 a second, air and ground.
  chimere: { kind: 'unit', name: 'Chimère', radius: 0.45, flying: true, mechanical: true, faction: 'isdaris', hotkey: 'C' },

  minerai: { kind: 'resource', name: 'Champ de minerai', size: 1 },
  puits: { kind: 'resource', name: 'Puits énergétique', size: 3, amount: Infinity },
};

/** The three levels of a Forge line (costs and times in balance.json); `base`: buildings the line needs from level 1. */
function upgrades(line: UpgradeLine, name: string, hotkey: string, base?: Record<string, number>): Record<string, object> {
  const out: Record<string, object> = {};
  for (const i of [0, 1, 2]) out[`${line}${i + 1}`] = { kind: 'upgrade', name: `${name} ${i + 1}`, line, level: i + 1, requires: { ...base, ...UPGRADE_REQUIRES[i] }, faction: 'humains', hotkey };
  return out;
}

/** A one-off research: a line of its own, with one level. */
function research(name: string, hotkey: string, effect: string, requires?: Record<string, number>): object {
  return { kind: 'upgrade', name, effect, line: '', level: 1, requires, faction: 'humains', hotkey };
}

const STATS: Record<string, object> = BALANCE.units;
export const DEFS = Object.fromEntries(
  Object.entries(BASE).map(([type, d]) => [type, { ...d, ...STATS[type], ...((d as { line?: string }).line === '' ? { line: type } : {}) }]),
) as Record<string, Def>;

/** Altitude of flying units above the ground, in tiles (render only). */
export const FLY_HEIGHT = 2.2;

export const unitDef = (type: string) => DEFS[type] as UnitDef;
export const buildingDef = (type: string) => DEFS[type] as BuildingDef;

/** Minerals carried per worker trip, and mining time per trip. */
export const HARVEST = BALANCE.rules.harvest;
export const START = BALANCE.rules.start;

/** What each faction starts with and builds; the AI and the HUD read their roles from here. */
export interface FactionDef {
  name: string;
  worker: string;
  hq: string;
  supply: string;
  barracks: string;
  extractor: string;
  /** Upgrade building, detector building and defensive building, if any. */
  forge?: string;
  detector?: string;
  defense?: string;
  /** Power-field building (Isdaris), if any. */
  pylon?: string;
  /** Second production building, for its heavier units, if any. */
  tech?: string;
  /** Buildings in the build menu, in order. */
  buildable: string[];
  /** Those of them in the advanced build menu (tech buildings). */
  advanced: string[];
  /** Army composition for the AI: [unit, weight]; units costing energy are only made when affordable. */
  army: [string, number][];
}

export const FACTIONS: Record<Faction, FactionDef> = {
  humains: {
    name: 'Humains', worker: 'serf', hq: 'conseil', supply: 'grenier', barracks: 'caserne', extractor: 'mine',
    forge: 'forge', detector: 'tour', tech: 'creaturium',
    buildable: ['conseil', 'grenier', 'caserne', 'mine', 'fortin', 'tour', 'marche', 'forge', 'metallurgie', 'alchimisterie', 'creaturium'],
    advanced: ['marche', 'forge', 'metallurgie', 'alchimisterie', 'creaturium'],
    army: Object.entries(BALANCE.ai.army.humains),
  },
  isdaris: {
    name: 'Isdaris', worker: 'moissonneur', hq: 'obelisque', supply: 'reservepsy', barracks: 'portail', extractor: 'recepteur', pylon: 'emetteur', defense: 'orbe', detector: 'orbe', tech: 'nanoassembleur',
    buildable: ['obelisque', 'emetteur', 'reservepsy', 'portail', 'recepteur', 'orbe', 'nanoassembleur'],
    advanced: ['nanoassembleur'],
    army: Object.entries(BALANCE.ai.army.isdaris),
  },
};
