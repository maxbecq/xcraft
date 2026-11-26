import { describe, expect, it, vi } from 'vitest';
import { AI } from '../ai/ai';
import BALANCE from '../balance.json';
import { ABILITIES, type BuildingDef, DEFS, type UnitDef } from '../data';
import { FP, ticks } from './fixed';
import { createMatch } from './setup';
import { type Command, type Entity, World } from './world';
import { noRegen } from './noregen';

const of = (w: World, owner: number, type: string): Entity[] => [...w.entities.values()].filter((e) => e.owner === owner && e.type === type);
const run = (w: World, seconds: number) => {
  for (let i = 0; i < ticks(seconds); i++) w.step([]);
};

// The gods spawned here are full of mana (XC.doc 2008): the tests are about the spells, not the mana.
describe('Dieux', () => {
  it('start with a Porte d’Asgaard, Esprits and Gaïa', () => {
    const w = createMatch(['dieux', 'humains']);
    expect(of(w, 0, 'asgaard')).toHaveLength(1);
    expect(of(w, 0, 'esprit')).toHaveLength(6);
    expect(of(w, 0, 'gaia')).toHaveLength(1);
    expect(w.supply(0)).toEqual({ used: 6 + (DEFS.gaia as UnitDef).supply, max: 14 });
  });

  it('Gaïa calls a building down and it materialises by itself; Esprits cannot build', () => {
    const w = createMatch(['dieux', 'humains']);
    w.players[0].minerals = 2000;
    const [gaia] = of(w, 0, 'gaia');
    const [esprit] = of(w, 0, 'esprit');
    w.step([{ player: 0, kind: 'build', ids: [esprit.id], type: 'branche', tx: 22, ty: 18 }]);
    expect(esprit.order).toBeNull();
    w.step([{ player: 0, kind: 'build', ids: [gaia.id], type: 'branche', tx: 22, ty: 18 }]);
    run(w, 10);
    const [branche] = of(w, 0, 'branche');
    expect(branche).toBeDefined();
    expect(gaia.order).toBeNull(); // free at once
    run(w, 30);
    expect(branche.buildLeft).toBe(0);
    expect(w.supply(0).max).toBe(24);
  });

  it('gods are summoned at the Porte, one of each, and summon their troops while standing still', () => {
    const w = createMatch(['dieux', 'humains']);
    const p = w.players[0];
    p.minerals = 5000;
    p.energy = 5000;
    w.spawn('branche', 0, 30 * FP, 14 * FP);
    const [porte] = of(w, 0, 'asgaard');
    w.step([{ player: 0, kind: 'train', ids: [porte.id], type: 'thor' }]);
    w.step([{ player: 0, kind: 'train', ids: [porte.id], type: 'thor' }]);
    expect(porte.queue).toEqual(['thor']); // unique, queued ones counted
    run(w, (DEFS.thor as UnitDef).buildTime + 1);
    const [thor] = of(w, 0, 'thor');
    expect(thor).toBeDefined();
    w.step([{ player: 0, kind: 'train', ids: [thor.id], type: 'nain' }, { player: 0, kind: 'train', ids: [thor.id], type: 'minotaure' }]);
    expect(thor.queue).toEqual(['nain']); // only his own troops
    // Summoning, he cannot walk away (balance designer 2026-11-22): the summons goes on.
    const [x, left] = [thor.x, thor.trainLeft];
    w.step([{ player: 0, kind: 'move', ids: [thor.id], x: 40 * FP, y: 40 * FP }]);
    run(w, 2);
    expect(thor.x).toBe(x);
    expect(thor.trainLeft).toBeLessThan(left);
    run(w, (DEFS.nain as UnitDef).buildTime + 1);
    const [nain] = of(w, 0, 'nain');
    expect(nain).toBeDefined();
    expect(Math.hypot(nain.x - thor.x, nain.y - thor.y)).toBeLessThan(4 * FP);
  });

  it('a fallen god can be summoned again at once, back at level 1; Gaïa comes back by herself', () => {
    const w = createMatch(['dieux', 'humains']);
    const p = w.players[0];
    p.minerals = 5000;
    p.energy = 5000;
    const thor = Object.assign(w.spawn('thor', 0, 30 * FP, 30 * FP), { mana: 1 << 30 });
    thor.lvl = 3;
    thor.hp = 0;
    const [gaia] = of(w, 0, 'gaia');
    gaia.hp = 0;
    run(w, 1);
    expect(w.lacks(0, 'thor')).toBe('');
    const [porte] = of(w, 0, 'asgaard');
    w.step([{ player: 0, kind: 'train', ids: [porte.id], type: 'thor' }]);
    run(w, (DEFS.thor as UnitDef).buildTime + 1);
    expect(of(w, 0, 'thor')[0].lvl).toBe(1);
    run(w, 46);
    expect(of(w, 0, 'gaia')).toHaveLength(1);
  });

  it('a god bought up a level gains its stats and summons that many times faster', () => {
    const w = createMatch(['dieux', 'humains']);
    const p = w.players[0];
    p.minerals = 5000;
    w.spawn('branche', 0, 36 * FP, 14 * FP);
    const thor = Object.assign(w.spawn('thor', 0, 30 * FP, 30 * FP), { mana: 1 << 30 });
    const lv = (DEFS.thor as UnitDef).levels!;
    w.step([{ player: 0, kind: 'train', ids: [thor.id], type: 'niveau' }]);
    w.step([{ player: 0, kind: 'train', ids: [thor.id], type: 'niveau' }]);
    expect(thor.queue).toEqual(['niveau']); // one at a time
    expect(p.minerals).toBe(5000 - lv.cost[0].minerals);
    run(w, lv.time[0] + 1);
    expect(thor.lvl).toBe(2);
    expect(thor.maxHp).toBe(lv.hp[1]);
    expect(w.weapon(thor)!.damage).toBe(lv.damage![1]);
    expect(w.armorBonus(thor)).toBe(lv.armor[1] - (DEFS.thor as UnitDef).armor);
    w.step([{ player: 0, kind: 'train', ids: [thor.id], type: 'nain' }]);
    run(w, (DEFS.nain as UnitDef).buildTime / 2 + 1);
    expect(of(w, 0, 'nain')).toHaveLength(1);
    // Cancelling a level gives its price back.
    const before = p.minerals;
    w.step([{ player: 0, kind: 'train', ids: [thor.id], type: 'niveau' }]);
    w.step([{ player: 0, kind: 'cancel', ids: [thor.id] }]);
    expect(p.minerals).toBe(before);
  });

  it('the spells grow with the god: Pluie de feu harder, Courroux sends a shock wave once Thor evolved', () => {
    const w = createMatch(['dieux', 'humains']);
    const apollon = Object.assign(w.spawn('apollon', 0, 30 * FP, 30 * FP), { mana: 1 << 30 });
    apollon.lvl = 3;
    const foe = w.spawn('legionnaire', 1, 34 * FP, 30 * FP);
    const before = foe.hp;
    w.step([{ player: 0, kind: 'ability', ids: [apollon.id], name: 'pluiedefeu', x: foe.x, y: foe.y }]);
    run(w, 1);
    expect(before - foe.hp).toBeGreaterThanOrEqual(ABILITIES.pluiedefeu.levels!.damage![2] - 10);
    const thor = Object.assign(w.spawn('thor', 0, 50 * FP, 30 * FP), { mana: 1 << 30 });
    thor.lvl = 2;
    const target = w.spawn('grenier', 1, 51 * FP, 27 * FP);
    const near = w.spawn('legionnaire', 1, 54 * FP, 28 * FP);
    const nearHp = near.hp;
    thor.charged = 100;
    w.step([{ player: 0, kind: 'attack', ids: [thor.id], x: target.x, y: target.y, target: target.id }]);
    run(w, 6); // Thor walks at 1.1 at his second level
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(near.hp).toBeLessThan(nearHp);
  });

  it('the second rank opens with two first-rank gods; Odin, Athéna and Isis summon their own troops', () => {
    const w = createMatch(['dieux', 'humains']);
    expect(w.lacks(0, 'odin')).toMatch(/2 parmi/);
    Object.assign(w.spawn('thor', 0, 30 * FP, 30 * FP), { mana: 1 << 30 });
    Object.assign(w.spawn('seth', 0, 34 * FP, 30 * FP), { mana: 1 << 30 });
    expect(w.lacks(0, 'odin')).toBe('');
    w.players[0].minerals = 5000;
    w.players[0].energy = 5000;
    w.spawn('branche', 0, 36 * FP, 14 * FP);
    w.spawn('branche', 0, 39 * FP, 14 * FP);
    const odin = Object.assign(w.spawn('odin', 0, 30 * FP, 40 * FP), { mana: 1 << 30 });
    const isis = Object.assign(w.spawn('isis', 0, 40 * FP, 40 * FP), { mana: 1 << 30 });
    w.step([{ player: 0, kind: 'train', ids: [odin.id], type: 'drake' }, { player: 0, kind: 'train', ids: [isis.id], type: 'pretresse' }]);
    run(w, (DEFS.drake as UnitDef).buildTime + 1);
    expect(of(w, 0, 'drake')).toHaveLength(1);
    expect(of(w, 0, 'pretresse')).toHaveLength(1);
  });

  it("Odin's aura and Athéna's: harder blows and more armour round them", () => {
    const w = createMatch(['dieux', 'humains']);
    const nain = w.spawn('nain', 0, 30 * FP, 30 * FP);
    const bare = w.armorBonus(nain);
    Object.assign(w.spawn('athena', 0, 32 * FP, 30 * FP), { mana: 1 << 30 });
    expect(w.armorBonus(nain)).toBe(bare + BALANCE.rules.upgrades.auraprotection.armor[0]);
    const dummy = w.spawn('grenier', 1, 30 * FP, 32 * FP);
    const hit = () => {
      const before = dummy.hp;
      w.hit(nain, dummy, (DEFS.nain as UnitDef).attack!);
      return before - dummy.hp;
    };
    const plain = hit();
    Object.assign(w.spawn('odin', 0, 33 * FP, 31 * FP), { mana: 1 << 30 }); // within his aura's 4 at his first level
    expect(hit()).toBe(plain + BALANCE.rules.upgrades.auraguerre.damage[0]);
  });

  it('Foudre stuns, Cri de guerre strengthens, Soins divins heals, Résurrection raises the fallen', () => {
    const w = createMatch(['dieux', 'humains']);
    const odin = Object.assign(w.spawn('odin', 0, 30 * FP, 30 * FP), { mana: 1 << 30 });
    const foe = w.spawn('legionnaire', 1, 34 * FP, 30 * FP);
    w.step([{ player: 0, kind: 'ability', ids: [odin.id], name: 'foudre', x: foe.x, y: foe.y }]);
    run(w, 0.5);
    expect(foe.held).toBeGreaterThan(0);
    const athena = Object.assign(w.spawn('athena', 0, 50 * FP, 50 * FP), { mana: 1 << 30 });
    const nain = w.spawn('nain', 0, 51 * FP, 50 * FP);
    w.step([{ player: 0, kind: 'ability', ids: [athena.id], name: 'cridegueurre' }]);
    expect(nain.war).toBeGreaterThan(0);
    const isis = Object.assign(w.spawn('isis', 0, 70 * FP, 50 * FP), { mana: 1 << 30 });
    const hurt = w.spawn('nain', 0, 71 * FP, 50 * FP);
    hurt.hp = 50;
    w.step([{ player: 0, kind: 'ability', ids: [isis.id], name: 'soinsdivins' }]);
    expect(hurt.hp).toBe(50 + ABILITIES.soinsdivins.damage!);
    hurt.hp = 0;
    run(w, 1);
    expect(of(w, 0, 'nain').filter((n) => Math.abs(n.x - 71 * FP) < FP)).toHaveLength(0);
    isis.abilityCd = 0; // her spells share one cooldown
    w.step([{ player: 0, kind: 'ability', ids: [isis.id], name: 'resurrection' }]);
    expect(of(w, 0, 'nain').filter((n) => Math.abs(n.x - 71 * FP) < 2 * FP)).toHaveLength(1);
  });

  it('the third rank: Soumission, Voile, Rayon de mort, Voyage, Armée des enfers, Nuée, putrid aura, Fontaine, Yggdrasill furieux', () => {
    const w = createMatch(['dieux', 'humains']);
    expect(w.lacks(0, 'frigg')).toMatch(/2 parmi/);
    Object.assign(w.spawn('odin', 0, 20 * FP, 20 * FP), { mana: 1 << 30 });
    Object.assign(w.spawn('isis', 0, 24 * FP, 20 * FP), { mana: 1 << 30 });
    expect(w.lacks(0, 'hades')).toBe('');
    // Soumission: the foe changes side, then comes back to its own.
    const frigg = Object.assign(w.spawn('frigg', 0, 30 * FP, 30 * FP), { mana: 1 << 30 });
    const foe = w.spawn('legionnaire', 1, 34 * FP, 30 * FP);
    w.step([{ player: 0, kind: 'ability', ids: [frigg.id], name: 'soumission', x: foe.x, y: foe.y }]);
    run(w, 0.5);
    expect(foe.owner).toBe(0);
    run(w, ABILITIES.soumission.duration + 1);
    expect(foe.owner).toBe(1);
    frigg.abilityCd = 0;
    const nain = w.spawn('nain', 0, 31 * FP, 30 * FP);
    w.step([{ player: 0, kind: 'ability', ids: [frigg.id], name: 'voile' }]);
    expect(nain.camo).toBeGreaterThan(0);
    // Rayon de mort on every enemy Hadès sees (no more Armée des enfers: équilibreur 2026-11-22).
    const w2 = createMatch(['dieux', 'humains']);
    const hades = Object.assign(w2.spawn('hades', 0, 30 * FP, 30 * FP), { mana: 1 << 30 });
    const a = w2.spawn('legionnaire', 1, 34 * FP, 30 * FP);
    const b = w2.spawn('legionnaire', 1, 31 * FP, 33 * FP);
    run(w2, 0.5);
    const [ha, hb] = [a.hp, b.hp];
    w2.step([{ player: 0, kind: 'ability', ids: [hades.id], name: 'rayonmort' }]);
    expect(a.hp).toBeLessThan(ha);
    expect(b.hp).toBeLessThan(hb);
    expect((DEFS.hades as UnitDef).abilities).not.toContain('armeeenfers');
    hades.abilityCd = 0;
    w2.step([{ player: 0, kind: 'ability', ids: [hades.id], name: 'voyage', x: 45 * FP, y: 30 * FP }]);
    run(w2, 6);
    expect(Math.abs(hades.x - 45 * FP)).toBeLessThan(3 * FP);
    // Osiris's aura and swarm.
    const osiris = Object.assign(w.spawn('osiris', 0, 40 * FP, 80 * FP), { mana: 1 << 30 });
    const c = w.spawn('legionnaire', 1, 41.5 * FP, 80 * FP);
    const hc = c.hp;
    run(w, 1.1);
    expect(c.hp).toBeLessThan(hc);
    osiris.hp = 1000;
    w.step([{ player: 0, kind: 'ability', ids: [osiris.id], name: 'nuee' }]);
    run(w, 2.1);
    expect(osiris.hp).toBeGreaterThan(1000 - 200);
    // The Fontaine heals; the Protecteur turns furieux with Hadès.
    const fontaine = w.spawn('fontaine', 0, 20 * FP, 60 * FP);
    const wounded = w.spawn('nain', 0, 22 * FP, 63 * FP);
    wounded.hp = 20;
    run(w, 2.1);
    expect(wounded.hp).toBeGreaterThan(20);
    void fontaine;
    expect(w.lacks(0, 'furieux')).toMatch(/Hadès/);
    Object.assign(w.spawn('hades', 0, 70 * FP, 20 * FP), { mana: 1 << 30 });
    expect(w.lacks(0, 'furieux')).toBe('');
  });

  it('the Temple primordial charges an ultimate while its three gods stand; any of them casts it once', () => {
    const w = createMatch(['dieux', 'humains']);
    const full = ticks(BALANCE.units.primordial.charge);
    w.spawn('primordial', 0, 20 * FP, 20 * FP);
    const seth = Object.assign(w.spawn('seth', 0, 30 * FP, 30 * FP), { mana: 1 << 30 });
    Object.assign(w.spawn('isis', 0, 32 * FP, 34 * FP), { mana: 1 << 30 });
    run(w, 2);
    expect(w.players[0].ultimates?.egyptien ?? 0).toBe(0); // Osiris missing
    const osiris = Object.assign(w.spawn('osiris', 0, 36 * FP, 34 * FP), { mana: 1 << 30 });
    run(w, 10);
    const charged = w.players[0].ultimates!.egyptien!;
    expect(charged).toBeGreaterThan(0);
    osiris.hp = 0;
    run(w, 5);
    expect(w.players[0].ultimates!.egyptien).toBe(charged); // stopped, not lost
    w.players[0].ultimates!.egyptien = full;
    const foe = w.spawn('legionnaire', 1, 34 * FP, 30 * FP);
    w.step([{ player: 0, kind: 'ability', ids: [seth.id], name: 'amonra', x: foe.x, y: foe.y }]);
    run(w, 1);
    expect(foe.held).toBeGreaterThan(ticks(5));
    expect(w.players[0].ultimates!.egyptien).toBe(0);
    // Tempête de Zeus: a share of each one's full health, allies too; Jörmungand comes.
    w.players[0].ultimates!.grec = full;
    w.players[0].ultimates!.scandinave = full;
    const apollon = Object.assign(w.spawn('apollon', 0, 50 * FP, 50 * FP), { mana: 1 << 30 });
    const mine = w.spawn('nain', 0, 54 * FP, 50 * FP);
    const theirs = w.spawn('legionnaire', 1, 55 * FP, 51 * FP);
    const [hm, ht] = [mine.hp, theirs.hp];
    w.step([{ player: 0, kind: 'ability', ids: [apollon.id], name: 'tempetezeus', x: 54 * FP, y: 50 * FP }]);
    run(w, 1);
    expect(mine.hp).toBeLessThan(hm);
    expect(theirs.hp).toBeLessThan(ht);
    const thor = Object.assign(w.spawn('thor', 0, 30 * FP, 50 * FP), { mana: 1 << 30 });
    w.step([{ player: 0, kind: 'ability', ids: [thor.id], name: 'jormungand', x: 33 * FP, y: 50 * FP }]);
    run(w, 1);
    expect(of(w, 0, 'jormungandr')).toHaveLength(1);
  });

  it('the Artefacterie gives up to 4 improvements to a god clicked on anywhere, the same one several times (like the Centre K)', () => {
    const w = createMatch(['dieux', 'humains']);
    const p = w.players[0];
    p.minerals = p.energy = 5000;
    const thor = Object.assign(w.spawn('thor', 0, 60 * FP, 60 * FP), { mana: 1 << 30 });
    const arte = w.spawn('artefacterie', 0, 20 * FP, 20 * FP);
    const give = (t: string) => {
      arte.abilityCd = 0;
      w.step([{ player: 0, kind: 'ability', ids: [arte.id], name: t, x: thor.x, y: thor.y }]);
    };
    give('artforce');
    expect(thor.arts).toEqual(['artforce']);
    expect(w.busy(thor)).toBe(false); // nothing queued at the god: it walks on
    w.step([{ player: 0, kind: 'ability', ids: [arte.id], name: 'artforce', x: thor.x, y: thor.y }]);
    expect(thor.arts).toHaveLength(1); // the Artefacterie rests a moment
    for (const t of ['artforce', 'artresistance', 'artvitesse', 'artagilite']) give(t);
    expect(thor.arts).toEqual(['artforce', 'artforce', 'artresistance', 'artvitesse']);
    expect(w.armorBonus(thor)).toBe(BALANCE.rules.upgrades.artefacts.resistance);
    const dummy = w.spawn('grenier', 1, 60 * FP, 62 * FP);
    const before = dummy.hp;
    w.hit(thor, dummy, (DEFS.thor as UnitDef).attack!);
    const plain = (DEFS.thor as UnitDef).attack!.damage;
    expect(before - dummy.hp).toBe(plain + Math.trunc((plain * 2 * BALANCE.rules.upgrades.artefacts.force) / 100) - (DEFS.grenier as BuildingDef).armor);
  });

  it('Chouette shows a zone; Dissipation frees an ally and hurts a summoned enemy; Élémentaires change form and merge', () => {
    const w = createMatch(['dieux', 'humains']);
    const athena = Object.assign(w.spawn('athena', 0, 30 * FP, 30 * FP), { mana: 1 << 30 });
    w.step([{ player: 0, kind: 'ability', ids: [athena.id], name: 'chouette', x: 40 * FP, y: 30 * FP }]);
    run(w, 3);
    expect(w.scans.some((z) => z.owner === 0 && z.radius === ABILITIES.chouette.radius)).toBe(true);
    const pretresse = Object.assign(w.spawn('pretresse', 0, 30 * FP, 34 * FP), { mana: 1 << 30 });
    const nain = w.spawn('nain', 0, 32 * FP, 34 * FP);
    nain.held = ticks(10);
    w.step([{ player: 0, kind: 'ability', ids: [pretresse.id], name: 'dissipation', x: nain.x, y: nain.y }]);
    run(w, 0.5);
    expect(nain.held).toBe(0);
    pretresse.abilityCd = 0;
    pretresse.spellCd = {}; // its 4 s (XC.doc 2008) waived for the test
    const ghost = w.spawn('fantome', 1, 33 * FP, 36 * FP);
    ghost.invuln = ghost.ttl;
    w.step([{ player: 0, kind: 'ability', ids: [pretresse.id], name: 'dissipation', x: ghost.x, y: ghost.y }]);
    run(w, 0.5);
    expect(ghost.hp).toBeLessThan(ghost.maxHp);
    const fire = w.spawn('elementaire', 0, 50 * FP, 30 * FP);
    w.step([{ player: 0, kind: 'ability', ids: [fire.id], name: 'formeterre' }]);
    expect(fire.type).toBe('elemterre');
    const other = w.spawn('elemeau', 0, 51 * FP, 30 * FP);
    void other;
    fire.abilityCd = 0; // one cooldown for its abilities
    w.step([{ player: 0, kind: 'ability', ids: [fire.id], name: 'fusion' }]);
    expect(of(w, 0, 'golem')).toHaveLength(1);
    expect(of(w, 0, 'elemterre').length + of(w, 0, 'elemeau').length).toBe(0);
  });

  it("the Temple de vénération's other research: Coup puissant, Peau de roc, Prescience, Drake géant, Aura putride; no more Transe", () => {
    const w = createMatch(['dieux', 'humains']);
    const up = w.players[0].upgrades;
    // Peau de roc: the Sphinx turns to stone, armoured and mending.
    const sphinx = w.spawn('sphinx', 0, 30 * FP, 30 * FP);
    const bare = w.armorBonus(sphinx);
    w.step([{ player: 0, kind: 'ability', ids: [sphinx.id], name: 'statue' }]);
    expect(sphinx.statue).toBe(0); // not researched
    up.peauroc = 1;
    w.step([{ player: 0, kind: 'ability', ids: [sphinx.id], name: 'statue' }]);
    expect(w.armorBonus(sphinx)).toBe(bare + BALANCE.rules.upgrades.statue.armor);
    // Coup puissant: some blows double.
    up.coupuissant = 1;
    const mino = w.spawn('minotaure', 0, 50 * FP, 30 * FP);
    const dummy = w.spawn('grenier', 1, 50 * FP, 32 * FP);
    const blows = new Set<number>();
    for (let i = 0; i < 12; i++) {
      const before = dummy.hp;
      w.hit(mino, dummy, (DEFS.minotaure as UnitDef).attack!);
      blows.add(before - dummy.hp);
      w.step([]);
    }
    expect(blows.size).toBe(2);
    // Drake géant and Aura putride, on those standing and to come.
    const drake = w.spawn('drake', 0, 60 * FP, 50 * FP);
    up.drakegeant = 1;
    w.empower(drake, 'drakegeant');
    expect(drake.maxHp).toBeGreaterThan((DEFS.drake as UnitDef).hp);
    expect(w.room(drake)).toBe(BALANCE.rules.upgrades.drakegeant.room);
    const slow = w.spawn('immortel', 0, 66 * FP, 50 * FP);
    up.auraputride = 1;
    const imm = w.spawn('immortel', 0, 64 * FP, 50 * FP);
    expect(imm.maxHp).toBe((DEFS.immortel as UnitDef).hp + BALANCE.rules.upgrades.auraputride.hp);
    expect(imm.speed).toBeGreaterThan(slow.speed);
    // The Minotaure lost its Transe enragée.
    expect((DEFS.minotaure as UnitDef).ability).toBeUndefined();
  });

  it('Déracinement: an Yggdrasill walks, then takes root again elsewhere', () => {
    const w = createMatch(['dieux', 'humains']);
    const b = w.spawn('protecteur', 0, 30 * FP, 30 * FP);
    w.step([{ player: 0, kind: 'ability', ids: [b.id], name: 'deraciner' }]);
    expect(b.type).toBe('protecteur'); // not researched
    w.players[0].upgrades.deracinement = 1;
    w.step([{ player: 0, kind: 'ability', ids: [b.id], name: 'deraciner' }]);
    expect(b.type).toBe('protecteurmob');
    run(w, 4);
    // A spot the ground allows, a few tiles off.
    const [tx, ty] = [...Array(64).keys()].map((i) => [30 + (i % 8), 26 + (i >> 3)]).find(([x, y]) => w.canPlace('protecteur', x, y, 0) && Math.abs(x - 30) > 2)!;
    w.step([{ player: 0, kind: 'ability', ids: [b.id], name: 'enraciner', x: (tx + 1) * FP, y: (ty + 1) * FP }]);
    run(w, 10);
    expect(b.type).toBe('protecteur');
    expect(b.tx).toBe(tx);
  });

  it("the Élémentaire d'eau's icy shot slows what it hits", () => {
    const w = createMatch(['dieux', 'humains']);
    const water = w.spawn('elemeau', 0, 30 * FP, 30 * FP);
    const foe = w.spawn('legionnaire', 1, 33 * FP, 30 * FP);
    const speed = foe.speed;
    w.hit(water, foe, (DEFS.elemeau as UnitDef).attack!);
    expect(foe.speed).toBeLessThan(speed);
    water.hp = 0; // no more shots
    run(w, BALANCE.rules.upgrades.glace.seconds + 0.5);
    expect(foe.chill).toBe(0);
  });

  it('Offrandes: the gods stop counting in the supply (a queued level never counts)', () => {
    const w = createMatch(['dieux', 'humains']);
    const thor = Object.assign(w.spawn('thor', 0, 30 * FP, 30 * FP), { mana: 1 << 30 });
    w.players[0].minerals = 5000;
    w.step([{ player: 0, kind: 'train', ids: [thor.id], type: 'niveau' }]);
    const before = w.supply(0).used;
    expect(before).toBe(6 + (DEFS.gaia as UnitDef).supply + (DEFS.thor as UnitDef).supply);
    w.players[0].upgrades.offrandes = 1;
    expect(w.supply(0).used).toBe(6);
  });

  it('a building Gaïa calls down at level 2 materialises twice as fast', () => {
    const w = createMatch(['dieux', 'humains']);
    w.players[0].minerals = 2000;
    const [gaia] = of(w, 0, 'gaia');
    gaia.lvl = 2;
    w.step([{ player: 0, kind: 'build', ids: [gaia.id], type: 'branche', tx: 22, ty: 18 }]);
    run(w, 10);
    const [branche] = of(w, 0, 'branche');
    run(w, (DEFS.branche as UnitDef).buildTime / 2);
    expect(branche.buildLeft).toBe(0);
    expect(branche.hp).toBeGreaterThan(branche.maxHp * 0.85);
  });

  it('the Yggdrasill protecteur needs two first-rank gods', () => {
    const w = createMatch(['dieux', 'humains']);
    expect(w.lacks(0, 'protecteur')).toMatch(/2 parmi/);
    Object.assign(w.spawn('thor', 0, 30 * FP, 30 * FP), { mana: 1 << 30 });
    Object.assign(w.spawn('seth', 0, 32 * FP, 30 * FP), { mana: 1 << 30 });
    expect(w.lacks(0, 'protecteur')).toBe('');
  });

  it('Courroux du marteau doubles the next blow (balance designer 2026-11-22); the Tempête de sable silences enemy shooters', () => {
    noRegen();
    const w = createMatch(['dieux', 'humains']);
    const thor = Object.assign(w.spawn('thor', 0, 30 * FP, 30 * FP), { mana: 1 << 30 });
    const dummy = w.spawn('conseil', 1, 31 * FP, 28 * FP);
    const before = dummy.hp;
    w.step([{ player: 0, kind: 'ability', ids: [thor.id], name: 'courroux' }]);
    expect(thor.charged).toBeGreaterThan(0);
    w.step([{ player: 0, kind: 'attack', ids: [thor.id], x: dummy.x, y: dummy.y, target: dummy.id }]);
    run(w, 3);
    expect(before - dummy.hp).toBeGreaterThanOrEqual(2 * (DEFS.thor as UnitDef).attack!.damage - 10);
    expect(thor.charged).toBe(0);

    const seth = Object.assign(w.spawn('seth', 0, 50 * FP, 50 * FP), { mana: 1 << 30 });
    const archer = w.spawn('auxiliaire', 1, 54 * FP, 50 * FP);
    run(w, 4); // both settle on open ground first
    w.step([{ player: 0, kind: 'ability', ids: [seth.id], name: 'tempete', x: archer.x, y: archer.y }]);
    run(w, 1);
    expect(w.storms).toHaveLength(1);
    const hp = seth.hp;
    w.step([{ player: 1, kind: 'attack', ids: [archer.id], x: seth.x, y: seth.y, target: seth.id }]);
    run(w, ABILITIES.tempete.duration - 2);
    expect(seth.hp).toBe(hp);
  });

  it('two gods standing close do not overlap, even a few tiles apart', () => {
    const w = new World(createMatch(['dieux', 'humains']).map);
    // 2.2 tiles apart, closer than their radii add up (2.5), in separation buckets two apart.
    const thor = Object.assign(w.spawn('thor', 0, Math.round(31.9 * FP), 40 * FP), { mana: 1 << 30 });
    const gaia = Object.assign(w.spawn('gaia', 0, Math.round(34.1 * FP), 40 * FP), { mana: 1 << 30 });
    run(w, 3);
    expect(Math.hypot(thor.x - gaia.x, thor.y - gaia.y)).toBeGreaterThanOrEqual(thor.radius + gaia.radius - FP / 16);
  });

  it('the AI plays the Dieux: Esprits, gods, an army', () => {
    const w = createMatch(['dieux', 'humains']);
    const ai = new AI(w, 0);
    for (let i = 0; i < ticks(9 * 60); i++) w.step(ai.think());
    expect(of(w, 0, 'esprit').length).toBeGreaterThan(10);
    expect(of(w, 0, 'thor')).toHaveLength(1);
    expect(of(w, 0, 'branche').length + of(w, 0, 'protecteur').length).toBeGreaterThan(0);
    expect(of(w, 0, 'nain').length + of(w, 0, 'minotaure').length + of(w, 0, 'sphinx').length).toBeGreaterThan(5);
  });

  it('gods bought up by the AI replay the same from the recorded commands (levels in the hash)', () => {
    const record: [number, Command[]][] = [];
    let levelled = false;
    const live = createMatch(['dieux', 'humains']);
    // Humans slowed and the Dieux sped up a little, so the Dieux last long enough for a god to level.
    live.players[1].handicap = 60;
    live.players[0].handicap = 150;
    const ais = [new AI(live, 0), new AI(live, 1)];
    while (live.tick < ticks(21 * 60)) {
      const cmds = ais.flatMap((ai) => ai.think());
      if (cmds.length) record.push([live.tick, cmds]);
      live.step(cmds);
      if (live.tick % 60 === 0) levelled ||= [...live.entities.values()].some((e) => e.owner === 0 && e.def.kind === 'unit' && e.lvl > 1);
    }
    expect(levelled).toBe(true); // a god levelled (it may have fallen since)
    const played = new Map<number, Command[]>(JSON.parse(JSON.stringify(record)));
    const again = createMatch(['dieux', 'humains']);
    again.players[1].handicap = 60;
    again.players[0].handicap = 150;
    while (again.tick < live.tick) again.step(played.get(again.tick) ?? []);
    expect(again.hash()).toBe(live.hash());
    expect([...again.entities.values()].map((e) => e.lvl)).toEqual([...live.entities.values()].map((e) => e.lvl));
  }, 60_000);
});

