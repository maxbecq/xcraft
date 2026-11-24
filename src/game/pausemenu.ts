import type { SandboxTool, World } from '../sim/world';
import { PLAYER, SANDBOX, SOLO, TOUCH } from './config';
import { fmt, SANDBOX_TOOLS, SCROLL, SCROLL_RANGE } from './settings';

/** The tool buttons over the map: menu, whole army, back to the main base. */
export const TOOLS_HTML = '<button class="tool" data-t="menu" title="Menu"><svg class="burger" viewBox="0 0 20 16" aria-hidden="true"><path d="M2 2h16M2 8h16M2 14h16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg><span> Menu</span></button><button class="tool" data-t="army" title="Toute l\'armée"><svg class="swords" viewBox="0 0 20 20" aria-hidden="true"><g stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"><path d="M3 3l11 11M17 3L6 14"/><path d="M11.5 16.5l5-5M3.5 11.5l5 5" stroke-width="2"/><path d="M15.5 15.5l2 2M4.5 15.5l-2 2"/></g></svg><span> Armée</span></button><button class="tool" data-t="home" title="Retour à la base principale"><svg class="keep" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 18V8h3V5h2v3h4V5h2v3h3v10zM8.5 18v-4a1.5 1.5 0 0 1 3 0v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg><span> Base</span></button>';

/** The pause menu, with its controls' help. */
export const PAUSE_HTML = `<div class="pause-box">
<h2>Pause</h2>
<button data-p="resume">Reprendre</button>
<button data-p="help">Contrôles</button>
<button data-p="options">Options</button>
<div class="pause-options" hidden></div>
<button data-p="fullscreen" hidden>Plein écran</button>
<button data-p="restart">Recommencer</button>
<button data-p="replay">Enregistrer le replay</button>
<button data-p="perfrec" hidden>Enregistrer les mesures de performance</button>
<button data-p="quit">Quitter la partie</button>
<div class="help" hidden><h3>Contrôles</h3>
Clic gauche / rectangle : sélectionner (<kbd>Maj</kbd> pour ajouter) · double-clic ou <kbd>Ctrl</kbd>+clic : tout ce type à l'écran<br>
Clic droit : déplacer, récolter, attaquer, point de ralliement<br>
<kbd>A</kbd> puis clic : attaquer / attaque-déplacement<br>
<kbd>S</kbd> stop · <kbd>H</kbd> maintenir la position · <kbd>P</kbd> puis clic : patrouille · <kbd>Y</kbd> puis clic : point de ralliement (bâtiment) · <kbd>B</kbd> construire (serf) · <kbd>Échap</kbd> annuler<br>
<kbd>Ctrl</kbd> ou <kbd>Alt</kbd> (<kbd>⌥</kbd> sur Mac)+<kbd>1</kbd>…<kbd>9</kbd> : créer ou remplacer le groupe, <kbd>Maj</kbd>+<kbd>1</kbd>…<kbd>9</kbd> : ajouter au groupe, <kbd>1</kbd>…<kbd>9</kbd> ou son icône en haut : rappel (×2 : centrer)<br>
Icône d'ouvrier en haut : ouvriers inactifs (clic : les sélectionner)<br>
Flèches, bords d'écran, minimap, clic molette glissé (ou clic droit glissé sans unité sélectionnée), deux doigts (trackpad) : caméra · molette, pincer : zoom vers le curseur, jusqu'à la carte entière<br>
<kbd>Tab</kbd> : type actif d'une sélection mixte (ses capacités) · <kbd>Maj</kbd> maintenu : voir les ordres en file<br>
<kbd>Espace</kbd>, <kbd>Entrée</kbd> ou clic sur l'alerte : aller à la dernière attaque · <kbd>Espace</kbd> maintenu en bougeant la souris : faire glisser la carte · <kbd>Alt</kbd> maintenu : toutes les barres de vie<br>
<kbd>Ctrl</kbd>+<kbd>F5</kbd>…<kbd>F8</kbd> : mémoriser la vue, <kbd>F5</kbd>…<kbd>F8</kbd> : y revenir · <kbd>²</kbd> : grande carte<br>
<kbd>F3</kbd> : panneau de production (toutes les files) · <kbd>F2</kbd> ou ⚔ : toute l'armée · icône de donjon : retour à la base principale · <kbd>F1</kbd>, <kbd>F10</kbd> ou ≡ : menu et pause
<h3>Écran tactile</h3>
Tap : sélectionner, puis tap ailleurs pour donner l'ordre<br>
Double tap : toutes les unités de ce type à l'écran<br>
Glisser : déplacer la vue · pincer : zoomer<br>
Appui long puis glisser : rectangle de sélection</div></div>`;

