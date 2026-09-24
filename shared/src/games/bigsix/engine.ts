// Big Six: chips on the seven spots, the dealer pulls the wheel, and every bet on the symbol the
// clapper stops on is paid from the fixed table in rules.ts.
//
// Single player: place chips, press Spin; the stop is drawn and every bet settled at once, and
// the client turns the wheel onto it. Multiplayer: once the leader starts the table a 20 second
// betting window opens. "No more bets" closes it, the stop is drawn only then, and the results
// stand while the wheel slows, the losers are swept and the winners paid. The window closes
// early once every connected seated player has pressed Ready (and someone has a bet down).
//
// Ready is an action of this game rather than the table's `ready` flag, because it has to reset
// with every spin and the table host keeps its flag until a client clears it.

import { type Cents, DOLLAR, checkBet, formatMoney } from '../../money.ts';
import type { EngineCtx, GameEngine, Step, Refusal, TableConfig, TableMode, ChipMove, RoundResult, GameEvent, SeatCtx } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { type SymbolId, SYMBOLS, drawStop, symbolAt, returnFor } from './rules.ts';
import { type BigSixAction, type BigSixView, type SeatSettle, type SpinInfo, type Phase, type SettledBet, parseAction } from './protocol.ts';

export const BETTING_MS = 20_000;
/** "No more bets" to the wheel at rest: the pull, the long slow-down against the clapper. */
export const SPIN_MS = 10_500;
/** Rest to the next window: the call, the sweep, the payouts. */
export const SETTLE_MS = 6_500;
export const HISTORY_LEN = 20;
/** Guards on state size: separate placements (the undo list) and chips in them, per seat per spin. */
export const MAX_PLACEMENTS = 200;
export const MAX_ENTRIES = 400;

type Entry = [spot: SymbolId, amount: Cents];

export interface BigSixState {
  cfg: TableConfig;
  phase: Phase;
  round: number;
  deadline: number | null;
  /** seat -> placements in order (undo takes the last one off). */
  placed: Record<number, Entry[][]>;
  ready: number[];
  /** seat -> the bets of the last spin that seat played, and whose they were (for Rebet). */
  last: Record<number, { account: number; bets: Entry[] }>;
  spin: SpinInfo | null;
  settled: Record<number, SeatSettle>;
  history: number[];
}

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'bigsix',
    variant: '',
    mode,
    maxSeats: mode === 'solo' ? 1 : 8,
    // up to a hundred times the table maximum (shared/src/limits.ts scales it with the table)
    buyIn: { min: 10 * DOLLAR, max: 50_000 * DOLLAR },
    limits: {
      // the table: smallest chip, and the most one player may have on the layout for a spin
      default: { min: DOLLAR, max: 2_500 * DOLLAR, step: DOLLAR },
      // each of the seven spots
      spot: { min: DOLLAR, max: 500 * DOLLAR, step: DOLLAR },
    },
    options: {},
  };
}

/** A seat's chips on the layout, summed per spot, in layout order. */
export function betsOf(s: BigSixState, seat: number): Map<SymbolId, Cents> {
  const sums = new Map<SymbolId, Cents>();
  for (const p of s.placed[seat] ?? []) for (const [k, a] of p) sums.set(k, (sums.get(k) ?? 0) + a);
  const out = new Map<SymbolId, Cents>();
  for (const k of SYMBOLS) if (sums.has(k)) out.set(k, sums.get(k)!);
  return out;
}

function seatTotal(s: BigSixState, seat: number): Cents {
  let t = 0;
  for (const p of s.placed[seat] ?? []) for (const [, a] of p) t += a;
  return t;
}

function seatsWithBets(s: BigSixState): number[] {
  return Object.keys(s.placed)
    .map(Number)
    .filter((seat) => seatTotal(s, seat) > 0)
    .sort((a, b) => a - b);
}

function betEvent(s: BigSixState, seat: number): GameEvent {
  return { type: 'bet', seat, bets: Object.fromEntries(betsOf(s, seat)) };
}

function openBetting(s: BigSixState, ctx: EngineCtx, events: GameEvent[]): void {
  s.phase = 'betting';
  s.round++;
  s.placed = {};
  s.ready = [];
  s.settled = {};
  s.deadline = ctx.mode === 'multi' ? ctx.now + BETTING_MS : null;
  events.push({ type: 'betting', round: s.round, deadline: s.deadline });
}

function goIdle(s: BigSixState): Step<BigSixState> {
  s.phase = 'idle';
  s.deadline = null;
  s.placed = {};
  s.ready = [];
  return { state: s, events: [{ type: 'idle' }] };
}

/** Changing your chips takes back a Ready. */
function unready(s: BigSixState, seat: number, events: GameEvent[]): void {
  if (!s.ready.includes(seat)) return;
  s.ready = s.ready.filter((x) => x !== seat);
  events.push({ type: 'ready', seat, on: false });
}

/**
 * Check a set of chips against the limits and the seat's stack, and put them down as one
 * placement. All of them go down or none do.
 */
