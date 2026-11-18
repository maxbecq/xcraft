/** Abilities: casts, aimed casts, Rappel, walls, take-off, transmutations, and the zones they leave. */
import BALANCE from '../balance.json';
import { ABILITIES, type BuildingDef, DEFS, RAPPEL, SKIN_RANGE, spell, KIT, STIM_HP, type UnitDef } from '../data';
import { FP, dist, idiv, speedPerTick, ticks, tileOf, toFp } from './fixed';
import { flies, type Entity, type World } from './world';

/** Rappel: holds the army units around (x, y) for the channel; false if there are none. */
export function recall(this: World, b: Entity, x: number, y: number): boolean {
  const ids = [...this.entities.values()]
    .filter((e) => e.owner === b.owner && e.def.kind === 'unit' && !e.def.worker && e.held === 0 && dist(e.x, e.y, x, y) <= RAPPEL.radius * FP)
    .sort((a, c) => dist(a.x, a.y, x, y) - dist(c.x, c.y, x, y) || a.id - c.id)
    .slice(0, RAPPEL.max)
    .map((e) => e.id);
  if (!ids.length) return false;
  const left = ticks(ABILITIES.rappel.duration);
  for (const id of ids) {
    const e = this.entities.get(id)!;
    this.setOrder(e, null);
    e.held = left + 1;
  }
  this.recalls.push({ owner: b.owner, from: b.id, x, y, ids, left });
  this.teleports.push({ phase: 'start', owner: b.owner, x1: x, y1: y, x2: b.x, y2: b.y, ids });
  return true;
}

/** End of a Rappel's channel: the surviving units appear on the open tiles around the Obélisque, if it still stands. */
export function land(this: World, r: World['recalls'][number]): void {
  const b = this.entities.get(r.from);
  const units = r.ids.map((id) => this.entities.get(id)).filter((e): e is Entity => !!e && e.hp > 0);
  if (!b || b.hp <= 0) {
    for (const e of units) e.held = 0;
    return;
  }
  const size = (b.def as BuildingDef).size;
  const ring: number[] = [];
  for (let ty = b.ty - 1; ty <= b.ty + size; ty++) {
    for (let tx = b.tx - 1; tx <= b.tx + size; tx++) {
      if ((tx === b.tx - 1 || tx === b.tx + size || ty === b.ty - 1 || ty === b.ty + size) && this.grid.open(tx, ty)) ring.push(tx, ty);
    }
  }
  if (!ring.length) ring.push(...this.grid.nearestOpen(b.tx + size, b.ty + size, this.grid.level(b.tx, b.ty)));
  units.forEach((e, i) => {
    const k = (i * 2) % ring.length;
    e.x = e.px = ring[k] * FP + FP / 2;
    e.y = e.py = ring[k + 1] * FP + FP / 2;
    e.held = ticks(RAPPEL.daze);
  });
  this.teleports.push({ phase: 'end', owner: r.owner, x1: r.x, y1: r.y, x2: b.x, y2: b.y, ids: units.map((e) => e.id) });
}

