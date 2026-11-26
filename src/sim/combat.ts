/** Combat: weapons and their upgrades, target search, attacks, damage, regeneration. */
import BALANCE from '../balance.json';
import { type Attack, type BuildingDef, CLASSES, type DamageClass, DEFS, reaches, SKIN_REDUCTION, spell, type UnitDef, type TierStats, type UpgradeLine, weaponAt, WEAPONS, ABILITIES } from '../data';
import { FP, dist, idiv, speedPerTick, ticks, tileOf, toFp } from './fixed';
import { type Order, flies, type Entity, type World } from './world';

/** A target's armour class; a Sphinx turned to stone is a heavy machine (équilibreur 2026-11-22). */
export const clsOf = (t: Entity): DamageClass => (t.statue > 0 ? 'MM' : ((t.def as UnitDef | BuildingDef).cls ?? 'BL'));

/** A machine for healing: mechanical, or of a machine's class (the Golem, the Titan, a Sphinx turned to stone: MM). */
export const machineLike = (t: Entity): boolean => !!(t.def as UnitDef).mechanical || clsOf(t) === 'M' || clsOf(t) === 'MM';
/** What a Soin heals (healers, Soins divins, the Fontaine): a living unit that is no machine, checked at each pulse. */
export const healable = (t: Entity): boolean => t.def.kind === 'unit' && t.hp > 0 && !machineLike(t);

/** Can this attack strike that target: in the air or not, and of a class it may hit. */
export const hits = (a: Attack, t: Entity): boolean => reaches(a, t.def.kind === 'unit' && flies(t)) && (!a.only || a.only.includes(clsOf(t)));

/** Reach of the cell index beyond a search range, in tiles: the widest building's half plus a tick's walk. */
const CELL_MARGIN = 4;

/** Near one of its player's finished Conseils (or the Grand Conseil). */
/** A Char Pégase's attack in the air: flyers only, at the balancer's rate (2026-11-22: 2.3 s), one object per attack. */
const ALOFT = new WeakMap<Attack, Attack>();
function aloft(a: Attack): Attack {
  let up = ALOFT.get(a);
  if (!up) ALOFT.set(a, (up = { ...a, air: true, ground: false, cooldown: BALANCE.rules.upgrades.pegaseAir.cooldown }));
  return up;
}

/** The shooters Armes chimiques gives a zone to. */
const CHEMICAL = ['alchimiste', 'cuve', 'tour'];

export function nearCouncil(this: World, e: Entity): boolean {
  const r = toFp(BALANCE.rules.upgrades.conseilAura.radius);
  for (const b of this.listed().councils) if (b.owner === e.owner && b.buildLeft === 0 && dist(b.x, b.y, e.x, e.y) <= r) return true;
  return false;
}

/** Which attack upgrade line a weapon follows: Forge melee or ranged (Humans), Portail or Assembleur (Isdaris). */
export function attackLine(this: World, e: Entity, a: Attack): UpgradeLine {
  if (this.players[e.owner].faction === 'isdaris') return (e.def as UnitDef).mechanical ? 'assembleuratk' : 'portailatk';
  // Z.doc: the flame thrower follows Attaque de proximité, like any melee weapon.
  if (this.players[e.owner].faction === 'z') return a.range < 1 || e.kit === 'flammes' ? 'zproxi' : 'zdist';
  return a.range < 1 ? 'melee' : 'ranged';
}

/** Cercle d'énergie: the Obélisques get a stronger shield; Boost génétique: Créatures get hp and speed (2010 sheet). */
export function empower(this: World, u: Entity, type: string): void {
  const U = BALANCE.rules.upgrades;
  if (type.startsWith('cercle') && u.type === 'obelisque') {
    const extra = U.cercleShield;
    u.maxShield += extra;
    u.shield += extra;
    this.unlist(); // the lists of what carries a shield (World.listed)
  } else if ((type === 'drakegeant' && u.type === 'drake') || (type === 'auraputride' && u.type === 'immortel')) {
    // Drake géant, Aura putride: more health, the wounds kept (the Immortel's speed is read in baseSpeed).
    const extra = type === 'drakegeant' ? idiv((u.def as UnitDef).hp * U.drakegeant.hp, 100) : U.auraputride.hp;
    u.maxHp += extra;
    u.hp += extra;
    if (type === 'auraputride' && u.boost === 0) u.speed = this.baseSpeed(u);
  } else if (type === 'boostgenetique' && u.type === 'creature') {
    u.maxHp += U.boost.hp;
    u.hp += U.boost.hp;
    if (u.boost === 0) u.speed = this.baseSpeed(u);
  }
}

/** Armour from research: Armure infanterie for foot soldiers, Blindage véhicules for machines, Peau épaisse for saurians, and unit ones. */
export function armorBonus(this: World, t: Entity): number {
  const d = t.def as UnitDef;
  const faction = this.players[t.owner].faction;
  let bonus = faction === 'z' ? (t.def.kind === 'building' ? this.level(t.owner, 'titane') * BALANCE.rules.z.titaneArmor : this.level(t.owner, 'zblindage')) : faction === 'dieux' ? (d.levels ? 0 : this.level(t.owner, 'armor')) : faction === 'isdaris' ? this.level(t.owner, d.mechanical ? 'assembleurarmor' : 'portailarmor') : this.level(t.owner, d.mechanical ? 'vehicles' : d.beast ? 'skin' : 'armor');
  if (t.type === 'moissonneur') bonus += this.level(t.owner, 'robots') * BALANCE.rules.upgrades.robots;
  if (t.type === 'legionnaire') bonus += this.level(t.owner, 'cuirasse');
  // Peau de roc (the balancer, 2026-11-22): +5 armour, shown with the rest.
  if (t.skin > 0) bonus += SKIN_REDUCTION;
  if (t.type === 'pegase' && this.level(t.owner, 'charlourd')) bonus += BALANCE.rules.upgrades.charlourd.armor;
  if (d.levels) bonus += d.levels.armor[t.lvl - 1] - d.armor;
  bonus += t.arts.filter((a) => a === 'artresistance').length * BALANCE.rules.upgrades.artefacts.resistance;
  if (t.statue > 0) bonus += BALANCE.rules.upgrades.statue.armor;
  // Athéna's protection aura, the strongest of her side's in reach.
  const A = BALANCE.rules.upgrades.auraprotection;
  let aura = 0;
  if (faction === 'dieux') for (const g of this.listed().athenas) if (g.owner === t.owner && g.hp > 0 && dist(g.x, g.y, t.x, t.y) <= toFp(A.radius[g.lvl - 1])) aura = Math.max(aura, A.armor[g.lvl - 1]);
  // Z socles: the armour their tier adds (Z.doc).
  if (t.tier > 1) bonus += d.tiers![t.tier - 2].armor - d.armor;
  return bonus + aura;
}

