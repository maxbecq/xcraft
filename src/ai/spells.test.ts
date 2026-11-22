import { describe, expect, it } from 'vitest';
import type { Faction } from '../data';
import { FP, ticks, toFp } from '../sim/fixed';
import { createMatch } from '../sim/setup';
import type { Command, Entity, World } from '../sim/world';
import { AI } from './ai';

// One scenario per spell the AI-against-AI games never showed: research done, caster ready, target there. Each
// test fails if the AI would never give the order (a condition that can never hold).

/** A match with the players' starting units gone (their buildings stay), the AI for player 0. */
function arena(factions: [Faction, Faction]): { w: World; ai: AI; at: (type: string, owner: number, dx: number, dy: number) => Entity } {
  const w = createMatch(factions);
  for (const e of [...w.entities.values()]) if (e.owner >= 0 && e.def.kind === 'unit') w.entities.delete(e.id);
  for (const p of w.players) [p.minerals, p.energy] = [0, 0];
  const [cx, cy] = [(w.map.width * FP) / 2, (w.map.height * FP) / 2];
  // Casters full of their own energy (fiches 2010): the scenes test the AI's choices, not the energy.
  const at = (type: string, owner: number, dx: number, dy: number) => Object.assign(w.spawn(type, owner, cx + dx * FP, cy + dy * FP), { mana: 1 << 30 });
  return { w, ai: new AI(w, 0), at };
}

/** The AI's orders over a few seconds, the world stepping with them. */
function orders(w: World, ai: AI, seconds = 3, also: () => Command[] = () => []): Command[] {
  const out: Command[] = [];
  const end = w.tick + ticks(seconds);
  while (w.tick < end) {
    const cmds = ai.think();
    out.push(...cmds);
    w.step([...cmds, ...also()]);
  }
  return out;
}

const cast = (cmds: Command[], name: string) => cmds.some((c) => c.kind === 'ability' && c.name === name);

/** Enemy units standing still, not fighting back (held), so the scene holds. */
const crowd = (at: (type: string, owner: number, dx: number, dy: number) => Entity, type: string, n: number, dx: number, dy: number) =>
  Array.from({ length: n }, (_, i) => {
    const e = at(type, 1, dx + (i % 3) * 0.8, dy + Math.floor(i / 3) * 0.8);
    e.held = ticks(60);
    return e;
  });

