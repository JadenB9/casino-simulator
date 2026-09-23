// Craps: the puck, the shooter, bets working or off, and one roll settling everything at once.
// What each bet pays and when it works lives in rules.ts; this file runs the table around it.
//
// Solo: you are the shooter. Put a bet down and Roll. Multiplayer: once the leader starts the
// table, the dice go to the first seat. After every roll there is a short betting pause (it ends
// early when everyone else is ready); then the shooter throws, or the table throws for them when
// their time runs out. On the come-out the shooter needs a bet on the pass line or don't pass.
// After a seven-out the dice pass clockwise (to the next seat number).
//
// Leaving: bets that can come down come back; contract bets (a pass or come bet with a point)
// stay up until they are decided. If nobody else is shooting, the table rolls on its own every
// couple of seconds until they are, so the seat can cash out.

import { type Cents, DOLLAR, checkBet, formatMoney, type BetProblem } from '../../money.ts';
import { randInt } from '../../rng.ts';
import type { EngineCtx, GameEngine, Step, Refusal, TableConfig, TableMode, ChipMove, RoundResult, GameEvent } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import {
  type Bet, type BetId, type BetKind, type PointNumber,
  betId, parseId, limitKey, oddsLimitKey, maxOdds, layVig, isRemovable, canToggle, settle, settleRank, nextPoint,
  ODDS_MAX, LAY_ODDS_MAX,
} from './rules.ts';
import { parseAction, type CrapsAction, type CrapsView } from './protocol.ts';

/** Multiplayer: bets go down for this long after each roll... */
export const PAUSE_MS = 7_000;
/** ...and never less than this, so the dice and payouts finish before the next throw. */
export const MIN_PAUSE_MS = 3_000;
/** Then the shooter has this long to throw before the table throws for them. */
export const SHOOT_MS = 10_000;
/** While only leaving seats' contract bets are up, the table rolls this often. */
export const LEAVING_ROLL_MS = 2_000;
export const HISTORY = 20;

export interface CrapsState {
  cfg: TableConfig;
  phase: 'idle' | 'open';
  point: PointNumber | null;
  shooter: number | null;
  rolls: number;
  pointsMade: number;
  history: [number, number][];
  bets: Record<number, Record<BetId, Bet>>;
  pauseUntil: number | null;
  minPauseEnd: number | null;
  rollBy: number | null;
  pauseOver: boolean;
  rollRequested: boolean;
  leaving: number[];
}

const D = DOLLAR;

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'craps',
    variant: '',
    mode,
    maxSeats: mode === 'solo' ? 1 : 8,
    buyIn: { min: 100 * D, max: 50_000 * D },
    // Steps keep every payout a whole number of cents (§3.5). Place 6/8 and lay bets use the
    // steps real tables use; the odds limits are further capped at 3-4-5x (6x laid) the flat bet.
    limits: {
      default: { min: 5 * D, max: 5_000 * D, step: D },
      line: { min: 10 * D, max: 5_000 * D, step: D },
      odds: { min: D, max: 25_000 * D, step: D },
      layOdds4: { min: D, max: 30_000 * D, step: D },
      layOdds5: { min: 3 * D, max: 30_000 * D, step: 3 * D },
      layOdds6: { min: 6 * D, max: 30_000 * D, step: 6 * D },
      place4: { min: 5 * D, max: 5_000 * D, step: 5 * D },
      place6: { min: 6 * D, max: 6_000 * D, step: 6 * D },
      buy: { min: 5 * D, max: 5_000 * D, step: D },
      lay4: { min: 10 * D, max: 10_000 * D, step: 2 * D },
      lay5: { min: 9 * D, max: 10_000 * D, step: 3 * D },
      lay6: { min: 12 * D, max: 10_000 * D, step: 6 * D },
      big: { min: 5 * D, max: 5_000 * D, step: D },
      field: { min: 5 * D, max: 5_000 * D, step: D },
      hard: { min: D, max: 1_000 * D, step: D },
      prop: { min: D, max: 1_000 * D, step: D },
      horn: { min: 4 * D, max: 1_000 * D, step: 4 * D },
      ce: { min: 2 * D, max: 1_000 * D, step: 2 * D },
    },
    // Lay bets are a house option, off by default (§3.1).
    options: { lay: false },
  };
}

