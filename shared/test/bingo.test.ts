import { describe, it, expect } from 'vitest';
import {
  BALLS, CELLS, FREE, LINES, CORNERS, LINE_MASKS, PATTERNS, PRIZES, LAST_PRIZE, MAX_CALLS, PUBLISHED_RTP,
  dealCard, drawOrder, callNumbers, completions, hasPattern, toGo, prizeMult, prizeFor, canStillWin, lineSubsets, chooseBig,
  completeBy, completeOn, cardReturn, toNumber, columnOf, ballName, callLine, type Card, type Pattern,
} from '../src/games/bingo/rules.ts';
import {
  engine, maxStake, BUY_MS, SOLO_BUY_MS, LEAD_MS, CALL_MS, SOLO_CALL_MS, RESULTS_MS, SOLO_RESULTS_MS, MAX_SEATS,
  type BingoState,
} from '../src/games/bingo/engine.ts';
import { MAX_CARDS, type BingoAction, type BingoView, type CardView } from '../src/games/bingo/protocol.ts';
import { isRefusal } from '../src/engine.ts';
import type { Rng } from '../src/rng.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';

type Sim = TableSim<BingoState, BingoAction, BingoView>;
type Ev = { type: string; [k: string]: unknown };

/** A card with the given numbers in row order (0 in the centre). */
function cardOf(rows: number[][]): Card {
  return rows.flat();
}

/** A standard test card: B 1-5, I 16-20, N 31,32,_,33,34, G 46-50, O 61-65 down the columns. */
const CARD: Card = cardOf([
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, 0, 48, 63],
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
]);

/** An order starting with `first` and then every other ball ascending. */
function orderStarting(first: number[]): number[] {
  const rest = Array.from({ length: BALLS }, (_, i) => i + 1).filter((b) => !first.includes(b));
  return [...first, ...rest];
}

function popcount(x: number): number {
  let n = 0;
  for (let b = x; b; b &= b - 1) n++;
  return n;
}

describe('bingo cards', () => {
  it('deals five columns from their own fifteen, all different, with the centre free', () => {
    const rng = seededRng(5);
    for (let i = 0; i < 2_000; i++) {
      const c = dealCard(rng);
      expect(c).toHaveLength(CELLS);
      expect(c[FREE]).toBe(0);
      const nums = c.filter((n) => n !== 0);
      expect(new Set(nums).size).toBe(24);
      c.forEach((n, cell) => {
        if (cell !== FREE) expect(columnOf(n)).toBe(cell % 5);
      });
    }
  });

  it('names balls by their column', () => {
    expect(ballName(1)).toBe('B 1');
    expect(ballName(15)).toBe('B 15');
    expect(ballName(16)).toBe('I 16');
    expect(ballName(45)).toBe('N 45');
    expect(ballName(60)).toBe('G 60');
    expect(ballName(75)).toBe('O 75');
    expect(callLine(11)).toBe('B 11. Legs eleven');
    expect(callLine(12)).toBe('B 12');
  });

  it('draws every ball once', () => {
    const rng = seededRng(9);
    for (let i = 0; i < 200; i++) expect([...drawOrder(rng)].sort((a, b) => a - b)).toEqual(Array.from({ length: BALLS }, (_, j) => j + 1));
  });

  it('has 12 lines, four of them through the free centre, and four corners', () => {
    expect(LINES).toHaveLength(12);
    expect(LINES.filter((l) => l.includes(FREE))).toHaveLength(4);
    expect(LINE_MASKS.map(popcount).sort()).toEqual([4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5]);
    expect(CORNERS).toEqual([0, 4, 20, 24]);
  });
});

describe('bingo patterns', () => {
  it('finds a row, a column, a diagonal through the centre, corners and blackout on the call that completes them', () => {
    // the N column (four numbers and the free centre) on calls 1-4
    let at = callNumbers(orderStarting([31, 32, 33, 34]));
    expect(completions(CARD, at).line).toBe(4);
    // the top row on calls 3-7 (two other balls first)
    at = callNumbers(orderStarting([70, 71, 1, 16, 31, 46, 61]));
    expect(completions(CARD, at).line).toBe(7);
    // a diagonal: 1, 17, centre, 49, 65
    at = callNumbers(orderStarting([1, 17, 49, 65]));
    expect(completions(CARD, at).line).toBe(4);
    at = callNumbers(orderStarting([1, 61, 5, 65]));
    expect(completions(CARD, at).corners).toBe(4);
    // blackout: the card's 24 numbers first
    at = callNumbers(orderStarting(CARD.filter((n) => n !== 0)));
    expect(completions(CARD, at)).toEqual({ line: completions(CARD, at).line, corners: completions(CARD, at).corners, blackout: 24 });
  });

  it('agrees with hasPattern and toGo after every call', () => {
    const rng = seededRng(44);
    for (let g = 0; g < 300; g++) {
      const card = dealCard(rng);
      const order = drawOrder(rng);
      const done = completions(card, callNumbers(order));
      const called = new Set<number>();
      for (let n = 1; n <= BALLS; n++) {
        called.add(order[n - 1]!);
        for (const p of PATTERNS) {
          expect(hasPattern(card, called, p)).toBe(done[p] <= n);
          expect(toGo(card, called, p) === 0).toBe(done[p] <= n);
        }
      }
    }
  });
});

