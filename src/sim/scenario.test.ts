import { describe, expect, it } from 'vitest';
import { AI } from '../ai/ai';
import { checkMap } from '../mapcheck';
import type { MapFile } from '../maps';
import { fingerprint } from './fingerprint';
import { FP, ticks } from './fixed';
import { MAX_SPAWN, secondsAt } from './scenario';
import { evaluate, parseExpr } from './triggers';
import { parseReplay } from '../game/replay';
import { removeMap } from '../maps';
import { createMatch } from './setup';
import type { Action, Trigger, Triggers, When } from './triggers';
import type { Command, World } from './world';

/** A small open map (as src/maprules.test.ts) with a triggers table. */
function map(t: Partial<Triggers>): MapFile {
  const def = checkMap({
    format: 1, id: 'scenario', name: 'Scénario', size: 64, players: [2], symmetry: 'rot180', biome: 'desert', terrain: [],
    bases: [
      { start: true, hq: [10, 10], minerals: [[6, 6], [7, 6], [8, 6]], wells: [[16, 6]] },
      { hq: [24, 24], minerals: [[22, 30], [23, 30]], wells: [] },
    ],
    triggers: { regions: [{ id: 'centre', rect: [30, 40, 4, 4] }, { id: 'nid', rect: [40, 20, 3, 3] }], vars: [{ id: 'n', value: 0 }], triggers: [], ...t },
  });
  if (typeof def === 'string') throw new Error(def);
  return def;
}
let ids = 0;
const trig = (when: When, ...actions: Action[]): Trigger => ({ id: `t${++ids}`, folder: '', enabled: true, once: false, when, do: actions.length ? actions : [{ add: 'n', value: '1' }] });
const n = (w: World) => (w.scenario!.state() as { vars: [string, number][] }).vars.find(([k]) => k === 'n')![1];
const run = (w: World, seconds: number, cmds: (w: World) => Command[] = () => []) => {
  const end = w.tick + ticks(seconds);
  while (w.tick < end) w.step(cmds(w));
};
const of = (w: World, owner: number, type?: string) => [...w.entities.values()].filter((e) => e.owner === owner && (!type || e.type === type));

