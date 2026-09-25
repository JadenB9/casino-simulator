// Bingo in the hall (docs/rules/parlour-games.md §1): cards on sale for a while, "Eyes down", then
// the caller draws balls on a clock and every card is checked as each one comes out. The hall runs
// itself like the Bandit Wheel: nobody presses Start, a game follows a game while anyone is
// seated. Alone, a sale waits for your first card, and Call starts the game at once.
//
// Money: a card's price comes off the stack when it is bought, and each prize is paid the moment
// the ball that completes it is called. A card is a bet until its game ends (it stays in play if
// its owner gets up), so a seat cashes out between games. Prizes are the fixed table in rules.ts,
// by pattern and call number, whoever else is playing.
//
// The ball order is drawn once, when the sale closes, after every card is dealt. It stays in the
// engine's state: views and events only ever carry the balls already called.

import { type Cents, DOLLAR, checkBet, formatMoney } from '../../money.ts';
import type { EngineCtx, GameEngine, Step, Refusal, TableConfig, TableMode, ChipMove, RoundResult, GameEvent, SeatCtx } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { type Card, type Pattern, PATTERNS, dealCard, drawOrder, callNumbers, completions, prizeMult, prizeFor, canStillWin, toGo, LAST_PRIZE, MAX_CALLS } from './rules.ts';
import { type BingoAction, type BingoView, type CardView, type GameSummary, type Phase, type PlayerView, type SeatResult, type Won, MAX_CARDS, parseAction } from './protocol.ts';

/** How long cards are on sale in a shared hall. */
export const BUY_MS = 25_000;
/** Alone, the sale runs this long after your first card (Call skips it). */
export const SOLO_BUY_MS = 10_000;
/** "Eyes down" to the first ball. */
export const LEAD_MS = 2_500;
/** Between balls, shared and alone. */
export const CALL_MS = 2_200;
export const SOLO_CALL_MS = 1_300;
/** The end of a game to the next sale. */
export const RESULTS_MS = 8_000;
export const SOLO_RESULTS_MS = 5_000;
export const HISTORY_LEN = 12;
export const MAX_SEATS = 40;

interface CardState {
  id: number;
  nums: Card;
  stake: Cents;
  won: Partial<Record<Pattern, Won>>;
}

interface SeatCards {
  account: number;
  cards: CardState[];
}

export interface BingoState {
  cfg: TableConfig;
  phase: Phase;
  round: number;
  deadline: number | null;
  nextCard: number;
  seats: Record<number, SeatCards>;
  /** The whole ball order, drawn when the sale closes. Never in a view or an event. */
  order: number[];
  /** How many balls are out: order[0..calls). */
  calls: number;
  /** seat -> what it bought last game (for Rebuy), and whose it was. */
  last: Record<number, { account: number; count: number; stake: Cents }>;
  results: Record<number, SeatResult>;
  history: GameSummary[];
}

export function windowFor(mode: TableMode): number {
  return mode === 'solo' ? SOLO_BUY_MS : BUY_MS;
}

export function callMsFor(mode: TableMode): number {
  return mode === 'solo' ? SOLO_CALL_MS : CALL_MS;
}

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'bingo',
    variant: '',
    mode,
    maxSeats: mode === 'solo' ? 1 : MAX_SEATS,
    // up to a hundred times the table maximum (shared/src/limits.ts scales it with the table)
    buyIn: { min: 10 * DOLLAR, max: 100_000 * DOLLAR },
    // the price of one card
    limits: { default: { min: DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR } },
    options: {},
  };
}

function cardView(c: CardState): CardView {
  return { id: c.id, nums: [...c.nums], stake: c.stake, won: { ...c.won } };
}

function staked(s: BingoState, seat: number): Cents {
  return (s.seats[seat]?.cards ?? []).reduce((n, c) => n + c.stake, 0);
}

function totalCards(s: BingoState): number {
  return Object.values(s.seats).reduce((n, x) => n + x.cards.length, 0);
}

function calledSet(s: BingoState): Set<number> {
  return new Set(s.order.slice(0, s.calls));
}

function openSale(s: BingoState, ctx: EngineCtx, events: GameEvent[]): void {
  s.phase = 'buying';
  s.round++;
  s.seats = {};
  s.order = [];
  s.calls = 0;
  s.results = {};
  // Alone the sale waits for your first card; a shared hall's clock starts now.
  s.deadline = s.cfg.mode === 'solo' ? null : ctx.now + BUY_MS;
  events.push({ type: 'buying', round: s.round, deadline: s.deadline });
}

