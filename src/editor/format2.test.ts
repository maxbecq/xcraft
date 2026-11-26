import { describe, expect, it } from 'vitest';
import { rotateFootprint, rotateTile } from '../map';
import { checkMap, MAP_MAX_CHARS, parseMap as parseMap1, parseMap as parseMapText } from '../mapcheck';
import { addMap, buildMap, CORNERS, type MapFile, MAPS, removeMap, turnsOf } from '../maps';
import { createMatch } from '../sim/setup';
import { blankMap, DECOR, fromFormat1, gameCounts, gameText, type MapFile2, parseMap, rampTiles, toFormat1, toGameMap, turnRamp, turnsOfSymmetry } from './format2';
import { previewWorld } from './world';

describe('format 2', () => {
  // Every map file read through format 2 gives the game's own map, tile for tile.
  for (const def of Object.values(MAPS)) {
    it(`${def.id} : format 1 → format 2 → carte du jeu identique`, () => {
      const biome = def.biome;
      const players = Math.max(...def.players);
      const f = fromFormat1(def, biome, players);
      const a = buildMap(def, players, biome);
      const b = toGameMap(parseMap(JSON.parse(JSON.stringify(f))));
      expect([...b.level]).toEqual([...a.level]);
      expect(b.ramp).toEqual(a.ramp);
      expect([...b.rampStep]).toEqual([...a.rampStep]);
      expect([...(b.chasm ?? new Uint8Array(a.level.length))]).toEqual([...(a.chasm ?? new Uint8Array(a.level.length))]);
      expect(b.sites!.filter((s) => s.start).length).toBe(players);
      expect(f.players.length + f.bases.length).toBe(a.sites!.length);
      expect(f.symmetry).toBe(turnsOf(def, players).length === 4 ? 'rot90' : 'rot180');
    });
  }

  it('un monde d\'aperçu : QG, ouvriers, ressources et unités posées', () => {
    const f = blankMap(64);
    f.minerals.push([20, 20]);
    f.wells.push([30, 30]);
    f.units.push({ type: 'caserne', owner: 0, at: [20, 10] }, { type: 'auxiliaire', owner: -1, at: [40, 40] }, { type: 'inconnu', owner: 0, at: [1, 1] });
    f.players[1].race = 'z';
    const { world, skipped } = previewWorld(f, toGameMap(f));
    const types = [...world.entities.values()].map((e) => e.type);
    expect(types).toContain('conseil');
    expect(types).toContain('intelligence');
    expect(types).toContain('caserne');
    expect(types).toContain('puits');
    expect(skipped).toEqual(['inconnu']);
  });

  it('une rampe tournée garde ses tuiles tournées', () => {
    const r = { at: [10, 20] as [number, number], up: 'N' as const, width: 3, level: 0 };
    for (const q of [1, 2, 3]) {
      const t = turnRamp(64, r, q);
      const turned = new Set(rampTiles(r).map(([x, y]) => {
        for (let k = 0; k < q; k++) [x, y] = [63 - y, x];
        return `${x},${y}`;
      }));
      expect(new Set(rampTiles(t).map(([x, y]) => `${x},${y}`))).toEqual(turned);
    }
  });

  it('refuse un fichier mal formé', () => {
    expect(() => parseMap({ format: 3 })).toThrow();
    expect(() => parseMap({ ...blankMap(32), tiles: ['0'] })).toThrow();
    expect(() => parseMap({ ...blankMap(32), size: 100000 })).toThrow();
    expect(() => parseMap({ ...blankMap(32), players: [] })).toThrow();
    expect(parseMap(JSON.parse(JSON.stringify(blankMap(32)))).size).toBe(32);
  });

  it('refuse un type, un décor, un angle, un interdit ou des déclencheurs inconnus', () => {
    const with_ = (patch: (f: MapFile2) => void) => {
      const f = JSON.parse(JSON.stringify(blankMap(32))) as MapFile2;
      patch(f);
      return () => parseMap(f);
    };
    expect(with_((f) => f.units.push({ type: 'dragonrouge', owner: 0, at: [5, 5] }))).toThrow(/units/);
    expect(with_((f) => f.units.push({ type: 'constructor', owner: 0, at: [5, 5] }))).toThrow(/units/);
    expect(with_((f) => f.units.push({ type: 'minerai', owner: 0, at: [5, 5] }))).toThrow(/units/);
    expect(with_((f) => f.decor.push({ type: 'licorne', at: [5, 5] }))).toThrow(/decor/);
    expect(with_((f) => f.decor.push({ type: 'rocks_a', at: [5, 5], yaw: 1e9 }))).toThrow(/decor/);
    expect(with_((f) => f.decor.push({ type: 'rocks_a', at: [5, 5], yaw: '1' as unknown as number }))).toThrow(/decor/);
    expect(with_((f) => (f.players[0].forbid = ['nimporte']))).toThrow(/players/);
    expect(with_((f) => (f.players[0].minerals = 1e12))).toThrow(/players/);
    expect(with_((f) => Object.assign(f, { triggers: [] }))).toThrow(/Déclencheurs/);
    expect(with_((f) => Object.assign(f, { triggers: { triggers: [{ id: 'a', when: { boom: 1 }, do: [] }] } }))).toThrow(/événement inconnu/);
    expect(with_((f) => {
      f.units.push({ type: 'caserne', owner: -1, at: [5, 5] });
      f.decor.push({ type: 'rocks_a', at: [8, 8], yaw: 1.5 });
      f.players[0].forbid = ['tour', 'boostgenetique'];
    })()).toMatchObject({ units: [{ type: 'caserne' }], decor: [{ type: 'rocks_a', yaw: 1.5 }] });
  });

  it('le catalogue de décor est celui du fichier de modèles', async () => {
    const { NodeIO } = await import('@gltf-transform/core');
    const doc = await new NodeIO().read('public/models/doodads.glb');
    expect([...DECOR].sort()).toEqual(doc.getRoot().getDefaultScene()!.listChildren().map((n) => n.getName()).sort());
  });
});

