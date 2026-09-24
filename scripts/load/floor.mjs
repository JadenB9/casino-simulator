// The casino floor with many people on it: walkers arrive in waves, walk (a frame every 40 ms, the
// way a browser moves its player), emote now and then (some mash the key: the floor lets three
// through, then one every two seconds), and a few watch a game's lobby list. Measured: what the
// one floor object takes in per second (every `mv` is an event it must handle), what each walker
// receives, and whether everyone saw everyone.
//
// `policy` is when a walker sends its position: 'new' is the client's rule (client/src/net/
// send-policy.ts, the same module), 'old' is a position every 100 ms while moving, as before it.
// `pattern` is how they walk: 'waypoints' (straight to a random spot, stand a moment, again) or
// 'zigzag' (a new heading every few hundred ms, never standing: the worst case for the rule).

import { EMOTES } from '../../shared/src/protocol.ts';
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
  const accounts = [];
  for (let i = 0; i < walkers; i++) accounts.push(await server.login(`${ctx.tag}w${i}`, nextIp(22)));

  const ws = [];
  const t0 = Date.now();
  // Arrive in waves of ten.
  for (let i = 0; i < walkers; i += 10) {
    const wave = accounts.slice(i, i + 10).map(async (a) => {
      const c = server.connect('floor', a, meter);
      const hello = await c.next((m) => m.t === 'hello', 15_000);
      return { a, c, hello, seen: new Set(), snapshots: 0, rows: 0, moves: 0, walkMs: 0, emotesSent: 0, emotesBurst: 0, emotesBack: new Map(), x: hello.you.x, z: hello.you.z, r: hello.you.r };
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
      }
    });
  }
  // A few watch lobby lists, the way the lobby panel does.
  for (const w of ws.slice(0, 5)) w.c.send({ t: 'watch', game: 'blackjack' });

  const startAt = Date.now();
  const stopAt = startAt + seconds * 1000;
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
  await Promise.all(ws.map(walk));
  const walkedSec = (Date.now() - startAt) / 1000;
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
    movesPerWalkingSecond: +moveRate.toFixed(2),
    snapshotsPerSecPerWalker: { min: +Math.min(...per).toFixed(1), max: +Math.max(...per).toFixed(1) },
    rowsPerSnapshot: +rows.toFixed(1),
    sawEveryoneWalk: `${sawAll}/${walkers}`,
    emotesSent: ws.reduce((s, w) => s + w.emotesSent, 0),
    emoteBursts: ws.reduce((s, w) => s + w.emotesBurst, 0),
    emotesDelivered: ws.reduce((s, w) => s + [...w.emotesBack.values()].reduce((x, y) => x + y, 0), 0),
    sendersOverEmoteCap: overCap,
    closedEarly,
    // The last to arrive sees every earlier wave in its hello (its own wave connects alongside it).
    ok: closedEarly.length === 0 && overCap === 0 && sawAll >= walkers - 1 && hellos.at(-1) >= walkers - Math.min(10, walkers),
  };
}
