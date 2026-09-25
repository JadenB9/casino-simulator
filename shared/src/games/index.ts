// Every game's engine, by id. The server hosts them; the tests drive them.

import type { GameEngine, GameId } from '../engine.ts';
import { engine as blackjack } from './blackjack/engine.ts';
import { engine as roulette } from './roulette/engine.ts';
import { engine as craps } from './craps/engine.ts';
import { engine as baccarat } from './baccarat/engine.ts';
import { engine as slots } from './slots/engine.ts';
import { engine as videopoker } from './videopoker/engine.ts';
import { engine as threecard } from './threecard/engine.ts';
import { engine as holdem } from './holdem/engine.ts';
import { engine as war } from './war/engine.ts';
import { engine as bigsix } from './bigsix/engine.ts';
import { engine as sicbo } from './sicbo/engine.ts';
import { engine as plinko } from './plinko/engine.ts';
import { engine as tower } from './tower/engine.ts';
import { engine as mines } from './mines/engine.ts';
import { engine as dice } from './dice/engine.ts';
import { engine as limbo } from './limbo/engine.ts';
import { engine as keno } from './keno/engine.ts';
import { engine as hilo } from './hilo/engine.ts';
import { engine as crash } from './crash/engine.ts';
import { engine as banditwheel } from './banditwheel/engine.ts';
import { engine as coinflip } from './coinflip/engine.ts';
import { engine as wheel } from './wheel/engine.ts';
import { engine as cases } from './cases/engine.ts';
import { engine as diamonds } from './diamonds/engine.ts';
import { engine as letitride } from './letitride/engine.ts';
import { engine as paigow } from './paigow/engine.ts';
import { engine as bingo } from './bingo/engine.ts';
import { engine as pachinko } from './pachinko/engine.ts';
import { engine as highcard } from './highcard/engine.ts';

// Each engine keeps its own state/action/view types; the host only ever handles them opaquely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEngine = GameEngine<any, any, any>;

export const ENGINES: Record<GameId, AnyEngine> = {
  blackjack,
  roulette,
  craps,
  baccarat,
  slots,
  videopoker,
  threecard,
  holdem,
  war,
  bigsix,
  sicbo,
  plinko,
  tower,
  mines,
  dice,
  limbo,
  keno,
  hilo,
  crash,
  banditwheel,
  coinflip,
  wheel,
  cases,
  diamonds,
  letitride,
  paigow,
  bingo,
  pachinko,
  highcard,
};

export function engineFor(id: GameId): AnyEngine {
  return ENGINES[id];
}
