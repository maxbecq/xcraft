// Faction data (Humans, Isdaris), from XC Mod 1.53 (SC2) where it exists.
// Times are in SC "Normal" seconds; the simulation runs at "Faster" (see GAME_SPEED).

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
  /** Permanently invisible: enemies only see it within range of one of their detectors. */
  cloaked?: boolean;
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
  faction: Faction;
  hotkey: string;
}

/** melee and ranged: +10 % of the weapon's base damage per level (at least +1); armor: +1 per level. */
export type UpgradeLine = 'melee' | 'ranged' | 'armor';

export type Def = UnitDef | BuildingDef | ResourceDef | UpgradeDef;

/** Active abilities: one per Human soldier. Times in "Normal" seconds. */
export interface AbilityDef {
  name: string;
  hotkey: string;
  cooldown: number;
  duration: number;
  /** Energy taken from the player's stock (building abilities). */
  energy?: number;
}

export const ABILITIES: Record<string, AbilityDef> = {
  /** Auxiliaire: costs 10 hp, attacks and moves 50 % faster. */
  stimulant: { name: 'Stimulant', hotkey: 'T', cooldown: 15, duration: 8 },
  /** Légionnaire: runs twice as fast to close in. */
  charge: { name: 'Charge', hotkey: 'C', cooldown: 20, duration: 3 },
  /** Soigneur (notice, mod « Peau de roc »): an ally within 4 tiles takes 5 less damage per hit. */
  peauderoc: { name: 'Peau de roc', hotkey: 'R', cooldown: 25, duration: 35 },
  /** Forge (notice): its telescope reveals a zone and detects invisible units there, for 50 energy. */
  observation: { name: 'Observation céleste', hotkey: 'O', cooldown: 30, duration: 10, energy: 50 },
  /**
   * Obélisque (mod « Rappel », a Prisme ability): after a 4 s channel, up to 8 army units within 5 tiles of
   * the target point appear around the Obélisque, then stay dazed 4 s. 100 energy as in the mod; the cooldown
   * is ours (the Prisme took 100 s to regain its 100 energy). `duration` is the channel.
   */
  rappel: { name: 'Rappel', hotkey: 'R', cooldown: 60, duration: 4, energy: 100 },
};
export const OBSERVATION = { radius: 8 };
export const RAPPEL = { radius: 5, max: 8, daze: 4 };
export const SKIN_RANGE = 4;
export const SKIN_REDUCTION = 5;
export const STIM_HP = 10;

/** Buildings each level needs, SC-like: level 2 a second Caserne, level 3 also a Tour alchimistique. */
const UPGRADE_REQUIRES: (Record<string, number> | undefined)[] = [undefined, { caserne: 2 }, { caserne: 2, tour: 1 }];

