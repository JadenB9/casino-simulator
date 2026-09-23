import { describe, it, expect } from 'vitest';
import type { Card } from '../src/cards.ts';
import { RANKS } from '../src/cards.ts';
import { DECKS, isPair, nextDraw, settleSpot, winnerOf, type Spot, type Winner } from '../src/games/baccarat/rules.ts';

// Exact 8-deck outcome counts over every ordered six-card sequence from a full shoe
// (416 x 415 x ... x 411 = 4,998,398,275,503,360), as in docs/rules/table-games.md §4.3.
//
// Cards are grouped by point value (128 zeros, 32 of each of 1-9), a coup is walked through the
// engine's own nextDraw() and winnerOf(), and every branch is weighted by how many ordered card
// sequences reach it, including the ways to fill the six positions a short coup leaves unused.
// Each weight is below 2^53 and exact as a double; the sums are kept as BigInt.

const SHOE = DECKS * 52;
const COUNTS = [16 * DECKS, 4 * DECKS, 4 * DECKS, 4 * DECKS, 4 * DECKS, 4 * DECKS, 4 * DECKS, 4 * DECKS, 4 * DECKS, 4 * DECKS];

function enumerate(): Record<Winner, bigint> {
  const counts = [...COUNTS];
  let left = SHOE;
  const player: number[] = [];
  const banker: number[] = [];
  const out: Record<Winner, bigint> = { player: 0n, banker: 0n, tie: 0n };

  const take = (v: number): number => {
    const w = counts[v]!;
    counts[v] = w - 1;
    left--;
    return w;
  };
  const putBack = (v: number) => {
    counts[v]!++;
    left++;
  };

  const play = (weight: number, used: number): void => {
    const hand = nextDraw(player, banker);
    if (hand === null) {
      let w = weight;
      for (let k = used, r = left; k < 6; k++, r--) w *= r;
      const p = player.reduce((a, b) => a + b, 0) % 10;
      const b = banker.reduce((a, c) => a + c, 0) % 10;
      out[winnerOf(p, b)] += BigInt(w);
      return;
    }
    const cards = hand === 'player' ? player : banker;
    for (let v = 0; v < 10; v++) {
      if (counts[v] === 0) continue;
      const w = weight * take(v);
      cards.push(v);
      play(w, used + 1);
      cards.pop();
      putBack(v);
    }
  };

  // Player, Banker, Player, Banker.
  for (let p1 = 0; p1 < 10; p1++) {
    const w1 = take(p1);
    player.push(p1);
    for (let b1 = 0; b1 < 10; b1++) {
      const w2 = w1 * take(b1);
      banker.push(b1);
      for (let p2 = 0; p2 < 10; p2++) {
        const w3 = w2 * take(p2);
        player.push(p2);
        for (let b2 = 0; b2 < 10; b2++) {
          const w4 = w3 * take(b2);
          banker.push(b2);
          play(w4, 4);
          banker.pop();
          putBack(b2);
        }
        player.pop();
        putBack(p2);
      }
      banker.pop();
      putBack(b1);
    }
    player.pop();
    putBack(p1);
  }
  return out;
}

/** Expected net per unit bet as an exact fraction [num, den], from the engine's own payouts on a $1 bet. */
function expectedValue(spot: Spot, counts: Record<Winner, bigint>, total: bigint): [bigint, bigint] {
  let num = 0n;
  for (const w of ['player', 'banker', 'tie'] as const) {
    const net = settleSpot(spot, 100, { winner: w, playerPair: false, bankerPair: false }).returned - 100;
    num += counts[w] * BigInt(net);
  }
  return [num, total * 100n];
}

function meanAndSd(spot: Spot, counts: Record<Winner, bigint>, total: bigint): { mean: number; sd: number } {
  let m1 = 0;
  let m2 = 0;
  for (const w of ['player', 'banker', 'tie'] as const) {
    const net = (settleSpot(spot, 100, { winner: w, playerPair: false, bankerPair: false }).returned - 100) / 100;
    const p = Number(counts[w]) / Number(total);
    m1 += p * net;
    m2 += p * net * net;
  }
  return { mean: m1, sd: Math.sqrt(m2 - m1 * m1) };
}

