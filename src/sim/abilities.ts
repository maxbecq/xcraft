/** Abilities: casts, aimed casts, Rappel, walls, take-off, transmutations, and the zones they leave. */
import BALANCE from '../balance.json';
import { ABILITIES, abilitiesOf, type BuildingDef, DEFS, type Mana, WEAPONS, WEAPON_ABILITIES, RAPPEL, SKIN_RANGE, spell, KIT, STIM_HP, type UnitDef } from '../data';
import { FP, dist, idiv, speedPerTick, ticks, tileOf, toFp } from './fixed';
import { flies, soars, type Entity, type World } from './world';

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
  // Nearest the map's middle first, a tie to the side left of the line from the Obélisque to it: the scan's order
  // gave the first unit the top-left tile from every corner. Doubled tile units, all whole.
  const [mx, my, ox, oy] = [this.map.width, this.map.height, 2 * b.tx + size, 2 * b.ty + size];
  const key = (i: number) => {
    const [cx, cy] = [2 * ring[i] + 1, 2 * ring[i + 1] + 1];
    const cross = (mx - ox) * (cy - oy) - (my - oy) * (cx - ox);
    return [(cx - mx) ** 2 + (cy - my) ** 2, cross < 0 ? 0 : 1, Math.abs(cross)];
  };
  const order = ring.map((_, i) => i).filter((i) => i % 2 === 0).sort((i, j) => {
    const [a, c] = [key(i), key(j)];
    return a[0] - c[0] || a[1] - c[1] || a[2] - c[2];
  });
  units.forEach((e, i) => {
    const k = order[i % order.length];
    e.x = e.px = ring[k] * FP + FP / 2;
    e.y = e.py = ring[k + 1] * FP + FP / 2;
    e.held = ticks(RAPPEL.daze);
  });
  this.teleports.push({ phase: 'end', owner: r.owner, x1: r.x, y1: r.y, x2: b.x, y2: b.y, ids: units.map((e) => e.id) });
}

/** Mutation: the Élémentaire form each ability turns into. */
const FORMS: Record<string, string> = { formefeu: 'elementaire', formeeau: 'elemeau', formeterre: 'elemterre', formeair: 'elemair' };