describe('bingo prizes', () => {
  it('pays each band on its calls and nothing after the last', () => {
    expect(prizeMult('line', 1)).toBe(5_000);
    expect(prizeMult('line', 12)).toBe(5_000);
    expect(prizeMult('line', 13)).toBe(2_000);
    expect(prizeMult('line', 40)).toBe(40);
    expect(prizeMult('line', 41)).toBe(0);
    expect(prizeMult('corners', 4)).toBe(10_000);
    expect(prizeMult('corners', 35)).toBe(50);
    expect(prizeMult('corners', 36)).toBe(0);
    expect(prizeMult('blackout', 24)).toBe(2_000_000);
    expect(prizeMult('blackout', 45)).toBe(2_000_000);
    expect(prizeMult('blackout', 46)).toBe(250_000);
    expect(prizeMult('blackout', 55)).toBe(20_000);
    expect(prizeMult('blackout', 56)).toBe(0);
    expect(LAST_PRIZE).toEqual({ line: 40, corners: 35, blackout: 55 });
    expect(MAX_CALLS).toBe(55);
  });

  it('pays less the later a pattern is completed, and whole cents on whole-dollar cards', () => {
    for (const p of PATTERNS) {
      const bands = PRIZES[p];
      for (let i = 1; i < bands.length; i++) {
        expect(bands[i]!.upTo).toBeGreaterThan(bands[i - 1]!.upTo);
        expect(bands[i]!.mult).toBeLessThan(bands[i - 1]!.mult);
      }
      for (let call = 1; call <= BALLS; call++) {
        for (const stake of [100, 700, 12_300, 100_000]) {
          const x = prizeFor(p, call, stake);
          expect(Number.isInteger(x)).toBe(true);
          expect(x).toBe((stake * prizeMult(p, call)) / 100);
        }
      }
    }
  });
});

describe('bingo odds (exact)', () => {
  it('counts the line subsets by inclusion-exclusion exactly as all 2^24 subsets do', () => {
    const byInclusion = lineSubsets();
    const counted = new Array<number>(25).fill(0);
    const masks = LINE_MASKS;
    for (let s = 0; s < 1 << 24; s++) {
      for (let j = 0; j < 12; j++) {
        if ((s & masks[j]!) === masks[j]) {
          counted[popcount(s)]!++;
          break;
        }
      }
    }
    counted.forEach((c, k) => expect(byInclusion[k]).toBe(BigInt(c)));
    expect(byInclusion[3]).toBe(0n);
    expect(byInclusion[24]).toBe(1n);
  });

  it('gives each pattern a proper distribution over the 75 calls', () => {
    const lines = lineSubsets();
    for (const p of PATTERNS) {
      let prev = 0;
      for (let n = 0; n <= BALLS; n++) {
        const f = toNumber(completeBy(p, n, lines));
        expect(f).toBeGreaterThanOrEqual(prev - 1e-15);
        prev = f;
      }
      const all = completeBy(p, BALLS, lines);
      expect(all.num).toBe(all.den);
    }
    // the earliest each can happen
    expect(completeBy('line', 3, lines).num).toBe(0n);
    expect(completeBy('line', 4, lines).num > 0n).toBe(true);
    expect(completeBy('blackout', 23).num).toBe(0n);
    expect(completeBy('blackout', 24)).toEqual({ num: 1n, den: chooseBig(75, 24) });
    expect(completeOn('corners', 4)).toEqual({ num: 1n, den: chooseBig(75, 4) });
  });

  it('agrees with a card played against every order of a small shuffled deck of calls', () => {
    // Four corners on call n exactly is C(n-1, 3) / C(75, 4): the last corner is called n-th and the
    // other three before it. Blackout on call n is C(n-1, 23) / C(75, 24).
    for (let n = 4; n <= BALLS; n++) {
      const c = completeOn('corners', n);
      expect(c.num * chooseBig(75, 4)).toBe(chooseBig(n - 1, 3) * c.den);
    }
    for (let n = 24; n <= BALLS; n++) {
      const b = completeOn('blackout', n);
      expect(b.num * chooseBig(75, 24)).toBe(chooseBig(n - 1, 23) * b.den);
    }
  });

  it('returns 96.710234% of a card\'s price, as published', () => {
    const { total, parts } = cardReturn();
    // the exact fraction, rounded to the published six decimals of a percent
    const scaled = (total.num * 10n ** 8n * 2n + total.den) / (2n * total.den);
    expect(scaled.toString()).toBe(PUBLISHED_RTP.replace('.', ''));
    expect(toNumber(total)).toBeCloseTo(0.9671023402, 9);
    expect(toNumber(parts.line)).toBeCloseTo(0.75353989962, 10);
    expect(toNumber(parts.corners)).toBeCloseTo(0.18084865688, 10);
    expect(toNumber(parts.blackout)).toBeCloseTo(0.03271378372, 10);
  });
});

