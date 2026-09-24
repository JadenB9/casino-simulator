// The bar's side of an order, from the moment it's paid until it leaves your hand. An order is
// paid at once (POST /bar/order) and then brought over. Until the floor has waiters, it's handed
// over after a short wait; a waiter takes over by calling deliverWith() and hearing onOrder(),
// then calling world.holdItem(order.id) (which lands in hold() here) when it reaches you.
//
// Holding is part of your look (look.held), so everyone on the floor sees it, and the server
// keeps it only while it's a recent paid order of yours. It leaves your hand when its time is up
// (HOLD_MS after it was paid), when you sit down at a table, or when you put it down.

import type { Cents } from '../../../../shared/src/money.ts';
import type { BarOrder, OrderResponse } from '../../../../shared/src/items.ts';
import type { Held, Look } from '../../../../shared/src/look.ts';
import type { SessionLike } from '../menu/deps.ts';
import { serverNow } from '../../net/clock.ts';

export interface BarDeps {
  session: SessionLike;
  api: { order(item: string, op: string): Promise<OrderResponse>; saveLook(look: Look): Promise<Look> };
  /** Whether you're at a table (an order waits for you to stand up before it's handed over). */
  seated(): boolean;
  /** Hear when you sit down at a table: what you hold is put down. */
  onSit(fn: () => void): () => void;
  /** How long an order takes to arrive when nobody brings it (ms). */
  delay?: number;
}

/** How long an order takes to reach you when there are no waiters yet. */
export const DELIVERY_MS = 4000;

/** Take on money numbers a purchase answered with, if they're the newest (rev) the session has seen. */
export function applyMoney(session: SessionLike, m: { balance: Cents; inPlay: Cents; rev: number }): void {
  const p = session.profile;
  if (!p || m.rev < p.rev) return;
  session.set({ ...p, balance: m.balance, inPlay: m.inPlay, rev: m.rev });
}

export class Bar {
  /** Paid for, not yet in your hand, oldest first. */
  private readonly queue: BarOrder[] = [];
  private readonly orderFns = new Set<(o: BarOrder) => void>();
  private readonly changeFns = new Set<() => void>();
  private waiters: ((o: BarOrder) => void) | null = null;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private readonly offs: (() => void)[];
  /** Look changes go out one at a time, in order. */
  private chain: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(private readonly deps: BarDeps) {
    this.offs = [deps.onSit(() => void this.drop()), deps.session.on(() => this.watchExpiry())];
    this.watchExpiry();
  }

  /** Orders paid for and on their way, oldest first. */
  get pending(): readonly BarOrder[] {
    return this.queue;
  }

  /** What's in your hand, or null (nothing, or its time is up). */
  held(): Held | null {
    const h = this.deps.session.profile?.look.held;
    return h && h.until > serverNow() ? h : null;
  }

  /** Order one item: paid now from your balance, brought to you after. */
  async order(item: string): Promise<BarOrder> {
    const r = await this.deps.api.order(item, crypto.randomUUID());
    applyMoney(this.deps.session, r);
    this.queue.push(r.order);
    for (const fn of this.orderFns) fn(r.order);
    this.changed();
    if (this.waiters) this.waiters(r.order);
    else this.later(() => void this.hold(r.order.id), this.deps.delay ?? DELIVERY_MS);
    return r.order;
  }

  /**
   * Hand an order over: it goes in your right hand, where everyone can see it. `id` is the
   * order's id, or an item id for the newest paid order of that item.
   */
  async hold(id: string): Promise<void> {
    let i = this.queue.findIndex((o) => o.id === id);
    if (i < 0) i = this.queue.map((o) => o.item).lastIndexOf(id);
    if (i < 0) return;
    const o = this.queue[i]!;
    if (this.deps.seated()) {
      // at a table: it waits by your seat until you stand up
      this.later(() => void this.hold(o.id), 2000);
      return;
    }
    this.queue.splice(i, 1);
    if (o.until <= serverNow()) {
      this.changed();
      return;
    }
    await this.setHeld({ item: o.item, order: o.id, until: o.until });
  }

  /** Put down what you're holding. */
  async drop(): Promise<void> {
    if (!this.deps.session.profile?.look.held) return;
    await this.setHeld(null);
  }

  /** Hear each order as it's paid for (the waiters walk it over). */
  onOrder(fn: (o: BarOrder) => void): () => void {
    this.orderFns.add(fn);
    return () => this.orderFns.delete(fn);
  }

  /** Hear when what's on its way or in your hand changes (the menu's status line). */
  onChange(fn: () => void): () => void {
    this.changeFns.add(fn);
    return () => this.changeFns.delete(fn);
  }

  /** Waiters take over delivery: each new order goes to `fn`, and nothing arrives on its own. Null hands it back. */
  deliverWith(fn: ((o: BarOrder) => void) | null): void {
    this.waiters = fn;
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    clearTimeout(this.expiry);
    for (const off of this.offs) off();
    this.orderFns.clear();
    this.changeFns.clear();
  }

  private setHeld(h: Held | null): Promise<void> {
    const run = async () => {
      const p = this.deps.session.profile;
      if (!p || this.disposed) return;
      const next: Look = { ...p.look };
      if (h) next.held = h;
      else delete next.held;
      const stored = await this.deps.api.saveLook(next);
      const now = this.deps.session.profile;
      if (now) this.deps.session.set({ ...now, look: stored });
      this.changed();
    };
    this.chain = this.chain.then(run, run).catch((err) => console.warn('bar: holding failed', err));
    return this.chain;
  }

  /** Put it down when its time is up, so the stored look doesn't keep an order that's gone. */
  private watchExpiry(): void {
    clearTimeout(this.expiry);
    const h = this.deps.session.profile?.look.held;
    if (!h || this.disposed) return;
    const left = h.until - serverNow();
    if (left <= 0) {
      void this.drop();
      return;
    }
    this.expiry = setTimeout(() => void this.drop(), Math.min(2 ** 31 - 1, left + 250));
  }

  private later(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.disposed) fn();
    }, ms);
    this.timers.add(t);
  }

  private changed(): void {
    for (const fn of this.changeFns) fn();
  }
}
