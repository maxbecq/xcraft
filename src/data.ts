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
const SOCLE_WEAPONS = ['laser', 'flammes', 'roquettes', 'dechiqueteur', 'jetsonique', 'laserlourd', 'arc', 'canonx04', 'reparateur', 'accumulateur'];
// Flying socles: no Canon X-04, nor the Lance-flammes (notice: « uniquement terrestre »).
const FLYER_WEAPONS = SOCLE_WEAPONS.filter((k) => k !== 'canonx04' && k !== 'flammes');
const TOWER_WEAPONS = ['laser', 'flammes', 'roquettes', 'dechiqueteur', 'jetsonique', 'laserlourd', 'arc', 'canonx04'];
/** The Tourelle takes the Réparateur too (équilibreur 22/11), the Assimilateur not. */
const TURRET_WEAPONS = [...TOWER_WEAPONS, 'reparateur'];

/** The six target classes of the 2010 sheets: light and armoured biological, mechanical, massive mechanical, structure, heroic. */
export const CLASSES = ['BL', 'BA', 'M', 'MM', 'S', 'H'] as const;
export type DamageClass = (typeof CLASSES)[number];

export interface Attack {
  /** Against light biological targets (BL): what the cards show and the upgrades go by. */
  damage: number;
  /** Fiches 2010: the damage against each class, in the order of CLASSES; without it, `damage` (and `vsMechanical`). */
  vs?: number[];
  /** Extra range beyond touching, in tiles (melee: ~0.1). */
  range: number;
  cooldown: number;
  /** Damage modifier against mechanical targets (buildings count as mechanical). */
  vsMechanical?: number;
  /** Damage modifier against buildings only (the Golem's blocks: notice, « dégâts aberrants aux bâtiments »). */
  vsStructure?: number;
  /** Hits flying units (default: ranged attacks do, melee ones do not). */
  air?: boolean;
  /** Hits ground units and buildings (default: true). */
  ground?: boolean;
  /** Area weapon: half damage to the enemy ground units within this radius (tiles) of the target. */
  splash?: number;
  /** Z Jet sonique: also hurts every unit, friend or foe, between the shooter and its target. */
  line?: boolean;
  /** Z Lance-flammes (équilibreur 22/11): a jet along the line of its range, burning every enemy on the ground on it,
   * between the shooter and its target and behind it. */
  flame?: boolean;
  /** Z Arc électrique: strikes up to this many enemies at once, in front of the shooter. */
  targets?: number;
  /** Z Canon X-04: fired at a target in contact, the shooter takes the blast too. */
  selfHit?: boolean;
  /** Strikes only targets of these classes (the Golem: structures and heavy machines, équilibreur 2026-11-22). */
  only?: DamageClass[];
}

/** Can this attack reach that target, flying or not? */
export function reaches(a: Attack, flying: boolean): boolean {
  return flying ? (a.air ?? a.range >= 1) : a.ground !== false;
}

/** A caster's own energy (fiches 2010, Z.doc; start from the mod): most, at birth, regained a second. */
export type Mana = readonly [number, number, number];

export interface UnitDef {
  mana?: Mana;
  /** Its class as a target (fiches 2010; provisional for the Dieux). */
  cls?: DamageClass;
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
  /** Soigneur (fiche 2010, Soins): its hp come back `healPulse` at a time (every healPulse / heal s), `healRange` tiles off. */
  healPulse?: number;
  healRange?: number;
  /** Passive effects shown as an icon on its card (ABILITIES entries without a button of their own to press). */
  passives?: string[];
  /** Mana each pulse of healing costs (the Soin of the balance designer, 2026-11-22: 5 for 25 hp). */
  healMana?: number;
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
  /** Hovers: moves over cliffs and water like a flyer, but is hit as a ground unit (Frigg, Élémentaire d'eau). */
  hover?: boolean;
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
  /** Z Barge: supply it carries, by tier. */
  transport?: number[];
  /** Z socle: what it becomes in the field, T2 then T3 (Z.doc), each unlocked by the next level of its research `r<type>`. */
  tiers?: TierStats[];
  weapons?: string[];
  /** Dieux: a god that summons these units at its feet, through its own queue, while it stands still. */
  trains?: string[];
  /** One per player at most, queued ones included (the gods). */
  unique?: boolean;
  /** Places buildings (Gaïa); by default only workers do. */
  builder?: boolean;
  /** Dieux (notice): the only buildings this unit raises, when not all its side's (Thor the Temple, Osiris the Fontaine). */
  builds?: string[];
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
  /** Hp healed each second, a pulse a second (Isis: balance designer 2026-11-22). */
  heal?: number[];
  cost: Cost[];
  time: number[];
}

export interface BuildingDef {
  /** Passive effects shown as an icon on its card (ABILITIES entries without a button of their own to press). */
  passives?: string[];
  mana?: Mana;
  /** Isdaris Obélisque (fiche 2010, mod): the buildings it materialises in its side's transfer zone. */
  builds?: string[];
  cls?: DamageClass;
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
  /** Voyageur, Réserve psy: cast the Recharge des boucliers on their own (fiche 2010, mod), from their own energy. */
  shieldCharge?: boolean;
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
  /** Its morph may be queued behind what it is making (the Alchimisterie, the balancer 2026-11-22). */
  queuesMorph?: boolean;
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
  /**
   * Isdaris extension (notice): the major building type it is built onto. It belongs to that one building (Entity.exts),
   * lost with it; what it unlocks there (units, research, a power) is that building's only.
   */
  host?: string;
}

/**
 * melee and ranged: +10 % of the blow's value against the target's class per level (at least +1); armor: +1 per level for foot
 * soldiers, vehicles: for machines, skin: for saurians. Any other line is a one-off research named like its line.
 */
export type UpgradeLine = string;

export type Def = UnitDef | BuildingDef | ResourceDef | UpgradeDef;

/** Active abilities: one per Human soldier. Times in "Normal" seconds. */
export interface AbilityDef {
  name: string;
  /** What it does, in a sentence, for its button's tooltip. */
  effect?: string;
  hotkey: string;
  cooldown: number;
  duration: number;
  /** Energy taken from the player's stock (building abilities). */
  energy?: number;
  /** Taken from the caster's own energy (fiches 2010), for a unit that has some; `cooldown` is then the spell's own. */
  mana?: number;
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
  /** Damage by target class (CLASSES order), when it differs (Mine alchimique, équilibreur 23/11). */
  vs?: number[];
  /** Gaz euphorisant: percent of their full health the allies give for it (équilibreur 23/11). */
  drain?: number;
  /** Couloir temporel: the supply that may cross before it closes. */
  supply?: number;
  /** Most units it moves at once. */
  max?: number;
  /** Percent of its damage it does to buildings (Pluie de feu: balance designer 2026-11-22). */
  building?: number;
  /** Dieux: an ultimate spell, cast free once the Temple primordial has charged it for this mythology. */
  ultimate?: Mythology;
  /** Dieux: values at the caster god's levels 1 to 3, in place of the plain ones (the spells grow with the god). */
  levels?: Partial<Record<'damage' | 'radius' | 'duration' | 'cooldown' | 'max' | 'mana' | 'range' | 'building', number[]>>;
}

/** Dieux: the three mythologies, each three gods (notice 1.2-1); all three standing charge its ultimate spell. */
/** The Artefacterie's improvements, given from it to a god anywhere (4 at most per god). */
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
/** Can a unit (or an Obélisque) of this kind raise this building: its own list, else a builder or a worker raises any. */
export function raises(def: { builds?: string[]; builder?: boolean; worker?: boolean }, type: string): boolean {
  return def.builds ? def.builds.includes(type) : !!(def.builder ?? def.worker);
}

export function abilitiesOf(def: { ability?: string; abilities?: string[] }): string[] {
  return [...(def.ability ? [def.ability] : []), ...(def.abilities ?? [])];
}

