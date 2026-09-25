// Leaderboards: the casino-wide boards (LEADERBOARDS) and each game's own (GAME_LEADERBOARDS), the
// top ten of each, plus the asker's own place on each board when it's further down.
//
// A set of boards is read in two D1 batches (the boards' account ids and values, then the names
// of everyone listed) and kept in this isolate's memory for a minute, so opening the sheet again
// doesn't touch D1 until they're that old; each game's boards are a set of their own. An asker
// outside a top ten has their own places read once per snapshot. Isolates each keep their own
// copy; nothing needs them to agree.
//
// Two kinds of board:
//   indexed  the top ten are the first entries of an index, and your place is a count over the
//            entries above you, through the index the query names (INDEXED BY, so a missing
//            migration fails this route loudly instead of quietly scanning; leaderboard.test.ts
//            checks the plans).
//              richest              net worth (WORTH)          WORTH_INDEX
//              biggestWin           a prefix of WIN_ROWS rows  idx_casino_stats_biggest_win
//              won, lost, biggestLoss, streak, feats, today(Down), week(Down), and a game's
//              won, lost, biggestLoss: one casino_tally key   idx_casino_tally_key_n
//              a game's netUp/netDown, biggestWin, rounds      idx_casino_stats_game_{net,win,rounds}
//   scanned  a sum or a ratio no index can order: the snapshot reads every row it needs once and
//            keeps each player's figure, and places are counted in memory.
//              rounds, wagered, netUp, netDown   casino_stats summed per player, in primary-key
//                                                order (grouped without sorting), one pass for all four
//              winRate     players with enough counted rounds (a range of the tally index), with
//                          their wins beside them (primary key)
//              celebs      the celebrity rows (a range of the tally index), counted per player
//              collection  casino_items summed per player, in primary-key order
//
// Only names leave here. Account ids stay inside, to tell which row is the asker's.

import {
  GAME_LEADERBOARDS,
  LEADERBOARDS,
  LEADERBOARD_TOP,
  type Leaderboard,
  type LeaderboardId,
  type LeaderboardResponse,
} from '../../shared/src/protocol.ts';
import type { GameId } from '../../shared/src/engine.ts';
import { CATALOG } from '../../shared/src/games/catalog.ts';
import { KEEP_DAYS, WIN_RATE_MIN, WIN_RATE_MIN_GAME, addDays, dayKey, vegasDay, weekKey, weekOf, winRateBp } from '../../shared/src/stats.ts';

/** How long one read of the boards serves before they're read again. */
export const CACHE_MS = 60_000;

/** Askers whose own places one snapshot remembers; past this they're read on every open. */
const MAX_PLACES = 2_000;

/** Old day and week rows are cleared at most this often (per isolate). */
const PRUNE_MS = 3_600_000;

/**
 * casino_stats has one row per player per game, so a player fills at most GAMES rows of the
 * biggest_win index. Before the tenth-best player's best row there can only be rows of the nine
 * ahead of them, at most 9 x GAMES, so the first 10 x GAMES rows name every one of the top ten
 * at their best. (Rows are taken in index order, biggest_win then account_id, which is the
 * board's own tie-break, so the prefix agrees with a full read even on ties.)
 */
const GAMES = Object.keys(CATALOG).length;
export const WIN_ROWS = LEADERBOARD_TOP * GAMES;

const TALLY = 'casino_tally INDEXED BY idx_casino_tally_key_n';

/**
 * Net worth, spelled exactly as its expression index is (SQLite only uses the index for the same
 * expression): the balance, chips on tables and the bank (bank6's migration 0007: banked is
 * savings, open deposits and the Casino Index at cost).
 */
const WORTH = 'balance + in_play + banked';
const WORTH_INDEX = 'idx_casino_accounts_networth';
/** The same, on a named row ("me.balance + me.in_play"). */
const worthOf = (row: string) => WORTH.split(' + ').map((col) => `${row}.${col}`).join(' + ');

/** One board read through an index: the top rows, and one player's value and how many are ahead. */
const gameStats = (col: 'net' | 'biggest_win' | 'rounds', index: string, down = false) => ({
  top: `
    SELECT account_id AS id, ${col} AS v FROM casino_stats INDEXED BY ${index}
     WHERE game = ?1 AND ${col} ${down ? '< 0' : '> 0'}
     ORDER BY ${col} ${down ? 'ASC, account_id DESC' : 'DESC, account_id'}
     LIMIT ?2`,
  place: `
    SELECT me.v AS v,
           (SELECT COUNT(*) FROM casino_stats INDEXED BY ${index} WHERE game = ?2 AND ${col} ${down ? '<' : '>'} me.v) AS ahead
      FROM (SELECT COALESCE((SELECT ${col} FROM casino_stats WHERE account_id = ?1 AND game = ?2), 0) AS v) AS me`,
});

