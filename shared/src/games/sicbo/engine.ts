// Sic Bo: three dice under a glass dome, 52 places to bet, every bet settled from the one roll
// (58 Pa. Code §625a.5: "no more bets", shake, call the dice, light the winners, collect the
// losers, pay the winners).
//
// Single player: put chips down and press Shake; the dice are drawn and every bet settled at
// once, and the client shakes the dome and lands the dice on them. Multiplayer: once the leader
// starts the table a 20 second betting window opens. It closes at its deadline, or as soon as
// everyone connected has pressed Ready with chips on the layout; the dice are drawn only then.
// The results stand while the dome shakes and the dealer pays, and the next window opens.
//
// Ready is an action of this game rather than the table's `ready` flag, because it has to reset
// with every roll and the table host keeps its flag until a client clears it.

import { type Cents, DOLLAR, checkBet, formatMoney } from '../../money.ts';
import type { EngineCtx, GameEngine, Step, Refusal, TableConfig, TableMode, ChipMove, RoundResult, GameEvent, SeatCtx } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { type Spot, spotByKey, rollDice, returnFor } from './rules.ts';
import { type SicBoAction, type SicBoView, type SeatSettle, type RollInfo, type Phase, type SettledBet, parseAction } from './protocol.ts';

export const BETTING_MS = 20_000;
/** "No more bets" to the dice at rest: the dome shakes, then the dice settle. */
export const ROLL_MS = 4_000;
/** Of that, how long the dome shakes before the dice start to settle. */
export const SHAKE_MS = 2_400;
/** Rest to the next window: the call, the lights, the sweep and the payouts. */
export const SETTLE_MS = 7_000;
export const HISTORY_LEN = 20;
/** Guards on state size: separate placements (the undo list) and chips in them, per seat per roll. */
export const MAX_PLACEMENTS = 200;
export const MAX_ENTRIES = 400;

type Entry = [key: string, amount: Cents];

export interface SicBoState {
  cfg: TableConfig;
  phase: Phase;
  round: number;
  deadline: number | null;
  /** seat -> placements in order (undo takes the last one off). */
  placed: Record<number, Entry[][]>;
  ready: number[];
  /** seat -> the bets of the last roll that seat played, and whose they were (for Rebet). */
  last: Record<number, { account: number; bets: Entry[] }>;
  roll: RollInfo | null;
  settled: Record<number, SeatSettle>;
  history: RollInfo['dice'][];
}

const D = DOLLAR;

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'sicbo',
    variant: '',
    mode,
    maxSeats: mode === 'solo' ? 1 : 8,
    // up to a hundred times the table maximum (shared/src/limits.ts scales it with the table)
    buyIn: { min: 20 * D, max: 500_000 * D },
    // Every pay is a whole k to 1, so whole-dollar steps keep every payout exact.
    limits: {
      // the table: smallest chip, and the most one player may have on the layout for a roll
      default: { min: D, max: 10_000 * D, step: D },
      // Small, Big, Odd, Even
      even: { min: 5 * D, max: 5_000 * D, step: D },
      // a single number (pays up to 3 to 1)
      single: { min: D, max: 1_000 * D, step: D },
      // totals, two-dice combinations, doubles, any triple
      prop: { min: D, max: 500 * D, step: D },
      // a specific triple (180 to 1)
      triple: { min: D, max: 100 * D, step: D },
    },
    options: {},
  };
}

/** A seat's chips on the layout, summed per spot. */
export function betsOf(s: SicBoState, seat: number): Map<string, Cents> {
  const out = new Map<string, Cents>();
  for (const p of s.placed[seat] ?? []) for (const [k, a] of p) out.set(k, (out.get(k) ?? 0) + a);
  return out;
}

function seatTotal(s: SicBoState, seat: number): Cents {
  let t = 0;
  for (const p of s.placed[seat] ?? []) for (const [, a] of p) t += a;
  return t;
}

