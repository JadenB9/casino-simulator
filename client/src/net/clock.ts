// Server time. Every message that matters carries the server's `now`; we keep the smallest
// observed offset (the least-delayed sample) and let it drift up slowly. Countdowns use
// { deadline, now } pairs from the same message, so they don't depend on this at all.

let offset: number | null = null;

export function observeServerTime(serverNow: number): void {
  const sample = serverNow - Date.now();
  offset = offset === null ? sample : Math.max(sample, offset - 20);
}

export function serverNow(): number {
  return Date.now() + (offset ?? 0);
}

/** ms left on a countdown that arrived as { deadline, now } at local time `receivedAt`. */
export function msLeft(deadline: number, now: number, receivedAt: number): number {
  return Math.max(0, deadline - now - (Date.now() - receivedAt));
}
