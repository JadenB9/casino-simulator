// The high-limit coins: a slot machine takes $5,000 and $10,000 coins ($30,000 a spin on Classic
// Sevens) and video poker five $5,000 coins ($25,000 a hand), each buys in up to a hundred of its
// largest bets, and every spin and hand settles to the cent: the credits chain from the bet and
// the win, the balance takes exactly the credits back at cash out, and the books balance.

import { describe, expect, it } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { ORIGIN, TEST_PASSWORD, api, connect, type Client } from './helpers.ts';

let seq = 0;
const DAY = 86_400_000;

async function player(tag: string): Promise<{ id: number; token: string }> {
  seq++;
  const res = await exports.default.fetch(
    new Request('http://casino.test/casino/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': `10.91.${(seq >> 8) & 255}.${seq & 255}` },
      body: JSON.stringify({ name: `hl${tag}${seq}`, password: TEST_PASSWORD }),
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.json<any>();
  // a high roller: past the first days (nothing held), with the ledger's grant for what they have
  await env.DB.prepare(`UPDATE casino_ledger SET created_at = created_at - ?2 WHERE account_id = ?1`).bind(body.profile.id, 3 * DAY + 1).run();
  const extra = 10_000_000_00 - body.profile.balance;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) VALUES (?1, ?2, 'grant', ?3, NULL, ?4)`).bind(`test-hl:${body.profile.id}`, body.profile.id, extra, Date.now() - 3 * DAY - 1),
    env.DB.prepare(`UPDATE casino_accounts SET balance = balance + ?2, rev = rev + 1 WHERE id = ?1`).bind(body.profile.id, extra),
  ]);
  return { id: body.profile.id, token: body.token };
}

const me = async (token: string) => (await (await api('me', token)).json<any>()).profile;
/** Cash feats have paid (a first big win at a machine can earn one): grants beside the play, never part of it. */
const featPaid = async (id: number) =>
  (await env.DB.prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM casino_ledger WHERE account_id = ?1 AND op_id LIKE 'feat:%'`).bind(id).first<{ n: number }>())!.n;

async function sit(token: string, path: string, amount: number): Promise<[Client, any]> {
  const { client } = await connect(path, token);
  const c = client!;
  const snap = await c.next<any>((m) => m.t === 'table');
  c.send({ t: 'buyin', aid: 'buy1', amount });
  await c.next<any>((m) => m.t === 'seat' && m.status === 'seated', 5000);
  return [c, snap];
}

/** The books: the ledger is the balance, and with nothing on a table the balance is grants plus the rounds' net. */
async function books(id: number): Promise<void> {
  const r = (await env.DB.prepare(
    `SELECT a.balance, a.in_play,
            (SELECT COALESCE(SUM(amount), 0) FROM casino_ledger l WHERE l.account_id = a.id) AS ledger,
            (SELECT COALESCE(SUM(amount), 0) FROM casino_ledger l WHERE l.account_id = a.id AND l.kind IN ('grant', 'loan')) AS granted,
            (SELECT COALESCE(SUM(net), 0) FROM casino_stats s WHERE s.account_id = a.id) AS net
       FROM casino_accounts a WHERE a.id = ?1`,
  )
    .bind(id)
    .first<any>())!;
  expect(r.in_play).toBe(0);
  expect(r.ledger).toBe(r.balance);
  expect(r.balance).toBe(r.granted + r.net);
}