function limitsOf(s: CrapsState, key: string) {
  return s.cfg.limits[key] ?? s.cfg.limits.default;
}

function limitMsg(p: BetProblem, key: string, s: CrapsState): string {
  const l = limitsOf(s, key);
  if (p === 'BELOW_MIN') return `The minimum there is ${formatMoney(l.min)}.`;
  if (p === 'ABOVE_MAX') return `The maximum there is ${formatMoney(l.max)}.`;
  return `Bets there go in ${formatMoney(l.step)} steps.`;
}

/** Chips a seat has on the layout. */
function live(s: CrapsState, seat: number): Cents {
  let sum = 0;
  for (const b of Object.values(s.bets[seat] ?? {})) sum += b.amount + (b.odds ?? 0);
  return sum;
}

function hasLine(s: CrapsState, seat: number): boolean {
  const mine = s.bets[seat];
  return !!(mine?.pass || mine?.dontpass);
}

/** Seated players who aren't on their way out, by seat number. */
function activeSeats(s: CrapsState, ctx: EngineCtx, exclude: number | null = null): number[] {
  return ctx.seats.map((x) => x.seat).filter((x) => x !== exclude && !s.leaving.includes(x));
}

/** The next active seat clockwise after `after` (optionally one with a line bet), or null. */
function nextShooter(s: CrapsState, ctx: EngineCtx, after: number | null, opts: { needLine?: boolean; exclude?: number } = {}): number | null {
  const seats = activeSeats(s, ctx, opts.exclude ?? null).filter((x) => !opts.needLine || hasLine(s, x));
  if (seats.length === 0) return null;
  if (after === null) return seats[0]!;
  return seats.find((x) => x > after) ?? seats[0]!;
}

function leavingLive(s: CrapsState): boolean {
  return s.leaving.some((x) => live(s, x) > 0);
}

/** Everyone but the shooter who is connected has pressed Ready. */
function othersReady(s: CrapsState, ctx: EngineCtx): boolean {
  return ctx.seats.every((x) => x.seat === s.shooter || s.leaving.includes(x.seat) || !x.connected || x.ready);
}

/** A multiplayer betting pause after a roll (or when the dice change hands). */
function openWindow(s: CrapsState, ctx: EngineCtx, events: GameEvent[]): void {
  s.pauseUntil = ctx.now + PAUSE_MS;
  s.minPauseEnd = ctx.now + MIN_PAUSE_MS;
  s.rollBy = s.pauseUntil + SHOOT_MS;
  s.pauseOver = false;
  s.rollRequested = false;
  events.push({ type: 'open', pauseUntil: s.pauseUntil, rollBy: s.rollBy });
}

/**
 * Keep the table moving for seats waiting on contract bets: solo rolls every couple of seconds;
 * a multiplayer table with nobody left to shoot does the same, or goes idle once nothing is up.
 */
function houseRolls(s: CrapsState, ctx: EngineCtx, events: GameEvent[]): void {
  const pending = leavingLive(s);
  if (s.cfg.mode === 'solo') {
    s.rollBy = pending ? ctx.now + LEAVING_ROLL_MS : null;
    return;
  }
  if (s.shooter !== null) return;
  if (pending) {
    s.pauseUntil = s.minPauseEnd = null;
    s.pauseOver = true;
    s.rollRequested = false;
    s.rollBy = ctx.now + LEAVING_ROLL_MS;
  } else if (activeSeats(s, ctx).length === 0) {
    s.phase = 'idle';
    s.pauseUntil = s.minPauseEnd = s.rollBy = null;
    s.pauseOver = false;
    s.rollRequested = false;
    events.push({ type: 'idle' });
  }
}

