// Three Card Poker: Ante and Play against the dealer, plus the Pair Plus side bet, dealt from a
// fresh deck every round. The rules, pay tables and odds are in docs/rules/cards-and-machines.md
// section 1; the hand ranks and settlement live in rules.ts so the tests check the same code.
//
// Solo: set the Ante and/or Pair Plus, Deal, then Play (a second bet equal to the Ante) or Fold;
// the dealer turns over three cards and the hand settles. Multiplayer (up to 6): once the leader
// starts the table a 15 second betting window opens, closing early when every connected player is
// ready; everyone with a bet gets three cards; all players decide at once within 15 seconds (a
// timeout folds); the dealer reveals, every seat settles, the results stay up for 6 seconds and
// the next window opens.

import type { Card } from '../../cards.ts';
import { type Cents, type BetLimits, DOLLAR, checkBet, formatMoney, isCents } from '../../money.ts';
import type { EngineCtx, GameEngine, Step, Refusal, TableConfig, TableMode, ChipMove, RoundResult, GameEvent } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { isObj } from '../../protocol.ts';
import { DEFAULT_PAYTABLE, dealHands, paytableOf, qualifies, score, settle, type Settlement } from './rules.ts';
import type { Decision, Phase, SeatView, ThreeCardAction, ThreeCardEvent, ThreeCardView } from './protocol.ts';

export const BETTING_MS = 15_000;
export const DECISION_MS = 15_000;
export const RESULTS_MS = 6_000;

interface Hand {
  cards: Card[];
  play: Cents;
  decision: Decision;
  /** Turned over for everyone at settlement. A folded hand never is. */
  shown: boolean;
}

export interface ThreeCardState {
  cfg: TableConfig;
  phase: Phase;
  round: number;
  /** When the current betting window, decision or results display ends (multiplayer only). */
  deadline: number | null;
  bets: Record<number, { ante: Cents; pairPlus: Cents }>;
  hands: Record<number, Hand>;
  /** The dealer's three cards once dealt; hidden from every view until `revealed`. */
  dealer: Card[];
  revealed: boolean;
  results: Record<number, Settlement>;
  /**
   * Seats already marked ready when this betting window opened. The host keeps the ready flag
   * between rounds, so a leftover flag must not close the next window before anyone has bet;
   * such a seat counts as ready again once it bets or is seen not ready.
   */
  staleReady: number[];
}

const NO_BETS = { ante: 0, pairPlus: 0 };

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'threecard',
    variant: '',
    mode,
    maxSeats: mode === 'solo' ? 1 : 6,
    buyIn: { min: 100 * DOLLAR, max: 10_000 * DOLLAR },
    limits: {
      default: { min: 10 * DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR },
      ante: { min: 10 * DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR },
      pairPlus: { min: 5 * DOLLAR, max: 500 * DOLLAR, step: DOLLAR },
    },
    options: { anteBonus: [...DEFAULT_PAYTABLE.anteBonus], pairPlus: [...DEFAULT_PAYTABLE.pairPlus] },
  };
}

function parseAction(raw: unknown): ThreeCardAction | null {
  if (!isObj(raw)) return null;
  switch (raw.type) {
    case 'bet': {
      const ante = raw.ante ?? 0;
      const pairPlus = raw.pairPlus ?? 0;
      if (!isCents(ante) || !isCents(pairPlus)) return null;
      return { type: 'bet', ante, pairPlus };
    }
    case 'deal':
    case 'play':
    case 'fold':
      return { type: raw.type };
    default:
      return null;
  }
}

function limitsFor(cfg: TableConfig, kind: 'ante' | 'pairPlus'): BetLimits {
  return cfg.limits[kind] ?? cfg.limits.default;
}

function seatList(rec: Record<number, unknown>): number[] {
  return Object.keys(rec)
    .map(Number)
    .sort((a, b) => a - b);
}

function anyPending(s: ThreeCardState): boolean {
  return Object.values(s.hands).some((h) => h.decision === 'pending');
}

function push(events: GameEvent[], e: ThreeCardEvent): void {
  events.push(e);
}

