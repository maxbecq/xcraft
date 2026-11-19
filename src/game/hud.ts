import BALANCE from '../balance.json';
import { BoxGeometry, Mesh, MeshBasicMaterial, type Scene, Vector3 } from 'three';
import { ABILITIES, abilitiesOf, ARTEFACTS, type BuildingDef, LOOKS, type Cost, DEFS, FACTIONS, MYTHS, type Mythology, type UnitDef, type UpgradeDef, KIT, WEAPONS, withKit } from '../data';
import { type GameMap, heightAt } from '../map';
import { FP, TICK_RATE, ticks } from '../sim/fixed';
import { GRID_REACH, PlaceGrid } from '../render/placegrid';
import type { Command, Entity, GameEvent, World } from '../sim/world';
import type { Audio } from '../audio';
import type { Input } from './input';
import { Portrait } from '../render/portrait';

interface Button {
  label: string;
  /** Entity type whose icon to show. */
  icon?: string;
  key: string;
  /** Command pictogram (public/icons/cmd/<faction>/<cmd>.svg), drawn in the player's side's style; the label goes to the tooltip. */
  cmd?: string;
  cost?: Cost;
  /** Why the button is disabled (unmet prerequisites), shown in its tooltip. */
  reason?: string;
  /** What it makes or researches, for the tooltip's details (defaults to the icon). */
  type?: string;
  /** Its time in seconds, when not the type's own (a god's level). */
  seconds?: number;
  /** The ability it uses, whose effect the tooltip explains. */
  ability?: string;
  action: () => void;
}

/** A command without its player field. */
type Order<C = Command> = C extends unknown ? Omit<C, 'player'> : never;

const KEY_LABEL: Record<string, string> = { Escape: 'Échap' };

/** Grid hotkeys (Options): the keys under the left hand, row by row, in the command card's order (4 to a row). Physical
 * keys, so the same places on any layout: A Z E R / Q S D F / W X C V in AZERTY, Q W E R / A S D F / Z X C V in QWERTY. */
const GRID_CODES = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyZ', 'KeyX', 'KeyC', 'KeyV'];
/** What each grid key prints on this keyboard: a guess from the language, then what the keys really typed. */
const gridLabel: Record<string, string> = Object.fromEntries(
  GRID_CODES.map((c, i) => [c, (navigator.language?.startsWith('fr') ? 'AZERQSDFWXCV' : 'QWERASDFZXCV')[i]]),
);
void (navigator as Navigator & { keyboard?: { getLayoutMap(): Promise<Map<string, string>> } }).keyboard
  ?.getLayoutMap()
  .then((m) => GRID_CODES.forEach((c) => m.get(c) && (gridLabel[c] = m.get(c)!.toUpperCase())))
  .catch(() => {});
window.addEventListener('keydown', (e) => {
  if (GRID_CODES.includes(e.code) && /^\p{L}$/u.test(e.key)) gridLabel[e.code] = e.key.toUpperCase();
}, true);

/** The sign before each message: refused (no entry), done (a tick), under attack (a shield with a bang). */
const SIGNS: Record<GameEvent['kind'], string> = {
  error: '<svg class="sign" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M5.5 14.5l9-9" stroke="currentColor" stroke-width="2.4"/></svg>',
  done: '<svg class="sign" viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 10.5l4.2 4.2L16.5 5.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  alert: '<svg class="sign" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5l7 2.6v5.2c0 4.4-3 7.6-7 9.2-4-1.6-7-4.8-7-9.2V4.1z" fill="currentColor"/><path d="M10 5.5v5.5M10 13.5v1.4" stroke="#1a0604" stroke-width="2.4" stroke-linecap="round"/></svg>',
};

/** Resource bar, selection panel, command card, messages and building placement. */
export class Hud {
  private readonly bar = el('div', 'hud-bar');
  /** Bottom console: minimap slot, selection panel, command card. */
  private readonly console = el('div', 'console');
  readonly mapSlot = el('div', 'slot map-slot');
  private readonly panel = el('div', 'hud-panel');
  /** Selection text, beside the live portrait. */
  private readonly details = el('div', 'details');
  readonly portrait = new Portrait();
  private readonly card = el('div', 'hud-card');
  private readonly toasts = el('div', 'hud-toasts');
  /** Where the last attack alert happened (tiles): Space or a click on its message goes there. */
  alertAt: { x: number; y: number } | null = null;
  /** Set by the game: marks an alert on the minimap, and moves the view. */
  ping: (x: number, y: number) => void = () => {};
  focus: (x: number, y: number) => void = () => {};
  /** Hit points (and shield) of our things at the last tick, to find where an attack lands. */
  private readonly lastHp = new Map<number, number>();
  /** When each of ours was last hurt (ms), for the red edge on its picture in the selection. */
  private readonly hitAt = new Map<number, number>();
  /** Our workers on their way to build, by id, with what: to name a building cancelled for want of resources. */
  private readonly sites = new Map<number, string>();
  /** Idle workers: their count on a button in the top bar (hidden at none); it flashes as one more stops. */
  readonly idle = el('button', 'chip idle-workers');
  private idleCount = 0;
  /** Production buildings with an empty queue: a click goes through them one by one. */
  readonly idleProd = el('button', 'chip idle-prod');
  private idleProdCount = 0;
  /** The production panel (F3 or its button): every producer of ours, what it makes and how far along, idle ones dimmed;
   * a click on a row selects that producer and shows it. */
  readonly prodToggle = el('button', 'chip prod-toggle');
  private readonly prod = el('div', 'prod-panel');
  private readonly prodList = el('div', 'prod-list');
  private prodKey = '';
  /** Control groups: one icon each (the group's most numerous type), with its key and head count. */
  readonly groups = el('div', 'groups');
  private groupsKey = '';
  private buttons: Button[] = [];
  /** Hotkeys by place in the card rather than by name (Options). */
  gridKeys = false;
  /** The key printed on a button (and the grid key that presses it, in grid mode). */
  private keyLabel(b: Button): string {
    const i = this.buttons.indexOf(b);
    return this.gridKeys && b.key !== 'Escape' && i >= 0 && i < GRID_CODES.length ? gridLabel[GRID_CODES[i]] : (KEY_LABEL[b.key] ?? b.key);
  }
  private cardKey = '';
  /** Last button pressed and how it reacted, so the card rebuilt by that press keeps the animation. */
  private pressed = { key: '', anim: '', at: -Infinity };
  /** Open build menu: basic buildings, or the advanced (tech) ones. */
  private buildMenu: false | 'basic' | 'advanced' = false;
  /** Z Plate-forme: the socle whose weapon is being picked before it is queued. */
  private weaponMenu: string | null = null;
  /** Its weapons, in a menu dropped under the socle's button (`menu`). */
  private menuItems: Button[] = [];
  private readonly menu = el('div', 'cmd-menu');
  private placing: string | null = null;
  /** The building type being placed, if any. */
  get placingType(): string | null {
    return this.placing;
  }
  /** Waiting for a click to attack or attack-move. */
  private targeting = false;
  /** The click aims a Forge's Observation céleste instead of an attack. */
  private scanning = false;
  /** Unit ability being aimed (none: a building's). */
  private aimed?: string;
  private readonly banner = el('div', 'hud-banner');
  /** More buttons for the end-of-game banner (the telemetry's). */
  endButtons = '';
  /** A match against a friend online: the end offers a rematch instead of a new game. */
  online = false;
  private readonly tip = el('div', 'cmd-tip');
  private readonly ghost: Mesh;
  private readonly grid: PlaceGrid;
  /** What the grid's tiles were last drawn for: they are redrawn only when the cursor changes tile (or each second). */
  private gridKey = '';

