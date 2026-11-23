/**
 * The alternative desktop interface (option « Interface alternative », computers only; the user's choice of
 * 2026-11-23): no console. A building's commands in a bubble just above it; a unit's in a bar at the bottom of the
 * screen, where the workers' build tree opens as soon as they are picked; every production queue in a column at the
 * left, always shown; the minimap afloat at the bottom left; the selection's sheet at the right. Its layout is in
 * style.css (body.alt); this places the bubble and opens the tree.
 */
import { Vector3 } from 'three';
import type { BuildingDef } from '../data';
import { heightAt } from '../map';
import { FP } from '../sim/fixed';
import type { Hud } from './hud';
import { bubbleOf } from './hud-card';

/** Room kept clear around the bubble: the top bar above, the queues' column at the left, the sheet at the right
 * (style.css: 16 px from the edges, 230 and 290 px wide), the bottom edge. */
const TOP = 64;
const LEFT = 254;
const RIGHT = 314;
const EDGE = 8;
const at = new Vector3();
/** The bubble's point, made on first use. */
let tail: HTMLElement | null = null;
/** Shown last frame: turning the option off has things to put back. */
let on = false;

/** Once a frame, before the card is drawn. */
export function updateAlt(h: Hud): void {
  on = true;
  if (!h.spectator) h.prod.hidden = false; // the queues' column stays (none when watching, as before)
  const own = h.input.own();
  // Workers just picked: their build tree at once (its Retour, or Échap, gives back their usual orders).
  if (h.selKey !== h.altSel) {
    h.altSel = h.selKey;
    if (own.length && own.every((e) => e.def.kind === 'unit') && h.workers().length === own.length) h.buildMenu = 'basic';
  }
  const b = bubbleOf(h);
  h.card.classList.toggle('bubble', !!b);
  if (!tail) (tail = document.createElement('div')), (tail.className = 'bubble-tail'), document.body.append(tail);
  tail.hidden = !b;
  if (!b) return;
  const size = (b.def as BuildingDef).size;
  const x = b.x / FP;
  const z = b.y / FP;
  // Above the building's health bar (render/overlay.ts puts it a quarter tile over the model's top).
  const top = h.top(b.id, b.buildLeft === 0) ?? heightAt(h.map, x, z) + 1.2 + size * 0.45;
  const s = h.input.toScreen(at.set(x, top + 0.6, z));
  const w = h.card.offsetWidth;
  const hh = h.card.offsetHeight;
  // No room above (the building at the top of the screen): under its footprint instead, pointing up at it.
  const below = s.y - hh < TOP;
  let y = s.y;
  if (below) {
    y = 0;
    for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) y = Math.max(y, h.input.toScreen(at.set(x + (dx * size) / 2, heightAt(h.map, x, z), z + (dz * size) / 2)).y + 14);
  }
  const bx = Math.round(Math.min(innerWidth - RIGHT - w / 2, Math.max(LEFT + w / 2, s.x)));
  const by = Math.round(below ? Math.max(TOP, Math.min(innerHeight - EDGE - hh, y)) : Math.min(innerHeight - EDGE, y));
  h.card.classList.toggle('below', below);
  tail.classList.toggle('below', below);
  h.card.style.setProperty('--bx', `${bx}px`);
  h.card.style.setProperty('--by', `${by}px`);
  // Between the bubble and the building (kept on the bubble when the building is off to the side).
  tail.style.left = `${Math.round(Math.min(bx + w / 2 - 16, Math.max(bx - w / 2 + 16, s.x)))}px`;
  tail.style.top = `${below ? by - 10 : by - 1}px`;
}

/** The option turned off: the card back in the console, the point gone. */
export function leaveAlt(h: Hud): void {
  if (!on) return;
  on = false;
  h.card.classList.remove('bubble', 'below');
  if (tail) tail.hidden = true;
  h.altSel = '';
  // The production panel as the player left it (F3).
  try {
    h.prod.hidden = localStorage.getItem('xcraft.prod') !== '1' || h.spectator;
  } catch {
    h.prod.hidden = true;
  }
  h.prodToggle.classList.toggle('on', !h.prod.hidden);
}
