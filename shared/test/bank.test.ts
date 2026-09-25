import { describe, it, expect } from 'vitest';
import {
  DAY_MS, DEPOSIT_CAP, EARLY_FEE_PPM, FUND_DAY_DRIFT, FUND_DAY_VOL, FUND_MU, FUND_SIGMA, FUND_START, HOUR_MS, INTEREST_DEN, REFILL_BELOW, REFILL_TO, SAVINGS_MAX_DAY,
  SEND, STEPS_PER_DAY, TERMS, UNIT, accrue, cleanNote, costOf, depositInterest, depositPayout, earlyFee, formatPrice, formatUnits, interestWeight,
  nextPayday, nextPrice, notYet, refillFor, sendable, stepOf, termOf, unitsFor, valueOf, type SavingsState,
} from '../src/bank.ts';
import { DOLLAR } from '../src/money.ts';
import { seededRng } from './helpers/seeded.ts';

describe('bank refill rule', () => {
  it('tops up to $50,000 below $10,000 in all', () => {
    expect([REFILL_BELOW, REFILL_TO]).toEqual([1_000_000, 5_000_000]);
    expect(refillFor(0)).toBe(5_000_000);
    expect(refillFor(1)).toBe(4_999_999);
    expect(refillFor(350_050)).toBe(4_649_950);
  });

  it('lends at $9,999.99 and not at $10,000.00', () => {
    expect(refillFor(999_999)).toBe(4_000_001);
    expect(refillFor(1_000_000)).toBe(0);
    expect(refillFor(1_000_001)).toBe(0);
    expect(refillFor(5_000_000)).toBe(0);
  });

  it('always lands the player on exactly $50,000', () => {
    for (const total of [0, 1, 99, 12_345, 500_000, 999_999]) expect(total + refillFor(total)).toBe(REFILL_TO);
  });

  it('says what it counted, the bank included', () => {
    expect(notYet(1_200_000, 0)).toBe('You have $12,000 in all. The bank tops you up when that is under $10,000.');
    expect(notYet(1_200_000, 100_000, 900_000)).toBe('You have $12,000 in all, $1,000 of it in chips on tables and $9,000 in the bank. The bank tops you up when that is under $10,000.');
  });
});

const T0 = Date.UTC(2026, 8, 25); // a midnight UTC
const fresh = (balance: number, since = T0): SavingsState => ({ balance, accrued: 0, frac: 0, since });

