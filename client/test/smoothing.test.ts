// How smooth another walker looks with fewer positions on the wire. A walker's true path (steady
// lines, turns, a stretch of zig-zag, a stop) is sent by the real rule (net/send-policy.ts),
// coalesced by a floor that flushes every 100 ms with each row's age, carried with jitter, and
// drawn by the real interpolation (net/interp.ts). Compared with the scheme before it (a position
// every 100 ms, flushes every 66 ms stamped at flush time, drawn 200 ms back), the drawn path
// must stay about as close to the truth and never visibly stall while the walker walks.

import { describe, expect, it } from 'vitest';
import { DELAY_MS, Track } from '../src/net/interp.ts';
import { shouldSend, type SentPose } from '../src/net/send-policy.ts';

const SPEED = 260; // cm/s

/** Heading (radians) and whether walking, at ms t of the scripted walk. */
function script(t: number): { heading: number; moving: boolean } {
  if (t < 2_000) return { heading: 0, moving: true }; // a steady line
  if (t < 4_000) return { heading: Math.PI / 2, moving: true }; // a right-angle turn, then steady
  if (t < 5_500) return { heading: Math.floor(t / 250) % 2 ? Math.PI / 4 : -Math.PI / 4, moving: true }; // zig-zag
  if (t < 6_500) return { heading: Math.PI, moving: true };
  return { heading: Math.PI, moving: false }; // stopped
}

/** The true position every ms, from integrating the script. */
function truePath(ms: number): { x: number; z: number; r: number; moving: boolean }[] {
  const out = [];
  let x = 0;
  let z = 0;
  for (let t = 0; t <= ms; t++) {
    const s = script(t);
    if (s.moving) {
      x += (Math.sin(s.heading) * SPEED) / 1000;
      z += (Math.cos(s.heading) * SPEED) / 1000;
    }
    out.push({ x, z, r: ((Math.round((s.heading / (2 * Math.PI)) * 256) % 256) + 256) % 256, moving: s.moving });
  }
  return out;
}

function rand32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Scheme {
  send: (cur: { x: number; z: number; r: number }, now: number, last: SentPose | null, prev: SentPose | null) => boolean;
  flushMs: number;
  /** Rows carry their age (the new floor) or are stamped at flush time (the old one). */
  ages: boolean;
  delayMs: number;
}

/** Drive one walk through a scheme; the drawn path's worst error and its longest stand-still while walking. */
function simulate(scheme: Scheme, seed: number) {
  const DURATION = 7_500;
  const truth = truePath(DURATION);
  const rand = rand32(seed);
  const latency = () => 30 + rand() * 40; // one way, 30-70 ms
  // Sender: a frame every 16 ms.
  const arrivals: { at: number; x: number; z: number; r: number; moving: boolean }[] = [];
  let last: SentPose | null = null;
  let prev: SentPose | null = null;
  let walking = false;
  let prevFrame: { x: number; z: number; r: number } | null = null;
  for (let t = 0; t <= DURATION; t += 16) {
    const p = truth[t]!;
    const cur = { x: Math.round(p.x), z: Math.round(p.z), r: p.r };
    const stirring = p.moving || !prevFrame || prevFrame.x !== cur.x || prevFrame.z !== cur.z || prevFrame.r !== cur.r;
    prevFrame = cur;
    let kind: 'mv' | 'st' | null = null;
    if (stirring) {
      if (!last || last.x !== cur.x || last.z !== cur.z || last.r !== cur.r) if (scheme.send(cur, t, last, prev)) kind = 'mv';
    } else if (walking) kind = 'st';
    if (!kind) continue;
    prev = kind === 'mv' && walking ? last : null;
    last = { ...cur, at: t };
    walking = kind === 'mv';
    arrivals.push({ at: t + latency(), ...cur, moving: kind === 'mv' });
  }
  arrivals.sort((a, b) => a.at - b.at);
  // Floor: coalesce per flush window; a row goes out at the next flush, with its age if the scheme has them.
  const rows: { ts: number; recv: number; x: number; z: number; r: number; moving: boolean }[] = [];
  let lastFlush = -Infinity;
  let pending: (typeof arrivals)[number] | null = null;
  const flush = (now: number) => {
    if (pending) rows.push({ ts: scheme.ages ? pending.at : now, recv: now + latency(), x: pending.x, z: pending.z, r: pending.r, moving: pending.moving });
    pending = null;
    lastFlush = now;
  };
  for (const a of arrivals) {
    if (pending && a.at >= lastFlush + scheme.flushMs) flush(lastFlush + scheme.flushMs); // the owed flush
    pending = a;
    if (a.at - lastFlush >= scheme.flushMs) flush(a.at);
  }
  if (pending) flush(lastFlush + scheme.flushMs);
  rows.sort((a, b) => a.recv - b.recv);
  // Receiver: a frame every 16 ms; draws DELAY behind (its clock is the server's, as clock.ts keeps).
  const track = new Track();
  let next = 0;
  let worst = 0;
  let still = 0;
  let longestStill = 0;
  let prevDrawn: { x: number; z: number } | null = null;
  for (let t = 400; t <= DURATION; t += 16) {
    while (next < rows.length && rows[next]!.recv <= t) {
      const r = rows[next++]!;
      track.push(r.ts, { x: r.x, z: r.z, r: r.r, moving: r.moving });
    }
    // Track draws DELAY_MS behind; shift the query so each scheme draws at its own delay.
    const drawn = track.at(t + DELAY_MS - scheme.delayMs);
    if (!drawn) continue;
    // What the walker was doing at the drawn moment, give or take the uplink.
    const target = Math.max(0, Math.round(t - scheme.delayMs - 50));
    const truthThen = truth[target]!;
    worst = Math.max(worst, Math.hypot(drawn.x - truthThen.x, drawn.z - truthThen.z));
    // A frame that barely moves while the walker walks; a hold waiting for data shows as a run of them.
    if (prevDrawn && truthThen.moving && script(target).moving && Math.hypot(drawn.x - prevDrawn.x, drawn.z - prevDrawn.z) < 0.5) {
      still += 16;
      longestStill = Math.max(longestStill, still);
    } else {
      still = 0;
    }
    prevDrawn = { x: drawn.x, z: drawn.z };
  }
  return { sent: arrivals.length, worstCm: Math.round(worst), longestStillMs: longestStill };
}

const OLD: Scheme = { send: (cur, now, last) => !last || now - last.at >= 100, flushMs: 66, ages: false, delayMs: 200 };

describe('another walker, drawn from fewer positions', () => {
  it('stays as close to the truth as before and never stalls, from well under half the messages', () => {
    const NEW: Scheme = { send: shouldSend, flushMs: 100, ages: true, delayMs: DELAY_MS };
    for (const seed of [1, 2, 3, 4, 5]) {
      const before = simulate(OLD, seed);
      const after = simulate(NEW, seed);
      // Half the messages or fewer...
      expect(after.sent, `seed ${seed}`).toBeLessThanOrEqual(before.sent * 0.5);
      // ...the drawn walker no further from where it really was (a stride is ~70 cm)...
      expect(after.worstCm, `seed ${seed}`).toBeLessThanOrEqual(Math.max(before.worstCm, 40));
      // ...and it never visibly stands still mid-walk waiting for the next position: at most a
      // frame or two where a corner meets the straight line it was drawing past it.
      expect(after.longestStillMs, `seed ${seed}`).toBeLessThanOrEqual(48);
    }
  });
});
