// Leaderboards: the ten richest players, the ten biggest single wins and the ten who have played
// the most rounds, plus the asker's own place on each board when it's further down.
//
// The top tens are read in one D1 batch and kept in this isolate's memory for a minute, so
// opening the sheet again doesn't touch D1 until they're that old. An asker outside a top ten
// has their own place read once per snapshot. Isolates each keep their own copy; nothing needs
// them to agree.
//
// Reads, and the index each one names (INDEXED BY, so a missing migration fails this route
// loudly instead of quietly scanning; leaderboard.test.ts checks the plans):
//   richest     balance + in_play, where in_play is what went to tables (the live stack
//               settles at cash-out). Top ten: ten index steps. Your place: a count over the
//               index above you.                              idx_casino_accounts_worth
//   biggestWin  the largest single-round profit in any one game. Top ten: a bounded prefix of
//               the index (WIN_ROWS). Your place: a count over the index above you.
//                                                             idx_casino_stats_biggest_win
//   rounds      rounds summed over every game. No index can order a sum, so the snapshot reads
//               casino_stats in primary-key order (account_id, game), which groups each player
//               without sorting, and keeps every player's total; your place is then your own
//               sum (a primary-key lookup) counted against those totals in memory.
//
// Only names leave here. Account ids stay inside, to tell which row is the asker's.

import { LEADERBOARDS, LEADERBOARD_TOP, type Leaderboard, type LeaderboardId, type LeaderboardResponse } from '../../shared/src/protocol.ts';
import { CATALOG } from '../../shared/src/games/catalog.ts';

/** How long one read of the top tens serves before it's read again. */
export const CACHE_MS = 60_000;

/** Askers whose own places one snapshot remembers; past this they're read on every open. */
const MAX_PLACES = 2_000;

/**
 * casino_stats has one row per player per game, so a player fills at most GAMES rows of the
 * biggest_win index. Before the tenth-best player's best row there can only be rows of the nine
 * ahead of them, at most 9 x GAMES, so the first 10 x GAMES rows name every one of the top ten
 * at their best. (Rows are taken in index order, biggest_win then account_id, which is the
 * board's own tie-break, so the prefix agrees with a full read even on ties.)
 */
const GAMES = Object.keys(CATALOG).length;
export const WIN_ROWS = LEADERBOARD_TOP * GAMES;

export const SQL = {
  richestTop: `
    SELECT id, name, balance + in_play AS v
      FROM casino_accounts INDEXED BY idx_casino_accounts_worth
     WHERE balance + in_play > 0
     ORDER BY balance + in_play DESC, id
     LIMIT ?1`,
  biggestWinTop: `
    SELECT best.id AS id, a.name AS name, best.v AS v
      FROM (SELECT account_id AS id, MAX(biggest_win) AS v
              FROM (SELECT account_id, biggest_win
                      FROM casino_stats INDEXED BY idx_casino_stats_biggest_win
                     WHERE biggest_win > 0
                     ORDER BY biggest_win DESC, account_id
                     LIMIT ?2)
             GROUP BY account_id
             ORDER BY v DESC, id
             LIMIT ?1) AS best
      JOIN casino_accounts AS a ON a.id = best.id
     ORDER BY best.v DESC, best.id`,
  roundsTop: `
    SELECT most.id AS id, a.name AS name, most.v AS v
      FROM (SELECT account_id AS id, SUM(rounds) AS v FROM casino_stats
             GROUP BY account_id
            HAVING SUM(rounds) > 0
             ORDER BY v DESC, id
             LIMIT ?1) AS most
      JOIN casino_accounts AS a ON a.id = most.id
     ORDER BY most.v DESC, most.id`,
  /** Every player's rounds total, for counting who is ahead of an asker. */
  roundsTotals: `
    SELECT SUM(rounds) AS v FROM casino_stats
     GROUP BY account_id
    HAVING SUM(rounds) > 0`,
  // One player's value, and (richest, biggestWin) how many players are strictly ahead of it.
  richestPlace: `
    SELECT me.balance + me.in_play AS v,
           (SELECT COUNT(*) FROM casino_accounts AS o INDEXED BY idx_casino_accounts_worth
             WHERE o.balance + o.in_play > me.balance + me.in_play) AS ahead
      FROM casino_accounts AS me
     WHERE me.id = ?1`,
  biggestWinPlace: `
    SELECT me.v AS v,
           (SELECT COUNT(DISTINCT account_id) FROM casino_stats INDEXED BY idx_casino_stats_biggest_win
             WHERE biggest_win > me.v) AS ahead
      FROM (SELECT COALESCE(MAX(biggest_win), 0) AS v FROM casino_stats WHERE account_id = ?1) AS me`,
  roundsPlace: `
    SELECT COALESCE(SUM(rounds), 0) AS v, NULL AS ahead FROM casino_stats WHERE account_id = ?1`,
} as const;

