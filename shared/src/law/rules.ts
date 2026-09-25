// The law's rules, shared so the server enforces what the client explains.
//
//   Strikes   Caught once (security sees you throw a punch, or the pit boss sees you winning too
//             much at his tables) and you're warned. Caught again within STRIKE_WINDOW_MS of
//             that warning, you go to jail. A warning runs out after the window.
//   Jail      Across the street. You stay inside until your winnings at the jail's own tables
//             reach your bail; then you walk out with everything you have, strikes cleared.
//   Bail      A fiftieth of what you had when you went in (balance, chips on tables, the bank), rounded
//             to $100, never under $1,000 or over $25,000.
//   Progress  Each finished round at a jail table adds what it won or lost, but never takes you
//             below zero. Every round has a chance to win and a loss can only send you back to
//             the start, so you always get out eventually; and at a jail table's maximum bet
//             (a quarter of the bail) it takes a few more wins than losses. Broke inmates can
//             still take the bank's top-up from the booking desk, so nobody is ever stuck.
//   Winning   "Too much" at a table is net winnings there in the last HOT_WINDOW_MS of at least
//   too much  hotAmount() (scaled by the table's limits), or any single round that is a big win
//             by the floor's own rule (wins.ts). The pit boss has to see you: at the table, in
//             his room, in his cone.

import { DOLLAR, type Cents } from '../money.ts';
import type { GameId } from '../engine.ts';
import { clampLimits, type TableLimits } from '../limits.ts';
import type { Rect } from '../zones.ts';
import type { StaffId } from './patrol.ts';

/** A warning lasts this long; a second catch inside it means jail. */
export const STRIKE_WINDOW_MS = 5 * 60_000;
/**
 * After a warning, the same moment can't catch you twice: the pit boss's report of the streak
 * he just warned you about, a guard seeing the punch the other guard saw.
 */
export const STRIKE_QUIET_MS = 15_000;
/** How long the word lasts once he's there. */
export const WARN_TALK_MS = 4_000;
/** How long the guard takes to walk you out: from his arrival to the fade, and then the door. */
export const ESCORT_TALK_MS = 1_800;
/** Making bail: the door buzzes, then you're across the street at the casino's doors. */
export const RELEASE_MS = 2_500;

// --- punching -------------------------------------------------------------------------------

/** Your fist reaches someone this far away (metres, centre to centre)... */
export const PUNCH_REACH = 1.2;
/** ...inside this half-angle in front of you (radians). */
export const PUNCH_ARC = 0.95;
/** One punch per this long; mashing the key throws no more. */
export const PUNCH_GAP_MS = 650;

export interface PunchCandidate<Id> {
  id: Id;
  x: number;
  z: number;
}

/** The nearest candidate in reach and in front of someone at (x, z) facing `yaw`; null for a swing at the air. */
export function punchTarget<Id>(x: number, z: number, yaw: number, candidates: Iterable<PunchCandidate<Id>>): Id | null {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const cos = Math.cos(PUNCH_ARC);
  let best: Id | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const dx = c.x - x;
    const dz = c.z - z;
    const d = Math.hypot(dx, dz);
    if (d > PUNCH_REACH || d >= bestD) continue;
    // right on top of you counts whichever way you face
    if (d > 0.25 && (dx * fx + dz * fz) / d < cos) continue;
    best = c.id;
    bestD = d;
  }
  return best;
}

// --- winning too much ------------------------------------------------------------------------

export const HOT_WINDOW_MS = 5 * 60_000;
/** A table reports a hot streak at most this often per player (the pit boss may be looking the other way). */
export const HOT_REPORT_GAP_MS = 20_000;

/** Net winnings at one table in HOT_WINDOW_MS that draw the pit boss: four maximum bets, a hundred minimums, at least $1,000. */
export function hotAmount(l: TableLimits | null): Cents {
  const floor = 1_000 * DOLLAR;
  if (!l) return floor;
  return Math.max(floor, 4 * l.max, 100 * l.min);
}

// --- jail ------------------------------------------------------------------------------------

export const BAIL_MIN: Cents = 1_000 * DOLLAR;
export const BAIL_MAX: Cents = 25_000 * DOLLAR;

/** The bail for someone worth `worth` (balance, chips on tables and the bank at cost) when they went in. */
export function bailFor(worth: Cents): Cents {
  const raw = Math.round(Math.max(0, worth) / 50 / (100 * DOLLAR)) * 100 * DOLLAR;
  return Math.min(BAIL_MAX, Math.max(BAIL_MIN, raw));
}

/** Progress after a round that won (or lost) `net`: it never goes below zero. */
export function progressAfter(won: Cents, net: Cents): Cents {
  return Math.max(0, won + net);
}

/** The jail's games: a blackjack table and a Sic Bo table, each run by a guard. */
export const JAIL_GAMES: readonly { station: string; game: GameId; variant: string }[] = [
  { station: 'jail-bj', game: 'blackjack', variant: '' },
  { station: 'jail-sb', game: 'sicbo', variant: '' },
];

export function isJailGame(game: string): boolean {
  return JAIL_GAMES.some((g) => g.game === game);
}

/** A jail table's name: a solo table whose variant slot says jail, so the bank and the profile still read it as solo. */
export function jailTableName(game: GameId, accountId: number): string {
  return `solo:${game}:jail:${accountId}`;
}

export function isJailTable(name: string): boolean {
  return name.startsWith('solo:') && name.split(':')[2] === 'jail';
}

/** A jail table's limits: $5 to a quarter of the bail (moved to what the game allows). */
export function jailLimits(game: GameId, bail: Cents): TableLimits | null {
  const max = Math.max(50 * DOLLAR, Math.floor(bail / 4 / (5 * DOLLAR)) * 5 * DOLLAR);
  return clampLimits(game, { min: 5 * DOLLAR, max });
}

// The jail's floor plan, in metres, inside LOTS.jail (x 166-196, z -45..-5). The building runs
// x 167-195, z -41..-9: the visitors' hall at the front (x 167-172, z -30..-20, its door on the
// street), and behind the bars the prison proper, where inmates are kept.
export const JAIL = {
  building: { x0: 167, x1: 195, z0: -41, z1: -9 },
  hall: { x0: 167, x1: 172, z0: -30, z1: -20 },
  /** Where inmates may be (the walls inside it are the client's; the server keeps them in this box). */
  inner: { x0: 172.4, x1: 194.6, z0: -40.6, z1: -9.4 },
  /** Booking, just inside the bars, facing into the day room. */
  spawn: { x: 175.5, z: -25, yaw: Math.PI / 2 },
} as const;

/** The inmates' box in centimetres, for presence.confine. */
export const JAIL_RECT: Rect = {
  minX: Math.round(JAIL.inner.x0 * 100),
  maxX: Math.round(JAIL.inner.x1 * 100),
  minZ: Math.round(JAIL.inner.z0 * 100),
  maxZ: Math.round(JAIL.inner.z1 * 100),
};

// --- the wire --------------------------------------------------------------------------------

/** Your own time inside. */
export interface JailState {
  bail: Cents;
  won: Cents;
  at: number;
}

/** What made a member of staff come over. */
export type Offence = 'punch' | 'win';

/** A catch, a lock-up or a release, as everyone hears it. */
export interface LawEvent {
  k: 'warn' | 'jail' | 'free';
  id: number;
  name: string;
  staff: StaffId | null;
  why: Offence | null;
  /** A warning's end (server ms): caught again before this, it's jail. */
  until?: number;
}
