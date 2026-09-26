// The boutique and the bar: GET /shop, POST /shop/buy, POST /shop/fx, POST /bar/order. All are
// paid from the balance only (chips on tables stay where they are), each in one D1 batch that
// writes the purchase row and takes the money together, so either both land or neither does.
//
// The boutique sells things you keep (worn items, rides, emotes, the statue: casino_items rows)
// and effects you buy each time (casino_orders rows, like a bar order). Rewards are never sold:
// feats give them. An effect also needs the floor: it holds a slot before the charge and plays
// it after (floor/fx.ts), so an effect that couldn't play is never paid for.
//
// A purchase row is the money record for its spending (the ledger's kind list can't grow without
// rebuilding it, and migrations are additive only; see 0004_items.sql). Each purchase carries an
// op id the client chose: a retry after a lost response collides on the row's key and is answered
// with the purchase that already landed, never charged twice.

import { formatMoney, type Cents } from '../../shared/src/money.ts';
import {
  EFFECTS, EMOTE_ITEMS, ORDER_LIFE_MS, SHOP_ITEMS, STATUE, barItem, carItem, theName, effectItem, emoteItem, isFreeEmote, isOp, shopEmote, shopItem, wornItem,
  type BarItem, type BuyResponse, type EffectItem, type EffectResponse, type FxEvent, type OrderResponse, type ShopResponse,
} from '../../shared/src/items.ts';
import type { EmoteId } from '../../shared/src/protocol.ts';
import { featOf } from '../../shared/src/feats.ts';
import { fail, json, readJson } from './http.ts';
import { bumpRate, orderKey, ownedOf } from './db.ts';
import { moneyOf } from './transfer.ts';
import { barPrice } from './happy.ts'; // v6 celebs6: happy hour
import { FX_KEEP_MS, eventFromOrder, fxKey, statueOf, statuesQuery, type StatueRow } from './floor/fx.ts';
import type { CasinoFloor } from './floor/index.ts';
import { valetApi } from './cars.ts'; // v6 cars6
import { gunItem } from '../../shared/src/arms.ts'; // v7
import { RESIDENCES, STORES } from '../../shared/src/stores.ts'; // v7.1
import { APARTMENTS, apartmentItem, homeItem, homeTier } from '../../shared/src/estate.ts'; // v7

/** Purchases per account per minute, for the shop, the effects and the bar each. */
const LIMIT = 20;

/** Something the boutique sells once and you keep: a worn item or ride, an emote, the statue. */
interface Sold {
  id: string;
  name: string;
  price: Cents;
  kind: 'item' | 'emote' | 'statue' | 'car' | 'gun' | 'home' | 'apartment';
}

function sold(id: unknown): Sold | null {
  const item = shopItem(id);
  if (item) return { id: item.id, name: item.name, price: item.price, kind: 'item' };
  const emote = shopEmote(id);
  if (emote) return { id: emote.id, name: emote.name, price: emote.price, kind: 'emote' };
  if (id === STATUE.id) return { id: STATUE.id, name: STATUE.name, price: STATUE.price, kind: 'statue' };
  // v6 cars6: the valet's cars, bought once and kept like the rest (a casino_items row)
  const car = carItem(id);
  if (car) return { id: car.id, name: car.name, price: car.price, kind: 'car' };
  // v7: the gun store's, the home store's, and the apartment and its upgrades
  const gun = gunItem(id);
  if (gun) return { id: gun.id, name: gun.name, price: gun.price, kind: 'gun' };
  const home = homeItem(id);
  if (home) return { id: home.id, name: home.name, price: home.price, kind: 'home' };
  const apt = apartmentItem(id);
  if (apt) return { id: apt.id, name: apt.name, price: apt.price, kind: 'apartment' };
  return null;
}

/**
 * v7: what an apartment step or a home piece needs first: the step before it, or an apartment at
 * all (and the step the piece fits). Null when it may be bought.
 */
async function needs(db: D1Database, accountId: number, item: Sold): Promise<string | null> {
  if (item.kind !== 'apartment' && item.kind !== 'home') return null;
  const tier = homeTier((await ownedOf(db, accountId)).items);
  if (item.kind === 'apartment') {
    const want = apartmentItem(item.id)!.tier;
    if (want > tier + 1) return `Buy ${theName(APARTMENTS[want - 2]!.name)} first.`;
    return null;
  }
  const piece = homeItem(item.id)!;
  if (tier < 1) return 'Home goods go in an apartment: buy The Residence first.';
  if ((piece.tier ?? 1) > tier) return `${theName(piece.name, true)} needs ${theName(APARTMENTS[(piece.tier ?? 1) - 1]!.name)}.`;
  return null;
}

