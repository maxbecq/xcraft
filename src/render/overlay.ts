import { Vector3, type Camera } from 'three';
import type { BuildingDef } from '../data';
import { type GameMap, heightAt } from '../map';
import { FP } from '../sim/fixed';
import type { Entity, World } from '../sim/world';

/** 2D layer over the 3D view: health bars of selected and wounded entities. */
export class Overlay {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly v = new Vector3();

  constructor(private readonly map: GameMap) {
    this.canvas.className = 'overlay';
    this.ctx = this.canvas.getContext('2d')!;
  }

  draw(world: World, camera: Camera, selected: ReadonlySet<number>, sees: (e: Entity) => boolean, alpha: number): void {
    const dpr = window.devicePixelRatio;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const e of world.entities.values()) {
      if (e.def.kind === 'resource' || !e.maxHp) continue;
      if (!selected.has(e.id) && e.hp >= e.maxHp && e.shield >= e.maxShield) continue;
      if (!sees(e)) continue;
      const size = e.def.kind === 'building' ? (e.def as BuildingDef).size : 0;
      const x = (e.px + (e.x - e.px) * alpha) / FP;
      const z = (e.py + (e.y - e.py) * alpha) / FP;
      this.v.set(x, heightAt(this.map, x, z) + (size ? 1.2 + size * 0.45 : 1.05), z).project(camera);
      if (this.v.z > 1) continue;
      const sx = ((this.v.x + 1) / 2) * w;
      const sy = ((1 - this.v.y) / 2) * h;
      if (sx < -50 || sy < -20 || sx > w + 50 || sy > h + 20) continue;
      const bw = size ? 14 * size : 26;
      const f = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(sx - bw / 2 - 1, sy - 1, bw + 2, 5);
      ctx.fillStyle = f > 0.6 ? '#5fd35f' : f > 0.3 ? '#e0c04f' : '#e0503f';
      ctx.fillRect(sx - bw / 2, sy, bw * f, 3);
      if (e.maxShield) {
        // Psychic shield: a blue bar above the hp bar.
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(sx - bw / 2 - 1, sy - 5, bw + 2, 4);
        ctx.fillStyle = '#6ac8ff';
        ctx.fillRect(sx - bw / 2, sy - 4, (bw * e.shield) / e.maxShield, 2);
      }
    }
  }
}
