import { Vector3, type Camera } from 'three';
import { type BuildingDef, FLY_HEIGHT, type UnitDef } from '../data';
import { type GameMap, heightAt } from '../map';
import { FP } from '../sim/fixed';
import { type Entity, type Order, type World, flies } from '../sim/world';

/** 2D layer over the 3D view: health bars of selected and wounded entities, order feedback. */
/** A rally point's arrows dive this long (ms), then its ring opens and fades for RALLY_RING. */
const RALLY_DIVE = 450;
const RALLY_RING = 520;

export class Overlay {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly v = new Vector3();
  private readonly right = new Vector3();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  /** Order feedback: where the last right-clicks / taps landed, fading out. */
  private marks: { x: number; z: number; color: string; label: string; t0: number; rally?: boolean; reach?: number }[] = [];

  constructor(private readonly map: GameMap) {
    this.canvas.className = 'overlay';
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** Alt held: every bar shows, unhurt too. */
  showAll = false;
  /** Shift held: the selected units' orders show as a path of waypoints. */
  showQueue = false;

  /** Where a building's model tops out in the world (set by the game from the entity renderer); undefined: not drawn yet. */
  top: (id: number) => number | undefined = () => undefined;

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
    this.right.setFromMatrixColumn(camera.matrixWorld, 0); // the screen's horizontal, in the world
    for (const e of world.entities.values()) {
      if (e.def.kind === 'resource' || !e.maxHp || e.inside) continue;
      if (!this.showAll && !selected.has(e.id) && e.hp >= e.maxHp && e.shield >= e.maxShield) continue;
      if (!sees(e)) continue;
      const size = e.def.kind === 'building' ? (e.def as BuildingDef).size : 0;
      const x = (e.px + (e.x - e.px) * alpha) / FP;
      const z = (e.py + (e.y - e.py) * alpha) / FP;
      // A building's bar sits just above its model's real top (a tower is far taller than its footprint says).
      const top = size ? this.top(e.id) : undefined;
      const y = top !== undefined ? top + 0.25 : heightAt(this.map, x, z) + (size ? 1.2 + size * 0.45 : 1.05) + (flies(e) ? FLY_HEIGHT : 0);
      this.v.set(x, y, z).project(camera);
      if (this.v.z > 1) continue;
      const sx = ((this.v.x + 1) / 2) * w;
      const sy = ((1 - this.v.y) / 2) * h;
      if (sx < -50 || sy < -20 || sx > w + 50 || sy > h + 20) continue;
      // A building's bar spans most of its footprint as drawn on screen (a size × size diamond, √2·size wide),
      // so it scales with the building and the zoom; a unit's stays a fixed small bar.
      let bw = 26;
      if (size) {
        const a = this.a.set(x, 0, z).project(camera);
        const b = this.b.set(x, 0, z).add(this.right).project(camera);
        const perTile = Math.hypot(((b.x - a.x) / 2) * w, ((b.y - a.y) / 2) * h); // pixels per world unit, across
        bw = Math.max(30, 0.7 * Math.SQRT2 * size * perTile);
      }
      const bh = size ? Math.max(3, Math.min(6, bw / 30)) : 3; // thicker on the big ones
      const f = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(sx - bw / 2 - 1, sy - 1, bw + 2, bh + 2);
      ctx.fillStyle = f > 0.6 ? '#5fd35f' : f > 0.3 ? '#e0c04f' : '#e0503f';
      ctx.fillRect(sx - bw / 2, sy, bw * f, bh);
      if ((e.def as UnitDef).levels) {
        // A god's level: as many gold notches after the bar.
        ctx.fillStyle = '#f2c14e';
        for (let i = 0; i < e.lvl; i++) ctx.fillRect(sx + bw / 2 + 3 + i * 4, sy - 1, 2, bh + 2);
      }
      if (e.maxShield) {
        // Psychic shield: a blue bar above the hp bar.
        const sh = Math.max(2, bh - 1);
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(sx - bw / 2 - 1, sy - sh - 3, bw + 2, sh + 2);
        ctx.fillStyle = '#6ac8ff';
        ctx.fillRect(sx - bw / 2, sy - sh - 2, (bw * e.shield) / e.maxShield, sh);
      }
    }
    if (this.showQueue) this.drawQueue(world, camera, selected, w, h);
    this.drawMarks(camera, w, h);
  }

  /** Whether two players are at war; set by the game (teams). */
  hostile = (a: number, b: number) => a >= 0 && b >= 0 && a !== b;

  /**
   * Shows that an order was taken: a ring that tightens on the spot (green: move, gold: harvest,
   * red: attack) and, on a resource, how much is left in it. A rally point set for buildings shows instead four
   * arrows diving onto the spot from above, then a brief ring there: on a clicked unit, building or field, onto the
   * thing itself, round its middle and as wide as it.
   */
  mark(player: number, x: number, z: number, target?: Entity, rally = false): void {
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
    if (rally) color = '#7fe8ff';
    // How far from the middle the arrows strike: the thing's own edge, or the very spot on open ground.
    const d = target?.def as { kind: string; size?: number; radius?: number } | undefined;
    const reach = !d ? 0 : d.kind === 'unit' ? (d.radius ?? 0.4) : (d.size ?? 1) * 0.5;
    this.marks.push({ x, z, color, label, t0: performance.now(), rally, reach });
    if (this.marks.length > 6) this.marks.shift();
  }