export const DEFS: Record<string, Def> = {
  serf: {
    kind: 'unit', name: 'Serf', hp: 75, armor: 0, speed: 2.4, radius: 0.375, sight: 8, supply: 1,
    cost: { minerals: 100, energy: 0 }, buildTime: 12, attack: { damage: 5, range: 0.1, cooldown: 2 }, worker: true, faction: 'humains', hotkey: 'S',
  },
  auxiliaire: {
    kind: 'unit', name: 'Auxiliaire', hp: 80, armor: 0, speed: 2.4, radius: 0.375, sight: 8, supply: 1,
    cost: { minerals: 100, energy: 0 }, buildTime: 18, attack: { damage: 6, range: 4, cooldown: 1 }, ability: 'stimulant', faction: 'humains', hotkey: 'A',
  },
  legionnaire: {
    kind: 'unit', name: 'Légionnaire-scieur', hp: 105, armor: 1, speed: 2.5, radius: 0.375, sight: 8, supply: 1,
    cost: { minerals: 100, energy: 0 }, buildTime: 20, attack: { damage: 20, range: 0.1, cooldown: 1 }, ability: 'charge', faction: 'humains', hotkey: 'L',
  },
  soigneur: {
    kind: 'unit', name: 'Soigneur', hp: 80, armor: 0, speed: 2.5, radius: 0.375, sight: 9, supply: 1,
    cost: { minerals: 125, energy: 100 }, buildTime: 25, attack: { damage: 12, range: 5, cooldown: 1.25, vsMechanical: -6 }, heal: 9, ability: 'peauderoc', faction: 'humains', hotkey: 'O',
  },
  // Mod: grenades alchimiques, 30 (20 against living targets: nearly all units), +10 here against buildings.
  phalangiste: {
    kind: 'unit', name: 'Phalangiste', hp: 110, armor: 0, speed: 2.5, radius: 0.4, sight: 9, supply: 1, requires: { forge: 1 },
    cost: { minerals: 225, energy: 150 }, buildTime: 30, attack: { damage: 20, range: 6, cooldown: 1.3, vsMechanical: 10 }, faction: 'humains', hotkey: 'P',
  },
  conseil: {
    kind: 'building', name: 'Conseil des Échevins', hp: 4000, armor: 3, size: 5, sight: 13, supply: 10,
    cost: { minerals: 1000, energy: 0 }, buildTime: 80, trains: ['serf'], dropoff: true, faction: 'humains', hotkey: 'C',
  },
  grenier: {
    kind: 'building', name: 'Grenier', hp: 1000, armor: 1, size: 2, sight: 7, supply: 10,
    cost: { minerals: 200, energy: 0 }, buildTime: 25, faction: 'humains', hotkey: 'G',
  },
  caserne: {
    kind: 'building', name: 'Caserne', hp: 2600, armor: 1, size: 3, sight: 10, supply: 0,
    cost: { minerals: 350, energy: 0 }, buildTime: 45, trains: ['auxiliaire', 'legionnaire', 'soigneur', 'phalangiste'], faction: 'humains', hotkey: 'K',
  },
  mine: {
    kind: 'building', name: 'Mine', hp: 1000, armor: 1, size: 3, sight: 5, supply: -4,
    cost: { minerals: 600, energy: 0 }, buildTime: 30, energyRate: 2.5, faction: 'humains', hotkey: 'M',
  },
  // Mod: « Guilde métallurgique » (the notice's Forge).
  forge: {
    kind: 'building', name: 'Forge', hp: 2800, armor: 2, size: 3, sight: 10, supply: 0,
    cost: { minerals: 400, energy: 0 }, buildTime: 50, ability: 'observation', faction: 'humains', hotkey: 'F',
    researches: ['melee1', 'melee2', 'melee3', 'ranged1', 'ranged2', 'ranged3', 'armor1', 'armor2', 'armor3'],
  },
  // Mod: « Tour anti-air » (detector); no air units yet, so it only detects.
  tour: {
    kind: 'building', name: 'Tour alchimistique', hp: 420, armor: 1, size: 2, sight: 10, supply: 0,
    cost: { minerals: 200, energy: 0 }, buildTime: 25, detector: 10, faction: 'humains', hotkey: 'T',
  },
  ...upgrades('melee', 'Attaque corps à corps', 'C'),
  ...upgrades('ranged', 'Attaque à distance', 'D'),
  ...upgrades('armor', 'Armure infanterie', 'A'),

  // ---------------------------------------------------------------- Isdaris
  moissonneur: {
    kind: 'unit', name: 'Robot moissonneur', hp: 50, shield: 25, armor: 0, speed: 2.4, radius: 0.375, sight: 8, supply: 1,
    cost: { minerals: 100, energy: 0 }, buildTime: 12, attack: { damage: 5, range: 0.1, cooldown: 1.5 }, worker: true, faction: 'isdaris', hotkey: 'S',
  },
  archer: {
    kind: 'unit', name: 'Archer', hp: 70, shield: 70, armor: 1, speed: 2.4, radius: 0.375, sight: 9, supply: 2,
    cost: { minerals: 150, energy: 50 }, buildTime: 24, attack: { damage: 10, range: 5, cooldown: 1.2 }, faction: 'isdaris', hotkey: 'A',
  },
  creature: {
    kind: 'unit', name: 'Créature', hp: 67, armor: 0, speed: 2.9, radius: 0.3, sight: 6, supply: 1,
    cost: { minerals: 70, energy: 0 }, buildTime: 14, attack: { damage: 7, range: 0.1, cooldown: 0.7 }, regen: 3, faction: 'isdaris', hotkey: 'C',
  },
  druide: {
    kind: 'unit', name: 'Druide', hp: 70, shield: 140, armor: 0, speed: 2.5, radius: 0.375, sight: 10, supply: 2,
    cost: { minerals: 200, energy: 150 }, buildTime: 35, attack: { damage: 18, range: 6, cooldown: 1.75 }, faction: 'isdaris', hotkey: 'D',
  },
  // Mod: « Sombre ». Shield 70 instead of the mod's 210: it still one-shots workers, but 4 auxiliaires win once it is detected.
  assassin: {
    kind: 'unit', name: 'Assassin', hp: 70, shield: 70, armor: 0, speed: 2.6, radius: 0.375, sight: 8, supply: 2,
    cost: { minerals: 400, energy: 400 }, buildTime: 50, attack: { damage: 75, range: 0.1, cooldown: 1.25, vsMechanical: -20 }, cloaked: true, faction: 'isdaris', hotkey: 'X',
  },
  obelisque: {
    kind: 'building', name: 'Obélisque', hp: 2000, shield: 2000, armor: 3, size: 5, sight: 13, supply: 15,
    cost: { minerals: 1000, energy: 0 }, buildTime: 80, trains: ['moissonneur'], dropoff: true, warp: true, power: 9, ability: 'rappel', faction: 'isdaris', hotkey: 'O',
  },
  emetteur: {
    kind: 'building', name: 'Émetteur', hp: 300, shield: 300, armor: 1, size: 2, sight: 10, supply: 0,
    cost: { minerals: 150, energy: 0 }, buildTime: 20, warp: true, power: 7, faction: 'isdaris', hotkey: 'E',
  },
  reservepsy: {
    kind: 'building', name: 'Réserve psy', hp: 500, shield: 500, armor: 1, size: 2, sight: 8, supply: 12,
    cost: { minerals: 300, energy: 0 }, buildTime: 30, warp: true, needsPower: true, shieldAura: 5, faction: 'isdaris', hotkey: 'P',
  },
  portail: {
    kind: 'building', name: 'Portail', hp: 1600, shield: 1600, armor: 1, size: 3, sight: 10, supply: 0,
    cost: { minerals: 400, energy: 0 }, buildTime: 50, trains: ['archer', 'creature', 'druide', 'assassin'], warp: true, needsPower: true, faction: 'isdaris', hotkey: 'T',
  },
  recepteur: {
    kind: 'building', name: 'Récepteur', hp: 600, shield: 600, armor: 1, size: 3, sight: 5, supply: -4,
    cost: { minerals: 600, energy: 0 }, buildTime: 30, energyRate: 2.5, warp: true, faction: 'isdaris', hotkey: 'R',
  },
  // Mod: « Orbe plasmique ».
  orbe: {
    kind: 'building', name: 'Orbe plasma', hp: 200, shield: 300, armor: 1, size: 2, sight: 8, supply: 0,
    cost: { minerals: 375, energy: 0 }, buildTime: 35, attack: { damage: 22, range: 7, cooldown: 1 }, detector: 8, warp: true, needsPower: true, faction: 'isdaris', hotkey: 'B',
  },
  // Mod: « Nano-assembleur » (needs a gateway), here making the Chasseur Discobole (its red upgrade in the mod).
  nanoassembleur: {
    kind: 'building', name: 'Nano-assembleur', hp: 1600, shield: 1600, armor: 1, size: 3, sight: 10, supply: 0, requires: { portail: 1 },
    cost: { minerals: 400, energy: 200 }, buildTime: 75, trains: ['discobole'], warp: true, needsPower: true, faction: 'isdaris', hotkey: 'N',
  },
  // Mod: disque de plasma, 40 (30 against massive targets and buildings).
  discobole: {
    kind: 'unit', name: 'Chasseur Discobole', hp: 200, shield: 250, armor: 0, speed: 2.6, radius: 0.5, sight: 9, supply: 2,
    cost: { minerals: 500, energy: 250 }, buildTime: 22.5, attack: { damage: 40, range: 6, cooldown: 1.5, vsMechanical: -10 }, faction: 'isdaris', hotkey: 'D',
  },

  minerai: { kind: 'resource', name: 'Champ de minerai', size: 1, amount: 1500 },
  puits: { kind: 'resource', name: 'Puits énergétique', size: 3, amount: Infinity },
};

