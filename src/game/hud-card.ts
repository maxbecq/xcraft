/** The command card: its buttons for the selection, their keys, presses and tooltips, and a Z socle's weapon panel. */
import BALANCE from '../balance.json';
import { ABILITIES, abilitiesOf, type BuildingDef, type Cost, DEFS, FACTIONS, raises, spell, type UnitDef, type UpgradeDef, WEAPONS, withKit } from '../data';
import { type Command, cdOf, type Entity } from '../sim/world';
import { GLYPHS, img, pictogram, weaponIcon } from './glyphs';
import type { Hud } from './hud';
import { aboardTiles, ultimatePct } from './hud-panel';
import { SCROLL } from './settings';

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
  /** A switch for an ability going on its own (autosoin, autoreanimation): whether it is on, a gold light round it. */
  auto?: boolean;
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
  h.touchedAt = performance.now();
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
  // The build list: a worker's, Gaïa's or a god's, or the Isdaris Obélisque's (it materialises them).
  if (h.buildMenu && h.workers().length) {
    const f = FACTIONS[h.world.players[h.player].faction];
    return [
      ...f.buildable.filter((t) => h.workers().some((w) => raises(w.def as UnitDef, t)) && (lcdTree(h) || onlyOwn(h) || f.advanced.includes(t) === (h.buildMenu === 'advanced'))).map((t) => {
        const d = DEFS[t] as BuildingDef;
        // An Isdaris robot beams it down on itself for a third more (fiche 2010); the Obélisque at its price.
        const beacon = d.faction === 'isdaris' && !h.workers().some((w) => w.def.kind === 'building');
        return { label: d.name, icon: t, key: d.hotkey, cost: beacon ? h.world.beaconCost(d) : d.cost, reason: h.world.lacks(h.player, t, built(h)) || undefined, action: () => (h.placing = t) };
      }),
      { label: 'Retour', cmd: 'retour', key: 'Escape', action: () => (h.buildMenu = false) },
    ];
  }
  if (units.length) {
    const list: Button[] = [{ label: 'Stop', cmd: 'stop', key: 'S', action: () => cmd({ kind: 'stop', ids }) }];
    // Stop and Attack go to everyone; abilities to the active kind only, once Tab picked one.
    // A passenger picked in its shelter's panel (notice: it uses its powers from inside): out on X.
    const aboard = units.filter((u) => u.inside);
    // Greyed while the shelter is held (stunned, recalled): it lets nobody out then.
    const stuck = aboard.every((u) => (h.world.entities.get(u.inside)?.held ?? 0) > 0);
    if (aboard.length) list.push({ label: 'Sortir', cmd: 'debarquer', key: 'X', reason: stuck ? 'Abri immobilisé' : undefined, action: () => aboard.forEach((u) => cmd({ kind: 'unload', ids: [u.inside], unit: u.id })) });
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
      // The LCD console shows every building at once, as a tree: no second, « advanced » list.
      if (!lcdTree(h) && !onlyOwn(h) && FACTIONS[h.world.players[h.player].faction].advanced.length) list.push({ label: 'Avancé', cmd: 'avance', key: 'V', action: () => (h.buildMenu = 'advanced') });
    }
    // One button per active ability among the selected units; each ready unit uses it.
    for (const ab of new Set(units.flatMap((u) => h.world.abilitiesFor(u)))) {
      const casters = units.filter((u) => h.world.abilitiesFor(u).includes(ab));
      const ready = casters.filter((u) => h.world.ready(u, ab)).length;
      const a = ABILITIES[ab];
      const reason = h.world.needs(h.player, a.research) ?? (a.ultimate && !h.world.ultimateReady(h.player, a.ultimate) ? `Se charge au Temple primordial : ${ultimatePct(h, a.ultimate)} %` : undefined);
      // Aimed ones wait for a click on the map (gold reticle); the others go at once.
      const action = a.target === 'point' ? () => h.setTargeting(true, true, ab) : () => cmd({ kind: 'ability', ids: casters.map((u) => u.id), name: ab });
      // A spell paid from the caster's own energy (fiches 2010): its price in the label.
      // At the caster's level (a god's spells cost less as it rises, XC.doc 2008).
      const payer = casters.find((u) => h.world.manaOf(u));
      const price = payer ? spell(ab, payer.lvl).mana : undefined;
      const mana = price !== undefined ? ` · ${price} énergie` : '';
      // On its own or not (the balancer, 2026-11-22): the Soin and the Réanimation switch from a button of their own, a
      // gold light running round it while on (any of the selected casters).
      const auto = ab === 'autosoin' ? casters.some((u) => !u.autoOff) : ab === 'autoreanimation' ? casters.some((u) => u.autoRaise) : undefined;
      const on = auto === undefined ? '' : auto ? ' : oui' : ' : non';
      list.push({ label: `${a.name}${on}${mana}${ready ? '' : ' (recharge)'}`, key: a.hotkey, reason, action, ability: ab, auto });
    }
    // Passive effects (Odin's war aura, Athéna's protection): an icon that does nothing, its effect in the tooltip.
    for (const p of new Set(units.flatMap((u) => (u.def as UnitDef).passives ?? []))) list.push({ label: `${ABILITIES[p].name} (passif)`, key: '', reason: 'Effet permanent', ability: p, action: () => {} });
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
      list.push({ label: d.name, icon: t, key: d.hotkey, cost: d.cost, seconds: Math.round(d.buildTime / lvl), reason: h.world.lacks(h.player, t, built(h)) || undefined, action: () => cmd({ kind: 'train', ids: order, type: t }) });
    }
    // Dieux: the next level of a selected god, bought at the god (the lowest-levelled first).
    const gods = units.filter((u) => (u.def as UnitDef).levels && !u.queue.includes('niveau')).sort((x, y) => x.lvl - y.lvl);
    const g = gods.find((u) => u.lvl < (u.def as UnitDef).levels!.hp.length);
    if (g) list.push({ label: `Niveau ${g.lvl + 1}`, cmd: 'niveau', type: 'niveau', key: (DEFS.niveau as UpgradeDef).hotkey, cost: (g.def as UnitDef).levels!.cost[g.lvl - 1], seconds: (g.def as UnitDef).levels!.time[g.lvl - 1], action: () => cmd({ kind: 'train', ids: [g.id], type: 'niveau' }) });
    // A god that summons troops has a rally point too; its right click moves it, so only this button sets one.
    if (units.some((u) => (u.def as UnitDef).trains?.length)) list.push({ label: 'Point de ralliement', cmd: 'rally', key: 'Y', action: () => h.setTargeting(true, true, 'rally') });
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
    const lack = h.world.lacks(h.player, t, built(h)) || undefined;
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
  // What one of the selected buildings may make: its own Isdaris extensions count (a Druide needs a Laboratoire on that Portail).
  const lackAt = (t: string) => {
    // Once for the side; building by building only when it needs an extension of this building type's own.
    const all = h.world.lacks(h.player, t, built(h));
    const local = Object.keys((DEFS[t] as UnitDef | UpgradeDef).requires ?? {}).some((r) => (DEFS[r] as UpgradeDef).host === b.type);
    if (all || !local) return all;
    const why = same.map((o) => h.world.lacks(h.player, t, built(h), o));
    return why.includes('') ? '' : why[0];
  };
  const list: Button[] = (b.def.trains ?? []).map((t) => {
    const d = DEFS[t] as UnitDef;
    const action = d.weapons ? () => (h.weaponMenu = t) : () => cmd({ kind: 'train', ids: order, type: t });
    return { label: d.name, icon: t, key: d.hotkey, cost: d.cost, reason: lackAt(t) || undefined, action };
  });
  // Isdaris Obélisque (fiche 2010, mod): its buildings, materialised from it.
  if ((b.def as BuildingDef).builds && b.owner === h.player) {
    const rest = Math.max(...same.map((o) => o.spellCd.materialisation ?? 0)) > h.world.tick && same.every((o) => (o.spellCd.materialisation ?? 0) > h.world.tick);
    list.push({ label: `Matérialiser${rest ? ' (recharge)' : ''}`, cmd: 'construire', key: 'B', action: () => (h.buildMenu = 'basic') });
  }
  if (b.def.bunker) {
    const ids = same.map((o) => o.id);
    const inside = [...h.world.entities.values()].filter((u) => ids.includes(u.inside)).length;
    // The Intelligence trains its drones on D, the Assimilateur buys its Déchiqueteur on D (and its Canon X-04 on X).
    list.push({ label: `Débarquer (${inside}/${b.def.bunker * same.length})`, cmd: 'debarquer', key: b.def.trains ? 'X' : b.def.weapons ? 'U' : 'D', reason: inside ? undefined : 'Personne à l\'intérieur', action: () => cmd({ kind: 'unload', ids }) });
  }
  // A building's abilities, once researched if they must be.
  for (const name of abilitiesOf(b.def as BuildingDef)) {
    const a = ABILITIES[name];
    // Behind an extension, the buildings that carry it (the Orbe's Observatoire, the Trône's).
    const able = same.filter((o) => !h.world.needs(h.player, a.research, o));
    if (!able.length) continue;
    const ready = able.some((o) => cdOf(o, name) === 0);
    const go = a.target === 'self' ? () => cmd({ kind: 'ability', ids: able.map((o) => o.id), name }) : () => h.setTargeting(true, true, name);
    list.push({ label: `${a.name}${ready ? '' : ' (recharge)'}`, key: a.hotkey, cost: { minerals: a.minerals ?? 0, energy: a.energy ?? 0 }, action: go, ability: name });
  }
  // Passive effects (the Humains' Échevins, Planification, Tour's detector): an icon that does nothing, its effect in the tooltip.
  for (const p of (b.def as BuildingDef).passives ?? []) list.push({ label: `${ABILITIES[p].name} (passif)`, key: '', reason: 'Effet permanent', ability: p, action: () => {} });
  // Z Tourelle and Assimilateur: a weapon bought once, for those that have none yet.
  if ((b.def as BuildingDef).weapons) {
    const bare = same.filter((o) => !o.kit && o.buildLeft === 0);
    for (const k of (b.def as BuildingDef).weapons!) {
      const kit = WEAPONS[k];
      const reason = h.world.needs(h.player, kit.research) ?? (bare.length ? undefined : 'Déjà armé');
      list.push({ label: kit.name, key: kit.hotkey, weapon: k, cost: kit.cost, reason, action: () => cmd({ kind: 'arm', ids: bare.map((o) => o.id), weapon: k }) });
    }
  }
  // Z Pods: up to three add-ons each, raised beside it (Plate-forme, Tourelle).
  for (const t of (b.def as BuildingDef).addons ?? []) {
    const d = DEFS[t] as BuildingDef;
    const free = same.find((o) => h.world.addonsOf(o) < BALANCE.rules.z.podAddons);
    const reason = h.world.lacks(h.player, t, built(h)) || (free ? undefined : 'Add-ons au complet');
    // Équilibreur 22/11: the player picks one of the 8 places round the Pod, as a building is placed.
    const pick = () => {
      if (!free) return;
      h.placing = t;
      h.addonPod = free.id;
    };
    list.push({ label: d.name, icon: t, key: d.hotkey, cost: d.cost, reason, action: pick });
  }
  // Isdaris: turning into a stronger building, in place.
  for (const t of b.def.morphs ?? []) {
    const d = DEFS[t] as BuildingDef;
    // The Alchimisterie: its Grande Alchimisterie queued behind what it makes (the balancer, 2026-11-22).
    const idle = same.find((o) => o.queue.length === 0 || ((b.def as BuildingDef).queuesMorph && !o.queue.includes(t) && o.queue.length < 5));
    if (!idle) continue;
    list.push({ label: `→ ${d.name}`, icon: t, key: d.hotkey, cost: d.cost, reason: h.world.lacks(h.player, t, built(h)) || undefined, action: () => cmd({ kind: 'train', ids: [idle.id], type: t }) });
  }
  // Marché: trade one resource for the other.
  if (b.type === 'marche') {
    const { give, get } = BALANCE.rules.trade;
    list.push({ label: `Minerai → ${get} énergie`, cmd: 'echange', key: 'M', cost: { minerals: give, energy: 0 }, action: () => cmd({ kind: 'trade', ids: [b.id], sell: 'minerals' }) });
    list.push({ label: `Énergie → ${get} minerai`, cmd: 'echange', key: 'N', cost: { minerals: 0, energy: give }, action: () => cmd({ kind: 'trade', ids: [b.id], sell: 'energy' }) });
  }
  // Research: the next level of each upgrade line not yet researched nor queued.
  for (const t of b.def.researches ?? []) {
    const d = DEFS[t] as UpgradeDef;
    // An extension: on the selected buildings that do not carry it yet (it is theirs alone).
    const free = d.host ? same.filter((o) => o.buildLeft === 0 && h.world.researchable(h.player, t, o)) : same;
    if (!free.length || !h.world.researchable(h.player, t, d.host ? free[0] : undefined)) continue;
    // Research behind an extension (on one of these buildings) or another research not done yet stays out of the card.
    const host = (r: string) => (DEFS[r] as UpgradeDef).host;
    const done = (r: string) => (host(r) === b.type ? same.some((o) => h.world.hasExt(h.player, r, o)) : host(r) ? h.world.hasExt(h.player, r) : h.world.level(h.player, (DEFS[r] as UpgradeDef).line) > 0);
    if (Object.keys(d.requires ?? {}).some((r) => DEFS[r].kind === 'upgrade' && !done(r))) continue;
    const order = [...free].sort((x, y) => x.queue.length - y.queue.length).map((x) => x.id);
    // A Z weapon's research (and its tiers) shows that weapon's pictogram.
    const weapon = Object.keys(WEAPONS).find((k) => WEAPONS[k].research === d.line || WEAPONS[k].research === t);
    list.push({ label: d.name, type: t, key: d.hotkey, cost: d.cost, reason: lackAt(t) || undefined, action: () => cmd({ kind: 'train', ids: order, type: t }), weapon });
  }
  // Last, so the other buttons keep their places (and grid keys).
  if (b.def.trains?.length) list.push({ label: 'Point de ralliement', cmd: 'rally', key: 'Y', action: () => h.setTargeting(true, true, 'rally') });
  if (same.some((o) => o.queue.length)) {
    list.push({ label: 'Annuler', cmd: 'annuler', key: 'Escape', action: () => cmd({ kind: 'cancel', ids: [same.find((o) => o.queue.length)!.id] }) });
  }
  return list;
}

