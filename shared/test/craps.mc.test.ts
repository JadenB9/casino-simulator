import { it, expect } from 'vitest';
import { settle, nextPoint, type Bet, type BetId, type PointNumber } from '../src/games/craps/rules.ts';
import { randInt, type Rng } from '../src/rng.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

// Monte Carlo, one trial per bet resolved (docs/rules/table-games.md §5): put the bet up, roll
// until it wins, loses or pushes, record the net per unit, start over. The rolls go through the
// same settle() and nextPoint() the table uses.

// shared/ compiles without DOM or Node types
declare const console: { log(...args: unknown[]): void };

const UNIT = 600; // $6: a legal size for every bet below

function resolve(rng: Rng, id: BetId, bet: Bet, point: PointNumber | null): number {
  for (;;) {
    const d1 = randInt(rng, 6) + 1;
    const d2 = randInt(rng, 6) + 1;
    const r = settle(id, bet, point, d1, d2);
    if (r.wagered > 0) return (r.returned - r.wagered) / bet.amount;
    // a line bet's own point is the table's point
    if (id === 'pass' || id === 'dontpass') point = nextPoint(point, d1 + d2);
  }
}

function run(label: string, id: BetId, point: PointNumber | null, published: number, seed: number, n: number): void {
  const rng = mcRng(seed);
  const tally = new Tally();
  const bet: Bet = { amount: UNIT };
  for (let i = 0; i < n; i++) tally.add(resolve(rng, id, bet, point));
  console.log(tally.summary(label, published));
  expect(Math.abs(tally.edge - published)).toBeLessThanOrEqual(3 * tally.se);
}

it('pass line: 1.414% per bet resolved (Monte Carlo, 3 SE)', () => {
  run('craps pass', 'pass', null, 7 / 495, 20260922, mcRounds(4_000_000));
});

it('field (2 pays 2:1, 12 pays 3:1): 2.778% (Monte Carlo, 3 SE)', () => {
  run('craps field', 'field', null, 1 / 36, 20260923, mcRounds(4_000_000));
});

it("don't pass, bar 12, pushes counted: 1.364% (Monte Carlo, 3 SE)", () => {
  run("craps don't pass", 'dontpass', null, 3 / 220, 20260924, mcRounds(2_000_000));
});

it('place 6: 1.515% (Monte Carlo, 3 SE)', () => {
  run('craps place 6', 'place6', 8, 1 / 66, 20260925, mcRounds(2_000_000));
});