// ---------------------------------------------------------------------------------------------
// The engine

function multi(seats: number[] = [0, 1], stack = 1_000_000, rng: Rng = seededRng(21)): Sim {
  return new TableSim(engine, rng, 'multi', seats.map((seat) => ({ seat, stack })));
}

function solo(stack = 1_000_000, rng: Rng = seededRng(22)): Sim {
  return new TableSim(engine, rng, 'solo', [{ seat: 0, stack }]);
}

/** Run the hall's clock until the game in progress ends; returns every event on the way. */
function playOut(sim: Sim): Ev[] {
  const all: Ev[] = [];
  for (let guard = 0; guard < 200 && sim.state.phase !== 'results'; guard++) {
    const d = engine.deadline(sim.state);
    if (d === null) throw new Error(`no deadline in ${sim.state.phase}`);
    sim.advance(d - sim.now);
    all.push(...(sim.lastEvents as Ev[]));
  }
  return all;
}

describe('bingo engine: a shared hall', () => {
  it('opens a sale as soon as someone sits, with no Start, and runs a game on the clock', () => {
    const sim = multi();
    expect(sim.state.phase).toBe('buying');
    expect(sim.state.deadline).toBe(sim.now + BUY_MS);
    sim.act(0, { type: 'buy', count: 2, stake: 500 });
    sim.act(1, { type: 'buy', count: 4, stake: 100 });
    expect(sim.stack(0)).toBe(1_000_000 - 1_000);
    expect(sim.stack(1)).toBe(1_000_000 - 400);
    sim.advance(BUY_MS);
    expect(sim.state.phase).toBe('calling');
    expect(sim.lastEvents).toEqual([{ type: 'eyesdown', round: 1, cards: 6, first: sim.now + LEAD_MS }]);
    sim.advance(LEAD_MS);
    expect(sim.state.calls).toBe(1);
    const ball = sim.lastEvents[0] as Ev;
    expect(ball).toMatchObject({ type: 'ball', call: 1, ball: sim.state.order[0], next: sim.now + CALL_MS });
    sim.advance(CALL_MS);
    expect(sim.state.calls).toBe(2);
  });

  it('pays every prize on the ball that completes it, and the stacks come out exactly', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const sim = multi([0, 3, 7], 1_000_000, seededRng(seed));
      sim.act(0, { type: 'buy', count: 4, stake: 200 });
      sim.act(3, { type: 'buy', count: 1, stake: 5_000 });
      sim.act(7, { type: 'max', count: 3 });
      const cards = new Map<number, CardView[]>();
      for (const seat of [0, 3, 7]) cards.set(seat, sim.view(seat).mine!);
      const before = new Map([0, 3, 7].map((s) => [s, sim.stack(s)]));
      const events = playOut(sim);
      const order = sim.state.order;
      const calls = sim.state.calls;
      const at = callNumbers([...order, ...Array.from({ length: BALLS }, (_, i) => i + 1).filter((b) => !order.includes(b))]);
      for (const [seat, list] of cards) {
        let expected = 0;
        for (const c of list) {
          const done = completions(c.nums, at);
          for (const p of PATTERNS) if (done[p] <= calls) expected += prizeFor(p, done[p], c.stake);
        }
        const wins = events.filter((e) => e.type === 'win' && e.seat === seat).reduce((n, e) => n + (e.paid as number), 0);
        expect(wins).toBe(expected);
        expect(sim.stack(seat) - before.get(seat)!).toBe(expected);
        const end = events.find((e) => e.type === 'end')!;
        const res = (end.seats as Record<number, { wagered: number; returned: number }>)[seat]!;
        expect(res.returned).toBe(expected);
        expect(res.wagered).toBe(list.reduce((n, c) => n + c.stake, 0));
      }
      expect(sim.rounds).toHaveLength(3);
    }
  });

  it('calls no further than a prize can still be won', () => {
    for (let seed = 100; seed < 160; seed++) {
      const sim = multi([0], 1_000_000, seededRng(seed));
      sim.act(0, { type: 'buy', count: 1, stake: 100 });
      playOut(sim);
      const calls = sim.state.calls;
      expect(calls).toBeLessThanOrEqual(MAX_CALLS);
      const card = sim.view(0).mine![0]!;
      const called = new Set(sim.state.order.slice(0, calls));
      // it stopped because nothing could win, and one call earlier something still could
      const done = (n: number) => {
        const c = new Set(sim.state.order.slice(0, n));
        const won: Partial<Record<Pattern, boolean>> = {};
        for (const p of PATTERNS) if (card.won[p] && card.won[p]!.call <= n) won[p] = true;
        return { c, won };
      };
      if (calls < MAX_CALLS) {
        const end = done(calls);
        expect(canStillWin(card.nums, end.c, calls, end.won)).toBe(false);
      }
      const prev = done(calls - 1);
      expect(canStillWin(card.nums, prev.c, calls - 1, prev.won)).toBe(true);
      expect(called.size).toBe(calls);
    }
  });

  it('never shows a ball before it is called: not in a view, not in an event', () => {
    const sim = multi([0, 1]);
    sim.act(0, { type: 'buy', count: 1, stake: 100 });
    sim.advance(BUY_MS);
    const order = [...sim.state.order];
    expect(order).toHaveLength(BALLS);
    let seen: Ev[] = [...(sim.lastEvents as Ev[])];
    for (let n = 0; n < 10; n++) {
      for (const viewer of [0, 1, null]) {
        const v = sim.view(viewer);
        expect(v.called).toEqual(order.slice(0, sim.state.calls));
        expect(JSON.stringify(v)).not.toContain('order');
      }
      const d = engine.deadline(sim.state)!;
      sim.advance(d - sim.now);
      seen = [...seen, ...(sim.lastEvents as Ev[])];
    }
    const balls = seen.filter((e) => e.type === 'ball').map((e) => e.ball);
    expect(balls).toEqual(order.slice(0, balls.length));
    for (const e of seen) expect(Object.keys(e)).not.toContain('order');
  });

  it('deals cards to their owner only; everyone else sees counts', () => {
    const sim = multi([0, 1]);
    sim.act(0, { type: 'buy', count: 2, stake: 100 });
    const [cards, bought] = sim.lastEvents as Ev[];
    expect(cards).toMatchObject({ type: 'cards', to: 0, seat: 0 });
    expect((cards!.cards as CardView[]).map((c) => c.nums.length)).toEqual([25, 25]);
    expect(bought).toEqual({ type: 'bought', seat: 0, cards: 2, staked: 200 });
    expect(sim.view(0).mine).toHaveLength(2);
    expect(sim.view(1).mine).toEqual([]);
    expect(sim.view(null).mine).toBeNull();
    expect(sim.view(1).players[0]).toMatchObject({ cards: 2, staked: 200, won: 0 });
  });

  it('refuses cards off the limits, past four, beyond the stack, and outside a sale', () => {
    const sim = multi([0, 1], 5_000);
    const refused = (seat: number, a: object) => sim.act(seat, a, { allowRefusal: true }).refused;
    expect(refused(0, { type: 'buy', count: 1, stake: 50 })).toBe('LIMIT');
    expect(refused(0, { type: 'buy', count: 1, stake: 150 })).toBe('LIMIT');
    expect(refused(0, { type: 'buy', count: 1, stake: 100_100 })).toBe('LIMIT');
    expect(refused(0, { type: 'buy', count: 2, stake: 3_000 })).toBe('NOT_ENOUGH_CHIPS');
    expect(refused(0, { type: 'buy', count: 3, stake: 100 })).toBeUndefined();
    expect(refused(0, { type: 'buy', count: 2, stake: 100 })).toBe('LIMIT');
    expect(refused(0, { type: 'buy', count: 1, stake: 100 })).toBeUndefined();
    expect(refused(0, { type: 'call' })).toBe('BAD_REQUEST');
    sim.advance(BUY_MS);
    expect(refused(1, { type: 'buy', count: 1, stake: 100 })).toBe('WRONG_PHASE');
    expect(refused(0, { type: 'return' })).toBe('WRONG_PHASE');
  });

  it('parses only well-formed actions', () => {
    expect(engine.parseAction({ type: 'buy', count: 2, stake: 500 })).toEqual({ type: 'buy', count: 2, stake: 500 });
    expect(engine.parseAction({ type: 'buy', count: 0, stake: 500 })).toBeNull();
    expect(engine.parseAction({ type: 'buy', count: MAX_CARDS + 1, stake: 500 })).toBeNull();
    expect(engine.parseAction({ type: 'buy', count: 1.5, stake: 500 })).toBeNull();
    expect(engine.parseAction({ type: 'buy', count: 1, stake: -100 })).toBeNull();
    expect(engine.parseAction({ type: 'buy', count: 1, stake: '100' })).toBeNull();
    expect(engine.parseAction({ type: 'max', count: 4 })).toEqual({ type: 'max', count: 4 });
    expect(engine.parseAction({ type: 'return' })).toEqual({ type: 'return' });
    expect(engine.parseAction({ type: 'rebuy' })).toEqual({ type: 'rebuy' });
    expect(engine.parseAction({ type: 'call' })).toEqual({ type: 'call' });
    expect(engine.parseAction({ type: 'daub', n: 4 })).toBeNull();
    expect(engine.parseAction(null)).toBeNull();
  });

  it('Max prices each card at the table maximum, or the stack shared between the cards', () => {
    const lim = { min: 100, max: 100_000, step: 100 };
    expect(maxStake(lim, 1_000_000_00, 4)).toEqual({ stake: 100_000 });
    expect(maxStake(lim, 250_000, 4)).toEqual({ stake: 62_500 });
    expect(maxStake(lim, 250_050, 3)).toEqual({ stake: 83_300 });
    expect(maxStake(lim, 399, 4)).toEqual({ none: 'NO_CHIPS' });
    const sim = multi([0], 250_000);
    sim.act(0, { type: 'max', count: 4 });
    expect(sim.view(0).mine!.map((c) => c.stake)).toEqual([62_500, 62_500, 62_500, 62_500]);
    expect(sim.stack(0)).toBe(0);
  });

  it('gives cards back when you return them or leave before eyes down, and keeps them in play after', () => {
    const sim = multi([0, 1], 10_000);
    sim.act(0, { type: 'buy', count: 2, stake: 1_000 });
    sim.act(0, { type: 'return' });
    expect(sim.stack(0)).toBe(10_000);
    expect(sim.lastEvents).toEqual([{ type: 'returned', seat: 0, refund: 2_000 }]);
    sim.act(0, { type: 'buy', count: 1, stake: 1_000 });
    expect(engine.liveBets(sim.state, 0)).toBe(1_000);
    sim.apply(engine.seatLeaving(sim.state, 0, sim.ctx()));
    expect(sim.stack(0)).toBe(10_000);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    sim.act(0, { type: 'buy', count: 1, stake: 1_000 });
    sim.act(1, { type: 'buy', count: 1, stake: 100 });
    sim.advance(BUY_MS);
    const step = engine.seatLeaving(sim.state, 0, sim.ctx());
    expect(step.state).toBe(sim.state);
    expect(step.chips).toBeUndefined();
    expect(engine.liveBets(sim.state, 0)).toBe(1_000);
    playOut(sim);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
  });

  it('buys last game\'s cards again with Rebuy, and a new player in the seat gets none', () => {
    const sim = multi([0, 1]);
    const refused = (seat: number, a: object) => sim.act(seat, a, { allowRefusal: true }).refused;
    expect(refused(0, { type: 'rebuy' })).toBe('BAD_REQUEST');
    sim.act(0, { type: 'buy', count: 3, stake: 700 });
    expect(refused(0, { type: 'rebuy' })).toBe('BAD_REQUEST');
    sim.advance(BUY_MS);
    playOut(sim);
    sim.advance(RESULTS_MS);
    expect(sim.state.phase).toBe('buying');
    expect(sim.view(0).canRebuy).toContain(0);
    sim.act(0, { type: 'rebuy' });
    expect(sim.view(0).mine!.map((c) => c.stake)).toEqual([700, 700, 700]);
    // someone else in seat 0 doesn't inherit it
    sim.seats.get(0)!.accountId = 4242;
    const joined = engine.seatJoined(sim.state, 0, sim.ctx());
    expect(joined.state.last[0]).toBeUndefined();
  });

  it('keeps the sale open when nobody buys, and rests when everyone has gone', () => {
    const sim = multi([0]);
    sim.advance(BUY_MS);
    expect(sim.state.phase).toBe('buying');
    expect(sim.lastEvents).toEqual([{ type: 'buying', round: 1, deadline: sim.now + BUY_MS }]);
    sim.seats.clear();
    sim.advance(BUY_MS);
    expect(sim.state.phase).toBe('idle');
    expect(engine.deadline(sim.state)).toBeNull();
    sim.seats.set(0, { seat: 0, accountId: 1, name: 'P0', stack: 1_000, connected: true, ready: false });
    sim.advance(1);
    expect(sim.state.phase).toBe('buying');
    expect(sim.state.round).toBe(2);
  });

  it('opens the next sale after the results, and pushes every deadline back after a restart', () => {
    const sim = multi([0]);
    sim.act(0, { type: 'buy', count: 1, stake: 100 });
    sim.advance(BUY_MS);
    playOut(sim);
    const d = engine.deadline(sim.state)!;
    expect(d).toBe(sim.now + RESULTS_MS);
    expect(engine.shiftDeadlines(sim.state, 5_000).deadline).toBe(d + 5_000);
    sim.advance(RESULTS_MS);
    expect(sim.state.phase).toBe('buying');
    expect(sim.state.round).toBe(2);
    expect(sim.view(0).mine).toEqual([]);
    expect(sim.view(0).history).toHaveLength(1);
    expect(sim.view(0).called).toEqual([]);
  });

  it('seats forty', () => {
    const seats = Array.from({ length: MAX_SEATS }, (_, i) => i);
    const sim = multi(seats, 100_000, seededRng(77));
    expect(engine.config('', 'multi').maxSeats).toBe(40);
    for (const seat of seats) sim.act(seat, { type: 'buy', count: 4, stake: 100 });
    sim.advance(BUY_MS);
    expect(sim.lastEvents).toMatchObject([{ type: 'eyesdown', cards: 160 }]);
    const events = playOut(sim);
    const total = seats.reduce((n, s) => n + sim.stack(s), 0);
    const paid = events.filter((e) => e.type === 'win').reduce((n, e) => n + (e.paid as number), 0);
    expect(total).toBe(40 * 100_000 - 160 * 100 + paid);
    expect(sim.rounds).toHaveLength(40);
  });

  it('never mutates the state it was given', () => {
    const sim = multi([0, 1]);
    const frozen = sim.state;
    const copy = structuredClone(frozen);
    sim.act(0, { type: 'buy', count: 2, stake: 100 });
    sim.advance(BUY_MS);
    sim.advance(LEAD_MS);
    expect(frozen).toEqual(copy);
  });
});

