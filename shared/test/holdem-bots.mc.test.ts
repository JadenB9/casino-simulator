// The Hold'em bots against each other, over many duplicate hands with fixed seeds: bots drawn
// for high stakes beat bots drawn for micro stakes, a professional beats the loose players
// heads-up, and none of the trivial strategies a player might try to farm the bots with
// (always call, always raise, min-raise every street, all-in every hand) wins against the tables
// the engine seats at high stakes. Win rates are big blinds per 100 hands with their standard
// errors, printed for the record. MC_ROUNDS scales the number of deals.

import { it, expect } from 'vitest';
import { mcRounds } from './helpers/stats.ts';
import { lineUp, stakesSkill, PERSONAS, PERSONA_IDS } from '../src/games/holdem/bots.ts';
import { alwaysCall, alwaysMinRaise, alwaysRaise, alwaysShove, botPlayer, drawnTable, duplicateMatch, table, type ArenaStats, type MatchResult } from './helpers/poker-arena.ts';

const log = (s: string) => console.log(s);
const stats: ArenaStats = { decisions: 0, refused: 0, ms: 0, slowestMs: 0 };

const find = (r: MatchResult[], name: string) => r.find((x) => x.name === name)!;

/**
 * The three kinds of player most likely at a table at this big blind (cents), each at the skill
 * a bot of that kind is drawn with there: the typical line-up, not one lucky or unlucky draw.
 */
function typical(bb: number, tag: string) {
  const w = lineUp(bb);
  return [...PERSONA_IDS]
    .sort((a, b) => w[b]! - w[a]!)
    .slice(0, 3)
    .map((id) => botPlayer(`${tag}${id}`, id, Math.min(0.99, PERSONAS[id]!.skill + stakesSkill(bb))));
}

it('the players at high stakes beat the players at micro stakes', () => {
  const deals = mcRounds(1_500);
  for (const [lo, hi, seed] of [
    [100, 1_000_000, 11], // $1 against $10,000 big blinds
    [100, 10_000, 12], // $1 against $100
  ] as const) {
    const teams = ['high', 'high', 'high', 'micro', 'micro', 'micro'];
    const players = [...typical(hi, 'hi:'), ...typical(lo, 'lo:')];
    const r = duplicateMatch(players, deals, seed, stats, { teams });
    log(`The typical players at a $${hi / 100} big blind against those at $${lo / 100}, ${deals} deals x 6 seatings:\n${table(r)}`);
    const high = find(r, 'high');
    const micro = find(r, 'micro');
    // the high-stakes players together win, the micro-stakes ones lose, each by more than 3 SE
    expect(high.bb100).toBeGreaterThan(3 * high.se);
    expect(micro.bb100).toBeLessThan(-3 * micro.se);
  }
  // and a line-up drawn at random, as the engine seats it, for the record
  const drawn = duplicateMatch([...drawnTable(1_000_000, 3, 11, 'hi:'), ...drawnTable(100, 3, 12, 'lo:')], deals, 13, stats, { teams: ['high', 'high', 'high', 'micro', 'micro', 'micro'] });
  log(`Bots drawn at random for a $10,000 and a $1 big blind, ${deals} deals x 6 seatings:\n${table(drawn)}`);
});

it('a professional beats a calling station, a fish and a maniac heads-up', () => {
  const deals = mcRounds(4_000);
  for (const [id, skill, seed] of [
    ['station', 0.12, 21],
    ['fish', 0.2, 22],
    ['maniac', 0.25, 23],
  ] as const) {
    const r = duplicateMatch([botPlayer('pro', 'pro', 0.97), botPlayer(id, id, skill)], deals, seed, stats);
    log(`Heads-up, a pro against a ${id}, ${deals} deals x 2 seatings:\n${table(r)}`);
    const pro = find(r, 'pro');
    expect(pro.bb100).toBeGreaterThan(3 * pro.se);
  }
});

it('no trivial strategy wins against the tables the engine seats at high stakes', () => {
  const deals = mcRounds(600);
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
