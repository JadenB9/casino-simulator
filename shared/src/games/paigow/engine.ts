// Pai Gow Poker: seven cards from a 53-card deck with the joker, set into a five-card high hand
// and a two-card low hand, both against the dealer's, who sets by the house way. Win both and the
// bet pays even money less a 5% commission; win one and it pushes; a copy (a tie) goes to the
// dealer. The Fortune side bet pays on the best poker hand in the seven, however they're set. The
// rules, the house way, the pay table and the odds are in docs/rules/table-games.md (Pai Gow
// Poker); the hand ranks, the house way and settlement live in rules.ts so the tests check the
// same code. The dealer is always the banker: player banking isn't offered (see the rules page).
//
// Solo: set the bet (and the Fortune if you like), Deal, arrange the seven cards (or ask for the
// house way) and set the hand; the dealer turns over and sets theirs and the hand settles.
// Multiplayer (up to 6): once the leader starts the table a 15 second betting window opens,
// closing early when every connected player is ready; everyone with a bet gets seven cards and 40
// seconds to set them (the clock sets a hand still open by the house way); the dealer reveals,
// every seat settles, the results stay up for 6 seconds and the next window opens.
//
// Several hands (solo only): up to three, each with its own bets and its own seven cards, dealt
// from the round's one deck and each played against the dealer's hand.

import { type Cents, type BetLimits, DOLLAR, checkBet, formatMoney, isCents } from '../../money.ts';
import type { EngineCtx, GameEngine, Step, Refusal, TableConfig, TableMode, ChipMove, RoundResult, GameEvent } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { isInt, isObj } from '../../protocol.ts';
import * as S from '../spots.ts';
import { DEFAULT_FORTUNE, dealHands, fortunePaysOf, fouls, houseWay, settingOf, settle, type PgCard, type Setting, type Settlement } from './rules.ts';
import type { PaiGowAction, PaiGowEvent, PaiGowView, Phase, SeatView } from './protocol.ts';

export const BETTING_MS = 15_000;
/** Setting seven cards takes longer than a yes or no. */
export const SETTING_MS = 40_000;
export const RESULTS_MS = 6_000;
/** How many hands one solo player may play at once. */
export const MAX_SPOTS = 3;
const SEATS = 6;

interface Hand {
  cards: PgCard[];
  setting: Setting | null;
  /** Turned over for everyone at settlement. */
  shown: boolean;
}

export interface PaiGowState {
  cfg: TableConfig;
  phase: Phase;
  round: number;
  deadline: number | null;
  bets: Record<number, { bet: Cents; fortune: Cents }>;
  hands: Record<number, Hand>;
  /** The dealer's seven once dealt; hidden from every view until `revealed`. */
  dealer: PgCard[];
  revealed: boolean;
  /** The dealer's hand set by the house way, once revealed. */
  dealerSetting: Setting | null;
  results: Record<number, Settlement>;
  /** Seats already marked ready when this betting window opened (see Three Card Poker's engine). */
  staleReady: number[];
  spotCount: Record<number, number>;
}

export function spotsOf(s: Pick<PaiGowState, 'cfg' | 'spotCount'>, seat: number): number[] {
  return S.spotsOf(s.cfg, s.spotCount, seat);
}

function owns(s: Pick<PaiGowState, 'cfg'>, seat: number, spot: number): boolean {
  return S.owns(s.cfg, seat, spot);
}

const NO_BETS = { bet: 0, fortune: 0 };

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'paigow',
    variant: '',
    mode,
    maxSeats: mode === 'solo' ? 1 : SEATS,
    buyIn: { min: 100 * DOLLAR, max: 100_000 * DOLLAR },
    limits: {
      default: { min: 10 * DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR },
      bet: { min: 10 * DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR },
      fortune: { min: 5 * DOLLAR, max: 100 * DOLLAR, step: DOLLAR },
    },
    options: { fortune: [...DEFAULT_FORTUNE] },
  };
}

