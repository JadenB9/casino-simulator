// Server time. Every message that matters carries the server's `now`; we keep the offset of the
// least-delayed sample (a later message can only have been slower on the way) and let it drift
// back slowly, 20 ms a message, as the link slows. Countdowns use { deadline, now } pairs from the
// same message, so they don't depend on this at all.

let offset: number | null = null;

/**
 * A message this far (ms) behind the time we keep isn't a slow one: this machine's clock was set
 * forward, and drifting back 20 ms a message would leave other players frozen and the wheels'
 * spins hours out for as long as that takes. Start again from it.
 */
const JUMP_MS = 5_000;

export function observeServerTime(serverNow: number): void {
  const sample = serverNow - Date.now();
  offset = offset === null || sample < offset - JUMP_MS ? sample : Math.max(sample, offset - 20);
}

export function serverNow(): number {
  return Date.now() + (offset ?? 0);
}

/** ms left on a countdown that arrived as { deadline, now } at local time `receivedAt`. */
export function msLeft(deadline: number, now: number, receivedAt: number): number {
  return Math.max(0, deadline - now - (Date.now() - receivedAt));
}
