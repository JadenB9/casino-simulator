// Canned boards and a stats sheet for the dev pages (?fixture=1), seen by the menu fixtures'
// player, Ace_High: in the top ten on some boards, further down on others, and on a few not at
// all (no win rate yet at a game, never down today). Deterministic, so screenshots compare.

import type { GameId } from '../../../../shared/src/engine.ts';
import { CATALOG } from '../../../../shared/src/games/catalog.ts';
import type { Leaderboard, LeaderboardId, LeaderboardResponse, LeaderboardRow, StatLine, StatsResponse } from '../../../../shared/src/protocol.ts';
import { lastDays, vegasDay } from '../../../../shared/src/stats.ts';
import { boardsOf } from '../stats/boards.ts';
import type { LeaderboardApi } from './leaderboard.ts';

const $ = (dollars: number) => Math.round(dollars * 100);

const NAMES = [
  'MarisolV', 'tkono', 'DoubleDown_Dee', 'Hollis', 'big_nick', 'vegas_jen', 'Rourke', 'snake_eyes',
  'paigeturner', 'OldFaithful', 'lucky_lou', 'Castellan', 'june_bug', 'Ferro', 'midnight_mo', 'Quill',
];
const ME = 'Ace_High';

/** A small deterministic shuffle, so each board has its own order of the same regulars. */
function order(seed: number): string[] {
  const out = [...NAMES];
  let s = seed * 2654435761;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Ten rows falling from `first` by roughly `step` each, one tie, and where Ace_High stands. */
function board(seed: number, first: number, step: number, me: { rank: number | null; value: number; of?: number }, of?: (i: number) => number): Leaderboard {
  const names = order(seed);
  const top: LeaderboardRow[] = [];
  let v = first;
  for (let i = 0; i < 10; i++) {
    if (i > 0 && i !== 5) v = Math.round(v - step * (0.6 + ((seed * 7 + i * 13) % 9) / 10));
    // money in whole dollars
    if (first >= 100_000) v = Math.round(v / 100) * 100;
    const rank = i === 5 ? top[4]!.rank : i + 1;
    top.push({ rank, name: names[i]!, value: v, ...(of ? { of: of(i) } : {}) });
  }
  if (me.rank !== null && me.rank <= 10) {
    top[me.rank - 1] = { rank: me.rank, name: ME, value: top[me.rank - 1]!.value, ...(of ? { of: top[me.rank - 1]!.of } : {}), you: true };
    return { top, you: null };
  }
  return { top, you: { name: ME, ...me } };
}

const down = (b: Leaderboard): Leaderboard => ({
  top: b.top.map((r) => ({ ...r, value: -r.value })),
  you: b.you && b.you.rank !== null ? { ...b.you, value: -b.you.value } : b.you,
});

const ALL: Record<LeaderboardId, Leaderboard> = {
  richest: board(1, $(1_284_350), $(110_000), { rank: 23, value: $(118_420) }),
  netUp: board(2, $(944_120), $(90_000), { rank: 31, value: $(18_420) }),
  netDown: down(board(3, $(412_600), $(40_000), { rank: null, value: 0 })),
  won: board(4, $(2_840_000), $(240_000), { rank: 17, value: $(391_880) }),
  lost: board(5, $(2_402_300), $(220_000), { rank: 14, value: $(373_460) }),
  wagered: board(6, $(18_450_000), $(1_600_000), { rank: 9, value: 0 }),
  biggestWin: board(7, $(92_500), $(8_000), { rank: 44, value: $(9_750) }),
  biggestLoss: board(8, $(150_000), $(13_000), { rank: 29, value: $(12_500) }),
  rounds: board(9, 14_902, 1_300, { rank: 5, value: 0 }),
  winRate: board(10, 5_812, 90, { rank: 12, value: 4_730, of: 4_775 }, (i) => 180 + ((i * 397) % 2_400)),
  streak: board(11, 17, 1, { rank: 3, value: 0 }),
  feats: board(12, 41, 3, { rank: 26, value: 12 }),
  celebs: board(13, 9, 1, { rank: 8, value: 0 }),
  collection: board(14, $(62_450_000), $(5_000_000), { rank: null, value: 0 }),
  today: board(15, $(88_400), $(8_000), { rank: 6, value: 0 }),
  todayDown: down(board(16, $(61_200), $(6_000), { rank: null, value: 0 })),
  week: board(17, $(310_550), $(28_000), { rank: 19, value: $(22_150) }),
  weekDown: down(board(18, $(204_900), $(19_000), { rank: null, value: 0 })),
};

export function boards(age = 14_000, game: GameId | null = null): LeaderboardResponse {
  if (!game) return { age, boards: ALL };
  const seed = Object.keys(CATALOG).indexOf(game) * 31;
  const k = game === 'blackjack' ? 1 : 0.25;
  const out: LeaderboardResponse['boards'] = {};
  for (const id of boardsOf(game)) {
    const one = id === 'winRate' ? { rank: null, value: 0 } : { rank: id === 'rounds' ? 4 : 18, value: Math.round(Math.abs(ALL[id].top[9]!.value) * k * 0.006) * 100 };
    const b = board(seed + id.length, Math.round(Math.abs(ALL[id].top[0]!.value) * k), Math.round(Math.abs(ALL[id].top[0]!.value - ALL[id].top[9]!.value) * k / 9) || 1, one, id === 'winRate' ? (i) => 60 + i * 37 : undefined);
    out[id] = id === 'netDown' ? down(b) : b;
  }
  return { age, game, boards: out };
}

/** The API stand-in: answers after `latency` ms, or fails with `fail` set. */
export function fixtureApi(opts: { latency?: number; fail?: boolean } = {}): LeaderboardApi & { stats(): Promise<StatsResponse> } {
  const later = <T>(v: () => T) =>
    new Promise<T>((resolve, reject) => setTimeout(() => (opts.fail ? reject(new TypeError('Failed to fetch')) : resolve(v())), opts.latency ?? 250));
  return {
    leaderboard: (game) => later(() => boards(14_000, game ?? null)),
    stats: () => later(() => fixtureStats()),
  };
}

const line = (rounds: number, wagered: number, net: number, biggestWin: number, counted: number, wins: number, won: number, lost: number, biggestLoss: number): StatLine => ({
  rounds, wagered, net, biggestWin, counted, wins, won, lost, biggestLoss,
});

/** Ace_High's own record: a regular at the tables, dabbling online, a mixed fortnight. */
export function fixtureStats(now = Date.now()): StatsResponse {
  const games: Partial<Record<GameId, StatLine>> = {
    blackjack: line(2_140, $(612_300), $(21_450), $(4_500), 1_320, 612, $(184_200), $(171_050), $(6_000)),
    roulette: line(880, $(402_100), $(-26_300), $(9_750), 610, 214, $(98_300), $(114_700), $(12_500)),
    craps: line(655, $(301_900), $(14_875), $(7_200), 402, 181, $(66_900), $(58_420), $(5_400)),
    baccarat: line(310, $(260_000), $(-9_800), $(5_000), 180, 86, $(21_300), $(27_950), $(5_000)),
    holdem: line(212, $(51_400), $(12_380), $(8_860), 212, 41, $(19_900), $(7_520), $(2_400)),
    slots: line(420, $(21_000), $(-4_210), $(1_250), 420, 97, $(3_140), $(7_350), $(50)),
    mines: line(96, $(9_600), $(1_760), $(2_310), 96, 38, $(4_620), $(2_860), $(100)),
    crash: line(62, $(12_400), $(-1_925), $(1_600), 62, 25, $(2_380), $(4_305), $(200)),
  };
  const total = line(0, 0, 0, 0, 0, 0, 0, 0, 0);
  for (const s of Object.values(games)) {
    for (const k of ['rounds', 'wagered', 'net', 'counted', 'wins', 'won', 'lost'] as const) total[k] += s[k];
    total.biggestWin = Math.max(total.biggestWin, s.biggestWin);
    total.biggestLoss = Math.max(total.biggestLoss, s.biggestLoss);
  }
  const nets = [12_400, -8_150, 0, 0, 3_275, 19_880, -22_300, 6_410, -3_020, 0, 41_250, -15_600, 9_900, 4_125];
  return {
    name: ME,
    createdAt: now - 19 * 86_400_000,
    worth: { balance: $(96_270), inPlay: $(22_150), total: $(118_420) },
    total,
    games,
    days: lastDays(vegasDay(now), 14).map((day, i) => ({ day, net: $(nets[i]!) })),
    streak: 9,
    feats: 12,
    celebs: 3,
    collection: $(1_285_000),
  };
}
