// Blackjack at a table: betting windows, turns and timers around the rule core in rules.ts.
//
// Solo: bet, then Deal; decisions wait for the player; a bet after the results opens the next
// round. Multiplayer (seats 0-6 at the seven circles, see SPOT_OF_SEAT): once the leader
// starts the table a 15 second betting window opens and closes early when everyone with a bet is
// ready; with an ace up every circle gets 10 seconds to answer insurance; each hand gets 20
// seconds per decision and stands when the time runs out; results show for 5 seconds, then the
// next window opens.
//
// Money: chips leave the stack when they go down on the layout (bets, doubles, splits,
// insurance) and come back when a hand or the insurance settles. The rule core keeps a running
// wagered/returned per circle, and every step turns the change in those into chip moves.
//
// Several spots (solo only): a solo player can play up to five circles, each with its own bet,
// from the one stack. The round is the same round a full table gets: one card to each circle from
// first base, the dealer's, a second each, the hole card, then every hand in circle order. Each
// spot is offered insurance on its own, splits and doubles on its own, and settles on its own
// (one RoundResult per spot, so the stats count hands). Spots are numbered like seats (see
// games/spots.ts): `spotsOf` says which a seat plays, and a spot's chips are its owner's.

import { type Shoe, cutCardOut, cardsLeft } from '../../cards.ts';
import { type Cents, DOLLAR, formatMoney } from '../../money.ts';
import type { EngineCtx, GameEngine, Step, Refusal, TableConfig, TableMode, ChipMove, RoundResult, GameEvent } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { isObj, isAmount, isOneOf } from '../../protocol.ts';
import * as S from '../spots.ts';
import {
  type Round,
  type Dealing,
  type Move,
  DECKS,
  MAX_HANDS,
  MAX_SPOTS,
  MOVES,
  SPOT_OF_SEAT,
  openShoe,
  startRound,
  decideInsurance,
  insuranceCost,
  play,
  legalMoves,
  moveCost,
  current,
  standCurrent,
  standSeat,
  cardsOnTable,
} from './rules.ts';
import type { BlackjackAction, BlackjackView, Phase } from './protocol.ts';

export type { BlackjackAction, BlackjackView } from './protocol.ts';

export const BETTING_MS = 15_000;
export const INSURANCE_MS = 10_000;
export const TURN_MS = 20_000;
export const RESULTS_MS = 5_000;

export interface BlackjackState {
  cfg: TableConfig;
  shoe: Shoe;
  phase: Phase;
  round: number;
  deadline: number | null;
  /** Bets in the circles, by spot. */
  bets: Record<number, Cents>;
  /** Each seat's chips in the order they went down (which spot, how much), for Undo. */
  stacks: Record<number, { spot: number; amount: Cents }[]>;
  /**
   * Seats whose ready flag was already on when this window opened (left over from the last
   * round). They count as ready again only after the flag has been seen off once.
   */
  staleReady: number[];
  deal: Round | null;
  /** Each spot's opening bet last round, for Rebet. */
  last: Record<number, Cents>;
  /** How many spots a seat plays, when it's more than one (solo tables only). Kept between rounds. */
  spotCount: Record<number, number>;
}

/** The spots a seat bets on: its own at a shared table; spots 0 to n - 1 at a solo table. */
export function spotsOf(s: Pick<BlackjackState, 'cfg' | 'spotCount'>, seat: number): number[] {
  return S.spotsOf(s.cfg, s.spotCount, seat);
}

/** Whether a spot's hand is this seat's: at a solo table every spot is its one player's. */
function owns(s: Pick<BlackjackState, 'cfg'>, seat: number, spot: number): boolean {
  return S.owns(s.cfg, seat, spot);
}

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'blackjack',
    variant: '',
    mode,
    maxSeats: mode === 'solo' ? 1 : 7,
    // up to a hundred times the table maximum (shared/src/limits.ts scales it with the table)
    buyIn: { min: 100 * DOLLAR, max: 500_000 * DOLLAR },
    limits: { default: { min: 25 * DOLLAR, max: 5_000 * DOLLAR, step: DOLLAR } },
    options: {},
  };
}

