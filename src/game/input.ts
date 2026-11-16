import { Raycaster, Vector2, Vector3, type Camera, type Object3D } from 'three';
import { type GameMap, heightAt } from '../map';
import { FP } from '../sim/fixed';
import type { Command, Entity, World } from '../sim/world';

const DRAG_PX = 5;
const PICK_PX = 22;
const DOUBLE_TAP_MS = 350;

export interface InputHooks {
  camera: () => Camera;
  terrain: Object3D;
  /** 3D roots of entities, each with userData.id. */
  roots: () => Object3D[];
  issue: (c: Command) => void;
  focus: (x: number, z: number) => void;
  /** Lets the HUD take a click first (e.g. to place a building); true if consumed. */
  click?: (button: number, ground: Vector3 | null, shift: boolean, target?: Entity) => boolean;
  /** An order was given at a ground point (tiles), maybe on an entity: show it. */
  ordered?: (x: number, z: number, target?: Entity) => void;
  /** Touch: move the camera by a finger drag (pixels) and zoom by a pinch factor. */
  pan: (dx: number, dy: number) => void;
  zoom: (factor: number) => void;
}

const LONG_PRESS_MS = 400;
const TAP_SLOP_PX = 12;
type TouchMode = 'pending' | 'pan' | 'box' | 'pinch';

/** Mouse and keyboard: selection, control groups and right-click orders for the local player. */
export class Input {
  readonly selected = new Set<number>();
  /** Ground point under the cursor, in world units. */
  hover: Vector3 | null = null;
  private readonly groups = new Map<string, number[]>();
  private readonly box = document.createElement('div');
  private dragStart: { x: number; y: number } | null = null;
  private lastGroupTap = { key: '', time: 0 };
  private readonly raycaster = new Raycaster();