function seatsWithBets(s: SicBoState): number[] {
  return Object.keys(s.placed)
    .map(Number)
    .filter((seat) => seatTotal(s, seat) > 0)
    .sort((a, b) => a - b);
}

function betEvent(s: SicBoState, seat: number): GameEvent {
  return { type: 'bet', seat, bets: Object.fromEntries(betsOf(s, seat)) };
}

function openBetting(s: SicBoState, ctx: EngineCtx, events: GameEvent[]): void {
  s.phase = 'betting';
  s.round++;
  s.placed = {};
  s.ready = [];
  s.settled = {};
  s.deadline = ctx.mode === 'multi' ? ctx.now + BETTING_MS : null;
  events.push({ type: 'betting', round: s.round, deadline: s.deadline });
}

function goIdle(s: SicBoState): Step<SicBoState> {
  s.phase = 'idle';
  s.deadline = null;
  s.placed = {};
  s.ready = [];
  return { state: s, events: [{ type: 'idle' }] };
}

/** Changing your chips takes back a Ready. */
function unready(s: SicBoState, seat: number, events: GameEvent[]): void {
  if (!s.ready.includes(seat)) return;
  s.ready = s.ready.filter((x) => x !== seat);
  events.push({ type: 'ready', seat, on: false });
}

const LIMIT_WORDS: Record<Spot['limit'], string> = {
  even: 'Small, Big, Odd and Even bets',
  single: 'Single-number bets',
  prop: 'Bets there',
  triple: 'Specific triples',
};

/**
 * Check a set of chips against the limits and the seat's stack, and put them down as one
 * placement. All of them go down or none do.
 */
function place(s: SicBoState, me: SeatCtx, adds: Map<string, Cents>, events: GameEvent[], what = 'That bet'): Step<SicBoState> | Refusal {
  const seat = me.seat;
  const current = betsOf(s, seat);
  let added = 0;
  for (const [key, amount] of adds) {
    const spot = spotByKey(key);
    if (!spot) return refuse('BAD_REQUEST', "That isn't a bet on this layout.");
    const lim = s.cfg.limits[spot.limit] ?? s.cfg.limits.default;
    const problem = checkBet((current.get(key) ?? 0) + amount, lim);
    if (problem === 'NOT_CENTS') return refuse('BAD_REQUEST', 'Bets are whole chips.');
    if (problem === 'BELOW_MIN') return refuse('LIMIT', `${LIMIT_WORDS[spot.limit]} start at ${formatMoney(lim.min)}.`);
    if (problem === 'ABOVE_MAX') return refuse('LIMIT', `${LIMIT_WORDS[spot.limit]} are limited to ${formatMoney(lim.max)} a spot.`);
    if (problem === 'OFF_STEP') return refuse('LIMIT', `Bets go in steps of ${formatMoney(lim.step)}.`);
    added += amount;
  }
  const tableMax = s.cfg.limits.default.max;
  if (seatTotal(s, seat) + added > tableMax) return refuse('LIMIT', `The table maximum is ${formatMoney(tableMax)} a roll.`);
  if (added > me.stack) return refuse('NOT_ENOUGH_CHIPS', `${what} is ${formatMoney(added)}, more than your stack.`);
  const list = s.placed[seat] ?? [];
  const entries = list.reduce((n, p) => n + p.length, 0);
  if (list.length >= MAX_PLACEMENTS || entries + adds.size > MAX_ENTRIES) return refuse('LIMIT', 'That is a lot of chips. Clear some before adding more.');
  s.placed[seat] = [...list, [...adds]];
  unready(s, seat, events);
  events.push(betEvent(s, seat));
  return { state: s, events, chips: [{ seat, bet: added }] };
}

