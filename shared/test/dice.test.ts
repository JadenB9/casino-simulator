import { describe, it, expect } from 'vitest';
import { GRID, MIN_CHANCE, MAX_CHANCE, RETURN_ROLLS, drawRoll, winCount, targetFor, isTarget, wins, floorDiv, winPayout, multiplierOf, exactReturn, rtpOf, nearestExactChance } from '../src/games/dice/rules.ts';
import { engine, RECENT, type DiceState, type DiceAction, type DiceView, type RollEvent } from '../src/games/dice/engine.ts';
import type { EngineCtx } from '../src/engine.ts';
import { isRefusal } from '../src/engine.ts';
import type { Rng } from '../src/rng.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';

type Sim = TableSim<DiceState, DiceAction, DiceView>;

/** An Rng whose next draw is `x`; randInt(10000) keeps any x below its rejection limit as x % 10000. */
function forced(x: number): Rng {
  return { next32: () => x };
}

function solo(stack = 1_000_000, rng: Rng = seededRng(21)): Sim {
  return new TableSim(engine, rng, 'solo', [{ seat: 0, stack }]);
}

function ctxWith(rng: Rng, stack = 1_000_000_000): EngineCtx {
  return { rng, now: 0, mode: 'solo', started: true, seats: [{ seat: 0, accountId: 1, name: 'P0', stack, connected: true, ready: false }] };
}

describe('dice targets', () => {
  it('counts the winning rolls: above the target for Over, below it for Under', () => {
    expect(winCount(4950, false)).toBe(4950);
    expect(winCount(5049, true)).toBe(4950);
    expect(targetFor(4950, true)).toBe(5049);
    expect(targetFor(4950, false)).toBe(4950);
    const bad: number[] = [];
    for (let c = MIN_CHANCE; c <= MAX_CHANCE; c++) {
      if (winCount(targetFor(c, true), true) !== c || winCount(targetFor(c, false), false) !== c) bad.push(c);
    }
    expect(bad).toEqual([]);
  });

  it('takes chances from 0.01% to 98% on either side, and nothing outside', () => {
    expect(isTarget(1, false)).toBe(true);
    expect(isTarget(9800, false)).toBe(true);
    expect(isTarget(0, false)).toBe(false);
    expect(isTarget(9801, false)).toBe(false);
    expect(isTarget(9998, true)).toBe(true);
    expect(isTarget(199, true)).toBe(true);
    expect(isTarget(9999, true)).toBe(false);
    expect(isTarget(198, true)).toBe(false);
    expect(isTarget(50.5, true)).toBe(false);
    expect(isTarget('5000', true)).toBe(false);
  });

  it('never pays a roll equal to the target', () => {
    expect(wins(5000, 5000, true)).toBe(false);
    expect(wins(5000, 5000, false)).toBe(false);
    expect(wins(5001, 5000, true)).toBe(true);
    expect(wins(4999, 5000, false)).toBe(true);
  });

  it('draws a roll uniformly from 0.00 to 99.99', () => {
    expect(drawRoll(forced(0))).toBe(0);
    expect(drawRoll(forced(9_999))).toBe(9_999);
    expect(drawRoll(forced(10_000))).toBe(0);
    expect(drawRoll(forced(4_294_959_999))).toBe(9_999);
  });
});

describe('dice payouts', () => {
  it('floors bet · 9900 / chance to the cent, exactly', () => {
    const bad: string[] = [];
    for (let c = MIN_CHANCE; c <= MAX_CHANCE; c++) {
      for (const bet of [100, 300, 700, 10_000, 99_900, 100_000]) {
        if (BigInt(winPayout(bet, c)) !== (BigInt(bet) * 9900n) / BigInt(c)) bad.push(`${bet} at ${c}`);
      }
    }
    expect(bad).toEqual([]);
    expect(winPayout(100, 4950)).toBe(200);
    expect(winPayout(100, 7000)).toBe(141);
    expect(winPayout(100, 1)).toBe(990_000);
    expect(winPayout(100, 9800)).toBe(101);
    expect(multiplierOf(4950)).toBe(2);
    expect(multiplierOf(9800)).toBeCloseTo(1.0102, 4);
  });

  it('floorDiv is exact where a / b rounds up to a whole number', () => {
    // 2^53 - 1 over 3 in doubles is exact; a quotient a hair under a whole number is the risky case.
    expect(floorDiv(9_007_199_254_740_990, 3)).toBe(3_002_399_751_580_330);
    expect(floorDiv(99_999_999_999_999, 100_000_000_000_000)).toBe(0);
    const bad: string[] = [];
    for (let a = 0; a < 2_000; a++) for (let b = 1; b < 50; b++) if (floorDiv(a, b) !== Math.floor(a / b)) bad.push(`${a}/${b}`);
    expect(bad).toEqual([]);
  });

  it('never pays a win back less than its stake (98% pays 1.0102x)', () => {
    let least = Infinity;
    for (let c = MIN_CHANCE; c <= MAX_CHANCE; c++) least = Math.min(least, winPayout(100, c));
    expect(least).toBe(101);
  });
});

