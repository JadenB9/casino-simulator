// The celebrities' routes against the clock, the tips and gift boxes' amounts, and the daily
// streak's calendar arithmetic (shared/src/celebs.ts). The routes against the building itself are
// in client/test/celebs-routes.test.ts.

import { describe, expect, it } from 'vitest';
import {
  CELEBS, CELEB_SPEED, DAILY_AMOUNTS, GIFT_MAX, GIFT_MIN, ROUTES, ROUTE_IDS, TIP_MAX, TIP_MIN,
  celebAt, celebOf, dailyAmount, dailyState, dayNumber, faceYaw, numberDay, parseCelebMsg, poseOn, prevDay, rollGift, rollTip,
  routeOfVisit, streakAfterClaim, timeline, visitEnd, type Visit,
} from '../src/celebs.ts';
import { parseLook } from '../src/look.ts';
import { seededRng } from './helpers/seeded.ts';

const unit = (seed: number) => {
  const r = seededRng(seed);
  return () => r.next32() / 2 ** 32;
};

describe('routes', () => {
  it('every celebrity has a route, a valid look and lines, and a name of their own', () => {
    expect(new Set(CELEBS.map((c) => c.name)).size).toBe(CELEBS.length);
    for (const c of CELEBS) {
      expect(ROUTE_IDS).toContain(c.route);
      expect(parseLook(c.look), c.id).toEqual(c.look);
      expect(c.lines.hello.length).toBeGreaterThanOrEqual(4);
      expect(c.lines.stop.length).toBeGreaterThan(0);
      expect(c.lines.table.length).toBeGreaterThan(0);
      for (const line of [...c.lines.hello, ...c.lines.stop, ...c.lines.table, c.lines.bye]) expect(line.length).toBeLessThanOrEqual(64);
    }
    // each route is someone's
    expect(new Set(CELEBS.map((c) => c.route))).toEqual(new Set(ROUTE_IDS));
  });

  it('walk in at the street doors and out the same way, a few minutes in all, waving at the doors', () => {
    for (const id of ROUTE_IDS) {
      const r = ROUTES[id];
      const tl = timeline(r);
      expect(r.pts[0], id).toEqual([0, 14.2]);
      expect(r.pts[r.pts.length - 1], id).toEqual([0, 14.2]);
      expect(tl.secs, id).toBeGreaterThan(3.5 * 60);
      expect(tl.secs, id).toBeLessThan(6 * 60);
      expect(r.stops[r.stops.length - 1]!.kind).toBe('bye');
      expect(r.stops[r.stops.length - 1]!.at).toBe(r.pts.length - 1);
      // stops in order along the route, each where the route has a point
      for (let i = 1; i < r.stops.length; i++) expect(r.stops[i]!.at).toBeGreaterThan(r.stops[i - 1]!.at);
      expect(r.stops.some((s) => s.kind === 'table')).toBe(true);
    }
  });

  it('never jumps: from one moment to the next they move no faster than their pace', () => {
    for (const id of ROUTE_IDS) {
      const tl = timeline(ROUTES[id]);
      let prev = poseOn(tl, 0);
      for (let t = 0.05; t <= tl.secs; t += 0.05) {
        const p = poseOn(tl, t);
        expect(Math.hypot(p.x - prev.x, p.z - prev.z), `${id} at ${t.toFixed(2)}`).toBeLessThanOrEqual(CELEB_SPEED * 0.05 + 1e-6);
        prev = p;
      }
      const end = poseOn(tl, tl.secs);
      expect([end.x, end.z]).toEqual([0, 14.2]);
    }
  });

  it('stand still at each stop for its length, facing its way; walk between them', () => {
    for (const id of ROUTE_IDS) {
      const tl = timeline(ROUTES[id]);
      const stops = tl.segs.filter((s) => s.kind === 'stop');
      expect(stops).toHaveLength(ROUTES[id].stops.length);
      for (const s of stops) {
        const spec = ROUTES[id].stops[s.stop]!;
        const [x, z] = ROUTES[id].pts[spec.at]!;
        expect(s.t1 - s.t0).toBeCloseTo(spec.secs, 9);
        for (const t of [s.t0 + 0.01, (s.t0 + s.t1) / 2, s.t1 - 0.01]) {
          const p = poseOn(tl, t);
          expect(p.walking).toBe(false);
          expect(p.stop).toBe(s.stop);
          expect(p.x).toBeCloseTo(x, 9);
          expect(p.z).toBeCloseTo(z, 9);
          expect(p.heading).toBe(faceYaw(spec.face));
        }
      }
      for (const s of tl.segs.filter((q) => q.kind === 'walk')) {
        const p = poseOn(tl, (s.t0 + s.t1) / 2);
        expect(p.walking).toBe(true);
        expect(p.stop).toBe(-1);
      }
    }
  });

  it('face the way they walk', () => {
    const tl = timeline(ROUTES.bar);
    // the first walk runs north from the doors: heading pi faces -z
    expect(poseOn(tl, 2).heading).toBeCloseTo(Math.PI, 9);
    // the door's stop faces the street
    expect(faceYaw(0)).toBe(0);
    expect(faceYaw(1)).toBeCloseTo(Math.PI / 2, 12);
    expect(faceYaw(-1)).toBeCloseTo(-Math.PI / 2, 12);
  });
});