/** Uses the unit's active ability if it is ready. */
/** Uses an ability on the spot (by default the unit's first one); aimed ones go through castAt. */
export function cast(this: World, e: Entity, name = (e.def as UnitDef).ability): void {
  const def = e.def as UnitDef;
  const ab = name && spell(name, e.lvl);
  if (!ab || ab.target === 'point' || e.abilityCd > 0 || (ab.research && !this.level(e.owner, ab.research)) || this.silenced(e.x, e.y)) return;
  const around = (r: number, test: (t: Entity) => boolean) => [...this.entities.values()].filter((t) => t.def.kind === 'unit' && t.hp > 0 && !t.inside && dist(t.x, t.y, e.x, e.y) <= toFp(r) && test(t));
  if (name === 'enfouissement') {
    e.burrowed = !e.burrowed;
    this.setOrder(e, null);
  } else if (name === 'feucirculaire') {
    for (const t of around(ab.radius!, (t) => this.hostile(t.owner, e.owner))) this.hit(e, t, { damage: ab.damage!, range: 1, cooldown: 0 });
  } else if (name === 'manteau') {
    for (const t of around(ab.radius!, (t) => t.owner === e.owner)) t.camo = ticks(ab.duration);
  } else if (name === 'dephasage') {
    e.phased = ticks(ab.duration);
  } else if (name === 'couloir') {
    // Through the corridor to the nearest other Espion of ours.
    const other = [...this.entities.values()].filter((o) => o !== e && o.owner === e.owner && o.type === 'espion').sort((a, b) => dist(a.x, a.y, e.x, e.y) - dist(b.x, b.y, e.x, e.y) || a.id - b.id)[0];
    if (!other) return void this.say(e.owner, 'Il faut un second Espion.');
    for (const t of around(ab.radius!, (t) => t.owner === e.owner && t !== e && !flies(t)).slice(0, ab.max)) this.place(t, other.x, other.y);
  } else if (name === 'decollage') {
    // Take off, or land where the ground is open; either takes a moment.
    if (e.airborne && !this.grid.open(tileOf(e.x), tileOf(e.y))) return void this.say(e.owner, 'Impossible d’atterrir ici.');
    e.airborne = !e.airborne;
    e.held = ticks(ab.duration);
    e.path = [];
    e.goal = null;
  } else if (name === 'coupcirculaire') {
    // A sweeping blow: every enemy on the ground within reach (poisoned too, with Lames empoisonnées).
    for (const t of [...this.entities.values()]) {
      if (t.def.kind !== 'unit' || t.hp <= 0 || t.inside || flies(t) || !this.hostile(t.owner, e.owner) || this.gap(e, t) > toFp(ab.radius!)) continue;
      this.hit(e, t, { damage: ab.damage!, range: 0.1, cooldown: 0 });
    }
  } else if (name === 'camouflage') {
    e.camo = ticks(ab.duration);
  } else if (name === 'courroux') {
    e.charged = ticks(ab.duration);
  } else if (name === 'cridegueurre') {
    for (const t of around(ab.radius!, (t) => t.owner === e.owner)) {
      t.warPct = Math.max(t.war > 0 ? t.warPct : 0, ab.damage!);
      t.war = ticks(ab.duration);
    }
  } else if (name === 'soinsdivins') {
    const hurt = around(ab.radius!, (t) => t.owner === e.owner && !(t.def as UnitDef).mechanical && t.hp < t.maxHp);
    if (!hurt.length) return;
    for (const t of hurt) {
      t.hp = Math.min(t.maxHp, t.hp + ab.damage!);
      this.shots.push({ x1: e.x, y1: e.y, x2: t.x, y2: t.y, kind: 'heal' });
    }
  } else if (name === 'voile') {
    for (const t of around(ab.radius!, (t) => t.owner === e.owner)) t.camo = Math.max(t.camo, ticks(ab.duration));
  } else if (name === 'rayonmort') {
    // Every enemy unit Hadès sees, within his sight.
    const seen = [...this.entities.values()].filter((t) => t.def.kind === 'unit' && t.hp > 0 && !t.inside && this.hostile(t.owner, e.owner) && this.sees(e.owner, t) && dist(t.x, t.y, e.x, e.y) <= toFp((e.def as UnitDef).sight));
    if (!seen.length) return;
    for (const t of seen) {
      this.hit(e, t, { damage: ab.damage!, range: 99, cooldown: 0 });
      this.shots.push({ x1: e.x, y1: e.y, x2: t.x, y2: t.y, kind: 'ranged' });
    }
  } else if (name === 'armeeenfers') {
    for (let i = 0; i < (ab.max ?? 1); i++) {
      const g = this.spawnBeside('fantome', e);
      g.invuln = g.ttl; // unhurt for all their short life
    }
  } else if (name === 'nuee') {
    e.swarm = ticks(ab.duration);
  } else if (name === 'resurrection') {
    // The side's own fallen of the last `duration` seconds round her, nearest first, back at full health.
    const fallen = this.corpses
      .filter((c) => c.owner === e.owner && this.tick - c.tick < ticks(ab.duration) && dist(c.x, c.y, e.x, e.y) <= toFp(ab.radius!) && !(DEFS[c.type] as UnitDef).unique)
      .sort((a, b) => dist(a.x, a.y, e.x, e.y) - dist(b.x, b.y, e.x, e.y) || a.tick - b.tick)
      .slice(0, ab.max);
    if (!fallen.length) return;
    for (const c of fallen) {
      this.corpses.splice(this.corpses.indexOf(c), 1);
      this.spawn(c.type, e.owner, c.x, c.y);
    }
  } else if (name === 'peauderoc') {
    // The most wounded ally in range (itself included) not already protected.
    let best: Entity | undefined;
    for (const t of this.entities.values()) {
      if (t.owner !== e.owner || t.def.kind !== 'unit' || t.skin > 0 || t.hp <= 0 || this.gap(e, t) > SKIN_RANGE * FP) continue;
      if (!best || t.hp * best.maxHp < best.hp * t.maxHp) best = t;
    }
    if (!best) return;
    best.skin = ticks(ab.duration);
    this.shots.push({ x1: e.x, y1: e.y, x2: best.x, y2: best.y, kind: 'heal' });
  } else {
    if (def.ability === 'stimulant') {
      if (e.hp <= STIM_HP) return;
      e.hp -= STIM_HP;
    }
    e.boost = ticks(ab.duration);
    e.speed = speedPerTick(def.speed * (def.ability === 'charge' ? 2 : 1.5));
  }
  e.abilityCd = ticks(ab.cooldown);
  this.casts.push({ kind: name!, x: e.x, y: e.y });
}