describe('export pour le jeu (format 1)', () => {
  /** Paints a tile and its turned copies, as the editor's brush does. */
  const paint = (f: MapFile2, x0: number, y0: number, x1: number, y1: number, c: string) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        for (const q of turnsOfSymmetry(f.symmetry)) {
          const [tx, ty] = rotateTile(f.size, x, y, q);
          f.tiles[ty] = f.tiles[ty].slice(0, tx) + c + f.tiles[ty].slice(tx + 1);
        }
      }
    }
  };
  const editorMap = (symmetry: 'rot180' | 'rot90', players: number) => {
    const f = blankMap(72, 'glace');
    f.symmetry = symmetry;
    f.name = 'Essai <éditeur>';
    const qs = turnsOfSymmetry(symmetry);
    f.players = Array.from({ length: players }, (_, i) => ({ race: '' as const, start: rotateFootprint(72, 10, 10, 4, CORNERS[i]), minerals: 200, energy: 0, forbid: [] as string[] }));
    paint(f, 2, 2, 22, 22, '1');
    paint(f, 3, 3, 8, 8, '2');
    paint(f, 30, 20, 33, 30, 'x');
    for (const q of qs) f.ramps.push(turnRamp(72, { at: [12, 23], up: 'N', width: 4, level: 0 }, q));
    for (const q of qs) {
      for (const m of [[6, 12], [6, 13], [6, 14], [7, 15]] as [number, number][]) f.minerals.push(rotateTile(72, ...m, q));
      f.wells.push(rotateFootprint(72, 16, 5, 3, q));
      f.bases.push(rotateFootprint(72, 40, 8, 4, q));
      f.minerals.push(rotateTile(72, 44, 5, q), rotateTile(72, 45, 5, q));
    }
    f.units.push({ type: 'caserne', owner: 0, at: [14, 14] });
    Object.assign(f.players[0], { race: 'z', minerals: 500, forbid: ['tour'] });
    return f;
  };

  for (const [symmetry, players] of [['rot180', 2], ['rot90', 4], ['rot90', 2]] as const) {
    it(`une carte de l'éditeur (${symmetry}, ${players} joueurs) passe par l'export, mapcheck et buildMap`, () => {
      const f = editorMap(symmetry, players);
      const { map, notes } = toFormat1(f);
      const checked = parseMap1(JSON.stringify(map));
      expect(typeof checked, String(checked)).toBe('object');
      const def = checked as MapFile;
      const built = buildMap(def, players, def.biome);
      const want = toGameMap(f);
      expect([...built.level]).toEqual([...want.level]);
      expect(built.ramp).toEqual(want.ramp);
      expect([...built.rampStep]).toEqual([...want.rampStep]);
      expect([...(built.chasm ?? [])]).toEqual([...(want.chasm ?? [])]);
      // Each seat starts where the editor put it; the free bases are there too.
      for (let i = 0; i < players; i++) expect(built.sites!.find((s) => s.start && s.turn === CORNERS[i])!.hq).toEqual(f.players[i].start);
      for (const b of f.bases) expect(built.sites!.some((s) => s.hq[0] === b[0] && s.hq[1] === b[1])).toBe(true);
      const minerals = new Set(turnsOf(def, players).flatMap((q) => def.bases.flatMap((b) => b.minerals.map(([x, y]) => rotateTile(72, x, y, q).join(',')))));
      expect(minerals).toEqual(new Set(f.minerals.map((m) => m.join(','))));
      expect(def.biome).toBe('glace');
      expect(notes.join(' ')).not.toContain('Pas encore lu');
      // The players' settings and the placed units go along, and come back into the editor.
      expect(def.units).toEqual([{ type: 'caserne', owner: 0, at: [14, 14] }]);
      expect(def.seats?.[0]).toEqual({ race: 'z', minerals: 500, forbid: ['tour'] });
      const back = fromFormat1(def, def.biome, players);
      expect(back.players[0]).toMatchObject({ race: 'z', minerals: 500, energy: 0, forbid: ['tour'] });
      expect(back.players[1].race).toBe('');
      expect(back.units).toEqual(f.units);
      // Imported as the game does, a match starts on it: each seat's headquarters on its start, and a minute runs.
      addMap(def);
      const world = createMatch(Array.from({ length: players }, () => 'humains' as const), undefined, def.id, def.biome);
      for (let i = 0; i < players; i++) {
        const hq = [...world.entities.values()].find((e) => e.owner === i && e.type === (i === 0 ? 'intelligence' : 'conseil'))!;
        expect([hq.tx, hq.ty]).toEqual(f.players[i].start);
      }
      for (let t = 0; t < 20 * 60; t++) world.step([]);
      removeMap(def.id);
    });
  }

  it('une carte sans symétrie sort symétrique, et le dit', () => {
    const f = editorMap('rot180', 2);
    f.symmetry = 'none';
    f.tiles[60] = '2'.repeat(72);
    const { map, notes } = toFormat1(f);
    expect(typeof parseMap1(JSON.stringify(map))).toBe('object');
    expect(notes.join(' ')).toContain('symétrique');
  });

  // The game's own maps, opened in the editor and exported again, give the same terrain.
  for (const def of Object.values(MAPS)) {
    it(`${def.id} : format 1 → éditeur → format 1 → mapcheck → même terrain`, () => {
      const players = Math.max(...def.players);
      const f = fromFormat1(def, def.biome, players);
      const out = parseMap1(JSON.stringify(toFormat1(f).map));
      expect(typeof out, String(out)).toBe('object');
      const a = buildMap(def, players, def.biome);
      const b = buildMap(out as MapFile, players, def.biome);
      expect([...b.level]).toEqual([...a.level]);
      expect(b.ramp).toEqual(a.ramp);
      expect([...(b.chasm ?? new Uint8Array(a.level.length))]).toEqual([...(a.chasm ?? new Uint8Array(a.level.length))]);
    });
  }
});

