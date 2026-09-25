// Stats: what the leaderboards and the stats sheet count, and the round tallies behind them.
//
// Two sources, both in D1:
//   casino_stats  one row per player per game (rounds, wagered, net, biggest win), folded in at
//                 each cash-out since the casino opened. Lifetime figures come from here.
//   casino_tally  running totals that the tables add to as rounds settle (server/src/feats.ts
//                 sends them), begun with v6. The keys this file adds beside the feats' own:
//     lost, lost:<game>     cents lost in rounds that lost money (a positive number)
//     worst, worst:<game>   the most lost on one round (kept as a maximum)
//     wins                  rounds that made a profit, every game (wins:<game> is the feats')
//     rounds:<game>         rounds with money on them at that game (rounds is the feats')
//     streak                the longest run of winning rounds at one table (a maximum)
//     n:<YYYY-MM-DD>        net on that casino day (Las Vegas), signed (not d:, whose rows the
//                           feats' flush clears after a few days)
//     w:<YYYY-MM-DD>:net    net in the week starting that Monday, signed
//     feats                 feats earned (added in the batch that pays each one)
//   and reads the feats' `won`, `won:<game>`, `rounds` and celebs' `celeb:<id>` rows.

import type { GameId } from './engine.ts';

/** Rounds (with money on them) a player needs before their win rate is ranked, casino-wide. */
export const WIN_RATE_MIN = 100;
/** The same at one game. */
export const WIN_RATE_MIN_GAME = 50;

/** Days of net the stats sheet charts, today included. */
export const STATS_DAYS = 14;
/** Day and week rows older than this are cleared from casino_tally (the boards never read them). */
export const KEEP_DAYS = 35;

/** Tally keys kept as the largest value seen rather than a sum (feats.ts isMaxTally asks here too). */
export function isStatMaxTally(key: string): boolean {
  return key === 'worst' || key === 'streak' || key.startsWith('worst:');
}

/**
 * What one counted round adds to the tallies, beside the feats' own keys: `profit` is returned
 * minus wagered. Pure; server/src/feats.ts roundFacts calls it for every round with a stake.
 */
export function addRoundStats(tally: Record<string, number>, game: GameId, profit: number): void {
  const add = (k: string, n: number) => (tally[k] = (tally[k] ?? 0) + n);
  add(`rounds:${game}`, 1);
  if (profit > 0) add('wins', 1);
  if (profit < 0) {
    add('lost', -profit);
    add(`lost:${game}`, -profit);
    tally.worst = Math.max(tally.worst ?? 0, -profit);
    tally[`worst:${game}`] = Math.max(tally[`worst:${game}`] ?? 0, -profit);
  }
}

// ---------------------------------------------------------------------------------------------
// Casino days and weeks (Las Vegas time)

const DAY_FORMAT = (() => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    return null;
  }
})();

/** The casino's date at `now`, YYYY-MM-DD (the same as floor/wins.ts casinoDay). */
export function vegasDay(now: number): string {
  if (DAY_FORMAT) {
    const parts = DAY_FORMAT.formatToParts(new Date(now));
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    const y = get('year');
    const m = get('month');
    const d = get('day');
    if (y && m && d) return `${y}-${m}-${d}`;
  }
  return new Date(now).toISOString().slice(0, 10);
}

/** A YYYY-MM-DD date moved by `n` days (calendar arithmetic, no time zone involved). */
export function addDays(day: string, n: number): string {
  const t = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** The Monday that starts the week `day` is in. */
export function weekOf(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 Sunday
  return addDays(day, -((dow + 6) % 7));
}

export const dayKey = (day: string): string => `n:${day}`;
export const weekKey = (monday: string): string => `w:${monday}:net`;

/** The last `n` casino days up to and including `today`, oldest first. */
export function lastDays(today: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDays(today, -i));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Figures

/** A win rate in basis points (5234 = 52.34%), rounded to the nearest; 0 with no rounds. */
export function winRateBp(wins: number, rounds: number): number {
  return rounds > 0 ? Math.round((wins * 10_000) / rounds) : 0;
}

/** "52.3%" from basis points. */
export function formatRate(bp: number): string {
  return `${(bp / 100).toFixed(1)}%`;
}

/** The game with the most rounds (the first in `order` on a tie), or null with none played. */
export function favouriteGame(rounds: Partial<Record<GameId, number>>, order: readonly GameId[]): GameId | null {
  let best: GameId | null = null;
  for (const g of order) if ((rounds[g] ?? 0) > 0 && (best === null || rounds[g]! > rounds[best]!)) best = g;
  return best;
}
