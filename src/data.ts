// Faction data (Humans, Isdaris, Z, Dieux), from XC Mod 1.53 (SC2) where it exists.
// Times are in SC "Normal" seconds; the simulation runs at "Faster" (see GAME_SPEED).
// Every balance number (hp, costs, damage, ability timings, AI thresholds) lives in balance.json, owned by the
// balance designer (see BALANCE.md); this file holds what each thing is and does.

import BALANCE from './balance.json';

export type Faction = 'humains' | 'isdaris' | 'z' | 'dieux';

export interface Cost {
  minerals: number;
  energy: number;
}

/** Every Z weapon a socle can be built with; the ones that fight, for the Tourelle and the Assimilateur. */
const SOCLE_WEAPONS = ['laser', 'flammes', 'roquettes', 'dechiqueteur', 'jetsonique', 'arc', 'canonx04', 'reparateur', 'accumulateur'];
const TOWER_WEAPONS = ['laser', 'flammes', 'roquettes', 'dechiqueteur', 'jetsonique', 'arc', 'canonx04'];

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
  /** Z Jet sonique: also hurts every unit, friend or foe, between the shooter and its target. */
  line?: boolean;
  /** Z Arc électrique: strikes up to this many enemies at once, in front of the shooter. */
  targets?: number;
  /** Z Canon X-04: fired at a target in contact, the shooter takes the blast too. */
  selfHit?: boolean;
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
  /** Z socle: weapons (keys of WEAPONS) it can be built with, in place of the machine gun of `attack`. */
  /** Z socle: the level of its weapon (Z.doc: Quadripode and Coléoptère T1 1, Hexapode T1 2), one more per tier. */
  weaponLevel?: number;
  /** Z socle: what it becomes in the field, T2 then T3 (Z.doc), each unlocked by the next level of its research `r<type>`. */
  tiers?: TierStats[];
  weapons?: string[];
  /** Dieux: a god that summons these units at its feet, through its own queue, while it stands still. */
  trains?: string[];
  /** One per player at most, queued ones included (the gods). */
  unique?: boolean;
  /** Places buildings (Gaïa); by default only workers do. */
  builder?: boolean;
  /** Comes back by itself at its side's headquarters this many seconds after dying (Gaïa). */
  respawn?: number;
  /** Needs `count` of these units standing, any of them (second-rank gods: two of the first rank). */
  requiresAny?: { of: string[]; count: number };
  /** Dieux: the god's 5 levels (XC.doc 2008), bought at the god. Stats by level (index 0 = level 1); price and time of
   * levels 2 to 5 (index 0 = level 2). What a god summons or calls down takes its base time divided by its level. */
  levels?: GodLevels;
  faction: Faction;
  hotkey: string;
}

export interface GodLevels {
  hp: number[];
  armor: number[];
  speed: number[];
  damage?: number[];
  cost: Cost[];
  time: number[];
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
  /** Isdaris: must be placed inside a power field (Z: on its creep, the same field drawn as cables). */
  needsPower?: boolean;
  /** Z: the drone that builds it merges into it (it is gone), and the building then grows by itself. */
  absorbs?: boolean;
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
  /** Z Tourelle and Assimilateur: weapons (keys of WEAPONS) that can be bought for it, once (Z.doc: « arme adaptable »). */
  weapons?: string[];
  /** Z: the level its weapon fights at. */
  weaponLevel?: number;
  /** Z Pod: add-ons it raises beside it, one at a time (Plate-forme, Tourelle). */
  addons?: string[];
  /** Z: a Pod add-on, raised by a Pod, never by a drone. */
  addon?: boolean;
  /** Buildings this one can turn into, in place, through its production queue (paying the new one's cost). */
  morphs?: string[];
  /** One per player at most (Grand Conseil). */
  unique?: boolean;
  /** Needs `count` of these units or buildings standing, any of them (Yggdrasill protecteur: two first-rank gods). */
  requiresAny?: { of: string[]; count: number };
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
  /** Minerals taken too (Z Centre K kits). */
  minerals?: number;
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
  /** Dieux: an ultimate spell, cast free once the Temple primordial has charged it for this mythology. */
  ultimate?: Mythology;
  /** Dieux: values at the caster god's levels 1 to 5, in place of the plain ones (the spells grow with the god). */
  levels?: Partial<Record<'damage' | 'radius' | 'duration' | 'cooldown' | 'max', number[]>>;
}

/** Dieux: the three mythologies, each three gods (notice 1.2-1); all three standing charge its ultimate spell. */
/** The Artefacterie's improvements, bought at a god (4 at most per god). */
export const ARTEFACTS = ['artforce', 'artresistance', 'artagilite', 'artvitesse'];

export type Mythology = 'scandinave' | 'grec' | 'egyptien';
export const MYTHS: Record<Mythology, { gods: string[]; spell: string; name: string }> = {
  scandinave: { gods: ['thor', 'odin', 'frigg'], spell: 'jormungand', name: 'scandinave' },
  grec: { gods: ['apollon', 'athena', 'hades'], spell: 'tempetezeus', name: 'grec' },
  egyptien: { gods: ['seth', 'isis', 'osiris'], spell: 'amonra', name: 'égyptien' },
};

