// Three Card Poker on the wire: the actions a player sends, the events the table animates and the
// view each seat gets. Cards a viewer may not see are null.

import type { Card } from '../../cards.ts';
import type { Cents } from '../../money.ts';
import type { Paytable, Settlement } from './rules.ts';

/**
 * `bet` sets both spots to these totals (0 takes a spot down), so Undo, Clear, Rebet and x2 are
 * all one message and a resend can't double a bet. `deal` is solo only; multiplayer deals when the
 * betting window closes. `play` places the Play bet (always equal to the Ante).
 */
export type ThreeCardAction =
  | { type: 'bet'; ante: Cents; pairPlus: Cents }
  | { type: 'deal' }
  | { type: 'play' }
  | { type: 'fold' };

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
  /** Every seat with a bet this round. */
  seats: Record<number, SeatView>;
  /** Empty before the deal, three nulls until the dealer turns them over. */
  dealer: (Card | null)[];
  paytable: Paytable;
}

/** Events, in the order they happen. `hand` goes only to its own seat. */
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
  | { type: 'idle' };
