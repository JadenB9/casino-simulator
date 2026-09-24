// High Card: the smallest complete game, kept as the reference for how an engine fits the
// contract and as the fixture the server tests play. Not on the casino floor.
//
// Everyone at the table bets; the dealer and each player get one card; higher rank wins (ace
// high), a tie pushes, a win pays 1 to 1. With ties pushing it has no house edge at all, which
// makes it a clean fixture: over many rounds the players' stacks should wander around where
// they started.
//
// Solo: bet, then Deal. Multiplayer: once the leader starts the table, a 15 second betting
// window opens; it closes early when every seated player with a bet is ready; cards come out;
// results show for 4 seconds; the next window opens.

import { type Card, type Shoe, newShoe, draw, cutCardOut, rankHigh } from '../../cards.ts';
import { type Cents, DOLLAR, checkBet } from '../../money.ts';
import type { EngineCtx, GameEngine, Step, Refusal, TableConfig, TableMode, ChipMove, RoundResult, GameEvent } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { isObj, isAmount } from '../../protocol.ts';

export const BETTING_MS = 15_000;
export const RESULTS_MS = 4_000;

export type HighCardAction = { type: 'bet'; amount: Cents } | { type: 'clear' } | { type: 'deal' };

export interface HighCardState {
  cfg: TableConfig;
  shoe: Shoe;
  phase: 'idle' | 'betting' | 'results';
  round: number;
  /** When the current phase ends (multiplayer only). */
  deadline: number | null;
  bets: Record<number, Cents>;
  cards: Record<number, Card>;
  dealer: Card | null;
  results: Record<number, { outcome: 'win' | 'lose' | 'push'; payout: Cents }>;
}

export interface HighCardView {
  phase: HighCardState['phase'];
  round: number;
  deadline: number | null;
  bets: Record<number, Cents>;
  cards: Record<number, Card>;
  dealer: Card | null;
  results: HighCardState['results'];
  cardsLeft: number;
}

const DECKS = 1;

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'highcard',
    variant: '',
    mode,
    maxSeats: mode === 'solo' ? 1 : 6,
    // up to a hundred times the table maximum (shared/src/limits.ts scales it with the table)
    buyIn: { min: 10 * DOLLAR, max: 100_000 * DOLLAR },
    limits: { default: { min: 1 * DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR } },
    options: {},
  };
}

function freshShoe(ctx: EngineCtx): Shoe {
  return newShoe(ctx.rng, DECKS, 0.75);
}

function parseAction(raw: unknown): HighCardAction | null {
  if (!isObj(raw)) return null;
  if (raw.type === 'bet' && isAmount(raw.amount)) return { type: 'bet', amount: raw.amount };
  if (raw.type === 'clear' || raw.type === 'deal') return { type: raw.type };
  return null;
}

/** Open a betting window if the table is running and someone is seated. */
function openBetting(s: HighCardState, ctx: EngineCtx, events: GameEvent[]): void {
  s.phase = 'betting';
  s.round++;
  s.bets = {};
  s.cards = {};
  s.dealer = null;
  s.results = {};
  s.deadline = ctx.mode === 'multi' ? ctx.now + BETTING_MS : null;
  events.push({ type: 'betting', round: s.round, deadline: s.deadline });
}

/** Deal and settle in one go: the result is decided here, before anything is shown. */
function dealRound(s: HighCardState, ctx: EngineCtx): Step<HighCardState> {
  const events: GameEvent[] = [];
  const chips: ChipMove[] = [];
  const rounds: RoundResult[] = [];
  if (cutCardOut(s.shoe) || s.shoe.cards.length - s.shoe.pos < 2 + 2 * Object.keys(s.bets).length) {
    s.shoe = freshShoe(ctx);
    events.push({ type: 'shuffle' });
  }
  const seats = Object.keys(s.bets).map(Number).sort((a, b) => a - b);
  for (const seat of seats) {
    s.cards[seat] = draw(s.shoe);
    events.push({ type: 'card', target: `seat:${seat}`, card: s.cards[seat] });
  }
  s.dealer = draw(s.shoe);
  events.push({ type: 'card', target: 'dealer', card: s.dealer });
  const d = rankHigh(s.dealer);
  for (const seat of seats) {
    const bet = s.bets[seat]!;
    const p = rankHigh(s.cards[seat]!);
    const outcome = p > d ? 'win' : p < d ? 'lose' : 'push';
    const payout = outcome === 'win' ? 2 * bet : outcome === 'push' ? bet : 0;
    s.results[seat] = { outcome, payout };
    if (payout > 0) chips.push({ seat, payout });
    rounds.push({ seat, wagered: bet, returned: payout });
    events.push({ type: 'result', seat, outcome, payout });
  }
  s.phase = 'results';
  s.deadline = ctx.mode === 'multi' ? ctx.now + RESULTS_MS : null;
  return { state: s, events, chips, rounds };
}

