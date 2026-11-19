/** Buildings: placement, power network, production, research, morphs, bunkers and carriers. */
import BALANCE from '../balance.json';
import { ABILITIES, ARTEFACTS, type BuildingDef, DEFS, KIT, reaches, type UnitDef, type UpgradeDef } from '../data';
import { FP, dist, idiv, ticks, tileOf, toFp } from './fixed';
import { flies, type Entity, type World } from './world';

/** Can `player` put this building here? (Without a player, the power field is not checked.) */
export function canPlace(this: World, type: string, tx: number, ty: number, player = -1): boolean {
  const def = DEFS[type] as BuildingDef;
  const g = this.grid;
  if (def.energyRate) {
    // Extractors go exactly on a free energy well.
    for (const w of this.entities.values()) {
      if (w.type === 'puits' && w.tx === tx && w.ty === ty) {
        return ![...this.entities.values()].some((m) => (m.def as BuildingDef).energyRate && m.def.kind === 'building' && m.tx === tx && m.ty === ty);
      }
    }
    return false;
  }
  const cx = tx * FP + (def.size * FP) / 2;
  const cy = ty * FP + (def.size * FP) / 2;
  if (def.needsPower && player >= 0 && !this.powered(player, cx, cy)) return false;
  // An emitter must join the network: its zone has to touch the zone of a linked power building.
  if (def.power && !def.dropoff && player >= 0 && !this.powerNetwork(player).some((b) => dist(b.x, b.y, cx, cy) <= (def.power! + (b.def as BuildingDef).power!) * FP)) return false;
  let level = -2;
  for (let y = ty; y < ty + def.size; y++) {
    for (let x = tx; x < tx + def.size; x++) {
      if (!g.open(x, y)) return false;
      const l = g.flatLevel(x, y);
      if (l < 0 || (level !== -2 && l !== level)) return false;
      level = l;
    }
  }
  return !this.underCliff(tx, ty, def.size, level);
}

/**
 * A tile of ground at its own level all round a building on the sides where a cliff rises: built right against
 * the wall, its back would sink into the rock as drawn. A plateau's edge falling away is no matter.
 */
export function underCliff(this: World, tx: number, ty: number, size: number, level: number): boolean {
  const g = this.grid;
  for (let y = ty - 1; y <= ty + size; y++) {
    for (let x = tx - 1; x <= tx + size; x++) {
      if ((x >= tx && x < tx + size && y >= ty && y < ty + size) || !g.inside(x, y)) continue;
      if (g.topLevel(x, y) > level) return true;
    }
  }
  return false;
}

/** Why a building cannot go there: out of the power field (Isdaris), off the creep (Z), or simply blocked. */
export function misplaced(this: World, def: BuildingDef, tx: number, ty: number, player: number): string {
  const level = this.grid.flatLevel(tx, ty);
  if (level >= 0 && !def.energyRate && this.underCliff(tx, ty, def.size, level)) return 'Trop près de la falaise.';
  if (!def.needsPower || this.powered(player, tx * FP + (def.size * FP) / 2, ty * FP + (def.size * FP) / 2)) return 'Emplacement invalide.';
  return def.faction === 'z' ? 'Hors du creep.' : "Hors d'un champ d'énergie.";
}

/** Where a Pod's add-on goes: against one of its sides, the first free one (east, west, south, north). */
export function addonSpot(this: World, pod: Entity, type: string): [number, number] | undefined {
  return this.addonSpotAt(type, pod.tx, pod.ty, (pod.def as BuildingDef).size, pod.owner);
}

/** The same for a Pod of size `own` at (tx, ty), placed or not (the placement preview checks its add-on has room). */
export function addonSpotAt(this: World, type: string, tx: number, ty: number, own: number, player: number): [number, number] | undefined {
  const size = (DEFS[type] as BuildingDef).size;
  const mid = idiv(own - size, 2);
  const spots: [number, number][] = [[tx + own, ty + mid], [tx - size, ty + mid], [tx + mid, ty + own], [tx + mid, ty - size]];
  return spots.find(([x, y]) => this.canPlace(type, x, y, player));
}

/**
 * Could this building cover tile (x, y)? canPlace one tile at a time, for the placement grid: open, flat, and in the
 * power field or on the creep where it must be. (The whole footprint also needs one level, away from a cliff, and an
 * emitter must join the network: canPlace checks those for the building as a whole.)
 */
