// Casino War: one card each against the dealer from a six-deck shoe, and the higher card wins even
// money. On a tie the player surrenders half the bet or goes to war: a raise equal to the bet,
// three cards burned, one more card each. The optional Tie bet pays 10 to 1. The rules, odds and
// sources are in docs/rules/table-games.md section 7; ranks and settlement live in rules.ts so the
// tests check the same code.
//
// Solo: set the bet (and a Tie bet if you like), Deal; on a tie choose War or Surrender, and the war
// cards settle it. Multiplayer (up to 6): once the leader starts the table a 15 second betting
// window opens, closing early when every connected player is ready; each bettor gets a card and the
// dealer takes one; everyone who tied decides at once within 12 seconds (a timeout goes to war, the
// better play); the dealer burns three and deals the war; the results stay up for 6 seconds and
// the next window opens.
//
// Several spots (solo only): a solo player can play up to three spots from one stack, each with
// its own bet and Tie bet and its own War or Surrender, dealt like a full table: one card to each
// spot and one to the dealer, and one war deal (burn three, a card to each spot at war, one to the
// dealer) once every tie is decided. Spots are numbered like seats (games/spots.ts); a spot's
// chips are its owner's.

import type { Card, Shoe } from '../../cards.ts';
import { type Cents, type BetLimits, DOLLAR, checkBet, formatMoney, isCents } from '../../money.ts';
import type { EngineCtx, GameEngine, Step, Refusal, TableConfig, TableMode, ChipMove, RoundResult, GameEvent } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { isObj } from '../../protocol.ts';
import * as S from '../spots.ts';
import { DEFAULT_RULES, SHOE_CARDS, dealRound, dealWar, openShoe, rulesOf, settle, settleDeal, shuffleDue, type Bets, type Choice, type Settlement } from './rules.ts';
import type { Decision, Phase, SeatView, WarAction, WarEvent, WarView } from './protocol.ts';

export const BETTING_MS = 15_000;
export const DECISION_MS = 12_000;
export const RESULTS_MS = 6_000;
/** How many spots one solo player may play at once. */
export const MAX_SPOTS = 3;
/** Spots a table has: one per seat. */
const SEATS = 6;

interface Spot {
  card: Card;
  /** Set on a tie only: pending until the player chooses. */
  decision: Decision | null;
  raise: Cents;
  warCard: Card | null;
  /** What the Tie bet paid at the deal, stake included (0 when it lost); null without a Tie bet. */
  tiePaid: Cents | null;
}

export interface WarState {
  cfg: TableConfig;
  phase: Phase;
  round: number;
  /** When the current betting window, decision or results display ends (multiplayer only). */
  deadline: number | null;
  bets: Record<number, Bets>;
  /** Each bettor's cards and choices once dealt. */
  spots: Record<number, Spot>;
  dealer: Card | null;
  dealerWar: Card | null;
  results: Record<number, Settlement>;
  /**
   * Seats already marked ready when this betting window opened. The host keeps the ready flag
   * between rounds, so a leftover flag must not close the next window before anyone has bet;
   * such a seat counts as ready again once it bets or is seen not ready.
   */
  staleReady: number[];
  /** The shoe in play, null before the first deal and after the table empties. Never in a view. */
  shoe: Shoe | null;
  shoeNo: number;
  /** How many spots a seat plays, when it's more than one (solo tables only). Kept between rounds. */
  spotCount: Record<number, number>;
}

/** The spots a seat bets on: its own at a shared table; spots 0 to n - 1 at a solo table. */
export function spotsOf(s: Pick<WarState, 'cfg' | 'spotCount'>, seat: number): number[] {
  return S.spotsOf(s.cfg, s.spotCount, seat);
}

function owns(s: Pick<WarState, 'cfg'>, seat: number, spot: number): boolean {
  return S.owns(s.cfg, seat, spot);
}

