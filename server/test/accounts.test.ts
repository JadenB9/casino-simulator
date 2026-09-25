// The account API: login rules and rate limits, the profile, looks, and the bank's top-up rule,
// including chips sitting on a table (and bets out on its felt). Storage is shared by every test
// in this file, so each test uses its own names and its own client IP (the rate limits are per IP).
// Passwords themselves are in auth.test.ts.

import { describe, it, expect } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { signToken } from '../src/auth.ts';
import type { CasinoTable } from '../src/table/host.ts';
import { DEFAULT_LOOK } from '../../shared/src/look.ts';
import { LOAN_AMOUNT, STARTING_BALANCE } from '../../shared/src/money.ts';
import { REFILL_BELOW, REFILL_TO } from '../../shared/src/bank.ts';
import { ORIGIN, TEST_PASSWORD, api, connect, type Client } from './helpers.ts';

let ipSeq = 0;
const freshIp = () => `198.51.100.${++ipSeq}`;

function loginRaw(body: string, ip: string, origin = ORIGIN): Promise<Response> {
  return exports.default.fetch(
    new Request('http://casino.test/casino/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': ip },
      body,
    }),
  );
}

const loginAs = (name: unknown, ip = freshIp(), password: unknown = TEST_PASSWORD) => loginRaw(JSON.stringify({ name, password }), ip);

async function account(name: string, ip = freshIp()): Promise<{ token: string; profile: any }> {
  const res = await loginAs(name, ip);
  expect(res.status).toBe(200);
  return res.json<any>();
}

const loan = (token: string) => api('bank/loan', token, { method: 'POST' });
const me = async (token: string) => (await (await api('me', token)).json<any>()).profile;
const putLook = (token: string, body: unknown) => api('me/look', token, { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) });

async function money(id: number): Promise<{ balance: number; in_play: number }> {
  return (await env.DB.prepare(`SELECT balance, in_play FROM casino_accounts WHERE id = ?1`).bind(id).first<any>())!;
}

async function count(sql: string, ...args: unknown[]): Promise<number> {
  return (await env.DB.prepare(sql).bind(...args).first<{ n: number }>())!.n;
}

/** Sit down at your solo High Card table with `amount` in chips. */
async function seatAtHighCard(token: string, amount: number): Promise<Client> {
  const { client } = await connect('solo/highcard', token);
  const c = client!;
  await c.next<any>((m) => m.t === 'table');
  c.send({ t: 'buyin', aid: 'buy1', amount });
  await c.next<any>((m) => m.t === 'seat' && m.status === 'seated', 5000);
  return c;
}

describe('login', () => {
  it('refuses names outside the rule with 400 BAD_NAME and creates nothing', async () => {
    const ip = freshIp();
    const before = await count(`SELECT count(*) AS n FROM casino_accounts`);
    for (const name of ['', 'ab', 'a'.repeat(17), 'has space', 'dash-name', 'héllo', 'semi;colon', 'tab\tname', 12345, null, ['arr']]) {
      const res = await loginAs(name, ip);
      expect(res.status, JSON.stringify(name)).toBe(400);
      expect((await res.json<any>()).error).toBe('BAD_NAME');
    }
    const missing = await loginRaw('{}', ip);
    expect(missing.status).toBe(400);
    const notJson = await loginRaw('name=ace', ip);
    expect(notJson.status).toBe(400);
    expect(await count(`SELECT count(*) AS n FROM casino_accounts`)).toBe(before);
  });

  it('takes names of exactly 3 and 16 characters of letters, digits and _', async () => {
    for (const name of ['abc', 'Z'.repeat(16), 'under_score_9', '___']) {
      expect((await loginAs(name)).status, name).toBe(200);
    }
  });

  it('is case-insensitive: every spelling opens one account, which keeps its first spelling', async () => {
    const first = await account('CaseKing');
    for (const spelling of ['caseking', 'CASEKING', 'cAsEkInG']) {
      const again = await account(spelling);
      expect(again.profile.id).toBe(first.profile.id);
      expect(again.profile.name).toBe('CaseKing');
      expect((await me(again.token)).name).toBe('CaseKing');
    }
    expect(await count(`SELECT count(*) AS n FROM casino_accounts WHERE name = 'caseking'`)).toBe(1);
    expect(await count(`SELECT count(*) AS n FROM casino_ledger WHERE account_id = ?1 AND kind = 'grant'`, first.profile.id)).toBe(1);
  });

  it('opens a new account with $50,000 and records the grant in the ledger', async () => {
    const t0 = Date.now();
    const { profile } = await account('Newcomer_1');
    expect(profile.balance).toBe(STARTING_BALANCE);
    expect(STARTING_BALANCE).toBe(5_000_000);
    expect(profile).toMatchObject({ name: 'Newcomer_1', inPlay: 0, rev: 0, loansTaken: 0, loans: [], tables: [] });
    expect(profile.look).toEqual(DEFAULT_LOOK);
    expect(profile.createdAt).toBeGreaterThanOrEqual(t0);
    expect(profile.createdAt).toBeLessThanOrEqual(Date.now());
    const ledger = await env.DB.prepare(`SELECT kind, amount FROM casino_ledger WHERE account_id = ?1`).bind(profile.id).all<any>();
    expect(ledger.results).toEqual([{ kind: 'grant', amount: STARTING_BALANCE }]);
  });

  it('refuses requests from other sites', async () => {
    const res = await loginRaw(JSON.stringify({ name: 'Elsewhere' }), freshIp(), 'https://evil.example');
    expect(res.status).toBe(403);
  });
});