describe('déclencheurs : les événements', () => {
  it('« time » une fois au moment dit, « every » à chaque période', () => {
    const w = createMatch(['humains', 'humains'], undefined, map({ vars: [{ id: 'n', value: 0 }, { id: 'm', value: 0 }], triggers: [trig({ time: 2 }), trig({ every: 3 }, { add: 'm', value: '1' })] }));
    let at = -1;
    while (w.tick < ticks(10)) {
      w.step([]);
      if (n(w) === 1 && at < 0) at = w.tick - 1;
    }
    expect(at).toBe(ticks(2));
    expect(n(w)).toBe(1);
    const m = (w.scenario!.state() as { vars: [string, number][] }).vars.find(([k]) => k === 'm')![1];
    expect(m).toBe(Math.floor((ticks(10) - 1) / ticks(3)));
  });

  it('« enter » et « leave » : une unité qui entre dans une région puis en sort', () => {
    const w = createMatch(['humains', 'humains'], undefined, map({ vars: [{ id: 'n', value: 0 }, { id: 'out', value: 0 }], triggers: [trig({ enter: 'centre', owner: 0 }), trig({ leave: 'centre' }, { add: 'out', value: '1' })] }));
    const u = w.spawn('auxiliaire', 0, 26 * FP, 41 * FP);
    run(w, 1);
    expect(n(w)).toBe(0);
    w.step([{ player: 0, kind: 'move', ids: [u.id], x: 31 * FP + FP / 2, y: 41 * FP + FP / 2 }]);
    run(w, 15);
    expect(n(w)).toBe(1);
    w.step([{ player: 0, kind: 'move', ids: [u.id], x: 26 * FP, y: 41 * FP }]);
    run(w, 15);
    expect((w.scenario!.state() as { vars: [string, number][] }).vars).toEqual([['n', 1], ['out', 1]]);
    // Another player's unit, owner set to 0: not counted.
    w.spawn('auxiliaire', 1, 31 * FP, 41 * FP);
    run(w, 1);
    expect(n(w)).toBe(1);
  });

  it('« killed » : la mort d\'une unité du type et du joueur dits', () => {
    const w = createMatch(['humains', 'humains'], undefined, map({ triggers: [trig({ killed: 'auxiliaire', owner: 1 }), trig({ killed: '' }, { add: 'n', value: '10' })] }));
    const a = w.spawn('auxiliaire', 1, 31 * FP, 41 * FP);
    const b = w.spawn('legionnaire', 0, 33 * FP, 41 * FP);
    run(w, 1);
    a.hp = 0;
    run(w, 1);
    expect(n(w)).toBe(11);
    b.hp = 0;
    run(w, 1);
    expect(n(w)).toBe(21);
  });

  it('« built » : un bâtiment terminé pendant la partie, pas ceux du départ', () => {
    const w = createMatch(['humains', 'humains'], undefined, map({ triggers: [trig({ built: 'caserne', owner: 0 }), trig({ built: 'conseil' })] }));
    const site = w.site('caserne', 0, 20, 20);
    run(w, 1);
    expect(n(w)).toBe(0);
    site.buildLeft = 0;
    site.hp = site.maxHp;
    run(w, 1);
    expect(n(w)).toBe(1);
  });

  it('« check » : quand la condition devient vraie, pas tant qu\'elle le reste', () => {
    const w = createMatch(['humains', 'humains'], undefined, map({ triggers: [trig({ check: 'minerals(1) >= 1000' })] }));
    w.players[0].minerals = 1500;
    run(w, 2);
    expect(n(w)).toBe(1);
    w.players[0].minerals = 0;
    run(w, 1);
    w.players[0].minerals = 1200;
    run(w, 1);
    expect(n(w)).toBe(2);
  });

  it('« si » retient l\'action ; « une seule fois » ; un déclencheur désactivé se tait', () => {
    const w = createMatch(['humains', 'humains'], undefined, map({
      vars: [{ id: 'n', value: 0 }, { id: 'once', value: 0 }, { id: 'off', value: 0 }],
      triggers: [
        { ...trig({ every: 1 }), if: 'n < 3' },
        { ...trig({ every: 1 }, { add: 'once', value: '1' }), once: true },
        { ...trig({ every: 1 }, { add: 'off', value: '1' }), enabled: false },
      ],
    }));
    run(w, 10);
    expect((w.scenario!.state() as { vars: [string, number][] }).vars).toEqual([['n', 3], ['off', 0], ['once', 1]]);
  });
});

describe('déclencheurs : les actions', () => {
  it('message à un joueur ou à tous', () => {
    const w = createMatch(['humains', 'humains'], undefined, map({ triggers: [trig({ time: 1 }, { message: 'Pour toi', to: 1 }, { message: 'Pour tous', to: 'all' })] }));
    const seen: { player: number; text: string }[] = [];
    while (w.tick <= ticks(1)) {
      w.step([]);
      seen.push(...w.events.filter((e) => e.text.startsWith('Pour')));
    }
    expect(seen.map((e) => `${e.player}:${e.text}`)).toEqual(['1:Pour toi', '0:Pour tous', '1:Pour tous']);
  });

  it('faire apparaître : le nombre calculé, dans la région, en attaque-déplacement vers l\'autre ; borné', () => {
    const w = createMatch(['humains', 'humains'], undefined, map({
      vars: [{ id: 'n', value: 3 }],
      triggers: [trig({ time: 1 }, { spawn: 'auxiliaire', count: '2 + n', owner: 1, in: 'nid', attack: 'centre' }, { spawn: 'serf', count: '999', owner: -1, in: 'centre' })],
    }));
    run(w, 1.2);
    const aux = of(w, 1, 'auxiliaire');
    expect(aux).toHaveLength(5);
    for (const e of aux) {
      const [tx, ty] = [Math.floor(e.x / FP), Math.floor(e.y / FP)];
      expect(Math.abs(tx - 41) <= 3 && Math.abs(ty - 21) <= 3).toBe(true);
      expect(e.order?.kind).toBe('attackMove');
    }
    expect(of(w, -1, 'serf')).toHaveLength(MAX_SPAWN);
  });

  it('variables, ressources, interdire et autoriser', () => {
    const w = createMatch(['humains', 'humains'], undefined, map({
      triggers: [
        trig({ time: 1 }, { set: 'n', value: '7 * 6' }, { give: 1, minerals: '500', energy: 'n' }, { forbid: 'caserne', player: 0 }),
        trig({ time: 2 }, { allow: 'caserne', player: 0 }, { forbid: 'tour', player: 0 }),
      ],
    }));
    const [m, e] = [w.players[1].minerals, w.players[1].energy];
    run(w, 1.2);
    expect(n(w)).toBe(42);
    expect([w.players[1].minerals - m, w.players[1].energy - e]).toEqual([500, 42]);
    expect(w.lacks(0, 'caserne')).toBe('Interdit sur cette carte.');
    run(w, 1);
    expect(w.lacks(0, 'caserne')).not.toBe('Interdit sur cette carte.');
    expect(w.players[0].forbid).toEqual(['tour']);
  });

  it('victoire, défaite ; activer et désactiver un déclencheur', () => {
    const win = createMatch(['humains', 'humains'], undefined, map({ triggers: [trig({ time: 1 }, { victory: 1 })] }));
    run(win, 2);
    expect(win.winner).toBe(1);
    const lose = createMatch(['humains', 'humains'], undefined, map({ triggers: [trig({ time: 1 }, { defeat: 0 })] }));
    run(lose, 3);
    expect(lose.players[0].resigned).toBe(true);
    expect(lose.winner).toBe(1);
    const w = createMatch(['humains', 'humains'], undefined, map({
      triggers: [
        { ...trig({ every: 1 }), id: 'compte', enabled: false },
        trig({ time: 3 }, { enable: 'compte' }),
        trig({ time: 6 }, { disable: 'compte' }),
      ],
    }));
    run(w, 10);
    // Turned on at the tick of 3 s, after its own turn in the list; off at 6 s, likewise.
    let fired = 0;
    for (let t = ticks(3) + 1; t <= ticks(6); t++) if (t % ticks(1) === 0) fired++;
    expect(n(w)).toBe(fired);
  });
});

