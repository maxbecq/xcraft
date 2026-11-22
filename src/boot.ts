/** The page's first script: a replay opened from a file waits in IndexedDB (too big, often, for the session's
 * storage), read back here before the game's modules run, since they settle the match as they load. */
import { loadOpenedReplay } from './game/replay';

const game = () => import('./main');
if (new URLSearchParams(location.search).get('replay') === 'file') void loadOpenedReplay().then(game);
else void game();
