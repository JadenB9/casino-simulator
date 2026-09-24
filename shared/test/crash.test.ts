import { describe, it, expect } from 'vitest';
import { CAP, RATE, MIN_AUTO, MAX_AUTO, timeTo, multAt, randBelow, splitOdds, drawCrash, formatMult } from '../src/games/crash/rules.ts';
import { engine, BETTING_MS, ALL_IN_MS, CRASHED_MS, HISTORY_LEN, type CrashAction, type CrashState, type CrashView } from '../src/games/crash/engine.ts';
import type { Rng } from '../src/rng.ts';
import { TableSim, type SimSeat } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';
import { forcedCrash, queuedRng } from './crash-forced.ts';

type Sim = TableSim<CrashState, CrashAction, CrashView>;

// ---------------------------------------------------------------------------------------------
// Exact fractions for walking the sampler's tree

type Frac = { n: bigint; d: bigint };
const gcd = (a: bigint, b: bigint): bigint => {
  while (b) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
};
const frac = (n: bigint, d: bigint): Frac => {
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
};
const mul = (a: Frac, b: Frac): Frac => frac(a.n * b.n, a.d * b.d);
const same = (a: Frac, b: Frac) => a.n * b.d === b.n * a.d;

/**
 * Every leaf of drawCrash's decision tree for a cap, with its exact probability: the first coin
 * (1 in 100 at 1.00×), then the bisection with splitOdds' exact coins.
 */
function leaves(cap: number): Map<number, Frac> {
  const out = new Map<number, Frac>();
  out.set(100, frac(1n, 100n));
  const stack: [number, number, Frac][] = [[100, cap, frac(99n, 100n)]];
  while (stack.length) {
    const [lo, hi, p] = stack.pop()!;
    if (hi - lo === 1) {
      out.set(hi, p);
      continue;
    }
    const mid = Math.floor((lo + hi) / 2);
    const [num, den] = splitOdds(lo, hi, mid, cap);
    stack.push([mid, hi, mul(p, frac(BigInt(num), BigInt(den)))]);
    stack.push([lo, mid, mul(p, frac(BigInt(den - num), BigInt(den)))]);
  }
  return out;
}

describe('crash curve', () => {
  it('is e^(0.00006 t): 2× at 11.55 s, 10× at 38.4 s, the cap at 153.5 s', () => {
    expect(RATE).toBe(0.00006);
    expect(timeTo(100)).toBe(0);
    expect(timeTo(101)).toBe(166);
    expect(timeTo(200)).toBe(11_553);
    expect(timeTo(1_000)).toBe(38_376);
    expect(timeTo(CAP)).toBe(153_506);
    expect(multAt(0)).toBe(100);
    expect(multAt(165)).toBe(100);
    expect(multAt(166)).toBe(101);
    expect(multAt(11_552)).toBe(199);
    expect(multAt(11_553)).toBe(200);
  });

  it('timeTo never goes backwards, over every hundredth to the cap', () => {
    let last = 0;
    for (let k = 101; k <= CAP; k++) {
      const t = timeTo(k);
      expect(t >= last).toBe(true);
      last = t;
    }
  });

  it('multAt(t) is the largest k with timeTo(k) ≤ t, for every millisecond of a long flight', () => {
    let prev = 100;
    for (let t = 0; t <= 160_000; t++) {
      const k = multAt(t);
      if (k < prev || timeTo(k) > t || (k < CAP && timeTo(k + 1) <= t)) throw new Error(`multAt(${t}) = ${k}`);
      prev = k;
    }
    expect(multAt(10_000_000)).toBe(CAP);
  });

  it('formats hundredths as a multiplier', () => {
    expect(formatMult(100)).toBe('1.00×');
    expect(formatMult(23_456)).toBe('234.56×');
    expect(formatMult(CAP)).toBe('10,000.00×');
  });
});

