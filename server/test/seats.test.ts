// Seats changing hands at lobby tables, through the real host: a seat given up in the middle of a
// round isn't handed to anyone new until the table is quiet, a newcomer who can only get that
// seat waits (and is told why), and nobody ever receives a card of someone who sat there before.
// Three Card Poker and Hold'em are the games with cards only one seat may see.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { evictDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import type { Client } from './helpers.ts';
import { aid, buyIn, cardsIn, clockAt, enter, find, inTable, makeLobby, player, sleep, table, type Player } from './party.ts';

afterEach(() => {
  vi.useRealTimers();
});

/** Every card a client has been sent, in any message. */
const seenBy = (c: Client) => new Set(c.msgs.flatMap((m) => cardsIn(m)));

describe('a seat given up mid-round', () => {
  it("Three Card: the only free seat waits for the round to end, and its newcomer never sees the last player's hand", async () => {
    // A full table of six: two play, four watch.
    const ps: Player[] = [];
    for (let i = 0; i < 6; i++) ps.push(await player('tcseat'));
    const made = await makeLobby(ps[0]!, 'threecard');
    const cs: Client[] = [];
    for (const p of ps) cs.push((await enter(p, made.tableId))[0]);
    const [c0, c1] = cs as [Client, Client];
    await buyIn(c0, 20_000);
    await buyIn(c1, 20_000);
    c0.send({ t: 'start' });
    await c1.next((m) => m.t === 'ev' && m.view.phase === 'betting');
    c0.send({ t: 'act', aid: aid(), a: { type: 'bet', ante: 1_000, pairPlus: 0 } });
    c1.send({ t: 'act', aid: aid(), a: { type: 'bet', ante: 1_000, pairPlus: 0 } });
    await c1.next((m) => m.t === 'seat' && m.stack === 19_000);
    await c0.next((m) => m.t === 'seat' && m.stack === 19_000);
    c0.send({ t: 'ready', on: true });
    c1.send({ t: 'ready', on: true });
    const dealt = await c1.next<any>((m) => m.t === 'ev' && m.view.phase === 'deciding');
    const hand = dealt.view.seats[1].cards as string[];
    expect(hand).toHaveLength(3);
    for (const c of hand) expect(c).toMatch(/^[2-9TJQKA][shdc]$/);

    // Seat 1 folds and leaves while seat 0 is still deciding.
    c1.send({ t: 'act', aid: aid(), a: { type: 'fold' } });
    await c1.next((m) => m.t === 'ev' && m.view.seats[1]?.decision === 'fold');
    // (c0 was here before c1 arrived: drop its old member lists so only the leave's can match.)
    c0.msgs.length = 0;
    c1.send({ t: 'leave' });
    await c0.next((m) => m.t === 'members' && !find(m.members, ps[1]!.id));

    // The newcomer can only get seat 1. They watch, and can't buy in until the round is over.
    const n = await player('tcnew');
    const [cn, snap] = await enter(n, made.tableId);
    expect(snap.you.seat).toBe(1);
    cn.send({ t: 'buyin', aid: aid(), amount: 20_000 });
    const refused = await cn.next<any>((m) => m.t === 'err');
    expect(refused).toMatchObject({ code: 'BUSY', msg: 'This seat opens when the round in play ends.' });
    expect((await inTable(made.tableId, (t: any) => t.meta.held)) as number[]).toEqual([1]);

    // Seat 0's decision times out, the round settles, and the seat opens.
    clockAt(dealt.view.deadline + 1);
    await runDurableObjectAlarm(table(made.tableId));
    await cn.next((m) => m.t === 'ev' && m.view.phase === 'results');
    expect((await inTable(made.tableId, (t: any) => t.meta.held)) as number[]).toEqual([]);
    cn.send({ t: 'buyin', aid: aid(), amount: 20_000 });
    await cn.next((m) => m.t === 'seat' && m.status === 'seated');
    cn.send({ t: 'sync' });
    const mine = await cn.next<any>((m) => m.t === 'table');
    expect(mine.you).toMatchObject({ seat: 1, status: 'seated', stack: 20_000 });
    expect(mine.view.seats[1]).toBeUndefined();

    // Not one of the folded cards ever reached the newcomer, in any message.
    const seen = seenBy(cn);
    for (const c of hand) expect(seen.has(c), c).toBe(false);
  }, 20_000);

  it("Hold'em: a newcomer is seated past a seat given up mid-hand, and sees nothing of it", async () => {
    const ps: Player[] = [];
    for (let i = 0; i < 4; i++) ps.push(await player('heseat'));
    const made = await makeLobby(ps[0]!, 'holdem');
    const cs: Client[] = [];
    for (const p of ps) cs.push((await enter(p, made.tableId))[0]);
    for (const c of cs) await buyIn(c, 20_000);
    cs[0]!.send({ t: 'start' });
    // The table deals a couple of seconds after it can start. Newcomers wait for the big blind, so
    // an early hand can be heads-up (a fold would end it); fold through those to one with three
    // or more players dealt in, where it goes on after someone folds.
    let view: any = null;
    for (let i = 0; i < 60; i++) {
      clockAt(Date.now() + 2_500);
      await runDurableObjectAlarm(table(made.tableId));
      await sleep(20);
      cs[0]!.send({ t: 'sync' });
      view = (await cs[0]!.next<any>((m) => m.t === 'table')).view;
      if (view.phase !== 'playing' || !view.turn) continue;
      if (view.seats.filter((s: any) => s?.inHand && !s.folded).length >= 3) break;
      cs[view.turn.seat]!.send({ t: 'act', aid: aid(), a: { type: 'fold' } });
      await sleep(20);
    }
    expect(view.phase).toBe('playing');
    expect(view.seats.filter((s: any) => s?.inHand && !s.folded).length).toBeGreaterThanOrEqual(3);

    // Whoever is to act folds and leaves; the hand goes on without them.
    const seat = view.turn.seat as number;
    const leaver = cs[seat]!;
    leaver.msgs.length = 0;
    leaver.send({ t: 'sync' });
    const hole = (await leaver.next<any>((m) => m.t === 'table')).view.you.cards as string[];
    expect(hole).toHaveLength(2);
    leaver.send({ t: 'act', aid: aid(), a: { type: 'fold' } });
    await leaver.next((m) => m.t === 'ev' && m.view.seats[seat]?.folded);
    // (Someone who was here before the leaver arrived still has member lists without them queued.)
    const other = cs[(seat + 1) % 4]!;
    other.msgs.length = 0;
    leaver.send({ t: 'leave' });
    await other.next((m) => m.t === 'members' && !find(m.members, ps[seat]!.id));
    expect((await inTable(made.tableId, (t: any) => t.meta.held)) as number[]).toEqual([seat]);

    const n = await player('henew');
    const [cn, snap] = await enter(n, made.tableId);
    expect(snap.you.seat).toBe(4);
    await buyIn(cn, 20_000);
    const seen = seenBy(cn);
    for (const c of hole) expect(seen.has(c), c).toBe(false);
  }, 20_000);

  it('someone still buying in gets the spectator view, not whatever the engine keeps under their seat number', async () => {
    const a = await player('bvw');
    const b = await player('bvw');
    const made = await makeLobby(a, 'threecard');
    const [ca] = await enter(a, made.tableId);
    const [cb] = await enter(b, made.tableId);
    await buyIn(ca, 20_000);
    await buyIn(cb, 20_000);
    ca.send({ t: 'start' });
    await cb.next((m) => m.t === 'ev' && m.view.phase === 'betting');
    for (const c of [ca, cb]) c.send({ t: 'act', aid: aid(), a: { type: 'bet', ante: 1_000, pairPlus: 0 } });
    await cb.next((m) => m.t === 'seat' && m.stack === 19_000);
    await ca.next((m) => m.t === 'seat' && m.stack === 19_000);
    for (const c of [ca, cb]) c.send({ t: 'ready', on: true });
    const dealt = await cb.next<any>((m) => m.t === 'ev' && m.view.phase === 'deciding');
    const hand = dealt.view.seats[1].cards as string[];
    expect(hand).toHaveLength(3);

    // Seat 1's cards are in the engine under seat 1. As if someone new held that number and were
    // still buying in, the snapshot must not show them; once seated, it's their own view again.
    const views = await inTable(made.tableId, (t: any) => {
      const mem = t.members.get(b.id);
      mem.status = 'buying_in';
      const buying = t.snapshotFor(b.id, Date.now()).view;
      mem.status = 'seated';
      const seated = t.snapshotFor(b.id, Date.now()).view;
      return { buying, seated, spectator: t.engine.view(t.state, null) };
    });
    expect(views.buying).toEqual(views.spectator);
    for (const c of hand) expect(cardsIn(views.buying)).not.toContain(c);
    expect(views.seated.seats[1].cards).toEqual(hand);
  });

  it('the hold survives a restart, and a seat given up between rounds is not held at all', async () => {
    const ps: Player[] = [];
    for (let i = 0; i < 3; i++) ps.push(await player('hold'));
    const made = await makeLobby(ps[0]!, 'threecard');
    const cs: Client[] = [];
    for (const p of ps) cs.push((await enter(p, made.tableId))[0]);
    await buyIn(cs[0]!, 20_000);
    await buyIn(cs[1]!, 20_000);

    // Between rounds (the table hasn't started): leaving holds nothing.
    cs[0]!.msgs.length = 0;
    cs[2]!.send({ t: 'leave' });
    await cs[0]!.next((m) => m.t === 'members' && !find(m.members, ps[2]!.id));
    expect((await inTable(made.tableId, (t: any) => t.meta.held ?? [])) as number[]).toEqual([]);

    // Mid-round: held, and still held after the object restarts.
    cs[0]!.send({ t: 'start' });
    await cs[1]!.next((m) => m.t === 'ev' && m.view.phase === 'betting');
    cs[0]!.send({ t: 'act', aid: aid(), a: { type: 'bet', ante: 1_000, pairPlus: 0 } });
    await cs[0]!.next((m) => m.t === 'seat' && m.stack === 19_000);
    cs[0]!.msgs.length = 0;
    cs[1]!.send({ t: 'leave' });
    await cs[0]!.next((m) => m.t === 'members' && !find(m.members, ps[1]!.id));
    expect((await inTable(made.tableId, (t: any) => t.meta.held)) as number[]).toEqual([1]);
    await evictDurableObject(table(made.tableId));
    expect((await inTable(made.tableId, (t: any) => t.meta.held)) as number[]).toEqual([1]);
  }, 20_000);
});
