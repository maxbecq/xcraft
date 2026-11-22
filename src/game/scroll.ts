import type { CameraRig } from '../camera';
import { ATTRACT } from './config';
import type { Hud } from './hud';
import type { Input } from './input';
import { SCROLL } from './settings';

/** Edge scrolling: how close to the screen's edge (at the bottom, to the top of the command console) the mouse must be. */
/** Its width grows with the screen: 12 % of its short side, never under 120 px (130 px on a 1080p screen), times the setting. */
const edgeBand = () => Math.round(SCROLL.band * Math.max(120, 0.12 * Math.min(window.innerWidth, window.innerHeight)));

/** The camera's own controls: what scrolls it (arrow keys, screen edges, Space held), the wheel's zoom, saved views. */
export interface CameraControls {
  /** The keys held down (also read for Alt and Shift). */
  keys: Set<string>;
  /** Where the keys and the screen's edges push the view this frame (-1..1 per axis); lights the edge it scrolls. */
  direction(): [number, number];
  /** Eases the view along that push over `dt` seconds. */
  glide(dt: number, dx: number, dy: number): void;
}

export function cameraControls(canvas: HTMLCanvasElement, rig: CameraRig, hud: Hud, input: Input, paused: () => boolean): CameraControls {
  // Camera: arrow keys, screen-edge scrolling, wheel zoom.
  const keys = new Set<string>();
  window.addEventListener('keydown', (e) => keys.add(e.key));
  window.addEventListener('keyup', (e) => keys.delete(e.key));
  window.addEventListener('blur', () => keys.clear());
  // Space held: the map follows the mouse (handy on a touchpad); Space tapped without moving, or Enter: to the last
  // attack. F5…F8: saved views (Ctrl, Cmd or Shift + the key saves the current one).
  const views = new Map<string, { x: number; z: number }>();
  /** Space held: where the mouse was last seen, and whether it dragged the map (then letting go jumps nowhere). */
  let spaceDrag: { x: number; y: number; moved: boolean } | null = null;
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest?.('input, textarea, select')) return;
    if (e.key === 'Alt') e.preventDefault(); // held to show every health bar, not to open the browser's menu
    // The arrows scroll the map: with Alt (or Cmd) held, not the browser's « previous page », which left the match.
    if (e.key.startsWith('Arrow')) e.preventDefault();
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) spaceDrag = { x: mouse?.x ?? -1, y: mouse?.y ?? -1, moved: false };
    } else if (e.key === 'Enter') {
      hud.toAlert();
    } else if (/^F[5-8]$/.test(e.key)) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || e.shiftKey) views.set(e.key, { x: rig.target.x, z: rig.target.z });
      else {
        const v = views.get(e.key);
        if (v) rig.lookAt(v.x, v.z);
      }
    }
  });

  let mouse: { x: number; y: number; onButton: boolean } | null = null;
  // Edge scrolling follows the mouse only: fingers drag the map instead. Only over the map itself: over any piece of
  // the interface (console, minimap, command card, top bar, menus, messages) the view stays put. The element really
  // under the pointer decides, so the Dieux console's cut-out shape and the dip of the others count as they are drawn
  // (a held pointer replays its moves there too, see game/pointerlock.ts).
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    mouse = { x: e.clientX, y: e.clientY, onButton: e.target !== canvas };
    if (spaceDrag && !paused()) {
      // Positions, not movementX: a held pointer replays its moves without it.
      if (spaceDrag.x >= 0) rig.panPixels(e.clientX - spaceDrag.x, e.clientY - spaceDrag.y);
      if (spaceDrag.x >= 0 && (e.clientX !== spaceDrag.x || e.clientY !== spaceDrag.y)) spaceDrag.moved = true;
      spaceDrag.x = e.clientX;
      spaceDrag.y = e.clientY;
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space' || !spaceDrag) return;
    if (!spaceDrag.moved) hud.toAlert();
    spaceDrag = null;
  });
  window.addEventListener('blur', () => (spaceDrag = null));
  document.addEventListener('mouseleave', () => (mouse = null));
  // Wheel zooms. A trackpad's two-finger scroll (sideways or fractional pixel deltas) pans,
  // and its pinch (sent as ctrl+wheel) zooms.
  window.addEventListener('wheel', (e) => {
    if (!(e.target instanceof HTMLCanvasElement)) return;
    e.preventDefault();
    const trackpad = e.deltaMode === 0 && (e.deltaX !== 0 || !Number.isInteger(e.deltaY));
    if (e.ctrlKey) rig.zoomBy(Math.exp(e.deltaY * 0.01), e.clientX, e.clientY);
    else if (trackpad) rig.panPixels(-e.deltaX, -e.deltaY);
    else rig.zoomBy(Math.exp(e.deltaY * 0.001), e.clientX, e.clientY);
  }, { passive: false });

  // Glowing edge and arrow cursor while the mouse scrolls the map.
  const edgeGlow = document.createElement('div');
  edgeGlow.className = 'edge-glow';
  document.body.append(edgeGlow);
  let edgeShown = '';
  /** When the pointer entered an edge band (scrolling waits a moment, so crossing the band to a button does not scroll). */
  let edgeSince = 0;
  /** A pointer settled in a band this long starts scrolling; touching the screen's very edge scrolls at once. */
  const EDGE_DWELL_MS = 200;
  /** In the band's outer part (this share of it), the wait is short: the pointer is clearly heading for the edge. */
  const EDGE_OUTER = 0.4;
  const EDGE_DWELL_OUTER_MS = 60;
  const EDGE_TOUCH_PX = 3;
  /** Panels set against a screen edge (the minimap, the command card, the menu with its chips, the production list):
   * the edge they touch does not scroll along them, nor a band's width past their ends, which takes in the corner they
   * sit in. The way from the middle of the screen to any of them crosses no scrolling band (as in StarCraft II, where the
   * console's edge is no scrolling edge). */
  const EDGE_PANELS = '.map-slot, .hud-card, .tools > *, .prod-panel';
  /** A panel this close to an edge is set against it. */
  const ATTACH_PX = 48;
  /** Whether the edge `side` (l, r, t, b: the bottom one runs along the console's top, at `bottom`) is calm at `along`
   * (y for the side edges, x for the others). A panel resting on the console (the tools on a small screen) counts as
   * set against the bottom. */
  function calmEdge(side: 'l' | 'r' | 't' | 'b', along: number, band: number, bottom: number): boolean {
    for (const el of document.querySelectorAll<HTMLElement>(EDGE_PANELS)) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const near = side === 'l' ? r.left : side === 'r' ? window.innerWidth - r.right : side === 't' ? r.top : Math.min(window.innerHeight - r.bottom, Math.abs(bottom - r.bottom));
      const [from, to] = side === 'l' || side === 'r' ? [r.top, r.bottom] : [r.left, r.right];
      if (near < ATTACH_PX && along > from - band && along < to + band) return true;
    }
    return false;
  }
  /** The console's top edge, this deep, scrolls down at once, like the screen's very bottom: a pointer thrown down at
   * the console lands on it (it crosses the band above in a frame or two). Deeper in, the console is for clicking. */
  const EDGE_LINE_PX = 14;
  function scrollDirection(): [number, number] {
    let dx = Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'));
    let dy = Number(keys.has('ArrowUp')) - Number(keys.has('ArrowDown'));
    let edge = '';
    // Space held drags the map with the mouse: the edges would scroll it too, against the drag.
    if (!mouse || spaceDrag) edgeSince = 0;
    if (mouse && !spaceDrag && !mouse.onButton && !paused() && !ATTRACT) {
      // Speed grows the deeper the pointer goes into the band, along an S: barely moving as it enters, then faster and
      // faster, and level again at the screen's edge.
      const EDGE_PX = edgeBand();
      const depth = (d: number) => {
        const t = Math.min(1, Math.max(0, 1 - d / EDGE_PX));
        return 0.06 + 0.94 * t * t * (3 - 2 * t);
      };
      let ex = mouse.x < EDGE_PX ? -depth(mouse.x) : mouse.x > window.innerWidth - EDGE_PX ? depth(window.innerWidth - mouse.x) : 0;
      // The bottom band sits just above the console, so its buttons never scroll the map.
      const bottom = document.querySelector('.console')?.getBoundingClientRect().top ?? window.innerHeight;
      if (ex && calmEdge(ex < 0 ? 'l' : 'r', mouse.y, EDGE_PX, bottom)) ex = 0;
      edgeGlow.style.setProperty('--edge-bottom', `${window.innerHeight - bottom}px`);
      const floor = mouse.y >= window.innerHeight - 1 - EDGE_TOUCH_PX || (mouse.y >= bottom && mouse.y < bottom + EDGE_LINE_PX);
      let ey = mouse.y < EDGE_PX ? depth(mouse.y) : mouse.y > bottom - EDGE_PX && mouse.y < bottom ? -depth(bottom - mouse.y) : floor ? -1 : 0;
      if (ey && calmEdge(ey > 0 ? 't' : 'b', mouse.x, EDGE_PX, bottom)) ey = 0;
      // Near a corner along an edge (the outer fifth): scroll diagonally, as fast as along the edge.
      const cornerX = window.innerWidth * 0.2;
      const cornerY = bottom * 0.2;
      if (ex && !ey) ey = Math.abs(ex) * (mouse.y < cornerY ? 1 : mouse.y > bottom - cornerY && mouse.y < bottom + EDGE_LINE_PX ? -1 : 0);
      else if (ey && !ex) ex = Math.abs(ey) * (mouse.x < cornerX ? -1 : mouse.x > window.innerWidth - cornerX ? 1 : 0);
      // The glow along the edge brightens with the speed.
      edgeGlow.style.opacity = String(0.35 + 0.65 * Math.max(Math.abs(ex), Math.abs(ey)));
      // Crossing the band on the way to a button, or near one: no scrolling.
      const inBand = !!(ex || ey);
      if (!inBand) edgeSince = 0;
      else if (!edgeSince) edgeSince = performance.now();
      const touching = floor || mouse.x <= EDGE_TOUCH_PX || mouse.y <= EDGE_TOUCH_PX || mouse.x >= window.innerWidth - 1 - EDGE_TOUCH_PX;
      // Distance to the nearest edge being scrolled, to know whether the pointer is in the band's outer part.
      const toEdge = Math.min(ex ? Math.min(mouse.x, window.innerWidth - mouse.x) : Infinity, ey > 0 ? mouse.y : ey < 0 ? Math.max(0, bottom - mouse.y) : Infinity);
      const dwell = toEdge < EDGE_PX * EDGE_OUTER ? EDGE_DWELL_OUTER_MS : EDGE_DWELL_MS;
      if (inBand && !touching && performance.now() - edgeSince < dwell) ex = ey = 0;
      if (ex) dx = ex;
      if (ey) dy = ey;
      edge = (ey > 0 ? 'n' : ey < 0 ? 's' : '') + (ex > 0 ? 'e' : ex < 0 ? 'w' : '');
    }
    if (edge !== edgeShown) {
      edgeShown = edge;
      edgeGlow.className = `edge-glow ${[...edge].map((d) => `edge-${d}`).join(' ')}`;
      input.scrollEdge = edge;
    }
    return [dx, dy];
  }
  /** Edge and arrow-key scrolling, eased: current speed per axis (-1..1), and how fast it changes per second. */
  const scroll = { x: 0, y: 0 };
  const SCROLL_ACCEL = 8;
  /** How long the view has been scrolled without a break (s), for the speed-up. */
  let scrollHeld = 0;
  return {
    keys,
    direction: scrollDirection,
    glide(dt, dx, dy) {
      // Eased scrolling: the view speeds up over an eighth of a second, then glides to a stop (slow, fast, slow) over
      // the coasting time set in the options.
      const decel = 1 / Math.max(0.02, SCROLL.coast);
      const towards = (v: number, to: number) => {
        const step = (Math.abs(to) < Math.abs(v) || Math.sign(to) !== Math.sign(v) ? decel : SCROLL_ACCEL) * dt;
        return v + Math.max(-step, Math.min(step, to - v));
      };
      scroll.x = towards(scroll.x, dx);
      scroll.y = towards(scroll.y, dy);
      rig.coast(dt);
      const ease = (v: number) => Math.sign(v) * Math.abs(v) * Math.abs(v) * (3 - 2 * Math.abs(v)); // smoothstep
      // Held on and on, scrolling speeds up along an S: slow to aim at first, up to 1.8 times as fast (with the
      // speed-up option at 1) after a second and a half.
      scrollHeld = dx || dy ? scrollHeld + dt : 0;
      const held = Math.min(1, Math.max(0, scrollHeld - 0.3) / 1.2);
      const boost = SCROLL.speed * (1 + 0.8 * SCROLL.ramp * held * held * (3 - 2 * held));
      if (scroll.x || scroll.y) rig.pan(ease(scroll.x) * boost, ease(scroll.y) * boost, dt);
    },
  };
}