const PLACE_SQL: Record<LeaderboardId, string> = { richest: SQL.richestPlace, biggestWin: SQL.biggestWinPlace, rounds: SQL.roundsPlace };

interface Ranked {
  id: number;
  name: string;
  value: number;
  rank: number;
}

interface Place {
  rank: number | null;
  value: number;
}

interface Snapshot {
  at: number;
  top: Record<LeaderboardId, Ranked[]>;
  /** Every player's rounds total, ascending. */
  rounds: number[];
  places: Map<number, Partial<Record<LeaderboardId, Place>>>;
}

let snapshot: Snapshot | null = null;

/** Forget the cached boards (tests start from a clean slate with this). */
export function clearLeaderboardCache(): void {
  snapshot = null;
}

/** Places 1, 2, 2, 4: a player tied with the one above shares their place. */
function ranked(rows: { id: number; name: string; v: number }[]): Ranked[] {
  const out: Ranked[] = [];
  for (const [i, r] of rows.entries()) {
    const above = out[i - 1];
    out.push({ id: r.id, name: r.name, value: r.v, rank: above && above.value === r.v ? above.rank : i + 1 });
  }
  return out;
}

/** How many of the ascending `sorted` are greater than `v`. */
function countAbove(sorted: number[], v: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! > v) hi = mid;
    else lo = mid + 1;
  }
  return sorted.length - lo;
}

async function readTop(db: D1Database, now: number): Promise<Snapshot> {
  const [richest, biggestWin, rounds, totals] = await db.batch([
    db.prepare(SQL.richestTop).bind(LEADERBOARD_TOP),
    db.prepare(SQL.biggestWinTop).bind(LEADERBOARD_TOP, WIN_ROWS),
    db.prepare(SQL.roundsTop).bind(LEADERBOARD_TOP),
    db.prepare(SQL.roundsTotals),
  ]);
  type Row = { id: number; name: string; v: number };
  return {
    at: now,
    top: {
      richest: ranked(richest!.results as Row[]),
      biggestWin: ranked(biggestWin!.results as Row[]),
      rounds: ranked(rounds!.results as Row[]),
    },
    rounds: (totals!.results as { v: number }[]).map((r) => r.v).sort((a, b) => a - b),
    places: new Map(),
  };
}

async function readPlaces(db: D1Database, snap: Snapshot, accountId: number, boards: LeaderboardId[]): Promise<Partial<Record<LeaderboardId, Place>>> {
  const results = await db.batch<{ v: number; ahead: number | null }>(boards.map((b) => db.prepare(PLACE_SQL[b]).bind(accountId)));
  const out: Partial<Record<LeaderboardId, Place>> = {};
  boards.forEach((b, i) => {
    const row = results[i]!.results[0];
    const value = row?.v ?? 0;
    // Nothing to rank (no money, no win, no rounds, or the account is gone): no place.
    if (value <= 0) out[b] = { rank: null, value: 0 };
    else out[b] = { rank: 1 + (b === 'rounds' ? countAbove(snap.rounds, value) : row!.ahead!), value };
  });
  return out;
}

/** The three boards as `asker` sees them at `now` (Date.now() in the Worker). */
export async function leaderboard(db: D1Database, asker: { id: number; name: string }, now: number): Promise<LeaderboardResponse> {
  if (!snapshot || now - snapshot.at >= CACHE_MS || now < snapshot.at) snapshot = await readTop(db, now);
  const snap = snapshot;

  const inTop = (b: LeaderboardId) => snap.top[b].some((r) => r.id === asker.id);
  let places = snap.places.get(asker.id) ?? {};
  const missing = LEADERBOARDS.filter((b) => !inTop(b) && !places[b]);
  if (missing.length > 0) {
    places = { ...places, ...(await readPlaces(db, snap, asker.id, missing)) };
    if (snap.places.size < MAX_PLACES || snap.places.has(asker.id)) snap.places.set(asker.id, places);
  }

  const boards = {} as Record<LeaderboardId, Leaderboard>;
  for (const b of LEADERBOARDS) {
    const place = places[b];
    boards[b] = {
      top: snap.top[b].map((r) => (r.id === asker.id ? { rank: r.rank, name: r.name, value: r.value, you: true as const } : { rank: r.rank, name: r.name, value: r.value })),
      you: inTop(b) || !place ? null : { rank: place.rank, name: asker.name, value: place.value },
    };
  }
  return { boards, age: now - snap.at };
}