function goIdle(s: BingoState): Step<BingoState> {
  s.phase = 'idle';
  s.deadline = null;
  s.seats = {};
  s.order = [];
  s.calls = 0;
  return { state: s, events: [{ type: 'idle' }] };
}

/** Deal `count` cards at `stake` each to a seat, checking the limits and the stack. */
function buy(s: BingoState, me: SeatCtx, count: number, stake: Cents, ctx: EngineCtx, what = 'Those cards'): Step<BingoState> | Refusal {
  const seat = me.seat;
  const lim = s.cfg.limits.default;
  const problem = checkBet(stake, lim);
  if (problem === 'NOT_CENTS') return refuse('BAD_REQUEST', 'Cards cost whole chips.');
  if (problem === 'BELOW_MIN') return refuse('LIMIT', `Cards here cost at least ${formatMoney(lim.min)}.`);
  if (problem === 'ABOVE_MAX') return refuse('LIMIT', `Cards here cost at most ${formatMoney(lim.max)}.`);
  // prizes are hundredths of the price, so a whole-dollar price keeps every prize in whole cents
  if (problem === 'OFF_STEP' || stake % DOLLAR !== 0) return refuse('LIMIT', `Card prices go in steps of ${formatMoney(Math.max(lim.step, DOLLAR))}.`);
  const have = s.seats[seat]?.cards.length ?? 0;
  if (have + count > MAX_CARDS) return refuse('LIMIT', have === 0 ? `Up to ${MAX_CARDS} cards a game.` : `Up to ${MAX_CARDS} cards a game; you have ${have}.`);
  const cost = stake * count;
  if (cost > me.stack) return refuse('NOT_ENOUGH_CHIPS', `${what} cost ${formatMoney(cost)}, more than your stack.`);
  const entry = s.seats[seat] ?? { account: me.accountId, cards: [] };
  const fresh: CardState[] = [];
  for (let i = 0; i < count; i++) fresh.push({ id: ++s.nextCard, nums: dealCard(ctx.rng), stake, won: {} });
  entry.cards = [...entry.cards, ...fresh];
  s.seats[seat] = entry;
  s.last[seat] = { account: me.accountId, count: entry.cards.length, stake };
  const events: GameEvent[] = [
    { type: 'cards', to: seat, seat, cards: fresh.map(cardView) },
    { type: 'bought', seat, cards: entry.cards.length, staked: staked(s, seat) },
  ];
  // Alone, the sale's clock starts with your first card.
  if (s.cfg.mode === 'solo' && s.deadline === null) {
    s.deadline = ctx.now + SOLO_BUY_MS;
    events.push({ type: 'buying', round: s.round, deadline: s.deadline });
  }
  return { state: s, events, chips: [{ seat, bet: cost }] };
}

/**
 * The most each of `count` cards can cost: the table maximum, or the stack shared between them,
 * in whole steps. Null (with the reason) when not even the minimum fits.
 */
export function maxStake(lim: { min: Cents; max: Cents; step: Cents }, stack: Cents, count: number): { stake: Cents } | { none: 'NO_CHIPS' } {
  const step = Math.max(lim.step, DOLLAR);
  let stake = Math.min(lim.max, Math.floor(stack / count));
  stake -= stake % step;
  if (stake < lim.min) return { none: 'NO_CHIPS' };
  return { stake };
}

/** The sale is over: draw the ball order and call the first ball after the lead-in. */
function eyesDown(s: BingoState, ctx: EngineCtx): Step<BingoState> {
  s.phase = 'calling';
  s.order = drawOrder(ctx.rng);
  s.calls = 0;
  const first = ctx.now + LEAD_MS;
  s.deadline = first;
  return { state: s, events: [{ type: 'eyesdown', round: s.round, cards: totalCards(s), first }] };
}