/** Uses the unit's active ability if it is ready. */
/** Uses an ability on the spot (by default the unit's first one); aimed ones go through castAt. */
export function cast(this: World, e: Entity, name = (e.def as UnitDef).ability): void {
  const def = e.def as UnitDef;
  const ab = name && spell(name, e.lvl);
  // Gone since the order (a caster merged into a Golem by another's Fusion earlier in the same command): no cast.
  if (this.entities.get(e.id) !== e) return;
  if (!ab || e.illusion || ab.target === 'point' || !this.ready(e, name) || (ab.research && !this.level(e.owner, ab.research)) || this.silenced(e.x, e.y)) return;
  const around = (r: number, test: (t: Entity) => boolean) => [...this.entities.values()].filter((t) => t.def.kind === 'unit' && t.hp > 0 && !t.inside && dist(t.x, t.y, e.x, e.y) <= toFp(r) && test(t));
  if (name === 'cone') {
    // Allies round the caster unhurt for a while (an aura: out of it, no more).
    if (e.cone === 0) this.cones++;
    e.cone = ticks(ab.duration);
  } else if (name === 'gravite') {
    e.gravity = ticks(ab.duration);
  } else if (name === 'invistemp') {
    e.camo = ticks(ab.duration);
  } else if (name === 'enfouissement') {
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
    // As many as 8 supply (2010 sheet).
    let room = ab.max!;
    for (const t of around(ab.radius!, (t) => t.owner === e.owner && t !== e && !flies(t))) {
      const supply = (t.def as UnitDef).supply;
      if (supply > room) continue;
      room -= supply;
      this.place(t, other.x, other.y);
    }
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
  } else if (name === 'camouflage' || name === 'camouflagewalkyrie') {
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
  } else if (name!.startsWith('forme')) {
    // Mutation: another form, its wounds kept; a flyer only lands on open ground.
    const into = FORMS[name!];
    if (soars(e) && !(DEFS[into] as UnitDef).flying && !(DEFS[into] as UnitDef).hover && !this.grid.open(tileOf(e.x), tileOf(e.y))) return void this.say(e.owner, 'Impossible de se poser ici.');
    this.transmute(e, into);
  } else if (name === 'fusion') {
    // Two Élémentaires, any forms (the base one too), merge into a Golem, which takes a while to set.
    const other = [...this.entities.values()]
      .filter((t) => t !== e && t.owner === e.owner && t.hp > 0 && (t.type === 'elembase' || Object.values(FORMS).includes(t.type)) && this.gap(e, t) <= toFp(ab.radius!))
      .sort((a, b) => this.gap(e, a) - this.gap(e, b) || a.id - b.id)[0];
    if (!other) return void this.say(e.owner, 'Il faut un second Élémentaire tout près.');
    // Halved toward the map's middle (>> 1 rounded down, a unit off in a corner's mirror).
    const [hx, hy] = [idiv(this.map.width * FP, 2), idiv(this.map.height * FP, 2)];
    const [mx, my] = [idiv(e.x + other.x - 2 * hx, 2) + hx, idiv(e.y + other.y - 2 * hy, 2) + hy];
    this.remove(other);
    this.remove(e);
    const g = this.spawn('golem', e.owner, mx, my);
    this.place(g, mx, my);
    g.held = ticks(ab.duration);
    this.casts.push({ kind: name, x: mx, y: my });
    return;
  } else if (name === 'posermine') {
    // Char Pégase: a chemical mine from its stock, under it, on the ground only; its own cooldown is the stock.
    if (e.airborne) return void this.say(e.owner, 'Les mines se posent au sol.');
    if (e.charges === 0) return void this.say(e.owner, 'Plus de mine en réserve.');
    e.charges--;
    this.spawnBeside('minechimique', e);
    this.casts.push({ kind: name, x: e.x, y: e.y });
    return;
  } else if (name === 'festin') {
    // Allosaure: devours the nearest fresh organic corpse and gets back a share of its health.
    const c = this.corpses.filter((c) => dist(c.x, c.y, e.x, e.y) <= toFp(ab.radius!)).sort((a, b) => dist(a.x, a.y, e.x, e.y) - dist(b.x, b.y, e.x, e.y) || a.tick - b.tick)[0];
    if (!c || e.hp >= e.maxHp) return;
    this.corpses.splice(this.corpses.indexOf(c), 1);
    e.hp = Math.min(e.maxHp, e.hp + idiv(e.maxHp * ab.damage!, 100));
  } else if (name === 'explosioncuve') {
    // The Cuve blows itself up: every unit on the ground around, friend or foe, and the enemy buildings take the blast, armour or not.
    for (const t of [...this.entities.values()]) {
      if (t === e || t.def.kind === 'resource' || t.hp <= 0 || t.inside || (t.def.kind === 'unit' ? flies(t) : !this.hostile(t.owner, e.owner))) continue;
      if (this.gap(e, t) <= toFp(ab.radius!)) this.hurt(t, ab.damage!);
    }
    this.casts.push({ kind: name, x: e.x, y: e.y });
    e.hp = 0;
    return;
  } else if (name === 'statue') {
    // To stone, or back (each way once its cooldown is over).
    e.statue = e.statue > 0 ? 0 : ticks(ab.duration);
    e.speed = this.baseSpeed(e);
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
  if (!this.spendMana(e, name!)) e.abilityCd = ticks(ab.cooldown);
  this.casts.push({ kind: name!, x: e.x, y: e.y });
}

/** An aimed ability, the caster in range of (x, y). False when there is nothing there to use it on. */
/** A point aimed at, kept on the map, half a tile inside its edge (a flyer sent off it went unseen, a beacon off it blocked a tile of another row). */
export function onMap(map: { width: number; height: number }, x: number, y: number): [number, number] {
  return [Math.min(map.width * FP - FP / 2, Math.max(FP / 2, x)), Math.min(map.height * FP - FP / 2, Math.max(FP / 2, y))];
}

export function castAt(this: World, e: Entity, name: string, x: number, y: number): boolean {
  [x, y] = onMap(this.map, x, y);
  const ab = spell(name, e.lvl);
  const near = (test: (t: Entity) => boolean) =>
    [...this.entities.values()]
      .filter((t) => t.def.kind === 'unit' && t.hp > 0 && !t.inside && dist(t.x, t.y, x, y) <= toFp(ab.radius!) && test(t))
      .sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y) || a.id - b.id);
  if (this.silenced(e.x, e.y) || e.illusion) return false;
  if (ab.ultimate) {
    if (!this.ultimateReady(e.owner, ab.ultimate)) {
      this.say(e.owner, `${ab.name} : pas encore chargé au Temple primordial.`);
      return true;
    }
    this.players[e.owner].ultimates![ab.ultimate] = 0;
  }
  if (name === 'gel') {
    // The enemy building nearest the point: no attack, no production, unhurt for a while.
    const b = [...this.entities.values()].filter((t) => t.def.kind === 'building' && this.hostile(t.owner, e.owner) && t.hp > 0 && dist(t.x, t.y, x, y) <= toFp(ab.radius! + (t.def as BuildingDef).size / 2)).sort((a, c) => dist(a.x, a.y, x, y) - dist(c.x, c.y, x, y) || a.id - c.id)[0];
    if (!b) return false;
    b.frozen = ticks(ab.duration);
  } else if (name === 'vacarme') {
    const v = this.spawn('vacarme', e.owner, x - FP / 2, y - FP / 2);
    v.ttl = ticks(ab.duration);
  } else if (name === 'balisez') {
    // An invulnerable beacon: sight of the zone for 50 s.
    this.scans.push({ owner: e.owner, x, y, left: ticks(ab.duration), radius: ab.radius });
  } else if (name === 'impulsion') {
    // Every unit of the zone but the Espion, flyers too (Z.doc).
    for (const t of near((t) => t !== e)) t.held = Math.max(t.held, ticks(ab.duration));
  } else if (name === 'atterrissage') {
    // Taken for a while (Soumission, Canon IEM): it may not settle and train for its holder.
    if (e.charm || e.seizedLeft) {
      this.say(e.owner, 'Pas tant qu’elle est prise.');
      return true;
    }
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
    // An illusion (fiche « Hallucination », mod): a decoy with the same hit points, which neither attacks nor casts.
    // Not of a worker, whose copy would still mine and build.
    const t = near((t) => t.owner === e.owner && t.type !== 'cadavre' && !(t.def as UnitDef).worker)[0];
    if (!t) return false;
    // A tile off on the side of the map's middle (always east, before: west of it from the other corners).
    const copy = this.spawn(t.type, e.owner, t.x + (t.x < idiv(this.map.width * FP, 2) ? FP : -FP), t.y);
    copy.ttl = ticks(ab.duration);
    copy.illusion = true;
  } else if (name === 'deflagration') {
    const t = [...this.entities.values()]
      .filter((t) => t.def.kind !== 'resource' && t.hp > 0 && this.hostile(t.owner, e.owner) && dist(t.x, t.y, x, y) <= toFp(ab.radius!) + t.radius)
      .sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y) || a.id - b.id)[0];
    if (!t) return false;
    this.hit(e, t, { damage: ab.damage!, range: 7, cooldown: 0 });
  } else if (name === 'silence') {
    this.silences.push({ x, y, r: toFp(ab.radius!), until: this.tick + ticks(ab.duration) });
  } else if (name === 'jormungand') {
    const u = this.spawn('jormungandr', e.owner, x, y);
    this.place(u, x, y);
  } else if (name === 'tempetezeus') {
    // Everyone under it, allies too, loses a share of its full health: the mightier, the harder hit.
    for (const t of [...this.entities.values()]) {
      if (t.def.kind !== 'unit' || t.hp <= 0 || t.inside || dist(t.x, t.y, x, y) > toFp(ab.radius!)) continue;
      this.hurt(t, Math.max(1, idiv((t.maxHp + t.maxShield) * ab.damage!, 100)));
      this.shots.push({ x1: x, y1: y - 8 * FP, x2: t.x, y2: t.y, kind: 'ranged' });
    }
  } else if (name === 'amonra') {
    // Blinded and held where they stand; machines shake it off sooner.
    for (const t of near((t) => this.hostile(t.owner, e.owner))) t.held = t.blind = Math.max(t.held, ticks((t.def as UnitDef).mechanical ? ab.duration / 3 : ab.duration));
  } else if (name === 'enraciner' || name === 'ancrer') {
    // Back into its own form at the point, where the ground allows; it fights again a few seconds later.
    if (e.charm || e.seizedLeft) {
      this.say(e.owner, 'Pas tant qu’elle est prise.');
      return true;
    }
    const into = e.type.replace(/mob$/, '');
    const size = (DEFS[into] as BuildingDef).size;
    const [tx, ty] = [tileOf(x) - (size >> 1), tileOf(y) - (size >> 1)];
    if (!this.canPlace(into, tx, ty, e.owner)) {
      this.say(e.owner, e.type === 'orbemob' ? 'Il faut un champ d’énergie libre.' : 'Impossible de prendre racine ici.');
      return true;
    }
    this.transmute(e, into, tx, ty);
    e.cooldown = ticks(ab.duration);
  } else if (name === 'chouette') {
    this.scans.push({ owner: e.owner, x, y, left: ticks(ab.duration), radius: ab.radius });
  } else if (name === 'dissipation') {
    const t = near((t) => t !== e)[0];
    if (!t) return false;
    if (t.owner === e.owner) {
      // What harms an ally: held, poisoned.
      t.held = 0;
      t.poison = 0;
    } else {
      // What helps an enemy; summoned ones and a Sphère de renvoi take a heavy blow.
      const summoned = t.ttl > 0 || t.reflect > 0;
      t.camo = 0;
      t.war = 0;
      t.skin = 0;
      t.reflect = 0;
      t.invuln = 0;
      if (t.boost > 0) {
        t.boost = 0;
        t.speed = this.baseSpeed(t);
      }
      if (summoned) this.hurt(t, ab.damage!);
    }
    this.shots.push({ x1: e.x, y1: e.y, x2: t.x, y2: t.y, kind: 'heal' });
  } else if (name === 'soumission') {
    // The enemy unit nearest the point (not a god, not a worker) changes side for a while.
    const t = near((t) => this.hostile(t.owner, e.owner) && !(t.def as UnitDef).unique && !(t.def as UnitDef).worker && t.charm === 0 && !t.seizedLeft)[0];
    if (!t) return false;
    t.charmOwner = t.owner;
    t.charm = ticks(ab.duration);
    this.turn(t, e.owner);
  } else if (name === 'voyage') {
    this.place(e, x, y);
  } else if (name === 'foudre') {
    const t = near((t) => this.hostile(t.owner, e.owner))[0];
    if (!t) return false;
    this.hit(e, t, { damage: ab.damage!, range: ab.range!, cooldown: 0 });
    t.held = Math.max(t.held, ticks(ab.duration));
    this.shots.push({ x1: e.x, y1: e.y, x2: t.x, y2: t.y, kind: 'ranged' });
  } else if (name === 'lumiereardente') {
    // Living enemies only (« l'infanterie ennemie »): walking speed and rate of attack halved.
    const foes = near((t) => this.hostile(t.owner, e.owner) && !(t.def as UnitDef).mechanical);
    if (!foes.length) return false;
    for (const t of foes) this.setPace(t, ticks(ab.duration), ab.damage!, idiv(10000, ab.damage!));
  } else if (name === 'jetdesable') {
    // The enemy machine nearest the point: a tenth of its speed, ten times as long between shots.
    const t = near((t) => this.hostile(t.owner, e.owner) && !!(t.def as UnitDef).mechanical)[0];
    if (!t) return false;
    this.setPace(t, ticks(ab.duration), ab.damage!, idiv(10000, ab.damage!));
    this.shots.push({ x1: e.x, y1: e.y, x2: t.x, y2: t.y, kind: 'ranged' });
  } else if (name === 'tempete') {
    this.storms.push({ owner: e.owner, x, y, r: toFp(ab.radius!), until: this.tick + ticks(ab.duration) });
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
    t.reflectLeft = ab.max!;
  } else if (name === 'explosiftoxique') {
    // A toxic cloud (2010 sheet, mod): its damage every second to every enemy unit in it, for its duration; clouds add up.
    this.clouds.push({ owner: e.owner, x, y, r: toFp(ab.radius!), damage: ab.damage!, hits: ab.duration, next: this.tick });
  } else if (name === 'gazeuphorisants') {
    // Allies of the zone (living ones) walk and strike faster for a while.
    const allies = near((t) => t.owner === e.owner && !(t.def as UnitDef).mechanical);
    if (!allies.length) return false;
    for (const t of allies) this.setPace(t, ticks(ab.duration), 100 + ab.damage!, idiv(10000, 100 + ab.damage!));
  } else if (name === 'acidedissolvant') {
    // A torrent of acid on the enemy building nearest the point.
    const b = [...this.entities.values()].filter((t) => t.def.kind === 'building' && this.hostile(t.owner, e.owner) && t.hp > 0 && dist(t.x, t.y, x, y) <= toFp(ab.radius! + (t.def as BuildingDef).size / 2)).sort((a, c) => dist(a.x, a.y, x, y) - dist(c.x, c.y, x, y) || a.id - c.id)[0];
    if (!b) return false;
    this.hurt(b, ab.damage!);
    this.shots.push({ x1: e.x, y1: e.y, x2: b.x, y2: b.y, kind: 'ranged' });
  } else if (name === 'regenerant') {
    // Every living ally of the zone (notice « ses troupes », 2010 sheet and mod: an area).
    const allies = near((t) => t.owner === e.owner && !(t.def as UnitDef).mechanical);
    if (!allies.length) return false;
    for (const t of allies) t.invuln = ticks(ab.duration);
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
    } else t.hp = Math.min(t.maxHp, t.hp + ab.damage!); // as many hp as it would burn (2010 sheet, mod)
  }
  // Téléportation rapide: the teleport comes back twice as fast.
  if (!this.spendMana(e, name)) e.abilityCd = name === 'teleport' && this.level(e.owner, 'teleportrapide') ? idiv(ticks(ab.cooldown) * (100 - BALANCE.rules.upgrades.teleportrapide), 100) : ticks(ab.cooldown);
  this.casts.push({ kind: name, x, y });
  return true;
}

