// A token bucket per socket: `capacity` messages in a burst, refilled at `perSecond`.
// Buckets live in memory, so a Durable Object waking from hibernation starts them full again,
// which is fine: they exist to stop floods, not to meter anyone precisely.

/**
 * Every signed-in HTTP request, per account (index.ts): far above what the client sends (a page
 * load is a dozen), so only a script hammering the reads (each is several D1 queries, /me asks
 * tables too) meets it. Kept per isolate like the tickets' limit; routes that write keep their
 * own limits in D1. (Here rather than in index.ts: the Worker's entry may export only handlers.)
 */
export const API_BURST = 60;
export const API_PER_SEC = 10;

export class Bucket {
  private tokens: number;
  private at = Date.now();

  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
  ) {
    this.tokens = capacity;
  }

  take(n = 1): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.at) / 1000) * this.perSecond);
    this.at = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

/**
 * One bucket per key (an account, an address), for limits that have to hold across sockets:
 * how often someone may open a connection, say. The map is capped; past the cap the oldest key
 * is forgotten, which only ever errs on the side of letting someone in.
 */
export class KeyedBuckets {
  private readonly map = new Map<string, Bucket>();

  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
    private readonly maxKeys = 5_000,
  ) {}

  take(key: string, n = 1): boolean {
    let b = this.map.get(key);
    if (!b) {
      if (this.map.size >= this.maxKeys) this.map.delete(this.map.keys().next().value!);
      b = new Bucket(this.capacity, this.perSecond);
      this.map.set(key, b);
    }
    return b.take(n);
  }
}
