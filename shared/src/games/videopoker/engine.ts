// Video poker: Jacks or Better 9/6 on a one-player machine (docs/rules/cards-and-machines.md §2).
//
// Deal takes the bet (coins x denomination) and shuffles a fresh 52-card deck. Its first five
// cards are the deal and the next five are the replacements, in order, so the draw is already
// decided when the hand is dealt. Those ten stay in the server's state; the client only ever
// sees the five on the screen. Draw replaces the cards not held and pays from the table.
// The machine's credits are the seat's stack, shown in coins of the chosen denomination.

import type { Card } from '../../cards.ts';
import { randInt, type Rng } from '../../rng.ts';
import { type Cents, DOLLAR, checkBet, formatMoney } from '../../money.ts';
import type { GameEngine, Step, Refusal, TableConfig, TableMode, GameEvent } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { isObj, isInt } from '../../protocol.ts';
import { rankHand, payCredits, cardCode, HAND_NAMES, MAX_COINS, type HandRank } from './hands.ts';

/** Coin values the player can pick: $1, $5, $25 and the high-limit $100. */
export const DENOMS: readonly Cents[] = [1 * DOLLAR, 5 * DOLLAR, 25 * DOLLAR, 100 * DOLLAR];

export type VideoPokerAction = { type: 'deal'; coins: number; denom?: Cents } | { type: 'draw'; hold: boolean[] };

export interface VideoPokerResult {
  rank: HandRank;
  /** "Two Pair"; "Nothing" for a losing hand. */
  name: string;
  /** Credits won (coins of `denom`), 0 on a loss. */
  credits: number;
  payout: Cents;
}

export interface VideoPokerState {
  cfg: TableConfig;
  /** idle: nothing played yet. dealt: five cards up, waiting for the draw. over: the hand is paid. */
  phase: 'idle' | 'dealt' | 'over';
  round: number;
  /** The seat playing the current (or last) hand. */
  seat: number | null;
  coins: number;
  denom: Cents;
  /** Ten cards of this hand's shuffled deck: 0-4 dealt, 5-9 the draws in order. Server only. */
  deck: Card[];
  /** The five cards on the screen. */
  hand: Card[];
  /** The holds the draw used (all false until then). */
  held: boolean[];
  /** The dealt hand's category, which the pay glass shows dimly before the draw. */
  dealt: HandRank | null;
  result: VideoPokerResult | null;
}

export interface VideoPokerView {
  phase: VideoPokerState['phase'];
  round: number;
  coins: number;
  denom: Cents;
  hand: Card[];
  held: boolean[];
  dealt: HandRank | null;
  result: VideoPokerResult | null;
}

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'videopoker',
    variant: '',
    mode,
    maxSeats: 1,
    // up to what the cashier tops a player up to: five $100 coins are $500 a hand
    buyIn: { min: 20 * DOLLAR, max: 50_000 * DOLLAR },
    // One $1 coin up to five $100 coins.
    limits: { default: { min: DENOMS[0]!, max: MAX_COINS * DENOMS[DENOMS.length - 1]!, step: DOLLAR } },
    options: { paytable: 'jacks-or-better-9-6', denoms: DENOMS, maxCoins: MAX_COINS },
  };
}

/**
 * Shuffle the first ten positions of a deck of card numbers: a Fisher-Yates that fills positions
 * 0, 1, 2... from what is left and stops after ten. Those ten come out exactly as a full shuffle
 * would put them (every ordered choice of ten of the 52 equally likely, whatever order the array
 * started in), and a hand can never use more than ten. The Monte Carlo test deals with this too.
 */
export function shuffleTen(rng: Rng, deck: Uint8Array | number[]): void {
  for (let i = 0; i < 10; i++) {
    const j = i + randInt(rng, 52 - i);
    const t = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = t;
  }
}

/** A fresh deck of card numbers, 0-51. */
export function deckNumbers(): Uint8Array {
  return Uint8Array.from({ length: 52 }, (_, i) => i);
}

function parseAction(raw: unknown): VideoPokerAction | null {
  if (!isObj(raw)) return null;
  if (raw.type === 'deal' && isInt(raw.coins)) {
    if (raw.denom === undefined) return { type: 'deal', coins: raw.coins };
    return isInt(raw.denom) ? { type: 'deal', coins: raw.coins, denom: raw.denom } : null;
  }
  if (raw.type === 'draw' && Array.isArray(raw.hold) && raw.hold.length === 5 && raw.hold.every((h) => typeof h === 'boolean')) {
    return { type: 'draw', hold: raw.hold.slice() as boolean[] };
  }
  return null;
}