/** The toxic clouds hurt the enemy units in them, once a second; a spent cloud goes. */
export function poisonClouds(this: World): void {
  for (const c of this.clouds) {
    if (c.next > this.tick) continue;
    for (const t of this.entities.values()) if (t.def.kind === 'unit' && t.hp > 0 && !t.inside && this.hostile(t.owner, c.owner) && dist(t.x, t.y, c.x, c.y) <= c.r + t.radius) this.hurt(t, c.damage);
    c.hits--;
    c.next = this.tick + ticks(1);
  }
  this.clouds = this.clouds.filter((c) => c.hits > 0);
}

/** A chemical mine (2010 sheet): when an enemy walker comes within 1, it blows up, its full damage on a zone of 2. */
export function mineTrigger(this: World, m: Entity): void {
  const ab = ABILITIES.posermine;
  const r = toFp(ab.radius!);
  const foes = [...this.entities.values()].filter((t) => t.def.kind === 'unit' && t.hp > 0 && !t.inside && !flies(t) && this.hostile(t.owner, m.owner) && dist(t.x, t.y, m.x, m.y) <= r + t.radius);
  if (!foes.some((t) => dist(t.x, t.y, m.x, m.y) <= r / 2 + t.radius)) return;
  for (const t of foes) this.hit(m, t, { damage: ab.damage!, range: 99, cooldown: 0 });
  this.casts.push({ kind: 'minechimique', x: m.x, y: m.y });
  m.hp = 0;
}