/** v7.1: where a thing must be bought, and why not here (null: here is fine). */
async function soldWhere(env: Env, accountId: number, item: Sold): Promise<string | null> {
  if (item.kind !== 'gun' && item.kind !== 'apartment') return null;
  let at: { x: number; z: number } | null = null;
  try {
    at = await floorOf(env).positionOf(accountId);
  } catch {
    /* the floor didn't answer: treated as away */
  }
  const x = (at?.x ?? 1e9) / 100;
  const z = (at?.z ?? 1e9) / 100;
  if (item.kind === 'gun') {
    const r = STORES.guns.room;
    return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1 ? null : 'Guns are sold at Ace Arms, across the street from the valet.';
  }
  // v7.4: the Residences desk is the hotel lobby's, on the ground floor
  const L = RESIDENCES.hall;
  const H = STORES.homes.room;
  const inLobby = x >= L.x0 && x <= L.x1 && z >= L.z0 && z <= L.z1;
  const inStore = x >= H.x0 && x <= H.x1 && z >= H.z0 && z <= H.z1;
  return inLobby || inStore ? null : 'Apartments are sold at the Residences desk in the hotel lobby (the elevator, G) and at Maison Home.';
}

/** Why the boutique won't sell something it knows (a reward, a free emote), or null. */
function notSold(id: unknown): string | null {
  if (isFreeEmote(id)) return `Everyone has ${theName(emoteItem(id)!.name)} already.`;
  const earned = wornItem(id) ?? emoteItem(id);
  return earned?.reward ? `${theName(earned.name, true)} isn't sold: it's earned.` : null;
}

export async function shopApi(request: Request, env: Env, route: string, accountId: number, cors: Record<string, string>): Promise<Response> {
  const now = Date.now();
  const db = env.DB;

  if (route === 'shop' && request.method === 'GET') {
    return json((await catalogFor(db, accountId)) satisfies ShopResponse, 200, cors);
  }

  if (route === 'shop/buy' && request.method === 'POST') {
    const body = (await readJson(request)) as { item?: unknown; op?: unknown } | null;
    const item = sold(body?.item);
    if (!item) {
      const why = notSold(body?.item);
      return why ? fail(409, 'NOT_ELIGIBLE', why, cors) : fail(404, 'NOT_FOUND', "The shop doesn't sell that.", cors);
    }
    if (!isOp(body?.op)) return fail(400, 'BAD_REQUEST', 'A purchase needs an operation id.', cors);
    if (!(await bumpRate(db, 'casino-shop', `a${accountId}`, LIMIT, 60_000, now))) return fail(429, 'RATE_LIMITED', 'Give it a minute.', cors);
    const first = await needs(db, accountId, item); // v7
    if (first) return fail(409, 'NOT_ELIGIBLE', first, cors);
    // v7.1: guns are sold in Ace Arms, apartments at the Residences desk in the casino's lobby
    const away = await soldWhere(env, accountId, item);
    if (away) return fail(409, 'NOT_ELIGIBLE', away, cors);
    const r = await buyItem(db, accountId, item, body.op, now);
    if (r.kind === 'owned') return fail(409, 'NOT_ELIGIBLE', `You already own ${theName(item.name)}.`, cors);
    if (r.kind === 'short') return notEnough(item, r, cors);
    // The floor hears about it (a retry too: both calls are harmless twice). The purchase stands
    // if it doesn't answer: the next floor connect reads emotes from D1, and the statues refresh.
    try {
      if (item.kind === 'emote') await floorOf(env).grant(accountId, [item.id as EmoteId]);
      if (item.kind === 'statue') await floorOf(env).statueBought();
      // v7: the floor may let them drive it, draw it, or ride up to their apartment now
      if (item.kind === 'car') await floorOf(env).grantKit(accountId, { cars: [item.id] });
      if (item.kind === 'gun') await floorOf(env).grantKit(accountId, { guns: [item.id] });
      if (item.kind === 'apartment') await floorOf(env).grantKit(accountId, { home: homeTier((await ownedOf(db, accountId)).items) });
      if (item.kind === 'home') await floorOf(env).grantKit(accountId, { homes: [item.id] }); // v7.1: the tower shows it
    } catch (err) {
      console.error('floor after purchase failed', item.id, err);
    }
    return json({ item: item.id, price: r.price, at: r.at, balance: r.balance, inPlay: r.inPlay, rev: r.rev } satisfies BuyResponse, 200, cors);
  }

  // v6 cars6: the valet brings a car you own round to the curb (cars.ts)
  if (route === 'shop/valet' && request.method === 'POST') return valetApi(request, env, accountId, cors);

  if (route === 'shop/fx' && request.method === 'POST') {
    const body = (await readJson(request)) as { item?: unknown; op?: unknown } | null;
    const fx = effectItem(body?.item);
    if (!fx) return fail(404, 'NOT_FOUND', "The shop doesn't sell that.", cors);
    if (!isOp(body?.op)) return fail(400, 'BAD_REQUEST', 'A purchase needs an operation id.', cors);
    if (!(await bumpRate(db, 'casino-fx', `a${accountId}`, LIMIT, 60_000, now))) return fail(429, 'RATE_LIMITED', 'Give it a minute.', cors);
    return playEffect(env, accountId, fx, body.op, now, cors);
  }

  if (route === 'bar/order' && request.method === 'POST') {
    const body = (await readJson(request)) as { item?: unknown; op?: unknown } | null;
    const item = barItem(body?.item);
    if (!item) return fail(404, 'NOT_FOUND', "The bar doesn't serve that.", cors);
    if (!isOp(body?.op)) return fail(400, 'BAD_REQUEST', 'An order needs an operation id.', cors);
    if (!(await bumpRate(db, 'casino-bar', `a${accountId}`, LIMIT, 60_000, now))) return fail(429, 'RATE_LIMITED', 'The bar is busy. Give it a minute.', cors);
    // v6 celebs6: happy hour, half price, decided by the moment the order is paid (happy.ts)
    const price = await barPrice(env, item.price, now);
    const r = await placeOrder(db, accountId, item, body.op, now, price);
    if (r.kind === 'short') return notEnough({ name: item.name, price }, r, cors);
    const order = { id: r.id, item: r.item, price: r.price, at: r.at, until: r.until };
    return json({ order, balance: r.balance, inPlay: r.inPlay, rev: r.rev } satisfies OrderResponse, 200, cors);
  }

  return fail(404, 'NOT_FOUND', 'Not here.', cors);
}