/**
 * The study's example, a tower defence: waves leave a nest and march on player 1's base; each one that gets in
 * costs a life. Player 1 wins if it holds three waves, loses when its lives are spent.
 */
function waves(size: number, guards: boolean): MapFile {
  const def = map({
    regions: [{ id: 'nid', rect: [20, 22, 3, 3] }, { id: 'base', rect: [9, 9, 6, 6] }],
    vars: [{ id: 'vague', value: 0 }, { id: 'vies', value: 3 }],
    triggers: [
      { ...trig({ every: 20 }, { add: 'vague', value: '1' }, { message: 'Vague !', to: 'all' }, { spawn: 'legionnaire', count: String(size), owner: 1, in: 'nid', attack: 'base' }), id: 'vague', if: 'vague < 3' },
      { ...trig({ enter: 'base', owner: 1 }, { add: 'vies', value: '-1' }), id: 'fuite' },
      { ...trig({ check: 'vague >= 3 and units(2, \'legionnaire\') == 0' }, { victory: 0 }), id: 'tenu', once: true },
      { ...trig({ check: 'vies <= 0' }, { defeat: 0 }), id: 'perdu', once: true },
    ],
  });
  if (guards) def.units = Array.from({ length: 8 }, (_, i) => ({ type: 'legionnaire', owner: 0, at: [15 + (i % 4), 15 + Math.floor(i / 4)] as [number, number] }));
  return def;
}
const play = (def: MapFile, seconds: number) => {
  const w = createMatch(['humains', 'humains'], undefined, def);
  while (w.tick < ticks(seconds) && w.winner === null) w.step([]);
  return w;
};

describe('déclencheurs : une carte de bout en bout', () => {
  it('une garde tient trois vagues : victoire du joueur 1', () => {
    const w = play(waves(2, true), 180);
    expect(w.winner).toBe(0);
  }, 60_000);

  it('sans garde, les vagues entrent dans la base : vies perdues, défaite du joueur 1', () => {
    const w = play(waves(4, false), 180);
    expect(w.players[0].resigned).toBe(true);
    expect(w.winner).toBe(1);
  }, 60_000);
});

