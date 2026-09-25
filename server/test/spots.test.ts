// Several hands at a solo table, through the real Worker and Durable Object: one stack at the table
// and bets per spot, money moving exactly and D1 touched only at the edges, every spot surviving a
// dropped connection or a restart, and the stats counting each hand.

import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { evictDurableObject } from 'cloudflare:test';
import { connect, featsHad, login, type Client } from './helpers.ts';

const BALANCE = 5_000_000;
const BUY_IN = 200_000;

async function money(id: number) {
  return env.DB.prepare(`SELECT balance, in_play FROM casino_accounts WHERE id = ?1`).bind(id).first<{ balance: number; in_play: number }>();
}

async function stats(id: number, game: string) {
  return env.DB.prepare(`SELECT rounds, wagered, net FROM casino_stats WHERE account_id = ?1 AND game = ?2`).bind(id, game).first<{ rounds: number; wagered: number; net: number }>();
}

let aids = 0;
/** The table's last transition each socket has seen: the reply to an action is the next one. */
const seen = new WeakMap<Client, number>();

/**
 * Send an action and wait for what it did: the table's events (and view), or a refusal. Faster
 * than any player, so it keeps under the table's rate limit and tries again when it's told to.
 */
async function act(c: Client, a: unknown): Promise<any> {
  for (let tries = 0; tries < 20; tries++) {
    const aid = `a${++aids}`;
    const after = seen.get(c) ?? 0;
    c.send({ t: 'act', aid, a });
    const m = await c.next((x) => (x.t === 'ev' && x.seq > after) || (x.t === 'err' && (x.ref === aid || x.code === 'RATE_LIMITED')));
    if (m.t === 'err' && m.code === 'RATE_LIMITED') {
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }
    if (m.t === 'err') throw new Error(`refused ${JSON.stringify(a)}: ${m.code} ${m.msg}`);
    seen.set(c, m.seq);
    await new Promise((r) => setTimeout(r, 40));
    return m;
  }
  throw new Error('rate limited twenty times running');
}

/** A fresh snapshot of the table on this socket. */
async function sync(c: Client): Promise<any> {
  c.send({ t: 'sync' });
  const snap = await c.next((m) => m.t === 'table');
  seen.set(c, snap.seq);
  return snap;
}

/** Connect to a solo table (again) and take its snapshot. */
async function open(game: string, token: string): Promise<{ c: Client; snap: any }> {
  const c = (await connect(`solo/${game}`, token)).client!;
  const snap = await c.next((m) => m.t === 'table');
  seen.set(c, snap.seq);
  return { c, snap };
}

async function sitDown(game: string, name: string): Promise<{ c: Client; token: string; id: number }> {
  const { token, profile } = await login(name);
  // the money here is checked to the cent: no feat pays beside the play
  await featsHad(profile.id);
  const { c } = await open(game, token);
  c.send({ t: 'buyin', aid: 'b1', amount: BUY_IN });
  await c.next((m) => m.t === 'seat' && m.status === 'seated');
  await sync(c);
  return { c, token, id: profile.id };
}

const BJ_BETS = [2500, 2600, 2700];

/** Blackjack: decline insurance and stand every hand, spot by spot, until the round is over. */
async function standOut(c: Client, view: any): Promise<any> {
  for (let guard = 0; guard < 30; guard++) {
    if (view.phase === 'insurance') {
      const asked = view.spots.find((s: any) => s.insurance === 'offered');
      view = (await act(c, { type: 'insurance', take: false, spot: asked.seat })).view;
    } else if (view.phase === 'play') {
      view = (await act(c, { type: 'stand', spot: view.turn.seat, hand: view.turn.hand })).view;
    } else return view;
  }
  throw new Error('the round never finished');
}

/** Blackjack: bet the three spots and deal. */
async function dealThree(c: Client): Promise<any> {
  for (const [spot, amount] of BJ_BETS.entries()) await act(c, { type: 'bet', amount, spot });
  return (await act(c, { type: 'deal' })).view;
}

const netOf = (spots: { wagered: number; returned: number }[]) => spots.reduce((a, s) => a + s.returned - s.wagered, 0);

async function stackNow(c: Client): Promise<number> {
  return (await sync(c)).you.stack;
}