/** A Z socle's next tier, if it has one. */
export function nextTier(this: World, e: Entity): TierStats | undefined {
  return (e.def as UnitDef).tiers?.[e.tier - 1];
}

/** A Z socle done evolving: one tier up, with the hit points it gains (its wounds kept), its speed and armour. */
export function evolved(this: World, e: Entity): void {
  const next = this.nextTier(e)!;
  const gain = next.hp - (e.tier > 1 ? (e.def as UnitDef).tiers![e.tier - 2].hp : (e.def as UnitDef).hp);
  e.tier++;
  e.maxHp += gain;
  e.hp += gain;
  e.speed = this.baseSpeed(e);
  e.cooldown = 0;
  this.say(e.owner, `Évolution terminée : ${e.def.name} T${e.tier}.`, 'done');
}

/** Extra range from research (Canons sciés: Auxiliaires; Trébuchet intégré: Ankylosaures against buildings). */
export function rangeBonus(this: World, e: Entity, t?: Entity): number {
  if (e.type === 'ankylosaure' && t?.def.kind === 'building' && this.level(e.owner, 'trebuchet')) return BALANCE.rules.upgrades.trebuchetRange;
  if (e.type === 'baliste' && this.level(e.owner, 'canonlourd')) return BALANCE.rules.upgrades.canonlourdRange;
  return e.type === 'auxiliaire' ? this.level(e.owner, 'canonsscies') : 0;
}

/** The weapon a unit fights with now: Scarabées get one by research, a Char Pégase in the air shoots only at flyers. */
export function weapon(this: World, e: Entity): Attack | undefined {
  // Double énergétique (fiche « Hallucination », mod): an illusion has no attack.
  if (e.illusion) return undefined;
  return this.ownWeapon(e);
}

/** The weapon a unit fights with, before any kit. */
export function ownWeapon(this: World, e: Entity): Attack | undefined {
  // Z socles: the weapon chosen at the Plate-forme, or the machine gun, as strong as the socle's level.
  // Z Tourelle and Assimilateur: the weapon bought for them, or the Tourelle's machine gun, at their level.
  const level = (e.def as UnitDef | BuildingDef).weaponLevel;
  if (level && (e.kit || e.def.kind === 'unit' || (e.def as BuildingDef).attack)) return weaponAt(e.kit || 'mitrailleuse', level + e.tier - 1, e.def.kind === 'unit' && flies(e));
  if (level) return undefined;
  if (e.type === 'scarabee') return this.level(e.owner, 'scarabeassaut') ? BALANCE.rules.upgrades.scarabeAttack : undefined;
  const a = (e.def as UnitDef | BuildingDef).attack;
  const lv = (e.def as UnitDef).levels;
  if (a && lv?.damage && e.lvl > 1) return levelled(a, lv.damage[e.lvl - 1]);
  return a && e.airborne ? aloft(a) : a;
}

/** A god's attack at a higher level: the same, harder (one object per attack and damage, not one per call). */
const LEVELLED = new Map<Attack, Map<number, Attack>>();
function levelled(a: Attack, damage: number): Attack {
  const by = LEVELLED.get(a) ?? LEVELLED.set(a, new Map()).get(a)!;
  return by.get(damage) ?? by.set(damage, { ...a, damage }).get(damage)!;
}

/** Walking speed per tick out of any boost: a god's that of its level. */
export function baseSpeed(this: World, e: Entity): number {
  const d = e.def as UnitDef;
  // Z socles: the speed of their tier (Z.doc); the Espion with Mega-Espion.
  const mega = e.type === 'zespion' && this.level(e.owner, 'megaespion');
  // Scarabée amélioré (fiche 2010): +0.1 of speed.
  const assault = e.type === 'scarabee' && e.owner >= 0 && this.level(e.owner, 'scarabeassaut') ? BALANCE.rules.upgrades.scarabeSpeed : 0;
  // Boost génétique: the Créature at 3.1 (équilibreur 24/11).
  const genetic = e.type === 'creature' && e.owner >= 0 && this.level(e.owner, 'boostgenetique') ? BALANCE.rules.upgrades.boost.speed : e.type === 'immortel' && e.owner >= 0 && this.level(e.owner, 'auraputride') ? BALANCE.rules.upgrades.auraputride.speed : 0;
  const fast = e.arts.filter((a) => a === 'artvitesse').length * BALANCE.rules.upgrades.artefacts.vitesse;
  const stone = (e.statue > 0 ? BALANCE.rules.upgrades.statue.speed : 100) * (e.chill > 0 ? 100 - BALANCE.rules.upgrades.glace.slow : 100) * this.paceOf(e)[0] / 10000;
  // The Char Pégase in the air (the balancer, 2026-11-22): 2.4.
  const air = e.airborne && e.type === 'pegase' ? BALANCE.rules.upgrades.pegaseAir.speed : 0;
  return speedPerTick(((mega ? d.speed + BALANCE.rules.z.megaEspion.speed : air ? air : d.levels ? d.levels.speed[e.lvl - 1] : e.tier > 1 ? d.tiers![e.tier - 2].speed : d.speed + assault + genetic) * (100 + fast) * stone) / 10000);
}

/** A god goes up a level: more hp (its wounds kept), armour, damage and speed (armour and damage are read at their use). */
export function ascend(this: World, g: Entity): void {
  const lv = (g.def as UnitDef).levels;
  if (!lv || g.lvl >= lv.hp.length) return;
  g.lvl++;
  const extra = lv.hp[g.lvl - 1] - lv.hp[g.lvl - 2];
  g.maxHp += extra;
  g.hp += extra;
  if (g.boost === 0) g.speed = this.baseSpeed(g);
  this.say(g.owner, `${g.def.name} passe au niveau ${g.lvl}.`, 'done');
}

/**
 * Once a second: Osiris's putrid aura (and the Immortel's once Aura putride is researched, at Osiris's first level)
 * hurts the living enemies round him;
 * his Nuée nauséabonde hurts the enemies round him and gives him what it takes; the Fontaine du Nil heals the living
 * allies round it.
 */
