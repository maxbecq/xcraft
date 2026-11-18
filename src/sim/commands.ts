/** Players' commands into orders: what World.step applies first each tick. */
import BALANCE from '../balance.json';
import { ABILITIES, abilitiesOf, ARTEFACTS, type BuildingDef, DEFS, type Faction, reaches, type UnitDef, type UpgradeDef, WEAPONS, withKit } from '../data';
import { FP, dist, idiv, isqrt, ticks, toFp } from './fixed';
import { type Order, flies, type Entity, type Command, type World } from './world';

/** The supply building of each faction, for the "not enough supply" message. */
const SUPPLY_NAMES: Record<Faction, string> = { humains: 'greniers', isdaris: 'réserves psy', z: 'pods', dieux: "branches d'Yggdrasill" };

/** The player's own entities named by a command, each once. */
export function owned(this: World, c: Command): Entity[] {
  return [...new Set(c.ids)].map((id) => this.entities.get(id)).filter((e): e is Entity => !!e && e.owner === c.player);
}

export function apply(this: World, c: Command): void {
  // Commands will come from other machines one day: reject malformed numbers.
  if (!Array.isArray(c.ids) || ('x' in c && !(Number.isSafeInteger(c.x) && Number.isSafeInteger(c.y)))) return;
  if ('tx' in c && !(Number.isSafeInteger(c.tx) && Number.isSafeInteger(c.ty))) return;
  const mine = this.owned(c);
  const units = mine.filter((e) => e.def.kind === 'unit' && e.held === 0 && !e.inside);
  const buildings = mine.filter((e) => e.def.kind === 'building' && e.buildLeft === 0);
  if (c.kind === 'move' || c.kind === 'smart' || c.kind === 'attack' || c.kind === 'patrol' || c.kind === 'stop' || c.kind === 'build' || c.kind === 'hold') {
    for (const e of units) e.stand = c.kind === 'hold';
  }
  switch (c.kind) {
    case 'sandbox': {
      // Never in a real match: only a match with one player has these tools.
      const p = this.players[c.player];
      if (this.players.length !== 1 || !p || (c.tool !== 'unlimited' && c.tool !== 'instant' && c.tool !== 'reveal')) return;
      p[c.tool] = !!c.on;
      return;
    }
    case 'stop':
    case 'hold':
      units.forEach((e) => {
        e.next = [];
        this.setOrder(e, null);
      });
      return;
    case 'patrol': {
      const fighters = units.filter((e) => this.weapon(e) || (e.def as UnitDef).heal);
      const [ox, oy] = this.formation(fighters);
      for (const [i, e] of fighters.entries()) this.setOrder(e, { kind: 'attackMove', x: c.x + ox[i], y: c.y + oy[i], target: 0, back: [e.x, e.y] });
      return;
    }
    case 'unload':
      for (const b of [...buildings, ...units]) for (const u of [...this.entities.values()]) if (u.inside === b.id) this.leave(u);
      return;
    case 'move':
      this.moveGroup(units, c.x, c.y);
      return;
    case 'smart':
      this.smart(c, units, buildings);
      return;
    case 'attack': {
      const t = this.target(c);
      const fighters = units.filter((e) => this.weapon(e));
      if (t && this.hostile(t.owner, c.player)) {
        // Those that cannot hit it (a flyer, for melee) attack-move to where it is.
        for (const e of fighters) {
          if (reaches(this.weapon(e)!, t.def.kind === 'unit' && flies(t))) this.setOrder(e, { kind: 'attack', target: t.id, auto: false, lx: e.x, ly: e.y });
          else this.setOrder(e, { kind: 'attackMove', x: t.x, y: t.y, target: 0 });
        }
      } else {
        // A compact group keeps its formation, as with a plain move.
        const [ox, oy] = this.formation(fighters);
        for (const [i, e] of fighters.entries()) this.setOrder(e, { kind: 'attackMove', x: c.x + ox[i], y: c.y + oy[i], target: 0 });
      }
      return;
    }
    case 'build': {
      const worker = units.find((e) => (e.def as UnitDef).builder ?? (e.def as UnitDef).worker);
      const bdef = DEFS[c.type];
      // Morphs come out of a building's queue, Z add-ons out of a Pod: no worker raises them.
      if (!worker || bdef?.kind !== 'building' || bdef.faction !== this.players[c.player].faction || bdef.morphOnly || bdef.addon) return;
      const lack = this.lacks(c.player, c.type);
      if (lack) return void this.say(c.player, lack);
      if (!this.canPlace(c.type, c.tx, c.ty, c.player)) return void this.say(c.player, this.misplaced(bdef, c.tx, c.ty, c.player));
      this.setOrder(worker, { kind: 'build', type: c.type, tx: c.tx, ty: c.ty });
      return;
    }
    case 'train': {
      if (ARTEFACTS.includes(c.type)) {
        // An improvement from the Artefacterie, bought at a god anywhere; 4 at most per god, queued ones counted.
        const lack = this.lacks(c.player, c.type);
        if (lack) return void this.say(c.player, lack);
        const max = BALANCE.rules.upgrades.artefacts.max;
        const g = units.find((u) => (u.def as UnitDef).levels && u.arts.length + u.queue.filter((q) => ARTEFACTS.includes(q)).length < max && u.queue.length < 5);
        if (!g) return void this.say(c.player, `${max} améliorations au plus par dieu.`);
        const up = DEFS[c.type] as UpgradeDef;
        if (!this.pay(c.player, up)) return;
        g.queue.push(c.type);
        if (g.queue.length === 1) g.trainLeft = this.trainTime(g, c.type);
        return;
      }
      if (c.type === 'niveau') {
        // A god's next level, paid and queued at the god itself; one at a time, up to the last.
        const gods = units.filter((u) => (u.def as UnitDef).levels && !u.queue.includes('niveau'));
        const g = gods.find((u) => u.lvl < (u.def as UnitDef).levels!.hp.length);
        if (!g) return void (gods.length && this.say(c.player, `${gods[0].def.name} est déjà au niveau maximal.`));
        const lv = (g.def as UnitDef).levels!;
        if (g.queue.length >= 5) return void this.say(c.player, "File d'attente pleine.");
        if (!this.pay(c.player, { cost: lv.cost[g.lvl - 1] })) return;
        g.queue.push('niveau');
        g.kits.push('');
        if (g.queue.length === 1) g.trainLeft = this.trainTime(g, 'niveau');
        return;
      }
      // Gods summon too (Dieux). The least busy producer takes it: shortest queue, then the one whose current item
      // ends first, then the lowest id (deterministic); full ones are skipped.
      const producers = [...buildings, ...units.filter((u) => (u.def as UnitDef).trains)].sort((a, b) => a.queue.length - b.queue.length || a.trainLeft - b.trainLeft || a.id - b.id);
      let full = false;
      for (const b of producers) {
        const def = b.def as BuildingDef;
        if (def.researches?.includes(c.type)) {
          if (!this.researchable(c.player, c.type)) return;
          const lack = this.lacks(c.player, c.type);
          if (lack) return void this.say(c.player, lack);
          if (b.queue.length >= 5) {
            full = true;
            continue;
          }
          const up = DEFS[c.type] as UpgradeDef;
          if (!this.pay(c.player, up)) return;
          b.queue.push(c.type);
          b.kits.push('');
          if (b.queue.length === 1) b.trainLeft = ticks(up.buildTime);
          return;
        }
        if (def.morphs?.includes(c.type)) {
          // Turning into another building (Isdaris): one at a time, nothing else queued.
          if (b.queue.length) continue;
          const lack = this.lacks(c.player, c.type);
          if (lack) return void this.say(c.player, lack);
          const into = DEFS[c.type] as BuildingDef;
          if (!this.pay(c.player, into)) return;
          b.queue.push(c.type);
          b.kits.push('');
          b.trainLeft = ticks(into.buildTime);
          return;
        }
        if (def.addons?.includes(c.type)) {
          // Z: a Pod raises one add-on beside it, which assembles itself; no drone is spent.
          if (b.buildLeft > 0 || [...this.entities.values()].some((a) => a.host === b.id)) continue;
          const lack = this.lacks(c.player, c.type);
          if (lack) return void this.say(c.player, lack);
          const spot = this.addonSpot(b, c.type);
          if (!spot) return void this.say(c.player, "Pas de place à côté du Pod.");
          const add = DEFS[c.type] as BuildingDef;
          if (!this.pay(c.player, add)) return;
          const a = this.spawn(c.type, c.player, spot[0] * FP, spot[1] * FP);
          a.host = b.id;
          a.buildLeft = this.buildTicks(a);
          a.hp = Math.max(1, idiv(a.maxHp, 10));
          return;
        }
        if (!def.trains?.includes(c.type)) continue;
        const missing = this.lacks(c.player, c.type);
        if (missing) return void this.say(c.player, missing);
        if (b.queue.length >= 5) {
          full = true;
          continue;
        }
        const unit = DEFS[c.type] as UnitDef;
        // Z: the socle's weapon is chosen here, for good, and paid on top of it (Z.doc: « Arme adaptable »).
        const kit = c.weapon ? WEAPONS[c.weapon] : undefined;
        if (c.weapon && (!kit || !unit.weapons?.includes(c.weapon))) return;
        if (kit?.research && !this.level(c.player, kit.research)) return void this.say(c.player, `Requiert : ${DEFS[kit.research].name}`);
        const s = this.supply(c.player);
        if (s.used + unit.supply > s.max) return void this.say(c.player, `Logistique insuffisante : construisez des ${SUPPLY_NAMES[this.players[c.player].faction]}.`);
        if (!this.pay(c.player, { cost: withKit(unit, c.weapon) })) return;
        b.queue.push(c.type);
        b.kits.push(c.weapon ?? '');
        if (b.queue.length === 1) b.trainLeft = this.trainTime(b, c.type);
        return; // one building per command, like SC
      }
      if (full) this.say(c.player, "File d'attente pleine.");
      return;
    }
    case 'cancel':
      for (const b of mine) {
        if (b.def.kind !== 'building' && !(b.def as UnitDef).trains) continue;
        if (b.def.kind === 'building' && b.buildLeft > 0) {
          this.refund(c.player, b.def);
          this.remove(b);
        } else if (b.queue.length) {
          const t = b.queue.pop()!;
          const kit = b.kits.pop();
          this.refund(c.player, t === 'niveau' ? { cost: (b.def as UnitDef).levels!.cost[b.lvl - 1] } : { cost: withKit(DEFS[t] as UnitDef | UpgradeDef, kit) });
          if (b.queue.length) b.trainLeft = Math.max(b.trainLeft, 1);
        }
      }
      return;
    case 'trade': {
      const market = buildings.find((b) => b.type === 'marche' && b.buildLeft === 0);
      const p = this.players[c.player];
      const { give, get } = BALANCE.rules.trade;
      if (!market) return;
      if (p[c.sell] < give) return void this.say(c.player, c.sell === 'minerals' ? 'Pas assez de minerai.' : "Pas assez d'énergie.");
      p[c.sell] -= give;
      p[c.sell === 'minerals' ? 'energy' : 'minerals'] += get;
      return;
    }
    case 'arm': {
      const kit = WEAPONS[c.weapon];
      if (!kit) return;
      if (kit.research && !this.level(c.player, kit.research)) return void this.say(c.player, `Requiert : ${DEFS[kit.research].name}`);
      for (const b of buildings) {
        if (!(b.def as BuildingDef).weapons?.includes(c.weapon) || b.kit || b.buildLeft > 0) continue;
        if (!this.pay(c.player, kit)) return;
        b.kit = c.weapon;
        b.cooldown = 0;
      }
      return;
    }
    case 'evolve': {
      // Z.doc: in the field, for a reduced price, standing still a few seconds; Optimisation perfectionnée speeds it up.
      for (const e of units) {
        const next = this.nextTier(e);
        if (!next || e.evolving) continue;
        if (this.level(c.player, `r${e.type}`) <= e.tier) {
          this.say(c.player, `Requiert : ${(DEFS[`r${e.type}${e.tier + 1}`] as UpgradeDef).name}`);
          continue;
        }
        if (!this.pay(c.player, next)) return;
        const t = ticks(next.buildTime);
        e.evolving = this.level(c.player, 'optimisationp') ? idiv(t * 100, 100 + BALANCE.rules.z.optimisationSpeedup) : t;
        e.held = e.evolving;
        this.setOrder(e, null);
      }
      return;
    }
    case 'ability': {
      const named = c.name && buildings.find((b) => abilitiesOf(b.def as BuildingDef).includes(c.name!) && (c.name === 'canoniem' ? b.iemCd : b.abilityCd) === 0);
      if (c.name && !named) {
        // A named unit ability: aimed ones by the ready caster nearest the point, the others by every ready caster.
        const ab = ABILITIES[c.name];
        if (!ab) return;
        if (ab.research && !this.level(c.player, ab.research)) return void this.say(c.player, `Requiert : ${DEFS[ab.research].name}`);
        const casters = units.filter((e) => abilitiesOf(e.def as UnitDef).includes(c.name!) && e.abilityCd === 0);
        if (ab.target !== 'point') return void casters.forEach((e) => this.cast(e, c.name));
        if (c.x === undefined || c.y === undefined || !casters.length) return;
        const [x, y] = [c.x, c.y];
        const e = casters.sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y) || a.id - b.id)[0];
        return void this.setOrder(e, { kind: 'cast', ability: c.name, x, y });
      }
      for (const e of units) this.cast(e);
      const b = named || buildings.find((b) => (b.def as BuildingDef).ability && b.abilityCd === 0);
      if (b && c.name === 'envol') return void this.takeOff(b);
      if (!b || c.x === undefined || c.y === undefined) return;
      const kind = c.name ?? (b.def as BuildingDef).ability!;
      const ab = ABILITIES[kind];
      if (b.type === 'centrek') {
        if (ab.research && !this.level(c.player, ab.research)) return void this.say(c.player, `Requiert : ${DEFS[ab.research].name}`);
        return void this.centreK(b, kind, c.x, c.y);
      }
      if (this.silenced(b.x, b.y)) return void this.say(c.player, 'Silence des ions : impossible ici.');
      if (ab.research && !this.level(c.player, ab.research)) return void this.say(c.player, `Requiert : ${DEFS[ab.research].name}`);
      if (this.players[c.player].energy < ab.energy!) return void this.say(c.player, "Pas assez d'énergie.");
      if (kind === 'rappel' && !this.recall(b, c.x, c.y)) return void this.say(c.player, 'Aucune unité à rappeler.');
      if (kind === 'observation') this.scans.push({ owner: c.player, x: c.x, y: c.y, left: ticks(ab.duration) });
      if (kind === 'observatoire') this.scans.push({ owner: c.player, x: c.x, y: c.y, left: ticks(ab.duration), radius: ab.radius });
      if (kind === 'canonorbital') {
        // The beam needs an Espion watching the spot; it spares nothing under it.
        const [cx, cy] = [c.x, c.y];
        if (![...this.entities.values()].some((s) => s.owner === c.player && s.type === 'espion' && dist(s.x, s.y, cx, cy) <= toFp((s.def as UnitDef).sight))) return void this.say(c.player, 'Un Espion doit viser la cible.');
        for (const t of [...this.entities.values()]) if (t.def.kind !== 'resource' && t.hp > 0 && !t.inside && dist(t.x, t.y, cx, cy) <= toFp(ab.radius!)) this.hurt(t, ab.damage!);
      }
      if (kind === 'murenergie') this.wall(c.player, b, c.x, c.y, ab.radius!, ticks(ab.duration));
      if (kind === 'portedephasage') for (const u of this.entities.values()) if (u.owner === c.player && u.def.kind === 'unit' && dist(u.x, u.y, c.x, c.y) <= toFp(ab.radius!)) u.phased = ticks(ab.duration);
      this.casts.push({ kind, x: c.x, y: c.y });
      this.players[c.player].energy -= ab.energy!;
      b.abilityCd = ticks(ab.cooldown);
      return;
    }
  }
}