/** Start a round: clear the layout and, in multiplayer, open a timed betting window. */
function openRound(s: ThreeCardState, ctx: EngineCtx, events: GameEvent[]): void {
  s.phase = 'betting';
  s.round++;
  s.bets = {};
  s.hands = {};
  s.dealer = [];
  s.revealed = false;
  s.results = {};
  s.deadline = ctx.mode === 'multi' ? ctx.now + BETTING_MS : null;
  s.staleReady = ctx.mode === 'multi' ? ctx.seats.filter((x) => x.ready).map((x) => x.seat) : [];
  push(events, { type: 'betting', round: s.round, deadline: s.deadline });
}

function goIdle(s: ThreeCardState, events: GameEvent[]): void {
  s.phase = 'idle';
  s.deadline = null;
  s.bets = {};
  s.hands = {};
  s.dealer = [];
  s.revealed = false;
  s.results = {};
  s.staleReady = [];
  push(events, { type: 'idle' });
}

/** Set a seat's Ante and Pair Plus to these totals, moving only the difference. */
function placeBets(state: ThreeCardState, seat: number, stack: Cents, ante: Cents, pairPlus: Cents, ctx: EngineCtx): Step<ThreeCardState> | Refusal {
  if (state.phase === 'deciding') return refuse('WRONG_PHASE', 'Cards are out: play or fold this hand first.');
  if (state.phase !== 'betting' && ctx.mode === 'multi') return refuse('WRONG_PHASE', 'Betting opens with the next hand.');
  const cur = state.phase === 'betting' ? (state.bets[seat] ?? NO_BETS) : NO_BETS;
  if (ante === cur.ante && pairPlus === cur.pairPlus) return { state, events: [] };
  const anteLimits = limitsFor(state.cfg, 'ante');
  const ppLimits = limitsFor(state.cfg, 'pairPlus');
  if (ante > 0 && checkBet(ante, anteLimits)) return refuse('LIMIT', `The Ante is ${formatMoney(anteLimits.min)} to ${formatMoney(anteLimits.max)}.`);
  if (pairPlus > 0 && checkBet(pairPlus, ppLimits)) return refuse('LIMIT', `Pair Plus is ${formatMoney(ppLimits.min)} to ${formatMoney(ppLimits.max)}.`);
  const delta = ante + pairPlus - cur.ante - cur.pairPlus;
  if (delta > stack) return refuse('NOT_ENOUGH_CHIPS', 'That bet is more than your stack.');
  // The Play bet has to match the Ante, so an Ante is only taken with its match still in the stack.
  if (stack - delta < ante) return refuse('NOT_ENOUGH_CHIPS', `Keep ${formatMoney(ante)} back for the Play bet: it matches the Ante.`);

  const s = structuredClone(state);
  const events: GameEvent[] = [];
  // Solo tables start the next round with the first bet after a result.
  if (s.phase !== 'betting') openRound(s, ctx, events);
  if (ante === 0 && pairPlus === 0) delete s.bets[seat];
  else s.bets[seat] = { ante, pairPlus };
  s.staleReady = s.staleReady.filter((x) => x !== seat);
  push(events, { type: 'bets', seat, ante, pairPlus });
  const chips: ChipMove[] = delta > 0 ? [{ seat, bet: delta }] : delta < 0 ? [{ seat, payout: -delta }] : [];
  return { state: s, events, chips };
}

