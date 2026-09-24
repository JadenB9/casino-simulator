// Baccarat (punto banco) as this casino deals it: 8 decks, the standard tableau, Banker pays
// 1:1 less a 5% commission, Tie 8:1 (Player and Banker bets push), Player Pair and Banker Pair
// 11:1. docs/rules/table-games.md §4; the rules themselves live in rules.ts.
//
// Solo: bet, then Deal. Multiplayer: once the leader starts the table a betting window opens.
// It closes at the deadline, or early once every connected player at the table is ready; one
// coup is dealt for everyone; the results stay up while the table plays the coup out; then the
// next window opens.
//
// A coup is dealt and settled in one step. Its cards go out in the events that lead to the
// result, together with a view that already holds it, so no message is ever ahead of what the
// table decided, and nothing hidden (the shoe order, the burned cards after the first) is ever
// in one.

import type { Card } from '../../cards.ts';
import { type Cents, type BetLimits, DOLLAR, formatMoney } from '../../money.ts';
import type { EngineCtx, GameEngine, GameEvent, Step, Refusal, TableConfig, TableMode, ChipMove, RoundResult } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { isObj, isAmount } from '../../protocol.ts';
import {
  type Bets, type Burn, type Coup, type Hand, type SeatResult, type ShoeTrack, type Spot,
  DECKS, SPOTS, SPOT_NAMES, betTotal, handTotal, isNatural, limitKey, newTrack, playCoup, seatNumber, settleBets,
} from './rules.ts';
import type { BaccaratAction, BaccaratEvent, BaccaratPhase, BaccaratView, RoadEntry } from './protocol.ts';

export const BETTING_MS = 15_000;
/**
 * Multiplayer: how long a coup's results stay up before the next window opens. The client plays
 * the coup out in that time (deal, reveal, draw, settle), so it grows with the third cards, a new
 * shoe's shuffle and burn, and the number of seats paid, and leaves a few seconds to read it.
 */
export const RESULTS_MS = 9_000;
export const THIRD_CARD_MS = 1_200;
export const NEW_SHOE_MS = 4_000;
export const PAY_MS = 450;

export interface BaccaratState {
  cfg: TableConfig;
  track: ShoeTrack;
  /** The current shoe's burn card. */
  burn: Burn | null;
  phase: BaccaratPhase;
  window: number;
  /** When the current phase ends (multiplayer only). */
  deadline: number | null;
  bets: Record<number, Bets>;
  /** Each seat's bet actions this window, newest last, so Undo takes back exactly one. */
  placed: Record<number, Bets[]>;
  coup: Coup | null;
  /** Coups dealt from this shoe. */
  coups: number;
  results: Record<number, SeatResult>;
  history: RoadEntry[];
}

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'baccarat',
    variant: '',
    mode,
    maxSeats: mode === 'solo' ? 1 : 7,
    // up to a hundred times the table maximum (shared/src/limits.ts scales it with the table)
    buyIn: { min: 100 * DOLLAR, max: 500_000 * DOLLAR },
    // `default` is the Player and Banker limit. A Tie max of $1,000 caps its payout at $8,000.
    limits: {
      default: { min: 10 * DOLLAR, max: 5_000 * DOLLAR, step: DOLLAR },
      tie: { min: 5 * DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR },
      pair: { min: 5 * DOLLAR, max: 500 * DOLLAR, step: DOLLAR },
    },
    options: {},
  };
}

export function limitsFor(cfg: TableConfig, spot: Spot): BetLimits {
  return cfg.limits[limitKey(spot)] ?? cfg.limits.default;
}

function parseAction(raw: unknown): BaccaratAction | null {
  if (!isObj(raw)) return null;
  if (raw.type === 'bet') {
    const bets: Bets = {};
    let any = false;
    for (const spot of SPOTS) {
      const v = raw[spot];
      if (v === undefined) continue;
      if (!isAmount(v)) return null;
      bets[spot] = v;
      any = true;
    }
    return any ? { type: 'bet', bets } : null;
  }
  if (raw.type === 'undo' || raw.type === 'clear' || raw.type === 'deal') return { type: raw.type };
  return null;
}

