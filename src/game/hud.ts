import { BoxGeometry, Mesh, MeshBasicMaterial, type Scene, Vector3 } from 'three';
import { type BuildingDef, DEFS, type UnitDef } from '../data';
import { el, noIcon } from './glyphs';
import { type GameMap, heightAt } from '../map';
import { FP, TICK_RATE } from '../sim/fixed';
import { GRID_REACH, PlaceGrid } from '../render/placegrid';
import type { Command, Entity, GameEvent, World } from '../sim/world';
import type { Audio } from '../audio';
import type { Input } from './input';
import { Portrait } from '../render/portrait';
import { showEnd, showEvents } from './hud-toasts';
import { updatePanel } from './hud-panel';
import { cancelSlot, toggleProd, updateBar, updateGroups, updateIdle, updateIdleProd, updateProd } from './hud-bar';
import { type Button, GRID_CODES, pressButton, pressMenu, showTip, updateCard } from './hud-card';

/** Resource bar, selection panel, command card, messages and building placement. */
export class Hud {
  readonly bar = el('div', 'hud-bar');
  /** Bottom console: minimap slot, selection panel, command card. */
  private readonly console = el('div', 'console');
  readonly mapSlot = el('div', 'slot map-slot');
  private readonly panel = el('div', 'hud-panel');
  /** Selection text, beside the live portrait. */
  readonly details = el('div', 'details');
  readonly portrait = new Portrait();
  readonly card = el('div', 'hud-card');
  readonly toasts = el('div', 'hud-toasts');
  /** Where the last attack alert happened (tiles): Space or a click on its message goes there. */
  alertAt: { x: number; y: number } | null = null;
  /** Set by the game: marks an alert on the minimap, and moves the view. */
  ping: (x: number, y: number) => void = () => {};
  focus: (x: number, y: number) => void = () => {};
  /** Hit points (and shield) of our things at the last tick, to find where an attack lands. */
  readonly lastHp = new Map<number, number>();
  /** When each of ours was last hurt (ms), for the red edge on its picture in the selection. */
  readonly hitAt = new Map<number, number>();
  /** Our workers on their way to build, by id, with what: to name a building cancelled for want of resources. */
  readonly sites = new Map<number, string>();
  /** Idle workers: their count on a button in the top bar (hidden at none); it flashes as one more stops. */
  readonly idle = el('button', 'chip idle-workers');
  idleCount = 0;
  /** Production buildings with an empty queue: a click goes through them one by one. */
  readonly idleProd = el('button', 'chip idle-prod');
  idleProdCount = 0;
  /** The production panel (F3 or its button): every producer of ours, what it makes and how far along, idle ones dimmed;
   * a click on a row selects that producer and shows it. */
  readonly prodToggle = el('button', 'chip prod-toggle');
  readonly prod = el('div', 'prod-panel');
  readonly prodList = el('div', 'prod-list');
  prodKey = '';
  /** Control groups: one icon each (the group's most numerous type), with its key and head count. */
  readonly groups = el('div', 'groups');
  groupsKey = '';
  buttons: Button[] = [];
  /** Hotkeys by place in the card rather than by name (Options). */
  gridKeys = false;
  cardKey = '';
  /** Last button pressed and how it reacted, so the card rebuilt by that press keeps the animation. */
  pressed = { key: '', anim: '', at: -Infinity };
  /** Open build menu: basic buildings, or the advanced (tech) ones. */
  buildMenu: false | 'basic' | 'advanced' = false;
  /** Z Plate-forme: the socle whose weapon is being picked before it is queued. */
  weaponMenu: string | null = null;
  /** Its weapons, in a menu dropped under the socle's button (`menu`). */
  menuItems: Button[] = [];
  readonly menu = el('div', 'cmd-menu');
  placing: string | null = null;
  /** The building type being placed, if any. */
  get placingType(): string | null {
    return this.placing;
  }
  /** Waiting for a click to attack or attack-move. */
  targeting = false;
  /** The click aims a Forge's Observation céleste instead of an attack. */
  scanning = false;
  /** Unit ability being aimed (none: a building's). */
  aimed?: string;
  readonly banner = el('div', 'hud-banner');
  /** More buttons for the end-of-game banner (the telemetry's). */
  endButtons = '';
  /** A match against a friend online: the end offers a rematch instead of a new game. */
  online = false;
  readonly tip = el('div', 'cmd-tip');
  private readonly ghost: Mesh;
  private readonly grid: PlaceGrid;
  /** What the grid's tiles were last drawn for: they are redrawn only when the cursor changes tile (or each second). */
  private gridKey = '';

