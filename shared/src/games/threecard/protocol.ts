// Three Card Poker on the wire: the actions a player sends, the events the table animates and the
// view each seat gets. Cards a viewer may not see are null.
//
// Hands are played at spots numbered like the seats (games/spots.ts), and every `seat` in the
// events and the view below is a spot. At a shared table each player plays their own seat's spot;
// a solo player can play up to three hands at once, spots 0 to n - 1, from one stack.

import type { Card } from '../../cards.ts';
import type { Cents } from '../../money.ts';
import type { Paytable, Settlement } from './rules.ts';

/**
 * `bet` sets a hand's two bets to these totals (0 takes a bet down), so Undo, Clear, Rebet and x2
 * are all one message and a resend can't double a bet. `deal` is solo only; multiplayer deals
 * when the betting window closes. `play` places the Play bet (always equal to the Ante). `spot`
 * says which of your hands (your first when absent); `spots` is solo only, between rounds.
 */
export type ThreeCardAction =
  | { type: 'bet'; ante: Cents; pairPlus: Cents; spot?: number }
  | { type: 'deal' }
  | { type: 'spots'; n: number }
  | { type: 'play'; spot?: number }
  | { type: 'fold'; spot?: number };

export type Phase = 'idle' | 'betting' | 'deciding' | 'results';

/** 'none' is a Pair Plus bet with no Ante: nothing to decide. */
export type Decision = 'pending' | 'play' | 'fold' | 'none';

export interface SeatView {
  ante: Cents;
  pairPlus: Cents;
  play: Cents;
  /** Empty before the deal. Your own cards, or anyone's once turned over at settlement; otherwise nulls. */
  cards: (Card | null)[];
  decision: Decision | null;
  result: Settlement | null;
}

export interface ThreeCardView {
  phase: Phase;
  round: number;
  /** Multiplayer: when the betting window or the decision closes. */
  deadline: number | null;
  /** Every spot with a bet this round. */
  seats: Record<number, SeatView>;
  /** The spots the viewer plays, first spot first (a spectator: none). */
  mine: number[];
  /** Empty before the deal, three nulls until the dealer turns them over. */
  dealer: (Card | null)[];
  paytable: Paytable;
}

/** Events, in the order they happen. `hand` goes only to the seat that plays it. */
export type ThreeCardEvent =
  | { type: 'betting'; round: number; deadline: number | null }
  | { type: 'bets'; seat: number; ante: Cents; pairPlus: Cents }
  | { type: 'deal'; seats: number[] }
  | { type: 'hand'; to: number; seat: number; cards: Card[] }
  | { type: 'decide'; deadline: number | null }
  | { type: 'decision'; seat: number; choice: 'play' | 'fold'; play: Cents; auto?: true }
  | { type: 'reveal'; dealer: Card[]; qualifies: boolean }
  | { type: 'show'; seat: number; cards: Card[] }
  | { type: 'result'; seat: number; result: Settlement }
  /** A solo player now plays `n` hands (this `seat` is the player's own seat). */
  | { type: 'spots'; seat: number; n: number }
  | { type: 'idle' };