  /** Where an order leads (tiles) and its colour: green to go or work, red to fight, gold to cast. */
  private orderPoint(world: World, o: Order): [number, number, string] | null {
    const at = (id: number): [number, number] | null => {
      const t = world.entities.get(id);
      return t ? [t.x / FP, t.y / FP] : null;
    };
    switch (o.kind) {
      case 'move': return [o.x / FP, o.y / FP, '#4dff6a'];
      case 'attackMove': return [o.x / FP, o.y / FP, '#ff6a4a'];
      case 'cast': return [o.x / FP, o.y / FP, '#ffd860'];
      case 'build': return [o.tx + 0.5, o.ty + 0.5, '#4dff6a'];
      case 'attack': { const p = at(o.target); return p && [...p, '#ff6a4a']; }
      case 'gather': case 'construct': case 'enter': case 'heal': case 'repair': { const p = at(o.target); return p && [...p, '#4dff6a']; }
    }
  }

  /** The selected units' current and queued orders: a dotted path from each unit through its waypoints. */
  private drawQueue(world: World, camera: Camera, selected: ReadonlySet<number>, w: number, h: number): void {
    const ctx = this.ctx;
    const screen = (x: number, z: number): [number, number] => {
      this.v.set(x, heightAt(this.map, x, z) + 0.05, z).project(camera);
      return [((this.v.x + 1) / 2) * w, ((1 - this.v.y) / 2) * h];
    };
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    for (const id of selected) {
      const e = world.entities.get(id);
      if (!e || e.def.kind !== 'unit' || !e.order) continue;
      let [px, py] = screen(e.x / FP, e.y / FP);
      for (const o of [e.order, ...e.next]) {
        const p = this.orderPoint(world, o);
        if (!p) continue;
        const [sx, sy] = screen(p[0], p[1]);
        ctx.strokeStyle = p[2];
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(sx, sy);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = p[2];
        ctx.beginPath();
        ctx.arc(sx, sy, 4, 0, Math.PI * 2);
        ctx.fill();
        [px, py] = [sx, sy];
      }
    }
    ctx.setLineDash([]);
  }

  private drawMarks(camera: Camera, w: number, h: number): void {
    const ctx = this.ctx;
    const now = performance.now();
    this.marks = this.marks.filter((m) => now - m.t0 < 1200);
    for (const m of this.marks) {
      if (m.rally) {
        this.drawRally(m, now - m.t0, camera, w, h);
        continue;
      }
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

  /**
   * A rally point being set: four small arrows swoop down in a curve, one from each diagonal of the ground, and strike
   * the edge of what was clicked (its middle on open ground), faster as they fall (RALLY_DIVE ms); then a ring opens
   * and fades there. Drawn from 3D points, so they follow the camera.
   */
  private drawRally(m: { x: number; z: number; color: string; reach?: number }, t: number, camera: Camera, w: number, h: number): void {
    const ctx = this.ctx;
    const ground = heightAt(this.map, m.x, m.z) + 0.05;
    const reach = m.reach ?? 0;
    const at = (dx: number, dy: number, dz: number): [number, number] => {
      this.v.set(m.x + dx, ground + dy, m.z + dz).project(camera);
      return [((this.v.x + 1) / 2) * w, ((1 - this.v.y) / 2) * h];
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (t < RALLY_DIVE) {
      const p = t / RALLY_DIVE;
      // Along a quadratic curve: out wide and high, over the thing's edge, down onto it; the arrows wheel a quarter
      // turn on the way, so they swoop rather than slide.
      const path = (q: number, a0: number): [number, number] => {
        const e = q * q;
        const r = (reach + 1.4) * (1 - e) ** 2 + 2 * (1 - e) * e * (reach + 0.5) + e * e * (reach + 0.05);
        const y = 1.6 * (1 - e) ** 2 + 2 * (1 - e) * e * 1.5 + e * e * 0.05;
        const a = a0 + (1 - e) * 0.9;
        return at(Math.cos(a) * r, y, Math.sin(a) * r);
      };
      for (let k = 0; k < 4; k++) {
        const a0 = Math.PI / 4 + (k * Math.PI) / 2;
        const trail: [number, number][] = [];
        for (let i = 0; i <= 6; i++) trail.push(path(Math.max(0, p - 0.22 + (0.22 * i) / 6), a0));
        const tip = trail[6];
        const prev = trail[5];
        const a = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
        for (const [color, width] of [['rgba(0, 0, 0, 0.6)', 5], [m.color, 2.5]] as const) {
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.beginPath();
          trail.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.moveTo(tip[0] - Math.cos(a - 0.6) * 7, tip[1] - Math.sin(a - 0.6) * 7);
          ctx.lineTo(...tip);
          ctx.lineTo(tip[0] - Math.cos(a + 0.6) * 7, tip[1] - Math.sin(a + 0.6) * 7);
          ctx.stroke();
        }
      }
      return;
    }
    const k = (t - RALLY_DIVE) / RALLY_RING;
    if (k >= 1) return;
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = m.color;
    ctx.shadowColor = m.color;
    ctx.shadowBlur = 10;
    ctx.lineWidth = 3 * (1 - k) + 1.2;
    const r = reach + 0.2 + 0.45 * k;
    ctx.beginPath();
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const [sx, sy] = at(Math.cos(a) * r, 0, Math.sin(a) * r);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
}
