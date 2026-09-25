// Fair play's side of the floor (index.ts calls it): where each player's walks end, and when
// they were doing anything at all, on their way to D1 (server/src/fair.ts note()).
//
// A stop counts only if it ends a real walk (at least WALK_MOVES positions and WALK_CM covered
// since the last stop) and the player then walks on: a stop that turns out to be sitting down on
// a floor seat (within SEAT_NEAR_CM of it), a teleport's landing, or the last stop before leaving
// isn't somewhere they chose to stop. Positions are the client's own, before any clamping.
// Memory only, like the tables' side.

import type { Batch } from '../../../shared/src/fair.ts';
import { note } from '../fair.ts';

const WALK_MOVES = 3;
const WALK_CM = 200;
const SEAT_NEAR_CM = 150;
/** Further than this between two positions is the server moving you (an elevator, jail, an invite). */
const JUMP_CM = 800;
const FLUSH_STOPS = 10;
const ACTIVE_EVERY_MS = 60_000;
/** Activity alone goes to D1 at most this often per player. */
const FLUSH_ACTIVE_MS = 10 * 60_000;

interface Walker {
  moves: number;
  dist: number;
  x: number;
  z: number;
  stop: [number, number] | null;
  batch: Batch;
  lastAt: number;
  sentAt: number;
}

export class FloorFair {
  private readonly walkers = new Map<number, Walker>();

  constructor(
    private readonly db: () => D1Database,
    private readonly auto: boolean,
    private readonly waitUntil: (p: Promise<unknown>) => void,
  ) {}

  private of(accountId: number, now: number): Walker {
    let w = this.walkers.get(accountId);
    if (!w) {
      w = { moves: 0, dist: 0, x: NaN, z: NaN, stop: null, batch: {}, lastAt: 0, sentAt: now };
      this.walkers.set(accountId, w);
    }
    return w;
  }

  /** Anything this player did (a minute's first moment is kept). */
  touched(accountId: number, now: number): void {
    const w = this.of(accountId, now);
    if (now - w.lastAt < ACTIVE_EVERY_MS) return;
    w.lastAt = now;
    (w.batch.at ??= []).push(now);
    if (now - w.sentAt >= FLUSH_ACTIVE_MS) this.send(accountId, w, now);
  }

  /** A position while walking (`mv`) or at a stop (`st`). */
  position(accountId: number, x: number, z: number, stopped: boolean, now: number): void {
    const w = this.of(accountId, now);
    if (!stopped && w.stop && Math.hypot(x - w.x, z - w.z) <= JUMP_CM) {
      // Walking on from the last stop: it was a real one.
      (w.batch.stops ??= []).push(w.stop);
      w.stop = null;
      if (w.batch.stops.length >= FLUSH_STOPS) this.send(accountId, w, now);
    }
    const step = Number.isFinite(w.x) ? Math.hypot(x - w.x, z - w.z) : 0;
    if (step > JUMP_CM) {
      w.stop = null;
      w.moves = 0;
      w.dist = 0;
    } else {
      w.dist += step;
    }
    w.x = x;
    w.z = z;
    if (stopped) {
      if (w.moves >= WALK_MOVES && w.dist >= WALK_CM) w.stop = [x, z];
      w.moves = 0;
      w.dist = 0;
    } else {
      w.moves += 1;
    }
  }

  /** Sat on a floor seat here: the stop beside it was the seat's, not the player's. */
  sat(accountId: number, x: number, z: number): void {
    const w = this.walkers.get(accountId);
    if (w?.stop && Math.hypot(w.stop[0] - x, w.stop[1] - z) <= SEAT_NEAR_CM) w.stop = null;
  }

  /** Left the floor: what's waiting goes, and the player is forgotten. */
  gone(accountId: number, now: number): void {
    const w = this.walkers.get(accountId);
    if (!w) return;
    this.send(accountId, w, now);
    this.walkers.delete(accountId);
  }

  private send(accountId: number, w: Walker, now: number): void {
    w.sentAt = now;
    const batch = w.batch;
    if (!batch.stops?.length && !batch.at?.length) return;
    w.batch = {};
    this.waitUntil(note(this.db(), accountId, batch, now, this.auto).catch((err) => console.error('fair: floor note failed', err)));
  }
}
