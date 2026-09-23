// Big Six on the wire: the actions a seat may send, the events the table animates, and the view.
//
// Actions (inside `{ t: 'act', aid, a }`):
//   bet    { bets: { spot, amount }[] }   one or more chips, all accepted or none
//   undo                                  take back your last placement
//   clear                                 take back everything you have on the layout
//   rebet  { double? }                    repeat last spin's bets; double: twice them, or double
//                                         what is on the layout if it isn't empty
//   ready  { on }                         multiplayer: done betting for this spin
//   spin                                  single player: no more bets, spin
//
// Events: betting, bet, ready, spin, settle, idle (shapes below). Everything at a Big Six table is
// public: every seat's chips, every result. The stop is drawn when betting closes and arrives in
// the same message as the settled view; the client turns the wheel onto it.

import type { Cents } from '../../money.ts';
import { isObj, isAmount } from '../../protocol.ts';
import { type SymbolId, isSymbol } from './rules.ts';

/** Seven spots; a doubled rebet or a burst of clicks still fits in one frame. */
export const MAX_BETS_PER_ACTION = 14;

export interface BetInput {
  spot: SymbolId;
  amount: Cents;
}

export type BigSixAction =
  | { type: 'bet'; bets: BetInput[] }
  | { type: 'undo' }
  | { type: 'clear' }
  | { type: 'rebet'; double: boolean }
  | { type: 'ready'; on: boolean }
  | { type: 'spin' };

export type Phase = 'idle' | 'betting' | 'results';

/** One settled bet: spot, amount staked, amount returned (0, or stake plus win). */
export type SettledBet = [spot: SymbolId, amount: Cents, returned: Cents];

export interface SeatSettle {
  wagered: Cents;
  returned: Cents;
  bets: SettledBet[];
}

export interface SpinInfo {
  round: number;
  /** Index into WHEEL of the stop the clapper comes to rest on. */
  stop: number;
  symbol: SymbolId;
  /** Server time the dealer pulls the wheel ("No more bets"). */
  startAt: number;
  /** Server time the wheel comes to rest. */
  restAt: number;
}

export interface BigSixView {
  phase: Phase;
  round: number;
  /** Multiplayer: betting closes at this server time (betting), or the next window opens (results). */
  deadline: number | null;
  /** Chips on the layout this round: seat -> spot -> cents. */
  bets: Record<number, Partial<Record<SymbolId, Cents>>>;
  /** Seats that pressed Ready this round (multiplayer). */
  ready: number[];
  /** The last spin, once decided. */
  spin: SpinInfo | null;
  /** The last spin's results per seat. */
  settled: Record<number, SeatSettle>;
  /** Stops that came up, most recent first. */
  history: number[];
  /** Seats with bets from an earlier spin to repeat. */
  canRebet: number[];
}

export type BigSixEvent =
  | { type: 'betting'; to?: 'all'; round: number; deadline: number | null }
  | { type: 'bet'; to?: 'all'; seat: number; bets: Partial<Record<SymbolId, Cents>> }
  | { type: 'ready'; to?: 'all'; seat: number; on: boolean }
  | { type: 'spin'; to?: 'all'; round: number; stop: number; symbol: SymbolId; startAt: number; restAt: number }
  | { type: 'settle'; to?: 'all'; round: number; stop: number; symbol: SymbolId; seats: Record<number, SeatSettle> }
  | { type: 'idle'; to?: 'all' };

/** Shape only; act() checks every rule. */
export function parseAction(raw: unknown): BigSixAction | null {
  if (!isObj(raw)) return null;
  switch (raw.type) {
    case 'bet': {
      const list = raw.bets;
      if (!Array.isArray(list) || list.length === 0 || list.length > MAX_BETS_PER_ACTION) return null;
      const bets: BetInput[] = [];
      for (const b of list) {
        if (!isObj(b) || !isSymbol(b.spot) || !isAmount(b.amount)) return null;
        bets.push({ spot: b.spot, amount: b.amount });
      }
      return { type: 'bet', bets };
    }
    case 'undo':
    case 'clear':
    case 'spin':
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

