// Other people on the floor for the frame-time checks, without a browser each: Node sockets that
// log in, dress, and then walk, sit, emote and play the way real clients do (the same send rule,
// net/send-policy.ts, and the same messages), so the page being measured draws them as it would
// draw real players. Used by perf.mjs; the load scripts' sockets (scripts/load/net.mjs) carry them.
//
//   const bots = await startBots({ port: 6121, origin: 'http://localhost:6120', count: 24, rooms, seats, stations });
//   ...
//   await bots.stop();
//
// Roles, by index: every fourth sits on a floor seat in its room (stands and moves on now and then),
// every fourth after that sits at a table there (a solo table opened with ?station=, which tells the
// floor where they are), the rest walk from spot to spot and emote now and then.

import { Server, nextIp, rng, sleep } from '../load/net.mjs';
import { shouldSend } from '../../client/src/net/send-policy.ts';
import { EMOTES } from '../../shared/src/protocol.ts';
import { OUTFITS, SKIN_TONES } from '../../shared/src/look.ts';

const FRAME_MS = 40;
const SPEED = 180; // cm/s: a stroll
const COLOURS = ['#1f2430', '#6b1d2a', '#0f3b2e', '#c9a227', '#e8e2d6', '#27408b', '#3a3a3a', '#8a4b2a', '#111111', '#5b2a86'];

const yawByte = (heading) => ((Math.round((heading / (Math.PI * 2)) * 256) % 256) + 256) % 256;

/**
 * rooms: [{ id, x0, x1, z0, z1 }] (metres); seats: [{ id, x, z, yaw, room }]; stations:
 * [{ id, game, variant, room }] (tables and machines a bot may sit at).
 */
export async function startBots({ port, origin, count, rooms, seats = [], stations = [], seed = 7, prefix = 'perfbot', only = null }) {
  const server = new Server(port, origin);
  const rand = rng(seed);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const inRooms = only ? rooms.filter((r) => only.includes(r.id)) : rooms;
  const bots = [];
  let stopping = false;
  const stats = { walkers: 0, sitters: 0, players: 0, seatsTaken: 0, seatRefused: 0, emotes: 0, sent: 0, errors: [] };

  for (let i = 0; i < count; i++) {
    const room = inRooms[i % inRooms.length];
    const name = `${prefix}${String(i).padStart(2, '0')}`;
    const a = await server.login(name, nextIp(40), 'casino-dev');
    const body = rand() < 0.5 ? 'm' : 'f';
    const look = { v: 1, body, outfit: pick(OUTFITS[body]), skin: Math.floor(rand() * SKIN_TONES.length), hair: pick(COLOURS), top: pick(COLOURS), bottom: pick(COLOURS), shoes: pick(COLOURS) };
    const r = await server.api('me/look', { method: 'PUT', token: a.token, ip: a.ip, body: { look } });
    if (r.status !== 200) stats.errors.push(`look ${name}: ${r.status}`);
    const roomSeats = seats.filter((s) => s.room === room.id);
    const roomStations = stations.filter((s) => s.room === room.id);
    const role = i % 4 === 0 && roomSeats.length ? 'sitter' : i % 4 === 1 && roomStations.length ? 'player' : 'walker';
    bots.push({ a, room, role, roomSeats, roomStations, floor: null, table: null, x: 0, z: 0, r: 0, last: null, prev: null });
  }

  const send = (b, msg) => {
    if (b.floor?.send(msg)) stats.sent++;
  };
  const pose = (b, t, now) => {
    send(b, { t, x: Math.round(b.x), z: Math.round(b.z), r: b.r });
    b.prev = t === 'mv' ? b.last : null;
    b.last = { x: Math.round(b.x), z: Math.round(b.z), r: b.r, at: now };
  };

  /** Walk in a straight line to (tx, tz) in cm, sending as a browser would. */
  const walkTo = async (b, tx, tz) => {
    const heading = Math.atan2(tx - b.x, tz - b.z);
    b.r = yawByte(heading);
    const dist = Math.hypot(tx - b.x, tz - b.z);
    const end = Date.now() + (dist / SPEED) * 1000;
    let at = Date.now();
    while (!stopping && Date.now() < end) {
      await sleep(FRAME_MS);
      const now = Date.now();
      const dt = (now - at) / 1000;
      at = now;
      b.x += Math.sin(heading) * SPEED * dt;
      b.z += Math.cos(heading) * SPEED * dt;
      const p = { x: Math.round(b.x), z: Math.round(b.z), r: b.r };
      if (shouldSend(p, now, b.last, b.prev)) pose(b, 'mv', now);
    }
    pose(b, 'st', Date.now());
  };

  const spot = (room) => {
    const m = 1.4;
    return [(room.x0 + m + rand() * (room.x1 - room.x0 - 2 * m)) * 100, (room.z0 + m + rand() * (room.z1 - room.z0 - 2 * m)) * 100];
  };

  const live = async (b) => {
    b.floor = server.connect('floor', b.a, null);
    const hello = await b.floor.next((m) => m.t === 'hello', 20_000);
    b.floor.on((m) => {
      if (m.t === 'seat.no') stats.seatRefused++;
    });
    // start somewhere in the room, not at the door
    [b.x, b.z] = spot(b.room);
    void hello;
    pose(b, 'st', Date.now());
    if (b.role === 'player') {
      stats.players++;
      const s = pick(b.roomStations);
      b.x = s.x * 100;
      b.z = s.z * 100;
      pose(b, 'st', Date.now());
      const extra = `&station=${encodeURIComponent(s.id)}${s.variant ? `&variant=${encodeURIComponent(s.variant)}` : ''}`;
      b.table = server.connect(`solo/${s.game}`, b.a, null, extra);
      await b.table.next((m) => m.t === 'table', 20_000).catch((e) => stats.errors.push(`table ${s.id}: ${e.message}`));
      while (!stopping) await sleep(500);
      return;
    }
    if (b.role === 'sitter') stats.sitters++;
    else stats.walkers++;
    while (!stopping) {
      if (b.role === 'sitter') {
        const s = pick(b.roomSeats);
        await walkTo(b, s.x * 100 + Math.sin(s.yaw) * 60, s.z * 100 + Math.cos(s.yaw) * 60);
        if (stopping) break;
        b.x = s.x * 100;
        b.z = s.z * 100;
        b.r = yawByte(s.yaw);
        send(b, { t: 'sit', seat: s.id, x: Math.round(b.x), z: Math.round(b.z), r: b.r });
        stats.seatsTaken++;
        const until = Date.now() + 15_000 + rand() * 20_000;
        while (!stopping && Date.now() < until) {
          await sleep(1000);
          if (rand() < 0.04) {
            send(b, { t: 'emote', e: pick(EMOTES) });
            stats.emotes++;
          }
        }
        send(b, { t: 'stand' });
      } else {
        const [tx, tz] = spot(b.room);
        await walkTo(b, tx, tz);
        if (rand() < 0.3) {
          send(b, { t: 'emote', e: pick(EMOTES) });
          stats.emotes++;
        }
        await sleep(800 + rand() * 3000);
      }
    }
  };

  const running = bots.map((b) => live(b).catch((e) => stats.errors.push(`${b.a.name}: ${e.message}`)));
  // everyone placed before the caller measures anything
  await sleep(1500);
  return {
    bots,
    stats,
    async stop() {
      stopping = true;
      await Promise.race([Promise.all(running), sleep(5000)]);
      await Promise.all(bots.flatMap((b) => [b.table?.close(1000, 'bye'), b.floor?.close(1000, 'bye')]));
    },
  };
}
