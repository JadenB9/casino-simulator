import { describe, it, expect } from 'vitest';
import type { Card } from '../src/cards.ts';
import { basicStrategy, HARD_CHART, SOFT_CHART, PAIR_CHART } from '../src/games/blackjack/strategy.ts';
import type { Move } from '../src/games/blackjack/rules.ts';

// The chart exactly as printed in docs/rules/table-games.md §1.4 ("Code-ready form"), copied
// here separately from the engine's copy so a typo in either one fails this test.
const DOC = `
HARD   5-8 HHHHHHHHHH    SOFT  A2 HHHDDHHHHH    PAIRS  AA YYYYYYYYYY
       9   HDDDDHHHHH          A3 HHHDDHHHHH           TT NNNNNNNNNN
       10  DDDDDDDDHH          A4 HHDDDHHHHH           99 YYYYYNYYNN
       11  DDDDDDDDDH          A5 HHDDDHHHHH           88 YYYYYYYYYY
       12  HHSSSHHHHH          A6 HDDDDHHHHH           77 YYYYYYNNNN
       13  SSSSSHHHHH          A7 SBBBBSSHHH           66 YYYYYNNNNN
       14  SSSSSHHHHH          A8 SSSSSSSSSS           55 NNNNNNNNNN
       15  SSSSSHHHRH          A9 SSSSSSSSSS           44 NNNYYNNNNN
       16  SSSSSHHRRR                                  33 YYYYYYNNNN
       17+ SSSSSSSSSS                                  22 YYYYYYNNNN
`;

function parseDoc(): { hard: Map<string, string>; soft: Map<string, string>; pairs: Map<string, string> } {
  const hard = new Map<string, string>();
  const soft = new Map<string, string>();
  const pairs = new Map<string, string>();
  // Three blocks side by side: hard in columns 0-24, soft in 25-47, pairs from 48.
  for (const line of DOC.split('\n')) {
    const blocks: [Map<string, string>, string][] = [
      [hard, line.slice(0, 25)],
      [soft, line.slice(25, 48)],
      [pairs, line.slice(48)],
    ];
    for (const [table, text] of blocks) {
      const cells = text.replace(/HARD|SOFT|PAIRS/, '').trim().split(/\s+/).filter(Boolean);
      if (cells.length === 2) table.set(cells[0]!, cells[1]!);
    }
  }
  return { hard, soft, pairs };
}

const doc = parseDoc();
// Dealer up cards per column (2 3 4 5 6 7 8 9 T A); every ten-value rank is tried in the T column.
const UPS: Card[][] = [['2c'], ['3c'], ['4c'], ['5c'], ['6c'], ['7c'], ['8c'], ['9c'], ['Tc', 'Jc', 'Qc', 'Kc'], ['Ac']];
const ALL = { double: true, split: true, surrender: true };

function expected(code: string, can: { double: boolean; surrender: boolean }): Move {
  switch (code) {
    case 'H':
      return 'hit';
    case 'S':
      return 'stand';
    case 'D':
      return can.double ? 'double' : 'hit';
    case 'B':
      return can.double ? 'double' : 'stand';
    case 'R':
      return can.surrender ? 'surrender' : 'hit';
    default:
      throw new Error(`unknown chart code ${code}`);
  }
}

const cards = (s: string): Card[] => s.split(' ') as Card[];

// Two-card (and a few multi-card) hands for every hard row, none of them a pair.
const HARD_HANDS: Record<string, string[]> = {
  '5-8': ['2d 3h', '2d 4h', '2d 5h', '3d 4h', '2d 6h', '3d 5h'],
  '9': ['2d 7h', '3d 6h', '4d 5h'],
  '10': ['2d 8h', '3d 7h', '4d 6h'],
  '11': ['2d 9h', '3d 8h', '4d 7h', '5d 6h'],
  '12': ['2d Th', '3d 9h', '4d 8h', '5d 7h', '2d Kh'],
  '13': ['3d Th', '4d 9h', '5d 8h', '6d 7h'],
  '14': ['4d Th', '5d 9h', '6d 8h', '4d Qh'],
  '15': ['5d Th', '6d 9h', '7d 8h', '5d Jh'],
  '16': ['6d Th', '7d 9h', '6d Kh'],
  '17+': ['7d Th', '8d 9h', '8d Th', '9d Th', '7d Kh'],
};

