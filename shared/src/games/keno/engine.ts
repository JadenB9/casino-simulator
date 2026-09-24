// Keno on the lounge computers (docs/rules/online-games.md §4). One bet is one action and one
// round: the picks and the risk travel with the bet, the ten numbers are drawn, and the pay for the
// hits goes back on the stack in the same step. The page then reveals the ten one by one; it
// already has them all, but they are settled, so nothing hidden is on the wire.

import { type Cents, DOLLAR, checkBet, formatMoney } from '../../money.ts';
import type { GameEngine, GameEvent, Refusal, Step, TableConfig, TableMode } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { isInt, isObj } from '../../protocol.ts';
import { type Risk, countHits, drawNumbers, isPicks, isRisk, multFor, payoutFor } from './rules.ts';

export type KenoAction = { type: 'bet'; bet: Cents; picks: number[]; risk: Risk };

/** A settled game. */
export interface KenoGame {
  round: number;
  bet: Cents;
  risk: Risk;
  picks: number[];
  /** The ten numbers, in the order they were drawn. */
  drawn: number[];
  hits: number;
  /** The multiplier paid, in hundredths. */
  mult: number;
  payout: Cents;
}

export interface KenoEvent extends KenoGame {
  type: 'draw';
  seat: number;
  /** The seat's stack once this game is paid. */
  stack: Cents;
}

export interface KenoState {
  cfg: TableConfig;
  round: number;
  /** The last games, newest first. */
  recent: KenoGame[];
}

export interface KenoView {
  round: number;
  recent: KenoGame[];
}

export const RECENT = 12;

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'keno',
    variant: '',
    mode,
    maxSeats: 1,
    // up to a hundred times the table maximum (shared/src/limits.ts scales it with the table)
    buyIn: { min: 10 * DOLLAR, max: 100_000 * DOLLAR },
    limits: { default: { min: DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR } },
    options: {},
  };
}

function parseAction(raw: unknown): KenoAction | null {
  if (!isObj(raw) || raw.type !== 'bet') return null;
  if (!isInt(raw.bet) || !isPicks(raw.picks) || !isRisk(raw.risk)) return null;
  return { type: 'bet', bet: raw.bet, picks: raw.picks.slice(), risk: raw.risk };
}

export const engine: GameEngine<KenoState, KenoAction, KenoView> = {
  id: 'keno',
  stateVersion: 1,
  seats: { min: 1, max: 1, multiplayer: false },
  config,

  create(cfg) {
    return { cfg, round: 0, recent: [] };
  },

  parseAction,

  act(state, seat, action, ctx): Step<KenoState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Buy in first.');
    const limits = state.cfg.limits.default;
    if (checkBet(action.bet, limits) || action.bet % DOLLAR !== 0) {
      return refuse('LIMIT', `Bets here are whole dollars, ${formatMoney(limits.min)} to ${formatMoney(limits.max)}.`);
    }
    if (action.bet > me.stack) return refuse('NOT_ENOUGH_CHIPS', 'Not enough chips for that bet.');

    const s = structuredClone(state);
    const drawn = drawNumbers(ctx.rng);
    const hits = countHits(action.picks, drawn);
    const picks = action.picks.length;
    const payout = payoutFor(action.bet, action.risk, picks, hits);
    s.round++;
    const game: KenoGame = { round: s.round, bet: action.bet, risk: action.risk, picks: action.picks, drawn, hits, mult: multFor(action.risk, picks, hits), payout };
    s.recent = [game, ...s.recent].slice(0, RECENT);
    const event: KenoEvent = { type: 'draw', seat, ...game, stack: me.stack - action.bet + payout };
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