/** An ability as cast by a caster of that level (a god's spells grow with it); the same object for the same level. */
const SPELLS = new Map<string, AbilityDef>();
export function spell(name: string, lvl: number): AbilityDef {
  const ab = ABILITIES[name];
  if (!ab?.levels || lvl <= 1) return ab;
  const key = `${name}:${lvl}`;
  let out = SPELLS.get(key);
  if (!out) {
    out = { ...ab };
    for (const [k, v] of Object.entries(ab.levels)) out[k as 'damage'] = v[lvl - 1];
    SPELLS.set(key, out);
  }
  return out;
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
  /** Z Espion (Z.doc): a beacon that gives sight of a zone for 50 s; units of a small zone held 5 s; invisible 20 s. */
  balisez: { name: 'Balise de révélation', hotkey: 'B', ...(BALANCE.abilities.balisez as object) } as AbilityDef,
  impulsion: { name: 'Impulsion magnétique', hotkey: 'I', research: 'impulsion', ...(BALANCE.abilities.impulsion as object) } as AbilityDef,
  invistemp: { name: 'Invisibilité temporaire', hotkey: 'N', research: 'invistemp', ...(BALANCE.abilities.invistemp as object) } as AbilityDef,
  /** Z Accumulateur (Z.doc): an enemy building frozen 20 s (no attack, no production, unhurt); a beacon that deafens
   * living units; allies round the caster unhurt. Energy costs (55, 130, 170) become cooldowns. */
  gel: { name: 'Gel électronique', hotkey: 'G', ...(BALANCE.abilities.gel as object) } as AbilityDef,
  vacarme: { name: 'Balise de vacarme', hotkey: 'V', ...(BALANCE.abilities.vacarme as object) } as AbilityDef,
  cone: { name: 'Cône de protection', hotkey: 'O', ...(BALANCE.abilities.cone as object) } as AbilityDef,
  /** Z Centre K (Z.doc): support kits fitted on an own socle anywhere on the map, on top of its weapon. */
  kitdetection: { name: 'Détection', hotkey: 'D', ...(BALANCE.abilities.kitdetection as object) } as AbilityDef,
  kitinvisibilite: { name: 'Invisibilité', hotkey: 'I', ...(BALANCE.abilities.kitinvisibilite as object) } as AbilityDef,
  kitreparateur: { name: 'Auto-réparateur', hotkey: 'A', ...(BALANCE.abilities.kitreparateur as object) } as AbilityDef,
  kitbalise: { name: 'Balise offensive', hotkey: 'B', ...(BALANCE.abilities.kitbalise as object) } as AbilityDef,
  /** Z Centre K (Z.doc): takes control of an enemy machine for 50 s, until it dies or the Centre K falls. */
  canoniem: { name: 'Canon IEM', hotkey: 'C', research: 'canoniem', ...(BALANCE.abilities.canoniem as object) } as AbilityDef,
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
  /** Gaïa (notice): appears by the friendly building nearest the point. */
  teleportgaia: { name: 'Téléportation de Gaïa', hotkey: 'T', target: 'point', ...BALANCE.abilities.teleportgaia },
  /** Gaïa (notice): a magic arrow on the enemy nearest the point. */
  flechegaia: { name: 'Flèche de Gaïa', hotkey: 'F', target: 'point', ...BALANCE.abilities.flechegaia },
  /** Thor (notice, « Courroux du marteau »): his next blow hits several times as hard. */
  courroux: { name: 'Courroux du marteau', hotkey: 'C', target: 'self', ...BALANCE.abilities.courroux },
  /** Odin (notice, « Foudre puissante »): a bolt on the enemy nearest the point, which it stuns. */
  foudre: { name: 'Foudre puissante', hotkey: 'F', target: 'point', ...BALANCE.abilities.foudre },
  /** Athéna (notice): she and the troops round her hit much harder for a while. */
  cridegueurre: { name: 'Cri de guerre', hotkey: 'C', target: 'self', ...BALANCE.abilities.cridegueurre },
  /** Isis (notice): heals every wounded living ally round her. */
  soinsdivins: { name: 'Soins divins', hotkey: 'S', target: 'self', ...BALANCE.abilities.soinsdivins },
  /** Isis (notice): raises allies fallen lately round her (`max` of them). */
  resurrection: { name: 'Résurrection', hotkey: 'R', target: 'self', ...BALANCE.abilities.resurrection },
  /** Frigg (notice): takes control of the enemy nearest the point for a while. */
  soumission: { name: 'Soumission divine', hotkey: 'S', target: 'point', ...BALANCE.abilities.soumission },
  /** Frigg (notice): she and the troops round her vanish from sight, long. */
  voile: { name: 'Voile de nuage', hotkey: 'V', target: 'self', ...BALANCE.abilities.voile },
  /** Hadès (notice): a ray that splits to strike every enemy unit he sees. */
  rayonmort: { name: 'Rayon de mort', hotkey: 'R', target: 'self', ...BALANCE.abilities.rayonmort },
  /** Hadès (notice): travels under ground to the point. */
  voyage: { name: 'Voyage souterrain', hotkey: 'V', target: 'point', ...BALANCE.abilities.voyage },
  /** Hadès (notice): ghosts that cannot be hurt rise round him, for a while. */
  armeeenfers: { name: 'Armée des enfers', hotkey: 'E', target: 'self', ...BALANCE.abilities.armeeenfers },
  /** Osiris (notice): a swarm round him that hurts the enemies and gives him their life. */
  nuee: { name: 'Nuée nauséabonde', hotkey: 'N', target: 'self', ...BALANCE.abilities.nuee },
  /** Yggdrasill (notice, Déracinement): uproots to walk, and takes root again at the point. */
  deraciner: { name: 'Déraciner', hotkey: 'E', target: 'self', research: 'deracinement', ...BALANCE.abilities.deraciner },
  enraciner: { name: 'Enraciner', hotkey: 'E', target: 'point', ...BALANCE.abilities.enraciner },
  /** Minotaure (notice): an enraged trance, its blows much harder for a while. */
  transe: { name: 'Transe enragée', hotkey: 'T', target: 'self', ...BALANCE.abilities.transe },
  /** Sphinx (notice, Peau de roc): turned to stone, slower and slower to shoot, but heavily armoured, mending. */
  statue: { name: 'Forme de statue', hotkey: 'R', target: 'self', research: 'peauroc', ...BALANCE.abilities.statue },
  /** Athéna (notice): her owl flies over a zone and shows it a while. */
  chouette: { name: 'Chouette', hotkey: 'O', target: 'point', ...BALANCE.abilities.chouette },
  /** Prêtresse (notice): on an ally, ends what harms it; on an enemy, what helps it, and hurts summoned ones badly. */
  dissipation: { name: 'Dissipation', hotkey: 'D', target: 'point', ...BALANCE.abilities.dissipation },
  /** Élémentaire (notice): Mutation to another form, and Fusion of two into a Golem. */
  formefeu: { name: 'Forme de feu', hotkey: 'J', target: 'self', ...BALANCE.abilities.mutation },
  formeeau: { name: 'Forme d’eau', hotkey: 'Y', target: 'self', ...BALANCE.abilities.mutation },
  formeterre: { name: 'Forme de terre', hotkey: 'K', target: 'self', ...BALANCE.abilities.mutation },
  formeair: { name: 'Forme d’air', hotkey: 'Q', target: 'self', ...BALANCE.abilities.mutation },
  fusion: { name: 'Fusion en Golem', hotkey: 'U', target: 'self', ...BALANCE.abilities.fusion },
  // Ultimate spells (notice): charged at the Temple primordial while the mythology's three gods stand, cast by any of them.
  /** Scandinave: an avatar of the serpent Jörmungandr fights by the god a while, and feeds on the dead. */
  jormungand: { name: 'Appel de Jörmungand', hotkey: 'U', target: 'point', ultimate: 'scandinave', ...BALANCE.abilities.jormungand },
  /** Grec: lightning over a wide zone, allies too; the mightier a unit, the more it suffers. */
  tempetezeus: { name: 'Tempête de Zeus', hotkey: 'U', target: 'point', ultimate: 'grec', ...BALANCE.abilities.tempetezeus },
  /** Égyptien: the enemies of the zone blinded and held long (machines more briefly). */
  amonra: { name: "Flamboiement d'Amon-Râ", hotkey: 'U', target: 'point', ultimate: 'egyptien', ...BALANCE.abilities.amonra },
  /** Apollon (notice, « Pluie de feu »): burning meteors on every enemy in a zone. */
  pluiedefeu: { name: 'Pluie de feu', hotkey: 'F', target: 'point', ...BALANCE.abilities.pluiedefeu },
  /** Seth (notice, « Tempête de sable »): enemy ranged units inside the zone cannot shoot for a while. */
  tempete: { name: 'Tempête de sable', hotkey: 'T', target: 'point', ...BALANCE.abilities.tempete },
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

  // ---------------------------------------------------------------- Z (Z.doc, 2010): a nest of metal insects
  // Drones merge into the buildings they raise. The Intelligence centrale (and Suprême) and the Pod supérieur spread a
  // creep of cables (the Isdaris power field, drawn as cables) that only repairs what stands on it. The Plate-forme and
  // the Tourelle are Pod add-ons, raised by a Pod beside it, one per Pod. Socles are unlocked at the Centre de socles and
  // leave the Plate-forme with the weapon chosen when they were queued, for good.
  drone: { kind: 'unit', name: 'Drone', radius: 0.375, worker: true, mechanical: true, faction: 'z', hotkey: 'D' },
  dronecombat: { kind: 'unit', name: 'Drone de combat', radius: 0.375, mechanical: true, faction: 'z', hotkey: 'C' },
  quadripode: { kind: 'unit', name: 'Quadripode', radius: 0.45, mechanical: true, requires: { rquadripode: 1 }, weapons: SOCLE_WEAPONS, faction: 'z', hotkey: 'Q' },
  hexapode: { kind: 'unit', name: 'Hexapode', radius: 0.6, mechanical: true, requires: { rhexapode: 1 }, weapons: SOCLE_WEAPONS, faction: 'z', hotkey: 'H' },
  coleoptere: { kind: 'unit', name: 'Coléoptère', radius: 0.5, flying: true, mechanical: true, requires: { rcoleoptere: 1 }, weapons: SOCLE_WEAPONS.filter((k) => k !== 'canonx04'), faction: 'z', hotkey: 'L' },
  // Z.doc: a levitating spy and support probe, which detects; its abilities wait on its energy (here, cooldowns).
  zespion: { kind: 'unit', name: 'Espion', radius: 0.4, flying: true, mechanical: true, requires: { pod: 1 }, abilities: ['balisez', 'impulsion', 'invistemp'], faction: 'z', hotkey: 'E' },
  intelligence: { kind: 'building', name: 'Intelligence centrale', size: 5, trains: ['drone', 'zespion'], dropoff: true, absorbs: true, morphs: ['supreme'], faction: 'z', hotkey: 'I' },
  // Z.doc: drones and spies in 75 % of their time (Production accélérée).
  supreme: { kind: 'building', name: 'Intelligence suprême', size: 5, trains: ['drone', 'zespion'], dropoff: true, absorbs: true, morphOnly: true, requires: { armement: 1, centrerecherche: 1 }, faction: 'z', hotkey: 'S' },
  pod: { kind: 'building', name: 'Pod', size: 2, absorbs: true, addons: ['plateforme', 'tourelle'], morphs: ['podsup'], faction: 'z', hotkey: 'P' },
  podsup: { kind: 'building', name: 'Pod supérieur', size: 2, absorbs: true, addons: ['plateforme', 'tourelle'], morphOnly: true, requires: { podsuperieur: 1 }, faction: 'z', hotkey: 'U' },
  // Z.doc: « arme adaptable », like the Tourelle: a weapon bought for it, at level 2 (the Tourelle's machine gun free).
  assimilateur: { kind: 'building', name: 'Assimilateur', size: 3, absorbs: true, weapons: TOWER_WEAPONS, faction: 'z', hotkey: 'A' },
  plateforme: { kind: 'building', name: 'Plate-forme', size: 3, absorbs: true, addon: true, trains: ['dronecombat', 'quadripode', 'hexapode', 'coleoptere'], faction: 'z', hotkey: 'F' },
  tourelle: { kind: 'building', name: 'Tourelle', size: 2, absorbs: true, addon: true, weapons: TOWER_WEAPONS, faction: 'z', hotkey: 'T' },
  centresocles: {
    kind: 'building', name: 'Centre de socles', size: 3, absorbs: true, requires: { pod: 1 }, faction: 'z', hotkey: 'S',
    researches: ['rquadripode', 'rquadripode2', 'rquadripode3', 'rhexapode', 'rhexapode2', 'rcoleoptere', 'rcoleoptere2', 'rcoleoptere3'],
  },
  armement: {
    kind: 'building', name: "Centre d'armement", size: 3, absorbs: true, requires: { pod: 1 }, faction: 'z', hotkey: 'R',
    researches: ['laser', 'lanceflammes', 'lanceroquettes', 'rdechiqueteur', 'rjetsonique', 'rarc', 'rreparateur', 'raccumulateur', 'rcanonx04'],
  },
  centrerecherche: {
    kind: 'building', name: 'Centre de recherche', size: 3, absorbs: true, requires: { pod: 1 }, faction: 'z', hotkey: 'C',
    researches: ['zproxi1', 'zproxi2', 'zproxi3', 'zdist1', 'zdist2', 'zdist3', 'zblindage1', 'zblindage2', 'zblindage3', 'titane', 'deploiement', 'sonderobuste', 'podsuperieur', 'impulsion', 'invistemp', 'megaespion'],
  },
  optimisation: { kind: 'building', name: "Centre d'optimisation", size: 3, absorbs: true, requires: { supreme: 1 }, researches: ['optimisationp'], faction: 'z', hotkey: 'O' },
  // Z.doc: sells support kits anywhere on the battlefield and fires the Canon IEM; one per player.
  centrek: {
    kind: 'building', name: 'Centre K', size: 3, absorbs: true, unique: true, requires: { optimisation: 1 }, faction: 'z', hotkey: 'K',
    abilities: ['kitdetection', 'kitinvisibilite', 'kitreparateur', 'kitbalise', 'canoniem'], researches: ['canoniem'],
  },
  canoniem: research('Canon IEM', 'C', "Le Centre K prend le contrôle d'une machine ennemie pendant 50 s.", undefined, 'z'),
  rquadripode: research('Quadripode', 'Q', 'Débloque le socle Quadripode.', undefined, 'z'),
  rhexapode: research('Hexapode', 'H', 'Débloque le socle Hexapode.', { centrerecherche: 1 }, 'z'),
  rcoleoptere: research('Coléoptère', 'L', 'Débloque le socle Coléoptère.', { supreme: 1 }, 'z'),
  rquadripode2: tier('rquadripode', 'Quadripode', 2, 'Q'),
  rquadripode3: tier('rquadripode', 'Quadripode', 3, 'Q'),
  rhexapode2: tier('rhexapode', 'Hexapode', 2, 'H'),
  rcoleoptere2: tier('rcoleoptere', 'Coléoptère', 2, 'L'),
  rcoleoptere3: tier('rcoleoptere', 'Coléoptère', 3, 'L'),
  optimisationp: research('Optimisation perfectionnée', 'P', 'Les socles évoluent 50 % plus vite.', undefined, 'z'),
  ...upgrades('zproxi', 'Attaque de proximité', 'P', undefined, 'z'),
  ...upgrades('zdist', 'Attaque à distance', 'D', undefined, 'z'),
  ...upgrades('zblindage', 'Blindage des socles', 'B', undefined, 'z'),
  titane: research('Blindage de titane', 'T', 'Blindage des bâtiments +2.', undefined, 'z'),
  deploiement: research('Déploiement rapide', 'R', 'Les bâtiments se construisent 20 % plus vite.', undefined, 'z'),
  sonderobuste: research('Sonde robuste', 'S', 'Points de vie des drones +25.', { supreme: 1 }, 'z'),
  impulsion: research('Impulsion magnétique', 'I', "L'Espion immobilise les unités d'une petite zone 5 s.", undefined, 'z'),
  invistemp: research('Invisibilité temporaire', 'N', "L'Espion devient invisible 20 s.", { supreme: 1 }, 'z'),
  megaespion: research('Mega-Espion', 'M', "L'Espion gagne 60 PV, 1 de vision et de la vitesse.", undefined, 'z'),
  podsuperieur: research('Pod supérieur', 'U', 'Les Pods peuvent évoluer en Pods supérieurs.', undefined, 'z'),
  laser: research('Laser', 'L', 'Arme laser pour les socles, choisie à leur construction.', undefined, 'z'),
  lanceflammes: research('Lance-flammes', 'F', 'Lance-flammes pour les socles, choisi à leur construction.', undefined, 'z'),
  rdechiqueteur: research('Déchiqueteur', 'D', 'Lame de corps à corps pour les socles (contre les volants sur un socle volant).', undefined, 'z'),
  rjetsonique: research('Jet sonique', 'J', 'Onde qui frappe tout sur sa ligne, alliés compris.', { supreme: 1 }, 'z'),
  rarc: research('Arc électrique', 'A', 'Frappe trois cibles à la fois devant le socle.', { supreme: 1 }, 'z'),
  rreparateur: research('Réparateur', 'P', 'Nanites qui réparent les machines alliées proches.', { supreme: 1 }, 'z'),
  raccumulateur: research('Accumulateur', 'C', 'Gel électronique, Balise de vacarme, Cône de protection.', { supreme: 1, optimisation: 1 }, 'z'),
  rcanonx04: research('Canon X-04', 'X', 'Artillerie de zone à longue portée pour les socles terrestres.', { supreme: 1, optimisation: 1 }, 'z'),
  // Z Accumulateur: the Balise de vacarme, a small invulnerable-free beacon that deafens living units around it.
  vacarme: { kind: 'building', name: 'Balise de vacarme', size: 1, faction: 'z', hotkey: 'V', morphOnly: true },
  lanceroquettes: research('Lance-roquettes', 'R', 'Lance-roquettes pour les socles, contre les machines et les bâtiments.', undefined, 'z'),

  // ---------------------------------------------------------------- Dieux (notice 1.2-1): gods that summon their armies
  // The gods stand in for production buildings: building-sized, unique, summoned at the Porte d'Asgaard, each summons
  // its own troops at its feet. Gaïa (given at the start, back by herself when she falls) calls the buildings down:
  // they materialise by themselves. Esprits harvest. V1: the first rank of gods (docs/camp-dieux.md).
  esprit: { kind: 'unit', name: 'Esprit', radius: 0.35, worker: true, builder: false, faction: 'dieux', hotkey: 'E' },
  gaia: { kind: 'unit', name: 'Gaïa', radius: 2.0, builder: true, trains: ['esprit'], unique: true, abilities: ['teleportgaia', 'flechegaia'], faction: 'dieux', hotkey: 'G' },
  thor: { kind: 'unit', name: 'Thor', radius: 1.7, trains: ['nain'], unique: true, abilities: ['jormungand'], ability: 'courroux', faction: 'dieux', hotkey: 'T' },
  apollon: { kind: 'unit', name: 'Apollon', radius: 1.4, trains: ['minotaure'], unique: true, abilities: ['tempetezeus'], ability: 'pluiedefeu', faction: 'dieux', hotkey: 'A' },
  seth: { kind: 'unit', name: 'Seth', radius: 1.7, trains: ['sphinx'], unique: true, abilities: ['amonra'], ability: 'tempete', faction: 'dieux', hotkey: 'S' },
  // Second rank (notice): two first-rank gods standing open it. Odin's war aura and Athéna's protection aura are
  // passive (rules.auraguerre, rules.auraprotection).
  odin: { kind: 'unit', name: 'Odin', radius: 1.7, trains: ['nain', 'corbeau', 'drake'], unique: true, abilities: ['jormungand'], ability: 'foudre', requiresAny: { of: ['thor', 'apollon', 'seth'], count: 2 }, faction: 'dieux', hotkey: 'O' },
  athena: { kind: 'unit', name: 'Athéna', radius: 1.5, trains: ['minotaure', 'elementaire'], unique: true, abilities: ['chouette', 'tempetezeus'], ability: 'cridegueurre', requiresAny: { of: ['thor', 'apollon', 'seth'], count: 2 }, faction: 'dieux', hotkey: 'H' },
  isis: { kind: 'unit', name: 'Isis', radius: 1.5, trains: ['sphinx', 'pretresse'], unique: true, abilities: ['soinsdivins', 'resurrection', 'amonra'], requiresAny: { of: ['thor', 'apollon', 'seth'], count: 2 }, faction: 'dieux', hotkey: 'I' },
  /** Odin's ravens: fast flying scouts, invisible, that see the invisible. */
  corbeau: { kind: 'unit', name: 'Corbeau', radius: 0.35, flying: true, beast: true, cloaked: true, faction: 'dieux', hotkey: 'C' },
  /** A slow flying beast, very hardy, breathing fire on an area. */
  drake: { kind: 'unit', name: 'Drake', radius: 0.9, flying: true, beast: true, faction: 'dieux', hotkey: 'D' },
  /** A small shapeshifter (notice): fire form, which also shoots flyers; it changes form at will (Mutation), and two
   * merge into a Golem. */
  elementaire: { kind: 'unit', name: 'Élémentaire de feu', radius: 0.45, abilities: ['formeeau', 'formeterre', 'formeair', 'fusion'], faction: 'dieux', hotkey: 'E' },
  /** Water form: an icy shot from afar. */
  elemeau: { kind: 'unit', name: 'Élémentaire d’eau', radius: 0.45, abilities: ['formefeu', 'formeterre', 'formeair', 'fusion'], faction: 'dieux', hotkey: 'E' },
  /** Earth form: very slow, very hardy, blades against infantry. */
  elemterre: { kind: 'unit', name: 'Élémentaire de terre', radius: 0.5, abilities: ['formefeu', 'formeeau', 'formeair', 'fusion'], faction: 'dieux', hotkey: 'E' },
  /** Air form: flies, very fast, strikes flyers only. */
  elemair: { kind: 'unit', name: 'Élémentaire d’air', radius: 0.45, flying: true, abilities: ['formefeu', 'formeeau', 'formeterre', 'fusion'], faction: 'dieux', hotkey: 'E' },
  /** Two Élémentaires merged: siege artillery of solid ether, enormous range, poor against what moves. */
  golem: { kind: 'unit', name: 'Golem', radius: 0.9, faction: 'dieux', hotkey: 'G' },
  // Third rank (notice): two second-rank gods standing open it. Osiris's putrid aura is passive (rules.putride).
  /** Frigg ignores the ground (cliffs, water): she flies. */
  frigg: { kind: 'unit', name: 'Frigg', radius: 1.4, flying: true, trains: ['nain', 'walkyrie'], unique: true, abilities: ['soumission', 'voile', 'jormungand'], requiresAny: { of: ['odin', 'athena', 'isis'], count: 2 }, faction: 'dieux', hotkey: 'F' },
  hades: { kind: 'unit', name: 'Hadès', radius: 1.6, trains: ['minotaure', 'titan'], unique: true, abilities: ['rayonmort', 'voyage', 'armeeenfers', 'tempetezeus'], requiresAny: { of: ['odin', 'athena', 'isis'], count: 2 }, faction: 'dieux', hotkey: 'D' },
  osiris: { kind: 'unit', name: 'Osiris', radius: 1.7, trains: ['sphinx', 'immortel'], unique: true, abilities: ['amonra'], ability: 'nuee', requiresAny: { of: ['odin', 'athena', 'isis'], count: 2 }, faction: 'dieux', hotkey: 'R' },
  /** Frigg's flying warrior: a double sword thrown from the air; vanishes a while. */
  walkyrie: { kind: 'unit', name: 'Walkyrie', radius: 0.45, flying: true, ability: 'camouflage', faction: 'dieux', hotkey: 'W' },
  /** Hadès's demigod: lightning from afar, razes buildings. */
  titan: { kind: 'unit', name: 'Titan', radius: 0.9, faction: 'dieux', hotkey: 'T' },
  /** Osiris's giant mummy: a melee beyond match, very slow, a toxic cloud round it (rules.putride, level 1). */
  immortel: { kind: 'unit', name: 'Immortel', radius: 0.8, faction: 'dieux', hotkey: 'I' },
  /** Hadès's Armée des enfers: ghosts that cannot be hurt, for a while. */
  fantome: { kind: 'unit', name: 'Fantôme', radius: 0.4, lifetime: 20, faction: 'dieux', hotkey: 'F' },
  /** Isis's priestess: heals, no attack; Dissipation. */
  pretresse: { kind: 'unit', name: 'Prêtresse', radius: 0.35, ability: 'dissipation', faction: 'dieux', hotkey: 'P' },
  nain: { kind: 'unit', name: 'Nain', radius: 0.4, faction: 'dieux', hotkey: 'N' },
  minotaure: { kind: 'unit', name: 'Minotaure', radius: 0.6, ability: 'transe', faction: 'dieux', hotkey: 'M' },
  // A statue set going by magic: a machine for the bonuses against machines.
  sphinx: { kind: 'unit', name: 'Sphinx', radius: 0.6, mechanical: true, ability: 'statue', faction: 'dieux', hotkey: 'X' },
  asgaard: { kind: 'building', name: "Porte d'Asgaard", size: 5, trains: ['thor', 'apollon', 'seth', 'odin', 'athena', 'isis', 'frigg', 'hades', 'osiris'], dropoff: true, warp: true, faction: 'dieux', hotkey: 'A' },
  // Notice: supply, and a melee blow at enemies that come too close; turns into a magic arrow tower.
  branche: { kind: 'building', name: "Branche d'Yggdrasill", size: 2, warp: true, morphs: ['protecteur'], ability: 'deraciner', faction: 'dieux', hotkey: 'B' },
  protecteur: { kind: 'building', name: 'Yggdrasill protecteur', size: 2, warp: true, morphOnly: true, morphs: ['furieux'], ability: 'deraciner', requiresAny: { of: ['thor', 'apollon', 'seth'], count: 2 }, faction: 'dieux', hotkey: 'P' },
  /** Hadès on the field: the Yggdrasill draws on the world tree, destruction and range « à peine concevables ». */
  furieux: { kind: 'building', name: 'Yggdrasill furieux', size: 2, warp: true, morphOnly: true, ability: 'deraciner', requiresAny: { of: ['hades'], count: 1 }, faction: 'dieux', hotkey: 'F' },
  /** Déracinement (notice): an Yggdrasill walking, any form; it cannot fight until it takes root again. */
  branchemob: { kind: 'unit', name: "Branche d'Yggdrasill (déracinée)", radius: 0.9, ability: 'enraciner', faction: 'dieux', hotkey: 'B' },
  protecteurmob: { kind: 'unit', name: 'Yggdrasill protecteur (déraciné)', radius: 0.9, ability: 'enraciner', faction: 'dieux', hotkey: 'P' },
  furieuxmob: { kind: 'unit', name: 'Yggdrasill furieux (déraciné)', radius: 0.9, ability: 'enraciner', faction: 'dieux', hotkey: 'F' },
  /** Osiris's Fontaine d'eau du Nil: the living allies round it heal fast (rules.fontaine). */
  fontaine: { kind: 'building', name: 'Fontaine du Nil', size: 2, warp: true, requires: { osiris: 1 }, faction: 'dieux', hotkey: 'F' },
  /** Gaïa's Temple primordial (unique): charges the ultimate spells (MYTHS). */
  primordial: { kind: 'building', name: 'Temple primordial', size: 4, warp: true, unique: true, faction: 'dieux', hotkey: 'P' },
  /** Avatar of Jörmungand (ultimate): a giant serpent for a while; eats the dead to heal. */
  jormungandr: { kind: 'unit', name: 'Avatar de Jörmungand', radius: 1.2, lifetime: 60, faction: 'dieux', hotkey: 'J' },
  /** Frigg's Artefacterie (unique): the gods buy improvements wherever they are (ARTEFACTS). */
  artefacterie: { kind: 'building', name: 'Artefacterie', size: 3, warp: true, unique: true, requires: { frigg: 1 }, faction: 'dieux', hotkey: 'R' },
  antre: { kind: 'building', name: 'Antre', size: 3, dropoff: true, warp: true, faction: 'dieux', hotkey: 'N' },
  puitsdivin: { kind: 'building', name: 'Puits', size: 3, warp: true, faction: 'dieux', hotkey: 'P' },
  temple: {
    kind: 'building', name: 'Temple de vénération', size: 3, warp: true, requires: { thor: 1 }, faction: 'dieux', hotkey: 'V',
    researches: ['dmelee1', 'dmelee2', 'dmelee3', 'dranged1', 'dranged2', 'dranged3', 'darmor1', 'darmor2', 'darmor3', 'celerite', 'offrandes', 'coupuissant', 'peauroc', 'prescience', 'drakegeant', 'armurezodiacale', 'deracinement'],
  },
  ...upgrades('melee', 'Attaque corps à corps', 'C', undefined, 'dieux', 3, 'dmelee'),
  ...upgrades('ranged', 'Attaque à distance', 'D', undefined, 'dieux', 3, 'dranged'),
  ...upgrades('armor', 'Amélioration armure', 'A', undefined, 'dieux', 3, 'darmor'),
  celerite: research('Célérité naine', 'N', 'Les Nains bondissent sur un ennemi proche.', undefined, 'dieux'),
  // The rest of the Temple de vénération's research (notice); XC.doc: the god of the mythology needed.
  coupuissant: { ...research('Coup puissant', 'U', 'Minotaures : un coup sur quatre fait double dégâts.', undefined, 'dieux'), requiresAny: { of: ['apollon', 'athena', 'hades'], count: 1 } },
  peauroc: { ...research('Peau de roc', 'R', 'Sphinx : Forme de statue, lent et tirant moins vite, mais très blindé et qui se répare.', undefined, 'dieux'), requiresAny: { of: ['seth', 'isis', 'osiris'], count: 1 } },
  prescience: research("Prescience d'Yggdrasill", 'Y', 'Les Yggdrasill détectent les unités camouflées.', undefined, 'dieux'),
  drakegeant: research('Drake géant', 'G', 'Drakes : plus de vie, et ils transportent des unités dans leur gueule.', { odin: 1 }, 'dieux'),
  deracinement: research('Déracinement', 'E', 'Les Yggdrasill peuvent se déraciner et marcher ; ils ne combattent qu’une fois enracinés.', undefined, 'dieux'),
  armurezodiacale: research('Armure zodiacale', 'Z', 'Titans : plus de vie et de blindage.', { hades: 1 }, 'dieux'),
  offrandes: research('Offrandes', 'O', 'Les dieux cessent de compter dans la population.', undefined, 'dieux'),
  // Artefacterie (notice, Frigg): a god buys up to 4 improvements, where it stands, the same one several times if it likes.
  artforce: research('Force', 'Y', 'Le dieu frappe plus fort.', { artefacterie: 1 }, 'dieux'),
  artresistance: research('Résistance', 'J', 'Le dieu gagne de l’armure.', { artefacterie: 1 }, 'dieux'),
  artagilite: research('Agilité', 'K', 'Le dieu frappe plus vite.', { artefacterie: 1 }, 'dieux'),
  artvitesse: research('Vitesse', 'Q', 'Le dieu se déplace plus vite.', { artefacterie: 1 }, 'dieux'),
  // A god's next level, queued at the god itself; its price and time are the god's own (UnitDef.levels).
  niveau: research('Niveau divin', 'L', 'Le dieu monte d’un niveau : vie, armure, dégâts et vitesse ; il invoque et bâtit plus vite.', undefined, 'dieux'),

  minerai: { kind: 'resource', name: 'Champ de minerai', size: 1 },
  puits: { kind: 'resource', name: 'Puits énergétique', size: 3, amount: Infinity },
};