function parseAction(raw: unknown): BlackjackAction | null {
  if (!isObj(raw)) return null;
  const spot = S.optIndex(raw.spot, SPOT_OF_SEAT.length);
  if (spot === false) return null;
  const at = spot === undefined ? {} : { spot };
  switch (raw.type) {
    case 'bet':
      return isAmount(raw.amount) ? { type: 'bet', amount: raw.amount, ...at } : null;
    case 'undo':
    case 'clear':
    case 'deal':
      return { type: raw.type };
    case 'spots': {
      const n = S.spotCount(raw.n, MAX_SPOTS);
      return n === null ? null : { type: 'spots', n };
    }
    case 'insurance':
      return typeof raw.take === 'boolean' ? { type: 'insurance', take: raw.take, ...at } : null;
    default: {
      if (!isOneOf(raw.type, MOVES)) return null;
      const hand = S.optIndex(raw.hand, MAX_HANDS);
      if (hand === false) return null;
      return { type: raw.type, ...at, ...(hand === undefined ? {} : { hand }) };
    }
  }
}

function dealing(s: BlackjackState, ctx: EngineCtx, events: GameEvent[]): Dealing {
  return { shoe: s.shoe, rng: ctx.rng, out: events };
}

/** Each spot's wagered and returned so far, to turn what a step changed into chip moves. */
type Ledger = Map<number, { w: Cents; r: Cents }>;

function ledger(r: Round): Ledger {
  return new Map(r.spots.map((sp) => [sp.seat, { w: sp.wagered, r: sp.returned }]));
}

function openBetting(s: BlackjackState, ctx: EngineCtx, events: GameEvent[]): void {
  s.phase = 'betting';
  s.round++;
  s.bets = {};
  s.stacks = {};
  s.deal = null;
  s.deadline = ctx.mode === 'multi' ? ctx.now + BETTING_MS : null;
  s.staleReady = ctx.seats.filter((x) => x.ready).map((x) => x.seat);
  events.push({ type: 'betting', round: s.round, deadline: s.deadline });
}

function goIdle(s: BlackjackState): Step<BlackjackState> {
  s.phase = 'idle';
  s.deadline = null;
  s.bets = {};
  s.stacks = {};
  s.deal = null;
  return { state: s, events: [{ type: 'idle' }] };
}

/**
 * After the rule core has moved the round on: chip moves from the change in each circle's
 * wagered/returned, the phase and its timer, and the finished rounds for stats.
 */
function wrapUp(s: BlackjackState, ctx: EngineCtx, events: GameEvent[], before: Ledger, prevPhase: Phase): Step<BlackjackState> {
  const r = s.deal!;
  // Chips only move for seats the host still has (a seat can't leave with chips on the layout,
  // so this never drops a payout; it keeps one bad seat from voiding the whole step).
  const seated = new Set(ctx.seats.map((x) => x.seat));
  // One move per seat, however many of its spots changed: a double on one circle and the payouts
  // on the others land together.
  const moves = new Map<number, ChipMove>();
  for (const sp of r.spots) {
    const b = before.get(sp.seat) ?? { w: sp.wagered, r: sp.returned };
    const bet = sp.wagered - b.w;
    const payout = sp.returned - b.r;
    const seat = S.owner(ctx, sp.seat);
    if ((bet > 0 || payout > 0) && seated.has(seat)) {
      const mv = moves.get(seat) ?? { seat };
      if (bet > 0) mv.bet = (mv.bet ?? 0) + bet;
      if (payout > 0) mv.payout = (mv.payout ?? 0) + payout;
      moves.set(seat, mv);
    }
  }
  const chips = [...moves.values()];
  const multi = ctx.mode === 'multi';
  let rounds: RoundResult[] | undefined;
  if (r.stage === 'done') {
    rounds = r.spots.filter((sp) => seated.has(S.owner(ctx, sp.seat)) && !sp.reported).map((sp) => S.roundOf(ctx, sp.seat, sp.wagered, sp.returned));
    s.phase = 'results';
    s.deadline = multi ? ctx.now + RESULTS_MS : null;
    events.push({ type: 'done', round: s.round });
  } else if (r.stage === 'insurance') {
    s.phase = 'insurance';
    // One window for everyone's answer; it doesn't restart as each seat answers.
    if (prevPhase !== 'insurance') s.deadline = multi ? ctx.now + INSURANCE_MS : null;
  } else {
    s.phase = 'play';
    s.deadline = multi ? ctx.now + TURN_MS : null;
  }
  const step: Step<BlackjackState> = { state: s, events };
  if (chips.length) step.chips = chips;
  if (rounds?.length) step.rounds = rounds;
  return step;
}