/** An aimed ability, the caster in range of (x, y). False when there is nothing there to use it on. */
export function castAt(this: World, e: Entity, name: string, x: number, y: number): boolean {
  const ab = spell(name, e.lvl);
  const near = (test: (t: Entity) => boolean) =>
    [...this.entities.values()]
      .filter((t) => t.def.kind === 'unit' && t.hp > 0 && !t.inside && dist(t.x, t.y, x, y) <= toFp(ab.radius!) && test(t))
      .sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y) || a.id - b.id);
  if (this.silenced(e.x, e.y)) return false;
  if (name === 'atterrissage') {
    const size = (DEFS.casernevolante as BuildingDef).size;
    const [tx, ty] = [tileOf(x) - (size >> 1), tileOf(y) - (size >> 1)];
    if (!this.canPlace('casernevolante', tx, ty, e.owner)) {
      this.say(e.owner, 'Impossible d’atterrir ici.');
      return true;
    }
    this.transmute(e, 'casernevolante', tx, ty);
    return true;
  }
  if (name === 'chocmental') {
    const t = near((t) => this.hostile(t.owner, e.owner))[0];
    if (!t) return false;
    t.held = Math.max(t.held, ticks(ab.duration));
  } else if (name === 'double') {
    const t = near((t) => t.owner === e.owner && t.type !== 'cadavre')[0];
    if (!t) return false;
    const copy = this.spawn(t.type, e.owner, t.x + FP, t.y);
    copy.ttl = ticks(ab.duration);
  } else if (name === 'deflagration') {
    const t = [...this.entities.values()]
      .filter((t) => t.def.kind !== 'resource' && t.hp > 0 && this.hostile(t.owner, e.owner) && dist(t.x, t.y, x, y) <= toFp(ab.radius!) + t.radius)
      .sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y) || a.id - b.id)[0];
    if (!t) return false;
    this.hit(e, t, { damage: ab.damage!, range: 7, cooldown: 0 });
  } else if (name === 'silence') {
    this.silences.push({ x, y, r: toFp(ab.radius!), until: this.tick + ticks(ab.duration) });
  } else if (name === 'soumission') {
    // The enemy unit nearest the point (not a god, not a worker) changes side for a while.
    const t = near((t) => this.hostile(t.owner, e.owner) && !(t.def as UnitDef).unique && !(t.def as UnitDef).worker && t.charm === 0)[0];
    if (!t) return false;
    t.charmOwner = t.owner;
    t.owner = e.owner;
    t.charm = ticks(ab.duration);
    this.setOrder(t, null);
  } else if (name === 'voyage') {
    this.place(e, x, y);
  } else if (name === 'foudre') {
    const t = near((t) => this.hostile(t.owner, e.owner))[0];
    if (!t) return false;
    this.hit(e, t, { damage: ab.damage!, range: ab.range!, cooldown: 0 });
    t.held = Math.max(t.held, ticks(ab.duration));
    this.shots.push({ x1: e.x, y1: e.y, x2: t.x, y2: t.y, kind: 'ranged' });
  } else if (name === 'tempete') {
    this.storms.push({ owner: e.owner, x, y, r: toFp(ab.radius!), until: this.tick + ticks(ab.duration) });
  } else if (name === 'flechegaia') {
    const t = [...this.entities.values()]
      .filter((t) => t.def.kind !== 'resource' && t.hp > 0 && this.hostile(t.owner, e.owner) && dist(t.x, t.y, x, y) <= toFp(ab.radius!) + t.radius)
      .sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y) || a.id - b.id)[0];
    if (!t) return false;
    this.hit(e, t, { damage: ab.damage!, range: ab.range!, cooldown: 0 });
  } else if (name === 'pluiedefeu') {
    const foes = near((t) => this.hostile(t.owner, e.owner));
    if (!foes.length) return false;
    for (const t of foes) this.hurt(t, ab.damage!);
  } else if (name === 'teleportgaia') {
    const b = [...this.entities.values()].filter((b) => b.owner === e.owner && b.def.kind === 'building' && b.buildLeft === 0).sort((a, c) => dist(a.x, a.y, x, y) - dist(c.x, c.y, x, y) || a.id - c.id)[0];
    if (!b) return false;
    this.place(e, b.x, b.y + ((b.def as BuildingDef).size * FP) / 2 + e.radius + FP / 2);
  } else if (name === 'teleport') {
    this.place(e, x, y);
  } else if (name === 'teleportgroupe') {
    const b = [...this.entities.values()].filter((b) => b.owner === e.owner && b.def.kind === 'building' && b.buildLeft === 0).sort((a, c) => dist(a.x, a.y, x, y) - dist(c.x, c.y, x, y) || a.id - c.id)[0];
    if (!b) return false;
    const group = [...this.entities.values()].filter((t) => t.owner === e.owner && t.def.kind === 'unit' && !t.inside && dist(t.x, t.y, e.x, e.y) <= toFp(ab.radius!)).slice(0, ab.max);
    for (const t of group) this.place(t, b.x, b.y + ((b.def as BuildingDef).size * FP) / 2 + FP);
  } else if (name === 'renvoi') {
    const t = near((t) => t.owner === e.owner)[0];
    if (!t) return false;
    t.reflect = ticks(ab.duration);
  } else if (name === 'explosiftoxique') {
    for (const t of near((t) => this.hostile(t.owner, e.owner))) t.poison = Math.max(t.poison, ticks(ab.duration));
  } else if (name === 'regenerant') {
    const t = near((t) => t.owner === e.owner && !(t.def as UnitDef).mechanical)[0];
    if (!t) return false;
    t.invuln = ticks(ab.duration);
  } else if (name === 'reanimation') {
    const i = this.corpses.findIndex((c) => dist(c.x, c.y, x, y) <= toFp(ab.radius!));
    if (i < 0) return false;
    const [c] = this.corpses.splice(i, 1);
    const u = this.spawn('cadavre', e.owner, c.x, c.y);
    u.ttl = ticks(ab.duration);
  } else if (name === 'napalm') {
    const t = near((t) => !!(t.def as UnitDef).mechanical)[0];
    if (!t) return false;
    if (this.hostile(t.owner, e.owner)) {
      this.hit(e, t, { damage: ab.damage!, range: 6, cooldown: 0 });
      t.held = Math.max(t.held, ticks(ab.duration));
    } else t.hp = Math.min(t.maxHp, t.hp + 2 * ab.damage!);
  }
  // Téléportation rapide: the teleport comes back twice as fast.
  e.abilityCd = name === 'teleport' && this.level(e.owner, 'teleportrapide') ? idiv(ticks(ab.cooldown) * (100 - BALANCE.rules.upgrades.teleportrapide), 100) : ticks(ab.cooldown);
  this.casts.push({ kind: name, x, y });
  return true;
}