/**
 * Chips can go down in any amount up to the spot's maximum, in the table's step. The minimum is
 * checked when betting closes instead, so a bet can be built up from small chips.
 */
function overLimit(cfg: TableConfig, spot: Spot, total: Cents): string | null {
  const lim = limitsFor(cfg, spot);
  if (total % lim.step !== 0) return `Bets go down in ${formatMoney(lim.step)} steps.`;
  if (total > lim.max) return `The ${SPOT_NAMES[spot]} maximum is ${formatMoney(lim.max)}.`;
  return null;
}

function underMin(cfg: TableConfig, bets: Bets): string | null {
  for (const spot of SPOTS) {
    const v = bets[spot];
    const min = limitsFor(cfg, spot).min;
    if (v && v < min) return `The ${SPOT_NAMES[spot]} minimum is ${formatMoney(min)}.`;
  }
  return null;
}

function roadEntry(c: Coup): RoadEntry {
  return {
    w: c.winner === 'player' ? 'P' : c.winner === 'banker' ? 'B' : 'T',
    p: c.playerTotal,
    b: c.bankerTotal,
    pp: c.playerPair,
    bp: c.bankerPair,
    n: c.natural,
  };
}

/** The coup as the dealer plays it: four cards face down, the reveals, the tableau's calls, the result. */
function coupEvents(coup: Coup, cut: number | null): BaccaratEvent[] {
  const out: BaccaratEvent[] = [];
  let n = 0;
  const deal = (hand: Hand, card: Card, faceUp: boolean) => {
    if (n === cut) out.push({ type: 'cutcard' });
    out.push({ type: 'card', hand, card, faceUp });
    n++;
  };
  deal('player', coup.player[0]!, false);
  deal('banker', coup.banker[0]!, false);
  deal('player', coup.player[1]!, false);
  deal('banker', coup.banker[1]!, false);
  const p = handTotal(coup.player.slice(0, 2));
  const b = handTotal(coup.banker.slice(0, 2));
  out.push({ type: 'reveal', hand: 'player', total: p }, { type: 'reveal', hand: 'banker', total: b });
  if (isNatural(p) || isNatural(b)) {
    out.push({ type: 'natural', player: p, banker: b });
  } else {
    for (const [hand, cards, total] of [['player', coup.player, p], ['banker', coup.banker, b]] as const) {
      if (cards.length > 2) {
        out.push({ type: 'draw', hand });
        deal(hand, cards[2]!, true);
      } else {
        out.push({ type: 'stand', hand, total });
      }
    }
  }
  out.push({
    type: 'outcome',
    winner: coup.winner,
    player: coup.playerTotal,
    banker: coup.bankerTotal,
    natural: coup.natural,
    playerPair: coup.playerPair,
    bankerPair: coup.bankerPair,
  });
  return out;
}

export function resultsMs(coup: Coup, newShoe: boolean, seatsPaid: number): number {
  const thirds = coup.player.length + coup.banker.length - 4;
  return RESULTS_MS + THIRD_CARD_MS * thirds + (newShoe ? NEW_SHOE_MS : 0) + PAY_MS * seatsPaid;
}

function openBetting(s: BaccaratState, ctx: EngineCtx, events: BaccaratEvent[]): void {
  s.phase = 'betting';
  s.window++;
  s.bets = {};
  s.placed = {};
  s.results = {};
  s.coup = null;
  s.deadline = ctx.mode === 'multi' ? ctx.now + BETTING_MS : null;
  events.push({ type: 'betting', window: s.window, deadline: s.deadline });
}

function goIdle(s: BaccaratState, events: BaccaratEvent[]): void {
  s.phase = 'idle';
  s.deadline = null;
  s.bets = {};
  s.placed = {};
  s.results = {};
  s.coup = null;
  events.push({ type: 'idle' });
}

function step(state: BaccaratState, events: BaccaratEvent[], chips?: ChipMove[], rounds?: RoundResult[]): Step<BaccaratState> {
  const out: Step<BaccaratState> = { state, events: events as GameEvent[] };
  if (chips?.length) out.chips = chips;
  if (rounds?.length) out.rounds = rounds;
  return out;
}

