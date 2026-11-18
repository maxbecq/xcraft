/** Combat: weapons and their upgrades, target search, attacks, damage, regeneration. */
import BALANCE from '../balance.json';
import { type Attack, type BuildingDef, DEFS, reaches, SKIN_REDUCTION, spell, KIT, type UnitDef, type TierStats, type UpgradeLine, weaponAt } from '../data';
import { FP, dist, idiv, speedPerTick, ticks, tileOf, toFp } from './fixed';
import { type Order, flies, type Entity, type World } from './world';

/** Reach of the cell index beyond a search range, in tiles: the widest building's half plus a tick's walk. */
const CELL_MARGIN = 4;

/** Near one of its player's finished Conseils (or the Grand Conseil). */
export function nearCouncil(this: World, e: Entity): boolean {
  const r = toFp(BALANCE.rules.upgrades.conseilAura.radius);
  for (const b of this.entities.values()) if (b.owner === e.owner && (b.type === 'conseil' || b.type === 'grandconseil') && b.buildLeft === 0 && dist(b.x, b.y, e.x, e.y) <= r) return true;
  return false;
}

/** Which attack upgrade line a weapon follows: Forge melee or ranged (Humans), Portail or Assembleur (Isdaris). */
export function attackLine(this: World, e: Entity, a: Attack): UpgradeLine {
  if (this.players[e.owner].faction === 'isdaris') return (e.def as UnitDef).mechanical ? 'assembleuratk' : 'portailatk';
  // Z.doc: the flame thrower follows Attaque de proximité, like any melee weapon.
  if (this.players[e.owner].faction === 'z') return a.range < 1 || e.kit === 'flammes' ? 'zproxi' : 'zdist';
  return a.range < 1 ? 'melee' : 'ranged';
}

/** Cercle d'énergie: major Isdaris buildings get a stronger shield; Boost génétique: Créatures get hp and speed. */
export function empower(this: World, u: Entity, type: string): void {
  const U = BALANCE.rules.upgrades;
  if (type.startsWith('cercle') && u.def.kind === 'building' && ['obelisque', 'portail', 'nanoassembleur', 'orbecommandement', 'trone'].includes(u.type)) {
    const extra = idiv((u.def.shield ?? 0) * U.cerclePercent, 100);
    u.maxShield += extra;
    u.shield += extra;
  } else if (type === 'boostgenetique' && u.type === 'creature') {
    const extra = idiv((u.def as UnitDef).hp * U.boost.hp, 100);
    u.maxHp += extra;
    u.hp += extra;
    u.speed = speedPerTick(((u.def as UnitDef).speed * (100 + U.boost.speed)) / 100);
  }
}

/** Armour from research: Armure infanterie for foot soldiers, Blindage véhicules for machines, Peau épaisse for saurians, and unit ones. */
export function armorBonus(this: World, t: Entity): number {
  const d = t.def as UnitDef;
  const faction = this.players[t.owner].faction;
  let bonus = faction === 'z' ? (t.def.kind === 'building' ? this.level(t.owner, 'titane') * BALANCE.rules.z.titaneArmor : this.level(t.owner, 'zblindage')) : faction === 'dieux' ? this.level(t.owner, 'armor') : faction === 'isdaris' ? this.level(t.owner, d.mechanical ? 'assembleurarmor' : 'portailarmor') : this.level(t.owner, d.mechanical ? 'vehicles' : d.beast ? 'skin' : 'armor');
  if (t.type === 'moissonneur') bonus += this.level(t.owner, 'robots') * BALANCE.rules.upgrades.robots;
  if (t.type === 'legionnaire') bonus += this.level(t.owner, 'cuirasse');
  if (t.type === 'pegase' && this.level(t.owner, 'charlourd')) bonus += BALANCE.rules.upgrades.charlourd.armor;
  if (d.levels) bonus += d.levels.armor[t.lvl - 1] - d.armor;
  // Athéna's protection aura, the strongest of her side's in reach.
  const A = BALANCE.rules.upgrades.auraprotection;
  let aura = 0;
  if (faction === 'dieux') for (const g of this.entities.values()) if (g.type === 'athena' && g.owner === t.owner && g.hp > 0 && dist(g.x, g.y, t.x, t.y) <= toFp(A.radius[g.lvl - 1])) aura = Math.max(aura, A.armor[g.lvl - 1]);
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
  const a = this.ownWeapon(e);
  // Z Balise offensive: its carrier's attack hits an area (Z.doc: a zone of 3).
  return a && e.support & KIT.balise ? { ...a, splash: BALANCE.rules.z.beaconSplash } : a;
}