/** Why `kind` can't be bet right now, or null. */
function whyNot(s: CrapsState, kind: BetKind): string | null {
  if ((kind === 'pass' || kind === 'dontpass') && s.point !== null) return 'Line bets go down before the come-out roll.';
  if ((kind === 'come' || kind === 'dontcome') && s.point === null) return 'Come bets open once a point is set.';
  if (kind === 'lay' && s.cfg.options.lay !== true) return "This table doesn't book lay bets.";
  return null;
}

/** The point a flat bet with odds rides on. */
function pointOf(s: CrapsState, id: BetId): PointNumber | null {
  if (id === 'pass' || id === 'dontpass') return s.point;
  return parseId(id).n ?? null;
}

function flatKind(id: BetId): 'pass' | 'dontpass' | 'come' | 'dontcome' {
  return parseId(id).kind as 'pass' | 'dontpass' | 'come' | 'dontcome';
}

/** Roll the dice and settle every bet on the table against the state before the roll. */
function doRoll(s: CrapsState, ctx: EngineCtx, auto: boolean): Step<CrapsState> {
  const d1 = randInt(ctx.rng, 6) + 1;
  const d2 = randInt(ctx.rng, 6) + 1;
  const total = d1 + d2;
  const before = s.point;
  const events: GameEvent[] = [{ type: 'roll', shooter: s.shooter, dice: [d1, d2], total, point: before, auto }];
  const moves: GameEvent[] = [];
  const chips: ChipMove[] = [];
  const rounds: RoundResult[] = [];
  const seated = new Set(ctx.seats.map((x) => x.seat));

  for (const seat of Object.keys(s.bets).map(Number).sort((a, b) => a - b)) {
    // chips can only move for a seated player; the host never lets a seat go with bets up
    if (!seated.has(seat)) continue;
    const mine = s.bets[seat]!;
    let back = 0;
    let wagered = 0;
    let returned = 0;
    const ids = Object.keys(mine).sort((a, b) => settleRank(a) - settleRank(b) || a.localeCompare(b));
    for (const id of ids) {
      const bet = mine[id]!;
      const r = settle(id, bet, before, d1, d2);
      back += r.back;
      wagered += r.wagered;
      returned += r.returned;
      if (r.flat || r.odds) events.push({ type: 'result', seat, id, flat: r.flat ?? null, odds: r.odds ?? null, win: r.win, back: r.back });
      if (r.moveTo !== undefined) {
        // settled after the bets on numbers, so an old come bet on this number has already gone
        const dest = `${parseId(id).kind}${r.moveTo}`;
        delete mine[id];
        mine[dest] = { amount: bet.amount };
        moves.push({ type: 'move', seat, from: id, id: dest, amount: bet.amount });
      } else if (r.left) mine[id] = r.left;
      else delete mine[id];
    }
    if (back > 0) chips.push({ seat, payout: back });
    if (wagered > 0) rounds.push({ seat, wagered, returned });
  }
  events.push(...moves);

  const after = nextPoint(before, total);
  s.point = after;
  s.rolls++;
  s.history.push([d1, d2]);
  if (s.history.length > HISTORY) s.history.shift();
  let sevenOut = false;
  if (before === null && after !== null) events.push({ type: 'puck', point: after });
  if (before !== null && after === null) {
    sevenOut = total === 7;
    if (!sevenOut) s.pointsMade++;
    events.push(sevenOut ? { type: 'puck', point: null, sevenOut: true } : { type: 'puck', point: null, made: before });
  }

  // Seats on their way out take back whatever can come down now (a pass bet that just won, say).
  // They stay on the leaving list (so they never get the dice) until the host calls seatLeaving
  // again to cash them out.
  for (const seat of s.leaving) {
    if (!seated.has(seat)) continue;
    const back = takeDownRemovable(s, seat, events);
    if (back > 0) chips.push({ seat, payout: back });
  }

  if (sevenOut) {
    s.pointsMade = 0;
    if (s.cfg.mode === 'multi' && s.shooter !== null) s.shooter = nextShooter(s, ctx, s.shooter);
    events.push({ type: 'shooter', seat: s.shooter, why: 'sevenout' });
  }
  if (s.cfg.mode === 'multi' && s.shooter !== null) openWindow(s, ctx, events);
  else {
    s.rollRequested = false;
    houseRolls(s, ctx, events);
  }
  return { state: s, events, chips, rounds };
}

