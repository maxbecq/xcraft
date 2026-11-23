/** Players' commands into orders: what World.step applies first each tick. */
import BALANCE from '../balance.json';
import { ABILITIES, abilitiesOf, ARTEFACTS, type BuildingDef, DEFS, type Faction, raises, reaches, spell, type UnitDef, type UpgradeDef, WEAPONS, withKit } from '../data';
import { onMap } from './abilities';
import { healable } from './combat';
import { commandOk } from './validate';
import { FP, dist, idiv, isqrt, ticks, toFp } from './fixed';
import { type Order, cdOf, flies, repairs, type Entity, type Command, type World } from './world';

/** The supply building of each faction, for the "not enough supply" message. */
const SUPPLY_NAMES: Record<Faction, string> = { humains: 'greniers', isdaris: 'réserves psy', z: 'pods', dieux: "branches d'Yggdrasill" };

/** The player's own entities named by a command, each once. */
export function owned(this: World, c: Command): Entity[] {
  return [...new Set(c.ids)].map((id) => this.entities.get(id)).filter((e): e is Entity => !!e && e.owner === c.player);
}

/** « Requiert : … » while the research is not done, for a message or a greyed button; nothing once it is. An extension: on `at` (hasExt). */
export function needs(this: World, player: number, research?: string, at?: Entity): string | undefined {
  if (!research) return undefined;
  const done = (DEFS[research] as UpgradeDef).host ? this.hasExt(player, research, at) : this.level(player, research) > 0;
  return done ? undefined : `Requiert : ${DEFS[research].name}`;
}

/** A god's improvements from the Artefacterie, those bought and those queued. */
export function artefacts(this: World, g: Entity): number {
  return g.arts.length + g.queue.filter((q) => ARTEFACTS.includes(q)).length;
}

/** Into a producer's queue, already paid for, with the weapon chosen for a Z socle; it starts at once when first. */
export function enqueue(this: World, b: Entity, type: string, kit = ''): void {
  b.queue.push(type);
  b.kits.push(kit);
  if (b.queue.length === 1) b.trainLeft = this.trainTime(b, type);
  // A god summoning or going up a level stops where it stands.
  if (this.busy(b) && b.order && STILL.has(b.order.kind)) this.setOrder(b, null);
}

/** What a god that is busy may not do: walk or fight. */
const STILL = new Set(['move', 'attack', 'attackMove', 'follow', 'enter', 'build', 'cast']);

/**
 * A god other than Gaïa summoning, going up a level, or raising a building: it neither moves nor fights till that is
 * done (balance designer, 2026-11-22). Gaïa's buildings rise alone and her Esprits come out as she walks.
 */
export function busy(this: World, e: Entity): boolean {
  const d = e.def as UnitDef;
  if (!d.unique || d.faction !== 'dieux' || !d.levels || e.type === 'gaia') return false;
  if (e.queue.length) return true;
  const b = e.raising ? this.entities.get(e.raising) : undefined;
  if (b && b.hp > 0 && b.buildLeft > 0) return true;
  e.raising = 0;
  return false;
}