export function tileFits(this: World, type: string, x: number, y: number, player: number, net = this.powerNetwork(player)): boolean {
  const def = DEFS[type] as BuildingDef;
  if (!this.grid.open(x, y) || this.grid.flatLevel(x, y) < 0) return false;
  // `net`: the player's power network, worked out once for a whole grid of tiles. canPlace wants the building's
  // centre in the field: this tile counts if it lies within reach of a centre that is (half the footprint's diagonal).
  const slack = Math.ceil((def.size - 1) * FP * Math.SQRT1_2);
  return !def.needsPower || net.some((b) => dist(b.x, b.y, x * FP + FP / 2, y * FP + FP / 2) <= (b.def as BuildingDef).power! * FP + slack);
}

/** Ticks a building takes to raise: Z ones 20 % faster with Déploiement rapide. */
export function buildTicks(this: World, b: Entity): number {
  const t = ticks((b.def as BuildingDef).buildTime);
  return this.players[b.owner]?.faction === 'z' && this.level(b.owner, 'deploiement') ? idiv(t * 100, 100 + BALANCE.rules.z.deploiementSpeedup) : t;
}

/** Is a point inside one of the player's linked power fields (Isdaris)? */
export function powered(this: World, player: number, x: number, y: number): boolean {
  return this.powerNetwork(player).some((b) => dist(b.x, b.y, x, y) <= (b.def as BuildingDef).power! * FP);
}

/**
 * The player's power buildings that are linked to a main building (Obelisk): finished ones whose
 * zones touch, step by step. An emitter cut off from it powers nothing.
 */
export function powerNetwork(this: World, player: number): Entity[] {
  const nodes = [...this.entities.values()].filter((b) => b.owner === player && (b.def as BuildingDef).power && b.buildLeft === 0);
  // Z (Z.doc): each Intelligence and Pod supérieur spreads its own creep, linked or not.
  if (this.players[player]?.faction === 'z') return nodes;
  const linked = nodes.filter((b) => (b.def as BuildingDef).dropoff);
  const rest = nodes.filter((b) => !(b.def as BuildingDef).dropoff);
  for (let i = 0; i < linked.length; i++) {
    const a = linked[i];
    for (let j = rest.length - 1; j >= 0; j--) {
      const b = rest[j];
      if (dist(a.x, a.y, b.x, b.y) <= ((a.def as BuildingDef).power! + (b.def as BuildingDef).power!) * FP) linked.push(...rest.splice(j, 1));
    }
  }
  return linked;
}

/** Z units and buildings on their own creep are repaired by the cables, a few hp each second (Z.doc: 1). */
export function repairOnCreep(this: World): void {
  for (const p of this.players) {
    if (p.faction !== 'z') continue;
    const net = this.powerNetwork(p.id);
    for (const u of this.entities.values()) {
      // Balise de vacarme (Accumulateur): living units round it, friend or foe, lose hp and cannot attack.
      if (u.owner === p.id && u.type === 'vacarme' && u.hp > 0) {
        const ab = ABILITIES.vacarme;
        for (const o of this.entities.values()) {
          if (o.def.kind !== 'unit' || o.hp <= 0 || o.inside || (o.def as UnitDef).mechanical || dist(o.x, o.y, u.x, u.y) > toFp(ab.radius!)) continue;
          o.hp -= ab.damage!;
          o.frozen = Math.max(o.frozen, ticks(1) + 1);
        }
      }
      // Kit Auto-réparateur (Centre K): 3 hp a second anywhere, flyers too.
      if (u.owner === p.id && u.support & KIT.reparateur && u.hp > 0) u.hp = Math.min(u.maxHp, u.hp + BALANCE.rules.z.kitRepair);
      if (u.owner !== p.id || u.def.kind === 'resource' || u.buildLeft > 0 || u.hp <= 0 || u.hp >= u.maxHp || flies(u)) continue;
      if (net.some((b) => dist(b.x, b.y, u.x, u.y) <= (b.def as BuildingDef).power! * FP)) u.hp = Math.min(u.maxHp, u.hp + BALANCE.rules.creepRepair);
    }
  }
}

/** Room in a bunker or carrier: Fortin, Scarabée, and Bourdons with Chargement. */
export function room(this: World, b: Entity): number {
  if (b.type === 'drake') return this.level(b.owner, 'drakegeant') ? BALANCE.rules.upgrades.drakegeant.room : 0;
  // Z Barge: supply carried, by tier (Z.doc).
  const transport = (b.def as UnitDef).transport;
  if (transport) return transport[b.tier - 1];
  return (b.def as BuildingDef | UnitDef).bunker ?? (b.type === 'bourdon' && this.level(b.owner, 'chargement') ? BALANCE.rules.upgrades.chargement : 0);
}

