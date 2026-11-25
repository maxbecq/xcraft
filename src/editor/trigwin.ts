/**
 * The triggers editor (Déclencheurs › Éditeur): the list by folder, the chosen trigger as sentences QUAND / SI /
 * ALORS with its fields inline (or as JSON), and beside it the regions, variables and the check. It works on a copy
 * of the table: OK keeps it, Annuler drops it.
 */
import { DEFS, type Faction } from '../data';
import { RACES } from './format2';
import { act, ed, REGION_COLORS } from './state';
import {
  ACTION_KINDS, type Action, blankAction, blankWhen, checkExpr, kindOf, LIMITS, NAME, parseExpr, readTriggers, renameRegion, renameTrigger, renameVar, RESERVED,
  type Trigger, triggerFaults, triggerProblems, type Triggers, WHEN_KINDS,
} from './triggers';
import { dialog } from './windows';

const h = (html: string) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const RACE_NAMES: Record<Faction, string> = { humains: 'Humains', z: 'Z', isdaris: 'Isdaris', dieux: 'Dieux' };
const WHEN_NAMES: Record<(typeof WHEN_KINDS)[number], string> = {
  time: 'À un moment de la partie', every: 'Régulièrement', enter: 'Entrée dans une région', leave: 'Sortie d\'une région',
  killed: 'Unité ou bâtiment détruit', built: 'Bâtiment terminé', check: 'Condition remplie',
};
const ACTION_NAMES: Record<(typeof ACTION_KINDS)[number], string> = {
  message: 'Afficher un message', spawn: 'Faire apparaître des unités', set: 'Fixer une variable', add: 'Ajouter à une variable', give: 'Donner des ressources',
  forbid: 'Interdire une technologie', allow: 'Autoriser une technologie', victory: 'Victoire', defeat: 'Défaite', enable: 'Activer un déclencheur', disable: 'Désactiver un déclencheur',
};

