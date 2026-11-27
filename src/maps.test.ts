import { describe, expect, it } from 'vitest';
import { createMap, rotateFootprint } from './map';
import { CORNERS, MAPS, buildMap, hqSlot, turnsOf } from './maps';
import { createMatch, expansions } from './sim/setup';
import type { World } from './sim/world';

/** Tiles a ground unit reaches from (x, y), walking. */
function reach(w: World, x: number, y: number): Uint8Array {
  const g = w.grid;
  const seen = new Uint8Array(g.width * g.height);
  const todo = [y * g.width + x];
  seen[todo[0]] = 1;
  while (todo.length) {
    const i = todo.pop()!;
    const [ax, ay] = [i % g.width, Math.floor(i / g.width)];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = (ay + dy) * g.width + ax + dx;
      if (g.inside(ax + dx, ay + dy) && !seen[j] && g.canStep(ax, ay, ax + dx, ay + dy, true)) {
        seen[j] = 1;
        todo.push(j);
      }
    }
  }
  return seen;
}

describe('map files', () => {
  it('the original map is unchanged, tile for tile', () => {
    const fingerprint = (players: number, chasms: boolean) => {
      const m = createMap(players, chasms);
      let h = 2166136261;
      for (let i = 0; i < m.level.length; i++) h = Math.imul(h ^ (m.level[i] + 4 * m.rampStep[i] + 32 * ' NESW'.indexOf(m.ramp[i] ?? ' ') + 256 * (m.chasm?.[i] ?? 0)), 16777619);
      return h >>> 0;
    };
    expect([fingerprint(2, false), fingerprint(4, false), fingerprint(2, true)]).toEqual([2462163747, 3023734073, 2017821987]);
  });

  for (const def of Object.values(MAPS)) {
    for (const players of def.players) {
      describe(`${def.id}, ${players} players`, () => {
        const w = createMatch(Array(players).fill('humains'), undefined, def.id);
        const hqs = [...w.entities.values()].filter((e) => e.type === 'conseil');

        it('has every player on its start', () => {
          expect(hqs.length).toBe(players);
        });

        it('lets every start reach every other start and every base spot on foot', () => {
          const from = reach(w, hqs[0].tx + 2, hqs[0].ty + 5);
          for (const h of hqs) expect(from[(h.ty + 5) * w.map.width + h.tx + 2], `start ${h.owner}`).toBe(1);
          for (const s of w.map.sites!) expect(from[(s.hq[1] + 2) * w.map.width + s.hq[0] + 2], `site ${s.hq}`).toBe(1);
        });

        it('has room for a headquarters on every free base spot', () => {
          for (const s of w.map.sites!) {
            if (s.start && CORNERS.indexOf(s.turn) < players) continue;
            expect(w.canPlace('conseil', s.hq[0], s.hq[1], 0), `site ${s.hq}`).toBe(true);
          }
        });

        it('puts resources on flat ground, each in reach of its base', () => {
          for (const e of w.entities.values()) {
            if (e.def.kind !== 'resource') continue;
            const size = e.type === 'puits' ? 3 : 1;
            const [cx, cy] = [e.tx + (size >> 1), e.ty + (size >> 1)];
            expect(w.grid.flatLevel(cx, cy), `${e.type} at ${cx},${cy}`).toBeGreaterThanOrEqual(0);
            // From the middle of the 4x4 main building (the balancer, 2026-11-22).
            const near = w.map.sites!.some((s) => Math.hypot(s.hq[0] + 2 - (e.tx + size / 2), s.hq[1] + 2 - (e.ty + size / 2)) < 12);
            expect(near, `${e.type} at ${e.tx},${e.ty}`).toBe(true);
          }
        });

        it('gives every base spot 10 mineral fields (the shared centre of Carrefour 12), and a place for its headquarters two free tiles or more from every field', () => {
          // The balancer, 2026-11-26: 10 fields of 2,500 a base; the main building never nearer the fields than HQ_MINERAL_GAP.
          // Carrefour's centre turns onto itself: its file lists 3 fields, made once a quarter, 12 in all (the user, 2026-11-27:
          // not 40, and 10 cannot be shared fairly by four corners).
          const centre = (b: (typeof def.bases)[number]) => def.id === 'carrefour' && b.name === 'centre';
          for (const b of def.bases) expect(b.minerals.length, b.name).toBe(centre(b) ? 3 : 10);
          // Every one of them made, none lost on another's tile once the map is turned, each with its 2,500.
          const fields = [...w.entities.values()].filter((e) => e.type === 'minerai');
          const turns = turnsOf(def, players).length;
          expect(fields.length).toBe(def.bases.reduce((n, b) => n + (centre(b) ? 12 : 10 * turns), 0));
          for (const f of fields) expect(f.amount, `${f.tx},${f.ty}`).toBe(2500);
          for (const q of turnsOf(def, players)) {
            for (const b of def.bases) {
              const [hx, hy] = rotateFootprint(w.map.width, ...hqSlot(def, b.hq), 4, q);
              expect(w.nearMinerals(hx, hy, 4), `${b.name}, quarter ${q}`).toBe(false);
              if (!hqs.some((h) => h.tx === hx && h.ty === hy)) expect(w.canPlace('conseil', hx, hy, 0), `${b.name}, quarter ${q}`).toBe(true);
            }
          }
        });

        it('gives every player somewhere to expand', () => {
          for (let p = 0; p < players; p++) expect(expansions(w, p).length).toBeGreaterThan(0);
        });
      });
    }
  }

  it('Carrefour is also symmetric across its diagonal, so neighbouring corners fight on equal terms', () => {
    // Quarter turns alone give each base a clockwise exit and a different anticlockwise one: in a four-player
    // free-for-all the corner attacking clockwise won most games (26, 14, 5, 3 wins by seat out of 48).
    const w = createMatch(['humains', 'humains', 'humains', 'humains'], undefined, 'carrefour');
    const m = w.map;
    const n = m.width;
    const swap: Record<string, string> = { N: 'W', W: 'N', S: 'E', E: 'S' };
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const [a, b] = [y * n + x, x * n + y];
        expect([m.level[b], m.ramp[b], m.rampStep[b]], `tile ${x},${y}`).toEqual([m.level[a], m.ramp[a] ? swap[m.ramp[a]!] : null, m.rampStep[a]]);
      }
    }
    // The main buildings' places too (a 4x4 in each 5x5 slot, hqSlot), at the starts and the naturals: each one's mirror
    // is one of them. (A 4x4 cannot sit square on the middle of a 111-tile map's edge or centre: the edge and centre
    // bases are off by a tile, as they always were.)
    const def = MAPS.carrefour;
    const slots = new Set(def.bases.filter((b) => b.start || b.name === 'naturelle').flatMap((b) => [0, 1, 2, 3].map((q) => rotateFootprint(n, ...hqSlot(def, b.hq), 4, q).join())));
    for (const s of slots) {
      const [x, y] = s.split(',').map(Number);
      expect(slots.has(`${y},${x}`), `QG ${s}`).toBe(true);
    }
    const resources = [...w.entities.values()].filter((e) => e.def.kind === 'resource');
    const at = new Set(resources.map((e) => `${e.type} ${e.tx},${e.ty}`));
    for (const e of resources) expect(at.has(`${e.type} ${e.ty},${e.tx}`), `${e.type} ${e.tx},${e.ty}`).toBe(true);
  });

  it('builds the same map twice', () => {
    for (const def of Object.values(MAPS)) {
      const a = buildMap(def, Math.max(...def.players));
      const b = buildMap(def, Math.max(...def.players));
      expect(Array.from(a.level)).toEqual(Array.from(b.level));
    }
  });

  it('puts no level under a chasm (the editor writes a chasm tile with no level, and the grid reads it)', () => {
    for (const def of Object.values(MAPS)) {
      const m = buildMap(def, Math.max(...def.players));
      const raised = m.chasm ? [...m.chasm.keys()].filter((i) => m.chasm![i] && m.level[i] !== 0) : [];
      expect(raised.map((i) => `${i % m.width},${Math.floor(i / m.width)}`), def.id).toEqual([]);
    }
  });
});

describe('the Volcan and Astéroïdes planets', () => {
  it('only change the look: every map is the same ground for them as for any planet, and a match starts on it', () => {
    for (const def of Object.values(MAPS)) {
      const plain = buildMap(def, 2, '');
      for (const biome of ['volcan', 'asteroides']) {
        const m = buildMap(def, 2, biome);
        expect([...m.level]).toEqual([...plain.level]);
        expect([...(m.chasm ?? [])]).toEqual([...(plain.chasm ?? [])]);
        expect(createMatch(['humains', 'z'], undefined, def.id, biome).entities.size).toBeGreaterThan(0);
      }
    }
  });
});
