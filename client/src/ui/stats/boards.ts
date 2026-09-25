// What each leaderboard is called, how it's grouped, and how its numbers are written. Pure (no
// DOM), so the words and the formatting are tested on their own (client/test/stats-boards.test.ts).

import type { GameId } from '../../../../shared/src/engine.ts';
import { CATALOG } from '../../../../shared/src/games/catalog.ts';
import { formatMoney } from '../../../../shared/src/money.ts';
import { GAME_LEADERBOARDS, LEADERBOARDS, type LeaderboardId } from '../../../../shared/src/protocol.ts';
import { WIN_RATE_MIN, WIN_RATE_MIN_GAME, formatRate } from '../../../../shared/src/stats.ts';

/** How a board's value is written: dollars, dollars with a sign, a count, or a rate. */
export type Unit = 'money' | 'signed' | 'count' | 'rate';

export interface BoardText {
  /** Its name in the list. */
  name: string;
  /** The value column's heading. */
  column: string;
  unit: Unit;
  /** One line under the board: what it counts. */
  note: string;
  empty: string;
  /** What a player not on the board is told. */
  unplaced: string;
}

export interface BoardGroup {
  label: string;
  boards: readonly LeaderboardId[];
}

/** The casino-wide boards, grouped as the sheet lists them. */
export const GROUPS: readonly BoardGroup[] = [
  { label: 'Money', boards: ['richest', 'netUp', 'netDown', 'won', 'lost', 'wagered', 'biggestWin', 'biggestLoss'] },
  { label: 'Play', boards: ['rounds', 'winRate', 'streak', 'feats', 'celebs', 'collection'] },
  { label: 'Today and this week', boards: ['today', 'todayDown', 'week', 'weekDown'] },
];

/** One game's boards, in one group. */
export const GAME_GROUPS: readonly BoardGroup[] = [
  { label: 'Money', boards: ['netUp', 'netDown', 'won', 'lost', 'biggestWin', 'biggestLoss'] },
  { label: 'Play', boards: ['rounds', 'winRate'] },
];

const played = 'Play a round with money on it to get on this board.';

const TEXT: Record<LeaderboardId, BoardText> = {
  richest: {
    name: 'Net worth',
    column: 'Worth',
    unit: 'money',
    note: 'Balance plus chips on tables.',
    empty: 'Nobody has any money yet.',
    unplaced: 'With nothing in your balance or on a table, you are not on this board.',
  },
  netUp: {
    name: 'Biggest winners',
    column: 'Net',
    unit: 'signed',
    note: 'Lifetime net over every game: what came back less what was bet.',
    empty: 'Nobody is up yet.',
    unplaced: 'You are not up overall, so you are not on this board.',
  },
  netDown: {
    name: 'Biggest losers',
    column: 'Net',
    unit: 'signed',
    note: 'Lifetime net over every game, furthest down first.',
    empty: 'Nobody is down yet.',
    unplaced: 'You are not down overall, so you are not on this board.',
  },
  won: {
    name: 'Total won',
    column: 'Won',
    unit: 'money',
    note: 'The profit of every winning round, added up.',
    empty: 'No rounds won yet.',
    unplaced: 'Win a round to get on this board.',
  },
  lost: {
    name: 'Total lost',
    column: 'Lost',
    unit: 'money',
    note: 'What every losing round cost, added up.',
    empty: 'No rounds lost yet.',
    unplaced: 'You have not lost a round yet.',
  },
  wagered: {
    name: 'High rollers',
    column: 'Wagered',
    unit: 'money',
    note: 'Everything bet, every game.',
    empty: 'Nothing bet yet.',
    unplaced: played,
  },
  biggestWin: {
    name: 'Biggest win',
    column: 'Win',
    unit: 'money',
    note: 'Biggest profit on a single round, any game.',
    empty: 'No wins yet.',
    unplaced: 'Win a round to get on this board.',
  },
  biggestLoss: {
    name: 'Biggest loss',
    column: 'Loss',
    unit: 'money',
    note: 'Most lost on a single round, any game.',
    empty: 'No rounds lost yet.',
    unplaced: 'You have not lost a round yet.',
  },
  rounds: {
    name: 'Most rounds',
    column: 'Rounds',
    unit: 'count',
    note: 'Rounds played, every game counted.',
    empty: 'No rounds played yet.',
    unplaced: 'Play a round to get on this board.',
  },
  winRate: {
    name: 'Win rate',
    column: 'Won',
    unit: 'rate',
    note: `Rounds that made a profit, out of ${WIN_RATE_MIN} or more played. A push is not a win.`,
    empty: `Nobody has played ${WIN_RATE_MIN} rounds yet.`,
    unplaced: `Play ${WIN_RATE_MIN} rounds with money on them to get a win rate.`,
  },
  streak: {
    name: 'Longest streak',
    column: 'In a row',
    unit: 'count',
    note: 'Winning rounds in a row at one table. A push keeps a streak going.',
    empty: 'No streaks yet.',
    unplaced: 'Win a round to start a streak.',
  },
  feats: {
    name: 'Achievements',
    column: 'Earned',
    unit: 'count',
    note: 'Achievements and challenges earned.',
    empty: 'Nothing earned yet.',
    unplaced: 'Earn an achievement to get on this board.',
  },
  celebs: {
    name: 'Celebrities met',
    column: 'Met',
    unit: 'count',
    note: 'Different celebrities talked to on the floor.',
    empty: 'Nobody has met a celebrity yet.',
    unplaced: 'Talk to a celebrity when one visits to get on this board.',
  },
  collection: {
    name: 'Collection',
    column: 'Value',
    unit: 'money',
    note: 'What the pieces, rides, cars and statues you keep cost.',
    empty: 'Nobody has bought anything yet.',
    unplaced: 'Buy something to keep in the boutique or at the valet to get on this board.',
  },
  today: {
    name: 'Up today',
    column: 'Net',
    unit: 'signed',
    note: 'Net since midnight, Las Vegas time.',
    empty: 'Nobody is up today yet.',
    unplaced: 'You are not up today, so you are not on this board.',
  },
  todayDown: {
    name: 'Down today',
    column: 'Net',
    unit: 'signed',
    note: 'Net since midnight, Las Vegas time, furthest down first.',
    empty: 'Nobody is down today yet.',
    unplaced: 'You are not down today, so you are not on this board.',
  },
  week: {
    name: 'Up this week',
    column: 'Net',
    unit: 'signed',
    note: 'Net since Monday midnight, Las Vegas time.',
    empty: 'Nobody is up this week yet.',
    unplaced: 'You are not up this week, so you are not on this board.',
  },
  weekDown: {
    name: 'Down this week',
    column: 'Net',
    unit: 'signed',
    note: 'Net since Monday midnight, Las Vegas time, furthest down first.',
    empty: 'Nobody is down this week yet.',
    unplaced: 'You are not down this week, so you are not on this board.',
  },
};