/** The control settings' fields (mouse and keyboard; none on a touch screen), in the title's options and the pause
 * menu; the game's speed only in a match alone against the AI. Sliders show their value. */
/** The Machines' own console skin, offered while playing them (on phones too, unlike the mouse and key settings). */
export function skinField(faction: string): string {
  if (faction !== 'z') return '';
  return `<fieldset class="options"><legend>Console</legend>
      <label><input type="checkbox" data-k="lcd"${SCROLL.lcd ? ' checked' : ''}> Console LCD : trois écrans flottants, construction en arbre</label>
    </fieldset>`;
}

export function controlFields(inMatch: boolean): string {
  const range = (k: keyof typeof SCROLL_RANGE, label: string, step: number, unit = '') =>
    `<label>${label} <input type="range" data-k="${k}" data-unit="${unit}" min="${SCROLL_RANGE[k][0]}" max="${SCROLL_RANGE[k][1]}" step="${step}" value="${SCROLL[k]}"><output>${fmt(Number(SCROLL[k]), unit)}</output></label>`;
  const check = (k: 'lock' | 'grid' | 'mute' | 'rattack', label: string, attr = '') => `<label${attr}><input type="checkbox" data-k="${k}"${SCROLL[k] ? ' checked' : ''}> ${label}</label>`;
  const sound = `<fieldset class="options"><legend>Son</legend>${range('volume', 'Volume', 0.05, '%')}${check('mute', 'Couper le son')}</fieldset>`;
  // A touch screen: the sound and the trial touch controls only (off by default, the usual ones untouched then).
  if (TOUCH) return `${sound}<fieldset class="options"><legend>Commandes tactiles</legend>
      <label><input type="checkbox" data-k="tactile"${SCROLL.tactile ? ' checked' : ''}> Essai : menu en étoile à l'appui long sur une unité ou un bâtiment, actions rapides en bas</label>
      <label><input type="checkbox" data-k="tuck"${SCROLL.tuck ? ' checked' : ''}> Replier les panneaux : la fiche et les commandes glissent vers le bas après quelques secondes, la languette ▲ les rappelle</label>
    </fieldset>`;
  return `${sound}<fieldset class="options"><legend>Défilement par les bords</legend>
      ${range('speed', 'Vitesse', 0.1, '×')}
      ${range('band', 'Largeur des bords', 0.1, '×')}
      ${range('ramp', 'Accélération', 0.1, '×')}
      ${range('coast', 'Inertie', 0.05, ' s')}
    </fieldset>
    <fieldset class="options"><legend>Souris</legend>
      ${check('lock', 'Garder la souris dans la fenêtre (hors plein écran)')}
      ${range('mouse', 'Vitesse du curseur gardé', 0.05, '×')}
    </fieldset>
    <fieldset class="options"><legend>Interface</legend>
      <label><span class="switch"><input type="checkbox" data-k="alt"${SCROLL.alt ? ' checked' : ''}><span></span></span> Gameplay expérimental : sans console, commandes au-dessus du bâtiment, files de production à gauche</label>
      ${check('grid', `Raccourcis en grille : la place du bouton (${navigator.language?.startsWith('fr') ? 'A Z E R / Q S D F / W X C V' : 'Q W E R / A S D F / Z X C V'}) plutôt que la lettre de son nom`, ` data-classic${SCROLL.alt ? ' hidden' : ''}`)}
      ${check('rattack', 'Clic droit = attaque : les unités de combat (pas les ouvriers) attaquent en chemin, ou attaquent l’unité visée')}
    </fieldset>
    ${inMatch && SOLO ? `<fieldset class="options"><legend>Partie contre l'IA</legend>${range('game', 'Vitesse du jeu', 0.25, '×')}</fieldset>` : ''}`;
}
/** Bac à sable: its options in the pause menu, as they stand now (shown on touch screens too). */
export function sandboxFields(world: World): string {
  if (!SANDBOX) return '';
  const p = world.players[PLAYER];
  return `<fieldset class="options"><legend>Bac à sable</legend>${Object.entries(SANDBOX_TOOLS)
    .map(([k, label]) => `<label><input type="checkbox" data-sandbox="${k}"${p[k as SandboxTool] ? ' checked' : ''}> ${label}</label>`)
    .join('')}</fieldset>`;
}