export function pulse(this: World, e: Entity): void {
  const U = BALANCE.rules.upgrades;
  // Biological only (équilibreur 26/11): no machine, nor a Golem, Titan or Sphinx in stone (massive mechanical).
  const living = (t: Entity) => t.def.kind === 'unit' && t.hp > 0 && !t.inside && !(t.def as UnitDef).mechanical && clsOf(t) !== 'MM';
  if (e.type === 'osiris' || (e.type === 'immortel' && this.level(e.owner, 'auraputride'))) {
    const dmg = U.putride.damage[e.type === 'osiris' ? e.lvl - 1 : 0];
    for (const t of this.entities.values()) if (living(t) && !flies(t) && this.hostile(t.owner, e.owner) && this.gap(e, t) <= toFp(U.putride.radius)) this.hurt(t, dmg);
  }
  // Gravité alourdie: the enemies in the aura are slowed until a little after the next pulse; out of it, it wears off.
  if (e.gravity > 0) {
    const g = ABILITIES.gravite;
    for (const t of this.entities.values()) {
      if (t.def.kind !== 'unit' || t.hp <= 0 || t.inside || !this.hostile(t.owner, e.owner) || dist(t.x, t.y, e.x, e.y) > toFp(g.radius!)) continue;
      t.heavy = ticks(1) + 1;
      if (t.boost === 0) t.speed = this.baseSpeed(t);
    }
  }
  if (e.swarm > 0) {
    const ab = spell('nuee', e.lvl);
    let taken = 0;
    for (const t of this.entities.values()) {
      if (t.def.kind !== 'unit' || t.hp <= 0 || t.inside || !this.hostile(t.owner, e.owner) || this.gap(e, t) > toFp(ab.radius!)) continue;
      const before = t.hp;
      this.hurt(t, ab.damage!);
      taken += before - Math.max(0, t.hp);
    }
    e.hp = Math.min(e.maxHp, e.hp + taken);
  }
  if (e.statue > 0) e.hp = Math.min(e.maxHp, e.hp + U.statue.regen);
  if (e.type === 'jormungandr' && e.abilityCd === 0) {
    // Festin: it devours a body near it and heals.
    const i = this.corpses.findIndex((c) => dist(c.x, c.y, e.x, e.y) <= 3 * FP);
    if (i >= 0) {
      this.corpses.splice(i, 1);
      e.hp = Math.min(e.maxHp, e.hp + 75);
      e.abilityCd = ticks(7);
    }
  }
  if (e.type === 'fontaine' && e.buildLeft === 0) {
    for (const t of this.entities.values()) if (healable(t) && !t.inside && t.owner === e.owner && t.hp < t.maxHp && dist(t.x, t.y, e.x, e.y) <= toFp(U.fontaine.radius)) t.hp = Math.min(t.maxHp, t.hp + U.fontaine.hp);
  }
}

/** Croissance économique: serfs and the Caserne's soldiers. */
export function grows(this: World, u: Entity): boolean {
  if (u.type === 'drone') return false;
  return u.def.kind === 'unit' && (u.type === 'serf' || !!(DEFS.caserne as BuildingDef).trains?.includes(u.type));
}

/** Raises a unit's hp by the Croissance économique bonus, keeping its wounds. */
export function fortify(this: World, u: Entity): void {
  // Sonde robuste (Z): a flat 25 hp for drones; Mega-Espion: 60 hp and some speed; Croissance économique: a flat 5 hp for Humans (2010 sheet, mod).
  if (u.type === 'zespion') u.speed = this.baseSpeed(u);
  const extra = u.type === 'drone' || u.type === 'dronecombat' ? BALANCE.rules.z.sondeRobusteHp : u.type === 'zespion' ? BALANCE.rules.z.megaEspion.hp : BALANCE.rules.upgrades.croissanceHp;
  u.maxHp += extra;
  u.hp += extra;
}

/** Damage that goes through shields first; armour only protects hp. */
/** Damage taken, and what it really took off (shield and hit points), protections and armour counted. */
export function hurt(this: World, t: Entity, damage: number): number {
  t.lastHit = this.tick;
  if (t.invuln > 0 || t.phased > 0) return 0;
  // Z Gel électronique: a frozen building is unhurt. Nuage de nanites (équilibreur 22/11): allied machines round its
  // caster take half the damage; several clouds over the same spot do not add up.
  if (t.frozen > 0 && t.def.kind === 'building') return 0;
  if (t.def.kind === 'unit' && (t.def as UnitDef).mechanical && this.coned(t)) damage = idiv(damage, 2);
  // Ciblage (équilibreur 24/11): 10 % more on what an Espion marked; a Drone protecteur near: 2 less (one drone counts).
  if (t.marked > 0) damage += idiv(damage * ABILITIES.ciblage.damage!, 100);
  if (t.def.kind === 'unit' && this.guarded(t)) damage = Math.max(1, damage - ABILITIES.protection.damage!);
  // Régénérant (the balancer, 2026-11-22): the host takes 5 % of the damage.
  if (t.ferveur > 0) damage = Math.max(1, idiv(damage * BALANCE.rules.upgrades.regenerantTaken, 100));
  // Bouclier psychique (2010 sheet): +1 to the shield's armour a level.
  if (damage > 0 && t.shield > 0 && t.owner >= 0 && this.players[t.owner]?.faction === 'isdaris') damage = Math.max(1, damage - this.level(t.owner, 'bouclier') * BALANCE.rules.upgrades.bouclierArmor);
  const absorbed = Math.min(t.shield, damage);
  t.shield -= absorbed;
  if (damage > absorbed) {
    // Z buildings too: Blindage de titane (+2, équilibreur 22/11; it was neither applied nor shown before).
    const armor = ('armor' in t.def ? t.def.armor : 0) + (t.owner >= 0 && (t.def.kind === 'unit' || (t.def.kind === 'building' && this.players[t.owner].faction === 'z')) ? this.armorBonus(t) : 0);
    const lost = Math.max(1, damage - absorbed - (absorbed > 0 ? 0 : armor));
    const had = Math.max(0, t.hp);
    t.hp -= lost;
    return absorbed + Math.min(lost, had);
  }
  return absorbed;
}

/** A unit within a Drone protecteur's reach, of the drone's side (the drone itself too). */
export function guarded(this: World, t: Entity): boolean {
  const r = toFp(ABILITIES.protection.radius!);
  for (const g of this.listed().guards) if (g.owner === t.owner && g.hp > 0 && !g.inside && dist(g.x, g.y, t.x, t.y) <= r) return true;
  return false;
}

/** Shields recharge a few seconds after the last hit (at once, and faster, near a psy reserve); some units heal. */
export function regenerate(this: World, e: Entity): void {
  if (e.hp <= 0) return;
  if (e.poison > 0 && --e.poison % ticks(1) === 0) e.hp -= BALANCE.rules.upgrades.poison.damage;
  if (e.hp <= 0) return; // killed by the poison: not healed back this tick (Codex 26/11)
  // A Sphinx in stone heals at its statue's own rate only (équilibreur 24/11).
  const regen = 'regen' in e.def && !(e.statue > 0) ? e.def.regen : undefined;
  // Living units heal at their own pace, hit or not, the shield apart (équilibreur 23-24/11: an Isdaris archer has both).
  if (regen && e.hp < e.maxHp && this.tick % ticks(1 / regen) === 0) e.hp++;
  const shielding = e.shield < e.maxShield && (e.def.kind !== 'building' || e.buildLeft === 0);
  if (!shielding || this.tick - e.lastHit < ticks(7)) return;
  // Shields come back 1 a second (2010 sheet).
  if (++e.regenTimer < ticks(1)) return;
  e.regenTimer = 0;
  e.shield++;
}

