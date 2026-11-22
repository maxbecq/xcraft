import { BIOMES, type Biome } from '../render/biome';
import { MAPS } from '../maps';
import { connect, NO_DIRECT, readRoom, waitVerdict, type NetStatus } from '../net';
import type { World } from '../sim/world';
import { countMatch } from '../stats';
import { factions, MAP, NET_ROLE, params, PLAYER } from './config';
import { downloadReplay, type Replay } from './replay';

/** After the end, a link cut this long: the other side is taken as gone, and no rematch can be agreed. */
const GONE_AFTER_END_MS = 10_000;

/** A network game's link to the other side, and what it says on screen: waiting, cuts, forfeits, the rematch. */
export class NetGame {
  // Network game: a banner while waiting for the other player, or once the link is lost.
  readonly banner = document.createElement('div');
  /** The measures' buttons for the end banner (« Enregistrer à nouveau »), kept up to date by main. */
  endButtons = '';
  readonly link: ReturnType<typeof connect> | null;
  readonly net: ReturnType<typeof connect>['lock'] | null;
  /** The other side has been here: the match runs (before, nobody's clock starts). */
  netStarted = false;
  /** The match ended for the network: a forfeit, or the two games no longer alike. Nothing more is simulated. */
  netOver = false;
  /** Since when the link has been cut, and since when the game has been waiting for the other side's orders (0: not). */
  cutSince = 0;
  stalledSince = 0;
  rematchAsked = false;
  /** The other side gone after the end: no rematch. */
  private gone = false;
  /** The network game's own clock (it steps the match in a background tab and watches the other side), stopped at the end. */
  stopNetClock: (() => void) | undefined;
  private warned = '';

  constructor(private readonly world: World, private readonly record: Replay, private readonly biome: Biome, private readonly keepGame: () => void) {
    this.banner.className = 'net-banner';
    this.banner.hidden = true;
    document.body.append(this.banner);
    /** The room, as a code reads (an address typed or cut short may hold anything); none if it is not one. */
    const ROOM = readRoom(params.get('room') ?? '');
    /** A map or planet this build does not have would be swapped for the default one, on this side only: the two games would differ. */
    const UNKNOWN = !!NET_ROLE && (!Object.hasOwn(MAPS, params.get('map') ?? '') || !Object.hasOwn(BIOMES, params.get('biome') ?? ''));
    const NO_ROOM = !!NET_ROLE && !ROOM;
    this.link = NET_ROLE && ROOM && !UNKNOWN ? connect(PLAYER, ROOM, (status, detail) => this.showNet(status, detail)) : null;
    this.net = this.link?.lock ?? null;
    this.banner.addEventListener('click', (e) => {
      const n = (e.target as HTMLElement).closest<HTMLElement>('[data-n]')?.dataset.n;
      if (n === 'replay') downloadReplay(this.record);
      else if (n === 'retry') {
        this.link?.leave();
        location.reload();
      }
      else if (n === 'quit') {
        this.link?.leave();
        location.search = `?biome=${this.biome.id}&map=${MAP.id}`;
      }
    });
    if (NO_ROOM) this.showNet('error', "Ce lien ne contient pas de code de partie valide (quatre caractères, comme K7QX) : demandez à votre ami de vous le renvoyer.");
    else if (UNKNOWN) this.showNet('error', 'Carte ou planète inconnue de cette version du jeu : rechargez la page (tous les deux).');
    else if (this.net) this.showNet(PLAYER === 0 ? 'waiting' : 'connecting');
    // Leaving the page tells the other side at once, rather than after the silence timeout.
    window.addEventListener('pagehide', () => this.link?.leave());
  }

