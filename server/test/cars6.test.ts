// v6 cars6: cars bought at the valet (POST /shop/buy, a casino_items row, kept for good) and
// brought round to the curb (POST /shop/valet): charged once, retries are the same purchase, never
// more than your balance, only your own cars and only from the stand; everyone out front sees a
// car pull up, and every cent is still accounted for:
//   SUM(ledger) - SUM(items.price) - SUM(orders.price) = balance.

import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import type { CasinoFloor } from '../src/floor/index.ts';
import { DOLLAR, STARTING_BALANCE } from '../../shared/src/money.ts';
import { CARS, carItem } from '../../shared/src/items.ts';
import { CURB, CURB_MS, CALLS_PER_MIN, VALET_STAND } from '../../shared/src/valet.ts';
import { api, connect, type Client } from './helpers.ts';
import { floor, player, sleep, type Player } from './party.ts';

let opSeq = 0;
const op = () => `cars6-op-${++opSeq}-${Math.random().toString(36).slice(2, 8)}`;

async function win(id: number, amount: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) VALUES (?1, ?2, 'cashout', ?3, 'test-table', ?4)`).bind(`win:${id}:${op()}`, id, amount, Date.now()),
    env.DB.prepare(`UPDATE casino_accounts SET balance = balance + ?2, rev = rev + 1 WHERE id = ?1`).bind(id, amount),
  ]);
}

async function balance(id: number): Promise<number> {
  return (await env.DB.prepare(`SELECT balance FROM casino_accounts WHERE id = ?1`).bind(id).first<{ balance: number }>())!.balance;
}

async function count(sql: string, ...args: unknown[]): Promise<number> {
  return (await env.DB.prepare(sql).bind(...args).first<{ n: number }>())!.n;
}

async function expectBalanced(id: number): Promise<void> {
  const ledger = await count(`SELECT COALESCE(SUM(amount), 0) AS n FROM casino_ledger WHERE account_id = ?1`, id);
  const items = await count(`SELECT COALESCE(SUM(price), 0) AS n FROM casino_items WHERE account_id = ?1`, id);
  const orders = await count(`SELECT COALESCE(SUM(price), 0) AS n FROM casino_orders WHERE account_id = ?1`, id);
  expect(ledger - items - orders).toBe(await balance(id));
}

const buy = (p: Player, item: unknown, opId: unknown = op()) => api('shop/buy', p.token, { method: 'POST', body: JSON.stringify({ item, op: opId }) });
const valet = (p: Player, car: unknown) => api('shop/valet', p.token, { method: 'POST', body: JSON.stringify({ car }) });

/** Move a player the way the elevator does (presence.teleport), metres. */
function teleport(p: Player, at: { x: number; z: number }): Promise<boolean> {
  return runInDurableObject(floor(), (f: CasinoFloor) => f.presence.teleport(p.id, Math.round(at.x * 100), Math.round(at.z * 100), 0));
}

/** Onto the floor; then, with `at` (metres), moved there the way the elevator moves you. */
async function onFloor(p: Player, at?: { x: number; z: number }): Promise<Client> {
  const { client } = await connect('floor', p.token, '', p.ip);
  await client!.next((m) => m.t === 'hello');
  client!.send({ t: 'st', x: 0, z: 1280, r: 0 });
  await sleep(60);
  if (at) {
    expect(await teleport(p, at)).toBe(true);
    await client!.next((m) => m.t === 'tp');
  }
  return client!;
}

const STAND = { x: VALET_STAND.x - 1, z: VALET_STAND.z };
const ROADSTER = carItem('halden-roadster')!;
const RALLY = carItem('brenner-rally')!;
const ORO = carItem('ombra-oro')!;

describe('buying a car (POST /shop/buy)', () => {
  it('charges once, keeps it, and a retry with the same op is the same purchase', async () => {
    const p = await player('c6buy');
    await win(p.id, 1_000_000 * DOLLAR);
    const id = op();
    const res = await buy(p, ROADSTER.id, id);
    expect(res.status).toBe(200);
    expect(await res.json<any>()).toMatchObject({ item: ROADSTER.id, price: ROADSTER.price });
    const again = await buy(p, ROADSTER.id, id);
    expect(again.status).toBe(200);
    expect(await count(`SELECT count(*) AS n FROM casino_items WHERE account_id = ?1 AND item = ?2`, p.id, ROADSTER.id)).toBe(1);
    // a second purchase is refused: you have it
    const twice = await buy(p, ROADSTER.id);
    expect(twice.status).toBe(409);
    expect(await twice.json<any>()).toMatchObject({ error: 'NOT_ELIGIBLE', msg: `You already own the ${ROADSTER.name}.` });
    expect(await balance(p.id)).toBe(STARTING_BALANCE + 1_000_000 * DOLLAR - ROADSTER.price);
    // it's in what you own (the shop's list; the profile's owned reads the same rows)
    const shop = await (await api('shop', p.token)).json<any>();
    expect(shop.owned.map((o: any) => o.item)).toEqual([ROADSTER.id]);
    await expectBalanced(p.id);
  });

  it('never takes more than your balance', async () => {
    const p = await player('c6short');
    await win(p.id, 300_000 * DOLLAR);
    const res = await buy(p, ORO.id);
    expect(res.status).toBe(409);
    expect(await res.json<any>()).toMatchObject({ error: 'INSUFFICIENT_FUNDS' });
    expect(await balance(p.id)).toBe(STARTING_BALANCE + 300_000 * DOLLAR);
    expect(await count(`SELECT count(*) AS n FROM casino_items WHERE account_id = ?1`, p.id)).toBe(0);
    await expectBalanced(p.id);
  });

  it('buys a garage full: every car once, the balance down by exactly their prices', async () => {
    const p = await player('c6fleet');
    const total = CARS.reduce((s, c) => s + c.price, 0);
    await win(p.id, total);
    for (const c of CARS) expect((await buy(p, c.id)).status, c.id).toBe(200);
    expect(await balance(p.id)).toBe(STARTING_BALANCE);
    expect(await count(`SELECT count(*) AS n FROM casino_items WHERE account_id = ?1`, p.id)).toBe(CARS.length);
    await expectBalanced(p.id);
  });
});

describe('the valet (POST /shop/valet)', () => {
  it('brings your own car round from the stand, and everyone on the floor sees it pull up', async () => {
    const p = await player('c6call');
    await win(p.id, 500_000 * DOLLAR);
    expect((await buy(p, ROADSTER.id)).status).toBe(200);
    const c = await onFloor(p);
    const watcher = await onFloor(await player('c6watch'));

    // unknown, not yours, and not from the stand
    expect((await valet(p, 'flying-carpet')).status).toBe(404);
    const notMine = await valet(p, RALLY.id);
    expect(notMine.status).toBe(409);
    expect((await notMine.json<any>()).msg).toMatch(/isn't yours/);
    const away = await valet(p, ROADSTER.id);
    expect(away.status).toBe(409);
    expect((await away.json<any>()).msg).toMatch(/valet stand/);

    expect(await teleport(p, STAND)).toBe(true);
    const before = await balance(p.id);
    const res = await valet(p, ROADSTER.id);
    expect(res.status).toBe(200);
    const { call } = await res.json<any>();
    expect(call).toMatchObject({ id: p.id, name: p.name, car: ROADSTER.id, slot: 0 });
    expect(call.until - call.at).toBe(CURB_MS);
    const seen = await watcher.next((m) => m.t === 'car' && m.id === p.id);
    expect(seen).toEqual({ t: 'car', ...call });

    // a second press is the same car at the curb: no second pull-up
    const again = await (await valet(p, ROADSTER.id)).json<any>();
    expect(again.call).toEqual(call);
    await sleep(80);
    expect(watcher.msgs.filter((m) => m.t === 'car' && m.id === p.id)).toEqual([]);

    // someone arriving now hears what's at the curb
    const late = await onFloor(await player('c6late'));
    const cars = await late.next((m) => m.t === 'cars');
    expect(cars.list).toEqual([call]);

    // sent back: gone for everyone (until has passed), and the curb is free again
    const back = await (await valet(p, null)).json<any>();
    expect(back.call).toBeNull();
    const gone = await watcher.next((m) => m.t === 'car' && m.id === p.id);
    expect(gone.until).toBeLessThanOrEqual(Date.now());
    expect(await balance(p.id)).toBe(before); // no money moves at the valet
    await expectBalanced(p.id);
    for (const x of [c, watcher, late]) x.ws.close(1000, 'bye');
  });

  it('swaps your car for another you own in the same space, and fills the curb before saying it is full', async () => {
    const players: Player[] = [];
    const clients: Client[] = [];
    for (let i = 0; i < CURB.length + 1; i++) {
      const p = await player(`c6curb${i}`);
      await win(p.id, 1_000_000 * DOLLAR);
      expect((await buy(p, ROADSTER.id)).status).toBe(200);
      clients.push(await onFloor(p, STAND));
      players.push(p);
    }
    const slots: number[] = [];
    for (const p of players.slice(0, CURB.length)) {
      const r = await valet(p, ROADSTER.id);
      expect(r.status).toBe(200);
      slots.push((await r.json<any>()).call.slot);
    }
    expect([...slots].sort()).toEqual(CURB.map((_, i) => i));
    const full = await valet(players.at(-1)!, ROADSTER.id);
    expect(full.status).toBe(409);
    expect(await full.json<any>()).toMatchObject({ error: 'BUSY' });

    // the first player swaps to a second car: same space
    const first = players[0]!;
    await win(first.id, 500_000 * DOLLAR);
    expect((await buy(first, RALLY.id)).status).toBe(200);
    const swap = await (await valet(first, RALLY.id)).json<any>();
    expect(swap.call).toMatchObject({ car: RALLY.id, slot: slots[0] });

    // one goes back: the waiting player gets its space
    expect((await valet(players[1]!, null)).status).toBe(200);
    const got = await (await valet(players.at(-1)!, ROADSTER.id)).json<any>();
    expect(got.call.slot).toBe(slots[1]);
    for (const p of players) await valet(p, null);
    for (const x of clients) x.ws.close(1000, 'bye');
  });

  it('limits how often you can call', async () => {
    const p = await player('c6rate');
    await win(p.id, 500_000 * DOLLAR);
    expect((await buy(p, ROADSTER.id)).status).toBe(200);
    const c = await onFloor(p, STAND);
    for (let i = 0; i < CALLS_PER_MIN; i++) expect((await valet(p, i % 2 ? null : ROADSTER.id)).status).toBe(200);
    expect((await valet(p, ROADSTER.id)).status).toBe(429);
    c.ws.close(1000, 'bye');
  });
});