export function triggersWindow(): void {
  const f = ed.f;
  const players = f.players.length;
  const t: Triggers = structuredClone(f.triggers ?? { regions: [], vars: [], triggers: [] });
  let cur = 0;
  let view: 'phrases' | 'json' = 'phrases';
  let side: 'regions' | 'vars' | 'check' = 'regions';
  const body = h('<div class="trig"><div class="tlist"></div><div class="tbody"></div><div class="tside"></div></div>');

  // ---- inline fields ----
  type Opt = [string, string];
  const sel = (opts: Opt[], value: string, set: (v: string) => void, groups?: [string, Opt[]][]) => {
    const s = h(`<select>${groups ? groups.map(([g, o]) => `<optgroup label="${esc(g)}">${o.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</optgroup>`).join('') : ''}${opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>`) as HTMLSelectElement;
    s.value = value;
    if (s.value !== value) {
      s.prepend(h(`<option value="${esc(value)}">${esc(value || '—')} (inconnu)</option>`));
      s.value = value;
    }
    s.onchange = () => (set(s.value), draw());
    return s;
  };
  const num = (value: number, min: number, max: number, set: (v: number) => void) => {
    const i = h(`<input type="number" min="${min}" max="${max}" value="${value}">`) as HTMLInputElement;
    i.onchange = () => (set(Math.max(min, Math.min(max, Math.round(Number(i.value) || 0)))), draw());
    return i;
  };
  const txt = (value: string, max: number, set: (v: string) => void, cls = '') => {
    const i = h(`<input type="text" class="${cls}" maxlength="${max}" value="${esc(value)}">`) as HTMLInputElement;
    i.onchange = () => (set(i.value), draw());
    return i;
  };
  /** An expression field: red, with the reason in its tooltip, when it does not read. */
  const expr = (value: string, set: (v: string) => void, empty = false) => {
    const i = txt(value, LIMITS.expr, set, 'expr');
    const check = () => {
      let why = '';
      if (i.value.trim() || !empty) {
        try {
          why = checkExpr(parseExpr(i.value), new Set(t.vars.map((v) => v.id)), players).join(' ; ');
        } catch (e) {
          why = (e as Error).message;
        }
      }
      i.classList.toggle('bad', !!why);
      i.title = why || 'Entiers, + − * / %, comparaisons, and, or, not, variables, time, units(j, \'type\'), buildings(j, \'type\'), minerals(j), energy(j), alive(j) ; joueurs comptés de 1.';
    };
    i.oninput = check;
    check();
    return i;
  };
  const playerOpts = (neutral = false, any = false): Opt[] => [
    ...(any ? [['', 'n\'importe quel joueur'] as Opt] : []),
    ...(neutral ? [['-1', 'Neutre'] as Opt] : []),
    ...f.players.map((_, i) => [String(i), `Joueur ${i + 1}`] as Opt),
  ];
  const typeGroups = (kinds: string[]): [string, Opt[]][] => RACES.map((r) => [RACE_NAMES[r], Object.entries(DEFS).filter(([, d]) => kinds.includes(d.kind) && 'faction' in d && d.faction === r).map(([id, d]) => [id, d.name] as Opt)]);
  const regionOpts = (): Opt[] => t.regions.map((r) => [r.id, r.id]);
  const varOpts = (): Opt[] => t.vars.map((v) => [v.id, v.id]);
  const line = (...parts: (string | HTMLElement)[]) => {
    const d = h('<span class="sentence"></span>');
    for (const p of parts) d.append(typeof p === 'string' ? document.createTextNode(p) : p);
    return d;
  };

  // ---- one trigger, as sentences ----
  function whenLine(tr: Trigger): HTMLElement {
    const w = tr.when as Record<string, unknown>;
    const k = kindOf(tr.when);
    const kind = sel(WHEN_KINDS.map((x) => [x, WHEN_NAMES[x]]), k, (v) => (tr.when = blankWhen(v as (typeof WHEN_KINDS)[number], t)));
    const owner = () => sel(playerOpts(false, true), w.owner === undefined ? '' : String(w.owner), (v) => (v === '' ? delete w.owner : (w.owner = Number(v))));
    const parts: (string | HTMLElement)[] = [kind, ' : '];
    switch (k) {
      case 'time': parts.push('à ', num(w.time as number, 0, LIMITS.seconds, (v) => (w.time = v)), ' secondes de partie'); break;
      case 'every': parts.push('toutes les ', num(w.every as number, 1, LIMITS.seconds, (v) => (w.every = v)), ' secondes'); break;
      case 'enter': case 'leave': parts.push('quand une unité de ', owner(), k === 'enter' ? ' entre dans ' : ' sort de ', sel(regionOpts(), w[k] as string, (v) => (w[k] = v))); break;
      case 'killed': parts.push('quand ', sel([['', 'une unité ou un bâtiment']], w.killed as string, (v) => (w.killed = v), typeGroups(['unit', 'building'])), ' de ', owner(), ' est détruit'); break;
      case 'built': parts.push('quand ', owner(), ' termine ', sel([], w.built as string, (v) => (w.built = v), typeGroups(['building']))); break;
      case 'check': parts.push('dès que ', expr(w.check as string, (v) => (w.check = v))); break;
    }
    return line(...parts);
  }
  function actionLine(a: Action, tr: Trigger, n: number): HTMLElement {
    const x = a as Record<string, unknown>;
    const k = kindOf(a) as (typeof ACTION_KINDS)[number];
    const kind = sel(ACTION_KINDS.map((y) => [y, ACTION_NAMES[y]]), k, (v) => (tr.do[n] = blankAction(v as (typeof ACTION_KINDS)[number], t)));
    const pl = (key: string, neutral = false) => sel(playerOpts(neutral), String(x[key]), (v) => (x[key] = Number(v)));
    const parts: (string | HTMLElement)[] = [kind, ' : '];
    switch (k) {
      case 'message':
        parts.push('« ', txt(x.message as string, LIMITS.text, (v) => (x.message = v), 'wide'), ' » à ', sel([['all', 'tous'], ...playerOpts()], String(x.to), (v) => (x.to = v === 'all' ? 'all' : Number(v))), ' pendant ', num(x.seconds as number, 1, 120, (v) => (x.seconds = v)), ' s');
        break;
      case 'spawn':
        parts.push(expr(x.count as string, (v) => (x.count = v)), ' × ', sel([], x.spawn as string, (v) => (x.spawn = v), typeGroups(['unit'])), ' pour ', pl('owner', true), ' dans ', sel(regionOpts(), x.in as string, (v) => (x.in = v)),
          ', attaquer-déplacer vers ', sel([['', '—'], ...regionOpts()], (x.attack as string) ?? '', (v) => (v ? (x.attack = v) : delete x.attack)));
        break;
      case 'set': parts.push(sel(varOpts(), x.set as string, (v) => (x.set = v)), ' = ', expr(x.value as string, (v) => (x.value = v))); break;
      case 'add': parts.push(expr(x.value as string, (v) => (x.value = v)), ' à ', sel(varOpts(), x.add as string, (v) => (x.add = v))); break;
      case 'give': parts.push(expr(x.minerals as string, (v) => (x.minerals = v)), ' minerai et ', expr(x.energy as string, (v) => (x.energy = v)), ' énergie à ', pl('give')); break;
      case 'forbid': case 'allow': parts.push(sel([], x[k] as string, (v) => (x[k] = v), typeGroups(['unit', 'building', 'upgrade'])), ' pour ', pl('player')); break;
      case 'victory': case 'defeat': parts.push('pour ', pl(k)); break;
      case 'enable': case 'disable': parts.push(sel(tr ? t.triggers.map((y) => [y.id, y.id] as Opt) : [], x[k] as string, (v) => (x[k] = v))); break;
    }
    return line(...parts);
  }

  // ---- drawing ----
  function drawList(): void {
    const list = body.querySelector('.tlist')!;
    const folders = [...new Set(t.triggers.map((x) => x.folder))].sort((a, b) => a.localeCompare(b, 'fr'));
    const tools = h('<div class="tools"><button class="small" data-a="new">＋ Nouveau</button><button class="small" data-a="dup">Dupliquer</button><button class="small" data-a="del">Supprimer</button><button class="small" data-a="up">↑</button><button class="small" data-a="down">↓</button></div>');
    tools.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => {
      const tr = t.triggers[cur];
      const fresh = (base: string) => {
        let n = 1;
        while (t.triggers.some((y) => y.id === `${base}${n > 1 ? ` ${n}` : ''}`)) n++;
        return `${base}${n > 1 ? ` ${n}` : ''}`;
      };
      switch (b.dataset.a) {
        case 'new':
          if (t.triggers.length >= LIMITS.triggers) return;
          t.triggers.splice(cur + 1, 0, { id: fresh('Déclencheur'), folder: tr?.folder ?? '', enabled: true, once: false, when: { time: 0 }, do: [{ message: 'Bonne chance !', to: 'all', seconds: 5 }] });
          cur = Math.min(cur + 1, t.triggers.length - 1);
          break;
        case 'dup':
          if (!tr || t.triggers.length >= LIMITS.triggers) return;
          t.triggers.splice(cur + 1, 0, { ...structuredClone(tr), id: fresh(tr.id) });
          cur++;
          break;
        case 'del':
          if (!tr) return;
          t.triggers.splice(cur, 1);
          cur = Math.max(0, Math.min(cur, t.triggers.length - 1));
          break;
        case 'up': case 'down': {
          const j = cur + (b.dataset.a === 'up' ? -1 : 1);
          if (!tr || j < 0 || j >= t.triggers.length) return;
          [t.triggers[cur], t.triggers[j]] = [t.triggers[j], t.triggers[cur]];
          cur = j;
        }
      }
      draw();
    }));
    list.replaceChildren(tools, ...folders.flatMap((fo) => [
      h(`<div class="folder">▾ 📁 ${esc(fo || 'Sans dossier')}</div>`),
      ...t.triggers.map((x, i) => [x, i] as const).filter(([x]) => x.folder === fo).map(([x, i]) => {
        const row = h(`<div class="trow${i === cur ? ' on' : ''}${x.enabled ? '' : ' off'}">⚡ ${esc(x.id)}${x.enabled ? '' : ' <small>(désactivé)</small>'}</div>`);
        row.onclick = () => {
          cur = i;
          draw();
        };
        return row;
      }),
    ]));
    if (!t.triggers.length) list.appendChild(h('<p class="note">Aucun déclencheur. « Nouveau » en crée un.</p>'));
  }
  function drawBody(): void {
    const box = body.querySelector('.tbody')!;
    const tr = t.triggers[cur];
    if (!tr) return void box.replaceChildren(h('<p class="note">Choisir un déclencheur dans la liste, ou en créer un.</p>'));
    const head = h('<div class="thead"></div>');
    const name = txt(tr.id, 40, (v) => {
      const to = v.trim();
      if (!to || t.triggers.some((y) => y !== tr && y.id === to)) return act.say('Nom vide ou déjà pris.');
      renameTrigger(t, tr.id, to);
    }, 'name');
    const folder = txt(tr.folder, 40, (v) => (tr.folder = v.trim()), 'folder');
    folder.placeholder = 'dossier';
    const flag = (label: string, on: boolean, set: (v: boolean) => void) => {
      const l = h(`<label class="chip${on ? ' on' : ''}"><input type="checkbox"${on ? ' checked' : ''} hidden>${label}</label>`);
      l.querySelector('input')!.onchange = (e) => (set((e.target as HTMLInputElement).checked), draw());
      return l;
    };
    const views = h(`<span class="views">Affichage : <a data-v="phrases" class="${view === 'phrases' ? 'on' : ''}">Phrases</a> · <a data-v="json" class="${view === 'json' ? 'on' : ''}">JSON</a></span>`);
    views.querySelectorAll<HTMLElement>('a').forEach((a) => (a.onclick = () => ((view = a.dataset.v as typeof view), draw())));
    head.append(h('<b>⚡</b>'), name, folder, flag('Actif', tr.enabled, (v) => (tr.enabled = v)), flag('Une seule fois', tr.once, (v) => (tr.once = v)), views);
    if (view === 'json') {
      const area = h(`<textarea class="json" spellcheck="false">${esc(JSON.stringify(tr, null, 2))}</textarea>`) as HTMLTextAreaElement;
      const why = h('<p class="note"></p>');
      const apply = h('<button class="small">Appliquer</button>');
      apply.onclick = () => {
        try {
          const next = JSON.parse(area.value);
          const table = readTriggers({ ...t, triggers: t.triggers.map((y, i) => (i === cur ? next : y)) }, f.size, players);
          t.triggers[cur] = table.triggers[cur];
          draw();
        } catch (e) {
          why.textContent = `Refusé : ${(e as Error).message}`;
        }
      };
      box.replaceChildren(head, area, h('<div class="row"></div>'));
      box.lastElementChild!.append(apply, why);
      return;
    }
    const sec = (title: string) => h(`<div class="sec">${title}</div>`);
    const stmt = (el: HTMLElement, tools: HTMLElement[] = []) => {
      const d = h('<div class="stmt"></div>');
      d.append(el, ...tools);
      return d;
    };
    const ifBox = expr(tr.if ?? '', (v) => (v.trim() ? (tr.if = v.trim()) : delete tr.if), true);
    ifBox.placeholder = 'toujours (vide)';
    const actions = tr.do.map((a, n) => {
      const mk = (label: string, title: string, run: () => void) => {
        const b = h(`<button class="small" title="${title}">${label}</button>`);
        b.onclick = () => (run(), draw());
        return b;
      };
      return stmt(actionLine(a, tr, n), [
        mk('↑', 'Monter', () => n > 0 && ([tr.do[n - 1], tr.do[n]] = [tr.do[n], tr.do[n - 1]])),
        mk('↓', 'Descendre', () => n < tr.do.length - 1 && ([tr.do[n + 1], tr.do[n]] = [tr.do[n], tr.do[n + 1]])),
        mk('✕', 'Enlever', () => tr.do.splice(n, 1)),
      ]);
    });
    const add = sel([['', '＋ ajouter une action…'], ...ACTION_KINDS.map((k) => [k, ACTION_NAMES[k]] as Opt)], '', (v) => v && tr.do.length < LIMITS.actions && tr.do.push(blankAction(v as (typeof ACTION_KINDS)[number], t)));
    add.classList.add('add');
    box.replaceChildren(head, sec('QUAND'), stmt(whenLine(tr)), sec('SI'), stmt(line('', ifBox)), sec('ALORS'), ...actions, add);
  }
  function drawSide(): void {
    const box = body.querySelector('.tside')!;
    const faults = triggerProblems(t, f.size, players);
    const tabs = h(`<div class="tabs"><button data-s="regions">Régions (${t.regions.length})</button><button data-s="vars">Variables (${t.vars.length})</button><button data-s="check">Vérification ${faults.length ? `<b class="bad">${faults.length}</b>` : '<b class="ok">✔</b>'}</button></div>`);
    tabs.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.classList.toggle('on', b.dataset.s === side);
      b.onclick = () => ((side = b.dataset.s as typeof side), draw());
    });
    const rename = (ok: (to: string) => boolean, run: (to: string) => void) => (v: string) => {
      const to = v.trim();
      if (!NAME.test(to) || RESERVED.has(to) || !ok(to)) return act.say('Nom refusé : minuscules, chiffres et _, unique, pas un mot réservé.');
      run(to);
    };
    let content: HTMLElement;
    if (side === 'regions') {
      content = h('<div><table class="grid"><thead><tr><th></th><th>Nom</th><th>Tuiles</th><th></th></tr></thead><tbody></tbody></table><p class="note">Dessiner une région : outil Régions (▭) de la barre d\'outils, sur la carte.</p></div>');
      content.querySelector('tbody')!.replaceChildren(...t.regions.map((r, i) => {
        const tr = h(`<tr><td><i class="swatch" style="background:${hex(REGION_COLORS[i % REGION_COLORS.length])}"></i></td><td></td><td>${r.rect[0]}, ${r.rect[1]} · ${r.rect[2]}×${r.rect[3]}</td><td><button class="small go">Voir</button> <button class="small del">✕</button></td></tr>`);
        tr.children[1].appendChild(txt(r.id, 24, rename((to) => !t.regions.some((x) => x !== r && x.id === to), (to) => renameRegion(t, r.id, to))));
        tr.querySelector<HTMLButtonElement>('.go')!.onclick = () => act.lookAt(r.rect[0] + r.rect[2] / 2, r.rect[1] + r.rect[3] / 2);
        tr.querySelector<HTMLButtonElement>('.del')!.onclick = () => (t.regions.splice(i, 1), draw());
        return tr;
      }));
    } else if (side === 'vars') {
      content = h('<div><table class="grid"><thead><tr><th>Nom</th><th>Départ</th><th></th></tr></thead><tbody></tbody></table></div>');
      content.querySelector('tbody')!.replaceChildren(...t.vars.map((v, i) => {
        const tr = h('<tr><td></td><td></td><td><button class="small del">✕</button></td></tr>');
        tr.children[0].appendChild(txt(v.id, 24, rename((to) => !t.vars.some((x) => x !== v && x.id === to), (to) => renameVar(t, v.id, to))));
        tr.children[1].appendChild(num(v.value, -LIMITS.value, LIMITS.value, (n) => (v.value = n)));
        tr.querySelector<HTMLButtonElement>('.del')!.onclick = () => (t.vars.splice(i, 1), draw());
        return tr;
      }));
      const addV = h('<button class="small">＋ Nouvelle variable</button>');
      addV.onclick = () => {
        if (t.vars.length >= LIMITS.vars) return;
        let n = t.vars.length + 1;
        while (t.vars.some((v) => v.id === `compteur${n}`)) n++;
        t.vars.push({ id: `compteur${n}`, value: 0 });
        draw();
      };
      content.appendChild(addV);
    } else {
      content = h(`<div class="checklist">${faults.length ? faults.map((x) => `<div class="x">✕ ${esc(x)}</div>`).join('') : `<div class="ok">✔ ${t.triggers.length} déclencheur${t.triggers.length > 1 ? 's' : ''}, aucune erreur.</div>`}
        ${t.triggers.filter((x) => !x.enabled).map((x) => `<div class="w">! « ${esc(x.id)} » est désactivé.</div>`).join('')}
        <p class="note">Le jeu ne lit pas encore les déclencheurs : ils sont gardés dans le fichier de l'éditeur, en attendant leur moteur dans la simulation.</p></div>`);
    }
    box.replaceChildren(tabs, content);
  }
  function draw(): void {
    drawList();
    drawBody();
    drawSide();
  }
  draw();
  dialog('Éditeur de déclencheurs', body, [
    { label: 'Annuler' },
    {
      label: 'OK', main: true, run: () => {
        const faults = triggerFaults(t, f.size, players);
        if (faults.length) {
          side = 'check';
          draw();
          act.say(`À corriger d'abord : ${faults[0]}`);
          return false;
        }
        if (JSON.stringify(t) === JSON.stringify(f.triggers ?? { regions: [], vars: [], triggers: [] })) return;
        act.snapshot();
        if (t.regions.length || t.vars.length || t.triggers.length) f.triggers = t;
        else delete f.triggers;
        act.redrawThings();
      },
    },
  ], 'huge');
}