export function smart(this: World, c: Extract<Command, { kind: 'smart' }>, units: Entity[], buildings: Entity[]): void {
  const t = this.target(c);
  for (const b of buildings) {
    if (!(b.def as BuildingDef).trains) continue;
    b.rally = { x: c.x, y: c.y };
    b.rallyTarget = t?.type === 'minerai' ? t.id : 0;
  }
  const movers: Entity[] = [];
  for (const e of units) {
    const worker = (e.def as UnitDef).worker;
    if (t && this.hostile(t.owner, e.owner) && this.weapon(e) && reaches(this.weapon(e)!, t.def.kind === 'unit' && flies(t))) {
      this.setOrder(e, { kind: 'attack', target: t.id, auto: false, lx: e.x, ly: e.y });
    } else if (!worker && t && t.owner === e.owner && t.def.kind === 'unit' && (e.def as UnitDef).heal && t.hp < t.maxHp) {
      this.setOrder(e, { kind: 'heal', target: t.id });
    } else if (worker && t?.def.kind === 'resource' && t.type === 'minerai') {
      this.setOrder(e, { kind: 'gather', target: t.id, phase: 'go', timer: 0 });
    } else if (worker && e.type === 'drone' && t && t !== e && t.owner === e.owner && t.hp < t.maxHp && t.buildLeft === 0 && (t.def.kind === 'building' || (t.def as UnitDef).mechanical)) {
      // Z.doc: a drone repairs Z buildings and machines, 4 hp a second, against resources.
      this.setOrder(e, { kind: 'repair', target: t.id, owedM: 0, owedE: 0 });
    } else if (worker && t && t.owner === e.owner && t.def.kind === 'building' && t.buildLeft > 0 && !(t.def as BuildingDef).warp && !(t.def as BuildingDef).absorbs) {
      this.setOrder(e, { kind: 'construct', target: t.id });
    } else if (!worker && t && t !== e && t.owner === e.owner && this.room(t) && t.buildLeft === 0 && !flies(e) && this.boards(e, t)) {
      this.setOrder(e, { kind: 'enter', target: t.id });
    } else if (worker && t && t.owner === e.owner && (t.def as BuildingDef).dropoff && e.carry > 0) {
      this.setOrder(e, { kind: 'gather', target: this.nearestField(e)?.id ?? 0, phase: 'return', timer: 0 });
    } else {
      movers.push(e);
    }
  }
  this.moveGroup(movers, c.x, c.y);
}

