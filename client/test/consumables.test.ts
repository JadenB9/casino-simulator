// Drinking and eating a held order: the timetable every screen works out the same way, your own
// sips on top of it, what's left in the glass, and what each item does for you afterwards.

import { describe, expect, it } from 'vitest';
import { BAR_MENU, HOLD_MS, barItem } from '../../shared/src/items.ts';
import { ACT_SECS, END_MS, FIRST_MS, GAP_MS, LATE_MS, PROFILES, acts, planFor, profileOf, stateAt, weights, type Act } from '../src/world/consumables/schedule.ts';
import { Effects, ITEM_EFFECTS, PACE_CAP, SOBER_MS, TIPSY_MAX } from '../src/world/consumables/effects.ts';

const T0 = 1_700_000_000_000;
/** An order paid at T0, handed over 30 s later. */
const order = (item: string, id = 'op-abcdef1234') => ({ item, id, until: T0 + HOLD_MS, seen: T0 + 30_000 });

describe('the timetable', () => {
  it('knows how every item on the menu is had', () => {
    for (const it of BAR_MENU) {
      const p = PROFILES[it.id];
      expect(p, it.id).toBeDefined();
      expect(p!.portions, it.id).toBeGreaterThanOrEqual(3);
      expect(p!.act === 'bite', it.id).toBe(it.kind === 'food');
    }
    // something not on the list is still had like its kind
    expect(profileOf('mystery').act).toBe('sip');
  });

  it('is the same on every screen that saw the hand-over', () => {
    const o = order('beer');
    const a = planFor(o.item, o.id, o.until, o.seen);
    const b = planFor(o.item, o.id, o.until, o.seen);
    expect(a.at).toEqual(b.at);
    // another order of the same thing falls a little differently
    const c = planFor(o.item, 'op-zzzzzz9999', o.until, o.seen);
    expect(c.at).not.toEqual(a.at);
  });

  it('spreads every portion over the time in hand, starting soon and done before it must go', () => {
    for (const it of BAR_MENU) {
      const o = order(it.id);
      const plan = planFor(it.id, o.id, o.until, o.seen);
      const p = profileOf(it.id);
      expect(plan.at.length, it.id).toBe(p.portions + (p.opener ? 1 : 0));
      expect(plan.at[0]!, it.id).toBeGreaterThanOrEqual(o.seen + FIRST_MS);
      expect(plan.at[0]!, it.id).toBeLessThan(o.seen + FIRST_MS + 30_000);
      const had = acts(plan);
      const s = stateAt(plan, had, o.until);
      expect(s.done, it.id).toBe(true);
      expect(s.doneAt, it.id).toBeLessThanOrEqual(o.until - END_MS + 1);
      // never two at once
      for (let i = 1; i < plan.at.length; i++) {
        const len = i === 1 && p.opener ? ACT_SECS[p.opener] * 1000 : ACT_SECS[p.act] * 1000;
        expect(plan.at[i]! - plan.at[i - 1]!, `${it.id} ${i}`).toBeGreaterThanOrEqual(len + GAP_MS);
      }
    }
  });

  it('opens a Dom with the spray and a cake with the candles before the first portion', () => {
    for (const [item, first] of [['dom', 'spray'], ['birthday-cake', 'blow']] as const) {
      const o = order(item);
      const plan = planFor(item, o.id, o.until, o.seen);
      const had = acts(plan);
      const s = stateAt(plan, had, had.acts[0]! + 100);
      expect(s.act?.kind).toBe(first);
      expect(s.act?.portion).toBe(-1);
      expect(s.opened).toBe(false);
      expect(s.level).toBe(1);
      const after = stateAt(plan, had, had.acts[0]! + ACT_SECS[first] * 1000 + 10);
      expect(after.opened).toBe(true);
      expect(after.taken).toBe(0);
    }
  });

  it('empties the glass sip by sip, easing down during each sip', () => {
    const o = order('red-wine');
    const plan = planFor(o.item, o.id, o.until, o.seen);
    const had = acts(plan);
    expect(stateAt(plan, had, o.seen).level).toBe(1);
    const t0 = had.acts[0]!;
    const ms = ACT_SECS.sip * 1000;
    const mid = stateAt(plan, had, t0 + ms * 0.5);
    expect(mid.act?.kind).toBe('sip');
    expect(mid.level).toBeLessThan(1);
    expect(mid.level).toBeGreaterThan(1 - 1 / 6);
    const after = stateAt(plan, had, t0 + ms + 1);
    expect(after.act).toBeNull();
    expect(after.taken).toBe(1);
    expect(after.level).toBeCloseTo(5 / 6, 9);
    // level only ever goes down
    let last = 1;
    for (let t = o.seen; t < o.until; t += 250) {
      const l = stateAt(plan, had, t).level;
      expect(l).toBeLessThanOrEqual(last + 1e-12);
      last = l;
    }
    expect(last).toBe(0);
  });

  it('takes a bite whole at the mouth', () => {
    const o = order('sliders');
    const plan = planFor(o.item, o.id, o.until, o.seen);
    const had = acts(plan);
    const t0 = had.acts[1]!;
    const ms = ACT_SECS.bite * 1000;
    expect(stateAt(plan, had, t0 + ms * 0.3).taken).toBe(1);
    expect(stateAt(plan, had, t0 + ms * 0.55).taken).toBe(2);
  });

  it('adds your own sips on top: the next portion, sooner, and it is finished sooner', () => {
    const o = order('whiskey');
    const plan = planFor(o.item, o.id, o.until, o.seen);
    const base = acts(plan);
    const now = o.seen + 2_000;
    const mine = acts(plan, [now, now + 100]);
    // the first is had now; the second waits its turn rather than overlapping it
    expect(mine.acts[0]).toBe(now);
    expect(mine.acts[1]).toBe(now + ACT_SECS.sip * 1000 + GAP_MS);
    expect(mine.acts.length).toBe(4);
    expect(stateAt(plan, mine, o.until).doneAt).toBeLessThan(stateAt(plan, base, o.until).doneAt);
    expect(stateAt(plan, mine, now + ACT_SECS.sip * 1000 + 10).taken).toBe(1);
    // more sips than the glass holds count for nothing
    const lots = acts(plan, Array.from({ length: 20 }, (_, i) => now + i * 10_000));
    expect(lots.acts.length).toBe(4);
  });

  it('lets a timetabled sip go when one of yours is still going', () => {
    const o = order('beer');
    const plan = planFor(o.item, o.id, o.until, o.seen);
    const first = plan.at[0]!;
    const had = acts(plan, [first - 500]);
    expect(had.acts[0]).toBe(first - 500);
    expect(had.acts[1]! - had.acts[0]!).toBeGreaterThanOrEqual(ACT_SECS.swig * 1000 + GAP_MS);
  });

  it('shows a latecomer the order partly gone, and fits the rest in', () => {
    const o = order('beer');
    const late = T0 + LATE_MS + 60_000;
    const plan = planFor(o.item, o.id, o.until, late);
    expect(plan.pre).toBeGreaterThan(0);
    expect(plan.pre).toBeLessThan(8);
    const had = acts(plan);
    expect(stateAt(plan, had, late).level).toBeCloseTo(1 - plan.pre / 8, 9);
    expect(stateAt(plan, had, o.until).done).toBe(true);
    // a hand-over after a slow walk is not a latecomer
    expect(planFor(o.item, o.id, o.until, T0 + 90_000).pre).toBe(0);
  });

  it('works on a dev hold longer than the bar allows', () => {
    const seen = T0;
    const plan = planFor('champagne', 'dev-order-0001', seen + 3_600_000, seen);
    expect(plan.at[0]!).toBeLessThan(seen + 20_000);
    expect(stateAt(plan, acts(plan), seen + HOLD_MS).done).toBe(true);
  });
});