const NO_BETS: Bets = { bet: 0, tie: 0 };

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'war',
    variant: '',
    mode,
    maxSeats: mode === 'solo' ? 1 : 6,
    buyIn: { min: 100 * DOLLAR, max: 10_000 * DOLLAR },
    limits: {
      default: { min: 10 * DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR },
      bet: { min: 10 * DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR },
      tie: { min: DOLLAR, max: 100 * DOLLAR, step: DOLLAR },
    },
    options: { tiePays: DEFAULT_RULES.tiePays, warTiePays: DEFAULT_RULES.warTiePays },
  };
}

function parseAction(raw: unknown): WarAction | null {
  if (!isObj(raw)) return null;
  const spot = S.optIndex(raw.spot, SEATS);
  if (spot === false) return null;
  const at = spot === undefined ? {} : { spot };
  switch (raw.type) {
    case 'bet': {
      const bet = raw.bet ?? 0;
      const tie = raw.tie ?? 0;
      if (!isCents(bet) || !isCents(tie)) return null;
      return { type: 'bet', bet, tie, ...at };
    }
    case 'deal':
      return { type: raw.type };
    case 'spots': {
      const n = S.spotCount(raw.n, MAX_SPOTS);
      return n === null ? null : { type: 'spots', n };
    }
    case 'war':
    case 'surrender':
      return { type: raw.type, ...at };
    default:
      return null;
  }
}

function limitsFor(cfg: TableConfig, kind: 'bet' | 'tie'): BetLimits {
  return cfg.limits[kind] ?? cfg.limits.default;
}

function seatList(rec: Record<number, unknown>): number[] {
  return Object.keys(rec)
    .map(Number)
    .sort((a, b) => a - b);
}

function anyPending(s: WarState): boolean {
  return Object.values(s.spots).some((x) => x.decision === 'pending');
}

function push(events: GameEvent[], e: WarEvent): void {
  events.push(e);
}

function clearRound(s: WarState): void {
  s.bets = {};
  s.spots = {};
  s.dealer = null;
  s.dealerWar = null;
  s.results = {};
}

/** Start a round: clear the layout and, in multiplayer, open a timed betting window. */
function openRound(s: WarState, ctx: EngineCtx, events: GameEvent[]): void {
  clearRound(s);
  s.phase = 'betting';
  s.round++;
  s.deadline = ctx.mode === 'multi' ? ctx.now + BETTING_MS : null;
  s.staleReady = ctx.mode === 'multi' ? ctx.seats.filter((x) => x.ready).map((x) => x.seat) : [];
  push(events, { type: 'betting', round: s.round, deadline: s.deadline });
}

/** Everyone has gone. A table with no play has its cards picked up and reshuffled (651a.5(g)). */
function goIdle(s: WarState, events: GameEvent[]): void {
  clearRound(s);
  s.phase = 'idle';
  s.deadline = null;
  s.staleReady = [];
  s.shoe = null;
  push(events, { type: 'idle' });
}

function toResults(s: WarState, ctx: EngineCtx): void {
  s.phase = 'results';
  s.deadline = ctx.mode === 'multi' ? ctx.now + RESULTS_MS : null;
}

