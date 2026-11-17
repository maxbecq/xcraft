import { Raycaster, Vector2, Vector3, type Camera, type Object3D } from 'three';
import { type GameMap, heightAt } from '../map';
import { FP } from '../sim/fixed';
import { type Command, type Entity, type World, flies } from '../sim/world';
import { type BuildingDef, FLY_HEIGHT, type UnitDef } from '../data';

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
  /** A finger let go of a drag at this speed (pixels per second); 0, 0 when a finger touches down. */
  fling?: (vx: number, vy: number) => void;
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
  return cursorSized(32, ...layers);
}

/**
 * A cursor with more room round the same 32-unit grid, at the same scale (one unit, one pixel), `view` pixels
 * wide and centred on the hotspot: the arrow drawn in it lines up with the page's own, so they can cross-fade.
 */
function cursorWide(view: number, ...layers: Layer[]): string {
  const o = 16 - view / 2;
  return cursorSvg(view, `${o} ${o} ${view} ${view}`, layers);
}

/** A cursor drawn on the 32-unit grid and shown `px` pixels wide (browsers take up to 128; 48 shows everywhere we target). */
function cursorSized(px: number, ...layers: Layer[]): string {
  return cursorSvg(px, '0 0 32 32', layers);
}

function cursorSvg(px: number, viewBox: string, layers: Layer[]): string {
  const draw = ({ color, shape, opacity = 1 }: Layer) =>
    `<g opacity='${opacity.toFixed(2)}'><g stroke='${color}' stroke-width='5' opacity='.45' filter='url(#h)'>${shape}</g><g stroke='#000' stroke-width='3' opacity='.7'>${shape}</g><g stroke='${color}' stroke-width='1.5'>${shape}</g></g>`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${px}' height='${px}' viewBox='${viewBox}'><defs><filter id='h' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='1.4'/></filter></defs><g fill='none' stroke-linecap='round' stroke-linejoin='round'>${layers.map(draw).join('')}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${px / 2} ${px / 2}, default`;
}

/** The game's arrow: bronze body, gold edge, its tip on the hotspot. */
const ARROW: Layer = { color: '#e8b64a', shape: "<path fill='#2b2010' d='M16.6 16.6L17 29.2L20.3 25.9L23.1 31L25.7 29.7L22.9 24.6L27.5 24.2Z'/><path stroke-width='1' opacity='.6' d='M18.4 20.2L18.6 25.6'/>" };
// The arrow everywhere outside the map's own cursors (menus, console); buttons keep their hand.
document.documentElement.style.setProperty('--arrow', cursorOf(ARROW));
/** Over the minimap: a gold viewfinder, the corners of the camera's view framing a dot (where it will look). */
const VIEWFINDER: Layer = { color: '#e8b64a', shape: "<path d='M6 13V9H10M22 9H26V13M26 19V23H22M10 23H6V19'/><circle cx='16' cy='16' r='1.6' fill='#e8b64a'/>" };
document.documentElement.style.setProperty('--minimap', cursorOf(VIEWFINDER));

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
  Array.from({ length: HOVER_FRAMES }, (_, f) => ({ color, shape: `${isoCorners(HOVER_W, (f / HOVER_FRAMES) * (Math.PI / 2))}<ellipse cx='16' cy='16' rx='4.5' ry='2.25'/>` }));
/** Hover brackets: their half-width, and the cursor box that holds them (wider than the usual 32 px). */
const HOVER_W = 20;
const HOVER_BOX = 48;

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
/** Edge scrolling: twin gold chevrons pointing the way the map scrolls, pushing outwards again and again. */
const EDGE_ANGLE: Record<string, number> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
const edgeFrames = (edge: string) =>
  cached(`edge${edge}`, () =>
    Array.from({ length: 6 }, (_, f) =>
      cursorSized(48, { color: '#e8b64a', shape: `<g transform='rotate(${EDGE_ANGLE[edge]} 16 16) translate(${(f * 0.9).toFixed(1)} 0)'><path d='M10 9L17 16L10 23'/><path d='M3 11.5L7.5 16L3 20.5' opacity='.55'/></g>` }),
    ),
  );
