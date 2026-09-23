import { it, expect } from 'vitest';
import { shuffleTen, deckNumbers } from '../src/games/videopoker/engine.ts';
import { rank5, payCredits, HAND_NAMES } from '../src/games/videopoker/hands.ts';
import { bestHold } from '../src/games/videopoker/strategy.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

// 9/6 Jacks or Better at five coins, played with the hold list (docs/rules/cards-and-machines.md
// §2.3-2.4): 99.5439% return, SD 4.4175 bets a hand. Twenty million hands put 3 SE at about
// 0.3%. Every hand is dealt with the engine's own shuffle and scored with its evaluator and pay
// table; the list's hold for each distinct deal is worked out once and remembered.

// shared/ compiles without DOM or Node types; vitest provides the console.
declare const console: { log(...args: unknown[]): void };

const RETURN = 0.99543904;
const SD = 4.4175;
// Final-hand probabilities under optimal play, §2.3 (Nothing .. Royal).
const PROB = [0.54543467, 0.21458503, 0.1292789, 0.0744487, 0.01122937, 0.01101451, 0.01151221, 0.00236255, 0.00010931, 0.00002476];

// Colex index of a sorted 5-card deal: C(a,1) + C(b,2) + C(c,3) + C(d,4) + C(e,5).
function binomials(k: number): Int32Array {
  const t = new Int32Array(52);
  for (let n = 0; n < 52; n++) {
    let v = 1;
    for (let i = 0; i < k; i++) v = (v * (n - i)) / (i + 1);
    t[n] = n < k ? 0 : Math.round(v);
  }
  return t;
}
const B1 = binomials(1);
const B2 = binomials(2);
const B3 = binomials(3);
const B4 = binomials(4);
const B5 = binomials(5);

it('9/6 Jacks or Better returns 99.5439% at five coins with the hold list (Monte Carlo, 3 SE)', () => {
  const n = mcRounds(20_000_000);
  const rng = mcRng(20260922);
  const deck = deckNumbers();
  const holds = new Int8Array(2_598_960).fill(-1);
  const h = new Uint8Array(5);
  const counts = new Array(10).fill(0);
  const tally = new Tally();

  for (let i = 0; i < n; i++) {
    shuffleTen(rng, deck);
    // Sort the deal (insertion sort on five) to look its hold up by colex index.
    for (let k = 0; k < 5; k++) {
      const c = deck[k]!;
      let j = k;
      while (j > 0 && h[j - 1]! > c) {
        h[j] = h[j - 1]!;
        j--;
      }
      h[j] = c;
    }
    const idx = B1[h[0]!]! + B2[h[1]!]! + B3[h[2]!]! + B4[h[3]!]! + B5[h[4]!]!;
    let hold = holds[idx]!;
    if (hold < 0) hold = holds[idx] = bestHold(h);
    let next = 5;
    const f0 = hold & 1 ? h[0]! : deck[next++]!;
    const f1 = hold & 2 ? h[1]! : deck[next++]!;
    const f2 = hold & 4 ? h[2]! : deck[next++]!;
    const f3 = hold & 8 ? h[3]! : deck[next++]!;
    const f4 = hold & 16 ? h[4]! : deck[next++]!;
    const rank = rank5(f0, f1, f2, f3, f4);
    counts[rank]++;
    tally.add(payCredits(rank, 5) / 5 - 1);
  }

  console.log(tally.summary('videopoker 9/6, hold list, 5 coins', 1 - RETURN));
  const lines = ['final hand         measured    expected       z'];
  for (let r = 9; r >= 0; r--) {
    const p = counts[r] / n;
    const z = (p - PROB[r]!) / Math.sqrt((PROB[r]! * (1 - PROB[r]!)) / n);
    lines.push(`${HAND_NAMES[r]!.padEnd(16)} ${p.toFixed(8)}  ${PROB[r]!.toFixed(8)}  ${z.toFixed(2).padStart(6)}`);
    expect(Math.abs(z)).toBeLessThan(4);
  }
  console.log(lines.join('\n'));

  expect(Math.abs(tally.edge - (1 - RETURN))).toBeLessThanOrEqual(3 * tally.se);
  // Royals carry most of the variance, so the measured SD wanders by about 2% per sigma of the
  // royal count; this only checks the results are in units of the whole five-coin bet.
  expect(Math.abs(tally.sd - SD) / SD).toBeLessThan(0.1);
});
