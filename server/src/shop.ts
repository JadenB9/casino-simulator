// The boutique and the bar: GET /shop, POST /shop/buy, POST /bar/order. Both are paid from the
// balance only (chips on tables stay where they are), each in one D1 batch that writes the
// purchase row and takes the money together, so either both land or neither does.
//
// A purchase row is the money record for its spending (the ledger's kind list can't grow without
// rebuilding it, and migrations are additive only; see 0004_items.sql). Each purchase carries an
// op id the client chose: a retry after a lost response collides on the row's key and is answered
// with the purchase that already landed, never charged twice.

import { formatMoney, type Cents } from '../../shared/src/money.ts';
import {
  HOLD_MS, SHOP_ITEMS, barItem, isOp, shopItem,
  type BarItem, type BuyResponse, type OrderResponse, type ShopItem, type ShopResponse,
} from '../../shared/src/items.ts';
import { fail, json, readJson } from './http.ts';
import { bumpRate, orderKey } from './db.ts';
import { moneyOf } from './transfer.ts';

/** Purchases per account per minute, for the shop and the bar each. */
const LIMIT = 20;

export async function shopApi(request: Request, env: Env, route: string, accountId: number, cors: Record<string, string>): Promise<Response> {
  const now = Date.now();
  const db = env.DB;

  if (route === 'shop' && request.method === 'GET') {
    return json((await catalogFor(db, accountId)) satisfies ShopResponse, 200, cors);
  }

  if (route === 'shop/buy' && request.method === 'POST') {
    const body = (await readJson(request)) as { item?: unknown; op?: unknown } | null;
    const item = shopItem(body?.item);
    if (!item) return fail(404, 'NOT_FOUND', "The shop doesn't sell that.", cors);
    if (!isOp(body?.op)) return fail(400, 'BAD_REQUEST', 'A purchase needs an operation id.', cors);
    if (!(await bumpRate(db, 'casino-shop', `a${accountId}`, LIMIT, 60_000, now))) return fail(429, 'RATE_LIMITED', 'Give it a minute.', cors);
    const r = await buyItem(db, accountId, item, body.op, now);
    if (r.kind === 'owned') return fail(409, 'NOT_ELIGIBLE', `You already own the ${item.name}.`, cors);
    if (r.kind === 'short') return notEnough(item, r, cors);
    return json({ item: item.id, price: r.price, at: r.at, balance: r.balance, inPlay: r.inPlay, rev: r.rev } satisfies BuyResponse, 200, cors);
  }

  if (route === 'bar/order' && request.method === 'POST') {
    const body = (await readJson(request)) as { item?: unknown; op?: unknown } | null;
    const item = barItem(body?.item);
    if (!item) return fail(404, 'NOT_FOUND', "The bar doesn't serve that.", cors);
    if (!isOp(body?.op)) return fail(400, 'BAD_REQUEST', 'An order needs an operation id.', cors);
    if (!(await bumpRate(db, 'casino-bar', `a${accountId}`, LIMIT, 60_000, now))) return fail(429, 'RATE_LIMITED', 'The bar is busy. Give it a minute.', cors);
    const r = await placeOrder(db, accountId, item, body.op, now);
    if (r.kind === 'short') return notEnough(item, r, cors);
    const order = { id: r.id, item: r.item, price: r.price, at: r.at, until: r.until };
    return json({ order, balance: r.balance, inPlay: r.inPlay, rev: r.rev } satisfies OrderResponse, 200, cors);
  }

  return fail(404, 'NOT_FOUND', 'Not here.', cors);
}

function notEnough(item: ShopItem | BarItem, money: { balance: Cents; inPlay: Cents }, cors: Record<string, string>): Response {
  return fail(409, 'INSUFFICIENT_FUNDS', `Not enough: the ${item.name} is ${formatMoney(item.price)} and your balance is ${formatMoney(money.balance)}.`, cors, {
    balance: money.balance,
    inPlay: money.inPlay,
  });
}

