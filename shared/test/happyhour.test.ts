// Happy hour's windows (shared/src/happyhour.ts): a quarter of an hour each, 75 to 135 minutes
// apart, the same from any clock that reads the same time, and half price exact on the whole menu.

import { describe, expect, it } from 'vitest';
import { HAPPY_CYCLE_MS, HAPPY_MS, barPriceAt, halfPrice, happyHourAt, happyHourOf, nextHappyHour } from '../src/happyhour.ts';
import { BAR_MENU } from '../src/items.ts';

const T0 = Date.UTC(2026, 8, 25);

describe('happy hour', () => {
  it('lasts a quarter of an hour, and comes round every 75 to 135 minutes (1.75 hours on average)', () => {
    let prev = happyHourOf(Math.floor(T0 / HAPPY_CYCLE_MS));
    let gaps = 0;
    const n = 2_000;
    for (let i = 1; i <= n; i++) {
      const h = happyHourOf(Math.floor(T0 / HAPPY_CYCLE_MS) + i);
      expect(h.end - h.start).toBe(HAPPY_MS);
      const gap = (h.start - prev.start) / 60_000;
      expect(gap).toBeGreaterThanOrEqual(75);
      expect(gap).toBeLessThanOrEqual(135);
      // on whole minutes
      expect(h.start % 60_000).toBe(0);
      gaps += gap;
      prev = h;
    }
    expect(gaps / n).toBeCloseTo(105, 0);
  });

  it('is on from its first millisecond to its last, and not either side', () => {
    const h = happyHourOf(Math.floor(T0 / HAPPY_CYCLE_MS) + 3);
    expect(happyHourAt(h.start - 1)).toBeNull();
    expect(happyHourAt(h.start)).toEqual(h);
    expect(happyHourAt(h.end - 1)).toEqual(h);
    expect(happyHourAt(h.end)).toBeNull();
    // what's on, else what's next
    expect(nextHappyHour(h.start - 1)).toEqual(h);
    expect(nextHappyHour(h.start + 5)).toEqual(h);
    expect(nextHappyHour(h.end)).toEqual(happyHourOf(Math.floor(T0 / HAPPY_CYCLE_MS) + 4));
  });

  it('is on about a seventh of the time, and the whole day has some', () => {
    let on = 0;
    const steps = 7 * 24 * 60;
    for (let m = 0; m < steps; m++) if (happyHourAt(T0 + m * 60_000)) on++;
    expect(on / steps).toBeGreaterThan(0.13);
    expect(on / steps).toBeLessThan(0.155);
  });

  it('halves every price on the menu exactly', () => {
    const h = happyHourOf(Math.floor(T0 / HAPPY_CYCLE_MS) + 1);
    for (const it of BAR_MENU) {
      expect(halfPrice(it.price) * 2, it.id).toBe(it.price);
      expect(barPriceAt(it.price, h.start)).toBe(it.price / 2);
      expect(barPriceAt(it.price, h.end)).toBe(it.price);
    }
    expect(halfPrice(1)).toBe(1);
  });
});