/** A Canon orbital shot lands: it spares nothing under it. */
export function orbitalHit(this: World, s: World['strikes'][number]): void {
  const ab = ABILITIES.canonorbital;
  for (const t of [...this.entities.values()]) if (t.def.kind !== 'resource' && t.hp > 0 && !t.inside && dist(t.x, t.y, s.x, s.y) <= toFp(ab.radius!)) this.hurt(t, ab.damage!);
  this.casts.push({ kind: 'canonorbital', x: s.x, y: s.y });
}

/** Of two paces in percent, the stronger: the farther from 100 %. */
const strong = (a: number, b: number) => (Math.abs(a - 100) >= Math.abs(b - 100) ? a : b);

/**
 * A change of pace for `left` ticks: walking speed and time between blows in percent of the usual. Over one still
 * running, each value keeps the stronger of the two and the time the longer.
 */
export function setPace(this: World, t: Entity, left: number, move: number, atk: number): void {
  if (t.pace > 0) [left, move, atk] = [Math.max(left, t.pace), strong(t.paceMove, move), strong(t.paceAtk, atk)];
  t.pace = left;
  t.paceMove = move;
  t.paceAtk = atk;
  if (t.boost === 0) t.speed = this.baseSpeed(t);
}

/** The pace in force, walking and time between blows in percent: the stronger of its timed one and Gravité's aura. */
export function paceOf(this: World, e: Entity): [number, number] {
  const g = ABILITIES.gravite;
  const [move, atk] = e.pace > 0 ? [e.paceMove, e.paceAtk] : [100, 100];
  return e.heavy > 0 ? [strong(move, 100 - g.damage!), strong(atk, g.max!)] : [move, atk];
}

