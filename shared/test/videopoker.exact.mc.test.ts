import { it, expect } from 'vitest';
import { rank5, PAY_PER_COIN, ROYAL_MAX_BET } from '../src/games/videopoker/hands.ts';
import { bestHold } from '../src/games/videopoker/strategy.ts';

// Exact return of the hold list, by enumeration (the method of docs/math/video-poker-job96.mjs):
// for every one of the 2,598,960 deals, the value of each of the 32 holds over every possible
// draw from the 47 unseen cards. The list (with footnotes) must match optimal play on every deal,
// return 99.543904% at five coins, and reproduce the final-hand counts of §2.3 to the last digit.
// It lives with the Monte Carlo runs because it takes a few seconds.

// shared/ compiles without DOM or Node types; vitest provides the console.
declare const console: { log(...args: unknown[]): void };

const NC = 10;
const DEALS = 2_598_960;
const C47 = [1, 47, 1081, 16215, 178365, 1533939];
// Scales "final hands for this hold" to 5 x C(47,5) per deal, the Wizard of Odds convention.
const WEIGHT = [5, 43, 473, 7095, 163185, 7669695];
const POP = Array.from({ length: 32 }, (_, m) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1) + ((m >> 4) & 1));

// §2.3 combinations per final hand (Nothing .. Royal) under optimal play at five coins.
const COMBOS = [
  10_872_274_993_896, 4_277_372_890_968, 2_576_946_164_148, 1_484_003_070_324, 223_837_565_784,
  219_554_786_160, 229_475_482_596, 47_093_167_764, 2_178_883_296, 493_512_264,
];

it('the hold list is optimal on every deal: 99.543904% at 5 coins, 98.1822% at 1-4 (exact)', () => {
  const Cb: number[][] = [];
  for (let n = 0; n <= 52; n++) {
    Cb.push(new Array(6).fill(0));
    Cb[n]![0] = 1;
    for (let k = 1; k <= 5 && k <= n; k++) Cb[n]![k] = Cb[n - 1]![k - 1]! + (k <= n - 1 ? Cb[n - 1]![k]! : 0);
  }

  // cnt[k][subset * NC + category]: final hands containing each k-card subset, by category.
  const cnt = [new Float64Array(NC), new Int32Array(52 * NC), new Int32Array(1326 * NC), new Int32Array(22100 * NC), new Int32Array(270725 * NC)];
  const cat5 = new Uint8Array(DEALS);
  const hand = [0, 0, 0, 0, 0];
  let d = 0;
  for (let e = 4; e < 52; e++) for (let c4 = 3; c4 < e; c4++) for (let c3 = 2; c3 < c4; c3++) for (let b = 1; b < c3; b++) for (let a = 0; a < b; a++) {
    hand[0] = a; hand[1] = b; hand[2] = c3; hand[3] = c4; hand[4] = e;
    const cat = rank5(a, b, c3, c4, e);
    cat5[d++] = cat;
    for (let m = 0; m < 31; m++) {
      let k = 0;
      let idx = 0;
      for (let i = 0; i < 5; i++) if (m & (1 << i)) idx += Cb[hand[i]!]![++k]!;
      cnt[k]![idx * NC + cat]! += 1;
    }
  }

  const pays5 = PAY_PER_COIN.map((p, cat) => (cat === 9 ? ROYAL_MAX_BET / 5 : p));
  const pays1 = PAY_PER_COIN;
  const weigh = (pays: readonly number[]) =>
    cnt.map((arr) => {
      const out = new Float64Array(arr.length / NC);
      for (let i = 0; i < out.length; i++) for (let c = 0; c < NC; c++) out[i]! += pays[c]! * arr[i * NC + c]!;
      return out;
    });
  const pay5 = weigh(pays5);
  const pay1 = weigh(pays1);

  const idxOf = new Int32Array(32);
  const kOf = new Int8Array(32);
  const f5 = new Float64Array(32);
  const f1 = new Float64Array(32);
  const dist = new Float64Array(NC);
  let sum5 = 0;
  let sum1 = 0;
  let misplays = 0;
  d = 0;
  for (let e = 4; e < 52; e++) for (let c4 = 3; c4 < e; c4++) for (let c3 = 2; c3 < c4; c3++) for (let b = 1; b < c3; b++) for (let a = 0; a < b; a++) {
    hand[0] = a; hand[1] = b; hand[2] = c3; hand[3] = c4; hand[4] = e;
    for (let m = 0; m < 32; m++) {
      let k = 0;
      let idx = 0;
      for (let i = 0; i < 5; i++) if (m & (1 << i)) idx += Cb[hand[i]!]![++k]!;
      idxOf[m] = idx;
      kOf[m] = k;
      f5[m] = k === 5 ? pays5[cat5[idx]!]! : k === 0 ? pay5[0]![0]! : pay5[k]![idx]!;
      f1[m] = k === 5 ? pays1[cat5[idx]!]! : k === 0 ? pay1[0]![0]! : pay1[k]![idx]!;
    }
    // Möbius over supersets: final hands with exactly these cards kept, none of the discards.
    for (let bit = 1; bit < 32; bit <<= 1)
      for (let m = 0; m < 32; m++)
        if (!(m & bit)) {
          f5[m]! -= f5[m | bit]!;
          f1[m]! -= f1[m | bit]!;
        }
    let best = 0;
    for (let m = 1; m < 32; m++) if (f5[m]! * C47[5 - POP[best]!]! > f5[best]! * C47[5 - POP[m]!]!) best = m;
    const pick = bestHold(hand);
    const ev = f5[pick]! / C47[5 - POP[pick]!]!;
    if (ev < f5[best]! / C47[5 - POP[best]!]! - 1e-12) misplays++;
    sum5 += ev;
    sum1 += f1[pick]! / C47[5 - POP[pick]!]!;
    // Final-hand categories for the pick: inclusion-exclusion over its supersets.
    const held = POP[pick]!;
    for (let s = pick; s < 32; s = (s + 1) | pick) {
      const sign = (POP[s]! - held) & 1 ? -1 : 1;
      if (s === 31) dist[cat5[idxOf[31]!]!]! += sign * WEIGHT[held]!;
      else {
        const arr = cnt[kOf[s]!]!;
        const base = idxOf[s]! * NC;
        for (let c = 0; c < NC; c++) dist[c]! += sign * arr[base + c]! * WEIGHT[held]!;
      }
    }
    d++;
  }

  const ret5 = sum5 / DEALS;
  const ret1 = sum1 / DEALS;
  console.log(`hold list, exact: ${(ret5 * 100).toFixed(6)}% at 5 coins, ${(ret1 * 100).toFixed(6)}% at 1-4 coins, ${misplays} deals off optimal`);
  expect(d).toBe(DEALS);
  expect(misplays).toBe(0);
  expect(ret5).toBeCloseTo(0.99543904, 8);
  expect(ret1).toBeCloseTo(0.981822, 6);
  expect(Array.from(dist, Math.round)).toEqual(COMBOS);
});