export function updateCard(h: Hud): void {
  const bk = `${h.world.tick}|${h.selKey}|${h.activeType}|${h.placing}|${h.targeting}|${h.scanning}|${h.aimed}|${h.buildMenu}|${h.weaponMenu}|${h.gridKeys}`;
  if (bk === h.buttonsKey) return placeMenu(h);
  h.buttonsKey = bk;
  h.buttons = buttonsFor(h);
  const p = h.world.players[h.player];
  // The LCD tree ticks what is built: a building finished while it is open must redraw it, though no button changed.
  const ticks = lcdTree(h) && h.buildMenu ? [...built(h)].map(([t, n]) => t + n).sort().join() : '';
  const bubble = !!bubbleOf(h);
  const key = [...h.buttons, ...h.menuItems].map((b) => `${b.key}${b.label}${b.cost && afford(p, b.cost)}${b.reason}`).join('|') + h.gridKeys + h.weaponMenu + ticks + h.alt + bubble + (bubble ? aboardKey(h) : '');
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
  const tree = lcdTree(h) && !!h.buildMenu && h.workers().length > 0;
  h.card.classList.toggle('tree', tree);
  if (!tree) h.card.classList.remove('more');
  h.card.innerHTML = tree ? treeHtml(h) : bubble ? groupedHtml(h) : h.buttons.map((b) => buttonHtml(h, b)).join('');
  if (tree) drawLinks(h.card), relinkOnResize(h.card);
  placeMenu(h);
}

