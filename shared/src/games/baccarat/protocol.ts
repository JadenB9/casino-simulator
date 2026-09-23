// What a baccarat table says on the wire: the actions a seat sends, the events the client
// animates, and the view it draws from. Money is integer cents throughout.
//
// Actions
//   { type: 'bet', player?, banker?, tie?, playerPair?, bankerPair? }  add chips to spots, all or nothing
//   { type: 'undo' }    take back the last bet action this coup
//   { type: 'clear' }   take back every bet this coup
//   { type: 'deal' }    solo only: no more bets, deal the coup
//
// Events, in the order a coup plays out
//   betting {window, deadline}         a betting window opened (deadline null at a solo table)
//   bet {seat, bets}                   a seat's bets changed (the full set)
//   refund {seat, spot, amount}        multiplayer: a bet under the spot's minimum came back at the close
//   nomore                             "No more bets"
//   shuffle {shoe}, burn {card, count} a new shoe: the first card shown, then `count` burned face down
//   cutcard                            the cut card came out: this coup and one more, then a shuffle
//   card {hand, card, faceUp}          shoe to hand; the first four face down, third cards face up
//   reveal {hand, total}               the dealer turns a hand's two cards, Player first
//   natural {player, banker}           an 8 or 9: both hands stand
//   draw {hand} | stand {hand, total}  the tableau's call for each hand
//   outcome {winner, player, banker, natural, playerPair, bankerPair}
//   result {seat, spots, wagered, returned, commission}  per seat, highest seat number first
//   lasthand                           the next coup is the last of this shoe
//   idle                               nobody is seated

import type { Cents } from '../../money.ts';
import type { Card } from '../../cards.ts';
import type { Bets, Burn, Coup, SeatResult, Spot, Winner, Hand } from './rules.ts';

export type BaccaratAction =
  | { type: 'bet'; bets: Bets }
  | { type: 'undo' }
  | { type: 'clear' }
  | { type: 'deal' };

/** One coup on the scoreboard. Short keys: a shoe holds about 80 of these and every view carries them. */
export interface RoadEntry {
  /** Winner: Player, Banker or Tie. */
  w: 'P' | 'B' | 'T';
  /** Final totals. */
  p: number;
  b: number;
  /** Player pair, Banker pair, natural. */
  pp: boolean;
  bp: boolean;
  n: boolean;
}

export type BaccaratPhase = 'idle' | 'betting' | 'results';

export interface ShoeView {
  /** Shoes started at this table (0 before the first shuffle). */
  no: number;
  /** Coups dealt from this shoe. */
  coups: number;
  /** Cards still in the shoe, and cards dealt or burned from it (in the discard or on the felt). */
  left: number;
  used: number;
  /** The cut card is out: the next coup is the last one. */
  lastHand: boolean;
  /** The last hand has been dealt: the next coup starts a new shoe. */
  shuffleNext: boolean;
  /** This shoe's burn card (only the face-up one). */
  burn: Burn | null;
}

export interface BaccaratView {
  phase: BaccaratPhase;
  /** Betting windows opened at this table; each coup has its own. */
  window: number;
  /** When betting closes (multiplayer only). */
  deadline: number | null;
  /** Every seat's bets this coup. Bets are on the felt for everyone to see. */
  bets: Record<number, Bets>;
  /** The coup on the felt: dealt and settled in one step, so every card in it is already public. */
  coup: Coup | null;
  results: Record<number, SeatResult>;
  /** This shoe's coups, oldest first: the source of the Bead Plate and the Big Road. */
  history: RoadEntry[];
  shoe: ShoeView;
}

export type BaccaratEvent =
  | { type: 'betting'; window: number; deadline: number | null }
  | { type: 'bet'; seat: number; bets: Bets }
  | { type: 'refund'; seat: number; spot: Spot; amount: Cents }
  | { type: 'nomore' }
  | { type: 'shuffle'; shoe: number }
  | { type: 'burn'; card: Card; count: number }
  | { type: 'cutcard' }
  | { type: 'card'; hand: Hand; card: Card; faceUp: boolean }
  | { type: 'reveal'; hand: Hand; total: number }
  | { type: 'natural'; player: number; banker: number }
  | { type: 'draw'; hand: Hand }
  | { type: 'stand'; hand: Hand; total: number }
  | { type: 'outcome'; winner: Winner; player: number; banker: number; natural: boolean; playerPair: boolean; bankerPair: boolean }
  | ({ type: 'result'; seat: number } & SeatResult)
  | { type: 'lasthand' }
  | { type: 'idle' };