/** Puts a unit at (x, y), or on the nearest open tile there for a walker; it stops what it was doing. */
export function place(this: World, t: Entity, x: number, y: number): void {
  if (!flies(t)) {
    const [ox, oy] = this.grid.nearestOpen(tileOf(x), tileOf(y), -1);
    [x, y] = [ox * FP + FP / 2, oy * FP + FP / 2];
  }
  t.x = t.px = x;
  t.y = t.py = y;
  if (this.cells) this.file(t); // teleported: findable at its new spot this tick
  t.path = [];
  t.goal = null;
  this.setOrder(t, null);
}

/**
 * Mur d'énergie: a line of tiles across (x, y), square to the caster's direction, blocked for a while.
 * Walkers caught on it are pushed off.
 */
export function wall(this: World, owner: number, from: Entity, x: number, y: number, half: number, left: number): void {
  const d = dist(from.x, from.y, x, y) || 1;
  const [ux, uy] = [-(y - from.y) / d, (x - from.x) / d];
  const tiles = new Set<number>();
  for (let k = -half * 2; k <= half * 2; k++) {
    const [tx, ty] = [tileOf(x + Math.trunc((ux * k * FP) / 2)), tileOf(y + Math.trunc((uy * k * FP) / 2))];
    if (this.grid.inside(tx, ty)) tiles.add(ty * this.grid.width + tx);
  }
  for (const i of tiles) this.grid.blocked[i]++;
  this.walls.push({ owner, tiles: [...tiles], left });
  for (const u of this.entities.values()) if (u.def.kind === 'unit' && !flies(u) && !u.inside && tiles.has(tileOf(u.y) * this.grid.width + tileOf(u.x))) this.place(u, u.x, u.y);
}

