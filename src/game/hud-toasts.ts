/** The HUD's messages (toasts) and the end-of-game banner. */
import type { Entity, GameEvent } from '../sim/world';
import { DEFS } from '../data';
import { FP } from '../sim/fixed';
import { el } from './glyphs';
import type { Hud } from './hud';

/** The sign before each message: refused (no entry), done (a tick), under attack (a shield with a bang). */
const SIGNS: Record<GameEvent['kind'], string> = {
  error: '<svg class="sign" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M5.5 14.5l9-9" stroke="currentColor" stroke-width="2.4"/></svg>',
  done: '<svg class="sign" viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 10.5l4.2 4.2L16.5 5.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  alert: '<svg class="sign" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5l7 2.6v5.2c0 4.4-3 7.6-7 9.2-4-1.6-7-4.8-7-9.2V4.1z" fill="currentColor"/><path d="M10 5.5v5.5M10 13.5v1.4" stroke="#1a0604" stroke-width="2.4" stroke-linecap="round"/></svg>',
};

export function showEvents(h: Hud, events: GameEvent[]): void {
  // The world's alert says only "attacked": the place is the last of ours that lost health this tick.
  let hit: Entity | undefined;
  if (h.lastHp.size > 2 * h.world.entities.size + 64) {
    h.lastHp.clear(); // forget the dead now and then
    h.hitAt.clear();
  }
  for (const e of h.world.entities.values()) {
    if (e.owner !== h.player) continue;
    const was = h.lastHp.get(e.id);
    if (was !== undefined && e.hp + e.shield < was) {
      hit = e;
      h.hitAt.set(e.id, performance.now());
    }
    h.lastHp.set(e.id, e.hp + e.shield);
  }
  // Every message is addressed to one player (a refusal, a building done, an attack): a spectator sees none.
  if (h.spectator) return;
  // A worker that reached its site but could no longer pay drops its build order with a bare "Pas assez de…":
  // say what was lost, as an alert pointing at the worker (it comes long after the order, often off screen).
  const dropped = [...h.sites].filter(([id]) => h.world.entities.get(id)?.order?.kind !== 'build');
  h.sites.clear();
  for (const e of h.world.entities.values()) if (e.owner === h.player && e.order?.kind === 'build') h.sites.set(e.id, e.order.type);
  for (let ev of events) {
    if (ev.player !== h.player) continue;
    let at: { x: number; y: number } | undefined;
    if (ev.kind === 'alert' && hit) at = { x: hit.x / FP, y: hit.y / FP };
    const site = ev.kind === 'error' && ev.text.startsWith('Pas assez') ? dropped.shift() : undefined;
    const worker = site && h.world.entities.get(site[0]);
    if (site) {
      ev = { ...ev, kind: 'alert', text: `${DEFS[site[1]].name} : construction annulée, ${ev.text[0].toLowerCase()}${ev.text.slice(1)}` };
      if (worker) at = { x: worker.x / FP, y: worker.y / FP };
    }
    // The same message again: its line counts up (×2, ×3…) and stays on, instead of piling up.
    const same = [...h.toasts.children].find((c): c is HTMLElement => c instanceof HTMLElement && !c.classList.contains('gone') && c.dataset.kind === ev.kind && c.dataset.text === ev.text);
    if (same) {
      const n = Number(same.dataset.n) + 1;
      same.dataset.n = String(n);
      same.querySelector('.times')!.textContent = `×${n}`;
      same.classList.remove('bump');
      void same.offsetWidth; // restart the bump
      same.classList.add('bump');
      h.toasts.append(same); // newest at the bottom
      expire(same, ev.kind);
      if (performance.now() - Number(same.dataset.sound) > 400) {
        h.audio.play(ev.kind);
        same.dataset.sound = String(performance.now());
      }
      continue;
    }
    const t = el('div', `hud-toast ${ev.kind}`);
    t.innerHTML = SIGNS[ev.kind];
    Object.assign(t.dataset, { kind: ev.kind, text: ev.text, n: '1', sound: String(performance.now()) });
    if (at) {
      const to = at;
      h.alertAt = to;
      h.ping(to.x, to.y);
      t.title = 'Aller voir (Espace ou Entrée)';
      t.addEventListener('click', () => h.focus(to.x, to.y));
    }
    h.audio.play(ev.kind);
    t.append(ev.text, el('b', 'times'));
    h.toasts.append(t);
    expire(t, ev.kind);
    while (h.toasts.children.length > 4) h.toasts.firstChild!.remove();
  }
}

/** (Re)starts a message's life: it fades after a while, shorter for a refusal, longer for an attack. */
function expire(t: HTMLElement, kind: GameEvent['kind']): void {
  const life = kind === 'alert' ? 5000 : kind === 'done' ? 3000 : 2200;
  clearTimeout(Number(t.dataset.fade));
  clearTimeout(Number(t.dataset.drop));
  t.dataset.fade = String(setTimeout(() => t.classList.add('gone'), life));
  t.dataset.drop = String(setTimeout(() => t.remove(), life + 300));
}

/** The end-of-game banner, once there is a winner. */
export function showEnd(h: Hud): void {
  if (h.world.winner !== null && h.banner.hidden) {
    // The winner is one player of the winning team: an ally's victory is ours too (our own buildings lost or not).
    const won = h.world.players[h.world.winner]?.team === h.world.players[h.player]?.team;
    h.banner.innerHTML = `<h1>${won ? 'Victoire !' : 'Défaite…'}</h1><div class="row"><button data-p="quit">Menu principal</button><button data-p="restart">${h.online ? 'Revanche' : 'Rejouer'}</button><button data-p="replay">Enregistrer le replay</button>${h.endButtons}</div>`;
    h.banner.classList.toggle('won', won);
    h.banner.hidden = false;
  }
}
