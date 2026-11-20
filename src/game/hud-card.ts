/** The command card: its buttons for the selection, their keys, presses and tooltips, and a Z socle's weapon panel. */
import BALANCE from '../balance.json';
import { ABILITIES, abilitiesOf, ARTEFACTS, type BuildingDef, type Cost, DEFS, FACTIONS, type UnitDef, type UpgradeDef, WEAPONS, withKit } from '../data';
import type { Command } from '../sim/world';
import { img, pictogram, weaponIcon, Z_GLYPHS } from './glyphs';
import type { Hud } from './hud';
import { ultimatePct } from './hud-panel';

export interface Button {
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
  /** The Z weapon it is about (fitted, bought or researched): its pictogram stands for its icon (WEAPON_GLYPHS). */
  weapon?: string;
  action: () => void;
}

/** A command without its player field. */
type Order<C = Command> = C extends unknown ? Omit<C, 'player'> : never;

const KEY_LABEL: Record<string, string> = { Escape: 'Échap' };

/** Grid hotkeys (Options): the keys under the left hand, row by row, in the command card's order (4 to a row). Physical
 * keys, so the same places on any layout: A Z E R / Q S D F / W X C V in AZERTY, Q W E R / A S D F / Z X C V in QWERTY. */
export const GRID_CODES = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyZ', 'KeyX', 'KeyC', 'KeyV'];
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

/** The key printed on a button (and the grid key that presses it, in grid mode). */
function keyLabel(h: Hud, b: Button): string {
  const i = h.buttons.indexOf(b);
  return h.gridKeys && b.key !== 'Escape' && i >= 0 && i < GRID_CODES.length ? gridLabel[GRID_CODES[i]] : (KEY_LABEL[b.key] ?? b.key);
}

/** A command button pressed, by click or hotkey: it sinks with a tick, or shakes and says why it is locked. */
export function pressButton(h: Hud, b: Button): void {
  const el = h.card.querySelector<HTMLElement>(`[data-key="${CSS.escape(b.key)}"]`);
  const anim = (name: string) => {
    h.pressed = { key: b.key, anim: name, at: performance.now() };
    if (!el) return;
    el.classList.remove('pressed', 'denied');
    void el.offsetWidth; // restarts the animation on a repeated press
    el.classList.add(name);
    el.addEventListener('animationend', () => el.classList.remove(name), { once: true });
  };
  if (b.reason) {
    h.audio.play('error', 0.4);
    anim('denied');
    if (el) showTip(h, el);
    return;
  }
  h.audio.play('click');
  anim(el?.classList.contains('off') ? 'denied' : 'pressed');
  b.action();
}

