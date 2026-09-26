// The boutique and the bar: buying from the balance only, one charge per purchase however often
// it's retried, owning for good, wearing only what you own, bar orders held in your hand, and
// every cent still accounted for:
//   SUM(ledger) - SUM(items.price) - SUM(orders.price) = balance + in_play.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { DEFAULT_LOOK } from '../../shared/src/look.ts';
import { DOLLAR, STARTING_BALANCE } from '../../shared/src/money.ts';
import { ORDER_LIFE_MS, SHOP_ITEMS, barItem, shopItem } from '../../shared/src/items.ts';
import { ORIGIN, TEST_PASSWORD, api, connect } from './helpers.ts';
import { awayFromHappyHour } from './quiet-bar.ts';

// v6 celebs6: these check full prices at the bar, so never inside a happy hour (happyhour.ts)
beforeEach(awayFromHappyHour);
afterEach(() => {
  vi.useRealTimers();
});

let ipSeq = 0;
let opSeq = 0;
const op = () => `test-op-${++opSeq}-${Math.random().toString(36).slice(2, 8)}`;

async function account(name: string): Promise<{ token: string; id: number }> {
  const res = await exports.default.fetch(
    new Request('http://casino.test/casino/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': `203.0.113.${++ipSeq}` },
      body: JSON.stringify({ name, password: TEST_PASSWORD }),
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.json<any>();
  return { token: body.token, id: body.profile.id };
}

/** Winnings, the way a table pays them: a cash-out ledger row and the balance, together. */
async function win(id: number, amount: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) VALUES (?1, ?2, 'cashout', ?3, 'test-table', ?4)`).bind(`win:${id}:${op()}`, id, amount, Date.now()),
    env.DB.prepare(`UPDATE casino_accounts SET balance = balance + ?2, rev = rev + 1 WHERE id = ?1`).bind(id, amount),
  ]);
}

async function money(id: number): Promise<{ balance: number; in_play: number; rev: number }> {
  return (await env.DB.prepare(`SELECT balance, in_play, rev FROM casino_accounts WHERE id = ?1`).bind(id).first<any>())!;
}

async function count(sql: string, ...args: unknown[]): Promise<number> {
  return (await env.DB.prepare(sql).bind(...args).first<{ n: number }>())!.n;
}

/**
 * Every cent accounted for: the ledger, less what the shop and the bar took, is the balance. (A
 * buy-in's ledger row is negative, so chips on a table are outside that sum; with none out, as
 * after a cash-out, it is the whole of balance + in_play.)
 */
async function expectBalanced(id: number): Promise<void> {
  const ledger = await count(`SELECT COALESCE(SUM(amount), 0) AS n FROM casino_ledger WHERE account_id = ?1`, id);
  const items = await count(`SELECT COALESCE(SUM(price), 0) AS n FROM casino_items WHERE account_id = ?1`, id);
  const orders = await count(`SELECT COALESCE(SUM(price), 0) AS n FROM casino_orders WHERE account_id = ?1`, id);
  const m = await money(id);
  expect(ledger - items - orders).toBe(m.balance);
  const escrow = await count(`SELECT COALESCE(SUM(amount), 0) AS n FROM casino_escrow WHERE account_id = ?1`, id);
  expect(m.in_play).toBe(escrow);
  if (m.in_play === 0) expect(ledger - items - orders).toBe(m.balance + m.in_play);
}

const buy = (token: string, item: unknown, opId: unknown = op()) => api('shop/buy', token, { method: 'POST', body: JSON.stringify({ item, op: opId }) });
const order = (token: string, item: unknown, opId: unknown = op()) => api('bar/order', token, { method: 'POST', body: JSON.stringify({ item, op: opId }) });
const putLook = (token: string, look: unknown) => api('me/look', token, { method: 'PUT', body: JSON.stringify({ look }) });
const me = async (token: string) => (await (await api('me', token)).json<any>()).profile;

const ROPE = shopItem('rope-chain')!;
const ICED = shopItem('iced-cuban')!;
const GRILL = shopItem('gold-top-six')!;
const BEER = barItem('beer')!;
const DOM = barItem('dom')!;

describe('GET /shop', () => {
  it('lists the catalog, what you own and your balance', async () => {
    const a = await account('shop_list');
    const res = await api('shop', a.token);
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.items.map((i: any) => i.id)).toEqual(SHOP_ITEMS.filter((i) => !i.reward).map((i) => i.id));
    expect(body.owned).toEqual([]);
    expect(body.balance).toBe(STARTING_BALANCE);
  });

  it('needs a login', async () => {
    const res = await exports.default.fetch(new Request('http://casino.test/casino/api/shop', { headers: { Origin: ORIGIN } }));
    expect(res.status).toBe(401);
  });
});

describe('POST /shop/buy', () => {
  it('refuses what you cannot afford, clearly, and changes nothing', async () => {
    const a = await account('shop_poor');
    const before = await money(a.id);
    const res = await buy(a.token, ROPE.id);
    expect(res.status).toBe(409);
    const body = await res.json<any>();
    expect(body.error).toBe('INSUFFICIENT_FUNDS');
    expect(body.msg).toBe('Not enough: the Rope Chain is $250,000 and your balance is $50,000.');
    expect(body.balance).toBe(STARTING_BALANCE);
    expect(await money(a.id)).toEqual(before);
    expect(await count(`SELECT count(*) AS n FROM casino_items WHERE account_id = ?1`, a.id)).toBe(0);
    await expectBalanced(a.id);
  });

  it('buys from the balance, owns it, and writes one purchase row with the price paid', async () => {
    const a = await account('shop_buyer');
    await win(a.id, 300_000 * DOLLAR);
    const before = await money(a.id);
    const res = await buy(a.token, ROPE.id);
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body).toMatchObject({ item: ROPE.id, price: ROPE.price, balance: before.balance - ROPE.price, inPlay: 0, rev: before.rev + 1 });
    expect(await money(a.id)).toMatchObject({ balance: before.balance - ROPE.price, in_play: 0 });
    const row = await env.DB.prepare(`SELECT item, price, bought_at, op_id FROM casino_items WHERE account_id = ?1`).bind(a.id).first<any>();
    expect(row).toMatchObject({ item: ROPE.id, price: ROPE.price, bought_at: body.at });
    expect(row.op_id).toMatch(new RegExp(`^shop:${a.id}:`));
    // the ledger itself is left alone: the purchase row is the record
    expect(await count(`SELECT count(*) AS n FROM casino_ledger WHERE account_id = ?1 AND kind NOT IN ('grant', 'cashout')`, a.id)).toBe(0);
    const shop = await (await api('shop', a.token)).json<any>();
    expect(shop.owned).toEqual([{ item: ROPE.id, price: ROPE.price, at: body.at }]);
    expect(shop.balance).toBe(before.balance - ROPE.price);
    await expectBalanced(a.id);
  });

  it('charges a retried purchase once and answers it with the purchase that landed', async () => {
    const a = await account('shop_retry');
    await win(a.id, 1_000_000 * DOLLAR);
    const id = op();
    const first = await (await buy(a.token, ROPE.id, id)).json<any>();
    const again = await buy(a.token, ROPE.id, id);
    expect(again.status).toBe(200);
    const body = await again.json<any>();
    expect(body).toMatchObject({ item: ROPE.id, price: ROPE.price, at: first.at, balance: first.balance });
    expect(await money(a.id)).toMatchObject({ balance: first.balance });
    expect(await count(`SELECT count(*) AS n FROM casino_items WHERE account_id = ?1`, a.id)).toBe(1);
    await expectBalanced(a.id);
  });

  it('refuses a second purchase of something you own, without charging', async () => {
    const a = await account('shop_twice');
    await win(a.id, 1_000_000 * DOLLAR);
    expect((await buy(a.token, ROPE.id)).status).toBe(200);
    const before = await money(a.id);
    const res = await buy(a.token, ROPE.id);
    expect(res.status).toBe(409);
    expect(await res.json<any>()).toMatchObject({ error: 'NOT_ELIGIBLE', msg: 'You already own the Rope Chain.' });
    expect(await money(a.id)).toEqual(before);
    await expectBalanced(a.id);
  });

  it('two clicks at once buy it once', async () => {
    const a = await account('shop_race');
    await win(a.id, 1_000_000 * DOLLAR);
    const before = await money(a.id);
    const [x, y] = await Promise.all([buy(a.token, ROPE.id), buy(a.token, ROPE.id)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect((await money(a.id)).balance).toBe(before.balance - ROPE.price);
    await expectBalanced(a.id);
  });

  it('pays from the balance only, never from chips on tables', async () => {
    const a = await account('shop_tables');
    await win(a.id, 250_000 * DOLLAR);
    // Most of it goes onto a table: worth is still enough, the balance isn't.
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) VALUES (?1, ?2, 'buyin', ?3, 'test-table', ?4)`).bind(`bi:${a.id}`, a.id, -200_000 * DOLLAR, Date.now()),
      env.DB.prepare(`UPDATE casino_accounts SET balance = balance - ?2, in_play = in_play + ?2 WHERE id = ?1`).bind(a.id, 200_000 * DOLLAR),
      env.DB.prepare(`INSERT INTO casino_escrow (account_id, table_id, amount, opened_at, updated_at) VALUES (?1, 'test-table', ?2, 0, 0)`).bind(a.id, 200_000 * DOLLAR),
    ]);
    const res = await buy(a.token, ROPE.id);
    expect(res.status).toBe(409);
    const body = await res.json<any>();
    expect(body).toMatchObject({ error: 'INSUFFICIENT_FUNDS', balance: 100_000 * DOLLAR, inPlay: 200_000 * DOLLAR });
    expect(await money(a.id)).toMatchObject({ balance: 100_000 * DOLLAR, in_play: 200_000 * DOLLAR });
    await expectBalanced(a.id);
  });

  it('owning one thing leaves the rest to buy, down to exactly zero', async () => {
    const a = await account('shop_many');
    await win(a.id, ROPE.price + GRILL.price - STARTING_BALANCE);
    expect((await buy(a.token, ROPE.id)).status).toBe(200);
    expect((await buy(a.token, GRILL.id)).status).toBe(200);
    expect((await money(a.id)).balance).toBe(0);
    expect((await buy(a.token, 'gold-aviators')).status).toBe(409);
    await expectBalanced(a.id);
  });

  it('refuses unknown items and missing op ids before anything else', async () => {
    const a = await account('shop_bad');
    for (const item of ['nope', 42, null, 'beer']) {
      const res = await buy(a.token, item);
      expect(res.status, String(item)).toBe(404);
      expect((await res.json<any>()).error).toBe('NOT_FOUND');
    }
    const noOp = await api('shop/buy', a.token, { method: 'POST', body: JSON.stringify({ item: ROPE.id }) });
    expect(noOp.status).toBe(400);
    for (const bad of [null, 12345678, 'x', 'has space in it', 'a'.repeat(41)]) {
      const res = await buy(a.token, ROPE.id, bad);
      expect(res.status, String(bad)).toBe(400);
    }
    expect(await count(`SELECT count(*) AS n FROM casino_items WHERE account_id = ?1`, a.id)).toBe(0);
  });

  it('limits purchases per account', async () => {
    const a = await account('shop_spam');
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await buy(a.token, ICED.id)).status);
    expect(statuses.slice(0, 20).every((s) => s === 409)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});