describe('format 2 : équipes', () => {
  it('passe les équipes au format 1 du jeu et les relit', () => {
    const f = fromFormat1(MAPS.origine, MAPS.origine.biome, 2);
    f.players[0].team = 1;
    f.players[1].team = 0;
    const { map } = toFormat1(f);
    const def = checkMap(JSON.parse(JSON.stringify(map))) as MapFile;
    expect(def.seats?.map((s) => s.team)).toEqual([1, 0]);
    expect(fromFormat1(def).players.map((p) => p.team)).toEqual([1, 0]);
    // No team: the menu's, nothing written.
    const free = fromFormat1(MAPS.origine, MAPS.origine.biome, 2);
    expect(toFormat1(free).map.seats).toBeUndefined();
  });

  it('refuse une équipe hors de 0 à 3 dans un fichier de l\'éditeur', () => {
    const f = JSON.parse(JSON.stringify(fromFormat1(MAPS.origine, MAPS.origine.biome, 2)));
    f.players[0].team = 4;
    expect(() => parseMap(f)).toThrow(/players/);
    f.players[0].team = 2;
    expect(parseMap(f).players[0].team).toBe(2);
  });
});

describe('format 2 : déclencheurs', () => {
  it("garde les déclencheurs dans le fichier de l'éditeur et les passe au jeu par l'export", () => {
    const f = JSON.parse(JSON.stringify(fromFormat1(MAPS.origine, MAPS.origine.biome, 2)));
    f.triggers = { regions: [{ id: 'nid', rect: [10, 10, 4, 4] }], vars: [{ id: 'vague', value: 0 }], triggers: [{ id: 'Vague', folder: '', enabled: true, once: false, when: { every: 45 }, do: [{ spawn: 'auxiliaire', count: '2 + vague', owner: 1, in: 'nid' }] }] };
    const back = parseMap(JSON.parse(JSON.stringify(f)));
    expect(back.triggers).toEqual(f.triggers);
    const { map, notes } = toFormat1(back);
    expect(map.triggers).toEqual(f.triggers);
    expect(notes.join(' ')).not.toMatch(/déclencheurs/);
    expect((checkMap(JSON.parse(JSON.stringify(map))) as MapFile).triggers).toEqual(f.triggers);
  });
});