  constructor(
    private readonly world: World,
    private readonly map: GameMap,
    private readonly player: number,
    private readonly input: Input,
    scene: Scene,
    private readonly issue: (c: Command) => void,
    private readonly audio: Audio,
    /** Watching (AI against AI, a replay): the players' own messages are not shown. */
    private readonly spectator = false,
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
    this.prodToggle.addEventListener('click', () => this.toggleProd());
    try {
      this.prod.hidden = localStorage.getItem('xcraft.prod') !== '1' || spectator;
    } catch {
      this.prod.hidden = true;
    }
    this.prodToggle.classList.toggle('on', !this.prod.hidden);
    const close = el('button', 'prod-close');
    close.textContent = '×';
    close.title = 'Fermer';
    close.addEventListener('click', () => this.toggleProd());
    this.prod.append(close, this.prodList);
    document.body.append(this.prod);
    // On a touch screen, a tap anywhere else closes it (and does nothing more on the map).
    window.addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      if (e.pointerType !== 'touch' || this.prod.hidden || this.prod.contains(t) || this.prodToggle.contains(t)) return;
      this.toggleProd();
      if (t instanceof HTMLCanvasElement) e.stopPropagation();
    }, { capture: true });
    this.prod.addEventListener('click', (e) => {
      const q = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]');
      if (q) return this.cancelSlot(q);
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
      this.toggleProd();
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
      tipTimer = window.setTimeout(() => this.showTip(el), 80);
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
      if (item) this.pressMenu(item);
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
      if (e.pointerType !== 'touch') return this.press(b);
      if (held) clearTimeout(held.timer);
      const h: { b: Button; long: boolean; timer: number } = (held = { b, long: false, timer: 0 });
      h.timer = window.setTimeout(() => {
        h.long = true;
        this.showTip(el);
      }, 450);
    });
    const release = (press: boolean) => {
      if (!held) return;
      clearTimeout(held.timer);
      if (held.long) this.tip.hidden = true;
      else if (press) this.press(held.b);
      held = null;
    };
    // On the window: the card may be rebuilt between the press and the release, its button gone from the page.
    window.addEventListener('pointerup', () => release(true));
    window.addEventListener('pointercancel', () => release(false));
    this.panel.addEventListener('pointerdown', (e) => {
      const q = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]');
      if (q) return this.cancelSlot(q);
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
          if (item && !e.repeat) this.pressMenu(item);
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
        if (!e.repeat) this.press(b);
      }
    });
  }

  /** A click on a queued icon (selection panel or production panel): that one out of the queue. */
  private cancelSlot(q: HTMLElement): void {
    const id = Number(q.dataset.of);
    const slot = Number(q.dataset.slot);
    if (this.world.entities.get(id)?.owner !== this.player) return;
    this.audio.play('click');
    this.issue({ player: this.player, kind: 'cancel', ids: [id], slot });
  }

  /** The selection's details, rebuilt only when more than its bars changed (so a hover or a tooltip on them holds). */
  private detailsKey = '';
  private setDetails(html: string): void {
    const bars = /width:[\d.e+-]+%/g;
    const key = html.replace(bars, '');
    if (key !== this.detailsKey) {
      this.detailsKey = key;
      this.details.innerHTML = html;
      return;
    }
    const widths = html.match(bars) ?? [];
    this.details.querySelectorAll<HTMLElement>('[style*="width"]').forEach((el, i) => {
      if (widths[i]) el.style.width = widths[i].slice(6);
    });
  }

  private toggleProd(): void {
    this.prod.hidden = !this.prod.hidden;
    this.prodToggle.classList.toggle('on', !this.prod.hidden);
    this.prodKey = '';
    try {
      localStorage.setItem('xcraft.prod', this.prod.hidden ? '0' : '1');
    } catch {
      // private browsing: open for this game only
    }
  }

  /** The production panel: rows rebuilt when a queue changes, progress bars moved every frame. */
  private updateProd(): void {
    if (!this.prodToggle.firstChild) this.prodToggle.innerHTML = `${img(FACTIONS[this.world.players[this.player].faction].barracks, '')}<b>≡</b>`;
    if (this.prod.hidden) return;
    const producers = [...this.world.entities.values()]
      .filter((e) => e.owner === this.player && e.buildLeft === 0 && (e.def.kind === 'building' ? !!(e.def as BuildingDef).trains?.length || e.queue.length > 0 : e.queue.length > 0))
      .sort((a, b) => Number(!a.queue.length) - Number(!b.queue.length) || a.type.localeCompare(b.type) || a.id - b.id);
    const key = producers.map((e) => `${e.id}:${e.queue.join(',')}`).join('|');
    if (key !== this.prodKey) {
      this.prodKey = key;
      this.prodList.innerHTML = producers.length
        ? producers
            .map((e) => {
              const queue = e.queue.map((t, i) => `<span class="cancel${i ? '' : ' now'}" data-of="${e.id}" data-slot="${i}" title="${DEFS[t].name}. Clic : annuler">${img(t, DEFS[t].name)}${i ? '' : '<i></i>'}</span>`).join('');
              return `<button class="prod-row${e.queue.length ? '' : ' idle'}" data-id="${e.id}" title="${e.def.name}${e.queue.length ? '' : ' : à l’arrêt'}"><span class="who">${img(e.type, e.def.name)}</span>${queue || '<em>à l’arrêt</em>'}</button>`;
            })
            .join('')
        : '<em>Aucun bâtiment de production</em>';
    }
    for (const bar of this.prod.querySelectorAll<HTMLElement>('.prod-row')) {
      const e = this.world.entities.get(Number(bar.dataset.id));
      const fill = bar.querySelector<HTMLElement>('.now i');
      if (!e || !fill || !e.queue.length) continue;
      // The world's time for it: a god's level shortens it.
      fill.style.width = `${Math.round(100 * (1 - e.trainLeft / this.world.trainTime(e, e.queue[0])))}%`;
    }
  }

  private updateGroups(): void {
    const list = this.input.groupList().map(([k, es]) => {
      const count = new Map<string, number>();
      for (const e of es) count.set(e.type, (count.get(e.type) ?? 0) + 1);
      const type = [...count].sort((a, b) => b[1] - a[1])[0][0];
      return { k, type, n: es.length };
    });
    const set = this.input.groupSet;
    const key = list.map((g) => `${g.k}${g.type}${g.n}`).join('|') + set.time;
    if (key === this.groupsKey) return;
    this.groupsKey = key;
    const fresh = performance.now() - set.time < 500 ? set.key : '';
    this.groups.innerHTML = list
      .map((g) => `<button class="chip${g.k === fresh ? ' flash' : ''}" data-g="${g.k}" title="Groupe ${g.k.slice(5)} : ${DEFS[g.type].name}"><kbd>${g.k.slice(5)}</kbd>${img(g.type, '')}<b>${g.n}</b></button>`)
      .join('');
  }

  private updateIdle(): void {
    const n = this.input.idleWorkers().length;
    if (n === this.idleCount) return;
    if (!this.idle.firstChild) this.idle.innerHTML = `${img(FACTIONS[this.world.players[this.player].faction].worker, '')}<b></b>`;
    this.idle.lastChild!.textContent = String(n);
    this.idle.hidden = n === 0;
    if (n > this.idleCount) {
      this.idle.classList.remove('flash');
      void this.idle.offsetWidth;
      this.idle.classList.add('flash');
    }
    this.idleCount = n;
  }

  /** The idle-production chip: how many production buildings stand with an empty queue. */
  private updateIdleProd(): void {
    const p = this.input.idleProducers().length;
    if (p !== this.idleProdCount) {
      if (!this.idleProd.firstChild) this.idleProd.innerHTML = `${img(FACTIONS[this.world.players[this.player].faction].barracks, '')}<b></b>`;
      this.idleProd.lastChild!.textContent = String(p);
      this.idleProd.hidden = p === 0;
      if (p > this.idleProdCount) {
        this.idleProd.classList.remove('flash');
        void this.idleProd.offsetWidth;
        this.idleProd.classList.add('flash');
      }
      this.idleProdCount = p;
    }
  }

  /** Sets a resource's count; it flashes as it goes up (income) or down (spending). */
  private count(span: HTMLElement, value: number): void {
    const text = span.lastChild!;
    const before = Number(text.textContent);
    text.textContent = String(value);
    if (Number.isNaN(before) || before === value) return;
    const dir = value > before ? 'gain' : 'spend';
    span.classList.remove('gain', 'spend');
    void span.offsetWidth;
    span.classList.add(dir);
  }

  /** A command button pressed, by click or hotkey: it sinks with a tick, or shakes and says why it is locked. */
  private press(b: Button): void {
    const el = this.card.querySelector<HTMLElement>(`[data-key="${CSS.escape(b.key)}"]`);
    const anim = (name: string) => {
      this.pressed = { key: b.key, anim: name, at: performance.now() };
      if (!el) return;
      el.classList.remove('pressed', 'denied');
      void el.offsetWidth; // restarts the animation on a repeated press
      el.classList.add(name);
      el.addEventListener('animationend', () => el.classList.remove(name), { once: true });
    };
    if (b.reason) {
      this.audio.play('error', 0.4);
      anim('denied');
      if (el) this.showTip(el);
      return;
    }
    this.audio.play('click');
    anim(el?.classList.contains('off') ? 'denied' : 'pressed');
    b.action();
  }

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
    this.pinUi.innerHTML = '<button class="pin-ok" aria-label="Poser" title="Poser (appui long : poser et continuer)">✓</button><button class="pin-no" aria-label="Annuler" title="Annuler">✕</button>';
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

  private setTargeting(on: boolean, scan = false, ability?: string): void {
    this.targeting = on;
    this.scanning = on && scan;
    this.aimed = on ? ability : undefined;
    document.body.classList.toggle('targeting', on);
    document.body.classList.toggle('scanning', on && scan);
  }

  notify(events: GameEvent[]): void {
    // The world's alert says only "attacked": the place is the last of ours that lost health this tick.
    let hit: Entity | undefined;
    if (this.lastHp.size > 2 * this.world.entities.size + 64) {
      this.lastHp.clear(); // forget the dead now and then
      this.hitAt.clear();
    }
    for (const e of this.world.entities.values()) {
      if (e.owner !== this.player) continue;
      const was = this.lastHp.get(e.id);
      if (was !== undefined && e.hp + e.shield < was) {
        hit = e;
        this.hitAt.set(e.id, performance.now());
      }
      this.lastHp.set(e.id, e.hp + e.shield);
    }
    // Every message is addressed to one player (a refusal, a building done, an attack): a spectator sees none.
    if (this.spectator) return;
    // A worker that reached its site but could no longer pay drops its build order with a bare "Pas assez de…":
    // say what was lost, as an alert pointing at the worker (it comes long after the order, often off screen).
    const dropped = [...this.sites].filter(([id]) => this.world.entities.get(id)?.order?.kind !== 'build');
    this.sites.clear();
    for (const e of this.world.entities.values()) if (e.owner === this.player && e.order?.kind === 'build') this.sites.set(e.id, e.order.type);
    for (let ev of events) {
      if (ev.player !== this.player) continue;
      let at: { x: number; y: number } | undefined;
      if (ev.kind === 'alert' && hit) at = { x: hit.x / FP, y: hit.y / FP };
      const site = ev.kind === 'error' && ev.text.startsWith('Pas assez') ? dropped.shift() : undefined;
      const worker = site && this.world.entities.get(site[0]);
      if (site) {
        ev = { ...ev, kind: 'alert', text: `${DEFS[site[1]].name} : construction annulée, ${ev.text[0].toLowerCase()}${ev.text.slice(1)}` };
        if (worker) at = { x: worker.x / FP, y: worker.y / FP };
      }
      // The same message again: its line counts up (×2, ×3…) and stays on, instead of piling up.
      const same = [...this.toasts.children].find((c): c is HTMLElement => c instanceof HTMLElement && !c.classList.contains('gone') && c.dataset.kind === ev.kind && c.dataset.text === ev.text);
      if (same) {
        const n = Number(same.dataset.n) + 1;
        same.dataset.n = String(n);
        same.querySelector('.times')!.textContent = `×${n}`;
        same.classList.remove('bump');
        void same.offsetWidth; // restart the bump
        same.classList.add('bump');
        this.toasts.append(same); // newest at the bottom
        this.expire(same, ev.kind);
        if (performance.now() - Number(same.dataset.sound) > 400) {
          this.audio.play(ev.kind);
          same.dataset.sound = String(performance.now());
        }
        continue;
      }
      const t = el('div', `hud-toast ${ev.kind}`);
      t.innerHTML = SIGNS[ev.kind];
      Object.assign(t.dataset, { kind: ev.kind, text: ev.text, n: '1', sound: String(performance.now()) });
      if (at) {
        const to = at;
        this.alertAt = to;
        this.ping(to.x, to.y);
        t.title = 'Aller voir (Espace ou Entrée)';
        t.addEventListener('click', () => this.focus(to.x, to.y));
      }
      this.audio.play(ev.kind);
      t.append(ev.text, el('b', 'times'));
      this.toasts.append(t);
      this.expire(t, ev.kind);
      while (this.toasts.children.length > 4) this.toasts.firstChild!.remove();
    }
  }

  /** (Re)starts a message's life: it fades after a while, shorter for a refusal, longer for an attack. */
  private expire(t: HTMLElement, kind: GameEvent['kind']): void {
    const life = kind === 'alert' ? 5000 : kind === 'done' ? 3000 : 2200;
    clearTimeout(Number(t.dataset.fade));
    clearTimeout(Number(t.dataset.drop));
    t.dataset.fade = String(setTimeout(() => t.classList.add('gone'), life));
    t.dataset.drop = String(setTimeout(() => t.remove(), life + 300));
  }

  /** Space: the view goes to the last attack. */
  toAlert(): void {
    if (this.alertAt) this.focus(this.alertAt.x, this.alertAt.y);
  }

  update(): void {
    const p = this.world.players[this.player];
    const s = this.world.supply(this.player);
    const secs = Math.floor((this.world.tick / ticks(60)) * 60);
    if (!this.bar.children.length) this.bar.innerHTML = '<span class="res clock">-</span><span class="res min"><i></i>-</span><span class="res nrg"><i></i>-</span><span class="res sup"><i></i>-</span>';
    const [clock, min, nrg, sup] = this.bar.children as HTMLCollectionOf<HTMLElement>;
    clock.lastChild!.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    this.count(min, p.minerals);
    this.count(nrg, p.energy);
    sup.lastChild!.textContent = `${s.used}/${s.max}`;
    sup.classList.toggle('full', s.used >= s.max);
    this.updatePanel();
    this.updateIdle();
    this.updateIdleProd();
    this.updateProd();
    this.updateGroups();
    this.updateCard();
    this.updateGhost();
    if (this.world.winner !== null && this.banner.hidden) {
      const won = this.world.winner === this.player;
      this.banner.innerHTML = `<h1>${won ? 'Victoire !' : 'Défaite…'}</h1><div class="row"><button data-p="quit">Menu principal</button><button data-p="restart">${this.online ? 'Revanche' : 'Rejouer'}</button><button data-p="replay">Enregistrer le replay</button>${this.endButtons}</div>`;
      this.banner.classList.toggle('won', won);
      this.banner.hidden = false;
    }
  }

  // ---------------------------------------------------------------- selection panel

  private updatePanel(): void {
    const sel = [...this.input.selected].map((id) => this.world.entities.get(id)).filter((e): e is Entity => !!e);
    this.portrait.show(sel.length === 1 ? sel[0].type : null, sel[0]?.owner);
    this.portrait.canvas.hidden = sel.length !== 1;
    if (sel.length === 0) {
      this.setDetails('');
      return;
    }
    if (sel.length > 1) {
      this.setDetails(`<div class="grid">${sel
        .slice(0, 24)
        .map((e) => `<div class="tile${e.type === this.activeType ? ' active' : ''}${performance.now() - (this.hitAt.get(e.id) ?? -1e9) < 500 ? ' hurt' : ''}" data-id="${e.id}" style="--hp:${e.hp / e.maxHp}">${img(e.type, e.def.name)}</div>`)
        .join('')}</div>`);
      return;
    }
    const e = sel[0];
    let html = `<div class="name">${e.def.name}${(e.def as UnitDef).levels ? ` <small>niveau ${e.lvl}</small>` : ''}</div>`;
    if (e.def.kind === 'resource') {
      html += `<div class="info">${Number.isFinite(e.amount) ? `${e.amount} restants` : 'Inépuisable'}</div>`;
    } else {
      if (e.maxShield) html += `<div class="hp shield"><div style="width:${(100 * e.shield) / e.maxShield}%"></div></div>`;
      html += `<div class="hp"><div style="width:${(100 * e.hp) / e.maxHp}%"></div></div><div class="info">${e.hp} / ${e.maxHp}${e.maxShield ? ` · bouclier ${e.shield} / ${e.maxShield}` : ''}</div>`;
    }
    if (e.def.kind === 'building') {
      const def = e.def as BuildingDef;
      // Construction or production: a block of its own, set beside the rest on wide screens.
      if (e.buildLeft > 0) {
        html += `<div class="prod">${progress('Construction', 1 - e.buildLeft / ticks(def.buildTime))}</div>`;
      } else if (e.queue.length) {
        const first = DEFS[e.queue[0]] as UnitDef | UpgradeDef;
        html += `<div class="prod">${progress(first.name, 1 - e.trainLeft / ticks(first.buildTime))}`;
        // Each one in the queue: a click (or a tap) takes it out, refunded.
        const own = e.owner === this.player && !this.spectator;
        html += `<div class="queue">${e.queue
          .map((t, i) => {
            const name = e.kits[i] ? `${DEFS[t].name} : ${WEAPONS[e.kits[i]].name}` : DEFS[t].name;
            return own ? `<span class="cancel" data-of="${e.id}" data-slot="${i}" title="${name}. Clic : annuler">${img(t, name)}</span>` : `<span>${img(t, name)}</span>`;
          })
          .join('')}</div></div>`;
      }
    }
    // The Temple primordial: each mythology's ultimate, charging while its three gods stand.
    if (e.type === 'primordial' && e.buildLeft === 0 && e.owner === this.player) {
      html += `<div class="prod">${(Object.keys(MYTHS) as Mythology[]).map((m) => progress(`${ABILITIES[MYTHS[m].spell].name} (${MYTHS[m].gods.map((g) => DEFS[g].name).join(', ')})`, this.ultimatePct(m) / 100)).join('')}</div>`;
    }
    if (e.def.kind === 'unit' && e.carry) html += `<div class="info">Transporte ${e.carry} minerai</div>`;
    // Carriers and bunkers: who is inside, each with its health; a click on one lets it out (as in SC2).
    const aboard = [...this.world.entities.values()].filter((u) => u.inside === e.id);
    if (aboard.length) {
      const out = e.owner === this.player && !this.spectator ? ' (clic : débarquer)' : '';
      html += `<div class="prod cargo"><div class="info">À bord : ${aboard.length}</div><div class="grid">${aboard
        .map((u) => `<div class="tile" data-unload="${u.id}" data-of="${e.id}" style="--hp:${u.hp / u.maxHp}" title="${u.def.name}${out}">${img(u.type, u.def.name)}</div>`)
        .join('')}</div></div>`;
    }
    if ((e.def as UnitDef).weapons) {
      const arm = e.kit ? WEAPONS[e.kit].name : e.def.kind === 'unit' || (e.def as BuildingDef).attack ? 'Mitrailleuse' : 'aucune';
      const kits = [[KIT.detection, 'Détection'], [KIT.invisibilite, 'Invisibilité'], [KIT.reparateur, 'Auto-réparateur'], [KIT.balise, 'Balise offensive']].filter(([bit]) => e.support & (bit as number)).map(([, n]) => n);
      html += `<div class="info">${e.def.kind === 'unit' ? `T${e.tier}${e.evolving ? ' (évolution en cours)' : ''} · ` : ''}Arme : ${arm}${kits.length ? ` · Kits : ${kits.join(', ')}` : ''}${e.seizedLeft ? ' · Capturé (Canon IEM)' : ''}</div>`;
    }
    if (e.def.kind !== 'resource') html += this.stats(e);
    this.setDetails(html);
    this.portrait.render();
  }

  /** How far a mythology's ultimate has charged, in percent. */
  private ultimatePct(m: Mythology): number {
    return Math.floor((100 * (this.world.players[this.player].ultimates?.[m] ?? 0)) / ticks(BALANCE.units.primordial.charge));
  }

  /**
   * Fighting stats of the selected unit or building, for anyone looking (spectators too): attack and armour with
   * their research bonus, range, rate of fire, speed and sight.
   */
  private stats(e: Entity): string {
    const fmt = (v: number) => (Math.round(v * 10) / 10).toLocaleString('fr-FR');
    const plus = (n: number) => (n > 0 ? ` <em>+${n}</em>` : '');
    const parts: string[] = [];
    const a = this.world.weapon(e);
    if (a) {
      // shortcut: only the faction's attack research is counted, not the rarer unit-specific bonuses (Acide, Conseil's aura…).
      const line = e.owner >= 0 ? this.world.attackLine(e, a) : '';
      const up = e.owner >= 0 && e.def.kind === 'unit' && !(e.def as UnitDef).worker ? this.world.level(e.owner, line) * Math.max(1, Math.round(a.damage / 10)) : 0;
      parts.push(`<span title="Dégâts par coup">Attaque ${a.damage}${plus(up)}</span>`);
      parts.push(`<span title="Portée">${a.range < 1 ? 'Mêlée' : `Portée ${fmt(a.range)}`}</span>`);
      parts.push(`<span title="Temps entre deux coups">Cadence ${fmt(a.cooldown)} s</span>`);
    }
    if ((e.def as UnitDef).heal) parts.push(`<span>Soin ${(e.def as UnitDef).heal}</span>`);
    if ('armor' in e.def) {
      // The world keeps the armour research to itself; read it rather than copy its many cases.
      const bonus = e.def.kind === 'unit' && e.owner >= 0 ? (this.world['armorBonus'] as (t: Entity) => number).call(this.world, e) : 0;
      parts.push(`<span title="Retirée de chaque coup reçu">Armure ${e.def.armor}${plus(bonus)}</span>`);
    }
    if (e.def.kind === 'unit') parts.push(`<span>Vitesse ${fmt((e.def as UnitDef).levels?.speed[e.lvl - 1] ?? (e.def as UnitDef).speed)}</span>`);
    if ('sight' in e.def) parts.push(`<span>Vue ${e.def.sight}</span>`);
    return parts.length ? `<div class="stats">${parts.join('')}</div>` : '';
  }

  // ---------------------------------------------------------------- command card

  private workers(): Entity[] {
    // Those that place buildings: workers, or Gaïa for the Dieux (their Esprits only harvest).
    return this.input.own().filter((e) => e.def.kind === 'unit' && ((e.def as UnitDef).builder ?? (e.def as UnitDef).worker));
  }

  /** The active kind in a mixed selection (Tab): its abilities and production are the ones on the card. */
  private activeType: string | null = null;

  private buttonsFor(): Button[] {
    this.menuItems = [];
    const own = this.input.own();
    if (!own.some((o) => o.type === this.activeType)) this.activeType = null;
    const ids = own.map((e) => e.id);
    const cmd = (c: Order) => this.issue({ ...c, player: this.player } as Command);
    if (this.placing) return [{ label: 'Annuler', cmd: 'annuler', key: 'Escape', action: () => (this.placing = null) }];
    if (this.targeting) return [{ label: 'Annuler', cmd: 'annuler', key: 'Escape', action: () => this.setTargeting(false) }];
    let units = own.filter((e) => e.def.kind === 'unit');
    if (units.length) {
      if (this.buildMenu && this.workers().length) {
        const f = FACTIONS[this.world.players[this.player].faction];
        return [
          ...f.buildable.filter((t) => f.advanced.includes(t) === (this.buildMenu === 'advanced')).map((t) => {
            const d = DEFS[t] as BuildingDef;
            return { label: d.name, icon: t, key: d.hotkey, cost: d.cost, reason: this.world.lacks(this.player, t) || undefined, action: () => (this.placing = t) };
          }),
          { label: 'Retour', cmd: 'retour', key: 'Escape', action: () => (this.buildMenu = false) },
        ];
      }
      const list: Button[] = [{ label: 'Stop', cmd: 'stop', key: 'S', action: () => cmd({ kind: 'stop', ids }) }];
      // Stop and Attack go to everyone; abilities to the active kind only, once Tab picked one.
      const all = units;
      const sub = units.filter((u) => u.type === this.activeType);
      if (sub.length) units = sub;
      if (all.some((u) => this.world.weapon(u))) {
        list.unshift({ label: 'Attaquer', cmd: 'attaquer', key: 'A', action: () => this.setTargeting(true) });
        list.push({ label: 'Maintenir', cmd: 'maintenir', key: 'H', action: () => cmd({ kind: 'hold', ids }) });
        list.push({ label: 'Patrouille', cmd: 'patrouiller', key: 'P', action: () => this.setTargeting(true, false, 'patrol') });
      }
      // Carriers (Scarabée, Bourdon with Chargement): let everyone out.
      const carriers = units.filter((u) => this.world.room(u));
      if (carriers.length) {
        const ids = carriers.map((u) => u.id);
        const inside = [...this.world.entities.values()].filter((u) => ids.includes(u.inside)).length;
        list.push({ label: `Débarquer (${inside})`, cmd: 'debarquer', key: 'D', reason: inside ? undefined : "Personne à l'intérieur", action: () => cmd({ kind: 'unload', ids }) });
      }
      if (this.workers().length) {
        list.push({ label: 'Construire', cmd: 'construire', key: 'B', action: () => (this.buildMenu = 'basic') });
        list.push({ label: 'Avancé', cmd: 'avance', key: 'V', action: () => (this.buildMenu = 'advanced') });
      }
      // One button per active ability among the selected units; each ready unit uses it.
      for (const ab of new Set(units.flatMap((u) => this.world.abilitiesFor(u)))) {
        const casters = units.filter((u) => this.world.abilitiesFor(u).includes(ab));
        const ready = casters.filter((u) => u.abilityCd === 0).length;
        const a = ABILITIES[ab];
        const reason = this.world.needs(this.player, a.research) ?? (a.ultimate && !this.world.ultimateReady(this.player, a.ultimate) ? `Se charge au Temple primordial : ${this.ultimatePct(a.ultimate)} %` : undefined);
        // Aimed ones wait for a click on the map (gold reticle); the others go at once.
        const action = a.target === 'point' ? () => this.setTargeting(true, true, ab) : () => cmd({ kind: 'ability', ids: casters.map((u) => u.id), name: ab });
        list.push({ label: `${a.name}${ready ? '' : ' (recharge)'}`, key: a.hotkey, reason, action, ability: ab });
      }
      // Z socles: evolve into the next tier, in the field.
      const evolvers = units.filter((u) => this.world.nextTier(u) && !u.evolving);
      if (evolvers.length) {
        const u = evolvers[0];
        const next = this.world.nextTier(u)!;
        const research = DEFS[`r${u.type}${u.tier + 1}`] as UpgradeDef;
        const reason = this.world.level(this.player, `r${u.type}`) <= u.tier ? `Requiert : ${research.name}` : undefined;
        list.push({ label: `Évoluer en T${u.tier + 1}`, cmd: 'evoluer', key: 'E', cost: next.cost, reason, action: () => cmd({ kind: 'evolve', ids: evolvers.filter((o) => o.tier === u.tier).map((o) => o.id) }) });
      }
      // Dieux: the gods summon their troops (in the least busy of the selected ones that can).
      for (const t of new Set(units.flatMap((u) => (u.def as UnitDef).trains ?? []))) {
        const d = DEFS[t] as UnitDef;
        const order = units.filter((u) => (u.def as UnitDef).trains?.includes(t)).sort((x, y) => x.queue.length - y.queue.length).map((x) => x.id);
        const lvl = this.world.entities.get(order[0])?.lvl ?? 1;
        list.push({ label: d.name, icon: t, key: d.hotkey, cost: d.cost, seconds: Math.round(d.buildTime / lvl), reason: this.world.lacks(this.player, t) || undefined, action: () => cmd({ kind: 'train', ids: order, type: t }) });
      }
      // Dieux: the next level of a selected god, bought at the god (the lowest-levelled first).
      const gods = units.filter((u) => (u.def as UnitDef).levels && !u.queue.includes('niveau')).sort((x, y) => x.lvl - y.lvl);
      const g = gods.find((u) => u.lvl < (u.def as UnitDef).levels!.hp.length);
      if (g) list.push({ label: `Niveau ${g.lvl + 1}`, cmd: 'niveau', type: 'niveau', key: (DEFS.niveau as UpgradeDef).hotkey, cost: (g.def as UnitDef).levels!.cost[g.lvl - 1], seconds: (g.def as UnitDef).levels!.time[g.lvl - 1], action: () => cmd({ kind: 'train', ids: [g.id], type: 'niveau' }) });
      // A god that summons troops has a rally point too; its right click moves it, so only this button sets one.
      if (units.some((u) => (u.def as UnitDef).trains?.length)) list.push({ label: 'Point de ralliement', cmd: 'rally', key: 'Y', action: () => this.setTargeting(true, true, 'rally') });
      // The Artefacterie's improvements, once there is one, for a selected god with room left.
      const buyers = units.filter((u) => (u.def as UnitDef).levels);
      if (buyers.length && [...this.world.entities.values()].some((b) => b.owner === this.player && b.type === 'artefacterie' && b.buildLeft === 0)) {
        const max = BALANCE.rules.upgrades.artefacts.max;
        const free = buyers.find((u) => this.world.artefacts(u) < max);
        for (const t of ARTEFACTS) {
          const d = DEFS[t] as UpgradeDef;
          list.push({ label: d.name, type: t, key: d.hotkey, cost: d.cost, reason: free ? undefined : `${max} améliorations au plus par dieu`, action: () => free && cmd({ kind: 'train', ids: [free.id], type: t }) });
        }
      }
      const summoning = units.find((u) => u.queue.length);
      if (summoning) list.push({ label: 'Annuler', cmd: 'annuler', key: 'Escape', action: () => cmd({ kind: 'cancel', ids: [summoning.id] }) });
      return list;
    }
    this.buildMenu = false;
    const b = own.find((o) => o.type === this.activeType) ?? own[0];
    if (!b || b.def.kind !== 'building') return [];
    const same = own.filter((o) => o.type === b.type);
    if (b.buildLeft > 0) return [{ label: 'Annuler', cmd: 'annuler', key: 'Escape', action: () => cmd({ kind: 'cancel', ids: [b.id] }) }];
    // Queue in the least busy of the selected buildings.
    const order = [...same].sort((x, y) => x.queue.length - y.queue.length).map((x) => x.id);
    // Z: a socle's weapon is picked before it is queued, for good; the machine gun comes free.
    // It drops down under the socle's button (the card stays), so the second step shows as one.
    if (this.weaponMenu && !b.def.trains?.includes(this.weaponMenu)) this.weaponMenu = null;
    if (this.weaponMenu) {
      const t = this.weaponMenu;
      const d = DEFS[t] as UnitDef;
      const lack = this.world.lacks(this.player, t) || undefined;
      const queue = (weapon?: string) => () => {
        cmd({ kind: 'train', ids: order, type: t, weapon });
        this.weaponMenu = null;
      };
      this.menuItems = [
        { label: 'Mitrailleuse', key: 'M', cmd: 'mitrailleuse', cost: d.cost, reason: lack, action: queue() },
        ...d.weapons!.map((k) => {
          const kit = WEAPONS[k];
          const reason = lack ?? this.world.needs(this.player, kit.research);
          return { label: kit.name, key: kit.hotkey, cmd: k, cost: withKit(d, k), reason, action: queue(k) };
        }),
      ];
    }
    const list: Button[] = (b.def.trains ?? []).map((t) => {
      const d = DEFS[t] as UnitDef;
      const action = d.weapons ? () => (this.weaponMenu = t) : () => cmd({ kind: 'train', ids: order, type: t });
      return { label: d.name, icon: t, key: d.hotkey, cost: d.cost, reason: this.world.lacks(this.player, t) || undefined, action };
    });
    if (b.def.bunker) {
      const ids = same.map((o) => o.id);
      const inside = [...this.world.entities.values()].filter((u) => ids.includes(u.inside)).length;
      list.push({ label: `Débarquer (${inside}/${b.def.bunker * same.length})`, cmd: 'debarquer', key: 'D', reason: inside ? undefined : 'Personne à l\'intérieur', action: () => cmd({ kind: 'unload', ids }) });
    }
    // A building's abilities, once researched if they must be.
    for (const name of abilitiesOf(b.def as BuildingDef)) {
      const a = ABILITIES[name];
      if (a.research && !this.world.level(this.player, a.research)) continue;
      const ready = same.some((o) => (name === 'canoniem' ? o.iemCd : o.abilityCd) === 0);
      const go = a.target === 'self' ? () => cmd({ kind: 'ability', ids: same.map((o) => o.id), name }) : () => this.setTargeting(true, true, name);
      list.push({ label: `${a.name}${ready ? '' : ' (recharge)'}`, key: a.hotkey, cost: { minerals: a.minerals ?? 0, energy: a.energy ?? 0 }, action: go, ability: name });
    }
    // Z Tourelle and Assimilateur: a weapon bought once, for those that have none yet.
    if ((b.def as BuildingDef).weapons) {
      const bare = same.filter((o) => !o.kit && o.buildLeft === 0);
      for (const k of (b.def as BuildingDef).weapons!) {
        const kit = WEAPONS[k];
        const reason = this.world.needs(this.player, kit.research) ?? (bare.length ? undefined : 'Déjà armé');
        list.push({ label: kit.name, key: kit.hotkey, cost: kit.cost, reason, action: () => cmd({ kind: 'arm', ids: bare.map((o) => o.id), weapon: k }) });
      }
    }
    // Z Pods: one add-on each, raised beside it (Plate-forme, Tourelle).
    for (const t of (b.def as BuildingDef).addons ?? []) {
      const d = DEFS[t] as BuildingDef;
      const free = same.find((o) => ![...this.world.entities.values()].some((a) => a.host === o.id));
      const reason = this.world.lacks(this.player, t) || (free ? undefined : 'Déjà un add-on');
      list.push({ label: d.name, icon: t, key: d.hotkey, cost: d.cost, reason, action: () => free && cmd({ kind: 'train', ids: [free.id], type: t }) });
    }
    // Isdaris: turning into a stronger building, in place.
    for (const t of b.def.morphs ?? []) {
      const d = DEFS[t] as BuildingDef;
      const idle = same.find((o) => o.queue.length === 0);
      if (!idle) continue;
      list.push({ label: `→ ${d.name}`, icon: t, key: d.hotkey, cost: d.cost, reason: this.world.lacks(this.player, t) || undefined, action: () => cmd({ kind: 'train', ids: [idle.id], type: t }) });
    }
    // Marché: trade one resource for the other.
    if (b.type === 'marche') {
      const { give, get } = BALANCE.rules.trade;
      list.push({ label: `Minerai → ${get} énergie`, cmd: 'echange', key: 'M', cost: { minerals: give, energy: 0 }, action: () => cmd({ kind: 'trade', ids: [b.id], sell: 'minerals' }) });
      list.push({ label: `Énergie → ${get} minerai`, cmd: 'echange', key: 'N', cost: { minerals: 0, energy: give }, action: () => cmd({ kind: 'trade', ids: [b.id], sell: 'energy' }) });
    }
    // Research: the next level of each upgrade line not yet researched nor queued.
    for (const t of b.def.researches ?? []) {
      if (!this.world.researchable(this.player, t)) continue;
      // Research behind an extension or another research not done yet stays out of the card.
      if (Object.keys((DEFS[t] as UpgradeDef).requires ?? {}).some((r) => DEFS[r].kind === 'upgrade' && !this.world.level(this.player, (DEFS[r] as UpgradeDef).line))) continue;
      const d = DEFS[t] as UpgradeDef;
      const order = [...same].sort((x, y) => x.queue.length - y.queue.length).map((x) => x.id);
      list.push({ label: d.name, type: t, key: d.hotkey, cost: d.cost, reason: this.world.lacks(this.player, t) || undefined, action: () => cmd({ kind: 'train', ids: order, type: t }) });
    }
    // Last, so the other buttons keep their places (and grid keys).
    if (b.def.trains?.length) list.push({ label: 'Point de ralliement', cmd: 'rally', key: 'Y', action: () => this.setTargeting(true, true, 'rally') });
    if (same.some((o) => o.queue.length)) {
      list.push({ label: 'Annuler', cmd: 'annuler', key: 'Escape', action: () => cmd({ kind: 'cancel', ids: [same.find((o) => o.queue.length)!.id] }) });
    }
    return list;
  }

  private updateCard(): void {
    this.buttons = this.buttonsFor();
    const p = this.world.players[this.player];
    const key = [...this.buttons, ...this.menuItems].map((b) => `${b.key}${b.label}${b.cost && afford(p, b.cost)}${b.reason}`).join('|') + this.gridKeys + this.weaponMenu;
    if (key === this.cardKey) return this.placeMenu();
    this.cardKey = key;
    this.menu.innerHTML = this.menuItems
      .map((b) => {
        const off = b.reason || (b.cost && !afford(p, b.cost)) ? ' off' : '';
        const cost = b.cost ? `<small>${b.cost.minerals ? `◆${b.cost.minerals}` : ''}${b.cost.energy ? ` ⚡${b.cost.energy}` : ''}</small>` : '';
        const glyph = WEAPON_GLYPHS[b.cmd ?? ''] ?? '';
        return `<button class="cmd-menu-item${off}" data-wkey="${b.key}" title="${b.reason ?? b.label}"><kbd>${b.key}</kbd><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${glyph}"/></svg><span>${b.label}</span>${cost}</button>`;
      })
      .join('');
    this.tip.hidden = true; // its button may be gone
    this.card.innerHTML = this.buttons
      .map((b) => {
        const cost = b.cost ? `<small>${b.cost.minerals ? `◆${b.cost.minerals}` : ''}${b.cost.energy ? ` ⚡${b.cost.energy}` : ''}</small>` : '';
        const off = b.reason || (b.cost && !afford(p, b.cost)) ? ' off' : '';
        const pic = b.icon ? img(b.icon, '') : b.cmd ? `<img class="ico-cmd" src="${import.meta.env.BASE_URL}icons/cmd/${p.faction}/${b.cmd}.svg" alt="">` : '';
        const anim = b.key === this.pressed.key && performance.now() - this.pressed.at < 150 ? ` ${this.pressed.anim}` : '';
        const open = this.weaponMenu && b.icon === this.weaponMenu ? ' open' : '';
        return `<button class="cmd${off}${anim}${open}${pic ? ' has-icon' : ''}" data-key="${b.key}" aria-label="${b.label}"${b.reason ? ' aria-disabled="true"' : ''}><kbd>${this.keyLabel(b)}</kbd>${pic}<span>${b.label}</span>${cost}</button>`;
      })
      .join('');
    this.placeMenu();
  }

  /**
   * The weapon panel: an extra LCD screen as wide as the command card, standing on top of it, a grid like it; it
   * unfolds upwards from the socle's button (the first frame it shows), with a flicker. Hidden when no socle is open.
   */
  private placeMenu(): void {
    const at = this.menuItems.length ? this.card.querySelector<HTMLElement>('.cmd.open') : null;
    const opening = !!at && this.menu.hidden;
    this.menu.hidden = !at;
    if (!at) {
      this.weaponMenu = null; // its socle no longer on the card (another selection)
      return;
    }
    const card = this.card.getBoundingClientRect();
    const r = at.getBoundingClientRect();
    this.menu.style.left = `${card.left}px`;
    this.menu.style.width = `${card.width}px`;
    this.menu.style.top = `${Math.max(4, card.top - this.menu.offsetHeight - 4)}px`;
    if (!opening) return;
    this.menu.style.transformOrigin = `${r.left + r.width / 2 - card.left}px 100%`;
    this.menu.classList.remove('unfold');
    void this.menu.offsetWidth; // restarts the animation
    this.menu.classList.add('unfold');
  }

  /** A weapon picked in the menu (a click, a tap or its key). */
  private pressMenu(b: Button): void {
    if (b.reason || (b.cost && !afford(this.world.players[this.player], b.cost))) return this.audio.play('error', 0.4);
    this.audio.play('click');
    b.action();
  }

  /** Fills and places the tooltip above a command button. */
  private showTip(button: HTMLElement): void {
    const b = this.buttons.find((x) => x.key === button.dataset.key);
    if (!b) return;
    const d = DEFS[b.type ?? b.icon ?? ''] as UnitDef | BuildingDef | UpgradeDef | undefined;
    const p = this.world.players[this.player];
    const lines: string[] = [`<b>${b.label}</b> <kbd>${this.keyLabel(b)}</kbd>`];
    if (b.cost) {
      const parts = [b.cost.minerals ? `◆ ${b.cost.minerals} minerai` : '', b.cost.energy ? `⚡ ${b.cost.energy} énergie` : ''];
      if (d?.kind === 'unit') parts.push(`⌂ ${d.supply} logistique`);
      if (d && 'buildTime' in d) parts.push(`⏱ ${b.seconds ?? d.buildTime} s`);
      lines.push(parts.filter(Boolean).join(' · '));
    }
    if (d?.kind === 'unit' || d?.kind === 'building') {
      const stats = [`${d.hp} PV`];
      if (d.shield) stats.push(`${d.shield} bouclier`);
      if (d.attack) stats.push(`${d.attack.damage} dégâts${d.attack.range > 1 ? `, portée ${d.attack.range}` : ', mêlée'}`);
      if ((d as UnitDef).heal) stats.push('soigne');
      if ((d as BuildingDef).bunker) stats.push(`abrite ${(d as BuildingDef).bunker} soldats`);
      if ((d as BuildingDef).trains?.length) stats.push(`produit : ${(d as BuildingDef).trains!.map((t) => DEFS[t].name).join(', ')}`);
      lines.push(stats.join(' · '));
      // Z socles: a second step follows the click (the weapon), easy to miss.
      if (d.kind === 'unit' && (d as UnitDef).weapons) lines.push('Socle : reçoit une arme, choisie ensuite (mitrailleuse gratuite).');
    }
    if (d?.kind === 'upgrade' && d.effect) lines.push(d.effect);
    if (b.ability && ABILITIES[b.ability].effect) lines.push(ABILITIES[b.ability].effect!);
    if (b.reason) lines.push(`<span class="need">${b.reason}</span>`);
    else if (b.cost && !afford(p, b.cost)) lines.push('<span class="need">Ressources insuffisantes</span>');
    this.tip.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
    this.tip.hidden = false;
    const r = button.getBoundingClientRect();
    const w = this.tip.offsetWidth;
    this.tip.style.left = `${Math.max(6, Math.min(window.innerWidth - w - 6, r.left + r.width / 2 - w / 2))}px`;
    this.tip.style.top = `${r.top - this.tip.offsetHeight - 8}px`;
  }

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
    if (!spot || !this.placing) return;
    const def = DEFS[this.placing] as BuildingDef;
    const size = def.size;
    const room = this.addonRoom(this.placing, spot);
    const ok = this.world.canPlace(this.placing, spot[0], spot[1], this.player) && room !== null;
    this.updateGrid(this.placing, g!);
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