describe('blackjack basic strategy: every cell of the chart (docs/rules/table-games.md §1.4)', () => {
  it("the engine's chart is the document's chart, row for row", () => {
    expect(new Map(HARD_CHART)).toEqual(doc.hard);
    expect(new Map(SOFT_CHART)).toEqual(doc.soft);
    expect(new Map(PAIR_CHART)).toEqual(doc.pairs);
    expect(doc.hard.size).toBe(10);
    expect(doc.soft.size).toBe(8);
    expect(doc.pairs.size).toBe(10);
  });

  for (const [row, codes] of doc.hard) {
    it(`hard ${row}: all ten up cards, with and without double and surrender`, () => {
      for (const hand of HARD_HANDS[row]!) {
        UPS.forEach((ups, col) => {
          for (const up of ups) {
            const code = codes[col]!;
            const where = `hard ${row} (${hand}) vs ${up}`;
            expect(basicStrategy(cards(hand), up, ALL), where).toBe(expected(code, ALL));
            const noDouble = { double: false, split: true, surrender: true };
            expect(basicStrategy(cards(hand), up, noDouble), `${where}, no double`).toBe(expected(code, noDouble));
            const noSurrender = { double: true, split: true, surrender: false };
            expect(basicStrategy(cards(hand), up, noSurrender), `${where}, no surrender`).toBe(expected(code, noSurrender));
          }
        });
      }
    });
  }

  for (const [row, codes] of doc.soft) {
    it(`soft ${row}: all ten up cards, and the stand/hit fallbacks when doubling isn't allowed`, () => {
      const hand = cards(`As ${row[1]}d`);
      UPS.forEach((ups, col) => {
        for (const up of ups) {
          const code = codes[col]!;
          expect(basicStrategy(hand, up, ALL), `soft ${row} vs ${up}`).toBe(expected(code, ALL));
          const noDouble = { double: false, split: true, surrender: true };
          expect(basicStrategy(hand, up, noDouble), `soft ${row} vs ${up}, no double`).toBe(expected(code, noDouble));
        }
      });
    });
  }

  it('multi-card soft hands use the row for their soft total (A-2-4 is soft 17, A-A-5 is soft 17)', () => {
    const a6 = doc.soft.get('A6')!;
    UPS.forEach((ups, col) => {
      for (const hand of ['As 2d 4h', 'As Ad 5h', '2d As 4h']) {
        // More than two cards: a D falls back to hit, a B to stand.
        const can = { double: false, split: false, surrender: false };
        expect(basicStrategy(cards(hand), ups[0]!, can), `${hand} vs ${ups[0]}`).toBe(expected(a6[col]!, can));
      }
    });
  });

  for (const [row, codes] of doc.pairs) {
    it(`pair ${row}: split or play the total, against all ten up cards`, () => {
      const rank = row[0] === 'T' ? ['T', 'K', 'Q', 'J'] : [row[0]!];
      const hands = rank.length > 1 ? ['Ts Kd', 'Kd Qh', 'Js Th'] : [`${rank[0]}s ${rank[0]}d`];
      UPS.forEach((ups, col) => {
        for (const up of ups) {
          for (const hand of hands) {
            const got = basicStrategy(cards(hand), up, ALL);
            if (codes[col] === 'Y') {
              expect(got, `${hand} vs ${up}`).toBe('split');
            } else {
              // N: the hand plays as its total. 5-5 is hard 10, 4-4 hard 8, T-T hard 20.
              expect(got, `${hand} vs ${up}`).not.toBe('split');
              expect(got, `${hand} vs ${up}`).toBe(basicStrategy(cards(hand), up, { double: true, split: false, surrender: true }));
            }
          }
        }
      });
    });
  }

  it('a pair that can no longer be split plays as its total: 8-8 at four hands is hard 16, hit (no surrender after a split)', () => {
    const can = { double: true, split: false, surrender: false };
    for (const up of ['9c', 'Tc', 'Ac'] as Card[]) expect(basicStrategy(cards('8s 8d'), up, can)).toBe('hit');
    for (const up of ['2c', '6c'] as Card[]) expect(basicStrategy(cards('8s 8d'), up, can)).toBe('stand');
    // A-A that can't be split is a soft 12: always hit.
    expect(basicStrategy(cards('As Ad'), '6c', { double: true, split: false, surrender: false })).toBe('hit');
  });

  it('surrender only where the chart says Rh: hard 16 (not 8-8) vs 9, T, A and hard 15 vs T', () => {
    const surrenders: string[] = [];
    for (const [row, codes] of doc.hard) {
      [...codes].forEach((c, col) => {
        if (c === 'R') surrenders.push(`${row} vs ${'23456789TA'[col]}`);
      });
    }
    expect(surrenders).toEqual(['15 vs T', '16 vs 9', '16 vs T', '16 vs A']);
    expect(basicStrategy(cards('8s 8d'), 'Tc', ALL)).toBe('split');
    expect(basicStrategy(cards('9s 7d'), 'Tc', ALL)).toBe('surrender');
  });
});