function notEnough(item: { name: string; price: Cents }, money: { balance: Cents; inPlay: Cents }, cors: Record<string, string>, bare = false): Response {
  return fail(409, 'INSUFFICIENT_FUNDS', `Not enough: ${bare ? item.name : theName(item.name)} is ${formatMoney(item.price)} and your balance is ${formatMoney(money.balance)}.`, cors, {
    balance: money.balance,
    inPlay: money.inPlay,
  });
}

/** Everything sold, what you have (earned rewards too, through ownedOf), your balance and the lobby's statues. */
async function catalogFor(db: D1Database, accountId: number): Promise<ShopResponse> {
  const [[bought, money, statues], have] = await Promise.all([
    db.batch([
      db.prepare(`SELECT item, price, bought_at FROM casino_items WHERE account_id = ?1 ORDER BY bought_at`).bind(accountId),
      db.prepare(`SELECT balance FROM casino_accounts WHERE id = ?1`).bind(accountId),
      statuesQuery(db),
    ]),
    ownedOf(db, accountId),
  ]);
  const owned: ShopResponse['owned'] = (bought!.results as { item: string; price: number; bought_at: number }[]).map((r) => ({ item: r.item, price: r.price, at: r.bought_at }));
  // What feats gave: ownedOf says it's yours; the feat says when and why.
  const listed = new Set(owned.map((o) => o.item));
  for (const [feat, at] of have.feats) {
    const reward = featOf(feat)?.reward;
    for (const id of [reward?.item, reward?.emote]) {
      if (!id || listed.has(id) || !have.items.has(id)) continue;
      listed.add(id);
      owned.push({ item: id, price: 0, at, feat });
    }
  }
  return {
    items: SHOP_ITEMS.filter((i) => !i.reward),
    owned,
    balance: (money!.results[0] as { balance: number } | undefined)?.balance ?? 0,
    emotes: EMOTE_ITEMS.filter((e) => shopEmote(e.id)),
    effects: EFFECTS,
    statue: STATUE,
    statues: (statues!.results as StatueRow[]).map(statueOf),
  };
}

function floorOf(env: Env): DurableObjectStub<CasinoFloor> {
  const ns = env.FLOOR as unknown as DurableObjectNamespace<CasinoFloor>;
  return ns.get(ns.idFromName('main'));
}

/** "4 min", "40 s" */
function wait(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return s >= 90 ? `${Math.ceil(s / 60)} min` : `${s} s`;
}

const BOOKED: Record<EffectItem['reach'], string> = {
  you: 'you have effects lined up',
  room: 'this room is booked',
  casino: 'the casino is booked',
};

/**
 * Play an effect: the floor holds a slot where you stand, the charge lands (a casino_orders row
 * and the balance, together), then the floor plays it. A retry with the same op is answered with
 * the effect it bought and never charged again, and plays it only if it never did.
 */