/** The dice are drawn here, after betting has closed, and every bet is settled at once. */
function rollRound(s: SicBoState, ctx: EngineCtx): Step<SicBoState> {
  const dice = rollDice(ctx.rng);
  const shakeAt = ctx.now;
  const restAt = ctx.now + ROLL_MS;
  const chips: ChipMove[] = [];
  const rounds: RoundResult[] = [];
  const seats: Record<number, SeatSettle> = {};
  for (const seat of seatsWithBets(s)) {
    const bets = [...betsOf(s, seat)];
    let wagered = 0;
    let returned = 0;
    const list: SettledBet[] = [];
    for (const [key, amount] of bets) {
      const back = returnFor(spotByKey(key)!, dice, amount);
      wagered += amount;
      returned += back;
      list.push([key, amount, back]);
    }
    seats[seat] = { wagered, returned, bets: list };
    s.last[seat] = { account: seatOf(ctx, seat)?.accountId ?? -1, bets };
    if (returned > 0) chips.push({ seat, payout: returned });
    rounds.push({ seat, wagered, returned });
  }
  s.history = [dice, ...s.history].slice(0, HISTORY_LEN);
  s.roll = { round: s.round, dice, shakeAt, restAt };
  s.settled = seats;
  s.placed = {};
  s.ready = [];
  s.phase = 'results';
  s.deadline = ctx.mode === 'multi' ? restAt + SETTLE_MS : null;
  const events: GameEvent[] = [
    { type: 'roll', round: s.round, dice, shakeAt, restAt },
    { type: 'settle', round: s.round, dice, seats },
  ];
  return { state: s, events, chips, rounds };
}

