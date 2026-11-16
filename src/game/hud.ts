import { BoxGeometry, Mesh, MeshBasicMaterial, type Scene, type Vector3 } from 'three';
import { type BuildingDef, type Cost, DEFS, FACTIONS, type UnitDef } from '../data';
import { type GameMap, heightAt } from '../map';
import { FP, ticks } from '../sim/fixed';
import type { Command, Entity, GameEvent, World } from '../sim/world';
import type { Audio } from '../audio';
import type { Input } from './input';
import { Portrait } from '../render/portrait';

interface Button {
  label: string;
  /** Entity type whose icon to show. */
  icon?: string;
  key: string;
  cost?: Cost;
  action: () => void;
}

/** A command without its player field. */
type Order<C = Command> = C extends unknown ? Omit<C, 'player'> : never;

const KEY_LABEL: Record<string, string> = { Escape: 'Échap' };

/** Resource bar, selection panel, command card, messages and building placement. */
export class Hud {
  private readonly bar = el('div', 'hud-bar');
  /** Bottom console: minimap slot, selection panel, command card. */
  private readonly console = el('div', 'console');
  readonly mapSlot = el('div', 'slot map-slot');
  private readonly panel = el('div', 'hud-panel');
  /** Selection text, beside the live portrait. */
  private readonly details = el('div', 'details');
  private readonly portrait = new Portrait();
  private readonly card = el('div', 'hud-card');
  private readonly toasts = el('div', 'hud-toasts');
  private buttons: Button[] = [];
  private cardKey = '';
  private buildMenu = false;
  private placing: string | null = null;
  /** Waiting for a click to attack or attack-move. */
  private targeting = false;
  private readonly banner = el('div', 'hud-banner');
  private readonly ghost: Mesh;

  constructor(
    private readonly world: World,
    private readonly map: GameMap,
    private readonly player: number,
    private readonly input: Input,
    scene: Scene,
    private readonly issue: (c: Command) => void,
    private readonly audio: Audio,
  ) {
    this.panel.classList.add('slot');
    this.panel.append(this.portrait.canvas, this.details);
    this.card.classList.add('slot');
    this.console.append(this.mapSlot, this.panel, this.card);
    document.body.append(this.bar, this.console, this.toasts, this.banner);
    this.banner.hidden = true;
    this.ghost = new Mesh(new BoxGeometry(1, 0.3, 1), new MeshBasicMaterial({ color: 0x55ff66, transparent: true, opacity: 0.45, depthWrite: false }));
    this.ghost.visible = false;
    scene.add(this.ghost);

    this.card.addEventListener('pointerdown', (e) => {
      const key = (e.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key;
      const b = this.buttons.find((x) => x.key === key);
      if (b) {
        this.audio.play('click');
        b.action();
      }
    });
    this.panel.addEventListener('pointerdown', (e) => {
      const id = Number((e.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id);
      if (!id) return;
      this.input.selected.clear();
      this.input.selected.add(id);
    });
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key === 'Escape' ? 'Escape' : e.key.toUpperCase();
      const b = this.buttons.find((x) => x.key === key);
      if (b) {
        e.preventDefault();
        b.action();
      }
    });
  }

  /** Mouse clicks on the map while placing a building or choosing an attack target. */
  click(button: number, ground: Vector3 | null, shift: boolean, target?: Entity): boolean {
    if (this.targeting) {
      if (button === 0 && ground) this.attack(ground.x, ground.z, target);
      if (!shift || button === 2) this.setTargeting(false);
      return true;
    }
    if (!this.placing) return false;
    if (button === 2) {
      this.placing = null;
      return true;
    }
    const spot = ground && this.spot(this.placing, ground);
    const worker = this.workers()[0];
    if (spot && worker) {
      this.issue({ player: this.player, kind: 'build', ids: [worker.id], type: this.placing, tx: spot[0], ty: spot[1] });
      if (!shift) {
        this.placing = null;
        this.buildMenu = false;
      }
    }
    return true;
  }

  /** Left-click on the minimap: attack-move when targeting. */
  minimapClick(x: number, y: number): boolean {
    if (!this.targeting) return false;
    this.attack(x, y);
    this.setTargeting(false);
    return true;
  }

