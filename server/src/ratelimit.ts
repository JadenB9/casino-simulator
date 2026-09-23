// A token bucket per socket: `capacity` messages in a burst, refilled at `perSecond`.
// Buckets live in memory, so a Durable Object waking from hibernation starts them full again,
// which is fine: they exist to stop floods, not to meter anyone precisely.

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