/** The three levels of a Forge line (costs and times in balance.json); `base`: buildings the line needs from level 1. */
function upgrades(line: UpgradeLine, name: string, hotkey: string, base?: Record<string, number>, faction: Faction = 'humains', levels = 3, key = line): Record<string, object> {
  const out: Record<string, object> = {};
  const steps = faction === 'humains' ? UPGRADE_REQUIRES : [undefined, undefined, undefined];
  for (let i = 0; i < levels; i++) out[`${key}${i + 1}`] = { kind: 'upgrade', name: `${name} ${i + 1}`, line, level: i + 1, requires: { ...base, ...steps[i] }, faction, hotkey };
  return out;
}

/** A one-off research: a line of its own, with one level. */
function research(name: string, hotkey: string, effect: string, requires?: Record<string, number>, faction: Faction = 'humains'): object {
  return { kind: 'upgrade', name, effect, line: '', level: 1, requires, faction, hotkey };
}

/** A Z socle research's next level (Z.doc): the socle may evolve into this tier in the field. */
function tier(line: string, socle: string, level: number, hotkey: string): object {
  return { kind: 'upgrade', name: `${socle} T${level}`, effect: `Les ${socle}s peuvent évoluer en T${level} sur le terrain.`, line, level, faction: 'z', hotkey };
}