/** Bring back every bet (and odds) of `seat` that may come down now. Returns the chips. */
function takeDownRemovable(s: CrapsState, seat: number, events: GameEvent[]): Cents {
  const mine = s.bets[seat];
  if (!mine) return 0;
  let total = 0;
  for (const id of Object.keys(mine)) {
    const bet = mine[id]!;
    if (isRemovable(id, s.point)) {
      const back = bet.amount + (bet.odds ?? 0) + (bet.vig ?? 0);
      delete mine[id];
      total += back;
      events.push({ type: 'bet', seat, id, bet: null, back });
    } else if (bet.odds) {
      total += bet.odds;
      events.push({ type: 'bet', seat, id, bet: { amount: bet.amount }, back: bet.odds });
      delete bet.odds;
      delete bet.on;
    }
  }
  return total;
}

function placeBets(s: CrapsState, seat: number, stack: Cents, a: Extract<CrapsAction, { type: 'bet' }>): Step<CrapsState> | Refusal {
  // A batch may hit the same spot twice; add it up per spot first.
  const adds = new Map<BetId, { kind: BetKind; n?: number; amount: Cents }>();
  for (const b of a.bets) {
    const id = betId(b.kind, b.number);
    const prev = adds.get(id);
    adds.set(id, { kind: b.kind, n: b.number, amount: (prev?.amount ?? 0) + b.amount });
  }
  const mine = (s.bets[seat] ??= {});
  let cost = 0;
  const next = new Map<BetId, Bet>();
  for (const [id, add] of adds) {
    const why = whyNot(s, add.kind);
    if (why) return refuse('WRONG_PHASE', why);
    const cur = mine[id];
    const amount = (cur?.amount ?? 0) + add.amount;
    const key = limitKey(add.kind, add.n);
    const problem = checkBet(amount, limitsOf(s, key));
    if (problem) return refuse('LIMIT', limitMsg(problem, key, s));
    const bet: Bet = { ...cur, amount };
    if (add.kind === 'lay') {
      bet.vig = layVig(amount, add.n as PointNumber);
      cost += bet.vig - (cur?.vig ?? 0);
    }
    cost += add.amount;
    next.set(id, bet);
  }
  if (cost > stack) return refuse('NOT_ENOUGH_CHIPS', 'That bet is more than your stack.');
  const events: GameEvent[] = [];
  for (const [id, bet] of next) {
    mine[id] = bet;
    events.push({ type: 'bet', seat, id, bet });
  }
  return { state: s, events, chips: [{ seat, bet: cost }] };
}