export const engine: GameEngine<HighCardState, HighCardAction, HighCardView> = {
  id: 'highcard',
  stateVersion: 1,
  seats: { min: 1, max: 6, multiplayer: true },
  config,

  create(cfg, ctx) {
    return {
      cfg,
      shoe: freshShoe(ctx),
      phase: 'idle',
      round: 0,
      deadline: null,
      bets: {},
      cards: {},
      dealer: null,
      results: {},
    };
  },

  parseAction,

  act(state, seat, action, ctx): Step<HighCardState> | Refusal {
    const s = structuredClone(state);
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Take a seat first.');

    if (action.type === 'bet') {
      const events: GameEvent[] = [];
      // Solo tables open a new round on the first bet after the last result.
      if (s.phase !== 'betting') {
        if (ctx.mode === 'multi') return refuse('WRONG_PHASE', 'Betting is closed.');
        openBetting(s, ctx, events);
      }
      const current = s.bets[seat] ?? 0;
      const total = current + action.amount;
      const problem = checkBet(total, s.cfg.limits.default);
      if (problem) return refuse('LIMIT', 'That bet is outside the table limits.');
      if (action.amount > me.stack) return refuse('NOT_ENOUGH_CHIPS', 'That bet is more than your stack.');
      s.bets[seat] = total;
      events.push({ type: 'bet', seat, total });
      return { state: s, events, chips: [{ seat, bet: action.amount }] };
    }

    if (action.type === 'clear') {
      if (s.phase !== 'betting') return refuse('WRONG_PHASE', 'Bets are already down.');
      const current = s.bets[seat] ?? 0;
      if (current === 0) return { state, events: [] };
      delete s.bets[seat];
      return { state: s, events: [{ type: 'bet', seat, total: 0 }], chips: [{ seat, payout: current }] };
    }

    // deal
    if (ctx.mode === 'multi') return refuse('WRONG_PHASE', 'The dealer deals when betting closes.');
    if (s.phase !== 'betting' || !s.bets[seat]) return refuse('WRONG_PHASE', 'Place a bet first.');
    return dealRound(s, ctx);
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
    const bettors = Object.keys(state.bets).map(Number);
    const allReady = bettors.length > 0 && ctx.seats.every((st) => st.ready || !(st.seat in state.bets));
    if (ctx.now < state.deadline && !(state.phase === 'betting' && allReady)) return null;
    const s = structuredClone(state);
    if (s.phase === 'betting') {
      if (bettors.length === 0) {
        // Nobody bet: roll the window over rather than dealing to an empty table.
        const events: GameEvent[] = [];
        if (ctx.seats.length === 0) {
          s.phase = 'idle';
          s.deadline = null;
          return { state: s, events: [{ type: 'idle' }] };
        }
        openBetting(s, ctx, events);
        return { state: s, events };
      }
      return dealRound(s, ctx);
    }
    // results shown long enough: next round, or go idle if the table emptied
    if (ctx.seats.length === 0) {
      s.phase = 'idle';
      s.deadline = null;
      return { state: s, events: [{ type: 'idle' }] };
    }
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

  seatJoined(state) {
    return { state, events: [] };
  },

  seatLeaving(state, seat) {
    // A bet that hasn't been dealt yet just comes back.
    if (state.phase !== 'betting' || !state.bets[seat]) return { state, events: [] };
    const s = structuredClone(state);
    const back = s.bets[seat]!;
    delete s.bets[seat];
    return { state: s, events: [{ type: 'bet', seat, total: 0 }], chips: [{ seat, payout: back }] };
  },

  liveBets(state, seat) {
    return state.phase === 'betting' ? (state.bets[seat] ?? 0) : 0;
  },

  view(state) {
    return {
      phase: state.phase,
      round: state.round,
      deadline: state.deadline,
      bets: state.bets,
      cards: state.cards,
      dealer: state.dealer,
      results: state.results,
      cardsLeft: state.shoe.cards.length - state.shoe.pos,
    };
  },
};
