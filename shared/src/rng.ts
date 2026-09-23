// Random numbers. The server draws from `crypto.getRandomValues`; tests inject a seeded
// generator with the same interface so a failure can be replayed. Nothing in the game may call
// Math.random.

export interface Rng {
  /** A uniformly distributed 32-bit unsigned integer. */
  next32(): number;
}

const TWO_32 = 2 ** 32;

/**
 * An integer in [0, n), every value exactly equally likely.
 *
 * `x % n` on a raw 32-bit draw favours small values whenever n doesn't divide 2^32 (for a
 * 52-card deck, the first 48 values come up 1 in 82 million more often). So draws at or above
 * the largest multiple of n below 2^32 are thrown away and redrawn; for n = 52 that happens
 * about once in 89 million draws.
 */
export function randInt(rng: Rng, n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > TWO_32) throw new RangeError(`randInt: bad range ${n}`);
  if (n === 1) return 0;
  const limit = TWO_32 - (TWO_32 % n);
  for (;;) {
    const x = rng.next32();
    if (x < limit) return x % n;
  }
}

/** True with probability num/den, exactly. */
export function chance(rng: Rng, num: number, den: number): boolean {
  return randInt(rng, den) < num;
}

/** A uniform float in [0, 1) with 32 bits of resolution; for bots and animation, never payouts. */
export function randUnit(rng: Rng): number {
  return rng.next32() / TWO_32;
}

/** Shuffle in place (Fisher-Yates: each position swaps with one at or before it). */
export function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new RangeError('pick: empty list');
  return items[randInt(rng, items.length)]!;
}

// `crypto` is a global in browsers, workerd and Node, but this folder compiles without DOM or
// Workers types, so it is declared here rather than pulled in.
declare const crypto: { getRandomValues<T extends Uint32Array>(array: T): T };

/**
 * The production generator. getRandomValues fills at most 65,536 bytes per call, which is
 * exactly this buffer; refilling in bulk keeps a million-card simulation from making a million
 * calls into the platform.
 */
export function cryptoRng(): Rng {
  const buf = new Uint32Array(16_384);
  let i = buf.length;
  return {
    next32() {
      if (i >= buf.length) {
        crypto.getRandomValues(buf);
        i = 0;
      }
      return buf[i++]!;
    },
  };
}
