/**
 * Anonymous visit counts with GoatCounter (no cookie, nothing personal sent; the country comes from the IP, which
 * GoatCounter does not keep). Uses its pixel endpoint, so no script to load.
 */

/** The GoatCounter site code: `xxx` in `xxx.goatcounter.com`. Empty: nothing is sent. `VITE_GOATCOUNTER` overrides it. */
const SITE_CODE = '';
const SITE: string = import.meta.env.VITE_GOATCOUNTER || SITE_CODE;

function send(path: string, title: string, event: boolean): void {
  if (!SITE || import.meta.env.DEV) return;
  const q = new URLSearchParams({ p: path, t: title, s: `${screen.width},${screen.height}`, rnd: Math.random().toString(36).slice(2) });
  if (event) q.set('e', 'true');
  else if (document.referrer && !document.referrer.startsWith(location.origin)) q.set('r', document.referrer);
  new Image().src = `https://${SITE}.goatcounter.com/count?${q}`;
}

/** The title screen, counted as a page view. */
export function countTitle(): void {
  send(location.pathname, document.title, false);
}

/** A match that really starts: `partie/<mode>/<carte>/<faction>`. */
export function countMatch(mode: 'ia' | 'en-ligne' | 'spectateur' | 'replay', map: string, faction: string): void {
  send(`partie/${mode}/${map}/${faction}`, 'Partie', true);
}
