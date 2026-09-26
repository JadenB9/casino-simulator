// The bar's orders from paying to your hand: paid at once, handed over after a moment (or by a
// waiter), put down when you sit down or when the time is up, and never twice.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bar } from '../src/ui/shop/bar.ts';
import { HOLD_MS, type OrderResponse } from '../../shared/src/items.ts';
import { DEFAULT_LOOK, type Look } from '../../shared/src/look.ts';
import type { Profile } from '../../shared/src/protocol.ts';

function profile(): Profile {
  return {
    id: 1, name: 'tester', look: { ...DEFAULT_LOOK }, createdAt: 0, balance: 100_000, inPlay: 0, rev: 1, tables: [], loansTaken: 0, loans: [],
    stats: { total: { rounds: 0, wagered: 0, net: 0, biggestWin: 0 }, games: {} },
  };
}

function rig() {
  const fns = new Set<(p: Profile) => void>();
  const session = {
    profile: profile() as Profile | null,
    set(p: Profile) {
      this.profile = p;
      for (const fn of fns) fn(p);
    },
    on(fn: (p: Profile) => void) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
  };
  const sits = new Set<() => void>();
  const saved: Look[] = [];
  let seated = false;
  let rev = 1;
  const api = {
    order: vi.fn(async (item: string, op: string): Promise<OrderResponse> => {
      const at = Date.now();
      const price = item === 'dom' ? 120_000 : 3_200;
      return { order: { id: op, item, price, at, until: at + HOLD_MS }, balance: session.profile!.balance - price, inPlay: 0, rev: ++rev };
    }),
    saveLook: vi.fn(async (look: Look) => {
      saved.push(look);
      return look;
    }),
  };
  const bar = new Bar({ session, api, seated: () => seated, onSit: (fn) => (sits.add(fn), () => sits.delete(fn)), delay: 4000 });
  return { bar, session, api, saved, sit: () => sits.forEach((fn) => fn()), setSeated: (on: boolean) => (seated = on) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the bar', () => {
  it('takes the money at once and hands the order over after a moment', async () => {
    const { bar, session, saved } = rig();
    const order = await bar.order('champagne');
    expect(session.profile!.balance).toBe(100_000 - 3_200);
    expect(bar.pending.map((o) => o.item)).toEqual(['champagne']);
    expect(session.profile!.look.held).toBeUndefined();
    await vi.advanceTimersByTimeAsync(4000);
    expect(bar.pending).toEqual([]);
    expect(session.profile!.look.held).toEqual({ item: 'champagne', order: order.id, until: order.until });
    expect(saved).toHaveLength(1);
    expect(bar.held()?.item).toBe('champagne');
  });

  it('lets waiters bring it: nothing arrives on its own, and holdItem takes the order id or the item', async () => {
    const { bar, session } = rig();
    const heard: string[] = [];
    bar.onOrder((o) => heard.push(o.item));
    const walking: string[] = [];
    bar.deliverWith((o) => walking.push(o.id));
    const a = await bar.order('beer');
    const b = await bar.order('sliders');
    expect(heard).toEqual(['beer', 'sliders']);
    expect(walking).toEqual([a.id, b.id]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(session.profile!.look.held).toBeUndefined();
    await bar.hold('sliders');
    expect(session.profile!.look.held?.order).toBe(b.id);
    // v7.4: the hand is full: the beer waits its turn instead of knocking the sliders out
    await bar.hold(a.id);
    expect(session.profile!.look.held?.order).toBe(b.id);
    expect(bar.waiting).toBe(1);
    // the sliders leave your hand: the beer comes to it
    await bar.drop();
    expect(session.profile!.look.held?.order).toBe(a.id);
    expect(bar.pending).toEqual([]);
    expect(bar.waiting).toBe(0);
    // an order that isn't pending (already handed over, or never paid) does nothing
    await bar.hold(a.id);
    await bar.hold('lobster');
    expect(session.profile!.look.held?.order).toBe(a.id);
  });

  it('queues a round: three orders brought at once come to hand one after another, oldest first', async () => {
    const { bar, session } = rig();
    const a = await bar.order('beer');
    const b = await bar.order('whiskey');
    const c = await bar.order('sliders');
    await vi.advanceTimersByTimeAsync(5000);
    expect(session.profile!.look.held?.order).toBe(a.id);
    expect(bar.waiting).toBe(2);
    await bar.drop();
    expect(session.profile!.look.held?.order).toBe(b.id);
    await bar.drop();
    expect(session.profile!.look.held?.order).toBe(c.id);
    await bar.drop();
    expect(session.profile!.look.held).toBeUndefined();
  });

  it('puts it down when you sit at a table, and waits by your seat for one on its way', async () => {
    const { bar, session, sit, setSeated } = rig();
    await bar.order('whiskey');
    await vi.advanceTimersByTimeAsync(4000);
    expect(session.profile!.look.held?.item).toBe('whiskey');
    setSeated(true);
    sit();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.profile!.look.held).toBeUndefined();
    await bar.order('espresso');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(session.profile!.look.held).toBeUndefined();
    setSeated(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(session.profile!.look.held?.item).toBe('espresso');
  });

  it('puts it down when its time is up, so the stored look lets go too', async () => {
    const { bar, session, saved } = rig();
    await bar.order('cocktail');
    await vi.advanceTimersByTimeAsync(4000);
    expect(bar.held()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    expect(bar.held()).toBeNull();
    expect(session.profile!.look.held).toBeUndefined();
    expect(saved.at(-1)?.held).toBeUndefined();
  });

  it('a refused order leaves nothing on its way and the money alone', async () => {
    const { bar, session, api } = rig();
    api.order.mockRejectedValueOnce(Object.assign(new Error('Not enough'), { status: 409, body: { error: 'INSUFFICIENT_FUNDS', msg: 'Not enough' } }));
    await expect(bar.order('dom')).rejects.toThrow('Not enough');
    expect(bar.pending).toEqual([]);
    expect(session.profile!.balance).toBe(100_000);
  });

  it('stops everything when disposed', async () => {
    const { bar, session } = rig();
    await bar.order('beer');
    bar.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(session.profile!.look.held).toBeUndefined();
  });
});
