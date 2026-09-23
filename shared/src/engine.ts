// The contract every game implements. The table's Durable Object hosts an engine; the Monte
// Carlo tests drive its rules directly; the client only imports its types.
//
// Engines are pure. Given a state, an action, an Rng and ctx.now they return the next state and
// what happened, and nothing else: no clock, no Math.random, no storage, no network. `act` and
// `tick` must not mutate the state they are given (clone it first; `structuredClone` is fine for
// table-sized state).
//
// Money: the host owns every seat's stack. An engine moves chips by returning `chips` in a Step
// (stack -= bet, stack += payout) and the host applies them in the same storage transaction as
// the new state, refusing the whole step if any stack would go negative. Engines check
// `ctx.seats[..].stack` themselves before accepting a bet, so a player gets a clean refusal
// instead of the host's safety net.

import type { Cents, BetLimits, BuyInLimits } from './money.ts';
import type { Rng } from './rng.ts';
import type { ErrorCode } from './protocol.ts';

export const GAME_IDS = ['blackjack', 'roulette', 'craps', 'baccarat', 'slots', 'videopoker', 'threecard', 'holdem'] as const;

/** The eight casino games, plus `highcard`: a tiny fixture game used by tests and the dev harness. */
export type GameId = (typeof GAME_IDS)[number] | 'highcard';

export type TableMode = 'solo' | 'multi';

export interface TableConfig {
  game: GameId;
  /** '' when the game has no variants. */
  variant: string;
  mode: TableMode;
  maxSeats: number;
  /** What a player may bring to the table when sitting down (or top up to). */
  buyIn: BuyInLimits;
  /** Limits per bet kind. `default` is always present. */
  limits: Record<string, BetLimits> & { default: BetLimits };
  /** Game-specific settings: paytable choice, blinds, machine id... */
  options: Record<string, unknown>;
}

/** A seated player as the engine sees them. Only players whose chips have landed are here. */
export interface SeatCtx {
  seat: number;
  accountId: number;
  name: string;
  stack: Cents;
  connected: boolean;
  /** Multiplayer betting windows close early once every seated player is ready. */
  ready: boolean;
}

export interface EngineCtx {
  rng: Rng;
  /** Server time in ms. Engines never read the clock themselves. */
  now: number;
  mode: TableMode;
  /** Multiplayer tables run no rounds until the leader presses Start. Solo tables are always started. */
  started: boolean;
  /** Seated players, sorted by seat number. */
  seats: readonly SeatCtx[];
}

/** Move chips between a seat's stack and the layout (stack -= bet; stack += payout). */
export interface ChipMove {
  seat: number;
  bet?: Cents;
  payout?: Cents;
}

/**
 * A finished round for one seat, for the stats on the player's profile: what they risked in it
 * (every bet, including doubles, splits and odds) and what came back to their stack.
 */
export interface RoundResult {
  seat: number;
  wagered: Cents;
  returned: Cents;
}

/**
 * Something for the client to animate. `to` is a seat number when only that player may see it
 * (a hole card, a private hand); omitted or 'all' for everyone at the table.
 */
export interface GameEvent {
  type: string;
  to?: 'all' | number;
  [key: string]: unknown;
}

export interface Step<S> {
  state: S;
  events: GameEvent[];
  chips?: ChipMove[];
  rounds?: RoundResult[];
}

export interface Refusal {
  refuse: ErrorCode;
  msg: string;
}

export function refuse(code: ErrorCode, msg: string): Refusal {
  return { refuse: code, msg };
}

export function isRefusal(x: unknown): x is Refusal {
  return typeof x === 'object' && x !== null && 'refuse' in x;
}

export function seatOf(ctx: EngineCtx, seat: number): SeatCtx | undefined {
  return ctx.seats.find((s) => s.seat === seat);
}

export interface GameEngine<S = unknown, A = unknown, V = unknown> {
  readonly id: GameId;
  /** Bump when the stored state shape changes; the host voids and refunds a round saved by another version. */
  readonly stateVersion: number;
  readonly seats: { min: number; max: number; multiplayer: boolean };

  /** Defaults for a new table of this game. */
  config(variant: string, mode: TableMode): TableConfig;
  create(cfg: TableConfig, ctx: EngineCtx): S;

  /** Untrusted input from a client, to a typed action or null. Shape only; rules are checked in act(). */
  parseAction(raw: unknown): A | null;
  act(state: S, seat: number, action: A, ctx: EngineCtx): Step<S> | Refusal;

  /** Run whatever is due at ctx.now: close betting, auto-stand, auto-fold, deal the next hand. */
  tick(state: S, ctx: EngineCtx): Step<S> | null;
  /** When tick() next needs to run, or null. */
  deadline(state: S): number | null;
  /** Push every pending deadline back by `ms` (the host calls this after a restart so reconnecting players aren't timed out). */
  shiftDeadlines(state: S, ms: number): S;

  /** A seat's chips just landed (buy-in). */
  seatJoined(state: S, seat: number, ctx: EngineCtx): Step<S>;
  /** The seat wants to leave: resolve what it has live (stand, fold, take down what can come down). */
  seatLeaving(state: S, seat: number, ctx: EngineCtx): Step<S>;
  /** Chips this seat still has on the layout. The host cashes a seat out only at 0. */
  liveBets(state: S, seat: number): Cents;

  /** Everything `viewer` may see (null = a spectator who isn't seated). Never the shoe order or anyone else's hidden cards. */
  view(state: S, viewer: number | null): V;
}
