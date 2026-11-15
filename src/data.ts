// Human faction data, from XC Mod 1.53 (SC2) where it exists.
// Times are in SC "Normal" seconds; the simulation runs at "Faster" (see GAME_SPEED).

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
    cost: { minerals: 100, energy: 0 }, buildTime: 12, attack: { damage: 5, range: 0.1, cooldown: 2 }, worker: true, hotkey: 'S',
  },
  auxiliaire: {
    kind: 'unit', name: 'Auxiliaire', hp: 80, armor: 0, speed: 2.4, radius: 0.375, sight: 8, supply: 1,
    cost: { minerals: 100, energy: 0 }, buildTime: 18, attack: { damage: 6, range: 4, cooldown: 1 }, hotkey: 'A',
  },
  legionnaire: {
    kind: 'unit', name: 'Légionnaire-scieur', hp: 105, armor: 1, speed: 2.5, radius: 0.375, sight: 8, supply: 1,
    cost: { minerals: 100, energy: 0 }, buildTime: 20, attack: { damage: 20, range: 0.1, cooldown: 1 }, hotkey: 'L',
  },
  soigneur: {
    kind: 'unit', name: 'Soigneur', hp: 80, armor: 0, speed: 2.5, radius: 0.375, sight: 9, supply: 1,
    cost: { minerals: 125, energy: 100 }, buildTime: 25, attack: { damage: 12, range: 5, cooldown: 1.25, vsMechanical: -6 }, heal: 9, hotkey: 'O',
  },
  conseil: {
    kind: 'building', name: 'Conseil des Échevins', hp: 4000, armor: 3, size: 5, sight: 13, supply: 10,
    cost: { minerals: 1000, energy: 0 }, buildTime: 80, trains: ['serf'], dropoff: true, hotkey: 'C',
  },
  grenier: {
    kind: 'building', name: 'Grenier', hp: 1000, armor: 1, size: 2, sight: 7, supply: 10,
    cost: { minerals: 200, energy: 0 }, buildTime: 25, hotkey: 'G',
  },
  caserne: {
    kind: 'building', name: 'Caserne', hp: 2600, armor: 1, size: 3, sight: 10, supply: 0,
    cost: { minerals: 350, energy: 0 }, buildTime: 45, trains: ['auxiliaire', 'legionnaire', 'soigneur'], hotkey: 'K',
  },
  mine: {
    kind: 'building', name: 'Mine', hp: 1000, armor: 1, size: 3, sight: 5, supply: -4,
    cost: { minerals: 600, energy: 0 }, buildTime: 30, energyRate: 2.5, hotkey: 'M',
  },
  minerai: { kind: 'resource', name: 'Champ de minerai', size: 1, amount: 1500 },
  puits: { kind: 'resource', name: 'Puits énergétique', size: 3, amount: Infinity },
};

export const unitDef = (type: string) => DEFS[type] as UnitDef;
export const buildingDef = (type: string) => DEFS[type] as BuildingDef;

/** Minerals carried per worker trip, and mining time per trip. */
export const HARVEST = { amount: 10, seconds: 3 };
export const START = { minerals: 200, energy: 0, serfs: 6 };