describe('rate limits', () => {
  it('allows 10 new accounts per IP per hour; existing accounts still log in', async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) expect((await loginAs(`burst_${i}`, ip)).status).toBe(200);
    const eleventh = await loginAs('burst_10', ip);
    expect(eleventh.status).toBe(429);
    expect((await eleventh.json<any>()).error).toBe('RATE_LIMITED');
    expect(await count(`SELECT count(*) AS n FROM casino_accounts WHERE name = 'burst_10'`)).toBe(0);
    // an account that already exists is a login, not a creation
    expect((await loginAs('burst_3', ip)).status).toBe(200);
    // and another address is unaffected
    expect((await loginAs('burst_10', freshIp())).status).toBe(200);
  });

  it('allows 30 login attempts per IP per minute, refused names included', async () => {
    const ip = freshIp();
    expect((await loginAs('Hammer_1', ip)).status).toBe(200);
    for (let i = 0; i < 29; i++) expect((await loginAs('x', ip)).status).toBe(400);
    const res = await loginAs('Hammer_1', ip);
    expect(res.status).toBe(429);
    expect((await res.json<any>()).error).toBe('RATE_LIMITED');
  });
});

describe('profile', () => {
  it('/me returns the whole profile shape, uncached', async () => {
    const { token, profile } = await account('Shape_1');
    const res = await api('me', token);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const p = (await res.json<any>()).profile;
    expect(Object.keys(p).sort()).toEqual(['balance', 'bank', 'createdAt', 'id', 'inPlay', 'loans', 'loansTaken', 'look', 'name', 'rev', 'stats', 'tables']);
    // v6 bank6: nothing in the bank yet, so net worth is the balance
    expect(p.bank).toEqual({ savings: 0, deposits: 0, fundCost: 0, fundValue: 0, gain: 0, worth: STARTING_BALANCE });
    expect(p.id).toBe(profile.id);
    expect(p.stats).toEqual({ total: { rounds: 0, wagered: 0, net: 0, biggestWin: 0 }, games: {} });
  });

  it('refuses missing, forged, expired and orphaned tokens with 401', async () => {
    const { token, profile } = await account('Tokens_1');
    const bare = await exports.default.fetch(new Request('http://casino.test/casino/api/me', { headers: { Origin: ORIGIN } }));
    expect(bare.status).toBe(401);
    expect((await api('me', 'v1.garbage.sig')).status).toBe(401);
    const [v, payload] = token.split('.');
    expect((await api('me', `${v}.${payload}.AAAA`)).status).toBe(401);
    const otherSecret = await signToken('some-other-secret', profile.id, profile.name, Date.now());
    expect((await api('me', otherSecret)).status).toBe(401);
    const expired = await signToken(env.CASINO_TOKEN_SECRET, profile.id, profile.name, Date.now() - 31 * 86_400_000);
    expect((await api('me', expired)).status).toBe(401);
    const orphan = await signToken(env.CASINO_TOKEN_SECRET, 987_654, 'Nobody', Date.now());
    expect((await api('me', orphan)).status).toBe(401);
  });

  it('lists chips on a table, with the live stack once the escrow has been open a while', async () => {
    const { token, profile } = await account('Stacker_1');
    const c = await seatAtHighCard(token, 50_000);
    c.send({ t: 'act', aid: 'bet1', a: { type: 'bet', amount: 2_000 } });
    await c.next<any>((m) => m.t === 'seat' && m.stack === 48_000);

    const fresh = await me(token);
    expect(fresh.inPlay).toBe(50_000);
    expect(fresh.balance).toBe(STARTING_BALANCE - 50_000);
    expect(fresh.tables).toEqual([{ tableId: `solo:highcard:-:${profile.id}`, game: 'highcard', escrow: 50_000 }]);

    // Make the escrow look three minutes old: /me asks the table, which reports its live stack.
    await env.DB.prepare(`UPDATE casino_escrow SET updated_at = updated_at - 180000 WHERE account_id = ?1`).bind(profile.id).run();
    const stale = await me(token);
    expect(stale.tables).toEqual([{ tableId: `solo:highcard:-:${profile.id}`, game: 'highcard', escrow: 50_000, stack: 48_000 }]);
    c.ws.close();
  });
});