/**
 * Recharge des boucliers (fiche 2010, mod): a Voyageur or a finished Réserve psy, once a second while it has the
 * energy, gives 20 shield to the most drained ally within 3 tiles (itself excepted).
 */
export function rechargeShields(this: World, e: Entity): void {
  const ab = ABILITIES.rechargebouclier;
  // Switched off by its button (équilibreur 24/11: on by default).
  if (!(e.def as BuildingDef).shieldCharge || e.autoOff || e.hp <= 0 || e.buildLeft > 0 || e.inside || e.mana < toFp(ab.mana!) || (e.spellCd.rechargebouclier ?? 0) > this.tick) return;
  let best: Entity | undefined;
  // Outside the units' turn there is no index of who is where (it is made after this): only what carries a shield is
  // gone through, not every entity, once a tick for each Réserve psy and Voyageur ready to give. The pick does not
  // depend on the order they come in (the most drained, the oldest of two as drained).
  for (const t of this.cells ? this.around(e.x, e.y, toFp(ab.range! + 3)) : this.listed().shielded) {
    if (t === e || t.owner !== e.owner || t.hp <= 0 || t.inside || t.shield >= t.maxShield || this.gap(e, t) > toFp(ab.range!)) continue;
    if (t.def.kind === 'building' && t.buildLeft > 0) continue;
    if (!best || t.maxShield - t.shield > best.maxShield - best.shield || (t.maxShield - t.shield === best.maxShield - best.shield && t.id < best.id)) best = t;
  }
  if (!best) return;
  best.shield = Math.min(best.maxShield, best.shield + ab.damage!);
  e.mana -= toFp(ab.mana!);
  e.spellCd.rechargebouclier = this.tick + ticks(ab.cooldown);
  this.shots.push({ x1: e.x, y1: e.y, x2: best.x, y2: best.y, kind: 'heal' });
}

/** The level of a Z weapon on its socle or tower (1 to 4): its base weapon level and its tier (the Réparateur's « niveau
 * de socle », proposition 3, provisional: a Tourelle at its weapon level 2). */
export function kitLevel(e: Entity): number {
  // Five levels of socle (équilibreur 23/11, XC's table); a table of four stops at its last.
  return Math.min(5, Math.max(1, ((e.def as UnitDef | BuildingDef).weaponLevel ?? 1) + e.tier - 1));
}

/** A healer's Soin spends its energy (healMana, balance designer 2026-11-22); false when it has run dry. The Z
 * Réparateur draws none (équilibreur 22/11). */
export function mends(this: World, e: Entity): boolean {
  const mana = (e.def as UnitDef).healMana;
  if (!mana) return true;
  if (e.mana < toFp(mana)) return false;
  e.mana -= toFp(mana);
  return true;
}

/** Hit points a second a unit gives back: a healer's, or a Z Réparateur's by its level (équilibreur 22/11: 2, 4, 8, 16). */
export function healRate(this: World, e: Entity): number {
  const def = e.def as UnitDef;
  if (def.levels?.heal) return def.levels.heal[e.lvl - 1];
  const heal = e.kit ? WEAPONS[e.kit]?.heal : undefined;
  return def.heal ?? (heal ? heal[Math.min(heal.length, kitLevel(e)) - 1] : 0);
}

/** Hp a pulse of healing gives: a god's by its level (a pulse a second), a Soigneur's card, a Réparateur its rate once
 * a second, one otherwise. */
export function healPulse(this: World, e: Entity): number {
  const lv = (e.def as UnitDef).levels?.heal;
  return lv ? lv[e.lvl - 1] : ((e.def as UnitDef).healPulse ?? (e.kit === 'reparateur' ? this.healRate(e) : 1));
}

/** How far it heals from (its edge): a healer's own range, a Z Réparateur's by its level (2 to 5). */
export function healReach(this: World, e: Entity): number {
  const range = e.kit ? WEAPONS[e.kit]?.healRange : undefined;
  return toFp(range ? range[Math.min(range.length, kitLevel(e)) - 1] : ((e.def as UnitDef).healRange ?? 2));
}

/** Inside a Nuage de nanites (Z Accumulateur): a unit of a caster's team within its radius, the caster excepted. */
export function coned(this: World, t: Entity): boolean {
  if (!this.cones) return false;
  const r = toFp(ABILITIES.cone.radius!);
  for (const c of this.entities.values()) if (c.cone > 0 && c !== t && !this.hostile(c.owner, t.owner) && t.owner >= 0 && c.hp > 0 && dist(c.x, c.y, t.x, t.y) <= r) return true;
  return false;
}

/** Idle units pick a fight (or a patient) in sight. Workers only fight when told to. */
export function acquire(this: World, e: Entity): void {
  const def = e.def as UnitDef;
  if (def.worker) return;
  const patient = this.healRate(e) && !e.autoOff ? this.patient(e) : undefined;
  if (patient) return this.setOrder(e, { kind: 'heal', target: patient.id });
  // Réanimation on its own (the balancer, 2026-11-22): a fresh body in reach rises.
  if (e.autoRaise && this.ready(e, 'reanimation')) {
    const reach = toFp(spell('reanimation', e.lvl).range ?? 0);
    const c = this.corpses.filter((c) => dist(c.x, c.y, e.x, e.y) <= reach).sort((a, b) => dist(a.x, a.y, e.x, e.y) - dist(b.x, b.y, e.x, e.y) || b.tick - a.tick)[0];
    if (c) this.castAt(e, 'reanimation', c.x, c.y); // its own mana spent there
  }
  // The weapon it has now, not only its sheet's (the Scarabée's cannon comes with a research).
  const a = this.weapon(e);
  if (!a) return;
  // Holding position: only what is already within reach.
  const t = this.enemyNear(e, e.stand ? toFp(a.range) + e.radius + FP : def.sight * FP, false, a);
  if (t) this.setOrder(e, { kind: 'attack', target: t.id, auto: true, lx: e.x, ly: e.y });
}

