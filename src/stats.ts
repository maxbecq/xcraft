/**
 * Anonymous visit counts with GoatCounter (no cookie, nothing personal sent; the country comes from the IP, which
 * GoatCounter does not keep). Uses its pixel endpoint, so no script to load.
 */

/** The GoatCounter site code: `xxx` in `xxx.goatcounter.com`. Empty: nothing is sent. `VITE_GOATCOUNTER` overrides it. */
const SITE_CODE = 'xcraft';
const SITE: string = import.meta.env.VITE_GOATCOUNTER || SITE_CODE;

/**
 * This browser is left out (`skipgc` = 't', the key GoatCounter's own script uses): `?nostats` sets it, `?nostats=0`
 * clears it, `#toggle-goatcounter` flips it. Lets the team play without filling the counts.
 */
export const SKIPPED = ((): boolean => {
  try {
    const flag = new URLSearchParams(location.search).get('nostats');
    const toggle = location.hash === '#toggle-goatcounter';
    const skip = flag !== null ? flag !== '0' : toggle ? localStorage.getItem('skipgc') !== 't' : null;
    if (skip === true) localStorage.setItem('skipgc', 't');
    else if (skip === false) localStorage.removeItem('skipgc');
    return localStorage.getItem('skipgc') === 't';
  } catch {
    return false; // storage blocked: counted, as GoatCounter's script does
  }
})();
/** Production builds checked locally (vite preview) are not visits. */
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

function send(path: string, title: string, event: boolean): void {
  if (!SITE || import.meta.env.DEV || SKIPPED || LOCAL) return;
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