describe('several spots at a solo table', () => {
  it('blackjack on three spots: one stack, bets per spot, every round settles exactly and each hand counts in the stats', async () => {
    const { c, id } = await sitDown('blackjack', 'spots_bj_money');
    const ev = await act(c, { type: 'spots', n: 3 });
    expect(ev.view.mine).toEqual([0, 1, 2]);
    let stack = BUY_IN;
    let wagered = 0;
    for (let round = 0; round < 6; round++) {
      const view = await standOut(c, await dealThree(c));
      expect(view.phase).toBe('results');
      expect(Object.fromEntries(view.spots.map((s: any) => [s.seat, s.base]))).toEqual({ 0: 2500, 1: 2600, 2: 2700 });
      stack += netOf(view.spots);
      wagered += view.spots.reduce((a: number, s: any) => a + s.wagered, 0);
      expect(await stackNow(c)).toBe(stack);
    }
    // The rounds never touched D1: the chips stay on the table until they're cashed out.
    expect(await money(id)).toEqual({ balance: BALANCE - BUY_IN, in_play: BUY_IN });
    c.send({ t: 'cashout', aid: 'c1' });
    const bal = await c.next((m) => m.t === 'balance' && m.inPlay === 0);
    expect(bal.balance).toBe(BALANCE - BUY_IN + stack);
    expect(await money(id)).toEqual({ balance: BALANCE - BUY_IN + stack, in_play: 0 });
    // Every spot of every round is a round in the stats.
    expect(await stats(id, 'blackjack')).toMatchObject({ rounds: 18, wagered, net: stack - BUY_IN });
  });

  it('blackjack: a dropped connection and a restart mid-round both bring back every spot, and the round plays on', async () => {
    const { c, token, id } = await sitDown('blackjack', 'spots_bj_back');
    await act(c, { type: 'spots', n: 3 });
    let stack = BUY_IN;
    let inPlay: any = null;
    // Deal until a round has hands still to play (a dealer blackjack settles on the deal).
    for (let tries = 0; tries < 20 && !inPlay; tries++) {
      const view = await dealThree(c);
      if (view.phase === 'play' || view.phase === 'insurance') inPlay = view;
      else stack += netOf(view.spots);
    }
    expect(inPlay).not.toBeNull();
    // Mid-round the bets are down, and a spot's natural is already paid when the dealer can't have one.
    const midRound = stack + netOf(inPlay.spots);

    c.ws.close(1000, 'network drop');
    const { c: again, snap } = await open('blackjack', token);
    expect(snap.you.status).toBe('seated');
    expect(snap.you.stack).toBe(midRound);
    expect(snap.view.mine).toEqual([0, 1, 2]);
    expect(snap.view.spots).toEqual(inPlay.spots);
    expect(snap.view.turn).toEqual(inPlay.turn);
    expect(snap.view.moves).toEqual(inPlay.moves);

    await evictDurableObject(env.TABLE.get(env.TABLE.idFromName(`solo:blackjack:-:${id}`)), { webSockets: 'close' });
    const { c: third, snap: restored } = await open('blackjack', token);
    expect(restored.you.stack).toBe(midRound);
    expect(restored.view.mine).toEqual([0, 1, 2]);
    expect(restored.view.spots).toEqual(inPlay.spots);

    const done = await standOut(third, restored.view);
    expect(done.phase).toBe('results');
    expect(await stackNow(third)).toBe(stack + netOf(done.spots));
    expect(await money(id)).toEqual({ balance: BALANCE - BUY_IN, in_play: BUY_IN });
  });

  it('three card poker: three hands, a reconnect while deciding shows all three again, and the money is exact', async () => {
    const { c, token, id } = await sitDown('threecard', 'spots_tc_back');
    await act(c, { type: 'spots', n: 3 });
    for (const spot of [0, 1, 2]) await act(c, { type: 'bet', ante: 1_000 + 100 * spot, pairPlus: 500, spot });
    const dealt = await act(c, { type: 'deal' });
    expect(dealt.view.phase).toBe('deciding');
    // Each hand's cards reach this player, and only in the events addressed to them.
    expect(dealt.events.filter((e: any) => e.type === 'hand').map((e: any) => e.seat)).toEqual([0, 1, 2]);
    const wagered = 3 * 500 + 1_000 + 1_100 + 1_200;

    c.ws.close(1000, 'network drop');
    const { c: again, snap } = await open('threecard', token);
    expect(snap.view.mine).toEqual([0, 1, 2]);
    for (const spot of [0, 1, 2]) {
      expect(snap.view.seats[spot].cards).toEqual(dealt.view.seats[spot].cards);
      expect(snap.view.seats[spot].cards.every((x: unknown) => typeof x === 'string')).toBe(true);
      expect(snap.view.seats[spot].decision).toBe('pending');
    }
    expect(snap.you.stack).toBe(BUY_IN - wagered);

    await act(again, { type: 'fold', spot: 1 });
    await act(again, { type: 'play', spot: 0 });
    const last = await act(again, { type: 'play', spot: 2 });
    expect(last.view.phase).toBe('results');
    const results = [0, 1, 2].map((spot) => last.view.seats[spot].result);
    const end = await sync(again);
    expect(end.you.stack).toBe(BUY_IN + netOf(results));

    again.send({ t: 'cashout', aid: 'c1' });
    const bal = await again.next((m) => m.t === 'balance' && m.inPlay === 0);
    expect(bal.balance).toBe(BALANCE - BUY_IN + end.you.stack);
    expect(await stats(id, 'threecard')).toMatchObject({ rounds: 3, wagered: results.reduce((a: number, r: any) => a + r.wagered, 0), net: netOf(results) });
  });

  it('casino war: three spots with every tie sent to war settle exactly, and a bet on a spot given up comes back', async () => {
    const { c, id } = await sitDown('war', 'spots_war_money');
    await act(c, { type: 'spots', n: 3 });
    let stack = BUY_IN;
    for (let round = 0; round < 12; round++) {
      for (const spot of [0, 1, 2]) await act(c, { type: 'bet', bet: 1_000, tie: 100, spot });
      let view = (await act(c, { type: 'deal' })).view;
      while (view.phase === 'deciding') {
        const spot = view.mine.find((s: number) => view.seats[s]?.decision === 'pending');
        view = (await act(c, { type: 'war', spot })).view;
      }
      expect(view.phase).toBe('results');
      stack += netOf([0, 1, 2].map((s) => view.seats[s].result));
    }
    await act(c, { type: 'bet', bet: 1_000, tie: 0, spot: 2 });
    const back = await act(c, { type: 'spots', n: 2 });
    expect(back.events).toContainEqual({ type: 'bets', seat: 2, bet: 0, tie: 0 });
    const snap = await sync(c);
    expect(snap.you.stack).toBe(stack);
    expect(snap.view.mine).toEqual([0, 1]);

    c.send({ t: 'cashout', aid: 'c1' });
    const bal = await c.next((m) => m.t === 'balance' && m.inPlay === 0);
    expect(bal.balance).toBe(BALANCE - BUY_IN + stack);
    expect(await stats(id, 'war')).toMatchObject({ rounds: 36, net: stack - BUY_IN });
  });
});
