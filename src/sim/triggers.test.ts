import { describe, expect, it } from 'vitest';
import { checkExpr, type Env, evaluate, parseExpr, readTriggers, renameRegion, renameTrigger, renameVar, triggerProblems, type Triggers } from './triggers';

const env = (vars: Record<string, number> = {}): Env => ({
  vars, time: 120,
  units: (p, t) => (p === 1 ? (t ? 2 : 10) : 0), buildings: () => 3, minerals: (p) => p * 100, energy: () => 7, alive: (p) => (p <= 2 ? 1 : 0),
});
const ev = (s: string, vars?: Record<string, number>) => evaluate(parseExpr(s), env(vars));

describe('déclencheurs : expressions', () => {
  it('calcule en entiers, avec les priorités usuelles', () => {
    expect(ev('4 + vague * 2', { vague: 3 })).toBe(10);
    expect(ev('(4 + 2) * 3')).toBe(18);
    expect(ev('7 / 2')).toBe(3);
    expect(ev('-7 / 2')).toBe(-3);
    expect(ev('5 / 0')).toBe(0);
    expect(ev('7 % 3')).toBe(1);
    expect(ev('- 3 + 1')).toBe(-2);
  });
  it('compare et combine en 1 ou 0', () => {
    expect(ev('vague <= 10 and units(1) == 10', { vague: 10 })).toBe(1);
    expect(ev('not alive(3) or 0')).toBe(1);
    expect(ev('time >= 600')).toBe(0);
    expect(ev("units(1, 'caserne') + buildings(2) + minerals(2) + energy(1)")).toBe(2 + 3 + 200 + 7);
  });
  it('refuse une expression mal formée, en français', () => {
    for (const bad of ['', '4 +', '(1', '1 2', 'a ==', '#', "'x'('y')", '99999999']) expect(() => parseExpr(bad), bad).toThrow();
    expect(() => parseExpr('x'.repeat(201))).toThrow(/trop longue/);
  });
  it('signale les noms inconnus, les arités et les joueurs inexistants', () => {
    const probs = (s: string) => checkExpr(parseExpr(s), new Set(['vague']), 2);
    expect(probs('vague + time')).toEqual([]);
    expect(probs('vies')[0]).toMatch(/variable inconnue/);
    expect(probs('foo(1)')[0]).toMatch(/fonction inconnue/);
    expect(probs('minerals(1, 2)')[0]).toMatch(/argument/);
    expect(probs('units(3)')[0]).toMatch(/joueur 3 inexistant/);
    expect(probs("units(1, 'dragonrouge')")[0]).toMatch(/type inconnu/);
    expect(probs("'caserne' + 1")[0]).toMatch(/hors d'un appel/);
  });
});

const table = (): Triggers => ({
  regions: [{ id: 'nid', rect: [10, 50, 6, 6] }, { id: 'sortie', rect: [60, 30, 4, 4] }],
  vars: [{ id: 'vague', value: 0 }, { id: 'vies', value: 20 }],
  triggers: [
    { id: 'Vague', folder: 'Vagues', enabled: true, once: false, when: { every: 45 }, if: 'vague <= 10', do: [{ spawn: 'auxiliaire', count: '4 + vague * 2', owner: 1, in: 'nid', attack: 'sortie' }, { add: 'vague', value: '1' }] },
    { id: 'Fuite', folder: 'Vagues', enabled: true, once: false, when: { enter: 'sortie', owner: 1 }, do: [{ add: 'vies', value: '-1' }] },
    { id: 'Perdu', folder: 'Fin', enabled: true, once: true, when: { check: 'vies <= 0' }, do: [{ defeat: 0 }, { disable: 'Vague' }] },
  ],
});

describe('déclencheurs : la table', () => {
  it("accepte l'exemple de l'étude et le relit à l'identique", () => {
    expect(triggerProblems(table(), 64, 2)).toEqual([]);
    expect(readTriggers(JSON.parse(JSON.stringify(table())), 64, 2)).toEqual(table());
  });
  it('relit une action ou un événement dont la clé n\'est pas la première', () => {
    const t = JSON.parse(JSON.stringify(table()));
    t.triggers[1].when = { owner: 1, enter: 'sortie' };
    t.triggers[1].do = [{ value: '-1', add: 'vies' }];
    expect(readTriggers(t, 64, 2).triggers[1]).toEqual(table().triggers[1]);
  });
  it('trouve les références cassées', () => {
    const t = table();
    t.triggers[0].do.push({ spawn: 'boostgenetique', count: 'x', owner: 5, in: 'nulle_part' });
    t.triggers[2].do.push({ enable: 'Absent' });
    t.regions.push({ id: 'loin', rect: [60, 60, 10, 10] });
    const p = triggerProblems(t, 64, 2).join('\n');
    for (const m of [/type « boostgenetique » inconnu/, /variable inconnue « x »/, /joueur inexistant/, /région « nulle_part » inconnue/, /déclencheur « Absent » inconnu/, /« loin » hors de la carte/]) expect(p).toMatch(m);
  });
  it('refuse à l\'import ce qui est mal formé ou hors bornes', () => {
    const bad = (patch: (t: Record<string, any>) => void) => {
      const t = JSON.parse(JSON.stringify(table()));
      patch(t);
      return () => readTriggers(t, 64, 2);
    };
    expect(bad((t) => (t.extra = 1))).toThrow(/champ inconnu/);
    expect(bad((t) => (t.regions[0].id = 'Nid !'))).toThrow(/nom/);
    expect(bad((t) => (t.vars[0].id = 'and'))).toThrow(/réservé/);
    expect(bad((t) => (t.vars[0].value = 1.5))).toThrow(/entier/);
    expect(bad((t) => (t.triggers[0].when = { every: 0 }))).toThrow(/durée/);
    expect(bad((t) => (t.triggers[0].when = { boom: 1 }))).toThrow(/événement inconnu/);
    expect(bad((t) => (t.triggers[0].do = [{ explode: 1 }]))).toThrow(/action inconnue/);
    expect(bad((t) => (t.triggers[0].do[0].owner = 2))).toThrow(/entier/);
    expect(bad((t) => (t.triggers[0].do = Array(31).fill({ victory: 0 })))).toThrow(/30 au plus/);
    expect(bad((t) => (t.triggers = Array(201).fill(t.triggers[0])))).toThrow(/200 au plus/);
    expect(bad((t) => (t.triggers[0].do[0].hp = 1))).toThrow(/champ inconnu/);
    expect(bad((t) => (t.triggers[0].if = '4 +'))).toThrow(/si/);
  });
});

describe('déclencheurs : références cassées et renommages', () => {
  it("garde à l'import une référence cassée (montrée dans l'éditeur), refuse un type inconnu", () => {
    const t = table();
    t.regions = t.regions.filter((r) => r.id !== 'sortie');
    expect(triggerProblems(t, 64, 2).join('\n')).toMatch(/région « sortie » inconnue/);
    expect(() => readTriggers(JSON.parse(JSON.stringify(t)), 64, 2)).not.toThrow();
    (t.triggers[0].do[0] as { spawn: string }).spawn = 'dragonrouge';
    expect(() => readTriggers(JSON.parse(JSON.stringify(t)), 64, 2)).toThrow(/dragonrouge/);
  });
  it('un renommage suit les références, pas les textes entre apostrophes', () => {
    const t = table();
    renameRegion(t, 'sortie', 'porte');
    expect(t.triggers[1].when).toEqual({ enter: 'porte', owner: 1 });
    expect(t.triggers[0].do[0]).toMatchObject({ attack: 'porte' });
    t.triggers[0].if = "vague <= 10 and units(1, 'vague') > 0";
    renameVar(t, 'vague', 'onde');
    expect(t.triggers[0].if).toBe("onde <= 10 and units(1, 'vague') > 0");
    expect(t.triggers[0].do[1]).toEqual({ add: 'onde', value: '1' });
    expect(t.triggers[0].do[0]).toMatchObject({ count: '4 + onde * 2' });
    renameTrigger(t, 'Vague', 'Assaut');
    expect(t.triggers[2].do[1]).toEqual({ disable: 'Assaut' });
    // The quoted 'vague' stayed: a unit type, which does not exist.
    expect(triggerProblems(t, 64, 2)).toEqual(['« Assaut », si : type inconnu « vague ».']);
  });
});