async function catalogFor(db: D1Database, accountId: number): Promise<ShopResponse> {
  const [owned, money] = await db.batch([
    db.prepare(`SELECT item, price, bought_at FROM casino_items WHERE account_id = ?1 ORDER BY bought_at`).bind(accountId),
    db.prepare(`SELECT balance FROM casino_accounts WHERE id = ?1`).bind(accountId),
  ]);
  return {
    items: SHOP_ITEMS,
    owned: (owned!.results as { item: string; price: number; bought_at: number }[]).map((r) => ({ item: r.item, price: r.price, at: r.bought_at })),
    balance: (money!.results[0] as { balance: number } | undefined)?.balance ?? 0,
  };
}

interface Money {
  balance: Cents;
  inPlay: Cents;
  rev: number;
}

type BuyOutcome = ({ kind: 'bought'; price: Cents; at: number } & Money) | { kind: 'owned' } | ({ kind: 'short' } & Money);

/** A purchase's own row and the price off the balance, in one batch; the money after it. */
async function pay(db: D1Database, row: D1PreparedStatement, accountId: number, price: Cents, now: number): Promise<Money> {
  const [, paid] = await db.batch<{ balance: number; in_play: number; rev: number }>([
    row,
    db
      .prepare(`UPDATE casino_accounts SET balance = balance - ?2, rev = rev + 1, last_seen = ?3 WHERE id = ?1 RETURNING balance, in_play, rev`)
      .bind(accountId, price, now),
  ]);
  const m = paid!.results[0]!;
  return { balance: m.balance, inPlay: m.in_play, rev: m.rev };
}

/**
 * Buy a shop item: the row that says you own it and the price off your balance, together. Owning
 * is one row per item, so a second purchase collides and rolls back; the stored op id tells a
 * retry of the purchase that landed (answered as bought) from a second attempt (owned).
 */
export async function buyItem(db: D1Database, accountId: number, item: ShopItem, op: string, now: number): Promise<BuyOutcome> {
  const opId = `shop:${accountId}:${op}`;
  try {
    const row = db.prepare(`INSERT INTO casino_items (account_id, item, price, bought_at, op_id) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(accountId, item.id, item.price, now, opId);
    return { kind: 'bought', price: item.price, at: now, ...(await pay(db, row, accountId, item.price, now)) };
  } catch (err) {
    const row = await db
      .prepare(`SELECT price, bought_at, op_id FROM casino_items WHERE account_id = ?1 AND item = ?2`)
      .bind(accountId, item.id)
      .first<{ price: number; bought_at: number; op_id: string }>();
    if (row) {
      if (row.op_id !== opId) return { kind: 'owned' };
      return { kind: 'bought', price: row.price, at: row.bought_at, ...(await money(db, accountId)) };
    }
    if (overdraft(err)) return { kind: 'short', ...(await money(db, accountId)) };
    throw err;
  }
}

type OrderOutcome = ({ kind: 'ordered'; id: string; item: string; price: Cents; at: number; until: number } & Money) | ({ kind: 'short' } & Money);

/** Order from the bar: the order row and the price off your balance, together. */
export async function placeOrder(db: D1Database, accountId: number, item: BarItem, op: string, now: number): Promise<OrderOutcome> {
  const opId = orderKey(accountId, op);
  try {
    const row = db.prepare(`INSERT INTO casino_orders (op_id, account_id, item, price, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(opId, accountId, item.id, item.price, now);
    return { kind: 'ordered', id: op, item: item.id, price: item.price, at: now, until: now + HOLD_MS, ...(await pay(db, row, accountId, item.price, now)) };
  } catch (err) {
    // The key holds the account, so a row here is this account's own order with this op: a
    // retry, answered with what was ordered the first time.
    const row = await db
      .prepare(`SELECT item, price, created_at FROM casino_orders WHERE op_id = ?1`)
      .bind(opId)
      .first<{ item: string; price: number; created_at: number }>();
    if (row) return { kind: 'ordered', id: op, item: row.item, price: row.price, at: row.created_at, until: row.created_at + HOLD_MS, ...(await money(db, accountId)) };
    if (overdraft(err)) return { kind: 'short', ...(await money(db, accountId)) };
    throw err;
  }
}

function overdraft(err: unknown): boolean {
  return String((err as Error)?.message ?? err).includes('balance_nonneg');
}

async function money(db: D1Database, accountId: number): Promise<Money> {
  const m = await moneyOf(db, accountId);
  return { balance: m?.balance ?? 0, inPlay: m?.in_play ?? 0, rev: m?.rev ?? 0 };
}
