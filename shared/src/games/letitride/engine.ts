// Let It Ride: three equal bets against the pay table, two of which you may pull back, plus the
// 3-Card Bonus side bet, dealt from a fresh deck every round. There is no dealer hand to beat:
// your three cards and the two community cards make one five-card hand, and a pair of tens or
// better pays every bet still riding. The rules, pay tables and odds are in
// docs/rules/table-games.md (Let It Ride); the hand ranks and settlement live in rules.ts so the
// tests check the same code.
//
// Solo: set the bet (it goes on all three circles) and the 3-Card Bonus if you like, Deal, look at
// your three cards and let bet 1 ride or pull it back; the dealer turns the first community card
// and you decide bet 2 the same way; the dealer turns the second and every bet still riding is
// paid or taken. Multiplayer (up to 7): once the leader starts the table a 15 second betting window
// opens, closing early when every connected player is ready; everyone with a bet gets three cards;
// everyone decides bet 1 at once within 15 seconds, then bet 2 (the clock pulls a bet back for a
// player who doesn't answer, the safe choice); the results stay up for 6 seconds and the next
// window opens.
//
// Several hands (solo only): a solo player can play up to three hands from one stack, each with
// its own bets and decisions, all against the round's two community cards.

import type { Card } from '../../cards.ts';
import { type Cents, type BetLimits, DOLLAR, checkBet, formatMoney, isCents } from '../../money.ts';
import type { EngineCtx, GameEngine, Step, Refusal, TableConfig, TableMode, ChipMove, RoundResult, GameEvent } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { isObj } from '../../protocol.ts';
import * as S from '../spots.ts';
import { DEFAULT_PAYTABLE, dealHands, paytableOf, settle, type Settlement } from './rules.ts';
import type { Decision, LetItRideAction, LetItRideEvent, LetItRideView, Phase, SeatView } from './protocol.ts';

export const BETTING_MS = 15_000;
/** Each of the two decisions. */
export const DECISION_MS = 15_000;
export const RESULTS_MS = 6_000;
/** How many hands one solo player may play at once. */
export const MAX_SPOTS = 3;
/** Spots a table has: one per seat. */
const SEATS = 7;

interface Hand {
  cards: Card[];
  first: Decision;
  second: Decision | null;
  /** Turned over for everyone at settlement. */
  shown: boolean;
}

export interface LetItRideState {
  cfg: TableConfig;
  phase: Phase;
  round: number;
  /** When the current betting window, decision or results display ends (multiplayer only). */
  deadline: number | null;
  /** Each spot's bets: `unit` on each of the three circles, and the 3-Card Bonus. */
  bets: Record<number, { unit: Cents; bonus: Cents }>;
  hands: Record<number, Hand>;
  /** The two community cards once dealt; each hidden from every view until turned over. */
  board: Card[];
  /** How many of the community cards are turned over. */
  revealed: number;
  results: Record<number, Settlement>;
  /** Seats already marked ready when this betting window opened (see Three Card Poker's engine). */
  staleReady: number[];
  /** How many hands a seat plays, when it's more than one (solo tables only). Kept between rounds. */
  spotCount: Record<number, number>;
}

export function spotsOf(s: Pick<LetItRideState, 'cfg' | 'spotCount'>, seat: number): number[] {
  return S.spotsOf(s.cfg, s.spotCount, seat);
}

function owns(s: Pick<LetItRideState, 'cfg'>, seat: number, spot: number): boolean {
  return S.owns(s.cfg, seat, spot);
}

const NO_BETS = { unit: 0, bonus: 0 };

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'letitride',
    variant: '',
    mode,
    maxSeats: mode === 'solo' ? 1 : SEATS,
    // a hundred times the three bets' maximum, as at every table (shared/src/limits.ts scales it)
    buyIn: { min: 100 * DOLLAR, max: 100_000 * DOLLAR },
    limits: {
      default: { min: 10 * DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR },
      bet: { min: 10 * DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR },
      bonus: { min: 5 * DOLLAR, max: 250 * DOLLAR, step: DOLLAR },
    },
    options: { hand: [...DEFAULT_PAYTABLE.hand], bonus: [...DEFAULT_PAYTABLE.bonus] },
  };
}

