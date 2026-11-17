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
  /** Area weapon: half damage to the enemy ground units within this radius (tiles) of the target. */
  splash?: number;
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
  /** Further abilities, after `ability`. */
  abilities?: string[];
  /** Lives this many seconds, then falls (Cadavre réanimé). */
  lifetime?: number;
  /** Units it can carry (Scarabée): they shoot from inside. */
  bunker?: number;
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
  /** Further abilities, after `ability`. */
  abilities?: string[];
  /** Hides allied ground units and vehicles within this radius (tiles) from enemies without detection (Déflecteur). */
  cloakAura?: number;
  /** Defensive building: shoots enemy units in range. */
  attack?: Attack;
  /** Reveals invisible enemies within this radius (tiles). */
  detector?: number;
  /** Bunker: how many units can shelter inside. */
  bunker?: number;
  /** Buildings this one can turn into, in place, through its production queue (paying the new one's cost). */
  morphs?: string[];
  /** One per player at most (Grand Conseil). */
  unique?: boolean;
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
  /** Aimed at a point of the map, within `range` tiles of the caster (the others are used on the spot). */
  target?: 'point' | 'self';
  range?: number;
  /** Area radius (tiles), damage, and the like, depending on the ability. */
  radius?: number;
  damage?: number;
  /** Most units it moves at once. */
  max?: number;
}

