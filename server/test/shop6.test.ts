// The v6 boutique: rides, emotes and the statue bought once and kept; effects bought each time and
// played on the floor (one at a time per player, per room and for the casino, queued when busy,
// never paid for when they can't play); emotes the floor passes on only for their owners; and
// every cent still accounted for:
//   SUM(ledger) - SUM(items.price) - SUM(orders.price) = balance.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { runDurableObjectAlarm } from 'cloudflare:test';
import { DOLLAR } from '../../shared/src/money.ts';
import { EFFECTS, EMOTE_ITEMS, SHOP_ITEMS, STATUE, effectItem, shopEmote, shopItem } from '../../shared/src/items.ts';
import { DEFAULT_LOOK } from '../../shared/src/look.ts';
import { api, connect, type Client } from './helpers.ts';
import { clockAt, floor, player, sleep, type Player } from './party.ts';
import { FX_GAP_MS, FX_MAX_WAIT_MS, FX_PENDING_MS, roomAt } from '../src/floor/fx.ts';

afterEach(() => {
  vi.useRealTimers();
});

let opSeq = 0;
const op = () => `shop6-op-${++opSeq}-${Math.random().toString(36).slice(2, 8)}`;

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

async function expectBalanced(id: number): Promise<void> {
  const ledger = await count(`SELECT COALESCE(SUM(amount), 0) AS n FROM casino_ledger WHERE account_id = ?1`, id);
  const items = await count(`SELECT COALESCE(SUM(price), 0) AS n FROM casino_items WHERE account_id = ?1`, id);
  const orders = await count(`SELECT COALESCE(SUM(price), 0) AS n FROM casino_orders WHERE account_id = ?1`, id);
  expect(ledger - items - orders).toBe((await money(id)).balance);
}

const buy = (p: Player, item: unknown, opId: unknown = op()) => api('shop/buy', p.token, { method: 'POST', body: JSON.stringify({ item, op: opId }) });
const fx = (p: Player, item: unknown, opId: unknown = op()) => api('shop/fx', p.token, { method: 'POST', body: JSON.stringify({ item, op: opId }) });
const putLook = (p: Player, look: unknown) => api('me/look', p.token, { method: 'PUT', body: JSON.stringify({ look }) });

/** Onto the floor, standing at (x, z) cm (a connection's first position places you). */
async function onFloor(p: Player, x = 0, z = 1280): Promise<Client> {
  const { client } = await connect('floor', p.token, '', p.ip);
  await client!.next((m) => m.t === 'hello');
  client!.send({ t: 'st', x, z, r: 0 });
  await sleep(60);
  return client!;
}

/** A player with this much won, on the floor at (x, z). */
async function rich(tag: string, amount: number, at?: [number, number]): Promise<{ p: Player; c: Client }> {
  const p = await player(tag);
  if (amount > 0) await win(p.id, amount);
  const c = await onFloor(p, ...(at ?? [0, 1280]));
  return { p, c };
}

const THROWBACK = shopEmote('throwback')!;
const GRIDDY = shopEmote('griddy')!;
const BOARD = shopItem('skateboard')!;
const CONFETTI = effectItem('fx-confetti')!;
const SPOT = effectItem('fx-spotlight')!;
const ROUND = effectItem('fx-round')!;
const DISCO = effectItem('fx-disco')!;
const MARQUEE = effectItem('fx-marquee')!;

// Room centres, cm (floor/fx.ts ROOM_BOUNDS).
const BAR: [number, number] = [2200, -800];
const LOUNGE: [number, number] = [2400, 900];
const POKER: [number, number] = [2000, -2500];
const SALON: [number, number] = [0, -2500];

