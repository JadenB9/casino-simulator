// The Bandit Wheel: chips on the five numbers at your terminal, the wheel spins on a clock, and
// every bet on the number the flapper stops on is paid from the fixed table in rules.ts.
//
// The wheel runs itself, as Rust's does: while anyone is seated a betting window opens, "No more
// bets" closes it, the slot is drawn only then and every bet settled at once, and the result
// stands while the wheel slows onto it and the terminals pay. Then the next window opens. Nobody
// presses Spin and nothing waits for a leader. It spins whether or not anyone has bet, so the
// history strip is the wheel's, not any one player's.
//
// Single player runs the same loop with a shorter window, plus "Spin now" once you have a bet down.

import { type Cents, DOLLAR, checkBet, formatMoney } from '../../money.ts';
import type { EngineCtx, GameEngine, Step, Refusal, TableConfig, TableMode, ChipMove, RoundResult, GameEvent, SeatCtx } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { type WheelNumber, NUMBERS, drawSlot, numberAt, returnFor } from './rules.ts';
import { type BanditAction, type BanditView, type Bets, type SeatSettle, type SpinInfo, type Phase, type SettledBet, parseAction } from './protocol.ts';

/** The betting window at a shared wheel. */
export const BETTING_MS = 20_000;
/** Alone, the window is shorter (and "Spin now" skips the rest of it). */
export const SOLO_BETTING_MS = 12_000;
/** "No more bets" to the wheel at rest: the pull, then the long slow-down against the flapper. */
export const SPIN_MS = 7_000;
/** Rest to the next window: the call, the payouts, a moment to look. */
export const SETTLE_MS = 5_000;
export const HISTORY_LEN = 24;
/** Guards on state size: separate placements (the undo list) and chips in them, per seat per spin. */
export const MAX_PLACEMENTS = 200;
export const MAX_ENTRIES = 400;

type Entry = [spot: WheelNumber, amount: Cents];

export interface BanditState {
  cfg: TableConfig;
  phase: Phase;
  round: number;
  deadline: number | null;
  /** seat -> placements in order (undo takes the last one off). */
  placed: Record<number, Entry[][]>;
  /** seat -> the bets of the last spin that seat played, and whose they were (for Rebet). */
  last: Record<number, { account: number; bets: Entry[] }>;
  spin: SpinInfo | null;
  settled: Record<number, SeatSettle>;
  history: number[];
}

export function windowFor(mode: TableMode): number {
  return mode === 'solo' ? SOLO_BETTING_MS : BETTING_MS;
}

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'banditwheel',
    variant: '',
    mode,
    maxSeats: mode === 'solo' ? 1 : 10,
    buyIn: { min: 10 * DOLLAR, max: 10_000 * DOLLAR },
    // each of the five numbers, per spin: the terminal's slot takes $1 to $1,000
    limits: { default: { min: DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR } },
    options: {},
  };
}

/** A seat's chips down, summed per number, in terminal order. */
export function betsOf(s: BanditState, seat: number): Map<WheelNumber, Cents> {
  const sums = new Map<WheelNumber, Cents>();
  for (const p of s.placed[seat] ?? []) for (const [k, a] of p) sums.set(k, (sums.get(k) ?? 0) + a);
  const out = new Map<WheelNumber, Cents>();
  for (const k of NUMBERS) if (sums.has(k)) out.set(k, sums.get(k)!);
  return out;
}

function seatTotal(s: BanditState, seat: number): Cents {
  let t = 0;
  for (const p of s.placed[seat] ?? []) for (const [, a] of p) t += a;
  return t;
}

function seatsWithBets(s: BanditState): number[] {
  return Object.keys(s.placed)
    .map(Number)
    .filter((seat) => seatTotal(s, seat) > 0)
    .sort((a, b) => a - b);
}

function betsView(s: BanditState, seat: number): Bets {
  return Object.fromEntries(betsOf(s, seat)) as Bets;
}

function betEvent(s: BanditState, seat: number): GameEvent {
  return { type: 'bet', seat, bets: betsView(s, seat) };
}

function openBetting(s: BanditState, ctx: EngineCtx, events: GameEvent[]): void {
  s.phase = 'betting';
  s.round++;
  s.placed = {};
  s.settled = {};
  s.deadline = ctx.now + windowFor(s.cfg.mode);
  events.push({ type: 'betting', round: s.round, deadline: s.deadline });
}

function goIdle(s: BanditState): Step<BanditState> {
  s.phase = 'idle';
  s.deadline = null;
  s.placed = {};
  return { state: s, events: [{ type: 'idle' }] };
}

