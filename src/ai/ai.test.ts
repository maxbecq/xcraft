import { describe, expect, it } from 'vitest';
import { FP, ticks } from '../sim/fixed';
import { createMatch } from '../sim/setup';
import type { Command, Entity, World } from '../sim/world';
import { AI, DIFFICULTY, teamFocus } from './ai';

/** Plays until someone wins or the time runs out; returns the winner and the game time in minutes. */
function play(world: World, ais: AI[], minutes: number): { winner: number | null; minutes: number } {
  const limit = ticks(minutes * 60);
  while (world.winner === null && world.tick < limit) world.step(ais.flatMap((ai) => ai.think()));
  return { winner: world.winner, minutes: Math.round((world.tick / ticks(60)) * 10) / 10 };
}

describe('AI', () => {
  it('never orders a building where its workers cannot get (L\'Anneau: low ground at the foot of the main\'s cliff)', () => {
    const w = createMatch(['humains', 'isdaris'], undefined, 'l-anneau');
    w.players.forEach((p) => (p.handicap = 130));
    const ais = [new AI(w, 0, undefined, 'hard'), new AI(w, 1, undefined, 'hard')];
    let failed = 0;
    while (w.winner === null && w.tick < ticks(14 * 60)) {
      w.step(ais.flatMap((ai) => ai.think()));
      failed += w.events.filter((e) => e.text === 'Emplacement inaccessible.').length;
    }
    expect(failed).toBe(0);
  }, 60_000);

  it('spreads its attacks in a four-player free-for-all: two opponents never pick the same first target', () => {
    // Carrefour: four corners, each at the same distance from its two neighbours.
    const w = createMatch(['humains', 'humains', 'humains', 'humains'], undefined, 'carrefour');
    const ais = [0, 1, 2, 3].map((i) => new AI(w, i));
    const focus = teamFocus(w);
    while (focus.size < 4 && w.tick < ticks(15 * 60)) w.step(ais.flatMap((ai) => ai.think()));
    const victims = [...focus.values()].map((id) => w.entities.get(id)!.owner);
    expect(victims).toHaveLength(4);
    expect(new Set(victims).size, `targets ${victims}`).toBe(4);
  }, 60_000);

  it('beats an idle opponent', () => {
    const w = createMatch();
    const r = play(w, [new AI(w, 1)], 20);
    expect(r.winner).toBe(1);
  }, 60_000);

  it('wins more often with a better difficulty, from either side', () => {
    for (const [weak, strong] of [['easy', 'normal'], ['normal', 'hard']]) {
      for (const side of [0, 1]) {
        const w = createMatch();
        w.players[side].handicap = DIFFICULTY[strong];
        w.players[1 - side].handicap = DIFFICULTY[weak];
        expect(play(w, [new AI(w, 0), new AI(w, 1)], 35).winner).toBe(side);
      }
    }
  }, 60_000);

  it('scans only where an undetected invisible unit hits, not at shooters out of sight', () => {
    const w = createMatch(['humains', 'isdaris']);
    const ai = new AI(w, 0);
    w.spawn('forge', 0, 20 * FP, 22 * FP);
    w.players[0].energy = 200;
    w.players[0].upgrades.observation = 1; // the telescope is a research: without it the order is refused
    const serf = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'serf')!;
    const scansAfter = (attacker: Entity) => {
      while (w.tick % 10 !== 0 || w.tick < 4) w.step([]);
      serf.lastHit = w.tick;
      serf.lastAttacker = attacker.id;
      return ai.think().filter((c) => c.kind === 'ability');
    };
    const sniper = w.spawn('druide', 1, serf.x + 7 * FP, serf.y + 7 * FP); // visible or not, it is no invisible unit
    expect(scansAfter(sniper)).toHaveLength(0);
    const sin = w.spawn('assassin', 1, serf.x + FP, serf.y);
    expect(scansAfter(sin)).toEqual([expect.objectContaining({ x: serf.x, y: serf.y })]);
    sin.x += 6 * FP; // an assassin far from the victim: not the culprit
    expect(scansAfter(sin)).toHaveLength(0);
  }, 60_000);

  it('defends its base against a raid, its wave included, and pulls workers when it has no army', () => {
    const w = createMatch();
    const ai = new AI(w, 0);
    play(w, [ai], 6);
    // The idle opponent may be dead by now: keep it in the game with a building out of the way.
    w.winner = null;
    w.spawn('grenier', 1, 90 * FP, 4 * FP);
    const council = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'conseil')!;
    const army = () => [...w.entities.values()].filter((e) => e.owner === 0 && e.def.kind === 'unit' && !(e.def as { worker?: boolean }).worker);
    expect(army().length).toBeGreaterThan(3);
    // Everyone away, as if a wave had left: a raid on the council must bring them back.
    w.step([{ player: 0, kind: 'smart', ids: army().map((u) => u.id), x: 80 * FP, y: 80 * FP }]);
    (ai as unknown as { wave: Set<number> }).wave = new Set(army().map((u) => u.id));
    const raid = [0, 1, 2, 3, 4, 5].map((i) => w.spawn('legionnaire', 1, council.x + (4 + (i % 3)) * FP, council.y + (4 + Math.floor(i / 3)) * FP));
    const step = () => w.step([...ai.think(), ...raid.filter((r) => !r.order && r.hp > 0).map((r) => ({ player: 1, kind: 'attack' as const, ids: [r.id], x: council.x, y: council.y, target: council.id }))]);
    for (let i = 0; i < ticks(60) && raid.some((r) => r.hp > 0); i++) step();
    expect(raid.every((r) => r.hp <= 0)).toBe(true);
    expect(council.hp).toBeGreaterThan(0);

    // No army at all: the serfs fight two raiders.
    const w2 = createMatch();
    const ai2 = new AI(w2, 0);
    const hq = [...w2.entities.values()].find((e) => e.owner === 0 && e.type === 'conseil')!;
    const two = [0, 1].map((i) => w2.spawn('auxiliaire', 1, hq.x + (5 + i) * FP, hq.y + 5 * FP));
    for (let i = 0; i < ticks(40) && two.some((r) => r.hp > 0); i++) {
      w2.step([...ai2.think(), ...two.filter((r) => !r.order && r.hp > 0).map((r) => ({ player: 1, kind: 'attack' as const, ids: [r.id], x: hq.x, y: hq.y, target: hq.id }))]);
    }
    expect(two.every((r) => r.hp <= 0)).toBe(true);
  }, 60_000);

  it('pulls a wave group back from a fight it cannot win, not from one it can', () => {
    const w = createMatch();
    const ai = new AI(w, 0);
    const wave = [0, 1, 2, 3].map((i) => w.spawn('auxiliaire', 0, (48 + i) * FP, 48 * FP));
    (ai as unknown as { wave: Set<number> }).wave = new Set(wave.map((u) => u.id));
    const retreat = () => {
      do w.step([]);
      while (w.tick % 10 !== 0);
      return ai.think().find((c) => c.kind === 'smart' && c.ids.includes(wave[0].id));
    };
    w.spawn('auxiliaire', 1, 48 * FP, 54 * FP);
    expect(retreat()).toBeUndefined();
    for (let i = 0; i < 10; i++) w.spawn('legionnaire', 1, (46 + (i % 5)) * FP, (54 + Math.floor(i / 5)) * FP);
    expect(retreat()).toBeDefined();
  }, 60_000);

  it('Isdaris fall back into the recharge zone of a Réserve psy', () => {
    const w = createMatch(['humains', 'isdaris']);
    const ais = [new AI(w, 0), new AI(w, 1)];
    play(w, ais, 8);
    const ai = ais[1] as unknown as { wave: Set<number> };
    // No Human army raiding the Isdaris base, or the group would go and defend it instead.
    for (const e of [...w.entities.values()]) if (e.owner === 0 && e.def.kind === 'unit' && !e.def.worker) w.entities.delete(e.id);
    // A small group facing a big army far away runs back to a Réserve psy.
    const group = [0, 1, 2].map((i) => w.spawn('archer', 1, (40 + i) * FP, 48 * FP));
    for (let i = 0; i < 12; i++) w.spawn('legionnaire', 0, (38 + (i % 6)) * FP, (52 + Math.floor(i / 6)) * FP);
    ai.wave = new Set(group.map((u) => u.id));
    let order: { x: number; y: number } | undefined;
    for (let i = 0; i < 40 && !order; i++) {
      w.step([]);
      const c = ais[1].think().find((c) => c.kind === 'smart' && c.ids.includes(group[0].id));
      if (c?.kind === 'smart') order = c;
    }
    const reserves = [...w.entities.values()].filter((e) => e.owner === 1 && e.type === 'reservepsy');
    expect(reserves.some((r) => order && r.x === order.x && r.y === order.y)).toBe(true);
  }, 60_000);

  it('finishes an AI-versus-AI game', () => {
    const w = createMatch();
    // A strict mirror can mine the map out even and end in a draw: one side gathers a little less.
    w.players[1].handicap = 95;
    const r = play(w, [new AI(w, 0), new AI(w, 1)], 45); // the mirror match ends near minute 40
    console.log('AI vs AI:', r, 'units', [...w.entities.values()].filter((e) => e.def.kind === 'unit').length);
    expect(r.winner).not.toBeNull();
  }, 60_000);
  it('Z: trains socles while saving for its tech, before the tech can even be built', () => {
    // From minute 6 the Z AI keeps the energy of its Intelligence suprême; it used to keep it before the Centre
    // d'armement and the Centre de recherche it needs stood, and a socle that costs no energy waited for those 400
    // energy too: the Z army never grew past 5 to 8 units (measure of the 0.9.48).
    const w = createMatch(['z', 'humains']);
    const pod = w.spawn('pod', 0, 20 * FP, 30 * FP);
    const plat = w.spawn('plateforme', 0, 22 * FP, 30 * FP);
    plat.host = pod.id;
    w.tick = ticks(7 * 60);
    w.players[0].minerals = 600;
    w.players[0].energy = 100;
    const ai = new AI(w, 0);
    let trained = false;
    for (let i = 0; i < 40 && !trained; i++) {
      const cmds = ai.think();
      trained = cmds.some((c) => c.kind === 'train' && c.ids.includes(plat.id));
      w.step(cmds);
    }
    expect(w.lacks(0, 'supreme')).not.toBe('');
    expect(trained).toBe(true);
  });
  it('Z: raises an add-on on a Pod with room, never retrying a Pod that has none or is full', () => {
    const w = createMatch(['z', 'humains']);
    const [ic] = [...w.entities.values()].filter((e) => e.owner === 0 && e.type === 'intelligence');
    const boxed = w.spawn('pod', 0, ic.x + 10 * FP, ic.y);
    const full = w.spawn('pod', 0, ic.x + 4 * FP, ic.y - 10 * FP);
    for (let i = 0; i < 3; i++) w.spawn('tourelle', 0, (50 + 4 * i) * FP, 50 * FP).host = full.id;
    const open = w.spawn('pod', 0, ic.x + 4 * FP, ic.y + 10 * FP);
    for (let i = 0; i < ticks(30); i++) w.step([]); // creep
    // Wall the first Pod in: towers of its own on every side left free.
    for (let spot; (spot = w.addonSpot(boxed, 'tourelle') ?? w.addonSpot(boxed, 'plateforme')); ) w.spawn('tourelle', 0, (spot[0] + 1) * FP, (spot[1] + 1) * FP);
    expect(w.addonSpot(boxed, 'plateforme')).toBeUndefined();
    w.players[0].minerals = 3000;
    w.players[0].energy = 1000;
    const ai = new AI(w, 0);
    const hosts: number[] = [];
    for (let i = 0; i < 40; i++) {
      const cmds = ai.think();
      for (const c of cmds) if (c.kind === 'train' && c.type && ['plateforme', 'tourelle'].includes(c.type)) hosts.push(...c.ids);
      w.step(cmds);
    }
    expect(hosts.length).toBeGreaterThan(0);
    expect(hosts.every((id) => id === open.id)).toBe(true);
  });
});