function takeOdds(s: CrapsState, seat: number, stack: Cents, a: Extract<CrapsAction, { type: 'odds' }>): Step<CrapsState> | Refusal {
  const flat = s.bets[seat]?.[a.on];
  if (!flat) return refuse('BAD_REQUEST', 'Odds go behind your own line or come bet.');
  const n = pointOf(s, a.on);
  if (n === null) return refuse('WRONG_PHASE', 'Odds go on once the point is set.');
  const kind = flatKind(a.on);
  const lay = kind === 'dontpass' || kind === 'dontcome';
  const odds = (flat.odds ?? 0) + a.amount;
  const max = maxOdds(kind, flat.amount, n);
  if (odds > max) return refuse('LIMIT', `${lay ? LAY_ODDS_MAX : ODDS_MAX[n]}x odds here: up to ${formatMoney(max)} behind this bet.`);
  const key = oddsLimitKey(lay, n);
  const problem = checkBet(odds, limitsOf(s, key));
  if (problem) return refuse('LIMIT', limitMsg(problem, key, s));
  if (a.amount > stack) return refuse('NOT_ENOUGH_CHIPS', 'That bet is more than your stack.');
  flat.odds = odds;
  return { state: s, events: [{ type: 'bet', seat, id: a.on, bet: flat }], chips: [{ seat, bet: a.amount }] };
}

function takeDown(s: CrapsState, seat: number, a: Extract<CrapsAction, { type: 'down' }>): Step<CrapsState> | Refusal {
  const mine = s.bets[seat];
  const bet = mine?.[a.id];
  if (!mine || !bet) return refuse('BAD_REQUEST', "You don't have a bet there.");
  let back: Cents;
  if (a.part === 'odds') {
    const odds = bet.odds ?? 0;
    const take = a.amount ?? odds;
    if (odds === 0 || take > odds) return refuse('BAD_REQUEST', "There aren't that many odds behind it.");
    const left = odds - take;
    if (left > 0) {
      const key = oddsLimitKey(flatKind(a.id) === 'dontpass' || flatKind(a.id) === 'dontcome', pointOf(s, a.id)!);
      const problem = checkBet(left, limitsOf(s, key));
      if (problem) return refuse('LIMIT', limitMsg(problem, key, s));
      bet.odds = left;
    } else delete bet.odds;
    back = take;
  } else {
    if (!isRemovable(a.id, s.point)) return refuse('WRONG_PHASE', 'A pass or come bet stays up once it has a point.');
    const take = a.amount ?? bet.amount;
    if (take > bet.amount) return refuse('BAD_REQUEST', "There isn't that much on that bet.");
    const left = bet.amount - take;
    const { kind, n } = parseId(a.id);
    if (left > 0) {
      if (kind === 'lay') return refuse('BAD_REQUEST', 'A lay bet comes down whole.');
      const key = limitKey(kind, n);
      const problem = checkBet(left, limitsOf(s, key));
      if (problem) return refuse('LIMIT', limitMsg(problem, key, s));
      const p = pointOf(s, a.id);
      if (bet.odds && p !== null && bet.odds > maxOdds(flatKind(a.id), left, p)) return refuse('LIMIT', 'Take some odds down first.');
      bet.amount = left;
      back = take;
    } else {
      back = bet.amount + (bet.odds ?? 0) + (bet.vig ?? 0);
      delete mine[a.id];
    }
  }
  return { state: s, events: [{ type: 'bet', seat, id: a.id, bet: mine[a.id] ?? null, back }], chips: [{ seat, payout: back }] };
}

