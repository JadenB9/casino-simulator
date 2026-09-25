// Cases on the lounge computers (docs/rules/online-games.md §11). Opening a case is one action
// and one round: the stake comes off the stack, the item is drawn and its multiplier goes back on,
// all in the step that takes the bet. The page then runs the reel of items past the marker and
// stops it on the one the server drew; `restAt` is when it stops, so the casino's big-win feed
// waits for the page. A quick open runs a short reel.

import { type Cents, DOLLAR, checkBet, formatMoney } from '../../money.ts';
import type { GameEngine, GameEvent, Refusal, Step, TableConfig, TableMode } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { isInt, isObj } from '../../protocol.ts';
import { type CaseId, CASE_INFO, drawItem, isCase, payoutFor } from './rules.ts';

export type CasesAction = { type: 'open'; bet: Cents; case: CaseId; quick: boolean };

/** How long the page's reel runs, and a quick open's. */
export const REEL_MS = 5_600;
export const QUICK_MS = 1_300;

/** An opened case, as the recent-drops strip and a reconnect see it. */
export interface CaseOpen {
  round: number;
  case: CaseId;
  bet: Cents;
  /** Index into the case's items, cheapest first. */
  item: number;
  mult: number;
  payout: Cents;
}

export interface CasesEvent extends CaseOpen {
  type: 'open';
  seat: number;
  quick: boolean;
  /** Server time the reel stops on the item. */
  restAt: number;
  /** The seat's stack once this case is paid. */
  stack: Cents;
}

export interface CasesState {
  cfg: TableConfig;
  round: number;
  recent: CaseOpen[];
}

export interface CasesView {
  round: number;
  recent: CaseOpen[];
}

export const RECENT = 16;

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'cases',
    variant: '',
    mode,
    maxSeats: 1,
    // up to a hundred times the table maximum (shared/src/limits.ts scales it with the table)
    buyIn: { min: 10 * DOLLAR, max: 100_000 * DOLLAR },
    limits: { default: { min: DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR } },
    options: {},
  };
}

function parseAction(raw: unknown): CasesAction | null {
  if (!isObj(raw) || raw.type !== 'open') return null;
  if (!isInt(raw.bet) || !isCase(raw.case)) return null;
  if (raw.quick !== undefined && typeof raw.quick !== 'boolean') return null;
  return { type: 'open', bet: raw.bet, case: raw.case, quick: raw.quick === true };
}

export const engine: GameEngine<CasesState, CasesAction, CasesView> = {
  id: 'cases',
  stateVersion: 1,
  seats: { min: 1, max: 1, multiplayer: false },
  config,

  create(cfg) {
    return { cfg, round: 0, recent: [] };
  },

  parseAction,

  act(state, seat, action, ctx): Step<CasesState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Buy in first.');
    const limits = state.cfg.limits.default;
    if (checkBet(action.bet, limits) || action.bet % DOLLAR !== 0) {
      return refuse('LIMIT', `Cases here cost whole dollars, ${formatMoney(limits.min)} to ${formatMoney(limits.max)}.`);
    }
    if (action.bet > me.stack) return refuse('NOT_ENOUGH_CHIPS', 'Not enough chips for that case.');

    const s = structuredClone(state);
    const index = drawItem(ctx.rng, action.case);
    const payout = payoutFor(action.bet, action.case, index);
    s.round++;
    const open: CaseOpen = { round: s.round, case: action.case, bet: action.bet, item: index, mult: CASE_INFO[action.case].items[index]!.mult, payout };
    s.recent = [open, ...s.recent].slice(0, RECENT);
    const event: CasesEvent = {
      type: 'open',
      seat,
      ...open,
      quick: action.quick,
      restAt: ctx.now + (action.quick ? QUICK_MS : REEL_MS),
      stack: me.stack - action.bet + payout,
    };
    return {
      state: s,
      events: [event as unknown as GameEvent],
      chips: [payout > 0 ? { seat, bet: action.bet, payout } : { seat, bet: action.bet }],
      rounds: [{ seat, wagered: action.bet, returned: payout }],
    };
  },

  // A case settles in the step that takes its bet: there is never anything to wait for.
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