/** Who may get in: soldiers that shoot into a Fortin or a Scarabée, any foot soldier into a Bourdon. */
export function boards(this: World, e: Entity, b: Entity): boolean {
  const d = e.def as UnitDef;
  // Z Barge: any ground unit of its side, machines too.
  if ((b.def as UnitDef).transport) return !d.worker && !flies(e);
  if (d.worker || d.mechanical || d.beast) return false;
  return b.type === 'bourdon' || b.type === 'drake' || (!!this.weapon(e) && this.weapon(e)!.range > 1);
}

/** Training time in ticks, the Caserne's shortened by Entraînement groupé. */
export function trainTime(this: World, b: Entity, type: string): number {
  const levels = (b.def as UnitDef).levels;
  if (type === 'niveau' && levels) return ticks(levels.time[b.lvl - 1]);
  // A god summons in its base time divided by its level (XC.doc 2008); a building raised by Gaïa keeps her level only
  // to materialise faster.
  const t = idiv(ticks((DEFS[type] as UnitDef | UpgradeDef).buildTime), b.def.kind === 'unit' ? b.lvl : 1);
  if (DEFS[type].kind !== 'unit') return t;
  let speedup = b.type === 'caserne' && this.level(b.owner, 'entrainementgroupe') ? BALANCE.rules.upgrades.entrainementSpeedup : 0;
  if (b.type === 'portail' && this.level(b.owner, 'miniportail')) speedup += BALANCE.rules.upgrades.miniportailSpeedup;
  // The Grand Conseil plans production: every unit comes out faster while it stands.
  if ([...this.entities.values()].some((g) => g.owner === b.owner && g.type === 'grandconseil' && g.buildLeft === 0)) speedup += BALANCE.rules.upgrades.grandConseilSpeedup;
  // Z.doc: the Intelligence suprême turns drones out in 75 % of their time (Production accélérée).
  if (b.type === 'supreme') speedup += BALANCE.rules.z.supremeSpeedup;
  return idiv(t * (100 - speedup), 100);
}

export function operate(this: World, b: Entity): void {
  if (b.buildLeft > 0) {
    if (!(b.def as BuildingDef).warp && !(b.def as BuildingDef).absorbs) return;
    // Materialising (Isdaris) or assembling (Z): builds itself, hp and shield filling up.
    const total = this.buildTicks(b);
    // Called down by Gaïa at level N: N steps a tick.
    for (let s = 0; s < b.lvl && b.buildLeft > 0; s++) {
      b.buildLeft--;
      this.grow(b, total);
    }
    if (b.buildLeft === 0) {
      b.shield = b.maxShield;
      this.say(b.owner, `${(b.def as BuildingDef).absorbs ? 'Assemblage' : 'Matérialisation'} terminé${(b.def as BuildingDef).absorbs ? '' : 'e'} : ${b.def.name}.`, 'done');
    }
    return;
  }
  const def = b.def as BuildingDef;
  // Z Gel électronique: neither shoots nor produces while frozen.
  if (b.frozen > 0) return;
  // Defences (Orbe plasma) shoot the closest enemy unit in range.
  const attack = this.weapon(b);
  if (attack && b.cooldown === 0) {
    const t = this.enemyNear(b, toFp(attack.range), true);
    if (t && (!b.kit || reaches(attack, flies(t)))) {
      b.cooldown = ticks(attack.cooldown);
      this.hit(b, t, attack);
    }
  }
  if (def.energyRate && ++b.timer >= ticks(1 / def.energyRate)) {
    b.timer = 0;
    this.players[b.owner].energy++;
  }
  this.produce(b);
}