export function buttonsFor(h: Hud): Button[] {
  h.menuItems = [];
  const own = h.input.own();
  if (!own.some((o) => o.type === h.activeType)) h.activeType = null;
  const ids = own.map((e) => e.id);
  const cmd = (c: Order) => h.issue({ ...c, player: h.player } as Command);
  if (h.placing) return [{ label: 'Annuler', cmd: 'annuler', key: 'Escape', action: () => (h.placing = null) }];
  if (h.targeting) return [{ label: 'Annuler', cmd: 'annuler', key: 'Escape', action: () => h.setTargeting(false) }];
  let units = own.filter((e) => e.def.kind === 'unit');
  if (units.length) {
    if (h.buildMenu && h.workers().length) {
      const f = FACTIONS[h.world.players[h.player].faction];
      return [
        ...f.buildable.filter((t) => f.advanced.includes(t) === (h.buildMenu === 'advanced')).map((t) => {
          const d = DEFS[t] as BuildingDef;
          return { label: d.name, icon: t, key: d.hotkey, cost: d.cost, reason: h.world.lacks(h.player, t) || undefined, action: () => (h.placing = t) };
        }),
        { label: 'Retour', cmd: 'retour', key: 'Escape', action: () => (h.buildMenu = false) },
      ];
    }
    const list: Button[] = [{ label: 'Stop', cmd: 'stop', key: 'S', action: () => cmd({ kind: 'stop', ids }) }];
    // Stop and Attack go to everyone; abilities to the active kind only, once Tab picked one.
    const all = units;
    const sub = units.filter((u) => u.type === h.activeType);
    if (sub.length) units = sub;
    if (all.some((u) => h.world.weapon(u))) {
      list.unshift({ label: 'Attaquer', cmd: 'attaquer', key: 'A', action: () => h.setTargeting(true) });
      list.push({ label: 'Maintenir', cmd: 'maintenir', key: 'H', action: () => cmd({ kind: 'hold', ids }) });
      list.push({ label: 'Patrouille', cmd: 'patrouiller', key: 'P', action: () => h.setTargeting(true, false, 'patrol') });
    }
    // Carriers (Scarabée, Bourdon with Chargement): let everyone out.
    const carriers = units.filter((u) => h.world.room(u));
    if (carriers.length) {
      const ids = carriers.map((u) => u.id);
      const inside = [...h.world.entities.values()].filter((u) => ids.includes(u.inside)).length;
      list.push({ label: `Débarquer (${inside})`, cmd: 'debarquer', key: 'D', reason: inside ? undefined : "Personne à l'intérieur", action: () => cmd({ kind: 'unload', ids }) });
    }
    if (h.workers().length) {
      list.push({ label: 'Construire', cmd: 'construire', key: 'B', action: () => (h.buildMenu = 'basic') });
      list.push({ label: 'Avancé', cmd: 'avance', key: 'V', action: () => (h.buildMenu = 'advanced') });
    }
    // One button per active ability among the selected units; each ready unit uses it.
    for (const ab of new Set(units.flatMap((u) => h.world.abilitiesFor(u)))) {
      const casters = units.filter((u) => h.world.abilitiesFor(u).includes(ab));
      const ready = casters.filter((u) => u.abilityCd === 0).length;
      const a = ABILITIES[ab];
      const reason = h.world.needs(h.player, a.research) ?? (a.ultimate && !h.world.ultimateReady(h.player, a.ultimate) ? `Se charge au Temple primordial : ${ultimatePct(h, a.ultimate)} %` : undefined);
      // Aimed ones wait for a click on the map (gold reticle); the others go at once.
      const action = a.target === 'point' ? () => h.setTargeting(true, true, ab) : () => cmd({ kind: 'ability', ids: casters.map((u) => u.id), name: ab });
      list.push({ label: `${a.name}${ready ? '' : ' (recharge)'}`, key: a.hotkey, reason, action, ability: ab });
    }
    // Z socles: evolve into the next tier, in the field.
    const evolvers = units.filter((u) => h.world.nextTier(u) && !u.evolving);
    if (evolvers.length) {
      const u = evolvers[0];
      const next = h.world.nextTier(u)!;
      const research = DEFS[`r${u.type}${u.tier + 1}`] as UpgradeDef;
      const reason = h.world.level(h.player, `r${u.type}`) <= u.tier ? `Requiert : ${research.name}` : undefined;
      list.push({ label: `Évoluer en T${u.tier + 1}`, cmd: 'evoluer', key: 'E', cost: next.cost, reason, action: () => cmd({ kind: 'evolve', ids: evolvers.filter((o) => o.tier === u.tier).map((o) => o.id) }) });
    }
    // Dieux: the gods summon their troops (in the least busy of the selected ones that can).
    for (const t of new Set(units.flatMap((u) => (u.def as UnitDef).trains ?? []))) {
      const d = DEFS[t] as UnitDef;
      const order = units.filter((u) => (u.def as UnitDef).trains?.includes(t)).sort((x, y) => x.queue.length - y.queue.length).map((x) => x.id);
      const lvl = h.world.entities.get(order[0])?.lvl ?? 1;
      list.push({ label: d.name, icon: t, key: d.hotkey, cost: d.cost, seconds: Math.round(d.buildTime / lvl), reason: h.world.lacks(h.player, t) || undefined, action: () => cmd({ kind: 'train', ids: order, type: t }) });
    }
    // Dieux: the next level of a selected god, bought at the god (the lowest-levelled first).
    const gods = units.filter((u) => (u.def as UnitDef).levels && !u.queue.includes('niveau')).sort((x, y) => x.lvl - y.lvl);
    const g = gods.find((u) => u.lvl < (u.def as UnitDef).levels!.hp.length);
    if (g) list.push({ label: `Niveau ${g.lvl + 1}`, cmd: 'niveau', type: 'niveau', key: (DEFS.niveau as UpgradeDef).hotkey, cost: (g.def as UnitDef).levels!.cost[g.lvl - 1], seconds: (g.def as UnitDef).levels!.time[g.lvl - 1], action: () => cmd({ kind: 'train', ids: [g.id], type: 'niveau' }) });
    // A god that summons troops has a rally point too; its right click moves it, so only this button sets one.
    if (units.some((u) => (u.def as UnitDef).trains?.length)) list.push({ label: 'Point de ralliement', cmd: 'rally', key: 'Y', action: () => h.setTargeting(true, true, 'rally') });
    // The Artefacterie's improvements, once there is one, for a selected god with room left.
    const buyers = units.filter((u) => (u.def as UnitDef).levels);
    if (buyers.length && [...h.world.entities.values()].some((b) => b.owner === h.player && b.type === 'artefacterie' && b.buildLeft === 0)) {
      const max = BALANCE.rules.upgrades.artefacts.max;
      const free = buyers.find((u) => h.world.artefacts(u) < max);
      for (const t of ARTEFACTS) {
        const d = DEFS[t] as UpgradeDef;
        list.push({ label: d.name, type: t, key: d.hotkey, cost: d.cost, reason: free ? undefined : `${max} améliorations au plus par dieu`, action: () => free && cmd({ kind: 'train', ids: [free.id], type: t }) });
      }
    }
    const summoning = units.find((u) => u.queue.length);
    if (summoning) list.push({ label: 'Annuler', cmd: 'annuler', key: 'Escape', action: () => cmd({ kind: 'cancel', ids: [summoning.id] }) });
    return list;
  }
  h.buildMenu = false;
  const b = own.find((o) => o.type === h.activeType) ?? own[0];
  if (!b || b.def.kind !== 'building') return [];
  const same = own.filter((o) => o.type === b.type);
  if (b.buildLeft > 0) return [{ label: 'Annuler', cmd: 'annuler', key: 'Escape', action: () => cmd({ kind: 'cancel', ids: [b.id] }) }];
  // Queue in the least busy of the selected buildings.
  const order = [...same].sort((x, y) => x.queue.length - y.queue.length).map((x) => x.id);
  // Z: a socle's weapon is picked before it is queued, for good; the machine gun comes free.
  // It drops down under the socle's button (the card stays), so the second step shows as one.
  if (h.weaponMenu && !b.def.trains?.includes(h.weaponMenu)) h.weaponMenu = null;
  if (h.weaponMenu) {
    const t = h.weaponMenu;
    const d = DEFS[t] as UnitDef;
    const lack = h.world.lacks(h.player, t) || undefined;
    const queue = (weapon?: string) => () => {
      cmd({ kind: 'train', ids: order, type: t, weapon });
      h.weaponMenu = null;
    };
    h.menuItems = [
      { label: 'Mitrailleuse', key: 'M', weapon: 'mitrailleuse', cost: d.cost, reason: lack, action: queue() },
      ...d.weapons!.map((k) => {
        const kit = WEAPONS[k];
        const reason = lack ?? h.world.needs(h.player, kit.research);
        return { label: kit.name, key: kit.hotkey, weapon: k, cost: withKit(d, k), reason, action: queue(k) };
      }),
    ];
  }
  const list: Button[] = (b.def.trains ?? []).map((t) => {
    const d = DEFS[t] as UnitDef;
    const action = d.weapons ? () => (h.weaponMenu = t) : () => cmd({ kind: 'train', ids: order, type: t });
    return { label: d.name, icon: t, key: d.hotkey, cost: d.cost, reason: h.world.lacks(h.player, t) || undefined, action };
  });
  if (b.def.bunker) {
    const ids = same.map((o) => o.id);
    const inside = [...h.world.entities.values()].filter((u) => ids.includes(u.inside)).length;
    list.push({ label: `Débarquer (${inside}/${b.def.bunker * same.length})`, cmd: 'debarquer', key: 'D', reason: inside ? undefined : 'Personne à l\'intérieur', action: () => cmd({ kind: 'unload', ids }) });
  }
  // A building's abilities, once researched if they must be.
  for (const name of abilitiesOf(b.def as BuildingDef)) {
    const a = ABILITIES[name];
    if (a.research && !h.world.level(h.player, a.research)) continue;
    const ready = same.some((o) => (name === 'canoniem' ? o.iemCd : o.abilityCd) === 0);
    const go = a.target === 'self' ? () => cmd({ kind: 'ability', ids: same.map((o) => o.id), name }) : () => h.setTargeting(true, true, name);
    list.push({ label: `${a.name}${ready ? '' : ' (recharge)'}`, key: a.hotkey, cost: { minerals: a.minerals ?? 0, energy: a.energy ?? 0 }, action: go, ability: name });
  }
  // Z Tourelle and Assimilateur: a weapon bought once, for those that have none yet.
  if ((b.def as BuildingDef).weapons) {
    const bare = same.filter((o) => !o.kit && o.buildLeft === 0);
    for (const k of (b.def as BuildingDef).weapons!) {
      const kit = WEAPONS[k];
      const reason = h.world.needs(h.player, kit.research) ?? (bare.length ? undefined : 'Déjà armé');
      list.push({ label: kit.name, key: kit.hotkey, weapon: k, cost: kit.cost, reason, action: () => cmd({ kind: 'arm', ids: bare.map((o) => o.id), weapon: k }) });
    }
  }
  // Z Pods: one add-on each, raised beside it (Plate-forme, Tourelle).
  for (const t of (b.def as BuildingDef).addons ?? []) {
    const d = DEFS[t] as BuildingDef;
    const free = same.find((o) => ![...h.world.entities.values()].some((a) => a.host === o.id));
    const reason = h.world.lacks(h.player, t) || (free ? undefined : 'Déjà un add-on');
    list.push({ label: d.name, icon: t, key: d.hotkey, cost: d.cost, reason, action: () => free && cmd({ kind: 'train', ids: [free.id], type: t }) });
  }
  // Isdaris: turning into a stronger building, in place.
  for (const t of b.def.morphs ?? []) {
    const d = DEFS[t] as BuildingDef;
    const idle = same.find((o) => o.queue.length === 0);
    if (!idle) continue;
    list.push({ label: `→ ${d.name}`, icon: t, key: d.hotkey, cost: d.cost, reason: h.world.lacks(h.player, t) || undefined, action: () => cmd({ kind: 'train', ids: [idle.id], type: t }) });
  }
  // Marché: trade one resource for the other.
  if (b.type === 'marche') {
    const { give, get } = BALANCE.rules.trade;
    list.push({ label: `Minerai → ${get} énergie`, cmd: 'echange', key: 'M', cost: { minerals: give, energy: 0 }, action: () => cmd({ kind: 'trade', ids: [b.id], sell: 'minerals' }) });
    list.push({ label: `Énergie → ${get} minerai`, cmd: 'echange', key: 'N', cost: { minerals: 0, energy: give }, action: () => cmd({ kind: 'trade', ids: [b.id], sell: 'energy' }) });
  }
  // Research: the next level of each upgrade line not yet researched nor queued.
  for (const t of b.def.researches ?? []) {
    if (!h.world.researchable(h.player, t)) continue;
    // Research behind an extension or another research not done yet stays out of the card.
    if (Object.keys((DEFS[t] as UpgradeDef).requires ?? {}).some((r) => DEFS[r].kind === 'upgrade' && !h.world.level(h.player, (DEFS[r] as UpgradeDef).line))) continue;
    const d = DEFS[t] as UpgradeDef;
    const order = [...same].sort((x, y) => x.queue.length - y.queue.length).map((x) => x.id);
    // A Z weapon's research (and its tiers) shows that weapon's pictogram.
    const weapon = Object.keys(WEAPONS).find((k) => WEAPONS[k].research === d.line || WEAPONS[k].research === t);
    list.push({ label: d.name, type: t, key: d.hotkey, cost: d.cost, reason: h.world.lacks(h.player, t) || undefined, action: () => cmd({ kind: 'train', ids: order, type: t }), weapon });
  }
  // Last, so the other buttons keep their places (and grid keys).
  if (b.def.trains?.length) list.push({ label: 'Point de ralliement', cmd: 'rally', key: 'Y', action: () => h.setTargeting(true, true, 'rally') });
  if (same.some((o) => o.queue.length)) {
    list.push({ label: 'Annuler', cmd: 'annuler', key: 'Escape', action: () => cmd({ kind: 'cancel', ids: [same.find((o) => o.queue.length)!.id] }) });
  }
  return list;
}