function parseAction(raw: unknown): PaiGowAction | null {
  if (!isObj(raw)) return null;
  const spot = S.optIndex(raw.spot, SEATS);
  if (spot === false) return null;
  const at = spot === undefined ? {} : { spot };
  switch (raw.type) {
    case 'bet': {
      const bet = raw.bet ?? 0;
      const fortune = raw.fortune ?? 0;
      if (!isCents(bet) || !isCents(fortune)) return null;
      return { type: 'bet', bet, fortune, ...at };
    }
    case 'deal':
      return { type: 'deal' };
    case 'spots': {
      const n = S.spotCount(raw.n, MAX_SPOTS);
      return n === null ? null : { type: 'spots', n };
    }
    case 'set': {
      const low = raw.low;
      if (!Array.isArray(low) || low.length !== 2) return null;
      const [i, j] = low as unknown[];
      if (!isInt(i) || !isInt(j) || i < 0 || j < 0 || i > 6 || j > 6 || i === j) return null;
      return { type: 'set', low: i < j ? [i, j] : [j, i], ...at };
    }
    default:
      return null;
  }
}

function limitsFor(cfg: TableConfig, kind: 'bet' | 'fortune'): BetLimits {
  return cfg.limits[kind] ?? cfg.limits.default;
}

function seatList(rec: Record<number, unknown>): number[] {
  return Object.keys(rec)
    .map(Number)
    .sort((a, b) => a - b);
}

function push(events: GameEvent[], e: PaiGowEvent): void {
  events.push(e);
}

function anyOpen(s: PaiGowState): boolean {
  return Object.values(s.hands).some((h) => h.setting === null);
}

function openRound(s: PaiGowState, ctx: EngineCtx, events: GameEvent[]): void {
  s.phase = 'betting';
  s.round++;
  s.bets = {};
  s.hands = {};
  s.dealer = [];
  s.revealed = false;
  s.dealerSetting = null;
  s.results = {};
  s.deadline = ctx.mode === 'multi' ? ctx.now + BETTING_MS : null;
  s.staleReady = ctx.mode === 'multi' ? ctx.seats.filter((x) => x.ready).map((x) => x.seat) : [];
  push(events, { type: 'betting', round: s.round, deadline: s.deadline });
}

function goIdle(s: PaiGowState, events: GameEvent[]): void {
  s.phase = 'idle';
  s.deadline = null;
  s.bets = {};
  s.hands = {};
  s.dealer = [];
  s.revealed = false;
  s.dealerSetting = null;
  s.results = {};
  s.staleReady = [];
  push(events, { type: 'idle' });
}

function placeBets(state: PaiGowState, seat: number, spot: number, stack: Cents, bet: Cents, fortune: Cents, ctx: EngineCtx): Step<PaiGowState> | Refusal {
  if (state.phase === 'setting') return refuse('WRONG_PHASE', 'Cards are out: set this hand first.');
  if (state.phase !== 'betting' && ctx.mode === 'multi') return refuse('WRONG_PHASE', 'Betting opens with the next hand.');
  if (!spotsOf(state, seat).includes(spot)) return refuse('BAD_REQUEST', "That spot isn't one of yours.");
  const betting = state.phase === 'betting';
  const cur = betting ? (state.bets[spot] ?? NO_BETS) : NO_BETS;
  if (bet === cur.bet && fortune === cur.fortune) return { state, events: [] };
  if (fortune > 0 && bet === 0) return refuse('BAD_REQUEST', 'The Fortune bonus goes with a bet on the hand.');
  const betLimits = limitsFor(state.cfg, 'bet');
  const fortuneLimits = limitsFor(state.cfg, 'fortune');
  if (bet > 0 && checkBet(bet, betLimits)) return refuse('LIMIT', `The bet is ${formatMoney(betLimits.min)} to ${formatMoney(betLimits.max)}.`);
  if (fortune > 0 && checkBet(fortune, fortuneLimits)) return refuse('LIMIT', `The Fortune bonus is ${formatMoney(fortuneLimits.min)} to ${formatMoney(fortuneLimits.max)}.`);
  const delta = bet + fortune - cur.bet - cur.fortune;
  if (delta > stack) return refuse('NOT_ENOUGH_CHIPS', 'That bet is more than your stack.');

  const s = structuredClone(state);
  const events: GameEvent[] = [];
  if (s.phase !== 'betting') openRound(s, ctx, events);
  if (bet === 0 && fortune === 0) delete s.bets[spot];
  else s.bets[spot] = { bet, fortune };
  s.staleReady = s.staleReady.filter((x) => x !== seat);
  push(events, { type: 'bets', seat: spot, bet, fortune });
  const chips: ChipMove[] = delta > 0 ? [{ seat, bet: delta }] : delta < 0 ? [{ seat, payout: -delta }] : [];
  return { state: s, events, chips };
}