/** An Isdaris extension (notice): built onto a major building, here researched there; unlocks units and research. */
function extension(name: string, hotkey: string, effect: string, requires?: Record<string, number>): object {
  return research(`Extension : ${name}`, hotkey, effect, requires, 'isdaris');
}
/** An Isdaris research (notice). */
function isd(name: string, hotkey: string, effect: string, requires?: Record<string, number>): object {
  return research(name, hotkey, effect, requires, 'isdaris');
}

/** Z support kits (Centre K, Z.doc), as bits of an entity's `support`. */
export const KIT = { detection: 1, invisibilite: 2, reparateur: 4, balise: 8 } as const;

/** A Z socle's next tier: what evolving costs and takes, and its new hit points, armour and speed. */
export interface TierStats {
  cost: Cost;
  buildTime: number;
  hp: number;
  armor: number;
  speed: number;
}

/** Z weapons (Z.doc), chosen for a socle when it is built, in place of its machine gun: stats and cost in balance.json. */
export interface WeaponDef {
  name: string;
  hotkey: string;
  /** At level 1 (the weakest socle): what the AI and the cards go by; none for the Réparateur and the Accumulateur. */
  attack?: Attack;
  /** Z Réparateur: hp a second it gives back to machines, and within what range. */
  heal?: number;
  healRange?: number;
  /** Only ground socles take it (Canon X-04). */
  ground?: boolean;
  cost: Cost;
  /** Research needed first. */
  research?: string;
}
interface WeaponStats {
  /** Z.doc, levels 1 to 4: damage against light biological targets (the game's plain damage), then against machines. */
  levels: [number, number][];
  range?: number;
  /** Range by level, when it grows with it (Lance-roquettes). */
  ranges?: number[];
  cooldown: number;
  air?: boolean;
  /** Déchiqueteur: a melee weapon that hits flyers instead when a flying socle carries it. */
  airIfFlying?: boolean;
  splash?: number;
  line?: boolean;
  targets?: number;
  selfHit?: boolean;
  heal?: number;
  healRange?: number;
  cost: Cost;
}
const WEAPON_STATS = BALANCE.weapons as unknown as Record<string, WeaponStats>;
/**
 * A Z weapon at a level (1 to 4: the socle's, Z.doc). Z.doc's damage, scaled by `rules.z.weaponDamage` % as the
 * socles' was (14 → 12), the gap against machines as `vsMechanical`.
 */
