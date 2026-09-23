// Placeholder engine for a game that hasn't been built yet: it opens but refuses every action.
// Each game's own engine.ts replaces it.

import { DOLLAR } from '../money.ts';
import type { GameEngine, GameId, TableMode } from '../engine.ts';
import { refuse } from '../engine.ts';
import { CATALOG } from './catalog.ts';

export function stubEngine(id: GameId): GameEngine<{ stub: true }, never, { stub: true }> {
  const info = CATALOG[id];
  return {
    id,
    stateVersion: 0,
    seats: { min: info.seats.min, max: info.seats.max, multiplayer: info.multiplayer },
    config(variant: string, mode: TableMode) {
      return {
        game: id,
        variant,
        mode,
        maxSeats: mode === 'solo' ? 1 : info.seats.max,
        buyIn: { min: 10 * DOLLAR, max: 10_000 * DOLLAR },
        limits: { default: { min: DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR } },
        options: {},
      };
    },
    create: () => ({ stub: true }),
    parseAction: () => null,
    act: () => refuse('BAD_REQUEST', `${info.name} isn't open yet.`),
    tick: () => null,
    deadline: () => null,
    shiftDeadlines: (s) => s,
    seatJoined: (s) => ({ state: s, events: [] }),
    seatLeaving: (s) => ({ state: s, events: [] }),
    liveBets: () => 0,
    view: () => ({ stub: true }),
  };
}
