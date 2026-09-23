// The stickman's calls: what gets said on each roll, from the dice and the puck before the roll.
// Presentation only, but shared so the wording can be tested next to the rules it describes.

import type { PointNumber } from './rules.ts';

const WORDS: Record<number, string> = {
  2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 11: 'eleven', 12: 'twelve',
};

export function numberWord(n: number): string {
  return WORDS[n] ?? String(n);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The call for a roll of (d1, d2) with the puck at `point` (null: a come-out roll). */
export function stickCall(point: PointNumber | null, d1: number, d2: number): string {
  const t = d1 + d2;
  const word = numberWord(t);
  const hard = d1 === d2 && (t === 4 || t === 6 || t === 8 || t === 10);
  if (point === null) {
    if (t === 7) return 'Seven, winner. Pay the line, take the don\'ts';
    if (t === 11) return 'Yo-leven, front line winner';
    if (t === 2) return 'Two craps, aces. Line away';
    if (t === 3) return 'Three craps, ace-deuce. Line away';
    if (t === 12) return 'Twelve craps. Bar the twelve';
    return `The point is ${word.toUpperCase()}${hard ? ', the hard way' : ''}`;
  }
  if (t === 7) return 'Seven out, line away. Pay the don\'ts';
  if (t === point) return `${cap(word)}${hard ? ' the hard way' : ''}, winner. Pay the line`;
  switch (t) {
    case 2:
      return 'Aces, two craps. Field pays double';
    case 3:
      return 'Three craps, ace-deuce';
    case 5:
      return 'Five, no field five';
    case 9:
      return 'Nine, center field nine';
    case 11:
      return 'Yo-leven';
    case 12:
      return 'Twelve craps, boxcars. Field pays triple';
    default:
      return hard ? `Hard ${word}` : `${cap(word)}, easy ${word}`;
  }
}
