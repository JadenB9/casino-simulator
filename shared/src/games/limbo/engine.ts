// Limbo on the lounge computers (docs/rules/online-games.md §3). One bet is one action and one
// round: the bet comes off the stack, the result is drawn, and a win (the target times the bet)
// goes back on in the same step. The target travels with every bet.

import { type Cents, DOLLAR, checkBet, formatMoney } from '../../money.ts';
import type { GameEngine, GameEvent, Refusal, Step, TableConfig, TableMode } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { isInt, isObj } from '../../protocol.ts';
import { drawResult, isTarget, winPayout, wins } from './rules.ts';

export type LimboAction = { type: 'bet'; bet: Cents; target: number };

/** A settled bet. `target` and `result` are multipliers in hundredths (2.00x is 200). */
export interface LimboBet {
  round: number;
  bet: Cents;
  target: number;
  result: number;
  win: boolean;
  payout: Cents;
}

export interface LimboEvent extends LimboBet {
  type: 'result';
  seat: number;
  /** The seat's stack once this bet is paid. */
  stack: Cents;
}

export interface LimboState {
  cfg: TableConfig;
  round: number;
  /** The last bets, newest first. */
  recent: LimboBet[];
}

export interface LimboView {
  round: number;
  recent: LimboBet[];
}

export const RECENT = 16;

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'limbo',
    variant: '',
    mode,
    maxSeats: 1,
    // up to a hundred times the table maximum (shared/src/limits.ts scales it with the table)
    buyIn: { min: 10 * DOLLAR, max: 100_000 * DOLLAR },
    limits: { default: { min: DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR } },
    options: {},
  };
}

function parseAction(raw: unknown): LimboAction | null {
  if (!isObj(raw) || raw.type !== 'bet') return null;
  if (!isInt(raw.bet) || !isInt(raw.target)) return null;
  return { type: 'bet', bet: raw.bet, target: raw.target };
}

export const engine: GameEngine<LimboState, LimboAction, LimboView> = {
  id: 'limbo',
  stateVersion: 1,
  seats: { min: 1, max: 1, multiplayer: false },
  config,

  create(cfg) {
    return { cfg, round: 0, recent: [] };
  },

  parseAction,

  act(state, seat, action, ctx): Step<LimboState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Buy in first.');
    if (!isTarget(action.target)) return refuse('BAD_REQUEST', 'Pick a target from 1.01x to 1,000,000x.');
    const limits = state.cfg.limits.default;
    if (checkBet(action.bet, limits) || action.bet % DOLLAR !== 0) {
      return refuse('LIMIT', `Bets here are whole dollars, ${formatMoney(limits.min)} to ${formatMoney(limits.max)}.`);
    }
    if (action.bet > me.stack) return refuse('NOT_ENOUGH_CHIPS', 'Not enough chips for that bet.');

    const s = structuredClone(state);
    const result = drawResult(ctx.rng);
    const win = wins(result, action.target);
    const payout = win ? winPayout(action.bet, action.target) : 0;
    s.round++;
    const bet: LimboBet = { round: s.round, bet: action.bet, target: action.target, result, win, payout };
    s.recent = [bet, ...s.recent].slice(0, RECENT);
    const event: LimboEvent = { type: 'result', seat, ...bet, stack: me.stack - action.bet + payout };
    return {
      state: s,
      events: [event as unknown as GameEvent],
      chips: [payout > 0 ? { seat, bet: action.bet, payout } : { seat, bet: action.bet }],
      rounds: [{ seat, wagered: action.bet, returned: payout }],
    };
  },

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
