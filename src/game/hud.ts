import { BoxGeometry, Mesh, MeshBasicMaterial, type Scene, Vector3 } from 'three';
import { type BuildingDef, DEFS, type UnitDef } from '../data';
import { el, noIcon } from './glyphs';
import type { GameMap } from '../map';
import { FP } from '../sim/fixed';
import { PlaceGrid } from '../render/placegrid';
import type { Command, Entity, GameEvent, World } from '../sim/world';
import type { Audio } from '../audio';
import type { Input } from './input';
import { Portrait } from '../render/portrait';
import { showEnd, showEvents } from './hud-toasts';
import { updatePanel } from './hud-panel';
import { cancelSlot, toggleProd, updateBar, updateGroups, updateIdle, updateIdleProd, updateProd } from './hud-bar';
import { makePinUi, place, spotAt, updateGhost } from './hud-place';
import { leaveAlt, updateAlt } from './hud-alt';
import { PoseConfirm } from './hud-pose';
import { type Button, GRID_CODES, pressButton, pressMenu, showTip, updateCard } from './hud-card';

const TUCK_MS = 1200;
/** Two taps this close in time are one double tap (as for units). */
const DOUBLE_TAP_MS = 350;

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
  /** When a group was last set, as the chips last showed. */
  groupsAt = -1;
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
  /** Z: the Pod whose add-on (`placing`) is being put in one of its 8 places (équilibreur 22/11). */
  addonPod: number | null = null;
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
  /** When the end banner last came up (ms): a press begun before it (a finger already down) does not press its buttons. */
  endShownAt = 0;
  /** More buttons for the end-of-game banner (the telemetry's). */
  endButtons = '';
  /** A match against a friend online: the end offers a rematch instead of a new game. */
  online = false;
  readonly tip = el('div', 'cmd-tip');
  /** Option « Replier les panneaux » (touch screens): the sheet and the commands slide down this long after the last
   * touch on them, a new selection or a command; the tab left at the bottom brings them back. */
  readonly tab = el('button', 'console-tab');
  touchedAt = 0;
  /** The marking menu (game/radial.ts) is open: a finger still choosing. */
  ringOpen = false;
  private tuckSel = '';
  readonly ghost: Mesh;
  /** A building just ordered, shown where it will rise. */
  readonly pose: PoseConfirm;
  /** The end banner offers the game's analysis. */
  bilan = false;
  /** The alternative desktop interface (game/hud-alt.ts), and the selection it last opened the build tree for. */
  alt = false;
  altSel = '';
  /** Set by the game: a building model's top (world units), for the bubble above it. */
  top: (id: number, built: boolean) => number | undefined = () => undefined;
  readonly grid: PlaceGrid;
  /** What the grid's tiles were last drawn for: they are redrawn only when the cursor changes tile (or each second). */
  gridKey = '';

  constructor(
    readonly world: World,
    readonly map: GameMap,
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
    document.body.append(this.bar, this.console, this.toasts, this.banner, this.tab);
    this.tab.hidden = true;
    this.tab.title = 'Afficher les panneaux';
    this.tab.addEventListener('click', () => (this.touchedAt = performance.now()));
    const touched = () => (this.touchedAt = performance.now());
    this.console.addEventListener('pointerdown', touched, true);
    this.console.addEventListener('scroll', touched, true);
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
    this.pose = new PoseConfirm(scene, map);
    this.grid = new PlaceGrid(scene, map);
    makePinUi(this);

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
    // A finger has no hover: a long press shows the tooltip (and presses nothing); a short one presses on release.
    let held: { press: () => void; long: boolean; timer: number } | null = null;
    const hold = (el: HTMLElement, press: () => void) => {
      if (held) clearTimeout(held.timer);
      const h: { press: () => void; long: boolean; timer: number } = (held = { press, long: false, timer: 0 });
      h.timer = window.setTimeout(() => {
        h.long = true;
        showTip(this, el);
      }, 450);
    };
    this.menu.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-wkey]');
      const item = this.menuItems.find((x) => x.key === el?.dataset.wkey);
      if (!item || !el) return;
      if (e.pointerType !== 'touch') return pressMenu(this, item);
      hold(el, () => pressMenu(this, item));
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
    this.card.addEventListener('pointerdown', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-key]');
      // By its label too: two abilities of a mixed selection may share a key (Peau de roc and Réanimation, R).
      const b = this.buttons.find((x) => x.key === el?.dataset.key && x.label === el?.getAttribute('aria-label')) ?? this.buttons.find((x) => x.key === el?.dataset.key);
      if (!b || !el) return;
      if (e.pointerType !== 'touch') return pressButton(this, b);
      hold(el, () => pressButton(this, b));
    });
    const release = (press: boolean) => {
      if (!held) return;
      clearTimeout(held.timer);
      if (held.long) this.tip.hidden = true;
      else if (press) held.press();
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
        // A passenger with powers (notice: they use them from a Fortin or a Scarabée) is picked: its card shows them,
        // and a Sortir button; the others step out at once.
        const u = this.world.entities.get(Number(out.dataset.unload));
        if (u && this.world.abilitiesFor(u).length && out.dataset.pick) {
          this.input.selected.clear();
          this.input.selected.add(u.id);
          return;
        }
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
    // A finger does not place at the first tap: it moves the footprint there; ✓ or a second tap there places it.
    if (this.input.touching) {
      if (ground && !this.pinTapped(ground, false)) this.pin = ground.clone();
      return true;
    }
    place(this, ground, shift);
    return true;
  }

  /**
   * Touch screens: the footprint stays where it was put (`pin`, on the ground) rather than under a finger that has no
   * hover. A finger on it drags it; a tap elsewhere on the map moves it there; ✓ places the building, a long press on
   * ✓ places it and keeps the order armed for another; ✕ drops the order.
   */
  pin: Vector3 | null = null;
  readonly pinUi = el('div', 'pin-ui');

  /** A finger down at (x, y) on the footprint (or a tile round it) takes hold of it. */
  grab(x: number, y: number): boolean {
    if (!this.placing || !this.pin) return false;
    const g = this.input.groundAt(x, y);
    const spot = spotAt(this, this.placing, this.pin);
    if (!g || !spot) return false;
    if (this.pinTapped(g, true)) return true;
    const size = (DEFS[this.placing] as BuildingDef).size;
    return g.x >= spot[0] - 1 && g.x <= spot[0] + size + 1 && g.z >= spot[1] - 1 && g.z <= spot[1] + size + 1;
  }

  private pinTap = { t: 0, x: 0, y: 0, down: false };
  /**
   * Touch: the second of two quick taps at the same spot places the building there (as ✓); refused there, it stays
   * armed. Seen at the finger's touch-down (`grab`) and at its release (`click`): a release after its own touch-down is
   * the same tap, not a second one.
   */
  private pinTapped(ground: Vector3, down: boolean): boolean {
    const now = performance.now();
    const s = this.input.toScreen(ground);
    const last = this.pinTap;
    this.pinTap = { t: now, ...s, down };
    if (!this.placing || (last.down && !down) || now - last.t > DOUBLE_TAP_MS || Math.hypot(s.x - last.x, s.y - last.y) > 40) return false;
    this.pinTap.t = 0;
    this.pin = ground.clone();
    const def = DEFS[this.placing] as BuildingDef;
    const spot = spotAt(this, this.placing, ground);
    if (spot && !def.energyRate && !this.world.canPlace(this.placing, spot[0], spot[1], this.player)) {
      this.notify([{ player: this.player, kind: 'error', text: this.world.misplaced(def, spot[0], spot[1], this.player) }]);
      return true;
    }
    this.audio.play('click');
    place(this, ground, false);
    return true;
  }

  /** The held footprint follows the finger. */
  drag(ground: Vector3 | null): void {
    if (ground && this.placing) this.pin = ground.clone();
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
    // Any unit or building clicked, our own and our allies' too (Attaquer, then a click on it); not a resource.
    const enemy = target && target.owner >= 0 ? target.id : undefined;
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

  /** The tick the interface last showed: what only the simulation changes (resources, supply, idle workers, queues,
   * health) is read again once a tick, not once a frame (each read went through every entity of the match). */
  private shownTick = -1;
  /** The selection's ids, joined once a frame for all that depends on it. */
  selKey = '';
  /** What the selection panel last showed (tick, selection, active kind). */
  panelKey = '';

  update(): void {
    const fresh = this.world.tick !== this.shownTick;
    this.shownTick = this.world.tick;
    this.selKey = [...this.input.selected].join();
    if (fresh) {
      updateBar(this);
      updateIdle(this);
      updateIdleProd(this);
    }
    updatePanel(this);
    if (fresh || !this.prodKey) updateProd(this);
    if (fresh || this.input.groupSet.time !== this.groupsAt) {
      this.groupsAt = this.input.groupSet.time;
      updateGroups(this);
    }
    updateCard(this);
    if (this.alt) updateAlt(this);
    else leaveAlt(this);
    updateGhost(this);
    showEnd(this);
    this.tuck();
  }

  /** Slides the sheet and the commands away once idle (never while a list, a placement, an aim or a tooltip is open). */
  private tuck(): void {
    const now = performance.now();
    const sel = this.selKey;
    if (sel !== this.tuckSel || this.input.pickedAt > this.touchedAt || this.buildMenu || this.weaponMenu || this.placing || this.targeting || this.ringOpen || !this.tip.hidden) this.touchedAt = now;
    this.tuckSel = sel;
    const tucked = document.body.classList.contains('tuck') && now - this.touchedAt > TUCK_MS;
    if (tucked === this.console.classList.contains('tucked')) return;
    // The minimap drops to the bottom too, where the commands were (upright phones: they sit below it).
    if (tucked) this.console.style.setProperty('--drop', `${Math.max(0, this.card.getBoundingClientRect().bottom - this.mapSlot.getBoundingClientRect().bottom)}px`);
    this.console.classList.toggle('tucked', tucked);
    this.tab.hidden = !tucked;
  }

  // ---------------------------------------------------------------- command card

  workers(): Entity[] {
    // Those that place buildings: workers, or Gaïa for the Dieux (their Esprits only harvest).
    // The Isdaris Obélisque too: it materialises its side's buildings.
    return this.input.own().filter((e) => (e.def.kind === 'unit' && ((e.def as UnitDef).builds?.length || ((e.def as UnitDef).builder ?? (e.def as UnitDef).worker))) || (e.def.kind === 'building' && e.buildLeft === 0 && !!(e.def as BuildingDef).builds));
  }

  /** The active kind in a mixed selection (Tab): its abilities and production are the ones on the card. */
  activeType: string | null = null;

  /** What the card's buttons depend on, cheap to read: they are worked out again only when it changes (at most once a
   * tick: resources, queues, sites, research and cooldowns move with the tick; the rest is the selection and this card's
   * own state). */
  buttonsKey = '';
}
