import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { applyTransfer, buyInStatements, cashOutStatements, takeLoan } from '../src/transfer.ts';
import { createAccount } from '../src/db.ts';

// The hash doesn't matter to money; each account gets a salt of its own, as real ones do.
const pass = () => ({ hash: `pbkdf2:1:${'0'.repeat(64)}`, salt: crypto.randomUUID().replace(/-/g, '') });

async function account(name: string) {
  return (await createAccount(env.DB, name, pass(), Date.now()))!;
}

describe('D1 transfers', () => {
  it('a new account gets $50,000 and a grant row, once', async () => {
    const a = await account('grant_me');
    expect(a.balance).toBe(5_000_000);
    // The same name in other letters is the same account: nothing new, no second grant.
    expect(await createAccount(env.DB, 'GRANT_ME', pass(), Date.now() + 5)).toBeNull();
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
});

describe('the bank top-up', () => {
  const setBalance = (id: number, cents: number) => env.DB.prepare(`UPDATE casino_accounts SET balance = ?2 WHERE id = ?1`).bind(id, cents).run();
  const loan = (id: number, opId: string, chips = 0, inPlay = 0) => takeLoan(env.DB, { opId, accountId: id, chips, inPlay, now: Date.now() });
  const books = async (id: number) => ({
    acct: await env.DB.prepare(`SELECT balance, in_play, loans_taken FROM casino_accounts WHERE id = ?1`).bind(id).first<any>(),
    loans: (await env.DB.prepare(`SELECT op_id, amount FROM casino_loans WHERE account_id = ?1 ORDER BY created_at, op_id`).bind(id).all<any>()).results,
    ledger: (await env.DB.prepare(`SELECT op_id, amount FROM casino_ledger WHERE account_id = ?1 AND kind = 'loan'`).bind(id).all<any>()).results,
  });

  it('at $9,999.99 tops up by $40,000.01 to exactly $50,000, with a loan row and a ledger row', async () => {
    const a = await account('refill_1');
    await setBalance(a.id, 999_999);
    const r = await loan(a.id, 'loan:r1:a');
    expect(r).toMatchObject({ granted: true, amount: 4_000_001, money: { balance: 5_000_000, in_play: 0 } });
    expect(await books(a.id)).toEqual({
      acct: { balance: 5_000_000, in_play: 0, loans_taken: 1 },
      loans: [{ op_id: 'loan:r1:a', amount: 4_000_001 }],
      ledger: [{ op_id: 'loan:r1:a', amount: 4_000_001 }],
    });
  });

  it('at exactly $10,000 does nothing at all', async () => {
    const a = await account('refill_2');
    await setBalance(a.id, 1_000_000);
    expect(await loan(a.id, 'loan:r2:a')).toEqual({ granted: false });
    expect(await books(a.id)).toEqual({ acct: { balance: 1_000_000, in_play: 0, loans_taken: 0 }, loans: [], ledger: [] });
  });

  it('at $0 lends the whole $50,000', async () => {
    const a = await account('refill_3');
    await setBalance(a.id, 0);
    expect(await loan(a.id, 'loan:r3:a')).toMatchObject({ granted: true, amount: 5_000_000, money: { balance: 5_000_000 } });
  });

  it('counts chips on tables: the top-up lands the balance plus chips on $50,000', async () => {
    const a = await account('refill_4');
    // $3,000 in the balance and $2,000 at a table (its stack, whatever went in).
    await setBalance(a.id, 300_000);
    const r = await loan(a.id, 'loan:r4:a', 200_000);
    expect(r).toMatchObject({ granted: true, amount: 4_500_000, money: { balance: 4_800_000 } });
    // $3,000 and $7,000 on tables is $10,000 in all: nothing.
    const b = await account('refill_5');
    await setBalance(b.id, 300_000);
    expect((await loan(b.id, 'loan:r5:a', 700_000)).granted).toBe(false);
    expect((await loan(b.id, 'loan:r5:b', 699_999)).amount).toBe(4_000_001);
  });

  it('does nothing when what D1 holds on tables changed since the chips were counted', async () => {
    const a = await account('refill_6');
    await setBalance(a.id, 0);
    // The count was made while $1,000 sat in an escrow that has since closed (or opened).
    expect((await loan(a.id, 'loan:r6:a', 100_000, 100_000)).granted).toBe(false);
    expect((await books(a.id)).loans).toEqual([]);
    expect((await loan(a.id, 'loan:r6:b', 0, 0)).granted).toBe(true);
  });

  it('is idempotent: the same op twice is one loan, and two ops at once are one loan', async () => {
    const a = await account('refill_7');
    await setBalance(a.id, 250_000);
    const first = await loan(a.id, 'loan:r7:a');
    const again = await loan(a.id, 'loan:r7:a');
    expect(first).toMatchObject({ granted: true, amount: 4_750_000 });
    expect(again).toMatchObject({ granted: true, amount: 4_750_000 });
    expect(await books(a.id)).toEqual({
      acct: { balance: 5_000_000, in_play: 0, loans_taken: 1 },
      loans: [{ op_id: 'loan:r7:a', amount: 4_750_000 }],
      ledger: [{ op_id: 'loan:r7:a', amount: 4_750_000 }],
    });

    const b = await account('refill_8');
    await setBalance(b.id, 0);
    const both = await Promise.all([loan(b.id, 'loan:r8:a'), loan(b.id, 'loan:r8:b'), loan(b.id, 'loan:r8:c')]);
    expect(both.filter((r) => r.granted)).toHaveLength(1);
    expect((await books(b.id)).acct).toEqual({ balance: 5_000_000, in_play: 0, loans_taken: 1 });
  });

  it('can be asked again every time the player is back under the line', async () => {
    const a = await account('refill_9');
    let n = 0;
    for (const left of [0, 999_999, 12_345]) {
      await setBalance(a.id, left);
      expect((await loan(a.id, `loan:r9:${++n}`)).amount).toBe(5_000_000 - left);
    }
    const { acct, loans } = await books(a.id);
    expect(acct).toEqual({ balance: 5_000_000, in_play: 0, loans_taken: 3 });
    expect(loans.map((l: any) => l.amount)).toEqual([5_000_000, 4_000_001, 4_987_655]);
  });

  it('refuses chip counts that are not whole cents', async () => {
    const a = await account('refill_10');
    await expect(loan(a.id, 'loan:r10:a', 12.5)).rejects.toThrow();
    await expect(loan(a.id, 'loan:r10:b', -1)).rejects.toThrow();
  });
});