/** The alternative interface: the building whose commands float in a bubble above it (only buildings of ours picked). */
export function bubbleOf(h: Hud): Entity | undefined {
  // A builder building's list (the Isdaris Obélisque, Matérialiser) is a tree, at the bottom like the workers'.
  if (!h.alt || h.buildMenu) return undefined;
  const own = h.input.own();
  return own.length && own.every((e) => e.def.kind === 'building') ? (own.find((e) => e.type === h.activeType) ?? own[0]) : undefined;
}

/** Who is inside the bubble's building, and how hurt: its pictures redrawn when that changes. */
function aboardKey(h: Hud): string {
  const b = bubbleOf(h)!;
  return [...h.world.entities.values()].filter((u) => u.inside === b.id).map((u) => `${u.id}:${u.hp}`).join(',');
}

/** What a bubble button belongs to, for its group's title (none: the building's plain orders). */
function groupOf(b: Button): string {
  const kind = DEFS[b.type ?? b.icon ?? '']?.kind;
  if (b.label.startsWith('→')) return 'Évoluer';
  if (kind === 'upgrade') return 'Recherches';
  if (kind === 'unit' || b.weapon) return 'Produire';
  if (kind === 'building') return 'Construire';
  if (b.ability) return 'Pouvoirs';
  return '';
}

