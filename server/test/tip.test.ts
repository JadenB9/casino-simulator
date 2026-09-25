// v6.1: tipping the dealer. A tip leaves the stack at the table like a lost bet, so the cash-out
// is the stack less the tip and every cent is still accounted for, with no ledger kind of its
// own; the table refuses what a seat can't tip, and a tip is no round: the seat's stats stay
// as they were.

import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { STARTING_BALANCE } from '../../shared/src/money.ts';
import { api, connect, login, type Client } from './helpers.ts';

async function money(id: number): Promise<{ balance: number; in_play: number }> {
  return (await env.DB.prepare(`SELECT balance, in_play FROM casino_accounts WHERE id = ?1`).bind(id).first<any>())!;
}

async function count(sql: string, ...args: unknown[]): Promise<number> {
  return (await env.DB.prepare(sql).bind(...args).first<{ n: number }>())!.n;
}

/** The ledger is the balance (with nothing on a table, the whole of balance + in_play). */
async function expectBalanced(id: number): Promise<void> {
  const ledger = await count(`SELECT COALESCE(SUM(amount), 0) AS n FROM casino_ledger WHERE account_id = ?1`, id);
  const m = await money(id);
  expect(m.in_play).toBe(0);
  expect(ledger).toBe(m.balance);
}

async function seated(game: string, name: string, amount: number): Promise<{ c: Client; id: number; token: string }> {
  const { token, profile } = await login(name);
  const c = (await connect(`solo/${game}`, token)).client!;
  await c.next((m) => m.t === 'table');
  c.send({ t: 'buyin', aid: 'b1', amount });
  await c.next((m) => m.t === 'seat' && m.status === 'seated');
  c.msgs.length = 0;
  return { c, id: profile.id, token };
}

describe('tipping the dealer', () => {
  it('comes off the stack, and the cash-out is the stack less the tip', async () => {
    const { c, id, token } = await seated('blackjack', 'tipper_one', 100_000);
    c.send({ t: 'tip', aid: 't1', amount: 2_500 });
    const seat = await c.next((m) => m.t === 'seat');
    expect(seat.stack).toBe(97_500);
    expect(seat.escrow).toBe(100_000);
    const said = await c.next((m) => m.t === 'tipped');
    expect(said).toMatchObject({ accountId: id, name: 'tipper_one', amount: 2_500 });
    // D1 hasn't moved: the chips are still on the table
    expect(await money(id)).toEqual({ balance: STARTING_BALANCE - 100_000, in_play: 100_000 });

    c.send({ t: 'cashout', aid: 'c1' });
    await c.next((m) => m.t === 'balance' && m.inPlay === 0);
    expect(await money(id)).toEqual({ balance: STARTING_BALANCE - 2_500, in_play: 0 });
    await expectBalanced(id);
    // a buy-in and a cash-out of the stack: nothing new in the ledger
    const kinds = await env.DB.prepare(`SELECT kind, amount FROM casino_ledger WHERE account_id = ?1 AND kind IN ('buyin', 'cashout') ORDER BY created_at`).bind(id).all<any>();
    expect(kinds.results).toEqual([{ kind: 'buyin', amount: -100_000 }, { kind: 'cashout', amount: 97_500 }]);

    // no round: the profile's stats for the game are untouched
    const me = await (await api('me', token)).json<any>();
    expect(me.profile.stats.games.blackjack?.rounds ?? 0).toBe(0);
    expect(me.profile.stats.games.blackjack?.net ?? 0).toBe(0);
    // counted only as tipped, once the table's tallies reach D1
    let tipped = 0;
    for (let i = 0; i < 40 && tipped === 0; i++) {
      tipped = (await env.DB.prepare(`SELECT n FROM casino_tally WHERE account_id = ?1 AND key = 'tipped'`).bind(id).first<{ n: number }>())?.n ?? 0;
      if (!tipped) await new Promise((r) => setTimeout(r, 100));
    }
    expect(tipped).toBe(2_500);
  });

  it('a replayed tip is taken once', async () => {
    const { c } = await seated('blackjack', 'tipper_twice', 10_000);
    c.send({ t: 'tip', aid: 'same', amount: 500 });
    c.send({ t: 'tip', aid: 'same', amount: 500 });
    expect((await c.next((m) => m.t === 'seat')).stack).toBe(9_500);
    await new Promise((r) => setTimeout(r, 150));
    expect(c.msgs.filter((m) => m.t === 'seat')).toEqual([]);
  });

  it('refuses more than the stack, a tip with chips out, and a table without a dealer', async () => {
    const { c } = await seated('blackjack', 'tipper_refused', 10_000);
    c.send({ t: 'tip', aid: 't1', amount: 10_001 });
    expect(await c.next((m) => m.t === 'err' && m.ref === 't1')).toMatchObject({ code: 'LIMIT' });
    c.send({ t: 'act', aid: 'bet', a: { type: 'bet', amount: 2_500 } });
    await c.next((m) => m.t === 'seat' && m.stack === 7_500);
    c.send({ t: 'tip', aid: 't2', amount: 100 });
    expect(await c.next((m) => m.t === 'err' && m.ref === 't2')).toMatchObject({ code: 'WRONG_PHASE', msg: 'Tip between hands.' });

    // not a whole number of cents, or nothing at all: not a message the table takes
    c.msgs.length = 0;
    c.send({ t: 'tip', aid: 't3', amount: 12.5 });
    c.send({ t: 'tip', aid: 't4', amount: 0 });
    c.send({ t: 'tip', aid: 't5', amount: -100 });
    await new Promise((r) => setTimeout(r, 150));
    expect(c.msgs.filter((m) => m.t === 'seat' || m.t === 'tipped')).toEqual([]);

    const machine = await seated('slots', 'tipper_slots', 10_000);
    machine.c.send({ t: 'tip', aid: 't1', amount: 100 });
    expect(await machine.c.next((m) => m.t === 'err' && m.ref === 't1')).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses a watcher', async () => {
    const { token } = await login('tipper_watching');
    const c = (await connect('solo/roulette', token)).client!;
    await c.next((m) => m.t === 'table');
    c.send({ t: 'tip', aid: 't1', amount: 100 });
    expect(await c.next((m) => m.t === 'err' && m.ref === 't1')).toMatchObject({ code: 'NOT_SEATED' });
  });

  it('tipping the last chips busts the seat: it cashes out at $0, all accounted for', async () => {
    const { c, id } = await seated('roulette', 'tipper_all', 5_000);
    c.send({ t: 'tip', aid: 't1', amount: 5_000 });
    await c.next((m) => m.t === 'seat' && m.status === 'watching');
    await c.next((m) => m.t === 'balance' && m.inPlay === 0);
    expect(await money(id)).toEqual({ balance: STARTING_BALANCE - 5_000, in_play: 0 });
    await expectBalanced(id);
  });
});
