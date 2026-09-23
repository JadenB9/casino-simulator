import { describe, it, expect } from 'vitest';
import type { Card } from '../src/cards.ts';
import { RANKS } from '../src/cards.ts';
import {
  BANKER_TABLEAU, POINTS, SPOTS, bankerDraws, burnCount, coupOf, dealCoup, handTotal, isPair, nextDraw, playerDraws,
  points, seatNumber, settleBets, settleSpot, winnerOf, type Coup, type Spot,
} from '../src/games/baccarat/rules.ts';

// The drawing rules exactly as docs/rules/table-games.md §4.2 prints them. Rows: the Banker's
// two-card total. Columns: the point value of the Player's third card, 0 to 9.
const DOCS_TABLEAU: Record<number, string> = {
  0: 'D D D D D D D D D D',
  1: 'D D D D D D D D D D',
  2: 'D D D D D D D D D D',
  3: 'D D D D D D D D S D',
  4: 'S S D D D D D D S S',
  5: 'S S S S D D D D S S',
  6: 'S S S S S S D D S S',
  7: 'S S S S S S S S S S',
};

// The same rules as the doc writes them in code, as a second, independent oracle.
function docsFormula(b: number, p3: number): boolean {
  return b <= 2 || (b === 3 && p3 !== 8) || (b === 4 && p3 >= 2 && p3 <= 7) || (b === 5 && p3 >= 4 && p3 <= 7) || (b === 6 && (p3 === 6 || p3 === 7));
}

const cells: { b: number; p3: number; draws: boolean }[] = [];
for (let b = 0; b <= 7; b++) {
  const row = DOCS_TABLEAU[b]!.split(' ');
  for (let p3 = 0; p3 <= 9; p3++) cells.push({ b, p3, draws: row[p3] === 'D' });
}

/** A dealer that deals these cards in this order. */
function script(cards: string[]): () => Card {
  let i = 0;
  return () => {
    const c = cards[i++];
    if (!c) throw new Error('script ran out of cards');
    return c as Card;
  };
}

const outcome = (winner: Coup['winner'], playerPair = false, bankerPair = false) => ({ winner, playerPair, bankerPair });

describe('baccarat tableau: Banker when the Player drew (every cell)', () => {
  it('has 80 cells, and the docs table and the docs formula agree on each', () => {
    expect(cells).toHaveLength(80);
    for (const c of cells) expect(c.draws).toBe(docsFormula(c.b, c.p3));
  });

  it.each(cells)('Banker $b against a Player third card of $p3: draws = $draws', ({ b, p3, draws }) => {
    expect(bankerDraws(b, p3)).toBe(draws);
    expect(BANKER_TABLEAU[b]![p3]).toBe(draws ? 'D' : 'S');
    // and through the coup walker the engine uses: a Player 5 that drew (points 2 + 3, then p3)
    expect(nextDraw([2, 3, p3], [b, 0])).toBe(draws ? 'banker' : null);
  });
});

describe('baccarat tableau: the Player (every total)', () => {
  const player = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => ({ t, draws: t <= 5, natural: t >= 8 }));
  it.each(player)('Player $t: draws = $draws, natural = $natural', ({ t, draws, natural }) => {
    if (!natural) expect(playerDraws(t)).toBe(draws);
    // Banker 7 so the Banker's own natural can't interfere.
    expect(nextDraw([t, 0], [7, 0])).toBe(draws ? 'player' : null);
  });
});

describe('baccarat tableau: Banker when the Player stood on 6 or 7 (every total)', () => {
  const rows: { p: number; b: number; draws: boolean }[] = [];
  for (const p of [6, 7]) for (let b = 0; b <= 9; b++) rows.push({ p, b, draws: b <= 5 });
  it.each(rows)('Player $p stands, Banker $b: draws = $draws', ({ p, b, draws }) => {
    if (b <= 7) expect(bankerDraws(b, null)).toBe(draws);
    expect(nextDraw([p, 0], [b, 0])).toBe(draws ? 'banker' : null);
  });
});

describe('baccarat naturals stop all drawing', () => {
  const rows: { p: number; b: number }[] = [];
  for (let p = 0; p <= 9; p++) for (let b = 0; b <= 9; b++) if (p >= 8 || b >= 8) rows.push({ p, b });
  it.each(rows)('Player $p, Banker $b: nobody draws', ({ p, b }) => {
    expect(nextDraw([p, 0], [b, 0])).toBeNull();
  });

  it('no hand ever gets a fourth card', () => {
    for (let p3 = 0; p3 <= 9; p3++) {
      for (let b3 = 0; b3 <= 9; b3++) expect(nextDraw([1, 1, p3], [1, 1, b3])).toBeNull();
    }
    expect(nextDraw([6, 0], [1, 1, 5])).toBeNull();
  });
});

