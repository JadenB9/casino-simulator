// The stats keys a round adds, casino days and weeks, and the figures the sheets show.

import { describe, expect, it } from 'vitest';
import {
  addDays,
  addRoundStats,
  dayKey,
  favouriteGame,
  formatRate,
  isStatMaxTally,
  lastDays,
  vegasDay,
  weekKey,
  weekOf,
  winRateBp,
} from '../src/stats.ts';
import { isMaxTally } from '../src/feats.ts';
import type { GameId } from '../src/engine.ts';

describe('a round in the tallies', () => {
  it('a win counts the round and a win; a loss what it lost and the worst round; a push only the round', () => {
    const win: Record<string, number> = {};
    addRoundStats(win, 'roulette', 2_600);
    expect(win).toEqual({ 'rounds:roulette': 1, wins: 1 });

    const loss: Record<string, number> = {};
    addRoundStats(loss, 'craps', -1_500);
    expect(loss).toEqual({ 'rounds:craps': 1, lost: 1_500, 'lost:craps': 1_500, worst: 1_500, 'worst:craps': 1_500 });

    const push: Record<string, number> = {};
    addRoundStats(push, 'blackjack', 0);
    expect(push).toEqual({ 'rounds:blackjack': 1 });
  });

  it('two rounds in one set of tallies: sums add, the worst round is the larger loss', () => {
    const t: Record<string, number> = {};
    addRoundStats(t, 'dice', -300);
    addRoundStats(t, 'dice', -900);
    addRoundStats(t, 'dice', -100);
    expect(t).toMatchObject({ 'rounds:dice': 3, lost: 1_300, worst: 900, 'worst:dice': 900 });
  });

  it('the worst round and the streak are kept as maximums, and the feats agree', () => {
    for (const k of ['worst', 'worst:dice', 'streak', 'best']) expect(isMaxTally(k)).toBe(true);
    for (const k of ['lost', 'lost:dice', 'wins', 'rounds:dice', 'won', dayKey('2026-09-25'), 'feats']) expect(isMaxTally(k)).toBe(false);
    expect(isStatMaxTally('best')).toBe(false);
  });
});

describe('casino days and weeks', () => {
  it('the day is Las Vegas time', () => {
    // 2026-09-25 06:30 UTC is still the 24th in Las Vegas (UTC-7 in September)
    expect(vegasDay(Date.UTC(2026, 8, 25, 6, 30))).toBe('2026-09-24');
    expect(vegasDay(Date.UTC(2026, 8, 25, 7, 30))).toBe('2026-09-25');
    // winter: UTC-8
    expect(vegasDay(Date.UTC(2026, 11, 1, 7, 30))).toBe('2026-11-30');
  });

  it('adds days across months and years', () => {
    expect(addDays('2026-09-25', 1)).toBe('2026-09-26');
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('weeks start on Monday', () => {
    // 2026-09-25 is a Friday
    expect(weekOf('2026-09-25')).toBe('2026-09-21');
    expect(weekOf('2026-09-21')).toBe('2026-09-21');
    expect(weekOf('2026-09-27')).toBe('2026-09-21');
    expect(weekOf('2026-09-28')).toBe('2026-09-28');
    expect(weekOf('2027-01-01')).toBe('2026-12-28');
  });

  it('keys sort by date, so a range of them is a stretch of days', () => {
    expect(dayKey('2026-09-25')).toBe('d:2026-09-25:net');
    expect(weekKey('2026-09-21')).toBe('w:2026-09-21:net');
    expect(dayKey('2026-09-09') < dayKey('2026-09-10')).toBe(true);
    // the prune bound (the first twelve characters) sits between the days either side of it
    const bound = dayKey('2026-09-10').slice(0, 12);
    expect(dayKey('2026-09-09') < bound && bound <= dayKey('2026-09-10')).toBe(true);
    // no other tally key falls in the d: or w: ranges
    const inRange = (k: string, p: string) => k >= `${p}:` && k < `${p};`;
    for (const k of ['daily-streak', 'daily-last', 'wins', 'won', 'worst', 'wins:dice', 'd', 'w']) expect(inRange(k, 'd') || inRange(k, 'w')).toBe(false);
  });

  it('the last n days end today, oldest first', () => {
    expect(lastDays('2026-10-02', 4)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(lastDays('2026-10-02', 1)).toEqual(['2026-10-02']);
  });
});

describe('figures', () => {
  it('a win rate in basis points, rounded to the nearest', () => {
    expect(winRateBp(0, 0)).toBe(0);
    expect(winRateBp(1, 3)).toBe(3_333);
    expect(winRateBp(2, 3)).toBe(6_667);
    expect(winRateBp(100, 100)).toBe(10_000);
    expect(formatRate(6_667)).toBe('66.7%');
    expect(formatRate(0)).toBe('0.0%');
    expect(formatRate(10_000)).toBe('100.0%');
  });

  it('the favourite game has the most rounds; a tie goes to the first in the list', () => {
    const order = ['blackjack', 'roulette', 'craps'] as GameId[];
    expect(favouriteGame({}, order)).toBeNull();
    expect(favouriteGame({ roulette: 3, craps: 9 }, order)).toBe('craps');
    expect(favouriteGame({ blackjack: 5, craps: 5 }, order)).toBe('blackjack');
    expect(favouriteGame({ blackjack: 0 }, order)).toBeNull();
  });
});
