// Wheel on the lounge computers (docs/rules/online-games.md §10). One spin is one action and one
// round: the bet comes off the stack, the segment is drawn and its multiplier goes back on, all in
// the step that takes the bet. The page then spins the wheel onto that segment; `restAt` is when
// it comes to rest there, so the casino's big-win feed waits for the page.

import { type Cents, DOLLAR, checkBet, formatMoney } from '../../money.ts';
import type { GameEngine, GameEvent, Refusal, Step, TableConfig, TableMode } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { isInt, isObj } from '../../protocol.ts';
import { type Risk, type Segments, WHEELS, drawSegment, isRisk, isSegments, payoutFor } from './rules.ts';

export type WheelAction = { type: 'spin'; bet: Cents; risk: Risk; segments: Segments };

/** How long the page's wheel turns before it rests on the segment. */
export const SPIN_MS = 3_000;

/** A settled spin, as the results strip and a reconnect see it. */
export interface WheelSpin {
  round: number;
  risk: Risk;
  segments: Segments;
  bet: Cents;
  segment: number;
  /** The segment's multiplier in hundredths. */
  mult: number;
  payout: Cents;
}

export interface WheelEvent extends WheelSpin {
  type: 'spin';
  seat: number;
  /** Server time the wheel comes to rest. */
  restAt: number;
  /** The seat's stack once this spin is paid. */
  stack: Cents;
}

export interface WheelState {
  cfg: TableConfig;
  round: number;
  recent: WheelSpin[];
}

export interface WheelView {
  round: number;
  recent: WheelSpin[];
}

export const RECENT = 16;

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'wheel',
    variant: '',
    mode,
    maxSeats: 1,
    // up to a hundred times the table maximum (shared/src/limits.ts scales it with the table)
    buyIn: { min: 10 * DOLLAR, max: 100_000 * DOLLAR },
    limits: { default: { min: DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR } },
    options: {},
  };
}

function parseAction(raw: unknown): WheelAction | null {
  if (!isObj(raw) || raw.type !== 'spin') return null;
  if (!isInt(raw.bet) || !isRisk(raw.risk) || !isSegments(raw.segments)) return null;
  return { type: 'spin', bet: raw.bet, risk: raw.risk, segments: raw.segments };
}

export const engine: GameEngine<WheelState, WheelAction, WheelView> = {
  id: 'wheel',
  stateVersion: 1,
  seats: { min: 1, max: 1, multiplayer: false },
  config,

  create(cfg) {
    return { cfg, round: 0, recent: [] };
  },

  parseAction,

  act(state, seat, action, ctx): Step<WheelState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Buy in first.');
    const limits = state.cfg.limits.default;
    if (checkBet(action.bet, limits) || action.bet % DOLLAR !== 0) {
      return refuse('LIMIT', `Bets here are whole dollars, ${formatMoney(limits.min)} to ${formatMoney(limits.max)}.`);
    }
    if (action.bet > me.stack) return refuse('NOT_ENOUGH_CHIPS', 'Not enough chips for that bet.');

    const s = structuredClone(state);
    const segment = drawSegment(ctx.rng, action.segments);
    const payout = payoutFor(action.bet, action.risk, action.segments, segment);
    s.round++;
    const spin: WheelSpin = { round: s.round, risk: action.risk, segments: action.segments, bet: action.bet, segment, mult: WHEELS[action.risk][action.segments][segment]!, payout };
    s.recent = [spin, ...s.recent].slice(0, RECENT);
    const event: WheelEvent = { type: 'spin', seat, ...spin, restAt: ctx.now + SPIN_MS, stack: me.stack - action.bet + payout };
    return {
      state: s,
      events: [event as unknown as GameEvent],
      chips: [payout > 0 ? { seat, bet: action.bet, payout } : { seat, bet: action.bet }],
      rounds: [{ seat, wagered: action.bet, returned: payout }],
    };
  },

  // A spin settles in the step that takes its bet: there is never anything to wait for.
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
