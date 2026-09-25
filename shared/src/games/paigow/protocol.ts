// Pai Gow Poker on the wire: the actions a player sends, the events the table animates and the
// view each seat gets. Cards a viewer may not see are null, and so is how another player set a
// hand until the dealer turns it over.
//
// Hands are played at spots numbered like the seats (games/spots.ts), and every `seat` in the
// events and the view below is a spot. At a shared table each player plays their own seat's spot;
// a solo player can play up to three hands at once, spots 0 to n - 1, from one stack, each against
// the dealer's one hand.

import type { Cents } from '../../money.ts';
import type { FortunePays, PgCard, Setting, Settlement } from './rules.ts';

/**
 * `bet` sets a hand's bet and Fortune bonus to these totals (0 takes them down; the Fortune needs
 * a bet with it). `deal` is solo only; multiplayer deals when the betting window closes. `set`
 * splits a hand's seven cards: `low` is where the two cards of the low hand sit among the seven
 * as dealt (the rest are the high hand), and a hand is set once. `spots` is solo only, between
 * rounds.
 */
export type PaiGowAction =
  | { type: 'bet'; bet: Cents; fortune: Cents; spot?: number }
  | { type: 'deal' }
  | { type: 'spots'; n: number }
  | { type: 'set'; low: [number, number]; spot?: number };

export type Phase = 'idle' | 'betting' | 'setting' | 'results';

export interface SeatView {
  bet: Cents;
  fortune: Cents;
  /** Empty before the deal. Your own seven, or anyone's once turned over; otherwise nulls. */
  cards: (PgCard | null)[];
  /** Whether the hand is set (by its player, or by the house way when the clock ran out). */
  set: boolean;
  /** How it was set: yours once you set it, anyone's once turned over. */
  setting: Setting | null;
  result: Settlement | null;
}

export interface PaiGowView {
  phase: Phase;
  round: number;
  /** Multiplayer: when the betting window or the setting closes. */
  deadline: number | null;
  seats: Record<number, SeatView>;
  /** The spots the viewer plays, first spot first (a spectator: none). */
  mine: number[];
  /** The dealer's seven: empty before the deal, nulls until turned over. */
  dealer: (PgCard | null)[];
  /** How the dealer set them, by the house way, once turned over. */
  dealerSetting: Setting | null;
  fortune: FortunePays;
}

/** Events, in the order they happen. `hand` goes only to the seat that plays it. */
export type PaiGowEvent =
  | { type: 'betting'; round: number; deadline: number | null }
  | { type: 'bets'; seat: number; bet: Cents; fortune: Cents }
  | { type: 'deal'; seats: number[] }
  | { type: 'hand'; to: number; seat: number; cards: PgCard[] }
  | { type: 'setting'; deadline: number | null }
  /** A hand is set, face down (`auto`: by the house way, the clock or a leaving player's). */
  | { type: 'set'; seat: number; auto?: true }
  /** The dealer turns over seven cards and sets them by the house way. */
  | { type: 'reveal'; dealer: PgCard[]; setting: Setting }
  | { type: 'show'; seat: number; cards: PgCard[]; setting: Setting }
  | { type: 'result'; seat: number; result: Settlement }
  | { type: 'spots'; seat: number; n: number }
  | { type: 'idle' };