/** Set one of a seat's spots' bet and Tie bet to these totals, moving only the difference. */
function placeBets(state: WarState, seat: number, spot: number, stack: Cents, bet: Cents, tie: Cents, ctx: EngineCtx): Step<WarState> | Refusal {
  if (state.phase === 'deciding') return refuse('WRONG_PHASE', 'A tie is waiting: go to war or surrender first.');
  if (state.phase !== 'betting' && ctx.mode === 'multi') return refuse('WRONG_PHASE', 'Betting opens with the next round.');
  if (!spotsOf(state, seat).includes(spot)) return refuse('BAD_REQUEST', "That spot isn't one of yours.");
  const betting = state.phase === 'betting';
  const cur = betting ? (state.bets[spot] ?? NO_BETS) : NO_BETS;
  if (bet === cur.bet && tie === cur.tie) return { state, events: [] };
  const betLimits = limitsFor(state.cfg, 'bet');
  const tieLimits = limitsFor(state.cfg, 'tie');
  if (tie > 0 && bet === 0) return refuse('LIMIT', 'The Tie bet goes with a bet on the main spot.');
  // A surrender hands back half the bet, so the bet has to split into whole cents.
  if (bet > 0 && (checkBet(bet, betLimits) || bet % 2 !== 0)) return refuse('LIMIT', `The bet is ${formatMoney(betLimits.min)} to ${formatMoney(betLimits.max)}.`);
  if (tie > 0 && checkBet(tie, tieLimits)) return refuse('LIMIT', `The Tie bet is ${formatMoney(tieLimits.min)} to ${formatMoney(tieLimits.max)}.`);
  const delta = bet + tie - cur.bet - cur.tie;
  if (delta > stack) return refuse('NOT_ENOUGH_CHIPS', 'That bet is more than your stack.');
  // Going to war raises by the bet, so a bet is only taken with its match still in the stack:
  // every spot's, so each of them could go to war on the same deal.
  let raises = bet;
  if (betting) for (const [key, b] of Object.entries(state.bets)) if (Number(key) !== spot && owns(state, seat, Number(key))) raises += b.bet;
  if (stack - delta < raises) {
    return refuse('NOT_ENOUGH_CHIPS', raises === bet ? `Keep ${formatMoney(bet)} back for a war: the raise matches the bet.` : `Keep ${formatMoney(raises)} back for wars: each raise matches its bet.`);
  }

  const s = structuredClone(state);
  const events: GameEvent[] = [];
  // Solo tables start the next round with the first bet after a result.
  if (s.phase !== 'betting') openRound(s, ctx, events);
  if (bet === 0 && tie === 0) delete s.bets[spot];
  else s.bets[spot] = { bet, tie };
  s.staleReady = s.staleReady.filter((x) => x !== seat);
  push(events, { type: 'bets', seat: spot, bet, tie });
  const chips: ChipMove[] = delta > 0 ? [{ seat, bet: delta }] : delta < 0 ? [{ seat, payout: -delta }] : [];
  return { state: s, events, chips };
}

/**
 * Solo: play `n` spots from the next deal on (sticky until changed). Not while a tie waits; a
 * bet already on a spot given up comes back to the stack.
 */
function setSpots(state: WarState, seat: number, n: number, ctx: EngineCtx): Step<WarState> | Refusal {
  if (ctx.mode !== 'solo') return refuse('WRONG_PHASE', 'One spot each at a shared table.');
  if (state.phase === 'deciding') return refuse('WRONG_PHASE', 'A tie is waiting: go to war or surrender first.');
  if ((state.spotCount[seat] ?? 1) === n) return { state, events: [] };
  const s = structuredClone(state);
  const events: GameEvent[] = [];
  let back = 0;
  if (s.phase === 'betting') {
    for (const spot of spotsOf(s, seat)) {
      const b = s.bets[spot];
      if (spot < n || !b) continue;
      back += b.bet + b.tie;
      delete s.bets[spot];
      push(events, { type: 'bets', seat: spot, bet: 0, tie: 0 });
    }
  }
  if (n === 1) delete s.spotCount[seat];
  else s.spotCount[seat] = n;
  push(events, { type: 'spots', seat, n });
  return back > 0 ? { state: s, events, chips: [{ seat, payout: back }] } : { state: s, events };
}

function finish(s: WarState, spot: number, r: Settlement, ctx: EngineCtx, rounds: RoundResult[], events: GameEvent[]): void {
  s.results[spot] = r;
  rounds.push(S.roundOf(ctx, spot, r.wagered, r.returned));
  push(events, { type: 'result', seat: spot, result: r });
}

/**
 * One card to every seat with a bet and one to the dealer. Seats that win or lose settle on the
 * spot; a tie pays the Tie bet now and waits for the player's choice.
 */