/** Training, research and morphing through the queue of a building, or of a god (Dieux). */
export function produce(this: World, b: Entity): void {
  // A rally point on a thing moves with it while it is seen, so its last known place is where it was last seen.
  if (b.rallyTarget && b.rally) {
    const t = this.entities.get(b.rallyTarget);
    if (t && (t.owner < 0 || this.sees(b.owner, t))) {
      b.rally.x = t.x;
      b.rally.y = t.y;
    }
  }
  if (b.queue.length && --b.trainLeft <= 0) {
    const type = b.queue.shift()!;
    const kit = b.kits.shift() ?? '';
    if (ARTEFACTS.includes(type)) {
      b.arts.push(type);
      if (b.boost === 0) b.speed = this.baseSpeed(b);
      this.say(b.owner, `${b.def.name} : ${DEFS[type].name} (${b.arts.length}/${BALANCE.rules.upgrades.artefacts.max}).`, 'done');
      if (b.queue.length) b.trainLeft = this.trainTime(b, b.queue[0]);
      return;
    }
    if (type === 'niveau') {
      this.ascend(b);
      if (b.queue.length) b.trainLeft = this.trainTime(b, b.queue[0]);
      return;
    }
    const up = DEFS[type];
    if (up.kind === 'building') {
      this.morph(b, type);
      if (b.queue.length) b.trainLeft = this.trainTime(b, b.queue[0]);
      return;
    }
    if (up.kind === 'upgrade') {
      this.players[b.owner].upgrades[up.line] = up.level;
      this.say(b.owner, `Recherche terminée : ${up.name}.`, 'done');
      if (type === 'megaespion') for (const u of this.entities.values()) if (u.owner === b.owner && u.type === 'zespion') this.fortify(u);
      if (type === 'sonderobuste') for (const u of this.entities.values()) if (u.owner === b.owner && u.type === 'drone') this.fortify(u);
      if (type === 'croissance') for (const u of this.entities.values()) if (u.owner === b.owner && this.grows(u)) this.fortify(u);
      if (type.startsWith('cercle') || ['boostgenetique', 'drakegeant', 'armurezodiacale'].includes(type)) for (const u of this.entities.values()) if (u.owner === b.owner) this.empower(u, type);
      if (b.queue.length) b.trainLeft = ticks((DEFS[b.queue[0]] as UpgradeDef).buildTime);
      return;
    }
    const u = this.spawnBeside(type, b);
    u.kit = kit;
    // Cuve génétique: Créatures come in pairs.
    if (type === 'creature' && this.level(b.owner, 'cuvegenetique')) {
      const twin = this.spawnBeside(type, b);
      this.rallyOn(twin, b);
    }
    this.rallyOn(u, b);
    if (b.queue.length) b.trainLeft = this.trainTime(b, b.queue[0]);
  }
}

/**
 * A unit sheltering in a bunker: out of reach, it shoots from inside with one more tile of range
 * (mod: « Bonus 1 portée »); thrown out if the bunker falls.
 */
export function shelter(this: World, e: Entity): void {
  const b = this.entities.get(e.inside);
  if (!b || b.hp <= 0) return this.leave(e);
  // Carried along; nobody shoots out of a flying transport.
  e.x = e.px = b.x;
  e.y = e.py = b.y;
  const a = this.weapon(e);
  if (e.cooldown > 0 || !a || flies(b)) return;
  const range = toFp(a.range + 1 + this.rangeBonus(e)) + (b.def.kind === 'building' ? b.def.size : 1) * FP / 2;
  const t = this.enemyNear(b, range, false, a);
  if (!t) return;
  e.cooldown = ticks(a.cooldown);
  this.hit({ ...e, x: b.x, y: b.y } as Entity, t, a);
}

/** Out of a bunker, on the nearest open tile beside it. */
export function leave(this: World, e: Entity): void {
  const b = this.entities.get(e.inside);
  e.inside = 0;
  const [x, y] = this.grid.nearestOpen(tileOf(e.x), tileOf(e.y), b?.def.kind === 'building' ? this.grid.level(b.tx, b.ty) : -1);
  e.x = e.px = x * FP + FP / 2;
  e.y = e.py = y * FP + FP / 2;
}

/**
 * A building site gains its hit points as it goes up: from a tenth to all of them over the build, in exact
 * steps (rounding each tick down used to leave finished buildings short), minus any damage taken meanwhile.
 */
export function grow(this: World, b: Entity, total: number): void {
  const done = total - b.buildLeft;
  const gain = idiv(b.maxHp * 9 * done, total * 10) - idiv(b.maxHp * 9 * (done - 1), total * 10);
  b.hp = Math.min(b.maxHp, b.hp + gain);
}

/** A building turned into another, in place, keeping its share of hit points and shields. */
export function morph(this: World, b: Entity, type: string): void {
  const def = DEFS[type] as BuildingDef;
  const shield = b.maxShield ? b.shield / b.maxShield : 1;
  this.retype(b, type);
  b.maxShield = def.shield ?? 0;
  b.shield = Math.round(b.maxShield * shield);
  b.cooldown = 0;
  this.say(b.owner, `Transformation terminée : ${def.name}.`, 'done');
}

/** Another type for the same entity (morph, take-off, landing, Déracinement, Élémentaire forms): its share of hit points kept. */
export function retype(this: World, e: Entity, type: string): void {
  const def = DEFS[type] as UnitDef | BuildingDef;
  const hp = e.hp / e.maxHp;
  e.type = type;
  e.def = def;
  e.maxHp = def.hp;
  e.hp = Math.max(1, Math.round(def.hp * hp));
}