describe('déclencheurs : déterminisme', () => {
  const record = () => {
    const def = waves(4, true);
    const w = createMatch(['humains', 'z'], undefined, def);
    const ais = [new AI(w, 0), new AI(w, 1)];
    const log: [number, Command[]][] = [];
    const prints: number[] = [];
    while (w.tick < ticks(4 * 60)) {
      const cmds = ais.flatMap((a) => a.think());
      if (cmds.length) log.push([w.tick, cmds]);
      w.step(cmds);
      if (w.tick % 100 === 0) prints.push(fingerprint(w));
    }
    return { def, log, prints, w };
  };

  it('deux parties pareilles donnent les mêmes empreintes, et le rejeu des ordres aussi', () => {
    const a = record();
    const b = record();
    expect(b.prints).toEqual(a.prints);
    // The replay: the map read back from its JSON, the orders at their ticks.
    const orders = new Map<number, Command[]>(JSON.parse(JSON.stringify(a.log)));
    const again = createMatch(['humains', 'z'], undefined, checkMap(JSON.parse(JSON.stringify(a.def))) as MapFile);
    const prints: number[] = [];
    while (again.tick < a.w.tick) {
      again.step(orders.get(again.tick) ?? []);
      if (again.tick % 100 === 0) prints.push(fingerprint(again));
    }
    expect(prints).toEqual(a.prints);
  }, 120_000);

  it("l'état des déclencheurs compte dans l'empreinte", () => {
    const def = map({ triggers: [trig({ every: 1 })] });
    const w1 = createMatch(['humains', 'humains'], undefined, def);
    const w2 = createMatch(['humains', 'humains'], undefined, def);
    run(w1, 2);
    run(w2, 2);
    expect(fingerprint(w1)).toBe(fingerprint(w2));
    (w2.scenario as unknown as { vars: Record<string, number> }).vars.n += 1;
    expect(fingerprint(w1)).not.toBe(fingerprint(w2));
  });

  it('une carte sans déclencheurs n\'a pas de moteur', () => {
    const def = map({});
    delete def.triggers;
    expect(createMatch(['humains', 'humains'], undefined, def).scenario).toBeNull();
    expect(createMatch(['humains', 'humains']).scenario).toBeNull();
  });
});

describe('déclencheurs : import par le jeu (mapcheck)', () => {
  it('refuse une référence cassée, un type inconnu, une forme fausse ; accepte une table juste', () => {
    const with_ = (t: unknown) => {
      const def = JSON.parse(JSON.stringify(map({})));
      def.id = 'scenario';
      def.triggers = t;
      return checkMap(def);
    };
    const ok = { regions: [{ id: 'nid', rect: [40, 20, 3, 3] }], vars: [], triggers: [{ id: 'a', when: { time: 5 }, do: [{ spawn: 'auxiliaire', count: '3', owner: 1, in: 'nid' }] }] };
    expect(typeof with_(ok)).toBe('object');
    expect(with_({ ...ok, regions: [] })).toMatch(/région « nid » inconnue/);
    expect(with_({ ...ok, triggers: [{ id: 'a', when: { time: 5 }, do: [{ spawn: 'dragonrouge', count: '3', owner: 1, in: 'nid' }] }] })).toMatch(/dragonrouge/);
    expect(with_({ ...ok, triggers: [{ id: 'a', when: { time: 5 }, do: [{ victory: 2 }] }] })).toMatch(/triggers/);
    expect(with_({ ...ok, regions: [{ id: 'nid', rect: [62, 20, 3, 3] }] })).toMatch(/hors de la carte/);
    expect(with_([])).toMatch(/triggers/);
  });
});