describe('Dieux builders (notice)', () => {
  it('Thor raises the Temple de vénération, Osiris the Fontaine, Frigg the Artefacterie; Gaïa none of them', () => {
    const w = createMatch(['dieux', 'humains']);
    const p = w.players[0];
    p.minerals = 99999;
    p.energy = 99999;
    const [gaia] = [...w.entities.values()].filter((e) => e.owner === 0 && e.type === 'gaia');
    for (const [god, type] of [['thor', 'temple'], ['osiris', 'fontaine'], ['frigg', 'artefacterie']] as const) {
      const g = w.spawn(god, 0, gaia.x + 4 * FP, gaia.y);
      let spot: [number, number] | undefined;
      for (let r = 4; r < 30 && !spot; r++) for (let dx = -r; dx <= r && !spot; dx++) for (const dy of [-r, r]) if (!spot && w.canPlace(type, Math.floor(gaia.x / FP) + dx, Math.floor(gaia.y / FP) + dy, 0)) spot = [Math.floor(gaia.x / FP) + dx, Math.floor(gaia.y / FP) + dy];
      w.step([{ player: 0, kind: 'build', ids: [gaia.id], type, tx: spot![0], ty: spot![1] }]);
      expect(gaia.order?.kind).not.toBe('build');
      // With both selected, the god takes the order (it may raise it at once, standing close enough).
      w.step([{ player: 0, kind: 'build', ids: [g.id, gaia.id], type, tx: spot![0], ty: spot![1] }]);
      expect(gaia.order?.kind).not.toBe('build');
      for (let i = 0; i < ticks(40) && ![...w.entities.values()].some((e) => e.type === type && e.owner === 0); i++) w.step([]);
      expect([...w.entities.values()].some((e) => e.type === type && e.owner === 0)).toBe(true);
    }
  });
});

