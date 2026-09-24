// Passwords: the hash, every way a login can go (new name, claimed name, an account from before
// passwords, races for one name), the wrong-password limits per address and per name, and the
// token version that retired the name-only logins. Storage is shared by every test in this
// file, so each test uses its own names and its own client addresses.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { MISSES_PER_IP, MISSES_PER_NAME, PBKDF2_ITERATIONS, hashPassword, pbkdf2, verifyPassword } from '../src/auth.ts';
import { ipKey } from '../src/floor/directory.ts';
import { ORIGIN, api } from './helpers.ts';

let ipSeq = 0;
// A /64 of its own each time: limits count an IPv6 /64 as one address.
const freshIp = () => `2001:db8:${(++ipSeq).toString(16)}::1`;
const enc = new TextEncoder();
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

function login(body: unknown, ip = freshIp()): Promise<Response> {
  return exports.default.fetch(
    new Request('http://casino.test/casino/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': ip },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

async function row(name: string): Promise<{ id: number; pass_hash: string | null; pass_salt: string | null }> {
  return (await env.DB.prepare(`SELECT id, pass_hash, pass_salt FROM casino_accounts WHERE name = ?1`).bind(name).first<any>())!;
}

async function count(sql: string, ...args: unknown[]): Promise<number> {
  return (await env.DB.prepare(sql).bind(...args).first<{ n: number }>())!.n;
}

/** An account the way every account looked before passwords: a name, money, no hash. */
async function oldAccount(name: string): Promise<number> {
  const now = Date.now();
  const r = await env.DB.prepare(`INSERT INTO casino_accounts (name, balance, created_at, last_seen) VALUES (?1, 5000000, ?2, ?2) RETURNING id`)
    .bind(name, now)
    .first<{ id: number }>();
  return r!.id;
}

describe('password hashing', () => {
  it('is PBKDF2-HMAC-SHA256: the RFC 7914 test vectors', async () => {
    expect(hex(await pbkdf2('passwd', enc.encode('salt'), 1))).toBe('55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc');
    expect(hex(await pbkdf2('Password', enc.encode('NaCl'), 80_000))).toBe('4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56');
  });

  it('runs 100,000 iterations', () => {
    expect(PBKDF2_ITERATIONS).toBe(100_000);
  });

  it('stores "pbkdf2:100000:<hex>" under a fresh 16-byte salt every time', async () => {
    const a = await hashPassword('hunter22');
    const b = await hashPassword('hunter22');
    for (const h of [a, b]) {
      expect(h.hash).toMatch(/^pbkdf2:100000:[0-9a-f]{64}$/);
      expect(h.salt).toMatch(/^[0-9a-f]{32}$/);
    }
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('verifies the right password and nothing else', async () => {
    const h = await hashPassword('hunter22');
    expect(await verifyPassword('hunter22', h)).toBe(true);
    for (const wrong of ['hunter23', 'Hunter22', 'hunter22 ', 'hunter2', '']) expect(await verifyPassword(wrong, h), wrong).toBe(false);
  });

  it('checks against the iteration count that was stored', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const stored = { hash: `pbkdf2:1000:${hex(await pbkdf2('older one', salt, 1000))}`, salt: hex(salt) };
    expect(await verifyPassword('older one', stored)).toBe(true);
    expect(await verifyPassword('older two', stored)).toBe(false);
  });

  it('treats a damaged or unknown record as a mismatch, never a match', async () => {
    const h = await hashPassword('hunter22');
    const digits = h.hash.slice(-64);
    const flipped = digits.slice(0, -1) + (digits.endsWith('0') ? '1' : '0');
    const bad = [
      { ...h, hash: `pbkdf2:100000:${flipped}` },
      { ...h, hash: `pbkdf2:100000:${digits.slice(2)}` },
      { ...h, hash: `pbkdf2:100001:${digits}` },
      { ...h, hash: `pbkdf2:0:${digits}` },
      { ...h, hash: `sha256:${digits}` },
      { ...h, hash: '' },
      { ...h, salt: '' },
      { ...h, salt: 'not hex at all!!' },
      { ...h, salt: h.salt.slice(1) },
    ];
    for (const b of bad) expect(await verifyPassword('hunter22', b), JSON.stringify(b)).toBe(false);
  });

  it('hashes the normalized password, so an accent typed either way matches', async () => {
    const h = await hashPassword('café noir');
    expect(await verifyPassword('café noir', h)).toBe(true);
  });
});

describe('login with a password', () => {
  it('creates a new name with the password it came with', async () => {
    const res = await login({ name: 'Fresh_1', password: 'first-pass' });
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.token).toMatch(/^v2\./);
    expect(body.profile).toMatchObject({ name: 'Fresh_1', balance: 5_000_000, loansTaken: 0 });
    const r = await row('Fresh_1');
    expect(r.pass_hash).toMatch(/^pbkdf2:100000:[0-9a-f]{64}$/);
    expect(await verifyPassword('first-pass', { hash: r.pass_hash!, salt: r.pass_salt! })).toBe(true);
    expect(await count(`SELECT count(*) AS n FROM casino_ledger WHERE account_id = ?1 AND kind = 'grant'`, r.id)).toBe(1);
  });

  it('opens a claimed name, in any spelling, only with its password', async () => {
    const first = await (await login({ name: 'Keeper_1', password: 'keep it safe' })).json<any>();
    for (const name of ['Keeper_1', 'keeper_1', 'KEEPER_1']) {
      const ok = await login({ name, password: 'keep it safe' });
      expect(ok.status, name).toBe(200);
      expect((await ok.json<any>()).profile.id).toBe(first.profile.id);
    }
    for (const password of ['keep it safer', 'Keep it safe', 'keep it saf', 'keep  it safe']) {
      const res = await login({ name: 'Keeper_1', password });
      expect(res.status, password).toBe(401);
      const body = await res.json<any>();
      expect(body).toEqual({ error: 'UNAUTHORIZED', msg: 'Wrong name or password.' });
    }
  });

  it('gives every wrong password the same answer, whoever the account is', async () => {
    await login({ name: 'Same_A', password: 'aaaa-aaaa' });
    const oldId = await oldAccount('Same_B');
    await login({ name: 'Same_B', password: 'bbbb-bbbb' });
    expect((await row('Same_B')).id).toBe(oldId);
    const a = await login({ name: 'Same_A', password: 'nope-nope' });
    const b = await login({ name: 'Same_B', password: 'nope-nope' });
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(await a.text()).toBe(await b.text());
  });

  it('lets the first password claim an account from before passwords, and only that one after', async () => {
    const id = await oldAccount('Oldtimer_1');
    expect((await row('Oldtimer_1')).pass_hash).toBeNull();
    const claim = await login({ name: 'oldtimer_1', password: 'mine now' });
    expect(claim.status).toBe(200);
    expect((await claim.json<any>()).profile).toMatchObject({ id, name: 'Oldtimer_1', balance: 5_000_000 });
    expect((await row('Oldtimer_1')).pass_hash).toMatch(/^pbkdf2:100000:/);
    expect((await login({ name: 'Oldtimer_1', password: 'mine too' })).status).toBe(401);
    expect((await login({ name: 'Oldtimer_1', password: 'mine now' })).status).toBe(200);
    // Claiming isn't creating: no second grant, and the money is what the account had.
    expect(await count(`SELECT count(*) AS n FROM casino_ledger WHERE account_id = ?1`, id)).toBe(0);
  });

  it('refuses a missing or out-of-rule password with 400, before touching any account', async () => {
    const ip = freshIp();
    const before = await count(`SELECT count(*) AS n FROM casino_accounts`);
    const legacy = await oldAccount('Unclaimed_1');
    for (const password of [undefined, null, '', 'abc', 'x'.repeat(65), 1234, ['abcd'], { p: 'abcd' }]) {
      for (const name of ['Nobody_Yet_1', 'Unclaimed_1']) {
        const res = await login({ name, password }, ip);
        expect(res.status, JSON.stringify(password)).toBe(400);
        expect(await res.json<any>()).toEqual({ error: 'BAD_REQUEST', msg: 'Passwords are 4 to 64 characters.' });
      }
    }
    expect(await count(`SELECT count(*) AS n FROM casino_accounts`)).toBe(before + 1);
    expect(await count(`SELECT count(*) AS n FROM casino_accounts WHERE id = ?1 AND pass_hash IS NULL`, legacy)).toBe(1);
    // Exactly 4 and exactly 64 are fine; so is a password of spaces.
    expect((await login({ name: 'Edge_Four', password: 'abcd' })).status).toBe(200);
    expect((await login({ name: 'Edge_Sixty4', password: 'y'.repeat(64) })).status).toBe(200);
    expect((await login({ name: 'Edge_Spaces', password: '    ' })).status).toBe(200);
  });

  it('still checks the name first', async () => {
    const res = await login({ name: 'no spaces', password: 'good password' });
    expect(res.status).toBe(400);
    expect((await res.json<any>()).error).toBe('BAD_NAME');
  });

  it('two people taking one new name at once: one account, the second must know its password', async () => {
    const [a, b] = await Promise.all([
      login({ name: 'Racer_1', password: 'password one' }),
      login({ name: 'RACER_1', password: 'password two' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
    const winner = a.status === 200 ? 'password one' : 'password two';
    expect(await count(`SELECT count(*) AS n FROM casino_accounts WHERE name = 'racer_1'`)).toBe(1);
    const { id } = await row('Racer_1');
    expect(await count(`SELECT count(*) AS n FROM casino_ledger WHERE account_id = ?1 AND kind = 'grant'`, id)).toBe(1);
    expect((await login({ name: 'Racer_1', password: winner })).status).toBe(200);
    // The same password twice at once is simply two logins to one account.
    const [c, d] = await Promise.all([login({ name: 'Racer_2', password: 'same one' }), login({ name: 'Racer_2', password: 'same one' })]);
    expect([c.status, d.status]).toEqual([200, 200]);
    expect((await c.json<any>()).profile.id).toBe((await d.json<any>()).profile.id);
  });

  it('two claims of one old account at once: the first password wins', async () => {
    await oldAccount('Claimed_Twice');
    const [a, b] = await Promise.all([
      login({ name: 'Claimed_Twice', password: 'claim one' }),
      login({ name: 'Claimed_Twice', password: 'claim two' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
    const winner = a.status === 200 ? 'claim one' : 'claim two';
    const loser = winner === 'claim one' ? 'claim two' : 'claim one';
    expect((await login({ name: 'Claimed_Twice', password: winner })).status).toBe(200);
    expect((await login({ name: 'Claimed_Twice', password: loser })).status).toBe(401);
  });

  it('never sends a hash back, and never writes the password where it can be read', async () => {
    const password = 'plain-text-canary-7';
    const logged: string[] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      }),
    );
    try {
      const made = await login({ name: 'Canary_1', password });
      const text = await made.text();
      expect(text).not.toContain(password);
      expect(text).not.toMatch(/pass_hash|pass_salt|pbkdf2/);
      await login({ name: 'Canary_1', password: password + 'x' });
      await oldAccount('Canary_2');
      await login({ name: 'Canary_2', password });
      const me = await (await api('me', JSON.parse(text).token)).text();
      expect(me).not.toMatch(/pass_hash|pass_salt|pbkdf2/);
    } finally {
      for (const s of spies) s.mockRestore();
    }
    expect(logged.join('\n')).not.toContain(password);
    const stored = await env.DB.prepare(`SELECT * FROM casino_accounts WHERE name IN ('Canary_1', 'Canary_2')`).all<any>();
    expect(JSON.stringify(stored.results)).not.toContain(password);
  });
});

describe('wrong-password limits', () => {
  afterEach(() => vi.restoreAllMocks());

  it(`gives an address ${MISSES_PER_IP} wrong passwords per window, then refuses it until the window ends`, async () => {
    await login({ name: 'Guarded_1', password: 'the right one' });
    const ip = freshIp();
    for (let i = 0; i < MISSES_PER_IP; i++) expect((await login({ name: 'Guarded_1', password: `guess ${i}` }, ip)).status).toBe(401);
    // Locked: even the right password is refused from here, and so is any other name.
    const locked = await login({ name: 'Guarded_1', password: 'the right one' }, ip);
    expect(locked.status).toBe(429);
    expect(await locked.json<any>()).toEqual({ error: 'RATE_LIMITED', msg: 'Too many tries. Wait a few minutes and try again.' });
    expect((await login({ name: 'Elsewhere_1', password: 'whatever' }, ip)).status).toBe(429);
    // Other addresses are fine: one address can't lock a name.
    expect((await login({ name: 'Guarded_1', password: 'the right one' })).status).toBe(200);
    // When the window runs out, so does the lock.
    await env.DB.prepare(`UPDATE casino_rate SET expires_at = 0 WHERE k = ?1`).bind(`casino-miss-ip:${ipKey(ip)}`).run();
    expect((await login({ name: 'Guarded_1', password: 'the right one' }, ip)).status).toBe(200);
  });

  it(`gives a name ${MISSES_PER_NAME} wrong passwords per window from all addresses together`, async () => {
    expect(MISSES_PER_NAME).toBeGreaterThan(MISSES_PER_IP);
    await login({ name: 'Guarded_2', password: 'the right one' });
    let sent = 0;
    while (sent < MISSES_PER_NAME) {
      const ip = freshIp();
      for (let i = 0; i < MISSES_PER_IP && sent < MISSES_PER_NAME; i++, sent++) {
        expect((await login({ name: 'guarded_2', password: `guess ${sent}` }, ip)).status).toBe(401);
      }
    }
    // Locked for everyone, in any spelling, right password included; other names are fine.
    const ip = freshIp();
    expect((await login({ name: 'Guarded_2', password: 'the right one' }, ip)).status).toBe(429);
    expect((await login({ name: 'GUARDED_2', password: 'the right one' })).status).toBe(429);
    expect((await login({ name: 'Unguarded_2', password: 'the right one' }, ip)).status).toBe(200);
    await env.DB.prepare(`UPDATE casino_rate SET expires_at = 0 WHERE k = 'casino-miss-name:guarded_2'`).run();
    expect((await login({ name: 'Guarded_2', password: 'the right one' }, ip)).status).toBe(200);
  }, 60_000);

  it('counts wrong passwords only: right ones, new names and claims leave the counters alone', async () => {
    const ip = freshIp();
    await login({ name: 'Counted_1', password: 'right one' }, ip);
    await login({ name: 'Counted_1', password: 'right one' }, ip);
    await oldAccount('Counted_2');
    await login({ name: 'Counted_2', password: 'right two' }, ip);
    const misses = () => count(`SELECT count(*) AS n FROM casino_rate WHERE k IN (?1, 'casino-miss-name:counted_1', 'casino-miss-name:counted_2')`, `casino-miss-ip:${ipKey(ip)}`);
    expect(await misses()).toBe(0);
    await login({ name: 'Counted_1', password: 'wrong one' }, ip);
    const n = await env.DB.prepare(`SELECT k, n FROM casino_rate WHERE k IN (?1, 'casino-miss-name:counted_1') ORDER BY k`).bind(`casino-miss-ip:${ipKey(ip)}`).all<any>();
    expect(n.results).toEqual([
      { k: `casino-miss-ip:${ipKey(ip)}`, n: 1 },
      { k: 'casino-miss-name:counted_1', n: 1 },
    ]);
  });

  it('answers a locked login without working out the password', async () => {
    const ip = freshIp();
    await env.DB.prepare(`INSERT INTO casino_rate (k, n, expires_at) VALUES (?1, ?2, ?3)`).bind(`casino-miss-ip:${ipKey(ip)}`, MISSES_PER_IP, Date.now() + 60_000).run();
    const derive = vi.spyOn(crypto.subtle, 'deriveBits');
    expect((await login({ name: 'Locked_Out_1', password: 'any password' }, ip)).status).toBe(429);
    expect(derive).not.toHaveBeenCalled();
    expect(await count(`SELECT count(*) AS n FROM casino_accounts WHERE name = 'Locked_Out_1'`)).toBe(0);
  });
});

describe('tokens', () => {
  it('are v2; a v1 token from the name-only login no longer opens anything', async () => {
    const res = await login({ name: 'Tokened_1', password: 'token pass' });
    const { token, profile } = await res.json<any>();
    expect(token.startsWith('v2.')).toBe(true);
    expect((await api('me', token)).status).toBe(200);

    // A v1 token exactly as the old login signed it, with this deployment's secret.
    const iat = Math.floor(Date.now() / 1000);
    const b64 = (s: Uint8Array) => btoa(String.fromCharCode(...s)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const payload = b64(enc.encode(JSON.stringify({ a: profile.id, n: profile.name, iat, exp: iat + 86_400 })));
    const key = await crypto.subtle.importKey('raw', enc.encode(env.CASINO_TOKEN_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode('v1.' + payload)));
    const v1 = `v1.${payload}.${b64(sig)}`;
    expect((await api('me', v1)).status).toBe(401);
    // Nor does relabelling it v2 (the signature covers the version).
    expect((await api('me', `v2.${payload}.${b64(sig)}`)).status).toBe(401);
  });
});
