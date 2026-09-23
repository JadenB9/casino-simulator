// Texas Hold'em on the wire: the actions a seat may send, the events the table animates, and the
// view each player gets. The view is per viewer: your own hole cards, everyone else's only once
// they are shown at showdown, and never the deck or a bot's cards.

import type { Card } from '../../cards.ts';
import type { Cents } from '../../money.ts';
import type { TableMode } from '../../engine.ts';

/**
 * `bet.amount` and `raise.to` are street totals: what you will have in front of you on this
 * street after the move. `allin` puts in everything you have behind.
 */
export type HoldemAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'bet'; amount: Cents }
  | { type: 'raise'; to: Cents }
  | { type: 'allin' }
  | { type: 'sitout'; on: boolean };

export type HoldemPhase = 'waiting' | 'playing' | 'runout' | 'results';

export type StreetName = 'preflop' | 'flop' | 'turn' | 'river';

// ---------------------------------------------------------------------------------------------
// Events, in the order they happen. All are public: private cards travel only in the view.

export type HoldemEvent =
  /** A new hand: the button moved, these seats are dealt in (clockwise from left of the button). */
  | { type: 'hand'; id: number; button: number; sb: number; bb: number; seats: number[] }
  | { type: 'post'; seat: number; blind: 'sb' | 'bb'; amount: Cents; allIn: boolean }
  /** Two face-down cards to each seat in `order`, one at a time, twice round. */
  | { type: 'deal'; order: number[] }
  | {
      type: 'act';
      seat: number;
      move: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';
      /** Chips added by this move. */
      added: Cents;
      /** The seat's street total after it. (Not `to`: on a GameEvent, `to` names who may see it.) */
      total: Cents;
      /** Set when the table made the move: the clock ran out, or the player left. */
      auto?: 'timeout' | 'leave';
    }
  /** Bets swept into the middle; `pots` are the pots after the sweep, main first. */
  | { type: 'collect'; pots: Cents[] }
  | { type: 'uncalled'; seat: number; amount: Cents }
  | { type: 'board'; street: StreetName; cards: Card[] }
  /** Hole cards turned face up: at showdown, or as soon as an all-in run-out starts (TDA 17). */
  | { type: 'reveal'; seat: number; cards: Card[]; hand: string | null }
  | { type: 'muck'; seat: number }
  | { type: 'win'; pot: number; label: string; amount: Cents; winners: { seat: number; amount: Cents }[]; hand: string | null; best: Card[] | null }
  | { type: 'rebuy'; seat: number; amount: Cents }
  | { type: 'sitout'; seat: number; on: boolean }
  | { type: 'handEnd'; id: number };

// ---------------------------------------------------------------------------------------------
// View

export interface HoldemSeatView {
  seat: number;
  name: string;
  bot: boolean;
  /** Chips behind (not counting what is in front of the seat or in the pot). */
  stack: Cents;
  sittingOut: boolean;
  /** Seated, waiting for the big blind to reach them before being dealt in. */
  waiting: boolean;
  /** Disconnected (a seat is held for two minutes). */
  away: boolean;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  /** In front of the seat on this street. */
  bet: Cents;
  /** [] = no cards; null = a face-down card; a code once the viewer may see it. */
  cards: (Card | null)[];
  /** The seat's last move on this street, for the nameplate. */
  last: string | null;
  /** Hand name once the cards are shown ("Two Pair, Kings and Nines"). */
  hand: string | null;
  /** The five cards that play, once shown and the board is complete. */
  best: Card[] | null;
  /** What the seat collected in the hand just finished (results phase). */
  won: Cents;
}

export interface HoldemPotView {
  amount: Cents;
  /** "Main pot", "Side pot 1", ... */
  label: string;
  eligible: number[];
}

/** What the viewer may do right now (present only on their turn). Amounts are street totals. */
export interface HoldemLegalView {
  fold: boolean;
  check: boolean;
  /** Cost of a call (0 = nothing to call). */
  call: Cents;
  /** The call puts the viewer all-in. */
  callAllIn: boolean;
  bet: { min: Cents; max: Cents } | null;
  raise: { min: Cents; max: Cents } | null;
  /** Chips behind. */
  behind: Cents;
  /** Already in front of the viewer on this street. */
  street: Cents;
  step: Cents;
}

export interface HoldemTurnView {
  seat: number;
  /** When the turn ends (server ms). */
  deadline: number;
  /** When the regular clock runs out and the time bank starts, or null (a bot's turn). */
  bankFrom: number | null;
}

export interface HoldemHandSummary {
  id: number;
  board: Card[];
  lines: string[];
}

export interface HoldemView {
  /** Server time of the step that produced this view, so a client that has fallen behind can catch up. */
  at: number;
  mode: TableMode;
  maxSeats: number;
  blinds: { sb: Cents; bb: Cents };
  phase: HoldemPhase;
  handId: number;
  button: number | null;
  sbSeat: number | null;
  bbSeat: number | null;
  street: StreetName | null;
  board: Card[];
  /** Pots in the middle, main first (the current street's bets are still in front of the seats). */
  pots: HoldemPotView[];
  /** Everything committed this hand, pots and bets. */
  total: Cents;
  /** The bet to match on this street. */
  bet: Cents;
  turn: HoldemTurnView | null;
  /** When the next hand is dealt (results and waiting phases). */
  nextAt: number | null;
  /** Indexed by seat number; null is an empty seat. */
  seats: (HoldemSeatView | null)[];
  you: {
    seat: number;
    cards: Card[];
    legal: HoldemLegalView | null;
    sittingOut: boolean;
    waiting: boolean;
    /** Time bank left, ms. */
    bank: number;
  } | null;
  /** This hand so far, one line per event ("Nora raises to $30"). */
  log: string[];
  /** Recent finished hands, newest first. */
  history: HoldemHandSummary[];
}