/** A board's words, casino-wide or at one game ("Top earners at Blackjack"). */
export function boardText(id: LeaderboardId, game: GameId | null = null): BoardText {
  const t = TEXT[id];
  if (!game) return t;
  const at = CATALOG[game].name;
  switch (id) {
    case 'netUp':
      return { ...t, name: 'Top earners', note: `Lifetime net at ${at}: what came back less what was bet.`, unplaced: `You are not up at ${at}, so you are not on this board.` };
    case 'netDown':
      return { ...t, note: `Lifetime net at ${at}, furthest down first.`, unplaced: `You are not down at ${at}, so you are not on this board.` };
    case 'won':
      return { ...t, note: `The profit of every winning round at ${at}, added up.`, unplaced: `Win a round at ${at} to get on this board.` };
    case 'lost':
      return { ...t, note: `What every losing round at ${at} cost, added up.`, unplaced: `You have not lost a round at ${at} yet.` };
    case 'biggestWin':
      return { ...t, note: `Biggest profit on a single round at ${at}.`, unplaced: `Win a round at ${at} to get on this board.` };
    case 'biggestLoss':
      return { ...t, note: `Most lost on a single round at ${at}.`, unplaced: `You have not lost a round at ${at} yet.` };
    case 'rounds':
      return { ...t, note: `Rounds played at ${at}.`, unplaced: `Play a round at ${at} to get on this board.` };
    case 'winRate':
      return {
        ...t,
        note: `Rounds at ${at} that made a profit, out of ${WIN_RATE_MIN_GAME} or more played. A push is not a win.`,
        empty: `Nobody has played ${WIN_RATE_MIN_GAME} rounds of ${at} yet.`,
        unplaced: `Play ${WIN_RATE_MIN_GAME} rounds of ${at} with money on them to get a win rate here.`,
      };
    default:
      return t;
  }
}

/** The boards a scope shows, in order: every one casino-wide, or a game's own. */
export function boardsOf(game: GameId | null): readonly LeaderboardId[] {
  return game ? GAME_LEADERBOARDS : LEADERBOARDS;
}

/** A board value as the sheet writes it. */
export function formatValue(unit: Unit, v: number): string {
  switch (unit) {
    case 'money':
      return formatMoney(v);
    case 'signed':
      return formatMoney(v, { sign: true });
    case 'count':
      return v.toLocaleString('en-US');
    case 'rate':
      return formatRate(v);
  }
}

/** "win" / "lose" for a signed value, for its colour; nothing for the others. */
export function valueTone(unit: Unit, v: number): '' | 'win' | 'lose' {
  if (unit !== 'signed') return '';
  return v > 0 ? 'win' : v < 0 ? 'lose' : '';
}

/** "12th" for the place strip; "1st", "2nd", "3rd", "11th", "22nd". */
export function ordinal(n: number): string {
  const tens = n % 100;
  const s = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n.toLocaleString('en-US')}${s}`;
}

/** The games a player can pick boards for, by name: the tables and machines, then the online ones. */
export function pickableGames(): { tables: GameId[]; online: GameId[] } {
  const ids = (Object.keys(CATALOG) as GameId[]).filter((g) => !CATALOG[g].dev);
  const byName = (a: GameId, b: GameId) => CATALOG[a].name.localeCompare(CATALOG[b].name);
  return { tables: ids.filter((g) => !CATALOG[g].online).sort(byName), online: ids.filter((g) => CATALOG[g].online).sort(byName) };
}

/** "Refreshed 12 s ago" for the sheet's subtitle. */
export function refreshedText(ageMs: number): string {
  const s = Math.max(0, Math.floor(ageMs / 1000));
  if (s < 1) return 'Refreshed just now';
  if (s < 60) return `Refreshed ${s} s ago`;
  return `Refreshed ${Math.floor(s / 60)} min ago`;
}