describe('GET /shop (v6)', () => {
  it('lists everything sold and never a reward, and what you own, earned rewards included', async () => {
    const p = await player('s6list');
    const res = await api('shop', p.token);
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.items.map((i: any) => i.id)).toEqual(SHOP_ITEMS.filter((i) => !i.reward).map((i) => i.id));
    expect(body.items.some((i: any) => i.kind === 'ride')).toBe(true);
    expect(body.emotes.map((e: any) => e.id)).toEqual(EMOTE_ITEMS.filter((e) => e.price > 0 && !e.reward).map((e) => e.id));
    expect(body.effects.map((e: any) => e.id)).toEqual(EFFECTS.map((e) => e.id));
    expect(body.statue).toEqual(STATUE);
    expect(Array.isArray(body.statues)).toBe(true);
    expect(body.owned).toEqual([]);

    // A feat's reward shows as owned, at no price, with the feat that gave it.
    const at = Date.now();
    await env.DB.prepare(`INSERT INTO casino_feats (account_id, feat, at) VALUES (?1, 'won-1m', ?2)`).bind(p.id, at).run();
    const after = await (await api('shop', p.token)).json<any>();
    expect(after.owned).toEqual([{ item: 'trophy', price: 0, at, feat: 'won-1m' }]);
  });
});

