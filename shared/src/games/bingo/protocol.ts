// Bingo on the wire: the actions a seat may send, the events the hall animates, and the view.
//
// Actions (inside `{ t: 'act', aid, a }`):
//   buy    { count, stake }   1 to 4 more cards for this game, each priced `stake`
//   max    { count }          that many cards at the most they can each cost: the table maximum,
//                             or your chips shared between them if that is less
//   return                    hand back every card bought for this game (while cards are on sale)
//   rebuy                     last game's cards again: as many, at the same price
//   call                      alone: eyes down now instead of waiting for the clock
//
// Events: buying, cards (to its owner only: the numbers on the new cards), bought, returned,
// eyesdown, ball, win, end, idle. Cards are dealt when they are bought; the ball order is drawn
// when the sale closes and lives only in the engine's state. Each ball is told as it is called,
// never before.

import type { Cents } from '../../money.ts';
import { isObj, isAmount } from '../../protocol.ts';
import type { Card, Pattern } from './rules.ts';

/** The most cards one player may have in a game. */
export const MAX_CARDS = 4;

export type BingoAction =
  | { type: 'buy'; count: number; stake: Cents }
  | { type: 'max'; count: number }
  | { type: 'return' }
  | { type: 'rebuy' }
  | { type: 'call' };

/** idle: nobody seated. buying: cards on sale. calling: balls coming out. results: the game has ended. */
export type Phase = 'idle' | 'buying' | 'calling' | 'results';

/** A prize a card has collected: the call it was completed on and what it paid. */
export interface Won {
  call: number;
  paid: Cents;
}

export interface CardView {
  id: number;
  nums: Card;
  stake: Cents;
  won: Partial<Record<Pattern, Won>>;
}

/** Someone in the hall, as everyone sees them: no numbers, just how they're doing. */
export interface PlayerView {
  cards: number;
  staked: Cents;
  won: Cents;
  /** The fewest numbers any of their cards needs for a prize still open (null: nothing open). */
  best: number | null;
}

export interface SeatResult {
  wagered: Cents;
  returned: Cents;
}

/** A finished game in the hall's history. */
export interface GameSummary {
  round: number;
  calls: number;
  cards: number;
  /** The biggest single prize in the game, as a multiple in hundredths, and its pattern. */
  top: { pattern: Pattern; mult: number; call: number } | null;
}

export interface BingoView {
  phase: Phase;
  round: number;
  /** buying: when the sale closes (null alone, until the first card); calling: the next ball; results: the next sale. */
  deadline: number | null;
  /** How long a sale runs at this table (for the clock's ring). */
  window: number;
  /** How far apart the balls come. */
  callMs: number;
  /** Every ball called this game, in order. */
  called: number[];
  /** The viewer's own cards this game (empty when they have none; null for a spectator). */
  mine: CardView[] | null;
  players: Record<number, PlayerView>;
  /** The last game's results per seat. */
  results: Record<number, SeatResult>;
  history: GameSummary[];
  /** Seats with an earlier game's cards to buy again. */
  canRebuy: number[];
}

export type BingoEvent =
  | { type: 'buying'; round: number; deadline: number | null }
  | { type: 'cards'; to: number; seat: number; cards: CardView[] }
  | { type: 'bought'; seat: number; cards: number; staked: Cents }
  | { type: 'returned'; seat: number; refund: Cents }
  | { type: 'eyesdown'; round: number; cards: number; first: number }
  | { type: 'ball'; call: number; ball: number; next: number | null }
  | { type: 'win'; seat: number; card: number; pattern: Pattern; call: number; mult: number; paid: Cents }
  | { type: 'end'; round: number; calls: number; seats: Record<number, SeatResult> }
  | { type: 'idle' };

function isCount(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= MAX_CARDS;
}

/** Shape only; act() checks every rule. */
export function parseAction(raw: unknown): BingoAction | null {
  if (!isObj(raw)) return null;
  switch (raw.type) {
    case 'buy':
      return isCount(raw.count) && isAmount(raw.stake) ? { type: 'buy', count: raw.count, stake: raw.stake } : null;
    case 'max':
      return isCount(raw.count) ? { type: 'max', count: raw.count } : null;
    case 'return':
    case 'rebuy':
    case 'call':
      return { type: raw.type };
    default:
      return null;
  }
}
