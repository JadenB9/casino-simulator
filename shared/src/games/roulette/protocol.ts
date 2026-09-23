// Roulette on the wire: the actions a seat may send, the events the table animates, and the view.
//
// Actions (inside `{ t: 'act', aid, a }`):
//   bet    { bets: { kind, numbers?, amount }[] }   one or more chips, all accepted or none
//   undo                                           take back your last placement
//   clear                                          take back everything you have on the layout
//   rebet  { double? }                             repeat last spin's bets; double: twice them, or
//                                                  double what is on the layout if it isn't empty
//   ready  { on }                                  multiplayer: done betting for this spin
//   spin                                           single player: no more bets, spin
//
// Events: betting, bet, ready, spin, settle, idle (shapes below). Everything at a roulette table is
// public: every seat's chips, every result. The pocket is chosen when betting closes and arrives
// in the same message as the settled view; the client animates the ball to it.

import type { Cents } from '../../money.ts';
import { isObj, isAmount, isInt } from '../../protocol.ts';
import { type BetKind, type Variant, isBetKind } from './rules.ts';

/** A frame is capped at 4 KB, so one action carries at most this many chips. */
export const MAX_BETS_PER_ACTION = 40;

export interface BetInput {
  kind: BetKind;
  numbers?: number[];
  amount: Cents;
}

export type RouletteAction =
  | { type: 'bet'; bets: BetInput[] }
  | { type: 'undo' }
  | { type: 'clear' }
  | { type: 'rebet'; double: boolean }
  | { type: 'ready'; on: boolean }
  | { type: 'spin' };

export type Phase = 'idle' | 'betting' | 'results';

/** One settled bet: spot key, amount staked, amount returned (0, or stake plus win). */
export type SettledBet = [key: string, amount: Cents, returned: Cents];

export interface SeatSettle {
  wagered: Cents;
  returned: Cents;
  bets: SettledBet[];
}

export interface SpinInfo {
  round: number;
  pocket: number;
  /** Server time the ball left the dealer's hand. */
  launchAt: number;
  /** Server time the ball comes to rest in the pocket. */
  restAt: number;
}

export interface RouletteView {
  variant: Variant;
  phase: Phase;
  round: number;
  /** Multiplayer: betting closes at this server time (betting), or the next window opens (results). */
  deadline: number | null;
  /** Multiplayer betting: when the dealer puts the ball in, a few seconds before "No more bets". */
  launchAt: number | null;
  /** Chips on the layout this round: seat -> spot key -> cents. */
  bets: Record<number, Record<string, Cents>>;
  /** Seats that pressed Ready this round (multiplayer). */
  ready: number[];
  /** The last spin, once decided. */
  spin: SpinInfo | null;
  /** The last spin's results per seat. */
  settled: Record<number, SeatSettle>;
  /** Most recent first. */
  history: number[];
  /** Whether each seat has bets from an earlier spin to repeat. */
  canRebet: number[];
}

export type RouletteEvent =
  | { type: 'betting'; to?: 'all'; round: number; deadline: number | null; launchAt: number | null }
  | { type: 'bet'; to?: 'all'; seat: number; bets: Record<string, Cents> }
  | { type: 'ready'; to?: 'all'; seat: number; on: boolean }
  | { type: 'spin'; to?: 'all'; round: number; pocket: number; launchAt: number; restAt: number }
  | { type: 'settle'; to?: 'all'; round: number; pocket: number; seats: Record<number, SeatSettle> }
  | { type: 'idle'; to?: 'all' };

/** Shape only; act() checks every rule. */
export function parseAction(raw: unknown): RouletteAction | null {
  if (!isObj(raw)) return null;
  switch (raw.type) {
    case 'bet': {
      const list = raw.bets;
      if (!Array.isArray(list) || list.length === 0 || list.length > MAX_BETS_PER_ACTION) return null;
      const bets: BetInput[] = [];
      for (const b of list) {
        if (!isObj(b) || !isBetKind(b.kind) || !isAmount(b.amount)) return null;
        if (b.numbers === undefined) {
          bets.push({ kind: b.kind, amount: b.amount });
          continue;
        }
        if (!Array.isArray(b.numbers) || b.numbers.length > 6 || !b.numbers.every(isInt)) return null;
        bets.push({ kind: b.kind, numbers: [...(b.numbers as number[])], amount: b.amount });
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