/** Close betting and deal to every circle with a bet. */
function beginRound(s: BlackjackState, ctx: EngineCtx, events: GameEvent[]): Step<BlackjackState> {
  const bets = Object.entries(s.bets)
    .map(([seat, bet]) => ({ seat: Number(seat), bet }))
    .filter((b) => b.bet > 0);
  s.last = {};
  for (const b of bets) s.last[b.seat] = b.bet;
  s.bets = {};
  s.stacks = {};
  const before: Ledger = new Map(bets.map((b) => [b.seat, { w: b.bet, r: 0 }]));
  const d = dealing(s, ctx, events);
  s.deal = startRound(bets, d);
  s.shoe = d.shoe;
  return wrapUp(s, ctx, events, before, 'betting');
}

function placeBet(state: BlackjackState, seat: number, spot: number, amount: Cents, stack: Cents, ctx: EngineCtx): Step<BlackjackState> | Refusal {
  if (state.phase === 'insurance' || state.phase === 'play') return refuse('WRONG_PHASE', 'Wait for this round to finish.');
  if (state.phase !== 'betting' && ctx.mode === 'multi') return refuse('WRONG_PHASE', 'Betting is closed.');
  if (!spotsOf(state, seat).includes(spot)) return refuse('BAD_REQUEST', "That circle isn't one of yours.");
  const lim = state.cfg.limits.default;
  // The limits are per circle, as at any table: each spot is a bet of its own.
  const total = (state.phase === 'betting' ? (state.bets[spot] ?? 0) : 0) + amount;
  if (amount % lim.step !== 0) return refuse('BAD_REQUEST', `Bets go up in ${formatMoney(lim.step)} steps.`);
  if (total > lim.max) return refuse('LIMIT', `The table maximum is ${formatMoney(lim.max)}.`);
  if (amount > stack) return refuse('NOT_ENOUGH_CHIPS', 'That bet is more than your stack.');
  const s = structuredClone(state);
  const events: GameEvent[] = [];
  // Solo: the first chip after the results clears the table for the next round.
  if (s.phase !== 'betting') openBetting(s, ctx, events);
  s.bets[spot] = total;
  (s.stacks[seat] ??= []).push({ spot, amount });
  events.push({ type: 'bet', seat: spot, total });
  return { state: s, events, chips: [{ seat, bet: amount }] };
}

/** Undo (the last chip this seat put down, on whichever of its spots) or Clear (all of them). */
function takeBack(state: BlackjackState, seat: number, all: boolean): Step<BlackjackState> | Refusal {
  if (state.phase !== 'betting') return refuse('WRONG_PHASE', 'The cards are already out.');
  const placed = state.stacks[seat] ?? [];
  if (placed.length === 0) return { state, events: [] };
  const s = structuredClone(state);
  const chips = s.stacks[seat]!;
  const back = all ? chips.splice(0) : [chips.pop()!];
  if (chips.length === 0) delete s.stacks[seat];
  const events: GameEvent[] = [];
  let payout = 0;
  for (const spot of new Set(back.map((c) => c.spot))) {
    const amount = back.filter((c) => c.spot === spot).reduce((a, c) => a + c.amount, 0);
    const total = (s.bets[spot] ?? 0) - amount;
    if (total > 0) s.bets[spot] = total;
    else delete s.bets[spot];
    payout += amount;
    events.push({ type: 'bet', seat: spot, total: Math.max(0, total) });
  }
  return { state: s, events, chips: [{ seat, payout }] };
}

/**
 * Solo: play `n` spots from the next round on (sticky until changed). Allowed while no cards are
 * out; a bet already on a spot given up comes back to the stack.
 */