  constructor(
    readonly world: World,
    private readonly map: GameMap,
    readonly player: number,
    readonly input: Input,
    scene: Scene,
    readonly issue: (c: Command) => void,
    readonly audio: Audio,
    /** Watching (AI against AI, a replay): the players' own messages are not shown. */
    readonly spectator = false,
  ) {
    this.panel.classList.add('slot');
    this.panel.append(this.portrait.canvas, this.details);
    this.card.classList.add('slot');
    this.console.append(this.mapSlot, this.panel, this.card);
    document.body.append(this.bar, this.console, this.toasts, this.banner);
    this.banner.hidden = true;
    this.idle.hidden = true;
    this.idle.title = 'Ouvriers inactifs : les sélectionner';
    this.idle.addEventListener('click', () => this.input.selectIdleWorkers());
    this.idleProd.title = 'Production à l’arrêt : passer les bâtiments en revue';
    this.idleProd.hidden = true;
    this.idleProd.addEventListener('click', () => this.input.selectIdleProducer());
    this.prodToggle.title = 'Production (F3) : toutes les files d’un coup d’œil';
    this.prodToggle.hidden = spectator;
    this.prodToggle.addEventListener('click', () => toggleProd(this));
    try {
      this.prod.hidden = localStorage.getItem('xcraft.prod') !== '1' || spectator;
    } catch {
      this.prod.hidden = true;
    }
    this.prodToggle.classList.toggle('on', !this.prod.hidden);
    const close = el('button', 'prod-close');
    close.textContent = '×';
    close.title = 'Fermer';
    close.addEventListener('click', () => toggleProd(this));
    this.prod.append(close, this.prodList);
    document.body.append(this.prod);
    // On a touch screen, a tap anywhere else closes it (and does nothing more on the map).
    window.addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      if (e.pointerType !== 'touch' || this.prod.hidden || this.prod.contains(t) || this.prodToggle.contains(t)) return;
      toggleProd(this);
      if (t instanceof HTMLCanvasElement) e.stopPropagation();
    }, { capture: true });
    this.prod.addEventListener('click', (e) => {
      const q = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]');
      if (q) return cancelSlot(this, q);
      const id = Number((e.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id);
      const b = this.world.entities.get(id);
      if (!b || b.owner !== this.player) return;
      this.input.selected.clear();
      this.input.selected.add(b.id);
      this.focus(b.x / FP, b.y / FP);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'F3' || spectator) return;
      e.preventDefault();
      toggleProd(this);
    });
    this.groups.addEventListener('click', (e) => {
      const k = (e.target as HTMLElement).closest<HTMLElement>('[data-g]')?.dataset.g;
      if (k) this.input.recallGroup(k);
    });
    this.ghost = new Mesh(new BoxGeometry(1, 0.3, 1), new MeshBasicMaterial({ color: 0x55ff66, transparent: true, opacity: 0.45, depthWrite: false }));
    this.ghost.visible = false;
    scene.add(this.ghost);
    this.grid = new PlaceGrid(scene, map);
    this.makePinUi();

    // Tooltip: shown almost at once (80 ms) over a command, with its cost, what it is and what it still needs.
    this.tip.hidden = true;
    document.body.append(this.tip);
    let tipTimer = 0;
    this.card.addEventListener('pointerover', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.cmd');
      if (!el || e.pointerType === 'touch') return;
      clearTimeout(tipTimer);
      tipTimer = window.setTimeout(() => showTip(this, el), 80);
    });
    this.card.addEventListener('pointerout', (e) => {
      if ((e.relatedTarget as HTMLElement | null)?.closest('.cmd') === (e.target as HTMLElement).closest('.cmd')) return;
      clearTimeout(tipTimer);
      this.tip.hidden = true;
    });
    this.menu.hidden = true;
    document.body.append(this.menu);
    this.menu.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const k = (e.target as HTMLElement).closest<HTMLElement>('[data-wkey]')?.dataset.wkey;
      const item = this.menuItems.find((x) => x.key === k);
      if (item) pressMenu(this, item);
    });
    // A click or tap anywhere but the menu or its socle's button closes it.
    window.addEventListener(
      'pointerdown',
      (e) => {
        const t = e.target as HTMLElement;
        if (this.weaponMenu && !this.menu.contains(t) && !t.closest?.('.cmd.open')) this.weaponMenu = null;
      },
      true,
    );
    // A finger has no hover: a long press shows the tooltip (and presses nothing); a short one presses on release.
    let held: { b: Button; long: boolean; timer: number } | null = null;
    this.card.addEventListener('pointerdown', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-key]');
      const b = this.buttons.find((x) => x.key === el?.dataset.key);
      if (!b || !el) return;
      if (e.pointerType !== 'touch') return pressButton(this, b);
      if (held) clearTimeout(held.timer);
      const h: { b: Button; long: boolean; timer: number } = (held = { b, long: false, timer: 0 });
      h.timer = window.setTimeout(() => {
        h.long = true;
        showTip(this, el);
      }, 450);
    });
    const release = (press: boolean) => {
      if (!held) return;
      clearTimeout(held.timer);
      if (held.long) this.tip.hidden = true;
      else if (press) pressButton(this, held.b);
      held = null;
    };
    // On the window: the card may be rebuilt between the press and the release, its button gone from the page.
    window.addEventListener('pointerup', () => release(true));
    window.addEventListener('pointercancel', () => release(false));
    this.panel.addEventListener('pointerdown', (e) => {
      const q = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]');
      if (q) return cancelSlot(this, q);
      const out = (e.target as HTMLElement).closest<HTMLElement>('[data-unload]');
      if (out) {
        const of = Number(out.dataset.of);
        if (this.world.entities.get(of)?.owner !== this.player || this.spectator) return;
        this.audio.play('click');
        return this.issue({ player: this.player, kind: 'unload', ids: [of], unit: Number(out.dataset.unload) });
      }
      const id = Number((e.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id);
      if (!id) return;
      this.input.selected.clear();
      this.input.selected.add(id);
    });
    // Types without an icon yet (placeholder models): drop the broken image and stop asking for it.
    document.addEventListener(
      'error',
      (e) => {
        const img = e.target;
        if (img instanceof HTMLImageElement && img.dataset.icon) {
          noIcon.add(img.dataset.icon);
          img.remove();
        }
      },
      true,
    );
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const types = e.key === 'Tab' ? [...new Set(this.input.own().map((o) => o.type))] : [];
      if (types.length > 1) {
        // Tab: the next kind in a mixed selection becomes the active one (its abilities, its production).
        e.preventDefault();
        // After the last kind, back to everyone's commands together.
        const cycle: (string | null)[] = [null, ...types];
        this.activeType = cycle[(cycle.indexOf(this.activeType) + 1) % cycle.length];
        return;
      }
      const key = e.key === 'Escape' ? 'Escape' : e.key.toUpperCase();
      if (this.menuItems.length) {
        // The open weapon menu takes its keys and Escape first; any other key closes it and goes on.
        const item = this.menuItems.find((x) => x.key === key);
        if (item || key === 'Escape') {
          e.preventDefault();
          if (item && !e.repeat) pressMenu(this, item);
          else this.weaponMenu = null;
          return;
        }
        this.weaponMenu = null;
      }
      const slot = this.gridKeys ? GRID_CODES.indexOf(e.code) : -1;
      // In grid mode a letter only presses the buttons past the grid (and Escape still cancels).
      const b = slot >= 0 ? this.buttons[slot] : this.buttons.find((x, i) => x.key === key && (!this.gridKeys || key === 'Escape' || i >= GRID_CODES.length));
      if (b) {
        e.preventDefault();
        if (!e.repeat) pressButton(this, b);
      }
    });
  }

  /** The selection's details, rebuilt only when more than its bars changed (so a hover or a tooltip on them holds). */
  detailsKey = '';

  /** Mouse clicks on the map while placing a building or choosing an attack target. */
  click(button: number, ground: Vector3 | null, shift: boolean, target?: Entity): boolean {
    if (this.targeting) {
      if (button === 0 && ground) this.aim(ground.x, ground.z, target, shift);
      if (!shift || button === 2) this.setTargeting(false);
      return true;
    }
    if (!this.placing) return false;
    if (button === 2) {
      this.placing = null;
      return true;
    }
    // A finger does not place at the first tap: it moves the footprint there; ✓ places it (see pinUi).
    if (this.input.touching) {
      if (ground) this.pin = ground.clone();
      return true;
    }
    this.place(ground, shift);
    return true;
  }

  /** The building being placed, ordered at `ground` (Shift: and kept armed for the next). */
  private place(ground: Vector3 | null, shift: boolean): void {
    if (!this.placing) return;
    const spot = ground && this.spot(this.placing, ground);
    const worker = this.workers()[0];
    // A Z Pod with no room for its add-on beside it would never get one.
    if (spot && worker && this.addonRoom(this.placing, spot) === null) {
      this.notify([{ player: this.player, kind: 'error', text: 'Pas de place pour l’extension du Pod.' }]);
      return;
    }
    if (spot && worker) {
      this.issue({ player: this.player, kind: 'build', ids: [worker.id], type: this.placing, tx: spot[0], ty: spot[1], queue: shift });
      if (!shift) {
        this.placing = null;
        this.buildMenu = false;
        // Off to build: out of the selection, so a stray tap or click no longer pulls it off the site (Shift keeps it
        // selected to queue more).
        this.input.selected.delete(worker.id);
      }
    }
  }

  /**
   * Touch screens: the footprint stays where it was put (`pin`, on the ground) rather than under a finger that has no
   * hover. A finger on it drags it; a tap elsewhere on the map moves it there; ✓ places the building, a long press on
   * ✓ places it and keeps the order armed for another; ✕ drops the order.
   */
  private pin: Vector3 | null = null;
  private readonly pinUi = el('div', 'pin-ui');

  /** A finger down at (x, y) on the footprint (or a tile round it) takes hold of it. */
  grab(x: number, y: number): boolean {
    if (!this.placing || !this.pin) return false;
    const g = this.input.groundAt(x, y);
    const spot = this.spot(this.placing, this.pin);
    if (!g || !spot) return false;
    const size = (DEFS[this.placing] as BuildingDef).size;
    return g.x >= spot[0] - 1 && g.x <= spot[0] + size + 1 && g.z >= spot[1] - 1 && g.z <= spot[1] + size + 1;
  }

  /** The held footprint follows the finger. */
  drag(ground: Vector3 | null): void {
    if (ground && this.placing) this.pin = ground.clone();
  }

  private makePinUi(): void {
    this.pinUi.hidden = true;
    this.pinUi.innerHTML = '<button class="cmd pin-ok" aria-label="Poser" title="Poser (appui long : poser et continuer)">✓</button><button class="cmd pin-no" aria-label="Annuler" title="Annuler">✕</button>';
    document.body.append(this.pinUi);
    const ok = this.pinUi.querySelector<HTMLElement>('.pin-ok')!;
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
      this.audio.play('click');
      this.place(this.pin, keep);
    });
    for (const type of ['pointerleave', 'pointercancel']) {
      ok.addEventListener(type, () => {
        clearTimeout(buzz);
        down = -1;
      });
    }
    this.pinUi.querySelector<HTMLElement>('.pin-no')!.addEventListener('click', () => {
      this.audio.play('click');
      this.placing = null;
    });
  }

  /** Left-click on the minimap: attack-move when targeting. */
  minimapClick(x: number, y: number): boolean {
    if (!this.targeting) return false;
    this.aim(x, y);
    this.setTargeting(false);
    return true;
  }

  private attack(x: number, z: number, target?: Entity, queue = false): void {
    const ids = this.input.own().map((e) => e.id);
    const enemy = target && this.world.hostile(target.owner, this.player) ? target.id : undefined;
    this.audio.play('target');
    this.issue({ player: this.player, kind: 'attack', ids, x: Math.round(x * FP), y: Math.round(z * FP), target: enemy, queue });
  }

  private aim(x: number, z: number, target?: Entity, queue = false): void {
    // Rally point: of the selected producers, on the ground, a unit or a resource (as a building's right click).
    if (this.aimed === 'rally') return this.input.rallyAt(x, z, target);
    if (this.aimed === 'patrol') {
      // Patrol: between where each unit stands and the point clicked.
      this.audio.play('order');
      return this.issue({ player: this.player, kind: 'patrol', ids: this.input.own().map((e) => e.id), x: Math.round(x * FP), y: Math.round(z * FP), queue });
    }
    if (!this.scanning) return this.attack(x, z, target, queue);
    const ids = this.input.own().map((e) => e.id);
    this.issue({ player: this.player, kind: 'ability', ids, x: Math.round(x * FP), y: Math.round(z * FP), name: this.aimed });
  }

  setTargeting(on: boolean, scan = false, ability?: string): void {
    this.targeting = on;
    this.scanning = on && scan;
    this.aimed = on ? ability : undefined;
    document.body.classList.toggle('targeting', on);
    document.body.classList.toggle('scanning', on && scan);
  }

  notify(events: GameEvent[]): void {
    showEvents(this, events);
  }

  /** Space: the view goes to the last attack. */
  toAlert(): void {
    if (this.alertAt) this.focus(this.alertAt.x, this.alertAt.y);
  }

  update(): void {
    updateBar(this);
    updatePanel(this);
    updateIdle(this);
    updateIdleProd(this);
    updateProd(this);
    updateGroups(this);
    updateCard(this);
    this.updateGhost();
    showEnd(this);
  }

  // ---------------------------------------------------------------- command card

  workers(): Entity[] {
    // Those that place buildings: workers, or Gaïa for the Dieux (their Esprits only harvest).
    return this.input.own().filter((e) => e.def.kind === 'unit' && ((e.def as UnitDef).builder ?? (e.def as UnitDef).worker));
  }

  /** The active kind in a mixed selection (Tab): its abilities and production are the ones on the card. */
  activeType: string | null = null;

  /** What the card's buttons depend on, cheap to read: they are worked out again only when it changes (at most once a
   * tick: resources, queues, sites, research and cooldowns move with the tick; the rest is the selection and this card's
   * own state). */
  buttonsKey = '';

  // ---------------------------------------------------------------- placement

  /** Top-left tile for a building centred under the cursor; mines snap to the nearest well. */
  private spot(type: string, ground: Vector3): [number, number] | null {
    const def = DEFS[type] as BuildingDef;
    if (def.energyRate) {
      let best: Entity | undefined;
      let bestD = 4 * FP;
      for (const w of this.world.entities.values()) {
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
  private addonRoom(type: string, spot: [number, number]): [number, number] | null | undefined {
    const def = DEFS[type] as BuildingDef;
    if (!def.addons?.length) return undefined;
    const big = [...def.addons].sort((a, b) => (DEFS[b] as BuildingDef).size - (DEFS[a] as BuildingDef).size)[0];
    return this.world.addonSpotAt(big, spot[0], spot[1], def.size, this.player) ?? null;
  }

  private updateGhost(): void {
    const touch = !!this.placing && this.input.touching;
    if (!this.placing) this.pin = null;
    else if (touch && !this.pin) this.pin = this.input.aim()?.clone() ?? null;
    const g = this.placing ? (touch ? this.pin : this.input.aim()) : this.input.hover;
    const spot = this.placing && g ? this.spot(this.placing, g) : null;
    this.ghost.visible = !!spot;
    this.pinUi.hidden = !(touch && spot);
    if (touch && spot && this.placing) {
      // Just below the footprint's corner nearest the camera (it looks from +x +y), kept on screen.
      const size = (DEFS[this.placing] as BuildingDef).size;
      const [x, z] = [spot[0] + size, spot[1] + size];
      const s = this.input.toScreen(new Vector3(x, heightAt(this.map, x, z), z));
      this.pinUi.style.left = `${Math.min(innerWidth - 60, Math.max(60, s.x))}px`;
      this.pinUi.style.top = `${Math.min(innerHeight - 60, Math.max(8, s.y + 10))}px`;
    }
    if (!this.placing || !g) {
      this.grid.hide();
      this.gridKey = '';
    }
    // The grid shows as soon as the order is armed: an extractor far from any well (no spot to snap to) still gets it,
    // the free wells lit, only without a footprint.
    if (this.placing && g) this.updateGrid(this.placing, g);
    if (!spot) this.grid.noFootprint();
    if (!spot || !this.placing) return;
    const def = DEFS[this.placing] as BuildingDef;
    const size = def.size;
    const room = this.addonRoom(this.placing, spot);
    const ok = this.world.canPlace(this.placing, spot[0], spot[1], this.player) && room !== null;
    let addon: { tx: number; ty: number; size: number; ok: boolean } | null = null;
    if (room !== undefined) {
      // The add-on's room: where it would go, or (none free) against the east side, in red.
      const big = Math.max(...def.addons!.map((t) => (DEFS[t] as BuildingDef).size));
      const [tx, ty] = room ?? [spot[0] + size, spot[1] + Math.floor((size - big) / 2)];
      addon = { tx, ty, size: big, ok: room !== null };
    }
    this.grid.footprint(spot[0], spot[1], size, ok, addon);
    (this.ghost.material as MeshBasicMaterial).color.set(ok ? 0x55ff66 : 0xff4444);
    this.ghost.scale.set(size, 1, size);
    const cx = spot[0] + size / 2;
    const cz = spot[1] + size / 2;
    this.ghost.position.set(cx, heightAt(this.map, cx, cz) + 0.15, cz);
  }

  /** The placement grid's tiles round the cursor, redrawn when it changes tile and once a second (sites come and go). */
  private updateGrid(type: string, at: Vector3): void {
    const cx = Math.floor(at.x);
    const cy = Math.floor(at.z);
    const key = `${type}|${cx}|${cy}|${Math.floor(this.world.tick / TICK_RATE)}`;
    if (key === this.gridKey) return;
    this.gridKey = key;
    // As far as the screen's corners reach on the ground (the sky beyond the map: the most it draws).
    let reach = 0;
    for (const [x, y] of [[0, 0], [innerWidth, 0], [0, innerHeight], [innerWidth, innerHeight]]) {
      const p = this.input.groundAt(x, y);
      reach = Math.max(reach, p ? Math.hypot(p.x - at.x, p.z - at.z) : GRID_REACH);
    }
    const def = DEFS[type] as BuildingDef;
    const net = this.world.powerNetwork(this.player);
    let fits = (x: number, y: number) => this.world.tileFits(type, x, y, this.player, net);
    if (def.energyRate) {
      // Extractors: the free wells light up, every other tile is red.
      const free = new Set<number>();
      for (const w of this.world.entities.values()) {
        if (w.type !== 'puits' || !this.world.canPlace(type, w.tx, w.ty, this.player)) continue;
        for (let y = w.ty; y < w.ty + def.size; y++) for (let x = w.tx; x < w.tx + def.size; x++) free.add(y * this.map.width + x);
      }
      fits = (x, y) => free.has(y * this.map.width + x);
    }
    this.grid.cellsAt(cx, cy, reach, fits);
  }
}
