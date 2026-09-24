// Crash: a multiplier climbs from 1.00× until it crashes; cash out before it does
// (docs/rules/online-games.md §8).
//
// The table runs its own round loop from its first seat, solo or shared, whatever the host's
// Start flag says: a betting window (7 s, or 1 s after every connected player has a bet in), the
// flight, the crash, three seconds of wreckage, the next window. The crash point is drawn from the
// server's Rng at launch, after the last bet is in, and stays in the engine's state until the
// crash; views and events never carry it (or the time it will happen) before then.
//
// A bet can carry an auto cash-out target. The engine's deadline is the next moment something is
// due: an auto target the multiplier reaches before the crash, or the crash itself. A manual cash
// out is judged at the server's ctx.now: anything due by then (auto targets, the crash) is settled
// first, then the bet, if it is still riding, is paid at multAt(now - launch), always below the
// crash point. A seat that stands up mid-flight is cashed out the same way; one that stands up
// during the window gets its bet back. Every bet is settled exactly once.

import { type Cents, DOLLAR, checkBet, formatMoney } from '../../money.ts';
import type { EngineCtx, GameEngine, Step, Refusal, TableConfig, TableMode, GameEvent, ChipMove, RoundResult } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { isObj, isInt, isAmount } from '../../protocol.ts';
import { CAP, MIN_AUTO, MAX_AUTO, timeTo, multAt, drawCrash, formatMult } from './rules.ts';

export const BETTING_MS = 7_000;
/** Once every connected seat has a bet in, the window closes this soon. */
export const ALL_IN_MS = 1_000;
/** The crash stays on screen this long before the next window opens. */
export const CRASHED_MS = 3_000;
export const HISTORY_LEN = 24;

export type CrashAction = { type: 'bet'; amount: Cents; auto: number | null } | { type: 'cancel' } | { type: 'cashout' };

export type CrashPhase = 'idle' | 'betting' | 'running' | 'crashed';

export interface CrashBet {
  seat: number;
  name: string;
  amount: Cents;
  /** Auto cash-out target in hundredths, or null. */
  auto: number | null;
  /** Hundredths it was paid at; null while it rides (and after a crash took it). */
  cashed: number | null;
  payout: Cents;
}

export interface CrashState {
  cfg: TableConfig;
  phase: CrashPhase;
  round: number;
  /** betting: when the window closes; crashed: when the next one opens. Null otherwise. */
  deadline: number | null;
  /** When the multiplier left 1.00× (running and crashed). */
  launchAt: number | null;
  /** The crash point in hundredths: drawn at launch, server only until the crash. */
  crash: number | null;
  bets: CrashBet[];
  /** Crash points, most recent first. */
  history: number[];
}

export interface CrashViewBet {
  seat: number;
  name: string;
  amount: Cents;
  /** Your own row only: others' targets are theirs. */
  auto: number | null;
  cashed: number | null;
  payout: Cents;
  /** Rode it into the crash. */
  busted: boolean;
}

export interface CrashView {
  phase: CrashPhase;
  round: number;
  /** betting: the window closes at this server time; crashed: the next opens. */
  deadline: number | null;
  launchAt: number | null;
  /** The crash point, once it has happened. */
  crash: number | null;
  bets: CrashViewBet[];
  history: number[];
  cap: number;
}

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'crash',
    variant: '',
    mode,
    maxSeats: mode === 'solo' ? 1 : 12,
    // up to a hundred times the table maximum (shared/src/limits.ts scales it with the table)
    buyIn: { min: 10 * DOLLAR, max: 100_000 * DOLLAR },
    limits: { default: { min: DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR } },
    options: { cap: CAP, bettingMs: BETTING_MS },
  };
}

function parseAction(raw: unknown): CrashAction | null {
  if (!isObj(raw)) return null;
  switch (raw.type) {
    case 'bet': {
      if (!isAmount(raw.amount)) return null;
      const auto = raw.auto ?? null;
      if (auto !== null && !isInt(auto)) return null;
      return { type: 'bet', amount: raw.amount, auto };
    }
    case 'cancel':
    case 'cashout':
      return { type: raw.type };
    default:
      return null;
  }
}

interface Out {
  events: GameEvent[];
  chips: ChipMove[];
  rounds: RoundResult[];
}

const out = (): Out => ({ events: [], chips: [], rounds: [] });

function step(s: CrashState, o: Out): Step<CrashState> {
  return { state: s, events: o.events, ...(o.chips.length ? { chips: o.chips } : {}), ...(o.rounds.length ? { rounds: o.rounds } : {}) };
}

function openBetting(s: CrashState, ctx: EngineCtx, o: Out): void {
  s.phase = 'betting';
  s.round++;
  s.bets = [];
  s.launchAt = null;
  s.crash = null;
  s.deadline = ctx.now + BETTING_MS;
  o.events.push({ type: 'betting', round: s.round, deadline: s.deadline });
}