function setSpots(state: BlackjackState, seat: number, n: number, ctx: EngineCtx): Step<BlackjackState> | Refusal {
  if (ctx.mode !== 'solo') return refuse('WRONG_PHASE', 'One circle each at a shared table.');
  if (state.phase === 'insurance' || state.phase === 'play') return refuse('WRONG_PHASE', 'Wait for this round to finish.');
  if ((state.spotCount[seat] ?? 1) === n) return { state, events: [] };
  const s = structuredClone(state);
  const events: GameEvent[] = [];
  let back = 0;
  if (s.phase === 'betting') {
    for (const spot of spotsOf(s, seat)) {
      if (spot < n || !s.bets[spot]) continue;
      back += s.bets[spot]!;
      delete s.bets[spot];
      events.push({ type: 'bet', seat: spot, total: 0 });
    }
    const kept = (s.stacks[seat] ?? []).filter((c) => c.spot < n);
    if (kept.length) s.stacks[seat] = kept;
    else delete s.stacks[seat];
  }
  if (n === 1) delete s.spotCount[seat];
  else s.spotCount[seat] = n;
  events.push({ type: 'spots', seat, n });
  return back > 0 ? { state: s, events, chips: [{ seat, payout: back }] } : { state: s, events };
}

function closeBetting(state: BlackjackState, ctx: EngineCtx): Step<BlackjackState> {
  const s = structuredClone(state);
  const events: GameEvent[] = [];
  const chips: ChipMove[] = [];
  const seated = new Set(ctx.seats.map((x) => x.seat));
  const min = s.cfg.limits.default.min;
  for (const [key, bet] of Object.entries(s.bets)) {
    const spot = Number(key);
    const seat = S.owner(ctx, spot);
    if (!seated.has(seat)) {
      // Can't happen (a leaving seat's bet comes back in seatLeaving); never deal to an empty chair.
      delete s.bets[spot];
      continue;
    }
    if (bet < min) {
      delete s.bets[spot];
      chips.push({ seat, payout: bet });
      events.push({ type: 'bet', seat: spot, total: 0, reason: 'min' });
    }
  }
  if (Object.keys(s.bets).length === 0) {
    // Nobody is in: roll the window over rather than deal to an empty table.
    if (ctx.seats.length === 0) {
      const idle = goIdle(s);
      return { ...idle, events: [...events, ...idle.events], chips };
    }
    openBetting(s, ctx, events);
    return { state: s, events, chips };
  }
  const step = beginRound(s, ctx, events);
  if (chips.length) step.chips = [...chips, ...(step.chips ?? [])];
  return step;
}