describe('visits', () => {
  const v: Visit = { id: 1_790_000_000_000, celeb: 'vale', start: 1_790_000_000_000, seed: 42 };

  it('are nowhere before they start and after they end, and the same everywhere in between', () => {
    expect(celebAt(v, v.start - 1)).toBeNull();
    expect(celebAt(v, visitEnd(v))).toBeNull();
    expect(visitEnd(v)).toBe(v.start + routeOfVisit(v).secs * 1000);
    expect(routeOfVisit(v).route).toBe(ROUTES.boutique);
    for (let t = v.start; t < visitEnd(v); t += 7_919) {
      // the server's check and every client's drawing call the same pure function
      expect(celebAt({ ...v }, t)).toEqual(celebAt(v, t));
    }
    const first = celebAt(v, v.start)!;
    expect([first.x, first.z]).toEqual([0, 14.2]);
  });

  it('an unknown celebrity id is nobody', () => {
    expect(celebOf('elvis')).toBeNull();
    expect(celebOf(7)).toBeNull();
    expect(celebOf('harlow')?.name).toBe('Dex Harlow');
  });
});

describe('tips and gift boxes', () => {
  it('tips are whole hundreds from $500 to $10,000, mostly small, rarely big', () => {
    const rand = unit(2026);
    const n = 200_000;
    let big = 0;
    let small = 0;
    let sum = 0;
    const seen = new Set<number>();
    let odd = 0;
    for (let i = 0; i < n; i++) {
      const t = rollTip(rand);
      if (t % 10_000 !== 0 || t < TIP_MIN || t > TIP_MAX) odd++;
      if (t > 500_000) big++;
      if (t <= 200_000) small++;
      sum += t;
      seen.add(t);
    }
    expect(odd).toBe(0);
    // every amount in the band turns up, the ends included
    expect(seen.size).toBe(96);
    expect(seen.has(TIP_MIN) && seen.has(TIP_MAX)).toBe(true);
    // 5% above $5,000, at least 70% at $2,000 or less (the $2,000s of the middle band too)
    expect(big / n).toBeGreaterThan(0.045);
    expect(big / n).toBeLessThan(0.055);
    expect(small / n).toBeGreaterThan(0.7);
    // $2,125 on average: 0.7 x $1,250 + 0.25 x $3,500 + 0.05 x $7,500
    expect(sum / n / 100).toBeGreaterThan(2_095);
    expect(sum / n / 100).toBeLessThan(2_155);
  });

  it('the extremes of the generator stay in the band', () => {
    expect(rollTip(() => 0)).toBe(TIP_MIN);
    expect(rollTip(() => 0.999999999)).toBe(TIP_MAX);
    expect(rollGift(() => 0)).toBe(GIFT_MIN);
    expect(rollGift(() => 0.999999999)).toBe(GIFT_MAX);
  });

  it('gift boxes hold $1,000 to $5,000 in steps of $250', () => {
    const rand = unit(7);
    const seen = new Set<number>();
    for (let i = 0; i < 20_000; i++) {
      const g = rollGift(rand);
      expect(g % 25_000).toBe(0);
      expect(g).toBeGreaterThanOrEqual(GIFT_MIN);
      expect(g).toBeLessThanOrEqual(GIFT_MAX);
      seen.add(g);
    }
    expect(seen.size).toBe(17);
  });
});