const icon = (type: string) => `${import.meta.env.BASE_URL}icons/${LOOKS[type] ?? type}.png`;
const noIcon = new Set<string>();
const img = (type: string, alt: string) => (noIcon.has(type) ? '' : `<img src="${icon(type)}" alt="${alt}" data-icon="${type}">`);

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

/** Z socle weapons' pictograms on the weapon panel: strokes on a 24 px box, drawn in the LCD's phosphor. */
const WEAPON_GLYPHS: Record<string, string> = {
  mitrailleuse: 'M3 10h13M3 14h13M16 8v8h3M19 11h2M6 14v3',
  laser: 'M3 12h12M15 12l2-2 2 2-2 2zM19 12h2M9 9v-2M9 15v2',
  flammes: 'M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 3-7 1 2 2 3 3 3c0-2-1-4 0-7z',
  roquettes: 'M5 19l3-3M8 16l9-9 3-1-1 3-9 9zM8 12l-3 1M12 16l-1 3',
  dechiqueteur: 'M12 3l2 3 3-1v3l3 2-3 2v3l-3-1-2 3-2-3-3 1v-3l-3-2 3-2V5l3 1zM12 10a2 2 0 1 0 0 4 2 2 0 1 0 0-4',
  jetsonique: 'M3 12h3M9 7a7 7 0 0 1 0 10M13 5a10 10 0 0 1 0 14M17 3a13 13 0 0 1 0 18',
  arc: 'M13 2L6 13h5l-2 9 8-12h-5z',
  canonx04: 'M3 10h12l3 2h3M3 14h12l3-2M6 14v4M11 14v4M3 10v4',
  reparateur: 'M15 4a4 4 0 0 0-1 6l-8 8 2 2 8-8a4 4 0 0 0 6-1l-3-1-1-3z',
  accumulateur: 'M4 8h14v8H4zM18 11h2v2h-2M7 10v4M10 10v4M13 10v4',
};

function progress(label: string, f: number): string {
  return `<div class="info">${label}</div><div class="bar"><div style="width:${Math.round(100 * f)}%"></div></div>`;
}

function afford(p: { minerals: number; energy: number }, c: Cost): boolean {
  return p.minerals >= c.minerals && p.energy >= c.energy;
}