export const engine: GameEngine<BlackjackState, BlackjackAction, BlackjackView> = {
  id: 'blackjack',
  stateVersion: 2,
  seats: { min: 1, max: 7, multiplayer: true },
  config,

  create(cfg, ctx) {
    const solo = cfg.mode === 'solo';
    return {
      cfg,
      shoe: openShoe(ctx.rng),
      phase: solo ? 'betting' : 'idle',
      round: solo ? 1 : 0,
      deadline: null,
      bets: {},
      stacks: {},
      staleReady: [],
      deal: null,
      last: {},
      spotCount: {},
    };
  },

  parseAction,

  act(state, seat, action, ctx) {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Take a seat first.');

    switch (action.type) {
      case 'bet':
        return placeBet(state, seat, action.spot ?? spotsOf(state, seat)[0]!, action.amount, me.stack, ctx);
      case 'undo':
      case 'clear':
        return takeBack(state, seat, action.type === 'clear');
      case 'spots':
        return setSpots(state, seat, action.n, ctx);
      case 'deal': {
        if (ctx.mode === 'multi') return refuse('WRONG_PHASE', 'The dealer deals when betting closes.');
        // At a solo table every bet down is this seat's; circles left empty just sit the round out.
        const bets = state.phase === 'betting' ? Object.values(state.bets).filter((b) => b > 0) : [];
        if (bets.length === 0) return refuse('WRONG_PHASE', 'Place a bet first.');
        const min = state.cfg.limits.default.min;
        if (bets.some((b) => b < min)) return refuse('LIMIT', `The table minimum is ${formatMoney(min)}${bets.length > 1 ? ' on each circle' : ''}.`);
        return beginRound(structuredClone(state), ctx, []);
      }
      case 'insurance': {
        if (state.phase !== 'insurance' || !state.deal) return refuse('WRONG_PHASE', 'Insurance is only offered with an ace up.');
        // Each spot answers on its own; without one named, the first of this seat's still asked.
        const spot = action.spot ?? state.deal.spots.find((sp) => owns(state, seat, sp.seat) && sp.insurance === 'offered')?.seat ?? seat;
        if (!owns(state, seat, spot)) return refuse('NOT_YOUR_TURN', "That isn't your hand.");
        const cost = action.take ? insuranceCost(state.deal, spot) : 0;
        if (cost > me.stack) return refuse('NOT_ENOUGH_CHIPS', `Insurance costs ${formatMoney(cost)}.`);
        const s = structuredClone(state);
        const events: GameEvent[] = [];
        const before = ledger(s.deal!);
        const d = dealing(s, ctx, events);
        const fault = decideInsurance(s.deal!, spot, action.take, d);
        if (fault) return refuse(fault.code, fault.msg);
        s.shoe = d.shoe;
        return wrapUp(s, ctx, events, before, state.phase);
      }
      default: {
        const move: Move = action.type;
        if (state.phase !== 'play' || !state.deal) return refuse('WRONG_PHASE', 'There is no hand to play right now.');
        const c = current(state.deal);
        if (!c || !owns(state, seat, c.spot.seat)) return refuse('NOT_YOUR_TURN', "It isn't your turn.");
        // A second click meant for a hand that has just finished must not play the next one.
        if ((action.spot !== undefined && action.spot !== c.spot.seat) || (action.hand !== undefined && action.hand !== c.hi)) {
          return refuse('NOT_YOUR_TURN', 'That hand is finished: the table has moved on to the next.');
        }
        const cost = moveCost(c.spot, c.hand, move);
        if (cost > me.stack && legalMoves(state.deal, c.spot, c.hand)[move]) {
          return refuse('NOT_ENOUGH_CHIPS', `You need ${formatMoney(cost)} more to ${move}.`);
        }
        const s = structuredClone(state);
        const events: GameEvent[] = [];
        const before = ledger(s.deal!);
        const d = dealing(s, ctx, events);
        const fault = play(s.deal!, c.spot.seat, move, d);
        if (fault) return refuse(fault.code, fault.msg);
        s.shoe = d.shoe;
        return wrapUp(s, ctx, events, before, state.phase);
      }
    }
  },

  tick(state, ctx) {
    if (ctx.mode !== 'multi' || !ctx.started) return null;
    const due = state.deadline !== null && ctx.now >= state.deadline;
    switch (state.phase) {
      case 'idle': {
        if (ctx.seats.length === 0) return null;
        const s = structuredClone(state);
        const events: GameEvent[] = [];
        openBetting(s, ctx, events);
        return { state: s, events };
      }
      case 'betting': {
        const readyNow = new Set(ctx.seats.filter((x) => x.ready).map((x) => x.seat));
        const stale = state.staleReady.filter((seat) => readyNow.has(seat));
        const bettors = Object.keys(state.bets).map(Number);
        // Everyone connected must say so, bet down or not: one player's Ready must not deal the
        // hand while another is still reaching for chips.
        // (With nobody connected there is nobody to be ready: the window runs to its deadline.)
        const allReady =
          bettors.length > 0 && ctx.seats.some((x) => x.connected) && ctx.seats.every((x) => !x.connected || (readyNow.has(x.seat) && !stale.includes(x.seat)));
        if (due || allReady) return closeBetting(state, ctx);
        if (stale.length !== state.staleReady.length) return { state: { ...state, staleReady: stale }, events: [] };
        return null;
      }
      case 'insurance': {
        if (!due || !state.deal) return null;
        const s = structuredClone(state);
        const events: GameEvent[] = [];
        const before = ledger(s.deal!);
        const d = dealing(s, ctx, events);
        for (const sp of s.deal!.spots) if (sp.insurance === 'offered' && s.deal!.stage === 'insurance') decideInsurance(s.deal!, sp.seat, false, d);
        s.shoe = d.shoe;
        return wrapUp(s, ctx, events, before, state.phase);
      }
      case 'play': {
        if (!due || !state.deal) return null;
        const s = structuredClone(state);
        const events: GameEvent[] = [];
        const before = ledger(s.deal!);
        const d = dealing(s, ctx, events);
        standCurrent(s.deal!, d);
        s.shoe = d.shoe;
        return wrapUp(s, ctx, events, before, state.phase);
      }
      case 'results': {
        if (!due) return null;
        const s = structuredClone(state);
        if (ctx.seats.length === 0) return goIdle(s);
        const events: GameEvent[] = [];
        openBetting(s, ctx, events);
        return { state: s, events };
      }
    }
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
    if (state.phase === 'betting') {
      const mine = Object.keys(state.bets).map(Number).filter((spot) => owns(state, seat, spot));
      const back = mine.reduce((a, spot) => a + (state.bets[spot] ?? 0), 0);
      if (back === 0) return { state, events: [] };
      const s = structuredClone(state);
      for (const spot of mine) delete s.bets[spot];
      delete s.stacks[seat];
      return { state: s, events: mine.map((spot) => ({ type: 'bet', seat: spot, total: 0 })), chips: [{ seat, payout: back }] };
    }
    if ((state.phase === 'insurance' || state.phase === 'play') && state.deal?.spots.some((sp) => owns(state, seat, sp.seat))) {
      // Cards are out, so the bets can't come down: answer insurance with no and stand every hand,
      // circle by circle in the order they play.
      const s = structuredClone(state);
      const events: GameEvent[] = [];
      const before = ledger(s.deal!);
      const d = dealing(s, ctx, events);
      for (const sp of state.deal.spots) if (owns(state, seat, sp.seat)) standSeat(s.deal!, sp.seat, d);
      s.shoe = d.shoe;
      const step = wrapUp(s, ctx, events, before, state.phase);
      // Nothing of this seat left on the layout (a natural paid, a bust, a surrender): the host
      // cashes it out now, before the dealer finishes, and the round's end only reports seats
      // still at the table. Report each of its spots' rounds here, or they never reach the stats.
      if (s.deal!.stage !== 'done') {
        for (const sp of s.deal!.spots) {
          if (!owns(state, seat, sp.seat) || sp.reported || sp.live !== 0) continue;
          sp.reported = true;
          step.rounds = [...(step.rounds ?? []), S.roundOf(ctx, sp.seat, sp.wagered, sp.returned)];
        }
      }
      return step;
    }
    return { state, events: [] };
  },

  liveBets(state, seat) {
    let live = 0;
    if (state.phase === 'betting') {
      for (const [spot, bet] of Object.entries(state.bets)) if (owns(state, seat, Number(spot))) live += bet;
    } else if ((state.phase === 'insurance' || state.phase === 'play') && state.deal) {
      for (const sp of state.deal.spots) if (owns(state, seat, sp.seat)) live += sp.live;
    }
    return live;
  },

  view(state, viewer) {
    const r = state.phase === 'insurance' || state.phase === 'play' || state.phase === 'results' ? state.deal : null;
    let moves: Move[] = [];
    const c = r ? current(r) : null;
    if (r && c && viewer !== null && owns(state, viewer, c.spot.seat)) {
      const legal = legalMoves(r, c.spot, c.hand);
      moves = MOVES.filter((m) => legal[m]);
    }
    return {
      phase: state.phase,
      round: state.round,
      deadline: state.deadline,
      bets: { ...state.bets },
      last: { ...state.last },
      mine: viewer === null ? [] : spotsOf(state, viewer),
      spots: r
        ? r.spots.map((sp) => ({
            seat: sp.seat,
            base: sp.base,
            hands: sp.hands.map((h) => ({ ...h, cards: [...h.cards] })),
            insurance: sp.insurance,
            insured: sp.insured,
            wagered: sp.wagered,
            returned: sp.returned,
          }))
        : [],
      // The hole card stays on the server until it's turned over.
      dealer: r ? r.dealer.map((card, i) => (i === 1 && !r.holeUp ? null : card)) : [],
      turn: c ? { seat: c.spot.seat, hand: c.hi } : null,
      moves,
      shoe: {
        decks: DECKS,
        left: cardsLeft(state.shoe),
        discards: Math.max(0, state.shoe.pos - (r ? cardsOnTable(r) : 0)),
        lastHand: cutCardOut(state.shoe),
      },
    };
  },
};