/** The three levels of a Forge line; mod XC 1.53 costs and times. */
function upgrades(line: UpgradeLine, name: string, hotkey: string): Record<string, UpgradeDef> {
  const out: Record<string, UpgradeDef> = {};
  [250, 350, 450].forEach((c, i) => {
    out[`${line}${i + 1}`] = { kind: 'upgrade', name: `${name} ${i + 1}`, line, level: i + 1, cost: { minerals: c, energy: c }, buildTime: 80 + 10 * i, requires: UPGRADE_REQUIRES[i], faction: 'humains', hotkey };
  });
  return out;
}

export const unitDef = (type: string) => DEFS[type] as UnitDef;
export const buildingDef = (type: string) => DEFS[type] as BuildingDef;

/** Minerals carried per worker trip, and mining time per trip. */
export const HARVEST = { amount: 10, seconds: 3 };
export const START = { minerals: 200, energy: 0, serfs: 6 };

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
  /** Army composition for the AI: [unit, weight]; units costing energy are only made when affordable. */
  army: [string, number][];
}

export const FACTIONS: Record<Faction, FactionDef> = {
  humains: {
    name: 'Humains', worker: 'serf', hq: 'conseil', supply: 'grenier', barracks: 'caserne', extractor: 'mine',
    forge: 'forge', detector: 'tour',
    buildable: ['conseil', 'grenier', 'caserne', 'mine', 'forge', 'tour'],
    army: [['auxiliaire', 5], ['legionnaire', 2], ['soigneur', 2]],
  },
  isdaris: {
    name: 'Isdaris', worker: 'moissonneur', hq: 'obelisque', supply: 'reservepsy', barracks: 'portail', extractor: 'recepteur', pylon: 'emetteur', defense: 'orbe', detector: 'orbe', tech: 'nanoassembleur',
    buildable: ['obelisque', 'emetteur', 'reservepsy', 'portail', 'recepteur', 'orbe', 'nanoassembleur'],
    army: [['archer', 4], ['creature', 4], ['druide', 2], ['assassin', 1]],
  },
};