/** No more bets: deal one coup and settle every seat, highest seat number first. */
function dealRound(s: BaccaratState, ctx: EngineCtx, events: BaccaratEvent[], chips: ChipMove[]): Step<BaccaratState> {
  const rounds: RoundResult[] = [];
  events.push({ type: 'nomore' });
  const played = playCoup(s.track, ctx.rng);
  if (played.burn) {
    s.burn = played.burn;
    s.history = [];
    s.coups = 0;
    events.push({ type: 'shuffle', shoe: s.track.shoeNo }, { type: 'burn', card: played.burn.card, count: played.burn.count });
  }
  const coup = played.coup;
  events.push(...coupEvents(coup, played.cut));
  s.coup = coup;
  s.coups++;
  s.history.push(roadEntry(coup));

  const seats = Object.keys(s.bets).map(Number).sort((a, b) => seatNumber(b) - seatNumber(a));
  for (const seat of seats) {
    const r = settleBets(s.bets[seat]!, coup);
    s.results[seat] = r;
    if (r.returned > 0) chips.push({ seat, payout: r.returned });
    rounds.push({ seat, wagered: r.wagered, returned: r.returned });
    events.push({ type: 'result', seat, ...r });
  }
  if (s.track.lastHand) events.push({ type: 'lasthand' });
  s.phase = 'results';
  s.placed = {};
  s.deadline = ctx.mode === 'multi' ? ctx.now + resultsMs(coup, played.burn !== null, seats.length) : null;
  return step(s, events, chips, rounds);
}

/** Multiplayer close: send back bets under a spot's minimum, then deal (or roll the window over if nothing is left). */
function closeBetting(s: BaccaratState, ctx: EngineCtx): Step<BaccaratState> {
  const events: BaccaratEvent[] = [];
  const chips: ChipMove[] = [];
  for (const seat of Object.keys(s.bets).map(Number)) {
    const bets = s.bets[seat]!;
    for (const spot of SPOTS) {
      const v = bets[spot];
      if (!v || v >= limitsFor(s.cfg, spot).min) continue;
      delete bets[spot];
      chips.push({ seat, payout: v });
      events.push({ type: 'refund', seat, spot, amount: v });
    }
    if (betTotal(bets) === 0) delete s.bets[seat];
  }
  if (Object.keys(s.bets).length === 0) {
    // Nothing on the layout: open the next window rather than deal to an empty table.
    if (ctx.seats.length === 0) goIdle(s, events);
    else openBetting(s, ctx, events);
    return step(s, events, chips);
  }
  return dealRound(s, ctx, events, chips);
}

function takeBack(s: BaccaratState, seat: number, amounts: Bets): Cents {
  const bets = s.bets[seat];
  if (!bets) return 0;
  let back = 0;
  for (const spot of SPOTS) {
    const v = Math.min(amounts[spot] ?? 0, bets[spot] ?? 0);
    if (!v) continue;
    const left = bets[spot]! - v;
    if (left > 0) bets[spot] = left;
    else delete bets[spot];
    back += v;
  }
  if (betTotal(bets) === 0) delete s.bets[seat];
  return back;
}

