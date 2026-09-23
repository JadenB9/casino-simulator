import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { applyTransfer, buyInStatements, cashOutStatements, takeLoan } from '../src/transfer.ts';
import { loginAccount } from '../src/db.ts';

async function account(name: string) {
  return (await loginAccount(env.DB, name, Date.now())).account;
}

describe('D1 transfers', () => {
  it('a new account gets $50,000 and a grant row, once', async () => {
    const a = await account('grant_me');
    expect(a.balance).toBe(5_000_000);
    await loginAccount(env.DB, 'GRANT_ME', Date.now() + 5);
    const rows = await env.DB.prepare(`SELECT kind, amount FROM casino_ledger WHERE account_id = ?1`).bind(a.id).all();
    expect(rows.results).toEqual([{ kind: 'grant', amount: 5_000_000 }]);
  });

  it('buy-in moves money to escrow; a retry is applied once; an overdraft is refused', async () => {
    const a = await account('buyer_1');
    const op = { opId: 't:x:1', accountId: a.id, tableId: 't', amount: 100_000, now: 1 };
    expect((await applyTransfer(env.DB, buyInStatements(env.DB, op), op.opId)).kind).toBe('applied');
    expect((await applyTransfer(env.DB, buyInStatements(env.DB, op), op.opId)).kind).toBe('applied');
    const after = await env.DB.prepare(`SELECT balance, in_play FROM casino_accounts WHERE id = ?1`).bind(a.id).first<any>();
    expect(after).toEqual({ balance: 4_900_000, in_play: 100_000 });
    const big = { opId: 't:x:2', accountId: a.id, tableId: 't', amount: 99_000_000, now: 2 };
    expect((await applyTransfer(env.DB, buyInStatements(env.DB, big), big.opId)).kind).toBe('insufficient');
    const ledger = await env.DB.prepare(`SELECT count(*) AS n FROM casino_ledger WHERE op_id = 't:x:2'`).first<any>();
    expect(ledger.n).toBe(0);
  });

  it('cash-out returns the stack, closes the escrow and folds in stats', async () => {
    const a = await account('casher_1');
    const buy = { opId: 'c:y:1', accountId: a.id, tableId: 'c', amount: 50_000, now: 1 };
    await applyTransfer(env.DB, buyInStatements(env.DB, buy), buy.opId);
    const stats = { game: 'blackjack' as const, rounds: 4, wagered: 20_000, net: 7_500, biggestWin: 5_000 };
    const out = { opId: 'c:y:2', accountId: a.id, tableId: 'c', stack: 57_500, now: 2, stats };
    const r = await applyTransfer(env.DB, cashOutStatements(env.DB, out), out.opId);
    expect(r).toMatchObject({ kind: 'applied', balance: 5_007_500, inPlay: 0 });
    const esc = await env.DB.prepare(`SELECT count(*) AS n FROM casino_escrow WHERE account_id = ?1`).bind(a.id).first<any>();
    expect(esc.n).toBe(0);
    const st = await env.DB.prepare(`SELECT rounds, net, biggest_win FROM casino_stats WHERE account_id = ?1`).bind(a.id).first<any>();
    expect(st).toEqual({ rounds: 4, net: 7_500, biggest_win: 5_000 });
  });

  it('refuses a transfer for a missing account and a fractional amount', async () => {
    const op = { opId: 'm:z:1', accountId: 999_999, tableId: 'm', amount: 100, now: 1 };
    await expect(applyTransfer(env.DB, buyInStatements(env.DB, op), op.opId)).rejects.toThrow();
    const a = await account('fraction_1');
    const frac = { opId: 'm:z:2', accountId: a.id, tableId: 'm', amount: 12.5, now: 1 };
    await expect(applyTransfer(env.DB, buyInStatements(env.DB, frac), frac.opId)).rejects.toThrow();
  });

  it('lends only at $0 with nothing on the tables, and only once', async () => {
    const a = await account('broke_1');
    expect((await takeLoan(env.DB, a.id, 1, 'loan:a')).granted).toBe(false);
    await env.DB.prepare(`UPDATE casino_accounts SET balance = 0 WHERE id = ?1`).bind(a.id).run();
    const first = await takeLoan(env.DB, a.id, 2, 'loan:b');
    expect(first.granted).toBe(true);
    expect(first.money?.balance).toBe(5_000_000);
    expect((await takeLoan(env.DB, a.id, 3, 'loan:c')).granted).toBe(false);
    const n = await env.DB.prepare(`SELECT count(*) AS n FROM casino_loans WHERE account_id = ?1`).bind(a.id).first<any>();
    expect(n.n).toBe(1);
  });
});
