/**
 * A building ordered: shown at once where it will rise, before its worker gets there (remark 91, touch screens). The
 * outline of its footprint, white, spreads out and fades, three waves one after the other; then it stays there, still
 * and faint, until the site starts, or the order is cancelled or dropped (the user's choice of 2026-11-23).
 */
import { AdditiveBlending, Mesh, MeshBasicMaterial, type Scene, Shape, ShapeGeometry } from 'three';
import { type BuildingDef, DEFS } from '../data';
import { type GameMap, heightAt } from '../map';
import type { World } from '../sim/world';

/** A square frame one unit wide, its border this share of the side. */
const FRAME = (() => {
  const s = new Shape().moveTo(-0.5, -0.5).lineTo(0.5, -0.5).lineTo(0.5, 0.5).lineTo(-0.5, 0.5).lineTo(-0.5, -0.5);
  const i = 0.5 - 0.06;
  s.holes.push(new Shape().moveTo(-i, -i).lineTo(-i, i).lineTo(i, i).lineTo(i, -i).lineTo(-i, -i));
  return new ShapeGeometry(s);
})();
const WAVES = 3;
const GAP_MS = 140;
const LIFE_MS = 700;
/** The outline that stays: how faint, how fast it comes in and goes, and how long a worker may take to get the order. */
const STAY_OPACITY = 0.35;
const FADE_MS = 250;
const ORDER_GRACE_MS = 3000;

interface Site {
  mesh: Mesh;
  t0: number;
  type: string;
  tx: number;
  ty: number;
  worker: number;
  /** The worker was seen with the order (it reaches the simulation a tick or more after the tap). */
  seen: boolean;
  /** When it began fading, or -1. */
  gone: number;
}

const frame = (cx: number, y: number, cz: number, size: number) => {
  const mesh = new Mesh(FRAME, new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(cx, y, cz);
  mesh.scale.setScalar(size);
  return mesh;
};

export class PoseConfirm {
  private readonly waves: { mesh: Mesh; t0: number; size: number }[] = [];
  private readonly sites: Site[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly map: GameMap,
  ) {}

  /** The order to raise `type` at (tx, ty) was just given to `worker`. */
  placed(type: string, tx: number, ty: number, worker: number): void {
    const size = (DEFS[type] as BuildingDef).size;
    const cx = tx + size / 2;
    const cz = ty + size / 2;
    const y = heightAt(this.map, cx, cz) + 0.2;
    const now = performance.now();
    for (let i = 0; i < WAVES; i++) {
      const mesh = frame(cx, y, cz, size);
      this.scene.add(mesh);
      this.waves.push({ mesh, t0: now + i * GAP_MS, size });
    }
    const mesh = frame(cx, y, cz, size);
    this.scene.add(mesh);
    this.sites.push({ mesh, t0: now, type, tx, ty, worker, seen: false, gone: -1 });
  }

  /** Each frame: spreads and fades the waves; keeps each outline while its site is still to come. */
  update(world: World): void {
    const now = performance.now();
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const s = this.waves[i];
      const k = (now - s.t0) / LIFE_MS;
      const mat = s.mesh.material as MeshBasicMaterial;
      if (k >= 1) {
        this.drop(s.mesh);
        this.waves.splice(i, 1);
        continue;
      }
      s.mesh.scale.setScalar(s.size * (1 + 0.6 * Math.max(0, k)));
      mat.opacity = k < 0 ? 0 : 0.95 * (1 - k);
    }
    for (let i = this.sites.length - 1; i >= 0; i--) {
      const s = this.sites[i];
      const t = now - s.t0;
      const on = going(world, s);
      s.seen ||= on;
      if (s.gone < 0 && (started(world, s) || (s.seen ? !on : t > ORDER_GRACE_MS))) s.gone = now;
      const out = s.gone < 0 ? 1 : 1 - (now - s.gone) / FADE_MS;
      if (out <= 0) {
        this.drop(s.mesh);
        this.sites.splice(i, 1);
        continue;
      }
      // Comes in as the first wave leaves the footprint behind.
      (s.mesh.material as MeshBasicMaterial).opacity = STAY_OPACITY * Math.min(1, t / LIFE_MS) * out;
    }
  }

  private drop(mesh: Mesh): void {
    this.scene.remove(mesh);
    (mesh.material as MeshBasicMaterial).dispose();
  }
}

/** A building of that type stands at that spot: the site has started. */
function started(world: World, s: Site): boolean {
  for (const e of world.entities.values()) if (e.type === s.type && e.tx === s.tx && e.ty === s.ty && e.def.kind === 'building') return true;
  return false;
}

/** Its worker still has that build to do, now or queued. */
function going(world: World, s: Site): boolean {
  const w = world.entities.get(s.worker);
  if (!w || w.hp <= 0) return false;
  return [w.order, ...w.next].some((o) => o?.kind === 'build' && o.type === s.type && o.tx === s.tx && o.ty === s.ty);
}
