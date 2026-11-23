/** The selection panel: the live portrait's text beside it, a group's tiles, a queue, the cargo and the fighting stats. */
import BALANCE from '../balance.json';
import { ABILITIES, type BuildingDef, DEFS, KIT, MYTHS, type Mythology, type UnitDef, type UpgradeDef, WEAPONS } from '../data';
import { FP, TICK_RATE, ticks } from '../sim/fixed';
import type { Entity } from '../sim/world';
import { img } from './glyphs';
import type { Hud } from './hud';

function setDetails(h: Hud, html: string): void {
  const bars = /width:[\d.e+-]+%/g;
  const key = html.replace(bars, '');
  if (key !== h.detailsKey) {
    h.detailsKey = key;
    h.details.innerHTML = html;
    return;
  }
  const widths = html.match(bars) ?? [];
  h.details.querySelectorAll<HTMLElement>('[style*="width"]').forEach((el, i) => {
    if (widths[i]) el.style.width = widths[i].slice(6);
  });
}

export function updatePanel(h: Hud): void {
  // Nothing it shows moves between two ticks but the portrait, which paces itself: the sheet was written out whole
  // (24 tiles for a group) and compared every frame.
  const key = `${h.world.tick}|${h.selKey}|${h.activeType}`;
  if (key === h.panelKey) {
    if (!h.portrait.canvas.hidden) h.portrait.render();
    return;
  }
  h.panelKey = key;
  const sel = [...h.input.selected].map((id) => h.world.entities.get(id)).filter((e): e is Entity => !!e);
  h.portrait.show(sel.length === 1 ? sel[0].type : null, sel[0]?.owner);
  h.portrait.canvas.hidden = sel.length !== 1;
  if (sel.length === 0) {
    setDetails(h, '');
    return;
  }
  if (sel.length > 1) {
    setDetails(h, `<div class="grid">${sel
      .slice(0, 24)
      .map((e) => `<div class="tile${e.type === h.activeType ? ' active' : ''}${performance.now() - (h.hitAt.get(e.id) ?? -1e9) < 500 ? ' hurt' : ''}" data-id="${e.id}" style="--hp:${e.hp / e.maxHp}">${img(e.type, e.def.name)}</div>`)
      .join('')}</div>`);
    return;
  }
  const e = sel[0];
  let html = `<div class="name" title="${e.def.name}">${e.def.name}${(e.def as UnitDef).levels ? ` <small>niveau ${e.lvl}</small>` : ''}</div>`;
  if (e.def.kind === 'resource') {
    html += `<div class="info">${Number.isFinite(e.amount) ? `${e.amount} restants` : 'Inépuisable'}</div>`;
  } else {
    if (e.maxShield) html += `<div class="hp shield"><div style="width:${(100 * e.shield) / e.maxShield}%"></div></div>`;
    html += `<div class="hp"><div style="width:${(100 * e.hp) / e.maxHp}%"></div></div>`;
    // A caster's own energy (fiches 2010): its bar and its points, for its owner and the enemy alike (as in SC2); its
    // points on the health's line, so the sheet keeps to the console's height.
    const mana = h.world.manaOf(e);
    if (mana) html += `<div class="hp mana"><div style="width:${(100 * e.mana) / (mana[0] * FP)}%"></div></div>`;
    html += `<div class="info">${e.hp} / ${e.maxHp}${e.maxShield ? ` · bouclier ${e.shield} / ${e.maxShield}` : ''}${mana ? ` · énergie ${Math.floor(e.mana / FP)} / ${mana[0]}` : ''}</div>`;
  }
  if (e.def.kind === 'building') {
    const def = e.def as BuildingDef;
    // Construction or production: a block of its own, set beside the rest on wide screens.
    if (e.buildLeft > 0) {
      html += `<div class="prod">${progress('Construction', 1 - e.buildLeft / ticks(def.buildTime))}</div>`;
    } else if (e.queue.length) {
      const first = DEFS[e.queue[0]] as UnitDef | UpgradeDef;
      html += `<div class="prod">${progress(first.name, 1 - e.trainLeft / ticks(first.buildTime))}`;
      // Miniportail: the second line, on the unit second in the queue.
      if (e.trainLeft2) html += progress(DEFS[e.queue[1]].name, 1 - e.trainLeft2 / h.world.trainTime(e, e.queue[1]));
      // Each one in the queue: a click (or a tap) takes it out, refunded.
      const own = e.owner === h.player && !h.spectator;
      html += `<div class="queue">${e.queue
        .map((t, i) => {
          const name = e.kits[i] ? `${DEFS[t].name} : ${WEAPONS[e.kits[i]].name}` : DEFS[t].name;
          return own ? `<span class="cancel" data-of="${e.id}" data-slot="${i}" title="${name}. Clic : annuler">${img(t, name)}</span>` : `<span>${img(t, name)}</span>`;
        })
        .join('')}</div></div>`;
    }
  }
  // The Temple primordial: each mythology's ultimate, charging while its three gods stand.
  if (e.type === 'primordial' && e.buildLeft === 0 && e.owner === h.player) {
    // One short line each, by mythology (the spell and gods in its tooltip): spelt out, the third fell below the panel.
    html += `<div class="prod">${(Object.keys(MYTHS) as Mythology[]).map((m) => `<div title="${ABILITIES[MYTHS[m].spell].name} (${MYTHS[m].gods.map((g) => DEFS[g].name).join(', ')})">${progress(`${MYTHS[m].name[0].toUpperCase()}${MYTHS[m].name.slice(1)} · ${ultimatePct(h, m)} %`, ultimatePct(h, m) / 100)}</div>`).join('')}</div>`;
  }
  if (e.def.kind === 'unit' && e.carry) html += `<div class="info">Transporte ${e.carry} minerai</div>`;
  // Druide's Double énergétique: its owner alone knows it is a decoy, and for how long.
  if (e.illusion && e.owner === h.player) html += `<div class="info">Double énergétique · disparaît dans ${Math.ceil(e.ttl / TICK_RATE)} s</div>`;
  // Carriers and bunkers: who is inside, each with its health; a click on one lets it out (as in SC2).
  const aboard = [...h.world.entities.values()].filter((u) => u.inside === e.id);
  if (aboard.length) {
    const out = e.owner === h.player && !h.spectator ? ' (clic : débarquer)' : '';
    html += `<div class="prod cargo"><div class="info">À bord : ${aboard.length}</div><div class="grid">${aboardTiles(h, e, aboard, out)}</div></div>`;
  }
  if ((e.def as UnitDef).weapons) {
    const arm = e.kit ? WEAPONS[e.kit].name : e.def.kind === 'unit' || (e.def as BuildingDef).attack ? 'Mitrailleuse' : 'aucune';
    const kits = [[KIT.detection, 'Détection'], [KIT.invisibilite, 'Invisibilité'], [KIT.reparateur, 'Auto-réparateur'], [KIT.patte, 'Patte ultramécanique']].filter(([bit]) => e.support & (bit as number)).map(([, n]) => n);
    html += `<div class="info">${e.def.kind === 'unit' ? `T${e.tier}${e.evolving ? ' (évolution en cours)' : ''} · ` : ''}Arme : ${arm}${kits.length ? ` · Kits : ${kits.join(', ')}` : ''}${e.seizedLeft ? ' · Capturé (Canon IEM)' : ''}</div>`;
  }
  // Équilibreur 22/11: a Z building off its creep stands idle, and says why.
  if (e.def.kind === 'building' && e.buildLeft === 0 && (e.def as BuildingDef).faction === 'z' && !h.world.onCreep(e)) html += `<div class="info off-creep" title="Hors du creep, ce bâtiment ne tire pas, ne produit pas, ne recherche pas et ne fournit pas d’énergie.">Hors creep : à l'arrêt</div>`;
  if (e.def.kind !== 'resource') html += stats(h, e);
  setDetails(h, html);
  h.portrait.render();
}