/**
 * Dragging the map (right or middle button held): four arrows lying on the ground round a ring, in the 2:1
 * isometric squash of the hover brackets and the attack reticle (half as long front to back as side to side).
 */
const GRAB = cursorSized(44, {
  color: '#e8b64a',
  shape:
    "<path d='M21 16H30M27 14.2L30 16L27 17.8M11 16H2M5 14.2L2 16L5 17.8M16 13.6V8.5M12.4 10L16 8.5L19.6 10M16 18.4V23.5M12.4 22L16 23.5L19.6 22'/><ellipse cx='16' cy='16' rx='4.6' ry='2.3'/>",
});
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
        hold(canvas, e.pointerId);
        return;
      }
      const ground = this.groundAt(e.clientX, e.clientY);
      if (this.hooks.click?.(e.button, ground, e.shiftKey, this.entityAt(e.clientX, e.clientY))) return;
      if (e.button === 2 && !this.own().length) {
        // Right button with none of ours selected (no order to give): it grabs and drags the map instead.
        this.grab = { x: e.clientX, y: e.clientY };
        hold(canvas, e.pointerId);
        return;
      }
      if (e.button === 0) {
        this.dragStart = { x: e.clientX, y: e.clientY };
        hold(canvas, e.pointerId);
        // A click on something selects it at once, on the press (ring, portrait and card in this very frame); a drag
        // that follows turns into a box, which replaces it on release. Shift (add or take out) waits for the release.
        const hit = e.shiftKey ? undefined : this.entityAt(e.clientX, e.clientY);
        this.pressPicked = !!hit;
        if (hit) this.pick(hit, e.ctrlKey || e.metaKey, false);
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
      if (click && this.pressPicked) return; // already picked on the press
      const hit = click ? this.entityAt(e.clientX, e.clientY) : undefined;
      if (hit) return this.pick(hit, e.ctrlKey || e.metaKey, e.shiftKey);
      if (!e.shiftKey) this.selected.clear();
      if (!click) for (const id of this.inBox(r, e.shiftKey)) this.selected.add(id);
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
  private lastClick = { time: 0, type: '' };
  /** The last left press picked something (so its release, if it stays a click, has nothing more to do). */
  private pressPicked = false;

  /** A click on `hit`: it alone, or all of its kind on screen (Ctrl/Cmd, or a second click); Shift adds or takes out. */
  private pick(hit: Entity, ctrl: boolean, shift: boolean): void {
    const kind = hit.owner === this.player ? hit.type : '';
    const now = performance.now();
    const all = !!kind && (ctrl || (kind === this.lastClick.type && now - this.lastClick.time < DOUBLE_TAP_MS));
    this.lastClick = { time: all ? 0 : now, type: kind };
    if (!shift) this.selected.clear();
    for (const id of all ? this.sameOnScreen(kind) : [hit.id]) {
      if (shift && !all && this.selected.has(id)) this.selected.delete(id);
      else this.selected.add(id);
    }
  }
  /** A dragging finger's speed (pixels per second) and the time of its last move. */
  private panVel = { x: 0, y: 0, t: 0 };

  private touchDown(e: PointerEvent, canvas: HTMLCanvasElement): void {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // capture is a convenience: the touch still works without it
    }
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    this.hooks.fling?.(0, 0); // a finger down catches a sliding view
    this.panVel = { x: 0, y: 0, t: performance.now() };
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
    if (this.touchMode === 'pan') {
      this.hooks.pan(dx, dy);
      // The finger's speed, smoothed over the last few moves, for the slide after it lets go.
      const now = performance.now();
      const ms = Math.max(1, now - this.panVel.t);
      this.panVel = { x: 0.5 * this.panVel.x + 0.5 * ((dx / ms) * 1000), y: 0.5 * this.panVel.y + 0.5 * ((dy / ms) * 1000), t: now };
    }
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
    // Let go while still moving (not after a pause): the view slides on.
    if (mode === 'pan' && performance.now() - this.panVel.t < 60) this.hooks.fling?.(this.panVel.x, this.panVel.y);
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
        this.sameOnScreen(target.type).forEach((id) => this.selected.add(id));
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

  /** Our things of a kind in view. */
  private sameOnScreen(type: string): number[] {
    return [...this.world.entities.values()].filter((e) => e.owner === this.player && e.type === type && this.onScreen(e)).map((e) => e.id);
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

  /** Own finished buildings that train units and have nothing in their queue. */
  idleProducers(): Entity[] {
    return [...this.world.entities.values()].filter((e) => e.owner === this.player && e.def.kind === 'building' && e.buildLeft === 0 && !!(e.def as BuildingDef).trains?.length && !e.queue.length);
  }

  private idleProdTurn = 0;

  /** Selects the next idle production building in turn and centres the view on it. */
  selectIdleProducer(): void {
    const idle = this.idleProducers();
    if (!idle.length) return;
    const e = idle[this.idleProdTurn++ % idle.length];
    this.selected.clear();
    this.selected.add(e.id);
    this.hooks.focus(e.x / FP, e.y / FP);
  }

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

  private screenOf(e: Entity, lift = 0.4): { x: number; y: number } {
    const x = e.x / FP;
    const z = e.y / FP;
    const v = new Vector3(x, heightAt(this.map, x, z) + lift + (flies(e) ? FLY_HEIGHT : 0), z).project(this.hooks.camera());
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
  }

  private ndc(x: number, y: number): Vector2 {
    return new Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  }

  /** Direction the map is scrolling at the screen's edge ('n', 'se'…), or '' (set each frame by the game loop). */
  scrollEdge = '';
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
    if (this.grab) {
      cursor = GRAB;
      this.shown = undefined;
    } else if (this.scrollEdge && !body.contains('targeting')) {
      cursor = edgeFrames(this.scrollEdge)[f % 6];
      this.shown = undefined;
    } else if (body.contains('targeting')) {
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
          ? cursorWide(HOVER_BOX, { ...this.fadeFrom, opacity: 1 - k }, { ...layer, opacity: k })
          : // The plain arrow is the page's own (CSS): the edge-scroll arrows can replace it there.
            !this.hoverColor
            ? ''
            : (steady.get(id) ?? steady.set(id, cursorWide(HOVER_BOX, layer)).get(id)!);
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
  /**
   * Ours inside a dragged box. Soldiers come first: workers caught at the edge of a fight are left out unless
   * the box holds nothing else (or `workers`, with Shift). A box with no unit at all picks our buildings.
   */
  private inBox(r: { x: number; y: number; w: number; h: number }, workers = false): number[] {
    const inside = [...this.world.entities.values()].filter((e) => {
      if (e.owner !== this.player || e.inside || (e.def.kind !== 'unit' && e.def.kind !== 'building')) return false;
      // A god (Dieux) stands as tall as a building: a box round its body takes it, not only one round its feet.
      const lifts = e.def.kind === 'unit' && (e.def as UnitDef).radius >= 1 ? [0.4, 1.5, 3] : [0.4];
      return lifts.some((lift) => {
        const s = this.screenOf(e, lift);
        return s.x >= r.x && s.x <= r.x + r.w && s.y >= r.y && s.y <= r.y + r.h;
      });
    });
    const units = inside.filter((e) => e.def.kind === 'unit');
    const army = units.filter((e) => !(e.def as UnitDef).worker);
    const picked = units.length ? (army.length && !workers ? army : units) : inside;
    return picked.map((e) => e.id);
  }

  private groundAt(x: number, y: number): Vector3 | null {
    this.raycaster.setFromCamera(this.ndc(x, y), this.hooks.camera());
    return this.raycaster.intersectObject(this.hooks.terrain)[0]?.point ?? null;
  }
}

/** Pointer capture, when there is one: a held pointer (Pointer Lock) refuses it, and game/pointerlock.ts then keeps the
 * events of a press on the element pressed. */
function hold(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // locked pointer
  }
}