export const ABILITIES: Record<string, AbilityDef> = {
  /** Auxiliaire: costs 10 hp, attacks and moves 50 % faster. */
  stimulant: { name: 'Stimulant', effect: 'Coûte un peu de vie : l\'unité attaque et se déplace bien plus vite un moment.', hotkey: 'T', ...BALANCE.abilities.stimulant },
  /** Légionnaire: runs twice as fast to close in. */
  charge: { name: 'Charge', effect: 'Court deux fois plus vite pour fondre sur l\'ennemi.', hotkey: 'C', ...BALANCE.abilities.charge },
  /** Soigneur (notice, mod « Peau de roc »): an ally within 4 tiles takes 5 less damage per hit. */
  // The balancer (2026-11-22): the Alchimiste's Réanimation goes on its own or not, switched from this button; off at
  // first, as it was cast by hand.
  autoreanimation: { name: 'Réanimation automatique', effect: 'Active ou coupe la réanimation automatique des corps tombés à portée.', hotkey: 'W', target: 'self', cooldown: 0, duration: 0 } as AbilityDef,
  // The balancer (2026-11-22): on the ally aimed at, +5 armour, shown.
  peauderoc: { name: 'Peau de roc', effect: "L'allié visé gagne +5 d'armure un moment.", hotkey: 'R', target: 'point', ...BALANCE.abilities.peauderoc },
  /** Forge (notice): its telescope reveals a zone and detects invisible units there, for 50 energy. */
  /** Z Espion (Z.doc): a beacon that gives sight of a zone for 50 s; units of a small zone held 5 s; invisible 20 s. */
  balisez: { name: 'Balise de révélation', effect: 'Pose une balise qui révèle une zone de la carte pendant un long moment.', hotkey: 'B', ...(BALANCE.abilities.balisez as object) } as AbilityDef,
  impulsion: { name: 'Impulsion magnétique', effect: 'Les unités d\'une petite zone sont immobilisées quelques secondes.', hotkey: 'I', research: 'impulsion', ...(BALANCE.abilities.impulsion as object) } as AbilityDef,
  /** Z Accumulateur (Z.doc): an enemy building frozen 20 s (no attack, no production, unhurt); a beacon that deafens
   * living units; allies round the caster unhurt. Energy costs (55, 130, 170) become cooldowns. */
  gel: { name: 'Gel électronique', effect: 'Gèle un bâtiment ennemi : il ne tire plus et ne produit plus pendant un moment.', hotkey: 'G', ...(BALANCE.abilities.gel as object) } as AbilityDef,
  vacarme: { name: 'Balise de vacarme', effect: 'Une balise assourdissante : les unités vivantes autour perdent de la vie et ne peuvent plus attaquer.', hotkey: 'V', ...(BALANCE.abilities.vacarme as object) } as AbilityDef,
  /** Z.doc and the notice: for a while, enemy units within 18 tiles of the caster walk half as fast and strike 25 % slower,
   * as long as they stay in it. 205 energy becomes a cooldown, like the others (energy / 2); the duration is provisional. */
  gravite: { name: 'Gravité alourdie', effect: 'Un long moment, les ennemis d\'une très vaste zone autour du socle se déplacent et attaquent bien plus lentement.', hotkey: 'R', ...(BALANCE.abilities.gravite as object) } as AbilityDef,
  // Équilibreur 22/11: the Cône de protection becomes the Nuage de nanites (half damage, machines only, radius 6).
  cone: { name: 'Nuage de nanites', effect: 'Les machines alliées autour de l\'Accumulateur ne subissent que la moitié des dégâts un moment.', hotkey: 'O', ...(BALANCE.abilities.cone as object) } as AbilityDef,
  /** Z Centre K (Z.doc): support kits fitted on an own socle anywhere on the map, on top of its weapon. */
  kitdetection: { name: 'Détection', effect: 'Équipe un de vos socles, où qu\'il soit, d\'un kit qui détecte les unités invisibles.', hotkey: 'D', ...(BALANCE.abilities.kitdetection as object) } as AbilityDef,
  kitinvisibilite: { name: 'Invisibilité', effect: 'Équipe un de vos socles, où qu\'il soit, d\'un kit qui le rend invisible.', hotkey: 'I', ...(BALANCE.abilities.kitinvisibilite as object) } as AbilityDef,
  kitreparateur: { name: 'Auto-réparateur', effect: 'Équipe un de vos socles, où qu\'il soit, d\'un kit qui le répare peu à peu.', hotkey: 'A', ...(BALANCE.abilities.kitreparateur as object) } as AbilityDef,
  // Équilibreur 22/11: in place of the Balise offensive, its socle climbs cliffs up or down, like a Colossus. Its price
  // (balance kitpatte), the Balise's: proposition 5, provisional.
  kitpatte: { name: 'Patte ultramécanique', effect: 'Équipe un de vos socles terrestres, où qu\'il soit, de pattes qui escaladent les falaises, vers le haut comme vers le bas.', hotkey: 'P', ...(BALANCE.abilities.kitpatte as object) } as AbilityDef,
  // Balance designer 2026-11-22: the Artefacterie works like the Z Centre K, an improvement picked there and given to a
  // god clicked on, wherever it stands (no longer bought at the god); its price that of the improvement.
  // Passive effects, shown as an icon on the card (balance designer 2026-11-22); UnitDef.passives, BuildingDef.passives.
  // The Humains' three (the balancer, 2026-11-22), on the building each comes from.
  presenceechevins: { name: 'Présence des Échevins', effect: `Effet permanent : vos troupes à ${BALANCE.rules.upgrades.conseilAura.radius} cases du Conseil gagnent +${BALANCE.rules.upgrades.conseilAura.damage} d'attaque.`, hotkey: '', cooldown: 0, duration: 0 } as AbilityDef,
  planificationindustrielle: { name: 'Planification industrielle', effect: `Effet permanent : tant qu'un Grand Conseil tient, toutes vos unités sauf les serfs sont produites ${BALANCE.rules.upgrades.grandConseilSpeedup} % plus vite.`, hotkey: '', cooldown: 0, duration: 0 } as AbilityDef,
  detecteurtour: { name: 'Détecteur', effect: `Effet permanent : révèle les unités invisibles à ${BALANCE.units.tour.detector} cases.`, hotkey: '', cooldown: 0, duration: 0 } as AbilityDef,
  auraguerre: { name: 'Aura de guerre', effect: 'Effet permanent : les troupes autour d\'Odin frappent plus fort, +1 / +2 / +4 à 4 / 5 / 6 cases selon son niveau.', hotkey: '', cooldown: 0, duration: 0 } as AbilityDef,
  auraprotection: { name: 'Aura défensive', effect: 'Effet permanent : les troupes autour d\'Athéna gagnent de l\'armure, +1 / +2 / +3 à 4 / 8 / 16 cases selon son niveau.', hotkey: '', cooldown: 0, duration: 0 } as AbilityDef,
  // Balance designer 2026-11-22: the Soin heals by itself, switched off and on again from this button.
  autosoin: { name: 'Soin automatique', effect: 'Active ou coupe le soin automatique des alliés blessés (pas des machines).', hotkey: 'W', target: 'self', cooldown: 0, duration: 0 } as AbilityDef,
  artforce: { name: 'Force', effect: 'Sur un dieu, où qu\'il soit : il frappe plus fort.', hotkey: 'G', target: 'point', cooldown: 10, duration: 0, radius: 2, ...BALANCE.units.artforce.cost } as AbilityDef,
  artresistance: { name: 'Résistance', effect: 'Sur un dieu, où qu\'il soit : il gagne de l\'armure.', hotkey: 'J', target: 'point', cooldown: 10, duration: 0, radius: 2, ...BALANCE.units.artresistance.cost } as AbilityDef,
  artagilite: { name: 'Agilité', effect: 'Sur un dieu, où qu\'il soit : il frappe plus vite.', hotkey: 'K', target: 'point', cooldown: 10, duration: 0, radius: 2, ...BALANCE.units.artagilite.cost } as AbilityDef,
  artvitesse: { name: 'Vitesse', effect: 'Sur un dieu, où qu\'il soit : il se déplace plus vite.', hotkey: 'Q', target: 'point', cooldown: 10, duration: 0, radius: 2, ...BALANCE.units.artvitesse.cost } as AbilityDef,
  /** Z Centre K (Z.doc): takes control of an enemy machine for 50 s, until it dies or the Centre K falls. */
  observation: { name: 'Observation céleste', effect: 'Le télescope révèle une zone et y détecte les unités invisibles.', hotkey: 'O', research: 'observation', ...BALANCE.abilities.observation },
  /**
   * Obélisque (mod « Rappel », a Prisme ability): after a 4 s channel, up to 8 army units within 5 tiles of
   * the target point appear around the Obélisque, then stay dazed 4 s. 100 energy as in the mod; the cooldown
   * is ours (the Prisme took 100 s to regain its 100 energy). `duration` is the channel.
   */
  rappel: { name: 'Rappel', effect: 'Après une courte canalisation, ramène près de l\'Obélisque les unités de combat proches du point visé.', hotkey: 'R', ...BALANCE.abilities.rappel },
  /** Belluaire (notice): a sweeping blow that hits every enemy on the ground around it. */
  coupcirculaire: { name: 'Coup circulaire', effect: 'Un coup tournoyant qui frappe tous les ennemis au sol autour.', hotkey: 'C', ...BALANCE.abilities.coupcirculaire },
  /** Belluaire (notice): blends into the surroundings, unseen by enemies without detection, for a while. */
  camouflage: { name: 'Camouflage', effect: 'Se fond dans le décor : invisible pour l\'ennemi sans détection, un moment.', hotkey: 'F', ...BALANCE.abilities.camouflage },
  /** Walkyrie (notice: « un court instant »): the Belluaire's power, with its own time. */
  camouflagewalkyrie: { name: 'Camouflage', effect: 'Se fond dans le décor : invisible pour l\'ennemi sans détection, un court instant.', hotkey: 'F', ...BALANCE.abilities.camouflagewalkyrie },
  /** Alchimiste (notice): a toxin bomb, poisoning every enemy in a wide zone. */
  explosiftoxique: { name: 'Explosif toxique', effect: 'Un nuage toxique : 37 dégâts par seconde pendant 4 s aux ennemis qui s\'y trouvent ; plusieurs nuages s\'additionnent.', hotkey: 'E', target: 'point', research: 'cocktail', ...BALANCE.abilities.explosiftoxique },
  /** Alchimiste (notice): the ally nearest the point cannot be hurt for a while, then the toxins nearly kill it (1 hp). */
  /** Char Pégase (notice, 2010 sheet, mod): invisible chemical mines, 5 in stock, one more every 12 s, 160 damage. */
  // The balancer (2026-11-22): the Bourdon drops a mine, in sight, that goes off 3 s later on its own.
  minealchimique: { name: 'Larguer une mine alchimique', effect: 'Largue au sol une mine visible qui explose 3 s plus tard dans un rayon de 1,75 : 80 dégâts aux unités, 160 aux mécaniques massifs et aux bâtiments. Coûte 50 minerais et 15 énergie.', hotkey: 'M', ...BALANCE.abilities.minealchimique },
  posermine: { name: 'Mine chimique', effect: 'Pose sous le char une mine invisible qui explose au passage des troupes ennemies (5 en réserve ; le char en refait une toutes les 12 s, pour 35 minerais et 20 énergie prélevés d\'office).', hotkey: 'M', ...(BALANCE.abilities.posermine as object) } as AbilityDef,
  /** Isdaris major buildings (notice: Obélisque, Portail, Psycho-assembleur, Orbe de commandement, Trône): a plasma shield
   * that makes it unhurt for a while, unable to shoot or produce (sheet and mod « Déphasage »; the mod's 10 s, cooldown 90). */
  // Équilibreur 24/11: the Obélisque's only, on one Isdaris building of the construction zone, itself too.
  bouclierplasma: { name: 'Bouclier de plasma', effect: 'L\'Obélisque rend invulnérable un bâtiment isdaris de la zone de construction (lui-même compris), qui ne tire et ne produit plus un moment ; les ennemis changent de cible.', hotkey: 'J', target: 'point', ...(BALANCE.abilities.bouclierplasma as object) } as AbilityDef,
  /** Allosaure (notice): feasts on a corpse nearby to heal; the mod's 50 % and 60 s. */
  // The balancer (2026-11-22): aimed at where a living unit (ally or enemy) has just died; +75 HP, then 1.5 s still.
  festin: { name: 'Festin', effect: 'Dévore la dépouille d\'une unité organique morte depuis peu, alliée ou ennemie : +75 PV, puis immobile 1,5 s.', hotkey: 'F', target: 'point', ...(BALANCE.abilities.festin as object) } as AbilityDef,
  /** Réservoir de substances (notice; mod and 2010 sheet for the numbers): its three abilities. */
  gazeuphorisants: { name: 'Gaz euphorisants', effect: 'Les alliés vivants de la zone attaquent et se déplacent plus vite un moment, au prix d\'un dixième de leur vie (sans tuer).', hotkey: 'Z', target: 'point', ...(BALANCE.abilities.gazeuphorisants as object) } as AbilityDef,
  acidedissolvant: { name: 'Acide dissolvant', effect: 'Un torrent d\'acide sur un bâtiment ennemi : de très lourds dégâts.', hotkey: 'Q', target: 'point', research: 'acide', ...(BALANCE.abilities.acidedissolvant as object) } as AbilityDef,
  explosioncuve: { name: 'Explosion suicidaire', effect: 'La cuve explose : toutes les unités au sol autour et les bâtiments ennemis sont gravement touchés.', hotkey: 'X', ...(BALANCE.abilities.explosioncuve as object) } as AbilityDef,
  regenerant: { name: 'Régénérant', effect: 'Les alliés de la zone ne peuvent plus être blessés un moment, puis les toxines les laissent à 1 PV.', hotkey: 'G', target: 'point', research: 'regenerant', ...BALANCE.abilities.regenerant },
  /** Alchimiste (notice): a living unit fallen near the point rises and fights for a while as a Cadavre réanimé. */
  reanimation: { name: 'Réanimation', effect: 'Une unité vivante tombée près du point se relève et combat un moment pour vous.', hotkey: 'R', target: 'point', ...BALANCE.abilities.reanimation },
  /** Phalangiste (notice): a napalm charge on a vehicle near the point: an enemy one is burnt and stopped, an ally one repaired. */
  napalm: { name: 'Charge de napalm', effect: 'Sur un véhicule : un ennemi brûle et s\'arrête, un allié est réparé.', hotkey: 'N', target: 'point', research: 'chargenapalm', ...BALANCE.abilities.napalm },
  /** Créature (notice): burrows, unseen, and bursts out when an enemy comes near; again to come out. */
  enfouissement: { name: 'Enfouissement', effect: 'S\'enterre, invisible, et surgit quand un ennemi approche ; encore pour ressortir.', hotkey: 'F', research: 'enfouissement', ...BALANCE.abilities.enfouissement },
  /** Assassin (notice): overwhelms the mind of the enemy nearest the point, which cannot move nor fight for a while. */
  chocmental: { name: 'Choc mental', effect: 'L\'ennemi visé ne peut plus bouger ni combattre un moment.', hotkey: 'M', target: 'point', research: 'chocmental', ...BALANCE.abilities.chocmental },
  /** Druide (notice): a perfect energy double of the ally nearest the point, for a while. */
  /** Druide (équilibreur 24/11, in place of the Déflagration): a block of energy no one walks through, for a while. */
  concentration: { name: 'Concentration énergétique', effect: 'Crée au sol un bloc d\'énergie infranchissable de rayon 3, un moment.', hotkey: 'G', target: 'point', ...BALANCE.abilities.concentration },
  /** Espion (équilibreur 24/11): the enemies of a zone take 10 % more damage for 30 s, wherever they go. */
  ciblage: { name: 'Ciblage', effect: 'Les unités et bâtiments ennemis de la zone encaissent 10 % de dégâts en plus pendant 30 s, même s\'ils en sortent.', hotkey: 'B', target: 'point', ...BALANCE.abilities.ciblage },
  /** Réserve psy, Voyageur (équilibreur 24/11): their Recharge de bouclier, on by default. */
  autorecharge: { name: 'Recharge de bouclier automatique', effect: 'Active ou coupe la recharge automatique des boucliers alliés proches.', hotkey: 'W', target: 'self', cooldown: 0, duration: 0 } as AbilityDef,
  // Passives shown as an icon (équilibreur 24/11).
  singularite: { name: 'Attaque de singularité', effect: 'Effet permanent : chaque attaque du Druide retire autant d\'énergie que de points de vie à sa cible.', hotkey: '', cooldown: 0, duration: 0 } as AbilityDef,
  disquetournoyant: { name: 'Disque tournoyant', effect: `Effet permanent, après sa recherche au Totem : chaque attaque inflige ${BALANCE.abilities.disquetournoyant.damage} % de ses dégâts aux ennemis à ${BALANCE.abilities.disquetournoyant.radius} cases autour de la cible.`, hotkey: '', research: 'disque', ...BALANCE.abilities.disquetournoyant } as AbilityDef,
  protection: { name: 'Bouclier protecteur', effect: `Effet permanent : les unités alliées à ${BALANCE.abilities.protection.radius} cases du drone (lui compris) subissent ${BALANCE.abilities.protection.damage} dégâts de moins par coup.`, hotkey: '', ...BALANCE.abilities.protection } as AbilityDef,
  dansesoldat: { name: 'Danse du soldat', effect: `Effet permanent : l'Assassin ne subit que ${BALANCE.rules.upgrades.danseDuSoldat} % des dégâts.`, hotkey: '', cooldown: 0, duration: 0 } as AbilityDef,
  voiledeflecteur: { name: 'Voile', effect: `Effet permanent : rend invisibles les unités alliées au sol à ${BALANCE.units.deflecteur.cloakAura} cases.`, hotkey: '', cooldown: 0, duration: 0 } as AbilityDef,
  detecteurorbe: { name: 'Détecteur', effect: `Effet permanent : révèle les unités invisibles à ${BALANCE.units.orbe.detector} cases.`, hotkey: '', cooldown: 0, duration: 0 } as AbilityDef,
  double: { name: 'Double énergétique', effect: 'Crée un leurre de l\'allié visé : mêmes points de vie, mais il n\'attaque pas.', hotkey: 'O', target: 'point', ...BALANCE.abilities.double },
  /** Druide (notice): a bolt of plasma on the enemy nearest the point. */
  deflagration: { name: 'Déflagration', effect: 'Un trait de plasma sur l\'ennemi visé.', hotkey: 'G', target: 'point', research: 'deflagration', ...BALANCE.abilities.deflagration },
  /** Druide (notice): no ability can be used inside the zone for a while. */
  silence: { name: 'Silence des ions', effect: 'Plus aucune capacité ne peut être utilisée dans la zone, un moment.', hotkey: 'I', target: 'point', research: 'silence', ...BALANCE.abilities.silence },
  /** Porte-disques, Chimère, Dragon (notice): a short-range teleport. */
  teleport: { name: 'Téléportation', effect: 'Une courte téléportation au point visé.', hotkey: 'T', target: 'point', ...BALANCE.abilities.teleport },
  /** Baliste plasma (notice): the cannon spins, firing at every enemy around. */
  feucirculaire: { name: 'Feu circulaire', effect: 'Le canon tourne sur lui-même et tire sur tous les ennemis autour.', hotkey: 'F', research: 'feucirculaire', ...BALANCE.abilities.feucirculaire },
  /** Espion (notice): with another Espion, a time corridor: the units round this one appear by the other. */
  couloir: { name: 'Couloir temporel', effect: 'Relie cet Espion à un autre des vôtres pendant 30 s : un clic droit sur l\'un fait passer l\'unité près de l\'autre ; le couloir se ferme après 5 passages ou 8 de ravitaillement.', hotkey: 'C', target: 'point', ...BALANCE.abilities.couloir },
  /** Voyageur (notice): a cloak of negative energy over itself and the allies round it. */
  manteau: { name: 'Manteau', effect: 'Un manteau d\'énergie négative sur le Voyageur et les alliés autour.', hotkey: 'M', research: 'manteau', ...BALANCE.abilities.manteau },
  /** Voyageur (notice): itself and the allies round it appear by the friendly building nearest the point. */
  teleportgroupe: { name: 'Téléportation de groupe', effect: 'Le Voyageur et les alliés autour apparaissent près de votre bâtiment le plus proche du point.', hotkey: 'T', target: 'point', ...BALANCE.abilities.teleportgroupe },
  /** Voyageur (notice): the ally nearest the point sends back part of the damage it takes. */
  /** Voyageur, Réserve psy (fiche 2010, mod): cast on their own, on an ally nearby whose shield is down. */
  rechargebouclier: { name: 'Recharge des boucliers', effect: 'Rend du bouclier à une unité alliée proche, automatiquement.', hotkey: '', ...BALANCE.abilities.rechargebouclier },
  renvoi: { name: 'Sphère de renvoi', effect: 'L\'allié visé renvoie une partie des dégâts qu\'il reçoit.', hotkey: 'R', target: 'point', research: 'renvoi', ...BALANCE.abilities.renvoi },
  /** Béhémoth (notice): phases out, unhurt and unable to fight, for a while. */
  dephasage: { name: 'Déphasage', effect: 'Se déphase : ne peut plus être blessé ni combattre, un moment.', hotkey: 'D', research: 'dephasage', ...BALANCE.abilities.dephasage },
  /** Orbe de commandement (notice, Observatoire): reveals a very wide zone. */
  observatoire: { name: 'Observatoire', effect: 'Révèle une très large zone de la carte.', hotkey: 'V', research: 'observatoire', ...BALANCE.abilities.observatoire },
  /** Trône (notice, Relais de canon orbital): a plasma beam from orbit on a point an Espion watches. */
  canonorbital: { name: 'Canon orbital', effect: 'Un rayon de plasma depuis l\'orbite, sur un point qu\'un Espion surveille.', hotkey: 'C', research: 'relais', ...BALANCE.abilities.canonorbital },
  /** Trône (notice, Porte de déphasage): the Isdaris units round the point phase out for a while. */
  portedephasage: { name: 'Porte de déphasage', effect: 'Les unités Isdaris autour du point se déphasent un moment.', hotkey: 'P', research: 'porte', ...BALANCE.abilities.portedephasage },
  /** Notice: the second, optional step of the Porte de déphasage: the group still phased is sent anywhere, out of phase. */
  transfertgroupe: { name: 'Transfert du groupe', effect: 'Téléporte où l\'on veut le groupe encore déphasé par la Porte ; il y arrive hors de sa forme déphasée.', hotkey: 'G', research: 'porte', target: 'point', cooldown: 0, duration: 0 },
  /** Char Pégase (notice): takes off (shooting only at flyers) or lands. */
  decollage: { name: 'Décollage / atterrissage', effect: 'Décolle (ne tire alors que sur les volants) ou atterrit.', hotkey: 'D', research: 'decollage', ...BALANCE.abilities.decollage },
  /** Caserne volante: lifts off, a slow flyer that trains nothing until it lands. */
  envol: { name: 'Décoller', effect: 'Décolle : vole lentement et ne produit plus rien tant qu\'elle n\'a pas atterri.', hotkey: 'D', target: 'self', ...BALANCE.abilities.envol },
  atterrissage: { name: 'Atterrir', effect: 'Atterrit au point visé et reprend la production.', hotkey: 'D', target: 'point', ...BALANCE.abilities.atterrissage },
  /** Trône (Concentrateur): a wall of energy across the map point, no unit nor shot goes through it. */
  murenergie: { name: "Mur d'énergie", effect: 'Un mur d\'énergie à travers le point : ni unité ni tir ne le traverse.', hotkey: 'M', research: 'concentrateur', ...BALANCE.abilities.murenergie },
  /** Gaïa (notice): appears by the friendly building nearest the point. */
  teleportgaia: { name: 'Téléportation de Gaïa', effect: 'Gaïa apparaît près de votre bâtiment le plus proche du point.', hotkey: 'T', target: 'point', ...BALANCE.abilities.teleportgaia },
  /** Gaïa (notice): a magic arrow on the enemy nearest the point. */
  /** Thor (notice, « Courroux du marteau »): his next blow hits several times as hard. */
  courroux: { name: 'Courroux du marteau', effect: 'Son prochain coup frappe plusieurs fois plus fort.', hotkey: 'C', target: 'self', ...BALANCE.abilities.courroux },
  /** Odin (notice, « Foudre puissante »): a bolt on the enemy nearest the point, which it stuns. */
  foudre: { name: 'Foudre puissante', effect: 'Un éclair sur l\'ennemi visé, qu\'il étourdit.', hotkey: 'F', target: 'point', ...BALANCE.abilities.foudre },
  /** Athéna (notice): she and the troops round her hit much harder for a while. */
  cridegueurre: { name: 'Cri de guerre', effect: 'Athéna et les troupes autour frappent bien plus fort un moment.', hotkey: 'C', target: 'self', ...BALANCE.abilities.cridegueurre },
  /** Isis (notice): heals every wounded living ally round her. */
  soinsdivins: { name: 'Soins divins', effect: 'Soigne tous les alliés vivants blessés autour d\'Isis.', hotkey: 'O', target: 'self', ...BALANCE.abilities.soinsdivins },
  /** Isis (notice): raises allies fallen lately round her (`max` of them). */
  resurrection: { name: 'Résurrection', effect: 'Relève des alliés tombés depuis peu autour d\'Isis.', hotkey: 'R', target: 'self', ...BALANCE.abilities.resurrection },
  /** Frigg (notice): takes control of the enemy nearest the point for a while. */
  soumission: { name: 'Soumission divine', effect: 'Prend le contrôle de l\'ennemi visé, un moment.', hotkey: 'O', target: 'point', ...BALANCE.abilities.soumission },
  /** Frigg (notice): she and the troops round her vanish from sight, long. */
  voile: { name: 'Voile de nuage', effect: 'Frigg et les troupes autour deviennent invisibles un long moment, même en s\'éloignant d\'elle.', hotkey: 'V', target: 'self', ...BALANCE.abilities.voile },
  /** Hadès (notice): a ray that splits to strike every enemy unit he sees. */
  rayonmort: { name: 'Rayon de mort', effect: 'Un rayon qui se divise et frappe chaque ennemi que voit Hadès.', hotkey: 'R', target: 'self', ...BALANCE.abilities.rayonmort },
  /** Hadès (notice): travels under ground to the point. */
  voyage: { name: 'Voyage souterrain', effect: 'Hadès voyage sous terre jusqu\'au point visé.', hotkey: 'V', target: 'point', ...BALANCE.abilities.voyage },
  /** Hadès (notice): ghosts that cannot be hurt rise round him, for a while. */
  /** Osiris (notice): a swarm round him that hurts the enemies and gives him their life. */
  nuee: { name: 'Nuée nauséabonde', effect: 'Une nuée blesse les ennemis autour d\'Osiris et lui rend leur vie.', hotkey: 'N', target: 'self', ...BALANCE.abilities.nuee },
  /** Yggdrasill (notice, Déracinement): uproots to walk, and takes root again at the point. */
  deraciner: { name: 'Déraciner', effect: 'S\'arrache du sol pour marcher ; on le replante ensuite au point voulu.', hotkey: 'E', target: 'self', research: 'deracinement', ...BALANCE.abilities.deraciner },
  /** Isdaris Orbe plasma (notice: « capable de se déplacer lentement » ; fiche: Redéploiement, 50 minerals, every 35 s). */
  /** Intelligence centrale (notice): the drones nearby shelter inside. */
  refuge: { name: 'Refuge', effect: 'Les serfs proches s\'abritent dans le Conseil, six au plus.', hotkey: 'R', target: 'self', ...BALANCE.abilities.refuge },
  redeploiement: { name: 'Redéploiement', effect: 'Vers un point de la zone de construction : l’Orbe reste immobile et ne tire plus 17 s, est téléportée, puis 17 s encore.', hotkey: 'R', target: 'point', ...BALANCE.abilities.redeploiement },
  ancrer: { name: 'Reposer', effect: 'Se repose au point visé, dans un champ d’énergie, et tire de nouveau peu après.', hotkey: 'R', target: 'point', ...BALANCE.abilities.ancrer },
  enraciner: { name: 'Enraciner', effect: 'Reprend racine au point visé.', hotkey: 'E', target: 'point', ...BALANCE.abilities.enraciner },
  /** Minotaure (notice): an enraged trance, its blows much harder for a while. */
  /** Sphinx (notice, Peau de roc): turned to stone, slower and slower to shoot, but heavily armoured, mending. */
  statue: { name: 'Forme de statue', effect: 'Se change en pierre : très blindé et se répare, mais tire de plus en plus lentement.', hotkey: 'R', target: 'self', research: 'peauroc', ...BALANCE.abilities.statue },
  /** Athéna (notice): her owl flies over a zone and shows it a while. */
  chouette: { name: 'Chouette', effect: 'La chouette d\'Athéna survole une zone, n\'importe où sur la carte, et la montre un moment.', hotkey: 'O', target: 'point', ...BALANCE.abilities.chouette },
  /** Prêtresse (notice): on an ally, ends what harms it; on an enemy, what helps it, and hurts summoned ones badly. */
  dissipation: { name: 'Dissipation', effect: 'Sur un allié, retire ce qui lui nuit ; sur un ennemi, ce qui l\'aide, et blesse durement les invocations.', hotkey: 'D', target: 'point', ...BALANCE.abilities.dissipation },
  /** Élémentaire (notice): Mutation to another form, and Fusion of two into a Golem. */
  formefeu: { name: 'Forme de feu', effect: 'Change de forme : feu.', hotkey: 'J', target: 'self', ...BALANCE.abilities.mutation },
  formeeau: { name: 'Forme d’eau', effect: 'Change de forme : eau.', hotkey: 'Y', target: 'self', ...BALANCE.abilities.mutation },
  formeterre: { name: 'Forme de terre', effect: 'Change de forme : terre.', hotkey: 'K', target: 'self', ...BALANCE.abilities.mutation },
  formeair: { name: 'Forme d’air', effect: 'Change de forme : air.', hotkey: 'Q', target: 'self', ...BALANCE.abilities.mutation },
  fusion: { name: 'Fusion en Golem', effect: 'Deux Élémentaires fusionnent en un Golem.', hotkey: 'U', target: 'self', ...BALANCE.abilities.fusion },
  // Ultimate spells (notice): charged at the Temple primordial while the mythology's three gods stand, cast by any of them.
  /** Scandinave: an avatar of the serpent Jörmungandr fights by the god a while, and feeds on the dead. */
  jormungand: { name: 'Appel de Jörmungand', effect: 'Un avatar du serpent Jörmungand combat aux côtés du dieu un moment et se nourrit des morts.', hotkey: 'U', target: 'point', ultimate: 'scandinave', ...BALANCE.abilities.jormungand },
  /** Grec: lightning over a wide zone, allies too; the mightier a unit, the more it suffers. */
  tempetezeus: { name: 'Tempête de Zeus', effect: 'La foudre frappe une large zone, alliés compris ; plus une unité est puissante, plus elle souffre.', hotkey: 'U', target: 'point', ultimate: 'grec', ...BALANCE.abilities.tempetezeus },
  /** Égyptien: the enemies of the zone blinded and held long (machines more briefly). */
  amonra: { name: "Flamboiement d'Amon-Râ", effect: 'Les ennemis de la zone sont aveuglés et immobilisés longtemps (les machines moins).', hotkey: 'U', target: 'point', ultimate: 'egyptien', ...BALANCE.abilities.amonra },
  /** Apollon (notice, « Pluie de feu »): burning meteors on every enemy in a zone. */
  pluiedefeu: { name: 'Pluie de feu', effect: 'Une pluie de météores sur une zone : 2 s après, 3 à 5 vagues qui brûlent tout ce qui s\'y trouve, alliés compris, et les bâtiments en partie.', hotkey: 'F', target: 'point', ...BALANCE.abilities.pluiedefeu },
  /** Apollon (notice; XC.doc 2008 for the numbers, its zones scaled as the Tempête's): enemy infantry of the zone walks and
   * strikes half as fast for a while. */
  lumiereardente: { name: 'Lumière ardente', effect: 'Une lumière insoutenable : l\'infanterie ennemie de la zone se déplace et attaque deux fois moins vite.', hotkey: 'O', target: 'point', ...(BALANCE.abilities.lumiereardente as object) } as AbilityDef,
  /** Seth (notice): a handful of sand in an enemy vehicle's works, which can hardly move or shoot for a while (numbers
   * provisional: none in the notice nor in XC.doc). */
  jetdesable: { name: 'Jet de sable', effect: 'Du sable dans les mécanismes : le véhicule ennemi visé ne peut presque plus bouger ni tirer un moment.', hotkey: 'B', target: 'point', ...(BALANCE.abilities.jetdesable as object) } as AbilityDef,
  /** Seth (notice, « Tempête de sable »): enemy ranged units inside the zone cannot shoot for a while. */
  tempete: { name: 'Tempête de sable', effect: 'Les unités ennemies à distance dans la zone ne peuvent plus tirer un moment.', hotkey: 'T', target: 'point', ...BALANCE.abilities.tempete },
};
export const OBSERVATION = BALANCE.rules.observation;
export const RAPPEL = BALANCE.rules.rappel;
export const SKIN_RANGE = BALANCE.rules.peauDeRoc.range;
export const SKIN_REDUCTION = BALANCE.rules.peauDeRoc.reduction;
export const STIM_HP = BALANCE.rules.stimulantHp;

