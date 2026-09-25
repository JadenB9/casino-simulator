// A bot's view of the table: its own two cards and everything public (the board, the bets, the
// stacks, this hand's actions, and what it has seen each player do before), built from the rules'
// hand and nothing else. The engine and the bot-against-bot tests build it the same way, so what
// the tests measure is what plays at the tables.

import type { Cents } from '../../money.ts';
import * as R from './rules.ts';
import type { BotSituation, Position } from './bots.ts';
import { tendency, type Act, type Reads } from './reads.ts';

/** The public story of a hand so far, as the engine keeps it. */
export interface PublicHand {
  acts: readonly Act[];
  /** Bets and raises before the flop, and calls of the big blind before any raise. */
  pre: { raises: number; limpers: number };
  /** Bets and raises on this street. */
  streetRaises: number;
  /** Who made the last bet or raise on the previous street. */
  prevAggressor: number | null;
}

/** Where a seat sits before the flop: 0 the button, 1 the cutoff, 2 the hijack...; -1 small blind, -2 big blind. */
export function distOf(h: R.Hand, seat: number): number {
  if (h.players.length === 2) return seat === h.button ? 0 : -2;
  if (seat === h.sbSeat) return -1;
  if (seat === h.bbSeat) return -2;
  const seats = h.players.map((p) => p.seat);
  let d = 0;
  for (let x = seat; x !== h.button; x = R.after(seats, x)) d++;
  return d;
}

/** After the flop, the button acts last: how late a seat acts, 0 first. */
export function lateness(h: R.Hand, seat: number): number {
  return (seat - h.button + 63) % 64;
}

/** early, middle, late or a blind, by the share of the seats before the button (Tips use the same). */
export function positionOf(h: R.Hand, seat: number): Position {
  if (seat === h.button) return 'late';
  if (seat === h.sbSeat) return 'sb';
  if (seat === h.bbSeat) return 'bb';
  const seats = h.players.map((p) => p.seat);
  const order: number[] = [];
  for (let x = R.after(seats, h.bbSeat); x !== h.button; x = R.after(seats, x)) order.push(x);
  const i = order.indexOf(seat);
  const f = order.length <= 1 ? 1 : i / order.length;
  return f < 1 / 3 ? 'early' : f < 2 / 3 ? 'middle' : 'late';
}

/** What the bot in `seat` can see: its own cards and the public table, nothing else. */
export function situationOf(h: R.Hand, seat: number, pub: PublicHand, reads: Reads, names: Record<number, string>, step: Cents): BotSituation {
  const p = R.player(h, seat)!;
  const opps = h.players.filter((o) => o.seat !== seat && !o.folded);
  const able = opps.filter((o) => !o.allIn);
  return {
    seat,
    hole: [p.hole[0]!, p.hole[1]!],
    board: [...h.board],
    street: h.street,
    bb: h.bb,
    step,
    pot: R.potTotal(h),
    bet: h.bet,
    legal: R.legal(h, p, step),
    position: positionOf(h, seat),
    dist: distOf(h, seat),
    players: h.players.length,
    ip: able.every((o) => lateness(h, o.seat) < lateness(h, seat)),
    opponents: opps.map((o) => ({
      seat: o.seat,
      stack: o.start - o.put,
      street: o.street,
      allIn: o.allIn,
      dist: distOf(h, o.seat),
      read: tendency(reads[names[o.seat] ?? '']),
    })),
    acts: pub.acts.map((a) => ({ ...a })),
    preRaises: pub.pre.raises,
    limpers: pub.pre.limpers,
    streetRaises: pub.streetRaises,
    aggressor: pub.prevAggressor === seat,
  };
}

