/** Buildings: placement, power network, production, research, morphs, bunkers and carriers. */
import BALANCE from '../balance.json';
import { ABILITIES, type BuildingDef, DEFS, HQ_MINERAL_GAP, HQ_TYPES, KIT, reaches, type UnitDef, type UpgradeDef } from '../data';
import { FP, dist, idiv, ticks, tileOf, toFp } from './fixed';
import { hits } from './combat';
import { flies, type Entity, type World } from './world';

/** Can `player` put this building here? (Without a player, the power field is not checked.) */
export function canPlace(this: World, type: string, tx: number, ty: number, player = -1): boolean {
  const def = DEFS[type] as BuildingDef;
  const g = this.grid;
  if (def.energyRate) {
    // The Z Assimilateur goes anywhere, off the creep too (équilibreur 23/11); off it, it extracts but does not shoot.
    if (def.needsPower && def.faction !== 'z' && player >= 0 && !this.powered(player, tx * FP + (def.size * FP) / 2, ty * FP + (def.size * FP) / 2)) return false;
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
  // (Not a Z Pod: each creep stands by itself.)
  if (def.power && !def.dropoff && def.faction !== 'z' && player >= 0 && !this.powerNetwork(player).some((b) => dist(b.x, b.y, cx, cy) <= (def.power! + (b.def as BuildingDef).power!) * FP)) return false;
  // A main building (the balancer, 2026-11-22): not within 3 tiles of a mineral field.
  if (HQ_TYPES.includes(type) && this.nearMinerals(tx, ty, def.size)) return false;
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

/** Whether a mineral field lies within HQ_MINERAL_GAP tiles of this footprint (counted tile to tile, 1 next to it). */
export function nearMinerals(this: World, tx: number, ty: number, size: number): boolean {
  for (const m of this.entities.values()) {
    if (m.type !== 'minerai') continue;
    const gx = Math.max(tx - m.tx, m.tx - (tx + size - 1), 0);
    const gy = Math.max(ty - m.ty, m.ty - (ty + size - 1), 0);
    if (Math.max(gx, gy) < HQ_MINERAL_GAP) return true;
  }
  return false;
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
  if (HQ_TYPES.some((t) => DEFS[t] === def) && this.nearMinerals(tx, ty, def.size)) return 'Trop près d’un gisement de minerai (3 cases au moins).';
  if (!def.needsPower || this.powered(player, tx * FP + (def.size * FP) / 2, ty * FP + (def.size * FP) / 2)) return 'Emplacement invalide.';
  return def.faction === 'z' ? 'Hors du creep.' : "Hors d'un champ d'énergie.";
}

/** How many add-ons a Pod carries, built or rising. */
export function addonsOf(this: World, pod: Entity): number {
  let n = 0;
  for (const a of this.entities.values()) if (a.host === pod.id) n++;
  return n;
}

/**
 * The 8 places round a Pod for an add-on (équilibreur 22/11: the Pod in the middle of a noughts-and-crosses grid):
 * north-west, north, north-east, west, east, south-west, south, south-east. A side place is centred on that side
 * (an odd difference of size leaves half a tile, taken towards the north or the west); a corner one meets the Pod's
 * corner. The add-on keeps its own size (the Plate-forme overhangs its square): proposition 2, provisional, all here.
 */
export function addonSlots(tx: number, ty: number, own: number, size: number): [number, number][] {
  const mid = Math.floor((own - size) / 2);
  const at = (d: number) => (d < 0 ? -size : d > 0 ? own : mid);
  const out: [number, number][] = [];
  for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) if (dx || dy) out.push([tx + at(dx), ty + at(dy)]);
  return out;
}

/**
 * Where a Pod's add-on goes: in the place the player chose (`slot`, 0 to 7, none if taken), or else against one of its
 * sides, the free one nearest the map's middle (the AI, and orders from before the 8 places).
 */
export function addonSpot(this: World, pod: Entity, type: string, slot?: number): [number, number] | undefined {
  if (slot === undefined) return this.addonSpotAt(type, pod.tx, pod.ty, (pod.def as BuildingDef).size, pod.owner);
  const at = addonSlots(pod.tx, pod.ty, (pod.def as BuildingDef).size, (DEFS[type] as BuildingDef).size)[slot];
  return at && this.canPlace(type, at[0], at[1], pod.owner) ? at : undefined;
}

/**
 * Is this Z building on its creep, and so working (équilibreur 22/11)? Those that need none (the Intelligences, the
 * Pods) always; a Pod's add-on while its Pod stands (or inside a creep); any other only inside a creep of its side.
 */
export function onCreep(this: World, b: Entity): boolean {
  const def = b.def as BuildingDef;
  // Proposition 1 (provisional): an add-on works while its Pod stands, wherever the creep ends.
  const host = def.addon && BALANCE.rules.z.addonOnCreepWithPod ? this.entities.get(b.host) : undefined;
  if (host && host.hp > 0) return true;
  if (def.faction !== 'z' || (!def.needsPower && !def.addon)) return true;
  return this.powered(b.owner, b.x, b.y);
}

/**
 * The same for a Pod of size `own` at (tx, ty), placed or not (the placement preview checks its add-on has room): one
 * of its 8 places (addonSlots, the player's), a side before a corner. On a side, an odd difference of size leaves half
 * a tile: the place shifted the other way is tried too, so a game turned with the map stays the same game.
 */
export function addonSpotAt(this: World, type: string, tx: number, ty: number, own: number, player: number): [number, number] | undefined {
  const size = (DEFS[type] as BuildingDef).size;
  const slots = addonSlots(tx, ty, own, size);
  const corners = [0, 2, 5, 7].map((i) => slots[i]);
  const sides = [1, 3, 4, 6].map((i) => slots[i]);
  if ((own - size) % 2) {
    const shift = Math.ceil((own - size) / 2) - Math.floor((own - size) / 2);
    sides.push([slots[1][0] + shift, slots[1][1]], [slots[3][0], slots[3][1] + shift], [slots[4][0], slots[4][1] + shift], [slots[6][0] + shift, slots[6][1]]);
  }
  // Seen from every corner alike (a fixed east-first order put a bottom-right base's add-on at its back): spots by
  // distance to the middle, a tie to the one left of the line from the Pod. Doubled tile units, all whole.
  const [mx, my, px, py] = [this.map.width, this.map.height, 2 * tx + own, 2 * ty + own];
  const key = ([x, y]: [number, number]) => {
    const [cx, cy] = [2 * x + size, 2 * y + size];
    return (cx - mx) ** 2 + (cy - my) ** 2 + ((mx - px) * (cy - py) - (my - py) * (cx - px) < 0 ? 0 : 0.5);
  };
  const best = (list: [number, number][]) => list.sort((a, b) => key(a) - key(b)).find(([x, y]) => this.canPlace(type, x, y, player));
  return best(sides) ?? best(corners);
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
  return !def.needsPower || (def.faction === 'z' && !!def.energyRate) || net.some((b) => dist(b.x, b.y, x * FP + FP / 2, y * FP + FP / 2) <= (b.def as BuildingDef).power! * FP + slack);
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

/** Room in a bunker or carrier: Fortin, Scarabée, Drake géant; the Barge and the Dirigeable by the supply they carry. */
export function room(this: World, b: Entity): number {
  if (b.type === 'drake') return this.level(b.owner, 'drakegeant') ? BALANCE.rules.upgrades.drakegeant.room : 0;
  // Z Barge: supply carried, by tier (Z.doc).
  const transport = (b.def as UnitDef).transport;
  if (transport) return transport[b.tier - 1];
  return (b.def as BuildingDef | UnitDef).bunker ?? 0;
}

/** Who may get in: soldiers that shoot into a Fortin or a Scarabée; into a Barge or a Dirigeable, any ground unit, its
 * workers too, each taking its supply's room (équilibreur 23-24/11, every side). */
export function boards(this: World, e: Entity, b: Entity): boolean {
  const d = e.def as UnitDef;
  // No shelter within a carried shelter: a Scarabée in a Dirigeable takes nobody, and goes in only empty.
  if (b.inside || ((b.def as UnitDef).transport && this.load(e) > 0)) return false;
  // Z Barge: any ground unit of its side, machines too.
  if ((b.def as UnitDef).transport || b.type === 'drake') return !flies(e);
  // Z Refuge (notice): the Intelligence shelters its drones, and only them; the Assimilateur takes 3 to run fully, the
  // Dieux' Puits 4 Esprits.
  if ((b.def as BuildingDef).dropoff || (b.def as BuildingDef).energyRate) return !!d.worker;
  if (d.worker || d.mechanical || d.beast) return false;
  return b.type === 'drake' || (!!this.weapon(e) && this.weapon(e)!.range > 1);
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
  // Z.doc: the Intelligence suprême turns drones out in 75 % of their time (Production accélérée).
  if (b.type === 'supreme') speedup += BALANCE.rules.z.supremeSpeedup;
  const time = idiv(t * (100 - speedup), 100);
  // Planification industrielle (the balancer, 2026-11-22): while a Grand Conseil stands, every unit but the Serf is made
  // 10 % faster (its speed, so its time divided by 1.1).
  const planned = type !== 'serf' && [...this.entities.values()].some((g) => g.owner === b.owner && g.type === 'grandconseil' && g.buildLeft === 0);
  return planned ? idiv(time * 100, 100 + BALANCE.rules.upgrades.grandConseilSpeedup) : time;
}

export function operate(this: World, b: Entity): void {
  if (b.buildLeft > 0) {
    if (!(b.def as BuildingDef).warp && !(b.def as BuildingDef).absorbs) return;
    // An Isdaris site whose construction zone is lost is gone, nothing paid back (équilibreur 24/11).
    if ((b.def as BuildingDef).faction === 'isdaris' && (b.def as BuildingDef).needsPower && this.tick % 10 === 0 && !this.powered(b.owner, b.x, b.y)) {
      this.say(b.owner, `Zone de construction perdue : ${b.def.name} annulé${b.def.name.endsWith('e') ? 'e' : ''}.`);
      b.hp = 0;
      return;
    }
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
  // Z Gel électronique, Isdaris Bouclier de plasma: neither shoots nor produces while frozen or phased; a Z building
  // off its creep neither (équilibreur 22/11).
  if (b.frozen > 0 || b.phased > 0) return;
  // Proposition 6 (provisional): what a Z building off its creep stops doing (all of it), its hp kept.
  const off = def.faction === 'z' && (def.needsPower || def.addon) && !this.onCreep(b) ? BALANCE.rules.z.offCreep : undefined;
  // Defences (Orbe plasma) shoot the closest enemy unit in range.
  // An Orbe plasma being redeployed does not shoot (équilibreur 24/11).
  const attack = (off && !off.shoots) || b.muted > 0 ? undefined : this.weapon(b);
  if (attack && b.cooldown === 0) {
    const f = b.focus ? this.entities.get(b.focus) : undefined;
    if (b.focus && (!f || f.hp <= 0 || f.inside)) b.focus = 0;
    const t = f && f.hp > 0 && !f.inside && this.gap(b, f) <= toFp(attack.range) && hits(attack, f) ? f : this.enemyNear(b, toFp(attack.range), true);
    if (t && (!b.kit || reaches(attack, flies(t)))) {
      b.cooldown = ticks(attack.cooldown);
      this.hit(b, t, attack);
    }
  }
  // Z Tourelle with a Réparateur (équilibreur 22/11): mends the most hurt machine or building in its reach, once a second.
  if (b.kit === 'reparateur' && b.cooldown === 0 && !(off && !off.shoots)) {
    const p = this.patient(b);
    if (p) {
      p.hp = Math.min(p.maxHp, p.hp + this.healRate(b));
      b.cooldown = ticks(1);
      this.shots.push({ x1: b.x, y1: b.y, x2: p.x, y2: p.y, kind: 'heal' });
    }
  }
  // Each worker inside adds a quarter of the full rate: the Assimilateur's 3 drones on top of the 25 % it runs at alone
  // (notice), the Puits' 4 Esprits from nothing (balance designer 2026-11-22).
  // Quarters of work pile up tick by tick, so a crew coming in or out changes only the ticks after it.
  if (def.energyRate && !(off && !off.energy)) {
    b.timer += def.bunker ? 4 - def.bunker + this.load(b) : 4;
    const full = ticks(1 / def.energyRate) * 4;
    if (b.timer >= full) {
      // Its well runs dry at last (équilibreur 24/11: 7500 in each).
      const well = [...this.entities.values()].find((w) => w.type === 'puits' && w.tx === b.tx && w.ty === b.ty);
      if (well && well.amount <= 0) b.timer = 0;
      else {
        b.timer -= full;
        this.players[b.owner].energy++;
        if (well) well.amount--;
      }
    }
  }
  if (!(off && !off.produces)) this.produce(b);
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
  // Miniportail (notice: a second production building): the unit second in the queue is made alongside the first.
  // Laboratoire on a Portail, Totem on a Psycho-assembleur (équilibreur 24/11): a unit and a research at once.
  if (!b.trainLeft2 && b.queue.length > 1 && this.twoLines(b)) b.trainLeft2 = this.trainTime(b, b.queue[1]);
  if (b.trainLeft2 && --b.trainLeft2 === 0) {
    const [type] = b.queue.splice(1, 1);
    const [kit] = b.kits.splice(1, 1);
    if (DEFS[type].kind === 'upgrade') this.finish(b, type);
    else this.deliver(b, type, kit ?? '');
  }
  if (b.queue.length && --b.trainLeft <= 0) {
    const type = b.queue.shift()!;
    const kit = b.kits.shift() ?? '';
    this.finish(b, type, kit);
    this.next(b);
  }
}

/** Whether the second of a queue runs alongside the first: two units with a Miniportail; a unit and a research with a
 * Laboratoire on a Portail or a Totem on a Psycho-assembleur (équilibreur 24/11). */
export function twoLines(this: World, b: Entity): boolean {
  const [a, c] = b.queue;
  const research = (t: string) => DEFS[t].kind === 'upgrade' && !(DEFS[t] as UpgradeDef).host;
  if (b.type === 'portail' && b.exts.includes('miniportail') && DEFS[c].kind === 'unit') return true;
  const lab = (b.type === 'portail' && b.exts.includes('laboratoire')) || (b.type === 'nanoassembleur' && b.exts.includes('totem'));
  return lab && ((DEFS[a].kind === 'unit' && research(c)) || (research(a) && DEFS[c].kind === 'unit'));
}

/** What a queue's item does once done: a god's level, a morph, an extension, a research, a unit. */
export function finish(this: World, b: Entity, type: string, kit = ''): void {
  {
    if (type === 'niveau') return this.ascend(b);
    const up = DEFS[type];
    if (up.kind === 'building') return this.morph(b, type);
    if (up.kind === 'upgrade' && up.host) {
      // An Isdaris extension: onto this building, its own.
      b.exts.push(type);
      this.say(b.owner, `${b.def.name} : ${up.name}.`, 'done');
      return;
    }
    if (up.kind === 'upgrade') {
      this.players[b.owner].upgrades[up.line] = up.level;
      this.say(b.owner, `Recherche terminée : ${up.name}.`, 'done');
      if (type === 'scarabeassaut') for (const u of this.entities.values()) if (u.owner === b.owner && u.type === 'scarabee' && u.boost === 0) u.speed = this.baseSpeed(u);
      if (type === 'megaespion') for (const u of this.entities.values()) if (u.owner === b.owner && u.type === 'zespion') this.fortify(u);
      if (type === 'sonderobuste') for (const u of this.entities.values()) if (u.owner === b.owner && (u.type === 'drone' || u.type === 'dronecombat')) this.fortify(u);
      if (type === 'croissance') for (const u of this.entities.values()) if (u.owner === b.owner && this.grows(u)) this.fortify(u);
      if (type.startsWith('cercle') || ['boostgenetique', 'drakegeant', 'auraputride'].includes(type)) for (const u of this.entities.values()) if (u.owner === b.owner) this.empower(u, type);
      return;
    }
    this.deliver(b, type, kit);
  }
}

/** The first of a queue done: the next starts, from where the Miniportail's second line had brought it. */
export function next(this: World, b: Entity): void {
  if (b.queue.length) b.trainLeft = b.trainLeft2 || this.trainTime(b, b.queue[0]);
  b.trainLeft2 = 0;
}

/** A unit trained: out beside its producer, to the rally point. */
export function deliver(this: World, b: Entity, type: string, kit: string): void {
  const u = this.spawnBeside(type, b);
  u.kit = kit;
  // Z Réparateur, Accumulateur: their energy, half full (shortcut: no source gives a start, the mod's casters start at half).
  const mana = this.manaOf(u);
  if (mana) u.mana = toFp(mana[1]);
  // Cuve génétique: Créatures come in pairs, the second one only if the supply has room for it (only one was queued).
  const room = type === 'creature' && b.exts.includes('cuvegenetique') ? this.supply(b.owner) : undefined;
  if (room && room.used + (DEFS.creature as UnitDef).supply <= room.max) {
    const twin = this.spawnBeside(type, b);
    this.rallyOn(twin, b);
  }
  this.rallyOn(u, b);
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
  // Drones in the Refuge only shelter.
  if (e.cooldown > 0 || !a || flies(b) || (e.def as UnitDef).worker) return;
  const range = toFp(a.range + 1 + this.rangeBonus(e)) + (b.def.kind === 'building' ? b.def.size : 1) * FP / 2;
  const t = this.enemyNear(b, range, false, a);
  if (!t) return;
  e.cooldown = ticks(a.cooldown);
  // The passenger itself (it stands on its shelter): what comes back at it (Sphère de renvoi) hurts it, not a copy.
  this.hit(e, t, a);
}

/** The tile of a point; right on an edge (an even-sized building's middle), the one on the map's middle side. */
const midward = (x: number, y: number, w: number, h: number): [number, number] => {
  const t = (v: number, n: number) => (v % FP === 0 && v >= idiv(n * FP, 2) ? v / FP - 1 : tileOf(v));
  return [t(x, w), t(y, h)];
};

/** Out of a bunker, on the open tile beside it nearest the map's middle (from every corner alike). */
export function leave(this: World, e: Entity): void {
  const b = this.entities.get(e.inside);
  e.inside = 0;
  const [x, y] =
    b?.def.kind === 'building'
      ? this.besideTile(b, { x: idiv(this.map.width * FP, 2), y: idiv(this.map.height * FP, 2) }, this.grid.level(b.tx, b.ty))
      : this.grid.nearestOpen(...midward(e.x, e.y, this.map.width, this.map.height), -1, [(this.map.width - 1) / 2, (this.map.height - 1) / 2]);
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
  this.unlist();
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
  // A Fortin (the balancer, 2026-11-22): the unit goes in, if it may and there is room.
  if (t.type === 'fortin' && t.owner === u.owner && t.buildLeft === 0 && this.boards(u, t) && this.load(t, u) <= this.room(t)) return this.setOrder(u, { kind: 'enter', target: t.id });
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
  // Seen from every corner alike: with no rally point, toward the map's middle (it was always down and right, the back
  // of a base in the bottom-right corner); ties go to the tile left of the line from the building, not the scan order.
  const mid = { x: idiv(this.map.width * FP, 2), y: idiv(this.map.height * FP, 2) };
  if (b.def.kind === 'unit') {
    // At a god's feet, on the side of the map's middle (north, before: behind it from one corner, before it from the
    // other): the rally point, if any, is then walked to (rallyOn).
    const toward = b.x === mid.x && b.y === mid.y ? { x: b.x, y: b.y - FP } : mid;
    const d = dist(b.x, b.y, toward.x, toward.y) || 1;
    const reach = b.radius + FP;
    const at = midward(b.x + idiv((toward.x - b.x) * reach, d), b.y + idiv((toward.y - b.y) * reach, d), this.map.width, this.map.height);
    const [tx, ty] = this.grid.nearestOpen(...at, -1, [(this.map.width - 1) / 2, (this.map.height - 1) / 2]);
    return this.spawn(type, b.owner, tx * FP + FP / 2, ty * FP + FP / 2);
  }
  const [tx, ty] = this.besideTile(b, b.rally ?? mid);
  return this.spawn(type, b.owner, tx * FP + FP / 2, ty * FP + FP / 2);
}

/**
 * The open tile round a building nearest a point (`level`: only on that level); a tie to the one left of the line
 * from the building to it.
 */
export function besideTile(this: World, b: Entity, toward: { x: number; y: number }, level = -1): [number, number] {
  const size = (b.def as BuildingDef).size;
  const [lx, ly] = [toward.x - b.x, toward.y - b.y];
  let best = this.grid.nearestOpen(b.tx + size, b.ty + size, this.grid.level(b.tx, b.ty)); // walled in: closest open tile
  let bestD = Infinity;
  for (let y = b.ty - 1; y <= b.ty + size; y++) {
    for (let x = b.tx - 1; x <= b.tx + size; x++) {
      if (!this.grid.open(x, y) || (level >= 0 && this.grid.level(x, y) !== level)) continue;
      const [cx, cy] = [x * FP + FP / 2, y * FP + FP / 2];
      const d = dist(cx, cy, toward.x, toward.y);
      if (d < bestD || (d === bestD && lx * (cy - b.y) - ly * (cx - b.x) < 0)) [best, bestD] = [[x, y], d];
    }
  }
  return best;
}

/** What a carrier holds: units, or for a Z Barge, their supply. */
export function load(this: World, b: Entity, extra?: Entity): number {
  const barge = !!(b.def as UnitDef).transport || b.type === 'drake';
  const weigh = (u: Entity) => (barge ? (u.def as UnitDef).supply : 1);
  let n = extra ? weigh(extra) : 0;
  for (const u of this.entities.values()) if (u.inside === b.id) n += weigh(u);
  return n;
}