/** The bubble's buttons by group, each under its title, in the order the groups first come. */
function groupedHtml(h: Hud): string {
  const groups = new Map<string, Button[]>();
  for (const b of h.buttons) groups.set(groupOf(b), [...(groups.get(groupOf(b)) ?? []), b]);
  const html = [...groups].map(([name, bs]) => `<div class="cmd-group"><em>${name}</em><div>${bs.map((b) => buttonHtml(h, b)).join('')}</div></div>`);
  // Who is inside (a Mine's serfs, a Fortin's soldiers…): their pictures, a click lets one out, as in the panel.
  const b = bubbleOf(h);
  const aboard = b ? [...h.world.entities.values()].filter((u) => u.inside === b.id) : [];
  if (b && aboard.length) html.push(`<div class="cmd-group aboard"><em>À bord</em><div>${aboardTiles(h, b, aboard)}</div></div>`);
  return html.join('');
}

/** Builders of one building or so (Thor, Osiris, Frigg): theirs in a single list, no « advanced » one. */
function onlyOwn(h: Hud): boolean {
  return h.workers().every((w) => (w.def as UnitDef).builds && !(w.def as UnitDef).builder);
}

/** The Machines' LCD console (option) draws its build list as a tech tree; so does the alternative interface, any side. */
function lcdTree(h: Hud): boolean {
  return (SCROLL.lcd && h.world.players[h.player].faction === 'z') || h.alt;
}

