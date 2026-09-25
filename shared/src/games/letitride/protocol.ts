// Let It Ride on the wire: the actions a player sends, the events the table animates and the view
// each seat gets. Cards a viewer may not see are null.
//
// Hands are played at spots numbered like the seats (games/spots.ts), and every `seat` in the
// events and the view below is a spot. At a shared table each player plays their own seat's spot;
// a solo player can play up to three hands at once, spots 0 to n - 1, from one stack, all against
// the same two community cards.

import type { Card } from '../../cards.ts';
import type { Cents } from '../../money.ts';
import type { Paytable, Settlement } from './rules.ts';

/**
 * `bet` sets a hand's bets: `unit` goes on each of the three circles (1, 2 and $, always equal)
 * and `bonus` on the 3-Card Bonus; both are totals (0 takes them down), so Undo, Clear, Rebet and
 * x2 are one message per hand and a resend can't double a bet. The 3-Card Bonus needs the three
 * bets under it. `deal` is solo only; multiplayer deals when the betting window closes. `ride`
 * and `pull` decide the bet up now (bet 1 on three cards, bet 2 after the first community card)
 * for the hand named, or your first still deciding. `spots` is solo only, between rounds.
 */
export type LetItRideAction =
  | { type: 'bet'; unit: Cents; bonus: Cents; spot?: number }
  | { type: 'deal' }
  | { type: 'spots'; n: number }
  | { type: 'ride'; spot?: number }
  | { type: 'pull'; spot?: number };

/** 'first': bet 1 is up (three cards); 'second': bet 2 is up (the first community card is out). */
export type Phase = 'idle' | 'betting' | 'first' | 'second' | 'results';

export type Decision = 'pending' | 'ride' | 'pull';

export interface SeatView {
  /** Each circle's bet, and the 3-Card Bonus. */
  unit: Cents;
  bonus: Cents;
  /** Empty before the deal. Your own cards, or anyone's once turned over at settlement; otherwise nulls. */
  cards: (Card | null)[];
  /** Bet 1 and bet 2: null before they are up. */
  first: Decision | null;
  second: Decision | null;
  result: Settlement | null;
}

export interface LetItRideView {
  phase: Phase;
  round: number;
  /** Multiplayer: when the betting window or the decision closes. */
  deadline: number | null;
  /** Every spot with a bet this round. */
  seats: Record<number, SeatView>;
  /** The spots the viewer plays, first spot first (a spectator: none). */
  mine: number[];
  /** The two community cards: empty before the deal, null until turned over. */
  board: (Card | null)[];
  paytable: Paytable;
}

/** Events, in the order they happen. `hand` goes only to the seat that plays it. */
export type LetItRideEvent =
  | { type: 'betting'; round: number; deadline: number | null }
  | { type: 'bets'; seat: number; unit: Cents; bonus: Cents }
  | { type: 'deal'; seats: number[] }
  | { type: 'hand'; to: number; seat: number; cards: Card[] }
  /** Bet 1 (`bet: 1`) or bet 2 is up for every hand still in. */
  | { type: 'decide'; bet: 1 | 2; deadline: number | null }
  /** A hand let a bet ride or pulled it back (`back` is what came back to the stack); `auto` when the clock or a leaving player decided. */
  | { type: 'decision'; seat: number; bet: 1 | 2; choice: 'ride' | 'pull'; back: Cents; auto?: true }
  /** A community card turned over: `index` 0 is the first, 1 the second. */
  | { type: 'board'; index: 0 | 1; card: Card }
  | { type: 'show'; seat: number; cards: Card[] }
  | { type: 'result'; seat: number; result: Settlement }
  /** A solo player now plays `n` hands (this `seat` is the player's own seat). */
  | { type: 'spots'; seat: number; n: number }
  | { type: 'idle' };
