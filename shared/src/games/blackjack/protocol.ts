// Blackjack on the wire: the actions a seat may send, the events the table animates, and the
// view each socket gets. Money is integer cents; cards are two-character codes, and a card the
// viewer may not see (the dealer's hole card before the flip) is null.
//
// Spots: a betting circle is numbered like the seats (spot s is the circle seat s would sit at,
// see SPOT_OF_SEAT), and every `seat` in the events and the round below is a spot. At a shared
// table each player plays their own seat's spot. A solo player can play several spots at once,
// spots 0 to n - 1 (the circles the first n players would take), all from one stack.

import type { Card } from '../../cards.ts';
import type { Cents } from '../../money.ts';
import type { Move, Outcome, InsuranceState } from './rules.ts';

export type BlackjackAction =
  /** Add chips to one of your circles (betting window); without `spot`, your first. */
  | { type: 'bet'; amount: Cents; spot?: number }
  /** Take back the last chip you put down, or everything on all your spots. */
  | { type: 'undo' }
  | { type: 'clear' }
  /** Solo only: close betting and deal. */
  | { type: 'deal' }
  /** Solo only, between rounds: play this many spots (1 to MAX_SPOTS). Bets on spots given up come back. */
  | { type: 'spots'; n: number }
  /**
   * With an ace up: insure a spot for half its bet, or (holding a blackjack) take even money.
   * Each of your spots is asked on its own; without `spot`, the first still unanswered.
   */
  | { type: 'insurance'; take: boolean; spot?: number }
  /**
   * A decision on the hand whose turn it is. `spot` and `hand` name the hand it was meant for, so
   * a click that arrives after that hand has finished is refused instead of playing the next one.
   */
  | { type: Move; spot?: number; hand?: number };

export type Phase = 'idle' | 'betting' | 'insurance' | 'play' | 'results';

/**
 * Events, in the order things happen at the table. All go to everyone: blackjack from a shoe
 * deals every player card face up, and the one hidden card (the dealer's hole card) travels as
 * null until its `hole` event.
 */
export type BlackjackEvent =
  | { type: 'betting'; round: number; deadline: number | null }
  | { type: 'bet'; seat: number; total: Cents; reason?: 'min' }
  | { type: 'shuffle'; discards?: boolean }
  | { type: 'burn' }
  | { type: 'cut' }
  | { type: 'card'; seat: number; hand: number; card: Card }
  | { type: 'dealer-card'; card: Card | null }
  | { type: 'insurance' }
  | { type: 'insured'; seat: number; take: boolean; amount: Cents; evenMoney: boolean }
  | { type: 'peek'; blackjack: boolean }
  | { type: 'hole'; card: Card }
  | { type: 'turn'; seat: number; hand: number }
  | { type: 'stand'; seat: number; hand: number; auto?: boolean }
  | { type: 'double'; seat: number; hand: number; bet: Cents }
  | { type: 'split'; seat: number; hand: number; bet: Cents }
  | { type: 'result'; seat: number; hand: number; outcome: Outcome; bet: Cents; payout: Cents }
  | { type: 'insurance-result'; seat: number; bet: Cents; payout: Cents }
  | { type: 'dealer'; total: number; bust: boolean; drew: boolean }
  | { type: 'done'; round: number }
  /** A solo player now plays `n` spots (this `seat` is the player's own seat). */
  | { type: 'spots'; seat: number; n: number }
  | { type: 'idle' };

export interface HandView {
  cards: Card[];
  bet: Cents;
  doubled: boolean;
  split: boolean;
  splitAce: boolean;
  done: boolean;
  outcome: Outcome | null;
  payout: Cents;
}

export interface SpotView {
  seat: number;
  base: Cents;
  hands: HandView[];
  insurance: InsuranceState;
  insured: Cents;
  wagered: Cents;
  returned: Cents;
}

export interface BlackjackView {
  phase: Phase;
  round: number;
  /** When the current window or turn runs out (multiplayer), server ms. */
  deadline: number | null;
  /** Bets in the circles during the betting window, by spot. */
  bets: Record<number, Cents>;
  /** Each spot's opening bet last round, for Rebet. */
  last: Record<number, Cents>;
  /** The spots the viewer bets on, first spot first (a spectator: none). */
  mine: number[];
  /** The round on the table (during play and while results show). */
  spots: SpotView[];
  /** Up card, hole card (null until turned), then the dealer's draws. */
  dealer: (Card | null)[];
  turn: { seat: number; hand: number } | null;
  /** The moves the rules allow on the hand whose turn it is (the seat also needs the chips for double and split). */
  moves: Move[];
  shoe: { decks: number; left: number; discards: number; lastHand: boolean };
}