export function fight(this: World, e: Entity, o: Extract<Order, { kind: 'attack' | 'attackMove' | 'heal' }>): void {
  const def = e.def as UnitDef;
  if (o.kind === 'heal') {
    const t = this.entities.get(o.target);
    if (!t || t.hp <= 0 || t.hp >= t.maxHp || !this.healRate(e) || ((e.def as UnitDef).heal && !healable(t))) return this.setOrder(e, null);
    // A god summoning or going up a level heals only what is within reach: it may not walk.
    if (this.gap(e, t) > this.healReach(e)) return this.busy(e) ? this.setOrder(e, null) : this.chase(e, t);
    e.goal = null;
    if (e.cooldown === 0 && this.mends(e)) {
      const pulse = this.healPulse(e);
      t.hp = Math.min(t.maxHp, t.hp + pulse);
      e.cooldown = ticks(pulse / this.healRate(e));
      if (pulse > 1) this.shots.push({ x1: e.x, y1: e.y, x2: t.x, y2: t.y, kind: 'heal' });
      if ((this.tick + e.id) % 8 === 0) this.shots.push({ x1: e.x, y1: e.y, x2: t.x, y2: t.y, kind: 'heal' });
    }
    return;
  }
  if (o.kind === 'attackMove') {
    // Heal on the way if needed, otherwise engage what comes into sight, then carry on.
    if (this.healRate(e) && !e.autoOff && (this.tick + e.id) % 4 === 0) {
      const p = this.patient(e);
      if (p) {
        if (this.gap(e, p) > this.healReach(e)) return this.chase(e, p);
        if (e.cooldown === 0 && this.mends(e)) {
          const pulse = this.healPulse(e);
          p.hp = Math.min(p.maxHp, p.hp + pulse);
          e.cooldown = ticks(pulse / this.healRate(e));
        }
        return;
      }
    }
    let t = this.entities.get(o.target);
    // Hitting a building or a worker: switch to a more urgent enemy that comes into sight.
    if (t && t.hp > 0 && this.rank(t) > 0 && (this.tick + e.id) % 4 === 0) {
      const better = this.enemyNear(e, def.sight * FP);
      if (better && this.rank(better) < this.rank(t)) {
        o.target = better.id;
        t = better;
        e.goal = null;
      }
    }
    if (!t || t.hp <= 0 || !this.sees(e.owner, t) || this.gap(e, t) > (def.sight + 2) * FP) {
      // Lost to distance while still in view (fled, or the path to it winds away round a cliff): leave it be for a
      // while, else the unit walks back to its goal, sees it again and turns round, for ever.
      if (t && t.hp > 0 && this.sees(e.owner, t)) [e.ignore, e.ignoreUntil] = [t.id, this.tick + ticks(10)];
      t = (this.tick + e.id) % 4 === 0 && this.tick >= e.calmUntil ? this.enemyNear(e, def.sight * FP) : undefined;
      o.target = t?.id ?? 0;
      if (!t && this.goTo(e, o.x, o.y)) {
        if (!o.back) return this.setOrder(e, null);
        // A patrol turns round at each end.
        [o.x, o.y, o.back] = [o.back[0], o.back[1], [o.x, o.y]];
        e.goal = null;
      }
      if (!t) return;
      e.goal = null;
    }
    return this.strike(e, t);
  }
  const t = this.entities.get(o.target);
  // A building under a Bouclier de plasma: its attackers turn to something else (équilibreur 24/11).
  if (!t || t.hp <= 0 || t.inside || (t.phased > 0 && t.def.kind === 'building') || (!this.sees(e.owner, t) && (o.auto || this.hidden(t)))) return this.setOrder(e, null);
  if (o.auto && dist(e.x, e.y, o.lx, o.ly) > (def.sight + 3) * FP) {
    // Chased too far: walk back.
    return this.setOrder(e, { kind: 'move', x: o.lx, y: o.ly, arrive: FP });
  }
  if (o.auto && this.rank(t) > 0 && (this.tick + e.id) % 4 === 0) {
    const better = this.enemyNear(e, def.sight * FP);
    if (better && this.rank(better) < this.rank(t)) o.target = better.id;
  }
  this.strike(e, t);
}

/** Attacks if in range, otherwise closes in. */
export function strike(this: World, e: Entity, t: Entity): void {
  const a = this.weapon(e);
  if (!a) return;
  if (!hits(a, t)) return this.setOrder(e, null);
  if (this.gap(e, t) > toFp(a.range + this.rangeBonus(e, t)) + FP / 8) return e.stand ? this.setOrder(e, null) : this.chase(e, t);
  e.shortTicks = 0;
  e.goal = null;
  e.path = [];
  if (e.cooldown > 0 || e.frozen > 0 || e.muted > 0) return;
  // Stimulant: attacks 50 % faster.
  if (e.phased > 0) return;
  // Inside an enemy Tempête de sable, ranged weapons are useless.
  if (a.range >= 1 && this.storms.some((z) => this.hostile(z.owner, e.owner) && dist(z.x, z.y, e.x, e.y) <= z.r)) return;
  e.cooldown = e.boost > 0 && (e.def as UnitDef).ability === 'stimulant' ? idiv(ticks(a.cooldown) * 2, 3) : ticks(a.cooldown);
  // Boost génétique: the Créature strikes every 0.9 s (équilibreur 24/11).
  if (e.type === 'creature' && this.level(e.owner, 'boostgenetique')) e.cooldown = ticks(BALANCE.rules.upgrades.boost.cooldown);
  // The Artefacterie's Agilité: each one a share off the time between blows.
  const quick = e.arts.length ? e.arts.filter((x) => x === 'artagilite').length * BALANCE.rules.upgrades.artefacts.agilite : 0;
  if (quick) e.cooldown = Math.max(1, idiv(e.cooldown * (100 - quick), 100));
  if (e.statue > 0) e.cooldown = idiv(e.cooldown * BALANCE.rules.upgrades.statue.rate, 100);
  if (e.pace > 0 || e.heavy > 0) e.cooldown = Math.max(1, idiv(e.cooldown * this.paceOf(e)[1], 100));
  this.hit(e, t, a);
  // Z Arc électrique: more enemies in reach, in front of the shooter (within 67.5° of its line to the target).
  if (a.targets && a.targets > 1) {
    const [fx, fy] = [t.x - e.x, t.y - e.y];
    const reach = toFp(a.range) + e.radius;
    const front = (o: Entity) => {
      const [ox, oy] = [o.x - e.x, o.y - e.y];
      const dot = fx * ox + fy * oy;
      // cos² 67.5° ≈ 0.146, in floats only to compare (the result is a yes or no, the same everywhere).
      return dot > 0 && dot * dot >= 0.146 * (fx * fx + fy * fy) * (ox * ox + oy * oy);
    };
    const more = [...this.entities.values()]
      .filter((o) => o !== t && o.def.kind === 'unit' && o.hp > 0 && !o.inside && this.hostile(o.owner, e.owner) && reaches(a, flies(o)) && this.sees(e.owner, o) && dist(e.x, e.y, o.x, o.y) <= reach + o.radius && front(o))
      .sort((x, y) => dist(e.x, e.y, x.x, x.y) - dist(e.x, e.y, y.x, y.y) || x.id - y.id)
      .slice(0, a.targets - 1);
    for (const o of more) this.hit(e, o, a);
  }
}

