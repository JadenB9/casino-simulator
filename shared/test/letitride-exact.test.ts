// Let It Ride, exactly. Every five-card hand (2,598,960) in every order it can be dealt: which
// three are the player's, and which of the other two is the first community card (20 ways), so
// 51,979,200 deals. The value of letting a bet ride on three or four cards is the average of what
// it pays over every way the rest can come, which gives the best play at both decisions; the
// strategy in rules.ts must be that play everywhere it matters, and with it the house edge is the
// published 3.51% of a unit.

import { it, expect } from 'vitest';
import { newDeck } from '../src/cards.ts';
import type { Card } from '../src/cards.ts';
import { DEFAULT_PAYTABLE, bonusPays, categoryOfCodes, codeOf, handPays, rideFirst, rideSecond } from '../src/games/letitride/rules.ts';

declare const console: { log(...args: unknown[]): void };

const CARDS: Card[] = new Array(52);
for (const c of newDeck()) CARDS[codeOf(c)] = c;

// C(n, k) for the combinatorial number system: a k-subset a < b < ... ranks as C(a,1) + C(b,2) + ...
const C: number[][] = Array.from({ length: 53 }, () => new Array(6).fill(0));
for (let n = 0; n <= 52; n++) {
  C[n]![0] = 1;
  for (let k = 1; k <= 5; k++) C[n]![k] = n === 0 ? 0 : C[n - 1]![k - 1]! + C[n - 1]![k]!;
}
const rank3 = (a: number, b: number, c: number) => C[a]![1]! + C[b]![2]! + C[c]![3]!;
const rank4 = (a: number, b: number, c: number, d: number) => C[a]![1]! + C[b]![2]! + C[c]![3]! + C[d]![4]!;

// Positions 0-4 of a five-card hand: the four left when one goes, and the three left when two go
// (the two being the community cards), all in ascending order.
const FOURS: number[][] = [0, 1, 2, 3, 4].map((i) => [0, 1, 2, 3, 4].filter((k) => k !== i));
const PAIRS: [number, number][] = [];
for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) PAIRS.push([i, j]);
const THREES: number[][] = PAIRS.map(([i, j]) => [0, 1, 2, 3, 4].filter((k) => k !== i && k !== j));

it('the pull-back strategy is the best play, and the house edge is 1,822,224 / 51,979,200 = 3.5057% of a unit', () => {
  const pay = DEFAULT_PAYTABLE;
  // a riding bet's result in units, for every five-card hand
  const value = (a: number, b: number, c: number, d: number, e: number) => {
    const m = handPays(categoryOfCodes(a, b, c, d, e), pay);
    return m > 0 ? m : -1;
  };
  // sums of that over every way to finish three cards (1,176) and four (48)
  const sum3 = new Int32Array(C[52]![3]!);
  const sum4 = new Int32Array(C[52]![4]!);
  const h = [0, 0, 0, 0, 0];
  for (h[4] = 4; h[4] < 52; h[4]++)
    for (h[3] = 3; h[3] < h[4]; h[3]++)
      for (h[2] = 2; h[2] < h[3]; h[2]++)
        for (h[1] = 1; h[1] < h[2]; h[1]++)
          for (h[0] = 0; h[0] < h[1]; h[0]++) {
            const v = value(h[0], h[1], h[2], h[3], h[4]);
            for (const f of FOURS) sum4[rank4(h[f[0]!]!, h[f[1]!]!, h[f[2]!]!, h[f[3]!]!)]! += v;
            for (const f of THREES) sum3[rank3(h[f[0]!]!, h[f[1]!]!, h[f[2]!]!)]! += v;
          }

  // The strategy against the best play, subset by subset.
  const ride3 = new Uint8Array(sum3.length);
  const ride4 = new Uint8Array(sum4.length);
  let wrong = 0;
  let ties3 = 0;
  let ties4 = 0;
  for (let c = 2; c < 52; c++)
    for (let b = 1; b < c; b++)
      for (let a = 0; a < b; a++) {
        const k = rank3(a, b, c);
        ride3[k] = rideFirst([CARDS[a]!, CARDS[b]!, CARDS[c]!]) ? 1 : 0;
        if (sum3[k] === 0) ties3++;
        else if ((sum3[k]! > 0) !== (ride3[k] === 1)) wrong++;
      }
  for (let d = 3; d < 52; d++)
    for (let c = 2; c < d; c++)
      for (let b = 1; b < c; b++)
        for (let a = 0; a < b; a++) {
          const k = rank4(a, b, c, d);
          ride4[k] = rideSecond([CARDS[a]!, CARDS[b]!, CARDS[c]!, CARDS[d]!]) ? 1 : 0;
          if (sum4[k] === 0) {
            ties4++;
            // a tie is pulled back
            if (ride4[k]) wrong++;
          } else if ((sum4[k]! > 0) !== (ride4[k] === 1)) wrong++;
        }
  expect(wrong).toBe(0);
  expect(ties3).toBe(0);
  expect(ties4).toBe(2_268);

  // Every deal played by the strategy: the result in units, and the units left riding.
  let won = 0;
  let riding = 0;
  let deals = 0;
  for (h[4] = 4; h[4] < 52; h[4]++)
    for (h[3] = 3; h[3] < h[4]; h[3]++)
      for (h[2] = 2; h[2] < h[3]; h[2]++)
        for (h[1] = 1; h[1] < h[2]; h[1]++)
          for (h[0] = 0; h[0] < h[1]; h[0]++) {
            const v = value(h[0], h[1], h[2], h[3], h[4]);
            PAIRS.forEach(([i, j], p) => {
              const t = THREES[p]!;
              const r1 = ride3[rank3(h[t[0]!]!, h[t[1]!]!, h[t[2]!]!)]!;
              // the first community card is either of the two: the four the player sees are then
              // the hand without the other one
              for (const other of [j, i]) {
                const f = FOURS[other]!;
                const units = 1 + r1 + ride4[rank4(h[f[0]!]!, h[f[1]!]!, h[f[2]!]!, h[f[3]!]!)]!;
                won += v * units;
                riding += units;
                deals++;
              }
            });
          }
  expect(deals).toBe(51_979_200);
  expect(won).toBe(-1_822_224);
  expect(riding).toBe(RIDING);
  console.log(`let it ride: edge ${((1_822_224 / 51_979_200) * 100).toFixed(4)}% of a unit, ${(riding / deals).toFixed(4)} units ride on average, element of risk ${((1_822_224 / riding) * 100).toFixed(4)}%`);
});

/** Units left riding over all 51,979,200 deals under the strategy (for the element of risk). */
const RIDING = 63_607_296;

it('the 3-Card Bonus 50-40-30-6-3-1: -1,568 / 22,100 = 7.0950%', () => {
  const deck = newDeck();
  let net = 0;
  let n = 0;
  for (let a = 0; a < 52; a++)
    for (let b = a + 1; b < 52; b++)
      for (let c = b + 1; c < 52; c++) {
        const m = bonusPays([deck[a]!, deck[b]!, deck[c]!], DEFAULT_PAYTABLE);
        net += m > 0 ? m : -1;
        n++;
      }
  expect(n).toBe(22_100);
  expect(net).toBe(-1_568);
});
