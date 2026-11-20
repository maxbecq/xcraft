/** Building placement: the ghost and the grid under the cursor, and on a touch screen the pinned footprint with ✓ and ✕. */
import { type MeshBasicMaterial, Vector3 } from 'three';
import { type BuildingDef, DEFS } from '../data';
import { heightAt } from '../map';
import { FP, TICK_RATE } from '../sim/fixed';
import { GRID_REACH } from '../render/placegrid';
import type { Entity } from '../sim/world';
import type { Hud } from './hud';

/** The building being placed, ordered at `ground` (Shift: and kept armed for the next). */
export function place(h: Hud, ground: Vector3 | null, shift: boolean): void {
  if (!h.placing) return;
  const spot = ground && spotAt(h, h.placing, ground);
  const worker = h.workers()[0];
  // A Z Pod with no room for its add-on beside it would never get one.
  if (spot && worker && addonRoom(h, h.placing, spot) === null) {
    h.notify([{ player: h.player, kind: 'error', text: 'Pas de place pour l’extension du Pod.' }]);
    return;
  }
  if (spot && worker) {
    h.issue({ player: h.player, kind: 'build', ids: [worker.id], type: h.placing, tx: spot[0], ty: spot[1], queue: shift });
    if (!shift) {
      h.placing = null;
      h.buildMenu = false;
      // Off to build: out of the selection, so a stray tap or click no longer pulls it off the site (Shift keeps it
      // selected to queue more).
      h.input.selected.delete(worker.id);
    }
  }
}

export function makePinUi(h: Hud): void {
  h.pinUi.hidden = true;
  h.pinUi.innerHTML = '<button class="cmd pin-ok" aria-label="Poser" title="Poser (appui long : poser et continuer)">✓</button><button class="cmd pin-no" aria-label="Annuler" title="Annuler">✕</button>';
  document.body.append(h.pinUi);
  const ok = h.pinUi.querySelector<HTMLElement>('.pin-ok')!;
  // Placed on release; held LONG_MS or more, the order stays armed. The time held is read from the events
  // themselves (a busy frame cannot turn a tap into a long press); the timer only buzzes when it is long enough.
  const LONG_MS = 500;
  let down = -1;
  let buzz = 0;
  ok.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    down = e.timeStamp;
    clearTimeout(buzz);
    buzz = window.setTimeout(() => navigator.vibrate?.(15), LONG_MS);
  });
  ok.addEventListener('pointerup', (e) => {
    clearTimeout(buzz);
    if (down < 0) return;
    const keep = e.timeStamp - down >= LONG_MS;
    down = -1;
    h.audio.play('click');
    place(h, h.pin, keep);
  });
  for (const type of ['pointerleave', 'pointercancel']) {
    ok.addEventListener(type, () => {
      clearTimeout(buzz);
      down = -1;
    });
  }
  h.pinUi.querySelector<HTMLElement>('.pin-no')!.addEventListener('click', () => {
    h.audio.play('click');
    h.placing = null;
  });
}

/** Top-left tile for a building centred under the cursor; mines snap to the nearest well. */
export function spotAt(h: Hud, type: string, ground: Vector3): [number, number] | null {
  const def = DEFS[type] as BuildingDef;
  if (def.energyRate) {
    let best: Entity | undefined;
    let bestD = 4 * FP;
    for (const w of h.world.entities.values()) {
      if (w.type !== 'puits') continue;
      const d = Math.hypot(w.x - ground.x * FP, w.y - ground.z * FP);
      if (d < bestD) [best, bestD] = [w, d];
    }
    return best ? [best.tx, best.ty] : null;
  }
  return [Math.round(ground.x - def.size / 2), Math.round(ground.z - def.size / 2)];
}

/**
 * For a building with add-ons (Z Pod) at `spot`: where its largest add-on would go, or null if no side has room;
 * undefined for any other building.
 */
function addonRoom(h: Hud, type: string, spot: [number, number]): [number, number] | null | undefined {
  const def = DEFS[type] as BuildingDef;
  if (!def.addons?.length) return undefined;
  const big = [...def.addons].sort((a, b) => (DEFS[b] as BuildingDef).size - (DEFS[a] as BuildingDef).size)[0];
  return h.world.addonSpotAt(big, spot[0], spot[1], def.size, h.player) ?? null;
}

