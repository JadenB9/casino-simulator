// When a walking player's position is worth a message. The floor is one Durable Object for
// everyone, and every `mv` is an event it has to handle, so a position goes out only when it says
// something the others' views can't work out for themselves:
//   - at most every SEND_MS (5 a second);
//   - never for a change too small to see (MIN_MOVE_CM, MIN_TURN);
//   - on a steady straight line only every STEADY_MS: everyone else draws the line between the
//     last two positions (net/interp.ts), so the ones in between add nothing until it bends.
// Pure, so the load scripts walk by exactly the same rule (scripts/load/floor.mjs).

/** Shortest gap between two positions, ms. */
export const SEND_MS = 200;
/** Longest gap while walking a steady straight line, ms. */
export const STEADY_MS = 320;
/** Smaller moves (cm) and turns (yaw bytes, 256 to a turn) than these aren't worth a message. */
export const MIN_MOVE_CM = 5;
export const MIN_TURN = 2;
/** How far (cm) from the straight line through the last two positions still counts as on it. */
export const OFF_LINE_CM = 8;

export interface SentPose {
  x: number;
  z: number;
  r: number;
  /** When it was sent (the sender's clock, ms). */
  at: number;
}

/** Yaw bytes apart, the short way round. */
export function turnBetween(a: number, b: number): number {
  const d = (((b - a) % 256) + 256) % 256;
  return Math.min(d, 256 - d);
}

/**
 * Whether a walking player at `cur` should send its position at `now`, given the last position
 * sent and the one before it (either may be missing).
 */
export function shouldSend(cur: { x: number; z: number; r: number }, now: number, last: SentPose | null, prev: SentPose | null): boolean {
  if (!last) return true;
  const since = now - last.at;
  if (since < SEND_MS) return false;
  const turned = turnBetween(cur.r, last.r);
  if (Math.hypot(cur.x - last.x, cur.z - last.z) < MIN_MOVE_CM && turned < MIN_TURN) return false;
  if (since >= STEADY_MS || turned >= MIN_TURN || !prev || last.at <= prev.at) return true;
  // Where the line through the last two positions says we'd be by now.
  const k = since / (last.at - prev.at);
  const x = last.x + (last.x - prev.x) * k;
  const z = last.z + (last.z - prev.z) * k;
  return Math.hypot(cur.x - x, cur.z - z) >= OFF_LINE_CM;
}
