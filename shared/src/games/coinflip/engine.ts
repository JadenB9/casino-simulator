// Coinflip on the lounge computers (docs/rules/online-games.md §9). Bet with a call, heads or
// tails: the stake comes off the stack and the coin is flipped in the same step. A wrong call
// ends the round; a right one pays 1.98× and leaves the round open, so the player can call again
// (every right call doubles what rides) or cash out. Twenty right calls cash out on their own.
//
// Nothing is hidden: each flip is drawn when it is called, never ahead of time.

import { type Cents, DOLLAR, checkBet, formatMoney } from '../../money.ts';
import type { Rng } from '../../rng.ts';
import type { GameEngine, GameEvent, Refusal, Step, TableConfig, TableMode } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { isAmount, isObj } from '../../protocol.ts';
import { MAX_STREAK, type Side, flip, isSide, streakMult, streakPayout } from './rules.ts';

export type CoinflipAction =
  | { type: 'bet'; amount: Cents; side: Side }
  | { type: 'flip'; side: Side }
  | { type: 'cashout' };

/** One call and how the coin landed. */
export interface CoinFlip {
  call: Side;
  side: Side;
}

/** A finished round, as the recent-results strip and a reconnect see it. */
export interface CoinflipRound {
  round: number;
  bet: Cents;
  /** Right calls in a row. */
  streak: number;
  /** cashout: the player took it; max: twenty right calls paid on their own; bust: a wrong call. */
  outcome: 'cashout' | 'max' | 'bust';
  /** Hundredths the stake was paid at (0 on a bust). */
  mult: number;
  payout: Cents;
}

export interface CoinflipState {
  cfg: TableConfig;
  phase: 'idle' | 'playing' | 'over';
  round: number;
  seat: number | null;
  bet: Cents;
  /** This round's flips, in order. */
  flips: CoinFlip[];
  result: CoinflipRound | null;
  /** Finished rounds, newest first. */
  recent: CoinflipRound[];
}

export interface CoinflipView {
  phase: CoinflipState['phase'];
  round: number;
  bet: Cents;
  flips: CoinFlip[];
  /** Right calls so far this round. */
  streak: number;
  /** What cashing out now pays, in hundredths (the result's once the round is over). */
  mult: number;
  result: CoinflipRound | null;
  recent: CoinflipRound[];
}

export const RECENT = 16;

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'coinflip',
    variant: '',
    mode,
    maxSeats: 1,
    // up to a hundred times the table maximum (shared/src/limits.ts scales it with the table)
    buyIn: { min: 10 * DOLLAR, max: 100_000 * DOLLAR },
    limits: { default: { min: DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR } },
    options: { maxStreak: MAX_STREAK },
  };
}

function parseAction(raw: unknown): CoinflipAction | null {
  if (!isObj(raw)) return null;
  switch (raw.type) {
    case 'bet':
      if (!isAmount(raw.amount) || !isSide(raw.side)) return null;
      return { type: 'bet', amount: raw.amount, side: raw.side };
    case 'flip':
      if (!isSide(raw.side)) return null;
      return { type: 'flip', side: raw.side };
    case 'cashout':
      return { type: 'cashout' };
    default:
      return null;
  }
}

const streakOf = (s: CoinflipState) => s.flips.length - (s.flips.at(-1) && s.flips.at(-1)!.call !== s.flips.at(-1)!.side ? 1 : 0);

/** End the round: pay the streak (nothing on a bust). */
function finish(s: CoinflipState, outcome: CoinflipRound['outcome'], events: GameEvent[], betNow: Cents): Step<CoinflipState> {
  const seat = s.seat!;
  const streak = streakOf(s);
  const mult = outcome === 'bust' ? 0 : streakMult(streak);
  const payout = outcome === 'bust' ? 0 : streakPayout(s.bet, streak);
  const result: CoinflipRound = { round: s.round, bet: s.bet, streak, outcome, mult, payout };
  s.result = result;
  s.phase = 'over';
  s.recent = [result, ...s.recent].slice(0, RECENT);
  events.push({ type: 'over', ...result });
  const move = betNow > 0 ? { seat, bet: betNow, ...(payout > 0 ? { payout } : {}) } : payout > 0 ? { seat, payout } : null;
  return { state: s, events, chips: move ? [move] : [], rounds: [{ seat, wagered: s.bet, returned: payout }] };
}