function parseAction(raw: unknown): LetItRideAction | null {
  if (!isObj(raw)) return null;
  const spot = S.optIndex(raw.spot, SEATS);
  if (spot === false) return null;
  const at = spot === undefined ? {} : { spot };
  switch (raw.type) {
    case 'bet': {
      const unit = raw.unit ?? 0;
      const bonus = raw.bonus ?? 0;
      if (!isCents(unit) || !isCents(bonus)) return null;
      return { type: 'bet', unit, bonus, ...at };
    }
    case 'deal':
      return { type: 'deal' };
    case 'spots': {
      const n = S.spotCount(raw.n, MAX_SPOTS);
      return n === null ? null : { type: 'spots', n };
    }
    case 'ride':
    case 'pull':
      return { type: raw.type, ...at };
    default:
      return null;
  }
}

function limitsFor(cfg: TableConfig, kind: 'bet' | 'bonus'): BetLimits {
  return cfg.limits[kind] ?? cfg.limits.default;
}

function seatList(rec: Record<number, unknown>): number[] {
  return Object.keys(rec)
    .map(Number)
    .sort((a, b) => a - b);
}

function push(events: GameEvent[], e: LetItRideEvent): void {
  events.push(e);
}

const deciding = (s: LetItRideState): boolean => s.phase === 'first' || s.phase === 'second';

/** The decision a hand has up now, at `first` or `second`. */
function upNow(s: LetItRideState, h: Hand): Decision | null {
  return s.phase === 'first' ? h.first : s.phase === 'second' ? h.second : null;
}

function anyPending(s: LetItRideState): boolean {
  return Object.values(s.hands).some((h) => upNow(s, h) === 'pending');
}

/** What a hand still has riding: the circles not pulled back, and the 3-Card Bonus. */
function riding(s: LetItRideState, spot: number): Cents {
  const b = s.bets[spot];
  const h = s.hands[spot];
  if (!b) return 0;
  if (!h) return 3 * b.unit + b.bonus;
  const pulled = (h.first === 'pull' ? 1 : 0) + (h.second === 'pull' ? 1 : 0);
  return (3 - pulled) * b.unit + b.bonus;
}

function openRound(s: LetItRideState, ctx: EngineCtx, events: GameEvent[]): void {
  s.phase = 'betting';
  s.round++;
  s.bets = {};
  s.hands = {};
  s.board = [];
  s.revealed = 0;
  s.results = {};
  s.deadline = ctx.mode === 'multi' ? ctx.now + BETTING_MS : null;
  s.staleReady = ctx.mode === 'multi' ? ctx.seats.filter((x) => x.ready).map((x) => x.seat) : [];
  push(events, { type: 'betting', round: s.round, deadline: s.deadline });
}

function goIdle(s: LetItRideState, events: GameEvent[]): void {
  s.phase = 'idle';
  s.deadline = null;
  s.bets = {};
  s.hands = {};
  s.board = [];
  s.revealed = 0;
  s.results = {};
  s.staleReady = [];
  push(events, { type: 'idle' });
}

/** Set one of a seat's hands' bets to these totals, moving only the difference. */
function placeBets(state: LetItRideState, seat: number, spot: number, stack: Cents, unit: Cents, bonus: Cents, ctx: EngineCtx): Step<LetItRideState> | Refusal {
  if (deciding(state)) return refuse('WRONG_PHASE', 'Cards are out: finish this hand first.');
  if (state.phase !== 'betting' && ctx.mode === 'multi') return refuse('WRONG_PHASE', 'Betting opens with the next hand.');
  if (!spotsOf(state, seat).includes(spot)) return refuse('BAD_REQUEST', "That spot isn't one of yours.");
  const betting = state.phase === 'betting';
  const cur = betting ? (state.bets[spot] ?? NO_BETS) : NO_BETS;
  if (unit === cur.unit && bonus === cur.bonus) return { state, events: [] };
  if (bonus > 0 && unit === 0) return refuse('BAD_REQUEST', 'The 3-Card Bonus goes with the three bets.');
  const betLimits = limitsFor(state.cfg, 'bet');
  const bonusLimits = limitsFor(state.cfg, 'bonus');
  if (unit > 0 && checkBet(unit, betLimits)) return refuse('LIMIT', `Each bet is ${formatMoney(betLimits.min)} to ${formatMoney(betLimits.max)}.`);
  if (bonus > 0 && checkBet(bonus, bonusLimits)) return refuse('LIMIT', `The 3-Card Bonus is ${formatMoney(bonusLimits.min)} to ${formatMoney(bonusLimits.max)}.`);
  const delta = 3 * unit + bonus - 3 * cur.unit - cur.bonus;
  if (delta > stack) return refuse('NOT_ENOUGH_CHIPS', unit > cur.unit ? `Three bets of ${formatMoney(unit)} are more than your stack.` : 'That bet is more than your stack.');

  const s = structuredClone(state);
  const events: GameEvent[] = [];
  // Solo tables start the next round with the first bet after a result.
  if (s.phase !== 'betting') openRound(s, ctx, events);
  if (unit === 0 && bonus === 0) delete s.bets[spot];
  else s.bets[spot] = { unit, bonus };
  s.staleReady = s.staleReady.filter((x) => x !== seat);
  push(events, { type: 'bets', seat: spot, unit, bonus });
  const chips: ChipMove[] = delta > 0 ? [{ seat, bet: delta }] : delta < 0 ? [{ seat, payout: -delta }] : [];
  return { state: s, events, chips };
}

