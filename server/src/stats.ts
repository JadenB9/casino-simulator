// Stats: the table's part (win runs, and the day and week a round counts toward) and GET /stats,
// a player's own record for the stats sheet. What each tally key means is in shared/src/stats.ts.
//
// The table's part rides on the feats' tallies: a finished round's facts (server/src/feats.ts
// stepFacts) get three more keys here, inside the same storage transaction that commits the
// round, and go to D1 with the feats' own flush. No extra D1 write per round.

import { CATALOG, isGameId } from '../../shared/src/games/catalog.ts';
import type { GameId } from '../../shared/src/engine.ts';
import type { StatLine, StatsResponse } from '../../shared/src/protocol.ts';
import { STATS_DAYS, dayKey, lastDays, vegasDay, weekKey, weekOf } from '../../shared/src/stats.ts';
import type { StepFacts } from './feats.ts';

/**
 * Each player's current run of winning rounds at this table, in the table's own SQLite. A win
 * adds one, a losing round ends it, a push leaves it as it is. The best run reaches D1 as the
 * `streak` tally (a maximum), so it's the longest run at any one table.
 */
export class RunBook {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS stat_run (account_id INTEGER PRIMARY KEY, run INTEGER NOT NULL)`);
  }

  /**
   * Add the streak, day and week keys to each counted round's tallies, in round order. Call
   * inside the step's storage transaction, before the feats record them.
   */
  apply(facts: StepFacts[], now: number): void {
    const day = vegasDay(now);
    for (const f of facts) {
      const t = f.facts.tally;
      // A round the feats didn't count (nothing staked) counts for nothing here either.
      if (!t.rounds) continue;
      const net = (t.won ?? 0) - (t.lost ?? 0);
      if (net !== 0) {
        t[dayKey(day)] = (t[dayKey(day)] ?? 0) + net;
        t[weekKey(weekOf(day))] = (t[weekKey(weekOf(day))] ?? 0) + net;
      }
      if (net === 0) continue;
      const was = this.sql.exec<{ run: number }>(`SELECT run FROM stat_run WHERE account_id = ?1`, f.accountId).toArray()[0]?.run ?? 0;
      const run = net > 0 ? was + 1 : 0;
      this.sql.exec(`INSERT OR REPLACE INTO stat_run (account_id, run) VALUES (?1, ?2)`, f.accountId, run);
      if (run > 0) t.streak = Math.max(t.streak ?? 0, run);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// GET /stats

const EMPTY: StatLine = { rounds: 0, wagered: 0, net: 0, biggestWin: 0, counted: 0, wins: 0, won: 0, lost: 0, biggestLoss: 0 };

/** The asker's record: five reads in one batch, each by primary key. Null if the account is gone. */
export async function statsOf(db: D1Database, accountId: number, now: number): Promise<StatsResponse | null> {
  const [acct, stats, tally, items, feats] = await db.batch([
    db.prepare(`SELECT name, balance, in_play, created_at FROM casino_accounts WHERE id = ?1`).bind(accountId),
    db.prepare(`SELECT game, rounds, wagered, net, biggest_win FROM casino_stats WHERE account_id = ?1`).bind(accountId),
    db.prepare(`SELECT key, n FROM casino_tally WHERE account_id = ?1`).bind(accountId),
    db.prepare(`SELECT COALESCE(SUM(price), 0) AS v FROM casino_items WHERE account_id = ?1`).bind(accountId),
    db.prepare(`SELECT COUNT(*) AS v FROM casino_feats WHERE account_id = ?1`).bind(accountId),
  ]);
  const a = (acct!.results as { name: string; balance: number; in_play: number; created_at: number }[])[0];
  if (!a) return null;
  const t = new Map((tally!.results as { key: string; n: number }[]).map((r) => [r.key, r.n]));
  const n = (k: string) => t.get(k) ?? 0;

  const games: Partial<Record<GameId, StatLine>> = {};
  const line = (g: GameId): StatLine => (games[g] ??= { ...EMPTY });
  for (const r of stats!.results as { game: string; rounds: number; wagered: number; net: number; biggest_win: number }[]) {
    if (!isGameId(r.game)) continue;
    Object.assign(line(r.game), { rounds: r.rounds, wagered: r.wagered, net: r.net, biggestWin: r.biggest_win });
  }
  for (const g of Object.keys(CATALOG) as GameId[]) {
    const counted = n(`rounds:${g}`);
    if (counted === 0 && !games[g]) continue;
    Object.assign(line(g), { counted, wins: n(`wins:${g}`), won: n(`won:${g}`), lost: n(`lost:${g}`), biggestLoss: n(`worst:${g}`) });
  }

  const total: StatLine = { ...EMPTY, counted: n('rounds'), wins: n('wins'), won: n('won'), lost: n('lost'), biggestLoss: n('worst') };
  for (const s of Object.values(games)) {
    total.rounds += s.rounds;
    total.wagered += s.wagered;
    total.net += s.net;
    total.biggestWin = Math.max(total.biggestWin, s.biggestWin);
  }

  let celebs = 0;
  for (const [k, v] of t) if (k.startsWith('celeb:') && v > 0) celebs++;

  return {
    name: a.name,
    createdAt: a.created_at,
    // net worth as the richest board ranks it (leaderboard.ts WORTH: + banked once the bank's column lands)
    worth: { balance: a.balance, inPlay: a.in_play, total: a.balance + a.in_play },
    total,
    games,
    days: lastDays(vegasDay(now), STATS_DAYS).map((day) => ({ day, net: n(dayKey(day)) })),
    streak: n('streak'),
    feats: (feats!.results as { v: number }[])[0]?.v ?? 0,
    celebs,
    collection: (items!.results as { v: number }[])[0]?.v ?? 0,
  };
}