export function updateGhost(h: Hud): void {
  const touch = !!h.placing && h.input.touching;
  if (!h.placing) h.pin = null;
  else if (touch && !h.pin) h.pin = h.input.aim()?.clone() ?? null;
  const g = h.placing ? (touch ? h.pin : h.input.aim()) : h.input.hover;
  const spot = h.placing && g ? spotAt(h, h.placing, g) : null;
  h.ghost.visible = !!spot;
  h.pinUi.hidden = !(touch && spot);
  if (touch && spot && h.placing) {
    // Just below the footprint's corner nearest the camera (it looks from +x +y), kept on screen.
    const size = (DEFS[h.placing] as BuildingDef).size;
    const [x, z] = [spot[0] + size, spot[1] + size];
    const s = h.input.toScreen(new Vector3(x, heightAt(h.map, x, z), z));
    h.pinUi.style.left = `${Math.min(innerWidth - 60, Math.max(60, s.x))}px`;
    h.pinUi.style.top = `${Math.min(innerHeight - 60, Math.max(8, s.y + 10))}px`;
  }
  if (!h.placing || !g) {
    h.grid.hide();
    h.gridKey = '';
  }
  // The grid shows as soon as the order is armed: an extractor far from any well (no spot to snap to) still gets it,
  // the free wells lit, only without a footprint.
  if (h.placing && g) updateGrid(h, h.placing, g);
  if (!spot) h.grid.noFootprint();
  if (!spot || !h.placing) return;
  const def = DEFS[h.placing] as BuildingDef;
  const size = def.size;
  const room = addonRoom(h, h.placing, spot);
  const ok = h.world.canPlace(h.placing, spot[0], spot[1], h.player) && room !== null;
  let addon: { tx: number; ty: number; size: number; ok: boolean } | null = null;
  if (room !== undefined) {
    // The add-on's room: where it would go, or (none free) against the east side, in red.
    const big = Math.max(...def.addons!.map((t) => (DEFS[t] as BuildingDef).size));
    const [tx, ty] = room ?? [spot[0] + size, spot[1] + Math.floor((size - big) / 2)];
    addon = { tx, ty, size: big, ok: room !== null };
  }
  h.grid.footprint(spot[0], spot[1], size, ok, addon);
  (h.ghost.material as MeshBasicMaterial).color.set(ok ? 0x55ff66 : 0xff4444);
  h.ghost.scale.set(size, 1, size);
  const cx = spot[0] + size / 2;
  const cz = spot[1] + size / 2;
  h.ghost.position.set(cx, heightAt(h.map, cx, cz) + 0.15, cz);
}

/** The placement grid's tiles round the cursor, redrawn when it changes tile and once a second (sites come and go). */
function updateGrid(h: Hud, type: string, at: Vector3): void {
  const cx = Math.floor(at.x);
  const cy = Math.floor(at.z);
  const key = `${type}|${cx}|${cy}|${Math.floor(h.world.tick / TICK_RATE)}`;
  if (key === h.gridKey) return;
  h.gridKey = key;
  // As far as the screen's corners reach on the ground (the sky beyond the map: the most it draws).
  let reach = 0;
  for (const [x, y] of [[0, 0], [innerWidth, 0], [0, innerHeight], [innerWidth, innerHeight]]) {
    const p = h.input.groundAt(x, y);
    reach = Math.max(reach, p ? Math.hypot(p.x - at.x, p.z - at.z) : GRID_REACH);
  }
  const def = DEFS[type] as BuildingDef;
  const net = h.world.powerNetwork(h.player);
  let fits = (x: number, y: number) => h.world.tileFits(type, x, y, h.player, net);
  if (def.energyRate) {
    // Extractors: the free wells light up, every other tile is red.
    const free = new Set<number>();
    for (const w of h.world.entities.values()) {
      if (w.type !== 'puits' || !h.world.canPlace(type, w.tx, w.ty, h.player)) continue;
      for (let y = w.ty; y < w.ty + def.size; y++) for (let x = w.tx; x < w.tx + def.size; x++) free.add(y * h.map.width + x);
    }
    fits = (x, y) => free.has(y * h.map.width + x);
  }
  h.grid.cellsAt(cx, cy, reach, fits);
}
