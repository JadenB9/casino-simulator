import { describe, it, expect } from 'vitest';
import { WHEEL, SLOTS, NUMBERS, SPOTS, type WheelNumber, spotOf, isNumber, isSlot, drawSlot, numberAt, returnFor, edgeOf, edgePercent, paysLabel, callFor } from '../src/games/banditwheel/rules.ts';
import { engine, maxFor, windowFor, BETTING_MS, SOLO_BETTING_MS, SPIN_MS, SETTLE_MS, HISTORY_LEN, type BanditState } from '../src/games/banditwheel/engine.ts';
import { parseAction, type BanditAction, type BanditView } from '../src/games/banditwheel/protocol.ts';
import { isRefusal } from '../src/engine.ts';
import type { Rng } from '../src/rng.ts';
import { TableSim, type SimSeat } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';

type Sim = TableSim<BanditState, BanditAction, BanditView>;

const slots = Array.from({ length: SLOTS }, (_, i) => i);

/** An Rng whose every draw lands on `slot` (randInt keeps x % n below its rejection limit). */
function forced(slot: number): Rng {
  return { next32: () => slot };
}

/** A generator whose next results can be queued, falling back to a seeded stream; counts draws. */
function steerable(seed = 7) {
  const base = seededRng(seed);
  const queue: number[] = [];
  let draws = 0;
  const rng: Rng = {
    next32: () => {
      draws++;
      return queue.length ? queue.shift()! : base.next32();
    },
  };
  return { rng, next: (slot: number) => queue.push(slot), draws: () => draws };
}

/** The first slot carrying `key`. */
const slotOf = (key: WheelNumber) => WHEEL.indexOf(key);

function solo(stack = 1_000_000, rng: Rng = seededRng(3)): Sim {
  return new TableSim(engine, rng, 'solo', [{ seat: 0, stack }]);
}

function multi(seats: number[] = [0, 1], rng: Rng = seededRng(5), stack = 1_000_000): Sim {
  const list: SimSeat[] = seats.map((seat) => ({ seat, stack }));
  return new TableSim(engine, rng, 'multi', list);
}

const bet = (spot: number, amount: number) => ({ type: 'bet', bets: [{ spot, amount }] });

/** Run the clock to the next deadline (one step of the loop, on time). */
function step(sim: Sim): void {
  sim.advance(engine.deadline(sim.state)! - sim.now);
}

/** One whole round: the window closes, the wheel spins and pays, the next window opens. */
function round(sim: Sim): void {
  step(sim);
  step(sim);
}

// ---------------------------------------------------------------------------------------------
// The wheel