describe('baccarat points', () => {
  it('ace 1, two to nine at face value, tens and pictures 0', () => {
    const expected = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 0, 0, 0];
    RANKS.forEach((r, i) => {
      expect(POINTS[r]).toBe(expected[i]);
      expect(points(`${r}s` as Card)).toBe(expected[i]);
    });
  });

  it('a total keeps only the last digit', () => {
    expect(handTotal(['9s', '8h'] as Card[])).toBe(7);
    expect(handTotal(['Ks', 'Qh', 'Jd'] as Card[])).toBe(0);
    expect(handTotal(['7s', '7h', '6d'] as Card[])).toBe(0);
    expect(handTotal(['As', '8h'] as Card[])).toBe(9);
  });

  it('burns count tens and pictures as 10 and the ace as 1', () => {
    RANKS.forEach((r, i) => expect(burnCount(`${r}c` as Card)).toBe(i < 9 ? i + 1 : 10));
  });

  it('a pair is two cards of the same rank (K-K, 10-10), not two ten-valued cards', () => {
    expect(isPair('Ks', 'Kd')).toBe(true);
    expect(isPair('Ts', 'Th')).toBe(true);
    expect(isPair('Js', 'Qs')).toBe(false);
    expect(isPair('Ts', 'Ks')).toBe(false);
  });
});

describe('baccarat coups (docs §4.5 edge cases)', () => {
  it('deals Player, Banker, Player, Banker, then the Player third card before the Banker one', () => {
    // P: 2 + 3 = 5 draws a 4 (9). B: A + 2 = 3 draws against a 4 -> K (3).
    const c = dealCoup(script(['2s', 'Ah', '3d', '2c', '4h', 'Ks']));
    expect(c.player).toEqual(['2s', '3d', '4h']);
    expect(c.banker).toEqual(['Ah', '2c', 'Ks']);
    expect(c.playerTotal).toBe(9);
    expect(c.bankerTotal).toBe(3);
    expect(c.winner).toBe('player');
  });

  it('a Player natural means the Banker never draws, even on 0-5', () => {
    const c = dealCoup(script(['8s', '2h', 'Ks', '3d']));
    expect(c.banker).toHaveLength(2);
    expect([c.playerTotal, c.bankerTotal, c.winner, c.natural]).toEqual([8, 5, 'player', true]);
  });

  it('a Banker natural means the Player never draws', () => {
    const c = dealCoup(script(['2s', '9h', '3c', 'Kd']));
    expect(c.player).toHaveLength(2);
    expect([c.playerTotal, c.bankerTotal, c.winner, c.natural]).toEqual([5, 9, 'banker', true]);
  });

  it('natural against natural: 9 beats 8, equal naturals tie', () => {
    expect(dealCoup(script(['4s', '3h', '5c', '5d'])).winner).toBe('player');
    const tie = dealCoup(script(['As', '8h', '7c', 'Kd']));
    expect([tie.playerTotal, tie.bankerTotal, tie.winner]).toEqual([8, 8, 'tie']);
  });

  it('when the Player stands on 6 or 7 the Banker ignores the table and draws on 0-5', () => {
    const c = dealCoup(script(['6h', '2c', 'Ks', '3s', '4d']));
    expect(c.player).toHaveLength(2);
    expect(c.banker).toEqual(['2c', '3s', '4d']);
    expect(c.winner).toBe('banker');
    const stands = dealCoup(script(['7h', '6c', 'Ks', 'Qs']));
    expect(stands.banker).toHaveLength(2);
    expect(stands.winner).toBe('player');
  });

  it('Banker 3 stands against a Player third card of 8', () => {
    const c = dealCoup(script(['2h', '3c', '3d', 'Ks', '8s']));
    expect(c.player).toEqual(['2h', '3d', '8s']);
    expect(c.banker).toHaveLength(2);
    expect([c.playerTotal, c.bankerTotal, c.winner]).toEqual([3, 3, 'tie']);
  });

  it('Banker 6 draws only against a Player third card of 6 or 7', () => {
    const draws = dealCoup(script(['2h', 'Kc', '2d', '6s', '6c', '3h']));
    expect(draws.banker).toEqual(['Kc', '6s', '3h']);
    const stands = dealCoup(script(['2h', 'Kc', '2d', '6s', '5c']));
    expect(stands.banker).toHaveLength(2);
  });

  it('pairs are the first two cards of a hand only', () => {
    const c = coupOf(['5s', '3h', '5d'] as Card[], ['Kd', 'Kc'] as Card[]);
    expect(c.playerPair).toBe(false);
    expect(c.bankerPair).toBe(true);
  });

  it('winnerOf compares totals', () => {
    expect(winnerOf(7, 5)).toBe('player');
    expect(winnerOf(5, 7)).toBe('banker');
    expect(winnerOf(6, 6)).toBe('tie');
  });
});