function setSpots(state: PaiGowState, seat: number, n: number, ctx: EngineCtx): Step<PaiGowState> | Refusal {
  if (ctx.mode !== 'solo') return refuse('WRONG_PHASE', 'One hand each at a shared table.');
  if (state.phase === 'setting') return refuse('WRONG_PHASE', 'Cards are out: set this hand first.');
  if ((state.spotCount[seat] ?? 1) === n) return { state, events: [] };
  const s = structuredClone(state);
  const events: GameEvent[] = [];
  let back = 0;
  if (s.phase === 'betting') {
    for (const spot of spotsOf(s, seat)) {
      const b = s.bets[spot];
      if (spot < n || !b) continue;
      back += b.bet + b.fortune;
      delete s.bets[spot];
      push(events, { type: 'bets', seat: spot, bet: 0, fortune: 0 });
    }
  }
  if (n === 1) delete s.spotCount[seat];
  else s.spotCount[seat] = n;
  push(events, { type: 'spots', seat, n });
  return back > 0 ? { state: s, events, chips: [{ seat, payout: back }] } : { state: s, events };
}

function deal(s: PaiGowState, ctx: EngineCtx): Step<PaiGowState> {
  const events: GameEvent[] = [];
  const chips: ChipMove[] = [];
  if (ctx.mode === 'multi') {
    for (const seat of seatList(s.bets)) {
      const who = seatOf(ctx, seat);
      if (who && !who.connected) {
        const b = s.bets[seat]!;
        delete s.bets[seat];
        chips.push({ seat, payout: b.bet + b.fortune });
        push(events, { type: 'bets', seat, bet: 0, fortune: 0 });
      }
    }
    if (Object.keys(s.bets).length === 0) {
      openRound(s, ctx, events);
      return { state: s, events, chips };
    }
  }
  const spots = seatList(s.bets);
  const dealt = dealHands(ctx.rng, spots.length);
  s.dealer = dealt.dealer;
  s.revealed = false;
  push(events, { type: 'deal', seats: spots });
  spots.forEach((spot, i) => {
    const cards = dealt.hands[i]!;
    s.hands[spot] = { cards, setting: null, shown: false };
    push(events, { type: 'hand', to: S.owner(ctx, spot), seat: spot, cards: [...cards] });
  });
  s.phase = 'setting';
  s.deadline = ctx.mode === 'multi' ? ctx.now + SETTING_MS : null;
  push(events, { type: 'setting', deadline: s.deadline });
  return { state: s, events, chips };
}

/** The dealer turns over and sets by the house way; every hand is shown and paid, first seat first. */
function settleAll(s: PaiGowState, ctx: EngineCtx, events: GameEvent[], chips: ChipMove[], rounds: RoundResult[]): void {
  const pay = fortunePaysOf(s.cfg.options);
  const dealer = houseWay(s.dealer);
  s.revealed = true;
  s.dealerSetting = dealer;
  push(events, { type: 'reveal', dealer: [...s.dealer], setting: dealer });
  for (const spot of seatList(s.hands)) {
    const h = s.hands[spot]!;
    const b = s.bets[spot]!;
    h.shown = true;
    push(events, { type: 'show', seat: spot, cards: [...h.cards], setting: h.setting! });
    const r = settle(b, h.setting!, dealer, h.cards, pay);
    s.results[spot] = r;
    if (r.returned > 0) chips.push({ seat: S.owner(ctx, spot), payout: r.returned });
    rounds.push(S.roundOf(ctx, spot, r.wagered, r.returned));
    push(events, { type: 'result', seat: spot, result: r });
  }
  s.phase = 'results';
  s.deadline = ctx.mode === 'multi' ? ctx.now + RESULTS_MS : null;
}

/** Set every hand still open (of `only`, or all) by the house way. */
function houseWayForOpen(s: PaiGowState, events: GameEvent[], only?: (spot: number) => boolean): void {
  for (const spot of seatList(s.hands)) {
    const h = s.hands[spot]!;
    if (h.setting || (only && !only(spot))) continue;
    h.setting = houseWay(h.cards);
    push(events, { type: 'set', seat: spot, auto: true });
  }
}

