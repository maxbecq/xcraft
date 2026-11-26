import { describe, expect, it } from 'vitest';
import { DEFS, type UnitDef } from '../data';
import { FP, speedPerTick, ticks } from './fixed';
import { createMatch } from './setup';
import type { World } from './world';
import { noRegen } from './noregen';

// The balancer's answer of 2026-11-22, section « 1. Humains »: followed to the letter.
const humans = () => {
  const w = createMatch(['humains', 'z']);
  w.players[0].minerals = w.players[0].energy = 99999;
  return w;
};
let at = 20;
const put = (w: World, type: string) => w.spawn(type, 0, (at = at >= 80 ? 26 : at + 6) * FP, 40 * FP);

describe('the balancer, Humains', () => {
  it('the tech tree', () => {
    const w = humans();
    const lacks = (t: string) => w.lacks(0, t);
    // Nothing but the Conseil: the Forge and the Alchimisterie wait for a Caserne; the Caserne volante needs nothing.
    expect(lacks('forge')).toContain('Caserne');
    expect(lacks('alchimisterie')).toContain('Caserne');
    expect(lacks('casernevolante')).toBe('');
    expect(lacks('tour')).not.toBe('');
    put(w, 'caserne');
    expect(lacks('forge')).toBe('');
    expect(lacks('alchimisterie')).toBe('');
    // Tour alchimistique, Grand Conseil: the Forge OR the Alchimisterie.
    expect(lacks('tour')).not.toBe('');
    expect(lacks('grandconseil')).not.toBe('');
    const alch = put(w, 'alchimisterie');
    expect(lacks('tour')).toBe('');
    expect(lacks('grandconseil')).toBe('');
    // Créaturium, Soigneur, Belluaire: the Alchimisterie.
    for (const t of ['creaturium', 'soigneur', 'belluaire']) expect(lacks(t), t).toBe('');
    // Marché, Grande Alchimisterie, Dressage d'Allosaurus, Décollage: the Grand Conseil.
    for (const t of ['marche', 'grandealchimisterie', 'dressageallosaures', 'decollage']) expect(lacks(t), t).toContain('Grand Conseil');
    put(w, 'grandconseil');
    for (const t of ['marche', 'grandealchimisterie', 'dressageallosaures', 'decollage']) expect(lacks(t), t).toBe('');
    // Grown into a Grande Alchimisterie, it still is the Alchimisterie the others need.
    w.remove(alch);
    put(w, 'grandealchimisterie');
    expect(lacks('creaturium')).toBe('');
    // Métallurgie: the Forge.
    expect(lacks('metallurgie')).toContain('Forge');
  });

  it('the Forge: levels 2 and 3 no longer need two Casernes (level 3 still the Tour)', () => {
    const w = humans();
    put(w, 'caserne');
    put(w, 'forge');
    w.players[0].upgrades.ranged = 1;
    expect(w.lacks(0, 'ranged2')).toBe('');
    w.players[0].upgrades.ranged = 2;
    expect(w.lacks(0, 'ranged3')).toContain('Tour');
  });

  it('numbers: supply 12 (Conseil, Grand Conseil), Grand Conseil armour 7, Légionnaire 22 s at 1.1, Soigneur 50 mana, Belluaire 2.9, Plésiosaure 2 / 3 / 2.5', () => {
    const d = (t: string) => DEFS[t] as UnitDef;
    expect([d('conseil').supply, d('grandconseil').supply, d('grandconseil').armor]).toEqual([12, 12, 7]);
    expect([d('legionnaire').buildTime, d('legionnaire').attack!.cooldown]).toEqual([22, 1.1]);
    expect(d('soigneur').mana![0]).toBe(50);
    expect(d('belluaire').speed).toBe(2.9);
    expect([d('plesiosaure').supply, d('plesiosaure').attack!.range, d('plesiosaure').attack!.cooldown]).toEqual([2, 3, 2.5]);
    expect([d('alchimisterie').cost.energy, d('grandealchimisterie').cost.energy]).toEqual([150, 500]);
    expect(d('scieassaut').cost).toEqual({ minerals: 200, energy: 200 });
  });

  it('Planification industrielle: a Grand Conseil makes every unit 10 % faster, but not the Serf', () => {
    const w = humans();
    const c = put(w, 'caserne');
    const conseil = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'conseil')!;
    const [aux, serf] = [w.trainTime(c, 'auxiliaire'), w.trainTime(conseil, 'serf')];
    put(w, 'grandconseil');
    expect(w.trainTime(c, 'auxiliaire')).toBe(Math.floor((aux * 100) / 110));
    expect(w.trainTime(conseil, 'serf')).toBe(serf);
  });

  it('Scie d\'assaut: +15 against buildings; the Auxiliaire gains +1 a level of ranged attack', () => {
    const w = humans();
    const leg = put(w, 'legionnaire');
    const store = w.spawn('grenier', 1, leg.x + FP, leg.y);
    const blow = () => w.blow(leg, store, w.weapon(leg)!);
    const before = blow();
    w.players[0].upgrades.scieassaut = 1;
    expect(blow() - before).toBe(15);
    const aux = put(w, 'auxiliaire');
    const foe = w.spawn('serf', 1, aux.x + 2 * FP, aux.y);
    const a = w.weapon(aux)!;
    const base = w.blow(aux, foe, a);
    w.players[0].upgrades.ranged = 2;
    expect(w.blow(aux, foe, a) - base).toBe(2);
  });

  it('Armes chimiques: the Tour alchimistique hits a zone of radius 1 round the flyer it shoots, allies too', () => {
    const w = humans();
    const tour = put(w, 'tour');
    const target = w.spawn('bourdon', 1, tour.x + 3 * FP, tour.y);
    const ally = w.spawn('bourdon', 0, tour.x + 3 * FP, tour.y + FP / 2);
    const far = w.spawn('bourdon', 1, tour.x + 3 * FP, tour.y + 2 * FP);
    w.hit(tour, target, w.weapon(tour)!);
    expect(ally.hp).toBe(ally.maxHp);
    w.players[0].upgrades.armeschimiques = 1;
    w.hit(tour, target, w.weapon(tour)!);
    expect(ally.hp).toBeLessThan(ally.maxHp);
    expect(far.hp).toBe(far.maxHp);
  });

  it('Scientisme: +25 mana for the Soigneur, +50 for the Alchimiste and the Réservoir', () => {
    const w = humans();
    const [s, a, c] = ['soigneur', 'alchimiste', 'cuve'].map((t) => put(w, t));
    const max = () => [s, a, c].map((e) => w.manaOf(e)![0]);
    expect(max()).toEqual([50, 200, 200]);
    w.players[0].upgrades.scientisme = 1;
    expect(max()).toEqual([75, 250, 250]);
    expect(w.lacks(0, 'scientisme')).toBe('');
    expect((DEFS.alchimisterie as { researches: string[] }).researches).toContain('scientisme');
  });

  it('Bourdon and Dirigeable, two units: the Dirigeable carries 4 of supply (a Pégase alone), the Bourdon shoots flyers only', () => {
    const w = humans();
    expect((DEFS.metallurgie as { trains: string[] }).trains).toEqual(expect.arrayContaining(['bourdon', 'dirigeable']));
    expect((DEFS.metallurgie as { researches: string[] }).researches).not.toContain('chargement');
    const d = put(w, 'dirigeable');
    expect([(DEFS.dirigeable as UnitDef).cost, (DEFS.bourdon as UnitDef).cost]).toEqual([{ minerals: 200, energy: 200 }, { minerals: 260, energy: 175 }]);
    expect(w.room(d)).toBe(4);
    const auxs = Array.from({ length: 5 }, () => w.spawn('auxiliaire', 0, d.x, d.y + FP));
    for (const a of auxs.slice(0, 4)) expect(w.boards(a, d) && w.load(d, a) <= w.room(d)).toBe(true);
    for (const a of auxs.slice(0, 4)) a.inside = d.id;
    expect(w.load(d, auxs[4]) <= w.room(d)).toBe(false);
    for (const a of auxs.slice(0, 4)) a.inside = 0;
    const tank = w.spawn('pegase', 0, d.x, d.y + 2 * FP);
    expect(w.boards(tank, d) && w.load(d, tank) <= w.room(d)).toBe(true);
    expect(w.boards(w.spawn('serf', 0, d.x, d.y), d)).toBe(false);
    const b = (DEFS.bourdon as UnitDef).attack!;
    expect([b.range, b.ground]).toEqual([5, false]);
    expect((DEFS.bourdon as UnitDef).detector).toBeGreaterThan(0);
  });

  it('the Char Pégase in the air: sight 10, speed 2.4, a shot every 2.3 s (flyers only); no more mines', () => {
    const w = humans();
    w.players[0].upgrades.decollage = 1;
    const p = put(w, 'pegase');
    expect((DEFS.pegase as UnitDef).abilities ?? []).not.toContain('posermine');
    w.step([{ player: 0, kind: 'ability', ids: [p.id], name: 'decollage' }]);
    expect(p.airborne).toBe(true);
    expect(w.weapon(p)).toMatchObject({ cooldown: 2.3, air: true, ground: false });
    expect(w.baseSpeed(p)).toBe(speedPerTick(2.4));
    expect(p.speed).toBe(speedPerTick(2.4));
  });

  it('Larguer une mine alchimique: 50 minerals and 15 energy, a mine in sight that goes off 3 s later, 160 round 1.75, 10 s of cooldown', () => {
    const w = humans();
    const b = w.spawn('bourdon', 0, 26 * FP, 40 * FP);
    const foe = w.spawn('legionnaire', 1, b.x + FP, b.y);
    const far = w.spawn('legionnaire', 1, b.x + 4 * FP, b.y);
    foe.held = far.held = 1e6; // they stay put
    const [m0, e0] = [w.players[0].minerals, w.players[0].energy];
    w.step([{ player: 0, kind: 'ability', ids: [b.id], name: 'minealchimique' }]);
    expect([m0 - w.players[0].minerals, e0 - w.players[0].energy]).toEqual([50, 15]);
    const mine = [...w.entities.values()].find((e) => e.type === 'minealchimique')!;
    expect(mine).toBeDefined();
    expect(w.sees(1, mine) || !(mine.def as UnitDef).cloaked).toBe(true);
    expect(b.abilityCd).toBeGreaterThanOrEqual(ticks(10) - 1);
    for (let i = 0; i < ticks(3) - 2; i++) w.step([]);
    expect(foe.hp).toBe(foe.maxHp);
    for (let i = 0; i < 4; i++) w.step([]);
    expect(foe.hp).toBeLessThan(foe.maxHp);
    expect(far.hp).toBe(far.maxHp);
    expect(w.entities.has(mine.id)).toBe(false);
  });

  it('Régénérant: 5 % of the damage taken for 7 s, then 1 HP left', () => {
    const w = humans();
    const a = Object.assign(w.spawn('alchimiste', 0, 30 * FP, 40 * FP), { mana: 1 << 30 });
    w.players[0].upgrades.regenerant = 1;
    const ally = w.spawn('legionnaire', 0, 32 * FP, 40 * FP);
    expect(w.castAt(a, 'regenerant', ally.x, ally.y)).toBe(true);
    expect(w.hurt(ally, 100)).toBe(5);
    for (let i = 0; i < ticks(7) + 1; i++) w.step([]);
    expect([ally.hp, ally.ferveur]).toEqual([1, 0]);
  });

  it('Explosif toxique: aimed at any spot, it hurts allies as well as enemies', () => {
    const w = humans();
    const a = Object.assign(w.spawn('alchimiste', 0, 30 * FP, 40 * FP), { mana: 1 << 30 });
    const ally = w.spawn('legionnaire', 0, 34 * FP, 40 * FP);
    ally.held = 1e6;
    expect(w.castAt(a, 'explosiftoxique', ally.x, ally.y)).toBe(true);
    for (let i = 0; i < ticks(2); i++) w.step([]);
    expect(ally.hp).toBeLessThan(ally.maxHp);
    expect(w.castAt(a, 'explosiftoxique', 40 * FP, 50 * FP)).toBe(true); // nobody there
  });

  it('Explosion suicidaire: the Réservoir goes off 2 s after the order', () => {
    const w = humans();
    const c = w.spawn('cuve', 0, 30 * FP, 40 * FP);
    const foe = w.spawn('legionnaire', 0, 32 * FP, 40 * FP); // an ally: the blast spares nobody, and the Réservoir does not shoot it
    foe.held = 1e6;
    w.step([{ player: 0, kind: 'ability', ids: [c.id], name: 'explosioncuve' }]);
    for (let i = 0; i < ticks(2) - 2; i++) w.step([]);
    expect(w.entities.has(c.id)).toBe(true);
    expect(foe.hp).toBe(foe.maxHp);
    for (let i = 0; i < 4; i++) w.step([]);
    expect(w.entities.has(c.id)).toBe(false);
    expect(foe.hp).toBeLessThan(foe.maxHp);
  });

  it('Soin: 25 HP for 5 mana, never on a machine, on its own or not (autosoin)', () => {
    noRegen();
    const w = humans();
    const m = w.spawn('soigneur', 0, 30 * FP, 40 * FP);
    const man = w.spawn('legionnaire', 0, 31 * FP, 40 * FP);
    const tank = w.spawn('scarabee', 0, 30 * FP, 42 * FP);
    man.hp = 50;
    tank.hp = 100;
    const mana = m.mana;
    for (let i = 0; i < 8; i++) w.step([]);
    expect(man.hp).toBe(75);
    expect(mana - m.mana).toBeGreaterThanOrEqual(5 * FP - FP); // 5 paid, a little regained meanwhile
    expect(w.patient(m)).not.toBe(tank);
    w.step([{ player: 0, kind: 'smart', ids: [m.id], x: tank.x, y: tank.y, target: tank.id }]);
    expect(m.order?.kind).not.toBe('heal');
    // Switched off: it no longer heals on its own, nor on an attack-move.
    w.step([{ player: 0, kind: 'ability', ids: [m.id], name: 'autosoin' }]);
    w.step([{ player: 0, kind: 'stop', ids: [m.id] }]);
    const hp = man.hp;
    for (let i = 0; i < ticks(5); i++) w.step([]);
    expect(man.hp).toBe(hp);
    w.step([{ player: 0, kind: 'attack', ids: [m.id], x: 60 * FP, y: 40 * FP }]);
    for (let i = 0; i < ticks(2); i++) w.step([]);
    expect(man.hp).toBe(hp);
    w.step([{ player: 0, kind: 'stop', ids: [m.id] }]);
    // Told to, it still does.
    w.step([{ player: 0, kind: 'smart', ids: [m.id], x: man.x, y: man.y, target: man.id }]);
    for (let i = 0; i < 8; i++) w.step([]);
    expect(man.hp).toBeGreaterThan(hp);
  });

  it('Réanimation on its own once switched on: a fresh body in reach rises', () => {
    const w = humans();
    const a = Object.assign(w.spawn('alchimiste', 0, 30 * FP, 40 * FP), { mana: 1 << 30 });
    const prey = w.spawn('archer', 1, 33 * FP, 40 * FP);
    prey.hp = 0;
    w.step([]);
    expect(w.corpses.length).toBe(1);
    for (let i = 0; i < 20; i++) w.step([]);
    expect([...w.entities.values()].some((e) => e.type === 'cadavre')).toBe(false); // off by default, as before
    w.step([{ player: 0, kind: 'ability', ids: [a.id], name: 'autoreanimation' }]);
    for (let i = 0; i < 20; i++) w.step([]);
    expect([...w.entities.values()].some((e) => e.type === 'cadavre' && e.owner === 0)).toBe(true);
  });

  it('the Mine works only with serfs inside, each of its 4 a quarter', () => {
    const w = createMatch(['humains', 'z']);
    const well = [...w.entities.values()].find((e) => e.type === 'puits')!;
    const mine = w.spawn('mine', 0, well.x, well.y);
    Object.assign(mine, { tx: well.tx, ty: well.ty });
    const serfs = Array.from({ length: 4 }, () => w.spawn('serf', 0, mine.x, mine.y + 3 * FP));
    const gain = (n: number) => {
      serfs.forEach((s, i) => (s.inside = i < n ? mine.id : 0));
      const e = w.players[0].energy;
      for (let i = 0; i < ticks(16); i++) w.step([]);
      return w.players[0].energy - e;
    };
    expect(w.room(mine)).toBe(4);
    expect(gain(0)).toBe(0);
    const [two, four] = [gain(2), gain(4)];
    expect(four).toBeGreaterThan(0);
    expect(Math.abs(four - 2 * two)).toBeLessThanOrEqual(1);
  });

  it('Refuge: six serfs, and nobody else, shelter in the Conseil', () => {
    const w = humans();
    const c = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'conseil')!;
    for (let i = 0; i < 4; i++) w.spawn('serf', 0, c.x + 4 * FP, c.y);
    const soldier = w.spawn('legionnaire', 0, c.x + 4 * FP, c.y + FP);
    expect(w.room(c)).toBe(6);
    expect(w.boards(soldier, c)).toBe(false);
    w.step([{ player: 0, kind: 'ability', ids: [c.id], name: 'refuge' }]);
    for (let i = 0; i < ticks(10); i++) w.step([]);
    expect([...w.entities.values()].filter((e) => e.inside === c.id && e.type === 'serf')).toHaveLength(6);
    expect(soldier.inside).toBe(0);
  });

  it('a Grenier becomes a Grenier à silo (100 minerals, 15 s, no research): +200 HP, +5 supply', () => {
    const w = humans();
    const g = put(w, 'grenier');
    const max = w.supply(0).max;
    const m = w.players[0].minerals;
    w.step([{ player: 0, kind: 'train', ids: [g.id], type: 'silo' }]);
    expect(m - w.players[0].minerals).toBe(100);
    for (let i = 0; i < ticks(15) + 2; i++) w.step([]);
    expect(g.type).toBe('silo');
    expect(g.maxHp).toBe((DEFS.grenier as UnitDef).hp + 200);
    expect(w.supply(0).max).toBe(max + 5);
  });

  it('the Alchimisterie queues its Grande Alchimisterie behind an Alchimiste', () => {
    const w = humans();
    put(w, 'grandconseil');
    const a = put(w, 'alchimisterie');
    w.step([{ player: 0, kind: 'train', ids: [a.id], type: 'alchimiste' }]);
    w.step([{ player: 0, kind: 'train', ids: [a.id], type: 'grandealchimisterie' }]);
    expect(a.queue).toEqual(['alchimiste', 'grandealchimisterie']);
    w.step([{ player: 0, kind: 'train', ids: [a.id], type: 'grandealchimisterie' }]);
    expect(a.queue).toEqual(['alchimiste', 'grandealchimisterie']); // once only
  });

  it('a Fortin as the rally point: the new Auxiliaire goes in', () => {
    const w = humans();
    const c = put(w, 'caserne');
    const f = w.spawn('fortin', 0, c.x + 6 * FP, c.y);
    w.step([{ player: 0, kind: 'rally', ids: [c.id], x: f.x, y: f.y, target: f.id }]);
    w.step([{ player: 0, kind: 'train', ids: [c.id], type: 'auxiliaire' }]);
    for (let i = 0; i < ticks(40); i++) w.step([]);
    const aux = [...w.entities.values()].find((e) => e.type === 'auxiliaire' && e.owner === 0)!;
    expect(aux.inside).toBe(f.id);
  });

  it('from inside a Scarabée, an Alchimiste still casts (its Explosif toxique)', () => {
    const w = humans();
    w.players[0].upgrades.cocktail = 1;
    const sc = w.spawn('scarabee', 0, 30 * FP, 40 * FP);
    const a = Object.assign(w.spawn('alchimiste', 0, 30 * FP, 41 * FP), { mana: 1 << 30 });
    a.inside = sc.id;
    w.step([{ player: 0, kind: 'ability', ids: [a.id], name: 'explosiftoxique', x: 34 * FP, y: 40 * FP }]);
    expect(w.clouds.length).toBe(1);
  });

  it('general: the four main buildings 4x4, never within 3 tiles of a mineral field; every map site still takes one', () => {
    for (const t of ['conseil', 'obelisque', 'intelligence', 'asgaard']) expect((DEFS[t] as { size: number }).size, t).toBe(4);
    const w = humans();
    const m = [...w.entities.values()].find((e) => e.type === 'minerai')!;
    // A footprint two tiles from the field: refused; three: the field no longer stands in the way.
    expect(w.nearMinerals(m.tx + 2, m.ty, 4)).toBe(true);
    expect(w.nearMinerals(m.tx + 4 + 3, m.ty + 10, 4)).toBe(false);
    for (const s of w.map.sites!) expect(w.nearMinerals(s.hq[0], s.hq[1], 4), `${s.hq}`).toBe(false);
    expect(w.misplaced(DEFS.conseil as never, m.tx + 2, m.ty, 0)).toContain('gisement');
  });
  it('no Soin cast on its own (a heal order or autosoin only): no mana spent, no cooldown', () => {
    const w = humans();
    const s = put(w, 'soigneur');
    const mana = s.mana;
    w.step([{ player: 0, kind: 'ability', ids: [s.id], name: 'soin' }]);
    expect([s.mana >= mana, s.abilityCd, s.spellCd.soin ?? 0]).toEqual([true, 0, 0]);
  });

  it('an empty assault Scarabée left alone fires on a foe in reach (its cannon comes from the research, not its sheet)', () => {
    const w = humans();
    w.players[0].upgrades.scarabeassaut = 1;
    const s = w.spawn('scarabee', 0, 40 * FP, 40 * FP);
    const foe = w.spawn('auxiliaire', 1, 42 * FP, 40 * FP);
    foe.held = ticks(60);
    for (let i = 0; i < 10; i++) w.step([]);
    expect(s.order?.kind === 'attack' && s.order.target).toBe(foe.id);
  });

  it('Refuge sends in only as many workers as there are seats free, the nearest first; the others keep to their work', () => {
    const w = humans();
    const hq = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'conseil')!;
    const serfs = [...w.entities.values()].filter((e) => e.owner === 0 && e.type === 'serf');
    const seats = w.room(hq);
    for (let i = 0; i < seats - 1; i++) w.spawn('serf', 0, hq.x, hq.y).inside = hq.id;
    const away = { kind: 'move' as const, x: hq.x + 12 * FP, y: hq.y };
    w.step([{ player: 0, kind: 'move', ids: serfs.map((e) => e.id), x: away.x, y: away.y }]);
    w.step([{ player: 0, kind: 'ability', ids: [hq.id], name: 'refuge' }]);
    const entering = serfs.filter((e) => e.order?.kind === 'enter');
    expect(entering.length).toBe(1);
    const gap = (e: (typeof serfs)[number]) => w.gap(e, hq);
    expect(serfs.every((e) => e.order?.kind === 'enter' || (e.order?.kind === 'move' && gap(e) >= gap(entering[0])))).toBe(true);
    // Full now: a second Refuge diverts nobody.
    w.step([{ player: 0, kind: 'ability', ids: [hq.id], name: 'refuge' }]);
    expect(serfs.filter((e) => e.order?.kind === 'enter').length).toBe(1);
  });

  it('Carrefour at four: the shared middle stays one site, and no two sites overlap', () => {
    const w = createMatch(['humains', 'humains', 'humains', 'humains'], undefined, 'carrefour');
    const sites = w.map.sites!;
    expect(sites.filter((s) => s.turn === -1).length).toBe(1);
    for (const a of sites) for (const b of sites) if (a !== b) expect(Math.abs(a.hq[0] - b.hq[0]) < 4 && Math.abs(a.hq[1] - b.hq[1]) < 4, `${a.hq} ${b.hq}`).toBe(false);
  });
});