  constructor(
    private readonly world: World,
    private readonly map: GameMap,
    private readonly player: number,
    private readonly hooks: InputHooks,
    canvas: HTMLCanvasElement,
  ) {
    this.box.className = 'selection-box';
    this.box.hidden = true;
    document.body.appendChild(this.box);

    window.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return this.touchDown(e, canvas);
      if (e.button === 1) {
        // Middle button: grab and drag the map.
        e.preventDefault();
        this.grab = { x: e.clientX, y: e.clientY };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      const ground = this.groundAt(e.clientX, e.clientY);
      if (this.hooks.click?.(e.button, ground, e.shiftKey, this.entityAt(e.clientX, e.clientY))) return;
      if (e.button === 0) {
        this.dragStart = { x: e.clientX, y: e.clientY };
        canvas.setPointerCapture(e.pointerId);
      } else if (e.button === 2 && ground) {
        this.orderAt(ground.x, ground.z, this.entityAt(e.clientX, e.clientY));
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      this.hover = this.groundAt(e.clientX, e.clientY);
      if (e.pointerType === 'touch') return this.touchMove(e);
      if (this.grab) {
        this.hooks.pan(e.clientX - this.grab.x, e.clientY - this.grab.y);
        this.grab = { x: e.clientX, y: e.clientY };
        return;
      }
      if (!this.dragStart) return;
      const r = this.rect(this.dragStart, e);
      this.box.hidden = r.w < DRAG_PX && r.h < DRAG_PX;
      Object.assign(this.box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    });
    canvas.addEventListener('pointercancel', (e) => this.touches.delete(e.pointerId));
    canvas.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') return this.touchUp(e);
      if (e.button === 1) this.grab = null;
      if (e.button !== 0 || !this.dragStart) return;
      const r = this.rect(this.dragStart, e);
      this.dragStart = null;
      this.box.hidden = true;
      const click = r.w < DRAG_PX && r.h < DRAG_PX;
      const hit = click ? this.entityAt(e.clientX, e.clientY) : undefined;
      const picked = click ? (hit ? [hit.id] : []) : this.inBox(r);
      if (!e.shiftKey) this.selected.clear();
      for (const id of picked) {
        if (e.shiftKey && click && this.selected.has(id)) this.selected.delete(id);
        else this.selected.add(id);
      }
    });
    window.addEventListener('keydown', (e) => this.groupKey(e));
  }

  // ---------------------------------------------------------------- touch

  /** Last pointer position while the middle button drags the map. */
  private grab: { x: number; y: number } | null = null;
  private readonly touches = new Map<number, { x: number; y: number; sx: number; sy: number }>();
  private touchMode: TouchMode | null = null;
  private longPress = 0;
  private lastTap = { time: 0, type: '' };

  private touchDown(e: PointerEvent, canvas: HTMLCanvasElement): void {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // capture is a convenience: the touch still works without it
    }
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    clearTimeout(this.longPress);
    if (this.touches.size === 1) {
      this.touchMode = 'pending';
      // Hold still a moment, then drag: selection box.
      this.longPress = window.setTimeout(() => {
        if (this.touchMode !== 'pending') return;
        this.touchMode = 'box';
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.box.hidden = false;
        navigator.vibrate?.(15);
      }, LONG_PRESS_MS);
    } else {
      this.touchMode = 'pinch';
      this.box.hidden = true;
      this.dragStart = null;
    }
  }

  private touchMove(e: PointerEvent): void {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    const pts = [...this.touches.values()];
    if (this.touchMode === 'pinch' && pts.length >= 2) {
      // Pinch: zoom by the change in finger spread, pan with the midpoint.
      const [a, b] = pts;
      const before = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      t.x = e.clientX;
      t.y = e.clientY;
      const after = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (before > 0 && after > 0) this.hooks.zoom(before / after);
      this.hooks.pan((pts[0].x + pts[1].x) / 2 - mx, (pts[0].y + pts[1].y) / 2 - my);
      return;
    }
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    t.x = e.clientX;
    t.y = e.clientY;
    if (this.touchMode === 'pending' && Math.hypot(e.clientX - t.sx, e.clientY - t.sy) > TAP_SLOP_PX) {
      this.touchMode = 'pan';
      clearTimeout(this.longPress);
    }
    if (this.touchMode === 'pan') this.hooks.pan(dx, dy);
    if (this.touchMode === 'box' && this.dragStart) {
      const r = this.rect(this.dragStart, e);
      Object.assign(this.box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    }
  }

  private touchUp(e: PointerEvent): void {
    clearTimeout(this.longPress);
    const mode = this.touchMode;
    this.touches.delete(e.pointerId);
    if (this.touches.size > 0) return;
    this.touchMode = null;
    if (mode === 'box' && this.dragStart) {
      const r = this.rect(this.dragStart, e);
      this.dragStart = null;
      this.box.hidden = true;
      const ids = this.inBox(r);
      if (ids.length) {
        this.selected.clear();
        ids.forEach((id) => this.selected.add(id));
      }
      return;
    }
    if (mode === 'pending') this.tap(e.clientX, e.clientY);
  }

  /** A tap: select own things; with a selection, order on anything else; double tap selects all of a kind. */
  private tap(x: number, y: number): void {
    const ground = this.groundAt(x, y);
    const target = this.entityAt(x, y);
    if (this.hooks.click?.(0, ground, false, target)) return;
    const now = performance.now();
    if (target && target.owner === this.player) {
      if (this.lastTap.type === target.type && now - this.lastTap.time < DOUBLE_TAP_MS) {
        const same = [...this.world.entities.values()].filter((e) => e.owner === this.player && e.type === target.type && this.onScreen(e));
        same.forEach((e) => this.selected.add(e.id));
      } else {
        this.selected.clear();
        this.selected.add(target.id);
      }
      this.lastTap = { time: now, type: target.type };
      return;
    }
    if (this.own().length && ground) {
      this.orderAt(ground.x, ground.z, target);
      return;
    }
    this.selected.clear();
    if (target) this.selected.add(target.id); // inspect an enemy or a resource
  }

  private onScreen(e: Entity): boolean {
    const s = this.screenOf(e);
    return s.x >= 0 && s.y >= 0 && s.x <= window.innerWidth && s.y <= window.innerHeight;
  }

  /** Selects every own combat unit (F2, or the Army button). */
  selectArmy(): void {
    this.selected.clear();
    for (const e of this.world.entities.values()) {
      if (e.owner === this.player && e.def.kind === 'unit' && !(e.def as { worker?: boolean }).worker) this.selected.add(e.id);
    }
  }

  /** Own selected entities. */
  own(): Entity[] {
    return [...this.selected].map((id) => this.world.entities.get(id)).filter((e): e is Entity => !!e && e.owner === this.player);
  }

  /** Right-click at a ground point (in tiles), optionally on an entity. */
  orderAt(x: number, z: number, target?: Entity): void {
    const ids = this.own().map((e) => e.id);
    if (!ids.length) return;
    this.hooks.issue({ player: this.player, kind: 'smart', ids, x: Math.round(x * FP), y: Math.round(z * FP), target: target?.id });
    this.hooks.ordered?.(x, z, target);
  }

  /** Drops dead entities from the selection. */
  prune(): void {
    for (const id of this.selected) if (!this.world.entities.has(id)) this.selected.delete(id);
  }

  private groupKey(e: KeyboardEvent): void {
    if (e.key === 'F2') {
      e.preventDefault();
      return this.selectArmy();
    }
    if (!/^Digit[0-9]$/.test(e.code)) return;
    const k = e.code;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      this.groups.set(k, this.own().map((u) => u.id));
      return;
    }
    const ids = (this.groups.get(k) ?? []).filter((id) => this.world.entities.has(id));
    if (!ids.length) return;
    this.selected.clear();
    ids.forEach((id) => this.selected.add(id));
    const now = performance.now();
    if (this.lastGroupTap.key === k && now - this.lastGroupTap.time < DOUBLE_TAP_MS) {
      const es = ids.map((id) => this.world.entities.get(id)!);
      this.hooks.focus(es.reduce((s, u) => s + u.x, 0) / es.length / FP, es.reduce((s, u) => s + u.y, 0) / es.length / FP);
    }
    this.lastGroupTap = { key: k, time: now };
  }

  private rect(a: { x: number; y: number }, b: { clientX: number; clientY: number }) {
    return { x: Math.min(a.x, b.clientX), y: Math.min(a.y, b.clientY), w: Math.abs(b.clientX - a.x), h: Math.abs(b.clientY - a.y) };
  }

  private screenOf(e: Entity): { x: number; y: number } {
    const x = e.x / FP;
    const z = e.y / FP;
    const v = new Vector3(x, heightAt(this.map, x, z) + 0.4, z).project(this.hooks.camera());
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
  }

  private ndc(x: number, y: number): Vector2 {
    return new Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  }

  /** Entity under the cursor: a mesh hit, else the closest unit within a few pixels. */
  private entityAt(x: number, y: number): Entity | undefined {
    this.raycaster.setFromCamera(this.ndc(x, y), this.hooks.camera());
    for (const hit of this.raycaster.intersectObjects(this.hooks.roots(), true)) {
      let o: Object3D | null = hit.object;
      while (o && o.userData.id === undefined) o = o.parent;
      const e = o && this.world.entities.get(o.userData.id);
      if (e && hit.object.visible) return e;
    }
    let best: Entity | undefined;
    let bestD = PICK_PX;
    for (const e of this.world.entities.values()) {
      if (e.def.kind !== 'unit' || !this.world.sees(this.player, e)) continue;
      const s = this.screenOf(e);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) [best, bestD] = [e, d];
    }
    return best;
  }

  /** Own units inside a screen rectangle. */
  private inBox(r: { x: number; y: number; w: number; h: number }): number[] {
    return [...this.world.entities.values()]
      .filter((e) => e.owner === this.player && e.def.kind === 'unit')
      .filter((e) => {
        const s = this.screenOf(e);
        return s.x >= r.x && s.x <= r.x + r.w && s.y >= r.y && s.y <= r.y + r.h;
      })
      .map((e) => e.id);
  }

  private groundAt(x: number, y: number): Vector3 | null {
    this.raycaster.setFromCamera(this.ndc(x, y), this.hooks.camera());
    return this.raycaster.intersectObject(this.hooks.terrain)[0]?.point ?? null;
  }
}