export const engine: GameEngine<PaiGowState, PaiGowAction, PaiGowView> = {
  id: 'paigow',
  stateVersion: 1,
  seats: { min: 1, max: SEATS, multiplayer: true },
  config,

  create(cfg) {
    return { cfg, phase: 'idle', round: 0, deadline: null, bets: {}, hands: {}, dealer: [], revealed: false, dealerSetting: null, results: {}, staleReady: [], spotCount: {} };
  },

  parseAction,

  act(state, seat, action, ctx): Step<PaiGowState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Take a seat first.');

    if (action.type === 'bet') return placeBets(state, seat, action.spot ?? spotsOf(state, seat)[0]!, me.stack, action.bet, action.fortune, ctx);
    if (action.type === 'spots') return setSpots(state, seat, action.n, ctx);

    if (action.type === 'deal') {
      if (ctx.mode === 'multi') return refuse('WRONG_PHASE', 'The dealer deals when betting closes.');
      if (state.phase !== 'betting' || Object.keys(state.bets).length === 0) return refuse('WRONG_PHASE', 'Place a bet first.');
      return deal(structuredClone(state), ctx);
    }

    // set: the hand named, or the first of this seat's still open
    const spot = action.spot ?? seatList(state.hands).find((x) => owns(state, seat, x) && state.hands[x]!.setting === null) ?? seat;
    if (!owns(state, seat, spot)) return refuse('NOT_YOUR_TURN', "That isn't your hand.");
    const h = state.phase === 'setting' ? state.hands[spot] : undefined;
    if (!h) return refuse('WRONG_PHASE', 'There is no hand to set right now.');
    if (h.setting) return refuse('WRONG_PHASE', 'This hand is already set.');
    const setting = settingOf(h.cards, action.low);
    if (fouls(setting)) return refuse('BAD_REQUEST', 'The five-card hand has to beat the two-card hand.');
    const s = structuredClone(state);
    const events: GameEvent[] = [];
    const chips: ChipMove[] = [];
    const rounds: RoundResult[] = [];
    s.hands[spot]!.setting = setting;
    push(events, { type: 'set', seat: spot });
    if (!anyOpen(s)) settleAll(s, ctx, events, chips, rounds);
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
    if (s.phase === 'setting') {
      // the clock sets every hand still open by the house way, as a dealer would for a player
      const chips: ChipMove[] = [];
      const rounds: RoundResult[] = [];
      houseWayForOpen(s, events);
      settleAll(s, ctx, events, chips, rounds);
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
    if (state.phase === 'betting' && mine.length > 0) {
      const s = structuredClone(state);
      let back = 0;
      const events: GameEvent[] = [];
      for (const spot of mine) {
        const b = s.bets[spot]!;
        back += b.bet + b.fortune;
        delete s.bets[spot];
        push(events, { type: 'bets', seat: spot, bet: 0, fortune: 0 });
      }
      s.staleReady = s.staleReady.filter((x) => x !== seat);
      return { state: s, events, chips: [{ seat, payout: back }] };
    }
    // A hand still open is set by the house way; it plays on against the dealer.
    if (state.phase === 'setting' && mine.some((spot) => state.hands[spot]?.setting === null)) {
      const s = structuredClone(state);
      const events: GameEvent[] = [];
      const chips: ChipMove[] = [];
      const rounds: RoundResult[] = [];
      houseWayForOpen(s, events, (spot) => mine.includes(spot));
      if (!anyOpen(s)) settleAll(s, ctx, events, chips, rounds);
      return { state: s, events, chips, rounds };
    }
    return { state, events: [] };
  },

  liveBets(state, seat) {
    if (state.phase !== 'betting' && state.phase !== 'setting') return 0;
    let live = 0;
    for (const spot of seatList(state.bets)) if (owns(state, seat, spot)) live += state.bets[spot]!.bet + state.bets[spot]!.fortune;
    return live;
  },

  view(state, viewer) {
    const seats: Record<number, SeatView> = {};
    for (const spot of seatList(state.bets)) {
      const b = state.bets[spot]!;
      const h = state.hands[spot];
      const own = viewer !== null && owns(state, viewer, spot);
      const open = !!h && (own || h.shown);
      seats[spot] = {
        bet: b.bet,
        fortune: b.fortune,
        cards: h ? (open ? [...h.cards] : new Array<null>(7).fill(null)) : [],
        set: !!h?.setting,
        setting: h?.setting && open ? structuredClone(h.setting) : null,
        result: state.results[spot] ?? null,
      };
    }
    return {
      phase: state.phase,
      round: state.round,
      deadline: state.deadline,
      seats,
      mine: viewer === null ? [] : spotsOf(state, viewer),
      dealer: state.dealer.length === 0 ? [] : state.revealed ? [...state.dealer] : new Array<null>(7).fill(null),
      dealerSetting: state.revealed && state.dealerSetting ? structuredClone(state.dealerSetting) : null,
      fortune: fortunePaysOf(state.cfg.options),
    };
  },
};