  showNet(status: NetStatus, detail?: string): void {
    if (this.netOver) return;
    if (status === 'connected') {
      if (!this.netStarted) countMatch('en-ligne', MAP.id, factions[PLAYER]);
      this.netStarted = true;
      this.cutSince = this.stalledSince = 0;
      this.banner.hidden = true;
      return;
    }
    if (status === 'reconnecting') {
      this.cutSince = performance.now();
      return; // watchNet tells, once the cut lasts
    }
    if (status === 'again' || status === 'go' || (status === 'left' && this.world.winner !== null)) return this.rematch(status, detail);
    if (status === 'left') return this.endNet('Victoire par abandon', detail ?? "L'adversaire a quitté la partie.");
    this.banner.hidden = false;
    // The network in the way: a fresh try may go through (another network, the friend's page reloaded).
    const retry = detail === NO_DIRECT ? '<button data-n="retry">Réessayer</button>' : '';
    if (status === 'waiting') this.banner.innerHTML = `<h2>En attente de votre adversaire…</h2>${detail ? `<p>${detail}</p>` : ''}${retry}<button data-n="quit">Annuler</button>`;
    else if (status === 'connecting') this.banner.innerHTML = `<h2>Connexion à la partie…</h2>${detail ? `<p>${detail}</p>` : ''}${retry}<button data-n="quit">Annuler</button>`;
    else this.banner.innerHTML = `<h2>Connexion impossible</h2>${detail ? `<p>${detail}</p>` : ''}<button data-n="quit">Menu principal</button>`;
  }

  /** After the end: the other side wants a rematch, both do (`room`: where), or it left and there will be none. */
  private rematch(status: NetStatus, room?: string): void {
    const button = document.querySelector<HTMLButtonElement>('.hud-banner [data-p="restart"]');
    if (status === 'go') {
      // The host goes once the guest said it was on its way; the guest a moment after saying so, so that it gets there.
      setTimeout(() => (location.search = `?net=${NET_ROLE}&room=${room}&camp=${factions[0]}&adversaire=${factions[1]}&biome=${this.biome.id}&map=${MAP.id}`), PLAYER === 0 ? 0 : 300);
    } else if (button && status === 'again') button.textContent = this.rematchAsked ? 'Revanche…' : 'Revanche (votre adversaire est prêt)';
    else if (button) {
      button.disabled = true;
      button.textContent = 'Adversaire parti';
    }
  }

  /** The match is over for the network: said, kept as a replay, and the other side told. */
  endNet(title: string, detail: string): void {
    if (this.netOver) return;
    this.netOver = true;
    this.stopNetClock?.();
    this.link?.leave();
    this.keepGame();
    this.banner.hidden = false;
    this.banner.innerHTML = `<h2>${title}</h2><p>${detail}</p><button data-n="quit">Menu principal</button><button data-n="replay">Enregistrer le replay</button>${this.endButtons}`;
  }

  /**
   * Long waits for the other side, said with the time left. While its match is still loading (none of its orders
   * yet), it is only waited for. A link cut for good ends the match with no winner (each side would otherwise claim
   * it); a side still linked but sending no orders loses by forfeit. A few times a second, even in a background tab.
   */
  watchNet(): void {
    if (!this.netStarted || this.netOver || !this.net) return;
    if (this.world.winner !== null) {
      // A side that closed its page without a word (a crash, a lost network) is only seen as a cut that lasts.
      if (this.cutSince && !this.gone && performance.now() - this.cutSince > GONE_AFTER_END_MS) {
        this.gone = true;
        this.link?.lost();
        this.rematch('left');
      }
      return;
    }
    const say = (text: string) => {
      if (text === this.warned) return;
      this.warned = text;
      this.banner.hidden = false;
      this.banner.innerHTML = text;
    };
    const v = waitVerdict(this.net.started, this.cutSince, this.stalledSince, performance.now());
    if (v.say === 'loading') return say('<h2>En attente de votre ami…</h2><p>Sa partie se charge.</p><button data-n="quit">Annuler</button>');
    if (v.say === 'nothing') {
      if (this.warned) this.banner.hidden = true;
      this.warned = '';
      return;
    }
    const left = v.left;
    if (v.say === 'cut-over') return this.endNet('Partie interrompue', 'La connexion avec votre adversaire n\'a pas pu être rétablie. Aucun vainqueur ; le replay est enregistré.');
    if (v.say === 'forfeit') return this.endNet('Victoire par abandon', "L'adversaire ne répond plus.");
    say(`<h2>L'adversaire ne répond plus</h2><p>${this.cutSince ? 'Connexion coupée, reconnexion…' : 'En attente de ses ordres…'}</p><p>${this.cutSince ? 'Partie interrompue' : 'Victoire par abandon'} dans ${left} s.</p><button data-n="quit">Quitter la partie</button>`);
  }
}