export function apply(this: World, c: Command): void {
  // The same check as for the other side's orders and a replay's (sim/validate.ts): none accepts what another drops.
  if (!commandOk(c, true, true)) return;
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
    case 'resign': {
      const p = this.players[c.player];
      if (!p || p.resigned || this.winner !== null || this.players.length < 2) return;
      p.resigned = true;
      for (const o of this.players) if (o !== p) this.say(o.id, o.team === p.team ? 'Votre allié abandonne.' : "L'adversaire abandonne.", 'alert');
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
      const fighters = units.filter((e) => this.weapon(e) || this.healRate(e));
      const [ox, oy] = this.formation(fighters);
      for (const [i, e] of fighters.entries()) this.setOrder(e, { kind: 'attackMove', x: c.x + ox[i], y: c.y + oy[i], target: 0, back: [e.x, e.y] });
      return;
    }
    case 'unload':
      for (const b of [...buildings, ...units]) for (const u of [...this.entities.values()]) if (u.inside === b.id && (c.unit === undefined || u.id === c.unit)) this.leave(u);
      return;
    case 'move':
      this.moveGroup(units, c.x, c.y);
      return;
    case 'smart':
      this.smart(c, units, buildings);
      return;
    case 'rally': {
      const t = this.target(c);
      for (const e of mine) if ((e.def as UnitDef).trains?.length && e.buildLeft === 0 && !e.inside) this.setRally(e, c, t);
      return;
    }
    case 'attack': {
      const t = this.target(c);
      const fighters = units.filter((e) => this.weapon(e));
      // An explicit attack may also aim at one's own side (or an ally's): to finish off a wounded unit, deny a kill,
      // clear a building. Never at a resource or a neutral thing.
      if (t && t.owner >= 0 && (this.hostile(t.owner, c.player) || t.def.kind !== 'resource')) {
        // Those that cannot hit it (a flyer, for melee) attack-move to where it is.
        for (const e of fighters) {
          if (e === t) continue; // no unit strikes itself
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
      const worker = units.find((e) => raises(e.def as UnitDef, c.type));
      const bdef = DEFS[c.type];
      // Isdaris (fiche 2010, mod): the Obélisque materialises it at once, wherever its side sees in the transfer zone,
      // then waits half the building's time (the mod's figure) before the next.
      const obelisk = worker ? undefined : buildings.find((b) => raises(b.def as BuildingDef, c.type) && b.buildLeft === 0);
      if (obelisk && bdef?.kind === 'building') {
        if ((obelisk.spellCd.materialisation ?? 0) > this.tick) {
          const ready = buildings.find((b) => b.type === obelisk.type && b.buildLeft === 0 && (b.spellCd.materialisation ?? 0) <= this.tick);
          if (!ready) return void this.say(c.player, 'Matérialisation en recharge.');
          return this.materialise(ready, c.type, c.tx, c.ty);
        }
        return this.materialise(obelisk, c.type, c.tx, c.ty);
      }
      // Morphs come out of a building's queue, Z add-ons out of a Pod: no worker raises them.
      if (!worker || bdef?.kind !== 'building' || bdef.faction !== this.players[c.player].faction || bdef.morphOnly || bdef.addon) return;
      const lack = this.lacks(c.player, c.type);
      if (lack) return void this.say(c.player, lack);
      if (!this.canPlace(c.type, c.tx, c.ty, c.player)) return void this.say(c.player, this.misplaced(bdef, c.tx, c.ty, c.player));
      this.setOrder(worker, { kind: 'build', type: c.type, tx: c.tx, ty: c.ty });
      return;
    }
    case 'train': {
      if (c.type === 'niveau') {
        // A god's next level, paid and queued at the god itself; one at a time, up to the last.
        const gods = units.filter((u) => (u.def as UnitDef).levels && !u.queue.includes('niveau'));
        const g = gods.find((u) => u.lvl < (u.def as UnitDef).levels!.hp.length);
        if (!g) return void (gods.length && this.say(c.player, `${gods[0].def.name} est déjà au niveau maximal.`));
        const lv = (g.def as UnitDef).levels!;
        if (g.queue.length >= 5) return void this.say(c.player, "File d'attente pleine.");
        if (!this.pay(c.player, { cost: lv.cost[g.lvl - 1] })) return;
        this.enqueue(g, 'niveau');
        return;
      }
      // Gods summon too (Dieux). The least busy producer takes it: shortest queue, then the one whose current item
      // ends first, then the lowest id (deterministic); full ones are skipped.
      const producers = [...buildings, ...units.filter((u) => (u.def as UnitDef).trains)].sort((a, b) => a.queue.length - b.queue.length || a.trainLeft - b.trainLeft || a.id - b.id);
      let full = false;
      // What the producers lacked (an extension on another building of the same type may still have it).
      let lacking = '';
      for (const b of producers) {
        const def = b.def as BuildingDef;
        if (def.researches?.includes(c.type)) {
          // An extension goes onto this very building (notice): skip those that carry it or have it queued.
          if ((DEFS[c.type] as UpgradeDef).host) {
            if (!this.researchable(c.player, c.type, b)) continue;
          } else if (!this.researchable(c.player, c.type)) return;
          const lack = this.lacks(c.player, c.type, undefined, b);
          if (lack) {
            lacking = lack;
            continue;
          }
          if (b.queue.length >= 5) {
            full = true;
            continue;
          }
          const up = DEFS[c.type] as UpgradeDef;
          if (!this.pay(c.player, up)) return;
          this.enqueue(b, c.type);
          return;
        }
        if (def.morphs?.includes(c.type)) {
          // Turning into another building (Isdaris): one at a time, nothing else queued.
          if (b.queue.length) continue;
          const lack = this.lacks(c.player, c.type);
          if (lack) return void this.say(c.player, lack);
          const into = DEFS[c.type] as BuildingDef;
          if (!this.pay(c.player, into)) return;
          this.enqueue(b, c.type);
          return;
        }
        if (def.addons?.includes(c.type)) {
          // Z: a Pod raises add-ons beside it (notice: up to 3), which assemble themselves; no drone is spent.
          if (b.buildLeft > 0 || this.addonsOf(b) >= BALANCE.rules.z.podAddons) continue;
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
        const missing = this.lacks(c.player, c.type, undefined, b);
        if (missing) {
          lacking = missing;
          continue;
        }
        if (b.queue.length >= 5) {
          full = true;
          continue;
        }
        const unit = DEFS[c.type] as UnitDef;
        // Z: the socle's weapon is chosen here, for good, and paid on top of it (Z.doc: « Arme adaptable »).
        const kit = c.weapon ? WEAPONS[c.weapon] : undefined;
        if (c.weapon && (!kit || !unit.weapons?.includes(c.weapon))) return;
        const need = this.needs(c.player, kit?.research);
        if (need) return void this.say(c.player, need);
        const s = this.supply(c.player);
        if (s.used + unit.supply > s.max) return void this.say(c.player, `Logistique insuffisante : construisez des ${SUPPLY_NAMES[this.players[c.player].faction]}.`);
        if (!this.pay(c.player, { cost: withKit(unit, c.weapon) })) return;
        this.enqueue(b, c.type, c.weapon);
        return; // one building per command, like SC
      }
      if (full) this.say(c.player, "File d'attente pleine.");
      else if (lacking) this.say(c.player, lacking);
      return;
    }
    case 'cancel':
      for (const b of mine) {
        if (b.def.kind !== 'building' && !(b.def as UnitDef).trains) continue;
        if (b.def.kind === 'building' && b.buildLeft > 0) {
          this.refund(c.player, b.def);
          this.remove(b);
        } else if (b.queue.length) {
          const i = c.slot ?? b.queue.length - 1;
          if (!Number.isSafeInteger(i) || i < 0 || i >= b.queue.length) continue;
          const [t] = b.queue.splice(i, 1);
          const [kit] = b.kits.splice(i, 1);
          this.refund(c.player, t === 'niveau' ? { cost: (b.def as UnitDef).levels!.cost[b.lvl - 1] } : { cost: withKit(DEFS[t] as UnitDef | UpgradeDef, kit) });
          // The one in progress taken out: the next starts afresh, as when it is queued first.
          if (i === 0 && c.slot !== undefined) this.next(b);
          else if (b.queue.length) b.trainLeft = Math.max(b.trainLeft, 1);
          // The Miniportail's second line loses what it was making.
          if (i === 1) b.trainLeft2 = 0;
        }
      }
      return;
    case 'trade': {
      const market = buildings.find((b) => b.type === 'marche' && b.buildLeft === 0);
      const p = this.players[c.player];
      const { give, get } = BALANCE.rules.trade;
      if (!market || (c.sell !== 'minerals' && c.sell !== 'energy')) return;
      if (p[c.sell] < give) return void this.say(c.player, c.sell === 'minerals' ? 'Pas assez de minerai.' : "Pas assez d'énergie.");
      p[c.sell] -= give;
      p[c.sell === 'minerals' ? 'energy' : 'minerals'] += get;
      return;
    }
    case 'arm': {
      const kit = WEAPONS[c.weapon];
      if (!kit) return;
      const need = this.needs(c.player, kit.research);
      if (need) return void this.say(c.player, need);
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
      // Replays recorded before the Walkyrie had her own Camouflage: hers under the old name.
      if (c.name === 'camouflage' && mine.some((e) => e.type === 'walkyrie')) {
        const ids = mine.filter((e) => e.type === 'walkyrie').map((e) => e.id);
        this.apply({ ...c, name: 'camouflagewalkyrie', ids });
        const rest = c.ids.filter((id) => !ids.includes(id));
        if (rest.length) this.apply({ ...c, ids: rest });
        return;
      }
      // A building's power behind an extension (notice: the Orbe's Observatoire, the Trône's): one that carries it first.
      const unlocked = (b: Entity, name: string) => !this.needs(c.player, ABILITIES[name]?.research, b);
      const ready = (b: Entity, name: string) => abilitiesOf(b.def as BuildingDef).includes(name) && cdOf(b, name) === 0;
      const named = c.name && (buildings.find((b) => ready(b, c.name!) && unlocked(b, c.name!)) ?? buildings.find((b) => ready(b, c.name!)));
      if (c.name && !named) {
        // A named unit ability: aimed ones by the ready caster nearest the point, the others by every ready caster.
        const ab = ABILITIES[c.name];
        if (!ab) return;
        const need = this.needs(c.player, ab.research);
        if (need) return void this.say(c.player, need);
        // An ability without cooldown (Explosion suicidaire) is ready whatever the caster used before.
        // Notice: soldiers in a Fortin or a Scarabée use their powers from inside, as they shoot.
        const able = mine.filter((e) => e.def.kind === 'unit' && e.held === 0 && (!e.inside || this.entities.get(e.inside)?.def.kind === 'building' || this.entities.get(e.inside)?.type === 'scarabee') && this.abilitiesFor(e).includes(c.name!));
        const casters = able.filter((e) => this.ready(e, c.name!));
        // Casters with energy of their own (fiches 2010): none with enough of it.
        if (!casters.length && able.some((e) => this.manaOf(e) && e.abilityCd === 0 && (e.spellCd[c.name!] ?? 0) <= this.tick)) return void this.say(c.player, "Pas assez d'énergie.");
        if (ab.target !== 'point') return void casters.forEach((e) => this.cast(e, c.name));
        if (c.x === undefined || c.y === undefined || !casters.length) return;
        const [x, y] = [c.x, c.y];
        const e = casters.sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y) || a.id - b.id)[0];
        if (e.inside) {
          // From inside it cannot walk up: within reach of the shelter's edge, or not at all.
          const shelter = this.entities.get(e.inside)!;
          const edge = shelter.def.kind === 'building' ? ((shelter.def as BuildingDef).size * FP) / 2 : shelter.radius;
          if (dist(e.x, e.y, x, y) > toFp(spell(c.name, e.lvl).range ?? 0) + edge) return void this.say(c.player, `${ab.name} : hors de portée de l'abri.`);
          if (!this.castAt(e, c.name, x, y)) this.say(c.player, `${ab.name} : rien à viser ici.`);
          return;
        }
        return void this.setOrder(e, { kind: 'cast', ability: c.name, x, y });
      }
      for (const e of units) this.cast(e);
      const own = (b: Entity) => (b.def as BuildingDef).ability && b.abilityCd === 0;
      const b = named || buildings.find((b) => own(b) && unlocked(b, (b.def as BuildingDef).ability!)) || buildings.find(own);
      if (b && c.name === 'envol') return void this.takeOff(b);
      if (b && (c.name === 'deraciner' || c.name === 'redeploiement')) return void this.uproot(b, c.name);
      if (b && c.name === 'refuge') {
        // Z Refuge: the drones round the Intelligence go in, as many as it holds (the rest are told it is full).
        const r = toFp(ABILITIES.refuge.radius!);
        for (const u of this.entities.values()) if (u.owner === b.owner && !u.inside && u.hp > 0 && this.boards(u, b) && this.gap(u, b) <= r) this.setOrder(u, { kind: 'enter', target: b.id });
        return;
      }
      if (b && c.name === 'bouclierplasma') {
        const ab = ABILITIES.bouclierplasma;
        b.phased = ticks(ab.duration);
        b.plasmaCd = ticks(ab.cooldown);
        this.casts.push({ kind: c.name, x: b.x, y: b.y });
        return;
      }
      if (!b || c.x === undefined || c.y === undefined) return;
      const [ax, ay] = onMap(this.map, c.x, c.y);
      const kind = c.name ?? (b.def as BuildingDef).ability!;
      const ab = ABILITIES[kind];
      if (!ab) return;
      if (b.type === 'centrek') {
        const need = this.needs(c.player, ab.research);
        if (need) return void this.say(c.player, need);
        return void this.centreK(b, kind, ax, ay);
      }
      if (b.type === 'artefacterie') return void this.artefact(b, kind, ax, ay);
      if (kind === 'transfertgroupe') {
        // Second step of the Porte de déphasage: the latest group still phased goes to the point, out of phase.
        const need = this.needs(c.player, ab.research, b);
        if (need) return void this.say(c.player, need);
        const g = this.phaseGroups.filter((g) => g.owner === c.player).pop();
        const units = g ? g.ids.map((id) => this.entities.get(id)).filter((u): u is Entity => !!u && u.owner === g.owner && u.hp > 0 && u.phased > 0 && !u.inside) : [];
        if (!g || !units.length) return void this.say(c.player, 'Aucun groupe déphasé.');
        this.phaseGroups.splice(this.phaseGroups.indexOf(g), 1);
        const [x, y] = [ax, ay];
        this.teleports.push({ phase: 'start', owner: c.player, x1: units[0].x, y1: units[0].y, x2: x, y2: y, ids: units.map((u) => u.id) });
        for (const u of units) {
          u.phased = 0;
          this.place(u, x, y);
        }
        this.teleports.push({ phase: 'end', owner: c.player, x1: units[0].x, y1: units[0].y, x2: x, y2: y, ids: units.map((u) => u.id) });
        return;
      }
      // A power with no energy cost (Envol, Redéploiement…) goes by its own path above, by name; unnamed, it is no
      // aimed power: nothing to pay (an energy of undefined would leave the player's at NaN, every price then paid).
      if (ab.energy === undefined) return;
      if (this.silenced(b.x, b.y)) return void this.say(c.player, 'Silence des ions : impossible ici.');
      const need = this.needs(c.player, ab.research, b);
      if (need) return void this.say(c.player, need);
      if (this.players[c.player].energy < ab.energy!) return void this.say(c.player, "Pas assez d'énergie.");
      if (kind === 'rappel' && !this.recall(b, ax, ay)) return void this.say(c.player, 'Aucune unité à rappeler.');
      if (kind === 'observation') this.scans.push({ owner: c.player, x: ax, y: ay, left: ticks(ab.duration) });
      if (kind === 'observatoire') this.scans.push({ owner: c.player, x: ax, y: ay, left: ticks(ab.duration), radius: ab.radius });
      if (kind === 'canonorbital') {
        // The beam needs an Espion watching the spot; it spares nothing under it.
        const [cx, cy] = [ax, ay];
        if (![...this.entities.values()].some((s) => s.owner === c.player && s.type === 'espion' && dist(s.x, s.y, cx, cy) <= toFp((s.def as UnitDef).sight))) return void this.say(c.player, 'Un Espion doit viser la cible.');
        // It strikes a few seconds later (2010 sheet: 5 s; the mod: 6 s), the players warned, time to get away.
        this.strikes.push({ owner: c.player, x: cx, y: cy, left: ticks(BALANCE.rules.canonDelay) });
        for (const p of this.players) if (p.id !== c.player) this.say(p.id, 'Frappe orbitale imminente !', 'alert');
      }
      if (kind === 'murenergie') this.wall(c.player, b, ax, ay, ab.radius!, ticks(ab.duration));
      if (kind === 'portedephasage') {
        const ids: number[] = [];
        for (const u of this.entities.values()) if (u.owner === c.player && u.def.kind === 'unit' && dist(u.x, u.y, ax, ay) <= toFp(ab.radius!)) {
          u.phased = ticks(ab.duration);
          ids.push(u.id);
        }
        if (ids.length) this.phaseGroups.push({ owner: c.player, ids, left: ticks(ab.duration) });
      }
      this.casts.push({ kind: kind === 'canonorbital' ? 'canonorbitalvise' : kind, x: ax, y: ay });
      this.players[c.player].energy -= ab.energy!;
      b.abilityCd = ticks(ab.cooldown);
      return;
    }
  }
}