/** One command button; `extra` goes inside it, after the cost, and `style` on it (a tree node's place). */
export function buttonHtml(h: Hud, b: Button, extra = '', cls = '', style = ''): string {
  const p = h.world.players[h.player];
  const cost = b.cost ? `<small${b.cost.minerals && b.cost.energy ? ' class="two"' : ''}>${b.cost.minerals ? `◆${b.cost.minerals}` : ''}${b.cost.energy ? ` ⚡${b.cost.energy}` : ''}</small>` : '';
  const off = b.reason || (b.cost && !afford(p, b.cost)) ? ' off' : '';
  const glyph = GLYPHS[(b.ability ?? b.type ?? '').replace(/\d+$/, '')];
  const pic = b.icon ? img(b.icon, '') : b.weapon ? weaponIcon(b.weapon) : b.cmd ? `<img class="ico-cmd" src="${import.meta.env.BASE_URL}icons/cmd/${p.faction}/${b.cmd}.svg" alt="">` : glyph ? pictogram(glyph) : '';
  const anim = b.key === h.pressed.key && performance.now() - h.pressed.at < 150 ? ` ${h.pressed.anim}` : '';
  const open = h.weaponMenu && b.icon === h.weaponMenu ? ' open' : '';
  return `<button class="cmd${off}${anim}${open}${pic ? ' has-icon' : ''}${b.auto ? ' autocast' : ''}${cls}" data-key="${b.key}" aria-label="${b.label}"${b.reason ? ' aria-disabled="true"' : ''}${style}><kbd>${keyLabel(h, b)}</kbd>${pic}<span>${b.label}</span>${cost}${extra}</button>`;
}

