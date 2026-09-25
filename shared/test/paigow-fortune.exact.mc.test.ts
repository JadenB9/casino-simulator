// The Fortune bonus, exactly: every one of the 154,143,080 seven-card hands from the 53-card deck,
// sorted into the pay table's lines. Each line's count is the Wizard of Odds' (Fortune Pai Gow
// Poker side bet, pay table 2), and with them the house edge is 11,970,096 / 154,143,080 =
// 7.7656%. Kept with the Monte Carlo runs because it takes about a minute.

import { it, expect } from 'vitest';
import { DEFAULT_FORTUNE, fortuneOfCodes } from '../src/games/paigow/rules.ts';

declare const console: { log(...args: unknown[]): void };

it('the Fortune lines over all 154,143,080 hands, and pay table 2 at 7.7656%', () => {
  // index 0: three pair and everything under it; then the eleven lines best first
  const counts = new Array<number>(12).fill(0);
  const h = [0, 0, 0, 0, 0, 0, 0];
  for (h[6] = 6; h[6] < 53; h[6]++)
    for (h[5] = 5; h[5] < h[6]; h[5]++)
      for (h[4] = 4; h[4] < h[5]; h[4]++)
        for (h[3] = 3; h[3] < h[4]; h[3]++)
          for (h[2] = 2; h[2] < h[3]; h[2]++)
            for (h[1] = 1; h[1] < h[2]; h[1]++) for (h[0] = 0; h[0] < h[1]; h[0]++) counts[fortuneOfCodes(h) + 1]!++;
  expect(counts).toEqual([124_556_196, 32, 72, 196, 1_128, 26_020, 184_644, 307_472, 4_188_528, 6_172_088, 7_672_500, 11_034_204]);
  let net = -counts[0]!;
  DEFAULT_FORTUNE.forEach((pays, line) => (net += pays * counts[line + 1]!));
  expect(net).toBe(-11_970_096);
  console.log(`pai gow fortune pay table 2: edge ${((11_970_096 / 154_143_080) * 100).toFixed(4)}% over 154,143,080 hands`);
});