/** Deal three cards to every seat with a bet and three to the dealer; the result is fixed here. */
function deal(s: ThreeCardState, ctx: EngineCtx): Step<ThreeCardState> {
  const events: GameEvent[] = [];
  const chips: ChipMove[] = [];
  const rounds: RoundResult[] = [];
  // A bet from someone whose connection dropped during the window just comes back, rather than
  // being dealt a hand that would time out and fold.
  if (ctx.mode === 'multi') {
    for (const seat of seatList(s.bets)) {
      const who = seatOf(ctx, seat);
      if (who && !who.connected) {
        const b = s.bets[seat]!;
        delete s.bets[seat];
        chips.push({ seat, payout: b.ante + b.pairPlus });
        push(events, { type: 'bets', seat, ante: 0, pairPlus: 0 });
      }
    }
    if (Object.keys(s.bets).length === 0) {
      openRound(s, ctx, events);
      return { state: s, events, chips };
    }
  }
  const seats = seatList(s.bets);
  const dealt = dealHands(ctx.rng, seats.length);
  s.dealer = dealt.dealer;
  s.revealed = false;
  push(events, { type: 'deal', seats });
  seats.forEach((seat, i) => {
    const cards = dealt.hands[i]!;
    s.hands[seat] = { cards, play: 0, decision: s.bets[seat]!.ante > 0 ? 'pending' : 'none', shown: false };
    push(events, { type: 'hand', to: seat, seat, cards: [...cards] });
  });
  if (anyPending(s)) {
    s.phase = 'deciding';
    s.deadline = ctx.mode === 'multi' ? ctx.now + DECISION_MS : null;
    push(events, { type: 'decide', deadline: s.deadline });
    return { state: s, events, chips };
  }
  // Pair Plus only, all round: nothing to decide, straight to the reveal.
  settleAll(s, ctx, events, chips, rounds);
  return { state: s, events, chips, rounds };
}

/** A fold settles on the spot: the Ante and (by the PA rule) the Pair Plus are lost. */
function fold(s: ThreeCardState, seat: number, auto: boolean, events: GameEvent[], rounds: RoundResult[]): void {
  const h = s.hands[seat]!;
  const b = s.bets[seat]!;
  h.decision = 'fold';
  const r = settle({ ante: b.ante, play: 0, pairPlus: b.pairPlus }, score(h.cards), score(s.dealer), paytableOf(s.cfg.options));
  s.results[seat] = r;
  rounds.push({ seat, wagered: r.wagered, returned: r.returned });
  push(events, auto ? { type: 'decision', seat, choice: 'fold', play: 0, auto: true } : { type: 'decision', seat, choice: 'fold', play: 0 });
  push(events, { type: 'result', seat, result: r });
}

/** The dealer turns over all three cards; every hand still in is shown and paid, first seat first. */
function settleAll(s: ThreeCardState, ctx: EngineCtx, events: GameEvent[], chips: ChipMove[], rounds: RoundResult[]): void {
  const pay = paytableOf(s.cfg.options);
  const dealer = score(s.dealer);
  s.revealed = true;
  push(events, { type: 'reveal', dealer: [...s.dealer], qualifies: qualifies(dealer) });
  for (const seat of seatList(s.hands)) {
    const h = s.hands[seat]!;
    if (h.decision === 'fold') continue;
    const b = s.bets[seat]!;
    h.shown = true;
    push(events, { type: 'show', seat, cards: [...h.cards] });
    const r = settle({ ante: b.ante, play: h.play, pairPlus: b.pairPlus }, score(h.cards), dealer, pay);
    s.results[seat] = r;
    if (r.returned > 0) chips.push({ seat, payout: r.returned });
    rounds.push({ seat, wagered: r.wagered, returned: r.returned });
    push(events, { type: 'result', seat, result: r });
  }
  s.phase = 'results';
  s.deadline = ctx.mode === 'multi' ? ctx.now + RESULTS_MS : null;
}

