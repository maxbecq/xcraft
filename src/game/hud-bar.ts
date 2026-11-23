/** The top bar (resources, idle workers and production, control groups) and the production panel it opens. */
import { type BuildingDef, DEFS, FACTIONS } from '../data';
import { ticks } from '../sim/fixed';
import { img } from './glyphs';
import type { Hud } from './hud';

/** The resource bar: the clock, both resources and the supply. */
export function updateBar(h: Hud): void {
  const p = h.world.players[h.player];
  const s = h.world.supply(h.player);
  const secs = Math.floor((h.world.tick / ticks(60)) * 60);
  if (!h.bar.children.length) h.bar.innerHTML = '<span class="res clock">-</span><span class="res min"><i></i>-</span><span class="res nrg"><i></i>-</span><span class="res sup"><i></i>-</span>';
  const [clock, min, nrg, sup] = h.bar.children as HTMLCollectionOf<HTMLElement>;
  // Written only when it changes: the clock once a second, not at every call.
  write(clock.lastChild!, `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`);
  count(min, p.minerals);
  count(nrg, p.energy);
  if (write(sup.lastChild!, `${s.used}/${s.max}`)) sup.classList.toggle('full', s.used >= s.max);
}

/** A click on a queued icon (selection panel or production panel): that one out of the queue. */
export function cancelSlot(h: Hud, q: HTMLElement): void {
  const id = Number(q.dataset.of);
  const slot = Number(q.dataset.slot);
  if (h.world.entities.get(id)?.owner !== h.player) return;
  h.audio.play('click');
  h.issue({ player: h.player, kind: 'cancel', ids: [id], slot });
}

export function toggleProd(h: Hud): void {
  h.prod.hidden = !h.prod.hidden;
  h.prodToggle.classList.toggle('on', !h.prod.hidden);
  h.prodKey = '';
  try {
    localStorage.setItem('xcraft.prod', h.prod.hidden ? '0' : '1');
  } catch {
    // private browsing: open for this game only
  }
}

/** The production panel: rows rebuilt when a queue changes, progress bars moved every frame. */
export function updateProd(h: Hud): void {
  if (!h.prodToggle.firstChild) h.prodToggle.innerHTML = `${img(FACTIONS[h.world.players[h.player].faction].barracks, '')}<b>≡</b>`;
  if (h.prod.hidden) return;
  const producers = [...h.world.entities.values()]
    .filter((e) => e.owner === h.player && e.buildLeft === 0 && (e.def.kind === 'building' ? !!(e.def as BuildingDef).trains?.length || e.queue.length > 0 : e.queue.length > 0))
    .sort((a, b) => Number(!a.queue.length) - Number(!b.queue.length) || a.type.localeCompare(b.type) || a.id - b.id);
  const key = producers.map((e) => `${e.id}:${e.queue.join(',')}`).join('|');
  if (key !== h.prodKey) {
    h.prodKey = key;
    h.prodList.innerHTML = producers.length
      ? producers
          .map((e) => {
            const queue = e.queue.map((t, i) => `<span class="cancel${i ? '' : ' now'}" data-of="${e.id}" data-slot="${i}" title="${DEFS[t].name}. Clic : annuler">${img(t, DEFS[t].name)}${i > 1 ? '' : '<i></i>'}</span>`).join('');
            return `<button class="prod-row${e.queue.length ? '' : ' idle'}" data-id="${e.id}" title="${e.def.name}${e.queue.length ? '' : ' : à l’arrêt'}"><span class="who">${img(e.type, e.def.name)}</span>${queue || '<em>à l’arrêt</em>'}${e.queue.length ? '<b class="left"></b>' : ''}</button>`;
          })
          .join('')
      : '<em>Aucun bâtiment de production</em>';
  }
  for (const bar of h.prod.querySelectorAll<HTMLElement>('.prod-row')) {
    const e = h.world.entities.get(Number(bar.dataset.id));
    const [fill, second] = bar.querySelectorAll<HTMLElement>('.cancel i');
    if (!e || !fill || !e.queue.length) continue;
    // The world's time for it: a god's level shortens it.
    fill.style.width = `${Math.round(100 * (1 - e.trainLeft / h.world.trainTime(e, e.queue[0])))}%`;
    // Seconds left on the one under way (shown by the alternative interface's column).
    const left = bar.querySelector<HTMLElement>('.left');
    if (left) left.textContent = `${Math.ceil(e.trainLeft / ticks(1))} s`;
    // Miniportail: the second line's progress, on the second slot.
    if (second) second.style.width = e.trainLeft2 ? `${Math.round(100 * (1 - e.trainLeft2 / h.world.trainTime(e, e.queue[1])))}%` : '0';
  }
}

export function updateGroups(h: Hud): void {
  const list = h.input.groupList().map(([k, es]) => {
    const count = new Map<string, number>();
    for (const e of es) count.set(e.type, (count.get(e.type) ?? 0) + 1);
    const type = [...count].sort((a, b) => b[1] - a[1])[0][0];
    return { k, type, n: es.length };
  });
  const set = h.input.groupSet;
  const key = list.map((g) => `${g.k}${g.type}${g.n}`).join('|') + set.time;
  if (key === h.groupsKey) return;
  h.groupsKey = key;
  const fresh = performance.now() - set.time < 500 ? set.key : '';
  h.groups.innerHTML = list
    .map((g) => `<button class="chip${g.k === fresh ? ' flash' : ''}" data-g="${g.k}" title="Groupe ${g.k.slice(5)} : ${DEFS[g.type].name}"><kbd>${g.k.slice(5)}</kbd>${img(g.type, '')}<b>${g.n}</b></button>`)
    .join('');
}

export function updateIdle(h: Hud): void {
  const n = h.input.idleWorkers().length;
  if (n === h.idleCount) return;
  if (!h.idle.firstChild) h.idle.innerHTML = `${img(FACTIONS[h.world.players[h.player].faction].worker, '')}<b></b>`;
  h.idle.lastChild!.textContent = String(n);
  h.idle.hidden = n === 0;
  if (n > h.idleCount) {
    h.idle.classList.remove('flash');
    void h.idle.offsetWidth;
    h.idle.classList.add('flash');
  }
  h.idleCount = n;
}

/** The idle-production chip: how many production buildings stand with an empty queue. */
export function updateIdleProd(h: Hud): void {
  const p = h.input.idleProducers().length;
  if (p !== h.idleProdCount) {
    if (!h.idleProd.firstChild) h.idleProd.innerHTML = `${img(FACTIONS[h.world.players[h.player].faction].barracks, '')}<b></b>`;
    h.idleProd.lastChild!.textContent = String(p);
    h.idleProd.hidden = p === 0;
    if (p > h.idleProdCount) {
      h.idleProd.classList.remove('flash');
      void h.idleProd.offsetWidth;
      h.idleProd.classList.add('flash');
    }
    h.idleProdCount = p;
  }
}

/** Sets a resource's count; it flashes as it goes up (income) or down (spending). */
function count(span: HTMLElement, value: number): void {
  const text = span.lastChild!;
  const before = Number(text.textContent);
  if (before === value) return;
  text.textContent = String(value);
  if (Number.isNaN(before)) return;
  const dir = value > before ? 'gain' : 'spend';
  span.classList.remove('gain', 'spend');
  void span.offsetWidth;
  span.classList.add(dir);
}

/** Sets a text node's text if it differs; true when it did. */
function write(node: ChildNode, text: string): boolean {
  if (node.textContent === text) return false;
  node.textContent = text;
  return true;
}