/** Every active ability of a unit or building def. */
export function abilitiesOf(def: { ability?: string; abilities?: string[] }): string[] {
  return [...(def.ability ? [def.ability] : []), ...(def.abilities ?? [])];
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
  /** Belluaire (notice): a sweeping blow that hits every enemy on the ground around it. */
  coupcirculaire: { name: 'Coup circulaire', hotkey: 'C', ...BALANCE.abilities.coupcirculaire },
  /** Belluaire (notice): blends into the surroundings, unseen by enemies without detection, for a while. */
  camouflage: { name: 'Camouflage', hotkey: 'F', ...BALANCE.abilities.camouflage },
  /** Alchimiste (notice): a toxin bomb, poisoning every enemy in a wide zone. */
  explosiftoxique: { name: 'Explosif toxique', hotkey: 'E', target: 'point', research: 'cocktail', ...BALANCE.abilities.explosiftoxique },
  /** Alchimiste (notice): the ally nearest the point cannot be hurt for a while, then the toxins nearly kill it (1 hp). */
  regenerant: { name: 'Régénérant', hotkey: 'G', target: 'point', research: 'regenerant', ...BALANCE.abilities.regenerant },
  /** Alchimiste (notice): a living unit fallen near the point rises and fights for a while as a Cadavre réanimé. */
  reanimation: { name: 'Réanimation', hotkey: 'R', target: 'point', ...BALANCE.abilities.reanimation },
  /** Phalangiste (notice): a napalm charge on a vehicle near the point: an enemy one is burnt and stopped, an ally one repaired. */
  napalm: { name: 'Charge de napalm', hotkey: 'N', target: 'point', research: 'chargenapalm', ...BALANCE.abilities.napalm },
  /** Créature (notice): burrows, unseen, and bursts out when an enemy comes near; again to come out. */
  enfouissement: { name: 'Enfouissement', hotkey: 'F', research: 'enfouissement', ...BALANCE.abilities.enfouissement },
  /** Assassin (notice): overwhelms the mind of the enemy nearest the point, which cannot move nor fight for a while. */
  chocmental: { name: 'Choc mental', hotkey: 'M', target: 'point', research: 'chocmental', ...BALANCE.abilities.chocmental },
  /** Druide (notice): a perfect energy double of the ally nearest the point, for a while. */
  double: { name: 'Double énergétique', hotkey: 'O', target: 'point', ...BALANCE.abilities.double },
  /** Druide (notice): a bolt of plasma on the enemy nearest the point. */
  deflagration: { name: 'Déflagration', hotkey: 'G', target: 'point', research: 'deflagration', ...BALANCE.abilities.deflagration },
  /** Druide (notice): no ability can be used inside the zone for a while. */
  silence: { name: 'Silence des ions', hotkey: 'I', target: 'point', research: 'silence', ...BALANCE.abilities.silence },
  /** Porte-disques, Chimère, Dragon (notice): a short-range teleport. */
  teleport: { name: 'Téléportation', hotkey: 'T', target: 'point', ...BALANCE.abilities.teleport },
  /** Baliste plasma (notice): the cannon spins, firing at every enemy around. */
  feucirculaire: { name: 'Feu circulaire', hotkey: 'F', research: 'feucirculaire', ...BALANCE.abilities.feucirculaire },
  /** Espion (notice): with another Espion, a time corridor: the units round this one appear by the other. */
  couloir: { name: 'Couloir temporel', hotkey: 'C', research: 'couloir', ...BALANCE.abilities.couloir },
  /** Voyageur (notice): a cloak of negative energy over itself and the allies round it. */
  manteau: { name: 'Manteau', hotkey: 'M', research: 'manteau', ...BALANCE.abilities.manteau },
  /** Voyageur (notice): itself and the allies round it appear by the friendly building nearest the point. */
  teleportgroupe: { name: 'Téléportation de groupe', hotkey: 'T', target: 'point', research: 'teleportation', ...BALANCE.abilities.teleportgroupe },
  /** Voyageur (notice): the ally nearest the point sends back part of the damage it takes. */
  renvoi: { name: 'Sphère de renvoi', hotkey: 'R', target: 'point', research: 'renvoi', ...BALANCE.abilities.renvoi },
  /** Béhémoth (notice): phases out, unhurt and unable to fight, for a while. */
  dephasage: { name: 'Déphasage', hotkey: 'D', research: 'dephasage', ...BALANCE.abilities.dephasage },
  /** Orbe de commandement (notice, Observatoire): reveals a very wide zone. */
  observatoire: { name: 'Observatoire', hotkey: 'V', research: 'observatoire', ...BALANCE.abilities.observatoire },
  /** Trône (notice, Relais de canon orbital): a plasma beam from orbit on a point an Espion watches. */
  canonorbital: { name: 'Canon orbital', hotkey: 'C', research: 'relais', ...BALANCE.abilities.canonorbital },
  /** Trône (notice, Porte de déphasage): the Isdaris units round the point phase out for a while. */
  portedephasage: { name: 'Porte de déphasage', hotkey: 'P', research: 'porte', ...BALANCE.abilities.portedephasage },
  /** Char Pégase (notice): takes off (shooting only at flyers) or lands. */
  decollage: { name: 'Décollage / atterrissage', hotkey: 'D', research: 'decollage', ...BALANCE.abilities.decollage },
  /** Caserne volante: lifts off, a slow flyer that trains nothing until it lands. */
  envol: { name: 'Décoller', hotkey: 'D', target: 'self', ...BALANCE.abilities.envol },
  atterrissage: { name: 'Atterrir', hotkey: 'D', target: 'point', ...BALANCE.abilities.atterrissage },
  /** Trône (Concentrateur): a wall of energy across the map point, no unit nor shot goes through it. */
  murenergie: { name: "Mur d'énergie", hotkey: 'M', research: 'concentrateur', ...BALANCE.abilities.murenergie },
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
  phalangiste: { kind: 'unit', name: 'Phalangiste', radius: 0.4, requires: { forge: 1 }, ability: 'napalm', faction: 'humains', hotkey: 'P' },
  conseil: { kind: 'building', name: 'Conseil des Échevins', size: 5, trains: ['serf'], dropoff: true, morphs: ['grandconseil'], faction: 'humains', hotkey: 'C' },
  // Notice: « Grand Conseil », the one planning office: while it stands, every unit is produced faster.
  grandconseil: { kind: 'building', name: 'Grand Conseil', size: 5, trains: ['serf'], dropoff: true, morphOnly: true, unique: true, requires: { forge: 1 }, faction: 'humains', hotkey: 'G' },
  grenier: { kind: 'building', name: 'Grenier', size: 2, faction: 'humains', hotkey: 'G' },
  caserne: { kind: 'building', name: 'Caserne', size: 3, trains: ['auxiliaire', 'legionnaire', 'soigneur', 'phalangiste', 'belluaire'], morphs: ['casernevolante'], faction: 'humains', hotkey: 'K' },
  // Notice: a Caserne turned into one that takes off and lands at will, to set up behind the enemy.
  casernevolante: { kind: 'building', name: 'Caserne volante', size: 3, trains: ['auxiliaire', 'legionnaire', 'soigneur', 'phalangiste', 'belluaire'], morphOnly: true, requires: { marche: 1 }, ability: 'envol', faction: 'humains', hotkey: 'V' },
  casernevol: { kind: 'unit', name: 'Caserne volante (en vol)', radius: 1.4, flying: true, mechanical: true, ability: 'atterrissage', faction: 'humains', hotkey: 'V' },
  mine: { kind: 'building', name: 'Mine', size: 3, faction: 'humains', hotkey: 'M' },
  // Mod: « Guilde métallurgique » (the notice's Forge).
  forge: {
    kind: 'building', name: 'Forge', size: 3, ability: 'observation', faction: 'humains', hotkey: 'F',
    researches: ['melee1', 'melee2', 'melee3', 'ranged1', 'ranged2', 'ranged3', 'armor1', 'armor2', 'armor3', 'vehicles1', 'vehicles2', 'vehicles3', 'skin1', 'skin2', 'skin3', 'canonsscies', 'cuirasse', 'scieassaut', 'lamesempoisonnees', 'chargenapalm', 'observation'],
  },
  // Notice: « Marché », trade one resource for the other at a poor rate, and economic research (mod: « Guilde des dresseurs-marchands »).
  marche: { kind: 'building', name: 'Marché', size: 3, requires: { caserne: 1 }, researches: ['croissance', 'pillage', 'entrainementgroupe'], faction: 'humains', hotkey: 'R' },
  // Mod: « Fortin », a bunker for four: soldiers inside are out of reach and shoot one tile farther.
  fortin: { kind: 'building', name: 'Fortin', size: 2, requires: { caserne: 1 }, faction: 'humains', hotkey: 'B' },
  // Mod: « Tour anti-air », a detector with a rocket launcher against flying units only (40, range 8).
  tour: { kind: 'building', name: 'Tour alchimistique', size: 2, faction: 'humains', hotkey: 'T' },
  // Notice: « Métallurgie », the vehicle workshop (mod « Machinerie », needing the Guilde métallurgique, here the Forge).
  metallurgie: { kind: 'building', name: 'Métallurgie', size: 3, requires: { forge: 1 }, trains: ['bourdon', 'scarabee', 'pegase'], researches: ['charlourd', 'decollage', 'chargement', 'scarabeassaut'], faction: 'humains', hotkey: 'M' },
  // Notice: « Scarabée », a slow amphibious armoured wagon: up to four Auxiliaires, Soigneurs, Phalangistes or Alchimistes
  // shelter and shoot from inside (mod « Transport scarabée »); with Scarabée d'assaut it has a gun of its own.
  scarabee: { kind: 'unit', name: 'Scarabée', radius: 0.8, mechanical: true, faction: 'humains', hotkey: 'S' },
  // Notice: « Bourdon », a propeller airship: detector, short-range anti-vehicle grenades, good against buildings and flyers
  // (mod « Dirigeable d'appui », which had no weapon: ours is provisional).
  bourdon: { kind: 'unit', name: 'Bourdon', radius: 0.45, flying: true, mechanical: true, faction: 'humains', hotkey: 'B' },
  // Notice: « Char Pégase », a massive tank whose « Incineratus » cannon wrecks vehicles and buildings (mod « Pegasus », ground mode).
  pegase: { kind: 'unit', name: 'Char Pégase', radius: 0.9, mechanical: true, ability: 'decollage', faction: 'humains', hotkey: 'P' },
  // Notice: « Alchimisterie », the alchemy tier: Alchimistes (mod: needs the Guilde alchimistique, here the Forge).
  alchimisterie: { kind: 'building', name: 'Alchimisterie', size: 3, requires: { forge: 1 }, trains: ['alchimiste'], researches: ['armeschimiques', 'cocktail', 'regenerant'], morphs: ['grandealchimisterie'], faction: 'humains', hotkey: 'A' },
  // Notice: « Alchimiste », a fragile support that detects hidden units; mod: cocktail instable, 15 (+5 against living targets).
  alchimiste: { kind: 'unit', name: 'Alchimiste', radius: 0.375, abilities: ['explosiftoxique', 'regenerant', 'reanimation'], faction: 'humains', hotkey: 'A' },
  // Notice: « Grande Alchimisterie », where the Réservoirs de substances are deployed.
  grandealchimisterie: {
    kind: 'building', name: 'Grande Alchimisterie', size: 3, trains: ['alchimiste', 'cuve'], researches: ['armeschimiques', 'cocktail', 'regenerant', 'acide'], morphOnly: true, faction: 'humains', hotkey: 'G',
  },
  // Notice: « Réservoir de substances », a heavy vat carried by serfs, its master alchemist throwing area bombs (mod « Cuve à efférents »).
  cuve: { kind: 'unit', name: 'Réservoir de substances', radius: 0.7, mechanical: true, faction: 'humains', hotkey: 'V' },
  // Notice: a fallen living unit raised by an Alchimiste, fighting for its side for a while (mod « Cadavre réanimé »).
  cadavre: { kind: 'unit', name: 'Cadavre réanimé', radius: 0.375, faction: 'humains', hotkey: 'Z' },
  // Notice: « Créaturium », where the belluaires train saurians (mod: needs the Guilde des dresseurs-marchands, here a Caserne).
  creaturium: { kind: 'building', name: 'Créaturium', size: 3, requires: { caserne: 1 }, trains: ['plesiosaure', 'ankylosaure', 'allosaure'], researches: ['oeilpercant', 'dressageallosaures', 'trebuchet'], faction: 'humains', hotkey: 'C' },
  // Notice: « Plésiosaure », a flying saurian with a heavy ballista against ground infantry (mod « Rodactylus »).
  plesiosaure: { kind: 'unit', name: 'Plésiosaure', radius: 0.6, flying: true, beast: true, faction: 'humains', hotkey: 'P' },
  // Notice: « Ankylosaure », slow and armoured, its spiked tail smashes buildings (mod « Kylosaurus »: 60, -30 light, +30 structures).
  ankylosaure: { kind: 'unit', name: 'Ankylosaure', radius: 0.9, beast: true, faction: 'humains', hotkey: 'A' },
  // Notice: « Allosaure », a huge flesh-eater that devours infantry (mod « Carnosaurus »: 60, -30 mechanical).
  allosaure: { kind: 'unit', name: 'Allosaure', radius: 0.9, beast: true, requires: { creaturium: 1, dressageallosaures: 1 }, faction: 'humains', hotkey: 'L' },
  // Notice: « Belluaire », a halberdier on a reptile, deadly to infantry, nearly useless against machines; trained in the
  // Caserne once a Créaturium stands (mod: a flamethrower, 15 +25 against living targets).
  belluaire: { kind: 'unit', name: 'Belluaire', radius: 0.45, requires: { creaturium: 1 }, abilities: ['coupcirculaire', 'camouflage'], faction: 'humains', hotkey: 'B' },
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
  cocktail: research('Cocktail alchimistique', 'K', "Les Alchimistes lancent l'Explosif toxique."),
  regenerant: research('Régénérant chimique', 'R', 'Les Alchimistes lancent le Régénérant sur leurs alliés.'),
  acide: research('Acide anti-structure', 'Q', 'Réservoirs de substances : gros bonus contre les bâtiments et les machines.'),
  chargenapalm: research('Charge de napalm', 'H', 'Les Phalangistes lancent la Charge de napalm sur les véhicules.'),
  decollage: research('Décollage', 'D', 'Les Chars Pégase peuvent décoller (tir anti-aérien) et atterrir.'),
  chargement: research('Chargement', 'C', "Les Bourdons embarquent jusqu'à quatre fantassins."),
  scarabeassaut: research("Scarabée d'assaut", 'A', 'Les Scarabées reçoivent un canon.'),
  trebuchet: research('Trébuchet intégré', 'T', 'Les Ankylosaures bombardent les bâtiments de loin.'),

  // ---------------------------------------------------------------- Isdaris
  moissonneur: { kind: 'unit', name: 'Robot moissonneur', radius: 0.375, worker: true, mechanical: true, faction: 'isdaris', hotkey: 'S' },
  archer: { kind: 'unit', name: 'Archer', radius: 0.375, faction: 'isdaris', hotkey: 'A' },
  creature: { kind: 'unit', name: 'Créature', radius: 0.3, ability: 'enfouissement', faction: 'isdaris', hotkey: 'C' },
  druide: { kind: 'unit', name: 'Druide', radius: 0.375, requires: { laboratoire: 1 }, abilities: ['double', 'deflagration', 'silence'], faction: 'isdaris', hotkey: 'D' },
  // Mod: « Sombre ». Shield 70 instead of the mod's 210: it still one-shots workers, but 4 auxiliaires win once it is detected.
  assassin: { kind: 'unit', name: 'Assassin', radius: 0.375, cloaked: true, requires: { autel: 1 }, ability: 'chocmental', faction: 'isdaris', hotkey: 'X' },
  obelisque: { kind: 'building', name: 'Obélisque', size: 5, trains: ['moissonneur'], dropoff: true, warp: true, ability: 'rappel', faction: 'isdaris', hotkey: 'O' },
  emetteur: { kind: 'building', name: 'Émetteur', size: 2, warp: true, morphs: ['pylonesanglant', 'deflecteur'], faction: 'isdaris', hotkey: 'E' },
  // Notice: an Émetteur turned « Déflecteur »: an aura of invisibility over the allied infantry and vehicles round it.
  deflecteur: { kind: 'building', name: 'Déflecteur', size: 2, requires: { orbecommandement: 1 }, warp: true, morphOnly: true, faction: 'isdaris', hotkey: 'D' },
  // Mod: an Émetteur turned into a « Pylône sanglant » (annihilateur de matière: 200 every 6.6 s, range 10, ground only).
  // The mod asks for an Orbe de commandement, not in the game yet: a Nano-assembleur stands in.
  pylonesanglant: { kind: 'building', name: 'Pylône sanglant', size: 2, requires: { orbecommandement: 1 }, warp: true, morphOnly: true, faction: 'isdaris', hotkey: 'P' },
  reservepsy: { kind: 'building', name: 'Réserve psy', size: 2, warp: true, needsPower: true, faction: 'isdaris', hotkey: 'P' },
  portail: {
    kind: 'building', name: 'Portail', size: 3, trains: ['archer', 'creature', 'druide', 'assassin'], warp: true, needsPower: true, faction: 'isdaris', hotkey: 'T',
    researches: ['miniportail', 'cuvegenetique', 'laboratoire', 'portailatk1', 'portailatk2', 'portailatk3', 'portailarmor1', 'portailarmor2', 'portailarmor3', 'enfouissement', 'deflagration', 'silence'],
  },
  recepteur: { kind: 'building', name: 'Récepteur', size: 3, warp: true, morphs: ['recepteurarme'], faction: 'isdaris', hotkey: 'R' },
  // Mod: « Récepteur armé », the Récepteur with a plasma arc (as the Orbe's), still drawing energy.
  recepteurarme: { kind: 'building', name: 'Récepteur armé', size: 3, warp: true, morphOnly: true, faction: 'isdaris', hotkey: 'A' },
  // Mod: « Orbe plasmique ».
  orbe: { kind: 'building', name: 'Orbe plasma', size: 2, warp: true, needsPower: true, faction: 'isdaris', hotkey: 'B' },
  // Mod: « Nano-assembleur » (needs a gateway), here making the Chasseur Discobole (its red upgrade in the mod).
  nanoassembleur: {
    kind: 'building', name: 'Psycho-assembleur', size: 3, requires: { portail: 1 }, trains: ['discobole', 'baliste', 'espion', 'chimere', 'dragon', 'voyageur', 'behemoth'], warp: true, needsPower: true, faction: 'isdaris', hotkey: 'N',
    researches: ['assembleur', 'balise', 'totem', 'assembleuratk1', 'assembleuratk2', 'assembleuratk3', 'assembleurarmor1', 'assembleurarmor2', 'assembleurarmor3', 'teleportation', 'manteau', 'feucirculaire', 'couloir'],
  },
  // Notice: « Orbe de commandement », the fourth major building, for large battles: shields research, and its extensions.
  orbecommandement: {
    kind: 'building', name: 'Orbe de commandement', size: 3, requires: { nanoassembleur: 1 }, warp: true, needsPower: true, ability: 'observatoire', faction: 'isdaris', hotkey: 'C',
    researches: ['autel', 'pyramide', 'observatoire', 'bouclier1', 'bouclier2', 'bouclier3', 'robots', 'cercle1', 'cercle2', 'chocmental', 'boostgenetique', 'teleportrapide', 'canonlourd', 'dephasage', 'renvoi', 'omniscience'],
  },
  // Notice: « Trône d'Altar Sargon », the last major building: Béhémoths, and the ultimate powers of its extensions.
  trone: {
    kind: 'building', name: "Trône d'Altar Sargon", size: 4, requires: { orbecommandement: 1 }, warp: true, needsPower: true, abilities: ['canonorbital', 'portedephasage', 'murenergie'], faction: 'isdaris', hotkey: 'A',
    researches: ['relais', 'porte', 'concentrateur'],
  },
  // Mod: disque de plasma, 40 (30 against massive targets and buildings).
  discobole: { kind: 'unit', name: 'Chasseur Discobole', radius: 0.5, mechanical: true, requires: { assembleur: 1 }, ability: 'teleport', faction: 'isdaris', hotkey: 'D' },
  // Notice: « Baliste plasma », a levitating ion cannon, slower but tougher than the Porte-disques (mod « Baliste »).
  baliste: { kind: 'unit', name: 'Baliste plasma', radius: 0.6, mechanical: true, requires: { assembleur: 1 }, ability: 'feucirculaire', faction: 'isdaris', hotkey: 'B' },
  // Notice: « Espion », an unarmed scout that detects hidden units and opens time corridors (mod « Prisme »).
  espion: { kind: 'unit', name: 'Espion', radius: 0.4, flying: true, mechanical: true, requires: { balise: 1 }, ability: 'couloir', faction: 'isdaris', hotkey: 'E' },
  // Notice: « Dragon », the Chimère made for space battles: plasma concentrators against flyers only, long range.
  dragon: { kind: 'unit', name: 'Dragon', radius: 0.5, flying: true, mechanical: true, requires: { balise: 1, pyramide: 1 }, ability: 'teleport', faction: 'isdaris', hotkey: 'G' },
  // Notice: « Voyageur », an unarmed flying generator: detects, recharges shields, cloaks, teleports, reflects.
  voyageur: { kind: 'unit', name: 'Voyageur', radius: 0.7, flying: true, mechanical: true, requires: { totem: 1 }, abilities: ['manteau', 'teleportgroupe', 'renvoi'], faction: 'isdaris', hotkey: 'V' },
  // Notice: « Béhémoth », a flying fortress with a building's shield and unmatched firepower; it can phase out.
  behemoth: { kind: 'unit', name: 'Béhémoth', radius: 1.1, flying: true, mechanical: true, requires: { balise: 1, trone: 1 }, ability: 'dephasage', faction: 'isdaris', hotkey: 'H' },

  // Mod: « Chimère » (green Nano-assembleur), a flying hunter: ion blaster, 21 a second, air and ground.
  chimere: { kind: 'unit', name: 'Chimère', radius: 0.45, flying: true, mechanical: true, requires: { balise: 1 }, ability: 'teleport', faction: 'isdaris', hotkey: 'C' },
  // Isdaris research (notice); extensions are researched on their host building.
  miniportail: extension('Miniportail', 'M', 'Unités du Portail formées 25 % plus vite.'),
  cuvegenetique: extension('Cuve génétique', 'U', 'Les Créatures arrivent par deux.'),
  laboratoire: extension('Laboratoire', 'L', 'Druides, et recherches de combat de l\'infanterie.'),
  ...upgrades('portailatk', 'Attaque portail', 'K', { laboratoire: 1 }, 'isdaris'),
  ...upgrades('portailarmor', 'Blindage portail', 'J', { laboratoire: 1 }, 'isdaris'),
  enfouissement: isd('Enfouissement', 'F', "Les Créatures s'enfouissent, invisibles, et jaillissent quand un ennemi approche.", { laboratoire: 1 }),
  deflagration: isd('Déflagration', 'G', 'Les Druides lancent un éclair de plasma dévastateur.', { laboratoire: 1 }),
  silence: isd('Silence des ions', 'I', "Les Druides empêchent l'usage des capacités dans une zone.", { laboratoire: 1 }),
  assembleur: extension('Assembleur inférieur', 'A', 'Véhicules terrestres : Porte-disques, Baliste plasma.'),
  balise: extension('Balise', 'B', 'Unités aériennes : Espion, Chimère, Dragon, Béhémoth.'),
  totem: extension('Totem', 'T', 'Voyageurs, et recherches de combat des véhicules.'),
  ...upgrades('assembleuratk', 'Attaque assembleur', 'K', { totem: 1 }, 'isdaris'),
  ...upgrades('assembleurarmor', 'Blindage assembleur', 'J', { totem: 1 }, 'isdaris'),
  teleportation: isd('Téléportation', 'P', 'Le Voyageur téléporte un groupe auprès d\'un bâtiment ami.', { totem: 1 }),
  manteau: isd('Manteau', 'O', "Le Voyageur rend invisibles les unités qui l'entourent.", { totem: 1 }),
  feucirculaire: isd('Feu circulaire', 'F', 'La Baliste plasma tire sur tous les ennemis autour d\'elle.', { totem: 1 }),
  couloir: isd('Couloir temporel', 'C', "Deux Espions font passer des unités de l'un à l'autre.", { totem: 1 }),
  autel: extension('Autel', 'A', 'Assassins au Portail, et recherches avancées.'),
  pyramide: extension('Pyramide', 'Y', 'Dragons au Psycho-assembleur, et recherches avancées.'),
  observatoire: extension('Observatoire', 'O', "L'Orbe révèle une très large zone."),
  ...upgrades('bouclier', 'Bouclier psychique', 'B', undefined, 'isdaris'),
  robots: isd('Robots améliorés', 'R', 'Robots moissonneurs : +1 attaque, +1 armure.'),
  ...upgrades('cercle', "Cercle d'énergie", 'E', undefined, 'isdaris', 2),
  chocmental: isd('Choc mental', 'M', "L'Assassin tétanise un ennemi.", { pyramide: 1 }),
  boostgenetique: isd('Boost génétique', 'G', 'Créatures : plus de PV, de cadence et de vitesse.', { pyramide: 1 }),
  teleportrapide: isd('Téléportation rapide', 'T', 'Porte-disques, Chimères, Dragons : téléportation deux fois plus fréquente.', { autel: 1 }),
  canonlourd: isd('Canon plasma lourd', 'L', 'Baliste plasma : très longue portée.', { autel: 1 }),
  dephasage: isd('Module déphasant', 'D', 'Le Béhémoth se déphase : invulnérable, sans attaquer.', { autel: 1 }),
  renvoi: isd('Sphère de renvoi', 'S', 'Le Voyageur protège un allié qui renvoie une part des dégâts.', { autel: 1 }),
  omniscience: isd('Omniscience', 'N', 'Espions : vision très étendue.', { autel: 1 }),
  relais: extension('Relais de canon orbital', 'R', "Le Trône frappe depuis l'espace un point visé par un Espion."),
  porte: extension('Porte de déphasage', 'P', "Le Trône déphase un groupe d'unités isdaris."),
  concentrateur: extension('Concentrateur énergétique', 'C', "Le Trône dresse un mur d'énergie que rien ne traverse."),

  minerai: { kind: 'resource', name: 'Champ de minerai', size: 1 },
  puits: { kind: 'resource', name: 'Puits énergétique', size: 3, amount: Infinity },
};