describe('crash point', () => {
  it('has exactly P(c > k) = 99/k below the cap: every leaf of the sampler, exact fractions (cap 10.00×)', () => {
    const cap = 1_000;
    const got = leaves(cap);
    expect(got.size).toBe(cap - 99);
    let total = frac(0n, 1n);
    for (const [k, p] of got) {
      const want = k === 100 ? frac(1n, 100n) : k < cap ? frac(99n, BigInt(k * (k - 1))) : frac(99n, BigInt(cap - 1));
      if (!same(p, want)) throw new Error(`P(c = ${k}) = ${p.n}/${p.d}, want ${want.n}/${want.d}`);
      total = frac(total.n * p.d + p.n * total.d, total.d * p.d);
    }
    expect(total).toEqual({ n: 1n, d: 1n });
    // so P(c > k) = 99/k exactly for every k below the cap
    let above = frac(0n, 1n);
    for (let k = cap; k > 100; k--) {
      above = frac(above.n * got.get(k)!.d + got.get(k)!.n * above.d, above.d * got.get(k)!.d);
      expect(same(above, frac(99n, BigInt(k - 1)))).toBe(true);
    }
  });

  it('is exact for a cap that is not a round number too (cap 12.34×)', () => {
    const cap = 1_234;
    for (const [k, p] of leaves(cap)) {
      const want = k === 100 ? frac(1n, 100n) : k < cap ? frac(99n, BigInt(k * (k - 1))) : frac(99n, BigInt(cap - 1));
      expect(same(p, want)).toBe(true);
    }
  });

  it('keeps every coin exact: integer odds below 2^53, numerator below denominator', () => {
    // the production cap's whole tree, walked without the fractions
    const stack: [number, number][] = [[100, CAP]];
    let nodes = 0;
    while (stack.length) {
      const [lo, hi] = stack.pop()!;
      if (hi - lo === 1) continue;
      const mid = Math.floor((lo + hi) / 2);
      const [num, den] = splitOdds(lo, hi, mid);
      if (!(Number.isSafeInteger(den) && num >= 1 && num < den)) throw new Error(`coin ${lo} ${mid} ${hi}: ${num}/${den}`);
      nodes++;
      stack.push([mid, hi], [lo, mid]);
    }
    expect(nodes).toBe(CAP - 101);
  });

  it('draws uniformly below 2^53, rejecting the top sliver', () => {
    const n = 2 ** 52 + 1;
    // 2^53 mod n = 2^52 - 1, so draws of 2^52 + 1 and above are thrown away
    const seq = [0xffffffff, 0xffffffff, 0, 7];
    const rng: Rng = { next32: () => seq.shift()! };
    expect(randBelow(rng, n)).toBe(7);
    expect(seq).toHaveLength(0);
    const r = seededRng(5);
    for (let i = 0; i < 1000; i++) {
      const x = randBelow(r, 999_999_999_999);
      expect(Number.isSafeInteger(x) && x >= 0 && x < 999_999_999_999).toBe(true);
    }
    expect(() => randBelow(r, 2 ** 60)).toThrow();
  });

  it('can be steered onto any point for tests', () => {
    for (const c of [100, 101, 150, 199, 200, 201, 1_000, 12_345, 999_999, CAP]) {
      expect(drawCrash(queuedRng(forcedCrash(c)))).toBe(c);
    }
  });

  it('stays within 100 to the cap', () => {
    const rng = seededRng(77);
    for (let i = 0; i < 20_000; i++) {
      const c = drawCrash(rng);
      expect(c >= 100 && c <= CAP && Number.isInteger(c)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The engine

const T0 = 1_000_000;

function table(seats: SimSeat[] = [{ seat: 0, stack: 100_000 }, { seat: 1, stack: 100_000 }], mode: 'solo' | 'multi' = 'multi'): { sim: Sim; rng: ReturnType<typeof queuedRng> } {
  const rng = queuedRng([], 9);
  const sim = new TableSim(engine, rng, mode, seats);
  sim.now = T0;
  return { sim, rng };
}

/** Open the first window the way the host does when the first seat's chips land. */
function open(sim: Sim): void {
  sim.apply(engine.seatJoined(sim.state, 0, sim.ctx()));
}

/** Close the window and launch onto crash point `c`. */
function launch(sim: Sim, rng: ReturnType<typeof queuedRng>, c: number): number {
  rng.queue.push(...forcedCrash(c));
  sim.advance(sim.state.deadline! - sim.now);
  expect(sim.state.crash === c || c === 100).toBe(true);
  return sim.state.launchAt!;
}

const types = (sim: Sim) => (sim.lastEvents as { type: string }[]).map((e) => e.type);

describe('crash engine: the round loop', () => {
  it('opens a window with the first seat, whatever the Start flag says, and idles when nobody sits', () => {
    const { sim } = table();
    expect(sim.state.phase).toBe('idle');
    expect(sim.started).toBe(false);
    // the host ticks after every commit: an idle table with seats opens a window by itself
    sim.advance(0);
    expect(sim.state.phase).toBe('betting');
    expect(sim.state.deadline).toBe(T0 + BETTING_MS);
    expect(types(sim)).toEqual(['betting']);

    const { sim: empty } = table([]);
    expect(engine.tick(empty.state, empty.ctx())).toBeNull();
  });

  it('runs a whole round: bets, launch, auto and manual cash-outs, the crash, the next window', () => {
    const { sim, rng } = table();
    open(sim);
    sim.act(0, { type: 'bet', amount: 1_000, auto: 150 });
    sim.act(1, { type: 'bet', amount: 2_000, auto: null });
    expect(sim.stack(0)).toBe(99_000);
    expect(sim.stack(1)).toBe(98_000);
    // everyone here has a bet in: the window closes a second from now
    expect(sim.state.deadline).toBe(T0 + ALL_IN_MS);
    expect(types(sim)).toEqual(['bet', 'closing']);

    const launchAt = launch(sim, rng, 300);
    expect(sim.state.phase).toBe('running');
    // nothing about the crash point is visible in flight
    const v = sim.view(1);
    expect(v.crash).toBeNull();
    expect(v.deadline).toBeNull();
    expect(JSON.stringify(v)).not.toContain('300');
    expect(JSON.stringify(sim.lastEvents)).not.toMatch(/crash|300/);
    // own auto target visible to its owner only
    expect(sim.view(0).bets.find((b) => b.seat === 0)!.auto).toBe(150);
    expect(sim.view(1).bets.find((b) => b.seat === 0)!.auto).toBeNull();
    // the engine wants to run next at seat 0's target
    expect(engine.deadline(sim.state)).toBe(launchAt + timeTo(150));

    sim.advance(launchAt + timeTo(150) - sim.now);
    expect(sim.lastEvents).toEqual([{ type: 'cashout', seat: 0, name: 'P0', at: 150, amount: 1_000, payout: 1_500, how: 'auto' }]);
    expect(sim.stack(0)).toBe(100_500);
    expect(engine.deadline(sim.state)).toBe(launchAt + timeTo(300));

    // seat 1 clicks at 2.5 s past 2×: paid at the multiplier on the server's clock
    sim.now = launchAt + timeTo(200) + 2_500;
    const at = multAt(sim.now - launchAt);
    sim.act(1, { type: 'cashout' });
    expect(sim.lastEvents).toEqual([{ type: 'cashout', seat: 1, name: 'P1', at, amount: 2_000, payout: 20 * at, how: 'manual' }]);
    expect(at).toBeGreaterThan(200);
    expect(at).toBeLessThan(300);
    expect(sim.stack(1)).toBe(98_000 + 20 * at);
    // a second click has nothing left to cash
    expect(sim.act(1, { type: 'cashout' }, { allowRefusal: true }).refused).toBe('BAD_REQUEST');

    sim.advance(launchAt + timeTo(300) - sim.now);
    expect(sim.state.phase).toBe('crashed');
    expect(sim.lastEvents).toEqual([{ type: 'crash', round: 1, crash: 300, launchAt, busted: [], deadline: sim.now + CRASHED_MS }]);
    expect(sim.view(null)).toMatchObject({ crash: 300, launchAt, history: [300] });
    expect(sim.rounds).toEqual([
      { seat: 0, wagered: 1_000, returned: 1_500 },
      { seat: 1, wagered: 2_000, returned: 20 * at },
    ]);

    sim.advance(CRASHED_MS);
    expect(sim.state.phase).toBe('betting');
    expect(sim.state.round).toBe(2);
    expect(sim.state.bets).toEqual([]);
  });

  it('busts whatever still rides at the crash, auto targets at or above it included', () => {
    const { sim, rng } = table();
    open(sim);
    sim.act(0, { type: 'bet', amount: 1_000, auto: 250 });
    sim.act(1, { type: 'bet', amount: 1_000, auto: 249 });
    const launchAt = launch(sim, rng, 250);
    // only seat 1's target is below the crash: the engine never schedules seat 0's
    expect(engine.deadline(sim.state)).toBe(launchAt + timeTo(249));
    sim.advance(launchAt + timeTo(250) - sim.now);
    expect(types(sim)).toEqual(['cashout', 'crash']);
    expect(sim.stack(0)).toBe(99_000);
    expect(sim.stack(1)).toBe(99_000 + 2_490);
    expect(sim.view(0).bets.map((b) => [b.seat, b.cashed, b.busted])).toEqual([
      [0, null, true],
      [1, 249, false],
    ]);
    expect(sim.rounds.at(-1)).toEqual({ seat: 0, wagered: 1_000, returned: 0 });
  });

  it('crashes at 1.00× the moment it launches, one round in a hundred', () => {
    const { sim, rng } = table();
    open(sim);
    sim.act(0, { type: 'bet', amount: 1_000, auto: 101 });
    launch(sim, rng, 100);
    expect(types(sim)).toEqual(['launch', 'crash']);
    expect(sim.state).toMatchObject({ phase: 'crashed', crash: 100 });
    expect(sim.stack(0)).toBe(99_000);
  });

  it('a click that arrives after the crash moment, before its tick, busts', () => {
    const { sim, rng } = table();
    open(sim);
    sim.act(0, { type: 'bet', amount: 1_000, auto: null });
    sim.act(1, { type: 'bet', amount: 1_000, auto: 180 });
    const launchAt = launch(sim, rng, 180);
    sim.now = launchAt + timeTo(180) + 40;
    sim.act(0, { type: 'cashout' });
    // the crash comes first; the click finds nothing riding
    expect(types(sim)).toEqual(['crash']);
    expect(sim.stack(0)).toBe(99_000);
    // an auto target equal to the crash point is not reached either
    expect(sim.stack(1)).toBe(99_000);
  });

  it('a click in the same millisecond as a due auto target settles the auto target first', () => {
    const { sim, rng } = table();
    open(sim);
    sim.act(0, { type: 'bet', amount: 1_000, auto: 120 });
    sim.act(1, { type: 'bet', amount: 1_000, auto: null });
    const launchAt = launch(sim, rng, 500);
    // seat 0's alarm is late; its own click comes in past its target
    sim.now = launchAt + timeTo(130);
    sim.act(0, { type: 'cashout' }, { allowRefusal: true });
    expect(sim.lastEvents).toEqual([{ type: 'cashout', seat: 0, name: 'P0', at: 120, amount: 1_000, payout: 1_200, how: 'auto' }]);
    expect(sim.stack(0)).toBe(100_200);
  });

  it('pays a manual cash-out at 1.00× before the first tick of the curve', () => {
    const { sim, rng } = table();
    open(sim);
    sim.act(0, { type: 'bet', amount: 1_000, auto: null });
    sim.act(1, { type: 'bet', amount: 1_000, auto: null });
    const launchAt = launch(sim, rng, 400);
    sim.now = launchAt + 100;
    sim.act(0, { type: 'cashout' });
    expect(sim.stack(0)).toBe(100_000);
    expect(sim.rounds.at(-1)).toEqual({ seat: 0, wagered: 1_000, returned: 1_000 });
  });

  it('runs rounds with nobody betting, and goes idle once the table is empty', () => {
    const { sim, rng } = table([{ seat: 0, stack: 10_000 }]);
    open(sim);
    launch(sim, rng, 150);
    expect(sim.state.phase).toBe('running');
    sim.advance(timeTo(150));
    expect(sim.state.phase).toBe('crashed');
    sim.seats.delete(0);
    sim.advance(CRASHED_MS);
    expect(sim.state.phase).toBe('idle');
    expect(engine.deadline(sim.state)).toBeNull();
    expect(types(sim)).toEqual(['idle']);
  });

  it('keeps the history of crash points, newest first, 24 long', () => {
    const { sim, rng } = table([{ seat: 0, stack: 10_000 }]);
    open(sim);
    for (let i = 0; i < 30; i++) {
      launch(sim, rng, 101 + i);
      sim.advance(timeTo(101 + i) + CRASHED_MS);
    }
    expect(sim.state.history).toHaveLength(HISTORY_LEN);
    expect(sim.state.history[0]).toBe(130);
    expect(sim.view(null).history.at(-1)).toBe(107);
  });

  it('closes early only for the players who are connected', () => {
    const { sim } = table([
      { seat: 0, stack: 10_000 },
      { seat: 1, stack: 10_000, connected: false },
    ]);
    open(sim);
    sim.act(0, { type: 'bet', amount: 100, auto: null });
    expect(sim.state.deadline).toBe(T0 + ALL_IN_MS);
  });
});

describe('crash engine: bets and refusals', () => {
  it('cancels a bet during the window, and only then', () => {
    const { sim, rng } = table();
    open(sim);
    sim.act(0, { type: 'bet', amount: 1_000, auto: null });
    sim.act(0, { type: 'cancel' });
    expect(sim.stack(0)).toBe(100_000);
    expect(sim.state.bets).toEqual([]);
    sim.act(0, { type: 'bet', amount: 500, auto: 200 });
    sim.act(1, { type: 'bet', amount: 500, auto: null });
    launch(sim, rng, 900);
    expect(sim.act(0, { type: 'cancel' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
  });

  it('refuses bets outside the window, twice in a round, off the limits, beyond the stack, or with a bad target', () => {
    const { sim, rng } = table([{ seat: 0, stack: 5_000 }, { seat: 1, stack: 5_000 }]);
    const refused = (seat: number, a: unknown) => sim.act(seat, a, { allowRefusal: true }).refused;
    expect(refused(0, { type: 'bet', amount: 100, auto: null })).toBe('WRONG_PHASE');
    open(sim);
    expect(refused(0, { type: 'bet', amount: 50, auto: null })).toBe('LIMIT');
    expect(refused(0, { type: 'bet', amount: 150, auto: null })).toBe('LIMIT');
    expect(refused(0, { type: 'bet', amount: 6_000, auto: null })).toBe('NOT_ENOUGH_CHIPS');
    expect(refused(0, { type: 'bet', amount: 100, auto: 100 })).toBe('LIMIT');
    expect(refused(0, { type: 'bet', amount: 100, auto: MAX_AUTO + 1 })).toBe('LIMIT');
    expect(refused(0, { type: 'cashout' })).toBe('WRONG_PHASE');
    sim.act(0, { type: 'bet', amount: 100, auto: MIN_AUTO });
    expect(refused(0, { type: 'bet', amount: 100, auto: null })).toBe('WRONG_PHASE');
    expect(engine.parseAction({ type: 'bet', amount: 100, auto: 1.5 })).toBeNull();
    expect(engine.parseAction({ type: 'bet', amount: 100 })).toEqual({ type: 'bet', amount: 100, auto: null });
    launch(sim, rng, 700);
    expect(refused(1, { type: 'bet', amount: 100, auto: null })).toBe('WRONG_PHASE');
    expect(refused(1, { type: 'cashout' })).toBe('BAD_REQUEST');
  });
});

describe('crash engine: leaving, restarts and money', () => {
  it('standing up in the window hands the bet back; in the air it cashes out on the clock, once', () => {
    const { sim, rng } = table();
    open(sim);
    sim.act(0, { type: 'bet', amount: 1_000, auto: null });
    let step = engine.seatLeaving(sim.state, 0, sim.ctx());
    sim.apply(step);
    expect(step.chips).toEqual([{ seat: 0, payout: 1_000 }]);
    expect(sim.stack(0)).toBe(100_000);

    sim.act(0, { type: 'bet', amount: 1_000, auto: null });
    sim.act(1, { type: 'bet', amount: 1_000, auto: null });
    const launchAt = launch(sim, rng, 600);
    sim.now = launchAt + timeTo(250) + 10;
    expect(engine.liveBets(sim.state, 0)).toBe(1_000);
    step = engine.seatLeaving(sim.state, 0, sim.ctx());
    sim.apply(step);
    const at = multAt(sim.now - launchAt);
    expect(step.events).toEqual([{ type: 'cashout', seat: 0, name: 'P0', at, amount: 1_000, payout: 10 * at, how: 'left' }]);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    // leaving again, or the crash, pays nothing more
    expect(engine.seatLeaving(sim.state, 0, sim.ctx()).events).toEqual([]);
    const before = sim.stack(0);
    sim.advance(launchAt + timeTo(600) - sim.now);
    expect(sim.stack(0)).toBe(before);
    expect(sim.rounds.filter((r) => r.seat === 0)).toEqual([{ seat: 0, wagered: 1_000, returned: 10 * at }]);
  });

  it('a seat that leaves after the crash moment, before its tick, is settled by the crash', () => {
    const { sim, rng } = table();
    open(sim);
    sim.act(0, { type: 'bet', amount: 1_000, auto: null });
    sim.act(1, { type: 'bet', amount: 1_000, auto: null });
    const launchAt = launch(sim, rng, 250);
    sim.now = launchAt + timeTo(250) + 5;
    const step = engine.seatLeaving(sim.state, 0, sim.ctx());
    expect((step.events as { type: string }[]).map((e) => e.type)).toEqual(['crash']);
    expect(step.chips ?? []).toEqual([]);
  });

  it('pushes a window back after a restart, but never rewinds a flight', () => {
    const { sim, rng } = table();
    open(sim);
    const d = sim.state.deadline!;
    expect(engine.shiftDeadlines(sim.state, 20_000).deadline).toBe(d + 20_000);
    sim.act(0, { type: 'bet', amount: 1_000, auto: null });
    sim.act(1, { type: 'bet', amount: 1_000, auto: null });
    launch(sim, rng, 800);
    expect(engine.shiftDeadlines(sim.state, 20_000)).toBe(sim.state);
  });

  it('never makes or loses a cent: 3,000 rounds of random bets, targets, clicks and departures', () => {
    const seats: SimSeat[] = [0, 1, 2, 3].map((seat) => ({ seat, stack: 1_000_000 }));
    const { sim } = table(seats);
    const r = seededRng(2024);
    const pick = (n: number) => r.next32() % n;
    let staked = 0;
    let paid = 0;
    open(sim);
    for (let round = 0; round < 3_000; round++) {
      const before = [0, 1, 2, 3].reduce((n, s) => n + sim.stack(s), 0);
      for (const seat of [0, 1, 2, 3]) {
        if (pick(3) === 0) continue;
        const auto = pick(2) ? null : 101 + pick(400);
        sim.act(seat, { type: 'bet', amount: 100 * (1 + pick(20)), auto });
      }
      if (pick(10) === 0 && sim.state.bets.length) sim.apply(engine.seatLeaving(sim.state, sim.state.bets[0]!.seat, sim.ctx()));
      sim.advance(sim.state.deadline! - sim.now);
      // some clicks at random moments of the flight
      while (sim.state.phase === 'running') {
        sim.now += 50 + pick(3_000);
        const riding = sim.state.bets.filter((b) => b.cashed === null);
        if (riding.length && pick(2)) sim.act(riding[pick(riding.length)]!.seat, { type: 'cashout' }, { allowRefusal: true });
        else sim.advance(0);
      }
      for (const b of sim.state.bets) {
        staked += b.amount;
        paid += b.payout;
        expect(b.payout === 0 || b.payout === (b.amount / 100) * b.cashed!).toBe(true);
        if (b.cashed !== null) expect(b.cashed).toBeLessThan(sim.state.crash!);
      }
      for (const s of [0, 1, 2, 3]) expect(engine.liveBets(sim.state, s)).toBe(0);
      const after = [0, 1, 2, 3].reduce((n, s) => n + sim.stack(s), 0);
      const roundBets = sim.state.bets.reduce((n, b) => n + b.amount - b.payout, 0);
      expect(before - after).toBe(roundBets);
      sim.advance(CRASHED_MS);
    }
    const wagered = sim.rounds.reduce((n, x) => n + x.wagered, 0);
    const returned = sim.rounds.reduce((n, x) => n + x.returned, 0);
    expect(wagered).toBe(staked);
    expect(returned).toBe(paid);
  });
});