describe('AI spells, each in a scene made for it', () => {
  it('no Cocktail from a Scarabée at a crowd just out of its reach (no order refused over and over)', () => {
    const { w, ai, at } = arena(['humains', 'humains']);
    w.players[0].upgrades.cocktail = 1;
    const scar = at('scarabee', 0, 0, 0);
    const a = at('alchimiste', 0, 0, 2);
    a.inside = scar.id;
    // From a Scarabée the Cocktail reaches 8 tiles plus its radius (0.8): three foes 8.9 off, within the old tile of
    // margin but out of the command's reach.
    for (const dy of [-0.5, 0, 0.5]) at('auxiliaire', 1, 8.9, dy).held = ticks(60);
    expect(orders(w, ai).some((c) => c.kind === 'ability' && c.name === 'explosiftoxique')).toBe(false);
  });

  it('Cocktail from an Alchimiste inside a Fortin (notice)', () => {
    const { w, ai, at } = arena(['humains', 'humains']);
    w.players[0].upgrades.cocktail = 1;
    const fort = at('fortin', 0, 0, 0);
    const a = at('alchimiste', 0, 0, 2);
    a.inside = fort.id;
    crowd(at, 'auxiliaire', 4, 5, 0);
    const cmds = orders(w, ai);
    expect(cmds.some((c) => c.kind === 'ability' && c.name === 'explosiftoxique' && c.ids.includes(a.id))).toBe(true);
  });

  it('Charge de napalm on an enemy vehicle', () => {
    const { w, ai, at } = arena(['humains', 'humains']);
    w.players[0].upgrades.chargenapalm = 1;
    at('phalangiste', 0, 0, 0);
    crowd(at, 'pegase', 1, 4, 0);
    expect(cast(orders(w, ai), 'napalm')).toBe(true);
  });

  it('Acide dissolvant on an enemy building', () => {
    const { w, ai, at } = arena(['humains', 'humains']);
    w.players[0].upgrades.acide = 1;
    at('cuve', 0, 0, 0);
    at('grenier', 1, 4, 0);
    crowd(at, 'auxiliaire', 1, 8, 6);
    expect(cast(orders(w, ai), 'acidedissolvant')).toBe(true);
  });

  it('Explosion suicidaire in the thick of the enemy', () => {
    const { w, ai, at } = arena(['humains', 'humains']);
    at('cuve', 0, 0, 0);
    crowd(at, 'auxiliaire', 6, 0.8, -0.8);
    expect(cast(orders(w, ai), 'explosioncuve')).toBe(true);
  });

  it('Gaz euphorisants on our soldiers in a fight', () => {
    const { w, ai, at } = arena(['humains', 'humains']);
    at('cuve', 0, -2, 0);
    const ours = [0, 1, 2, 3, 4].map((i) => at('legionnaire', 0, 0, i * 0.6 - 1.2));
    const foes = crowd(at, 'auxiliaire', 5, 3, -1);
    // Our légionnaires go for them: they are then engaged.
    const go = (): Command[] => ours.filter((u) => u.hp > 0 && !u.order).map((u) => ({ player: 0, kind: 'attack', ids: [u.id], x: foes[0].x, y: foes[0].y, target: foes[0].id }));
    expect(cast(orders(w, ai, 4, go), 'gazeuphorisants')).toBe(true);
  });

  it('Festin on a corpse when hurt', () => {
    const { w, ai, at } = arena(['humains', 'humains']);
    w.players[0].upgrades.dressageallosaures = 1;
    const allo = at('allosaure', 0, 0, 0);
    allo.hp = Math.floor(allo.maxHp / 2);
    crowd(at, 'auxiliaire', 1, 5, 0);
    w.corpses.push({ x: allo.x + FP, y: allo.y, tick: w.tick, owner: 1, type: 'auxiliaire' });
    expect(cast(orders(w, ai, 2), 'festin')).toBe(true);
  });

  it('Pégase mines when enemy walkers come close', () => {
    const { w, ai, at } = arena(['humains', 'humains']);
    at('pegase', 0, 0, 0);
    crowd(at, 'auxiliaire', 3, 3, 0);
    expect(cast(orders(w, ai), 'posermine')).toBe(true);
  });

  it('Canon orbital on a crowd an Espion of ours watches', () => {
    const { w, ai, at } = arena(['isdaris', 'humains']);
    w.players[0].energy = 1000;
    at('trone', 0, -20, -20).exts.push('relais');
    at('espion', 0, 0, 0);
    crowd(at, 'auxiliaire', 6, 3, 0);
    expect(cast(orders(w, ai), 'canonorbital')).toBe(true);
  });

  it('Porte de déphasage on a group losing far from home, then the group home', () => {
    const { w, ai, at } = arena(['isdaris', 'humains']);
    w.players[0].energy = 1000;
    at('trone', 0, -20, -20).exts.push('porte');
    const group = [0, 1, 2, 3].map((i) => at('archer', 0, i * 0.7, 0));
    group.forEach((u) => ([u.hp, u.shield] = [20, 0]));
    crowd(at, 'legionnaire', 9, 2, 2);
    (ai as unknown as { wave: Set<number> }).wave = new Set(group.map((u) => u.id));
    // The Obélisque's Rappel, which comes first, recharging.
    for (const b of w.entities.values()) if (b.owner === 0 && b.type === 'obelisque') b.abilityCd = ticks(60);
    const cmds = orders(w, ai, 4);
    expect(cast(cmds, 'portedephasage')).toBe(true);
    expect(cast(cmds, 'transfertgroupe')).toBe(true);
  });

  /** A Z socle with the Accumulateur. */
  const accumulateur = (at: (type: string, owner: number, dx: number, dy: number) => Entity) => {
    const s = at('quadripode', 0, 0, 0);
    s.kit = 'accumulateur';
    return s;
  };

  it('Gel électronique on an enemy building that shoots', () => {
    const { w, ai, at } = arena(['z', 'humains']);
    accumulateur(at);
    at('tour', 1, 4, 0);
    crowd(at, 'auxiliaire', 1, 8, 6);
    expect(cast(orders(w, ai), 'gel')).toBe(true);
  });

  it('Cône de protection with five of ours under fire', () => {
    const { w, ai, at } = arena(['z', 'humains']);
    accumulateur(at);
    const ours = [1, 2, 3, 4, 5].map((i) => at('dronecombat', 0, (i % 3) * 0.7 - 0.7, Math.floor(i / 3) * 0.7 + 0.7));
    crowd(at, 'auxiliaire', 3, 5, 0);
    const hit = () => {
      for (const u of ours) u.lastHit = w.tick;
      return [];
    };
    expect(cast(orders(w, ai, 3, hit), 'cone')).toBe(true);
  });

  it('Gravité alourdie on six enemies or more close by', () => {
    const { w, ai, at } = arena(['z', 'humains']);
    accumulateur(at);
    crowd(at, 'auxiliaire', 6, 3, 0);
    expect(cast(orders(w, ai), 'gravite')).toBe(true);
  });

  it('Hadès keeps the mana of his Voyage: no Rayon de la mort that would leave him without it', () => {
    const scene = (mana: number) => {
      const { w, ai, at } = arena(['dieux', 'humains']);
      const hades = at('hades', 0, 0, 0);
      hades.lvl = 3; // 200 mana at most: room for the Rayon (140) and the Voyage (40)
      hades.mana = toFp(mana);
      crowd(at, 'auxiliaire', 6, 3, 0);
      // Two seconds: 2 mana more at most.
      return cast(orders(w, ai, 2), 'rayonmort');
    };
    expect(scene(150)).toBe(false);
    expect(scene(190)).toBe(true);
  });

  it('Fusion of two Élémentaires waiting at home, late on', () => {
    const { w, ai, at } = arena(['dieux', 'humains']);
    while (w.tick < ticks(15 * 60)) w.tick++;
    // A side with income ahead (no worker and an empty bank: its last units leave on a last wave).
    w.players[0].minerals = 1000;
    at('elementaire', 0, 0, 0);
    at('elementaire', 0, 1, 0);
    expect(cast(orders(w, ai), 'fusion')).toBe(true);
  });
});