describe('dice returns (exact)', () => {
  it('returns c · floor(bet · 9900 / c) / (10,000 · bet): every roll of every target, at $1', () => {
    // All 10,000 rolls against all 19,600 targets (9,800 chances on each side) with the same
    // rule functions the engine settles with: the total paid is the published formula exactly.
    const bad: string[] = [];
    // A local binding: the test runner reaches imports through getters, too slow for 196M calls.
    const won = wins;
    for (const over of [false, true]) {
      for (let c = MIN_CHANCE; c <= MAX_CHANCE; c++) {
        const target = targetFor(c, over);
        let wonRolls = 0;
        for (let roll = 0; roll < GRID; roll++) if (won(roll, target, over)) wonRolls++;
        const paid = wonRolls * winPayout(100, c);
        const { num, den } = exactReturn(100, c);
        if (wonRolls !== c || paid * den !== num * GRID * 100) bad.push(`${over ? 'over' : 'under'} ${target}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('matches through the engine over all 10,000 rolls for a spread of targets and bets', () => {
    const state = engine.create(engine.config('', 'solo'), ctxWith(forced(0)));
    const cases: [number, boolean, number][] = [
      [4950, false, 100], [5049, true, 100], [7000, false, 100], [290, true, 100], [1, false, 100],
      [9998, true, 100], [9800, false, 700], [3333, false, 1_300], [6000, true, 25_000], [199, true, 100_000],
    ];
    for (const [target, over, bet] of cases) {
      const c = winCount(target, over);
      let paid = 0;
      for (let roll = 0; roll < GRID; roll++) {
        const step = engine.act(state, 0, { type: 'roll', bet, target, over }, ctxWith(forced(roll)));
        if (isRefusal(step)) throw new Error(step.msg);
        const ev = step.events[0] as unknown as RollEvent;
        if (ev.roll !== roll || ev.win !== wins(roll, target, over) || ev.chance !== c) throw new Error(`roll ${roll} settled wrong`);
        paid += ev.payout;
      }
      const { num, den } = exactReturn(bet, c);
      // paid over (10,000 rolls x bet) = num / den
      expect(paid * den).toBe(num * GRID * bet);
    }
  });

  it('is 99% exactly when the chance divides bet · 9900, and at most one cent a win below it', () => {
    expect(rtpOf(100, 4950)).toBe(0.99);
    expect(rtpOf(100, 5000)).toBe(0.99);
    expect(rtpOf(100, 1)).toBe(0.99);
    expect(rtpOf(100, 7000)).toBeCloseTo(0.987, 12);
    const bad: string[] = [];
    for (const bet of [100, 200, 500, 2_500, 100_000]) {
      let exact = 0;
      for (let c = MIN_CHANCE; c <= MAX_CHANCE; c++) {
        const { num, den } = exactReturn(bet, c);
        const paid = winPayout(bet, c);
        // A win pays at most one cent under the ideal bet · 9900 / c, and never over it: the return
        // sits in (0.99 - c / (10^4 · bet), 0.99], equal to 0.99 exactly when c divides bet · 9900.
        const divides = (bet * RETURN_ROLLS) % c === 0;
        if (divides) exact++;
        const ok =
          c * paid <= bet * RETURN_ROLLS &&
          c * paid + c > bet * RETURN_ROLLS &&
          num === c * paid &&
          den === GRID * bet &&
          (divides ? num * 100 === 99 * den : num * 100 < 99 * den);
        if (!ok) bad.push(`${bet} at ${c}`);
      }
      expect(exact).toBeGreaterThan(100);
    }
    expect(bad).toEqual([]);
  });

  it('publishes the $1 extremes: 98.0306% at 97.06% is the lowest, 114 chances pay exactly 99%', () => {
    let min = 1;
    let at = 0;
    let exact = 0;
    for (let c = MIN_CHANCE; c <= MAX_CHANCE; c++) {
      const r = rtpOf(100, c);
      if (r < min) [min, at] = [r, c];
      if ((100 * RETURN_ROLLS) % c === 0) exact++;
    }
    expect(at).toBe(9706);
    expect(min).toBeCloseTo(0.98030600, 8);
    expect(exact).toBe(114);
  });

  it('finds the nearest chance that pays exactly 99% at a bet', () => {
    expect(nearestExactChance(100, 4950)).toBe(4950);
    const c = nearestExactChance(100, 7000);
    expect((100 * RETURN_ROLLS) % c).toBe(0);
    for (let d = 0; d < Math.abs(c - 7000); d++) {
      expect((100 * RETURN_ROLLS) % (7000 + d)).not.toBe(0);
      expect((100 * RETURN_ROLLS) % (7000 - d)).not.toBe(0);
    }
  });
});

describe('dice engine', () => {
  it('takes the bet and pays a win in one step', () => {
    const sim = solo(10_000, forced(12));
    sim.act(0, { type: 'roll', bet: 500, target: 4950, over: false });
    const ev = sim.lastEvents[0] as RollEvent;
    expect(ev).toMatchObject({ type: 'roll', seat: 0, round: 1, bet: 500, target: 4950, over: false, chance: 4950, roll: 12, win: true, payout: 1_000 });
    expect(ev.stack).toBe(10_000 - 500 + 1_000);
    expect(sim.stack(0)).toBe(ev.stack);
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 500, returned: 1_000 }]);
  });

  it('takes the bet on a loss and pays nothing', () => {
    const sim = solo(10_000, forced(4950));
    sim.act(0, { type: 'roll', bet: 500, target: 4950, over: false });
    const ev = sim.lastEvents[0] as RollEvent;
    expect(ev.win).toBe(false);
    expect(ev.payout).toBe(0);
    expect(sim.stack(0)).toBe(9_500);
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 500, returned: 0 }]);
  });

  it('keeps the last rolls newest first', () => {
    const sim = solo();
    for (let i = 0; i < RECENT + 3; i++) sim.act(0, { type: 'roll', bet: 100, target: 5049, over: true });
    const v = sim.view(0);
    expect(v.recent).toHaveLength(RECENT);
    expect(v.recent[0]!.round).toBe(RECENT + 3);
  });

  it('refuses bad targets, bets off the limits or the dollar, and bets beyond the stack', () => {
    const sim = solo(5_000);
    const refused = (a: object) => sim.act(0, { type: 'roll', bet: 100, target: 4950, over: false, ...a }, { allowRefusal: true }).refused;
    expect(refused({ target: 9801 })).toBe('BAD_REQUEST');
    expect(refused({ target: 0 })).toBe('BAD_REQUEST');
    expect(refused({ target: 198, over: true })).toBe('BAD_REQUEST');
    expect(refused({ target: 9999, over: true })).toBe('BAD_REQUEST');
    expect(refused({ bet: 0 })).toBe('LIMIT');
    expect(refused({ bet: 250 })).toBe('LIMIT');
    expect(refused({ bet: 100_100 })).toBe('LIMIT');
    expect(refused({ bet: 5_100 })).toBe('NOT_ENOUGH_CHIPS');
    expect(sim.rounds).toHaveLength(0);
  });

  it('parses only well-formed rolls', () => {
    expect(engine.parseAction({ type: 'roll', bet: 100, target: 4950, over: false })).toEqual({ type: 'roll', bet: 100, target: 4950, over: false });
    expect(engine.parseAction({ type: 'roll', bet: 100, target: 49.5, over: false })).toBeNull();
    expect(engine.parseAction({ type: 'roll', bet: 100, target: 4950, over: 'yes' })).toBeNull();
    expect(engine.parseAction({ type: 'roll', bet: 100, target: 4950 })).toBeNull();
    expect(engine.parseAction({ type: 'bet', bet: 100, target: 4950, over: false })).toBeNull();
  });

  it('never leaves chips on the table and never mutates its input', () => {
    const sim = solo();
    const frozen = sim.state;
    const before = structuredClone(frozen);
    sim.act(0, { type: 'roll', bet: 100, target: 4950, over: false });
    expect(frozen).toEqual(before);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    expect(engine.tick(sim.state, sim.ctx())).toBeNull();
  });
});
