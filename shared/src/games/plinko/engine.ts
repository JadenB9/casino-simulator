// Plinko on the lounge computers (docs/rules/online-games.md §1). One drop is one action and one
// round: the bet comes off the stack, the path is drawn, and the bin's multiplier goes back on, all
// in the step that takes the bet. The client then plays the ball down the path it was sent, so
// several balls can be falling at once while every one of them is already settled. Nothing is ever
// live between drops, which makes leaving always clean.

import { type Cents, DOLLAR, checkBet, formatMoney } from '../../money.ts';
import type { GameEngine, GameEvent, Refusal, Step, TableConfig, TableMode } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { isInt, isObj } from '../../protocol.ts';
import { type Risk, type Rows, MULTS, binOf, drawBits, isRisk, isRows, pathOf, payoutFor } from './rules.ts';

export type PlinkoAction = { type: 'drop'; bet: Cents; rows: Rows; risk: Risk };

/** A settled drop, as the recent-results column and a reconnect see it. */
export interface PlinkoDrop {
  round: number;
  rows: Rows;
  risk: Risk;
  bet: Cents;
  bin: number;
  /** The bin's multiplier in hundredths (1000x is 100000). */
  mult: number;
  payout: Cents;
}

/** The drop event: the settled drop plus the path to animate and the stack after it. */
export interface DropEvent extends PlinkoDrop {
  type: 'drop';
  seat: number;
  /** One entry per row, 0 = left, 1 = right. */
  path: number[];
  /** The seat's stack once this drop is paid. */
  stack: Cents;
}

export interface PlinkoState {
  cfg: TableConfig;
  round: number;
  /** The last drops, newest first. */
  recent: PlinkoDrop[];
}

export interface PlinkoView {
  round: number;
  recent: PlinkoDrop[];
}

/** How many settled drops the state keeps for the results column and the bets list. */
export const RECENT = 16;

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'plinko',
    variant: '',
    mode,
    maxSeats: 1,
    // up to a hundred times the table maximum (shared/src/limits.ts scales it with the table)
    buyIn: { min: 10 * DOLLAR, max: 100_000 * DOLLAR },
    limits: { default: { min: DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR } },
    options: {},
  };
}

function parseAction(raw: unknown): PlinkoAction | null {
  if (!isObj(raw) || raw.type !== 'drop') return null;
  if (!isInt(raw.bet) || !isRows(raw.rows) || !isRisk(raw.risk)) return null;
  return { type: 'drop', bet: raw.bet, rows: raw.rows, risk: raw.risk };
}

export const engine: GameEngine<PlinkoState, PlinkoAction, PlinkoView> = {
  id: 'plinko',
  stateVersion: 1,
  seats: { min: 1, max: 1, multiplayer: false },
  config,

  create(cfg) {
    return { cfg, round: 0, recent: [] };
  },

  parseAction,

  act(state, seat, action, ctx): Step<PlinkoState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Buy in first.');
    const limits = state.cfg.limits.default;
    const problem = checkBet(action.bet, limits);
    if (problem || action.bet % DOLLAR !== 0) return refuse('LIMIT', `Bets here are whole dollars, ${formatMoney(limits.min)} to ${formatMoney(limits.max)}.`);
    if (action.bet > me.stack) return refuse('NOT_ENOUGH_CHIPS', 'Not enough chips for that bet.');

    const s = structuredClone(state);
    const bits = drawBits(ctx.rng, action.rows);
    const bin = binOf(bits);
    const payout = payoutFor(action.bet, action.rows, action.risk, bin);
    s.round++;
    const drop: PlinkoDrop = { round: s.round, rows: action.rows, risk: action.risk, bet: action.bet, bin, mult: MULTS[action.rows][action.risk][bin]!, payout };
    s.recent = [drop, ...s.recent].slice(0, RECENT);
    const event: DropEvent = { type: 'drop', seat, ...drop, path: pathOf(bits, action.rows), stack: me.stack - action.bet + payout };
    return {
      state: s,
      events: [event as unknown as GameEvent],
      chips: [payout > 0 ? { seat, bet: action.bet, payout } : { seat, bet: action.bet }],
      rounds: [{ seat, wagered: action.bet, returned: payout }],
    };
  },

  // A drop settles in the step that takes its bet: there is never anything to wait for.
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