describe('AI Z Refuge', () => {
  it('shelters its drones from a raid it cannot hold off, and lets them out once it is gone', () => {
    const w = createMatch(['z', 'humains']);
    const ai = new AI(w, 0);
    const [ic] = [...w.entities.values()].filter((e) => e.owner === 0 && e.type === 'intelligence');
    const foes = [0, 1, 2, 3, 4, 5].map((i) => w.spawn('legionnaire', 1, ic.x + 5 * FP, ic.y + (i - 3) * FP));
    let cmds: Command[] = [];
    for (let i = 0; i < ticks(3) && !cmds.some((c) => c.kind === 'ability' && c.name === 'refuge'); i++) {
      cmds = ai.think();
      w.step(cmds);
    }
    expect(cmds).toContainEqual(expect.objectContaining({ kind: 'ability', name: 'refuge', ids: [ic.id] }));
    for (const f of foes) w.remove(f);
    let out = false;
    for (let i = 0; i < ticks(5) && !out; i++) {
      cmds = ai.think();
      out = cmds.some((c) => c.kind === 'unload');
      w.step(cmds);
    }
    expect(out).toBe(true);
  });

  it('Z: the drones in an Assimilateur no longer count as miners, and are replaced', () => {
    const w = createMatch(['z', 'humains']);
    const ai = new AI(w, 0);
    const [ic] = [...w.entities.values()].filter((e) => e.owner === 0 && e.type === 'intelligence');
    const drones = [...w.entities.values()].filter((e) => e.owner === 0 && e.type === 'drone');
    for (let i = drones.length; i < 16; i++) drones.push(w.spawn('drone', 0, ic.x, ic.y + 4 * FP));
    const assim = w.spawn('assimilateur', 0, ic.x + 8 * FP, ic.y);
    for (let i = 0; i < 3; i++) w.spawn('pod', 0, ic.x - 8 * FP, ic.y + (i * 4 - 4) * FP);
    for (const d of drones.slice(0, 3)) d.inside = assim.id;
    w.players[0].minerals = 1000;
    const cmds = ai.think();
    expect(cmds).toContainEqual(expect.objectContaining({ kind: 'train', ids: [ic.id], type: 'drone' }));
  });

  it('sends a worker stuck on its way to a field to another one', () => {
    const w = createMatch(['dieux', 'humains']);
    const ai = new AI(w, 0);
    // Nobody gets anywhere: a worker on its way to a field stays where it is.
    w.goNear = () => {};
    const esprit = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'esprit')!;
    const field = [...w.entities.values()].find((e) => e.type === 'minerai')!;
    w.step([{ player: 0, kind: 'smart', ids: [esprit.id], x: field.x, y: field.y, target: field.id }]);
    let sent: Command | undefined;
    for (let i = 0; i < ticks(8) && !sent; i++) {
      const cmds = ai.think();
      sent = cmds.find((c) => c.kind === 'smart' && c.ids.includes(esprit.id));
      w.step(cmds);
    }
    expect(sent).toBeDefined();
    expect(w.tick).toBeGreaterThanOrEqual(ticks(5));
    expect((sent as Extract<Command, { kind: 'smart' }>).target).not.toBe(field.id);
  });

  it('a worker waiting by a busy field stays, and a stuck one never looks far for another', () => {
    const w = createMatch(['dieux', 'humains']);
    const ai = new AI(w, 0);
    const esprit = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'esprit')!;
    const fields = [...w.entities.values()].filter((e) => e.type === 'minerai');
    const field = fields.sort((a, b) => Math.hypot(a.x - esprit.x, a.y - esprit.y) - Math.hypot(b.x - esprit.x, b.y - esprit.y))[0];
    // Next to the field, waiting: it is someone else's.
    w.goNear = () => {};
    [esprit.x, esprit.y] = [field.tx * FP - FP / 2, field.y];
    esprit.order = { kind: 'gather', target: field.id, phase: 'go', timer: 0 };
    field.miner = -1;
    for (let i = 0; i < ticks(8); i++) {
      esprit.order = { kind: 'gather', target: field.id, phase: 'go', timer: 0 };
      const cmds = ai.think();
      expect(cmds.some((c) => c.kind === 'smart' && c.ids.includes(esprit.id))).toBe(false);
      w.tick++;
    }
    // Far from any field, stuck: nothing within 12 tiles, it is not sent across the map.
    [esprit.x, esprit.y] = [(w.map.width * FP) / 2, (w.map.height * FP) / 2];
    for (let i = 0; i < ticks(8); i++) {
      esprit.order = { kind: 'gather', target: field.id, phase: 'go', timer: 0 };
      const cmds = ai.think();
      for (const c of cmds) if (c.kind === 'smart' && c.ids.includes(esprit.id)) {
        const t = w.entities.get(c.target!)!;
        expect(Math.hypot(t.x - esprit.x, t.y - esprit.y)).toBeLessThan(12 * FP);
      }
      w.tick++;
    }
  });

  it('a worker stuck again never goes back to a field it got stuck on', () => {
    const w = createMatch(['dieux', 'humains']);
    const ai = new AI(w, 0);
    w.goNear = () => {};
    const esprit = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'esprit')!;
    const field = [...w.entities.values()].find((e) => e.type === 'minerai')!;
    w.step([{ player: 0, kind: 'smart', ids: [esprit.id], x: field.x, y: field.y, target: field.id }]);
    const tried = [field.id];
    for (let i = 0; i < ticks(20); i++) {
      const cmds = ai.think();
      const sent = cmds.find((c) => c.kind === 'smart' && c.ids.includes(esprit.id));
      if (sent?.kind === 'smart') {
        expect(tried).not.toContain(sent.target);
        tried.push(sent.target!);
      }
      w.step(cmds);
    }
    expect(tried.length).toBeGreaterThanOrEqual(3);
  });

  it('down to a few workers, keeps the price of the next one from its buildings', () => {
    const w = createMatch(['dieux', 'humains']);
    for (const e of [...w.entities.values()]) if (e.owner === 0 && e.type === 'esprit') w.entities.delete(e.id);
    const asgaard = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'asgaard')!;
    w.spawn('esprit', 0, asgaard.x, asgaard.y + 5 * FP);
    // Thor out: the Porte and a god, a Puits divin is due.
    w.spawn('thor', 0, asgaard.x + 5 * FP, asgaard.y);
    // A Branche is wanted (200): with 220, it took everything, and no esprit came.
    w.players[0].minerals = 220;
    const cmds = new AI(w, 0).think();
    expect(cmds).toContainEqual(expect.objectContaining({ kind: 'train', type: 'esprit' }));
  });

  it('keeps no worker price when no worker can come: a full supply raises its Branche', () => {
    const w = createMatch(['dieux', 'humains']);
    for (const e of [...w.entities.values()]) if (e.owner === 0 && e.type === 'esprit') w.entities.delete(e.id);
    const asgaard = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'asgaard')!;
    w.spawn('esprit', 0, asgaard.x, asgaard.y + 5 * FP);
    // Nains up to the supply cap: no esprit can be trained before a Branche.
    while (w.supply(0).used < w.supply(0).max) w.spawn('nain', 0, asgaard.x + 6 * FP, asgaard.y);
    w.players[0].minerals = 220;
    const cmds = new AI(w, 0).think();
    expect(cmds).toContainEqual(expect.objectContaining({ kind: 'build', type: 'branche' }));
  });

  it('Z: keeps no drone price while its Intelligence waits to turn into the suprême', () => {
    const w = createMatch(['z', 'humains']);
    const [ic] = [...w.entities.values()].filter((e) => e.owner === 0 && e.type === 'intelligence');
    for (const e of [...w.entities.values()]) if (e.owner === 0 && e.type === 'drone') w.entities.delete(e.id);
    w.spawn('drone', 0, ic.x, ic.y + 4 * FP);
    // Both busy researching: the minerals go to nothing else.
    for (const [t, dx, up] of [['armement', -9, 'laser'], ['centrerecherche', 9, 'rquadripode']] as const) w.spawn(t, 0, ic.x + dx * FP, ic.y + 6 * FP).queue.push(up);
    while (w.tick < ticks(7 * 60)) w.tick++;
    w.players[0].minerals = 310;
    w.players[0].energy = 500;
    const cmds = new AI(w, 0).think();
    expect(cmds).toContainEqual(expect.objectContaining({ kind: 'train', ids: [ic.id], type: 'supreme' }));
  });

  it("a reinforcement joins the wave out: no new wave, the front not sent back to the shared road's middle", () => {
    // L'Anneau: two roads round the chasm, a new wave goes by the middle of one.
    const w = createMatch(['humains', 'humains'], undefined, 'l-anneau');
    for (const e of [...w.entities.values()]) if (e.owner === 1 && e.def.kind === 'unit') w.entities.delete(e.id);
    while (w.tick < ticks(10 * 60) || w.tick % 10) w.tick++; // the AI thinks every 10 ticks
    const ai = new AI(w, 0);
    const state = ai as unknown as { waves: number; wave: Set<number>; via: unknown };
    const theirs = [...w.entities.values()].find((e) => e.owner === 1 && e.type === 'conseil')!;
    const front = [0, 1, 2, 3].map((i) => w.spawn('legionnaire', 0, theirs.x + (i - 2) * FP, theirs.y + 8 * FP));
    front.forEach((u) => state.wave.add(u.id));
    state.waves = 1;
    const hq = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'conseil')!;
    const late = w.spawn('legionnaire', 0, hq.x, hq.y + 5 * FP);
    ai.think();
    expect(state.wave.has(late.id)).toBe(true);
    expect(state.via).toBe(null);
    // A reinforcement, not a new wave: the next wave is no bigger for it.
    expect(state.waves).toBe(1);
  });

  it('easy: reinforcements never take the wave out past its cap', () => {
    const w = createMatch(['humains', 'humains']);
    for (const e of [...w.entities.values()]) if (e.owner === 1 && e.def.kind === 'unit') w.entities.delete(e.id);
    while (w.tick < ticks(12 * 60) || w.tick % 10) w.tick++;
    const ai = new AI(w, 0, undefined, 'easy');
    const state = ai as unknown as { waves: number; wave: Set<number> };
    const hq = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'conseil')!;
    const theirs = [...w.entities.values()].find((e) => e.owner === 1 && e.type === 'conseil')!;
    for (let i = 0; i < 5; i++) state.wave.add(w.spawn('legionnaire', 0, theirs.x + (i - 2) * FP, theirs.y + 8 * FP).id);
    state.waves = 1;
    for (let i = 0; i < 6; i++) w.spawn('legionnaire', 0, hq.x + (i - 3) * FP, hq.y + 5 * FP);
    ai.think();
    expect(state.wave.size).toBeLessThanOrEqual(6);
  });

  it('easy: the wave cap counts the gods', () => {
    const w = createMatch(['dieux', 'humains']);
    for (const e of [...w.entities.values()]) if (e.owner === 1 && e.def.kind === 'unit') w.entities.delete(e.id);
    while (w.tick < ticks(12 * 60) || w.tick % 10) w.tick++;
    const ai = new AI(w, 0, undefined, 'easy');
    const state = ai as unknown as { waves: number; wave: Set<number> };
    const asgaard = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'asgaard')!;
    // Second-rank gods, whole: they go with a wave.
    for (const [i, g] of ['odin', 'athena'].entries()) w.spawn(g, 0, asgaard.x + (i * 2 - 1) * 3 * FP, asgaard.y + 6 * FP);
    for (let i = 0; i < 6; i++) w.spawn('nain', 0, asgaard.x + (i - 3) * FP, asgaard.y + 5 * FP);
    ai.think();
    expect(state.wave.size).toBe(6);
  });

  it('with the enemy army gone and no wave out, one soldier alone stays home', () => {
    const w = createMatch(['humains', 'humains']);
    for (const e of [...w.entities.values()]) if (e.owner === 1 && e.def.kind === 'unit') w.entities.delete(e.id);
    while (w.tick < ticks(10 * 60) || w.tick % 10) w.tick++;
    const ai = new AI(w, 0);
    (ai as unknown as { waves: number }).waves = 3;
    const hq = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'conseil')!;
    const lone = w.spawn('legionnaire', 0, hq.x, hq.y + 5 * FP);
    for (let i = 0; i < ticks(2); i++) {
      const cmds = ai.think();
      expect(cmds.some((c) => c.kind === 'attack' && c.ids.includes(lone.id))).toBe(false);
      w.step(cmds);
    }
  });

  it('with the enemy army gone, a few soldiers at home go and raze its last buildings', () => {
    const w = createMatch(['humains', 'humains']);
    for (const e of [...w.entities.values()]) if (e.owner === 1 && e.def.kind === 'unit') w.entities.delete(e.id);
    while (w.tick < ticks(10 * 60)) w.tick++;
    const ai = new AI(w, 0);
    (ai as unknown as { waves: number }).waves = 3;
    const hq = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'conseil')!;
    const few = [0, 1, 2, 3].map((i) => w.spawn('legionnaire', 0, hq.x + (i - 2) * FP, hq.y + 5 * FP));
    let sent = false;
    for (let i = 0; i < ticks(2) && !sent; i++) {
      const cmds = ai.think();
      sent = cmds.some((c) => c.kind === 'attack' && few.some((u) => c.ids.includes(u.id)));
      w.step(cmds);
    }
    expect(sent).toBe(true);
  });

  it('never sends soldiers to man the Intelligence as a Fortin', () => {
    const w = createMatch(['z', 'humains']);
    const ai = new AI(w, 0);
    const [ic] = [...w.entities.values()].filter((e) => e.owner === 0 && e.type === 'intelligence');
    w.spawn('auxiliaire', 0, ic.x + 5 * FP, ic.y);
    for (let i = 0; i < ticks(3); i++) {
      const cmds = ai.think();
      expect(cmds.some((c) => c.kind === 'smart' && c.target === ic.id)).toBe(false);
      w.step(cmds);
    }
  });
});

