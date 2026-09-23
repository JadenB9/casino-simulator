// Sic Bo on the wire: the actions a seat may send, the events the table animates, and the view.
//
// Actions (inside `{ t: 'act', aid, a }`):
//   bet    { bets: { spot, amount }[] }   one or more chips, all accepted or none ('total:10', 'combo:2-5' ...)
//   undo                                  take back your last placement
//   clear                                 take back everything you have on the layout
//   rebet  { double? }                    repeat last roll's bets; double: twice them, or double
//                                         what is on the layout if it isn't empty
//   ready  { on }                         multiplayer: done betting for this roll
//   roll                                  single player: no more bets, shake the dice
//
// Events: betting, bet, ready, roll, settle, idle. Everything at a Sic Bo table is public: every
// seat's chips and every result. The dice are drawn when betting closes and arrive in the same
// message as the settled view; the client shakes the dome and lands the dice on them.

import type { Cents } from '../../money.ts';
import { isObj, isAmount } from '../../protocol.ts';
import type { Dice } from './rules.ts';

/** A frame is capped at 4 KB, so one action carries at most this many chips. */
export const MAX_BETS_PER_ACTION = 40;

export interface BetInput {
  spot: string;
  amount: Cents;
}

export type SicBoAction =
  | { type: 'bet'; bets: BetInput[] }
  | { type: 'undo' }
  | { type: 'clear' }
  | { type: 'rebet'; double: boolean }
  | { type: 'ready'; on: boolean }
  | { type: 'roll' };

export type Phase = 'idle' | 'betting' | 'results';

/** One settled bet: spot key, amount staked, amount returned (0, or stake plus win). */
export type SettledBet = [key: string, amount: Cents, returned: Cents];

export interface SeatSettle {
  wagered: Cents;
  returned: Cents;
  bets: SettledBet[];
}

export interface RollInfo {
  round: number;
  dice: Dice;
  /** Server time the dome starts shaking ("No more bets"). */
  shakeAt: number;
  /** Server time the dice come to rest. */
  restAt: number;
}

export interface SicBoView {
  phase: Phase;
  round: number;
  /** Multiplayer: betting closes at this server time (betting), or the next window opens (results). */
  deadline: number | null;
  /** Chips on the layout this round: seat -> spot key -> cents. */
  bets: Record<number, Record<string, Cents>>;
  /** Seats that pressed Ready this round (multiplayer). */
  ready: number[];
  /** The last roll, once decided. */
  roll: RollInfo | null;
  /** The last roll's results per seat. */
  settled: Record<number, SeatSettle>;
  /** Most recent first. */
  history: Dice[];
  /** Seats that have bets from an earlier roll to repeat. */
  canRebet: number[];
}

export type SicBoEvent =
  | { type: 'betting'; to?: 'all'; round: number; deadline: number | null }
  | { type: 'bet'; to?: 'all'; seat: number; bets: Record<string, Cents> }
  | { type: 'ready'; to?: 'all'; seat: number; on: boolean }
  | { type: 'roll'; to?: 'all'; round: number; dice: Dice; shakeAt: number; restAt: number }
  | { type: 'settle'; to?: 'all'; round: number; dice: Dice; seats: Record<number, SeatSettle> }
  | { type: 'idle'; to?: 'all' };

const SPOT_RE = /^[a-z]{3,9}(:\d{1,2}(-\d)?)?$/;

/** Shape only; act() checks every rule. */
export function parseAction(raw: unknown): SicBoAction | null {
  if (!isObj(raw)) return null;
  switch (raw.type) {
    case 'bet': {
      const list = raw.bets;
      if (!Array.isArray(list) || list.length === 0 || list.length > MAX_BETS_PER_ACTION) return null;
      const bets: BetInput[] = [];
      for (const b of list) {
        if (!isObj(b) || typeof b.spot !== 'string' || !SPOT_RE.test(b.spot) || !isAmount(b.amount)) return null;
        bets.push({ spot: b.spot, amount: b.amount });
      }
      return { type: 'bet', bets };
    }
    case 'undo':
    case 'clear':
    case 'roll':
      return { type: raw.type };
    case 'rebet':
      if (raw.double !== undefined && typeof raw.double !== 'boolean') return null;
      return { type: 'rebet', double: raw.double === true };
    case 'ready':
      if (typeof raw.on !== 'boolean') return null;
      return { type: 'ready', on: raw.on };
    default:
      return null;
  }
}