describe('POST /shop/buy (v6)', () => {
  it('refuses rewards and free emotes, clearly, and charges nothing', async () => {
    const p = await player('s6reward');
    await win(p.id, 50_000_000 * DOLLAR);
    const before = await money(p.id);
    for (const [id, msg] of [
      ['golden-board', "The Golden Hoverboard isn't sold: it's earned."],
      ['champion-jacket', "The Champion's Jacket isn't sold: it's earned."],
      ['trophy', "The Trophy isn't sold: it's earned."],
      ['wave', 'Everyone has the Wave already.'],
    ]) {
      const res = await buy(p, id);
      expect(res.status).toBe(409);
      expect(await res.json<any>()).toMatchObject({ error: 'NOT_ELIGIBLE', msg });
    }
    expect((await buy(p, 'fx-confetti')).status).toBe(404); // effects are played, not bought to keep
    expect(await money(p.id)).toEqual(before);
    expect(await count(`SELECT count(*) AS n FROM casino_items WHERE account_id = ?1`, p.id)).toBe(0);
    await expectBalanced(p.id);
  });

  it('buys a ride once, and you can ride it', async () => {
    const p = await player('s6ride');
    await win(p.id, 100_000 * DOLLAR);
    const res = await buy(p, BOARD.id);
    expect(res.status).toBe(200);
    expect(await res.json<any>()).toMatchObject({ item: BOARD.id, price: BOARD.price });
    expect((await buy(p, BOARD.id)).status).toBe(409);
    const worn = await putLook(p, { ...DEFAULT_LOOK, ride: BOARD.id });
    expect(worn.status).toBe(200);
    expect((await worn.json<any>()).look.ride).toBe(BOARD.id);
    // one you don't own can't be ridden
    expect((await putLook(p, { ...DEFAULT_LOOK, ride: 'segway' })).status).toBe(403);
    await expectBalanced(p.id);
  });

  it('buys an emote: charged once, the floor tells you, and it passes from then on', async () => {
    const { p, c } = await rich('s6emote', 1_000_000 * DOLLAR);
    const other = await onFloor(await player('s6emobs'));
    // not yet: dropped quietly (no strike, no echo)
    c.send({ t: 'emote', e: THROWBACK.id });
    await sleep(120);
    expect(other.msgs.filter((m) => m.t === 'emote' && m.id === p.id)).toEqual([]);

    const id = op();
    const res = await buy(p, THROWBACK.id, id);
    expect(res.status).toBe(200);
    expect(await c.next((m) => m.t === 'owned')).toEqual({ t: 'owned', emotes: [THROWBACK.id] });
    // a retry is the same purchase: no second charge, and nothing new to own
    const again = await buy(p, THROWBACK.id, id);
    expect(again.status).toBe(200);
    expect(await count(`SELECT count(*) AS n FROM casino_items WHERE account_id = ?1 AND item = ?2`, p.id, THROWBACK.id)).toBe(1);
    expect((await money(p.id)).balance).toBe(1_000_000 * DOLLAR + 50_000 * DOLLAR - THROWBACK.price);

    c.send({ t: 'emote', e: THROWBACK.id });
    expect(await other.next((m) => m.t === 'emote' && m.id === p.id)).toEqual({ t: 'emote', id: p.id, e: THROWBACK.id });
    // one not bought still goes nowhere
    c.send({ t: 'emote', e: GRIDDY.id });
    await sleep(120);
    expect(other.msgs.filter((m) => m.t === 'emote' && m.e === GRIDDY.id)).toEqual([]);
    await sleep(60);
    expect(c.msgs.filter((m) => m.t === 'owned')).toEqual([]);

    // a new connection knows it from D1
    c.ws.close(1000, 'bye');
    const back = await onFloor(p);
    back.send({ t: 'emote', e: THROWBACK.id });
    expect(await other.next((m) => m.t === 'emote' && m.id === p.id && m.e === THROWBACK.id)).toBeTruthy();
    await expectBalanced(p.id);
    back.ws.close(1000, 'bye');
    other.ws.close(1000, 'bye');
  });

  it('grant() from a feat: the owner hears `owned` once, and the emote passes', async () => {
    const p = await player('s6grant');
    const c = await onFloor(p);
    const other = await onFloor(await player('s6grobs'));
    await floor().grant(p.id, ['moonwalk']);
    expect(await c.next((m) => m.t === 'owned')).toEqual({ t: 'owned', emotes: ['moonwalk'] });
    await floor().grant(p.id, ['moonwalk', 'wave']); // already had it; free ones are never news
    await sleep(80);
    expect(c.msgs.filter((m) => m.t === 'owned')).toEqual([]);
    c.send({ t: 'emote', e: 'moonwalk' });
    expect(await other.next((m) => m.t === 'emote' && m.id === p.id)).toEqual({ t: 'emote', id: p.id, e: 'moonwalk' });
    // a grant to someone not on the floor is a no-op (they read it from D1 when they come)
    await floor().grant(999_999, ['trophy']);
    c.ws.close(1000, 'bye');
    other.ws.close(1000, 'bye');
  });

  it('buys the statue: charged once, and the lobby shows the newest buyers wearing their look now', async () => {
    const { p, c } = await rich('s6statue', 12_000_000 * DOLLAR);
    const res = await buy(p, STATUE.id);
    expect(res.status).toBe(200);
    const shown = await c.next((m) => m.t === 'statues' && m.list.some((s: any) => s.name === p.name));
    expect(shown.list[0]).toMatchObject({ name: p.name });
    expect((await buy(p, STATUE.id)).status).toBe(409);
    await expectBalanced(p.id);

    // a newcomer is shown it right after hello
    const q = await player('s6stview');
    const { client } = await connect('floor', q.token, '', q.ip);
    const greet = await client!.next((m) => m.t === 'statues');
    expect(greet.list[0].name).toBe(p.name);

    // the owner changes their look: the statue changes with it (without the drink in hand)
    const look = { ...DEFAULT_LOOK, hair: '#c0c0c0' };
    expect((await putLook(p, look)).status).toBe(200);
    const changed = await client!.next((m) => m.t === 'statues');
    expect(changed.list[0].look.hair).toBe('#c0c0c0');
    expect(changed.list[0].look.held).toBeUndefined();

    // only the newest three stand in the lobby
    const later: Player[] = [];
    for (let i = 0; i < 3; i++) {
      const b = await player(`s6stat${i}`);
      await win(b.id, 10_000_000 * DOLLAR);
      expect((await buy(b, STATUE.id)).status).toBe(200);
      later.push(b);
      await sleep(5);
    }
    const shop = await (await api('shop', q.token)).json<any>();
    expect(shop.statues.map((s: any) => s.name)).toEqual(later.map((b) => b.name).reverse());
    c.ws.close(1000, 'bye');
    client!.ws.close(1000, 'bye');
  });
});