const sameFraction = ([a, b]: [bigint, bigint], [c, d]: [bigint, bigint]) => a * d === c * b;
const pct = (x: number) => (x * 100).toFixed(4);

describe('baccarat exact enumeration (8 decks, full shoe)', () => {
  const started = Date.now();
  const counts = enumerate();
  const ms = Date.now() - started;
  const total = counts.player + counts.banker + counts.tie;

  it('covers every ordered six-card sequence, quickly', () => {
    expect(total).toBe(416n * 415n * 414n * 413n * 412n * 411n);
    expect(total).toBe(4_998_398_275_503_360n);
    expect(ms).toBeLessThan(5_000);
  });

  it('reproduces the documented outcome counts exactly', () => {
    expect(counts.banker).toBe(2_292_252_566_437_888n);
    expect(counts.player).toBe(2_230_518_282_592_256n);
    expect(counts.tie).toBe(475_627_426_473_216n);
  });

  it('gives the documented exact expected values and edges', () => {
    const banker = expectedValue('banker', counts, total);
    const player = expectedValue('player', counts, total);
    const tie = expectedValue('tie', counts, total);
    expect(sameFraction(banker, [-114753351728n, 10847218479825n])).toBe(true);
    expect(sameFraction(player, [-241149546272n, 19524993263685n])).toBe(true);
    expect(sameFraction(tie, [-103841353768n, 723147898655n])).toBe(true);
    expect(pct(-Number(banker[0]) / Number(banker[1]))).toBe('1.0579');
    expect(pct(-Number(player[0]) / Number(player[1]))).toBe('1.2351');
    expect(pct(-Number(tie[0]) / Number(tie[1]))).toBe('14.3596');
  });

  it('gives the documented standard deviations', () => {
    expect(meanAndSd('banker', counts, total).sd.toFixed(4)).toBe('0.9274');
    expect(meanAndSd('player', counts, total).sd.toFixed(4)).toBe('0.9512');
    expect(meanAndSd('tie', counts, total).sd.toFixed(4)).toBe('2.6409');
  });

  it('pair bets: P(pair) = 31/415 and an 11 to 1 payout gives -43/415 (10.3614%)', () => {
    // A pair bet looks at two cards of the deal (Player: 1st and 3rd, Banker: 2nd and 4th), and
    // any two positions of a shuffled shoe are alike, so one enumeration over ordered rank pairs
    // covers both bets.
    const perRank = 4 * DECKS;
    let pairs = 0n;
    let all = 0n;
    for (const r1 of RANKS) {
      for (const r2 of RANKS) {
        const w = BigInt(perRank * (r1 === r2 ? perRank - 1 : perRank));
        all += w;
        if (isPair(`${r1}s` as Card, `${r2}h` as Card)) pairs += w;
      }
    }
    expect(all).toBe(416n * 415n);
    expect(sameFraction([pairs, all], [31n, 415n])).toBe(true);
    for (const spot of ['playerPair', 'bankerPair'] as const) {
      const win = settleSpot(spot, 100, { winner: 'banker', playerPair: true, bankerPair: true }).returned - 100;
      const lose = settleSpot(spot, 100, { winner: 'banker', playerPair: false, bankerPair: false }).returned - 100;
      const ev: [bigint, bigint] = [pairs * BigInt(win) + (all - pairs) * BigInt(lose), all * 100n];
      expect(sameFraction(ev, [-43n, 415n])).toBe(true);
      expect(pct(43 / 415)).toBe('10.3614');
      const p = 31 / 415;
      const mean = -43 / 415;
      const sd = Math.sqrt(p * (win / 100) ** 2 + (1 - p) * (lose / 100) ** 2 - mean * mean);
      expect(sd.toFixed(4)).toBe('3.1549');
    }
  });
});
