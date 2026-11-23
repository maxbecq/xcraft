/**
 * The end-of-game analysis (remark 92), opened from the end banner: one large curve a player, picked by tabs, the
 * fights, lost headquarters and the victory marked under its time axis; each player's totals; the key moments. Its
 * data: game/recap-data.ts.
 */
import { TEAM_COLORS } from '../render/models';
import { TICK_RATE } from '../sim/fixed';
import type { World } from '../sim/world';
import type { Moment, RecapPlayer, RecapSample, Recorder, Totals } from './recap-data';

interface Metric {
  label: string;
  get: (p: RecapPlayer) => number;
}
const METRICS: Metric[] = [
  { label: 'Armée (valeur)', get: (p) => p.army },
  { label: 'Ressources en réserve', get: (p) => p.minerals + p.energy },
  { label: 'Production cumulée', get: (p) => p.produced },
  { label: 'Pertes cumulées', get: (p) => p.lost },
  { label: 'Ouvriers', get: (p) => p.workers },
  { label: 'Activité (ordres / min)', get: (p) => p.apm },
];

const MOMENT_ICON: Record<Moment['kind'], string> = { batiment: '▣', unite: '◆', combat: '⚔', 'base-perdue': '✖', fin: '★' };
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const clock = (tick: number) => {
  const s = Math.round(tick / TICK_RATE);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** One curve a player on `cv`, time across; key moments as marks along the bottom. */
function draw(cv: HTMLCanvasElement, tl: RecapSample[], get: (p: RecapPlayer) => number, colors: string[], moments: Moment[]): void {
  const dpr = devicePixelRatio || 1;
  const W = cv.clientWidth;
  const H = cv.clientHeight;
  cv.width = W * dpr;
  cv.height = H * dpr;
  const g = cv.getContext('2d')!;
  g.scale(dpr, dpr);
  const L = 40;
  const B = 32;
  const end = tl.at(-1)?.tick || 1;
  const max = Math.max(1, ...tl.flatMap((s) => s.players.map(get)));
  const x = (t: number) => L + ((W - L - 8) * t) / end;
  const y = (v: number) => 6 + (H - B - 6) * (1 - v / max);
  g.font = '11px system-ui, sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.strokeStyle = 'rgba(255,255,255,0.1)';
  for (const f of [0, 0.5, 1]) {
    g.beginPath();
    g.moveTo(L, y(max * f));
    g.lineTo(W - 8, y(max * f));
    g.stroke();
    g.fillText(String(Math.round(max * f)), 2, y(max * f) + 4);
  }
  for (let m = 0; m * 60 * TICK_RATE <= end; m += Math.max(1, Math.ceil(end / TICK_RATE / 60 / 6))) g.fillText(`${m}′`, x(m * 60 * TICK_RATE) - 4, H - B + 13);
  tl[0]?.players.forEach((_, p) => {
    g.strokeStyle = colors[p];
    g.lineWidth = 2;
    g.beginPath();
    tl.forEach((s, i) => (i ? g.lineTo : g.moveTo).call(g, x(s.tick), y(get(s.players[p]))));
    g.stroke();
  });
  g.font = '13px system-ui, sans-serif';
  for (const m of moments) {
    g.fillStyle = colors[m.player] ?? '#fff';
    g.fillText(MOMENT_ICON[m.kind], x(m.tick) - 5, H - 3);
  }
}

/** The totals table's rows: a label, and a player's value. */
function rows(tl: RecapSample[], totals: Totals[]): [string, (p: number) => string][] {
  const peak = (p: number, f: (x: RecapPlayer) => number) => Math.max(0, ...tl.map((s) => f(s.players[p])));
  const avg = (p: number) => (tl.length ? Math.round(tl.reduce((a, s) => a + s.players[p].apm, 0) / tl.length) : 0);
  const n = (v: number) => Math.round(v).toLocaleString('fr-FR');
  return [
    ['Minerai récolté', (p) => n(totals[p].gotMinerals)],
    ['Énergie récoltée', (p) => n(totals[p].gotEnergy)],
    ['Dépensé (minerai + énergie)', (p) => n(totals[p].spentMinerals + totals[p].spentEnergy)],
    ['Unités produites', (p) => n(totals[p].unitsMade)],
    ['Bâtiments construits', (p) => n(totals[p].buildingsMade)],
    ['Unités ennemies tuées', (p) => n(totals[p].unitsKilled)],
    ['Bâtiments ennemis détruits', (p) => n(totals[p].buildingsRazed)],
    ['Unités perdues', (p) => n(totals[p].unitsLost)],
    ['Bâtiments perdus', (p) => n(totals[p].buildingsLost)],
    ['Armée au plus fort', (p) => n(peak(p, (x) => x.army))],
    ['Ouvriers au plus', (p) => n(peak(p, (x) => x.workers))],
    ['Ordres par minute', (p) => n(avg(p))],
  ];
}

const CSS = `
.recap{position:fixed;inset:0;z-index:60;overflow:auto;background:#0b0d12;color:#e8e4da;font:14px system-ui,sans-serif;padding:max(16px,env(safe-area-inset-top)) 16px 24px}
.recap h2{margin:0 0 4px;font-size:20px}.recap h3{margin:16px 0 6px;font-size:15px}.recap .sub{opacity:.7;margin-bottom:10px}
.recap .close{position:sticky;top:0;float:right;font-size:22px;background:#333;color:#fff;border:0;border-radius:6px;padding:2px 12px}
.recap .card{background:rgba(255,255,255,.05);border-radius:8px;padding:8px}
.recap canvas{width:100%;height:min(48vh,360px);display:block}
.recap .legend span{margin-right:14px}.recap .legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px}
.recap .tabs{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.recap .tabs button{background:#2a2e36;color:#ddd;border:0;border-radius:14px;padding:6px 12px;font:inherit}
.recap .tabs button.on{background:#e8c060;color:#111}
.recap .wrap{overflow-x:auto}.recap table{border-collapse:collapse;width:100%;max-width:760px}
.recap td,.recap th{padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.08);text-align:right;white-space:nowrap}
.recap td:first-child,.recap th:first-child{text-align:left;white-space:normal;opacity:.85}
.recap .note{opacity:.55;font-size:12px;margin-top:6px}
.recap ol{list-style:none;padding:0;margin:4px 0;columns:2 280px}.recap li{padding:2px 0;break-inside:avoid}.recap li b{display:inline-block;width:44px;opacity:.6;font-weight:400}
`;

/** Opens the analysis over the game. */
export function showRecap(rec: Recorder, world: World, names: string[]): void {
  const colors = world.players.map((p) => hex(TEAM_COLORS[p.id % TEAM_COLORS.length]));
  const tl = rec.timeline;
  // Building after building, the first of each kind, is too many to read: the fights, bases and the end.
  const major = rec.moments.filter((m) => m.kind !== 'batiment' && m.kind !== 'unite');
  const box = document.createElement('div');
  box.className = 'recap';
  const legend = `<div class="legend">${names.map((n, i) => `<span><i style="background:${colors[i]}"></i>${esc(n)}</span>`).join('')}</div>`;
  const table = `<div class="wrap"><table><tr><th></th>${names.map((n, i) => `<th style="color:${colors[i]}">${esc(n)}</th>`).join('')}</tr>${rows(tl, rec.totals)
    .map(([label, v]) => `<tr><td>${label}</td>${names.map((_, i) => `<td>${v(i)}</td>`).join('')}</tr>`)
    .join('')}</table></div><p class="note">Récolté : tout ce qui est entré en réserve, remboursements et pillage compris. Tuées, détruits, perdus : au combat seulement (une unité absorbée ou consommée n’y compte pas).</p>`;
  const list = `<ol>${major.map((m) => `<li><b>${clock(m.tick)}</b><span style="color:${colors[m.player] ?? '#fff'}">${MOMENT_ICON[m.kind]}</span> ${esc(names[m.player] ?? '')} — ${esc(m.detail)}</li>`).join('')}</ol>`;
  box.innerHTML = `<style>${CSS}</style><button class="close" aria-label="Fermer">✕</button><h2>Analyse de la partie</h2><div class="sub">Durée ${clock(world.tick)}</div>${legend}
    <div class="tabs">${METRICS.map((m, i) => `<button data-t="${i}" class="${i ? '' : 'on'}">${m.label}</button>`).join('')}</div><div class="card"><canvas></canvas></div>
    <h3>Totaux</h3>${table}<h3>Moments clés</h3>${list}`;
  document.body.append(box);
  let at = 0;
  const cv = box.querySelector('canvas')!;
  const redraw = () => draw(cv, tl, METRICS[at].get, colors, major);
  box.querySelector('.tabs')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-t]');
    if (!b) return;
    at = Number(b.dataset.t);
    box.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    redraw();
  });
  redraw();
  addEventListener('resize', redraw);
  box.querySelector('.close')!.addEventListener('click', () => {
    removeEventListener('resize', redraw);
    box.remove();
  });
}