export function updateCard(h: Hud): void {
  const bk = `${h.world.tick}|${[...h.input.selected].join()}|${h.activeType}|${h.placing}|${h.targeting}|${h.scanning}|${h.aimed}|${h.buildMenu}|${h.weaponMenu}|${h.gridKeys}`;
  if (bk === h.buttonsKey) return placeMenu(h);
  h.buttonsKey = bk;
  h.buttons = buttonsFor(h);
  const p = h.world.players[h.player];
  const key = [...h.buttons, ...h.menuItems].map((b) => `${b.key}${b.label}${b.cost && afford(p, b.cost)}${b.reason}`).join('|') + h.gridKeys + h.weaponMenu;
  if (key === h.cardKey) return placeMenu(h);
  h.cardKey = key;
  h.menu.innerHTML = h.menuItems
    .map((b) => {
      const off = b.reason || (b.cost && !afford(p, b.cost)) ? ' off' : '';
      const cost = b.cost ? `<small>${b.cost.minerals ? `◆${b.cost.minerals}` : ''}${b.cost.energy ? ` ⚡${b.cost.energy}` : ''}</small>` : '';
      return `<button class="cmd-menu-item${off}" data-wkey="${b.key}" title="${b.reason ?? b.label}"><kbd>${b.key}</kbd>${weaponIcon(b.weapon)}<span>${b.label}</span>${cost}</button>`;
    })
    .join('');
  h.tip.hidden = true; // its button may be gone
  h.card.innerHTML = h.buttons
    .map((b) => {
      const cost = b.cost ? `<small${b.cost.minerals && b.cost.energy ? ' class="two"' : ''}>${b.cost.minerals ? `◆${b.cost.minerals}` : ''}${b.cost.energy ? ` ⚡${b.cost.energy}` : ''}</small>` : '';
      const off = b.reason || (b.cost && !afford(p, b.cost)) ? ' off' : '';
      const glyph = p.faction === 'z' ? Z_GLYPHS[(b.ability ?? b.type ?? '').replace(/\d+$/, '')] : undefined;
      const pic = b.icon ? img(b.icon, '') : b.weapon ? weaponIcon(b.weapon) : b.cmd ? `<img class="ico-cmd" src="${import.meta.env.BASE_URL}icons/cmd/${p.faction}/${b.cmd}.svg" alt="">` : glyph ? pictogram(glyph) : '';
      const anim = b.key === h.pressed.key && performance.now() - h.pressed.at < 150 ? ` ${h.pressed.anim}` : '';
      const open = h.weaponMenu && b.icon === h.weaponMenu ? ' open' : '';
      return `<button class="cmd${off}${anim}${open}${pic ? ' has-icon' : ''}" data-key="${b.key}" aria-label="${b.label}"${b.reason ? ' aria-disabled="true"' : ''}><kbd>${keyLabel(h, b)}</kbd>${pic}<span>${b.label.replace(/^Extension : /, 'Ext. ')}</span>${cost}</button>`; // short enough for the button (the tooltip says it whole)
    })
    .join('');
  placeMenu(h);
}