export const SQL = {
  richestTop: `
    SELECT id, ${WORTH} AS v
      FROM casino_accounts INDEXED BY ${WORTH_INDEX}
     WHERE ${WORTH} > 0
     ORDER BY ${WORTH} DESC, id
     LIMIT ?1`,
  richestPlace: `
    SELECT ${worthOf('me')} AS v,
           (SELECT COUNT(*) FROM casino_accounts AS o INDEXED BY ${WORTH_INDEX}
             WHERE ${worthOf('o')} > ${worthOf('me')}) AS ahead
      FROM casino_accounts AS me
     WHERE me.id = ?1`,
  biggestWinTop: `
    SELECT account_id AS id, MAX(biggest_win) AS v
      FROM (SELECT account_id, biggest_win
              FROM casino_stats INDEXED BY idx_casino_stats_biggest_win
             WHERE biggest_win > 0
             ORDER BY biggest_win DESC, account_id
             LIMIT ?1)
     GROUP BY account_id
     ORDER BY v DESC, id
     LIMIT ?2`,
  biggestWinPlace: `
    SELECT me.v AS v,
           (SELECT COUNT(DISTINCT account_id) FROM casino_stats INDEXED BY idx_casino_stats_biggest_win
             WHERE biggest_win > me.v) AS ahead
      FROM (SELECT COALESCE(MAX(biggest_win), 0) AS v FROM casino_stats WHERE account_id = ?1) AS me`,
  /** One tally key's largest values (?1 key, ?2 how many). */
  tallyTop: `
    SELECT account_id AS id, n AS v FROM ${TALLY}
     WHERE key = ?1 AND n > 0
     ORDER BY n DESC, account_id
     LIMIT ?2`,
  /** One tally key's most negative values; a tie lists the newer account first (the index read backwards). */
  tallyBottom: `
    SELECT account_id AS id, n AS v FROM ${TALLY}
     WHERE key = ?1 AND n < 0
     ORDER BY n ASC, account_id DESC
     LIMIT ?2`,
  tallyPlace: `
    SELECT me.v AS v, (SELECT COUNT(*) FROM ${TALLY} WHERE key = ?2 AND n > me.v) AS ahead
      FROM (SELECT COALESCE((SELECT n FROM casino_tally WHERE account_id = ?1 AND key = ?2), 0) AS v) AS me`,
  tallyPlaceDown: `
    SELECT me.v AS v, (SELECT COUNT(*) FROM ${TALLY} WHERE key = ?2 AND n < me.v) AS ahead
      FROM (SELECT COALESCE((SELECT n FROM casino_tally WHERE account_id = ?1 AND key = ?2), 0) AS v) AS me`,
  /** Every player's rounds, wagered and net over all their games. */
  statsTotals: `
    SELECT account_id AS id, SUM(rounds) AS r, SUM(wagered) AS w, SUM(net) AS n FROM casino_stats
     GROUP BY account_id`,
  /** Players with at least ?3 on rounds key ?1, and their wins key ?2. */
  rateRows: `
    SELECT r.account_id AS id, r.n AS rounds, COALESCE(w.n, 0) AS wins
      FROM casino_tally AS r INDEXED BY idx_casino_tally_key_n
      LEFT JOIN casino_tally AS w ON w.account_id = r.account_id AND w.key = ?2
     WHERE r.key = ?1 AND r.n >= ?3`,
  /** How many celebrities each player has met (celeb:<id> rows). */
  celebs: `
    SELECT account_id AS id, COUNT(*) AS v FROM ${TALLY}
     WHERE key > 'celeb:' AND key < 'celeb;' AND n > 0
     GROUP BY account_id`,
  /** What each player's kept things cost. */
  collection: `
    SELECT account_id AS id, SUM(price) AS v FROM casino_items
     GROUP BY account_id`,
  names: `SELECT id, name FROM casino_accounts WHERE id IN (SELECT value FROM json_each(?1))`,
  /** Day and week net rows before ?1 / ?2 (they sort by date, and nothing else starts n: or w:). */
  prune: `DELETE FROM casino_tally WHERE (key >= 'n:' AND key < ?1) OR (key >= 'w:' AND key < ?2)`,
  gameNetTop: gameStats('net', 'idx_casino_stats_game_net').top,
  gameNetPlace: gameStats('net', 'idx_casino_stats_game_net').place,
  gameNetBottom: gameStats('net', 'idx_casino_stats_game_net', true).top,
  gameNetPlaceDown: gameStats('net', 'idx_casino_stats_game_net', true).place,
  gameWinTop: gameStats('biggest_win', 'idx_casino_stats_game_win').top,
  gameWinPlace: gameStats('biggest_win', 'idx_casino_stats_game_win').place,
  gameRoundsTop: gameStats('rounds', 'idx_casino_stats_game_rounds').top,
  gameRoundsPlace: gameStats('rounds', 'idx_casino_stats_game_rounds').place,
} as const;