describe('savings interest', () => {
  it('weighs each slice of the balance at its tier', () => {
    expect(interestWeight(0)).toBe(0);
    expect(interestWeight(100)).toBe(100 * 50);
    expect(interestWeight(100_000 * DOLLAR)).toBe(10_000_000 * 50);
    expect(interestWeight(200_000 * DOLLAR)).toBe(10_000_000 * 50 + 10_000_000 * 10);
    expect(interestWeight(1_000_000 * DOLLAR)).toBe(interestWeight(5_000_000 * DOLLAR));
  });

  it('pays $500 at midnight for a day on $100,000, and $1,400 at most', () => {
    const { state, paid } = accrue(fresh(100_000 * DOLLAR), T0 + DAY_MS);
    expect(paid).toEqual([{ day: T0 / DAY_MS, amount: 500 * DOLLAR }]);
    expect(state).toEqual({ balance: 100_500 * DOLLAR, accrued: 0, frac: 0, since: T0 + DAY_MS });
    expect(accrue(fresh(1_000_000 * DOLLAR), T0 + DAY_MS).paid[0]!.amount).toBe(SAVINGS_MAX_DAY);
    expect(accrue(fresh(9_000_000 * DOLLAR), T0 + DAY_MS).paid[0]!.amount).toBe(SAVINGS_MAX_DAY);
  });

  it('holds what the day earns until midnight', () => {
    const { state, paid } = accrue(fresh(100_000 * DOLLAR), T0 + 12 * HOUR_MS);
    expect(paid).toEqual([]);
    expect(state.balance).toBe(100_000 * DOLLAR);
    expect(state.accrued).toBe(250 * DOLLAR);
    expect(nextPayday(T0 + 12 * HOUR_MS)).toBe(T0 + DAY_MS);
  });

  it('comes out the same however a span is split, to the fraction of a cent', () => {
    const rng = seededRng(7);
    for (let trial = 0; trial < 50; trial++) {
      const start = fresh(1 + (rng.next32() % 150_000_000), T0 + (rng.next32() % DAY_MS));
      const end = start.since + (rng.next32() % (5 * DAY_MS));
      const once = accrue(start, end);
      let s = start;
      const paid: { day: number; amount: number }[] = [];
      let t = start.since;
      while (t < end) {
        t = Math.min(end, t + 1 + (rng.next32() % (3 * HOUR_MS)));
        const r = accrue(s, t);
        s = r.state;
        paid.push(...r.paid);
      }
      expect(s).toEqual(once.state);
      expect(paid).toEqual(once.paid);
      expect(s.frac).toBeLessThan(INTEREST_DEN);
    }
  });

  it('asking every second earns nothing more than asking once a day', () => {
    let s = fresh(250_000 * DOLLAR);
    for (let t = T0 + 1000; t <= T0 + 2 * HOUR_MS; t += 1000) s = accrue(s, t).state;
    expect(s).toEqual(accrue(fresh(250_000 * DOLLAR), T0 + 2 * HOUR_MS).state);
  });

  it('compounds only at midnights, whatever the timing', () => {
    // three days at once pays three payments, each on the balance with the days before paid in
    const { paid, state } = accrue(fresh(100_000 * DOLLAR), T0 + 3 * DAY_MS);
    expect(paid.map((p) => p.amount)).toEqual([50_000, 50_000 + Math.floor((50_000 * 10) / 10_000), 50_000 + Math.floor((100_050 * 10) / 10_000)]);
    expect(state.balance).toBe(100_000 * DOLLAR + paid.reduce((s, p) => s + p.amount, 0));
  });

  it('a deposit for a moment earns that moment and no more (no in-and-out loop pays)', () => {
    // in for one second a thousand times: exactly what one thousand seconds would have paid, rounded down
    let s: SavingsState = fresh(0);
    let t = T0;
    for (let i = 0; i < 1000; i++) {
      s = { ...accrue(s, t).state, balance: s.balance + 100_000 * DOLLAR };
      t += 1000;
      s = { ...accrue(s, t).state };
      s = { ...s, balance: s.balance - 100_000 * DOLLAR };
      t += 60_000;
    }
    const held = accrue({ ...fresh(100_000 * DOLLAR), since: T0 }, T0 + 1_000_000).state;
    expect(s.accrued).toBe(held.accrued);
    expect(s.frac).toBe(held.frac);
  });

  it('changes nothing for a clock behind `since`', () => {
    const s = fresh(1_000, T0 + 5000);
    expect(accrue(s, T0)).toEqual({ state: s, paid: [] });
  });
});

describe('term deposits', () => {
  it('has three terms at fixed rates', () => {
    expect(TERMS.map((t) => [t.id, t.ms, t.ppm])).toEqual([
      ['1h', HOUR_MS, 150],
      ['24h', DAY_MS, 4_000],
      ['7d', 7 * DAY_MS, 35_000],
    ]);
    expect(termOf('24h')!.label).toBe('24 hours');
    expect(termOf('2h')).toBeNull();
  });

  it('pays interest rounded down, and takes a fee for breaking early', () => {
    expect(depositInterest(1_000_000 * DOLLAR, termOf('7d')!)).toBe(35_000 * DOLLAR);
    expect(depositInterest(12_345, termOf('1h')!)).toBe(1);
    expect(earlyFee(100_000 * DOLLAR)).toBe(500 * DOLLAR);
    expect(EARLY_FEE_PPM).toBe(5_000);
    const d = { principal: 10_000 * DOLLAR, interest: 40 * DOLLAR, maturesAt: T0 };
    expect(depositPayout(d, T0)).toEqual({ paid: 10_040 * DOLLAR, gain: 40 * DOLLAR, matured: true });
    expect(depositPayout(d, T0 - 1)).toEqual({ paid: 9_950 * DOLLAR, gain: -50 * DOLLAR, matured: false });
  });

  it('never pays more a day than the cap allows', () => {
    // a week's deposit at the cap pays $35,000: $5,000 a day
    expect(depositInterest(DEPOSIT_CAP, termOf('7d')!) / 7).toBe(5_000 * DOLLAR);
    // rolling hour deposits all day long earns less than a day's
    expect(depositInterest(DEPOSIT_CAP, termOf('1h')!) * 24).toBeLessThan(depositInterest(DEPOSIT_CAP, termOf('24h')!));
  });
});