describe('AI resignation', () => {
  /** Player 1 left with its buildings only: no unit, no mineral. */
  const ruined = (minerals: number) => {
    const w = createMatch();
    for (const e of [...w.entities.values()]) if (e.owner === 1 && e.def.kind === 'unit') w.entities.delete(e.id);
    w.players[1].minerals = minerals;
    w.players[1].energy = 0;
    return w;
  };

  it('gives up a minute after the game is lost, and the other side wins', () => {
    const w = ruined(0);
    const ai = new AI(w, 1);
    let warned = false;
    while (w.winner === null && w.tick < ticks(90)) {
      w.step(ai.think());
      warned ||= w.events.some((e) => e.player === 0 && e.text === "L'adversaire abandonne.");
    }
    expect(w.players[1].resigned).toBe(true);
    expect(w.winner).toBe(0);
    expect(warned).toBe(true);
    expect(w.tick).toBeGreaterThanOrEqual(ticks(60));
  }, 60_000);

  it('never gives up while it can still pay for a worker', () => {
    const w = ruined(100);
    const ai = new AI(w, 1);
    while (w.winner === null && w.tick < ticks(120)) w.step(ai.think());
    expect(w.players[1].resigned).toBeFalsy();
    expect(w.winner).toBe(null);
  }, 60_000);

  it('is refused in a match with one player (Bac à sable)', () => {
    const w = createMatch(['humains']);
    w.step([{ player: 0, kind: 'resign', ids: [] }]);
    expect(w.players[0].resigned).toBeFalsy();
  });
});
