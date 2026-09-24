// The casino floor with many people on it: walkers arrive in waves, walk (a frame every 40 ms, the
// way a browser moves its player), emote now and then (some mash the key: the floor lets three
// through, then one every two seconds), and a few watch a game's lobby list. Some sit down on a
// floor seat at their stops (a stool, a sofa: `sit`, a while, `stand`), a pool of seats about half
// as big as the crowd so some are refused ("got there first"); some order from the bar (POST
// /bar/order, then the drink in their hand: PUT /me/look, which the floor tells everyone).
// Measured: what the one floor object takes in per second (every `mv` is an event it must handle),
// what each walker receives, whether everyone saw everyone, and the seats' and orders' answers.
//
// `policy` is when a walker sends its position: 'new' is the client's rule (client/src/net/
// send-policy.ts, the same module), 'old' is a position every 100 ms while moving, as before it.
// `pattern` is how they walk: 'waypoints' (straight to a random spot, stand a moment, again) or
// 'zigzag' (a new heading every few hundred ms, never standing: the worst case for the rule).

import { EMOTES } from '../../shared/src/protocol.ts';
import { BAR_MENU } from '../../shared/src/items.ts';
import { shouldSend } from '../../client/src/net/send-policy.ts';
import { nextIp, sleep } from './net.mjs';

const BOUNDS = { minX: -1900, maxX: 1900, minZ: -1400, maxZ: 1400 };
const SPEED = 260; // cm/s, the walking pace
const FRAME_MS = 40;
const OLD_SEND_MS = 100;

const yawByte = (heading) => ((Math.round((heading / (Math.PI * 2)) * 256) % 256) + 256) % 256;