export function smart(this: World, c: Extract<Command, { kind: 'smart' }>, units: Entity[], buildings: Entity[]): void {
  const t = this.target(c);
  for (const b of buildings) if ((b.def as BuildingDef).trains) this.setRally(b, c, t);
  const movers: Entity[] = [];
  for (const e of units) {
    const worker = (e.def as UnitDef).worker;
    if (t && this.hostile(t.owner, e.owner) && this.weapon(e) && reaches(this.weapon(e)!, t.def.kind === 'unit' && flies(t))) {
      this.setOrder(e, { kind: 'attack', target: t.id, auto: false, lx: e.x, ly: e.y });
    } else if (!worker && t && t.owner === e.owner && (e.def as UnitDef).heal && healable(t) && t.hp < t.maxHp) {
      this.setOrder(e, { kind: 'heal', target: t.id });
    } else if (worker && t?.def.kind === 'resource' && t.type === 'minerai') {
      this.setOrder(e, { kind: 'gather', target: t.id, phase: 'go', timer: 0 });
    } else if (worker && t && t !== e && t.owner === e.owner && t.hp < t.maxHp && t.buildLeft === 0 && repairs(e.type, t)) {
      // Z.doc: a drone repairs Z buildings and machines; the notice: the Serf too, the Esprit buildings only.
      this.setOrder(e, { kind: 'repair', target: t.id, owedM: 0, owedE: 0 });
    } else if (worker && t && t.owner === e.owner && t.def.kind === 'building' && t.buildLeft > 0 && !(t.def as BuildingDef).warp && !(t.def as BuildingDef).absorbs) {
      this.setOrder(e, { kind: 'construct', target: t.id });
    } else if (!worker && t && t !== e && t.owner === e.owner && this.room(t) && t.buildLeft === 0 && !flies(e) && this.boards(e, t)) {
      this.setOrder(e, { kind: 'enter', target: t.id });
    } else if (worker && t && t.owner === e.owner && (t.def as BuildingDef).energyRate && this.room(t) && t.buildLeft === 0 && this.boards(e, t)) {
      // Z Assimilateur: a drone goes in to work it.
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
/** On a thing (unit, building, field), the rally point is that thing, at its middle; else the spot clicked. */
export function setRally(this: World, b: Entity, c: { x: number; y: number }, t: Entity | undefined): void {
  const on = t && t.id !== b.id ? t : undefined;
  b.rally = on ? { x: on.x, y: on.y } : { x: c.x, y: c.y };
  b.rallyTarget = on?.id ?? 0;
}

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
/**
 * A sum of positions over n, to the nearest, halves to the even: as the map's width in fixed point is even, the mean
 * of mirrored positions is the mirror of the mean (rounding toward zero put it one unit off on one side).
 */
function mean(sum: number, n: number): number {
  const q = Math.floor(sum / n);
  const twice = 2 * (sum - q * n);
  return twice > n || (twice === n && q % 2 !== 0) ? q + 1 : q;
}

export function formation(this: World, units: Entity[], to?: [number, number]): [number[], number[], boolean] {
  const n = Math.max(1, units.length);
  const cx = mean(units.reduce((s, e) => s + e.x, 0), n);
  const cy = mean(units.reduce((s, e) => s + e.y, 0), n);
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
  if (order && STILL.has(order.kind) && this.busy(e)) return;
  const c = this.commanding;
  if (c && e.owner === c.player && Array.isArray(c.ids) && c.ids.includes(e.id)) e.next.splice(0);
  if (order && this.queueing && (e.order || e.next.length)) {
    e.next.push(order);
    return;
  }
  // An order done (or dropped): the next one in the list, if any.
  if (!order && e.next.length) order = e.next.shift()!;
  while (order && STILL.has(order.kind) && this.busy(e)) order = e.next.shift() ?? null;
  const old = e.order;
  if (old?.kind === 'gather') this.release(e, old.target);
  e.order = order;
  e.goal = null;
  e.path = [];
  e.blockedTicks = 0;
  e.stuck = 0;
}

/** The Obélisque beams a building down (fiche 2010, mod): seen by its side, placed as usual, paid, then it rests. */
export function materialise(this: World, o: Entity, type: string, tx: number, ty: number): void {
  const def = DEFS[type] as BuildingDef;
  const lack = this.lacks(o.owner, type);
  if (lack) return void this.say(o.owner, lack);
  if (!this.canPlace(type, tx, ty, o.owner)) return void this.say(o.owner, this.misplaced(def, tx, ty, o.owner));
  const mid = Math.floor(def.size / 2);
  if (!this.vision[o.owner].visible(tx + mid, ty + mid)) return void this.say(o.owner, 'Il faut voir l’emplacement.');
  if (!this.pay(o.owner, def)) return;
  this.site(type, o.owner, tx, ty);
  // The rest is half the building's time (the mod's figure); with the Cercle d'énergie, a quarter (fiche 2010).
  const rest = (BALANCE.rules.materialisation.cooldown as Record<string, number>)[type];
  o.spellCd.materialisation = this.tick + ticks(this.level(o.owner, 'cercle') ? rest / 2 : rest);
}