describe('look', () => {
  const look = { v: 1, body: 'f', outfit: 'dress', skin: 5, hair: '#b8894e', top: '#6b1f2a', bottom: '#1f2430', shoes: '#8a5a34' };

  it('saves a valid look; /me and the next login return it', async () => {
    const { token } = await account('Dresser_1');
    const res = await putLook(token, { look });
    expect(res.status).toBe(200);
    expect((await res.json<any>()).look).toEqual(look);
    expect((await me(token)).look).toEqual(look);
    expect((await account('dresser_1')).profile.look).toEqual(look);
  });

  it('drops keys it does not know', async () => {
    const { token } = await account('Dresser_2');
    const res = await putLook(token, { look: { ...look, hat: '#ffffff', glow: true } });
    expect(res.status).toBe(200);
    expect((await res.json<any>()).look).toEqual(look);
  });

  it('refuses every invalid look with 400 and keeps the one it had', async () => {
    const { token } = await account('Dresser_3');
    expect((await putLook(token, { look })).status).toBe(200);
    const bad: unknown[] = [
      { ...look, v: 2 },
      { ...look, body: 'x' },
      { ...look, body: 'm' }, // a dress is not one of the male outfits
      { ...look, outfit: 'suit' }, // nor is a suit one of the female ones
      { ...look, outfit: 'tuxedo' },
      { ...look, skin: 8 },
      { ...look, skin: -1 },
      { ...look, skin: 1.5 },
      { ...look, skin: '2' },
      { ...look, hair: '#fff' },
      { ...look, top: 'red' },
      { ...look, shoes: '#12345g' },
      (({ bottom: _b, ...rest }) => rest)(look),
      null,
      'dress',
      [look],
    ];
    for (const b of bad) {
      const res = await putLook(token, { look: b });
      expect(res.status, JSON.stringify(b)).toBe(400);
      expect((await res.json<any>()).error).toBe('BAD_REQUEST');
    }
    expect((await putLook(token, {})).status).toBe(400);
    expect((await putLook(token, 'not json')).status).toBe(400);
    // bigger than the 1 KB the endpoint reads
    expect((await putLook(token, { look: { ...look, pad: 'x'.repeat(1100) } })).status).toBe(400);
    expect((await me(token)).look).toEqual(look);
  });

  it('stores colours in lower case whatever case the picker sent', async () => {
    const { token } = await account('Dresser_4');
    const res = await putLook(token, { look: { ...look, hair: '#FFAA00' } });
    expect(res.status).toBe(200);
    expect((await me(token)).look).toEqual({ ...look, hair: '#ffaa00' });
  });

  it('needs a token', async () => {
    const res = await exports.default.fetch(
      new Request('http://casino.test/casino/api/me/look', { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ look }) }),
    );
    expect(res.status).toBe(401);
  });
});