/**
 * The weapon panel: an extra LCD screen as wide as the command card, standing on top of it, a grid like it; it
 * unfolds upwards from the socle's button (the first frame it shows), with a flicker. Hidden when no socle is open.
 */
function placeMenu(h: Hud): void {
  const at = h.menuItems.length ? h.card.querySelector<HTMLElement>('.cmd.open') : null;
  const opening = !!at && h.menu.hidden;
  if (h.menu.hidden !== !at) h.menu.hidden = !at;
  if (!at) {
    h.weaponMenu = null; // its socle no longer on the card (another selection)
    return;
  }
  const card = h.card.getBoundingClientRect();
  const r = at.getBoundingClientRect();
  h.menu.style.left = `${card.left}px`;
  h.menu.style.width = `${card.width}px`;
  h.menu.style.top = `${Math.max(4, card.top - h.menu.offsetHeight - 4)}px`;
  if (!opening) return;
  h.menu.style.transformOrigin = `${r.left + r.width / 2 - card.left}px 100%`;
  h.menu.classList.remove('unfold');
  void h.menu.offsetWidth; // restarts the animation
  h.menu.classList.add('unfold');
}

/** A weapon picked in the menu (a click, a tap or its key). */
export function pressMenu(h: Hud, b: Button): void {
  if (b.reason || (b.cost && !afford(h.world.players[h.player], b.cost))) return h.audio.play('error', 0.4);
  h.audio.play('click');
  b.action();
}

/** Fills and places the tooltip above a command button. */
export function showTip(h: Hud, button: HTMLElement): void {
  // A command, or a weapon in the socle's menu.
  const b = button.dataset.wkey ? h.menuItems.find((x) => x.key === button.dataset.wkey) : h.buttons.find((x) => x.key === button.dataset.key);
  if (!b) return;
  const d = DEFS[b.type ?? b.icon ?? ''] as UnitDef | BuildingDef | UpgradeDef | undefined;
  const p = h.world.players[h.player];
  const lines: string[] = [`${b.weapon ? weaponIcon(b.weapon) : ''}<b>${b.label}</b> <kbd>${keyLabel(h, b)}</kbd>`];
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
  h.tip.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
  h.tip.hidden = false;
  const r = button.getBoundingClientRect();
  const w = h.tip.offsetWidth;
  h.tip.style.left = `${Math.max(6, Math.min(window.innerWidth - w - 6, r.left + r.width / 2 - w / 2))}px`;
  h.tip.style.top = `${r.top - h.tip.offsetHeight - 8}px`;
}

function afford(p: { minerals: number; energy: number }, c: Cost): boolean {
  return p.minerals >= c.minerals && p.energy >= c.energy;
}