export const engine: GameEngine<ThreeCardState, ThreeCardAction, ThreeCardView> = {
  id: 'threecard',
  stateVersion: 1,
  seats: { min: 1, max: 6, multiplayer: true },
  config,

  create(cfg) {
    return { cfg, phase: 'idle', round: 0, deadline: null, bets: {}, hands: {}, dealer: [], revealed: false, results: {}, staleReady: [] };
  },

  parseAction,

  act(state, seat, action, ctx): Step<ThreeCardState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Take a seat first.');

    if (action.type === 'bet') return placeBets(state, seat, me.stack, action.ante, action.pairPlus, ctx);

    if (action.type === 'deal') {
      if (ctx.mode === 'multi') return refuse('WRONG_PHASE', 'The dealer deals when betting closes.');
      if (state.phase !== 'betting' || !state.bets[seat]) return refuse('WRONG_PHASE', 'Bet the Ante or Pair Plus first.');
      return deal(structuredClone(state), ctx);
    }

    // play or fold
    const h = state.phase === 'deciding' ? state.hands[seat] : undefined;
    if (!h) return refuse('WRONG_PHASE', 'There is no hand to play right now.');
    if (h.decision === 'none') return refuse('WRONG_PHASE', 'Pair Plus alone has nothing to decide.');
    if (h.decision !== 'pending') return refuse('WRONG_PHASE', 'This hand is already decided.');
    const s = structuredClone(state);
    const events: GameEvent[] = [];
    const chips: ChipMove[] = [];
    const rounds: RoundResult[] = [];
    if (action.type === 'play') {
      const ante = s.bets[seat]!.ante;
      if (me.stack < ante) return refuse('NOT_ENOUGH_CHIPS', 'The Play bet has to match the Ante.');
      const mine = s.hands[seat]!;
      mine.decision = 'play';
      mine.play = ante;
      chips.push({ seat, bet: ante });
      push(events, { type: 'decision', seat, choice: 'play', play: ante });
    } else {
      fold(s, seat, false, events, rounds);
    }
    if (!anyPending(s)) settleAll(s, ctx, events, chips, rounds);
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
      for (const seat of seatList(s.hands)) if (s.hands[seat]!.decision === 'pending') fold(s, seat, true, events, rounds);
      settleAll(s, ctx, events, chips, rounds);
      return { state: s, events, chips, rounds };
    }
    // results have been up long enough
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
    // Chips only land on a seat with nothing live, so whatever this round still keeps under the
    // number (a folded hand, its result) is the last occupant's, and view() shows a seat its own
    // cards: clear it, so the newcomer never sees a hand nobody else was shown.
    if (!state.hands[seat] && !state.bets[seat] && !state.results[seat]) return { state, events: [] };
    const s = structuredClone(state);
    delete s.hands[seat];
    delete s.bets[seat];
    delete s.results[seat];
    return { state: s, events: [] };
  },

  seatLeaving(state, seat, ctx) {
    // Bets not yet dealt come back.
    if (state.phase === 'betting' && state.bets[seat]) {
      const s = structuredClone(state);
      const b = s.bets[seat]!;
      delete s.bets[seat];
      s.staleReady = s.staleReady.filter((x) => x !== seat);
      return { state: s, events: [{ type: 'bets', seat, ante: 0, pairPlus: 0 }], chips: [{ seat, payout: b.ante + b.pairPlus }] };
    }
    // A hand still waiting on Play or Fold is folded, as a timeout would.
    if (state.phase === 'deciding' && state.hands[seat]?.decision === 'pending') {
      const s = structuredClone(state);
      const events: GameEvent[] = [];
      const chips: ChipMove[] = [];
      const rounds: RoundResult[] = [];
      fold(s, seat, true, events, rounds);
      if (!anyPending(s)) settleAll(s, ctx, events, chips, rounds);
      return { state: s, events, chips, rounds };
    }
    // A played hand (or Pair Plus alone) stays live until the dealer settles it.
    return { state, events: [] };
  },

  liveBets(state, seat) {
    const b = state.bets[seat];
    if (!b) return 0;
    if (state.phase === 'betting') return b.ante + b.pairPlus;
    if (state.phase === 'deciding') {
      const h = state.hands[seat];
      return !h || h.decision === 'fold' ? 0 : b.ante + b.pairPlus + h.play;
    }
    return 0;
  },

  view(state, viewer) {
    const seats: Record<number, SeatView> = {};
    for (const seat of seatList(state.bets)) {
      const b = state.bets[seat]!;
      const h = state.hands[seat];
      const open = !!h && (seat === viewer || h.shown);
      seats[seat] = {
        ante: b.ante,
        pairPlus: b.pairPlus,
        play: h?.play ?? 0,
        cards: h ? (open ? [...h.cards] : [null, null, null]) : [],
        decision: h ? h.decision : null,
        result: state.results[seat] ?? null,
      };
    }
    return {
      phase: state.phase,
      round: state.round,
      deadline: state.deadline,
      seats,
      dealer: state.dealer.length === 0 ? [] : state.revealed ? [...state.dealer] : [null, null, null],
      paytable: paytableOf(state.cfg.options),
    };
  },
};
