// Straw, Sticks & Bricks on the real server: spins at the smallest coin until a Blowdown comes up
// (1 in 114.56 spins), each settled to the cent, the Blowdown's houses and street in whole bets
// and inside the spin's win; then a $50,000 spin at the high-limit coin. The credits chain from
// bet to win, cash out returns exactly the credits, and the books balance.

import { describe, expect, it } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { ORIGIN, TEST_PASSWORD, api, connect, featsHad, type Client } from './helpers.ts';
import { PIGS } from '../../shared/src/games/slots/pigs.ts';

let seq = 0;
const DAY = 86_400_000;

async function player(tag: string): Promise<{ id: number; token: string }> {
  seq++;
  const res = await exports.default.fetch(
    new Request('http://casino.test/casino/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': `10.92.${(seq >> 8) & 255}.${seq & 255}` },
      body: JSON.stringify({ name: `pg${tag}${seq}`, password: TEST_PASSWORD }),
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.json<any>();
  // past the first days (nothing held), with the ledger's grant for what they have
  await env.DB.prepare(`UPDATE casino_ledger SET created_at = created_at - ?2 WHERE account_id = ?1`).bind(body.profile.id, 3 * DAY + 1).run();
  const extra = 10_000_000_00 - body.profile.balance;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) VALUES (?1, ?2, 'grant', ?3, NULL, ?4)`).bind(`test-pg:${body.profile.id}`, body.profile.id, extra, Date.now() - 3 * DAY - 1),
    env.DB.prepare(`UPDATE casino_accounts SET balance = balance + ?2, rev = rev + 1 WHERE id = ?1`).bind(body.profile.id, extra),
  ]);
  // feats pay beside the play; this test checks the play alone to the cent
  await featsHad(body.profile.id);
  return { id: body.profile.id, token: body.token };
}

const me = async (token: string) => (await (await api('me', token)).json<any>()).profile;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

describe('Straw, Sticks & Bricks on the server', () => {
  it('spins and a Blowdown settle to the cent, and a $50,000 spin at the top coin', async () => {
    const p = await player('bd');
    const { client } = await connect('solo/slots', p.token, '&variant=pigs');
    const c: Client = client!;
    const snap = await c.next<any>((m) => m.t === 'table');
    expect(snap.meta.config.variant).toBe('pigs');
    expect(snap.meta.config.limits.default).toEqual({ min: 20, max: 5_000_000, step: 20 });
    expect(snap.meta.config.buyIn.max).toBe(500_000_000);
    c.send({ t: 'buyin', aid: 'buy1', amount: 200_000_000 });
    await c.next<any>((m) => m.t === 'seat' && m.status === 'seated', 5000);
    const start = (await me(p.token)).balance;
    let credit = 200_000_000;

    const spin = async (aid: string, coins: number, denom: number) => {
      c.send({ t: 'act', aid, a: { type: 'spin', coins, denom } });
      const ev = await c.next<any>((m) => m.t === 'ev' && m.events.some((e: any) => e.type === 'result'), 5000);
      const s = ev.events.find((e: any) => e.type === 'spin');
      const reels = ev.events.find((e: any) => e.type === 'reels');
      const result = ev.events.find((e: any) => e.type === 'result');
      const bet = PIGS.lines * coins * denom;
      expect(s.bet).toBe(bet);
      expect(s.credit).toBe(credit - bet);
      expect(result.credit).toBe(s.credit + result.win);
      expect(result.win).toBe(reels.win);
      const lineWin = reels.lines.reduce((a: number, l: any) => a + l.win, 0);
      const bd = reels.blowdown;
      expect(reels.win).toBe(lineWin + (bd?.win ?? 0));
      expect(!!bd).toBe(reels.trigger);
      if (bd) {
        expect(reels.scatters).toBeGreaterThanOrEqual(6);
        expect(bd.start).toHaveLength(reels.scatters);
        for (const [, grade, win] of bd.houses) {
          expect(win % bet).toBe(0);
          expect(PIGS.bonus.prizes[grade]).toContain(win / bet);
        }
        expect(bd.win).toBe(bd.houses.reduce((a: number, h: number[]) => a + h[2]!, 0) + bd.street);
        expect(bd.street === 0 || bd.street === PIGS.bonus.street * bet).toBe(true);
      }
      credit = result.credit;
      return { bd, win: result.win, bet };
    };

    // the smallest bet (20 cents) until the houses come; the machine takes 12 actions a second
    let bonus = null;
    for (let i = 0; i < 1500 && !bonus; i++) {
      bonus = (await spin(`a${i}`, 1, 1)).bd;
      await pause(85);
    }
    expect(bonus).toBeTruthy();
    // five credits a line at $500: $50,000
    const top = await spin('top', 5, 50_000);
    expect(top.bet).toBe(5_000_000);

    c.send({ t: 'cashout', aid: 'out1' });
    await c.next<any>((m) => m.t === 'seat' && m.status === 'watching', 5000);
    const after = await me(p.token);
    expect(after.balance - start).toBe(credit);
    expect(after.inPlay).toBe(0);
    await books(p.id);
    c.ws.close();
  }, 240_000);
});