export const engine: GameEngine<BaccaratState, BaccaratAction, BaccaratView> = {
  id: 'baccarat',
  stateVersion: 1,
  seats: { min: 1, max: 7, multiplayer: true },
  config,

  create(cfg) {
    // The shoe is shuffled (and burned) when the first coup is dealt, so it plays out on the felt.
    return {
      cfg,
      track: newTrack(),
      burn: null,
      phase: 'idle',
      window: 0,
      deadline: null,
      bets: {},
      placed: {},
      coup: null,
      coups: 0,
      results: {},
      history: [],
    };
  },

  parseAction,

  act(state, seat, action, ctx): Step<BaccaratState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Take a seat first.');

    if (action.type === 'bet') {
      if (state.phase !== 'betting' && ctx.mode === 'multi') return refuse('WRONG_PHASE', 'Betting opens after this coup.');
      const current = state.phase === 'betting' ? (state.bets[seat] ?? {}) : {};
      let adding = 0;
      for (const spot of SPOTS) {
        const v = action.bets[spot];
        if (!v) continue;
        const problem = overLimit(state.cfg, spot, (current[spot] ?? 0) + v);
        if (problem) return refuse('LIMIT', problem);
        adding += v;
      }
      if (adding > me.stack) return refuse('NOT_ENOUGH_CHIPS', 'That bet is more than your stack.');
      const s = structuredClone(state);
      const events: BaccaratEvent[] = [];
      // Solo tables open a new coup with the first chip after the last result.
      if (s.phase !== 'betting') openBetting(s, ctx, events);
      const bets = (s.bets[seat] ??= {});
      for (const spot of SPOTS) {
        const v = action.bets[spot];
        if (v) bets[spot] = (bets[spot] ?? 0) + v;
      }
      (s.placed[seat] ??= []).push({ ...action.bets });
      events.push({ type: 'bet', seat, bets });
      return step(s, events, [{ seat, bet: adding }]);
    }

    if (action.type === 'undo' || action.type === 'clear') {
      if (state.phase !== 'betting' || !state.bets[seat]) return { state, events: [] };
      const s = structuredClone(state);
      let back: Cents;
      if (action.type === 'undo') {
        const last = s.placed[seat]?.pop();
        if (!last) return { state, events: [] };
        back = takeBack(s, seat, last);
      } else {
        back = takeBack(s, seat, s.bets[seat]!);
        delete s.placed[seat];
      }
      return step(s, [{ type: 'bet', seat, bets: s.bets[seat] ?? {} }], back > 0 ? [{ seat, payout: back }] : []);
    }

    // deal
    if (ctx.mode === 'multi') return refuse('WRONG_PHASE', 'The dealer deals when betting closes.');
    const mine = state.phase === 'betting' ? state.bets[seat] : undefined;
    if (!mine || betTotal(mine) === 0) return refuse('WRONG_PHASE', 'Place a bet first.');
    const short = underMin(state.cfg, mine);
    if (short) return refuse('LIMIT', short);
    return dealRound(structuredClone(state), ctx, [], []);
  },

  tick(state, ctx) {
    if (ctx.mode !== 'multi' || !ctx.started) return null;
    if (state.phase === 'idle') {
      if (ctx.seats.length === 0) return null;
      const s = structuredClone(state);
      const events: BaccaratEvent[] = [];
      openBetting(s, ctx, events);
      return step(s, events);
    }
    if (state.deadline === null) return null;
    if (state.phase === 'betting') {
      // Early close once everyone connected at the table says they're ready (and a bet is down).
      const anyBets = Object.keys(state.bets).length > 0;
      const allReady = anyBets && ctx.seats.every((st) => st.ready || !st.connected);
      if (ctx.now < state.deadline && !allReady) return null;
      return closeBetting(structuredClone(state), ctx);
    }
    if (ctx.now < state.deadline) return null;
    const s = structuredClone(state);
    const events: BaccaratEvent[] = [];
    if (ctx.seats.length === 0) goIdle(s, events);
    else openBetting(s, ctx, events);
    return step(s, events);
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

  seatLeaving(state, seat) {
    // Bets that haven't been dealt on come back; a dealt coup is already settled.
    if (state.phase !== 'betting' || !state.bets[seat]) return { state, events: [] };
    const s = structuredClone(state);
    const back = betTotal(s.bets[seat]);
    delete s.bets[seat];
    delete s.placed[seat];
    return step(s, [{ type: 'bet', seat, bets: {} }], [{ seat, payout: back }]);
  },

  liveBets(state, seat) {
    return state.phase === 'betting' ? betTotal(state.bets[seat]) : 0;
  },

  view(state) {
    const shoe = state.track.shoe;
    return {
      phase: state.phase,
      window: state.window,
      deadline: state.deadline,
      bets: state.bets,
      coup: state.coup,
      results: state.results,
      history: state.history,
      shoe: {
        no: state.track.shoeNo,
        coups: state.coups,
        left: shoe ? shoe.cards.length - shoe.pos : DECKS * 52,
        used: shoe ? shoe.pos : 0,
        lastHand: state.track.lastHand,
        shuffleNext: state.track.shuffleNext,
        burn: state.burn,
      },
    };
  },
};
