// The Bandit Wheel on the wire: the actions a seat may send, the events the table animates, and
// the view.
//
// Actions (inside `{ t: 'act', aid, a }`):
//   bet    { bets: { spot, amount }[] }   one or more chips, all accepted or none
//   max    { spot }                       as much as the table takes on that number, or your stack
//   undo                                  take back your last placement
//   clear                                 take back everything you have down
//   rebet  { double? }                    repeat last spin's bets; double: twice them, or double
//                                         what is down if anything is
//   spin                                  single player: spin now instead of waiting for the clock
//
// Events: betting, bet, spin, settle, idle (shapes below). Everything at the wheel is public: every
// seat's bets, every result. The slot is drawn when betting closes and arrives in the same message
// as the settled view; the client turns the wheel onto it.

import type { Cents } from '../../money.ts';
import { isObj, isAmount } from '../../protocol.ts';
import { type WheelNumber, isNumber } from './rules.ts';

/** Five numbers; a doubled rebet or a burst of clicks still fits in one frame. */
export const MAX_BETS_PER_ACTION = 10;

export interface BetInput {
  spot: WheelNumber;
  amount: Cents;
}

export type BanditAction =
  | { type: 'bet'; bets: BetInput[] }
  | { type: 'max'; spot: WheelNumber }
  | { type: 'undo' }
  | { type: 'clear' }
  | { type: 'rebet'; double: boolean }
  | { type: 'spin' };

/** idle: nobody seated. betting: the terminals are open. results: the wheel turns, stops, pays. */
export type Phase = 'idle' | 'betting' | 'results';

/** One settled bet: number, amount staked, amount returned (0, or stake plus win). */
export type SettledBet = [spot: WheelNumber, amount: Cents, returned: Cents];

export interface SeatSettle {
  wagered: Cents;
  returned: Cents;
  bets: SettledBet[];
}

export interface SpinInfo {
  round: number;
  /** Index into WHEEL of the slot the flapper comes to rest in. */
  slot: number;
  number: WheelNumber;
  /** Server time the wheel is pulled ("No more bets"). */
  startAt: number;
  /** Server time the wheel comes to rest. */
  restAt: number;
}

export type Bets = Partial<Record<WheelNumber, Cents>>;

export interface BanditView {
  phase: Phase;
  round: number;
  /** betting: when the terminals close; results: when the next round opens. */
  deadline: number | null;
  /** How long a betting window runs at this table (for the countdown ring). */
  window: number;
  /** Chips down this round: seat -> number -> cents. */
  bets: Record<number, Bets>;
  /** The last spin, once decided. */
  spin: SpinInfo | null;
  /** The last spin's results per seat. */
  settled: Record<number, SeatSettle>;
  /** Slots that came up, most recent first. */
  history: number[];
  /** Seats with bets from an earlier spin to repeat. */
  canRebet: number[];
}

export type BanditEvent =
  | { type: 'betting'; to?: 'all'; round: number; deadline: number }
  | { type: 'bet'; to?: 'all'; seat: number; bets: Bets }
  | { type: 'spin'; to?: 'all'; round: number; slot: number; number: WheelNumber; startAt: number; restAt: number }
  | { type: 'settle'; to?: 'all'; round: number; slot: number; number: WheelNumber; seats: Record<number, SeatSettle> }
  | { type: 'idle'; to?: 'all' };

/** Shape only; act() checks every rule. */
export function parseAction(raw: unknown): BanditAction | null {
  if (!isObj(raw)) return null;
  switch (raw.type) {
    case 'bet': {
      const list = raw.bets;
      if (!Array.isArray(list) || list.length === 0 || list.length > MAX_BETS_PER_ACTION) return null;
      const bets: BetInput[] = [];
      for (const b of list) {
        if (!isObj(b) || !isNumber(b.spot) || !isAmount(b.amount)) return null;
        bets.push({ spot: b.spot, amount: b.amount });
      }
      return { type: 'bet', bets };
    }
    case 'max':
      return isNumber(raw.spot) ? { type: 'max', spot: raw.spot } : null;
    case 'undo':
    case 'clear':
    case 'spin':
      return { type: raw.type };
    case 'rebet':
      if (raw.double !== undefined && typeof raw.double !== 'boolean') return null;
      return { type: 'rebet', double: raw.double === true };
    default:
      return null;
  }
}
