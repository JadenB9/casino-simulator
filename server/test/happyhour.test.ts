// Happy hour at the bar (shared/src/happyhour.ts, server/src/happy.ts): an order paid inside the
// window costs half, one paid a millisecond either side costs the full price, the order's row keeps
// what was actually paid (so every cent is still accounted for), a retry is the order that landed
// whenever it's retried, and the floor tells everyone when happy hour is.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { HAPPY_CYCLE_MS, halfPrice, happyHourOf, nextHappyHour, type HappyHour } from '../../shared/src/happyhour.ts';
import { barItem } from '../../shared/src/items.ts';
import { STARTING_BALANCE } from '../../shared/src/money.ts';
import { api, connect } from './helpers.ts';
import { clockAt, player, type Player } from './party.ts';

afterEach(() => {
  vi.useRealTimers();
});

const BEER = barItem('beer')!;
const WINE = barItem('red-wine')!;
let opSeq = 0;
const op = () => `happy-op-${++opSeq}-${Math.random().toString(36).slice(2, 8)}`;
const order = (p: Player, item: string, opId = op()) => api('bar/order', p.token, { method: 'POST', body: JSON.stringify({ item, op: opId }) });

async function balance(id: number): Promise<number> {
  return (await env.DB.prepare(`SELECT balance FROM casino_accounts WHERE id = ?1`).bind(id).first<{ balance: number }>())!.balance;
}

async function expectBalanced(id: number): Promise<void> {
  const n = async (sql: string) => (await env.DB.prepare(sql).bind(id).first<{ n: number }>())!.n;
  const ledger = await n(`SELECT COALESCE(SUM(amount), 0) AS n FROM casino_ledger WHERE account_id = ?1`);
  const items = await n(`SELECT COALESCE(SUM(price), 0) AS n FROM casino_items WHERE account_id = ?1`);
  const orders = await n(`SELECT COALESCE(SUM(price), 0) AS n FROM casino_orders WHERE account_id = ?1`);
  expect(ledger - items - orders).toBe(await balance(id));
}

/** The next scheduled happy hour that starts after now. */
function upcoming(): HappyHour {
  const now = Date.now();
  const k = Math.floor(now / HAPPY_CYCLE_MS);
  const h = happyHourOf(k);
  return h.start > now + 1_000 ? h : happyHourOf(k + 1);
}

describe('happy hour at the bar', () => {
  it('charges half from the first millisecond to the last, and full either side', async () => {
    const h = upcoming();
    clockAt(h.start - 60_000);
    const p = await player('hh_edges');
    const paid: number[] = [];
    for (const at of [h.start - 1, h.start, h.end - 1, h.end]) {
      clockAt(at);
      const res = await order(p, 'beer');
      expect(res.status).toBe(200);
      paid.push((await res.json<any>()).order.price);
    }
    expect(paid).toEqual([BEER.price, halfPrice(BEER.price), halfPrice(BEER.price), BEER.price]);
    expect(halfPrice(BEER.price)).toBe(450);
    // the rows keep what was paid, and the balance lost exactly that
    const rows = await env.DB.prepare(`SELECT price FROM casino_orders WHERE account_id = ?1 ORDER BY created_at`).bind(p.id).all<{ price: number }>();
    expect(rows.results.map((r) => r.price)).toEqual(paid);
    expect(await balance(p.id)).toBe(STARTING_BALANCE - paid.reduce((a, b) => a + b, 0));
    await expectBalanced(p.id);
  });

  it('a retry is the order that landed, at the price it was paid, whenever it comes', async () => {
    const h = upcoming();
    clockAt(h.start + 5_000);
    const p = await player('hh_retry');
    const cheap = op();
    const first = await (await order(p, 'red-wine', cheap)).json<any>();
    expect(first.order.price).toBe(halfPrice(WINE.price));
    // after happy hour, the same op: the same half-price order, nothing more taken
    clockAt(h.end + 60_000);
    const again = await (await order(p, 'red-wine', cheap)).json<any>();
    expect(again.order).toEqual(first.order);
    expect(await balance(p.id)).toBe(STARTING_BALANCE - halfPrice(WINE.price));
    // and the other way round: a full-price order retried in the next happy hour stays full price
    const next = happyHourOf(Math.floor(h.start / HAPPY_CYCLE_MS) + 1);
    const full = op();
    clockAt(next.start - 10_000);
    const late = await (await order(p, 'beer', full)).json<any>();
    expect(late.order.price).toBe(BEER.price);
    clockAt(next.start + 10_000);
    expect((await (await order(p, 'beer', full)).json<any>()).order.price).toBe(BEER.price);
    expect(await balance(p.id)).toBe(STARTING_BALANCE - halfPrice(WINE.price) - BEER.price);
    await expectBalanced(p.id);
  });

  it("says the happy-hour price when the balance can't cover the full one either", async () => {
    const h = upcoming();
    clockAt(h.start + 1_000);
    const p = await player('hh_short');
    await env.DB.prepare(`UPDATE casino_accounts SET balance = 400 WHERE id = ?1`).bind(p.id).run();
    const res = await order(p, 'beer');
    expect(res.status).toBe(409);
    expect((await res.json<any>()).msg).toContain('$4.50');
    // $4.50 exactly is enough in happy hour, not a cent more is taken
    await env.DB.prepare(`UPDATE casino_accounts SET balance = 450 WHERE id = ?1`).bind(p.id).run();
    expect((await order(p, 'beer')).status).toBe(200);
    expect(await balance(p.id)).toBe(0);
  });

  it('the floor tells a newcomer when happy hour is, the same as the Worker prices it', async () => {
    const p = await player('hh_floor');
    const { client } = await connect('floor', p.token, '', p.ip);
    const hi = await client!.next<any>((m) => m.t === 'celebs');
    expect(hi.happy).toEqual(nextHappyHour(Date.now()));
    expect(hi.happy.end - hi.happy.start).toBe(15 * 60_000);
    client!.ws.close();
  });

  it('on the dev stack a happy hour can be started by hand: the price and the floor both hear of it', async () => {
    const p = await player('hh_dev');
    const { client } = await connect('floor', p.token, '', p.ip);
    await client!.next((m) => m.t === 'celebs');
    // well clear of a scheduled one
    const res = await api('dev/happy', p.token, { method: 'POST', body: JSON.stringify({ ms: 60_000 }) });
    expect(res.status).toBe(200);
    const h = (await res.json<any>()).happy;
    expect(h.end - h.start).toBe(60_000);
    expect((await client!.next<any>((m) => m.t === 'happy')).happy).toEqual(h);
    expect((await (await order(p, 'beer')).json<any>()).order.price).toBe(halfPrice(BEER.price));
    clockAt(h.end + 1);
    const after = (await (await order(p, 'beer')).json<any>()).order.price;
    expect([BEER.price, halfPrice(BEER.price)]).toContain(after);
    await env.DB.prepare(`DELETE FROM casino_rate WHERE k = 'dev:happy'`).run();
    client!.ws.close();
    await expectBalanced(p.id);
  });
});