/** Where a shot from (x1, y1) to (x2, y2) meets a Mur d'énergie, if it does. */
export function walled(this: World, x1: number, y1: number, x2: number, y2: number): { x: number; y: number } | undefined {
  if (!this.walls.length) return undefined;
  const steps = Math.ceil((dist(x1, y1, x2, y2) * 2) / FP);
  for (let k = 1; k < steps; k++) {
    const [x, y] = [x1 + Math.trunc(((x2 - x1) * k) / steps), y1 + Math.trunc(((y2 - y1) * k) / steps)];
    const i = tileOf(y) * this.grid.width + tileOf(x);
    if (this.walls.some((m) => m.tiles.includes(i))) return { x, y };
  }
  return undefined;
}

/** Caserne volante: takes off, a slow flyer; anything queued must be finished or cancelled first. */
export function takeOff(this: World, b: Entity): void {
  if (b.queue.length) return void this.say(b.owner, 'Production en cours.');
  this.transmute(b, 'casernevol');
}

/** A building that becomes a unit, or back (at tiles tx, ty), keeping its id, rally and share of hit points. */
export function transmute(this: World, e: Entity, type: string, tx = 0, ty = 0): void {
  const def = DEFS[type] as UnitDef | BuildingDef;
  const hp = e.hp / e.maxHp;
  if (e.def.kind === 'building') this.block(e, -1);
  e.type = type;
  e.def = def;
  e.maxHp = def.hp;
  e.hp = Math.max(1, Math.round(def.hp * hp));
  e.path = [];
  e.goal = null;
  this.setOrder(e, null);
  if (def.kind === 'unit') {
    e.radius = toFp(def.radius);
    e.speed = speedPerTick(def.speed);
    return;
  }
  e.radius = (def.size * FP) / 2;
  e.speed = 0;
  [e.tx, e.ty] = [tx, ty];
  e.x = e.px = tx * FP + e.radius;
  e.y = e.py = ty * FP + e.radius;
  this.block(e, 1);
}

