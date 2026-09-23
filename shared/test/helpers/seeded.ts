// A seeded generator for tests: same interface as the production one, so an engine can't tell
// the difference, but a failing run replays exactly. sfc32 (Chris Doty-Humphrey's Small Fast
// Counting generator) passes PractRand to terabytes, which is plenty for Monte Carlo work.

import type { Rng } from '../../src/rng.ts';

export function seededRng(seed: number): Rng {
  let a = 0x9e3779b9 | 0;
  let b = 0x243f6a88 | 0;
  let c = 0xb7e15162 | 0;
  let d = seed | 0;
  const next = (): number => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 16; i++) next();
  return { next32: next };
}