/** Solo: play `n` hands from the next deal on (sticky until changed). */
function setSpots(state: LetItRideState, seat: number, n: number, ctx: EngineCtx): Step<LetItRideState> | Refusal {
  if (ctx.mode !== 'solo') return refuse('WRONG_PHASE', 'One hand each at a shared table.');
  if (deciding(state)) return refuse('WRONG_PHASE', 'Cards are out: finish this hand first.');
  if ((state.spotCount[seat] ?? 1) === n) return { state, events: [] };
  const s = structuredClone(state);
  const events: GameEvent[] = [];
  let back = 0;
  if (s.phase === 'betting') {
    for (const spot of spotsOf(s, seat)) {
      const b = s.bets[spot];
      if (spot < n || !b) continue;
      back += 3 * b.unit + b.bonus;
      delete s.bets[spot];
      push(events, { type: 'bets', seat: spot, unit: 0, bonus: 0 });
    }
  }
  if (n === 1) delete s.spotCount[seat];
  else s.spotCount[seat] = n;
  push(events, { type: 'spots', seat, n });
  return back > 0 ? { state: s, events, chips: [{ seat, payout: back }] } : { state: s, events };
}

/** Three cards to every spot with a bet and two face down in the middle; the result is fixed here. */
function deal(s: LetItRideState, ctx: EngineCtx): Step<LetItRideState> {
  const events: GameEvent[] = [];
  const chips: ChipMove[] = [];
  // A bet from someone whose connection dropped during the window comes back.
  if (ctx.mode === 'multi') {
    for (const seat of seatList(s.bets)) {
      const who = seatOf(ctx, seat);
      if (who && !who.connected) {
        const b = s.bets[seat]!;
        delete s.bets[seat];
        chips.push({ seat, payout: 3 * b.unit + b.bonus });
        push(events, { type: 'bets', seat, unit: 0, bonus: 0 });
      }
    }
    if (Object.keys(s.bets).length === 0) {
      openRound(s, ctx, events);
      return { state: s, events, chips };
    }
  }
  const spots = seatList(s.bets);
  const dealt = dealHands(ctx.rng, spots.length);
  s.board = dealt.board;
  s.revealed = 0;
  push(events, { type: 'deal', seats: spots });
  spots.forEach((spot, i) => {
    const cards = dealt.hands[i]!;
    s.hands[spot] = { cards, first: 'pending', second: null, shown: false };
    push(events, { type: 'hand', to: S.owner(ctx, spot), seat: spot, cards: [...cards] });
  });
  s.phase = 'first';
  s.deadline = ctx.mode === 'multi' ? ctx.now + DECISION_MS : null;
  push(events, { type: 'decide', bet: 1, deadline: s.deadline });
  return { state: s, events, chips };
}

/** One hand lets the bet up now ride, or pulls it back to the stack. */
function decide(s: LetItRideState, spot: number, choice: 'ride' | 'pull', auto: boolean, ctx: EngineCtx, events: GameEvent[], chips: ChipMove[]): void {
  const h = s.hands[spot]!;
  const bet: 1 | 2 = s.phase === 'first' ? 1 : 2;
  if (bet === 1) h.first = choice;
  else h.second = choice;
  const back = choice === 'pull' ? s.bets[spot]!.unit : 0;
  if (back > 0) chips.push({ seat: S.owner(ctx, spot), payout: back });
  push(events, auto ? { type: 'decision', seat: spot, bet, choice, back, auto: true } : { type: 'decision', seat: spot, bet, choice, back });
}

/**
 * Once every hand has decided: after bet 1 the first community card turns over and bet 2 is up;
 * after bet 2 the second turns over and everything settles.
 */