/**
 * Check a set of chips against the limits and the seat's stack, and put them down as one
 * placement. All of them go down or none do.
 */
function place(s: BanditState, me: SeatCtx, adds: Map<WheelNumber, Cents>, events: GameEvent[], what = 'That bet'): Step<BanditState> | Refusal {
  const seat = me.seat;
  const current = betsOf(s, seat);
  const lim = s.cfg.limits.default;
  let added = 0;
  for (const [key, amount] of adds) {
    const problem = checkBet((current.get(key) ?? 0) + amount, lim);
    if (problem === 'NOT_CENTS') return refuse('BAD_REQUEST', 'Bets are whole chips.');
    if (problem === 'BELOW_MIN') return refuse('LIMIT', `Bets start at ${formatMoney(lim.min)} a number.`);
    if (problem === 'ABOVE_MAX') return refuse('LIMIT', `Each number takes at most ${formatMoney(lim.max)} a spin.`);
    if (problem === 'OFF_STEP') return refuse('LIMIT', `Bets go in steps of ${formatMoney(lim.step)}.`);
    added += amount;
  }
  if (added > me.stack) return refuse('NOT_ENOUGH_CHIPS', `${what} is ${formatMoney(added)}, more than your stack.`);
  const list = s.placed[seat] ?? [];
  const entries = list.reduce((n, p) => n + p.length, 0);
  if (list.length >= MAX_PLACEMENTS || entries + adds.size > MAX_ENTRIES) return refuse('LIMIT', 'That is a lot of chips. Clear some before adding more.');
  s.placed[seat] = [...list, [...adds]];
  events.push(betEvent(s, seat));
  return { state: s, events, chips: [{ seat, bet: added }] };
}

/**
 * The most one more placement can put on `key`: up to the table maximum for that number, and no
 * more than the stack, in whole steps. Null when nothing fits (with the reason).
 */
export function maxFor(s: BanditState, seat: number, stack: Cents, key: WheelNumber): { amount: Cents } | { none: 'AT_MAX' | 'NO_CHIPS' } {
  const lim = s.cfg.limits.default;
  const current = betsOf(s, seat).get(key) ?? 0;
  const room = lim.max - current;
  if (room <= 0) return { none: 'AT_MAX' };
  let amount = Math.min(room, stack);
  amount -= amount % lim.step;
  if (amount <= 0 || current + amount < lim.min) return { none: 'NO_CHIPS' };
  return { amount };
}

/** The slot is drawn here, after betting has closed, and every bet is settled at once. */
function spinRound(s: BanditState, ctx: EngineCtx): Step<BanditState> {
  const slot = drawSlot(ctx.rng);
  const number = numberAt(slot);
  const startAt = ctx.now;
  const restAt = ctx.now + SPIN_MS;
  const chips: ChipMove[] = [];
  const rounds: RoundResult[] = [];
  const seats: Record<number, SeatSettle> = {};
  for (const seat of seatsWithBets(s)) {
    // Only a seated player can have chips down (leaving takes them back first); anything else
    // would make the host refuse the whole step and stop the wheel, so it is never paid.
    const who = seatOf(ctx, seat);
    if (!who) continue;
    const bets = [...betsOf(s, seat)];
    let wagered = 0;
    let returned = 0;
    const list: SettledBet[] = [];
    for (const [key, amount] of bets) {
      const back = returnFor(key, slot, amount);
      wagered += amount;
      returned += back;
      list.push([key, amount, back]);
    }
    seats[seat] = { wagered, returned, bets: list };
    s.last[seat] = { account: who.accountId, bets };
    if (returned > 0) chips.push({ seat, payout: returned });
    rounds.push({ seat, wagered, returned });
  }
  s.history = [slot, ...s.history].slice(0, HISTORY_LEN);
  s.spin = { round: s.round, slot, number, startAt, restAt };
  s.settled = seats;
  s.placed = {};
  s.phase = 'results';
  s.deadline = restAt + SETTLE_MS;
  const events: GameEvent[] = [
    { type: 'spin', round: s.round, slot, number, startAt, restAt },
    { type: 'settle', round: s.round, slot, number, seats },
  ];
  return { state: s, events, chips, rounds };
}

