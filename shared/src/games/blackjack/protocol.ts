// Blackjack on the wire: the actions a seat may send, the events the table animates, and the
// view each socket gets. Money is integer cents; cards are two-character codes, and a card the
// viewer may not see (the dealer's hole card before the flip) is null.

import type { Card } from '../../cards.ts';
import type { Cents } from '../../money.ts';
import type { Move, Outcome, InsuranceState } from './rules.ts';

export type BlackjackAction =
  /** Add chips to your circle (betting window). */
  | { type: 'bet'; amount: Cents }
  /** Take back the last chip you put down, or everything. */
  | { type: 'undo' }
  | { type: 'clear' }
  /** Solo only: close betting and deal. */
  | { type: 'deal' }
  /** With an ace up: insure for half your bet, or (holding a blackjack) take even money. */
  | { type: 'insurance'; take: boolean }
  | { type: Move };

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
  /** Bets in the circles during the betting window. */
  bets: Record<number, Cents>;
  /** Each seat's opening bet last round, for Rebet. */
  last: Record<number, Cents>;
  /** The round on the table (during play and while results show). */
  spots: SpotView[];
  /** Up card, hole card (null until turned), then the dealer's draws. */
  dealer: (Card | null)[];
  turn: { seat: number; hand: number } | null;
  /** The moves the rules allow on the hand whose turn it is (the seat also needs the chips for double and split). */
  moves: Move[];
  shoe: { decks: number; left: number; discards: number; lastHand: boolean };
}