function deal(s: WarState, ctx: EngineCtx): Step<WarState> {
  const events: GameEvent[] = [];
  const chips: ChipMove[] = [];
  const rounds: RoundResult[] = [];
  // A bet from someone whose connection dropped during the window just comes back, rather than
  // being dealt a hand that could need a decision nobody is there to make.
  if (ctx.mode === 'multi') {
    for (const seat of seatList(s.bets)) {
      const who = seatOf(ctx, seat);
      if (who && !who.connected) {
        const b = s.bets[seat]!;
        delete s.bets[seat];
        chips.push({ seat, payout: b.bet + b.tie });
        push(events, { type: 'bets', seat, bet: 0, tie: 0 });
      }
    }
    if (Object.keys(s.bets).length === 0) {
      openRound(s, ctx, events);
      return { state: s, events, chips };
    }
  }
  if (shuffleDue(s.shoe)) {
    s.shoe = openShoe(ctx.rng);
    s.shoeNo++;
    push(events, { type: 'shuffle', shoe: s.shoeNo });
  }
  const rules = rulesOf(s.cfg.options);
  const seats = seatList(s.bets);
  const dealt = dealRound(s.shoe!, seats.length);
  s.dealer = dealt.dealer;
  push(events, { type: 'deal', seats, cards: [...dealt.cards], dealer: dealt.dealer });
  if (dealt.cut) push(events, { type: 'cut' });
  const tied: number[] = [];
  seats.forEach((spot, i) => {
    const b = s.bets[spot]!;
    const card = dealt.cards[i]!;
    const d = settleDeal(b, card, dealt.dealer, rules);
    s.spots[spot] = { card, decision: null, raise: 0, warCard: null, tiePaid: b.tie > 0 ? d.tie : null };
    if (d.bet === null) {
      s.spots[spot]!.decision = 'pending';
      tied.push(spot);
      if (d.tie > 0) chips.push({ seat: S.owner(ctx, spot), payout: d.tie });
      push(events, { type: 'tie', seat: spot, tiePaid: b.tie > 0 ? d.tie : null });
      return;
    }
    const r = settle(b, { player: card, dealer: dealt.dealer }, rules);
    if (r.returned > 0) chips.push({ seat: S.owner(ctx, spot), payout: r.returned });
    finish(s, spot, r, ctx, rounds, events);
  });
  if (tied.length > 0) {
    s.phase = 'deciding';
    s.deadline = ctx.mode === 'multi' ? ctx.now + DECISION_MS : null;
    push(events, { type: 'decide', seats: tied, deadline: s.deadline });
  } else {
    toResults(s, ctx);
  }
  return { state: s, events, chips, rounds };
}

/** Record a choice on a tie. A surrender settles at once; a war puts up the raise and waits for the war deal. */
function decide(s: WarState, spot: number, choice: Choice, auto: boolean, ctx: EngineCtx, events: GameEvent[], chips: ChipMove[], rounds: RoundResult[]): void {
  const hand = s.spots[spot]!;
  const b = s.bets[spot]!;
  const seat = S.owner(ctx, spot);
  hand.decision = choice;
  if (choice === 'war') {
    hand.raise = b.bet;
    chips.push({ seat, bet: b.bet });
  }
  const e: WarEvent = { type: 'decision', seat: spot, choice, raise: hand.raise };
  push(events, auto ? { ...e, auto: true } : e);
  if (choice === 'surrender') {
    const r = settle(b, { player: hand.card, dealer: s.dealer!, choice }, rulesOf(s.cfg.options));
    // the Tie bet was paid at the deal; half the bet comes back now
    chips.push({ seat, payout: r.bet });
    finish(s, spot, r, ctx, rounds, events);
  }
}

/**
 * What the table does for a tie nobody decides: war, the better play, when `left` (what the stack
 * still holds after this step's other raises) covers the raise. Returns the raise put up.
 */
