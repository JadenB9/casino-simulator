// Every game's client module. Each game folder replaces its own stub.
//
// A folder can hand over its view as code to fetch (contract.ts, GameClientDef), which keeps it out
// of the page's first download. Such a view is fetched (lazy.ts) by loadView() as someone sits
// down (the app starts it when E is pressed, so picking limits covers the wait, and waits for it
// before opening the table), and by warmViews() once the casino is open, one at a time in idle
// moments, so it is nearly always here before anyone walks up. A mount that comes first anyway
// gets a stand-in that keeps what the table says, in order, for the real view once it lands.
//
// The stylesheets those views import are imported here as well, each where its view used to
// bring it in, so they stay in the page's one stylesheet in the same order and nothing restyles
// when a view arrives (a sheet of its own would come after every other and win ties it used to lose).

import type { GameId } from '../../../shared/src/engine.ts';
import type { GameClientDef } from './contract.ts';
import { GameViews } from './lazy.ts';
import { toast } from '../ui/kit.ts';
import { stubModule } from './stub.ts';
import { highcard } from './highcard/index.ts';
import { blackjack } from './blackjack/index.ts';
import './multihand/multihand.css';
import './blackjack/blackjack.css';
import { roulette } from './roulette/index.ts';
import { craps } from './craps/index.ts';
import './craps/craps.css';
import { baccarat } from './baccarat/index.ts';
import './baccarat/baccarat.css';
import { slots } from './slots/index.ts';
import { videopoker } from './videopoker/index.ts';
import { threecard } from './threecard/index.ts';
import './threecard/threecard.css';
import { holdem } from './holdem/index.ts';
import './holdem/holdem.css';
import { war } from './war/index.ts';
import './war/war.css';
import { bigsix } from './bigsix/index.ts';
import { sicbo } from './sicbo/index.ts';
import { plinko } from './plinko/index.ts';
import { tower } from './tower/index.ts';
import { mines } from './mines/index.ts';
import { dice } from './dice/index.ts';
import { limbo } from './limbo/index.ts';
import { keno } from './keno/index.ts';
import { hilo } from './hilo/index.ts';
import { crash } from './crash/index.ts';
import { banditwheel } from './banditwheel/index.ts';
import { coinflip } from './coinflip/index.ts';
import { wheel } from './wheel/index.ts';
import { cases } from './cases/index.ts';
import { diamonds } from './diamonds/index.ts';
import { letitride } from './letitride/index.ts';
import './letitride/letitride.css';
import { paigow } from './paigow/index.ts';
import './paigow/paigow.css';
import { bingo } from './bingo/index.ts';
import { pachinko } from './pachinko/index.ts';

const DEFS: Record<GameId, GameClientDef> = {
  blackjack, roulette, craps, baccarat, slots, videopoker, threecard, holdem, war, bigsix, sicbo,
  plinko, tower, mines, dice, limbo, keno, hilo, crash, banditwheel,
  coinflip, wheel, cases, diamonds, letitride, paigow, bingo, pachinko, highcard,
};

const views = new GameViews(DEFS, { failed: () => toast('This table could not load. Reload the page to play here.', 'err', 8000) });

/** Every game's client module, the view included however its folder hands it over. */
export const GAMES = views.modules;

/** Whether a game's view can be mounted right now, with nothing left to fetch. */
export const viewReady = (game: GameId): boolean => views.ready(game);

/** Fetch a game's view unless it is here already (see GameViews.load). */
export const loadView = (game: GameId): Promise<void> => views.load(game);

/** Fetch every view not here yet, one at a time in idle moments: once the casino is open. */
export const warmViews = (): void => views.warm();

export { stubModule };
