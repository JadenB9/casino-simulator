import { describe, it, expect } from 'vitest';
import { COLORS, GEMS, HANDS, PATTERNS, PAYS, WAYS, patternOf, matched, groups, payoutFor, exactReturn } from '../src/games/diamonds/rules.ts';
import { engine, type DiamondsAction, type DiamondsEvent, type DiamondsState, type DiamondsView } from '../src/games/diamonds/engine.ts';
import { TableSim } from './helpers/table-sim.ts';
import { queuedRng } from './online-rng.ts';

type Sim = TableSim<DiamondsState, DiamondsAction, DiamondsView>;

function solo(queue: number[] = [], stack = 100_000): Sim {
  return new TableSim(engine, queuedRng(queue, 4), 'solo', [{ seat: 0, stack }]);
}

/** Every one of the 7^5 hands, in order. */
function* everyHand(): Generator<number[]> {
  for (let i = 0; i < HANDS; i++) {
    const h: number[] = [];
    for (let k = 0, x = i; k < GEMS; k++, x = Math.floor(x / COLORS)) h.push(x % COLORS);
    yield h;
  }
}

describe('diamonds patterns', () => {
  it('names each pattern', () => {
    expect(patternOf([1, 1, 1, 1, 1])).toBe('five');
    expect(patternOf([1, 1, 3, 1, 1])).toBe('four');
    expect(patternOf([2, 5, 2, 5, 2])).toBe('fullhouse');
    expect(patternOf([2, 5, 2, 6, 2])).toBe('three');
    expect(patternOf([0, 4, 0, 4, 6])).toBe('twopair');
    expect(patternOf([0, 4, 0, 3, 6])).toBe('pair');
    expect(patternOf([0, 1, 2, 3, 4])).toBe('none');
    expect(groups([2, 5, 2, 5, 2])).toEqual([3, 2]);
    expect(matched([0, 4, 0, 3, 6])).toEqual([true, false, true, false, false]);
  });

  it('counts every hand exactly: the 16,807 hands fall as the published ways', () => {
    const counts = Object.fromEntries(PATTERNS.map((p) => [p, 0])) as Record<string, number>;
    for (const h of everyHand()) counts[patternOf(h)]!++;
    expect(counts).toEqual(WAYS);
    expect(Object.values(WAYS).reduce((a, b) => a + b, 0)).toBe(16_807);
  });

  it('returns exactly 99% (enumerated over every hand, and in closed form)', () => {
    let num = 0;
    for (const h of everyHand()) num += PAYS[patternOf(h)];
    expect(num).toBe(1_663_893);
    expect(num * 100).toBe(HANDS * 100 * 99);
    const r = exactReturn();
    expect(r.num * 100).toBe(r.den * 99);
    expect(PAYS).toEqual({ five: 6_699, four: 500, fullhouse: 400, three: 300, twopair: 200, pair: 10, none: 0 });
    expect(payoutFor(300, 'pair')).toBe(30);
  });
});

describe('diamonds engine', () => {
  it('draws five gems with the server rng and pays the pattern', () => {
    const sim = solo([3, 3, 3, 3, 3, 0, 1, 0, 1, 2]);
    sim.act(0, { type: 'bet', bet: 1_000 });
    let e = sim.lastEvents[0] as DiamondsEvent;
    expect(e).toMatchObject({ type: 'draw', gems: [3, 3, 3, 3, 3], pattern: 'five', mult: 6_699, payout: 66_990 });
    expect(sim.stack(0)).toBe(100_000 - 1_000 + 66_990);
    expect(e.stack).toBe(sim.stack(0));
    sim.act(0, { type: 'bet', bet: 1_000 });
    e = sim.lastEvents[0] as DiamondsEvent;
    expect(e).toMatchObject({ gems: [0, 1, 0, 1, 2], pattern: 'twopair', payout: 2_000 });
    expect(sim.view(0).recent.map((h) => h.pattern)).toEqual(['twopair', 'five']);
    expect(sim.rounds.map((r) => r.returned)).toEqual([66_990, 2_000]);
  });

  it('refuses bets off the limits or the stack, and junk', () => {
    const sim = solo([], 500);
    expect(sim.act(0, { type: 'bet', bet: 50 }, { allowRefusal: true }).refused).toBe('LIMIT');
    expect(sim.act(0, { type: 'bet', bet: 250 }, { allowRefusal: true }).refused).toBe('LIMIT');
    expect(sim.act(0, { type: 'bet', bet: 600 }, { allowRefusal: true }).refused).toBe('NOT_ENOUGH_CHIPS');
    expect(engine.parseAction({ type: 'bet' })).toBeNull();
    expect(engine.parseAction({ type: 'deal', bet: 100 })).toBeNull();
  });
});
