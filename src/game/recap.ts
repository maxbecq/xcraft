/**
 * The end-of-game analysis (remark 92), a prototype behind ?bilan=1|2|3, one layout each: 1 a board of small curves,
 * 2 one large curve with tabs and the key moments marked on it, 3 the balance of forces and a table of totals. Its data:
 * game/recap-data.ts.
 */
import { TEAM_COLORS } from '../render/models';
import { TICK_RATE } from '../sim/fixed';
import type { World } from '../sim/world';
import { params } from './config';
import type { Moment, RecapPlayer, RecapSample, Recorder } from './recap-data';

export const RECAP_LAYOUT = (['1', '2', '3'] as const).find((l) => l === params.get('bilan')) ?? null;

interface Metric {
  key: string;
  label: string;
  get: (p: RecapPlayer) => number;
}
const METRICS: Metric[] = [
  { key: 'ressources', label: 'Ressources en réserve', get: (p) => p.minerals + p.energy },
  { key: 'armee', label: 'Armée (valeur)', get: (p) => p.army },
  { key: 'production', label: 'Production cumulée', get: (p) => p.produced },
  { key: 'pertes', label: 'Pertes cumulées', get: (p) => p.lost },
  { key: 'ouvriers', label: 'Ouvriers', get: (p) => p.workers },
  { key: 'activite', label: 'Activité (ordres / min)', get: (p) => p.apm },
];

