// Money under concurrency. No rounds are played here, so every account must end exactly where it
// started, with the ledger, in_play and escrows agreeing:
//   - one account buys in at eight tables at once, then tops up at all eight at once with more
//     than its balance covers (D1 must refuse exactly the ones it can't), then cashes out of all
//     eight at once;
//   - one seat fires buy-in, top-ups and cash-outs as fast as it can, one of them replayed;
//   - eight accounts buy into one lobby in the same instant;
//   - the same top-up sent from a second tab with the same token and action id lands once.

import { START_BALANCE, nextIp, sleep } from './net.mjs';

let aidSeq = 0;
const aid = () => `mo${(++aidSeq).toString(36)}`;

/** A solo table socket, waited to its snapshot. */
async function solo(server, meter, acct, game) {
  const c = server.connect(`solo/${game}`, acct, meter);
  await c.next((m) => m.t === 'table', 15_000);
  return c;
}

/** Wait until this socket's seat settles into `status` (or an error of one of `codes` comes). */
function settle(c, status, codes = []) {
  return c.next((m) => (m.t === 'seat' && m.status === status) || (m.t === 'err' && codes.includes(m.code)), 20_000).catch((e) => ({ t: 'timeout', e: String(e) }));
}

export async function money(ctx) {
  const { server, meter } = ctx;
  const out = { checks: [] };
  const check = (name, ok, extra = {}) => out.checks.push({ check: name, ok, ...extra });
  // Eight tables whose buy-in allows $5,000 (the sums below are for exactly eight).
  const games = ['blackjack', 'roulette', 'craps', 'baccarat', 'threecard', 'war', 'sicbo', 'bigsix'];

  // --- one account, eight tables at once -----------------------------------------------------
  const a = await server.login(`${ctx.tag}mA`, nextIp(21));
  const conns = await Promise.all(games.map((g) => solo(server, meter, a, g)));
  let results = await Promise.all(
    conns.map((c) => {
      c.send({ t: 'buyin', aid: aid(), amount: 500_000 });
      return settle(c, 'seated', ['INSUFFICIENT_FUNDS']);
    }),
  );
  check('8 concurrent buy-ins of $5,000 on $50,000: all seated', results.every((m) => m.t === 'seat'), { outcomes: results.map((m) => m.code ?? m.status ?? m.t) });

  // $10,000 left; eight top-ups of $2,000 at once: exactly five fit.
  results = await Promise.all(
    conns.map((c) => {
      c.send({ t: 'topup', aid: aid(), amount: 200_000 });
      return c.next((m) => (m.t === 'seat' && m.stack === 700_000) || (m.t === 'err' && m.code === 'INSUFFICIENT_FUNDS'), 20_000).catch(() => ({ t: 'timeout' }));
    }),
  );
  const landed = results.filter((m) => m.t === 'seat').length;
  const refused = results.filter((m) => m.t === 'err').length;
  check('8 concurrent top-ups of $2,000 on $10,000: exactly 5 land, 3 refused', landed === 5 && refused === 3, { landed, refused });
  let me = (await server.api('me', { token: a.token, ip: a.ip })).body.profile;
  check('balance 0 and $50,000 in play after the top-ups', me.balance === 0 && me.inPlay === START_BALANCE, { balance: me.balance, inPlay: me.inPlay });

  // Cash out of all eight at once.
  results = await Promise.all(
    conns.map((c) => {
      c.send({ t: 'cashout', aid: aid() });
      return c.next((m) => m.t === 'balance' || (m.t === 'err' && m.code !== 'RATE_LIMITED'), 20_000).catch(() => ({ t: 'timeout' }));
    }),
  );
  await sleep(500);
  me = (await server.api('me', { token: a.token, ip: a.ip })).body.profile;
  check('8 concurrent cash-outs: back to $50,000, nothing in play', me.balance === START_BALANCE && me.inPlay === 0 && me.tables.length === 0, {
    balance: me.balance,
    inPlay: me.inPlay,
    tables: me.tables.length,
    outcomes: results.map((m) => m.t),
  });
  for (const c of conns) c.close();

  // --- one seat, everything at once ------------------------------------------------------------
  const b = await server.login(`${ctx.tag}mB`, nextIp(21));
  const c = await solo(server, meter, b, 'roulette');
  c.send({ t: 'buyin', aid: aid(), amount: 100_000 });
  await settle(c, 'seated');
  const replay = aid();
  const burst = [
    { t: 'topup', aid: replay, amount: 10_000 },
    { t: 'cashout', aid: aid() },
    { t: 'topup', aid: aid(), amount: 10_000 },
    { t: 'cashout', aid: aid() },
    { t: 'topup', aid: replay, amount: 10_000 },
    { t: 'buyin', aid: aid(), amount: 50_000 },
    { t: 'cashout', aid: aid() },
  ];
  for (const m of burst) c.send(m);
  // Let it all land, then make sure the seat is cashed out and look at the money.
  await sleep(3_000);
  c.send({ t: 'sync' });
  const snap = await c.next((m) => m.t === 'table', 10_000);
  if (snap.you.status === 'seated') {
    c.send({ t: 'cashout', aid: aid() });
    await c.next((m) => m.t === 'balance', 20_000).catch(() => null);
  }
  await sleep(500);
  me = (await server.api('me', { token: b.token, ip: b.ip })).body.profile;
  check('a burst of buy-in, top-ups (one replayed) and cash-outs ends where it started', me.balance === START_BALANCE && me.inPlay === 0, { balance: me.balance, inPlay: me.inPlay });
  c.close();

  // --- eight accounts, one lobby, one instant -------------------------------------------------
  const accts = [];
  for (let i = 0; i < 8; i++) accts.push(await server.login(`${ctx.tag}mC${i}`, nextIp(21)));
  const made = await server.api('tables', { method: 'POST', token: accts[0].token, ip: accts[0].ip, body: { game: 'craps', visibility: 'public' } });
  const lobby = [];
  lobby.push(server.connect(`table/${made.body.tableId}`, accts[0], meter));
  await lobby[0].next((m) => m.t === 'table');
  for (const acct of accts.slice(1)) lobby.push(server.connect(`table/${made.body.tableId}`, acct, meter));
  await Promise.all(lobby.slice(1).map((l) => l.next((m) => m.t === 'table', 15_000)));
  results = await Promise.all(
    lobby.map((l) => {
      l.send({ t: 'buyin', aid: aid(), amount: 100_000 });
      return settle(l, 'seated');
    }),
  );
  check('8 accounts buy into one lobby in the same instant: all seated', results.every((m) => m.t === 'seat'), { outcomes: results.map((m) => m.status ?? m.t) });
  const leaves = await Promise.all(lobby.map((l) => (l.send({ t: 'leave' }), l.done)));
  check('and all leave cleanly', leaves.every((x) => x.code === 1000), { codes: leaves.map((x) => x.code) });

  // --- the same token in two tabs ---------------------------------------------------------------
  const d = await server.login(`${ctx.tag}mD`, nextIp(21));
  const tab1 = await solo(server, meter, d, 'baccarat');
  tab1.send({ t: 'buyin', aid: aid(), amount: 100_000 });
  await settle(tab1, 'seated');
  const same = aid();
  tab1.send({ t: 'topup', aid: same, amount: 20_000 });
  await tab1.next((m) => m.t === 'seat' && m.stack === 120_000, 20_000);
  const tab2 = await solo(server, meter, d, 'baccarat');
  const replaced = await tab1.done;
  tab2.send({ t: 'topup', aid: same, amount: 20_000 });
  await sleep(1_500);
  tab2.send({ t: 'sync' });
  const s2 = await tab2.next((m) => m.t === 'table', 10_000);
  check('a second tab takes the seat over (4001 to the first)', replaced.code === 4001, { code: replaced.code });
  check('the same top-up from the second tab lands once', s2.you.stack === 120_000, { stack: s2.you.stack });
  tab2.send({ t: 'leave' });
  await tab2.done;

  out.ok = out.checks.every((x) => x.ok);
  return out;
}