export function weaponAt(key: string, level: number, flying = false): Attack | undefined {
  const w = WEAPON_STATS[key];
  if (!w.levels.length) return undefined;
  const [light, machine] = w.levels[Math.min(w.levels.length, Math.max(1, level)) - 1];
  const scale = (n: number) => Math.round((n * BALANCE.rules.z.weaponDamage) / 100);
  const a: Attack = { damage: scale(light), range: w.ranges ? w.ranges[Math.min(w.ranges.length, Math.max(1, level)) - 1] : w.range!, cooldown: w.cooldown };
  if (scale(machine) !== a.damage) a.vsMechanical = scale(machine) - a.damage;
  if (w.air !== undefined) a.air = w.air;
  if (w.airIfFlying && flying) {
    a.air = true;
    a.ground = false;
  }
  if (w.splash) a.splash = w.splash;
  if (w.line) a.line = true;
  if (w.targets) a.targets = w.targets;
  if (w.selfHit) a.selfHit = true;
  return a;
}
const weaponDef = (key: string, name: string, hotkey: string, research?: string, ground?: boolean): WeaponDef => ({
  name, hotkey, research, ground, attack: weaponAt(key, 1), cost: WEAPON_STATS[key].cost, heal: WEAPON_STATS[key].heal, healRange: WEAPON_STATS[key].healRange,
});
export const WEAPONS: Record<string, WeaponDef> = {
  laser: weaponDef('laser', 'Laser', 'L', 'laser'),
  flammes: weaponDef('flammes', 'Lance-flammes', 'F', 'lanceflammes'),
  roquettes: weaponDef('roquettes', 'Lance-roquettes', 'R', 'lanceroquettes'),
  dechiqueteur: weaponDef('dechiqueteur', 'Déchiqueteur', 'D', 'rdechiqueteur'),
  jetsonique: weaponDef('jetsonique', 'Jet sonique', 'J', 'rjetsonique'),
  arc: weaponDef('arc', 'Arc électrique', 'A', 'rarc'),
  canonx04: weaponDef('canonx04', 'Canon X-04', 'X', 'rcanonx04', true),
  reparateur: weaponDef('reparateur', 'Réparateur', 'P', 'rreparateur'),
  accumulateur: weaponDef('accumulateur', 'Accumulateur', 'C', 'raccumulateur'),
};
/** Z weapons that bring abilities rather than an attack (Accumulateur, Z.doc). */
export const WEAPON_ABILITIES: Record<string, string[]> = { accumulateur: ['gel', 'vacarme', 'cone'] };