describe('the Casino Index', () => {
  it('prices at $100 on the first step, a step every five minutes', () => {
    expect(formatPrice(FUND_START)).toBe('$100.0000');
    expect(STEPS_PER_DAY).toBe(288);
    expect(stepOf(T0)).toBe(T0 / 300_000);
    expect(stepOf(T0 + 299_999)).toBe(T0 / 300_000);
  });

  it('is a function of the price and the draws alone', () => {
    expect(nextPrice(FUND_START, 0.3, 0.7)).toBe(nextPrice(FUND_START, 0.3, 0.7));
    expect(nextPrice(FUND_START, 0.3, 0.7)).not.toBe(nextPrice(FUND_START, 0.3, 0.2));
    expect(nextPrice(1, 0.999999, 0.5)).toBeGreaterThanOrEqual(1);
  });

  it('holds a step within four standard deviations', () => {
    const up = nextPrice(FUND_START, 0.99999999999, 0);
    expect(Math.log(up / FUND_START)).toBeCloseTo(FUND_MU + 4 * FUND_SIGMA, 5);
    const down = nextPrice(FUND_START, 0.99999999999, 0.5);
    expect(Math.log(down / FUND_START)).toBeCloseTo(FUND_MU - 4 * FUND_SIGMA, 5);
  });

  it('drifts up about 0.1% a day with about 2% a day of swing (a year of steps, fixed seed)', () => {
    const rng = seededRng(2026);
    const u = () => rng.next32() / 2 ** 32;
    const days = 3000;
    const dayReturns: number[] = [];
    let price = FUND_START * 1000; // finer ticks, so rounding doesn't bend the measurement
    for (let d = 0; d < days; d++) {
      const open = price;
      for (let s = 0; s < STEPS_PER_DAY; s++) price = nextPrice(price, u(), u());
      dayReturns.push(price / open - 1);
    }
    const mean = dayReturns.reduce((s, r) => s + r, 0) / days;
    const sd = Math.sqrt(dayReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (days - 1));
    const se = sd / Math.sqrt(days);
    console.log(`Casino Index: mean day ${(mean * 100).toFixed(4)}% (published ${FUND_DAY_DRIFT * 100}%), SE ${(se * 100).toFixed(4)}%, sd ${(sd * 100).toFixed(3)}%, z ${((mean - FUND_DAY_DRIFT) / se).toFixed(2)}`);
    expect(Math.abs(mean - FUND_DAY_DRIFT)).toBeLessThan(3 * se);
    expect(Math.abs(sd - FUND_DAY_VOL)).toBeLessThan(0.002);
    // real risk: plenty of losing days
    expect(dayReturns.filter((r) => r < 0).length / days).toBeGreaterThan(0.4);
  });

  it('never pays back more than went in at the same price', () => {
    const rng = seededRng(99);
    for (let i = 0; i < 2000; i++) {
      const cents = 1 + (rng.next32() % 100_000_000);
      const price = 1 + (rng.next32() % 50_000_000);
      const units = unitsFor(cents, price);
      expect(valueOf(units, price)).toBeLessThanOrEqual(cents);
      expect(valueOf(units + 1, price)).toBeGreaterThan(valueOf(units, price) - 1);
    }
    expect(unitsFor(100 * DOLLAR, FUND_START)).toBe(UNIT);
    expect(valueOf(UNIT, FUND_START)).toBe(100 * DOLLAR);
    expect(formatUnits(1_500_000)).toBe('1.5');
    expect(formatUnits(12_000_001)).toBe('12.000001');
  });

  it('takes cost off in proportion, and all of it with the last unit', () => {
    expect(costOf(500_000, { units: 1_000_000, cost: 10_001 })).toBe(5_000);
    expect(costOf(1_000_000, { units: 1_000_000, cost: 10_001 })).toBe(10_001);
    expect(costOf(3, { units: 3, cost: 7 })).toBe(7);
  });
});

describe('transfers', () => {
  it('lets out the balance less what is held, within the day cap', () => {
    expect(sendable(100_000 * DOLLAR, 0, 0)).toBe(SEND.dayCap < 100_000 * DOLLAR ? SEND.dayCap : 100_000 * DOLLAR);
    expect(sendable(80_000 * DOLLAR, 50_000 * DOLLAR, 0)).toBe(30_000 * DOLLAR);
    expect(sendable(40_000 * DOLLAR, 50_000 * DOLLAR, 0)).toBe(0);
    expect(sendable(1_000_000 * DOLLAR, 0, 200_000 * DOLLAR)).toBe(50_000 * DOLLAR);
  });

  it('keeps a note to one clean line', () => {
    expect(cleanNote(undefined)).toBeNull();
    expect(cleanNote('   ')).toBeNull();
    expect(cleanNote('  for the\n drinks​ ')).toBe('for the drinks');
    expect(cleanNote('x'.repeat(SEND.noteMax))).toBe('x'.repeat(SEND.noteMax));
    expect(cleanNote('x'.repeat(SEND.noteMax + 1))).toBeUndefined();
    expect(cleanNote(42)).toBeUndefined();
  });
});