export const engine: GameEngine<CrapsState, CrapsAction, CrapsView> = {
  id: 'craps',
  stateVersion: 1,
  seats: { min: 1, max: 8, multiplayer: true },
  config,

  create(cfg, ctx) {
    return {
      cfg,
      phase: cfg.mode === 'solo' ? 'open' : 'idle',
      point: null,
      shooter: cfg.mode === 'solo' ? (ctx.seats[0]?.seat ?? null) : null,
      rolls: 0,
      pointsMade: 0,
      history: [],
      bets: {},
      pauseUntil: null,
      minPauseEnd: null,
      rollBy: null,
      pauseOver: false,
      rollRequested: false,
      leaving: [],
    };
  },

  parseAction,

  act(state, seat, action, ctx): Step<CrapsState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Take a seat first.');
    if (state.phase !== 'open') return refuse('WRONG_PHASE', 'The table opens when the leader starts it.');
    const s = structuredClone(state);
    // Playing on after asking to cash out means staying.
    s.leaving = s.leaving.filter((x) => x !== seat);
    if (s.cfg.mode === 'solo') {
      s.shooter = seat;
      if (!leavingLive(s)) s.rollBy = null;
    }

    switch (action.type) {
      case 'bet':
        return placeBets(s, seat, me.stack, action);
      case 'odds':
        return takeOdds(s, seat, me.stack, action);
      case 'down':
        return takeDown(s, seat, action);
      case 'working': {
        const bet = s.bets[seat]?.[action.id];
        if (!bet) return refuse('BAD_REQUEST', "You don't have a bet there.");
        if (!canToggle(action.id)) return refuse('BAD_REQUEST', "That bet can't be called off.");
        if (action.on === null) delete bet.on;
        else bet.on = action.on;
        return { state: s, events: [{ type: 'bet', seat, id: action.id, bet }] };
      }
      case 'roll': {
        if (s.cfg.mode === 'solo') {
          if (live(s, seat) === 0) return refuse('WRONG_PHASE', 'Put a bet down first.');
          return doRoll(s, ctx, false);
        }
        if (s.shooter !== seat) return refuse('NOT_YOUR_TURN', 'Only the shooter throws the dice.');
        if (s.point === null && !hasLine(s, seat)) return refuse('WRONG_PHASE', "The shooter needs a bet on the pass line or don't pass.");
        if (s.rollRequested) return { state, events: [] };
        if (s.pauseOver || (othersReady(s, ctx) && ctx.now >= (s.minPauseEnd ?? 0))) return doRoll(s, ctx, false);
        // Everyone else still has time to bet: the dice fly as soon as the pause ends.
        s.rollRequested = true;
        if (othersReady(s, ctx) && s.minPauseEnd !== null && s.pauseUntil !== null) s.pauseUntil = Math.min(s.pauseUntil, s.minPauseEnd);
        return { state: s, events: [{ type: 'requested', seat, pauseUntil: s.pauseUntil }] };
      }
    }
  },

  tick(state, ctx) {
    if (state.cfg.mode === 'solo') {
      if (state.rollBy === null || ctx.now < state.rollBy) return null;
      const s = structuredClone(state);
      if (leavingLive(s)) return doRoll(s, ctx, true);
      s.rollBy = null;
      return { state: s, events: [] };
    }
    if (!ctx.started) return null;
    const s = structuredClone(state);
    const events: GameEvent[] = [];
    if (s.phase === 'idle') {
      if (activeSeats(s, ctx).length === 0) return null;
      s.phase = 'open';
      s.shooter = nextShooter(s, ctx, null);
      events.push({ type: 'shooter', seat: s.shooter, why: 'first' });
      openWindow(s, ctx, events);
      return { state: s, events };
    }

    // The shooter walked away or was cashed out: the dice move on.
    if (s.shooter !== null && !activeSeats(s, ctx).includes(s.shooter)) {
      s.shooter = nextShooter(s, ctx, s.shooter);
      events.push({ type: 'shooter', seat: s.shooter, why: 'left' });
      if (s.shooter !== null) openWindow(s, ctx, events);
      else houseRolls(s, ctx, events);
      return { state: s, events };
    }
    if (s.shooter === null) {
      const seat = nextShooter(s, ctx, null);
      if (seat !== null) {
        s.shooter = seat;
        events.push({ type: 'shooter', seat, why: 'first' });
        openWindow(s, ctx, events);
        return { state: s, events };
      }
      if (s.rollBy !== null && ctx.now >= s.rollBy) {
        if (leavingLive(s)) return doRoll(s, ctx, true);
        houseRolls(s, ctx, events);
        return { state: s, events };
      }
      return null;
    }

    if (!s.pauseOver) {
      const ready = othersReady(s, ctx) && s.minPauseEnd !== null;
      if (ctx.now >= (s.pauseUntil ?? 0) || (ready && ctx.now >= s.minPauseEnd!)) {
        s.pauseOver = true;
        if (s.rollRequested && (s.point !== null || hasLine(s, s.shooter))) return doRoll(s, ctx, false);
        s.rollRequested = false;
        return { state: s, events: [{ type: 'pause', over: true, rollBy: s.rollBy }] };
      }
      if (ready && s.pauseUntil! > s.minPauseEnd!) {
        s.pauseUntil = s.minPauseEnd;
        return { state: s, events: [{ type: 'open', pauseUntil: s.pauseUntil, rollBy: s.rollBy }] };
      }
      return null;
    }

    if (s.rollBy === null || ctx.now < s.rollBy) return null;
    if (s.point !== null || hasLine(s, s.shooter)) return doRoll(s, ctx, true);
    // Come-out, and the shooter never bet the line: the dice go to the next seat that has.
    const withLine = nextShooter(s, ctx, s.shooter, { needLine: true });
    if (withLine === null && leavingLive(s)) return doRoll(s, ctx, true);
    s.shooter = withLine ?? nextShooter(s, ctx, s.shooter);
    events.push({ type: 'shooter', seat: s.shooter, why: 'nobet' });
    openWindow(s, ctx, events);
    return { state: s, events };
  },

  deadline(state) {
    if (state.cfg.mode === 'solo') return state.rollBy;
    if (state.phase === 'idle') return null;
    if (state.shooter !== null && !state.pauseOver) return state.pauseUntil;
    return state.rollBy;
  },

  shiftDeadlines(state, ms) {
    const shift = (t: number | null) => (t === null ? null : t + ms);
    return { ...state, pauseUntil: shift(state.pauseUntil), minPauseEnd: shift(state.minPauseEnd), rollBy: shift(state.rollBy) };
  },

  seatJoined(state, seat, ctx) {
    const s = structuredClone(state);
    const events: GameEvent[] = [];
    if (live(s, seat) === 0) {
      delete s.bets[seat];
      s.leaving = s.leaving.filter((x) => x !== seat);
    }
    if (s.cfg.mode === 'solo') {
      s.shooter = seat;
      s.phase = 'open';
    } else if (s.phase === 'open' && s.shooter === null) {
      s.shooter = seat;
      events.push({ type: 'shooter', seat, why: 'first' });
      openWindow(s, ctx, events);
    }
    return { state: s, events };
  },

  seatLeaving(state, seat, ctx) {
    const s = structuredClone(state);
    const events: GameEvent[] = [];
    const back = takeDownRemovable(s, seat, events);
    if (live(s, seat) > 0) {
      if (!s.leaving.includes(seat)) {
        s.leaving.push(seat);
        events.push({ type: 'leaving', seat });
      }
    } else {
      delete s.bets[seat];
      s.leaving = s.leaving.filter((x) => x !== seat);
    }
    if (s.cfg.mode === 'multi' && s.phase === 'open' && s.shooter === seat) {
      s.shooter = nextShooter(s, ctx, seat, { exclude: seat });
      events.push({ type: 'shooter', seat: s.shooter, why: 'left' });
      if (s.shooter !== null) openWindow(s, ctx, events);
    }
    houseRolls(s, ctx, events);
    return { state: s, events, chips: back > 0 ? [{ seat, payout: back }] : [] };
  },

  liveBets(state, seat) {
    return live(state, seat);
  },

  view(state) {
    return {
      point: state.point,
      phase: state.phase,
      shooter: state.shooter,
      rolls: state.rolls,
      pointsMade: state.pointsMade,
      history: state.history,
      bets: state.bets,
      pauseUntil: state.pauseUntil,
      rollBy: state.rollBy,
      pauseOver: state.pauseOver,
      rollRequested: state.rollRequested,
      leaving: state.leaving,
      lay: state.cfg.options.lay === true,
    };
  },
};
