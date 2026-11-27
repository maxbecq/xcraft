import { type UnitDef, spell } from '../data';
import { ticks } from '../sim/fixed';
import type { Entity, World } from '../sim/world';

/**
 * Provisional (the user's ask, 2026-11-27): a big icon over each god saying what it is doing, read from the simulation
 * and never written to it. `?etatdieux=0` turns it off; to remove it, delete this file and its call in overlay.ts.
 */
const PARAMS = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
export const GOD_STATE_ON = PARAMS.get('etatdieux') !== '0';

export type GodState = 'sort' | 'production' | 'attaque';

/** How long the wand stays up after a spell cast on the spot (seconds). */
const CAST_SHOWN = 1.5;

/**
 * What a god is doing. One icon at a time, by priority: a spell (brief, so it wins while it lasts), then production
 * (a queue at the god: summoning, a level, or a building it raises), then an attack. Isis's Soin counts as a spell.
 */
export function godState(world: World, e: Entity): GodState | null {
  const d = e.def as UnitDef;
  if (d.kind !== 'unit' || !d.unique || d.faction !== 'dieux' || !d.levels || e.hp <= 0) return null;
  const o = e.order;
  if (o?.kind === 'cast' || o?.kind === 'heal') return 'sort';
  for (const [name, ready] of Object.entries(e.spellCd)) {
    const cast = ready - ticks(spell(name, e.lvl).cooldown);
    if (world.tick - cast >= 0 && world.tick - cast < ticks(CAST_SHOWN)) return 'sort';
  }
  if (e.queue.length || (e.raising && (world.entities.get(e.raising)?.buildLeft ?? 0) > 0)) return 'production';
  if (o?.kind === 'attack' || (o?.kind === 'attackMove' && e.cooldown > 0)) return 'attaque';
  return null;
}

const SWORD = 'M19 3l2 2-10 10-2-2zM8 14l2 2-3 3-2-2zM4 18l2 2-2 2-2-2z';
const WAND = 'M3 21l11-11 1.5 1.5-11 11zM17 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1z';
const paths = new Map<string, Path2D>();

/** Draws `state` centred on (x, y), `r` its radius in pixels; `t` in seconds turns the gear. */
export function drawGodState(ctx: CanvasRenderingContext2D, state: GodState, x: number, y: number, r: number, t: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(16,20,28,0.82)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = state === 'attaque' ? '#e0503f' : state === 'sort' ? '#b48cff' : '#f2c14e';
  ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle;
  if (state === 'production') {
    // A gear of 8 teeth, a turn every 3 s.
    ctx.rotate((t / 3) * Math.PI * 2);
    const R = r * 0.62;
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2;
      const a1 = ((i + 1) / 16) * Math.PI * 2;
      const rr = i % 2 ? R * 0.78 : R;
      ctx.arc(0, 0, rr, a0, a1);
    }
    ctx.closePath();
    ctx.moveTo(R * 0.32, 0);
    ctx.arc(0, 0, R * 0.32, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
  } else {
    const s = (r * 1.3) / 24;
    ctx.scale(s, s);
    ctx.translate(-12, -12);
    const d = state === 'attaque' ? SWORD : WAND;
    let p = paths.get(d);
    if (!p) paths.set(d, (p = new Path2D(d)));
    ctx.fill(p);
  }
  ctx.restore();
}