/** Call the next ball, pay whatever it completes, and end the game when nothing more can win. */
function callBall(s: BingoState, ctx: EngineCtx): Step<BingoState> {
  const n = ++s.calls;
  const ball = s.order[n - 1]!;
  const at = callNumbers(s.order);
  const events: GameEvent[] = [];
  const chips: ChipMove[] = [];
  const wins: GameEvent[] = [];
  for (const [seatStr, entry] of Object.entries(s.seats)) {
    const seat = Number(seatStr);
    const who = seatOf(ctx, seat);
    // A card is paid only to the player who bought it, and only while they're seated (a seat with
    // cards in play stays seated until its game ends, so this is a guard, never a forfeit).
    const payable = !!who && who.accountId === entry.account;
    let paid = 0;
    for (const card of entry.cards) {
      const done = completions(card.nums, at);
      for (const p of PATTERNS) {
        if (done[p] !== n || card.won[p]) continue;
        const mult = prizeMult(p, n);
        if (mult === 0) continue;
        const amount = prizeFor(p, n, card.stake);
        card.won[p] = { call: n, paid: amount };
        paid += amount;
        wins.push({ type: 'win', seat, card: card.id, pattern: p, call: n, mult, paid: amount });
      }
    }
    if (paid > 0 && payable) chips.push({ seat, payout: paid });
  }
  const called = calledSet(s);
  const open = Object.values(s.seats).some((e) => e.cards.some((c) => canStillWin(c.nums, called, n, c.won)));
  const over = n >= MAX_CALLS || !open;
  s.deadline = over ? null : ctx.now + callMsFor(s.cfg.mode);
  events.push({ type: 'ball', call: n, ball, next: s.deadline }, ...wins);
  if (!over) return { state: s, events, chips };
  return endGame(s, ctx, events, chips);
}

function endGame(s: BingoState, ctx: EngineCtx, events: GameEvent[], chips: ChipMove[]): Step<BingoState> {
  const rounds: RoundResult[] = [];
  const results: Record<number, SeatResult> = {};
  let top: GameSummary['top'] = null;
  for (const [seatStr, entry] of Object.entries(s.seats)) {
    const seat = Number(seatStr);
    let returned = 0;
    for (const c of entry.cards) {
      for (const p of PATTERNS) {
        const w = c.won[p];
        if (!w) continue;
        returned += w.paid;
        const mult = prizeMult(p, w.call);
        if (!top || mult > top.mult) top = { pattern: p, mult, call: w.call };
      }
    }
    const wagered = staked(s, seat);
    results[seat] = { wagered, returned };
    if (seatOf(ctx, seat)?.accountId === entry.account) rounds.push({ seat, wagered, returned });
  }
  s.history = [{ round: s.round, calls: s.calls, cards: totalCards(s), top }, ...s.history].slice(0, HISTORY_LEN);
  s.results = results;
  s.phase = 'results';
  s.deadline = ctx.now + (s.cfg.mode === 'solo' ? SOLO_RESULTS_MS : RESULTS_MS);
  // the rest of the order is never told; forget it
  s.order = s.order.slice(0, s.calls);
  events.push({ type: 'end', round: s.round, calls: s.calls, seats: results });
  return { state: s, events, chips, rounds };
}

function playerView(s: BingoState, seat: number, called: Set<number>): PlayerView {
  const entry = s.seats[seat]!;
  let won = 0;
  let best: number | null = null;
  for (const c of entry.cards) {
    for (const p of PATTERNS) {
      const w = c.won[p];
      if (w) {
        won += w.paid;
        continue;
      }
      if (s.phase === 'calling' && s.calls >= LAST_PRIZE[p]) continue;
      const need = toGo(c.nums, called, p);
      if (best === null || need < best) best = need;
    }
  }
  return { cards: entry.cards.length, staked: staked(s, seat), won, best };
}