// ---------------------------------------------------------------------------------------------
// Boards as data

type Row = { id: number; v: number; of?: number };

/** Bigger is better (1), or more negative is (-1: the losers' boards). */
type Dir = 1 | -1;

interface Indexed {
  kind: 'indexed';
  dir: Dir;
  /** The top rows: SQL and its parameters (the row count is always last). */
  top: [sql: string, ...args: unknown[]];
  /** The asker's value and how many are ahead: SQL, bound as (accountId, ...args). */
  place: [sql: string, ...args: unknown[]];
}

interface Scanned {
  kind: 'scanned';
  dir: Dir;
  /** Which scan, and how to pick this board's figure from its rows. */
  scan: 'stats' | 'rate' | 'celebs' | 'collection';
  pick(r: ScanRow): Row | null;
}

type BoardSpec = Indexed | Scanned;

type ScanRow = Record<string, number>;

const tallyBoard = (key: string, dir: Dir = 1): Indexed => ({
  kind: 'indexed',
  dir,
  top: [dir > 0 ? SQL.tallyTop : SQL.tallyBottom, key],
  place: [dir > 0 ? SQL.tallyPlace : SQL.tallyPlaceDown, key],
});

const rateBoard = (min: number): Scanned => ({
  kind: 'scanned',
  dir: 1,
  scan: 'rate',
  pick: (r) => (r.rounds! >= min ? { id: r.id!, v: winRateBp(r.wins!, r.rounds!), of: r.rounds! } : null),
});

/** The casino-wide boards at `now` (the day and week boards read today's and this week's rows). */
function globalSpecs(now: number): Record<LeaderboardId, BoardSpec> {
  const day = vegasDay(now);
  return {
    richest: { kind: 'indexed', dir: 1, top: [SQL.richestTop], place: [SQL.richestPlace] },
    netUp: { kind: 'scanned', dir: 1, scan: 'stats', pick: (r) => ({ id: r.id!, v: r.n! }) },
    netDown: { kind: 'scanned', dir: -1, scan: 'stats', pick: (r) => ({ id: r.id!, v: r.n! }) },
    won: tallyBoard('won'),
    lost: tallyBoard('lost'),
    wagered: { kind: 'scanned', dir: 1, scan: 'stats', pick: (r) => ({ id: r.id!, v: r.w! }) },
    biggestWin: { kind: 'indexed', dir: 1, top: [SQL.biggestWinTop, WIN_ROWS], place: [SQL.biggestWinPlace] },
    biggestLoss: tallyBoard('worst'),
    rounds: { kind: 'scanned', dir: 1, scan: 'stats', pick: (r) => ({ id: r.id!, v: r.r! }) },
    winRate: rateBoard(WIN_RATE_MIN),
    streak: tallyBoard('streak'),
    feats: tallyBoard('feats'),
    celebs: { kind: 'scanned', dir: 1, scan: 'celebs', pick: (r) => ({ id: r.id!, v: r.v! }) },
    collection: { kind: 'scanned', dir: 1, scan: 'collection', pick: (r) => ({ id: r.id!, v: r.v! }) },
    today: tallyBoard(dayKey(day)),
    todayDown: tallyBoard(dayKey(day), -1),
    week: tallyBoard(weekKey(weekOf(day))),
    weekDown: tallyBoard(weekKey(weekOf(day)), -1),
  };
}

function gameSpecs(game: GameId): Record<(typeof GAME_LEADERBOARDS)[number], BoardSpec> {
  const g = (top: string, place: string, dir: Dir = 1): Indexed => ({ kind: 'indexed', dir, top: [top, game], place: [place, game] });
  return {
    netUp: g(SQL.gameNetTop, SQL.gameNetPlace),
    netDown: g(SQL.gameNetBottom, SQL.gameNetPlaceDown, -1),
    won: tallyBoard(`won:${game}`),
    lost: tallyBoard(`lost:${game}`),
    biggestWin: g(SQL.gameWinTop, SQL.gameWinPlace),
    biggestLoss: tallyBoard(`worst:${game}`),
    rounds: g(SQL.gameRoundsTop, SQL.gameRoundsPlace),
    winRate: rateBoard(WIN_RATE_MIN_GAME),
  };
}

