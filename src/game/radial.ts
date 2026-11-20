/** Trial touch controls (option « Commandes tactiles »): a marking menu. A long press on one's own unit or building
 * opens its commands in a ring round the finger; sliding over one shows its details, letting go on it gives it. A
 * command that opens a list (Construire, a socle's weapons) shows that list in the ring, then a tap chooses. */
import type { Entity } from '../sim/world';
import { el } from './glyphs';
import type { Hud } from './hud';
import { type Button, buttonHtml, buttonsFor, pressButton, pressMenu, showTip } from './hud-card';

/** Distance from the ring's centre to its buttons' centres (px), and how close the finger must come to pick one. */
const RING_MIN = 78;
const PICK_PX = 34;

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
    const r = Math.max(RING_MIN, (list.length * 58) / (2 * Math.PI));
    // Kept on screen whole: the centre pulled in from the edges.
    this.cx = Math.min(innerWidth - r - 30, Math.max(r + 30, x));
    this.cy = Math.min(innerHeight - r - 30, Math.max(r + 60, y));
    this.root.style.left = `${this.cx}px`;
    this.root.style.top = `${this.cy}px`;
    this.root.innerHTML = list.map((b) => buttonHtml(h, b)).join('');
    const nodes = [...this.root.querySelectorAll<HTMLElement>('.cmd')];
    this.items = list.map((b, i) => {
      const a = -Math.PI / 2 + (i / list.length) * Math.PI * 2;
      const [dx, dy] = [Math.cos(a) * r, Math.sin(a) * r];
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
