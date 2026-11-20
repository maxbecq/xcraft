// Mechanics added after the audit of 20 November 2026 (docs/audit-mecaniques-2026-11-20.md).
import { describe, expect, it } from 'vitest';
import BALANCE from '../balance.json';
import { FP, ticks } from './fixed';
import { createMatch } from './setup';
import { type Entity, World } from './world';

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
    const cuve = w.spawn('cuve', 0, 30 * FP, 30 * FP);
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
    const alch = w.spawn('alchimiste', 0, 30 * FP, 30 * FP);
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
    run(w, 12);
    expect(tank.charges).toBe(5);
    const foe = w.spawn('creature', 1, mine.x + 4 * FP, mine.y);
    const hp = foe.hp + foe.shield;
    w.step([{ player: 1, kind: 'move', ids: [foe.id], x: mine.x - 4 * FP, y: mine.y }]);
    run(w, 6);
    expect(w.entities.has(mine.id)).toBe(false);
    expect(w.entities.has(foe.id) ? hp - foe.hp - foe.shield : hp).toBeGreaterThanOrEqual(Math.min(hp, 100));
  });

  it('the Assassin dodges a third of the shots from afar (Danse du soldat), not the blows', () => {
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
    expect(h3 - before(assassin)).toBe(h4 - before(archer));
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
    run(w, 6);
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
    const foe = w.spawn('auxiliaire', 1, 40 * FP, 30 * FP);
    const far = w.spawn('auxiliaire', 1, 60 * FP, 30 * FP);
    const speed = foe.speed;
    w.step([{ player: 0, kind: 'ability', ids: [acc.id], name: 'gravite' }]);
    expect(acc.gravity).toBeGreaterThan(0);
    run(w, 1.1);
    expect(foe.speed).toBeLessThan(speed);
    expect(foe.paceAtk).toBe(125);
    expect(far.pace).toBe(0);
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
});
