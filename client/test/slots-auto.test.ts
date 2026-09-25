import { describe, it, expect } from 'vitest';
import { SpinDriver, autoStop, autoCount, type AutoStops, type SpinOutcome } from '../src/games/slots/auto.ts';

const STOPS: AutoStops = { spins: null, below: null, winOver: null, feature: false };

/** A machine the way the views behave: one spin at a time, the bet off the credits when it goes. */
function machine(opts: { credit?: number; bet?: number; wins?: number[]; feature?: number[]; handPay?: number[] } = {}) {
  const bet = opts.bet ?? 100;
  let credit = opts.credit ?? 10_000;
  let busy = false;
  let sent = 0;
  let overlaps = 0;
  const said: string[] = [];
  const driver = new SpinDriver({
    spin: () => {
      if (busy) return false;
      if (credit < bet) return 'Insert money to play';
      busy = true;
      sent++;
      credit -= bet;
      return true;
    },
    changed: () => {},
    stopped: (why) => said.push(why),
  });
  /** The spin out plays to the end and shows; the driver hears of it. */
  const settle = (): SpinOutcome | null => {
    if (!busy) return null;
    const i = sent - 1;
    const win = opts.wins?.[i] ?? 0;
    credit += win;
    busy = false;
    const o = { bet, win, credit, feature: !!opts.feature?.includes(i), handPay: !!opts.handPay?.includes(i) };
    driver.settled(o);
    return o;
  };
  /** Settle until the machine stops on its own (or a cap). */
  const run = (cap = 1000) => {
    for (let n = 0; n < cap && busy; n++) {
      const before = sent;
      settle();
      // at most one new spin goes per settle, never a second while one is out
      if (sent - before > 1) overlaps++;
    }
  };
  return {
    driver,
    settle,
    run,
    said,
    get sent() {
      return sent;
    },
    get busy() {
      return busy;
    },
    get credit() {
      return credit;
    },
    get overlaps() {
      return overlaps;
    },
  };
}

describe('slots Auto: stops', () => {
  const o = (x: Partial<SpinOutcome>): SpinOutcome => ({ bet: 100, win: 0, credit: 5_000, feature: false, handPay: false, ...x });

  it('carries on while nothing says stop', () => {
    expect(autoStop(STOPS, null, o({}))).toBeNull();
    expect(autoStop({ ...STOPS, spins: 10 }, 3, o({}))).toBeNull();
  });
  it('stops when the spins are done', () => {
    expect(autoStop({ ...STOPS, spins: 10 }, 0, o({}))).toBe('Spins done');
  });
  it('always stops when the credits cannot cover the bet', () => {
    expect(autoStop(STOPS, null, o({ credit: 99 }))).toBe('Out of credits');
    expect(autoStop(STOPS, null, o({ credit: 100 }))).toBeNull();
  });
  it('stops under the credits floor, not at it', () => {
    const s = { ...STOPS, below: 2_000 };
    expect(autoStop(s, null, o({ credit: 2_000 }))).toBeNull();
    expect(autoStop(s, null, o({ credit: 1_999 }))).toBe('Credits under $20');
  });
  it('stops on a single win over the amount, not equal to it', () => {
    const s = { ...STOPS, winOver: 5_000 };
    expect(autoStop(s, null, o({ win: 5_000 }))).toBeNull();
    expect(autoStop(s, null, o({ win: 5_001 }))).toBe('Won $50.01');
  });
  it('stops on a feature only when asked', () => {
    expect(autoStop(STOPS, null, o({ feature: true }))).toBeNull();
    expect(autoStop({ ...STOPS, feature: true }, null, o({ feature: true }))).toBe('Feature played');
  });
  it('always stops on a hand pay', () => {
    expect(autoStop(STOPS, null, o({ win: 250_000, handPay: true }))).toBe('Hand pay $2,500');
  });
  it('counts what is left, the spin playing included', () => {
    expect(autoCount({ left: 22, spun: 3 }, true)).toBe('23 left');
    expect(autoCount({ left: 22, spun: 3 }, false)).toBe('22 left');
    expect(autoCount({ left: null, spun: 7 }, true)).toBe('7 spun');
  });
});