/** A command's target, only if the player can see it (no clicking enemies through the fog). */
export function target(this: World, c: { player: number; target?: number }): Entity | undefined {
  const t = c.target !== undefined ? this.entities.get(c.target) : undefined;
  return t && (t.owner < 0 || this.sees(c.player, t)) ? t : undefined;
}

export function moveGroup(this: World, units: Entity[], x: number, y: number): void {
  if (units.length === 0) return;
  // A compact group keeps its formation; a spread-out one gathers into a block round the point.
  const [ox, oy] = this.formation(units, [x, y]);
  for (const [i, e] of units.entries()) this.setOrder(e, { kind: 'move', x: x + ox[i], y: y + oy[i], arrive: FP / 4 });
}

/**
 * Each unit's offset from the destination. A compact group keeps its formation. A spread-out one converges on the
 * point, or, given the point (`to`, a plain move), gets a slot each in a block facing the way it goes: rows across
 * the march, the units nearest the point in the front row, each row filled left to right as the units stand. All of
 * it is reckoned along the march, not the map's axes, so two mirrored groups get mirrored blocks (no side favoured).
 */
export function formation(this: World, units: Entity[], to?: [number, number]): [number[], number[], boolean] {
  const n = Math.max(1, units.length);
  const cx = idiv(units.reduce((s, e) => s + e.x, 0), n);
  const cy = idiv(units.reduce((s, e) => s + e.y, 0), n);
  const compact = units.every((e) => dist(e.x, e.y, cx, cy) < 4 * FP);
  if (compact || !to || units.length === 1) return [units.map((e) => (compact ? e.x - cx : 0)), units.map((e) => (compact ? e.y - cy : 0)), compact];
  // The march: from the group's centre to the point (straight "down" if it is already there).
  let [dx, dy] = [to[0] - cx, to[1] - cy];
  if (dx === 0 && dy === 0) dy = FP;
  const len = isqrt(dx * dx + dy * dy);
  const along = (e: Entity) => (e.x - cx) * dx + (e.y - cy) * dy; // larger: nearer the point
  const across = (e: Entity) => (e.y - cy) * dx - (e.x - cx) * dy; // larger: further left of the march
  const cols = isqrt(units.length - 1) + 1;
  const rows = idiv(units.length + cols - 1, cols);
  const step = 2 * units.reduce((m, e) => Math.max(m, e.radius), 0) + FP / 4; // even, so the block is centred exactly
  const order = units.map((_, i) => i).sort((a, b) => along(units[b]) - along(units[a]) || units[a].id - units[b].id);
  const ox: number[] = new Array(units.length);
  const oy: number[] = new Array(units.length);
  for (let r = 0; r < rows; r++) {
    // Front row first; in each row, the units from right to left of the march take the slots right to left.
    const row = order.slice(r * cols, r * cols + cols).sort((a, b) => across(units[a]) - across(units[b]) || units[a].id - units[b].id);
    const fwd = idiv((rows - 1) * step, 2) - r * step;
    row.forEach((u, c) => {
      const side = c * step - idiv((row.length - 1) * step, 2);
      ox[u] = idiv(dx * fwd - dy * side, len);
      oy[u] = idiv(dy * fwd + dx * side, len);
    });
  }
  return [ox, oy, false];
}

export function setOrder(this: World, e: Entity, order: Order | null): void {
  if (order && this.queueing && (e.order || e.next.length)) {
    e.next.push(order);
    return;
  }
  // An order done (or dropped): the next one in the list, if any.
  if (!order && e.next.length) order = e.next.shift()!;
  const old = e.order;
  if (old?.kind === 'gather') this.release(e, old.target);
  e.order = order;
  e.goal = null;
  e.path = [];
  e.blockedTicks = 0;
  e.stuck = 0;
}
