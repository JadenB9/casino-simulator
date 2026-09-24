// Casino War on the wire: the actions a player sends, the events the table animates and the view
// every seat gets. Every card in Casino War is dealt face up, so the views hide nothing but the
// shoe's order and the burned cards, which never leave the server.
//
// Hands are played at spots numbered like the seats (games/spots.ts), and every `seat` in the
// events and the view below is a spot. At a shared table each player plays their own seat's spot;
// a solo player can play up to three spots at once, spots 0 to n - 1, from one stack.

import type { Card } from '../../cards.ts';
import type { Cents } from '../../money.ts';
import type { Settlement, WarRules } from './rules.ts';

/**
 * `bet` sets a spot's bet and Tie bet to these totals (0 takes a bet down), so Undo, Clear, Rebet
 * and x2 are all one message and a resend can't double a bet. `deal` is solo only; multiplayer
 * deals when the betting window closes. `war` places the raise (always equal to the bet);
 * `surrender` takes half the bet back. `spot` says which of your spots (your first when absent);
 * `spots` is solo only, between rounds.
 */
export type WarAction =
  | { type: 'bet'; bet: Cents; tie: Cents; spot?: number }
  | { type: 'deal' }
  | { type: 'spots'; n: number }
  | { type: 'war'; spot?: number }
  | { type: 'surrender'; spot?: number };

export type Phase = 'idle' | 'betting' | 'deciding' | 'results';

/** Only a tie on the deal asks for a decision; null for every other hand. */
export type Decision = 'pending' | 'war' | 'surrender';

export interface SeatView {
  bet: Cents;
  tie: Cents;
  /** The War raise once placed. */
  raise: Cents;
  /** The card from the deal, then the war card beside it. */
  card: Card | null;
  warCard: Card | null;
  decision: Decision | null;
  /** What the Tie bet paid at the deal, stake included (0 when it lost); null before the deal or without one. */
  tiePaid: Cents | null;
  result: Settlement | null;
}

export interface WarView {
  phase: Phase;
  round: number;
  /** Multiplayer: when the betting window or the decision closes, or the results come down. */
  deadline: number | null;
  /** Every spot with a bet this round. */
  seats: Record<number, SeatView>;
  /** The spots the viewer plays, first spot first (a spectator: none). */
  mine: number[];
  dealer: Card | null;
  dealerWar: Card | null;
  rules: WarRules;
  /**
   * What anyone at the table can see of the shoe: which shoe, how many cards are left in it, and
   * whether the cover card has come out (the cards are reshuffled before the next deal).
   */
  shoe: { no: number; left: number; cutOut: boolean };
}

/** Events, in the order they happen. Every card is public the moment it is dealt. */
export type WarEvent =
  | { type: 'betting'; round: number; deadline: number | null }
  | { type: 'bets'; seat: number; bet: Cents; tie: Cents }
  | { type: 'shuffle'; shoe: number }
  | { type: 'deal'; seats: number[]; cards: Card[]; dealer: Card }
  | { type: 'cut' }
  | { type: 'tie'; seat: number; tiePaid: Cents | null }
  | { type: 'decide'; seats: number[]; deadline: number | null }
  | { type: 'decision'; seat: number; choice: 'war' | 'surrender'; raise: Cents; auto?: true }
  | { type: 'war'; seats: number[]; cards: Card[]; dealer: Card }
  | { type: 'result'; seat: number; result: Settlement }
  /** A solo player now plays `n` spots (this `seat` is the player's own seat). */
  | { type: 'spots'; seat: number; n: number }
  | { type: 'idle' };
