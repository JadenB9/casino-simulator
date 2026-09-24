// Leader handoff with several drops, in real time (the handoff waits LEADER_HANDOFF_MS, 20 s):
//   1. the leader drops: the lead passes to the longest-present player still connected;
//   2. the new leader and the next in line drop together: it passes past both;
//   3. everyone comes back: the lead stays where it went;
//   4. the leader leaves while nobody else is connected: the longest-present absent player takes
//      it, and hands it on to whoever is back when the handoff time runs out.

import { BUY_IN } from './bots.ts';
import { TablePlayer } from './player.mjs';
import { nextIp, sleep } from './net.mjs';

const HANDOFF_MS = 20_000;

async function leaderIs(p, id, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (p.leader === id) return Date.now() - t0;
    await sleep(100);
  }
  return null;
}

export async function leader(ctx) {
  const { server, meter, rand } = ctx;
  const game = 'blackjack';
  const accounts = [];
  for (let i = 0; i < 5; i++) accounts.push(await server.login(`${ctx.tag}ld${i}`, nextIp(20)));
  const made = await server.api('tables', { method: 'POST', token: accounts[0].token, ip: accounts[0].ip, body: { game, visibility: 'public' } });
  if (made.status !== 201) throw new Error(`create lobby ${made.status} ${made.text}`);
  const ps = accounts.map((a) => new TablePlayer(server, meter, a, game, made.body.tableId, rand));
  for (const p of ps) await p.connect(); // in join order: 0 leads, then 1, 2, 3, 4
  await Promise.all(ps.map((p) => p.buyIn(BUY_IN[game])));
  ps[0].conn.send({ t: 'start' });
  for (const p of ps) p.start();
  const steps = [];
  const check = (name, ok, extra = {}) => steps.push({ step: name, ok, ...extra });

  // 1. The leader drops; within the handoff time (and not long after) player 1 leads.
  ps[0].drop();
  const t1 = await leaderIs(ps[3], accounts[1].id, HANDOFF_MS + 10_000);
  check('leader drops: lead passes to the next longest-present', t1 !== null && t1 >= HANDOFF_MS - 2_000, { ms: t1 });

  // 2. The new leader and the next in line drop together: it passes past both, to player 3.
  ps[1].drop();
  ps[2].drop();
  const t2 = await leaderIs(ps[4], accounts[3].id, HANDOFF_MS + 10_000);
  check('two drop at once: lead passes past both', t2 !== null && t2 >= HANDOFF_MS - 2_000, { ms: t2 });

  // 3. They all come back; the lead stays with player 3.
  for (const p of ps.slice(0, 3)) await p.connect();
  await sleep(1_500);
  check('everyone back: the lead stays where it went', ps.every((p) => p.leader === accounts[3].id), { leaders: ps.map((p) => p.leader) });

  // 4. Everyone but the leader drops; the leader leaves. The lead goes to player 0 (longest
  //    present, but away); player 4 comes back, and gets it when the handoff time is up.
  for (const p of [ps[0], ps[1], ps[2], ps[4]]) p.drop();
  await sleep(500);
  await ps[3].leave();
  await sleep(500);
  await ps[4].connect();
  check('leader leaves with nobody here: an absent successor holds it', ps[4].leader === accounts[0].id, { leader: ps[4].leader });
  const t4 = await leaderIs(ps[4], accounts[4].id, HANDOFF_MS + 10_000);
  check('the absent successor hands it to whoever is back', t4 !== null, { ms: t4 });

  // Everyone leaves (reconnecting first, so each cashes out from a live seat).
  for (const p of [ps[0], ps[1], ps[2]]) await p.connect();
  const left = await Promise.all([ps[0], ps[1], ps[2], ps[4]].map((p) => p.leave()));
  return { steps, leftCleanly: left.filter((c) => c && c.code === 1000).length, ok: steps.every((s) => s.ok) };
}