export const engine: GameEngine<BanditState, BanditAction, BanditView> = {
  id: 'banditwheel',
  stateVersion: 1,
  seats: { min: 1, max: 10, multiplayer: true },
  config,

  create(cfg, ctx) {
    const s: BanditState = {
      cfg,
      phase: 'idle',
      round: 0,
      deadline: null,
      placed: {},
      last: {},
      spin: null,
      settled: {},
      history: [],
    };
    // A fresh state for a table that already has players (a round voided by a new version of the
    // rules) opens straight away.
    if (ctx.seats.length > 0) openBetting(s, ctx, []);
    return s;
  },

  parseAction,

  act(state, seat, action, ctx): Step<BanditState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Take a seat first.');
    if (state.phase !== 'betting') return refuse('WRONG_PHASE', state.phase === 'results' ? 'No more bets. The next round opens when the wheel has paid.' : 'The wheel is not taking bets yet.');
    const s = structuredClone(state);
    const events: GameEvent[] = [];

    if (action.type === 'spin') {
      if (s.cfg.mode !== 'solo') return refuse('BAD_REQUEST', 'The wheel spins on its own when the clock runs out.');
      if (seatTotal(s, seat) === 0) return refuse('WRONG_PHASE', 'Place a bet first.');
      return spinRound(s, ctx);
    }

    if (action.type === 'bet') {
      const adds = new Map<WheelNumber, Cents>();
      for (const b of action.bets) adds.set(b.spot, (adds.get(b.spot) ?? 0) + b.amount);
      return place(s, me, adds, events);
    }

    if (action.type === 'max') {
      const m = maxFor(s, seat, me.stack, action.spot);
      if ('none' in m) {
        const lim = s.cfg.limits.default;
        return m.none === 'AT_MAX'
          ? refuse('LIMIT', `${action.spot} already has the table maximum, ${formatMoney(lim.max)}.`)
          : refuse('NOT_ENOUGH_CHIPS', `Bets start at ${formatMoney(lim.min)}; you have ${formatMoney(me.stack)}.`);
      }
      return place(s, me, new Map([[action.spot, m.amount]]), events, 'Max');
    }

    if (action.type === 'rebet') {
      const down = betsOf(s, seat);
      let adds: Map<WheelNumber, Cents>;
      if (action.double && down.size > 0) {
        adds = down;
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
      if (!lastPlacement) return { state, events: [] };
      s.placed[seat] = list.slice(0, -1);
      const back = lastPlacement.reduce((n, [, a]) => n + a, 0);
      events.push(betEvent(s, seat));
      return { state: s, events, chips: [{ seat, payout: back }] };
    }

    // clear
    const back = seatTotal(s, seat);
    if (back === 0) return { state, events: [] };
    delete s.placed[seat];
    events.push(betEvent(s, seat));
    return { state: s, events, chips: [{ seat, payout: back }] };
  },

  tick(state, ctx) {
    if (state.phase === 'idle') {
      if (ctx.seats.length === 0) return null;
      const s = structuredClone(state);
      const events: GameEvent[] = [];
      openBetting(s, ctx, events);
      return { state: s, events };
    }
    if (state.deadline === null || ctx.now < state.deadline) return null;
    const s = structuredClone(state);
    // Everyone has gone (their chips came back as they left): the wheel rests until someone sits.
    if (ctx.seats.length === 0) return goIdle(s);
    if (state.phase === 'betting') return spinRound(s, ctx);
    // the results have stood long enough
    const events: GameEvent[] = [];
    openBetting(s, ctx, events);
    return { state: s, events };
  },

  deadline(state) {
    return state.deadline;
  },

  shiftDeadlines(state, ms) {
    // The window (or the pause after a result) waits for players coming back after a restart. A
    // spin already decided keeps its own times: its result is out, and reconnecting clients show
    // it at rest.
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
    // Chips down before "No more bets" come back; after it they are already settled.
    if (state.phase !== 'betting' || !state.placed[seat]) return { state, events: [] };
    const back = seatTotal(state, seat);
    const s = structuredClone(state);
    delete s.placed[seat];
    if (back === 0) return { state: s, events: [] };
    return { state: s, events: [betEvent(s, seat)], chips: [{ seat, payout: back }] };
  },

  liveBets(state, seat) {
    return state.phase === 'betting' ? seatTotal(state, seat) : 0;
  },

  view(state) {
    const bets: Record<number, Bets> = {};
    for (const seat of seatsWithBets(state)) bets[seat] = betsView(state, seat);
    return {
      phase: state.phase,
      round: state.round,
      deadline: state.deadline,
      window: windowFor(state.cfg.mode),
      bets,
      spin: state.spin,
      settled: state.settled,
      history: [...state.history],
      canRebet: Object.keys(state.last).map(Number),
    };
  },
};
