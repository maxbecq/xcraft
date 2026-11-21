// Mechanics added after the audit of 20 November 2026 (docs/audit-mecaniques-2026-11-20.md).
import { describe, expect, it } from 'vitest';
import BALANCE from '../balance.json';
import { FP, ticks } from './fixed';
import { createMatch } from './setup';
import { type Entity, World, flies, soars } from './world';
import { reaches } from '../data';

const of = (w: World, owner: number, type: string): Entity[] => [...w.entities.values()].filter((e) => e.owner === owner && e.type === type);
const run = (w: World, seconds: number) => {
  for (let i = 0; i < ticks(seconds); i++) w.step([]);
};

describe('audit gaps', () => {
  it('the Serf repairs buildings and machines, the Esprit buildings only (notice)', () => {
    const w = createMatch(['humains', 'dieux']);
    w.players[0].minerals = 1000;
    const serf = of(w, 0, 'serf')[0];
    const grenier = w.spawn('grenier', 0, 40 * FP, 40 * FP);
    grenier.hp = Math.floor(grenier.maxHp / 2);
    const before = grenier.hp;
    w.step([{ player: 0, kind: 'smart', ids: [serf.id], x: grenier.x, y: grenier.y, target: grenier.id }]);
    expect(serf.order?.kind).toBe('repair');
    run(w, 30);
    expect(grenier.hp).toBeGreaterThan(before);
    const tank = w.spawn('pegase', 0, 30 * FP, 30 * FP);
    tank.hp = 10;
    w.step([{ player: 0, kind: 'smart', ids: [serf.id], x: tank.x, y: tank.y, target: tank.id }]);
    expect(serf.order?.kind).toBe('repair');

    w.players[1].minerals = 1000;
    const esprit = of(w, 1, 'esprit')[0];
    const [porte] = of(w, 1, 'asgaard');
    porte.hp -= 100;
    w.step([{ player: 1, kind: 'smart', ids: [esprit.id], x: porte.x, y: porte.y, target: porte.id }]);
    expect(esprit.order?.kind).toBe('repair');
    run(w, 30);
    expect(porte.hp).toBe(porte.maxHp);
    expect(BALANCE.rules.repair.esprit.hp).toBe(8); // XC.doc 2008
  });

  it('the Réservoir de substances: Gaz euphorisants, Acide dissolvant after its research, Explosion suicidaire', () => {
    const w = createMatch(['humains', 'isdaris']);
    const cuve = Object.assign(w.spawn('cuve', 0, 30 * FP, 30 * FP), { mana: 1 << 30 });
    const aux = w.spawn('auxiliaire', 0, 34 * FP, 30 * FP);
    const speed = aux.speed;
    w.step([{ player: 0, kind: 'ability', ids: [cuve.id], name: 'gazeuphorisants', x: aux.x, y: aux.y }]);
    run(w, 1);
    expect(aux.pace).toBeGreaterThan(0);
    expect(aux.speed).toBeGreaterThan(speed);
    expect(aux.paceAtk).toBe(80); // 25 % faster: 1 / 1.25
    run(w, 31);
    expect(aux.speed).toBe(speed);

    const foe = w.spawn('portail', 1, 40 * FP, 30 * FP);
    foe.buildLeft = 0;
    const hp = foe.hp + foe.shield;
    cuve.abilityCd = 0;
    cuve.frozen = aux.frozen = ticks(60); // their guns quiet, to count the acid alone
    w.step([{ player: 0, kind: 'ability', ids: [cuve.id], name: 'acidedissolvant', x: foe.x, y: foe.y }]);
    run(w, 10);
    expect(foe.hp + foe.shield).toBe(hp); // no research yet
    w.players[0].upgrades.acide = 1;
    w.step([{ player: 0, kind: 'ability', ids: [cuve.id], name: 'acidedissolvant', x: foe.x, y: foe.y }]);
    expect(cuve.order?.kind).toBe('cast');
    run(w, 10);
    expect(hp - foe.hp - foe.shield).toBe(400);

    cuve.frozen = 0;
    const near = w.spawn('archer', 1, cuve.x + 2 * FP, cuve.y);
    const far = w.spawn('archer', 1, cuve.x + 8 * FP, cuve.y);
    const [nearHp, farHp] = [near.hp + near.shield, far.hp + far.shield];
    w.step([{ player: 0, kind: 'ability', ids: [cuve.id], name: 'explosioncuve' }]);
    run(w, 1);
    expect(w.entities.has(cuve.id)).toBe(false);
    expect(w.entities.has(near.id) ? nearHp - near.hp - near.shield : nearHp).toBeGreaterThanOrEqual(Math.min(nearHp, 356));
    expect(far.hp + far.shield).toBe(farHp);
  });

  it('the Régénérant covers every living ally of its zone', () => {
    const w = createMatch(['humains', 'isdaris']);
    w.players[0].upgrades.regenerant = 1;
    const alch = Object.assign(w.spawn('alchimiste', 0, 30 * FP, 30 * FP), { mana: 1 << 30 });
    const a = w.spawn('auxiliaire', 0, 33 * FP, 30 * FP);
    const b = w.spawn('auxiliaire', 0, 33 * FP, 31 * FP);
    w.step([{ player: 0, kind: 'ability', ids: [alch.id], name: 'regenerant', x: a.x, y: (a.y + b.y) / 2 }]);
    run(w, 1);
    expect(a.invuln).toBeGreaterThan(0);
    expect(b.invuln).toBeGreaterThan(0);
  });

  it('the Allosaure feasts on a corpse nearby to heal (notice), half its health (mod)', () => {
    const w = createMatch(['humains', 'isdaris']);
    const allo = w.spawn('allosaure', 0, 30 * FP, 30 * FP);
    allo.hp = 100;
    w.step([{ player: 0, kind: 'ability', ids: [allo.id], name: 'festin' }]);
    expect(allo.hp).toBe(100); // no corpse
    const prey = w.spawn('archer', 1, 32 * FP, 30 * FP);
    prey.hp = 0;
    w.step([]);
    expect(w.corpses.length).toBeGreaterThan(0);
    w.step([{ player: 0, kind: 'ability', ids: [allo.id], name: 'festin' }]);
    expect(allo.hp).toBe(100 + Math.floor(allo.maxHp / 2));
    expect(allo.abilityCd).toBeGreaterThan(0);
  });

  it('the Char Pégase lays invisible chemical mines from a stock of 5 that blow up under enemy walkers', () => {
    const w = createMatch(['humains', 'isdaris']);
    const tank = w.spawn('pegase', 0, 30 * FP, 30 * FP);
    expect(tank.charges).toBe(5);
    w.step([{ player: 0, kind: 'ability', ids: [tank.id], name: 'posermine' }]);
    const [mine] = of(w, 0, 'minechimique');
    expect(mine).toBeDefined();
    expect(tank.charges).toBe(4);
    expect(tank.abilityCd).toBe(0); // the take-off stays ready
    expect(w.sees(1, mine)).toBe(false);
    // Each new mine costs 35 minerals and 20 energy (mod): none without them, one with them.
    const p = w.players[0];
    [p.minerals, p.energy] = [0, 0];
    run(w, 12);
    expect(tank.charges).toBe(4);
    [p.minerals, p.energy] = [100, 100];
    run(w, 12);
    expect(tank.charges).toBe(5);
    expect([p.minerals, p.energy]).toEqual([65, 80]);
    const foe = w.spawn('creature', 1, mine.x + 4 * FP, mine.y);
    const hp = foe.hp + foe.shield;
    w.step([{ player: 1, kind: 'move', ids: [foe.id], x: mine.x - 4 * FP, y: mine.y }]);
    run(w, 6);
    expect(w.entities.has(mine.id)).toBe(false);
    expect(w.entities.has(foe.id) ? hp - foe.hp - foe.shield : hp).toBeGreaterThanOrEqual(Math.min(hp, 100));
  });

  it('the Assassin dodges a third of the attacks, near or far (Danse du soldat, 2010 sheet)', () => {
    const w = createMatch(['isdaris', 'humains']);
    const assassin = w.spawn('assassin', 0, 30 * FP, 30 * FP);
    const archer = w.spawn('archer', 0, 30 * FP, 34 * FP);
    const shooter = w.spawn('auxiliaire', 1, 40 * FP, 30 * FP);
    const brute = w.spawn('legionnaire', 1, 40 * FP, 34 * FP);
    const a = w.weapon(shooter)!;
    const before = (t: Entity) => t.hp + t.shield;
    const [h1, h2] = [before(assassin), before(archer)];
    w.hit(shooter, assassin, a);
    w.hit(shooter, archer, a);
    expect(h1 - before(assassin)).toBeLessThan(h2 - before(archer));
    const m = w.weapon(brute)!;
    const [h3, h4] = [before(assassin), before(archer)];
    w.hit(brute, assassin, m);
    w.hit(brute, archer, m);
    // Blows too: two thirds of the Légionnaire's value against the Assassin's class (BA 15), in full on the Archer (BL 20).
    expect(h3 - before(assassin)).toBe(Math.floor((m.vs![1] * 67) / 100));
    expect(h4 - before(archer)).toBe(m.vs![0]); // its shield takes it, armour aside
  });

  it('an Isdaris major building raises its plasma shield: unhurt, no shooting or production, for a while', () => {
    const w = createMatch(['isdaris', 'humains']);
    const [obelisque] = of(w, 0, 'obelisque');
    w.players[0].minerals = 1000;
    w.step([{ player: 0, kind: 'train', ids: [obelisque.id], type: 'moissonneur' }]);
    w.step([{ player: 0, kind: 'ability', ids: [obelisque.id], name: 'bouclierplasma' }]);
    expect(obelisque.phased).toBeGreaterThan(0);
    expect(obelisque.plasmaCd).toBeGreaterThan(0);
    expect(obelisque.abilityCd).toBe(0); // the Rappel stays ready
    const [hp, shield] = [obelisque.hp, obelisque.shield];
    w.hurt(obelisque, 500);
    expect([obelisque.hp, obelisque.shield]).toEqual([hp, shield]);
    const left = obelisque.trainLeft;
    run(w, 5);
    expect(obelisque.trainLeft).toBe(left); // production on hold
    run(w, 16); // 20 s (2010 sheet)
    expect(obelisque.phased).toBe(0);
    w.hurt(obelisque, 500);
    expect(obelisque.hp + obelisque.shield).toBeLessThan(hp + shield);
  });

  it('the Trône is unique (2010 sheet)', () => {
    const w = createMatch(['isdaris', 'humains']);
    w.spawn('orbecommandement', 0, 20 * FP, 30 * FP);
    expect(w.lacks(0, 'trone')).toBeFalsy();
    w.spawn('trone', 0, 30 * FP, 30 * FP);
    expect(w.lacks(0, 'trone')).toBe('Un seul par joueur.');
  });

  it('the Accumulateur\'s Gravité alourdie slows the enemies of a vast zone round it while they stay in it', () => {
    const w = createMatch(['z', 'humains']);
    w.players[0].upgrades.raccumulateur = 1;
    const acc = w.spawn('quadripode', 0, 30 * FP, 30 * FP);
    acc.kit = 'accumulateur';
    acc.mana = 1 << 30; // plenty of its own energy (fiches 2010), the spell under test aside
    const foe = w.spawn('auxiliaire', 1, 40 * FP, 30 * FP);
    const far = w.spawn('auxiliaire', 1, 60 * FP, 30 * FP);
    const speed = foe.speed;
    w.step([{ player: 0, kind: 'ability', ids: [acc.id], name: 'gravite' }]);
    expect(acc.gravity).toBeGreaterThan(0);
    run(w, 1.1);
    expect(foe.speed).toBeLessThan(speed);
    expect(w.paceOf(foe)[1]).toBe(125);
    expect(far.heavy).toBe(0);
    foe.x = 70 * FP; // out of the zone
    run(w, 2.2);
    expect(foe.speed).toBe(speed);
  });

  it('Sonde robuste also strengthens the Drone de combat (Z.doc)', () => {
    const w = createMatch(['z', 'humains']);
    const before = w.spawn('dronecombat', 0, 30 * FP, 30 * FP);
    const hp = before.maxHp;
    w.players[0].upgrades.sonderobuste = 1;
    const after = w.spawn('dronecombat', 0, 32 * FP, 30 * FP);
    expect(after.maxHp).toBe(hp + BALANCE.rules.z.sondeRobusteHp);
  });

  it('Apollon\'s Lumière ardente halves the pace of the enemy infantry of a zone, longer at higher levels', () => {
    const w = createMatch(['dieux', 'humains']);
    const apollon = w.spawn('apollon', 0, 30 * FP, 30 * FP);
    const aux = w.spawn('auxiliaire', 1, 35 * FP, 30 * FP);
    const tank = w.spawn('pegase', 1, 35 * FP, 31 * FP);
    aux.frozen = tank.frozen = ticks(60); // quiet, so the god does not chase them
    const speed = aux.speed;
    w.step([{ player: 0, kind: 'ability', ids: [apollon.id], name: 'lumiereardente', x: aux.x, y: aux.y }]);
    run(w, 1);
    expect(aux.paceAtk).toBe(200);
    expect(aux.speed).toBeLessThan(speed);
    expect(tank.pace).toBe(0); // machines are not blinded
    expect(aux.pace).toBeLessThanOrEqual(ticks(25));
  });

  it('Seth\'s Jet de sable all but stops an enemy vehicle', () => {
    const w = createMatch(['dieux', 'humains']);
    const seth = w.spawn('seth', 0, 30 * FP, 30 * FP);
    const tank = w.spawn('pegase', 1, 34 * FP, 30 * FP);
    tank.frozen = ticks(60);
    const speed = tank.speed;
    w.step([{ player: 0, kind: 'ability', ids: [seth.id], name: 'jetdesable', x: tank.x, y: tank.y }]);
    run(w, 1);
    expect(tank.paceAtk).toBe(1000);
    expect(tank.speed).toBeLessThan(speed / 5);
  });

  it('Seth hits a wounded soldier harder', () => {
    const w = createMatch(['dieux', 'humains']);
    const seth = w.spawn('seth', 0, 30 * FP, 30 * FP);
    const fresh = w.spawn('legionnaire', 1, 31 * FP, 30 * FP);
    const hurt = w.spawn('legionnaire', 1, 31 * FP, 31 * FP);
    hurt.hp = Math.floor(hurt.maxHp / 3);
    const [a, b] = [fresh.hp, hurt.hp];
    w.hit(seth, fresh, w.weapon(seth)!);
    w.hit(seth, hurt, w.weapon(seth)!);
    expect(b - hurt.hp).toBeGreaterThan(a - fresh.hp);
  });

  it('a ghost of the Armée des enfers vanishes once it has dealt its share of damage', () => {
    const w = createMatch(['dieux', 'humains']);
    const ghost = w.spawn('fantome', 0, 30 * FP, 30 * FP);
    const foe = w.spawn('phalangiste', 1, 31 * FP, 30 * FP);
    const a = w.weapon(ghost)!;
    for (let i = 0; i < 100 && ghost.hp > 0 && foe.hp > 0; i++) {
      foe.hp = foe.maxHp;
      w.hit(ghost, foe, a);
    }
    expect(ghost.hp).toBe(0);
    expect(ghost.dealt).toBeGreaterThanOrEqual(BALANCE.rules.upgrades.fantomeDamage);
  });

  it('Frigg and the Élémentaire d\'eau hover over the terrain but are hit as ground units', () => {
    const w = createMatch(['dieux', 'humains']);
    const frigg = w.spawn('frigg', 0, 30 * FP, 30 * FP);
    const eau = w.spawn('elemeau', 0, 32 * FP, 30 * FP);
    const brute = w.spawn('legionnaire', 1, 31 * FP, 31 * FP);
    for (const u of [frigg, eau]) {
      expect(soars(u)).toBe(true);
      expect(flies(u)).toBe(false);
      expect(reaches(w.weapon(brute)!, flies(u))).toBe(true);
    }
    const hp = frigg.hp;
    w.step([{ player: 1, kind: 'attack', ids: [brute.id], x: frigg.x, y: frigg.y, target: frigg.id }]);
    run(w, 3);
    expect(frigg.hp).toBeLessThan(hp);
  });

  it('the Porte de déphasage\'s second step sends the group still phased anywhere, out of phase', () => {
    const w = createMatch(['isdaris', 'humains']);
    w.players[0].energy = 1000;
    const trone = w.spawn('trone', 0, 20 * FP, 20 * FP);
    trone.exts.push('porte');
    const a = w.spawn('archer', 0, 40 * FP, 40 * FP);
    const b = w.spawn('archer', 0, 41 * FP, 40 * FP);
    const x0 = a.x;
    w.step([{ player: 0, kind: 'ability', ids: [trone.id], name: 'transfertgroupe', x: 60 * FP, y: 30 * FP }]);
    expect(Math.abs(a.x - x0)).toBeLessThan(FP); // nothing phased: nothing goes
    w.step([{ player: 0, kind: 'ability', ids: [trone.id], name: 'portedephasage', x: a.x, y: a.y }]);
    expect(a.phased).toBeGreaterThan(0);
    expect(b.phased).toBeGreaterThan(0);
    w.step([{ player: 0, kind: 'ability', ids: [trone.id], name: 'transfertgroupe', x: 60 * FP, y: 30 * FP }]);
    for (const u of [a, b]) {
      expect(u.phased).toBe(0);
      expect(Math.abs(u.x - 60 * FP)).toBeLessThan(3 * FP);
    }
  });

  it('the Élémentaire de feu\'s breath burns the ground units round its target', () => {
    const w = createMatch(['dieux', 'humains']);
    const fire = w.spawn('elementaire', 0, 30 * FP, 30 * FP);
    const t = w.spawn('auxiliaire', 1, 33 * FP, 30 * FP);
    const by = w.spawn('auxiliaire', 1, 33 * FP + FP / 2, 30 * FP);
    const hp = by.hp;
    w.hit(fire, t, w.weapon(fire)!);
    expect(by.hp).toBeLessThan(hp);
  });

  it('Amon-Râ blinds the enemies it holds: they see next to nothing', () => {
    const w = createMatch(['dieux', 'humains']);
    const seth = w.spawn('seth', 0, 30 * FP, 30 * FP);
    const aux = w.spawn('auxiliaire', 1, 36 * FP, 30 * FP);
    w.players[0].ultimates = { egyptien: 1e9 } as never;
    aux.frozen = ticks(60);
    run(w, 1);
    expect(w.sees(1, seth)).toBe(true);
    w.castAt(seth, 'amonra', aux.x, aux.y);
    expect(aux.held).toBeGreaterThan(0);
    expect(aux.blind).toBe(aux.held);
    run(w, 1);
    expect(w.sees(1, seth)).toBe(false);
  });

  it('a Pod carries up to three add-ons (notice)', () => {
    const w = createMatch(['z', 'humains']);
    w.players[0].minerals = 5000;
    const [ic] = of(w, 0, 'intelligence');
    const pod = w.spawn('pod', 0, ic.x + 4 * FP, ic.y + 10 * FP);
    run(w, 30); // its creep spreads
    // Two already hang on it (set down by hand, the ground round this Pod has room for two more only).
    for (let i = 0; i < 2; i++) w.spawn('tourelle', 0, (50 + 4 * i) * FP, 50 * FP).host = pod.id;
    w.step([{ player: 0, kind: 'train', ids: [pod.id], type: 'tourelle' }]);
    expect(w.addonsOf(pod)).toBe(3);
    expect(w.addonSpot(pod, 'tourelle')).toBeDefined(); // room left, but the Pod is full
    w.step([{ player: 0, kind: 'train', ids: [pod.id], type: 'tourelle' }]);
    expect(w.addonsOf(pod)).toBe(BALANCE.rules.z.podAddons);
  });

  it('the Orbe plasma moves slowly, without shooting, and is set down again in a power field (Redéploiement)', () => {
    const w = createMatch(['isdaris', 'humains']);
    const p = w.players[0];
    p.minerals = 1000;
    const [obe] = of(w, 0, 'obelisque');
    // Two free spots in the Obélisque's field.
    const spots: [number, number][] = [];
    for (let dy = -8; dy <= 8 && spots.length < 2; dy++)
      for (let dx = -8; dx <= 8 && spots.length < 2; dx++) {
        const [tx, ty] = [obe.tx + dx, obe.ty + dy];
        if (w.canPlace('orbe', tx, ty, 0) && !spots.some(([x, y]) => Math.abs(x - tx) < 4 && Math.abs(y - ty) < 4)) spots.push([tx, ty]);
      }
    expect(spots).toHaveLength(2);
    const orbe = w.spawn('orbe', 0, (spots[0][0] + 1) * FP, (spots[0][1] + 1) * FP);
    w.step([{ player: 0, kind: 'ability', ids: [orbe.id], name: 'redeploiement' }]);
    expect(orbe.type).toBe('orbemob');
    expect(orbe.speed).toBeGreaterThan(0);
    expect(w.weapon(orbe)).toBeUndefined();
    expect(p.minerals).toBe(1000 - 50); // sheet
    // Out of any field: refused.
    w.step([{ player: 0, kind: 'ability', ids: [orbe.id], name: 'ancrer', x: orbe.x + 40 * FP, y: orbe.y }]);
    run(w, 1);
    expect(orbe.type).toBe('orbemob');
    w.step([{ player: 0, kind: 'ability', ids: [orbe.id], name: 'ancrer', x: (spots[1][0] + 1) * FP, y: (spots[1][1] + 1) * FP }]);
    run(w, 30);
    expect(orbe.type).toBe('orbe');
    expect([orbe.tx, orbe.ty]).toEqual(spots[1]);
    expect(orbe.abilityCd).toBeGreaterThan(0); // 35 s before the next one (sheet)
  });

  it('Jet de sable under Gravité alourdie keeps its own 8 s, then only the Gravité slow is left', () => {
    const w = createMatch(['z', 'dieux']);
    const g = BALANCE.abilities.gravite;
    const jet = BALANCE.abilities.jetdesable;
    w.players[0].upgrades.raccumulateur = 1;
    const acc = w.spawn('quadripode', 0, 30 * FP, 30 * FP);
    acc.kit = 'accumulateur';
    acc.mana = 1 << 30; // plenty of its own energy (fiches 2010), the spell under test aside
    const tank = w.spawn('pegase', 1, 36 * FP, 30 * FP);
    tank.frozen = ticks(60);
    w.step([{ player: 0, kind: 'ability', ids: [acc.id], name: 'gravite' }]);
    run(w, 1.1);
    expect(w.paceOf(tank)).toEqual([100 - g.damage, g.max]);
    w.setPace(tank, ticks(jet.duration), jet.damage, 10000 / jet.damage); // Seth's Jet de sable
    expect(w.paceOf(tank)).toEqual([jet.damage, 10000 / jet.damage]);
    run(w, jet.duration - 1);
    expect(w.paceOf(tank)).toEqual([jet.damage, 10000 / jet.damage]);
    run(w, 1.1);
    expect(tank.pace).toBe(0);
    expect(tank.heavy).toBeGreaterThan(0);
    expect(w.paceOf(tank)).toEqual([100 - g.damage, g.max]);
    expect(tank.speed).toBe(w.baseSpeed(tank));
  });

  it('the Méga-Espion is slowed like any other unit', () => {
    const w = createMatch(['z', 'dieux']);
    w.players[0].upgrades.megaespion = 1;
    const spy = Object.assign(w.spawn('zespion', 0, 30 * FP, 30 * FP), { mana: 1 << 30 });
    const fast = w.baseSpeed(spy);
    w.setPace(spy, ticks(5), 50, 125);
    expect(spy.speed).toBe(w.baseSpeed(spy));
    expect(spy.speed).toBeLessThan(fast);
  });

  it('a ghost spends its share only on damage really dealt, not on a target that takes none', () => {
    const w = createMatch(['dieux', 'humains']);
    const ghost = w.spawn('fantome', 0, 30 * FP, 30 * FP);
    const foe = w.spawn('phalangiste', 1, 31 * FP, 30 * FP);
    const a = w.weapon(ghost)!;
    foe.invuln = ticks(60);
    for (let i = 0; i < 100; i++) w.hit(ghost, foe, a);
    expect(ghost.dealt).toBe(0);
    expect(ghost.hp).toBeGreaterThan(0);
    foe.invuln = 0;
    const before = foe.hp + foe.shield;
    w.hit(ghost, foe, a);
    expect(ghost.dealt).toBe(before - foe.hp - foe.shield);
  });

  it('the group transfer leaves behind a unit that has changed sides since it was phased', () => {
    const w = createMatch(['isdaris', 'humains']);
    w.players[0].energy = 1000;
    const trone = w.spawn('trone', 0, 20 * FP, 20 * FP);
    trone.exts.push('porte');
    const a = w.spawn('archer', 0, 40 * FP, 40 * FP);
    const b = w.spawn('archer', 0, 41 * FP, 40 * FP);
    w.step([{ player: 0, kind: 'ability', ids: [trone.id], name: 'portedephasage', x: a.x, y: a.y }]);
    b.owner = 1; // taken over (Soumission divine)
    const bx = b.x;
    w.step([{ player: 0, kind: 'ability', ids: [trone.id], name: 'transfertgroupe', x: 60 * FP, y: 30 * FP }]);
    expect(Math.abs(a.x - 60 * FP)).toBeLessThan(3 * FP);
    expect(b.x).toBe(bx);
    expect(b.phased).toBeGreaterThan(0);
  });
});