/**
 * An attack's value against one target, by its class (fiches 2010): the class value, the bonuses against it, and the
 * upgrades and auras of the attacker (Forge, Présence des Échevins, Odin, Balise offensive).
 */
export function blow(this: World, e: Entity, t: Entity, a: Attack): number {
  const U = BALANCE.rules.upgrades;
  const machine = t.def.kind === 'building' || !!(t.def as UnitDef).mechanical || t.statue > 0;
  // Fiches 2010: the attack's value against the target's class; else the plain damage, more or less against machines.
  const cls = CLASSES.indexOf(clsOf(t));
  const base = this.classValue(e, a, cls);
  let bonus = a.vs ? 0 : (machine ? (a.vsMechanical ?? 0) : 0) + (t.def.kind === 'building' ? (a.vsStructure ?? 0) : 0);
  // Scie d'assaut (2010 sheet): +5 against structures and heavy machines.
  if ((CLASSES[cls] === 'S' || CLASSES[cls] === 'MM') && e.type === 'legionnaire' && this.level(e.owner, 'scieassaut')) bonus += U.scieassautBonus;
  let upgrade = 0;
  // +10 % a level of the value against the target's class (2010 sheets). Z: the upgrade follows the weapon, so the armed
  // Tourelle and Assimilateur and the Sonde get it too (Z.doc); the Serf too (the Humans' sheet). Not the Robot moissonneur.
  upgrade = this.researched(e, a, base + bonus);
  if (e.type === 'moissonneur') upgrade += this.level(e.owner, 'robots') * U.robots;
  // The Échevins' presence (2010 sheet): +1 to the attack of the units within 13 of one of their Conseils.
  if (e.def.kind === 'unit' && this.nearCouncil(e)) upgrade += U.conseilAura.damage;
  // Odin's war aura: the Dieux units round him (him too) hit harder, by his level; the strongest one counts.
  if (e.def.kind === 'unit' && this.players[e.owner]?.faction === 'dieux') {
    const G = U.auraguerre;
    let aura = 0;
    for (const g of this.listed().odins) if (g.owner === e.owner && g.hp > 0 && dist(g.x, g.y, e.x, e.y) <= toFp(G.radius[g.lvl - 1])) aura = Math.max(aura, G.damage[g.lvl - 1]);
    upgrade += aura;
  }
  return base + bonus + upgrade;
}

/** An attack's base value against a class (index in CLASSES); Char lourd (2010 sheet): the Pégase on the ground 29/29/87/58/87/29. */
export function classValue(this: World, e: Entity, a: Attack, cls: number): number {
  if (e.type === 'pegase' && !e.airborne && e.owner >= 0 && this.level(e.owner, 'charlourd')) return BALANCE.rules.upgrades.charlourd.vs[cls];
  return a.vs ? a.vs[cls] : a.damage;
}

/** The attack research's share of a blow worth `value` (+10 % a level), for an attacker that gets it. */
export function researched(this: World, e: Entity, a: Attack, value: number): number {
  // The gods grow by their levels, not by the units' weapon research (équilibreur 24/11).
  const armed = e.def.kind === 'unit' ? e.type !== 'moissonneur' && !(e.def as UnitDef).levels : this.players[e.owner]?.faction === 'z';
  if (!armed) return 0;
  // The Auxiliaire: +1 a level, not 10 % of its 15 (the balancer, 2026-11-22).
  const step = e.type === 'auxiliaire' ? BALANCE.rules.upgrades.auxiliaireRanged : Math.max(1, Math.round(value / 10));
  return this.level(e.owner, this.attackLine(e, a)) * step;
}

/** Cri de guerre (much harder for a while) and the Artefacterie's Force (for good), on a blow's value; `force` alone if `late`, the Cri alone if `late` is false. */
export function boost(this: World, e: Entity, value: number, late?: boolean): number {
  let damage = value;
  if (late !== true && e.war > 0) damage += idiv(damage * e.warPct, 100);
  if (late === false) return damage;
  const force = e.arts.length ? e.arts.filter((x) => x === 'artforce').length * BALANCE.rules.upgrades.artefacts.force : 0;
  if (force) damage += idiv(damage * force, 100);
  return damage;
}

/** What a blow does to another one it reaches (a line, behind, a splash): the value against its own class, boosted; the Assassin dances. */
export function aside(this: World, e: Entity, o: Entity, a: Attack): number {
  const damage = this.boost(e, this.blow(e, o, a));
  return o.type === 'assassin' ? idiv(damage * BALANCE.rules.upgrades.danseDuSoldat, 100) : damage;
}

