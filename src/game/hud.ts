import BALANCE from '../balance.json';
import { BoxGeometry, Mesh, MeshBasicMaterial, type Scene, type Vector3 } from 'three';
import { ABILITIES, abilitiesOf, type BuildingDef, LOOKS, type Cost, DEFS, FACTIONS, type UnitDef, type UpgradeDef, WEAPONS } from '../data';
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
  /** Why the button is disabled (unmet prerequisites), shown in its tooltip. */
  reason?: string;
  /** What it makes or researches, for the tooltip's details (defaults to the icon). */
  type?: string;
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
  /** Idle workers: their count on a button in the top bar (hidden at none); it flashes as one more stops. */
  readonly idle = el('button', 'chip idle-workers');
  private idleCount = 0;
  /** Control groups: one icon each (the group's most numerous type), with its key and head count. */
  readonly groups = el('div', 'groups');
  private groupsKey = '';
  private buttons: Button[] = [];
  private cardKey = '';
  /** Last button pressed and how it reacted, so the card rebuilt by that press keeps the animation. */
  private pressed = { key: '', anim: '', at: -Infinity };
  /** Open build menu: basic buildings, or the advanced (tech) ones. */
  private buildMenu: false | 'basic' | 'advanced' = false;
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
  private readonly tip = el('div', 'cmd-tip');
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
    this.idle.hidden = true;
    this.idle.title = 'Ouvriers inactifs : les sélectionner';
    this.idle.addEventListener('click', () => this.input.selectIdleWorkers());
    this.groups.addEventListener('click', (e) => {
      const k = (e.target as HTMLElement).closest<HTMLElement>('[data-g]')?.dataset.g;
      if (k) this.input.recallGroup(k);
    });
    this.ghost = new Mesh(new BoxGeometry(1, 0.3, 1), new MeshBasicMaterial({ color: 0x55ff66, transparent: true, opacity: 0.45, depthWrite: false }));
    this.ghost.visible = false;
    scene.add(this.ghost);

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
    this.card.addEventListener('pointerdown', (e) => {
      const key = (e.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key;
      const b = this.buttons.find((x) => x.key === key);
      if (b) this.press(b);
    });
    this.panel.addEventListener('pointerdown', (e) => {
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
      const key = e.key === 'Escape' ? 'Escape' : e.key.toUpperCase();
      const b = this.buttons.find((x) => x.key === key);
      if (b) {
        e.preventDefault();
        if (!e.repeat) this.press(b);
      }
    });
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
    const spot = ground && this.spot(this.placing, ground);
    const worker = this.workers()[0];
    if (spot && worker) {
      this.issue({ player: this.player, kind: 'build', ids: [worker.id], type: this.placing, tx: spot[0], ty: spot[1], queue: shift });
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
    for (const ev of events) {
      if (ev.player !== this.player) continue;
      const t = el('div', `hud-toast ${ev.kind}`);
      this.audio.play(ev.kind);
      t.textContent = ev.text;
      this.toasts.append(t);
      setTimeout(() => t.classList.add('gone'), 2200);
      setTimeout(() => t.remove(), 2500);
      while (this.toasts.children.length > 3) this.toasts.firstChild!.remove();
    }
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
    this.updateGroups();
    this.updateCard();
    this.updateGhost();
    if (this.world.winner !== null && this.banner.hidden) {
      const won = this.world.winner === this.player;
      this.banner.innerHTML = `<h1>${won ? 'Victoire !' : 'Défaite…'}</h1><div class="row"><button data-p="quit">Menu principal</button><button data-p="restart">Rejouer</button><button data-p="replay">Enregistrer le replay</button></div>`;
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
        .map((e) => `<div class="tile" data-id="${e.id}" style="--hp:${e.hp / e.maxHp}">${img(e.type, e.def.name)}</div>`)
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
        const first = DEFS[e.queue[0]] as UnitDef | UpgradeDef;
        html += progress(first.name, 1 - e.trainLeft / ticks(first.buildTime));
        html += `<div class="queue">${e.queue.map((t) => `<span>${img(t, DEFS[t].name)}</span>`).join('')}</div>`;
      }
    }
    if (e.def.kind === 'unit' && e.carry) html += `<div class="info">Transporte ${e.carry} minerai</div>`;
    if ((e.def as UnitDef).weapons) html += `<div class="info">Arme : ${e.kit ? WEAPONS[e.kit].name : 'Mitrailleuse légère'}</div>`;
    if (e.def.kind !== 'resource') html += this.stats(e);
    this.details.innerHTML = html;
    this.portrait.render();
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
      const p = this.world.players[e.owner];
      const line = p?.faction === 'isdaris' ? ((e.def as UnitDef).mechanical ? 'assembleuratk' : 'portailatk') : p?.faction === 'z' ? 'zattaque' : a.range < 1 ? 'melee' : 'ranged';
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
    if (e.def.kind === 'unit') parts.push(`<span>Vitesse ${fmt((e.def as UnitDef).speed)}</span>`);
    if ('sight' in e.def) parts.push(`<span>Vue ${e.def.sight}</span>`);
    return parts.length ? `<div class="stats">${parts.join('')}</div>` : '';
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
        const f = FACTIONS[this.world.players[this.player].faction];
        return [
          ...f.buildable.filter((t) => f.advanced.includes(t) === (this.buildMenu === 'advanced')).map((t) => {
            const d = DEFS[t] as BuildingDef;
            return { label: d.name, icon: t, key: d.hotkey, cost: d.cost, reason: this.world.lacks(this.player, t) || undefined, action: () => (this.placing = t) };
          }),
          { label: 'Retour', key: 'Escape', action: () => (this.buildMenu = false) },
        ];
      }
      const list: Button[] = [{ label: 'Stop', key: 'S', action: () => cmd({ kind: 'stop', ids }) }];
      if (units.some((u) => this.world.weapon(u))) list.unshift({ label: 'Attaquer', key: 'A', action: () => this.setTargeting(true) });
      // Carriers (Scarabée, Bourdon with Chargement): let everyone out.
      const carriers = units.filter((u) => this.world.room(u));
      if (carriers.length) {
        const ids = carriers.map((u) => u.id);
        const inside = [...this.world.entities.values()].filter((u) => ids.includes(u.inside)).length;
        list.push({ label: `Débarquer (${inside})`, key: 'D', reason: inside ? undefined : "Personne à l'intérieur", action: () => cmd({ kind: 'unload', ids }) });
      }
      if (this.workers().length) {
        list.push({ label: 'Construire', key: 'B', action: () => (this.buildMenu = 'basic') });
        list.push({ label: 'Avancé', key: 'V', action: () => (this.buildMenu = 'advanced') });
      }
      // One button per active ability among the selected units; each ready unit uses it.
      for (const ab of new Set(units.flatMap((u) => abilitiesOf(u.def as UnitDef)))) {
        const casters = units.filter((u) => abilitiesOf(u.def as UnitDef).includes(ab));
        const ready = casters.filter((u) => u.abilityCd === 0).length;
        const a = ABILITIES[ab];
        const reason = a.research && !this.world.level(this.player, a.research) ? `Requiert : ${DEFS[a.research].name}` : undefined;
        // Aimed ones wait for a click on the map (gold reticle); the others go at once.
        const action = a.target === 'point' ? () => this.setTargeting(true, true, ab) : () => cmd({ kind: 'ability', ids: casters.map((u) => u.id), name: ab });
        list.push({ label: `${a.name}${ready ? '' : ' (recharge)'}`, key: a.hotkey, reason, action });
      }
      // Z socles: a weapon kit to fit on those that take it and do not carry it yet.
      for (const [k, kit] of Object.entries(WEAPONS)) {
        const takers = units.filter((u) => (u.def as UnitDef).weapons?.includes(k) && u.kit !== k);
        if (!units.some((u) => (u.def as UnitDef).weapons?.includes(k))) continue;
        const reason = kit.research && !this.world.level(this.player, kit.research) ? `Requiert : ${DEFS[kit.research].name}` : takers.length ? undefined : 'Déjà équipé';
        list.push({ label: kit.name, key: kit.hotkey, cost: kit.cost, reason, action: () => cmd({ kind: 'equip', ids: takers.map((u) => u.id), weapon: k }) });
      }
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
      return { label: d.name, icon: t, key: d.hotkey, cost: d.cost, reason: this.world.lacks(this.player, t) || undefined, action: () => cmd({ kind: 'train', ids: order, type: t }) };
    });
    if (b.def.bunker) {
      const ids = same.map((o) => o.id);
      const inside = [...this.world.entities.values()].filter((u) => ids.includes(u.inside)).length;
      list.push({ label: `Débarquer (${inside}/${b.def.bunker * same.length})`, key: 'D', reason: inside ? undefined : 'Personne à l\'intérieur', action: () => cmd({ kind: 'unload', ids }) });
    }
    // A building's abilities, once researched if they must be.
    for (const name of abilitiesOf(b.def as BuildingDef)) {
      const a = ABILITIES[name];
      if (a.research && !this.world.level(this.player, a.research)) continue;
      const ready = same.some((o) => o.abilityCd === 0);
      const go = a.target === 'self' ? () => cmd({ kind: 'ability', ids: same.map((o) => o.id), name }) : () => this.setTargeting(true, true, name);
      list.push({ label: `${a.name}${ready ? '' : ' (recharge)'}`, key: a.hotkey, cost: { minerals: 0, energy: a.energy ?? 0 }, action: go });
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
      list.push({ label: `Minerai → ${get} énergie`, key: 'M', cost: { minerals: give, energy: 0 }, action: () => cmd({ kind: 'trade', ids: [b.id], sell: 'minerals' }) });
      list.push({ label: `Énergie → ${get} minerai`, key: 'N', cost: { minerals: 0, energy: give }, action: () => cmd({ kind: 'trade', ids: [b.id], sell: 'energy' }) });
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
    if (same.some((o) => o.queue.length)) {
      list.push({ label: 'Annuler', key: 'Escape', action: () => cmd({ kind: 'cancel', ids: [same.find((o) => o.queue.length)!.id] }) });
    }
    return list;
  }

  private updateCard(): void {
    this.buttons = this.buttonsFor();
    const p = this.world.players[this.player];
    const key = this.buttons.map((b) => `${b.key}${b.label}${b.cost && afford(p, b.cost)}${b.reason}`).join('|');
    if (key === this.cardKey) return;
    this.cardKey = key;
    this.tip.hidden = true; // its button may be gone
    this.card.innerHTML = this.buttons
      .map((b) => {
        const cost = b.cost ? `<small>${b.cost.minerals ? `◆${b.cost.minerals}` : ''}${b.cost.energy ? ` ⚡${b.cost.energy}` : ''}</small>` : '';
        const off = b.reason || (b.cost && !afford(p, b.cost)) ? ' off' : '';
        const pic = b.icon ? img(b.icon, '') : '';
        const anim = b.key === this.pressed.key && performance.now() - this.pressed.at < 150 ? ` ${this.pressed.anim}` : '';
        return `<button class="cmd${off}${anim}${pic ? ' has-icon' : ''}" data-key="${b.key}" aria-label="${b.label}"${b.reason ? ' aria-disabled="true"' : ''}><kbd>${KEY_LABEL[b.key] ?? b.key}</kbd>${pic}<span>${b.label}</span>${cost}</button>`;
      })
      .join('');
  }

  /** Fills and places the tooltip above a command button. */
  private showTip(button: HTMLElement): void {
    const b = this.buttons.find((x) => x.key === button.dataset.key);
    if (!b) return;
    const d = DEFS[b.type ?? b.icon ?? ''] as UnitDef | BuildingDef | UpgradeDef | undefined;
    const p = this.world.players[this.player];
    const lines: string[] = [`<b>${b.label}</b> <kbd>${KEY_LABEL[b.key] ?? b.key}</kbd>`];
    if (b.cost) {
      const parts = [b.cost.minerals ? `◆ ${b.cost.minerals} minerai` : '', b.cost.energy ? `⚡ ${b.cost.energy} énergie` : ''];
      if (d?.kind === 'unit') parts.push(`⌂ ${d.supply} logistique`);
      if (d && 'buildTime' in d) parts.push(`⏱ ${d.buildTime} s`);
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
    }
    if (d?.kind === 'upgrade' && d.effect) lines.push(d.effect);
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

const icon = (type: string) => `${import.meta.env.BASE_URL}icons/${LOOKS[type] ?? type}.png`;
const noIcon = new Set<string>();
const img = (type: string, alt: string) => (noIcon.has(type) ? '' : `<img src="${icon(type)}" alt="${alt}" data-icon="${type}">`);

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