describe('Élémentaire (notice: « faible et chétive »)', () => {
  it('Athéna summons it in its base form, which turns into any of the four forms or fuses', () => {
    expect((DEFS.athena as UnitDef).trains).toContain('elembase');
    expect((DEFS.athena as UnitDef).trains).not.toContain('elementaire');
    const w = createMatch(['dieux', 'humains']);
    const base = w.spawn('elembase', 0, 50 * FP, 30 * FP);
    // XC.doc 2008: 200 PV, 12 in melee, weaker than any of its forms.
    expect(base.maxHp).toBe(200);
    for (const f of ['elementaire', 'elemeau', 'elemterre']) expect((DEFS[f] as UnitDef).attack!.damage).toBeGreaterThanOrEqual(12);
    w.step([{ player: 0, kind: 'ability', ids: [base.id], name: 'formeair' }]);
    expect(base.type).toBe('elemair');
    const a = w.spawn('elembase', 0, 60 * FP, 30 * FP);
    w.spawn('elembase', 0, 61 * FP, 30 * FP);
    w.step([{ player: 0, kind: 'ability', ids: [a.id], name: 'fusion' }]);
    expect([...w.entities.values()].filter((e) => e.type === 'golem')).toHaveLength(1);
  });

  it('the AI turns its base Élémentaires into fire at once', () => {
    const w = createMatch(['dieux', 'humains']);
    const ai = new AI(w, 0);
    const base = w.spawn('elembase', 0, 30 * FP, 30 * FP);
    for (let i = 0; i < ticks(3) && base.type === 'elembase'; i++) w.step(ai.think());
    expect(base.type).toBe('elementaire');
  });
});