describe('baccarat payouts (docs §4.4)', () => {
  const winners = ['player', 'banker', 'tie'] as const;
  // What a $100 bet returns (stake included), for each spot and winner, with no pairs dealt.
  const table: Record<Spot, Record<(typeof winners)[number], number>> = {
    player: { player: 20_000, banker: 0, tie: 10_000 },
    banker: { player: 0, banker: 19_500, tie: 10_000 },
    tie: { player: 0, banker: 0, tie: 90_000 },
    playerPair: { player: 0, banker: 0, tie: 0 },
    bankerPair: { player: 0, banker: 0, tie: 0 },
  };
  const rows = SPOTS.flatMap((spot) => winners.map((w) => ({ spot, w, returned: table[spot][w] })));
  it.each(rows)('$100 on $spot when $w wins returns $returned cents', ({ spot, w, returned }) => {
    expect(settleSpot(spot, 10_000, outcome(w)).returned).toBe(returned);
  });

  it('a tie pushes Player and Banker bets and pays Tie 8 to 1', () => {
    expect(settleSpot('player', 2_500, outcome('tie'))).toEqual({ bet: 2_500, outcome: 'push', returned: 2_500, commission: 0 });
    expect(settleSpot('banker', 2_500, outcome('tie'))).toEqual({ bet: 2_500, outcome: 'push', returned: 2_500, commission: 0 });
    expect(settleSpot('tie', 2_500, outcome('tie'))).toEqual({ bet: 2_500, outcome: 'win', returned: 22_500, commission: 0 });
  });

  it('Banker wins pay 1 to 1 less 5% of the win, exact to the cent for every whole-dollar bet', () => {
    for (let dollars = 1; dollars <= 5_000; dollars++) {
      const bet = dollars * 100;
      const r = settleSpot('banker', bet, outcome('banker'));
      expect(r.commission).toBe(5 * dollars);
      expect(r.returned).toBe(2 * bet - 5 * dollars);
      expect(Number.isInteger(r.returned)).toBe(true);
    }
    expect(settleSpot('banker', 2_500, outcome('banker'))).toEqual({ bet: 2_500, outcome: 'win', returned: 4_875, commission: 125 });
  });

  it('commission never needs rounding: a bet off the dollar step would not even settle', () => {
    // The table refuses $1.50 (see the engine tests); if one ever got here it fails loudly.
    expect(() => settleSpot('banker', 150, outcome('banker'))).toThrow();
  });

  it('commission is only taken from winning Banker bets', () => {
    for (const spot of SPOTS) {
      for (const w of winners) {
        const r = settleSpot(spot, 10_000, outcome(w, true, true));
        expect(r.commission).toBe(spot === 'banker' && w === 'banker' ? 500 : 0);
      }
    }
  });

  it('pair bets pay 11 to 1 whoever wins the coup, and lose without a pair', () => {
    for (const w of winners) {
      expect(settleSpot('playerPair', 500, outcome(w, true, false)).returned).toBe(6_000);
      expect(settleSpot('bankerPair', 500, outcome(w, true, false)).returned).toBe(0);
      expect(settleSpot('bankerPair', 500, outcome(w, false, true)).returned).toBe(6_000);
      expect(settleSpot('playerPair', 500, outcome(w, false, true)).returned).toBe(0);
    }
  });

  it('settles a whole seat: every spot, the total wagered, returned and commission', () => {
    const r = settleBets({ banker: 10_000, tie: 1_000, playerPair: 500, bankerPair: 500 }, outcome('banker', false, true));
    expect(r.wagered).toBe(12_000);
    expect(r.returned).toBe(19_500 + 6_000);
    expect(r.commission).toBe(500);
    expect(r.spots.tie?.outcome).toBe('lose');
    expect(r.spots.player).toBeUndefined();
  });
});

describe('baccarat seats', () => {
  it('numbers seats 1-7, the first player in the middle and the rest filling outwards', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(seatNumber)).toEqual([4, 3, 5, 2, 6, 1, 7]);
    expect(new Set([0, 1, 2, 3, 4, 5, 6].map(seatNumber)).size).toBe(7);
  });
});