/** Puts a unit at (x, y), or on the nearest open tile there for a walker; it stops what it was doing. */
export function place(this: World, t: Entity, x: number, y: number): void {
  if (!soars(t)) {
    const [ox, oy] = this.grid.nearestOpen(tileOf(x), tileOf(y), -1, [(this.map.width - 1) / 2, (this.map.height - 1) / 2]);
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
  this.grid.changes++;
  this.walls.push({ owner, tiles: [...tiles], left });
  for (const u of this.entities.values()) if (u.def.kind === 'unit' && !soars(u) && !u.inside && tiles.has(tileOf(u.y) * this.grid.width + tileOf(u.x))) this.place(u, u.x, u.y);
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

/** Déracinement: an Yggdrasill (any form) becomes a walking tree, which cannot fight; Redéploiement, the same for an Orbe plasma. */
export function uproot(this: World, b: Entity, name = 'deraciner'): void {
  const ab = ABILITIES[name];
  if ((ab.research && !this.level(b.owner, ab.research)) || b.buildLeft > 0) return;
  if (b.queue.length) return void this.say(b.owner, 'Transformation en cours.');
  if (b.abilityCd > 0) return void this.say(b.owner, `${ab.name} en recharge.`);
  const p = this.players[b.owner];
  if (p.minerals < (ab.minerals ?? 0)) return void this.say(b.owner, 'Pas assez de minerais.');
  p.minerals -= ab.minerals ?? 0;
  this.transmute(b, `${b.type}mob`);
}

/** A building that becomes a unit, or back (at tiles tx, ty), keeping its id, rally and share of hit points. */
export function transmute(this: World, e: Entity, type: string, tx = 0, ty = 0): void {
  const def = DEFS[type] as UnitDef | BuildingDef;
  if (e.def.kind === 'building') this.block(e, -1);
  this.retype(e, type);
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
    const t = near((t) => this.hostile(t.owner, b.owner) && !!(t.def as UnitDef).mechanical && !(t.def as UnitDef).unique && this.sees(b.owner, t) && !t.seizedLeft && !t.charm);
    if (!t) return void this.say(b.owner, 'Aucune machine ennemie visée.');
    t.seizedFrom = t.owner;
    t.seizedBy = b.id;
    t.seizedLeft = ticks(ab.duration);
    this.turn(t, b.owner);
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
  e.seizedBy = 0;
  e.seizedLeft = 0;
  this.turn(e, e.seizedFrom);
}

/**
 * A unit changing side (Soumission, Canon IEM, and back): its orders and queued orders are dropped, what it carries
 * gets out, and the units attacking it let it go.
 */
export function turn(this: World, e: Entity, owner: number): void {
  e.owner = owner;
  e.next = [];
  this.setOrder(e, null);
  // Carried by its old side (charmed, then boarded): out, else stuck in a transport its player cannot unload.
  const shelter = e.inside ? this.entities.get(e.inside) : undefined;
  if (shelter && shelter.owner !== owner) this.leave(e);
  for (const u of this.entities.values()) {
    if (u.inside === e.id) this.leave(u);
    const o = u.order;
    if (o?.kind === 'attackMove' && o.target === e.id) o.target = 0;
    else if (o?.kind === 'attack' && o.target === e.id) this.setOrder(u, null);
  }
}

/** A unit's abilities: its own, and those its Z weapon brings (Accumulateur). */
/**
 * A caster's own energy (fiches 2010, Z.doc): [most, at birth, regained a second], by its kind, or by the level of
 * the Z weapon it carries (Réparateur, Accumulateur: N1 to N4).
 */
export function manaOf(this: World, e: Entity): Mana | undefined {
  const own = (e.def as UnitDef | BuildingDef).mana;
  if (own) return own;
  // Dieux (XC.doc 2008): every god the same mana by its level, regained at 1 a second (half full at its summoning:
  // shortcut, no source gives a start; the mod's casters start at half).
  if ((e.def as UnitDef).levels && (e.def as UnitDef).faction === 'dieux') {
    const g = BALANCE.rules.godMana;
    const max = g.max[Math.min(g.max.length, e.lvl) - 1];
    return [max, g.max[0] / 2, g.regen];
  }
  const w = e.kit ? WEAPONS[e.kit]?.mana : undefined;
  if (!w) return undefined;
  const max = w.max[Math.min(w.max.length, Math.max(1, ((e.def as UnitDef).weaponLevel ?? 1) + e.tier - 1)) - 1];
  return [max, max / 2, w.regen];
}

/** Can it use this ability now: its cooldown over and, for a caster with energy of its own, enough of it. */
export function ready(this: World, e: Entity, name: string): boolean {
  const ab = spell(name, e.lvl);
  if (ab.mana !== undefined && this.manaOf(e)) return e.abilityCd === 0 && (e.spellCd[name] ?? 0) <= this.tick && e.mana >= toFp(ab.mana);
  return e.abilityCd === 0 || !ab.cooldown;
}

/** A spell cast from the caster's own energy: paid, one second before the next (fiches), and its own cooldown. */
export function spendMana(this: World, e: Entity, name: string): boolean {
  const ab = spell(name, e.lvl);
  if (ab.mana === undefined || !this.manaOf(e)) return false;
  e.mana -= toFp(ab.mana);
  e.abilityCd = ticks(1);
  if (ab.cooldown > 1) e.spellCd[name] = this.tick + ticks(ab.cooldown);
  return true;
}

export function abilitiesFor(this: World, e: Entity): string[] {
  const own = abilitiesOf(e.def as UnitDef);
  return e.kit && WEAPON_ABILITIES[e.kit] ? [...own, ...WEAPON_ABILITIES[e.kit]] : own;
}