describe('bandit wheel: the wheel', () => {
  it('has 25 slots: twelve 1s, six 3s, four 5s, two 10s and one 20', () => {
    expect(WHEEL).toHaveLength(25);
    expect(SLOTS).toBe(25);
    const count = (k: WheelNumber) => WHEEL.filter((x) => x === k).length;
    expect(NUMBERS.map(count)).toEqual([12, 6, 4, 2, 1]);
    for (const spot of SPOTS) expect(count(spot.key)).toBe(spot.slots);
  });

  it('is the order copied off the Rust wheel, clockwise from the 20 (docs §9.2)', () => {
    // AdamNizol/rustwheel (colours) and tylerkanz/rust-wheel-oracle (numbers) agree slot for slot
    const byColour = [
      'red', 'yellow', 'green', 'yellow', 'blue', 'yellow', 'green', 'yellow', 'purple', 'yellow', 'green', 'yellow', 'blue',
      'yellow', 'blue', 'green', 'yellow', 'purple', 'yellow', 'green', 'yellow', 'blue', 'yellow', 'green', 'yellow',
    ];
    const byNumber = [20, 1, 3, 1, 5, 1, 3, 1, 10, 1, 3, 1, 5, 1, 5, 3, 1, 10, 1, 3, 1, 5, 1, 3, 1];
    expect([...WHEEL]).toEqual(byNumber);
    expect(WHEEL.map((n) => spotOf(n)!.colour)).toEqual(byColour);
  });

  it('never puts two 1s side by side, and sets the 20 between two 1s', () => {
    for (const i of slots) expect(WHEEL[i] === 1 && WHEEL[(i + 1) % SLOTS] === 1).toBe(false);
    const t = slotOf(20);
    expect(WHEEL[(t + SLOTS - 1) % SLOTS]).toBe(1);
    expect(WHEEL[(t + 1) % SLOTS]).toBe(1);
  });

  it('reads the number at any slot, wrapping round', () => {
    expect(numberAt(0)).toBe(20);
    expect(numberAt(8)).toBe(10);
    expect(numberAt(25)).toBe(20);
    expect(numberAt(-1)).toBe(1);
    expect(numberAt(-17)).toBe(10);
  });

  it('draws slots from randInt over the whole wheel', () => {
    for (const i of slots) expect(drawSlot(forced(i))).toBe(i);
    // a draw at or above the rejection limit is thrown away
    const limit = 2 ** 32 - (2 ** 32 % 25);
    let calls = 0;
    const rng: Rng = { next32: () => (calls++ === 0 ? limit : 13) };
    expect(drawSlot(rng)).toBe(13);
    expect(calls).toBe(2);
    // the largest value kept maps to the last slot
    expect(drawSlot(forced(limit - 1))).toBe(24);
  });

  it('knows its numbers and slots', () => {
    for (const n of NUMBERS) expect(isNumber(n)).toBe(true);
    for (const x of [0, 2, 4, 15, 25, '1', null, 1.5]) expect(isNumber(x)).toBe(false);
    expect(isSlot(0)).toBe(true);
    expect(isSlot(24)).toBe(true);
    expect(isSlot(25)).toBe(false);
    expect(isSlot(-1)).toBe(false);
    expect(isSlot(3.5)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// The paytable

describe('bandit wheel: paytable', () => {
  it('pays the number to 1, in Rust colours', () => {
    expect(SPOTS.map((s) => [s.key, s.pays, s.slots, s.colour])).toEqual([
      [1, 1, 12, 'yellow'],
      [3, 3, 6, 'green'],
      [5, 5, 4, 'blue'],
      [10, 10, 2, 'purple'],
      [20, 20, 1, 'red'],
    ]);
    expect(SPOTS.map(paysLabel)).toEqual(['1 to 1', '3 to 1', '5 to 1', '10 to 1', '20 to 1']);
    expect(NUMBERS.map(callFor)).toEqual(['One', 'Three', 'Five', 'Ten', 'Twenty']);
  });

  it('pays every number correctly on every slot (exhaustive)', () => {
    for (const spot of SPOTS) {
      for (const i of slots) {
        const back = returnFor(spot.key, i, 700);
        expect(back).toBe(WHEEL[i] === spot.key ? 700 * (spot.pays + 1) : 0);
      }
    }
  });

  it('has the exact edges 4%, 4%, 4%, 12% and 16%, by enumerating the 25 slots', () => {
    const want: Record<WheelNumber, [number, number]> = { 1: [1, 25], 3: [1, 25], 5: [1, 25], 10: [3, 25], 20: [4, 25] };
    for (const spot of SPOTS) {
      // whole cents over the whole wheel: the expected return of a $1 bet times 25
      const returned = slots.reduce((sum, i) => sum + returnFor(spot.key, i, 100), 0);
      const lost = 25 * 100 - returned;
      const [num, den] = want[spot.key];
      expect(lost * den).toBe(num * 25 * 100);
      expect(edgeOf(spot)).toEqual({ num, den });
    }
    expect(SPOTS.map(edgePercent)).toEqual([4, 4, 4, 12, 16]);
    // the return to player: 96%, 96%, 96%, 88%, 84%
    expect(SPOTS.map((s) => 100 - edgePercent(s))).toEqual([96, 96, 96, 88, 84]);
  });

  it('pays whole dollars on whole-dollar bets, so nothing is ever rounded', () => {
    for (const spot of SPOTS) for (const d of [1, 7, 999, 1000]) expect(Number.isInteger(returnFor(spot.key, slotOf(spot.key), d * 100) / 100)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Parsing

describe('bandit wheel: parseAction', () => {
  it('accepts the actions in their shapes', () => {
    expect(parseAction({ type: 'bet', bets: [{ spot: 20, amount: 500 }] })).toEqual({ type: 'bet', bets: [{ spot: 20, amount: 500 }] });
    expect(parseAction({ type: 'max', spot: 3 })).toEqual({ type: 'max', spot: 3 });
    expect(parseAction({ type: 'undo' })).toEqual({ type: 'undo' });
    expect(parseAction({ type: 'clear' })).toEqual({ type: 'clear' });
    expect(parseAction({ type: 'spin' })).toEqual({ type: 'spin' });
    expect(parseAction({ type: 'rebet' })).toEqual({ type: 'rebet', double: false });
    expect(parseAction({ type: 'rebet', double: true })).toEqual({ type: 'rebet', double: true });
  });

  it('refuses anything else', () => {
    for (const raw of [
      null,
      [],
      'bet',
      { type: 'bet' },
      { type: 'bet', bets: [] },
      { type: 'bet', bets: [{ spot: 2, amount: 100 }] },
      { type: 'bet', bets: [{ spot: '20', amount: 100 }] },
      { type: 'bet', bets: [{ spot: 20, amount: 0 }] },
      { type: 'bet', bets: [{ spot: 20, amount: -100 }] },
      { type: 'bet', bets: [{ spot: 20, amount: 1.5 }] },
      { type: 'bet', bets: Array.from({ length: 11 }, () => ({ spot: 1, amount: 100 })) },
      { type: 'max' },
      { type: 'max', spot: 7 },
      { type: 'rebet', double: 'yes' },
      { type: 'ready', on: true },
      { type: 'deal' },
    ]) {
      expect(parseAction(raw)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The engine

describe('bandit wheel: the loop', () => {
  it('sets up a table: ten seats (one alone), $1 to $1,000 a number, whole dollars', () => {
    const m = engine.config('', 'multi');
    expect(m.maxSeats).toBe(10);
    expect(engine.config('', 'solo').maxSeats).toBe(1);
    expect(m.limits.default).toEqual({ min: 100, max: 100_000, step: 100 });
    expect(windowFor('multi')).toBe(BETTING_MS);
    expect(windowFor('solo')).toBe(SOLO_BETTING_MS);
    expect(SOLO_BETTING_MS).toBeLessThan(BETTING_MS);
  });

  it('rests with nobody seated and opens a window when someone sits', () => {
    const sim = multi([]);
    expect(sim.view(null).phase).toBe('idle');
    expect(engine.deadline(sim.state)).toBeNull();
    sim.advance(60_000);
    expect(sim.view(null).phase).toBe('idle');
    sim.seats.set(0, { seat: 0, accountId: 1000, name: 'P0', stack: 10_000, connected: true, ready: false });
    sim.apply(engine.seatJoined(sim.state, 0, sim.ctx()));
    sim.advance(0);
    const v = sim.view(0);
    expect(v.phase).toBe('betting');
    expect(v.round).toBe(1);
    expect(v.deadline).toBe(sim.now + BETTING_MS);
    expect(v.window).toBe(BETTING_MS);
  });

  it('runs itself at a shared wheel: window, spin, results, next window, with no Start and no Spin', () => {
    const { rng, next } = steerable();
    const sim = multi([0, 1], rng);
    // nobody pressed Start: the wheel doesn't wait for a leader
    sim.started = false;
    const v0 = sim.view(0);
    expect(v0.phase).toBe('betting');
    const open = sim.now;
    expect(v0.deadline).toBe(open + BETTING_MS);
    sim.act(0, bet(3, 1_000));
    next(slotOf(3));
    sim.advance(BETTING_MS - 1);
    expect(sim.view(0).phase).toBe('betting');
    sim.advance(1);
    const v1 = sim.view(0);
    expect(v1.phase).toBe('results');
    expect(v1.spin).toMatchObject({ round: 1, slot: slotOf(3), number: 3, startAt: open + BETTING_MS, restAt: open + BETTING_MS + SPIN_MS });
    expect(v1.deadline).toBe(open + BETTING_MS + SPIN_MS + SETTLE_MS);
    expect(v1.settled[0]).toEqual({ wagered: 1_000, returned: 4_000, bets: [[3, 1_000, 4_000]] });
    sim.advance(SPIN_MS + SETTLE_MS);
    const v2 = sim.view(0);
    expect(v2.phase).toBe('betting');
    expect(v2.round).toBe(2);
    expect(v2.settled).toEqual({});
    expect(v2.spin?.round).toBe(1);
  });

  it('spins when the clock runs out even if nobody has bet (the history is the wheel’s)', () => {
    const sim = multi([0, 1]);
    for (let i = 0; i < 5; i++) round(sim);
    const v = sim.view(null);
    expect(v.history).toHaveLength(5);
    expect(v.round).toBe(6);
    expect(sim.rounds).toHaveLength(0);
  });

  it('keeps the history to the latest spins, newest first', () => {
    const { rng, next } = steerable();
    const sim = solo(1_000_000, rng);
    for (let i = 0; i < HISTORY_LEN + 6; i++) {
      next(i % SLOTS);
      sim.act(0, bet(1, 100));
      sim.act(0, { type: 'spin' });
      sim.advance(SPIN_MS + SETTLE_MS);
    }
    const h = sim.view(0).history;
    expect(h).toHaveLength(HISTORY_LEN);
    expect(h[0]).toBe((HISTORY_LEN + 5) % SLOTS);
    expect(h[1]).toBe((HISTORY_LEN + 4) % SLOTS);
  });

  it('runs the same loop alone with a shorter window, and Spin now once a bet is down', () => {
    const { rng, next } = steerable();
    const sim = solo(100_000, rng);
    const v = sim.view(0);
    expect(v.phase).toBe('betting');
    expect(v.window).toBe(SOLO_BETTING_MS);
    expect(v.deadline).toBe(sim.now + SOLO_BETTING_MS);
    expect(sim.act(0, { type: 'spin' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    sim.act(0, bet(20, 500));
    next(slotOf(20));
    sim.advance(1_000);
    sim.act(0, { type: 'spin' });
    const r = sim.view(0);
    expect(r.phase).toBe('results');
    expect(r.spin).toMatchObject({ number: 20, startAt: sim.now, restAt: sim.now + SPIN_MS });
    expect(sim.stack(0)).toBe(100_000 - 500 + 500 * 21);
    // and alone the clock spins the wheel too
    sim.advance(SPIN_MS + SETTLE_MS);
    expect(sim.view(0).phase).toBe('betting');
    sim.advance(SOLO_BETTING_MS);
    expect(sim.view(0).phase).toBe('results');
  });

  it('never lets a shared wheel be spun by a player', () => {
    const sim = multi([0, 1]);
    sim.act(0, bet(1, 100));
    const res = engine.act(sim.state, 0, { type: 'spin' }, sim.ctx());
    expect(isRefusal(res) && res.refuse).toBe('BAD_REQUEST');
  });

  it('takes no bets while the wheel turns and pays', () => {
    const sim = multi([0, 1]);
    sim.act(0, bet(1, 100));
    sim.advance(BETTING_MS);
    expect(sim.view(0).phase).toBe('results');
    for (const a of [bet(1, 100), { type: 'max', spot: 5 }, { type: 'rebet' }, { type: 'undo' }, { type: 'clear' }]) {
      expect(sim.act(0, a, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    }
  });

  it('spins at the moment a late tick runs, so a wheel woken late still turns in full', () => {
    const sim = multi([0]);
    sim.act(0, bet(1, 100));
    const due = engine.deadline(sim.state)!;
    sim.now = due + 90_000; // the alarm came a minute and a half late
    sim.apply(engine.tick(sim.state, sim.ctx())!);
    const s = sim.view(0).spin!;
    expect(s.startAt).toBe(sim.now);
    expect(s.restAt - s.startAt).toBe(SPIN_MS);
  });

  it('goes idle when the last player leaves, and not before', () => {
    const sim = multi([0, 1]);
    sim.seats.delete(1);
    round(sim);
    expect(sim.view(null).phase).toBe('betting');
    sim.seats.delete(0);
    step(sim);
    expect(sim.view(null).phase).toBe('idle');
    expect(engine.deadline(sim.state)).toBeNull();
    expect(sim.lastEvents).toEqual([{ type: 'idle' }]);
  });

  it('keeps turning while its players are disconnected (their bets still settle)', () => {
    const { rng, next } = steerable();
    const sim = multi([0, 1], rng);
    sim.act(1, bet(5, 2_000));
    sim.seats.get(1)!.connected = false;
    sim.seats.get(0)!.connected = false;
    next(slotOf(5));
    sim.advance(BETTING_MS);
    expect(sim.view(1).settled[1]).toEqual({ wagered: 2_000, returned: 12_000, bets: [[5, 2_000, 12_000]] });
    expect(sim.stack(1)).toBe(1_000_000 - 2_000 + 12_000);
  });

  it('draws nothing until betting closes: no result exists before the spin', () => {
    const { rng, draws } = steerable();
    const sim = multi([0, 1], rng);
    sim.act(0, bet(1, 100));
    sim.act(1, bet(20, 100));
    sim.advance(BETTING_MS - 1);
    expect(draws()).toBe(0);
    const v = sim.view(1);
    expect(v.spin).toBeNull();
    expect(JSON.stringify(v)).not.toContain('slot');
    sim.advance(1);
    expect(draws()).toBe(1);
    expect(sim.view(1).spin).not.toBeNull();
  });

  it('shifts only a pending deadline after a restart', () => {
    const sim = multi([0]);
    const before = engine.deadline(sim.state)!;
    const shifted = engine.shiftDeadlines(sim.state, 20_000);
    expect(engine.deadline(shifted)).toBe(before + 20_000);
    // the spin already decided keeps its times
    sim.advance(BETTING_MS);
    const spin = sim.view(0).spin!;
    const after = engine.shiftDeadlines(sim.state, 20_000);
    expect(after.spin).toEqual(spin);
    expect(engine.deadline(after)).toBe(spin.restAt + SETTLE_MS + 20_000);
    // nothing pending, nothing to move
    const idle = multi([]);
    expect(engine.shiftDeadlines(idle.state, 20_000)).toBe(idle.state);
  });
});

describe('bandit wheel: bets', () => {
  it('pays each number its own multiple plus the stake, and takes the rest', () => {
    for (const spot of SPOTS) {
      const { rng, next } = steerable();
      const sim = solo(1_000_000, rng);
      sim.act(0, { type: 'bet', bets: SPOTS.map((s) => ({ spot: s.key, amount: 1_000 })) });
      next(slotOf(spot.key));
      sim.act(0, { type: 'spin' });
      const st = sim.view(0).settled[0]!;
      expect(st.wagered).toBe(5_000);
      expect(st.returned).toBe(1_000 * (spot.pays + 1));
      for (const [key, amount, back] of st.bets) expect(back).toBe(key === spot.key ? amount * (key + 1) : 0);
      expect(sim.stack(0)).toBe(1_000_000 - 5_000 + 1_000 * (spot.pays + 1));
      expect(sim.rounds.at(-1)).toEqual({ seat: 0, wagered: 5_000, returned: 1_000 * (spot.pays + 1) });
    }
  });

  it('settles two players at once, each on their own bets', () => {
    const { rng, next } = steerable();
    const sim = multi([0, 3], rng);
    sim.act(0, { type: 'bet', bets: [{ spot: 1, amount: 2_500 }, { spot: 10, amount: 500 }] });
    sim.act(3, bet(10, 1_000));
    sim.act(3, bet(20, 100));
    next(slotOf(10));
    sim.advance(BETTING_MS);
    const v = sim.view(null);
    expect(v.settled[0]).toEqual({ wagered: 3_000, returned: 5_500, bets: [[1, 2_500, 0], [10, 500, 5_500]] });
    expect(v.settled[3]).toEqual({ wagered: 1_100, returned: 11_000, bets: [[10, 1_000, 11_000], [20, 100, 0]] });
    expect(sim.stack(0)).toBe(1_000_000 - 3_000 + 5_500);
    expect(sim.stack(3)).toBe(1_000_000 - 1_100 + 11_000);
    expect(sim.rounds).toEqual([
      { seat: 0, wagered: 3_000, returned: 5_500 },
      { seat: 3, wagered: 1_100, returned: 11_000 },
    ]);
  });

  it('shows every seat’s bets to everyone while the window is open', () => {
    const sim = multi([0, 1, 2]);
    sim.act(0, bet(1, 500));
    sim.act(2, { type: 'bet', bets: [{ spot: 20, amount: 100 }, { spot: 5, amount: 300 }] });
    const want = { 0: { 1: 500 }, 2: { 5: 300, 20: 100 } };
    for (const viewer of [0, 1, 2, null]) expect(sim.view(viewer).bets).toEqual(want);
    expect(sim.lastEvents).toEqual([{ type: 'bet', seat: 2, bets: { 5: 300, 20: 100 } }]);
  });

  it('holds each number to the table limits and the stack', () => {
    const sim = solo(150_000);
    expect(sim.act(0, bet(1, 50), { allowRefusal: true }).refused).toBe('LIMIT'); // under $1
    expect(sim.act(0, bet(1, 150), { allowRefusal: true }).refused).toBe('LIMIT'); // not whole dollars
    expect(sim.act(0, bet(1, 100_100), { allowRefusal: true }).refused).toBe('LIMIT'); // over $1,000
    sim.act(0, bet(1, 100_000));
    expect(sim.act(0, bet(1, 100), { allowRefusal: true }).refused).toBe('LIMIT'); // $1,000 already there
    sim.act(0, bet(3, 50_000));
    expect(sim.act(0, bet(5, 100), { allowRefusal: true }).refused).toBe('NOT_ENOUGH_CHIPS');
    expect(sim.stack(0)).toBe(0);
    // several chips go down together or not at all
    const sim2 = solo(10_000);
    expect(sim2.act(0, { type: 'bet', bets: [{ spot: 1, amount: 5_000 }, { spot: 3, amount: 6_000 }] }, { allowRefusal: true }).refused).toBe('NOT_ENOUGH_CHIPS');
    expect(sim2.view(0).bets).toEqual({});
    expect(sim2.stack(0)).toBe(10_000);
  });

  it('Max puts down the table maximum or the stack, whichever is less', () => {
    // plenty of chips: the table's $1,000 on that number
    const rich = solo(1_000_000);
    rich.act(0, { type: 'max', spot: 20 });
    expect(rich.view(0).bets[0]).toEqual({ 20: 100_000 });
    expect(rich.stack(0)).toBe(900_000);
    expect(rich.act(0, { type: 'max', spot: 20 }, { allowRefusal: true }).refused).toBe('LIMIT');
    // some already there: only the rest of the limit
    rich.act(0, bet(5, 25_000));
    rich.act(0, { type: 'max', spot: 5 });
    expect(rich.view(0).bets[0]![5]).toBe(100_000);
    // a small stack: all of it
    const poor = solo(43_700);
    poor.act(0, { type: 'max', spot: 3 });
    expect(poor.view(0).bets[0]).toEqual({ 3: 43_700 });
    expect(poor.stack(0)).toBe(0);
    expect(poor.act(0, { type: 'max', spot: 1 }, { allowRefusal: true }).refused).toBe('NOT_ENOUGH_CHIPS');
    // one undo takes the whole Max back
    poor.act(0, { type: 'undo' });
    expect(poor.stack(0)).toBe(43_700);
  });

  it('reads Max from the table’s own limits', () => {
    const cfg = engine.config('', 'solo');
    cfg.limits = { default: { min: 500, max: 20_000, step: 100 } };
    const sim = new TableSim(engine, seededRng(1), 'solo', [{ seat: 0, stack: 1_000_000 }], cfg);
    sim.act(0, { type: 'max', spot: 10 });
    expect(sim.view(0).bets[0]).toEqual({ 10: 20_000 });
    expect(maxFor(sim.state, 0, 300, 1)).toEqual({ none: 'NO_CHIPS' });
    expect(maxFor(sim.state, 0, 1_000_000, 10)).toEqual({ none: 'AT_MAX' });
    expect(maxFor(sim.state, 0, 12_345, 1)).toEqual({ amount: 12_300 });
  });

  it('undoes the last placement, clears everything, and gives the chips back', () => {
    const sim = solo(100_000);
    sim.act(0, bet(1, 1_000));
    sim.act(0, { type: 'bet', bets: [{ spot: 3, amount: 500 }, { spot: 20, amount: 100 }] });
    expect(sim.stack(0)).toBe(98_400);
    sim.act(0, { type: 'undo' });
    expect(sim.view(0).bets[0]).toEqual({ 1: 1_000 });
    expect(sim.stack(0)).toBe(99_000);
    sim.act(0, bet(5, 700));
    sim.act(0, { type: 'clear' });
    expect(sim.view(0).bets).toEqual({});
    expect(sim.stack(0)).toBe(100_000);
    // nothing to take back: no change, no events
    const before = sim.state;
    sim.act(0, { type: 'undo' });
    sim.act(0, { type: 'clear' });
    expect(sim.state).toBe(before);
  });

  it('repeats and doubles the last spin’s bets', () => {
    const sim = solo(1_000_000);
    expect(sim.act(0, { type: 'rebet' }, { allowRefusal: true }).refused).toBe('BAD_REQUEST');
    sim.act(0, { type: 'bet', bets: [{ spot: 1, amount: 2_000 }, { spot: 10, amount: 300 }] });
    sim.act(0, { type: 'spin' });
    sim.advance(SPIN_MS + SETTLE_MS);
    expect(sim.view(0).canRebet).toEqual([0]);
    sim.act(0, { type: 'rebet' });
    expect(sim.view(0).bets[0]).toEqual({ 1: 2_000, 10: 300 });
    // ×2 with chips down doubles what is down
    sim.act(0, { type: 'rebet', double: true });
    expect(sim.view(0).bets[0]).toEqual({ 1: 4_000, 10: 600 });
    sim.act(0, { type: 'clear' });
    // ×2 on an empty terminal is twice the last spin
    sim.act(0, { type: 'rebet', double: true });
    expect(sim.view(0).bets[0]).toEqual({ 1: 4_000, 10: 600 });
  });

  it('does not hand the last player’s Rebet to someone new in that seat', () => {
    const sim = multi([0]);
    sim.act(0, bet(1, 500));
    round(sim);
    expect(sim.view(0).canRebet).toEqual([0]);
    sim.seats.set(0, { seat: 0, accountId: 4242, name: 'New', stack: 50_000, connected: true, ready: false });
    sim.apply(engine.seatJoined(sim.state, 0, sim.ctx()));
    expect(sim.view(0).canRebet).toEqual([]);
    expect(sim.act(0, { type: 'rebet' }, { allowRefusal: true }).refused).toBe('BAD_REQUEST');
  });

  it('gives a leaving player’s chips back before the spin, and none after it', () => {
    const sim = multi([0, 1]);
    sim.act(1, bet(20, 3_000));
    expect(engine.liveBets(sim.state, 1)).toBe(3_000);
    const out = engine.seatLeaving(sim.state, 1, sim.ctx());
    expect(out.chips).toEqual([{ seat: 1, payout: 3_000 }]);
    expect(out.events).toEqual([{ type: 'bet', seat: 1, bets: {} }]);
    sim.apply(out);
    expect(engine.liveBets(sim.state, 1)).toBe(0);
    expect(sim.stack(1)).toBe(1_000_000);
    // a seat with nothing down leaves the state untouched
    expect(engine.seatLeaving(sim.state, 0, sim.ctx()).state).toBe(sim.state);
    // after "No more bets" the round is already settled: nothing is live, nothing comes back
    sim.act(0, bet(1, 1_000));
    sim.advance(BETTING_MS);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    const late = engine.seatLeaving(sim.state, 0, sim.ctx());
    expect(late.chips ?? []).toEqual([]);
    expect(late.state).toBe(sim.state);
  });

  it('refuses a seat that has not bought in', () => {
    const sim = multi([0]);
    expect(sim.act(5, bet(1, 100), { allowRefusal: true }).refused).toBe('NOT_SEATED');
  });
});