/** Unseen by enemies without detection: invisible units, and Belluaires under Camouflage. */
export function hidden(this: World, e: Entity): boolean {
  return !!(e.def as UnitDef).cloaked || e.camo > 0 || e.burrowed || this.shrouded.has(e.id) || !!(e.support & KIT.invisibilite);
}

/** Inside a Silence des ions zone: no ability can be used there. */
export function silenced(this: World, x: number, y: number): boolean {
  return this.silences.some((z) => z.until > this.tick && dist(z.x, z.y, x, y) <= z.r);
}

/**
 * Z Centre K (Z.doc): fits a support kit on the own socle nearest the point, anywhere on the map, or fires the Canon
 * IEM at the enemy machine nearest it, which fights for its player 50 s.
 */
export function centreK(this: World, b: Entity, kind: string, x: number, y: number): void {
  const ab = ABILITIES[kind];
  const near = (ok: (t: Entity) => boolean) =>
    [...this.entities.values()].filter((t) => t.def.kind === 'unit' && t.hp > 0 && !t.inside && ok(t) && dist(t.x, t.y, x, y) <= toFp(ab.radius!)).sort((a, c) => dist(a.x, a.y, x, y) - dist(c.x, c.y, x, y) || a.id - c.id)[0];
  if (kind === 'canoniem') {
    if (b.iemCd > 0) return void this.say(b.owner, 'Canon IEM en recharge.');
    const t = near((t) => this.hostile(t.owner, b.owner) && !!(t.def as UnitDef).mechanical && !(t.def as UnitDef).unique && this.sees(b.owner, t) && !t.seizedLeft);
    if (!t) return void this.say(b.owner, 'Aucune machine ennemie visée.');
    t.seizedFrom = t.owner;
    t.owner = b.owner;
    t.seizedBy = b.id;
    t.seizedLeft = ticks(ab.duration);
    this.setOrder(t, null);
    b.iemCd = ticks(ab.cooldown);
    this.casts.push({ kind, x: t.x, y: t.y });
    return;
  }
  const bit = { kitdetection: KIT.detection, kitinvisibilite: KIT.invisibilite, kitreparateur: KIT.reparateur, kitbalise: KIT.balise }[kind] ?? 0;
  const t = near((t) => t.owner === b.owner && !!(t.def as UnitDef).weaponLevel && !(t.support & bit));
  if (!t) return void this.say(b.owner, 'Aucun socle sans ce kit à cet endroit.');
  if (!this.pay(b.owner, { cost: { minerals: ab.minerals ?? 0, energy: ab.energy ?? 0 } })) return;
  t.support |= bit;
  b.abilityCd = ticks(ab.cooldown);
  this.casts.push({ kind, x: t.x, y: t.y });
}

/** A machine taken by the Canon IEM goes back to its player. */
export function unseize(this: World, e: Entity): void {
  e.owner = e.seizedFrom;
  e.seizedBy = 0;
  e.seizedLeft = 0;
  this.setOrder(e, null);
}
