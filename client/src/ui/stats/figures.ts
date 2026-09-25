// The stats sheet's figures, worked out from GET /stats without the DOM (tested in
// client/test/stats-boards.test.ts): the per-game rows and their sort, the fortnight's summary,
// and the day labels under the chart.

import type { GameId } from '../../../../shared/src/engine.ts';
import { CATALOG, isGameId } from '../../../../shared/src/games/catalog.ts';
import type { StatLine, StatsResponse } from '../../../../shared/src/protocol.ts';
import { winRateBp } from '../../../../shared/src/stats.ts';

export type GameSort = 'game' | 'rounds' | 'rate' | 'wagered' | 'net' | 'won' | 'lost' | 'best' | 'worst';

export interface GameRow {
  game: GameId;
  line: StatLine;
  /** Basis points, or null with no counted rounds. */
  rate: number | null;
}

/** Games with anything to show: a round in the lifetime record or in the tallies. */
export function gameRows(s: StatsResponse, sort: GameSort = 'rounds', desc = true): GameRow[] {
  const rows: GameRow[] = [];
  for (const [g, line] of Object.entries(s.games)) {
    if (!isGameId(g) || !line || (line.rounds === 0 && line.counted === 0)) continue;
    rows.push({ game: g, line, rate: line.counted > 0 ? winRateBp(line.wins, line.counted) : null });
  }
  const key = (r: GameRow): number | string => {
    switch (sort) {
      case 'game':
        return CATALOG[r.game].name;
      case 'rounds':
        return r.line.rounds;
      case 'rate':
        return r.rate ?? -1;
      case 'wagered':
        return r.line.wagered;
      case 'net':
        return r.line.net;
      case 'won':
        return r.line.won;
      case 'lost':
        return r.line.lost;
      case 'best':
        return r.line.biggestWin;
      case 'worst':
        return r.line.biggestLoss;
    }
  };
  rows.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    const c = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number);
    // ties in catalog order
    return (desc ? -c : c) || Object.keys(CATALOG).indexOf(a.game) - Object.keys(CATALOG).indexOf(b.game);
  });
  return rows;
}

/** How many of the floor's games the player hasn't played yet. */
export function unplayed(s: StatsResponse): number {
  const played = new Set(gameRows(s).map((r) => r.game));
  return (Object.keys(CATALOG) as GameId[]).filter((g) => !CATALOG[g].dev && !played.has(g)).length;
}

export interface Fortnight {
  total: number;
  best: { day: string; net: number } | null;
  worst: { day: string; net: number } | null;
  /** Days up, down and level. */
  up: number;
  down: number;
  /** The largest net either way, for the chart's scale (never 0). */
  scale: number;
}

export function fortnight(days: StatsResponse['days']): Fortnight {
  let total = 0;
  let best: Fortnight['best'] = null;
  let worst: Fortnight['worst'] = null;
  let up = 0;
  let down = 0;
  let scale = 0;
  for (const d of days) {
    total += d.net;
    if (d.net > 0) up++;
    if (d.net < 0) down++;
    if (d.net > 0 && (!best || d.net > best.net)) best = d;
    if (d.net < 0 && (!worst || d.net < worst.net)) worst = d;
    scale = Math.max(scale, Math.abs(d.net));
  }
  return { total, best, worst, up, down, scale: scale || 1 };
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Fri 25 Sep" for a YYYY-MM-DD casino day. */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
}

/** Under a bar: the weekday's initial and the date ("F", "25"). */
export function dayTick(day: string): [string, string] {
  const d = new Date(`${day}T12:00:00Z`);
  return [WEEKDAY[d.getUTCDay()]!.slice(0, 1), String(d.getUTCDate())];
}
