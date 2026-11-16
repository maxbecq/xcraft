import { Vector3, type Camera } from 'three';
import type { BuildingDef } from '../data';
import { type GameMap, heightAt } from '../map';
import { FP } from '../sim/fixed';
import type { Entity, World } from '../sim/world';

/** 2D layer over the 3D view: health bars of selected and wounded entities, order feedback. */
export class Overlay {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly v = new Vector3();
  /** Order feedback: where the last right-clicks / taps landed, fading out. */
  private marks: { x: number; z: number; color: string; label: string; t0: number }[] = [];

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
      // Sized like the 3D view, in pixels: on phones 100vh is taller than the visible window.
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const e of world.entities.values()) {
      if (e.def.kind === 'resource' || !e.maxHp || e.inside) continue;
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
    this.drawMarks(camera, w, h);
  }

  /** Whether two players are at war; set by the game (teams). */
  hostile = (a: number, b: number) => a >= 0 && b >= 0 && a !== b;

  /**
   * Shows that an order was taken: a ring that tightens on the spot (green: move, gold: harvest,
   * red: attack) and, on a resource, how much is left in it.
   */
  mark(player: number, x: number, z: number, target?: Entity): void {
    let color = '#8dff8a';
    let label = '';
    if (target?.def.kind === 'resource') {
      color = '#ffd860';
      label = Number.isFinite(target.amount) ? `${target.def.name} : ${target.amount}` : `${target.def.name} : inépuisable`;
      x = target.x / FP;
      z = target.y / FP;
    } else if (target && this.hostile(target.owner, player)) {
      color = '#ff6a4a';
      x = target.x / FP;
      z = target.y / FP;
    } else if (target) {
      x = target.x / FP;
      z = target.y / FP;
    }
    this.marks.push({ x, z, color, label, t0: performance.now() });
    if (this.marks.length > 6) this.marks.shift();
  }

  private drawMarks(camera: Camera, w: number, h: number): void {
    const ctx = this.ctx;
    const now = performance.now();
    this.marks = this.marks.filter((m) => now - m.t0 < 1200);
    for (const m of this.marks) {
      const k = (now - m.t0) / 1200; // 0 → 1
      const y = heightAt(this.map, m.x, m.z) + 0.05;
      const r = 0.9 * (1 - k * 0.6);
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 3.5;
      ctx.shadowColor = m.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        this.v.set(m.x + Math.cos(a) * r, y, m.z + Math.sin(a) * r).project(camera);
        const sx = ((this.v.x + 1) / 2) * w;
        const sy = ((1 - this.v.y) / 2) * h;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      if (m.label) {
        this.v.set(m.x, y + 1.4 + k * 0.4, m.z).project(camera);
        ctx.font = '700 17px Rajdhani, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.shadowBlur = 0;
        const sx = ((this.v.x + 1) / 2) * w;
        const sy = ((1 - this.v.y) / 2) * h;
        ctx.strokeText(m.label, sx, sy);
        ctx.fillStyle = m.color;
        ctx.fillText(m.label, sx, sy);
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }
}