/** The three levels of a Forge line (costs and times in balance.json); `base`: buildings the line needs from level 1. */
function upgrades(line: UpgradeLine, name: string, hotkey: string, base?: Record<string, number>, faction: Faction = 'humains', levels = 3): Record<string, object> {
  const out: Record<string, object> = {};
  const steps = faction === 'humains' ? UPGRADE_REQUIRES : [undefined, undefined, undefined];
  for (let i = 0; i < levels; i++) out[`${line}${i + 1}`] = { kind: 'upgrade', name: `${name} ${i + 1}`, line, level: i + 1, requires: { ...base, ...steps[i] }, faction, hotkey };
  return out;
}

/** A one-off research: a line of its own, with one level. */
function research(name: string, hotkey: string, effect: string, requires?: Record<string, number>, faction: Faction = 'humains'): object {
  return { kind: 'upgrade', name, effect, line: '', level: 1, requires, faction, hotkey };
}

/** An Isdaris extension (notice): built onto a major building, here researched there; unlocks units and research. */
function extension(name: string, hotkey: string, effect: string, requires?: Record<string, number>): object {
  return research(`Extension : ${name}`, hotkey, effect, requires, 'isdaris');
}
/** An Isdaris research (notice). */
function isd(name: string, hotkey: string, effect: string, requires?: Record<string, number>): object {
  return research(name, hotkey, effect, requires, 'isdaris');
}

const STATS: Record<string, object> = BALANCE.units;
export const DEFS = Object.fromEntries(
  Object.entries(BASE).map(([type, d]) => [type, { ...d, ...STATS[type], ...((d as { line?: string }).line === '' ? { line: type } : {}) }]),
) as Record<string, Def>;

/** Types drawn with another's model and icon until they get their own (render only). */
export const LOOKS: Record<string, string> = { casernevolante: 'caserne', casernevol: 'caserne', grandconseil: 'conseil', grandealchimisterie: 'alchimisterie', cadavre: 'serf' };
/** Size of those stand-in models against the original's. */
export const LOOK_SCALE: Record<string, number> = { grandconseil: 1.1 };

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
    buildable: ['obelisque', 'emetteur', 'reservepsy', 'portail', 'recepteur', 'orbe', 'nanoassembleur', 'orbecommandement', 'trone'],
    advanced: ['nanoassembleur', 'orbecommandement', 'trone'],
    army: Object.entries(BALANCE.ai.army.isdaris),
  },
};