describe('Golem (notice: « dégâts aberrants aux bâtiments »)', () => {
  it('its 70 more go to buildings only, not to machines', () => {
    const w = createMatch(['dieux', 'humains']);
    const g = w.spawn('golem', 0, 30 * FP, 30 * FP);
    const a = w.weapon(g)!;
    const loss = (type: string) => {
      const t = w.spawn(type, 1, 40 * FP, 40 * FP);
      const before = t.hp;
      w.hit(g, t, { ...a, splash: 0 });
      return before - t.hp + ((t.def as UnitDef).armor ?? 0);
    };
    expect(loss('caserne')).toBe(140);
    expect(loss('pegase')).toBe(70);
  });
});

describe('a busy god (balance designer, 2026-11-22)', () => {
  it('stands still and does not fight while it summons or goes up a level; Gaïa walks on', () => {
    const w = createMatch(['dieux', 'humains']);
    w.players[0].minerals = 5000;
    w.players[0].energy = 5000;
    w.spawn('branche', 0, 30 * FP, 14 * FP);
    const thor = w.spawn('thor', 0, 30 * FP, 30 * FP);
    w.step([{ player: 0, kind: 'train', ids: [thor.id], type: 'nain' }]);
    expect(thor.queue.length).toBe(1);
    expect(w.busy(thor)).toBe(true);
    w.step([{ player: 0, kind: 'move', ids: [thor.id], x: 40 * FP, y: 30 * FP }]);
    run(w, 2);
    expect(thor.x).toBe(30 * FP);
    const foe = w.spawn('legionnaire', 1, 31 * FP, 30 * FP);
    w.step([{ player: 0, kind: 'attack', ids: [thor.id], x: foe.x, y: foe.y, target: foe.id }]);
    expect(thor.order).toBeNull();
    w.remove(foe);
    run(w, (DEFS.nain as UnitDef).buildTime + 2);
    expect(w.busy(thor)).toBe(false);
    w.step([{ player: 0, kind: 'move', ids: [thor.id], x: 40 * FP, y: 30 * FP }]);
    run(w, 2);
    expect(thor.x).toBeGreaterThan(30 * FP);
    const gaia = of(w, 0, 'gaia')[0];
    w.step([{ player: 0, kind: 'train', ids: [gaia.id], type: 'esprit' }]);
    expect(w.busy(gaia)).toBe(false);
    // Raising a building: busy till it is up.
    const site = w.site('fontaine', 0, 50, 50);
    thor.raising = site.id;
    expect(w.busy(thor)).toBe(true);
    site.buildLeft = 0;
    expect(w.busy(thor)).toBe(false);
  });
});

