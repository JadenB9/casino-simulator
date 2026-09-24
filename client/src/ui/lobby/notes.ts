// The line under "Single player" in the station panel: how a table of your own runs, in the
// player's words. Every multiplayer game has its own, since "deal" means nothing at a wheel.

import type { GameId } from '../../../../shared/src/engine.ts';

const SOLO_NOTE: Partial<Record<GameId, string>> = {
  blackjack: 'You and the dealer. Deal when you are ready.',
  baccarat: 'You and the dealer. Deal when you are ready.',
  threecard: 'You and the dealer. Deal when you are ready.',
  war: 'You and the dealer. Deal when you are ready.',
  roulette: 'You and the croupier. Spin when you are ready.',
  craps: 'You and the stickman. Roll when you are ready.',
  holdem: 'You against bots, each one marked as a bot.',
  bigsix: 'You and the dealer. Spin when you are ready.',
  sicbo: 'You and the dealer. Shake when you are ready.',
  banditwheel: 'You and the wheel. Spin when you are ready, or it spins when the clock runs out.',
  crash: 'Rounds of your own, one after another: bet in the window, cash out before it crashes.',
};

export function soloNote(game: GameId): string {
  return SOLO_NOTE[game] ?? 'You and the dealer. Deal when you are ready.';
}