function bet(s: VideoPokerState): Cents {
  return s.coins * s.denom;
}

/** Replace what isn't held from the deck, pay the hand, and end the game. */
function settle(s: VideoPokerState, hold: boolean[]): Step<VideoPokerState> {
  const seat = s.seat!;
  let next = 5;
  const hand = s.hand.map((c, i) => (hold[i] ? c : s.deck[next++]!));
  const rank = rankHand(hand);
  const credits = payCredits(rank, s.coins);
  const payout = credits * s.denom;
  s.hand = hand;
  s.held = hold.slice();
  s.result = { rank, name: HAND_NAMES[rank]!, credits, payout };
  s.phase = 'over';
  const events: GameEvent[] = [
    { type: 'draw', hold: s.held, cards: hand },
    { type: 'result', seat, rank, name: s.result.name, coins: s.coins, denom: s.denom, credits, payout },
  ];
  return {
    state: s,
    events,
    chips: payout > 0 ? [{ seat, payout }] : [],
    rounds: [{ seat, wagered: bet(s), returned: payout }],
  };
}

export const engine: GameEngine<VideoPokerState, VideoPokerAction, VideoPokerView> = {
  id: 'videopoker',
  stateVersion: 1,
  seats: { min: 1, max: 1, multiplayer: false },
  config,

  create(cfg) {
    return {
      cfg,
      phase: 'idle',
      round: 0,
      seat: null,
      coins: MAX_COINS,
      denom: DENOMS[0]!,
      deck: [],
      hand: [],
      held: [false, false, false, false, false],
      dealt: null,
      result: null,
    };
  },

  parseAction,

  act(state, seat, action, ctx): Step<VideoPokerState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Take a seat first.');

    if (action.type === 'deal') {
      if (state.phase === 'dealt') return refuse('WRONG_PHASE', 'Hold your cards and draw first.');
      const denom = action.denom ?? state.denom;
      if (action.coins < 1 || action.coins > MAX_COINS) return refuse('LIMIT', `Bet 1 to ${MAX_COINS} coins.`);
      if (!DENOMS.includes(denom)) return refuse('LIMIT', `This machine takes ${DENOMS.map((d) => formatMoney(d)).join(', ')} coins.`);
      const amount = action.coins * denom;
      if (checkBet(amount, state.cfg.limits.default)) return refuse('LIMIT', 'That bet is outside the machine limits.');
      if (amount > me.stack) return refuse('NOT_ENOUGH_CHIPS', 'Not enough credits for that bet.');

      const s = structuredClone(state);
      const deck = deckNumbers();
      shuffleTen(ctx.rng, deck);
      s.deck = Array.from(deck.subarray(0, 10), cardCode);
      s.hand = s.deck.slice(0, 5);
      s.held = [false, false, false, false, false];
      s.round++;
      s.seat = seat;
      s.coins = action.coins;
      s.denom = denom;
      s.dealt = rankHand(s.hand);
      s.result = null;
      s.phase = 'dealt';
      return {
        state: s,
        events: [{ type: 'deal', round: s.round, coins: s.coins, denom, bet: amount, cards: s.hand, made: s.dealt }],
        chips: [{ seat, bet: amount }],
      };
    }

    // draw
    if (state.phase !== 'dealt') return refuse('WRONG_PHASE', 'Deal a hand first.');
    if (state.seat !== seat) return refuse('NOT_YOUR_TURN', 'This hand belongs to another player.');
    return settle(structuredClone(state), action.hold);
  },

  // A machine has no clock: nothing happens until the player presses a button.
  tick: () => null,
  deadline: () => null,
  shiftDeadlines: (state) => state,

  seatJoined(state) {
    return { state, events: [] };
  },

  seatLeaving(state, seat) {
    // Walking away mid-hand stands pat: the dealt hand is held whole and paid as it stands.
    if (state.phase !== 'dealt' || state.seat !== seat) return { state, events: [] };
    return settle(structuredClone(state), [true, true, true, true, true]);
  },

  liveBets(state, seat) {
    return state.phase === 'dealt' && state.seat === seat ? bet(state) : 0;
  },

  view(state) {
    return {
      phase: state.phase,
      round: state.round,
      coins: state.coins,
      denom: state.denom,
      hand: state.hand,
      held: state.held,
      dealt: state.dealt,
      result: state.result,
    };
  },
};
