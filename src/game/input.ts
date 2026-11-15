import { Raycaster, Vector2, Vector3, type Camera, type Object3D } from 'three';
import { type GameMap, heightAt } from '../map';
import { FP } from '../sim/fixed';
import type { Command, Entity, World } from '../sim/world';

const DRAG_PX = 5;
const DOUBLE_TAP_MS = 350;

/** Mouse and keyboard: selection, control groups and orders for the local player. */
export class Input {
  readonly selected = new Set<number>();
  private readonly groups = new Map<string, number[]>();
  private readonly box = document.createElement('div');
  private dragStart: { x: number; y: number } | null = null;
  private lastGroupTap = { key: '', time: 0 };
  private readonly raycaster = new Raycaster();

  constructor(
    private readonly world: World,
    private readonly map: GameMap,
    private readonly player: number,
    private readonly camera: () => Camera,
    private readonly terrain: Object3D,
    private readonly issue: (c: Command) => void,
    private readonly focus: (x: number, z: number) => void,
    canvas: HTMLCanvasElement,
  ) {
    this.box.className = 'selection-box';
    this.box.hidden = true;
    document.body.appendChild(this.box);

    window.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) {
        this.dragStart = { x: e.clientX, y: e.clientY };
        canvas.setPointerCapture(e.pointerId);
      } else if (e.button === 2) {
        const p = this.groundAt(e.clientX, e.clientY);
        if (p) this.orderAt(p.x, p.z);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
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
      const picked = r.w < DRAG_PX && r.h < DRAG_PX ? this.pick(e.clientX, e.clientY) : this.inBox(r);
      if (!e.shiftKey) this.selected.clear();
      for (const id of picked) {
        if (e.shiftKey && picked.length === 1 && this.selected.has(id)) this.selected.delete(id);
        else this.selected.add(id);
      }
    });
    window.addEventListener('keydown', (e) => this.key(e));
  }

  /** Right-click on the ground (or the minimap), in tiles. */
  orderAt(x: number, z: number): void {
    const ids = this.ownSelection();
    if (ids.length) this.issue({ player: this.player, kind: 'move', ids, x: Math.round(x * FP), y: Math.round(z * FP) });
  }

  private ownSelection(): number[] {
    return [...this.selected].filter((id) => this.world.entities.get(id)?.owner === this.player);
  }

  private key(e: KeyboardEvent): void {
    if (/^Digit[0-9]$/.test(e.code)) {
      const k = e.code;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.groups.set(k, this.ownSelection());
        return;
      }
      const ids = (this.groups.get(k) ?? []).filter((id) => this.world.entities.has(id));
      if (!ids.length) return;
      this.selected.clear();
      ids.forEach((id) => this.selected.add(id));
      const now = performance.now();
      if (this.lastGroupTap.key === k && now - this.lastGroupTap.time < DOUBLE_TAP_MS) {
        const es = ids.map((id) => this.world.entities.get(id)!);
        this.focus(es.reduce((s, u) => s + u.x, 0) / es.length / FP, es.reduce((s, u) => s + u.y, 0) / es.length / FP);
      }
      this.lastGroupTap = { key: k, time: now };
    } else if (e.code === 'KeyS' && !e.ctrlKey && !e.metaKey) {
      const ids = this.ownSelection();
      if (ids.length) this.issue({ player: this.player, kind: 'stop', ids });
    }
  }

  private rect(a: { x: number; y: number }, b: { clientX: number; clientY: number }) {
    return { x: Math.min(a.x, b.clientX), y: Math.min(a.y, b.clientY), w: Math.abs(b.clientX - a.x), h: Math.abs(b.clientY - a.y) };
  }

  private screenOf(e: Entity): { x: number; y: number } {
    const x = e.x / FP;
    const z = e.y / FP;
    const v = new Vector3(x, heightAt(this.map, x, z) + 0.4, z).project(this.camera());
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
  }

  private units(): Entity[] {
    return [...this.world.entities.values()].filter((e) => e.def.kind === 'unit');
  }

  /** Closest unit under the cursor. */
  private pick(x: number, y: number): number[] {
    let best: Entity | null = null;
    let bestD = 22;
    for (const e of this.units()) {
      const s = this.screenOf(e);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) [best, bestD] = [e, d];
    }
    return best ? [best.id] : [];
  }

  /** Own units inside a screen rectangle. */
  private inBox(r: { x: number; y: number; w: number; h: number }): number[] {
    return this.units()
      .filter((e) => e.owner === this.player)
      .filter((e) => {
        const s = this.screenOf(e);
        return s.x >= r.x && s.x <= r.x + r.w && s.y >= r.y && s.y <= r.y + r.h;
      })
      .map((e) => e.id);
  }

  private groundAt(x: number, y: number): Vector3 | null {
    this.raycaster.setFromCamera(new Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1), this.camera());
    return this.raycaster.intersectObject(this.terrain)[0]?.point ?? null;
  }
}