/** Buildings each level needs: level 3 a Tour alchimistique (the balancer, 2026-11-22: no second Caserne any more). */
// Équilibreur 23/11: no Tour alchimistique for level 3 either.
const UPGRADE_REQUIRES: (Record<string, number> | undefined)[] = [undefined, undefined, undefined];

/** What each thing is; its numbers come from balance.json (merged into DEFS below). */
const BASE: Record<string, object> = {
  serf: { kind: 'unit', name: 'Serf', radius: 0.375, worker: true, faction: 'humains', hotkey: 'S' },
  auxiliaire: { kind: 'unit', name: 'Auxiliaire', radius: 0.375, faction: 'humains', hotkey: 'A' },
  legionnaire: { kind: 'unit', name: 'Légionnaire-scieur', radius: 0.375, faction: 'humains', hotkey: 'L' },
  soigneur: { kind: 'unit', name: 'Soigneur', radius: 0.375, requires: { alchimisterie: 1 }, ability: 'peauderoc', abilities: ['autosoin'], faction: 'humains', hotkey: 'O' },
  // Mod: grenades alchimiques, 30 (20 against living targets: nearly all units), +10 here against buildings.
  phalangiste: { kind: 'unit', name: 'Phalangiste', radius: 0.4, requires: { forge: 1 }, ability: 'napalm', faction: 'humains', hotkey: 'P' },
  conseil: { kind: 'building', name: 'Conseil des Échevins', size: 4, passives: ['presenceechevins'], trains: ['serf'], dropoff: true, morphs: ['grandconseil'], abilities: ['refuge'], faction: 'humains', hotkey: 'C' },
  // Notice: « Grand Conseil », the one planning office: while it stands, every unit is produced faster.
  grandconseil: { kind: 'building', name: 'Grand Conseil', size: 4, passives: ['presenceechevins', 'planificationindustrielle'], trains: ['serf'], dropoff: true, morphOnly: true, unique: true, abilities: ['refuge'], requires: { caserne: 1 }, requiresAny: { of: ['forge', 'alchimisterie'], count: 1 }, faction: 'humains', hotkey: 'G' },
  grenier: { kind: 'building', name: 'Grenier', size: 2, morphs: ['silo'], faction: 'humains', hotkey: 'G' },
  // The balancer (2026-11-22): each Grenier may become a Grenier à silo, no research needed: +200 HP, +5 supply.
  silo: { kind: 'building', name: 'Grenier à silo', size: 2, morphOnly: true, faction: 'humains', hotkey: 'S' },
  caserne: { kind: 'building', name: 'Caserne', size: 3, trains: ['auxiliaire', 'legionnaire', 'soigneur', 'phalangiste', 'belluaire'], morphs: ['casernevolante'], faction: 'humains', hotkey: 'K' },
  // Notice: a Caserne turned into one that takes off and lands at will, to set up behind the enemy.
  casernevolante: { kind: 'building', name: 'Caserne volante', size: 3, trains: ['auxiliaire', 'legionnaire', 'soigneur', 'phalangiste', 'belluaire'], morphOnly: true, ability: 'envol', faction: 'humains', hotkey: 'V' },
  casernevol: { kind: 'unit', name: 'Caserne volante (en vol)', radius: 1.4, flying: true, mechanical: true, ability: 'atterrissage', faction: 'humains', hotkey: 'V' },
  mine: { kind: 'building', name: 'Mine', size: 3, faction: 'humains', hotkey: 'M' },
  // Mod: « Guilde métallurgique » (the notice's Forge).
  forge: {
    kind: 'building', name: 'Forge', size: 3, requires: { caserne: 1 }, ability: 'observation', faction: 'humains', hotkey: 'F',
    researches: ['melee1', 'melee2', 'melee3', 'ranged1', 'ranged2', 'ranged3', 'armor1', 'armor2', 'armor3', 'vehicles1', 'vehicles2', 'vehicles3', 'skin1', 'skin2', 'skin3', 'canonsscies', 'cuirasse', 'scieassaut', 'lamesempoisonnees', 'chargenapalm', 'observation'],
  },
  // Notice: « Marché », trade one resource for the other at a poor rate, and economic research (mod: « Guilde des dresseurs-marchands »).
  marche: { kind: 'building', name: 'Marché', size: 3, requires: { grandconseil: 1 }, researches: ['croissance', 'pillage'], faction: 'humains', hotkey: 'R' },
  // Mod: « Fortin », a bunker for four: soldiers inside are out of reach and shoot one tile farther.
  fortin: { kind: 'building', name: 'Fortin', size: 2, requires: { caserne: 1 }, faction: 'humains', hotkey: 'B' },
  // Mod: « Tour anti-air », a detector with a rocket launcher against flying units only (40, range 8).
  tour: { kind: 'building', name: 'Tour alchimistique', size: 2, passives: ['detecteurtour'], requiresAny: { of: ['forge', 'alchimisterie'], count: 1 }, faction: 'humains', hotkey: 'T' },
  // Notice: « Métallurgie », the vehicle workshop (mod « Machinerie », needing the Guilde métallurgique, here the Forge).
  metallurgie: { kind: 'building', name: 'Métallurgie', size: 3, requires: { forge: 1 }, trains: ['bourdon', 'dirigeable', 'scarabee', 'pegase'], researches: ['charlourd', 'decollage', 'scarabeassaut'], faction: 'humains', hotkey: 'M' },
  // Notice: « Scarabée », a slow amphibious armoured wagon: up to four Auxiliaires, Soigneurs, Phalangistes or Alchimistes
  // shelter and shoot from inside (mod « Transport scarabée »); with Scarabée d'assaut it has a gun of its own.
  scarabee: { kind: 'unit', name: 'Scarabée', radius: 0.8, mechanical: true, faction: 'humains', hotkey: 'S' },
  // The balancer (2026-11-22): the Bourdon and the Dirigeable are two units, by the 2010 sheet. The Bourdon: a small
  // anti-air gyrocopter (air only, range 5), a detector, dropping alchemical mines.
  bourdon: { kind: 'unit', name: 'Bourdon', radius: 0.45, flying: true, mechanical: true, ability: 'minealchimique', faction: 'humains', hotkey: 'B' },
  // The Dirigeable: transport (4 of supply) and reconnaissance, a detector, unarmed.
  dirigeable: { kind: 'unit', name: 'Dirigeable', radius: 0.6, flying: true, mechanical: true, faction: 'humains', hotkey: 'G' },
  // Notice: « Char Pégase », a massive tank whose « Incineratus » cannon wrecks vehicles and buildings (mod « Pegasus », ground mode).
  pegase: { kind: 'unit', name: 'Char Pégase', radius: 0.9, mechanical: true, ability: 'decollage', faction: 'humains', hotkey: 'P' },
  // Notice: « Alchimisterie », the alchemy tier: Alchimistes (mod: needs the Guilde alchimistique, here the Forge).
  alchimisterie: { kind: 'building', name: 'Alchimisterie', size: 3, requires: { caserne: 1 }, trains: ['alchimiste'], researches: ['armeschimiques', 'cocktail', 'regenerant', 'scientisme'], morphs: ['grandealchimisterie'], queuesMorph: true, faction: 'humains', hotkey: 'A' },
  // Notice: « Alchimiste », a fragile support that detects hidden units; mod: cocktail instable, 15 (+5 against living targets).
  alchimiste: { kind: 'unit', name: 'Alchimiste', radius: 0.375, abilities: ['explosiftoxique', 'regenerant', 'reanimation', 'autoreanimation'], faction: 'humains', hotkey: 'A' },
  // Notice: « Grande Alchimisterie », where the Réservoirs de substances are deployed.
  grandealchimisterie: {
    kind: 'building', name: 'Grande Alchimisterie', size: 3, trains: ['alchimiste', 'cuve'], researches: ['armeschimiques', 'cocktail', 'regenerant', 'acide', 'scientisme'], morphOnly: true, requires: { grandconseil: 1 }, faction: 'humains', hotkey: 'G',
  },
  // Notice: « Réservoir de substances », a heavy vat carried by serfs, its master alchemist throwing area bombs (mod « Cuve à efférents »).
  /** Laid by a Char Pégase, never trained. */
  minechimique: { kind: 'unit', name: 'Mine chimique', radius: 0.3, cloaked: true, mechanical: true, faction: 'humains', hotkey: 'M' },
  /** Dropped by a Bourdon, never trained: in sight, it goes off when its fuse runs out. */
  minealchimique: { kind: 'unit', name: 'Mine alchimique', radius: 0.3, mechanical: true, faction: 'humains', hotkey: 'M' },
  cuve: { kind: 'unit', name: 'Réservoir de substances', radius: 0.7, mechanical: true, abilities: ['gazeuphorisants', 'acidedissolvant', 'explosioncuve'], faction: 'humains', hotkey: 'V' },
  // Notice: a fallen living unit raised by an Alchimiste, fighting for its side for a while (mod « Cadavre réanimé »).
  cadavre: { kind: 'unit', name: 'Cadavre réanimé', radius: 0.375, faction: 'humains', hotkey: 'Z' },
  // Notice: « Créaturium », where the belluaires train saurians (mod: needs the Guilde des dresseurs-marchands, here a Caserne).
  creaturium: { kind: 'building', name: 'Créaturium', size: 3, requires: { alchimisterie: 1 }, trains: ['plesiosaure', 'ankylosaure', 'allosaure'], researches: ['dressageallosaures', 'trebuchet'], faction: 'humains', hotkey: 'C' },
  // Notice: « Plésiosaure », a flying saurian with a heavy ballista against ground infantry (mod « Rodactylus »).
  plesiosaure: { kind: 'unit', name: 'Plésiosaure', radius: 0.6, flying: true, beast: true, faction: 'humains', hotkey: 'P' },
  // Notice: « Ankylosaure », slow and armoured, its spiked tail smashes buildings (mod « Kylosaurus »: 60, -30 light, +30 structures).
  ankylosaure: { kind: 'unit', name: 'Ankylosaure', radius: 0.9, beast: true, faction: 'humains', hotkey: 'A' },
  // Notice: « Allosaure », a huge flesh-eater that devours infantry (mod « Carnosaurus »: 60, -30 mechanical).
  allosaure: { kind: 'unit', name: 'Allosaure', radius: 0.9, beast: true, ability: 'festin', requires: { creaturium: 1, dressageallosaures: 1 }, faction: 'humains', hotkey: 'L' },
  // Notice: « Belluaire », a halberdier on a reptile, deadly to infantry, nearly useless against machines; trained in the
  // Caserne once a Créaturium stands (mod: a flamethrower, 15 +25 against living targets).
  belluaire: { kind: 'unit', name: 'Belluaire', radius: 0.45, requires: { alchimisterie: 1 }, abilities: ['camouflage'], faction: 'humains', hotkey: 'B' },
  ...upgrades('melee', 'Attaque corps à corps', 'C'),
  ...upgrades('ranged', 'Attaque à distance', 'D'),
  ...upgrades('armor', 'Armure infanterie', 'A'),
  ...upgrades('vehicles', 'Blindage véhicules', 'V', { metallurgie: 1 }),
  ...upgrades('skin', 'Peau épaisse', 'P', { creaturium: 1 }),
  // One-off research from the notice (costs and times in balance.json; the mod's where it has them). No longer offered
  // (the balancer, 2026-11-22), kept for old replays: Entraînement groupé (the Marché's « production groupée »), Œil perçant.
  canonsscies: research('Canons sciés', 'N', 'Auxiliaires : +1 de portée.', { caserne: 1 }),
  cuirasse: research('Cuirasse', 'U', 'Légionnaires-scieurs : +1 d\'armure.', { caserne: 1 }),
  scieassaut: research("Scie d'assaut", 'S', 'Légionnaires-scieurs : +15 dégâts contre les bâtiments et les véhicules massifs.', { caserne: 1 }),
  lamesempoisonnees: research('Lames empoisonnées', 'L', 'Belluaires : leurs coups empoisonnent les unités organiques.', { creaturium: 1 }),
  observation: research('Observation céleste', 'B', 'Les Forges peuvent observer une zone de la carte.'),
  croissance: research('Croissance économique', 'C', 'Serfs et unités de la Caserne : +5 points de vie.'),
  pillage: research('Pillage', 'P', 'Chaque bâtiment ennemi détruit rapporte une part de son coût.'),
  entrainementgroupe: research('Entraînement groupé', 'E', 'Unités de la Caserne formées 25 % plus vite.'),
  armeschimiques: research('Armes chimiques', 'C', 'Alchimistes, Réservoirs et Tours alchimistiques : leurs tirs touchent une zone (rayon 1), alliés compris.'),
  // The 2010 sheet's research (at the Guilde alchimistique, not in the game: here the Alchimisterie), the balancer's numbers.
  scientisme: research('Scientisme', 'I', 'Soigneurs : +25 de mana ; Alchimistes et Réservoirs de substances : +50.'),
  oeilpercant: research('Œil perçant', 'O', 'Les Plésiosaures détectent les unités invisibles.'),
  dressageallosaures: research("Dressage d'allosaures", 'D', "Permet de dresser des Allosaures.", { grandconseil: 1 }),
  charlourd: research('Char lourd', 'L', 'Chars Pégase : au sol, 29 dégâts aux fantassins, 58 aux machines lourdes, 87 aux machines et bâtiments ; +1 armure.'),
  cocktail: research('Cocktail alchimistique', 'K', "Les Alchimistes lancent l'Explosif toxique."),
  regenerant: research('Régénérant chimique', 'R', 'Les Alchimistes lancent le Régénérant sur leurs alliés.'),
  acide: research('Acide anti-structure', 'Q', 'Les Réservoirs de substances peuvent dissoudre un bâtiment ennemi sous l\'acide.'),
  chargenapalm: research('Charge de napalm', 'H', 'Les Phalangistes lancent la Charge de napalm sur les véhicules.'),
  decollage: research('Décollage', 'D', 'Les Chars Pégase peuvent décoller (tir anti-aérien) et atterrir.', { grandconseil: 1 }),
  // No longer offered (the balancer, 2026-11-22: the Dirigeable carries on its own); kept for old replays.
  chargement: research('Chargement', 'C', "Les Bourdons embarquent jusqu'à quatre fantassins, ou un véhicule (Scarabée, Char Pégase)."),
  scarabeassaut: research("Scarabée d'assaut", 'A', 'Les Scarabées reçoivent un canon et vont un peu plus vite.'),
  trebuchet: research('Trébuchet intégré', 'T', 'Les Ankylosaures bombardent les bâtiments de loin.'),

  // ---------------------------------------------------------------- Isdaris
  moissonneur: { kind: 'unit', name: 'Robot moissonneur', radius: 0.375, builds: ['obelisque', 'recepteur'], worker: true, mechanical: true, faction: 'isdaris', hotkey: 'S' },
  // Équilibreur 24/11: only from a Portail with its Miniportail.
  archer: { kind: 'unit', name: 'Archer', radius: 0.375, requires: { miniportail: 1 }, faction: 'isdaris', hotkey: 'A' },
  creature: { kind: 'unit', name: 'Créature', radius: 0.3, ability: 'enfouissement', faction: 'isdaris', hotkey: 'C' },
  druide: { kind: 'unit', name: 'Druide', radius: 0.375, requires: { laboratoire: 1 }, abilities: ['double', 'concentration', 'silence'], passives: ['singularite'], faction: 'isdaris', hotkey: 'D' },
  // Mod: « Sombre ». Shield 70 instead of the mod's 210: it still one-shots workers, but 4 auxiliaires win once it is detected.
  assassin: { kind: 'unit', name: 'Assassin', radius: 0.375, cloaked: true, requires: { autel: 1 }, ability: 'chocmental', passives: ['dansesoldat'], faction: 'isdaris', hotkey: 'X' },
  obelisque: { kind: 'building', name: 'Obélisque', size: 4, builds: Object.keys(BALANCE.rules.materialisation.cooldown), trains: ['moissonneur'], researches: ['cercle1', 'cercle2'], dropoff: true, warp: true, ability: 'rappel', abilities: ['bouclierplasma'], faction: 'isdaris', hotkey: 'O' }, // Cercle d'énergie here (équilibreur 24/11)
  emetteur: { kind: 'building', name: 'Émetteur', size: 2, warp: true, morphs: ['pylonesanglant', 'deflecteur'], faction: 'isdaris', hotkey: 'E' },
  // Notice: an Émetteur turned « Déflecteur »: an aura of invisibility over the allied infantry and vehicles round it.
  deflecteur: { kind: 'building', name: 'Déflecteur', size: 2, requires: { orbecommandement: 1 }, warp: true, morphOnly: true, passives: ['voiledeflecteur'], faction: 'isdaris', hotkey: 'D' },
  // Mod: an Émetteur turned into a « Pylône sanglant » (annihilateur de matière: 200 every 6.6 s, range 10, ground only).
  // The mod asks for an Orbe de commandement, not in the game yet: a Nano-assembleur stands in.
  pylonesanglant: { kind: 'building', name: 'Pylône sanglant', size: 2, requires: { orbecommandement: 1 }, warp: true, morphOnly: true, faction: 'isdaris', hotkey: 'P' },
  reservepsy: { kind: 'building', name: 'Réserve psy', size: 2, warp: true, needsPower: true, abilities: ['autorecharge'], faction: 'isdaris', hotkey: 'P' },
  portail: {
    kind: 'building', name: 'Portail', size: 3, trains: ['archer', 'creature', 'druide', 'assassin'], warp: true, needsPower: true, faction: 'isdaris', hotkey: 'T',
    researches: ['miniportail', 'cuvegenetique', 'laboratoire', 'portailatk1', 'portailatk2', 'portailatk3', 'portailarmor1', 'portailarmor2', 'portailarmor3', 'enfouissement', 'silence'],
  },
  recepteur: { kind: 'building', name: 'Récepteur', size: 3, warp: true, morphs: ['recepteurarme'], faction: 'isdaris', hotkey: 'R' },
  // Mod: « Récepteur armé », the Récepteur with a plasma arc (as the Orbe's), still drawing energy.
  recepteurarme: { kind: 'building', name: 'Récepteur armé', size: 3, warp: true, morphOnly: true, faction: 'isdaris', hotkey: 'A' },
  // Mod: « Orbe plasmique ».
  orbe: { kind: 'building', name: 'Orbe plasma', size: 2, warp: true, needsPower: true, ability: 'redeploiement', passives: ['detecteurorbe'], faction: 'isdaris', hotkey: 'B' },
  /** Redéploiement: an Orbe plasma on the move; it does not shoot until set down again. */
  // Équilibreur 26/11: once materialised, the Orbe plasma floats, always free to move at 0.2, and keeps its Redéploiement.
  orbemob: { kind: 'unit', name: 'Orbe plasma', radius: 0.9, mechanical: true, ability: 'redeploiement', passives: ['detecteurorbe'], faction: 'isdaris', hotkey: 'B' },
  // Mod: « Nano-assembleur » (needs a gateway), here making the Chasseur Discobole (its red upgrade in the mod).
  nanoassembleur: {
    kind: 'building', name: 'Psycho-assembleur', size: 3, requires: { portail: 1 }, trains: ['droneprotecteur', 'discobole', 'baliste', 'espion', 'chimere', 'dragon', 'voyageur', 'behemoth'], warp: true, needsPower: true, faction: 'isdaris', hotkey: 'N',
    researches: ['assembleur', 'balise', 'totem', 'assembleuratk1', 'assembleuratk2', 'assembleuratk3', 'assembleurarmor1', 'assembleurarmor2', 'assembleurarmor3', 'disque', 'manteau', 'feucirculaire'],
  },
  // Notice: « Orbe de commandement », the fourth major building, for large battles: shields research, and its extensions.
  orbecommandement: {
    kind: 'building', name: 'Orbe de commandement', size: 3, requires: { nanoassembleur: 1 }, warp: true, needsPower: true, ability: 'observatoire', faction: 'isdaris', hotkey: 'C',
    researches: ['autel', 'pyramide', 'observatoire', 'bouclier1', 'bouclier2', 'bouclier3', 'robots', 'chocmental', 'boostgenetique', 'teleportrapide', 'canonlourd', 'dephasage', 'renvoi', 'omniscience'],
  },
  // Notice: « Trône d'Altar Sargon », the last major building: Béhémoths, and the ultimate powers of its extensions.
  trone: {
    kind: 'building', name: "Trône d'Altar Sargon", size: 4, requires: { orbecommandement: 1 }, warp: true, needsPower: true, unique: true, abilities: ['canonorbital', 'portedephasage', 'transfertgroupe', 'murenergie'], faction: 'isdaris', hotkey: 'A',
    researches: ['relais', 'porte', 'concentrateur'],
  },
  // Mod: disque de plasma, 40 (30 against massive targets and buildings).
  discobole: { kind: 'unit', name: 'Chasseur Discobole', radius: 0.5, mechanical: true, requires: { assembleur: 1 }, ability: 'teleport', passives: ['disquetournoyant'], faction: 'isdaris', hotkey: 'D' },
  // Notice: « Baliste plasma », a levitating ion cannon, slower but tougher than the Porte-disques (mod « Baliste »).
  baliste: { kind: 'unit', name: 'Baliste plasma', radius: 0.6, mechanical: true, requires: { assembleur: 1 }, ability: 'feucirculaire', faction: 'isdaris', hotkey: 'B' },
  // Notice: « Espion », an unarmed scout that detects hidden units and opens time corridors (mod « Prisme »).
  espion: { kind: 'unit', name: 'Espion', radius: 0.4, flying: true, mechanical: true, requires: { balise: 1 }, ability: 'couloir', abilities: ['ciblage'], faction: 'isdaris', hotkey: 'E' },
  // Notice: « Dragon », the Chimère made for space battles: plasma concentrators against flyers only, long range.
  dragon: { kind: 'unit', name: 'Dragon', radius: 0.5, flying: true, mechanical: true, requires: { balise: 1, pyramide: 1 }, faction: 'isdaris', hotkey: 'G' }, // no Téléportation (équilibreur 24/11)
  // Notice: « Voyageur », an unarmed flying generator: detects, recharges shields, cloaks, teleports, reflects.
  voyageur: { kind: 'unit', name: 'Voyageur', radius: 0.7, flying: true, mechanical: true, requires: { totem: 1 }, abilities: ['manteau', 'teleportgroupe', 'renvoi', 'autorecharge'], faction: 'isdaris', hotkey: 'V' },
  // Notice: « Béhémoth », a flying fortress with a building's shield and unmatched firepower; it can phase out.
  behemoth: { kind: 'unit', name: 'Béhémoth', radius: 1.1, flying: true, mechanical: true, requires: { balise: 1, trone: 1 }, ability: 'dephasage', faction: 'isdaris', hotkey: 'H' },

  // Équilibreur 24/11 (Isdaris.doc): unarmed, it shields the allies round it; drawn as a small Baliste for now.
  droneprotecteur: { kind: 'unit', name: 'Drone protecteur', radius: 0.4, mechanical: true, passives: ['protection'], faction: 'isdaris', hotkey: 'P' },
  // Mod: « Chimère » (green Nano-assembleur), a flying hunter: ion blaster, 21 a second, air and ground.
  chimere: { kind: 'unit', name: 'Chimère', radius: 0.45, flying: true, mechanical: true, requires: { balise: 1 }, ability: 'teleport', faction: 'isdaris', hotkey: 'C' },
  // Isdaris research (notice). Extensions: built onto one host building each (notice: three per major building).
  miniportail: extension('Miniportail', 'M', 'Le Portail forme deux unités à la fois.', 'portail'),
  cuvegenetique: extension('Cuve génétique', 'U', 'Les Créatures arrivent par deux.', 'portail'),
  laboratoire: extension('Laboratoire', 'L', 'Druides, et recherches de combat de l\'infanterie.', 'portail'),
  ...upgrades('portailatk', 'Attaque portail', 'K', { laboratoire: 1 }, 'isdaris'),
  ...upgrades('portailarmor', 'Blindage portail', 'J', { laboratoire: 1 }, 'isdaris'),
  enfouissement: isd('Enfouissement', 'F', "Les Créatures s'enfouissent, invisibles, et jaillissent quand un ennemi approche.", { laboratoire: 1 }),
  deflagration: isd('Déflagration', 'G', 'Les Druides lancent un éclair de plasma dévastateur.', { laboratoire: 1 }),
  disque: isd('Disque tournoyant', 'Q', 'Chasseurs discoboles : chaque attaque touche aussi les ennemis autour de la cible (15 %).', { totem: 1 }),
  silence: isd('Silence des ions', 'I', "Les Druides empêchent l'usage des capacités dans une zone.", { laboratoire: 1 }),
  assembleur: extension('Assembleur inférieur', 'A', 'Véhicules terrestres : Porte-disques, Baliste plasma.', 'nanoassembleur'),
  balise: extension('Balise', 'L', 'Unités aériennes : Espion, Chimère, Dragon, Béhémoth.', 'nanoassembleur'),
  totem: extension('Totem', 'T', 'Voyageurs, et recherches de combat des véhicules.', 'nanoassembleur'),
  ...upgrades('assembleuratk', 'Attaque assembleur', 'K', { totem: 1 }, 'isdaris'),
  ...upgrades('assembleurarmor', 'Blindage assembleur', 'J', { totem: 1 }, 'isdaris'),
  teleportation: isd('Téléportation', 'P', 'Le Voyageur téléporte un groupe auprès d\'un bâtiment ami.', { totem: 1 }),
  manteau: isd('Manteau', 'O', "Le Voyageur rend invisibles les unités qui l'entourent.", { totem: 1 }),
  feucirculaire: isd('Feu circulaire', 'F', 'La Baliste plasma tire sur tous les ennemis autour d\'elle.', { totem: 1 }),
  couloir: isd('Couloir temporel', 'C', "Deux Espions font passer des unités de l'un à l'autre.", { totem: 1 }),
  autel: extension('Autel', 'A', 'Assassins au Portail, et recherches avancées.', 'orbecommandement'),
  pyramide: extension('Pyramide', 'Y', 'Dragons au Psycho-assembleur, et recherches avancées.', 'orbecommandement'),
  observatoire: extension('Observatoire', 'O', "L'Orbe révèle une très large zone.", 'orbecommandement'),
  ...upgrades('bouclier', 'Bouclier psychique', 'B', undefined, 'isdaris'),
  robots: isd('Robots améliorés', 'R', 'Robots moissonneurs : +2 attaque, +2 armure.'),
  ...upgrades('cercle', "Cercle d'énergie", 'E', undefined, 'isdaris', 2),
  chocmental: isd('Choc mental', 'M', "L'Assassin tétanise un ennemi.", { pyramide: 1 }),
  boostgenetique: isd('Boost génétique', 'G', 'Créatures : plus de PV, de cadence et de vitesse.', { pyramide: 1 }),
  teleportrapide: isd('Téléportation rapide', 'T', 'Porte-disques, Chimères, Dragons : téléportation deux fois plus fréquente.', { autel: 1 }),
  canonlourd: isd('Canon plasma lourd', 'L', 'Baliste plasma : très longue portée.', { autel: 1 }),
  dephasage: isd('Module déphasant', 'D', 'Le Béhémoth se déphase : invulnérable, sans attaquer.', { autel: 1 }),
  renvoi: isd('Sphère de renvoi', 'S', 'Le Voyageur protège un allié qui renvoie une part des dégâts.', { pyramide: 1 }), // équilibreur 24/11
  omniscience: isd('Omniscience', 'N', 'Espions : vision très étendue.', { autel: 1 }),
  relais: extension('Relais de canon orbital', 'R', "Le Trône frappe depuis l'espace un point visé par un Espion.", 'trone'),
  porte: extension('Porte de déphasage', 'P', "Le Trône déphase un groupe d'unités isdaris.", 'trone'),
  concentrateur: extension('Concentrateur énergétique', 'C', "Le Trône dresse un mur d'énergie que rien ne traverse.", 'trone'),

  // ---------------------------------------------------------------- Z (Z.doc, 2010): a nest of metal insects
  // Drones merge into the buildings they raise. The Intelligence centrale (and Suprême), the Pod (2 round it) and the
  // Pod supérieur (13) spread a creep of cables (the Isdaris power field, drawn as cables) that repairs what stands on
  // it. Équilibreur 22/11: every other Z building goes only on the creep and stops working off it; a Pod's add-ons count
  // as on it while their Pod stands. The Plate-forme and the Tourelle are Pod add-ons, raised by a Pod in one of the 8
  // places round it (équilibreur 22/11), up to 3 a Pod. Socles are unlocked at the Centre de socles and leave the
  // Plate-forme with the weapon chosen when they were queued, for good.
  drone: { kind: 'unit', name: 'Drone', radius: 0.375, worker: true, mechanical: true, faction: 'z', hotkey: 'D' },
  dronecombat: { kind: 'unit', name: 'Drone de combat', radius: 0.375, mechanical: true, faction: 'z', hotkey: 'C' },
  quadripode: { kind: 'unit', name: 'Quadripode', radius: 0.45, mechanical: true, requires: { rquadripode: 1 }, weapons: SOCLE_WEAPONS, faction: 'z', hotkey: 'Q' },
  hexapode: { kind: 'unit', name: 'Hexapode', radius: 0.6, mechanical: true, requires: { rhexapode: 1 }, weapons: SOCLE_WEAPONS, faction: 'z', hotkey: 'H' },
  coleoptere: { kind: 'unit', name: 'Coléoptère', radius: 0.5, flying: true, mechanical: true, requires: { rcoleoptere: 1 }, weapons: FLYER_WEAPONS, faction: 'z', hotkey: 'L' },
  // Z.doc: the large socles, ground (Octopode) and flying (Mastodonte), after the Centre d'optimisation; the Barge,
  // a flying transport for 8 then 12 of supply.
  octopode: { kind: 'unit', name: 'Octopode', radius: 0.9, mechanical: true, requires: { roctopode: 1 }, weapons: SOCLE_WEAPONS, faction: 'z', hotkey: 'O' },
  mastodonte: { kind: 'unit', name: 'Mastodonte', radius: 0.9, flying: true, mechanical: true, requires: { rmastodonte: 1 }, weapons: FLYER_WEAPONS, faction: 'z', hotkey: 'M' },
  barge: { kind: 'unit', name: 'Barge', radius: 0.7, flying: true, mechanical: true, requires: { rbarge: 1 }, faction: 'z', hotkey: 'B' },
  // Z.doc: a levitating spy and support probe, which detects; its abilities wait on its energy (here, cooldowns).
  zespion: { kind: 'unit', name: 'Espion', radius: 0.4, flying: true, mechanical: true, requires: { pod: 1 }, abilities: ['balisez', 'impulsion'], faction: 'z', hotkey: 'E' },
  intelligence: { kind: 'building', name: 'Intelligence centrale', size: 4, trains: ['drone', 'zespion'], dropoff: true, absorbs: true, morphs: ['supreme'], faction: 'z', hotkey: 'I' },
  // Z.doc: drones and spies in 75 % of their time (Production accélérée).
  supreme: { kind: 'building', name: 'Intelligence suprême', size: 4, trains: ['drone', 'zespion'], dropoff: true, absorbs: true, morphOnly: true, requires: { armement: 1, centrerecherche: 1, centresocles: 1 }, faction: 'z', hotkey: 'S' },
  pod: { kind: 'building', name: 'Pod', size: 2, absorbs: true, addons: ['plateforme', 'tourelle'], morphs: ['podsup'], faction: 'z', hotkey: 'P' },
  podsup: { kind: 'building', name: 'Pod supérieur', size: 2, absorbs: true, addons: ['plateforme', 'tourelle'], morphOnly: true, requires: { podsuperieur: 1 }, faction: 'z', hotkey: 'U' },
  // Z.doc: « arme adaptable », like the Tourelle: a weapon bought for it, at level 2 (the Tourelle's machine gun free).
  assimilateur: { kind: 'building', name: 'Assimilateur', size: 3, absorbs: true, needsPower: true, weapons: TOWER_WEAPONS, faction: 'z', hotkey: 'A' },
  plateforme: { kind: 'building', name: 'Plate-forme', size: 3, absorbs: true, addon: true, trains: ['dronecombat', 'quadripode', 'hexapode', 'coleoptere', 'octopode', 'mastodonte', 'barge'], faction: 'z', hotkey: 'F' },
  tourelle: { kind: 'building', name: 'Tourelle', size: 2, absorbs: true, addon: true, weapons: TURRET_WEAPONS, faction: 'z', hotkey: 'T' },
  centresocles: {
    kind: 'building', name: 'Centre de socles', size: 3, absorbs: true, needsPower: true, requires: { pod: 1 }, faction: 'z', hotkey: 'S',
    researches: ['rquadripode', 'rquadripode2', 'rquadripode3', 'rhexapode', 'rhexapode2', 'rcoleoptere', 'rcoleoptere2', 'rcoleoptere3', 'roctopode', 'roctopode2', 'rmastodonte', 'rmastodonte2', 'rbarge', 'rbarge2'],
  },
  armement: {
    kind: 'building', name: "Centre d'armement", size: 3, absorbs: true, needsPower: true, requires: { pod: 1 }, faction: 'z', hotkey: 'R',
    researches: ['laser', 'lanceflammes', 'lanceroquettes', 'rdechiqueteur', 'rjetsonique', 'rlaserlourd', 'rarc', 'rreparateur', 'raccumulateur', 'rcanonx04'],
  },
  centrerecherche: {
    kind: 'building', name: 'Centre de recherche', size: 3, absorbs: true, needsPower: true, requires: { pod: 1 }, faction: 'z', hotkey: 'C',
    researches: ['zproxi1', 'zproxi2', 'zproxi3', 'zdist1', 'zdist2', 'zdist3', 'zblindage1', 'zblindage2', 'zblindage3', 'titane', 'deploiement', 'sonderobuste', 'podsuperieur', 'impulsion', 'invistemp', 'megaespion'],
  },
  optimisation: { kind: 'building', name: "Centre d'optimisation", size: 3, absorbs: true, needsPower: true, requires: { supreme: 1 }, researches: ['optimisationp'], faction: 'z', hotkey: 'O' },
  // Z.doc: sells support kits anywhere on the battlefield; one per player (its Canon IEM gone, équilibreur 22/11).
  centrek: {
    kind: 'building', name: 'Centre K', size: 3, absorbs: true, unique: true, needsPower: true, requires: { optimisation: 1 }, faction: 'z', hotkey: 'K',
    abilities: ['kitdetection', 'kitinvisibilite', 'kitreparateur', 'kitpatte'],
  },
  rquadripode: research('Socle du Quadripode', 'Q', 'Débloque le socle Quadripode.', undefined, 'z'),
  rhexapode: research("Socle de l'Hexapode", 'H', 'Débloque le socle Hexapode.', { centrerecherche: 1 }, 'z'),
  rcoleoptere: research('Socle du Coléoptère', 'L', 'Débloque le socle Coléoptère.', { supreme: 1 }, 'z'),
  roctopode: research("Socle de l'Octopode", 'O', 'Débloque le socle Octopode.', { supreme: 1, optimisation: 1 }, 'z'),
  roctopode2: tier('roctopode', 'Octopode', 2, 'O'),
  rmastodonte: research('Socle du Mastodonte', 'M', 'Débloque le socle Mastodonte.', { supreme: 1, optimisation: 1 }, 'z'),
  rmastodonte2: tier('rmastodonte', 'Mastodonte', 2, 'M'),
  rbarge: research('Socle de la Barge', 'B', 'Débloque la Barge, socle volant de transport.', { supreme: 1 }, 'z'),
  rbarge2: tier('rbarge', 'Barge', 2, 'B'),
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
  sonderobuste: research('Sonde robuste', 'S', 'Points de vie des drones et des drones de combat +25.', { supreme: 1 }, 'z'),
  impulsion: research('Impulsion magnétique', 'I', "L'Espion immobilise les unités d'une petite zone 5 s.", undefined, 'z'),
  // Équilibreur (22/11): once researched, every Espion is invisible for good (was a 20 s ability).
  invistemp: research('Invisibilité du métal', 'N', "L'Espion devient invisible en permanence.", { supreme: 1 }, 'z'),
  megaespion: research('Mega-Espion', 'M', "L'Espion gagne 60 PV, 1 de vision et de la vitesse.", undefined, 'z'),
  podsuperieur: research('Pod supérieur', 'U', 'Les Pods peuvent évoluer en Pods supérieurs.', undefined, 'z'),
  laser: research('Laser', 'L', 'Arme laser pour les socles, choisie à leur construction.', undefined, 'z'),
  lanceflammes: research('Lance-flammes', 'F', 'Lance-flammes pour les socles, choisi à leur construction.', undefined, 'z'),
  rdechiqueteur: research('Déchiqueteur', 'D', 'Lame de corps à corps pour les socles (contre les volants sur un socle volant).', undefined, 'z'),
  rjetsonique: research('Jet sonique', 'J', 'Onde qui frappe tout sur sa ligne, alliés compris.', { supreme: 1 }, 'z'),
  // Équilibreur 23/11: the Laser lourd (XC: 69 to 101 by the socle's level, every 3.5 s, 5 to 8 far, air and ground).
  rlaserlourd: research('Laser lourd', 'H', 'Rayon lourd et lent, air et sol.', { supreme: 1 }, 'z'),
  rarc: research('Arc électrique', 'A', 'Frappe trois cibles à la fois devant le socle.', { supreme: 1 }, 'z'),
  rreparateur: research('Réparateur', 'P', 'Nanites qui réparent les machines alliées proches.', { supreme: 1 }, 'z'),
  raccumulateur: research('Accumulateur', 'C', 'Gel électronique, Balise de vacarme, Nuage de nanites, Gravité alourdie.', { supreme: 1, optimisation: 1 }, 'z'),
  rcanonx04: research('Canon X-04', 'X', 'Artillerie de zone à longue portée pour les socles terrestres.', { supreme: 1, optimisation: 1 }, 'z'),
  // Z Accumulateur: the Balise de vacarme, a small invulnerable-free beacon that deafens living units around it.
  vacarme: { kind: 'building', name: 'Balise de vacarme', size: 1, faction: 'z', hotkey: 'V', morphOnly: true },
  lanceroquettes: research('Lance-roquettes', 'R', 'Lance-roquettes pour les socles, contre les machines et les bâtiments.', undefined, 'z'),

  // ---------------------------------------------------------------- Dieux (notice 1.2-1): gods that summon their armies
  // The gods stand in for production buildings: building-sized, unique, summoned at the Porte d'Asgaard, each summons
  // its own troops at its feet. Gaïa (given at the start, back by herself when she falls) calls the buildings down:
  // they materialise by themselves. Esprits harvest. V1: the first rank of gods (docs/camp-dieux.md).
  esprit: { kind: 'unit', name: 'Esprit', radius: 0.35, worker: true, builder: false, faction: 'dieux', hotkey: 'E' },
  gaia: { kind: 'unit', name: 'Gaïa', radius: 2.0, builder: true, builds: ['asgaard', 'branche', 'antre', 'puitsdivin', 'temple', 'primordial'], trains: ['esprit'], unique: true, abilities: ['teleportgaia'], faction: 'dieux', hotkey: 'G' },
  thor: { kind: 'unit', name: 'Thor', radius: 1.7, trains: ['nain'], unique: true, abilities: ['jormungand'], ability: 'courroux', faction: 'dieux', hotkey: 'T' },
  apollon: { kind: 'unit', name: 'Apollon', radius: 1.4, trains: ['minotaure'], unique: true, abilities: ['lumiereardente', 'tempetezeus'], ability: 'pluiedefeu', faction: 'dieux', hotkey: 'A' },
  seth: { kind: 'unit', name: 'Seth', radius: 1.7, trains: ['sphinx'], unique: true, abilities: ['jetdesable', 'amonra'], ability: 'tempete', faction: 'dieux', hotkey: 'S' },
  // Second rank (notice): two first-rank gods standing open it. Odin's war aura and Athéna's protection aura are
  // passive (rules.auraguerre, rules.auraprotection).
  odin: { kind: 'unit', name: 'Odin', radius: 1.7, passives: ['auraguerre'], trains: ['nain', 'corbeau', 'drake'], unique: true, abilities: ['jormungand'], ability: 'foudre', requiresAny: { of: ['thor', 'apollon', 'seth'], count: 2 }, faction: 'dieux', hotkey: 'O' },
  athena: { kind: 'unit', name: 'Athéna', radius: 1.5, passives: ['auraprotection'], trains: ['minotaure', 'elembase'], unique: true, abilities: ['chouette', 'tempetezeus'], ability: 'cridegueurre', requiresAny: { of: ['thor', 'apollon', 'seth'], count: 2 }, faction: 'dieux', hotkey: 'H' },
  isis: { kind: 'unit', name: 'Isis', radius: 1.5, trains: ['sphinx', 'pretresse'], unique: true, abilities: ['autosoin', 'soinsdivins', 'resurrection', 'amonra'], requiresAny: { of: ['thor', 'apollon', 'seth'], count: 2 }, faction: 'dieux', hotkey: 'I' },
  /** Odin's ravens: fast flying scouts, invisible, that see the invisible. */
  corbeau: { kind: 'unit', name: 'Corbeau', radius: 0.35, flying: true, beast: true, cloaked: true, faction: 'dieux', hotkey: 'C' },
  /** A slow flying beast, very hardy, breathing fire on an area. */
  drake: { kind: 'unit', name: 'Drake', radius: 0.9, flying: true, beast: true, faction: 'dieux', hotkey: 'D' },
  /** A small shapeshifter (notice): fire form, which also shoots flyers; it changes form at will (Mutation), and two
   * merge into a Golem. */
  /** Notice: summoned « faible et chétive », then turned into one of the four forms (XC.doc 2008: its figures). */
  elembase: { kind: 'unit', name: 'Élémentaire', radius: 0.35, abilities: ['formefeu', 'formeeau', 'formeterre', 'formeair', 'fusion'], faction: 'dieux', hotkey: 'E' },
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
  frigg: { kind: 'unit', name: 'Frigg', radius: 1.4, builds: ['artefacterie'], trains: ['nain', 'walkyrie'], unique: true, abilities: ['soumission', 'voile', 'jormungand'], requiresAny: { of: ['odin', 'athena', 'isis'], count: 2 }, faction: 'dieux', hotkey: 'F' },
  hades: { kind: 'unit', name: 'Hadès', radius: 1.6, trains: ['minotaure', 'titan'], unique: true, abilities: ['rayonmort', 'voyage', 'tempetezeus'], requiresAny: { of: ['odin', 'athena', 'isis'], count: 2 }, faction: 'dieux', hotkey: 'D' },
  osiris: { kind: 'unit', name: 'Osiris', radius: 1.7, builds: ['fontaine'], trains: ['sphinx', 'immortel'], unique: true, abilities: ['amonra'], ability: 'nuee', requiresAny: { of: ['odin', 'athena', 'isis'], count: 2 }, faction: 'dieux', hotkey: 'R' },
  /** Frigg's flying warrior: a double sword thrown from the air; vanishes a while. */
  walkyrie: { kind: 'unit', name: 'Walkyrie', radius: 0.45, flying: true, ability: 'camouflagewalkyrie', faction: 'dieux', hotkey: 'W' },
  /** Hadès's demigod: lightning from afar, razes buildings. */
  titan: { kind: 'unit', name: 'Titan', radius: 0.9, faction: 'dieux', hotkey: 'T' },
  /** Osiris's giant mummy: a melee beyond match, very slow, a toxic cloud round it (rules.putride, level 1). */
  immortel: { kind: 'unit', name: 'Immortel', radius: 0.8, faction: 'dieux', hotkey: 'I' },
  /** Hadès's Armée des enfers: ghosts that cannot be hurt, for a while. */
  fantome: { kind: 'unit', name: 'Fantôme', radius: 0.4, lifetime: 20, faction: 'dieux', hotkey: 'F' },
  /** Isis's priestess: heals, no attack; Dissipation. */
  pretresse: { kind: 'unit', name: 'Prêtresse', radius: 0.35, abilities: ['autosoin', 'dissipation'], faction: 'dieux', hotkey: 'E' },
  nain: { kind: 'unit', name: 'Nain', radius: 0.4, faction: 'dieux', hotkey: 'N' },
  minotaure: { kind: 'unit', name: 'Minotaure', radius: 0.6, faction: 'dieux', hotkey: 'M' },
  // Biological and armoured (BA); a heavy machine while turned to stone (équilibreur 2026-11-22).
  sphinx: { kind: 'unit', name: 'Sphinx', radius: 0.6, ability: 'statue', faction: 'dieux', hotkey: 'X' },
  asgaard: { kind: 'building', name: "Porte d'Asgaard", size: 4, trains: ['thor', 'apollon', 'seth', 'odin', 'athena', 'isis', 'frigg', 'hades', 'osiris'], dropoff: true, warp: true, faction: 'dieux', hotkey: 'A' },
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
  primordial: { kind: 'building', name: 'Temple primordial', size: 4, warp: true, unique: true, faction: 'dieux', hotkey: 'R' },
  /** Avatar of Jörmungand (ultimate): a giant serpent for a while; eats the dead to heal. */
  jormungandr: { kind: 'unit', name: 'Avatar de Jörmungand', radius: 1.2, lifetime: 60, faction: 'dieux', hotkey: 'J' },
  /** Frigg's Artefacterie (unique): the gods buy improvements wherever they are (ARTEFACTS). */
  artefacterie: { kind: 'building', name: 'Artefacterie', size: 3, warp: true, unique: true, requires: { frigg: 1 }, abilities: ARTEFACTS, faction: 'dieux', hotkey: 'R' },
  antre: { kind: 'building', name: 'Antre', size: 4, dropoff: true, warp: true, faction: 'dieux', hotkey: 'N' },
  // Balance designer 2026-11-22: 4 Esprits inside to run, a quarter of the yield each.
  puitsdivin: { kind: 'building', name: 'Puits', size: 3, warp: true, bunker: 4, faction: 'dieux', hotkey: 'P' },
  temple: {
    kind: 'building', name: 'Temple de vénération', size: 3, warp: true, requiresAny: { of: ['thor', 'seth', 'apollon'], count: 1 }, faction: 'dieux', hotkey: 'V',
    researches: ['dmelee1', 'dmelee2', 'dmelee3', 'dranged1', 'dranged2', 'dranged3', 'darmor1', 'darmor2', 'darmor3', 'celerite', 'offrandes', 'coupuissant', 'peauroc', 'prescience', 'drakegeant', 'auraputride', 'deracinement'],
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
  auraputride: research('Aura putride', 'I', 'Immortels : +100 PV, plus rapides, et une aura qui ronge les ennemis vivants au corps à corps.', { osiris: 1 }, 'dieux'),
  offrandes: research('Offrandes', 'O', 'Les dieux cessent de compter dans la population.', undefined, 'dieux'),
  // Artefacterie (notice, Frigg): a god buys up to 4 improvements, where it stands, the same one several times if it likes.
  artforce: research('Force', 'G', 'Le dieu frappe plus fort.', { artefacterie: 1 }, 'dieux'),
  artresistance: research('Résistance', 'J', 'Le dieu gagne de l’armure.', { artefacterie: 1 }, 'dieux'),
  artagilite: research('Agilité', 'K', 'Le dieu frappe plus vite.', { artefacterie: 1 }, 'dieux'),
  artvitesse: research('Vitesse', 'Q', 'Le dieu se déplace plus vite.', { artefacterie: 1 }, 'dieux'),
  // A god's next level, queued at the god itself; its price and time are the god's own (UnitDef.levels).
  niveau: research('Niveau divin', 'L', 'Le dieu monte d’un niveau : vie, armure, dégâts et vitesse ; il invoque et bâtit plus vite.', undefined, 'dieux'),

  minerai: { kind: 'resource', name: 'Champ de minerai', size: 1 },
  // 7500 of energy in a well (équilibreur 24/11), then dry.
  puits: { kind: 'resource', name: 'Puits énergétique', size: 3 },
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

/** A Z socle research's next level (Z.doc): the socle may evolve into this tier in the field. Named « Socle du … » so a
 * research never reads as the unit it unlocks (« Requiert : Quadripode » on the Quadripode's own button). */
function tier(line: string, socle: string, level: number, hotkey: string): object {
  const of = socle === 'Barge' ? 'de la ' : /^[AEIOUH]/.test(socle) ? "de l'" : 'du ';
  return { kind: 'upgrade', name: `Socle ${of}${socle} T${level}`, effect: `Les ${socle}s peuvent évoluer en T${level} sur le terrain.`, line, level, faction: 'z', hotkey };
}

/** An Isdaris extension (notice): built onto one major building of `host`'s type, its own; unlocks units, research or a power there. */
function extension(name: string, hotkey: string, effect: string, host: string): object {
  return { ...research(`Extension : ${name}`, hotkey, effect, undefined, 'isdaris'), host };
}
/** An Isdaris research (notice). */
function isd(name: string, hotkey: string, effect: string, requires?: Record<string, number>): object {
  return research(name, hotkey, effect, requires, 'isdaris');
}

/** Z support kits (Centre K, Z.doc), as bits of an entity's `support`. */
export const KIT = { detection: 1, invisibilite: 2, reparateur: 4, patte: 8 } as const;

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
  /** Z Réparateur (équilibreur 22/11): hp a second it gives back to machines and buildings, and within what range, by the
   * level of its socle (1 to 4), for no energy. */
  heal?: number[];
  healRange?: number[];
  /** Only ground socles take it (Canon X-04). */
  ground?: boolean;
  /** Z Accumulateur (Z.doc): the energy the weapon gives its socle, by level, and regained a second. */
  mana?: { max: number[]; regen: number };
  cost: Cost;
  /** Research needed first. */
  research?: string;
}
interface WeaponStats {
  /** Z.doc, levels 1 to 4: the damage against each class (BL, BA, M, MM, S, H). */
  levels: number[][];
  range?: number;
  /** Range by level, when it grows with it (Lance-roquettes). */
  ranges?: number[];
  cooldown: number;
  air?: boolean;
  /** Déchiqueteur: a melee weapon that hits flyers instead when a flying socle carries it. */
  airIfFlying?: boolean;
  splash?: number;
  line?: boolean;
  flame?: boolean;
  targets?: number;
  selfHit?: boolean;
  heal?: number[];
  healRange?: number[];
  mana?: { max: number[]; regen: number };
  cost: Cost;
}
const WEAPON_STATS = BALANCE.weapons as unknown as Record<string, WeaponStats>;
/** A Z weapon at a level (1 to 4: the socle's), with Z.doc's damage against each class. */
export function weaponAt(key: string, level: number, flying = false): Attack | undefined {
  const w = WEAPON_STATS[key];
  if (!w.levels.length) return undefined;
  const vs = w.levels[Math.min(w.levels.length, Math.max(1, level)) - 1];
  const a: Attack = { damage: vs[0], vs, range: w.ranges ? w.ranges[Math.min(w.ranges.length, Math.max(1, level)) - 1] : w.range!, cooldown: w.cooldown };
  if (w.air !== undefined) a.air = w.air;
  if (w.airIfFlying && flying) {
    a.air = true;
    a.ground = false;
  }
  if (w.splash) a.splash = w.splash;
  if (w.line) a.line = true;
  if (w.flame) a.flame = true;
  if (w.targets) a.targets = w.targets;
  if (w.selfHit) a.selfHit = true;
  return a;
}
const weaponDef = (key: string, name: string, hotkey: string, research?: string, ground?: boolean): WeaponDef => ({
  name, hotkey, research, ground, attack: weaponAt(key, 1), cost: WEAPON_STATS[key].cost, heal: WEAPON_STATS[key].heal, healRange: WEAPON_STATS[key].healRange, mana: WEAPON_STATS[key].mana,
});
export const WEAPONS: Record<string, WeaponDef> = {
  laser: weaponDef('laser', 'Laser', 'L', 'laser'),
  flammes: weaponDef('flammes', 'Lance-flammes', 'F', 'lanceflammes'),
  roquettes: weaponDef('roquettes', 'Lance-roquettes', 'R', 'lanceroquettes'),
  dechiqueteur: weaponDef('dechiqueteur', 'Déchiqueteur', 'D', 'rdechiqueteur'),
  jetsonique: weaponDef('jetsonique', 'Jet sonique', 'J', 'rjetsonique'),
  laserlourd: weaponDef('laserlourd', 'Laser lourd', 'H', 'rlaserlourd'),
  arc: weaponDef('arc', 'Arc électrique', 'A', 'rarc'),
  canonx04: weaponDef('canonx04', 'Canon X-04', 'X', 'rcanonx04', true),
  reparateur: weaponDef('reparateur', 'Réparateur', 'P', 'rreparateur'),
  accumulateur: weaponDef('accumulateur', 'Accumulateur', 'C', 'raccumulateur'),
};
/** Z weapons that bring abilities rather than an attack (Accumulateur, Z.doc). */
export const WEAPON_ABILITIES: Record<string, string[]> = { accumulateur: ['gel', 'vacarme', 'cone', 'gravite'] };

const STATS: Record<string, object> = BALANCE.units;
export const DEFS = Object.fromEntries(
  Object.entries(BASE).map(([type, d]) => [type, { ...d, ...STATS[type], ...((d as { line?: string }).line === '' ? { line: type } : {}) }]),
) as Record<string, Def>;
// Équilibreur 22/11 (proposition 1, provisional): the Pod's creep of 2, counted from its edge (from its centre then: 2
// plus half its size) or, `fromEdge` false, from its centre.
// Équilibreur 23/11 and 24/11: every living unit heals slowly by itself (Humains and Dieux 0.5 hp a second, the Golem
// excepted; the Isdaris 1 every 8 s), unless its own rate is set (the Créature: the Humains' rate).
for (const [type, d] of Object.entries(DEFS)) {
  const R = BALANCE.rules.bioRegen as Record<string, number | string[]>;
  const u = d as UnitDef;
  if (d.kind === 'unit' && !u.mechanical && u.regen === undefined && typeof R[u.faction] === 'number' && !(R.not as string[]).includes(type)) u.regen = R[u.faction] as number;
}
(DEFS.pod as BuildingDef).power =BALANCE.rules.z.podCreep.radius + (BALANCE.rules.z.podCreep.fromEdge ? (DEFS.pod as BuildingDef).size / 2 : 0);

/** What a unit costs with its weapon (Z socles), or alone. */
export function withKit(def: { cost: Cost }, weapon?: string): Cost {
  const kit = weapon ? WEAPONS[weapon]?.cost : undefined;
  return kit ? { minerals: def.cost.minerals + kit.minerals, energy: def.cost.energy + kit.energy } : def.cost;
}

/** Types drawn with another's model and icon until they get their own (render only). */

/** The main buildings (the balancer, 2026-11-22: 4x4, not within 3 tiles of a mineral field), their in-place growths
 * too; on the map, each in the 5x5 slot the maps keep for it, at the corner farthest from the minerals. */
export const HQ_TYPES = ['conseil', 'grandconseil', 'obelisque', 'intelligence', 'supreme', 'asgaard'];
export const HQ_MINERAL_GAP = 3;

export const LOOKS: Record<string, string> = { elembase: 'elementaire', fantome: 'esprit', furieux: 'protecteur', branchemob: 'branche', protecteurmob: 'protecteur', furieuxmob: 'protecteur', orbemob: 'orbe', casernevolante: 'caserne', casernevol: 'casernevolante', dirigeable: 'bourdon', minealchimique: 'minechimique', grandconseil: 'conseil', grandealchimisterie: 'alchimisterie', silo: 'grenier', cadavre: 'serf', supreme: 'intelligence', podsup: 'pod' };
/** Size of those stand-in models against the original's. */
export const LOOK_SCALE: Record<string, number> = { dirigeable: 1.3, silo: 1.15, belluaire: 1.3, ankylosaure: 1.35, creaturium: 1.3, elembase: 0.7, grandconseil: 1.1, portail: 1.18, furieux: 1.2, supreme: 1.1, podsup: 1.15 };

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
    // Équilibreur 2026-11-22: no « advanced » list for the Dieux, Gaïa's buildings in one.
    advanced: [],
    army: Object.entries(BALANCE.ai.army.dieux),
  },
};