/** Does a carrier of the Balise offensive stand on this player's side? Counted once a tick. */
export function beacon(this: World, player: number): boolean {
  if (this.beaconsAt !== this.tick) {
    this.beaconsAt = this.tick;
    this.beacons.clear();
    for (const u of this.entities.values()) if (u.support & KIT.balise && u.hp > 0) this.beacons.add(u.owner);
  }
  return this.beacons.has(player);
}

/** The weapon a unit fights with, before any kit. */
export function ownWeapon(this: World, e: Entity): Attack | undefined {
  // Z socles: the weapon chosen at the Plate-forme, or the machine gun, as strong as the socle's level.
  // Z Tourelle and Assimilateur: the weapon bought for them, or the Tourelle's machine gun, at their level.
  const level = (e.def as UnitDef | BuildingDef).weaponLevel;
  if (level && (e.kit || e.def.kind === 'unit' || (e.def as BuildingDef).attack)) return weaponAt(e.kit || 'mitrailleuse', level + e.tier - 1);
  if (level) return undefined;
  if (e.type === 'scarabee') return this.level(e.owner, 'scarabeassaut') ? BALANCE.rules.upgrades.scarabeAttack : undefined;
  const a = (e.def as UnitDef | BuildingDef).attack;
  const lv = (e.def as UnitDef).levels;
  if (a && lv?.damage && e.lvl > 1) return levelled(a, lv.damage[e.lvl - 1]);
  return a && e.airborne ? { ...a, air: true, ground: false } : a;
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
  if (e.type === 'zespion' && this.level(e.owner, 'megaespion')) return speedPerTick(d.speed + BALANCE.rules.z.megaEspion.speed);
  return speedPerTick(d.levels ? d.levels.speed[e.lvl - 1] : e.tier > 1 ? d.tiers![e.tier - 2].speed : d.speed);
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
 * Once a second: Osiris's putrid aura (and the Immortel's, at his first level) hurts the living enemies round him;
 * his Nuée nauséabonde hurts the enemies round him and gives him what it takes; the Fontaine du Nil heals the living
 * allies round it.
 */