const STATS: Record<string, object> = BALANCE.units;
export const DEFS = Object.fromEntries(
  Object.entries(BASE).map(([type, d]) => [type, { ...d, ...STATS[type], ...((d as { line?: string }).line === '' ? { line: type } : {}) }]),
) as Record<string, Def>;

/** What a unit costs with its weapon (Z socles), or alone. */
export function withKit(def: { cost: Cost }, weapon?: string): Cost {
  const kit = weapon ? WEAPONS[weapon]?.cost : undefined;
  return kit ? { minerals: def.cost.minerals + kit.minerals, energy: def.cost.energy + kit.energy } : def.cost;
}

/** Types drawn with another's model and icon until they get their own (render only). */
export const LOOKS: Record<string, string> = { fantome: 'esprit', furieux: 'protecteur', branchemob: 'branche', protecteurmob: 'protecteur', furieuxmob: 'protecteur', casernevolante: 'caserne', casernevol: 'caserne', grandconseil: 'conseil', grandealchimisterie: 'alchimisterie', cadavre: 'serf', supreme: 'intelligence', podsup: 'pod', vacarme: 'tourelle' };
/** Size of those stand-in models against the original's. */
export const LOOK_SCALE: Record<string, number> = { grandconseil: 1.1, furieux: 1.2, supreme: 1.1, podsup: 1.15, vacarme: 0.5 };

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
  /** Dieux: the unit that places buildings (else the workers), the one that summons the workers (else the hq),
   * units given at the start besides the workers, and the cheap drop-off the AI expands with (else the hq). */
  builder?: string;
  workerFrom?: string;
  start?: string[];
  outpost?: string;
  /** Dieux: the gods, summoned at the hq; they produce the army. */
  gods?: string[];
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
  z: {
    name: 'Z', worker: 'drone', hq: 'intelligence', supply: 'pod', barracks: 'plateforme', extractor: 'assimilateur',
    forge: 'centrerecherche', defense: 'tourelle',
    buildable: ['intelligence', 'pod', 'assimilateur', 'centresocles', 'armement', 'centrerecherche', 'optimisation', 'centrek'],
    advanced: ['centresocles', 'armement', 'centrerecherche', 'optimisation', 'centrek'],
    army: Object.entries(BALANCE.ai.army.z),
  },
  dieux: {
    name: 'Dieux', worker: 'esprit', hq: 'asgaard', supply: 'branche', barracks: 'asgaard', extractor: 'puitsdivin',
    forge: 'temple', defense: 'branche', builder: 'gaia', workerFrom: 'gaia', start: ['gaia'], outpost: 'antre', gods: ['thor', 'apollon', 'seth', 'odin', 'athena', 'isis', 'frigg', 'hades', 'osiris'],
    buildable: ['asgaard', 'branche', 'antre', 'puitsdivin', 'temple', 'fontaine', 'primordial', 'artefacterie'],
    advanced: ['temple', 'fontaine', 'primordial', 'artefacterie'],
    army: Object.entries(BALANCE.ai.army.dieux),
  },
};