  private attack(x: number, z: number, target?: Entity): void {
    const ids = this.input.own().map((e) => e.id);
    const enemy = target && target.owner >= 0 && target.owner !== this.player ? target.id : undefined;
    this.issue({ player: this.player, kind: 'attack', ids, x: Math.round(x * FP), y: Math.round(z * FP), target: enemy });
  }

  private setTargeting(on: boolean): void {
    this.targeting = on;
    document.body.classList.toggle('targeting', on);
  }

  notify(events: GameEvent[]): void {
    for (const ev of events) {
      if (ev.player !== this.player) continue;
      const t = el('div', `hud-toast ${ev.kind}`);
      this.audio.play(ev.kind);
      t.textContent = ev.text;
      this.toasts.append(t);
      setTimeout(() => t.remove(), 2500);
      while (this.toasts.children.length > 3) this.toasts.firstChild!.remove();
    }
  }

  update(): void {
    const p = this.world.players[this.player];
    const s = this.world.supply(this.player);
    const secs = Math.floor((this.world.tick / ticks(60)) * 60);
    this.bar.innerHTML = `<span class="res clock">${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</span><span class="res min"><i></i>${p.minerals}</span><span class="res nrg"><i></i>${p.energy}</span><span class="res sup${s.used >= s.max ? ' full' : ''}"><i></i>${s.used}/${s.max}</span>`;
    this.updatePanel();
    this.updateCard();
    this.updateGhost();
    if (this.world.winner !== null && this.banner.hidden) {
      const won = this.world.winner === this.player;
      this.banner.innerHTML = `<h1>${won ? 'Victoire !' : 'Défaite…'}</h1><button onclick="location.reload()">Rejouer</button>`;
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
      this.details.innerHTML = '';
      return;
    }
    if (sel.length > 1) {
      this.details.innerHTML = `<div class="grid">${sel
        .slice(0, 24)
        .map((e) => `<div class="tile" data-id="${e.id}" style="--hp:${e.hp / e.maxHp}"><img src="${icon(e.type)}" alt="${e.def.name}"></div>`)
        .join('')}</div>`;
      return;
    }
    const e = sel[0];
    let html = `<div class="name">${e.def.name}</div>`;
    if (e.def.kind === 'resource') {
      html += `<div class="info">${Number.isFinite(e.amount) ? `${e.amount} restants` : 'Inépuisable'}</div>`;
    } else {
      if (e.maxShield) html += `<div class="hp shield"><div style="width:${(100 * e.shield) / e.maxShield}%"></div></div>`;
      html += `<div class="hp"><div style="width:${(100 * e.hp) / e.maxHp}%"></div></div><div class="info">${e.hp} / ${e.maxHp}${e.maxShield ? ` · bouclier ${e.shield} / ${e.maxShield}` : ''}</div>`;
    }
    if (e.def.kind === 'building') {
      const def = e.def as BuildingDef;
      if (e.buildLeft > 0) {
        html += progress('Construction', 1 - e.buildLeft / ticks(def.buildTime));
      } else if (e.queue.length) {
        const first = DEFS[e.queue[0]] as UnitDef;
        html += progress(first.name, 1 - e.trainLeft / ticks(first.buildTime));
        html += `<div class="queue">${e.queue.map((t) => `<span><img src="${icon(t)}" alt="${DEFS[t].name}"></span>`).join('')}</div>`;
      }
    }
    if (e.def.kind === 'unit' && e.carry) html += `<div class="info">Transporte ${e.carry} minerai</div>`;
    this.details.innerHTML = html;
    this.portrait.render();
  }

  // ---------------------------------------------------------------- command card

  private workers(): Entity[] {
    return this.input.own().filter((e) => e.def.kind === 'unit' && (e.def as UnitDef).worker);
  }

