// Hold'em at any stakes, end to end: a $0.50/$1 table bets in half dollars and cashes out to the
// cent, a $100,000/$200,000 table takes a $50,000,000 buy-in, and at both every cent is accounted
// for (the ledger adds up to the balance plus what is in play).

import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { connect, login, type Client } from './helpers.ts';

async function money(id: number): Promise<{ balance: number; in_play: number }> {
  return (await env.DB.prepare(`SELECT balance, in_play FROM casino_accounts WHERE id = ?1`).bind(id).first<any>())!;
}

async function ledger(id: number): Promise<number> {
  return (await env.DB.prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM casino_ledger WHERE account_id = ?1`).bind(id).first<any>())!.n;
}

/** Money given to a test account the way the casino gives it: a balance change and a grant row. */
async function grant(id: number, amount: number, tag: string): Promise<void> {
  await env.DB.prepare(`UPDATE casino_accounts SET balance = balance + ?2, rev = rev + 1 WHERE id = ?1`).bind(id, amount).run();
  await env.DB.prepare(`INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) VALUES (?3, ?1, 'grant', ?2, NULL, 0)`).bind(id, amount, `test:${tag}`).run();
}

/** Play the player's turns (check, else fold) until a hand has finished with the player in it. */
async function playAHand(c: Client): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const m = await c.next<any>((x) => x.t === 'ev' || x.t === 'table', 15_000);
    const v = m.view;
    if (v?.you?.legal) {
      c.send({ t: 'act', aid: `p${i}`, a: v.you.legal.check ? { type: 'check' } : { type: 'fold' } });
    }
    if (m.t === 'ev' && m.events.some((e: any) => e.type === 'handEnd')) return;
  }
  throw new Error('no hand finished');
}

async function leaveAndSettle(c: Client, id: number): Promise<{ balance: number; in_play: number }> {
  c.send({ t: 'leave' });
  await c.next((m) => m.t === 'balance' && m.inPlay === 0, 15_000);
  const after = await money(id);
  expect(after.in_play).toBe(0);
  return after;
}

describe("Hold'em at any stakes", () => {
  it('a $0.50/$1 table: half-dollar bets, a $20 to $250 buy-in, and a cash-out to the cent', { timeout: 60_000 }, async () => {
    const { token, profile } = await login('poker6_micro');
    const { client } = await connect('solo/holdem', token, '&limits=50-100');
    const c = client!;
    const snap = await c.next<any>((m) => m.t === 'table');
    expect(snap.meta.config.options).toMatchObject({ sb: 50, bb: 100 });
    expect(snap.meta.config.buyIn).toEqual({ min: 2_000, max: 25_000 });
    expect(snap.meta.config.limits.default).toMatchObject({ min: 100, step: 50 });
    c.send({ t: 'buyin', aid: 'over', amount: 25_100 });
    expect((await c.next<any>((m) => m.t === 'err' && m.ref === 'over')).msg).toBe('This table takes $20 to $250.');
    c.send({ t: 'buyin', aid: 'in', amount: 25_000 });
    await c.next((m) => m.t === 'seat' && m.status === 'seated');
    await playAHand(c);
    await playAHand(c);
    const after = await leaveAndSettle(c, profile.id);
    // whatever the hands did, not a cent was made or lost on the way
    expect(await ledger(profile.id)).toBe(after.balance);
    c.ws.close();
  });

  it('a $100,000/$200,000 table takes $50,000,000, and every cent comes back through the escrow', { timeout: 60_000 }, async () => {
    const { token, profile } = await login('poker6_nosebleed');
    await grant(profile.id, 6_000_000_000, 'nosebleed');
    const { client } = await connect('solo/holdem', token, '&limits=10000000-20000000');
    const c = client!;
    const snap = await c.next<any>((m) => m.t === 'table');
    expect(snap.meta.config.options).toMatchObject({ sb: 10_000_000, bb: 20_000_000 });
    expect(snap.meta.config.buyIn).toEqual({ min: 400_000_000, max: 5_000_000_000 });
    const before = await money(profile.id);
    c.send({ t: 'buyin', aid: 'in', amount: 5_000_000_000 });
    await c.next((m) => m.t === 'seat' && m.status === 'seated', 10_000);
    const seated = await money(profile.id);
    expect(seated).toEqual({ balance: before.balance - 5_000_000_000, in_play: 5_000_000_000 });
    await playAHand(c);
    const after = await leaveAndSettle(c, profile.id);
    expect(await ledger(profile.id)).toBe(after.balance);
    // a hand of checks and folds costs at most the blinds
    expect(before.balance - after.balance).toBeLessThanOrEqual(10_000_000 + 20_000_000);
    c.ws.close();
  });

  it('custom blinds in between: $25,000/$50,000', async () => {
    const { token } = await login('poker6_lobby');
    const { client } = await connect('solo/holdem', token, '&limits=2500000-5000000');
    const snap = await client!.next<any>((m) => m.t === 'table');
    expect(snap.meta.config.options).toMatchObject({ sb: 2_500_000, bb: 5_000_000 });
    expect(snap.meta.config.buyIn).toEqual({ min: 100_000_000, max: 1_250_000_000 });
    client!.ws.close();
  });
});