describe('a busy healer god and Gaïa on the move (Codex review, 2026-11-23)', () => {
  it('Isis summoning heals only within reach: she does not walk to a wounded ally, and her queue runs on', () => {
    noRegen();
    const w = createMatch(['dieux', 'humains']);
    const isis = Object.assign(w.spawn('isis', 0, 30 * FP, 30 * FP), { mana: 1 << 30 });
    w.enqueue(isis, 'sphinx');
    const left = isis.trainLeft;
    const hurt = w.spawn('nain', 0, 37 * FP, 30 * FP);
    hurt.hp = 10;
    run(w, 2);
    expect(isis.x).toBe(30 * FP);
    expect(hurt.hp).toBe(10);
    expect(isis.trainLeft).toBeLessThan(left);
    // Within reach, she still heals.
    hurt.x = 32 * FP;
    run(w, 2);
    expect(hurt.hp).toBeGreaterThan(10);
  });

  it('Gaïa summons an Esprit as she walks', () => {
    const w = createMatch(['dieux', 'humains']);
    w.players[0].minerals = 5000;
    const gaia = of(w, 0, 'gaia')[0];
    const esprits = of(w, 0, 'esprit').length;
    w.step([{ player: 0, kind: 'train', ids: [gaia.id], type: 'esprit' }]);
    const [x, y] = [gaia.x, gaia.y];
    for (let i = 0; i < ticks((DEFS.esprit as UnitDef).buildTime + 2); i++) {
      if (!gaia.goal && !gaia.order) w.step([{ player: 0, kind: 'move', ids: [gaia.id], x: x === gaia.x ? 60 * FP : x, y }]);
      else w.step([]);
    }
    expect(gaia.x !== x || gaia.y !== y).toBe(true);
    expect(of(w, 0, 'esprit').length).toBe(esprits + 1);
  });
});

