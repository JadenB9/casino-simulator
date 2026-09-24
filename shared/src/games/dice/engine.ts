// Dice on the lounge computers (docs/rules/online-games.md §2). One roll is one action and one
// round: the bet comes off the stack, the roll is drawn, and a win goes back on in the same step.
// The target and side travel with every roll, so the table itself remembers nothing but the last
// few results.

import { type Cents, DOLLAR, checkBet, formatMoney } from '../../money.ts';
import type { GameEngine, GameEvent, Refusal, Step, TableConfig, TableMode } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { isInt, isObj } from '../../protocol.ts';
import { drawRoll, isTarget, winCount, winPayout, wins } from './rules.ts';

export type DiceAction = { type: 'roll'; bet: Cents; target: number; over: boolean };

/** A settled roll. `target` and `roll` are hundredths (50.49 is 5049). */
export interface DiceRoll {
  round: number;
  bet: Cents;
  target: number;
  over: boolean;
  /** Winning rolls out of 10,000. */
  chance: number;
  roll: number;
  win: boolean;
  payout: Cents;
}

export interface RollEvent extends DiceRoll {
  type: 'roll';
  seat: number;
  /** The seat's stack once this roll is paid. */
  stack: Cents;
}

export interface DiceState {
  cfg: TableConfig;
  round: number;
  /** The last rolls, newest first. */
  recent: DiceRoll[];
}

export interface DiceView {
  round: number;
  recent: DiceRoll[];
}

export const RECENT = 16;

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'dice',
    variant: '',
    mode,
    maxSeats: 1,
    // up to a hundred times the table maximum (shared/src/limits.ts scales it with the table)
    buyIn: { min: 10 * DOLLAR, max: 100_000 * DOLLAR },
    limits: { default: { min: DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR } },
    options: {},
  };
}

function parseAction(raw: unknown): DiceAction | null {
  if (!isObj(raw) || raw.type !== 'roll') return null;
  if (!isInt(raw.bet) || !isInt(raw.target) || typeof raw.over !== 'boolean') return null;
  return { type: 'roll', bet: raw.bet, target: raw.target, over: raw.over };
}

export const engine: GameEngine<DiceState, DiceAction, DiceView> = {
  id: 'dice',
  stateVersion: 1,
  seats: { min: 1, max: 1, multiplayer: false },
  config,

  create(cfg) {
    return { cfg, round: 0, recent: [] };
  },

  parseAction,

  act(state, seat, action, ctx): Step<DiceState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Buy in first.');
    if (!isTarget(action.target, action.over)) return refuse('BAD_REQUEST', 'Pick a win chance from 0.01% to 98%.');
    const limits = state.cfg.limits.default;
    if (checkBet(action.bet, limits) || action.bet % DOLLAR !== 0) {
      return refuse('LIMIT', `Bets here are whole dollars, ${formatMoney(limits.min)} to ${formatMoney(limits.max)}.`);
    }
    if (action.bet > me.stack) return refuse('NOT_ENOUGH_CHIPS', 'Not enough chips for that bet.');

    const s = structuredClone(state);
    const chance = winCount(action.target, action.over);
    const roll = drawRoll(ctx.rng);
    const win = wins(roll, action.target, action.over);
    const payout = win ? winPayout(action.bet, chance) : 0;
    s.round++;
    const result: DiceRoll = { round: s.round, bet: action.bet, target: action.target, over: action.over, chance, roll, win, payout };
    s.recent = [result, ...s.recent].slice(0, RECENT);
    const event: RollEvent = { type: 'roll', seat, ...result, stack: me.stack - action.bet + payout };
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
