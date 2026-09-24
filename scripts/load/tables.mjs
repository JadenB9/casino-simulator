// Eight players in one lobby at every multiplayer game, all at once: they buy in, bet every
// window, act on their turns, top up once, and leave. With `storm`, sockets drop at random
// (mid-round and while seated, one at a time and a whole table at once) and come back the way the
// client does; every return must find the same seat, and a bet still on the layout of the same
// round must still be there.

import { BUY_IN, LOBBY_GAMES } from './bots.ts';
import { TablePlayer, roundOf } from './player.mjs';
import { nextIp, sleep } from './net.mjs';

const PLAYERS = 8;
/** Seats per lobby table (the catalog's multiplayer limits). */
const SEATS = { blackjack: 7, roulette: 8, craps: 8, baccarat: 7, threecard: 6, holdem: 9, war: 6, sicbo: 8, bigsix: 8 };

/** What this seat has on the layout that must survive a reconnect in the same round (or null). */
function myBet(game, view, seat) {
  if (!view || seat === null) return null;
  switch (game) {
    case 'blackjack':
      return view.phase === 'betting' ? view.bets?.[seat] ?? null : null;
    case 'roulette':
    case 'sicbo':
    case 'bigsix':
    case 'baccarat':
      return view.phase === 'betting' && view.bets?.[seat] ? JSON.stringify(view.bets[seat]) : null;
    case 'threecard':
    case 'war':
      return view.phase === 'betting' && view.seats?.[seat] ? JSON.stringify([view.seats[seat].ante ?? view.seats[seat].bet, view.seats[seat].pairPlus ?? view.seats[seat].tie]) : null;
    case 'craps': {
      const mine = view.bets?.[seat];
      if (!mine) return null;
      // Contract bets can't come down or change while away; compare the line bets.
      const line = ['pass', 'dontpass'].filter((k) => mine[k]).map((k) => [k, mine[k].amount]);
      return line.length ? JSON.stringify(line) : null;
    }
    default:
      return null;
  }
}

async function lobbyRun(ctx, game, gi, opts) {
  const { server, meter, rand } = ctx;
  const tag = `${ctx.tag}${game.slice(0, 2)}`;
  const accounts = [];
  for (let i = 0; i < PLAYERS; i++) accounts.push(await server.login(`${tag}${i}`, nextIp(18 + (gi % 2))));
  const made = await server.api('tables', { method: 'POST', token: accounts[0].token, ip: accounts[0].ip, body: { game, visibility: 'public' } });
  if (made.status !== 201) throw new Error(`${game}: create lobby ${made.status} ${made.text}`);
  const tableId = made.body.tableId;
  // Eight come; a table with fewer seats (blackjack and baccarat 7, Three Card and war 6) must turn
  // the rest away with "table full" while it plays on.
  const seats = Math.min(PLAYERS, made.body.maxSeats ?? SEATS[game]);
  const players = accounts.slice(0, seats).map((a) => new TablePlayer(server, meter, a, game, tableId, rand));
  // The creator first (they lead), then everyone else at once.
  await players[0].connect();
  await Promise.all(players.slice(1).map((p) => p.connect()));
  const turnedAway = await Promise.all(
    accounts.slice(seats).map(async (a) => {
      const c = server.connect(`table/${tableId}`, a, meter);
      const closed = await c.done;
      return closed.code === 4005 && closed.reason === 'table full' && !c.msgs.some((m) => m.t === 'table');
    }),
  );
  const seated = await Promise.all(players.map((p) => p.buyIn(BUY_IN[game])));
  const out = {
    game, tableId, players: seats, turnedAway: `${turnedAway.filter(Boolean).length}/${accounts.length - seats}`, seated: seated.filter(Boolean).length,
    rounds: 0, topUps: 0, drops: 0, massDrops: 0, restored: 0, notRestored: [], betsKept: 0, betsLost: [], leftCleanly: 0, errors: {},
  };
  if (turnedAway.some((x) => !x)) out.notRestored.push({ problem: 'a player past the seat limit was let in, or not told the table is full' });
  players[0].conn.send({ t: 'start' });
  for (const p of players) p.start();

  const deadline = Date.now() + opts.timeoutMs;
  const target = game === 'craps' ? opts.rounds * 4 : opts.rounds;
  let toppedUp = false;
  let massDropped = false;
  const busy = new Set();

  /** Drop one player's socket and bring it back after a client-like pause, checking what it finds. */
  const bounce = async (p, pause) => {
    if (busy.has(p) || p.leaving) return;
    busy.add(p);
    const before = { seat: p.seat, round: roundOf(game, p.view), bet: myBet(game, p.view, p.seat), status: p.status };
    p.drop();
    out.drops++;
    await sleep(pause);
    try {
      const snap = await p.connect();
      const ok = snap.you.seat === before.seat && (before.status !== 'seated' || snap.you.status === 'seated' || snap.you.status === 'cashing_out');
      if (ok) out.restored++;
      else out.notRestored.push({ account: p.account.name, before, after: snap.you });
      if (before.bet !== null && roundOf(game, snap.view) === before.round) {
        const after = myBet(game, snap.view, snap.you.seat);
        if (after === before.bet) out.betsKept++;
        // The betting window can close while away: then the bet was dealt (a new phase, same round).
        else if (snap.view.phase === 'betting') out.betsLost.push({ account: p.account.name, before: before.bet, after });
      }
    } catch (err) {
      out.notRestored.push({ account: p.account.name, before, error: String(err) });
    }
    busy.delete(p);
    p.schedule();
  };

  while (Date.now() < deadline) {
    await sleep(1_000);
    const played = Math.min(...players.map((p) => p.rounds));
    out.rounds = played;
    if (!toppedUp && played >= Math.ceil(target / 2)) {
      // Everyone tops up at once, bets and all still working.
      toppedUp = true;
      for (const p of players) if (p.topUp(Math.min(5_000, BUY_IN[game] / 10))) out.topUps++;
    }
    if (opts.storm) {
      // A deploy's worth of drops once: the whole table goes, and comes back within two seconds.
      if (!massDropped && played >= 1) {
        massDropped = true;
        out.massDrops++;
        await Promise.all(players.map((p) => bounce(p, 200 + Math.floor(rand() * 1_800))));
      }
      // And now and then one player's network blips, mid-round or between rounds alike.
      for (const p of players) if (rand() < opts.dropRate) void bounce(p, 300 + Math.floor(rand() * 2_700));
    }
    if (played >= target) break;
  }
  while (busy.size) await sleep(100);
  out.rounds = Math.min(...players.map((p) => p.rounds));
  const left = await Promise.all(players.map((p) => p.leave()));
  out.leftCleanly = left.filter((c) => c && c.code === 1000).length;
  for (const p of players) for (const [code, n] of Object.entries(p.errors)) out.errors[code] = (out.errors[code] ?? 0) + n;
  return out;
}

export async function tables(ctx, opts) {
  const o = { rounds: 6, timeoutMs: 240_000, storm: false, dropRate: 0.02, ...opts };
  const results = await Promise.all(LOBBY_GAMES.map((g, i) => lobbyRun(ctx, g, i, o).catch((err) => ({ game: g, failed: String(err?.stack ?? err) }))));
  return results;
}