describe('the Puits (balance designer, 2026-11-22)', () => {
  it('yields nothing empty, a quarter of its rate for each Esprit inside, up to 4', () => {
    const energyIn = (crew: number) => {
      const w = createMatch(['dieux', 'humains']);
      const puits = w.spawn('puitsdivin', 0, 40 * FP, 40 * FP);
      for (let i = 0; i < crew; i++) Object.assign(w.spawn('esprit', 0, 40 * FP, 40 * FP), { inside: puits.id });
      const before = w.players[0].energy;
      run(w, 40);
      return w.players[0].energy - before;
    };
    expect(energyIn(0)).toBe(0);
    const [two, four] = [energyIn(2), energyIn(4)];
    expect(Math.abs(four - 2 * two)).toBeLessThanOrEqual(2);
    expect(four).toBeGreaterThan(0);
  });

  it('pays the work done by the crew of each tick, not by the crew of the moment', () => {
    const w = createMatch(['dieux', 'humains']);
    const puits = w.spawn('puitsdivin', 0, 40 * FP, 40 * FP);
    const full = ticks(1 / (DEFS.puitsdivin as BuildingDef).energyRate!);
    const one = w.spawn('esprit', 0, 40 * FP, 40 * FP);
    one.inside = puits.id;
    const before = w.players[0].energy;
    // Alone, one Esprit does a quarter of the work: three quarters of an energy in three full periods.
    for (let i = 0; i < 3 * full; i++) w.step([]);
    one.inside = 0;
    run(w, 5);
    for (let i = 0; i < 4; i++) Object.assign(w.spawn('esprit', 0, 40 * FP, 40 * FP), { inside: puits.id });
    w.step([]);
    expect(w.players[0].energy - before).toBe(0);
  });

  it('counts no crew in a bunker that yields no energy', () => {
    const w = createMatch(['humains', 'dieux']);
    w.spawn('fortin', 0, 40 * FP, 40 * FP);
    const load = vi.spyOn(w, 'load');
    run(w, 1);
    expect(load).not.toHaveBeenCalled();
  });
});