describe('bingo engine: alone', () => {
  it('waits for your first card, then runs the short clock, and Call starts at once', () => {
    const sim = solo();
    expect(sim.state.phase).toBe('buying');
    expect(sim.state.deadline).toBeNull();
    sim.advance(60_000);
    expect(sim.state.phase).toBe('buying');
    sim.act(0, { type: 'buy', count: 1, stake: 100 });
    expect(sim.state.deadline).toBe(sim.now + SOLO_BUY_MS);
    sim.act(0, { type: 'call' });
    expect(sim.state.phase).toBe('calling');
    sim.advance(LEAD_MS);
    expect(engine.deadline(sim.state)).toBe(sim.now + SOLO_CALL_MS);
    playOut(sim);
    expect(engine.deadline(sim.state)).toBe(sim.now + SOLO_RESULTS_MS);
    sim.advance(SOLO_RESULTS_MS);
    expect(sim.state.phase).toBe('buying');
    expect(sim.state.deadline).toBeNull();
  });

  it('refuses Call without a card', () => {
    const sim = solo();
    expect(sim.act(0, { type: 'call' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
  });

  it('refuses a player who has not bought in', () => {
    const sim = solo();
    const res = engine.act(sim.state, 0, { type: 'buy', count: 1, stake: 100 }, { ...sim.ctx(), seats: [] });
    expect(isRefusal(res) && res.refuse).toBe('NOT_SEATED');
  });
});