/** Deals one attack's damage (with the attacker's Forge upgrades), alerts the victim and lets it fight back. */
export function hit(this: World, e: Entity, t: Entity, a: Attack): void {
  // A Mur d'énergie stops shots: they flare on it.
  const stop = a.range >= 1 && this.walled(e.x, e.y, t.x, t.y);
  if (stop) return void this.shots.push({ x1: e.x, y1: e.y, x2: stop.x, y2: stop.y, kind: 'ranged', type: e.type, air1: flies(e), air2: false });
  const U = BALANCE.rules.upgrades;
  const machine = t.def.kind === 'building' || !!(t.def as UnitDef).mechanical;
  const value = this.blow(e, t, a);
  // Cri de guerre first, then Coup puissant and Seth, the Artefacterie's Force last (their rounding in this order).
  let damage = this.boost(e, value, false);
  // Coup puissant: one blow in four, by a fixed draw on the tick and the attacker (the simulation has no randomness).
  if (e.type === 'minotaure' && this.level(e.owner, 'coupuissant') && (Math.imul(this.tick + 1, 2654435761) ^ e.id) % 4 === 0) damage *= 2;
  // Seth (notice: he hits the weakest soldiers hard, to finish them cruelly): more against a unit under half its health.
  damage = this.boost(e, damage, true);
  // Courroux du marteau: the charged blow.
  if (e.charged > 0 && a.range < 1) {
    damage *= U.courroux;
    e.charged = 0;
    // Thor evolved (notice): the blow sends a shock wave through the enemies on the ground round the target.
    const wave = spell('courroux', e.lvl).radius ?? 0;
    if (wave > 0) {
      for (const o of [...this.entities.values()]) {
        if (o === t || o.def.kind !== 'unit' || o.hp <= 0 || o.inside || flies(o) || !this.hostile(o.owner, e.owner) || this.gap(t, o) > toFp(wave)) continue;
        this.hurt(o, a.damage);
      }
    }
  }
  // Danse du soldat (2010 sheet: dodges a third of the attacks, near or far; without chance, it takes two thirds of each).
  if (t.type === 'assassin') damage = idiv(damage * BALANCE.rules.upgrades.danseDuSoldat, 100);
  // Sphère de renvoi (fiche 2010, mod): half the blow goes back to the attacker, whoever it is (own side too: kept on
  // purpose, rule 47), the other half is taken; it ends after its time or once `max` points have gone back.
  if (t.reflect > 0 && e.def.kind === 'unit' && e.hp > 0) {
    const back = Math.min(t.reflectLeft, idiv(damage * U.renvoiPercent, 100));
    damage -= back;
    this.hurt(e, back);
    if ((t.reflectLeft -= back) <= 0) t.reflect = 0;
  }
  const hp0 = Math.max(0, t.hp);
  const dealt = this.hurt(t, damage);
  // Attaque de singularité (équilibreur 24/11): the Druide's blow drains as much energy as it takes hit points (not
  // shield, Codex 26/11).
  if (e.type === 'druide' && t.mana > 0) t.mana = Math.max(0, t.mana - toFp(hp0 - Math.max(0, t.hp)));
  // Disque tournoyant (équilibreur 24/11, after its research): 15 % of what the target took to the enemies round it.
  if (e.type === 'discobole' && e.owner >= 0 && this.level(e.owner, 'disque')) {
    const D = ABILITIES.disquetournoyant;
    const share = idiv(dealt * D.damage!, 100);
    if (share > 0)
      for (const o of [...this.entities.values()]) {
        if (o === t || o.def.kind === 'resource' || o.hp <= 0 || o.inside || flies(o) || !this.hostile(o.owner, e.owner) || this.gap(t, o) > toFp(D.radius!)) continue;
        this.hurt(o, share);
      }
  }
  // Armée des enfers (notice): a ghost vanishes once it has dealt its share of damage (or when its time is up).
  if (e.type === 'fantome' && (e.dealt += dealt) >= U.fantomeDamage) e.hp = 0;
  // Z Jet sonique: every ground unit on the line from the shooter to its target is hit too, friend or foe (Z.doc).
  if (a.line) {
    const [lx, ly] = [t.x - e.x, t.y - e.y];
    const len2 = lx * lx + ly * ly || 1;
    for (const o of [...this.entities.values()]) {
      if (o === e || o === t || o.def.kind !== 'unit' || o.hp <= 0 || o.inside || flies(o)) continue;
      const k = (o.x - e.x) * lx + (o.y - e.y) * ly;
      if (k <= 0 || k >= len2) continue;
      const cross = Math.abs((o.x - e.x) * ly - (o.y - e.y) * lx);
      if (cross * cross <= (o.radius + FP / 4) * (o.radius + FP / 4) * len2) this.hurt(o, this.aside(e, o, a));
    }
  }
  // Z Lance-flammes (équilibreur 22/11): a jet the length of its range from the shooter's edge, through the target and
  // on; every enemy on the ground on it burns, between and behind (each the blow against its own class).
  if (a.flame) {
    const [lx, ly] = [t.x - e.x, t.y - e.y];
    const len = dist(e.x, e.y, t.x, t.y) || 1;
    const end = e.radius + toFp(a.range);
    for (const o of [...this.entities.values()]) {
      // Proposition 4 (provisional): allies on the line spared.
      if (o === e || o === t || o.def.kind !== 'unit' || o.hp <= 0 || o.inside || flies(o) || (!BALANCE.rules.z.flameHitsAllies && !this.hostile(o.owner, e.owner))) continue;
      // Along the line and off it, in whole units (no floating root in the simulation).
      const k = idiv((o.x - e.x) * lx + (o.y - e.y) * ly, len);
      if (k <= 0 || k - o.radius > end) continue;
      const cross = idiv(Math.abs((o.x - e.x) * ly - (o.y - e.y) * lx), len);
      if (cross <= o.radius + FP / 4) this.hurt(o, this.aside(e, o, a));
    }
  }
  // Z Canon X-04: fired at a target in contact, the shooter takes its own blast (Z.doc).
  if (a.selfHit && this.gap(e, t) <= FP / 2) this.hurt(e, damage);
  // The Élémentaire d'eau's icy shot slows what it hits.
  if (e.type === 'elemeau' && t.def.kind === 'unit') {
    t.chill = ticks(BALANCE.rules.upgrades.glace.seconds);
    if (t.boost === 0) t.speed = this.baseSpeed(t);
  }
  t.lastAttacker = e.id;
  t.lastHitBy = e.owner;
  // Lames empoisonnées: a Belluaire's blade poisons living units.
  if (e.type === 'belluaire' && t.def.kind === 'unit' && !machine && this.level(e.owner, 'lamesempoisonnees')) t.poison = ticks(U.poison.seconds);
  // Area weapons splash, half damage, on the ground units round the target. Armes chimiques (the balancer, 2026-11-22):
  // the Alchimiste, the Réservoir and the Tour alchimistique hit a zone of radius 1, allies too, on the target's own
  // level (the Tour shoots flyers).
  const chemical = CHEMICAL.includes(e.type) && this.level(e.owner, 'armeschimiques') > 0;
  const splash = chemical ? Math.max(a.splash ?? 0, U.chemicalSplash) : a.splash;
  if (splash) {
    for (const o of [...this.entities.values()]) {
      if (o === t || o === e || o.def.kind !== 'unit' || o.hp <= 0 || o.inside) continue;
      if (chemical ? flies(o) !== flies(t) : flies(o) || !this.hostile(o.owner, e.owner)) continue;
      if (dist(o.x, o.y, t.x, t.y) <= toFp(splash)) this.hurt(o, idiv(this.aside(e, o, a), 2));
    }
  }
  // Struck by its own side (an explicit attack order): no alarm, and nobody strikes back.
  const own = e.owner >= 0 && t.owner >= 0 && !this.hostile(e.owner, t.owner);
  if (!own && this.tick - (this.lastAlert[t.owner] ?? -Infinity) > ticks(15)) {
    this.lastAlert[t.owner] = this.tick;
    this.say(t.owner, t.def.kind === 'building' ? 'Votre base est attaquée !' : 'Vos troupes sont attaquées !', 'alert');
  }
  this.shots.push({ x1: e.x, y1: e.y, x2: t.x, y2: t.y, kind: a.range < 1 ? 'melee' : 'ranged', type: e.type, id: e.id, air1: flies(e), air2: flies(t) });
  if (own) return;
  // Idle soldiers hit from afar fight back; against a soldier shooting out of a bunker, at the bunker.
  if (e.inside) e = this.entities.get(e.inside) ?? e;
  const td = t.def as UnitDef;
  if (!t.order && !t.held && t.def.kind === 'unit' && td.attack && !td.worker && hits(td.attack, e)) {
    this.setOrder(t, { kind: 'attack', target: e.id, auto: true, lx: t.x, ly: t.y });
  }
  // So do soldiers attack-moving that are not already fighting a soldier, even while walking on past an
  // unreachable target (calmUntil), unless the shooter is the very one they just gave up on.
  const o = t.order;
  if (o?.kind === 'attackMove' && !t.held && td.attack && hits(td.attack, e) && !(e.id === t.ignore && this.tick < t.ignoreUntil)) {
    const current = this.entities.get(o.target);
    if (!current || current.hp <= 0 || this.rank(current) > this.rank(e)) {
      o.target = e.id;
      t.calmUntil = 0;
      t.goal = null;
    }
  }
}