function autoDecide(s: WarState, spot: number, left: Cents, ctx: EngineCtx, events: GameEvent[], chips: ChipMove[], rounds: RoundResult[]): Cents {
  const raise = s.bets[spot]!.bet;
  const war = left >= raise;
  decide(s, spot, war ? 'war' : 'surrender', true, ctx, events, chips, rounds);
  return war ? raise : 0;
}

/**
 * Every tie is decided: burn three, deal one card to each seat at war and one to the dealer, and
 * settle them. With nobody at war (all surrendered) there is no war deal and nothing is burned.
 */
function warDeal(s: WarState, ctx: EngineCtx, events: GameEvent[], chips: ChipMove[], rounds: RoundResult[]): void {
  const seats = seatList(s.spots).filter((seat) => s.spots[seat]!.decision === 'war');
  if (seats.length > 0) {
    const rules = rulesOf(s.cfg.options);
    const dealt = dealWar(s.shoe!, seats.length);
    s.dealerWar = dealt.dealer;
    push(events, { type: 'war', seats, cards: [...dealt.cards], dealer: dealt.dealer });
    if (dealt.cut) push(events, { type: 'cut' });
    seats.forEach((spot, i) => {
      const hand = s.spots[spot]!;
      hand.warCard = dealt.cards[i]!;
      const r = settle(s.bets[spot]!, { player: hand.card, dealer: s.dealer!, choice: 'war', war: { player: hand.warCard, dealer: dealt.dealer } }, rules);
      // the Tie bet was paid at the deal; the bet and the raise come back now if the war was won or tied
      if (r.bet + r.war > 0) chips.push({ seat: S.owner(ctx, spot), payout: r.bet + r.war });
      finish(s, spot, r, ctx, rounds, events);
    });
  }
  toResults(s, ctx);
}

