// Every game's client module. Each game folder replaces its own stub.

import type { GameId } from '../../../shared/src/engine.ts';
import type { GameClientModule } from './contract.ts';
import { stubModule } from './stub.ts';
import { highcard } from './highcard/index.ts';
import { blackjack } from './blackjack/index.ts';
import { roulette } from './roulette/index.ts';
import { craps } from './craps/index.ts';
import { baccarat } from './baccarat/index.ts';
import { slots } from './slots/index.ts';
import { videopoker } from './videopoker/index.ts';
import { threecard } from './threecard/index.ts';
import { holdem } from './holdem/index.ts';
import { war } from './war/index.ts';
import { bigsix } from './bigsix/index.ts';
import { sicbo } from './sicbo/index.ts';

export const GAMES: Record<GameId, GameClientModule> = {
  blackjack, roulette, craps, baccarat, slots, videopoker, threecard, holdem, war, bigsix, sicbo, highcard,
};

export { stubModule };
