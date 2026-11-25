/** Trial touch controls (option « Commandes tactiles »): a marking menu. A long press on one's own unit or building
 * opens its commands in a fan above the finger, clear of the hand (beside it near the top of the screen); sliding over
 * one shows its details, letting go on it gives it. A command that opens a list (Construire, a socle's weapons) shows
 * that list in the fan, then a tap chooses. */
import type { Entity } from '../sim/world';
import { fan } from './fan';
import { el } from './glyphs';
import type { Hud } from './hud';
import { type Button, buttonHtml, buttonsFor, pressButton, pressMenu, showTip } from './hud-card';

/** How close the finger must come to a button to pick it (px). */
const PICK_PX = 34;
/** Room kept clear at the screen's edges (px): the top bar above, the sides and bottom. */
const TOP = 60;
const EDGE = 30;

export class Marking {
  private readonly root = el('div', 'marking');
  private items: { b: Button; node: HTMLElement; x: number; y: number }[] = [];
  private over: HTMLElement | null = null;
  private weapons = false;
  /** Open after the finger let go (a list to tap in): a tap elsewhere closes it. */
  private sticky = false;
  private cx = 0;
  private cy = 0;

  constructor(private readonly h: Hud) {
    this.root.hidden = true;
    document.body.append(this.root);
    this.root.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (!this.sticky) return;
      const node = (e.target as HTMLElement).closest<HTMLElement>('.cmd');
      const item = this.items.find((i) => i.node === node);
      if (item) this.give(item.b);
      else this.close();
    });
    // A list left open: a tap anywhere else only closes it (no order on the map).
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.sticky || this.root.contains(e.target as Node)) return;
        e.stopPropagation();
        this.close();
      },
      true,
    );
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** A long press on `target` at (x, y): false when the option is off or the thing has no command. */
  start(x: number, y: number, target: Entity): boolean {
    if (!document.body.classList.contains('tactile')) return false;
    const h = this.h;
    h.input.selected.clear();
    h.input.selected.add(target.id);
    h.buildMenu = false;
    h.weaponMenu = null;
    h.placing = null;
    return this.show(x, y, buttonsFor(h), false);
  }

  /** The finger moved: the button under it lights up and shows its details. */
  move(x: number, y: number): void {
    const near = this.nearest(x, y);
    if (near === this.over) return;
    this.over?.classList.remove('lit');
    this.over = near;
    if (near) {
      near.classList.add('lit');
      showTip(this.h, near);
    } else this.h.tip.hidden = true;
  }

  /** The finger let go: on a button, it is given; elsewhere, the ring closes. */
  end(x: number, y: number): void {
    const node = this.nearest(x, y);
    const item = this.items.find((i) => i.node === node);
    if (item) this.give(item.b);
    else this.close();
  }

  close(): void {
    this.root.hidden = true;
    this.root.innerHTML = '';
    this.items = [];
    this.over = null;
    this.sticky = false;
    this.h.tip.hidden = true;
    this.h.ringOpen = false;
  }

  private give(b: Button): void {
    const h = this.h;
    const before = `${h.buildMenu}|${h.weaponMenu}`;
    if (this.weapons) pressMenu(h, b);
    else pressButton(h, b);
    h.ringAt = performance.now(); // given from the ring: the panels at the bottom stay folded (pressButton shows them)
    // It opened a list (the buildings, a socle's weapons): that list in the ring, to tap in.
    // With the Machines' LCD console, Construire draws its tech tree there: the ring steps aside for it.
    const tree = !!h.buildMenu && document.body.classList.contains('lcd') && document.body.classList.contains('z');
    if (!tree && `${h.buildMenu}|${h.weaponMenu}` !== before && (h.buildMenu || h.weaponMenu)) {
      const list = buttonsFor(h);
      if (this.show(this.cx, this.cy, h.weaponMenu ? h.menuItems : list, !!h.weaponMenu)) return void (this.sticky = true);
    }
    this.close();
  }

  private show(x: number, y: number, list: Button[], weapons: boolean): boolean {
    this.close();
    if (!list.length) return false;
    const h = this.h;
    if (!weapons) h.buttons = list; // the tooltip reads its button there
    this.weapons = weapons;
    // Above the finger, where the hand does not cover it; wider than a half circle if a half is too wide for the screen.
    let f = fan(list.length, -Math.PI / 2, Math.PI);
    if (2 * f.r + 2 * EDGE > innerWidth) f = fan(list.length, -Math.PI / 2, 1.5 * Math.PI);
    const up = y - f.r - 27 >= TOP;
    // Too near the top: beside the finger, on the side with more room.
    if (!up) f = fan(list.length, x > innerWidth / 2 ? Math.PI : 0, Math.PI);
    const xs = f.at.map(([dx]) => dx);
    const ys = f.at.map(([, dy]) => dy);
    // Kept on screen whole: the centre pulled in from the edges.
    const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
    this.cx = clamp(x, EDGE + 27 - Math.min(...xs), innerWidth - EDGE - 27 - Math.max(...xs));
    this.cy = clamp(y, TOP + 27 - Math.min(...ys), innerHeight - EDGE - 27 - Math.max(...ys));
    this.root.style.left = `${this.cx}px`;
    this.root.style.top = `${this.cy}px`;
    this.root.innerHTML = list.map((b) => buttonHtml(h, b)).join('');
    const nodes = [...this.root.querySelectorAll<HTMLElement>('.cmd')];
    this.items = list.map((b, i) => {
      const [dx, dy] = f.at[i];
      const node = nodes[i];
      if (weapons) {
        node.dataset.wkey = b.key;
        delete node.dataset.key;
      }
      node.style.transform = `translate(${dx}px, ${dy}px)`;
      return { b, node, x: this.cx + dx, y: this.cy + dy };
    });
    this.root.hidden = false;
    h.ringOpen = true;
    return true;
  }

  private nearest(x: number, y: number): HTMLElement | null {
    let best: HTMLElement | null = null;
    let d = PICK_PX;
    for (const i of this.items) {
      const e = Math.hypot(i.x - x, i.y - y);
      if (e < d) [best, d] = [i.node, e];
    }
    return best;
  }
}
