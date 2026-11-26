import { Group, Mesh, BoxGeometry, MeshBasicMaterial, OrthographicCamera, Raycaster, Vector2 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Entity } from '../sim/world';
import { Input } from './input';

// input.ts sets its cursors on the page as it loads.
vi.hoisted(() => {
  (globalThis as { document?: unknown }).document ??= { documentElement: { style: { setProperty() {} } } };
});

// Input bound to nothing: only the fields the methods under test read.
const bare = (fields: Record<string, unknown>) => Object.assign(Object.create(Input.prototype), fields) as Record<string, any>;

describe('a tap with a worker selected', () => {
  const worker = { id: 1, type: 'ouvrier', owner: 0, buildLeft: 0, def: { kind: 'unit', worker: true } } as unknown as Entity;
  const other = { id: 2, type: 'soldat', owner: 0, buildLeft: 0, def: { kind: 'unit' } } as unknown as Entity;
  const field = { id: 3, type: 'minerai', owner: -1, buildLeft: 0, def: { kind: 'resource' } } as unknown as Entity;
  const tapping = (picks: (harvest: boolean) => Entity | undefined) => {
    const orders: (Entity | undefined)[] = [];
    const input = bare({
      player: 0,
      army: false,
      selected: new Set([worker.id]),
      lastTap: { time: 0, type: '' },
      hooks: {},
      world: { entities: new Map([[1, worker], [2, other], [3, field]]) },
      groundAt: () => ({ x: 4, z: 4 }),
      entityAt: (_x: number, _y: number, harvest = false) => picks(harvest),
      orderAt: (_x: number, _z: number, target?: Entity) => orders.push(target),
    });
    input.tap(10, 10);
    return { input, orders };
  };

  it('on the edge of another of ours standing before a field selects that unit, no harvest given', () => {
    const { input, orders } = tapping((harvest) => (harvest ? field : other));
    expect(orders).toEqual([]);
    expect([...input.selected]).toEqual([other.id]);
  });

  it('on the field, the order harvests it', () => {
    const { orders } = tapping((harvest) => (harvest ? field : undefined));
    expect(orders).toEqual([field]);
  });
});

describe('what the ray under the cursor skips', () => {
  it('a mesh inside a group marked noPick (a well\'s sparks) is not the well', () => {
    const well = { id: 5, def: { kind: 'resource' } } as unknown as Entity;
    const root = new Group();
    root.userData.id = 5;
    const fx = new Group();
    fx.userData.noPick = true;
    const spark = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    fx.add(spark);
    root.add(fx);
    root.updateMatrixWorld(true);
    const camera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld(true);
    const input = bare({
      raycaster: new Raycaster(),
      hooks: { camera: () => camera, roots: () => [root] },
      world: { entities: new Map([[5, well]]) },
      map: { width: 8 },
      ndc: () => new Vector2(0, 0),
      caughtAt: () => undefined,
    });
    expect(input.entityAt(0, 0)).toBeUndefined();
    fx.userData.noPick = false;
    expect(input.entityAt(0, 0)).toBe(well);
  });
});
