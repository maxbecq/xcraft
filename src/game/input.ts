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
}

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
      if (!this.dragStart) return;
      const r = this.rect(this.dragStart, e);
      this.box.hidden = r.w < DRAG_PX && r.h < DRAG_PX;
      Object.assign(this.box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    });
    canvas.addEventListener('pointerup', (e) => {
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

  /** Own selected entities. */
  own(): Entity[] {
    return [...this.selected].map((id) => this.world.entities.get(id)).filter((e): e is Entity => !!e && e.owner === this.player);
  }

  /** Right-click at a ground point (in tiles), optionally on an entity. */
  orderAt(x: number, z: number, target?: Entity): void {
    const ids = this.own().map((e) => e.id);
    if (!ids.length) return;
    this.hooks.issue({ player: this.player, kind: 'smart', ids, x: Math.round(x * FP), y: Math.round(z * FP), target: target?.id });
  }

  /** Drops dead entities from the selection. */
  prune(): void {
    for (const id of this.selected) if (!this.world.entities.has(id)) this.selected.delete(id);
  }

  private groupKey(e: KeyboardEvent): void {
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
      if (e.def.kind !== 'unit') continue;
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