export async function floor(ctx, opts = {}) {
  const { server, meter, rand } = ctx;
  const walkers = opts.walkers ?? 50;
  const seconds = opts.seconds ?? 30;
  const policy = opts.policy ?? 'new';
  const pattern = opts.pattern ?? 'waypoints';
  /** Share of walkers who sit at some stops, and who order from the bar at some. */
  const sitShare = opts.sit ?? 0.3;
  const orderShare = opts.order ?? 0.15;
  const seatPool = Math.max(2, Math.round(walkers / 2));
  const seats = { tries: 0, sat: 0, refused: 0, stood: 0 };
  const orders = { tries: 0, paid: 0, held: 0, refused: {}, ms: [] };
  const accounts = [];
  for (let i = 0; i < walkers; i++) accounts.push(await server.login(`${ctx.tag}w${i}`, nextIp(22)));

  const ws = [];
  const t0 = Date.now();
  // Arrive in waves of ten.
  for (let i = 0; i < walkers; i += 10) {
    const wave = accounts.slice(i, i + 10).map(async (a) => {
      const c = server.connect('floor', a, meter);
      const hello = await c.next((m) => m.t === 'hello', 15_000);
      return { a, c, hello, look: hello.you.look, seen: new Set(), snapshots: 0, rows: 0, moves: 0, walkMs: 0, emotesSent: 0, emotesBurst: 0, emotesBack: new Map(), seatsHeard: 0, looksHeard: 0, x: hello.you.x, z: hello.you.z, r: hello.you.r };
    });
    ws.push(...(await Promise.all(wave)));
    await sleep(300);
  }
  const arrivalMs = Date.now() - t0;
  const ids = new Set(ws.map((w) => w.a.id));
  for (const w of ws) {
    w.c.on((m) => {
      if (m.t === 's') {
        w.snapshots++;
        w.rows += m.p.length;
        for (const row of m.p) w.seen.add(row[0]);
      } else if (m.t === 'emote') {
        w.emotesBack.set(m.id, (w.emotesBack.get(m.id) ?? 0) + 1);
      } else if (m.t === 'player') {
        if (m.seat !== undefined) w.seatsHeard++;
        if (m.look) w.looksHeard++;
      } else if (m.t === 'seat.no') {
        seats.refused++;
      }
    });
  }
  // A few watch lobby lists, the way the lobby panel does.
  for (const w of ws.slice(0, 5)) w.c.send({ t: 'watch', game: 'blackjack' });

  const startAt = Date.now();
  const stopAt = startAt + seconds * 1000;
  ws.forEach((w, i) => {
    w.sits = i % Math.max(1, Math.round(1 / sitShare)) === 0;
    w.orders = i % Math.max(1, Math.round(1 / orderShare)) === 1;
    w.ordered = 0;
  });
  const walk = async (w) => {
    let last = null;
    let prev = null;
    const send = (t, now) => {
      if (!w.c.send({ t, x: Math.round(w.x), z: Math.round(w.z), r: w.r })) return;
      const pose = { x: Math.round(w.x), z: Math.round(w.z), r: w.r, at: now };
      if (t === 'mv') {
        w.moves++;
        prev = last;
      } else {
        prev = null;
      }
      last = pose;
    };
    send('st', Date.now()); // the first position on a connection places the player
    while (Date.now() < stopAt) {
      // A leg: straight to a random spot, or a short stretch on a random heading.
      let heading;
      let legMs;
      if (pattern === 'zigzag') {
        heading = rand() * Math.PI * 2;
        legMs = 150 + rand() * 250;
      } else {
        const tx = BOUNDS.minX + rand() * (BOUNDS.maxX - BOUNDS.minX);
        const tz = BOUNDS.minZ + rand() * (BOUNDS.maxZ - BOUNDS.minZ);
        heading = Math.atan2(tx - w.x, tz - w.z);
        legMs = (Math.hypot(tx - w.x, tz - w.z) / SPEED) * 1000;
      }
      w.r = yawByte(heading);
      const legEnd = Math.min(stopAt, Date.now() + legMs);
      let frameAt = Date.now();
      while (Date.now() < legEnd) {
        await sleep(FRAME_MS);
        const now = Date.now();
        const dt = (now - frameAt) / 1000;
        frameAt = now;
        w.walkMs += dt * 1000;
        w.x = Math.min(BOUNDS.maxX, Math.max(BOUNDS.minX, w.x + Math.sin(heading) * SPEED * dt));
        w.z = Math.min(BOUNDS.maxZ, Math.max(BOUNDS.minZ, w.z + Math.cos(heading) * SPEED * dt));
        const pose = { x: Math.round(w.x), z: Math.round(w.z), r: w.r };
        const due = policy === 'old' ? !last || now - last.at >= OLD_SEND_MS : shouldSend(pose, now, last, prev);
        if (due) send('mv', now);
      }
      if (pattern === 'zigzag') continue;
      send('st', Date.now());
      // Some sit down here a while: a seat from the pool, within reach of where they stopped.
      if (w.sits && rand() < 0.5) {
        const seat = `load-seat-${Math.floor(rand() * seatPool)}`;
        const sx = Math.round(w.x + (rand() - 0.5) * 120);
        const sz = Math.round(w.z + (rand() - 0.5) * 120);
        const refusedBefore = seats.refused;
        seats.tries++;
        w.c.send({ t: 'sit', seat, x: sx, z: sz, r: w.r });
        await sleep(300);
        if (seats.refused === refusedBefore) {
          seats.sat++;
          w.x = sx;
          w.z = sz;
          last = { x: sx, z: sz, r: w.r, at: Date.now() };
          prev = null;
          await sleep(2_000 + Math.floor(rand() * 6_000));
          w.c.send({ t: 'stand' });
          seats.stood++;
        }
      }
      // Some order from the bar: paid, then the drink shows in their hand (a look everyone hears).
      if (w.orders && w.ordered < 4 && rand() < 0.35) {
        const item = BAR_MENU[Math.floor(rand() * 6)];
        const op = `load${Date.now().toString(36)}${Math.floor(rand() * 1e6).toString(36)}`;
        orders.tries++;
        w.ordered++;
        const t0 = Date.now();
        const r = await server.api('bar/order', { method: 'POST', token: w.a.token, ip: w.a.ip, body: { item: item.id, op } });
        orders.ms.push(Date.now() - t0);
        if (r.status === 200) {
          orders.paid++;
          const look = { ...w.look, held: { item: item.id, order: op, until: r.body.order.until } };
          const l = await server.api('me/look', { method: 'PUT', token: w.a.token, ip: w.a.ip, body: { look } });
          if (l.status === 200) orders.held++;
          else orders.refused[`look ${l.status}`] = (orders.refused[`look ${l.status}`] ?? 0) + 1;
        } else orders.refused[r.status] = (orders.refused[r.status] ?? 0) + 1;
      }
      // Stand a moment; now and then wave (or mash the emote key).
      if (rand() < 0.3) {
        const mash = rand() < 0.2 ? 6 : 1;
        for (let k = 0; k < mash; k++) {
          w.c.send({ t: 'emote', e: EMOTES[Math.floor(rand() * EMOTES.length)] });
          w.emotesSent++;
        }
        if (mash > 1) w.emotesBurst++;
      }
      await sleep(200 + Math.floor(rand() * 2_000));
    }
    send('st', Date.now());
  };
  const inBefore = meter.out;
  const cpuBefore = ctx.cpu ? await ctx.cpu() : null;
  await Promise.all(ws.map(walk));
  const walkedSec = (Date.now() - startAt) / 1000;
  const cpuAfter = ctx.cpu ? await ctx.cpu() : null;
  const inbound = meter.out - inBefore;
  await sleep(1_000);

  const closedEarly = ws.filter((w) => w.c.closed).map((w) => ({ name: w.a.name, ...w.c.closed }));
  const sawAll = ws.filter((w) => [...ids].filter((id) => id !== w.a.id).every((id) => w.seen.has(id))).length;
  // Emotes a sender got back never exceed what the floor lets through: 3, then one every 2 s.
  const cap = 3 + Math.ceil(walkedSec / 2);
  const overCap = ws.filter((w) => (w.emotesBack.get(w.a.id) ?? 0) > cap).length;
  const per = ws.map((w) => w.snapshots / walkedSec);
  const rows = ws.reduce((s, w) => s + w.rows, 0) / Math.max(1, ws.reduce((s, w) => s + w.snapshots, 0));
  const moveRate = ws.reduce((s, w) => s + w.moves, 0) / Math.max(1, ws.reduce((s, w) => s + w.walkMs, 0) / 1000);
  const hellos = ws.map((w) => w.hello.players.length);
  for (const w of ws) w.c.close(1000, 'bye');
  await sleep(500);
  return {
    walkers,
    policy,
    pattern,
    seconds: +walkedSec.toFixed(1),
    arrivalMs,
    rosterAtArrival: { first: hellos[0], last: hellos.at(-1) },
    floorInboundPerSec: +(inbound / walkedSec).toFixed(0),
    // the runtime's CPU while they walk (logins and arrivals left out): the floor's own load
    workerdCpuShareWhileWalking: cpuBefore && cpuAfter ? +((cpuAfter.cpu - cpuBefore.cpu) / walkedSec).toFixed(2) : null,
    movesPerWalkingSecond: +moveRate.toFixed(2),
    snapshotsPerSecPerWalker: { min: +Math.min(...per).toFixed(1), max: +Math.max(...per).toFixed(1) },
    rowsPerSnapshot: +rows.toFixed(1),
    sawEveryoneWalk: `${sawAll}/${walkers}`,
    emotesSent: ws.reduce((s, w) => s + w.emotesSent, 0),
    emoteBursts: ws.reduce((s, w) => s + w.emotesBurst, 0),
    emotesDelivered: ws.reduce((s, w) => s + [...w.emotesBack.values()].reduce((x, y) => x + y, 0), 0),
    sendersOverEmoteCap: overCap,
    closedEarly,
    seats: { ...seats, pool: seatPool, heardPerWalker: +(ws.reduce((s, w) => s + w.seatsHeard, 0) / walkers).toFixed(1) },
    orders: { tries: orders.tries, paid: orders.paid, held: orders.held, refused: orders.refused, msMedian: orders.ms.sort((a, b) => a - b)[Math.floor(orders.ms.length / 2)] ?? null, msMax: orders.ms.at(-1) ?? null, looksHeardPerWalker: +(ws.reduce((s, w) => s + w.looksHeard, 0) / walkers).toFixed(1) },
    floorOutboundPerSec: +(ws.reduce((s, w) => s + w.snapshots, 0) / walkedSec).toFixed(0),
    // The last to arrive sees every earlier wave in its hello (its own wave connects alongside it).
    ok: closedEarly.length === 0 && overCap === 0 && sawAll >= walkers - 1 && hellos.at(-1) >= walkers - Math.min(10, walkers),
  };
}