describe('slots Auto: the driver', () => {
  it('spins exactly the number asked, one at a time', () => {
    for (const n of [10, 25, 50, 100]) {
      const m = machine();
      m.driver.start({ ...STOPS, spins: n });
      expect(m.sent).toBe(1);
      m.run();
      expect(m.sent).toBe(n);
      expect(m.overlaps).toBe(0);
      expect(m.driver.running).toBe(false);
      expect(m.said).toEqual(['Spins done']);
      expect(m.credit).toBe(10_000 - n * 100);
    }
  });

  it('never sends a second spin while one is out, however it is asked', () => {
    const m = machine();
    m.driver.start({ ...STOPS, spins: 5 });
    m.driver.hold(true);
    m.driver.hold(false);
    m.driver.hold(true);
    m.driver.start({ ...STOPS, spins: 5 });
    expect(m.sent).toBe(1);
    expect(m.driver.inFlight).toBe(true);
    m.settle();
    expect(m.sent).toBe(2);
  });

  it('runs on ∞ until something else stops it: the credits', () => {
    const m = machine({ credit: 1_000 });
    m.driver.start(STOPS);
    m.run();
    expect(m.sent).toBe(10);
    expect(m.said).toEqual(['Out of credits']);
    expect(m.credit).toBe(0);
  });

  it('stops on a win over the amount, after the spin that paid it', () => {
    const m = machine({ wins: [0, 50, 0, 8_000, 0] });
    m.driver.start({ ...STOPS, winOver: 5_000 });
    m.run();
    expect(m.sent).toBe(4);
    expect(m.said).toEqual(['Won $80']);
  });

  it('stops on a feature when asked, and plays through it when not', () => {
    const a = machine({ feature: [2] });
    a.driver.start({ ...STOPS, spins: 10, feature: true });
    a.run();
    expect(a.sent).toBe(3);
    expect(a.said).toEqual(['Feature played']);
    const b = machine({ feature: [2] });
    b.driver.start({ ...STOPS, spins: 10 });
    b.run();
    expect(b.sent).toBe(10);
  });

  it('stops under the credits floor', () => {
    const m = machine({ credit: 3_000 });
    m.driver.start({ ...STOPS, below: 2_500 });
    m.run();
    // 3,000 less 100 a spin: 2,400 after the sixth
    expect(m.sent).toBe(6);
    expect(m.said).toEqual(['Credits under $25']);
  });

  it('always stops on a hand pay', () => {
    const m = machine({ wins: [0, 300_000], handPay: [1] });
    m.driver.start({ ...STOPS, spins: 100 });
    m.run();
    expect(m.sent).toBe(2);
    expect(m.said).toEqual(['Hand pay $3,000']);
  });

  it('a stop from the player lets the spin out finish and sends nothing more', () => {
    const m = machine();
    m.driver.start({ ...STOPS, spins: 50 });
    m.settle();
    m.driver.stop('');
    expect(m.said).toEqual(['']);
    expect(m.busy).toBe(true);
    m.settle();
    expect(m.sent).toBe(2);
    expect(m.busy).toBe(false);
  });

  it('a refused spin stops Auto and says why', () => {
    const m = machine();
    m.driver.start({ ...STOPS, spins: 10 });
    m.driver.refused('Too fast.');
    expect(m.driver.running).toBe(false);
    expect(m.driver.inFlight).toBe(false);
    expect(m.said).toEqual(['Too fast.']);
  });

  it('a machine that cannot spin stops Auto at once', () => {
    const m = machine({ credit: 50 });
    m.driver.start({ ...STOPS, spins: 10 });
    expect(m.sent).toBe(0);
    expect(m.driver.running).toBe(false);
    expect(m.said).toEqual(['Insert money to play']);
  });

  it('a reconnect forgets the spin out and stops quietly', () => {
    const m = machine();
    m.driver.start({ ...STOPS, spins: 10 });
    m.driver.reset();
    expect(m.driver.running).toBe(false);
    expect(m.driver.inFlight).toBe(false);
    expect(m.said).toEqual([]);
  });
});

describe('slots hold to spin', () => {
  it('spins at once, again each time the last settles, and stops after the spin out when let go', () => {
    const m = machine();
    m.driver.hold(true);
    expect(m.sent).toBe(1);
    m.settle();
    m.settle();
    expect(m.sent).toBe(3);
    m.driver.hold(false);
    expect(m.busy).toBe(true);
    m.settle();
    expect(m.sent).toBe(3);
    expect(m.busy).toBe(false);
    expect(m.said).toEqual([]);
  });

  it('pressed while a single spin plays, it waits for that spin to settle', () => {
    const m = machine();
    // a spin that went without the driver (Enter on the button)
    m.driver.hold(true);
    m.driver.hold(false);
    m.driver.inFlight = false;
    m.driver.hold(true);
    expect(m.sent).toBe(1);
    m.settle();
    expect(m.sent).toBe(2);
  });

  it('let go before the spin settles: that one spin only', () => {
    const m = machine();
    m.driver.hold(true);
    m.driver.hold(false);
    m.settle();
    expect(m.sent).toBe(1);
  });

  it('stops holding when the credits run out, quietly (the machine says why itself)', () => {
    const m = machine({ credit: 300 });
    m.driver.hold(true);
    m.run();
    expect(m.sent).toBe(3);
    expect(m.driver.holding).toBe(false);
    expect(m.said).toEqual([]);
  });
});