/** The scans a set of boards needs, and their SQL. */
function scanSql(scan: Scanned['scan'], game: GameId | null): [string, ...unknown[]] {
  switch (scan) {
    case 'stats':
      return [SQL.statsTotals];
    case 'rate':
      return game ? [SQL.rateRows, `rounds:${game}`, `wins:${game}`, WIN_RATE_MIN_GAME] : [SQL.rateRows, 'rounds', 'wins', WIN_RATE_MIN];
    case 'celebs':
      return [SQL.celebs];
    case 'collection':
      return [SQL.collection];
  }
}

// ---------------------------------------------------------------------------------------------
// Snapshots

interface Ranked {
  id: number;
  name: string;
  value: number;
  of?: number;
  rank: number;
}

interface Place {
  rank: number | null;
  value: number;
  of?: number;
}

/** A scanned board: every eligible player, best first, and each one's row by id. */
interface Listed {
  list: Row[];
  byId: Map<number, Row>;
}

interface Snapshot {
  at: number;
  specs: Partial<Record<LeaderboardId, BoardSpec>>;
  top: Partial<Record<LeaderboardId, Ranked[]>>;
  listed: Partial<Record<LeaderboardId, Listed>>;
  places: Map<number, Partial<Record<LeaderboardId, Place>>>;
}

let world: Snapshot | null = null;
const perGame = new Map<GameId, Snapshot>();
let prunedAt = 0;

/** Forget the cached boards (tests start from a clean slate with this). */
export function clearLeaderboardCache(): void {
  world = null;
  perGame.clear();
  prunedAt = 0;
}

/** Places 1, 2, 2, 4: a player tied with the one above shares their place. */
function ranked(rows: (Row & { name: string })[]): Ranked[] {
  const out: Ranked[] = [];
  for (const [i, r] of rows.entries()) {
    const above = out[i - 1];
    out.push({ id: r.id, name: r.name, value: r.v, ...(r.of !== undefined ? { of: r.of } : {}), rank: above && above.value === r.v ? above.rank : i + 1 });
  }
  return out;
}

/** On the board at all: a value on the board's side of zero (a win rate counts from 0%). */
function eligible(spec: BoardSpec, r: Row): boolean {
  if (spec.kind === 'scanned' && spec.scan === 'rate') return true;
  return spec.dir > 0 ? r.v > 0 : r.v < 0;
}

/** Best first: by value in the board's direction, then more rounds (win rate), then the older account. */
function order(dir: Dir) {
  return (a: Row, b: Row) => dir * (b.v - a.v) || (b.of ?? 0) - (a.of ?? 0) || a.id - b.id;
}

/** How many of the best-first `list` are strictly better than `v`. */
function ahead(list: Row[], v: number, dir: Dir): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dir * (list[mid]!.v - v) > 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

async function readBoards(db: D1Database, specs: Partial<Record<LeaderboardId, BoardSpec>>, game: GameId | null, now: number): Promise<Snapshot> {
  const ids = Object.keys(specs) as LeaderboardId[];
  const stmts: D1PreparedStatement[] = [];
  const at = new Map<string, number>();
  for (const b of ids) {
    const s = specs[b]!;
    if (s.kind === 'indexed') {
      at.set(b, stmts.length);
      const [sql, ...args] = s.top;
      stmts.push(db.prepare(sql).bind(...args, LEADERBOARD_TOP));
    } else if (!at.has(`scan:${s.scan}`)) {
      at.set(`scan:${s.scan}`, stmts.length);
      const [sql, ...args] = scanSql(s.scan, game);
      stmts.push(db.prepare(sql).bind(...args));
    }
  }
  // Now and then, the day and week rows nobody reads any more go (they'd only grow).
  const prune = !game && now - prunedAt >= PRUNE_MS;
  if (prune) {
    const cut = addDays(vegasDay(now), -KEEP_DAYS);
    stmts.push(db.prepare(SQL.prune).bind(dayKey(cut), weekKey(weekOf(cut)).slice(0, 12)));
    prunedAt = now;
  }
  const results = await db.batch<ScanRow>(stmts);

  const tops: Partial<Record<LeaderboardId, Row[]>> = {};
  const listed: Partial<Record<LeaderboardId, Listed>> = {};
  for (const b of ids) {
    const s = specs[b]!;
    if (s.kind === 'indexed') {
      tops[b] = (results[at.get(b)!]!.results as Row[]).map((r) => ({ id: r.id, v: r.v }));
      continue;
    }
    const list: Row[] = [];
    for (const r of results[at.get(`scan:${s.scan}`)!]!.results) {
      const row = s.pick(r);
      if (row && eligible(s, row)) list.push(row);
    }
    list.sort(order(s.dir));
    listed[b] = { list, byId: new Map(list.map((r) => [r.id, r])) };
    tops[b] = list.slice(0, LEADERBOARD_TOP);
  }

  // Names for everyone listed, in one read.
  const want = new Set<number>();
  for (const rows of Object.values(tops)) for (const r of rows) want.add(r.id);
  const names = new Map<number, string>();
  if (want.size > 0) {
    const r = await db.prepare(SQL.names).bind(JSON.stringify([...want])).all<{ id: number; name: string }>();
    for (const row of r.results) names.set(row.id, row.name);
  }
  const top: Partial<Record<LeaderboardId, Ranked[]>> = {};
  for (const b of ids) top[b] = ranked(tops[b]!.filter((r) => names.has(r.id)).map((r) => ({ ...r, name: names.get(r.id)! })));
  return { at: now, specs, top, listed, places: new Map() };
}