export function chase(this: World, e: Entity, t: Entity): void {
  if (t.def.kind === 'building') return this.goNear(e, t.tx, t.ty, (t.def as BuildingDef).size);
  if (!e.goal || dist(e.goal.x, e.goal.y, t.x, t.y) > FP) this.plan(e, t.x, t.y);
  if (!this.follow(e) || flies(e)) return void (e.shortTicks = 0);
  // At the end of its path and still out of reach (the target stands below a cliff): after two seconds,
  // leave it be for a while and pick another fight, rather than standing there for ever.
  if (++e.shortTicks < ticks(2)) return;
  e.shortTicks = 0;
  e.ignore = t.id;
  e.ignoreUntil = this.tick + ticks(10);
  // Walk on without picking a fight for a few seconds: others nearby are likely out of reach too.
  e.calmUntil = this.tick + ticks(5);
  e.goal = null;
  const o = e.order;
  if (o?.kind === 'attackMove') o.target = 0;
  else if (o?.kind === 'attack') this.setOrder(e, o.auto ? null : { kind: 'attackMove', x: o.lx, y: o.ly, target: 0 });
}

export function index(this: World): void {
  this.cells = new Map();
  for (const e of this.entities.values()) this.file(e);
}

export function file(this: World, e: Entity): void {
  const k = (tileOf(e.y) >> 3) * 1024 + (tileOf(e.x) >> 3);
  const list = this.cells!.get(k);
  if (list) list.push(e);
  else this.cells!.set(k, [e]);
}

/** Entities that may lie within `range` of a point, edges included (a superset: callers still measure). */
export function around(this: World, x: number, y: number, range: number): Iterable<Entity> {
  if (!this.cells) return this.entities.values();
  const r = range + CELL_MARGIN * FP;
  const out: Entity[] = [];
  for (let cy = Math.max(0, tileOf(y - r)) >> 3; cy <= tileOf(y + r) >> 3; cy++) {
    for (let cx = Math.max(0, tileOf(x - r)) >> 3; cx <= tileOf(x + r) >> 3; cx++) {
      for (const t of this.cells.get(cy * 1024 + cx) ?? []) if (this.entities.get(t.id) === t) out.push(t);
    }
  }
  return out;
}

/** Edge-to-edge distance. */
export function gap(this: World, e: Entity, t: Entity): number {
  if (t.def.kind === 'unit') return dist(e.x, e.y, t.x, t.y) - e.radius - t.radius;
  const size = (t.def as BuildingDef).size;
  const nx = Math.max(t.tx * FP, Math.min(e.x, (t.tx + size) * FP));
  const ny = Math.max(t.ty * FP, Math.min(e.y, (t.ty + size) * FP));
  return dist(e.x, e.y, nx, ny) - e.radius;
}

/** How urgent an enemy is to hit: 0 what shoots back (soldiers, defences), 1 other units (workers), 2 buildings. */
export function rank(this: World, t: Entity): number {
  // A Double énergétique looks armed like the unit it copies: the enemy cannot tell it apart.
  const armed = !!(t.illusion ? this.ownWeapon(t) : this.weapon(t)) && !(t.def as UnitDef).worker;
  return armed ? 0 : t.def.kind === 'unit' ? 1 : 2;
}

/** Most threatening visible enemy within range: armed units and defences first, then workers, then buildings. */
export function enemyNear(this: World, e: Entity, range: number, unitsOnly = false, a = this.weapon(e)): Entity | undefined {
  let best: Entity | undefined;
  let bestScore = Infinity;
  for (const t of this.around(e.x, e.y, range)) {
    if (!this.hostile(t.owner, e.owner) || t.def.kind === 'resource' || t.hp <= 0 || (unitsOnly && t.def.kind !== 'unit')) continue;
    if (a && !hits(a, t)) continue;
    if (t.id === e.ignore && this.tick < e.ignoreUntil) continue;
    if (t.inside || (t.phased > 0 && t.def.kind === 'building')) continue; // sheltering in a bunker: hit the bunker; a plasma shield: another
    const d = this.gap(e, t);
    // No rank brings the score under d: past the best already, it cannot win (rank costs a weapon lookup).
    if (d > range || d > bestScore || !this.sees(e.owner, t)) continue;
    const score = d + [0, 3 * FP, 8 * FP][this.rank(t)];
    // Ties go to the oldest entity, as when every entity was scanned in order.
    if (score < bestScore || (score === bestScore && t.id < best!.id)) [best, bestScore] = [t, score];
  }
  return best;
}

/** Most wounded friendly unit in sight. */
export function patient(this: World, e: Entity): Entity | undefined {
  let best: Entity | undefined;
  let worst = 1;
  const mender = !(e.def as UnitDef).heal;
  // A Réparateur on a Tourelle mends only what is in its reach; on a socle, a little further (it goes there).
  const range = mender ? this.healReach(e) + (e.def.kind === 'building' ? 0 : 2 * FP) : (e.def as UnitDef).sight * FP;
  const busy = this.busy(e);
  for (const t of this.entities.values()) {
    if (t === e || t.owner !== e.owner || t.hp >= t.maxHp || t.hp <= 0) continue;
    // The Réparateur mends machines and, as the notice says (« véhicules et bâtiments »), finished buildings.
    // A healer's Soin mends no machine (balance designer 2026-11-22).
    if (t.def.kind === 'building' ? !mender || t.buildLeft > 0 : t.def.kind !== 'unit' || mender !== machineLike(t)) continue;
    // A Tourelle's reach counts from its edge, as a Réparateur's does (it cannot step closer).
    if ((t.def.kind === 'building' || e.def.kind === 'building' ? this.gap(e, t) : dist(e.x, e.y, t.x, t.y)) > range) continue;
    if (busy && this.gap(e, t) > this.healReach(e)) continue;
    const f = t.hp / t.maxHp;
    if (f < worst) [best, worst] = [t, f];
  }
  return best;
}
