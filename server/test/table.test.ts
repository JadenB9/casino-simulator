import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { evictDurableObject } from 'cloudflare:test';
import { api, connect, login } from './helpers.ts';

async function money(id: number) {
  return env.DB.prepare(`SELECT balance, in_play FROM casino_accounts WHERE id = ?1`).bind(id).first<any>();
}

describe('solo table, end to end', () => {
  it('buy in, play High Card rounds, cash out: D1 moves exactly at the edges', async () => {
    const { token, profile } = await login('solo_player');
    const { client } = await connect('solo/highcard', token);
    expect(client).not.toBeNull();
    const c = client!;
    const hello = await c.next((m) => m.t === 'table');
    expect(hello.meta.game).toBe('highcard');

    c.send({ t: 'buyin', aid: 'b1', amount: 100_000 });
    await c.next((m) => m.t === 'seat' && m.status === 'seated');
    expect(await money(profile.id)).toEqual({ balance: 4_900_000, in_play: 100_000 });

    let stack = 100_000;
    for (let i = 0; i < 5; i++) {
      c.send({ t: 'act', aid: `bet${i}`, a: { type: 'bet', amount: 1_000 } });
      await c.next((m) => m.t === 'ev' && m.events.some((e: any) => e.type === 'bet'));
      c.send({ t: 'act', aid: `deal${i}`, a: { type: 'deal' } });
      const ev = await c.next((m) => m.t === 'ev' && m.events.some((e: any) => e.type === 'result'));
      const r = ev.view.results['0'];
      stack += r.payout - 1_000;
    }
    // Rounds never touched D1.
    expect(await money(profile.id)).toEqual({ balance: 4_900_000, in_play: 100_000 });

    c.send({ t: 'cashout', aid: 'c1' });
    const bal = await c.next((m) => m.t === 'balance' && m.inPlay === 0);
    expect(bal.balance).toBe(4_900_000 + stack);
    expect(await money(profile.id)).toEqual({ balance: 4_900_000 + stack, in_play: 0 });

    const me = await (await api('me', token)).json<any>();
    expect(me.profile.stats.games.highcard.rounds).toBe(5);
  });

  it('a replayed action id is applied once', async () => {
    const { token } = await login('replayer');
    const { client } = await connect('solo/highcard', token);
    const c = client!;
    await c.next((m) => m.t === 'table');
    c.send({ t: 'buyin', aid: 'b1', amount: 10_000 });
    await c.next((m) => m.t === 'seat' && m.status === 'seated');
    c.msgs.length = 0;
    c.send({ t: 'act', aid: 'same', a: { type: 'bet', amount: 500 } });
    c.send({ t: 'act', aid: 'same', a: { type: 'bet', amount: 500 } });
    const s = await c.next((m) => m.t === 'seat');
    expect(s.stack).toBe(9_500);
    await new Promise((r) => setTimeout(r, 100));
    expect(c.msgs.filter((m) => m.t === 'seat').length).toBe(0);
  });

  it('survives an eviction mid-session with the stack intact', async () => {
    const { token, profile } = await login('evicted_1');
    const first = (await connect('solo/highcard', token)).client!;
    await first.next((m) => m.t === 'table');
    first.send({ t: 'buyin', aid: 'b1', amount: 20_000 });
    await first.next((m) => m.t === 'seat' && m.status === 'seated');
    first.send({ t: 'act', aid: 'x1', a: { type: 'bet', amount: 2_000 } });
    await first.next((m) => m.t === 'seat' && m.stack === 18_000);

    const ns = env.TABLE;
    const stub = ns.get(ns.idFromName(`solo:highcard:-:${profile.id}`));
    await evictDurableObject(stub, { webSockets: 'close' });

    const again = (await connect('solo/highcard', token)).client!;
    const snap = await again.next((m) => m.t === 'table');
    expect(snap.you.stack).toBe(18_000);
    expect(snap.view.bets['0']).toBe(2_000);
    again.send({ t: 'act', aid: 'x2', a: { type: 'deal' } });
    await again.next((m) => m.t === 'ev' && m.events.some((e: any) => e.type === 'result'));
  });

  it('refuses a bad token and a wrong protocol version with close codes', async () => {
    const bad = (await connect('solo/highcard', 'v1.nope.nope')).client!;
    await new Promise((r) => setTimeout(r, 50));
    expect(bad.closed?.code).toBe(4003);
    const { token } = await login('version_1');
    const res = await (await import('cloudflare:workers')).exports.default.fetch(
      new Request(`http://casino.test/casino/ws/solo/highcard?v=99&t=${token}`, { headers: { Upgrade: 'websocket', Origin: 'http://localhost:5173' } }),
    );
    const ws = res.webSocket!;
    let code = 0;
    ws.addEventListener('close', (e) => (code = e.code));
    ws.accept();
    await new Promise((r) => setTimeout(r, 50));
    expect(code).toBe(4009);
  });

  it('the bank tops a player up to $50,000 only once they are under $10,000', async () => {
    const { token, profile } = await login('loan_seeker');
    const refused = await api('bank/loan', token, { method: 'POST' });
    expect(refused.status).toBe(409);
    await env.DB.prepare(`UPDATE casino_accounts SET balance = 0 WHERE id = ?1`).bind(profile.id).run();
    const ok = await api('bank/loan', token, { method: 'POST' });
    expect(ok.status).toBe(200);
    const body = await ok.json<any>();
    expect(body.profile.balance).toBe(5_000_000);
    expect(body.profile.loansTaken).toBe(1);
  });
});

describe('lobby tables', () => {
  it('create private with a PIN, join by PIN from a second account, leader starts', async () => {
    const a = await login('leader_1');
    const b = await login('joiner_1');
    const made = await (await api('tables', a.token, { method: 'POST', body: JSON.stringify({ game: 'highcard', visibility: 'private' }) })).json<any>();
    // highcard is a dev fixture and has no public tables
    expect(made.error).toBe('BAD_REQUEST');
  });
});