describe('Apollon\'s Pluie de feu (balance designer, 2026-11-22)', () => {
  it('falls on an area, burns friend and foe, and buildings at a quarter, a third, a half by level', () => {
    const w = createMatch(['dieux', 'humains']);
    const apollon = Object.assign(w.spawn('apollon', 0, 30 * FP, 30 * FP), { mana: 1 << 30 });
    const friend = w.spawn('nain', 0, 34 * FP, 30 * FP);
    const store = w.spawn('grenier', 1, 35 * FP, 32 * FP);
    const [fh, sh] = [friend.hp, store.hp];
    w.step([{ player: 0, kind: 'ability', ids: [apollon.id], name: 'pluiedefeu', x: 34 * FP, y: 31 * FP }]);
    expect(friend.hp).toBeLessThan(fh);
    const toStore = sh - store.hp;
    expect(toStore).toBeGreaterThan(0);
    expect(toStore).toBeLessThan(ABILITIES.pluiedefeu.damage! / 2);
    // On bare ground too.
    apollon.spellCd = {};
    apollon.abilityCd = 0;
    const mana = apollon.mana;
    w.step([{ player: 0, kind: 'ability', ids: [apollon.id], name: 'pluiedefeu', x: 26 * FP, y: 26 * FP }]);
    expect(apollon.mana).toBeLessThan(mana);
  });
});