/** Flip for `call`; a wrong call or the twentieth right one ends the round. */
function play(s: CoinflipState, call: Side, events: GameEvent[], rng: Rng, betNow: Cents): Step<CoinflipState> {
  const side = flip(rng);
  s.flips.push({ call, side });
  const win = call === side;
  const streak = streakOf(s);
  events.push({ type: 'flip', round: s.round, call, side, win, streak, mult: win ? streakMult(streak) : 0 });
  if (!win) return finish(s, 'bust', events, betNow);
  if (streak >= MAX_STREAK) return finish(s, 'max', events, betNow);
  return { state: s, events, chips: betNow > 0 ? [{ seat: s.seat!, bet: betNow }] : [] };
}

export const engine: GameEngine<CoinflipState, CoinflipAction, CoinflipView> = {
  id: 'coinflip',
  stateVersion: 1,
  seats: { min: 1, max: 1, multiplayer: false },
  config,

  create(cfg) {
    return { cfg, phase: 'idle', round: 0, seat: null, bet: 0, flips: [], result: null, recent: [] };
  },

  parseAction,

  act(state, seat, action, ctx): Step<CoinflipState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Take a seat first.');

    if (action.type === 'bet') {
      if (state.phase === 'playing') return refuse('WRONG_PHASE', 'Finish this round first: call again or cash out.');
      const lim = state.cfg.limits.default;
      const problem = checkBet(action.amount, lim);
      if (problem === 'OFF_STEP' || problem === 'NOT_CENTS') return refuse('LIMIT', `Bets are whole ${formatMoney(lim.step)} amounts.`);
      if (problem) return refuse('LIMIT', `Bet ${formatMoney(lim.min)} to ${formatMoney(lim.max)}.`);
      if (action.amount > me.stack) return refuse('NOT_ENOUGH_CHIPS', `You have ${formatMoney(me.stack)} here.`);
      const s = structuredClone(state);
      s.round++;
      s.seat = seat;
      s.bet = action.amount;
      s.flips = [];
      s.result = null;
      s.phase = 'playing';
      return play(s, action.side, [{ type: 'bet', round: s.round, bet: s.bet }], ctx.rng, s.bet);
    }

    if (state.phase !== 'playing') return refuse('WRONG_PHASE', 'Place a bet to start a round.');
    if (state.seat !== seat) return refuse('NOT_YOUR_TURN', 'This round belongs to another player.');
    if (action.type === 'cashout') return finish(structuredClone(state), 'cashout', [], 0);
    return play(structuredClone(state), action.side, [], ctx.rng, 0);
  },

  tick: () => null,
  deadline: () => null,
  shiftDeadlines: (state) => state,
  seatJoined: (state) => ({ state, events: [] }),

  seatLeaving(state, seat) {
    // A round is only ever open after a right call, so standing up cashes it out.
    if (state.phase !== 'playing' || state.seat !== seat) return { state, events: [] };
    return finish(structuredClone(state), 'cashout', [], 0);
  },

  liveBets(state, seat) {
    return state.phase === 'playing' && state.seat === seat ? state.bet : 0;
  },

  view(state) {
    const streak = streakOf(state);
    return {
      phase: state.phase,
      round: state.round,
      bet: state.bet,
      flips: state.flips.map((f) => ({ ...f })),
      streak,
      mult: state.phase === 'playing' ? streakMult(streak) : state.result?.mult ?? 0,
      result: state.result,
      recent: state.recent,
    };
  },
};