/**
 * The build list as a tech tree: a column per step of requirements (DEFS.requires), each building in the row of the
 * first thing it needs, so the links run straight. A requirement that is not built but evolved into (the Intelligence
 * suprême) stands in the tree too, as a node that cannot be clicked, linked to what it evolves from. Locked buildings
 * are greyed with what they lack (World.lacks); built ones are ticked. Links are drawn once laid out (drawLinks).
 */
function treeHtml(h: Hud): string {
  const btn = new Map(h.buttons.filter((b) => b.icon).map((b) => [b.icon!, b]));
  const from = (t: string) => [...btn.keys()].find((s) => (DEFS[s] as BuildingDef).morphs?.includes(t));
  const needs = (t: string): string[] => {
    const r = Object.keys((DEFS[t] as BuildingDef).requires ?? {}).filter((x) => DEFS[x]?.kind === 'building');
    const src = btn.has(t) ? undefined : from(t);
    return src ? [src, ...r] : r;
  };
  // Every building of the list and every building they need, recursively.
  const nodes: string[] = [];
  const add = (t: string) => {
    if (nodes.includes(t)) return;
    needs(t).forEach(add);
    nodes.push(t);
  };
  [...btn.keys()].forEach(add);
  const depth = new Map<string, number>();
  for (const t of nodes) depth.set(t, Math.max(-1, ...needs(t).map((r) => depth.get(r) ?? 0)) + 1);
  const row = new Map<string, number>();
  const free: number[] = [];
  for (const t of [...nodes].sort((a, b) => depth.get(a)! - depth.get(b)!)) {
    const c = depth.get(t)!;
    const r = Math.max(free[c] ?? 0, ...needs(t).map((x) => row.get(x) ?? 0));
    row.set(t, r);
    free[c] = r + 1;
  }
  const has = (t: string) => (built(h).get(t) ?? 0) > 0;
  const at = (t: string) => ` style="grid-column:${depth.get(t)! + 1};grid-row:${row.get(t)! + 1}" data-t="${t}" data-req="${needs(t).join(' ')}"`;
  const html = nodes.map((t) => {
    const tick = has(t) ? ' have' : '';
    const b = btn.get(t);
    if (b) return buttonHtml(h, b, b.reason ? `<em>${b.reason}</em>` : '', ` node${tick}`, at(t));
    const src = from(t);
    const why = h.world.lacks(h.player, t, built(h));
    return `<div class="node ghost${tick}${why && !tick ? ' off' : ''}"${at(t)}>${img(t, '')}<span>${DEFS[t].name}</span><em>${src ? `évolution : ${DEFS[src].name}` : 'à obtenir'}</em></div>`;
  });
  const back = h.buttons.find((b) => !b.icon);
  if (back) html.push(buttonHtml(h, back, '', ' node back', ` style="grid-column:1;grid-row:${free.reduce((m, v) => Math.max(m, v ?? 0), 0) + 1}"`));
  return html.join('');
}

/** The local player's finished buildings by type, counted once a tick for every requirement check and tick of the card. */
const builtCache = new WeakMap<object, { tick: number; player: number; n: Map<string, number> }>();
function built(h: Hud): Map<string, number> {
  const c = builtCache.get(h.world);
  if (c && c.tick === h.world.tick && c.player === h.player) return c.n;
  const n = h.world.builtCounts(h.player);
  builtCache.set(h.world, { tick: h.world.tick, player: h.player, n });
  return n;
}