function advance(s: LetItRideState, ctx: EngineCtx, events: GameEvent[], chips: ChipMove[], rounds: RoundResult[]): void {
  if (anyPending(s)) return;
  if (s.phase === 'first') {
    s.revealed = 1;
    push(events, { type: 'board', index: 0, card: s.board[0]! });
    for (const h of Object.values(s.hands)) h.second = 'pending';
    s.phase = 'second';
    s.deadline = ctx.mode === 'multi' ? ctx.now + DECISION_MS : null;
    push(events, { type: 'decide', bet: 2, deadline: s.deadline });
    return;
  }
  if (s.phase === 'second') settleAll(s, ctx, events, chips, rounds);
}

/** The second community card turns over; every hand is shown and paid, first seat first. */
function settleAll(s: LetItRideState, ctx: EngineCtx, events: GameEvent[], chips: ChipMove[], rounds: RoundResult[]): void {
  const pay = paytableOf(s.cfg.options);
  s.revealed = 2;
  push(events, { type: 'board', index: 1, card: s.board[1]! });
  for (const spot of seatList(s.hands)) {
    const h = s.hands[spot]!;
    const b = s.bets[spot]!;
    h.shown = true;
    push(events, { type: 'show', seat: spot, cards: [...h.cards] });
    const r = settle(b.unit, [h.first === 'pull', h.second === 'pull'], b.bonus, [...h.cards, ...s.board], pay);
    s.results[spot] = r;
    if (r.returned > 0) chips.push({ seat: S.owner(ctx, spot), payout: r.returned });
    rounds.push(S.roundOf(ctx, spot, r.wagered, r.returned));
    push(events, { type: 'result', seat: spot, result: r });
  }
  s.phase = 'results';
  s.deadline = ctx.mode === 'multi' ? ctx.now + RESULTS_MS : null;
}

