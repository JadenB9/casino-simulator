// Diamonds on the lounge computers (docs/rules/online-games.md §12). One bet is one action and one
// round: the stake comes off the stack, five gems are drawn and the hand's pay goes back on, all in
// the step that takes the bet. The page then sets the gems down one by one.

import { type Cents, DOLLAR, checkBet, formatMoney } from '../../money.ts';
import type { GameEngine, GameEvent, Refusal, Step, TableConfig, TableMode } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { isInt, isObj } from '../../protocol.ts';
import { type Pattern, PAYS, drawGems, patternOf, payoutFor } from './rules.ts';

export type DiamondsAction = { type: 'bet'; bet: Cents };

/** A settled hand, as the results strip and a reconnect see it. */
export interface DiamondsHand {
  round: number;
  bet: Cents;
  /** Five colours, 0-6, in the order they were set down. */
  gems: number[];
  pattern: Pattern;
  /** The pattern's pay in hundredths. */
  mult: number;
  payout: Cents;
}

export interface DiamondsEvent extends DiamondsHand {
  type: 'draw';
  seat: number;
  /** The seat's stack once this hand is paid. */
  stack: Cents;
}

export interface DiamondsState {
  cfg: TableConfig;
  round: number;
  recent: DiamondsHand[];
}

export interface DiamondsView {
  round: number;
  recent: DiamondsHand[];
}

export const RECENT = 16;

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'diamonds',
    variant: '',
    mode,
    maxSeats: 1,
    // up to a hundred times the table maximum (shared/src/limits.ts scales it with the table)
    buyIn: { min: 10 * DOLLAR, max: 100_000 * DOLLAR },
    limits: { default: { min: DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR } },
    options: {},
  };
}

function parseAction(raw: unknown): DiamondsAction | null {
  if (!isObj(raw) || raw.type !== 'bet' || !isInt(raw.bet)) return null;
  return { type: 'bet', bet: raw.bet };
}

export const engine: GameEngine<DiamondsState, DiamondsAction, DiamondsView> = {
  id: 'diamonds',
  stateVersion: 1,
  seats: { min: 1, max: 1, multiplayer: false },
  config,

  create(cfg) {
    return { cfg, round: 0, recent: [] };
  },

  parseAction,

  act(state, seat, action, ctx): Step<DiamondsState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Buy in first.');
    const limits = state.cfg.limits.default;
    if (checkBet(action.bet, limits) || action.bet % DOLLAR !== 0) {
      return refuse('LIMIT', `Bets here are whole dollars, ${formatMoney(limits.min)} to ${formatMoney(limits.max)}.`);
    }
    if (action.bet > me.stack) return refuse('NOT_ENOUGH_CHIPS', 'Not enough chips for that bet.');

    const s = structuredClone(state);
    const gems = drawGems(ctx.rng);
    const pattern = patternOf(gems);
    const payout = payoutFor(action.bet, pattern);
    s.round++;
    const hand: DiamondsHand = { round: s.round, bet: action.bet, gems, pattern, mult: PAYS[pattern], payout };
    s.recent = [hand, ...s.recent].slice(0, RECENT);
    const event: DiamondsEvent = { type: 'draw', seat, ...hand, gems: [...gems], stack: me.stack - action.bet + payout };
    return {
      state: s,
      events: [event as unknown as GameEvent],
      chips: [payout > 0 ? { seat, bet: action.bet, payout } : { seat, bet: action.bet }],
      rounds: [{ seat, wagered: action.bet, returned: payout }],
    };
  },

  // A hand settles in the step that takes its bet: there is never anything to wait for.
  tick: () => null,
  deadline: () => null,
  shiftDeadlines: (state) => state,
  seatJoined: (state) => ({ state, events: [] }),
  seatLeaving: (state) => ({ state, events: [] }),
  liveBets: () => 0,

  view(state) {
    return { round: state.round, recent: state.recent };
  },
};
