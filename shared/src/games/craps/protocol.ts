// Craps on the wire: the actions a seat sends, the view every seat gets, and the events the
// client animates. Nothing at a craps table is hidden, so every seat gets the same view.

import type { Cents } from '../../money.ts';
import { isObj, isAmount } from '../../protocol.ts';
import { BET_KINDS, NUMBERED, isBetId, isComeOnNumber, type Bet, type BetId, type BetKind, type PointNumber } from './rules.ts';

export interface BetRequest {
  kind: BetKind;
  number?: number;
  amount: Cents;
}

export type CrapsAction =
  /** Add chips to one or more spots, all or nothing. */
  | { type: 'bet'; bets: BetRequest[] }
  /** Take or lay odds behind `on`: 'pass', 'dontpass', 'come6', 'dontcome9'... */
  | { type: 'odds'; on: BetId; amount: Cents }
  /** Take a bet down, or `amount` of it. `part: 'odds'` takes down only the odds behind it. */
  | { type: 'down'; id: BetId; part?: 'odds'; amount?: Cents }
  /** Call a bet on or off (null: back to the house default). */
  | { type: 'working'; id: BetId; on: boolean | null }
  /** The shooter throws the dice. */
  | { type: 'roll' };

export interface CrapsView {
  /** The puck: null while it is OFF (a come-out roll is next). */
  point: PointNumber | null;
  /** Multiplayer tables sit 'idle' until the leader starts them. */
  phase: 'idle' | 'open';
  shooter: number | null;
  /** Rolls at this table so far. */
  rolls: number;
  /** Points the current shooter has made. */
  pointsMade: number;
  /** The last rolls, oldest first. */
  history: [number, number][];
  /** Every seat's bets, by spot. */
  bets: Record<number, Record<BetId, Bet>>;
  /** Multiplayer: bets go down until `pauseUntil`; the shooter must throw by `rollBy`. */
  pauseUntil: number | null;
  rollBy: number | null;
  pauseOver: boolean;
  /** The shooter has thrown and the dice fly as soon as the pause ends. */
  rollRequested: boolean;
  /** Seats that asked to leave while contract bets were still up. */
  leaving: number[];
  /** Whether this table books lay bets (a house option, off by default). */
  lay: boolean;
}

/**
 * Events, in the order they happen:
 * - `bet` {seat, id, bet}: a spot's new contents (bet null = the spot was cleared) after a
 *   bet, odds, a take-down or an on/off call; `back` is what came back to the stack.
 * - `roll` {shooter, dice: [d1, d2], total, point, auto}: `point` is the puck before the roll.
 * - `result` {seat, id, flat, odds?, win, back}: one decided bet.
 * - `move` {seat, from, id, amount}: a come or don't come bet travels from its box to spot `id`.
 * - `puck` {point, made?, sevenOut?}
 * - `shooter` {seat, why: 'first' | 'sevenout' | 'left' | 'nobet'}
 * - `open` {pauseUntil, rollBy}: a multiplayer betting pause.
 * - `requested` {seat}: the shooter threw; the dice fly when the pause ends.
 * - `leaving` {seat}: a seat is waiting for its contract bets to resolve.
 */
export type CrapsEvent = { type: string; [key: string]: unknown };

const MAX_BATCH = 24;

export function parseAction(raw: unknown): CrapsAction | null {
  if (!isObj(raw)) return null;
  switch (raw.type) {
    case 'bet': {
      if (!Array.isArray(raw.bets) || raw.bets.length === 0 || raw.bets.length > MAX_BATCH) return null;
      const bets: BetRequest[] = [];
      for (const b of raw.bets) {
        if (!isObj(b) || !(BET_KINDS as readonly unknown[]).includes(b.kind) || !isAmount(b.amount)) return null;
        const kind = b.kind as BetKind;
        const nums = NUMBERED[kind];
        if (nums) {
          if (typeof b.number !== 'number' || !nums.includes(b.number)) return null;
          bets.push({ kind, number: b.number, amount: b.amount });
        } else {
          if (b.number !== undefined) return null;
          bets.push({ kind, amount: b.amount });
        }
      }
      return { type: 'bet', bets };
    }
    case 'odds':
      if (!isAmount(raw.amount)) return null;
      if (raw.on !== 'pass' && raw.on !== 'dontpass' && !(isBetId(raw.on) && isComeOnNumber(raw.on))) return null;
      return { type: 'odds', on: raw.on, amount: raw.amount };
    case 'down': {
      if (!isBetId(raw.id)) return null;
      if (raw.part !== undefined && raw.part !== 'odds') return null;
      if (raw.amount !== undefined && !isAmount(raw.amount)) return null;
      const a: CrapsAction = { type: 'down', id: raw.id };
      if (raw.part === 'odds') a.part = 'odds';
      if (raw.amount !== undefined) a.amount = raw.amount as Cents;
      return a;
    }
    case 'working':
      if (!isBetId(raw.id) || (raw.on !== true && raw.on !== false && raw.on !== null)) return null;
      return { type: 'working', id: raw.id, on: raw.on };
    case 'roll':
      return { type: 'roll' };
    default:
      return null;
  }
}
