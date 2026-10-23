// The page's idea of the server's time (client/src/net/clock.ts): the least-delayed message sets
// it, slower ones pull it back only a little at a time, and a clock set forward on this machine
// is noticed at once instead of leaving everything that runs on server time far out for minutes.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { msLeft, observeServerTime, serverNow } from '../src/net/clock.ts';

const T0 = 1_700_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe('server time', () => {
  it('follows the quickest message, eases back for slower ones, and notices a clock set forward', () => {
    // the server is 10 s ahead of this machine; this message took 50 ms
    observeServerTime(T0 + 10_000 - 50);
    expect(serverNow()).toBe(T0 + 9_950);
    // a quicker one (10 ms) sets it at once
    observeServerTime(T0 + 9_990);
    expect(serverNow()).toBe(T0 + 9_990);
    // a much slower one (500 ms on the way) moves it back only 20 ms
    observeServerTime(T0 + 9_500);
    expect(serverNow()).toBe(T0 + 9_970);
    // this machine's clock is set an hour forward: the next message puts it right
    vi.setSystemTime(T0 + 3_600_000);
    observeServerTime(T0 + 10_000);
    expect(serverNow()).toBe(T0 + 10_000);
    // and set back again: the next message is "quicker" than any, so that is right at once too
    vi.setSystemTime(T0);
    observeServerTime(T0 + 10_000);
    expect(serverNow()).toBe(T0 + 10_000);
  });

  it('counts a countdown down from when it arrived', () => {
    const at = Date.now();
    vi.advanceTimersByTime(1_500);
    expect(msLeft(T0 + 10_000, T0, at)).toBe(8_500);
    vi.advanceTimersByTime(20_000);
    expect(msLeft(T0 + 10_000, T0, at)).toBe(0);
  });
});
