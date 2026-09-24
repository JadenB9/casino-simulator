// The casino floor with many people on it: walkers arrive in waves, walk between random points at
// the client's pace (a move every 100 ms while walking, a stop when they arrive), emote now and
// then (some mash the key: the floor lets three through, then one every two seconds), and a few
// watch a game's lobby list. Measured: what each walker receives per second, snapshot sizes, and
// whether everyone saw everyone.

import { EMOTES } from '../../shared/src/protocol.ts';
import { nextIp, sleep } from './net.mjs';

const BOUNDS = { minX: -1900, maxX: 1900, minZ: -1400, maxZ: 1400 };
const SPEED = 260; // cm/s, the walking pace
const STEP_MS = 100;

export async function floor(ctx, opts = {}) {
  const { server, meter, rand } = ctx;
  const walkers = opts.walkers ?? 50;
  const seconds = opts.seconds ?? 30;
  const accounts = [];
  for (let i = 0; i < walkers; i++) accounts.push(await server.login(`${ctx.tag}w${i}`, nextIp(22)));

  const ws = [];
  const t0 = Date.now();
  // Arrive in waves of ten.
  for (let i = 0; i < walkers; i += 10) {
    const wave = accounts.slice(i, i + 10).map(async (a) => {
      const c = server.connect('floor', a, meter);
      const hello = await c.next((m) => m.t === 'hello', 15_000);
      return { a, c, hello, seen: new Set(), snapshots: 0, rows: 0, emotesSent: 0, emotesBurst: 0, emotesBack: new Map(), x: hello.you.x, z: hello.you.z };
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

  const stopAt = Date.now() + seconds * 1000;
  const walk = async (w) => {
    let first = true;
    while (Date.now() < stopAt) {
      const tx = BOUNDS.minX + rand() * (BOUNDS.maxX - BOUNDS.minX);
      const tz = BOUNDS.minZ + rand() * (BOUNDS.maxZ - BOUNDS.minZ);
      const r = Math.floor(rand() * 256);
      while (Date.now() < stopAt) {
        const dx = tx - w.x;
        const dz = tz - w.z;
        const d = Math.hypot(dx, dz);
        const step = (SPEED * STEP_MS) / 1000;
        if (d <= step) {
          w.x = Math.round(tx);
          w.z = Math.round(tz);
          break;
        }
        w.x = Math.round(w.x + (dx / d) * step);
        w.z = Math.round(w.z + (dz / d) * step);
        w.c.send({ t: first ? 'st' : 'mv', x: w.x, z: w.z, r });
        first = false;
        await sleep(STEP_MS);
      }
      w.c.send({ t: 'st', x: w.x, z: w.z, r });
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
  };
  await Promise.all(ws.map(walk));
  await sleep(1_000);

  const seconds_ = (Date.now() - (stopAt - seconds * 1000)) / 1000;
  const closedEarly = ws.filter((w) => w.c.closed).map((w) => ({ name: w.a.name, ...w.c.closed }));
  // Everyone should have seen (almost) everyone walk: all but those who never moved in their view.
  const sawAll = ws.filter((w) => [...ids].filter((id) => id !== w.a.id).every((id) => w.seen.has(id))).length;
  // Emotes a sender got back never exceed what the floor lets through: 3, then one every 2 s.
  const cap = 3 + Math.ceil(seconds_ / 2);
  const overCap = ws.filter((w) => (w.emotesBack.get(w.a.id) ?? 0) > cap).length;
  const per = ws.map((w) => w.snapshots / seconds_);
  const rows = ws.reduce((s, w) => s + w.rows, 0) / Math.max(1, ws.reduce((s, w) => s + w.snapshots, 0));
  const hellos = ws.map((w) => w.hello.players.length);
  for (const w of ws) w.c.close(1000, 'bye');
  await sleep(500);
  return {
    walkers,
    seconds: +seconds_.toFixed(1),
    arrivalMs,
    rosterAtArrival: { first: hellos[0], last: hellos.at(-1) },
    snapshotsPerSecPerWalker: { min: +Math.min(...per).toFixed(1), max: +Math.max(...per).toFixed(1) },
    rowsPerSnapshot: +rows.toFixed(1),
    sawEveryoneWalk: `${sawAll}/${walkers}`,
    emotesSent: ws.reduce((s, w) => s + w.emotesSent, 0),
    emoteBursts: ws.reduce((s, w) => s + w.emotesBurst, 0),
    emotesDelivered: ws.reduce((s, w) => s + [...w.emotesBack.values()].reduce((x, y) => x + y, 0), 0),
    sendersOverEmoteCap: overCap,
    closedEarly,
    ok: closedEarly.length === 0 && overCap === 0 && sawAll >= walkers - 1 && hellos.at(-1) >= walkers - 1 - 0,
  };
}
