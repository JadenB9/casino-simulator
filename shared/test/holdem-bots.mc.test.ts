// The Hold'em bots against each other, over many duplicate hands with fixed seeds: bots drawn
// for high stakes beat bots drawn for micro stakes, a professional beats each kind of weak
// player heads-up, and none of the trivial strategies a player might try to farm the bots with
// (always call, always raise, min-raise every street, all-in every hand) wins against the tables
// the engine seats at high stakes. Win rates are big blinds per 100 hands with their standard
// errors, printed for the record. MC_ROUNDS scales the number of deals.

import { it, expect } from 'vitest';
import { mcRounds } from './helpers/stats.ts';
import { alwaysCall, alwaysMinRaise, alwaysRaise, alwaysShove, botPlayer, drawnTable, duplicateMatch, table, type ArenaStats, type MatchResult } from './helpers/poker-arena.ts';

const log = (s: string) => console.log(s);
const stats: ArenaStats = { decisions: 0, refused: 0, ms: 0, slowestMs: 0 };

const find = (r: MatchResult[], name: string) => r.find((x) => x.name === name)!;

it('bots drawn for high stakes beat bots drawn for micro stakes', () => {
  const deals = mcRounds(1_500);
  for (const [lo, hi, seed] of [
    [100, 1_000_000, 11], // $1 against $10,000 big blinds
    [100, 10_000, 12], // $1 against $100
  ] as const) {
    const teams = ['high', 'high', 'high', 'micro', 'micro', 'micro'];
    const players = [...drawnTable(hi, 3, seed, 'hi:'), ...drawnTable(lo, 3, seed + 1, 'lo:')];
    const r = duplicateMatch(players, deals, seed, stats, { teams });
    log(`Bots drawn at a $${hi / 100} big blind against bots drawn at $${lo / 100}, ${deals} deals x 6 seatings:\n${table(r)}`);
    const high = find(r, 'high');
    const micro = find(r, 'micro');
    // the high-stakes bots together win, the micro-stakes ones lose, each by more than 3 SE
    expect(high.bb100).toBeGreaterThan(3 * high.se);
    expect(micro.bb100).toBeLessThan(-3 * micro.se);
  }
});

it('a professional beats every kind of weak player heads-up', () => {
  const deals = mcRounds(2_000);
  for (const [id, skill, seed] of [
    ['station', 0.12, 21],
    ['fish', 0.2, 22],
    ['maniac', 0.25, 23],
    ['rock', 0.45, 24],
  ] as const) {
    const r = duplicateMatch([botPlayer('pro', 'pro', 0.97), botPlayer(id, id, skill)], deals, seed, stats);
    log(`Heads-up, a pro against a ${id}, ${deals} deals x 2 seatings:\n${table(r)}`);
    const pro = find(r, 'pro');
    expect(pro.bb100).toBeGreaterThan(3 * pro.se);
  }
});

it('no trivial strategy wins against the tables the engine seats at high stakes', () => {
  const deals = mcRounds(1_000);
  const strategies = [
    ['always call', alwaysCall],
    ['always raise', alwaysRaise],
    ['always min-raise', alwaysMinRaise],
    ['always all-in', alwaysShove],
  ] as const;
  for (const bb of [100_000, 10_000_000]) {
    for (const [i, [label, make]] of strategies.entries()) {
      const seed = 31 + i + bb;
      const r = duplicateMatch([make(label), ...drawnTable(bb, 5, seed)], deals, seed, stats);
      log(`${label} against five bots drawn for a $${bb / 100} big blind, ${deals} deals x 6 seatings:\n${table(r)}`);
      const me = find(r, label);
      // it loses, and by more than the noise
      expect(me.bb100 + 3 * me.se).toBeLessThan(0);
    }
  }
});

it('every bot decision was legal, and quick', () => {
  log(`${stats.decisions} bot decisions, ${stats.refused} refused, ${(stats.ms / stats.decisions).toFixed(3)} ms each on average, slowest ${stats.slowestMs.toFixed(1)} ms`);
  expect(stats.decisions).toBeGreaterThan(10_000);
  expect(stats.refused).toBe(0);
  expect(stats.ms / stats.decisions).toBeLessThan(5);
});