export const engine: GameEngine<SicBoState, SicBoAction, SicBoView> = {
  id: 'sicbo',
  stateVersion: 1,
  seats: { min: 1, max: 8, multiplayer: true },
  config,

  create(cfg, ctx) {
    const solo = ctx.mode === 'solo';
    return {
      cfg,
      phase: solo ? 'betting' : 'idle',
      round: solo ? 1 : 0,
      deadline: null,
      placed: {},
      ready: [],
      last: {},
      roll: null,
      settled: {},
      history: [],
    };
  },

  parseAction,

  act(state, seat, action, ctx): Step<SicBoState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Take a seat first.');
    const s = structuredClone(state);
    const events: GameEvent[] = [];

    if (action.type === 'roll') {
      if (ctx.mode === 'multi') return refuse('WRONG_PHASE', 'The dealer shakes when betting closes.');
      if (s.phase !== 'betting' || seatTotal(s, seat) === 0) return refuse('WRONG_PHASE', 'Place a bet first.');
      return rollRound(s, ctx);
    }

    if (action.type === 'ready') {
      if (ctx.mode !== 'multi') return refuse('BAD_REQUEST', 'Press Shake when you are ready.');
      if (s.phase !== 'betting') return refuse('WRONG_PHASE', 'No more bets.');
      if (action.on === s.ready.includes(seat)) return { state, events: [] };
      s.ready = action.on ? [...s.ready, seat].sort((a, b) => a - b) : s.ready.filter((x) => x !== seat);
      return { state: s, events: [{ type: 'ready', seat, on: action.on }] };
    }

    // Everything else changes chips on the layout, which only happens while betting is open.
    // A single-player table opens the next roll with the first change after a result.
    if (s.phase !== 'betting') {
      if (ctx.mode === 'multi') return refuse('WRONG_PHASE', 'No more bets.');
      openBetting(s, ctx, events);
    }

    if (action.type === 'bet') {
      const adds = new Map<string, Cents>();
      for (const b of action.bets) {
        if (!spotByKey(b.spot)) return refuse('BAD_REQUEST', "That isn't a bet on this layout.");
        adds.set(b.spot, (adds.get(b.spot) ?? 0) + b.amount);
      }
      return place(s, me, adds, events);
    }

    if (action.type === 'rebet') {
      const onLayout = betsOf(s, seat);
      let adds: Map<string, Cents>;
      if (action.double && onLayout.size > 0) {
        adds = onLayout;
      } else {
        const last = s.last[seat];
        if (!last || last.account !== me.accountId || last.bets.length === 0) return refuse('BAD_REQUEST', 'There are no bets to repeat yet.');
        const k = action.double ? 2 : 1;
        adds = new Map(last.bets.map(([key, a]) => [key, a * k]));
      }
      return place(s, me, adds, events, action.double ? 'Doubling' : 'Rebet');
    }

    const list = s.placed[seat] ?? [];
    if (action.type === 'undo') {
      const lastPlacement = list[list.length - 1];
      if (!lastPlacement) return events.length ? { state: s, events } : { state, events: [] };
      s.placed[seat] = list.slice(0, -1);
      const back = lastPlacement.reduce((n, [, a]) => n + a, 0);
      unready(s, seat, events);
      events.push(betEvent(s, seat));
      return { state: s, events, chips: [{ seat, payout: back }] };
    }

    // clear
    const back = seatTotal(s, seat);
    if (back === 0) return events.length ? { state: s, events } : { state, events: [] };
    delete s.placed[seat];
    unready(s, seat, events);
    events.push(betEvent(s, seat));
    return { state: s, events, chips: [{ seat, payout: back }] };
  },

  tick(state, ctx) {
    if (ctx.mode !== 'multi' || !ctx.started) return null;
    if (state.phase === 'idle') {
      if (ctx.seats.length === 0) return null;
      const s = structuredClone(state);
      const events: GameEvent[] = [];
      openBetting(s, ctx, events);
      return { state: s, events };
    }
    if (state.deadline === null) return null;
    if (state.phase === 'betting') {
      const bettors = seatsWithBets(state);
      const allReady = bettors.length > 0 && ctx.seats.every((st) => state.ready.includes(st.seat) || !st.connected);
      if (ctx.now < state.deadline && !allReady) return null;
      const s = structuredClone(state);
      if (bettors.length === 0) {
        // Nobody bet: no roll, just a fresh window (or rest if the table emptied).
        if (ctx.seats.length === 0) return goIdle(s);
        const events: GameEvent[] = [];
        openBetting(s, ctx, events);
        return { state: s, events };
      }
      return rollRound(s, ctx);
    }
    // results have stood long enough
    if (ctx.now < state.deadline) return null;
    const s = structuredClone(state);
    if (ctx.seats.length === 0) return goIdle(s);
    const events: GameEvent[] = [];
    openBetting(s, ctx, events);
    return { state: s, events };
  },

  deadline(state) {
    return state.deadline;
  },

  shiftDeadlines(state, ms) {
    if (state.deadline === null) return state;
    return { ...state, deadline: state.deadline + ms };
  },

  seatJoined(state, seat, ctx) {
    // A new player in this seat doesn't inherit the last player's Rebet.
    const last = state.last[seat];
    const me = seatOf(ctx, seat);
    if (!last || (me && last.account === me.accountId)) return { state, events: [] };
    const s = structuredClone(state);
    delete s.last[seat];
    return { state: s, events: [] };
  },

  seatLeaving(state, seat) {
    // Chips on the layout before "No more bets" come back down; after it they are already settled.
    if (state.phase !== 'betting') return { state, events: [] };
    const back = seatTotal(state, seat);
    const s = structuredClone(state);
    delete s.placed[seat];
    s.ready = s.ready.filter((x) => x !== seat);
    if (back === 0) return { state: s, events: [] };
    return { state: s, events: [betEvent(s, seat)], chips: [{ seat, payout: back }] };
  },

  liveBets(state, seat) {
    return state.phase === 'betting' ? seatTotal(state, seat) : 0;
  },

  view(state) {
    const bets: Record<number, Record<string, Cents>> = {};
    for (const seat of seatsWithBets(state)) bets[seat] = Object.fromEntries(betsOf(state, seat));
    return {
      phase: state.phase,
      round: state.round,
      deadline: state.deadline,
      bets,
      ready: [...state.ready],
      roll: state.roll,
      settled: state.settled,
      history: state.history.map((d) => [...d] as RollInfo['dice']),
      canRebet: Object.keys(state.last).map(Number),
    };
  },
};