function goIdle(s: CrashState, o: Out): void {
  s.phase = 'idle';
  s.deadline = null;
  s.launchAt = null;
  s.crash = null;
  s.bets = [];
  o.events.push({ type: 'idle' });
}

/** Pay a riding bet at `k` hundredths. */
function payOut(b: CrashBet, k: number, how: 'auto' | 'manual' | 'left', o: Out): void {
  b.cashed = k;
  // whole-dollar bets times hundredths: always whole cents
  b.payout = (b.amount / 100) * k;
  o.chips.push({ seat: b.seat, payout: b.payout });
  o.rounds.push({ seat: b.seat, wagered: b.amount, returned: b.payout });
  o.events.push({ type: 'cashout', seat: b.seat, name: b.name, at: k, amount: b.amount, payout: b.payout, how });
}

/**
 * Bring a flight up to `now`: auto targets reached before the crash are paid (in the order the
 * multiplier reached them), then, if its moment has come, the crash takes whatever still rides.
 */
function advance(s: CrashState, now: number, o: Out): void {
  if (s.phase !== 'running') return;
  const t = now - s.launchAt!;
  const c = s.crash!;
  const due = s.bets
    .filter((b) => b.cashed === null && b.auto !== null && b.auto < c && timeTo(b.auto) <= t)
    .sort((a, b) => a.auto! - b.auto! || a.seat - b.seat);
  for (const b of due) payOut(b, b.auto!, 'auto', o);
  if (t < timeTo(c)) return;
  const busted: number[] = [];
  for (const b of s.bets) {
    if (b.cashed !== null) continue;
    busted.push(b.seat);
    o.rounds.push({ seat: b.seat, wagered: b.amount, returned: 0 });
  }
  s.history = [c, ...s.history].slice(0, HISTORY_LEN);
  s.phase = 'crashed';
  s.deadline = now + CRASHED_MS;
  o.events.push({ type: 'crash', round: s.round, crash: c, launchAt: s.launchAt, busted, deadline: s.deadline });
}

/** The first moment of a flight that needs the server: an auto target it will reach, or the crash. */
function flightDeadline(s: CrashState): number {
  const c = s.crash!;
  let next = s.launchAt! + timeTo(c);
  for (const b of s.bets) {
    if (b.cashed === null && b.auto !== null && b.auto < c) next = Math.min(next, s.launchAt! + timeTo(b.auto));
  }
  return next;
}

function viewBet(s: CrashState, b: CrashBet, viewer: number | null): CrashViewBet {
  return {
    seat: b.seat,
    name: b.name,
    amount: b.amount,
    auto: b.seat === viewer ? b.auto : null,
    cashed: b.cashed,
    payout: b.payout,
    busted: s.phase === 'crashed' && b.cashed === null,
  };
}

