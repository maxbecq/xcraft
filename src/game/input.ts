import { Raycaster, Vector2, Vector3, type Camera, type Object3D } from 'three';
import { type GameMap, heightAt } from '../map';
import { FP } from '../sim/fixed';
import { type Command, type Entity, type World, flies } from '../sim/world';
import { FLY_HEIGHT } from '../data';

const DRAG_PX = 5;
const PICK_PX = 22;
/** Flyers win a click within this distance of where they fly, over anything on the ground. */
const FLYER_PICK_PX = 28;
/** Mineral fields and geysers are small on screen: a wider catch, so a worker order lands on them. */
const RESOURCE_PICK_PX = 45;
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

/** One drawing of a cursor: SVG strokes on a 32 px box, in a colour, at an opacity (for cross-fades). */
interface Layer {
  color: string;
  shape: string;
  opacity?: number;
}

/** Cursor image from layers: each a soft halo of its colour, a dark outline, then the colour; hotspot in the middle. */
function cursorOf(...layers: Layer[]): string {
  const draw = ({ color, shape, opacity = 1 }: Layer) =>
    `<g opacity='${opacity.toFixed(2)}'><g stroke='${color}' stroke-width='5' opacity='.45' filter='url(#h)'>${shape}</g><g stroke='#000' stroke-width='3' opacity='.7'>${shape}</g><g stroke='${color}' stroke-width='1.5'>${shape}</g></g>`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><defs><filter id='h' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='1.4'/></filter></defs><g fill='none' stroke-linecap='round' stroke-linejoin='round'>${layers.map(draw).join('')}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 16, default`;
}

/** The game's arrow: bronze body, gold edge, its tip on the hotspot. */
const ARROW: Layer = { color: '#e8b64a', shape: "<path fill='#2b2010' d='M16.6 16.6L17 29.2L20.3 25.9L23.1 31L25.7 29.7L22.9 24.6L27.5 24.2Z'/><path stroke-width='1' opacity='.6' d='M18.4 20.2L18.6 25.6'/>" };
// The arrow everywhere outside the map's own cursors (menus, console); buttons keep their hand.
document.documentElement.style.setProperty('--arrow', cursorOf(ARROW));

/**
 * Corner brackets of a ground square seen in isometric view: a 2:1 diamond, `w` from centre to side corner,
 * turned by `turn` radians on the ground.
 */
function isoCorners(w: number, turn = 0): string {
  const arm = 0.26; // bracket arm, as a share of the square's side
  const p = Array.from({ length: 4 }, (_, k) => {
    const a = turn - Math.PI / 2 + (k * Math.PI) / 2;
    return [16 + w * Math.cos(a), 16 + (w / 2) * Math.sin(a)];
  });
  const f = (v: number) => v.toFixed(2);
  return `<path d='${p
    .map(([cx, cy], k) => {
      const [[ax, ay], [bx, by]] = [p[(k + 3) % 4], p[(k + 1) % 4]];
      return `M${f(cx + (ax - cx) * arm)} ${f(cy + (ay - cy) * arm)}L${f(cx)} ${f(cy)}L${f(cx + (bx - cx) * arm)} ${f(cy + (by - cy) * arm)}`;
    })
    .join('')}'/>`;
}

const cursorCache = new Map<string, string[]>();
const steady = new Map<string, string>();
const cached = (key: string, make: () => string[]) => cursorCache.get(key) ?? cursorCache.set(key, make()).get(key)!;

/** Over something selectable (SC1 lens): corner brackets turning slowly on the ground round a flat ring, a quarter turn in 12 frames. */
const HOVER_FRAMES = 12;
const hoverLayers = (color: string): Layer[] =>
  Array.from({ length: HOVER_FRAMES }, (_, f) => ({ color, shape: `${isoCorners(13, (f / HOVER_FRAMES) * (Math.PI / 2))}<ellipse cx='16' cy='16' rx='3.5' ry='1.75'/>` }));

/** Aiming an attack or an ability: a reticle lying on the ground, its four ticks turning round it. */
const aimFrames = (color: string) =>
  cached(`aim${color}`, () =>
    Array.from({ length: 8 }, (_, f) => {
      let ticks = '';
      for (let k = 0; k < 4; k++) {
        const a = ((f / 8 + k) * Math.PI) / 2;
        const [c, s] = [Math.cos(a), Math.sin(a)];
        ticks += `M${(16 + 13 * c).toFixed(2)} ${(16 + 6.5 * s).toFixed(2)}L${(16 + 7.5 * c).toFixed(2)} ${(16 + 3.75 * s).toFixed(2)}`;
      }
      return cursorOf({ color, shape: `<ellipse cx='16' cy='16' rx='10' ry='5'/><path d='${ticks}'/><ellipse cx='16' cy='16' rx='1.2' ry='0.6'/>` });
    }),
  );