  private buttonsFor(): Button[] {
    const own = this.input.own();
    const ids = own.map((e) => e.id);
    const cmd = (c: Order) => this.issue({ ...c, player: this.player } as Command);
    if (this.placing) return [{ label: 'Annuler', key: 'Escape', action: () => (this.placing = null) }];
    if (this.targeting) return [{ label: 'Annuler', key: 'Escape', action: () => this.setTargeting(false) }];
    const units = own.filter((e) => e.def.kind === 'unit');
    if (units.length) {
      if (this.buildMenu && this.workers().length) {
        return [
          ...FACTIONS[this.world.players[this.player].faction].buildable.map((t) => {
            const d = DEFS[t] as BuildingDef;
            return { label: d.name, icon: t, key: d.hotkey, cost: d.cost, action: () => (this.placing = t) };
          }),
          { label: 'Retour', key: 'Escape', action: () => (this.buildMenu = false) },
        ];
      }
      const list: Button[] = [{ label: 'Stop', key: 'S', action: () => cmd({ kind: 'stop', ids }) }];
      if (units.some((u) => (u.def as UnitDef).attack)) list.unshift({ label: 'Attaquer', key: 'A', action: () => this.setTargeting(true) });
      if (this.workers().length) list.push({ label: 'Construire', key: 'B', action: () => (this.buildMenu = true) });
      return list;
    }
    this.buildMenu = false;
    const b = own[0];
    if (!b || b.def.kind !== 'building') return [];
    const same = own.filter((o) => o.type === b.type);
    if (b.buildLeft > 0) return [{ label: 'Annuler', key: 'Escape', action: () => cmd({ kind: 'cancel', ids: [b.id] }) }];
    const list: Button[] = (b.def.trains ?? []).map((t) => {
      const d = DEFS[t] as UnitDef;
      // Queue in the least busy of the selected buildings.
      const order = [...same].sort((x, y) => x.queue.length - y.queue.length).map((x) => x.id);
      return { label: d.name, icon: t, key: d.hotkey, cost: d.cost, action: () => cmd({ kind: 'train', ids: order, type: t }) };
    });
    if (same.some((o) => o.queue.length)) {
      list.push({ label: 'Annuler', key: 'Escape', action: () => cmd({ kind: 'cancel', ids: [same.find((o) => o.queue.length)!.id] }) });
    }
    return list;
  }

  private updateCard(): void {
    this.buttons = this.buttonsFor();
    const p = this.world.players[this.player];
    const key = this.buttons.map((b) => `${b.key}${b.label}${b.cost && afford(p, b.cost)}`).join('|');
    if (key === this.cardKey) return;
    this.cardKey = key;
    this.card.innerHTML = this.buttons
      .map((b) => {
        const cost = b.cost ? `<small>${b.cost.minerals ? `◆${b.cost.minerals}` : ''}${b.cost.energy ? ` ⚡${b.cost.energy}` : ''}</small>` : '';
        const off = b.cost && !afford(p, b.cost) ? ' off' : '';
        const img = b.icon ? `<img src="${icon(b.icon)}" alt="">` : '';
        return `<button class="cmd${off}${img ? ' has-icon' : ''}" data-key="${b.key}" title="${b.label}"><kbd>${KEY_LABEL[b.key] ?? b.key}</kbd>${img}<span>${b.label}</span>${cost}</button>`;
      })
      .join('');
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

  private updateGhost(): void {
    const g = this.input.hover;
    const spot = this.placing && g ? this.spot(this.placing, g) : null;
    this.ghost.visible = !!spot;
    if (!spot || !this.placing) return;
    const size = (DEFS[this.placing] as BuildingDef).size;
    const ok = this.world.canPlace(this.placing, spot[0], spot[1], this.player);
    (this.ghost.material as MeshBasicMaterial).color.set(ok ? 0x55ff66 : 0xff4444);
    this.ghost.scale.set(size, 1, size);
    const cx = spot[0] + size / 2;
    const cz = spot[1] + size / 2;
    this.ghost.position.set(cx, heightAt(this.map, cx, cz) + 0.15, cz);
  }
}

const icon = (type: string) => `${import.meta.env.BASE_URL}icons/${type}.png`;

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

function progress(label: string, f: number): string {
  return `<div class="info">${label}</div><div class="bar"><div style="width:${Math.round(100 * f)}%"></div></div>`;
}

function afford(p: { minerals: number; energy: number }, c: Cost): boolean {
  return p.minerals >= c.minerals && p.energy >= c.energy;
}
