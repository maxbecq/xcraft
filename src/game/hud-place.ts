/** Building placement: the ghost and the grid under the cursor, and on a touch screen the pinned footprint with ✓ and ✕. */
import { type MeshBasicMaterial, Vector3 } from 'three';
import BALANCE from '../balance.json';
import { type BuildingDef, DEFS, raises, type UnitDef } from '../data';
import { heightAt } from '../map';
import { addonSlots } from '../sim/buildings';
import { FP, TICK_RATE } from '../sim/fixed';
import { UNSEEN } from '../sim/vision';
import { GRID_REACH } from '../render/placegrid';
import type { Entity } from '../sim/world';
import type { Hud } from './hud';

/** The building being placed, ordered at `ground` (Shift: and kept armed for the next). */
export function place(h: Hud, ground: Vector3 | null, shift: boolean): void {
  if (!h.placing) return;
  const spot = ground && spotAt(h, h.placing, ground);
  // Z: a Pod's add-on, in the place picked among its 8 (the Pod raises it, no drone).
  const pod = addonHost(h);
  if (pod) {
    if (!spot) return;
    const slot = addonSlots(pod.tx, pod.ty, (pod.def as BuildingDef).size, (DEFS[h.placing] as BuildingDef).size).findIndex(([x, y]) => x === spot[0] && y === spot[1]);
    if (!h.world.canPlace(h.placing, spot[0], spot[1], h.player)) return void h.notify([{ player: h.player, kind: 'error', text: 'Emplacement occupé.' }]);
    h.issue({ player: h.player, kind: 'train', ids: [pod.id], type: h.placing, slot });
    if (!shift || h.world.addonsOf(pod) + 1 >= BALANCE.rules.z.podAddons) h.placing = null;
    return;
  }
  const worker = h.workers().find((w) => raises(w.def as UnitDef, h.placing!));
  // An extractor clicked away from any well: said, not silently dropped (the well may hide behind the main building).
  if (ground && !spot && worker) {
    h.notify([{ player: h.player, kind: 'error', text: `${DEFS[h.placing].name} : à poser sur un puits d’énergie libre (en vert).` }]);
    return;
  }
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
      if (worker.def.kind === 'unit') h.input.selected.delete(worker.id);
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
/** The Pod an add-on being placed goes round, if that is what is being placed. */
function addonHost(h: Hud): Entity | undefined {
  if (!h.placing || !(DEFS[h.placing] as BuildingDef).addon || h.addonPod === null) return undefined;
  const pod = h.world.entities.get(h.addonPod);
  return pod && pod.hp > 0 && pod.owner === h.player ? pod : undefined;
}

export function spotAt(h: Hud, type: string, ground: Vector3): [number, number] | null {
  const def = DEFS[type] as BuildingDef;
  const pod = addonHost(h);
  if (pod) {
    // The place round the Pod nearest the cursor, of the 8.
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (const [x, y] of addonSlots(pod.tx, pod.ty, (pod.def as BuildingDef).size, def.size)) {
      const d = Math.hypot(x + def.size / 2 - ground.x, y + def.size / 2 - ground.z);
      if (d < bestD) [best, bestD] = [[x, y], d];
    }
    return best;
  }
  if (def.addon) return null;
  if (def.energyRate) {
    let best: Entity | undefined;
    let bestD = 4 * FP;
    for (const w of h.world.entities.values()) {
      if (w.type !== 'puits' || !foundWell(h, w)) continue; // a well never found draws no ghost
      const d = Math.hypot(w.x - ground.x * FP, w.y - ground.z * FP);
      if (d < bestD) [best, bestD] = [w, d];
    }
    return best ? [best.tx, best.ty] : null;
  }
  return [Math.round(ground.x - def.size / 2), Math.round(ground.z - def.size / 2)];
}

/**
 * For a building with add-ons (Z Pod) at `spot`: where its largest add-on would go, or null if none of its 8 places has room;
 * undefined for any other building.
 */
function addonRoom(h: Hud, type: string, spot: [number, number]): [number, number] | null | undefined {
  const def = DEFS[type] as BuildingDef;
  if (!def.addons?.length) return undefined;
  const big = [...def.addons].sort((a, b) => (DEFS[b] as BuildingDef).size - (DEFS[a] as BuildingDef).size)[0];
  return h.world.addonSpotAt(big, spot[0], spot[1], def.size, h.player) ?? null;
}

/** Per HUD, the wells it last saw taken by an extractor (a well never seen taken counts as free). */
const seenTaken = new WeakMap<Hud, { tick: number; taken: Map<number, boolean> }>();

/**
 * Which wells the player knows to be taken, as last seen: under the fog a well keeps the state it was seen in, so the
 * placement grid never shows an enemy extractor the player cannot see. Brought up to date once a tick.
 */
export function takenAsSeen(h: Hud): Map<number, boolean> {
  let m = seenTaken.get(h);
  if (!m) seenTaken.set(h, (m = { tick: -1, taken: new Map() }));
  if (m.tick === h.world.tick) return m.taken;
  m.tick = h.world.tick;
  const w = h.world;
  const all = h.spectator || !!w.players[h.player]?.reveal;
  const on = new Map<number, Entity>();
  for (const e of w.entities.values()) if (e.def.kind === 'building' && (e.def as BuildingDef).energyRate) on.set(e.ty * w.map.width + e.tx, e);
  for (const e of w.entities.values()) {
    if (e.type !== 'puits') continue;
    const x = on.get(e.ty * w.map.width + e.tx);
    if (x && (all || w.sees(h.player, x))) m.taken.set(e.id, true);
    else if (all || w.sees(h.player, e)) m.taken.set(e.id, false);
  }
  return m.taken;
}

/** Has the player found this well (explored its tile, as the minimap and the models have it)? */
function foundWell(h: Hud, w: Entity): boolean {
  return h.spectator || !!h.world.players[h.player]?.reveal || h.world.vision[h.player].tiles[w.ty * h.world.map.width + w.tx] !== UNSEEN;
}

/** A well the player has found and last saw free: lit on the placement grid. */
export function freeAsSeen(h: Hud, w: Entity): boolean {
  return foundWell(h, w) && !takenAsSeen(h).get(w.id);
}

export function updateGhost(h: Hud): void {
  takenAsSeen(h);
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
  // Placing a Pod's add-on: its 8 places drawn at once, the free ones green.
  const host = addonHost(h);
  h.grid.slots(host && h.placing ? addonSlots(host.tx, host.ty, (host.def as BuildingDef).size, (DEFS[h.placing] as BuildingDef).size).map(([tx, ty]) => ({ tx, ty, size: (DEFS[h.placing!] as BuildingDef).size, ok: h.world.canPlace(h.placing!, tx, ty, h.player) })) : null);
  if (!spot) h.grid.noFootprint();
  if (!spot || !h.placing) return;
  const def = DEFS[h.placing] as BuildingDef;
  const size = def.size;
  const room = addonRoom(h, h.placing, spot);
  // An extractor's ghost: as the player last saw its well (the simulation knows an enemy one under the fog).
  const well = def.energyRate ? [...h.world.entities.values()].find((w) => w.type === 'puits' && w.tx === spot[0] && w.ty === spot[1]) : undefined;
  const ok = (well ? freeAsSeen(h, well) : h.world.canPlace(h.placing, spot[0], spot[1], h.player)) && room !== null;
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
  const wells: [number, number][] = [];
  if (def.energyRate) {
    // Extractors: the free wells light up, every other tile is red.
    const free = new Set<number>();
    for (const w of h.world.entities.values()) {
      if (w.type !== 'puits' || !freeAsSeen(h, w)) continue;
      wells.push([w.tx, w.ty]);
      for (let y = w.ty; y < w.ty + def.size; y++) for (let x = w.tx; x < w.tx + def.size; x++) free.add(y * h.map.width + x);
    }
    fits = (x, y) => free.has(y * h.map.width + x);
  }
  h.grid.wells(wells, def.size);
  h.grid.cellsAt(cx, cy, reach, fits);
}