export function pulse(this: World, e: Entity): void {
  const U = BALANCE.rules.upgrades;
  const living = (t: Entity) => t.def.kind === 'unit' && t.hp > 0 && !t.inside && !(t.def as UnitDef).mechanical;
  if (e.type === 'osiris' || e.type === 'immortel') {
    const dmg = U.putride.damage[e.type === 'osiris' ? e.lvl - 1 : 0];
    for (const t of this.entities.values()) if (living(t) && !flies(t) && this.hostile(t.owner, e.owner) && this.gap(e, t) <= toFp(U.putride.radius)) this.hurt(t, dmg);
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
  if (e.type === 'fontaine' && e.buildLeft === 0) {
    for (const t of this.entities.values()) if (living(t) && t.owner === e.owner && t.hp < t.maxHp && dist(t.x, t.y, e.x, e.y) <= toFp(U.fontaine.radius)) t.hp = Math.min(t.maxHp, t.hp + U.fontaine.hp);
  }
}

/** Croissance économique: serfs and the Caserne's soldiers. */
export function grows(this: World, u: Entity): boolean {
  if (u.type === 'drone') return false;
  return u.def.kind === 'unit' && (u.type === 'serf' || !!(DEFS.caserne as BuildingDef).trains?.includes(u.type));
}

/** Raises a unit's hp by the Croissance économique share, keeping its wounds. */
export function fortify(this: World, u: Entity): void {
  // Sonde robuste (Z): a flat 25 hp for drones; Mega-Espion: 60 hp and some speed; Croissance économique: a share for Humans.
  if (u.type === 'zespion') u.speed = this.baseSpeed(u);
  const extra = u.type === 'drone' ? BALANCE.rules.z.sondeRobusteHp : u.type === 'zespion' ? BALANCE.rules.z.megaEspion.hp : idiv((u.def as UnitDef).hp * BALANCE.rules.upgrades.croissanceHp, 100);
  u.maxHp += extra;
  u.hp += extra;
}

/** Damage that goes through shields first; armour only protects hp. */
export function hurt(this: World, t: Entity, damage: number): void {
  t.lastHit = this.tick;
  if (t.invuln > 0 || t.phased > 0) return;
  if (t.skin > 0) damage = Math.max(1, damage - SKIN_REDUCTION);
  const absorbed = Math.min(t.shield, damage);
  t.shield -= absorbed;
  if (damage > absorbed) {
    const armor = ('armor' in t.def ? t.def.armor : 0) + (t.def.kind === 'unit' && t.owner >= 0 ? this.armorBonus(t) : 0);
    t.hp -= Math.max(1, damage - absorbed - (absorbed > 0 ? 0 : armor));
  }
}

/** Shields recharge a few seconds after the last hit (at once, and faster, near a psy reserve); some units heal. */
export function regenerate(this: World, e: Entity): void {
  if (e.hp <= 0) return;
  if (e.poison > 0 && --e.poison % ticks(1) === 0) e.hp -= BALANCE.rules.upgrades.poison.damage;
  const regen = 'regen' in e.def ? e.def.regen : undefined;
  const shielding = e.shield < e.maxShield && (e.def.kind !== 'building' || e.buildLeft === 0);
  if (!shielding && !(regen && e.hp < e.maxHp)) return;
  const aura = shielding && this.nearShieldAura(e);
  if (shielding && !aura && this.tick - e.lastHit < ticks(7)) return;
  const rate = regen && e.hp < e.maxHp ? regen : (aura ? 8 : 2) + (e.owner >= 0 ? this.level(e.owner, 'bouclier') * BALANCE.rules.upgrades.boucliersRegen : 0);
  if (++e.regenTimer < ticks(1 / rate)) return;
  e.regenTimer = 0;
  if (shielding) e.shield++;
  else e.hp++;
}

export function nearShieldAura(this: World, e: Entity): boolean {
  for (const b of this.entities.values()) {
    const r = (b.def as BuildingDef).shieldAura;
    if (b.owner === e.owner && r && b.buildLeft === 0 && dist(b.x, b.y, e.x, e.y) <= r * FP) return true;
  }
  return false;
}

/** Idle units pick a fight (or a patient) in sight. Workers only fight when told to. */
export function acquire(this: World, e: Entity): void {
  const def = e.def as UnitDef;
  if (def.worker) return;
  const patient = def.heal ? this.patient(e) : undefined;
  if (patient) return this.setOrder(e, { kind: 'heal', target: patient.id });
  if (!def.attack) return;
  // Holding position: only what is already within reach.
  const t = this.enemyNear(e, e.stand ? toFp(def.attack.range) + e.radius + FP : def.sight * FP);
  if (t) this.setOrder(e, { kind: 'attack', target: t.id, auto: true, lx: e.x, ly: e.y });
}

export function fight(this: World, e: Entity, o: Extract<Order, { kind: 'attack' | 'attackMove' | 'heal' }>): void {
  const def = e.def as UnitDef;
  if (o.kind === 'heal') {
    const t = this.entities.get(o.target);
    if (!t || t.hp <= 0 || t.hp >= t.maxHp || !def.heal) return this.setOrder(e, null);
    if (this.gap(e, t) > 2 * FP) return this.chase(e, t);
    e.goal = null;
    if (e.cooldown === 0) {
      t.hp = Math.min(t.maxHp, t.hp + 1);
      e.cooldown = ticks(1 / def.heal);
      if ((this.tick + e.id) % 8 === 0) this.shots.push({ x1: e.x, y1: e.y, x2: t.x, y2: t.y, kind: 'heal' });
    }
    return;
  }
  if (o.kind === 'attackMove') {
    // Heal on the way if needed, otherwise engage what comes into sight, then carry on.
    if (def.heal && (this.tick + e.id) % 4 === 0) {
      const p = this.patient(e);
      if (p) {
        if (this.gap(e, p) > 2 * FP) return this.chase(e, p);
        if (e.cooldown === 0) {
          p.hp = Math.min(p.maxHp, p.hp + 1);
          e.cooldown = ticks(1 / def.heal);
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
  if (!t || t.hp <= 0 || t.inside || (!this.sees(e.owner, t) && (o.auto || this.hidden(t)))) return this.setOrder(e, null);
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
  if (!reaches(a, flies(t))) return this.setOrder(e, null);
  if (this.gap(e, t) > toFp(a.range + this.rangeBonus(e, t)) + FP / 8) return e.stand ? this.setOrder(e, null) : this.chase(e, t);
  e.shortTicks = 0;
  e.goal = null;
  e.path = [];
  if (e.cooldown > 0) return;
  // Stimulant: attacks 50 % faster.
  if (e.phased > 0) return;
  // Inside an enemy Tempête de sable, ranged weapons are useless.
  if (a.range >= 1 && this.storms.some((z) => this.hostile(z.owner, e.owner) && dist(z.x, z.y, e.x, e.y) <= z.r)) return;
  e.cooldown = e.boost > 0 && (e.def as UnitDef).ability === 'stimulant' ? idiv(ticks(a.cooldown) * 2, 3) : ticks(a.cooldown);
  if (e.type === 'creature' && this.level(e.owner, 'boostgenetique')) e.cooldown = idiv(e.cooldown * (100 - BALANCE.rules.upgrades.boost.rate), 100);
  this.hit(e, t, a);
}

/** Deals one attack's damage (with the attacker's Forge upgrades), alerts the victim and lets it fight back. */
export function hit(this: World, e: Entity, t: Entity, a: Attack): void {
  // A Mur d'énergie stops shots: they flare on it.
  const stop = a.range >= 1 && this.walled(e.x, e.y, t.x, t.y);
  if (stop) return void this.shots.push({ x1: e.x, y1: e.y, x2: stop.x, y2: stop.y, kind: 'ranged', type: e.type, air1: flies(e), air2: false });
  const U = BALANCE.rules.upgrades;
  const machine = t.def.kind === 'building' || !!(t.def as UnitDef).mechanical;
  let bonus = machine ? (a.vsMechanical ?? 0) : 0;
  if (machine && e.type === 'legionnaire' && this.level(e.owner, 'scieassaut')) bonus += U.scieassautBonus;
  if (e.type === 'pegase' && this.level(e.owner, 'charlourd')) bonus += U.charlourd.damage;
  if (machine && e.type === 'cuve' && this.level(e.owner, 'acide')) bonus += U.acideBonus;
  let upgrade = 0;
  if (e.def.kind === 'unit' && !e.def.worker) upgrade = this.level(e.owner, this.attackLine(e, a)) * Math.max(1, Math.round(a.damage / 10));
  if (e.type === 'moissonneur') upgrade += this.level(e.owner, 'robots') * U.robots;
  // The Échevins' presence: units fighting near one of their Conseils hit a little harder.
  if (e.def.kind === 'unit' && this.nearCouncil(e)) upgrade += Math.max(1, idiv((a.damage + bonus) * U.conseilAura.percent, 100));
  // Odin's war aura: the Dieux units round him (him too) hit harder, by his level; the strongest one counts.
  if (e.def.kind === 'unit' && this.players[e.owner]?.faction === 'dieux') {
    const G = U.auraguerre;
    let aura = 0;
    for (const g of this.entities.values()) if (g.type === 'odin' && g.owner === e.owner && g.hp > 0 && dist(g.x, g.y, e.x, e.y) <= toFp(G.radius[g.lvl - 1])) aura = Math.max(aura, G.damage[g.lvl - 1]);
    upgrade += aura;
  }
  // Z Balise offensive (Z.doc): +5 % to every attack of its owner's while a carrier stands; not cumulative.
  if (e.owner >= 0 && this.players[e.owner].faction === 'z' && this.beacon(e.owner)) upgrade += idiv((a.damage + bonus) * BALANCE.rules.z.beaconPercent, 100);
  // Courroux du marteau: the charged blow.
  let damage = a.damage + bonus + upgrade;
  // Cri de guerre: much harder for a while.
  if (e.war > 0) damage += idiv(damage * e.warPct, 100);
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
  this.hurt(t, damage);
  t.lastAttacker = e.id;
  t.lastHitBy = e.owner;
  // Sphère de renvoi: part of the blow goes back to the attacker.
  if (t.reflect > 0 && e.def.kind === 'unit' && e.hp > 0) this.hurt(e, Math.max(1, idiv((a.damage + bonus) * U.renvoiPercent, 100)));
  // Lames empoisonnées: a Belluaire's blade poisons living units.
  if (e.type === 'belluaire' && t.def.kind === 'unit' && !machine && this.level(e.owner, 'lamesempoisonnees')) t.poison = ticks(U.poison.seconds);
  // Area weapons splash, half damage, on the ground units round the target (Armes chimiques: the Alchimiste's cocktails too).
  const splash = a.splash ?? (e.type === 'alchimiste' && this.level(e.owner, 'armeschimiques') ? U.chemicalSplash : 0);
  if (splash) {
    for (const o of [...this.entities.values()]) {
      if (o === t || o.def.kind !== 'unit' || o.hp <= 0 || o.inside || flies(o) || !this.hostile(o.owner, e.owner)) continue;
      if (dist(o.x, o.y, t.x, t.y) <= toFp(splash)) this.hurt(o, idiv(a.damage + upgrade, 2));
    }
  }
  if (this.tick - (this.lastAlert[t.owner] ?? -Infinity) > ticks(15)) {
    this.lastAlert[t.owner] = this.tick;
    this.say(t.owner, t.def.kind === 'building' ? 'Votre base est attaquée !' : 'Vos troupes sont attaquées !', 'alert');
  }
  this.shots.push({ x1: e.x, y1: e.y, x2: t.x, y2: t.y, kind: a.range < 1 ? 'melee' : 'ranged', type: e.type, air1: flies(e), air2: flies(t) });
  // Idle soldiers hit from afar fight back; against a soldier shooting out of a bunker, at the bunker.
  if (e.inside) e = this.entities.get(e.inside) ?? e;
  const td = t.def as UnitDef;
  if (!t.order && !t.held && t.def.kind === 'unit' && td.attack && !td.worker && reaches(td.attack, flies(e))) {
    this.setOrder(t, { kind: 'attack', target: e.id, auto: true, lx: t.x, ly: t.y });
  }
  // So do soldiers attack-moving that are not already fighting a soldier, even while walking on past an
  // unreachable target (calmUntil), unless the shooter is the very one they just gave up on.
  const o = t.order;
  if (o?.kind === 'attackMove' && !t.held && td.attack && reaches(td.attack, flies(e)) && !(e.id === t.ignore && this.tick < t.ignoreUntil)) {
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
  const armed = !!this.weapon(t) && !(t.def as UnitDef).worker;
  return armed ? 0 : t.def.kind === 'unit' ? 1 : 2;
}

/** Most threatening visible enemy within range: armed units and defences first, then workers, then buildings. */
export function enemyNear(this: World, e: Entity, range: number, unitsOnly = false, a = this.weapon(e)): Entity | undefined {
  let best: Entity | undefined;
  let bestScore = Infinity;
  for (const t of this.around(e.x, e.y, range)) {
    if (!this.hostile(t.owner, e.owner) || t.def.kind === 'resource' || t.hp <= 0 || (unitsOnly && t.def.kind !== 'unit')) continue;
    if (a && !reaches(a, flies(t))) continue;
    if (t.id === e.ignore && this.tick < e.ignoreUntil) continue;
    if (t.inside) continue; // sheltering in a bunker: hit the bunker
    const d = this.gap(e, t);
    if (d > range || !this.sees(e.owner, t)) continue;
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
  const range = (e.def as UnitDef).sight * FP;
  for (const t of this.entities.values()) {
    if (t === e || t.owner !== e.owner || t.def.kind !== 'unit' || t.hp >= t.maxHp || t.hp <= 0) continue;
    if (dist(e.x, e.y, t.x, t.y) > range) continue;
    const f = t.hp / t.maxHp;
    if (f < worst) [best, worst] = [t, f];
  }
  return best;
}
