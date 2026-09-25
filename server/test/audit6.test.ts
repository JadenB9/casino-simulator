// The v6 odds-and-cheese audit (docs/ODDS-AUDIT.md): each hole it found, shown closed.

import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../src/index.ts';
import { CLOSE } from '../../shared/src/protocol.ts';
import { roundFacts } from '../src/feats.ts';
import { HELD_OFF_POKER } from '../src/table/host.ts';
import { Client, ORIGIN, api, connect, ticketFor } from './helpers.ts';
import { buyIn, closedWith, enter, makeLobby, money, player, sleep } from './party.ts';

const DAY = 86_400_000;
let tries = 0;

/** A socket to `path` through the Worker with its env as given (the dev flag on or off). */
async function socketWith(e: Env, path: string, token: string): Promise<Client> {
  const ticket = await ticketFor(path, token);
  const res = await worker.fetch(
    new Request(`http://casino.test/casino/ws/${path}?v=1&ticket=${encodeURIComponent(ticket!)}`, { headers: { Upgrade: 'websocket', Origin: ORIGIN } }),
    e,
  );
  return new Client(res.webSocket!);
}

/** Ask to sit down and say how it went: seated, or the error's text. */
async function tryBuyIn(c: Client, amount: number): Promise<'seated' | string> {
  c.send({ t: 'buyin', aid: `try${++tries}`, amount });
  const m = await c.next<any>((x) => (x.t === 'seat' && x.status === 'seated') || x.t === 'err', 5000);
  return m.t === 'err' ? m.msg : 'seated';
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

describe("Hold'em chip dumping", () => {
  it("the cashier's top-up can't be taken to a multiplayer Hold'em table; it plays anywhere else", async () => {
    const main = await player('aud_main');
    const alt = await player('aud_alt');
    const made = await makeLobby(main, 'holdem');

    // A new player's starting stake sits down with friends at once.
    const [cm] = await enter(main, made.tableId);
    await buyIn(cm, 100_000);

    // The alt loses everything and takes the cashier's top-up...
    await env.DB.prepare(`UPDATE casino_accounts SET balance = 0 WHERE id = ?1`).bind(alt.id).run();
    const loan = await api('bank/loan', alt.token, { method: 'POST' });
    expect(loan.status).toBe(200);
    expect((await money(alt.id)).balance).toBe(5_000_000);

    // ...which can't go to the table where it could be lost on purpose to the main account.
    const [ca] = await enter(alt, made.tableId);
    expect(await tryBuyIn(ca, 20_000)).toBe(HELD_OFF_POKER);
    expect(await money(alt.id)).toEqual({ balance: 5_000_000, in_play: 0 });
    ca.ws.close();

    // It plays against the bots, and at every other table.
    const { client: bots } = await connect('solo/holdem', alt.token);
    await bots!.next((m) => m.t === 'table');
    expect(await tryBuyIn(bots!, 20_000)).toBe('seated');
    const { client: bj } = await connect('solo/blackjack', alt.token);
    await bj!.next((m) => m.t === 'table');
    expect(await tryBuyIn(bj!, 20_000)).toBe('seated');

    // Three days on, it's the alt's own money like any other.
    await env.DB.prepare(`UPDATE casino_ledger SET created_at = created_at - ?2 WHERE account_id = ?1 AND kind = 'loan'`).bind(alt.id, 3 * DAY + 1).run();
    await sleep(50);
    const [again] = await enter(alt, made.tableId);
    expect(await tryBuyIn(again, 20_000)).toBe('seated');
  }, 30_000);

  it('only what is held stays off: the rest of the balance sits down', async () => {
    // a balance of its own, then a $2,500 daily bonus on top (held for three days)
    const sit = async (balance: number): Promise<string> => {
      const p = await player('aud_part');
      await env.DB.prepare(`UPDATE casino_accounts SET balance = ?2 WHERE id = ?1`).bind(p.id, balance).run();
      expect((await api('daily/claim', p.token, { method: 'POST' })).status).toBe(200);
      const made = await makeLobby(p, 'holdem');
      const [c] = await enter(p, made.tableId);
      return tryBuyIn(c, 100_000);
    };
    // $1,000 of its own beside the bonus: a $1,000 sitting fits exactly...
    expect(await sit(100_000)).toBe('seated');
    // ...and with $100 less it doesn't, though the balance ($3,400) covers it
    expect(await sit(90_000)).toBe(HELD_OFF_POKER);
  }, 30_000);
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