const MOMENT_ICON: Record<Moment['kind'], string> = { batiment: '▣', unite: '◆', combat: '⚔', 'base-perdue': '✖', fin: '★' };
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const clock = (tick: number) => {
  const s = Math.round(tick / TICK_RATE);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** One curve a player on `cv`, time across; key moments as ticks along the bottom when given. */
function draw(cv: HTMLCanvasElement, tl: RecapSample[], get: (p: RecapPlayer) => number, colors: string[], moments: Moment[] = []): void {
  const dpr = devicePixelRatio || 1;
  const W = cv.clientWidth;
  const H = cv.clientHeight;
  cv.width = W * dpr;
  cv.height = H * dpr;
  const g = cv.getContext('2d')!;
  g.scale(dpr, dpr);
  const L = 40;
  const B = moments.length ? 30 : 18;
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
  for (const m of moments) {
    g.fillStyle = colors[m.player] ?? '#fff';
    g.fillText(MOMENT_ICON[m.kind], x(m.tick) - 4, H - 4);
  }
}

const CSS = `
.recap{position:fixed;inset:0;z-index:60;overflow:auto;background:#0b0d12;color:#e8e4da;font:14px system-ui,sans-serif;padding:max(16px,env(safe-area-inset-top)) 16px 24px}
.recap h2{margin:0 0 4px;font-size:20px}.recap .sub{opacity:.7;margin-bottom:12px}
.recap .close{position:sticky;top:0;float:right;font-size:22px;background:#333;color:#fff;border:0;border-radius:6px;padding:2px 12px}
.recap .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.recap .card{background:rgba(255,255,255,.05);border-radius:8px;padding:8px}.recap .card h3{margin:0 0 4px;font-size:13px;font-weight:600;opacity:.85}
.recap canvas{width:100%;height:140px;display:block}.recap .big canvas{height:min(48vh,360px)}
.recap .legend span{margin-right:14px}.recap .legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px}
.recap .tabs{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.recap .tabs button{background:#2a2e36;color:#ddd;border:0;border-radius:14px;padding:6px 12px}
.recap .tabs button.on{background:#e8c060;color:#111}
.recap ol{list-style:none;padding:0;margin:8px 0;columns:2 280px}.recap li{padding:2px 0;break-inside:avoid}.recap li b{display:inline-block;width:44px;opacity:.6;font-weight:400}
.recap table{border-collapse:collapse;width:100%;margin-top:12px}.recap td,.recap th{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.1);text-align:right}.recap td:first-child,.recap th:first-child{text-align:left}
.recap .strip{position:relative;height:64px;margin:8px 40px 0}.recap .strip span{position:absolute;transform:translateX(-50%);font-size:16px;text-align:center}
`;

/** Opens the analysis over the game, in the layout picked by ?bilan=. */
export function showRecap(rec: Recorder, world: World, names: string[]): void {
  const colors = world.players.map((p) => hex(TEAM_COLORS[p.id % TEAM_COLORS.length]));
  const tl = rec.timeline;
  const box = document.createElement('div');
  box.className = 'recap';
  const style = document.createElement('style');
  style.textContent = CSS;
  const legend = `<div class="legend">${names.map((n, i) => `<span><i style="background:${colors[i]}"></i>${esc(n)}</span>`).join('')}</div>`;
  const moments = (list: Moment[]) => `<ol>${list.map((m) => `<li><b>${clock(m.tick)}</b><span style="color:${colors[m.player] ?? '#fff'}">${MOMENT_ICON[m.kind]}</span> ${esc(names[m.player] ?? '')} — ${esc(m.detail)}</li>`).join('')}</ol>`;
  const head = `<button class="close" aria-label="Fermer">✕</button><h2>Analyse de la partie</h2><div class="sub">Durée ${clock(world.tick)} · ${rec.moments.length} moments clés</div>${legend}`;
  // Building after building, the first of each kind, is too many to read: the board and tabs keep the fights, bases and the end.
  const major = rec.moments.filter((m) => m.kind !== 'batiment' && m.kind !== 'unite');
  const layout = RECAP_LAYOUT ?? '1';
  const redraws: (() => void)[] = [];
  if (layout === '1') {
    box.innerHTML = `${head}<div class="grid">${METRICS.map((m) => `<div class="card"><h3>${m.label}</h3><canvas data-m="${m.key}"></canvas></div>`).join('')}</div><h3>Moments clés</h3>${moments(rec.moments)}`;
    for (const m of METRICS) redraws.push(() => draw(box.querySelector(`[data-m="${m.key}"]`)!, tl, m.get, colors));
  } else if (layout === '2') {
    box.innerHTML = `${head}<div class="tabs">${METRICS.map((m, i) => `<button data-t="${i}" class="${i ? '' : 'on'}">${m.label}</button>`).join('')}</div><div class="card big"><canvas></canvas></div><h3>Moments clés</h3>${moments(major)}`;
    let at = 0;
    const cv = box.querySelector<HTMLCanvasElement>('.big canvas')!;
    redraws.push(() => draw(cv, tl, METRICS[at].get, colors, major));
    box.querySelector('.tabs')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-t]');
      if (!b) return;
      at = Number(b.dataset.t);
      box.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
      redraws.forEach((f) => f());
    });
  } else {
    // The balance of forces: each side's share of all the army on the map, stacked to 100 %.
    const share = (p: RecapPlayer, s: RecapSample) => (100 * p.army) / Math.max(1, s.players.reduce((a, q) => a + q.army, 0));
    const end = tl.at(-1)?.tick || 1;
    const rows = world.players.map((_, i) => {
      const s = tl.map((x) => x.players[i]);
      const avg = s.length ? Math.round(s.reduce((a, x) => a + x.apm, 0) / s.length) : 0;
      return `<tr><td style="color:${colors[i]}">${esc(names[i])}</td><td>${s.at(-1)?.produced ?? 0}</td><td>${s.at(-1)?.lost ?? 0}</td><td>${Math.max(0, ...s.map((x) => x.army))}</td><td>${Math.max(0, ...s.map((x) => x.workers))}</td><td>${avg}</td></tr>`;
    });
    box.innerHTML = `${head}<div class="card big"><h3>Rapport de force (part de l’armée, %)</h3><canvas></canvas><div class="strip">${major.map((m, i) => `<span title="${esc(m.detail)}" style="left:${(100 * m.tick) / end}%;color:${colors[m.player] ?? '#fff'}">${MOMENT_ICON[m.kind]}<br><small>${i && m.tick - major[i - 1].tick < end / 25 ? '' : clock(m.tick)}</small></span>`).join('')}</div></div>
      <table><tr><th>Joueur</th><th>Produit</th><th>Perdu</th><th>Armée au plus fort</th><th>Ouvriers au plus</th><th>Ordres / min</th></tr>${rows.join('')}</table><h3>Moments clés</h3>${moments(rec.moments)}`;
    const cv = box.querySelector<HTMLCanvasElement>('.big canvas')!;
    redraws.push(() => draw(cv, tl.map((s) => ({ tick: s.tick, players: s.players.map((p) => ({ ...p, army: share(p, s) })) })), (p) => p.army, colors));
  }
  box.prepend(style);
  document.body.append(box);
  const redraw = () => redraws.forEach((f) => f());
  redraw();
  addEventListener('resize', redraw);
  box.querySelector('.close')!.addEventListener('click', () => {
    removeEventListener('resize', redraw);
    box.remove();
  });
}