describe('wearing what you own', () => {
  it('refuses a look wearing an item you do not own and stores nothing', async () => {
    const a = await account('wear_nope');
    const res = await putLook(a.token, { ...DEFAULT_LOOK, top: '#123456', chain: ROPE.id });
    expect(res.status).toBe(403);
    expect(await res.json<any>()).toMatchObject({ error: 'NOT_ELIGIBLE', msg: "You don't own the Rope Chain yet." });
    expect((await me(a.token)).look).toEqual(DEFAULT_LOOK);
  });

  it('wears it once bought, and everyone on the floor sees it', async () => {
    const a = await account('wear_yes');
    const b = await account('wear_watcher');
    await win(a.id, 1_000_000 * DOLLAR);
    expect((await buy(a.token, ROPE.id)).status).toBe(200);
    expect((await buy(a.token, GRILL.id)).status).toBe(200);
    const { client: mine } = await connect('floor', a.token);
    const { client: theirs } = await connect('floor', b.token);
    await mine!.next((m) => m.t === 'hello');
    await theirs!.next((m) => m.t === 'hello');
    const look = { ...DEFAULT_LOOK, chain: ROPE.id, grill: GRILL.id };
    const res = await putLook(a.token, look);
    expect(res.status).toBe(200);
    expect((await res.json<any>()).look).toEqual(look);
    expect((await me(a.token)).look).toEqual(look);
    const seen = await theirs!.next<any>((m) => m.t === 'player' && m.id === a.id && m.look);
    expect(seen.look).toEqual(look);
    // and a newcomer gets it in the roster
    const c = await account('wear_late');
    const { client: late } = await connect('floor', c.token);
    const hello = await late!.next<any>((m) => m.t === 'hello');
    expect(hello.players.find((p: any) => p.id === a.id)?.look).toEqual(look);
    for (const cl of [mine, theirs, late]) cl!.ws.close();
  });

  it('one unowned item refuses the whole look, even beside owned ones', async () => {
    const a = await account('wear_mixed');
    await win(a.id, 1_000_000 * DOLLAR);
    expect((await buy(a.token, ROPE.id)).status).toBe(200);
    const res = await putLook(a.token, { ...DEFAULT_LOOK, chain: ROPE.id, clothes: 'diamond-suit' });
    expect(res.status).toBe(403);
    expect((await res.json<any>()).msg).toBe("You don't own the Diamond-Studded Suit yet.");
    expect((await me(a.token)).look).toEqual(DEFAULT_LOOK);
  });

  it('taking things off needs nothing owned', async () => {
    const a = await account('wear_off');
    await win(a.id, 1_000_000 * DOLLAR);
    expect((await buy(a.token, ROPE.id)).status).toBe(200);
    expect((await putLook(a.token, { ...DEFAULT_LOOK, chain: ROPE.id })).status).toBe(200);
    const res = await putLook(a.token, DEFAULT_LOOK);
    expect(res.status).toBe(200);
    expect((await me(a.token)).look).toEqual(DEFAULT_LOOK);
  });

  it('drops item ids the shop never sold instead of refusing', async () => {
    const a = await account('wear_junk');
    const res = await putLook(a.token, { ...DEFAULT_LOOK, chain: 'platinum-yacht', grill: ROPE.id });
    expect(res.status).toBe(200);
    expect((await res.json<any>()).look).toEqual(DEFAULT_LOOK);
  });
});