describe('format 2 : revue Codex', () => {
  const four = () => {
    const def = Object.values(MAPS).find((m) => m.players.includes(4))!;
    return fromFormat1(def, def.biome, 4);
  };

  it('relit les déclencheurs et les effectifs d\'une carte exportée : format 2 → 1 → 2', () => {
    const f = four();
    f.triggers = { regions: [{ id: 'nid', rect: [10, 10, 4, 4] }], vars: [{ id: 'vague', value: 0 }], triggers: [{ id: 'Vague', folder: '', enabled: true, once: false, when: { every: 45 }, do: [{ spawn: 'auxiliaire', count: '2 + vague', owner: 3, in: 'nid' }] }] };
    f.counts = [4];
    const def = checkMap(JSON.parse(JSON.stringify(toFormat1(f).map))) as MapFile;
    const back = fromFormat1(def);
    expect(back.triggers).toEqual(f.triggers);
    expect(back.counts).toEqual([4]);
  });

  it('exporte un 2 contre 2 qui ne se joue qu\'à 4', () => {
    const f = four();
    f.players.forEach((p, i) => (p.team = i < 2 ? 0 : 1));
    expect(checkMap(JSON.parse(JSON.stringify(toFormat1(f).map)))).toMatch(/À 2 joueurs, tous dans la même équipe/);
    f.counts = [4];
    const def = checkMap(JSON.parse(JSON.stringify(toFormat1(f).map))) as MapFile;
    expect(def.players).toEqual([4]);
    expect(gameCounts(f)).toEqual([4]);
    const w = createMatch(['humains', 'z', 'isdaris', 'dieux'], undefined, def);
    expect(w.players.map((p) => p.team)).toEqual([0, 0, 1, 1]);
  });

  it('refuse à l\'export ce que le jeu refuserait à la relecture : un texte trop gros', () => {
    const f = four();
    f.triggers = { regions: [], vars: [], triggers: Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`, folder: '', enabled: true, once: false, when: { time: i }, do: [{ message: 'x'.repeat(200), to: 'all' as const }] })) };
    const text = JSON.stringify(toFormat1(f).map);
    expect(typeof checkMap(JSON.parse(text))).toBe('object'); // the object alone passes
    expect(parseMapText(text)).toMatch(/trop gros/); // the text the game reads does not
  });
});

// Codex, 2026-11-26 (third final review): the compact text was checked and an indented one saved, so a map just under
// the bound was said exported, then refused at the import.
describe('le texte exporté pour le jeu', () => {
  it('est celui qui a été contrôlé : refusé s\'il dépasse la limite une fois écrit', () => {
    const big = { ...MAPS['le-col'], id: 'gros-col', description: '', terrain: [...MAPS['le-col'].terrain] } as MapFile;
    const poly = MAPS.asteroides.terrain.find((t) => t.shape === 'polygon' && !('arch' in t && t.arch))!;
    while (JSON.stringify({ ...big, terrain: [...big.terrain, poly] }).length <= MAP_MAX_CHARS - 2000) big.terrain.push(poly);
    expect(typeof parseMapText(JSON.stringify(big))).toBe('object'); // compact, it passes
    expect(() => gameText(big)).toThrow(); // as saved, it would not
    const text = gameText(MAPS['le-col']);
    expect(typeof parseMapText(text)).toBe('object');
  });
});