describe('bank', () => {
  const setBalance = (id: number, cents: number) => env.DB.prepare(`UPDATE casino_accounts SET balance = ?2 WHERE id = ?1`).bind(id, cents).run();
  const soloTable = (id: number): DurableObjectStub<CasinoTable> => env.TABLE.get(env.TABLE.idFromName(`solo:highcard:-:${id}`));

  it('refuses a top-up at $10,000 or more in all, and says how much there is', async () => {
    const { token, profile } = await account('Solvent_1');
    const res = await loan(token);
    expect(res.status).toBe(409);
    expect(await res.json<any>()).toEqual({
      error: 'NOT_ELIGIBLE',
      msg: 'You have $50,000 in all. The bank tops you up when that is under $10,000.',
      balance: STARTING_BALANCE,
      inPlay: 0,
    });
    await setBalance(profile.id, REFILL_BELOW);
    expect((await loan(token)).status).toBe(409);
    expect(await count(`SELECT count(*) AS n FROM casino_loans WHERE account_id = ?1`, profile.id)).toBe(0);
    expect((await me(token)).loansTaken).toBe(0);
  });

  it('tops $9,999.99 up to exactly $50,000, counts the loan, and does it again next time', async () => {
    const { token, profile } = await account('Refill_1');
    await setBalance(profile.id, 999_999);
    const res = await loan(token);
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.loan.amount).toBe(4_000_001);
    expect(body.profile).toMatchObject({ balance: REFILL_TO, inPlay: 0, loansTaken: 1 });
    expect(body.profile.loans).toEqual([{ amount: 4_000_001, at: body.loan.at }]);
    // At $50,000 there's nothing more to ask for...
    expect((await loan(token)).status).toBe(409);
    // ...until the player is under the line again.
    await setBalance(profile.id, 0);
    const again = await (await loan(token)).json<any>();
    expect(again.loan.amount).toBe(LOAN_AMOUNT);
    expect(again.profile.loansTaken).toBe(2);
    expect(again.profile.loans.map((l: any) => l.amount)).toEqual([LOAN_AMOUNT, 4_000_001]);
    expect(await count(`SELECT count(*) AS n FROM casino_ledger WHERE account_id = ?1 AND kind = 'loan'`, profile.id)).toBe(2);
  });

  it('counts chips on a table, and tops up while the player stays seated', async () => {
    const { token, profile } = await account('Seated_1');
    const c = await seatAtHighCard(token, 100_000);
    // $1,000 at the table and nothing else.
    await setBalance(profile.id, 0);
    const res = await loan(token);
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.loan.amount).toBe(4_900_000);
    expect(body.profile).toMatchObject({ balance: 4_900_000, inPlay: 100_000, loansTaken: 1 });

    // The seat didn't notice.
    c.send({ t: 'sync' });
    const snap = await c.next<any>((m) => m.t === 'table');
    expect(snap.you).toMatchObject({ status: 'seated', stack: 100_000 });

    // $49,000 here and $1,000 on the table is $50,000 in all.
    const refused = await loan(token);
    expect(refused.status).toBe(409);
    expect((await refused.json<any>()).msg).toBe('You have $50,000 in all, $1,000 of it in chips on tables. The bank tops you up when that is under $10,000.');
    c.ws.close();
  });

  it('counts bets out on the felt, so chips put down for a moment still count', async () => {
    const { token, profile } = await account('Felt_1');
    const c = await seatAtHighCard(token, 150_000);
    c.send({ t: 'act', aid: 'bet1', a: { type: 'bet', amount: 100_000 } });
    await c.next<any>((m) => m.t === 'seat' && m.stack === 50_000);
    // $8,500 in the balance, $500 in hand and $1,000 on the felt: $10,000 exactly.
    await setBalance(profile.id, 850_000);
    const res = await loan(token);
    expect(res.status).toBe(409);
    expect((await res.json<any>()).msg).toBe('You have $10,000 in all, $1,500 of it in chips on tables. The bank tops you up when that is under $10,000.');
    // A cent less, and the top-up brings it all to exactly $50,000.
    await setBalance(profile.id, 849_999);
    const ok = await (await loan(token)).json<any>();
    expect(ok.loan.amount).toBe(4_000_001);
    expect(ok.profile.balance).toBe(4_850_000);
    c.ws.close();
  });

  it('waits, and says so, while chips are on their way to or from a table', async () => {
    const { token, profile } = await account('Moving_1');
    const c = await seatAtHighCard(token, 100_000);
    await setBalance(profile.id, 0);
    // A top-up the table has recorded but not yet brought in from D1 (not due during this test).
    await runInDurableObject(soloTable(profile.id), (_t, state) => {
      const now = Date.now();
      state.storage.sql.exec(
        `INSERT INTO outbox (op_id, kind, account_id, amount, payload, state, attempts, next_at, created_at) VALUES ('test:topup', 'topup', ?1, 100000, NULL, 'pending', 0, ?2, ?3)`,
        profile.id, now + 3_600_000, now,
      );
    });
    const res = await loan(token);
    expect(res.status).toBe(409);
    expect(await res.json<any>()).toEqual({ error: 'BUSY', msg: 'Chips are still moving at one of your tables. Try again in a moment.' });
    expect(await count(`SELECT count(*) AS n FROM casino_loans WHERE account_id = ?1`, profile.id)).toBe(0);
    await runInDurableObject(soloTable(profile.id), (_t, state) => {
      state.storage.sql.exec(`DELETE FROM outbox WHERE op_id = 'test:topup'`);
    });
    expect((await loan(token)).status).toBe(200);
    c.ws.close();
  });

  it('lends once to a player who lost their last chip at the table, even to two requests at once', async () => {
    const { token, profile } = await account('Busted_1');
    // Down to the table minimum: everything else was lost elsewhere.
    await env.DB.prepare(`UPDATE casino_accounts SET balance = 1000 WHERE id = ?1`).bind(profile.id).run();
    const c = await seatAtHighCard(token, 1_000);
    expect(await money(profile.id)).toEqual({ balance: 0, in_play: 1_000 });

    // Bet the whole stack until it's gone. Each round is close to a coin flip, so this ends fast.
    let stack = 1_000;
    for (let round = 0; stack > 0; round++) {
      expect(round).toBeLessThan(200);
      // A lucky streak can run past the table's action limit (12 a second after a burst of 24);
      // an action it refuses would never produce the event waited for below.
      if (round >= 8) await new Promise((r) => setTimeout(r, 180));
      const bet = Math.min(stack, 100_000);
      c.send({ t: 'act', aid: `b${round}`, a: { type: 'bet', amount: bet } });
      await c.next<any>((m) => m.t === 'ev' && m.events.some((e: any) => e.type === 'bet' && e.total === bet));
      c.send({ t: 'act', aid: `d${round}`, a: { type: 'deal' } });
      const ev = await c.next<any>((m) => m.t === 'ev' && m.events.some((e: any) => e.type === 'result'));
      stack += ev.view.results['0'].payout - bet;
    }
    // A stack at zero with nothing on the layout is cashed out straight away, closing the escrow.
    const bal = await c.next<any>((m) => m.t === 'balance' && m.inPlay === 0, 5000);
    expect(bal.balance).toBe(0);
    expect(await money(profile.id)).toEqual({ balance: 0, in_play: 0 });

    const [a, b] = await Promise.all([loan(token), loan(token)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const after = await me(token);
    expect(after).toMatchObject({ balance: LOAN_AMOUNT, inPlay: 0, loansTaken: 1 });
    expect(after.stats.games.highcard.rounds).toBeGreaterThan(0);
    expect(await count(`SELECT count(*) AS n FROM casino_loans WHERE account_id = ?1`, profile.id)).toBe(1);

    // Every cent is accounted for: starting grant + loan + table results = balance.
    const ledger = await count(`SELECT COALESCE(SUM(amount), 0) AS n FROM casino_ledger WHERE account_id = ?1`, profile.id);
    const adjusted = STARTING_BALANCE - 1_000; // what the direct UPDATE above removed
    expect(ledger - adjusted).toBe(after.balance + after.inPlay);
    c.ws.close();
  }, 60_000);
});