/** How far a mythology's ultimate has charged, in percent. */
export function ultimatePct(h: Hud, m: Mythology): number {
  return Math.floor((100 * (h.world.players[h.player].ultimates?.[m] ?? 0)) / ticks(BALANCE.units.primordial.charge));
}

/**
 * Fighting stats of the selected unit or building, for anyone looking (spectators too): attack and armour with
 * their research bonus, range, rate of fire, speed and sight.
 */
function stats(h: Hud, e: Entity): string {
  const fmt = (v: number) => (Math.round(v * 10) / 10).toLocaleString('fr-FR');
  const plus = (n: number) => (n > 0 ? ` <em>+${n}</em>` : '');
  const parts: string[] = [];
  const a = h.world.weapon(e);
  if (a) {
    // shortcut: the value against light biologicals (BL) with the attack research on it; the other bonuses (Conseil, auras…) are left out.
    const light = h.world.classValue(e, a, 0);
    const up = e.owner >= 0 ? h.world.researched(e, a, light) : 0;
    parts.push(`<span title="Dégâts par coup contre l'infanterie légère ; selon la cible, la valeur et le bonus de recherche changent">Attaque ${light}${plus(up)}</span>`);
    // With its research (Canons sciés: the balancer, 2026-11-22, wants it shown on the Auxiliaire).
    const reach = e.owner >= 0 ? h.world.rangeBonus(e) : 0;
    parts.push(`<span title="Portée">${a.range < 1 ? 'Mêlée' : `Portée ${fmt(a.range)}${plus(reach)}`}</span>`);
    parts.push(`<span title="Temps entre deux coups">Cadence ${fmt(a.cooldown)} s</span>`);
  }
  if ((e.def as UnitDef).heal) parts.push(`<span>Soin ${(e.def as UnitDef).heal}</span>`);
  if ('armor' in e.def) {
    // The world's own armour research, read rather than copied (its cases are many).
    const bonus = e.owner >= 0 && (e.def.kind === 'unit' || (e.def.kind === 'building' && h.world.players[e.owner].faction === 'z')) ? h.world.armorBonus(e) : 0;
    parts.push(`<span title="Retirée de chaque coup reçu">Armure ${e.def.armor}${plus(bonus)}</span>`);
  }
  if (e.def.kind === 'unit') parts.push(`<span>Vitesse ${fmt((e.def as UnitDef).levels?.speed[e.lvl - 1] ?? (e.def as UnitDef).speed)}</span>`);
  if ('sight' in e.def) parts.push(`<span>Vue ${e.def.sight}</span>`);
  // Isdaris: the extensions built onto this building, its own.
  if (e.exts.length) parts.push(`<span title="Extensions de ce bâtiment">${e.exts.map((x) => DEFS[x].name.replace('Extension : ', '')).join(', ')}</span>`);
  return parts.length ? `<div class="stats">${parts.join('')}</div>` : '';
}

function progress(label: string, f: number): string {
  return `<div class="info">${label}</div><div class="bar"><div style="width:${Math.round(100 * f)}%"></div></div>`;
}

/** Who is inside a carrier or a bunker, a tile each with its health; a click lets one out (hud.ts). The selection
 * panel shows them, and the alternative interface's bubble too. */
export function aboardTiles(h: Hud, e: Entity, aboard: Entity[], out = e.owner === h.player && !h.spectator ? ' (clic : débarquer)' : ''): string {
  return aboard
    .map((u) => {
      // In a Fortin or a Scarabée, a passenger with powers is picked by a click, to use them from inside (notice).
      const pick = (e.def.kind === 'building' || e.type === 'scarabee') && h.world.abilitiesFor(u).length > 0;
      return `<div class="tile" data-unload="${u.id}" data-of="${e.id}"${pick ? ' data-pick="1"' : ''} style="--hp:${u.hp / u.maxHp}" title="${u.def.name}${pick && out ? ' (clic : ses pouvoirs)' : out}">${img(u.type, u.def.name)}</div>`;
    })
    .join('');
}
