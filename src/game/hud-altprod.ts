/**
 * The alternative interface's production column (the user's choice of 2026-11-24, backlog 18): by kind of producer
 * rather than one row each. Under each kind, what it can make now (requirements met, a producer free of them) and
 * the queues of all its producers. A click on a unit queues one: an ordinary `train` order to every producer of that
 * kind, which the simulation gives to the least busy (shortest queue, then the one finishing first). A right click
 * takes the last of that unit queued back out; a click on a queued icon takes that one out; on the kind's name,
 * picks its producers.
 */
import { type BuildingDef, type Cost, DEFS, type UnitDef } from '../data';
import { FP, ticks } from '../sim/fixed';
import type { Entity } from '../sim/world';
import { img } from './glyphs';
import type { Hud } from './hud';

const KEY = 'alt:';
const afford = (p: { minerals: number; energy: number }, c: Cost) => p.minerals >= c.minerals && p.energy >= c.energy;
const price = (c: Cost) => `${c.minerals ? `◆ ${c.minerals}` : ''}${c.minerals && c.energy ? ' ' : ''}${c.energy ? `⚡ ${c.energy}` : ''}`;

/** Our producers, finished, by kind (in a fixed order). */
function kinds(h: Hud): [string, Entity[]][] {
  const by = new Map<string, Entity[]>();
  const all = [...h.world.entities.values()]
    .filter((e) => e.owner === h.player && e.buildLeft === 0 && !e.inside && (!!(e.def as BuildingDef | UnitDef).trains?.length || e.queue.length > 0))
    .sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id);
  for (const e of all) by.set(e.type, [...(by.get(e.type) ?? []), e]);
  return [...by];
}

/** What producers of a kind can make now: requirements met, by one of them at least (an Isdaris extension is one Portail's). */
function makes(h: Hud, es: Entity[]): string[] {
  return ((es[0].def as BuildingDef | UnitDef).trains ?? []).filter((t) => es.some((e) => !h.world.lacks(h.player, t, undefined, e)));
}

export function updateAltProd(h: Hud): void {
  const p = h.world.players[h.player];
  const list = kinds(h).map(([type, es]) => ({ type, es, can: makes(h, es) }));
  const key = KEY + list.map(({ type, es, can }) => `${type}:${es.map((e) => `${e.id}=${e.queue.join(',')}`).join(';')}:${can.map((t) => t + afford(p, (DEFS[t] as UnitDef).cost)).join(',')}`).join('|');
  if (key !== h.prodKey) {
    h.prodKey = key;
    h.prodList.innerHTML = list.length
      ? list
          .map(({ type, es, can }) => {
            const ids = es.map((e) => e.id).join(',');
            const units = can
              .map((t) => {
                const d = DEFS[t] as UnitDef;
                const off = afford(p, d.cost) ? '' : ' off';
                return `<button class="make${off}" data-train="${t}" data-ids="${ids}" title="${d.name} · ${price(d.cost)} · ${d.buildTime} s. Clic : en produire un ; clic droit : retirer le dernier en file">${img(t, d.name)}</button>`;
              })
              .join('');
            const queue = es
              .flatMap((e) => e.queue.map((t, i) => `<span class="cancel${i ? '' : ' now'}" data-of="${e.id}" data-slot="${i}" title="${DEFS[t].name}. Clic : annuler">${img(t, DEFS[t].name)}${i ? '' : '<i></i>'}</span>`))
              .join('');
            const busy = es.filter((e) => e.queue.length).length;
            return `<div class="prod-kind"><button class="kind" data-ids="${ids}" title="Sélectionner : ${es[0].def.name}">${img(type, es[0].def.name)}<b>${es[0].def.name}</b>${es.length > 1 ? `<em>×${es.length}</em>` : ''}${busy ? `<small class="left" data-of="${es.find((e) => e.queue.length)!.id}"></small>` : ''}</button>${units ? `<div class="makes">${units}</div>` : ''}${queue ? `<div class="queue">${queue}</div>` : ''}</div>`;
          })
          .join('')
      : '<em>Aucun bâtiment de production</em>';
  }
  // Every frame: the bars of what is under way, and the seconds left on the soonest done.
  for (const s of h.prodList.querySelectorAll<HTMLElement>('.cancel.now')) {
    const e = h.world.entities.get(Number(s.dataset.of));
    const fill = s.querySelector<HTMLElement>('i');
    if (e?.queue.length && fill) fill.style.width = `${Math.round(100 * (1 - e.trainLeft / h.world.trainTime(e, e.queue[0])))}%`;
  }
  for (const k of h.prodList.querySelectorAll<HTMLElement>('.prod-kind')) {
    const left = k.querySelector<HTMLElement>('small.left');
    if (!left) continue;
    const ids = (k.querySelector<HTMLElement>('.kind')!.dataset.ids ?? '').split(',').map(Number);
    const busy = ids.map((id) => h.world.entities.get(id)).filter((e): e is Entity => !!e?.queue.length);
    if (busy.length) left.textContent = `${Math.ceil(Math.min(...busy.map((e) => e.trainLeft)) / ticks(1))} s`;
  }
}

const idsOf = (el: HTMLElement) => (el.dataset.ids ?? '').split(',').map(Number).filter(Boolean);

/** A click in the column: queue a unit, or pick a kind's producers. True when it was one of these. */
export function altProdClick(h: Hud, target: HTMLElement): boolean {
  if (!h.alt || h.spectator) return false;
  const make = target.closest<HTMLElement>('[data-train]');
  if (make) {
    h.audio.play('click');
    h.issue({ player: h.player, kind: 'train', ids: idsOf(make), type: make.dataset.train! });
    return true;
  }
  const kind = target.closest<HTMLElement>('.kind');
  if (!kind) return false;
  const es = idsOf(kind).map((id) => h.world.entities.get(id)).filter((e): e is Entity => e?.owner === h.player);
  if (!es.length) return true;
  h.input.selected.clear();
  for (const e of es) h.input.selected.add(e.id);
  h.focus(es[0].x / FP, es[0].y / FP);
  return true;
}

/** A right click on a unit: the last of it in the queues of that kind out (the furthest back, the latest producer). */
export function altProdUndo(h: Hud, target: HTMLElement): boolean {
  const make = target.closest<HTMLElement>('[data-train]');
  if (!make || !h.alt || h.spectator) return false;
  const t = make.dataset.train!;
  let best: { e: Entity; slot: number } | null = null;
  for (const id of idsOf(make)) {
    const e = h.world.entities.get(id);
    const slot = e?.queue.lastIndexOf(t) ?? -1;
    if (e && slot >= 0 && (!best || slot > best.slot || (slot === best.slot && e.id > best.e.id))) best = { e, slot };
  }
  if (best) {
    h.audio.play('click');
    h.issue({ player: h.player, kind: 'cancel', ids: [best.e.id], slot: best.slot });
  }
  return true;
}