async function playEffect(env: Env, accountId: number, fx: EffectItem, op: string, now: number, cors: Record<string, string>): Promise<Response> {
  const db = env.DB;
  const key = fxKey(accountId, op);
  const floor = floorOf(env);
  const answer = (event: FxEvent, m: Money) => json({ fx: event, balance: m.balance, inPlay: m.inPlay, rev: m.rev } satisfies EffectResponse, 200, cors);

  // A retry of a purchase that was paid for: what it bought, played if the floor never played it.
  const paid = await db
    .prepare(`SELECT o.item AS item, o.created_at AS created_at, a.name AS name FROM casino_orders o JOIN casino_accounts a ON a.id = o.account_id WHERE o.op_id = ?1`)
    .bind(key)
    .first<{ item: string; created_at: number; name: string }>();
  if (paid) return answer((await replay(floor, accountId, op, paid, now)) ?? eventFromOrder(accountId, paid.name, paid)!, await money(db, accountId));

  // Short already: say so before holding a slot for it (the batch below still guards).
  const before = await money(db, accountId);
  if (before.balance < fx.price) return notEnough(fx, before, cors, true);

  const held = await floor.fxReserve(accountId, fx.id, op);
  if ('error' in held) {
    if (held.error === 'AWAY') return fail(409, 'NOT_ELIGIBLE', 'Effects play where you stand: walk out onto the floor first.', cors);
    if (held.error === 'BUSY') return fail(409, 'BUSY', `Not yet: ${BOOKED[fx.reach]} for the next ${wait(held.wait)}.`, cors);
    return fail(404, 'NOT_FOUND', "The shop doesn't sell that.", cors);
  }
  try {
    const row = db.prepare(`INSERT INTO casino_orders (op_id, account_id, item, price, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(key, accountId, fx.id, fx.price, now);
    const m = await pay(db, row, accountId, fx.price, now);
    return answer((await floor.fxConfirm(accountId, op)) ?? held.event, m);
  } catch (err) {
    if (overdraft(err)) {
      await floor.fxCancel(accountId, op);
      return notEnough(fx, await money(db, accountId), cors, true);
    }
    // The same op landing from a request running alongside this one: it's paid, so it plays.
    const landed = await db.prepare(`SELECT 1 AS n FROM casino_orders WHERE op_id = ?1`).bind(key).first();
    if (landed) return answer((await floor.fxConfirm(accountId, op)) ?? held.event, await money(db, accountId));
    // Anything else: the hold stays, and the floor's alarm settles it against D1 (paid or not).
    throw err;
  }
}

/**
 * A paid effect's event for a retry. The floor keeps effects FX_KEEP_MS after they end, so one it
 * doesn't know about and paid for more recently than that never reached it (the Worker stopped
 * between the charge and the play): it plays now, already paid for. Null if it can't be found or
 * played (an old one, or the buyer has left the floor).
 */
async function replay(floor: DurableObjectStub<CasinoFloor>, accountId: number, op: string, paid: { item: string; created_at: number }, now: number): Promise<FxEvent | null> {
  const known = await floor.fxOf(accountId, op);
  if (known) return (await floor.fxConfirm(accountId, op)) ?? known;
  if (now - paid.created_at >= FX_KEEP_MS) return null;
  const held = await floor.fxReserve(accountId, paid.item, op);
  if ('error' in held) return null;
  return (await floor.fxConfirm(accountId, op)) ?? held.event;
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
export async function buyItem(db: D1Database, accountId: number, item: { id: string; price: Cents }, op: string, now: number): Promise<BuyOutcome> {
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
export async function placeOrder(db: D1Database, accountId: number, item: BarItem, op: string, now: number, price: Cents = item.price): Promise<OrderOutcome> {
  const opId = orderKey(accountId, op);
  try {
    // (the row keeps what was paid: half the menu's price in happy hour)
    const row = db.prepare(`INSERT INTO casino_orders (op_id, account_id, item, price, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(opId, accountId, item.id, price, now);
    return { kind: 'ordered', id: op, item: item.id, price, at: now, until: now + ORDER_LIFE_MS, ...(await pay(db, row, accountId, price, now)) };
  } catch (err) {
    // The key holds the account, so a row here is this account's own order with this op: a
    // retry, answered with what was ordered the first time.
    const row = await db
      .prepare(`SELECT item, price, created_at FROM casino_orders WHERE op_id = ?1`)
      .bind(opId)
      .first<{ item: string; price: number; created_at: number }>();
    if (row) return { kind: 'ordered', id: op, item: row.item, price: row.price, at: row.created_at, until: row.created_at + ORDER_LIFE_MS, ...(await money(db, accountId)) };
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