export const engine: GameEngine<WarState, WarAction, WarView> = {
  id: 'war',
  stateVersion: 2,
  seats: { min: 1, max: 6, multiplayer: true },
  config,

  create(cfg) {
    return {
      cfg,
      phase: 'idle',
      round: 0,
      deadline: null,
      bets: {},
      spots: {},
      dealer: null,
      dealerWar: null,
      results: {},
      staleReady: [],
      shoe: null,
      shoeNo: 0,
      spotCount: {},
    };
  },

  parseAction,

  act(state, seat, action, ctx): Step<WarState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Take a seat first.');

    if (action.type === 'bet') return placeBets(state, seat, action.spot ?? spotsOf(state, seat)[0]!, me.stack, action.bet, action.tie, ctx);
    if (action.type === 'spots') return setSpots(state, seat, action.n, ctx);

    if (action.type === 'deal') {
      if (ctx.mode === 'multi') return refuse('WRONG_PHASE', 'The dealer deals when betting closes.');
      // At a solo table every bet down is this seat's.
      if (state.phase !== 'betting' || Object.keys(state.bets).length === 0) return refuse('WRONG_PHASE', 'Place a bet first.');
      return deal(structuredClone(state), ctx);
    }

    // war or surrender, on the tie named or the first of this seat's still waiting
    const at = action.spot ?? seatList(state.spots).find((x) => owns(state, seat, x) && state.spots[x]!.decision === 'pending') ?? seat;
    if (!owns(state, seat, at)) return refuse('NOT_YOUR_TURN', "That isn't your hand.");
    const spot = state.phase === 'deciding' ? state.spots[at] : undefined;
    if (!spot || spot.decision === null) return refuse('WRONG_PHASE', 'There is no tie to decide right now.');
    if (spot.decision !== 'pending') return refuse('WRONG_PHASE', 'This tie is already decided.');
    if (action.type === 'war' && me.stack < state.bets[at]!.bet) return refuse('NOT_ENOUGH_CHIPS', 'The raise has to match the bet.');
    const s = structuredClone(state);
    const events: GameEvent[] = [];
    const chips: ChipMove[] = [];
    const rounds: RoundResult[] = [];
    decide(s, at, action.type, false, ctx, events, chips, rounds);
    if (!anyPending(s)) warDeal(s, ctx, events, chips, rounds);
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
        // Remember who has been seen not ready, so that their next Ready counts.
        return stale.length === state.staleReady.length ? null : { state: { ...state, staleReady: stale }, events: [] };
      }
      const s = structuredClone(state);
      s.staleReady = [];
      if (bettors === 0) {
        // Nobody bet: roll the window over rather than dealing to an empty layout.
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
    if (s.phase === 'deciding') {
      const chips: ChipMove[] = [];
      const rounds: RoundResult[] = [];
      for (const spot of seatList(s.spots)) {
        if (s.spots[spot]!.decision === 'pending') autoDecide(s, spot, seatOf(ctx, S.owner(ctx, spot))?.stack ?? 0, ctx, events, chips, rounds);
      }
      warDeal(s, ctx, events, chips, rounds);
      return { state: s, events, chips, rounds };
    }
    // the results have been up long enough
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

  seatJoined(state) {
    return { state, events: [] };
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
        back += b.bet + b.tie;
        delete s.bets[spot];
        push(events, { type: 'bets', seat: spot, bet: 0, tie: 0 });
      }
      s.staleReady = s.staleReady.filter((x) => x !== seat);
      return { state: s, events, chips: [{ seat, payout: back }] };
    }
    // A tie still waiting on a choice goes to war, as a timeout would, and plays out with the war deal.
    const waiting = mine.filter((spot) => state.spots[spot]?.decision === 'pending');
    if (state.phase === 'deciding' && waiting.length > 0) {
      const s = structuredClone(state);
      const events: GameEvent[] = [];
      const chips: ChipMove[] = [];
      const rounds: RoundResult[] = [];
      // Each raise comes out of what the one stack still holds after the ones before it.
      let left = seatOf(ctx, seat)?.stack ?? 0;
      for (const spot of waiting) left -= autoDecide(s, spot, left, ctx, events, chips, rounds);
      if (!anyPending(s)) warDeal(s, ctx, events, chips, rounds);
      return { state: s, events, chips, rounds };
    }
    // Anything else on the layout is already settled or waiting on the war deal.
    return { state, events: [] };
  },

  liveBets(state, seat) {
    let live = 0;
    for (const spot of seatList(state.bets)) {
      if (!owns(state, seat, spot)) continue;
      const b = state.bets[spot]!;
      if (state.phase === 'betting') live += b.bet + b.tie;
      else if (state.phase === 'deciding') {
        const hand = state.spots[spot];
        // A pending tie still has its bet out, and a war its raise as well; the Tie bet was paid at the deal.
        if (hand && !state.results[spot]) live += b.bet + hand.raise;
      }
    }
    return live;
  },

  view(state, viewer) {
    const seats: Record<number, SeatView> = {};
    for (const seat of seatList(state.bets)) {
      const b = state.bets[seat]!;
      const spot = state.spots[seat];
      seats[seat] = {
        bet: b.bet,
        tie: b.tie,
        raise: spot?.raise ?? 0,
        card: spot?.card ?? null,
        warCard: spot?.warCard ?? null,
        decision: spot?.decision ?? null,
        tiePaid: spot?.tiePaid ?? null,
        result: state.results[seat] ?? null,
      };
    }
    const shoe = state.shoe;
    return {
      phase: state.phase,
      round: state.round,
      deadline: state.deadline,
      seats,
      mine: viewer === null ? [] : spotsOf(state, viewer),
      dealer: state.dealer,
      dealerWar: state.dealerWar,
      rules: rulesOf(state.cfg.options),
      shoe: { no: state.shoeNo, left: shoe ? shoe.cards.length - shoe.pos : SHOE_CARDS, cutOut: shoe !== null && shoe.pos > shoe.cutAt },
    };
  },
};