export const engine: GameEngine<CrashState, CrashAction, CrashView> = {
  id: 'crash',
  stateVersion: 1,
  seats: { min: 1, max: 12, multiplayer: true },
  config,

  create(cfg) {
    return { cfg, phase: 'idle', round: 0, deadline: null, launchAt: null, crash: null, bets: [], history: [] };
  },

  parseAction,

  act(state, seat, action, ctx): Step<CrashState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Take a seat first.');

    if (action.type === 'bet') {
      if (state.phase !== 'betting') {
        return refuse('WRONG_PHASE', state.phase === 'running' ? "It's in the air: bet on the next round." : 'Bets open for the next round in a moment.');
      }
      if (state.bets.some((b) => b.seat === seat)) return refuse('WRONG_PHASE', 'You have a bet in. Cancel it to change it.');
      const lim = state.cfg.limits.default;
      const problem = checkBet(action.amount, lim);
      if (problem === 'OFF_STEP' || problem === 'NOT_CENTS') return refuse('LIMIT', `Bets are whole ${formatMoney(lim.step)} amounts.`);
      if (problem) return refuse('LIMIT', `Bet ${formatMoney(lim.min)} to ${formatMoney(lim.max)}.`);
      if (action.amount > me.stack) return refuse('NOT_ENOUGH_CHIPS', `You have ${formatMoney(me.stack)} here.`);
      const auto = action.auto;
      if (auto !== null && (auto < MIN_AUTO || auto > MAX_AUTO)) {
        return refuse('LIMIT', `Auto cash-out goes from ${formatMult(MIN_AUTO)} to ${formatMult(MAX_AUTO)}.`);
      }
      const s = structuredClone(state);
      s.bets.push({ seat, name: me.name, amount: action.amount, auto, cashed: null, payout: 0 });
      const o = out();
      o.events.push({ type: 'bet', seat, name: me.name, amount: action.amount });
      o.chips.push({ seat, bet: action.amount });
      // Everyone who is here has a bet in: no need to keep the others waiting.
      const here = ctx.seats.filter((st) => st.connected);
      if (here.length > 0 && here.every((st) => s.bets.some((b) => b.seat === st.seat))) {
        s.deadline = Math.min(s.deadline ?? Infinity, ctx.now + ALL_IN_MS);
        o.events.push({ type: 'closing', round: s.round, deadline: s.deadline });
      }
      return step(s, o);
    }

    if (action.type === 'cancel') {
      if (state.phase !== 'betting') return refuse('WRONG_PHASE', 'Too late to cancel: the round is under way.');
      const i = state.bets.findIndex((b) => b.seat === seat);
      if (i < 0) return refuse('BAD_REQUEST', 'You have no bet in.');
      const s = structuredClone(state);
      const [b] = s.bets.splice(i, 1);
      return { state: s, events: [{ type: 'cancel', seat }], chips: [{ seat, payout: b!.amount }] };
    }

    // cashout
    if (state.phase !== 'running') {
      return refuse('WRONG_PHASE', state.phase === 'betting' ? "It hasn't launched yet: cancel instead." : 'Nothing in the air to cash out.');
    }
    if (!state.bets.some((b) => b.seat === seat && b.cashed === null)) return refuse('BAD_REQUEST', 'You have no bet in the air.');
    const s = structuredClone(state);
    const o = out();
    advance(s, ctx.now, o);
    const b = s.bets.find((x) => x.seat === seat)!;
    // Still riding and still flying: paid at the multiplier on the server's clock, below the crash.
    if (s.phase === 'running' && b.cashed === null) payOut(b, Math.min(multAt(ctx.now - s.launchAt!), s.crash! - 1), 'manual', o);
    return step(s, o);
  },

  tick(state, ctx) {
    const o = out();
    if (state.phase === 'idle') {
      if (ctx.seats.length === 0) return null;
      const s = structuredClone(state);
      openBetting(s, ctx, o);
      return step(s, o);
    }
    if (state.phase === 'betting') {
      if (state.deadline === null || ctx.now < state.deadline) return null;
      const s = structuredClone(state);
      if (ctx.seats.length === 0 && s.bets.length === 0) {
        goIdle(s, o);
        return step(s, o);
      }
      // Launch: the crash point is drawn now, with every bet in.
      s.phase = 'running';
      s.deadline = null;
      s.launchAt = ctx.now;
      s.crash = drawCrash(ctx.rng);
      o.events.push({ type: 'launch', round: s.round, launchAt: s.launchAt });
      // A 1.00× round is over the moment it starts.
      advance(s, ctx.now, o);
      return step(s, o);
    }
    if (state.phase === 'running') {
      if (ctx.now < flightDeadline(state)) return null;
      const s = structuredClone(state);
      advance(s, ctx.now, o);
      return step(s, o);
    }
    // crashed
    if (state.deadline === null || ctx.now < state.deadline) return null;
    const s = structuredClone(state);
    if (ctx.seats.length === 0) goIdle(s, o);
    else openBetting(s, ctx, o);
    return step(s, o);
  },

  deadline(state) {
    return state.phase === 'running' ? flightDeadline(state) : state.deadline;
  },

  shiftDeadlines(state, ms) {
    // A window or the pause after a crash can wait for people to reconnect. A flight can't: the
    // curve is a function of time since launch, and rewinding it would let someone cash out below
    // a multiplier they had already seen it pass.
    if (state.phase === 'running' || state.deadline === null) return state;
    return { ...state, deadline: state.deadline + ms };
  },

  seatJoined(state, _seat, ctx) {
    if (state.phase !== 'idle') return { state, events: [] };
    const s = structuredClone(state);
    const o = out();
    openBetting(s, ctx, o);
    return step(s, o);
  },

  seatLeaving(state, seat, ctx) {
    const i = state.bets.findIndex((b) => b.seat === seat && b.cashed === null);
    if (i < 0) return { state, events: [] };
    const s = structuredClone(state);
    const o = out();
    if (s.phase === 'betting') {
      // Not launched yet: the bet comes back.
      const [b] = s.bets.splice(i, 1);
      o.events.push({ type: 'cancel', seat });
      o.chips.push({ seat, payout: b!.amount });
      return step(s, o);
    }
    if (s.phase !== 'running') return { state, events: [] };
    // In the air: settle what's due, then cash this seat out at the multiplier on the clock.
    advance(s, ctx.now, o);
    const b = s.bets[i]!;
    if (s.phase === 'running' && b.cashed === null) payOut(b, Math.min(multAt(ctx.now - s.launchAt!), s.crash! - 1), 'left', o);
    return step(s, o);
  },

  liveBets(state, seat) {
    if (state.phase !== 'betting' && state.phase !== 'running') return 0;
    return state.bets.find((b) => b.seat === seat && b.cashed === null)?.amount ?? 0;
  },

  view(state, viewer) {
    const done = state.phase === 'crashed';
    return {
      phase: state.phase,
      round: state.round,
      deadline: state.phase === 'betting' || done ? state.deadline : null,
      launchAt: state.phase === 'running' || done ? state.launchAt : null,
      crash: done ? state.crash : null,
      bets: state.bets.map((b) => viewBet(state, b, viewer)),
      history: [...state.history],
      cap: CAP,
    };
  },
};
