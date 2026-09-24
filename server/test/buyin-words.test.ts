import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { connect, login } from './helpers.ts';

// A buy-in or a top-up the table can't take is refused in words a player can act on: the amounts
// written the way the rest of the casino writes money, and for a top-up, how much more fits.

// buy-ins, top-ups and cash-outs share a bucket of three, then one a second
const pace = () => new Promise((r) => setTimeout(r, 1_050));

describe('buy-in and top-up refusals', () => {
  it('say the range, how much more a stack can take, and whole dollars', { timeout: 20_000 }, async () => {
    const { token, profile } = await login('words_buyin');
    const { client } = await connect('solo/limbo', token);
    const c = client!;
    const hello = await c.next((m) => m.t === 'table');
    expect(hello.meta.config.buyIn).toEqual({ min: 1_000, max: 10_000_000 });

    c.send({ t: 'buyin', aid: 'low', amount: 500 });
    expect((await c.next((m) => m.t === 'err' && m.ref === 'low')).msg).toBe('This table takes $10 to $100,000.');
    c.send({ t: 'buyin', aid: 'cents', amount: 1_050 });
    expect((await c.next((m) => m.t === 'err' && m.ref === 'cents')).msg).toBe('Chips come in whole dollars.');

    c.send({ t: 'buyin', aid: 'in', amount: 4_000_000 });
    await c.next((m) => m.t === 'seat' && m.status === 'seated');
    await pace();
    c.send({ t: 'topup', aid: 'over', amount: 7_000_000 });
    expect((await c.next((m) => m.t === 'err' && m.ref === 'over')).msg).toBe('This table takes $100,000 at most: you can add up to $60,000.');
    await pace();
    c.send({ t: 'topup', aid: 'fits', amount: 500_000 });
    await c.next((m) => m.t === 'seat' && m.stack === 4_500_000);

    // at the top already
    await env.DB.prepare(`UPDATE casino_accounts SET balance = balance + 6_000_000 WHERE id = ?1`).bind(profile.id).run();
    await env.DB.prepare(`INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) VALUES ('test:words', ?1, 'grant', 6000000, NULL, 0)`).bind(profile.id).run();
    await pace();
    c.send({ t: 'topup', aid: 'full', amount: 5_500_000 });
    await c.next((m) => m.t === 'seat' && m.stack === 10_000_000);
    await pace();
    c.send({ t: 'topup', aid: 'more', amount: 100 });
    expect((await c.next((m) => m.t === 'err' && m.ref === 'more')).msg).toBe('This table takes $100,000 at most, and you have $100,000 here.');
  });
});