describe('the daily bonus', () => {
  it('pays more each day for seven days, then the seventh every day', () => {
    expect(DAILY_AMOUNTS).toHaveLength(7);
    for (let i = 1; i < 7; i++) expect(DAILY_AMOUNTS[i]!).toBeGreaterThan(DAILY_AMOUNTS[i - 1]!);
    expect(dailyAmount(1)).toBe(DAILY_AMOUNTS[0]);
    expect(dailyAmount(7)).toBe(DAILY_AMOUNTS[6]);
    expect(dailyAmount(30)).toBe(DAILY_AMOUNTS[6]);
    expect(dailyAmount(0)).toBe(DAILY_AMOUNTS[0]);
  });

  it('knows the day before, over months, years and leap days', () => {
    expect(prevDay('2026-09-25')).toBe('2026-09-24');
    expect(prevDay('2026-10-01')).toBe('2026-09-30');
    expect(prevDay('2027-01-01')).toBe('2026-12-31');
    expect(prevDay('2028-03-01')).toBe('2028-02-29');
    expect(prevDay('2027-03-01')).toBe('2027-02-28');
    // the clocks changing makes no difference to a date
    expect(prevDay('2027-03-15')).toBe('2027-03-14');
    expect(() => prevDay('yesterday')).toThrow();
  });

  it('keeps days as numbers in the tally and reads them back', () => {
    expect(dayNumber('2026-09-25')).toBe(20260925);
    expect(numberDay(20260925)).toBe('2026-09-25');
    expect(numberDay(0)).toBeNull();
    expect(numberDay(1.5)).toBeNull();
  });

  it('a claim the day after carries the streak on; later starts again; the same day is refused', () => {
    expect(streakAfterClaim(null, 0, '2026-09-25')).toBe(1);
    expect(streakAfterClaim('2026-09-24', 3, '2026-09-25')).toBe(4);
    expect(streakAfterClaim('2026-09-23', 3, '2026-09-25')).toBe(1);
    expect(streakAfterClaim('2026-09-25', 3, '2026-09-25')).toBeNull();
    expect(streakAfterClaim('2026-12-31', 9, '2027-01-01')).toBe(10);
  });

  it('says where a streak stands and what the next claim pays', () => {
    expect(dailyState(null, 0, '2026-09-25')).toEqual({ streak: 0, claimed: false, next: 1 });
    expect(dailyState('2026-09-24', 2, '2026-09-25')).toEqual({ streak: 2, claimed: false, next: 3 });
    expect(dailyState('2026-09-25', 3, '2026-09-25')).toEqual({ streak: 3, claimed: true, next: 4 });
    expect(dailyState('2026-09-20', 5, '2026-09-25')).toEqual({ streak: 0, claimed: false, next: 1 });
    expect(dailyState('2026-09-24', 12, '2026-09-25')).toEqual({ streak: 12, claimed: false, next: 7 });
  });
});

describe('floor messages', () => {
  it('takes a word or a box by its id and nothing else', () => {
    expect(parseCelebMsg({ t: 'celeb.talk', visit: 1790000000000 })).toEqual({ t: 'celeb.talk', visit: 1790000000000 });
    expect(parseCelebMsg({ t: 'gift.open', id: 5, extra: 1 })).toEqual({ t: 'gift.open', id: 5 });
    for (const bad of [null, 3, 'x', {}, { t: 'celeb.talk' }, { t: 'celeb.talk', visit: '1' }, { t: 'celeb.talk', visit: 1.5 }, { t: 'celeb.talk', visit: -1 }, { t: 'gift.open', id: 0 }, { t: 'mv', x: 1 }]) {
      expect(parseCelebMsg(bad)).toBeNull();
    }
  });
});
