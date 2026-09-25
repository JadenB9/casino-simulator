// What every held order on this screen shares: when each was first seen in a hand (the start of
// its timetable here), the acts your own keys added to yours, the odd gesture that isn't a
// portion (a toast, handing the empty back, a pat on a full stomach), and whose order is yours.

import { serverNow } from '../../net/clock.ts';
import type { Act } from './schedule.ts';

/** A gesture that isn't a portion: a toast, handing the empty back, a pat on the belly. */
export type Extra = 'toast' | 'give' | 'pat';

export const EXTRA_SECS: Record<Extra, number> = { toast: 2.4, give: 1.7, pat: 2.2 };

export interface ExtraAct {
  kind: Extra;
  t0: number;
  /** A toast: where the other glass is coming from (world, horizontal), for the clink. */
  toward?: { x: number; z: number };
}

const seen = new Map<string, number>();
const own = new Map<string, number[]>();
const extras = new Map<string, ExtraAct[]>();
let mine: string | null = null;
let clock: () => number = serverNow;

/** The time everything here runs on: the server's clock (a test or a still shot can pin it). */
export function now(): number {
  return clock();
}

export function setClock(fn: (() => number) | null): void {
  clock = fn ?? serverNow;
}

/** When this screen first saw the order in a hand (the first call decides). */
export function firstSeen(order: string, at = now()): number {
  let t = seen.get(order);
  if (t === undefined) {
    t = at;
    seen.set(order, t);
    // an order is held five minutes: nothing older is worth keeping
    if (seen.size > 200) for (const [k, v] of seen) if (v < at - 3_600_000) seen.delete(k);
  }
  return t;
}

/** Your own acts on an order (your Sip key), in order. */
export function ownActs(order: string): readonly number[] {
  return own.get(order) ?? [];
}

export function addOwnAct(order: string, t: number): void {
  const list = own.get(order) ?? [];
  list.push(t);
  own.set(order, list);
}

export function extraActs(order: string): readonly ExtraAct[] {
  return extras.get(order) ?? [];
}

export function addExtra(order: string, e: ExtraAct): void {
  const list = extras.get(order) ?? [];
  list.push(e);
  // only the last few matter
  if (list.length > 8) list.shift();
  extras.set(order, list);
}

/** The extra going on at `t`, if any. */
export function extraAt(order: string, t: number): { e: ExtraAct; phase: number } | null {
  const list = extras.get(order);
  if (!list) return null;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i]!;
    const phase = (t - e.t0) / (EXTRA_SECS[e.kind] * 1000);
    if (phase >= 0 && phase < 1) return { e, phase };
  }
  return null;
}

/** Your own order (the one your keys and your effects follow). */
export function myOrder(): string | null {
  return mine;
}

export function setMyOrder(order: string | null): void {
  mine = order;
}

export type AnyAct = Act | Extra;