describe('the automatic Soin (balance designer, 2026-11-22)', () => {
  it('the Prêtresse heals 25 for 5 mana, by itself or not, never a machine; Isis 25 a second at her first level', () => {
    noRegen();
    const w = createMatch(['dieux', 'humains']);
    const pretresse = w.spawn('pretresse', 0, 30 * FP, 30 * FP);
    const nain = w.spawn('nain', 0, 32 * FP, 30 * FP);
    const sphinx = Object.assign(w.spawn('sphinx', 0, 30 * FP, 32 * FP), { statue: 0 });
    const golem = w.spawn('golem', 0, 28 * FP, 30 * FP);
    nain.hp = golem.hp = 10;
    // Switched off: nobody healed.
    w.step([{ player: 0, kind: 'ability', ids: [pretresse.id], name: 'autosoin' }]);
    expect(pretresse.autoOff).toBe(true);
    run(w, 3);
    expect(nain.hp).toBe(10);
    w.step([{ player: 0, kind: 'ability', ids: [pretresse.id], name: 'autosoin' }]);
    const mana = pretresse.mana;
    run(w, 3);
    expect(nain.hp).toBeGreaterThan(10);
    expect(golem.hp).toBe(10); // a machine
    expect(pretresse.mana).toBeLessThan(mana);
    expect(sphinx.hp).toBe(sphinx.maxHp);
    const isis = Object.assign(w.spawn('isis', 0, 50 * FP, 50 * FP), { mana: 1 << 30 });
    const hurt = w.spawn('nain', 0, 52 * FP, 50 * FP);
    hurt.hp = 10;
    run(w, 1.5);
    expect(hurt.hp).toBeGreaterThanOrEqual(10 + 25);
    expect(w.healPulse(isis)).toBe(25);
    isis.lvl = 3;
    expect(w.healPulse(isis)).toBe(35);
  });

  it('switched off, the Prêtresse drops the patient she was walking to and pays no more (Codex review, 2026-11-23)', () => {
    noRegen();
    const w = createMatch(['dieux', 'humains']);
    const pretresse = w.spawn('pretresse', 0, 30 * FP, 30 * FP);
    const nain = w.spawn('nain', 0, 37 * FP, 30 * FP);
    nain.held = 1 << 20; // stays where it is
    nain.hp = 10;
    run(w, 0.5);
    expect(pretresse.order?.kind).toBe('heal');
    w.step([{ player: 0, kind: 'ability', ids: [pretresse.id], name: 'autosoin' }]);
    expect(pretresse.order).toBeNull();
    const mana = pretresse.mana;
    run(w, 4);
    expect(nain.hp).toBe(10);
    expect(pretresse.mana).toBeGreaterThanOrEqual(mana);
  });

  it('one rule for every Soin: no machine healed by Soins divins nor the Fontaine, a Sphinx turned to stone dropped', () => {
    const w = createMatch(['dieux', 'humains']);
    const isis = Object.assign(w.spawn('isis', 0, 30 * FP, 30 * FP), { mana: 1 << 30 });
    const golem = w.spawn('golem', 0, 32 * FP, 30 * FP);
    const nain = w.spawn('nain', 0, 30 * FP, 32 * FP);
    golem.hp = nain.hp = 10;
    w.step([{ player: 0, kind: 'ability', ids: [isis.id], name: 'soinsdivins' }]);
    expect(nain.hp).toBeGreaterThan(10);
    expect(golem.hp).toBe(10);
    w.spawn('fontaine', 0, 60 * FP, 60 * FP);
    const g2 = w.spawn('golem', 0, 61 * FP, 60 * FP);
    g2.hp = 10;
    run(w, 3);
    expect(g2.hp).toBe(10);
    // A Prêtresse healing a Sphinx that turns to stone stops.
    const pretresse = w.spawn('pretresse', 0, 80 * FP, 80 * FP);
    const sphinx = Object.assign(w.spawn('sphinx', 0, 81 * FP, 80 * FP), { mana: 1 << 30 });
    sphinx.hp = 10;
    w.setOrder(pretresse, { kind: 'heal', target: sphinx.id });
    w.step([]);
    expect(pretresse.order?.kind).toBe('heal');
    sphinx.statue = ticks(15); // Forme de statue
    const mana = pretresse.mana;
    run(w, 2);
    expect(pretresse.order?.kind).not.toBe('heal');
    expect(pretresse.mana).toBeGreaterThanOrEqual(mana); // its stone mends it, not her
  });
});