describe('arm weights', () => {
  it('start and end at rest, and never pass all the way', () => {
    for (const kind of ['sip', 'swig', 'bite', 'spray', 'blow'] as Act[]) {
      for (const t of [0, 1]) for (const v of Object.values(weights(kind, t))) expect(v, `${kind} ${t}`).toBe(0);
      for (let t = 0; t <= 1; t += 0.01) {
        const w = weights(kind, t);
        for (const [k, v] of Object.entries(w)) {
          expect(v, `${kind} ${k} ${t}`).toBeGreaterThanOrEqual(0);
          expect(v, `${kind} ${k} ${t}`).toBeLessThanOrEqual(1.25);
        }
      }
    }
  });

  it('has the glass at the lips while a sip goes down', () => {
    const w = weights('sip', 0.5);
    expect(w.tip).toBe(1);
    const b = weights('bite', 0.5);
    expect(b.eat).toBe(1);
  });
});

describe('effects', () => {
  it('never touches money: every effect is a pace, a look or a mood', () => {
    for (const [id, e] of Object.entries(ITEM_EFFECTS)) {
      expect(barItem(id), id).not.toBeNull();
      expect(Object.keys(e).every((k) => ['tipsy', 'pace', 'bubbly', 'party', 'fed'].includes(k)), id).toBe(true);
    }
  });

  it('speeds you up with an espresso, for a while, and stacks the time but not the speed', () => {
    const fx = new Effects();
    expect(fx.paceNow(T0)).toBe(1);
    fx.portion('espresso', T0, true);
    fx.portion('espresso', T0 + 1000, false);
    expect(fx.paceNow(T0 + 1000)).toBe(1.2);
    expect(fx.paceNow(T0 + 3 * 60_000 + 1)).toBe(1);
    fx.portion('espresso', T0, true);
    fx.portion('espresso', T0 + 10, true);
    expect(fx.paceNow(T0 + 5 * 60_000)).toBe(1.2);
    // an energy drink on top: the faster one, never past the cap
    fx.portion('energy-drink', T0 + 20, true);
    expect(fx.paceNow(T0 + 30)).toBe(1.3);
    for (let i = 0; i < 20; i++) fx.portion('energy-drink', T0 + 40 + i, true);
    expect(fx.paceNow(T0 + 100)).toBeLessThanOrEqual(PACE_CAP);
    // the time stacks only so far
    expect(fx.paceNow(T0 + 9 * 60_000)).toBe(1);
  });

  it('keeps even a boosted run well under the floor server limit', () => {
    // player.ts runs at 4.8 m/s; the floor server lets a walker go 9 m/s
    expect(4.8 * PACE_CAP).toBeLessThan(9 * 0.75);
  });

  it('gets you tipsy with how many you have had, and wears off', () => {
    const fx = new Effects();
    for (let i = 0; i < 6; i++) fx.portion('red-wine', T0, i === 0);
    expect(fx.tipsyNow(T0)).toBeCloseTo(1, 9);
    expect(fx.sway(T0)).toBeGreaterThan(0);
    const one = fx.sway(T0);
    for (let i = 0; i < 4; i++) fx.portion('whiskey', T0, i === 0);
    expect(fx.sway(T0)).toBeGreaterThan(one);
    expect(fx.chips(T0).find((c) => c.id === 'tipsy')).toBeDefined();
    // one drink's worth wears off every SOBER_MS
    expect(fx.tipsyNow(T0 + SOBER_MS)).toBeCloseTo(fx.tipsyNow(T0) - 1, 9);
    expect(fx.sway(T0 + 60 * 60_000)).toBe(0);
    // never more than TIPSY_MAX
    for (let i = 0; i < 100; i++) fx.portion('whiskey', T0, false);
    expect(fx.tipsyNow(T0)).toBe(TIPSY_MAX);
    expect(fx.sway(T0)).toBe(1);
  });

  it('sobers you up twice as fast on a full stomach', () => {
    const a = new Effects();
    const b = new Effects();
    for (const fx of [a, b]) for (let i = 0; i < 8; i++) fx.portion('beer', T0, i === 0);
    b.finished('ribeye', T0);
    expect(b.isFed(T0 + 1000)).toBe(true);
    const t = T0 + SOBER_MS / 2;
    expect(1 - b.tipsyNow(t)).toBeCloseTo(2 * (1 - a.tipsyNow(t)), 9);
  });

  it('shows a timed chip for each thing on you', () => {
    const fx = new Effects();
    fx.portion('champagne', T0, true);
    fx.portion('espresso', T0, true);
    fx.finished('lobster', T0);
    const chips = fx.chips(T0 + 1000);
    expect(chips.map((c) => c.id).sort()).toEqual(['bubbly', 'fed', 'wired']);
    for (const c of chips) expect(c.left).toBeGreaterThan(0);
    expect(fx.chips(T0 + 60 * 60_000)).toEqual([]);
    // a second plate adds its time, only so far
    fx.finished('lobster', T0);
    fx.finished('lobster', T0);
    expect(fx.isFed(T0 + 12 * 60_000 + 1)).toBe(false);
  });
});
