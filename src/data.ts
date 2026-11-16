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
  faction: Faction;
  hotkey: string;
}

export interface BuildingDef {
  kind: 'building';
  name: string;
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
  faction: Faction;
  hotkey: string;
}

export interface ResourceDef {
  kind: 'resource';
  name: string;
  size: number;
  amount: number;
}

export type Def = UnitDef | BuildingDef | ResourceDef;

export const DEFS: Record<string, Def> = {
  serf: {
    kind: 'unit', name: 'Serf', hp: 75, armor: 0, speed: 2.4, radius: 0.375, sight: 8, supply: 1,
    cost: { minerals: 100, energy: 0 }, buildTime: 12, attack: { damage: 5, range: 0.1, cooldown: 2 }, worker: true, faction: 'humains', hotkey: 'S',
  },
  auxiliaire: {
    kind: 'unit', name: 'Auxiliaire', hp: 80, armor: 0, speed: 2.4, radius: 0.375, sight: 8, supply: 1,
    cost: { minerals: 100, energy: 0 }, buildTime: 18, attack: { damage: 6, range: 4, cooldown: 1 }, faction: 'humains', hotkey: 'A',
  },
  legionnaire: {
    kind: 'unit', name: 'Légionnaire-scieur', hp: 105, armor: 1, speed: 2.5, radius: 0.375, sight: 8, supply: 1,
    cost: { minerals: 100, energy: 0 }, buildTime: 20, attack: { damage: 20, range: 0.1, cooldown: 1 }, faction: 'humains', hotkey: 'L',
  },
  soigneur: {
    kind: 'unit', name: 'Soigneur', hp: 80, armor: 0, speed: 2.5, radius: 0.375, sight: 9, supply: 1,
    cost: { minerals: 125, energy: 100 }, buildTime: 25, attack: { damage: 12, range: 5, cooldown: 1.25, vsMechanical: -6 }, heal: 9, faction: 'humains', hotkey: 'O',
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
    cost: { minerals: 350, energy: 0 }, buildTime: 45, trains: ['auxiliaire', 'legionnaire', 'soigneur'], faction: 'humains', hotkey: 'K',
  },
  mine: {
    kind: 'building', name: 'Mine', hp: 1000, armor: 1, size: 3, sight: 5, supply: -4,
    cost: { minerals: 600, energy: 0 }, buildTime: 30, energyRate: 2.5, faction: 'humains', hotkey: 'M',
  },

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
  obelisque: {
    kind: 'building', name: 'Obélisque', hp: 2000, shield: 2000, armor: 3, size: 5, sight: 13, supply: 15,
    cost: { minerals: 1000, energy: 0 }, buildTime: 80, trains: ['moissonneur'], dropoff: true, warp: true, power: 9, faction: 'isdaris', hotkey: 'O',
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
    cost: { minerals: 400, energy: 0 }, buildTime: 50, trains: ['archer', 'creature', 'druide'], warp: true, needsPower: true, faction: 'isdaris', hotkey: 'T',
  },
  recepteur: {
    kind: 'building', name: 'Récepteur', hp: 600, shield: 600, armor: 1, size: 3, sight: 5, supply: -4,
    cost: { minerals: 600, energy: 0 }, buildTime: 30, energyRate: 2.5, warp: true, faction: 'isdaris', hotkey: 'R',
  },

  minerai: { kind: 'resource', name: 'Champ de minerai', size: 1, amount: 1500 },
  puits: { kind: 'resource', name: 'Puits énergétique', size: 3, amount: Infinity },
};

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
  /** Power-field building (Isdaris), if any. */
  pylon?: string;
  /** Buildings in the build menu, in order. */
  buildable: string[];
  /** Army composition for the AI: [unit, weight]; units costing energy are only made when affordable. */
  army: [string, number][];
}

export const FACTIONS: Record<Faction, FactionDef> = {
  humains: {
    name: 'Humains', worker: 'serf', hq: 'conseil', supply: 'grenier', barracks: 'caserne', extractor: 'mine',
    buildable: ['conseil', 'grenier', 'caserne', 'mine'],
    army: [['auxiliaire', 5], ['legionnaire', 2], ['soigneur', 2]],
  },
  isdaris: {
    name: 'Isdaris', worker: 'moissonneur', hq: 'obelisque', supply: 'reservepsy', barracks: 'portail', extractor: 'recepteur', pylon: 'emetteur',
    buildable: ['obelisque', 'emetteur', 'reservepsy', 'portail', 'recepteur'],
    army: [['archer', 4], ['creature', 4], ['druide', 2]],
  },
};