export const engine: GameEngine<BingoState, BingoAction, BingoView> = {
  id: 'bingo',
  stateVersion: 1,
  seats: { min: 1, max: MAX_SEATS, multiplayer: true },
  config,

  create(cfg, ctx) {
    const s: BingoState = {
      cfg,
      phase: 'idle',
      round: 0,
      deadline: null,
      nextCard: 0,
      seats: {},
      order: [],
      calls: 0,
      last: {},
      results: {},
      history: [],
    };
    // A fresh state for a hall that already has players (a game voided by a new version) opens a sale.
    if (ctx.seats.length > 0) openSale(s, ctx, []);
    return s;
  },

  parseAction,

  act(state, seat, action, ctx): Step<BingoState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Take a seat first.');
    if (state.phase !== 'buying') {
      return refuse('WRONG_PHASE', state.phase === 'calling' ? 'Eyes down: cards for the next game go on sale when this one ends.' : 'Cards are not on sale yet.');
    }
    const s = structuredClone(state);
    const lim = s.cfg.limits.default;

    switch (action.type) {
      case 'buy':
        return buy(s, me, action.count, action.stake, ctx);
      case 'max': {
        const m = maxStake(lim, me.stack, action.count);
        if ('none' in m) return refuse('NOT_ENOUGH_CHIPS', `Cards start at ${formatMoney(lim.min)}; you have ${formatMoney(me.stack)}.`);
        return buy(s, me, action.count, m.stake, ctx, 'Max');
      }
      case 'rebuy': {
        if (s.seats[seat]?.cards.length) return refuse('BAD_REQUEST', 'You already have cards for this game.');
        const last = s.last[seat];
        if (!last || last.account !== me.accountId) return refuse('BAD_REQUEST', 'There are no cards to buy again yet.');
        return buy(s, me, last.count, last.stake, ctx, 'Rebuy');
      }
      case 'return': {
        const back = staked(s, seat);
        if (back === 0) return { state, events: [] };
        delete s.seats[seat];
        return { state: s, events: [{ type: 'returned', seat, refund: back }], chips: [{ seat, payout: back }] };
      }
      case 'call': {
        if (s.cfg.mode !== 'solo') return refuse('BAD_REQUEST', 'The caller starts when the clock runs out.');
        if (!s.seats[seat]?.cards.length) return refuse('WRONG_PHASE', 'Buy a card first.');
        return eyesDown(s, ctx);
      }
    }
  },

  tick(state, ctx) {
    if (state.phase === 'idle') {
      if (ctx.seats.length === 0) return null;
      const s = structuredClone(state);
      const events: GameEvent[] = [];
      openSale(s, ctx, events);
      return { state: s, events };
    }
    if (state.deadline === null || ctx.now < state.deadline) return null;
    const s = structuredClone(state);
    if (state.phase === 'buying') {
      // Everyone has gone (their cards came back as they left): the hall rests.
      if (ctx.seats.length === 0) return goIdle(s);
      // Nobody bought: the sale goes on.
      if (totalCards(s) === 0) {
        s.deadline = ctx.now + windowFor(s.cfg.mode);
        return { state: s, events: [{ type: 'buying', round: s.round, deadline: s.deadline }] };
      }
      return eyesDown(s, ctx);
    }
    if (state.phase === 'calling') return callBall(s, ctx);
    // results have stood long enough
    if (ctx.seats.length === 0) return goIdle(s);
    const events: GameEvent[] = [];
    openSale(s, ctx, events);
    return { state: s, events };
  },

  deadline(state) {
    return state.deadline;
  },

  shiftDeadlines(state, ms) {
    // The sale, the next ball and the pause after a game all wait for players coming back.
    if (state.deadline === null) return state;
    return { ...state, deadline: state.deadline + ms };
  },

  seatJoined(state, seat, ctx) {
    // A new player in this seat doesn't inherit the last player's Rebuy.
    const last = state.last[seat];
    const me = seatOf(ctx, seat);
    if (!last || (me && last.account === me.accountId)) return { state, events: [] };
    const s = structuredClone(state);
    delete s.last[seat];
    return { state: s, events: [] };
  },

  seatLeaving(state, seat) {
    // Cards bought for a game that hasn't started come back; once it has, they play to the end.
    if (state.phase !== 'buying' || !state.seats[seat]) return { state, events: [] };
    const back = staked(state, seat);
    const s = structuredClone(state);
    delete s.seats[seat];
    if (back === 0) return { state: s, events: [] };
    return { state: s, events: [{ type: 'returned', seat, refund: back }], chips: [{ seat, payout: back }] };
  },

  liveBets(state, seat) {
    return state.phase === 'buying' || state.phase === 'calling' ? staked(state, seat) : 0;
  },

  view(state, viewer) {
    const called = calledSet(state);
    const players: Record<number, PlayerView> = {};
    for (const seat of Object.keys(state.seats).map(Number)) players[seat] = playerView(state, seat, called);
    return {
      phase: state.phase,
      round: state.round,
      deadline: state.deadline,
      window: windowFor(state.cfg.mode),
      callMs: callMsFor(state.cfg.mode),
      called: state.order.slice(0, state.calls),
      mine: viewer === null ? null : (state.seats[viewer]?.cards ?? []).map(cardView),
      players,
      results: { ...state.results },
      history: state.history.map((h) => ({ ...h })),
      canRebuy: Object.keys(state.last).map(Number),
    };
  },
};