describe('high-limit machines', () => {
  it('a $5,000-coin spin and a $30,000 spin settle to the cent', async () => {
    const p = await player('sl');
    const [c, snap] = await sit(p.token, 'solo/slots', 300_000_000);
    expect(snap.meta.config.limits.default).toEqual({ min: 25, max: 3_000_000, step: 25 });
    expect(snap.meta.config.buyIn.max).toBe(300_000_000);
    const start = (await me(p.token)).balance;
    const feats0 = await featPaid(p.id);
    let credit = 300_000_000;
    let net = 0;
    for (const [aid, coins, denom] of [['s1', 1, 500_000], ['s2', 3, 1_000_000], ['s3', 2, 500_000]] as const) {
      c.send({ t: 'act', aid, a: { type: 'spin', coins, denom } });
      const ev = await c.next<any>((m) => m.t === 'ev' && m.events.some((e: any) => e.type === 'result'), 5000);
      const spin = ev.events.find((e: any) => e.type === 'spin');
      const result = ev.events.find((e: any) => e.type === 'result');
      expect(spin.bet).toBe(coins * denom);
      expect(spin.credit).toBe(credit - coins * denom);
      expect(result.credit).toBe(spin.credit + result.win);
      expect(Number.isSafeInteger(result.win)).toBe(true);
      net += result.win - spin.bet;
      credit = result.credit;
    }
    // no coin past the top one
    c.send({ t: 'act', aid: 's4', a: { type: 'spin', coins: 1, denom: 2_000_000 } });
    expect((await c.next<any>((m) => m.t === 'err', 5000)).code).toBe('BAD_REQUEST');
    c.send({ t: 'cashout', aid: 'out1' });
    await c.next<any>((m) => m.t === 'seat' && m.status === 'watching', 5000);
    const after = await me(p.token);
    expect(credit).toBe(300_000_000 + net);
    expect(after.balance - start).toBe(credit + (await featPaid(p.id)) - feats0);
    expect(after.inPlay).toBe(0);
    await books(p.id);
    c.ws.close();
  });

  it('the high-limit coins on every machine: $25,000 to $50,000 at the top', async () => {
    const p = await player('top');
    const tops: Record<string, number> = { sevens: 3_000_000, wild: 3_000_000, diamonds: 3_000_000, neon: 5_000_000, cherries: 2_500_000, goldrush: 5_000_000, pigs: 5_000_000 };
    for (const [variant, top] of Object.entries(tops)) {
      const { client } = await connect('solo/slots', p.token, `&variant=${variant}`);
      const snap = await client!.next<any>((m) => m.t === 'table');
      expect(snap.meta.config.limits.default.max, variant).toBe(top);
      expect(snap.meta.config.buyIn.max, variant).toBe(100 * top);
      client!.ws.close();
    }
  });

  it('a $25,000 video poker hand settles to the cent', async () => {
    const p = await player('vp');
    const [c, snap] = await sit(p.token, 'solo/videopoker', 250_000_000);
    expect(snap.meta.config.limits.default).toEqual({ min: 100, max: 2_500_000, step: 100 });
    expect(snap.meta.config.buyIn.max).toBe(250_000_000);
    const start = (await me(p.token)).balance;
    const feats0 = await featPaid(p.id);
    let credit = 250_000_000;
    for (const [n, denom] of [[1, 500_00], [2, 1_000_00], [3, 5_000_00]] as const) {
      c.send({ t: 'act', aid: `d${n}`, a: { type: 'deal', coins: 5, denom } });
      const dealt = await c.next<any>((m) => m.t === 'ev' && m.events.some((e: any) => e.type === 'deal'), 5000);
      const deal = dealt.events.find((e: any) => e.type === 'deal');
      expect(deal.bet).toBe(5 * denom);
      c.send({ t: 'act', aid: `h${n}`, a: { type: 'draw', hold: [true, true, false, false, false] } });
      const drawn = await c.next<any>((m) => m.t === 'ev' && m.events.some((e: any) => e.type === 'result'), 5000);
      const result = drawn.events.find((e: any) => e.type === 'result');
      expect(result.payout).toBe(result.credits * denom);
      // the machine's credits: the bet off and the payout on, to the cent
      const want = credit - 5 * denom + result.payout;
      const seat = await c.next<any>((m) => m.t === 'seat' && m.stack === want, 5000);
      credit = seat.stack;
    }
    c.send({ t: 'act', aid: 'd9', a: { type: 'deal', coins: 5, denom: 10_000_00 } });
    expect((await c.next<any>((m) => m.t === 'err', 5000)).code).toBe('LIMIT');
    c.send({ t: 'cashout', aid: 'out1' });
    await c.next<any>((m) => m.t === 'seat' && m.status === 'watching', 5000);
    const after = await me(p.token);
    expect(after.balance - start).toBe(credit + (await featPaid(p.id)) - feats0);
    await books(p.id);
    c.ws.close();
  });
});