describe('déclencheurs : ce qu\'une carte hostile ne peut pas faire', () => {
  const imp = (t: unknown) => {
    const def = JSON.parse(JSON.stringify(map({})));
    def.triggers = t;
    return checkMap(def);
  };
  const one = (a: unknown, when: unknown = { time: 1 }) => ({ regions: [{ id: 'nid', rect: [40, 20, 3, 3] }], vars: [{ id: 'a', value: 0 }], triggers: [{ id: 'x', when, do: [a] }] });

  it('refuse une expression vide là où elle est attendue (pas pour « si »)', () => {
    for (const a of [{ set: 'a', value: '' }, { add: 'a', value: '  ' }, { give: 0, minerals: '', energy: '0' }, { spawn: 'auxiliaire', count: '', owner: 1, in: 'nid' }]) expect(imp(one(a)), JSON.stringify(a)).toMatch(/vide/);
    expect(imp(one({ set: 'a', value: '1' }, { check: '' }))).toMatch(/vide/);
    const t = one({ set: 'a', value: '1' });
    (t.triggers[0] as { if?: string }).if = '';
    expect(typeof imp(t)).toBe('object');
  });

  it('refuse les noms hérités comme fonctions ou variables', () => {
    for (const f of ['toString(1)', '__proto__(1)', 'constructor(1)', 'hasOwnProperty(1)', 'valueOf(1)', '__defineGetter__(1)']) expect(imp(one({ set: 'a', value: f })), f).toMatch(/fonction inconnue/);
    for (const v of ['__proto__', 'constructor', 'toString']) expect(imp({ vars: [{ id: v, value: 0 }], triggers: [] }), v).toMatch(/réservé/);
  });

  it("l'évaluateur rend toujours un entier fini, borné, même sur un arbre forgé", () => {
    const env = { vars: Object.create(null), time: 0, units: () => 0, buildings: () => 0, minerals: () => 0, energy: () => 0, alive: () => 0 };
    expect(evaluate({ f: 'toString', args: [{ n: 1 }] }, env)).toBe(0);
    expect(evaluate({ f: '__proto__', args: [] }, env)).toBe(0);
    expect(evaluate({ v: 'constructor' }, env)).toBe(0);
    expect(evaluate(parseExpr('1000000 * 1000000 * 1000000'), env)).toBe(1_000_000_000);
    expect(evaluate(parseExpr('0 - 1000000 * 1000000'), env)).toBe(-1_000_000_000);
    const weird = { ...env, units: () => Number.NaN, minerals: () => Number.POSITIVE_INFINITY };
    expect(evaluate(parseExpr('units(1) + 1'), weird)).toBe(1);
    expect(evaluate(parseExpr('minerals(1)'), weird)).toBe(0);
  });

  it('refuse les signes < > " & dans les noms, dossiers et messages', () => {
    expect(imp(one({ message: '<b>gras</b>', to: 'all' }))).toMatch(/signes/);
    const t = one({ set: 'a', value: '1' });
    (t.triggers[0] as { id: string }).id = 'a&b';
    expect(imp(t)).toMatch(/signes/);
  });

  it('une table qui ne se lit pas fait échouer createMatch, jamais un tick', () => {
    const def = map({});
    def.triggers = { regions: [], vars: [{ id: 'a', value: 0 }], triggers: [{ id: 'x', folder: '', enabled: true, once: false, when: { time: 1 }, do: [{ set: 'a', value: '' }] }] };
    expect(() => createMatch(['humains', 'humains'], undefined, def)).toThrow(/vide/);
  });
});

describe('déclencheurs : précisions', () => {
  it('« time » des expressions suit les ticks de l\'événement « time »', () => {
    for (const s of [0, 1, 5, 60, 599, 600, 3600]) {
      expect(secondsAt(ticks(s)), String(s)).toBe(Math.max(s, s === 0 ? 0 : s));
      expect(secondsAt(ticks(s) - 1) < s || s === 0, String(s)).toBe(true);
    }
    const w = createMatch(['humains', 'humains'], undefined, map({ vars: [{ id: 'n', value: 0 }, { id: 'm', value: 0 }], triggers: [trig({ time: 60 }), trig({ check: 'time >= 60' }, { add: 'm', value: '1' })] }));
    while (n(w) === 0) w.step([]);
    expect((w.scenario!.state() as { vars: [string, number][] }).vars).toEqual([['m', 1], ['n', 1]]);
  });

  it('une unité déjà dans la région au départ n\'y « entre » pas ; changer de main sur place n\'est pas sortir', () => {
    const def = map({ vars: [{ id: 'n', value: 0 }, { id: 'out', value: 0 }], triggers: [trig({ enter: 'centre' }), trig({ leave: 'centre', owner: 0 }, { add: 'out', value: '1' })] });
    def.units = [{ type: 'legionnaire', owner: 0, at: [31, 41] }];
    const w = createMatch(['humains', 'humains'], undefined, def);
    run(w, 2);
    expect(n(w)).toBe(0);
    of(w, 0, 'legionnaire')[0].owner = 1; // taken where it stands
    run(w, 1);
    expect((w.scenario!.state() as { vars: [string, number][] }).vars).toEqual([['n', 0], ['out', 0]]);
  });

  it('la fin d\'une illusion n\'est pas une mort ; les chantiers et illusions ne comptent pas', () => {
    const w = createMatch(['humains', 'humains'], undefined, map({ vars: [{ id: 'n', value: 0 }, { id: 'u', value: 0 }, { id: 'b', value: 0 }], triggers: [trig({ killed: '' }), trig({ every: 1 }, { set: 'u', value: "units(2, 'auxiliaire')" }, { set: 'b', value: "buildings(1, 'caserne')" })] }));
    const ghost = w.spawn('auxiliaire', 1, 31 * FP, 41 * FP);
    ghost.illusion = true;
    w.site('caserne', 0, 20, 20);
    run(w, 1.5);
    const v = () => Object.fromEntries((w.scenario!.state() as { vars: [string, number][] }).vars);
    expect([v().u, v().b]).toEqual([0, 0]);
    ghost.hp = 0;
    run(w, 1);
    expect(v().n).toBe(0);
  });

  it('les unités neutres d\'une action restent passives', () => {
    const def = map({ triggers: [trig({ time: 1 }, { spawn: 'legionnaire', count: '4', owner: -1, in: 'nid' })] });
    def.units = [{ type: 'auxiliaire', owner: 0, at: [41, 18] }];
    const w = createMatch(['humains', 'humains'], undefined, def);
    run(w, 20);
    expect(of(w, -1, 'legionnaire')).toHaveLength(4);
    expect(of(w, 0, 'auxiliaire')[0].hp).toBe(of(w, 0, 'auxiliaire')[0].maxHp);
  });

  it('un message de carte est une information, pas une alerte', () => {
    const w = createMatch(['humains', 'humains'], undefined, map({ triggers: [trig({ time: 1 }, { message: 'Bienvenue', to: 'all' })] }));
    const kinds = new Set<string>();
    while (w.tick <= ticks(1)) {
      w.step([]);
      for (const e of w.events) if (e.text === 'Bienvenue') kinds.add(e.kind);
    }
    expect([...kinds]).toEqual(['info']);
  });
});