/** Right-click order given: green brackets snapping shut on the spot. */
const orderFrames = () => cached('order', () => [14, 10.5, 7, 4].map((w) => cursorOf({ color: '#4dff6a', shape: isoCorners(w) })));
/** Cross-fade between the arrow and the hover brackets (and between hover colours), in ms. */
const FADE_MS = 180;
const ORDER_FRAME_MS = 70;
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
    private readonly canvas: HTMLCanvasElement,
  ) {
    window.setInterval(() => this.animateCursor(), 60);
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
      if (e.button === 2 && !this.own().length) {
        // Right button with none of ours selected (no order to give): it grabs and drags the map instead.
        this.grab = { x: e.clientX, y: e.clientY };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button === 0) {
        this.dragStart = { x: e.clientX, y: e.clientY };
        canvas.setPointerCapture(e.pointerId);
      } else if (e.button === 2 && ground) {
        this.orderAt(ground.x, ground.z, this.entityAt(e.clientX, e.clientY), e.shiftKey);
        this.orderedAt = performance.now();
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      this.hover = this.groundAt(e.clientX, e.clientY);
      if (e.pointerType === 'touch') return this.touchMove(e);
      this.hoverCursor(e.clientX, e.clientY);
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
      if (e.button === 1 || e.button === 2) this.grab = null;
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

  /** Own workers with nothing to do (those sheltering in a bunker are busy). */
  idleWorkers(): Entity[] {
    return [...this.world.entities.values()].filter((e) => e.owner === this.player && (e.def as { worker?: boolean }).worker && !e.order && !e.inside);
  }

  private idleTurn = 0;

  /** Selects every idle worker and centres the view on the next one in turn (the idle-workers button). */
  selectIdleWorkers(): void {
    const idle = this.idleWorkers();
    if (!idle.length) return;
    this.selected.clear();
    for (const e of idle) this.selected.add(e.id);
    const e = idle[this.idleTurn++ % idle.length];
    this.hooks.focus(e.x / FP, e.y / FP);
  }

  /** Own selected entities. */
  own(): Entity[] {
    return [...this.selected].map((id) => this.world.entities.get(id)).filter((e): e is Entity => !!e && e.owner === this.player);
  }

  /** Right-click at a ground point (in tiles), optionally on an entity. */
  /** Right-click order; with shift, it comes after what the units are doing. */
  orderAt(x: number, z: number, target?: Entity, queue = false): void {
    const ids = this.own().map((e) => e.id);
    if (!ids.length) return;
    this.hooks.issue({ player: this.player, kind: 'smart', ids, x: Math.round(x * FP), y: Math.round(z * FP), target: target?.id, queue });
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
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();
      const ids = this.own().map((u) => u.id);
      // Ctrl: the group becomes the selection; Shift: the selection joins it.
      if (e.shiftKey && !e.ctrlKey && !e.metaKey) this.groups.set(k, [...new Set([...(this.groups.get(k) ?? []), ...ids])]);
      else this.groups.set(k, ids);
      if (ids.length) this.groupSet = { key: k, time: performance.now() };
      return;
    }
    this.recallGroup(k);
  }

  /** Last group assigned (Ctrl or Shift + digit), so its icon can flash. */
  groupSet = { key: '', time: -Infinity };

  /** Control groups with someone left in them, by key (`Digit1`…`Digit0`), in keyboard order. */
  groupList(): [string, Entity[]][] {
    return [...this.groups.keys()]
      .sort((a, b) => ((Number(a.slice(5)) + 9) % 10) - ((Number(b.slice(5)) + 9) % 10))
      .map((k): [string, Entity[]] => [k, this.groups.get(k)!.map((id) => this.world.entities.get(id)).filter((e): e is Entity => !!e)])
      .filter(([, es]) => es.length > 0);
  }

  /** Selects a control group (its digit key, or its icon); twice in a row centres the view on it. */
  recallGroup(k: string): void {
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
    const v = new Vector3(x, heightAt(this.map, x, z) + 0.4 + (flies(e) ? FLY_HEIGHT : 0), z).project(this.hooks.camera());
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
  }

  private ndc(x: number, y: number): Vector2 {
    return new Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  }

  private lastHoverPick = 0;
  private hoverColor = '';
  private orderedAt = -Infinity;
  private cursorFrame = 0;
  /** What the cursor last showed (undefined after an aim or an order), and the cross-fade under way. */
  private shown: Layer | undefined;
  private cursorKey = '';
  private fadeFrom: Layer | undefined;
  private fadeStart = 0;

  /** Owner colour of what is under the cursor (SC1 lens), checked at most every 50 ms. */
  private hoverCursor(x: number, y: number): void {
    const now = performance.now();
    if (now - this.lastHoverPick < 50) return;
    this.lastHoverPick = now;
    const e = this.dragStart || this.grab ? undefined : this.entityAt(x, y);
    this.hoverColor = !e ? '' : e.owner === this.player ? '#4dff6a' : e.owner < 0 ? '#ffe27a' : this.world.hostile(e.owner, this.player) ? '#ff4a3a' : '#5ad8ff';
  }

  /**
   * Animated cursors, by priority: aiming (red, gold for an ability), a right-click order just given, hovering,
   * else the arrow. Aiming and orders show at once; hover and the arrow cross-fade into each other.
   */
  private animateCursor(): void {
    const f = this.cursorFrame++;
    const body = document.body.classList;
    const since = performance.now() - this.orderedAt;
    let cursor: string;
    if (body.contains('targeting')) {
      cursor = aimFrames(body.contains('scanning') ? '#ffd860' : '#ff4a3a')[f % 8];
      this.shown = undefined;
    } else if (since < 4 * ORDER_FRAME_MS) {
      cursor = orderFrames()[Math.floor(since / ORDER_FRAME_MS)];
      this.shown = undefined;
    } else {
      const layer = this.hoverColor ? hoverLayers(this.hoverColor)[f % HOVER_FRAMES] : ARROW;
      const key = this.hoverColor || 'arrow';
      if (key !== this.cursorKey) {
        // Fade from what was on screen; straight in after an aim or an order.
        this.fadeFrom = this.shown;
        this.fadeStart = performance.now();
        this.cursorKey = key;
      }
      const k = Math.min(1, (performance.now() - this.fadeStart) / FADE_MS);
      const id = `${key}${layer.shape}`;
      cursor =
        this.fadeFrom && k < 1
          ? cursorOf({ ...this.fadeFrom, opacity: 1 - k }, { ...layer, opacity: k })
          : // The plain arrow is the page's own (CSS): the edge-scroll arrows can replace it there.
            !this.hoverColor
            ? ''
            : (steady.get(id) ?? steady.set(id, cursorOf(layer)).get(id)!);
      this.shown = layer;
    }
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }

  /** Entity under the cursor: a mesh hit, else the closest unit within a few pixels, else the closest resource. */
  private entityAt(x: number, y: number): Entity | undefined {
    // Flyers first: small and high up, a ray that just misses one hits whatever is on the ground below.
    let flyer: Entity | undefined;
    let flyerD = FLYER_PICK_PX;
    for (const e of this.world.entities.values()) {
      if (e.def.kind !== 'unit' || !flies(e) || e.inside || !this.world.sees(this.player, e)) continue;
      const s = this.screenOf(e);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < flyerD) [flyer, flyerD] = [e, d];
    }
    if (flyer) return flyer;
    this.raycaster.setFromCamera(this.ndc(x, y), this.hooks.camera());
    for (const hit of this.raycaster.intersectObjects(this.hooks.roots(), true)) {
      // Scaffolding, selection rings and light pools are see-through for clicks.
      if (hit.object.userData.noPick) continue;
      let o: Object3D | null = hit.object;
      while (o && o.userData.id === undefined) o = o.parent;
      const e = o && this.world.entities.get(o.userData.id);
      if (e && hit.object.visible && !e.inside) return e;
    }
    let best: Entity | undefined;
    let bestD = PICK_PX;
    for (const e of this.world.entities.values()) {
      if (e.def.kind !== 'unit' || !this.world.sees(this.player, e)) continue;
      const s = this.screenOf(e);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) [best, bestD] = [e, d];
    }
    if (best) return best;
    bestD = RESOURCE_PICK_PX;
    for (const e of this.world.entities.values()) {
      if (e.def.kind !== 'resource') continue;
      const s = this.screenOf(e);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) [best, bestD] = [e, d];
    }
    return best;
  }

  /** Own units inside a screen rectangle. */
  private inBox(r: { x: number; y: number; w: number; h: number }): number[] {
    return [...this.world.entities.values()]
      .filter((e) => e.owner === this.player && e.def.kind === 'unit' && !e.inside)
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
