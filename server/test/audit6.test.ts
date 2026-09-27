// The v6 odds-and-cheese audit (docs/ODDS-AUDIT.md): each hole it found, shown closed.

import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import worker from '../src/index.ts';
import { CLOSE } from '../../shared/src/protocol.ts';
import { roundFacts } from '../src/feats.ts';
import { STRIKE_QUIET_MS, bailFor } from '../../shared/src/law/rules.ts';
import type { CasinoFloor } from '../src/floor/index.ts';
import { Client, ORIGIN, api, connect, ticketFor } from './helpers.ts';
import { closedWith, floor, money, player } from './party.ts';

/** A socket to `path` through the Worker with its env as given (the dev flag on or off). */
async function socketWith(e: Env, path: string, token: string): Promise<Client> {
  const ticket = await ticketFor(path, token);
  const res = await worker.fetch(
    new Request(`http://casino.test/casino/ws/${path}?v=1&ticket=${encodeURIComponent(ticket!)}`, { headers: { Upgrade: 'websocket', Origin: ORIGIN } }),
    e,
  );
  return new Client(res.webSocket!);
}

describe('the test fixture game', () => {
  it("High Card (no house edge) opens only on the dev stack, not in production", async () => {
    const p = await player('aud_hc');
    const off = await socketWith({ ...env, CASINO_DEV: undefined } as unknown as Env, 'solo/highcard', p.token);
    expect((await closedWith(off)).code).toBe(CLOSE.NOT_FOUND);
    const on = await socketWith(env, 'solo/highcard', p.token);
    expect((await on.next<any>((m) => m.t === 'table')).meta.game).toBe('highcard');
    // a real game still opens off the dev stack
    const bj = await socketWith({ ...env, CASINO_DEV: undefined } as unknown as Env, 'solo/blackjack', p.token);
    expect((await bj.next<any>((m) => m.t === 'table')).meta.game).toBe('blackjack');
  });
});

describe('amounts won', () => {
  it("a pot won from other players counts at Hold'em only, never toward the amount challenges or the boards", () => {
    const pot = roundFacts('holdem', '', { events: [], state: null }, { seat: 0, wagered: 1_000_000, returned: 101_000_000 }, '2026-09-25');
    expect(pot.tally.won).toBeUndefined();
    expect(pot.tally.best).toBeUndefined();
    expect(pot.tally.wins).toBeUndefined();
    expect(pot.tally['d:2026-09-25:won']).toBeUndefined();
    expect(pot.tally['won:holdem']).toBe(100_000_000);
    const lost = roundFacts('holdem', '', { events: [], state: null }, { seat: 0, wagered: 1_000_000, returned: 0 });
    expect(lost.tally.lost).toBeUndefined();
    expect(lost.tally['lost:holdem']).toBe(1_000_000);
    // a win from the house counts everywhere
    const hand = roundFacts('blackjack', '', { events: [], state: null }, { seat: 0, wagered: 1_000_000, returned: 2_000_000 });
    expect(hand.tally.won).toBe(1_000_000);
    expect(hand.tally.best).toBe(1_000_000);
  });
});

describe('jail', () => {
  it('bail counts the bank too: parking money in savings first leaves the bail as it was', async () => {
    const p = await player('aud_bail');
    await env.DB.prepare(`UPDATE casino_accounts SET balance = 10000000 WHERE id = ?1`).bind(p.id).run();
    const saved = await api('bank/savings', p.token, { method: 'POST', body: JSON.stringify({ op: 'aud-save-1', dir: 'in', amount: 9_000_000 }) });
    expect(saved.status).toBe(200);
    expect((await money(p.id)).balance).toBe(1_000_000);
    await runInDurableObject(floor(), async (f: CasinoFloor) => {
      const now = Date.now();
      await f.law.strike(p.id, p.name, 'g1', 'punch', now);
      await f.law.strike(p.id, p.name, 'g1', 'punch', now + STRIKE_QUIET_MS + 1);
    });
    const row = await env.DB.prepare(`SELECT bail FROM casino_jail WHERE account_id = ?1`).bind(p.id).first<{ bail: number }>();
    // $100,000 in all ($90,000 of it saved): $2,000, not the $1,000 floor that $10,000 would give
    expect(row!.bail).toBe(bailFor(10_000_000));
    expect(row!.bail).toBe(200_000);
  });
});