describe('POST /shop/fx', () => {
  it('needs you on the floor, and charges nothing when you are not', async () => {
    const p = await player('s6away');
    const before = await money(p.id);
    const res = await fx(p, CONFETTI.id);
    expect(res.status).toBe(409);
    expect(await res.json<any>()).toMatchObject({ error: 'NOT_ELIGIBLE' });
    expect(await money(p.id)).toEqual(before);
    expect(await count(`SELECT count(*) AS n FROM casino_orders WHERE account_id = ?1`, p.id)).toBe(0);
    expect((await fx(p, 'fx-fireworks')).status).toBe(404);
    expect((await fx(p, CONFETTI.id, 'bad op')).status).toBe(400);
  });

  it('charges once, plays where you stand for everyone, and a retry is the same effect', async () => {
    const { p, c } = await rich('s6fx', 0, [120, 900]);
    const other = await onFloor(await player('s6fxobs'));
    const before = await money(p.id);
    const id = op();
    const t0 = Date.now();
    const res = await fx(p, CONFETTI.id, id);
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.fx).toMatchObject({ fx: CONFETTI.id, id: p.id, name: p.name, x: 120, z: 900 });
    expect(body.fx.at).toBeGreaterThanOrEqual(t0);
    expect(body.fx.until - body.fx.at).toBe(CONFETTI.secs * 1000);
    expect(body).toMatchObject({ balance: before.balance - CONFETTI.price, inPlay: 0, rev: before.rev + 1 });
    const row = await env.DB.prepare(`SELECT item, price FROM casino_orders WHERE op_id = ?1`).bind(`fx:${p.id}:${id}`).first<any>();
    expect(row).toEqual({ item: CONFETTI.id, price: CONFETTI.price });
    expect(await other.next((m) => m.t === 'fx')).toEqual({ t: 'fx', ...body.fx });
    expect(await c.next((m) => m.t === 'fx')).toEqual({ t: 'fx', ...body.fx });

    const again = await fx(p, CONFETTI.id, id);
    expect(again.status).toBe(200);
    expect((await again.json<any>()).fx).toEqual(body.fx);
    await sleep(80);
    expect(other.msgs.filter((m) => m.t === 'fx')).toEqual([]);
    expect(await count(`SELECT count(*) AS n FROM casino_orders WHERE account_id = ?1`, p.id)).toBe(1);
    expect((await money(p.id)).balance).toBe(before.balance - CONFETTI.price);
    await expectBalanced(p.id);
    c.ws.close(1000, 'bye');
    other.ws.close(1000, 'bye');
  });

  it('refuses what you cannot afford without holding the slot', async () => {
    const p = await player('s6fxpoor');
    const c = await onFloor(p, ...SALON);
    const before = await money(p.id);
    const res = await fx(p, DISCO.id); // $100,000 on a $50,000 balance
    expect(res.status).toBe(409);
    expect(await res.json<any>()).toMatchObject({ error: 'INSUFFICIENT_FUNDS', balance: before.balance, msg: 'Not enough: the Disco Night is $100,000 and your balance is $50,000.' });
    expect(await money(p.id)).toEqual(before);
    expect(await count(`SELECT count(*) AS n FROM casino_orders WHERE account_id = ?1`, p.id)).toBe(0);
    await expectBalanced(p.id);
    // nothing held: with the money, it starts now
    await win(p.id, 100_000 * DOLLAR);
    const t0 = Date.now();
    const ok = await (await fx(p, DISCO.id)).json<any>();
    expect(ok.fx.at).toBeLessThan(t0 + 1000);
    await expectBalanced(p.id);
    c.ws.close(1000, 'bye');
  });

  it("queues a player's own effects one after another", async () => {
    const { p, c } = await rich('s6fxyou', 100_000 * DOLLAR, LOUNGE);
    const a = (await (await fx(p, SPOT.id)).json<any>()).fx;
    const b = (await (await fx(p, CONFETTI.id)).json<any>()).fx;
    expect(b.at).toBe(a.until + FX_GAP_MS);
    expect(b.until).toBe(b.at + CONFETTI.secs * 1000);
    // someone else's own effect in the same room isn't held up
    const { p: q, c: qc } = await rich('s6fxyou2', 100_000 * DOLLAR, LOUNGE);
    const t0 = Date.now();
    const other = (await (await fx(q, CONFETTI.id)).json<any>()).fx;
    expect(other.at).toBeLessThan(t0 + 1000);
    // a newcomer is told what is on and what is coming
    const { client } = await connect('floor', (await player('s6fxnew')).token);
    const list = (await client!.next((m) => m.t === 'fxs')).list;
    for (const e of [a, b, other]) expect(list).toContainEqual(e);
    await expectBalanced(p.id);
    for (const s of [c, qc, client!]) s.ws.close(1000, 'bye');
  });

  it('plays one room effect per room at a time; another room is free', async () => {
    const { p, c } = await rich('s6fxroom', 1_000_000 * DOLLAR, BAR);
    const { p: q, c: qc } = await rich('s6fxroom2', 1_000_000 * DOLLAR, BAR);
    const { p: r, c: rc } = await rich('s6fxroom3', 1_000_000 * DOLLAR, POKER);
    expect(roomAt(...BAR)).toBe('bar');
    expect(roomAt(...POKER)).toBe('poker');
    const first = (await (await fx(p, DISCO.id)).json<any>()).fx;
    const second = (await (await fx(q, ROUND.id)).json<any>()).fx;
    expect(second.at).toBe(first.until + FX_GAP_MS);
    const t0 = Date.now();
    const elsewhere = (await (await fx(r, DISCO.id)).json<any>()).fx;
    expect(elsewhere.at).toBeLessThan(t0 + 1000);
    for (const s of [c, qc, rc]) s.ws.close(1000, 'bye');
  });

  it('plays one casino effect at a time, and refuses one that would wait too long, uncharged', async () => {
    const { p, c } = await rich('s6fxcas', 5_000_000 * DOLLAR, SALON);
    const { p: q, c: qc } = await rich('s6fxcas2', 5_000_000 * DOLLAR, BAR);
    const times: any[] = [];
    for (let i = 0; ; i++) {
      const res = await fx(i % 2 ? q : p, MARQUEE.id);
      if (res.status !== 200) {
        expect(res.status).toBe(409);
        expect(await res.json<any>()).toMatchObject({ error: 'BUSY' });
        break;
      }
      times.push((await res.json<any>()).fx);
    }
    // back to back, across rooms and buyers, up to FX_MAX_WAIT_MS out
    for (let i = 1; i < times.length; i++) expect(times[i].at).toBe(times[i - 1].until + FX_GAP_MS);
    expect(times.at(-1).at - times[0].at).toBeLessThanOrEqual(FX_MAX_WAIT_MS);
    expect(times.length).toBe(Math.floor(FX_MAX_WAIT_MS / (MARQUEE.secs * 1000 + FX_GAP_MS)) + 1);
    const paid = await count(`SELECT count(*) AS n FROM casino_orders WHERE account_id IN (?1, ?2)`, p.id, q.id);
    expect(paid).toBe(times.length);
    await expectBalanced(p.id);
    await expectBalanced(q.id);
    c.ws.close(1000, 'bye');
    qc.ws.close(1000, 'bye');
  });

  it("settles a reservation the Worker never came back for: paid plays, unpaid goes", async () => {
    const p = await player('s6fxsettle');
    const c = await onFloor(p, 2400, 1300);
    const watcher = await onFloor(await player('s6fxsetobs'));
    const paidOp = op();
    const lostOp = op();
    const held = await floor().fxReserve(p.id, 'fx-rain', paidOp);
    expect('event' in held).toBe(true);
    // the charge landed, then the Worker stopped before telling the floor
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO casino_orders (op_id, account_id, item, price, created_at) VALUES (?1, ?2, 'fx-rain', ?3, ?4)`).bind(`fx:${p.id}:${paidOp}`, p.id, effectItem('fx-rain')!.price, Date.now()),
      env.DB.prepare(`UPDATE casino_accounts SET balance = balance - ?2 WHERE id = ?1`).bind(p.id, effectItem('fx-rain')!.price),
    ]);
    // and another never got charged at all
    const lost = await floor().fxReserve(p.id, 'fx-sparklers', lostOp);
    expect('event' in lost).toBe(true);
    await sleep(80);
    expect(watcher.msgs.filter((m) => m.t === 'fx')).toEqual([]);

    clockAt(Date.now() + FX_PENDING_MS + 1000);
    await runDurableObjectAlarm(floor());
    const played = await watcher.next((m) => m.t === 'fx');
    expect(played).toMatchObject({ fx: 'fx-rain', id: p.id });
    expect(await floor().fxOf(p.id, lostOp)).toBeNull();
    expect(await floor().fxOf(p.id, paidOp)).toMatchObject({ fx: 'fx-rain' });
    await expectBalanced(p.id);
    c.ws.close(1000, 'bye');
    watcher.ws.close(1000, 'bye');
  });

  it('gives the slot back when the charge is refused, and plays a hold only once', async () => {
    const p = await player('s6fxcancel');
    const c = await onFloor(p, 2400, 400);
    const first = op();
    const held = await floor().fxReserve(p.id, 'fx-disco', first);
    expect('event' in held).toBe(true);
    // a second hold in the Lounge queues behind the first...
    const q = await player('s6fxcancel2');
    const qc = await onFloor(q, 2500, 500);
    const qOp = op();
    const behind = await floor().fxReserve(q.id, 'fx-round', qOp);
    expect((behind as any).event.at).toBe((held as any).event.until + FX_GAP_MS);
    // ...the same op again is the same hold, not a second one
    expect(await floor().fxReserve(p.id, 'fx-disco', first)).toEqual(held);
    // refused (the batch found the balance short): the slot is free again for what comes next
    await floor().fxCancel(p.id, first);
    expect(await floor().fxOf(p.id, first)).toBeNull();
    expect(await floor().fxConfirm(p.id, first)).toBeNull();
    // confirming twice broadcasts once
    const watcher = await onFloor(await player('s6fxcancel3'));
    expect(await floor().fxConfirm(q.id, qOp)).toEqual((behind as any).event);
    await floor().fxConfirm(q.id, qOp);
    await sleep(80);
    expect(watcher.msgs.filter((m) => m.t === 'fx' && m.id === q.id)).toHaveLength(1);
    for (const s of [c, qc, watcher]) s.ws.close(1000, 'bye');
  });

  it('a retry of a paid effect the floor never heard of plays it, without a second charge', async () => {
    const p = await player('s6fxreplay');
    const c = await onFloor(p, 1200, 900);
    const id = op();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO casino_orders (op_id, account_id, item, price, created_at) VALUES (?1, ?2, 'fx-confetti', ?3, ?4)`).bind(`fx:${p.id}:${id}`, p.id, CONFETTI.price, Date.now()),
      env.DB.prepare(`UPDATE casino_accounts SET balance = balance - ?2 WHERE id = ?1`).bind(p.id, CONFETTI.price),
    ]);
    const before = await money(p.id);
    const res = await fx(p, CONFETTI.id, id);
    expect(res.status).toBe(200);
    expect((await res.json<any>()).fx).toMatchObject({ fx: CONFETTI.id, x: 1200, z: 900 });
    expect(await c.next((m) => m.t === 'fx')).toMatchObject({ fx: CONFETTI.id, id: p.id });
    expect(await money(p.id)).toEqual(before);
    await expectBalanced(p.id);
    c.ws.close(1000, 'bye');
  });
});