/**
 * Sends a unit just out of `b` to its rally point. None: workers go mining, the others stay. On open ground: there.
 * On a thing: a field is mined by a worker, others go beside it; a friendly unit is followed; a friendly building,
 * gone beside; an enemy, attacked (by those that can hit it). A thing gone by then: its last known place.
 */
export function rallyOn(this: World, u: Entity, b: Entity): void {
  const worker = (u.def as UnitDef).worker;
  if (!b.rally) {
    const field = worker ? this.nearestField(u) : undefined;
    if (field) this.setOrder(u, { kind: 'gather', target: field.id, phase: 'go', timer: 0 });
    return;
  }
  const t = b.rallyTarget ? this.entities.get(b.rallyTarget) : undefined;
  const there = { kind: 'move', x: b.rally.x, y: b.rally.y, arrive: FP / 2 } as const;
  if (!t || (t.def.kind !== 'resource' && (t.hp <= 0 || t.inside))) return this.setOrder(u, there);
  if (t.def.kind === 'resource') {
    if (worker && t.type === 'minerai') return this.setOrder(u, { kind: 'gather', target: t.id, phase: 'go', timer: 0 });
    return this.setOrder(u, this.beside(t, b));
  }
  if (this.hostile(t.owner, u.owner)) {
    const w = this.weapon(u);
    if (w && reaches(w, t.def.kind === 'unit' && flies(t))) return this.setOrder(u, { kind: 'attack', target: t.id, auto: false, lx: u.x, ly: u.y });
    return this.setOrder(u, there);
  }
  if (t.def.kind === 'unit') return this.setOrder(u, { kind: 'follow', target: t.id, lx: t.x, ly: t.y });
  this.setOrder(u, this.beside(t, b));
}

/** A walk to the edge of a building or field, a tile out, on the side facing `from`. */
export function beside(this: World, t: Entity, from: Entity): { kind: 'move'; x: number; y: number; arrive: number } {
  const half = t.def.kind === 'unit' ? t.radius : idiv(((t.def as BuildingDef).size ?? 1) * FP, 2);
  const dx = from.x - t.x;
  const dy = from.y - t.y;
  const len = dist(from.x, from.y, t.x, t.y) || 1;
  return { kind: 'move', x: t.x + idiv(dx * (half + FP), len), y: t.y + idiv(dy * (half + FP), len), arrive: FP / 2 };
}

/** Spawns a unit on the open tile next to a building, on the side of its rally point. */
export function spawnBeside(this: World, type: string, b: Entity): Entity {
  if (b.def.kind === 'unit') {
    // At a god's feet, in front of it: the rally point, if any, is then walked to (rallyOn).
    const toward = { x: b.x, y: b.y - FP };
    const d = dist(b.x, b.y, toward.x, toward.y) || 1;
    const reach = b.radius + FP;
    const [tx, ty] = this.grid.nearestOpen(tileOf(b.x + idiv((toward.x - b.x) * reach, d)), tileOf(b.y + idiv((toward.y - b.y) * reach, d)), -1);
    return this.spawn(type, b.owner, tx * FP + FP / 2, ty * FP + FP / 2);
  }
  const size = (b.def as BuildingDef).size;
  const toward = b.rally ?? { x: b.x + FP, y: b.y + FP };
  let best = this.grid.nearestOpen(b.tx + size, b.ty + size, this.grid.level(b.tx, b.ty)); // walled in: closest open tile
  let bestD = Infinity;
  for (let y = b.ty - 1; y <= b.ty + size; y++) {
    for (let x = b.tx - 1; x <= b.tx + size; x++) {
      if (!this.grid.open(x, y)) continue;
      const d = dist(x * FP + FP / 2, y * FP + FP / 2, toward.x, toward.y);
      if (d < bestD) [best, bestD] = [[x, y], d];
    }
  }
  return this.spawn(type, b.owner, best[0] * FP + FP / 2, best[1] * FP + FP / 2);
}

/** What a carrier holds: units, or for a Z Barge, their supply. */
export function load(this: World, b: Entity, extra?: Entity): number {
  const barge = !!(b.def as UnitDef).transport;
  const weigh = (u: Entity) => (barge ? (u.def as UnitDef).supply : 1);
  let n = extra ? weigh(extra) : 0;
  for (const u of this.entities.values()) if (u.inside === b.id) n += weigh(u);
  return n;
}