describe('POST /bar/order', () => {
  it('takes the price off the balance and returns the order', async () => {
    const a = await account('bar_beer');
    const before = await money(a.id);
    const id = op();
    const res = await order(a.token, BEER.id, id);
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.order).toMatchObject({ id, item: 'beer', price: 9 * DOLLAR });
    expect(body.order.until).toBe(body.order.at + ORDER_LIFE_MS); // v7.4: five in hand after up to fifteen in line
    expect(body).toMatchObject({ balance: before.balance - 900, inPlay: 0, rev: before.rev + 1 });
    expect(await money(a.id)).toMatchObject({ balance: before.balance - 900 });
    const row = await env.DB.prepare(`SELECT account_id, item, price, created_at FROM casino_orders WHERE op_id = ?1`).bind(`bar:${a.id}:${id}`).first<any>();
    expect(row).toEqual({ account_id: a.id, item: 'beer', price: 900, created_at: body.order.at });
    await expectBalanced(a.id);
  });

  it('a retried order is the same order, charged once; a new op is a new round', async () => {
    const a = await account('bar_retry');
    const id = op();
    const first = await (await order(a.token, 'champagne', id)).json<any>();
    const again = await (await order(a.token, 'champagne', id)).json<any>();
    expect(again.order).toEqual(first.order);
    expect((await money(a.id)).balance).toBe(STARTING_BALANCE - 3_200);
    const second = await (await order(a.token, 'champagne')).json<any>();
    expect(second.order.id).not.toBe(first.order.id);
    expect((await money(a.id)).balance).toBe(STARTING_BALANCE - 6_400);
    await expectBalanced(a.id);
  });

  it("one player's op id never answers for another's", async () => {
    const a = await account('bar_opa');
    const b = await account('bar_opb');
    const id = op();
    expect((await order(a.token, 'beer', id)).status).toBe(200);
    const res = await order(b.token, 'lobster', id);
    expect(res.status).toBe(200);
    expect((await res.json<any>()).order.item).toBe('lobster');
    expect((await money(b.id)).balance).toBe(STARTING_BALANCE - 9_500);
    await expectBalanced(a.id);
    await expectBalanced(b.id);
  });

  it('refuses an order you cannot pay for', async () => {
    const a = await account('bar_broke');
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) VALUES (?1, ?2, 'buyin', ?3, 'test-table', 0)`).bind(`bb:${a.id}`, a.id, -(STARTING_BALANCE - 1_000 * DOLLAR)),
      env.DB.prepare(`UPDATE casino_accounts SET balance = ?2 WHERE id = ?1`).bind(a.id, 1_000 * DOLLAR),
    ]);
    const res = await order(a.token, DOM.id);
    expect(res.status).toBe(409);
    expect(await res.json<any>()).toMatchObject({ error: 'INSUFFICIENT_FUNDS', msg: 'Not enough: the Bottle of Dom is $1,200 and your balance is $1,000.', balance: 1_000 * DOLLAR });
    expect(await count(`SELECT count(*) AS n FROM casino_orders WHERE account_id = ?1`, a.id)).toBe(0);
    await expectBalanced(a.id);
  });

  it('refuses what the bar does not serve', async () => {
    const a = await account('bar_bad');
    for (const item of ['rope-chain', 'mojito', 3]) expect((await order(a.token, item)).status).toBe(404);
    expect((await order(a.token, 'beer', 'x')).status).toBe(400);
  });

  it('limits orders per account', async () => {
    const a = await account('bar_spam');
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await order(a.token, 'espresso')).status);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
    await expectBalanced(a.id);
  });
});

describe('holding an order', () => {
  it('shows a paid order in your hand, with the end time the order sets', async () => {
    const a = await account('hold_yes');
    const { order: o } = await (await order(a.token, 'champagne')).json<any>();
    const res = await putLook(a.token, { ...DEFAULT_LOOK, held: { item: 'champagne', order: o.id, until: 1 } });
    expect(res.status).toBe(200);
    const look = (await res.json<any>()).look;
    expect(look.held).toEqual({ item: 'champagne', order: o.id, until: o.until });
    expect((await me(a.token)).look.held).toEqual(look.held);
  });

  it('drops a held order that is not yours, not paid, not that item, or run out', async () => {
    const a = await account('hold_no');
    const b = await account('hold_other');
    const { order: theirs } = await (await order(b.token, 'beer')).json<any>();
    const { order: mine } = await (await order(a.token, 'beer')).json<any>();
    const cases = [
      { item: 'beer', order: theirs.id, until: 9e12 },
      { item: 'beer', order: 'never-ordered-1', until: 9e12 },
      { item: 'dom', order: mine.id, until: 9e12 },
    ];
    for (const held of cases) {
      const res = await putLook(a.token, { ...DEFAULT_LOOK, held });
      expect(res.status, JSON.stringify(held)).toBe(200);
      expect((await res.json<any>()).look.held, JSON.stringify(held)).toBeUndefined();
    }
    // an order paid more than five minutes ago has left your hand
    await env.DB.prepare(`UPDATE casino_orders SET created_at = ?2 WHERE op_id = ?1`).bind(`bar:${a.id}:${mine.id}`, Date.now() - ORDER_LIFE_MS - 1).run();
    const late = await putLook(a.token, { ...DEFAULT_LOOK, held: { item: 'beer', order: mine.id, until: 9e12 } });
    expect((await late.json<any>()).look.held).toBeUndefined();
  });

  it('a held order travels to the floor with the look, and putting it down clears it', async () => {
    const a = await account('hold_floor');
    const b = await account('hold_see');
    const { client: theirs } = await connect('floor', b.token);
    const { client: mine } = await connect('floor', a.token);
    await theirs!.next((m) => m.t === 'hello');
    await mine!.next((m) => m.t === 'hello');
    const { order: o } = await (await order(a.token, 'dom')).json<any>();
    expect((await putLook(a.token, { ...DEFAULT_LOOK, held: { item: 'dom', order: o.id, until: 0 + 1 } })).status).toBe(200);
    const seen = await theirs!.next<any>((m) => m.t === 'player' && m.id === a.id && m.look?.held);
    expect(seen.look.held).toEqual({ item: 'dom', order: o.id, until: o.until });
    expect((await putLook(a.token, DEFAULT_LOOK)).status).toBe(200);
    const down = await theirs!.next<any>((m) => m.t === 'player' && m.id === a.id && m.look && !m.look.held);
    expect(down.look).toEqual(DEFAULT_LOOK);
    theirs!.ws.close();
    mine!.ws.close();
  });
});

describe('the audit', () => {
  it('balances through a real table: buy in, order while seated from the balance, play, cash out, shop', async () => {
    const a = await account('audit_table');
    await win(a.id, 250_000 * DOLLAR);
    const { client } = await connect('solo/highcard', a.token);
    const c = client!;
    await c.next((m) => m.t === 'table');
    c.send({ t: 'buyin', aid: 'b1', amount: 10_000 * DOLLAR });
    await c.next((m) => m.t === 'seat' && m.status === 'seated', 5000);
    expect(await money(a.id)).toMatchObject({ balance: 290_000 * DOLLAR, in_play: 10_000 * DOLLAR });
    await expectBalanced(a.id);

    // Seated with chips out: the bar and the shop take from the balance, and the table's chips
    // are left alone (the Rope Chain costs $250,000 and the balance still has it).
    expect((await order(a.token, 'whiskey')).status).toBe(200);
    expect((await buy(a.token, ROPE.id)).status).toBe(200);
    expect(await money(a.id)).toMatchObject({ balance: 290_000 * DOLLAR - 22 * DOLLAR - ROPE.price, in_play: 10_000 * DOLLAR });
    await expectBalanced(a.id);

    let stack = 10_000 * DOLLAR;
    for (let i = 0; i < 3; i++) {
      c.send({ t: 'act', aid: `bet${i}`, a: { type: 'bet', amount: 100 * DOLLAR } });
      await c.next((m) => m.t === 'ev' && m.events.some((e: any) => e.type === 'bet'));
      c.send({ t: 'act', aid: `deal${i}`, a: { type: 'deal' } });
      const ev = await c.next<any>((m) => m.t === 'ev' && m.events.some((e: any) => e.type === 'result'));
      stack += ev.view.results['0'].payout - 100 * DOLLAR;
    }
    c.send({ t: 'cashout', aid: 'c1' });
    const bal = await c.next<any>((m) => m.t === 'balance' && m.inPlay === 0, 5000);
    // The cash-out adds to the balance the purchases left, and its revision is newer than theirs.
    expect(bal.balance).toBe(290_000 * DOLLAR - 22 * DOLLAR - ROPE.price + stack);
    expect(await money(a.id)).toMatchObject({ balance: bal.balance, in_play: 0 });
    await expectBalanced(a.id);
    c.ws.close();
  });

  it('balances after a mix of wins, purchases, orders and refusals', async () => {
    const a = await account('audit_mix');
    await win(a.id, 3_000_000 * DOLLAR);
    await buy(a.token, ICED.id);
    await buy(a.token, ICED.id);
    await buy(a.token, 'figaro');
    await order(a.token, 'dom');
    await order(a.token, 'caviar');
    await buy(a.token, 'diamond-suit');
    await order(a.token, 'beer');
    await expectBalanced(a.id);
    const m = await money(a.id);
    expect(m.balance).toBe(STARTING_BALANCE + 3_000_000 * DOLLAR - ICED.price - shopItem('figaro')!.price - 1_200 * DOLLAR - 350 * DOLLAR - 9 * DOLLAR);
  });
});
