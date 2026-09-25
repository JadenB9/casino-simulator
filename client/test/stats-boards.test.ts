// The leaderboards' words and number formats, your place on a board, and the stats sheet's
// figures: its game rows and their sort, the fortnight, the day labels.

import { describe, expect, it } from 'vitest';
import { CATALOG } from '../../shared/src/games/catalog.ts';
import type { GameId } from '../../shared/src/engine.ts';
import { GAME_LEADERBOARDS, LEADERBOARDS, type StatLine, type StatsResponse } from '../../shared/src/protocol.ts';
import { GAME_GROUPS, GROUPS, boardText, boardsOf, formatValue, ordinal, pickableGames, refreshedText, valueTone } from '../src/ui/stats/boards.ts';
import { dayLabel, dayTick, fortnight, gameRows, unplayed } from '../src/ui/stats/figures.ts';
import { placeOn } from '../src/ui/social/leaderboard.ts';

describe('the boards', () => {
  it('the groups list every board once, in the order the server sends them', () => {
    expect(GROUPS.flatMap((g) => g.boards)).toEqual([...LEADERBOARDS]);
    expect(GAME_GROUPS.flatMap((g) => g.boards)).toEqual([...GAME_LEADERBOARDS]);
    expect(boardsOf(null)).toEqual(LEADERBOARDS);
    expect(boardsOf('craps')).toEqual(GAME_LEADERBOARDS);
  });

  it('every board has its words, and a game board names its game', () => {
    const names = new Set<string>();
    for (const id of LEADERBOARDS) {
      const t = boardText(id);
      for (const k of ['name', 'column', 'note', 'empty', 'unplaced'] as const) expect(t[k].length).toBeGreaterThan(0);
      names.add(t.name);
    }
    expect(names.size).toBe(LEADERBOARDS.length);
    for (const id of GAME_LEADERBOARDS) expect(boardText(id, 'roulette').note).toContain('Roulette');
    expect(boardText('netUp', 'blackjack').name).toBe('Top earners');
    expect(boardText('winRate', 'keno').unplaced).toMatch(/^Play 50 rounds of Keno/);
    expect(boardText('winRate').unplaced).toMatch(/^Play 100 rounds/);
  });

  it('writes each unit its own way', () => {
    expect(formatValue('money', 1_234_500)).toBe('$12,345');
    expect(formatValue('signed', 1_234_500)).toBe('+$12,345');
    expect(formatValue('signed', -50)).toBe('−$0.50');
    expect(formatValue('count', 14_902)).toBe('14,902');
    expect(formatValue('rate', 5_234)).toBe('52.3%');
    expect(valueTone('signed', 5)).toBe('win');
    expect(valueTone('signed', -5)).toBe('lose');
    expect(valueTone('signed', 0)).toBe('');
    expect(valueTone('money', -5)).toBe('');
  });

  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 1_002].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '1,002nd',
    ]);
  });

  it('your place: your row in the ten, your row below it, or none', () => {
    expect(placeOn(undefined)).toBeNull();
    expect(placeOn({ top: [{ rank: 1, name: 'a', value: 5 }, { rank: 1, name: 'me', value: 5, you: true }], you: null })).toBe(1);
    expect(placeOn({ top: [], you: { rank: 41, name: 'me', value: 5 } })).toBe(41);
    expect(placeOn({ top: [], you: { rank: null, name: 'me', value: 0 } })).toBeNull();
  });

  it('the picker offers every game on the floor, tables first, never the test game', () => {
    const { tables, online } = pickableGames();
    const all = [...tables, ...online];
    expect(all).not.toContain('highcard');
    expect(new Set(all).size).toBe(Object.keys(CATALOG).length - 1);
    for (const g of online) expect(CATALOG[g].online).toBe(true);
    expect([...tables].sort((a, b) => CATALOG[a].name.localeCompare(CATALOG[b].name))).toEqual(tables);
  });

  it('says how old the boards are', () => {
    expect(refreshedText(400)).toBe('Refreshed just now');
    expect(refreshedText(14_000)).toBe('Refreshed 14 s ago');
    expect(refreshedText(125_000)).toBe('Refreshed 2 min ago');
  });
});

const line = (o: Partial<StatLine>): StatLine => ({ rounds: 0, wagered: 0, net: 0, biggestWin: 0, counted: 0, wins: 0, won: 0, lost: 0, biggestLoss: 0, ...o });

function sheet(games: Partial<Record<GameId, StatLine>>, nets: number[] = []): StatsResponse {
  return {
    name: 'me',
    createdAt: 0,
    worth: { balance: 0, inPlay: 0, total: 0 },
    total: line({}),
    games,
    days: nets.map((net, i) => ({ day: `2026-09-${String(12 + i).padStart(2, '0')}`, net })),
    streak: 0,
    feats: 0,
    celebs: 0,
    collection: 0,
  };
}

describe('the stats sheet', () => {
  const s = sheet({
    blackjack: line({ rounds: 300, wagered: 9_000, net: -500, counted: 100, wins: 45, won: 900, lost: 1_400, biggestWin: 200, biggestLoss: 300 }),
    roulette: line({ rounds: 90, wagered: 20_000, net: 2_000, counted: 90, wins: 20 }),
    craps: line({ rounds: 300, net: 10 }),
    // played before round records began, and a line with nothing in it
    keno: line({ rounds: 0, counted: 0 }),
  });

  it('lists the games played, most rounds first, ties in catalog order', () => {
    expect(gameRows(s).map((r) => r.game)).toEqual(['blackjack', 'craps', 'roulette']);
    expect(gameRows(s)[0]!.rate).toBe(4_500);
    expect(gameRows(s).find((r) => r.game === 'craps')!.rate).toBeNull();
  });

  it('sorts by any column either way; no rate sorts below any rate', () => {
    expect(gameRows(s, 'net', true).map((r) => r.game)).toEqual(['roulette', 'craps', 'blackjack']);
    expect(gameRows(s, 'net', false).map((r) => r.game)).toEqual(['blackjack', 'craps', 'roulette']);
    expect(gameRows(s, 'game', false).map((r) => r.game)).toEqual(['blackjack', 'craps', 'roulette']);
    expect(gameRows(s, 'rate', true).map((r) => r.game)).toEqual(['blackjack', 'roulette', 'craps']);
    expect(gameRows(s, 'wagered', true).map((r) => r.game)).toEqual(['roulette', 'blackjack', 'craps']);
  });

  it("counts the floor's games not played yet", () => {
    const floor = Object.values(CATALOG).filter((g) => !g.dev).length;
    expect(unplayed(s)).toBe(floor - 3);
    expect(unplayed(sheet({}))).toBe(floor);
  });

  it('sums the fortnight, and finds its best and worst days', () => {
    const f = fortnight(sheet({}, [100, -300, 0, 50, 400, -20]).days);
    expect(f).toEqual({ total: 230, best: { day: '2026-09-16', net: 400 }, worst: { day: '2026-09-13', net: -300 }, up: 3, down: 2, scale: 400 });
    const quiet = fortnight(sheet({}, [0, 0]).days);
    expect(quiet).toMatchObject({ total: 0, best: null, worst: null, scale: 1 });
  });

  it('labels the days', () => {
    expect(dayLabel('2026-09-25')).toBe('Fri 25 Sep');
    expect(dayLabel('2027-01-03')).toBe('Sun 3 Jan');
    expect(dayTick('2026-09-21')).toEqual(['M', '21']);
  });
});