function place(s: BigSixState, me: SeatCtx, adds: Map<SymbolId, Cents>, events: GameEvent[], what = 'That bet'): Step<BigSixState> | Refusal {
  const seat = me.seat;
  const current = betsOf(s, seat);
  const lim = s.cfg.limits.spot ?? s.cfg.limits.default;
  let added = 0;
  for (const [key, amount] of adds) {
    const problem = checkBet((current.get(key) ?? 0) + amount, lim);
    if (problem === 'NOT_CENTS') return refuse('BAD_REQUEST', 'Bets are whole chips.');
    if (problem === 'BELOW_MIN') return refuse('LIMIT', `Bets start at ${formatMoney(lim.min)} a spot.`);
    if (problem === 'ABOVE_MAX') return refuse('LIMIT', `Each spot is limited to ${formatMoney(lim.max)}.`);
    if (problem === 'OFF_STEP') return refuse('LIMIT', `Bets go in steps of ${formatMoney(lim.step)}.`);
    added += amount;
  }
  const tableMax = s.cfg.limits.default.max;
  if (seatTotal(s, seat) + added > tableMax) return refuse('LIMIT', `The table maximum is ${formatMoney(tableMax)} a spin.`);
  if (added > me.stack) return refuse('NOT_ENOUGH_CHIPS', `${what} is ${formatMoney(added)}, more than your stack.`);
  const list = s.placed[seat] ?? [];
  const entries = list.reduce((n, p) => n + p.length, 0);
  if (list.length >= MAX_PLACEMENTS || entries + adds.size > MAX_ENTRIES) return refuse('LIMIT', 'That is a lot of chips. Clear some before adding more.');
  s.placed[seat] = [...list, [...adds]];
  unready(s, seat, events);
  events.push(betEvent(s, seat));
  return { state: s, events, chips: [{ seat, bet: added }] };
}

/** The stop is drawn here, after betting has closed, and every bet is settled at once. */
function spinRound(s: BigSixState, ctx: EngineCtx, startAt: number, restAt: number): Step<BigSixState> {
  const stop = drawStop(ctx.rng);
  const symbol = symbolAt(stop);
  const chips: ChipMove[] = [];
  const rounds: RoundResult[] = [];
  const seats: Record<number, SeatSettle> = {};
  for (const seat of seatsWithBets(s)) {
    const bets = [...betsOf(s, seat)];
    let wagered = 0;
    let returned = 0;
    const list: SettledBet[] = [];
    for (const [key, amount] of bets) {
      const back = returnFor(key, stop, amount);
      wagered += amount;
      returned += back;
      list.push([key, amount, back]);
    }
    seats[seat] = { wagered, returned, bets: list };
    const account = seatOf(ctx, seat)?.accountId ?? -1;
    s.last[seat] = { account, bets };
    if (returned > 0) chips.push({ seat, payout: returned });
    rounds.push({ seat, wagered, returned });
  }
  s.history = [stop, ...s.history].slice(0, HISTORY_LEN);
  s.spin = { round: s.round, stop, symbol, startAt, restAt };
  s.settled = seats;
  s.placed = {};
  s.ready = [];
  s.phase = 'results';
  s.deadline = ctx.mode === 'multi' ? restAt + SETTLE_MS : null;
  const events: GameEvent[] = [
    { type: 'spin', round: s.round, stop, symbol, startAt, restAt },
    { type: 'settle', round: s.round, stop, symbol, seats },
  ];
  return { state: s, events, chips, rounds };
}

export const engine: GameEngine<BigSixState, BigSixAction, BigSixView> = {
  id: 'bigsix',
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
      spin: null,
      settled: {},
      history: [],
    };
  },

  parseAction,

  act(state, seat, action, ctx): Step<BigSixState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Take a seat first.');
    const s = structuredClone(state);
    const events: GameEvent[] = [];

    if (action.type === 'spin') {
      if (ctx.mode === 'multi') return refuse('WRONG_PHASE', 'The dealer spins when betting closes.');
      if (s.phase !== 'betting' || seatTotal(s, seat) === 0) return refuse('WRONG_PHASE', 'Place a bet first.');
      return spinRound(s, ctx, ctx.now, ctx.now + SPIN_MS);
    }

    if (action.type === 'ready') {
      if (ctx.mode !== 'multi') return refuse('BAD_REQUEST', 'Press Spin when you are ready.');
      if (s.phase !== 'betting') return refuse('WRONG_PHASE', 'No more bets.');
      if (action.on === s.ready.includes(seat)) return { state, events: [] };
      s.ready = action.on ? [...s.ready, seat].sort((a, b) => a - b) : s.ready.filter((x) => x !== seat);
      return { state: s, events: [{ type: 'ready', seat, on: action.on }] };
    }

    // Everything else changes chips on the layout, which only happens while betting is open.
    // A single-player table opens the next spin with the first change after a result.
    if (s.phase !== 'betting') {
      if (ctx.mode === 'multi') return refuse('WRONG_PHASE', 'No more bets.');
      openBetting(s, ctx, events);
    }

    if (action.type === 'bet') {
      const adds = new Map<SymbolId, Cents>();
      for (const b of action.bets) adds.set(b.spot, (adds.get(b.spot) ?? 0) + b.amount);
      return place(s, me, adds, events);
    }

    if (action.type === 'rebet') {
      const onLayout = betsOf(s, seat);
      let adds: Map<SymbolId, Cents>;
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
        // Nobody bet: no spin, just a fresh window (or rest if the table emptied).
        if (ctx.seats.length === 0) return goIdle(s);
        const events: GameEvent[] = [];
        openBetting(s, ctx, events);
        return { state: s, events };
      }
      return spinRound(s, ctx, ctx.now, ctx.now + SPIN_MS);
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
    const bets: Record<number, Partial<Record<SymbolId, Cents>>> = {};
    for (const seat of seatsWithBets(state)) bets[seat] = Object.fromEntries(betsOf(state, seat));
    return {
      phase: state.phase,
      round: state.round,
      deadline: state.deadline,
      bets,
      ready: [...state.ready],
      spin: state.spin,
      settled: state.settled,
      history: [...state.history],
      canRebet: Object.keys(state.last).map(Number),
    };
  },
};