async function readPlaces(db: D1Database, snap: Snapshot, accountId: number, boards: LeaderboardId[]): Promise<Partial<Record<LeaderboardId, Place>>> {
  const out: Partial<Record<LeaderboardId, Place>> = {};
  const indexed: LeaderboardId[] = [];
  for (const b of boards) {
    const s = snap.specs[b]!;
    if (s.kind === 'indexed') {
      indexed.push(b);
      continue;
    }
    const l = snap.listed[b]!;
    const me = l.byId.get(accountId);
    out[b] = me ? { rank: 1 + ahead(l.list, me.v, s.dir), value: me.v, ...(me.of !== undefined ? { of: me.of } : {}) } : { rank: null, value: 0 };
  }
  if (indexed.length > 0) {
    const results = await db.batch<{ v: number; ahead: number }>(
      indexed.map((b) => {
        const [sql, ...args] = (snap.specs[b] as Indexed).place;
        return db.prepare(sql).bind(accountId, ...args);
      }),
    );
    indexed.forEach((b, i) => {
      const row = results[i]!.results[0];
      const value = row?.v ?? 0;
      // Nothing to rank (no money, no win, nothing lost, or the account is gone): no place.
      out[b] = eligible(snap.specs[b]!, { id: accountId, v: value }) ? { rank: 1 + row!.ahead, value } : { rank: null, value: 0 };
    });
  }
  return out;
}

/**
 * The boards as `asker` sees them at `now` (Date.now() in the Worker): the casino-wide ones, or
 * with `game`, that game's.
 */
export async function leaderboard(db: D1Database, asker: { id: number; name: string }, now: number, game: GameId | null = null): Promise<LeaderboardResponse> {
  const fresh = (s: Snapshot | null | undefined): s is Snapshot => !!s && now - s.at < CACHE_MS && now >= s.at;
  let snap = game ? perGame.get(game) : world;
  if (!fresh(snap)) {
    snap = await readBoards(db, game ? gameSpecs(game) : globalSpecs(now), game, now);
    if (game) perGame.set(game, snap);
    else world = snap;
  }
  const s = snap;
  const ids = (game ? GAME_LEADERBOARDS : LEADERBOARDS) as readonly LeaderboardId[];

  const inTop = (b: LeaderboardId) => s.top[b]!.some((r) => r.id === asker.id);
  let places = s.places.get(asker.id) ?? {};
  const missing = ids.filter((b) => !inTop(b) && !places[b]);
  if (missing.length > 0) {
    places = { ...places, ...(await readPlaces(db, s, asker.id, missing)) };
    if (s.places.size < MAX_PLACES || s.places.has(asker.id)) s.places.set(asker.id, places);
  }

  const boards: Partial<Record<LeaderboardId, Leaderboard>> = {};
  for (const b of ids) {
    const place = places[b];
    boards[b] = {
      top: s.top[b]!.map((r) => ({
        rank: r.rank,
        name: r.name,
        value: r.value,
        ...(r.of !== undefined ? { of: r.of } : {}),
        ...(r.id === asker.id ? { you: true as const } : {}),
      })),
      you: inTop(b) || !place ? null : { rank: place.rank, name: asker.name, value: place.value, ...(place.of !== undefined ? { of: place.of } : {}) },
    };
  }
  return { boards, ...(game ? { game } : {}), age: now - s.at };
}
