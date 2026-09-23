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
  highcard,
};

export function engineFor(id: GameId): AnyEngine {
  return ENGINES[id];
}