/** Redraws the tree's links when the card changes size (a window resized, a phone turned); made on first use (browser only). */
let linker: ResizeObserver | undefined;
function relinkOnResize(card: HTMLElement): void {
  linker ??= new ResizeObserver((entries) => {
    for (const { target } of entries) {
      const c = target as HTMLElement;
      if (!c.classList.contains('tree') || c.dataset.size === `${c.clientWidth}x${c.clientHeight}`) continue;
      c.querySelector('svg.links')?.remove();
      drawLinks(c);
    }
  });
  linker.observe(card);
  if (!card.dataset.scrolls) {
    card.dataset.scrolls = '1';
    card.addEventListener('scroll', () => moreRight(card), { passive: true });
  }
}

/** Marks a tree that has more to the right than it shows (its right edge fades), until scrolled to its end. */
function moreRight(card: HTMLElement): void {
  card.classList.toggle('more', card.classList.contains('tree') && card.scrollLeft + card.clientWidth < card.scrollWidth - 2);
}

/** The tree's links, drawn under its nodes once they are laid out: amber, dashed towards a locked building. */
function drawLinks(card: HTMLElement): void {
  card.dataset.size = `${card.clientWidth}x${card.clientHeight}`;
  moreRight(card);
  const box = card.getBoundingClientRect();
  const rect = new Map([...card.querySelectorAll<HTMLElement>('[data-t]')].map((n) => [n.dataset.t!, n]));
  const paths = { open: '', lock: '' };
  for (const n of rect.values()) {
    const b = n.getBoundingClientRect();
    for (const r of (n.dataset.req ?? '').split(' ').filter(Boolean)) {
      const a = rect.get(r)?.getBoundingClientRect();
      if (!a) continue;
      const x1 = a.right - box.left + card.scrollLeft;
      const y1 = a.top + a.height / 2 - box.top + card.scrollTop;
      const x2 = b.left - box.left + card.scrollLeft;
      const y2 = b.top + b.height / 2 - box.top + card.scrollTop;
      // The bend just before the node's own column: a link that skips a column runs along its row, not down through its nodes.
      const mx = Math.round(Math.max(x1 + 6, x2 - 11));
      paths[n.classList.contains('off') ? 'lock' : 'open'] += `M${Math.round(x1)} ${Math.round(y1)}H${mx}V${Math.round(y2)}H${Math.round(x2)}`;
    }
  }
  card.insertAdjacentHTML('afterbegin', `<svg class="links" width="${card.scrollWidth}" height="${card.scrollHeight}" aria-hidden="true"><path d="${paths.open}"/><path class="lock" d="${paths.lock}"/></svg>`);
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

/** Fills and places the tooltip above a command button (or another button, `given` saying what it does). */
export function showTip(h: Hud, button: HTMLElement, given?: Button): void {
  // A command, or a weapon in the socle's menu.
  const b = given ?? (button.dataset.wkey ? h.menuItems.find((x) => x.key === button.dataset.wkey) : h.buttons.find((x) => x.key === button.dataset.key));
  if (!b) return;
  const d = DEFS[b.type ?? b.icon ?? ''] as UnitDef | BuildingDef | UpgradeDef | undefined;
  const p = h.world.players[h.player];
  const lines: string[] = [`${b.weapon ? weaponIcon(b.weapon) : ''}<b>${b.label}</b>${b.key ? ` <kbd>${keyLabel(h, b)}</kbd>` : ''}`];
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
    if ((d as BuildingDef).bunker) stats.push((d as BuildingDef).energyRate ? `${(d as BuildingDef).bunker} ouvriers à l’intérieur, 25 % chacun` : `abrite ${(d as BuildingDef).bunker} soldats`);
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
  const top = r.top - h.tip.offsetHeight - 8;
  h.tip.style.top = `${top < 6 ? r.bottom + 8 : top}px`; // under it when there is no room above (the queues' column)
}

function afford(p: { minerals: number; energy: number }, c: Cost): boolean {
  return p.minerals >= c.minerals && p.energy >= c.energy;
}