describe('déclencheurs : aux bornes', () => {
  it('200 déclencheurs aux expressions longues, 1000 unités : un tick reste court', () => {
    // As long as an expression may be (200 characters): as many counts as fit.
    const terms = Array.from({ length: 20 }, (_, k) => (k % 2 ? 'buildings(1)' : `units(${(k % 4) / 2 + 1}, 'legionnaire')`));
    let long = terms[0];
    for (const x of terms.slice(1)) if (long.length + x.length + 8 < 190) long += ` + ${x}`;
    const def = map({
      regions: [{ id: 'centre', rect: [20, 20, 24, 24] }],
      vars: [{ id: 'n', value: 0 }],
      triggers: Array.from({ length: 200 }, (_, i) => ({ ...trig(i % 2 ? { check: `${long} > 0` } : { enter: 'centre' }, { set: 'n', value: long }), id: `t${i}`, if: 'alive(1) and alive(2)' })),
    });
    const w = createMatch(['humains', 'humains'], undefined, def);
    for (let i = 0; i < 1000; i++) w.spawn('legionnaire', i % 2, (20 + (i % 24)) * FP + FP / 2, (20 + Math.floor(i / 42)) * FP + FP / 2);
    w.step([]);
    const t = performance.now();
    for (let i = 0; i < 20; i++) (w.scenario as unknown as { step(w: World): void }).step(w);
    // Generous for a slow test machine: the old engine took seconds here.
    expect((performance.now() - t) / 20).toBeLessThan(25);
  }, 60_000);
});

describe('déclencheurs : un replay portant sa carte', () => {
  it('se relit par parseReplay et rejoue à l\'empreinte près', () => {
    const def = waves(3, true);
    const w = createMatch(['humains', 'z'], [0, 1], def);
    const ais = [new AI(w, 0), new AI(w, 1)];
    const log: [number, Command[]][] = [];
    while (w.tick < ticks(90)) {
      const cmds = ais.flatMap((a) => a.think());
      if (cmds.length) log.push([w.tick, cmds]);
      w.step(cmds);
    }
    const text = JSON.stringify({ v: 1, map: def.id, carte: def, factions: ['humains', 'z'], teams: [0, 1], biome: def.biome, handicap: [100, 100], ticks: log });
    const r = parseReplay(text);
    if (typeof r === 'string') throw new Error(r);
    const again = createMatch(r.factions, r.teams, r.map, r.biome);
    expect(again.scenario).not.toBeNull();
    let k = 0;
    while (again.tick < w.tick) again.step(r.ticks[k]?.[0] === again.tick ? r.ticks[k++][1] : []);
    expect(fingerprint(again)).toBe(fingerprint(w));
    removeMap(def.id);
  }, 60_000);
});