export const engine: GameEngine<LetItRideState, LetItRideAction, LetItRideView> = {
  id: 'letitride',
  stateVersion: 1,
  seats: { min: 1, max: SEATS, multiplayer: true },
  config,

  create(cfg) {
    return { cfg, phase: 'idle', round: 0, deadline: null, bets: {}, hands: {}, board: [], revealed: 0, results: {}, staleReady: [], spotCount: {} };
  },

  parseAction,

  act(state, seat, action, ctx): Step<LetItRideState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Take a seat first.');

    if (action.type === 'bet') return placeBets(state, seat, action.spot ?? spotsOf(state, seat)[0]!, me.stack, action.unit, action.bonus, ctx);
    if (action.type === 'spots') return setSpots(state, seat, action.n, ctx);

    if (action.type === 'deal') {
      if (ctx.mode === 'multi') return refuse('WRONG_PHASE', 'The dealer deals when betting closes.');
      if (state.phase !== 'betting' || Object.keys(state.bets).length === 0) return refuse('WRONG_PHASE', 'Place your bets first.');
      return deal(structuredClone(state), ctx);
    }

    // ride or pull, on the hand named or the first of this seat's still deciding
    const spot = action.spot ?? seatList(state.hands).find((x) => owns(state, seat, x) && upNow(state, state.hands[x]!) === 'pending') ?? seat;
    if (!owns(state, seat, spot)) return refuse('NOT_YOUR_TURN', "That isn't your hand.");
    const h = deciding(state) ? state.hands[spot] : undefined;
    if (!h) return refuse('WRONG_PHASE', 'There is no bet to decide right now.');
    if (upNow(state, h) !== 'pending') return refuse('WRONG_PHASE', 'This bet is already decided.');
    const s = structuredClone(state);
    const events: GameEvent[] = [];
    const chips: ChipMove[] = [];
    const rounds: RoundResult[] = [];
    decide(s, spot, action.type, false, ctx, events, chips);
    advance(s, ctx, events, chips, rounds);
    return { state: s, events, chips, rounds };
  },

  tick(state, ctx) {
    if (ctx.mode !== 'multi' || !ctx.started) return null;
    if (state.phase === 'idle') {
      if (ctx.seats.length === 0) return null;
      const s = structuredClone(state);
      const events: GameEvent[] = [];
      openRound(s, ctx, events);
      return { state: s, events };
    }
    const due = state.deadline !== null && ctx.now >= state.deadline;
    if (state.phase === 'betting') {
      const stale = state.staleReady.filter((seat) => ctx.seats.some((x) => x.seat === seat && x.ready));
      const bettors = Object.keys(state.bets).length;
      const allReady =
        bettors > 0 && ctx.seats.some((x) => x.connected) && ctx.seats.every((x) => !x.connected || (x.ready && !stale.includes(x.seat)));
      if (!due && !allReady) {
        return stale.length === state.staleReady.length ? null : { state: { ...state, staleReady: stale }, events: [] };
      }
      const s = structuredClone(state);
      s.staleReady = [];
      if (bettors === 0) {
        const events: GameEvent[] = [];
        if (ctx.seats.length === 0) goIdle(s, events);
        else openRound(s, ctx, events);
        return { state: s, events };
      }
      return deal(s, ctx);
    }
    if (!due) return null;
    const s = structuredClone(state);
    const events: GameEvent[] = [];
    if (deciding(s)) {
      // the clock pulls back every bet still waiting: the choice that risks nothing more
      const chips: ChipMove[] = [];
      const rounds: RoundResult[] = [];
      for (const spot of seatList(s.hands)) if (upNow(s, s.hands[spot]!) === 'pending') decide(s, spot, 'pull', true, ctx, events, chips);
      advance(s, ctx, events, chips, rounds);
      return { state: s, events, chips, rounds };
    }
    if (ctx.seats.length === 0) goIdle(s, events);
    else openRound(s, ctx, events);
    return { state: s, events };
  },

  deadline(state) {
    return state.deadline;
  },

  shiftDeadlines(state, ms) {
    if (state.deadline === null) return state;
    return { ...state, deadline: state.deadline + ms };
  },

  seatJoined(state, seat) {
    // Whatever this round still keeps under the seat's spots is the last occupant's: clear it, so
    // the newcomer never sees a hand nobody else was shown.
    const keys = [...Object.keys(state.hands), ...Object.keys(state.bets), ...Object.keys(state.results)].map(Number);
    const left = [...new Set(keys)].filter((spot) => owns(state, seat, spot));
    if (left.length === 0) return { state, events: [] };
    const s = structuredClone(state);
    for (const spot of left) {
      delete s.hands[spot];
      delete s.bets[spot];
      delete s.results[spot];
    }
    return { state: s, events: [] };
  },

  seatLeaving(state, seat, ctx) {
    const mine = seatList(state.bets).filter((spot) => owns(state, seat, spot));
    // Bets not yet dealt come back.
    if (state.phase === 'betting' && mine.length > 0) {
      const s = structuredClone(state);
      let back = 0;
      const events: GameEvent[] = [];
      for (const spot of mine) {
        const b = s.bets[spot]!;
        back += 3 * b.unit + b.bonus;
        delete s.bets[spot];
        push(events, { type: 'bets', seat: spot, unit: 0, bonus: 0 });
      }
      s.staleReady = s.staleReady.filter((x) => x !== seat);
      return { state: s, events, chips: [{ seat, payout: back }] };
    }
    // A bet still waiting is pulled back, as the clock would; what can't be pulled (the $ bet, and
    // bets already let ride) stays until the dealer settles it. Alone at the table, that is now.
    if (deciding(state) && mine.some((spot) => state.hands[spot] && upNow(state, state.hands[spot]) === 'pending')) {
      const s = structuredClone(state);
      const events: GameEvent[] = [];
      const chips: ChipMove[] = [];
      const rounds: RoundResult[] = [];
      for (let pass = 0; pass < 2 && deciding(s); pass++) {
        const waiting = mine.filter((spot) => s.hands[spot] && upNow(s, s.hands[spot]) === 'pending');
        if (waiting.length === 0) break;
        for (const spot of waiting) decide(s, spot, 'pull', true, ctx, events, chips);
        advance(s, ctx, events, chips, rounds);
      }
      return { state: s, events, chips, rounds };
    }
    return { state, events: [] };
  },

  liveBets(state, seat) {
    let live = 0;
    for (const spot of seatList(state.bets)) {
      if (!owns(state, seat, spot)) continue;
      if (state.phase === 'betting' || deciding(state)) live += riding(state, spot);
    }
    return live;
  },

  view(state, viewer) {
    const seats: Record<number, SeatView> = {};
    for (const spot of seatList(state.bets)) {
      const b = state.bets[spot]!;
      const h = state.hands[spot];
      const open = !!h && ((viewer !== null && owns(state, viewer, spot)) || h.shown);
      seats[spot] = {
        unit: b.unit,
        bonus: b.bonus,
        cards: h ? (open ? [...h.cards] : [null, null, null]) : [],
        first: h ? h.first : null,
        second: h ? h.second : null,
        result: state.results[spot] ?? null,
      };
    }
    return {
      phase: state.phase,
      round: state.round,
      deadline: state.deadline,
      seats,
      mine: viewer === null ? [] : spotsOf(state, viewer),
      board: state.board.map((c, i) => (i < state.revealed ? c : null)),
      paytable: paytableOf(state.cfg.options),
    };
  },
};
