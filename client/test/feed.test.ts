// The LED sign's font and tape, and how a big win reads on the sign and in a toast.

import { describe, it, expect } from 'vitest';
import { TAPE_ROWS, centred, layoutTape, ledText, textWidth } from '../src/world/ledfont.ts';
import { detail, toastLines, wholeDollars, winsCount } from '../src/ui/feed/lines.ts';
import type { BigWin } from '../../shared/src/protocol.ts';

/** The tape as rows of '#' and '.', for eyeballing a glyph. */
function rows(text: string): string[] {
  const t = layoutTape([{ text, color: [1, 1, 1] }]);
  const out: string[] = [];
  for (let y = 0; y < t.height; y++) {
    let line = '';
    for (let x = 0; x < t.width; x++) line += t.data[(y * t.width + x) * 4]! > 0 ? '#' : '.';
    out.push(line);
  }
  return out;
}

describe('the LED font', () => {
  it('draws a 5x7 letter between a blank row above and below', () => {
    expect(rows('A')).toEqual(['.....', '.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#', '.....']);
    expect(TAPE_ROWS).toBe(9);
  });

  it('trims narrow glyphs to their ink but keeps digits five wide so amounts line up', () => {
    expect(textWidth('I')).toBe(3);
    expect(textWidth('1')).toBe(5);
    expect(textWidth('.')).toBe(2);
    expect(textWidth('$')).toBe(5);
    // one blank column between letters, three for a space, none after the last
    expect(textWidth('AB')).toBe(11);
    expect(textWidth('A B')).toBe(5 + 1 + 3 + 1 + 5);
    expect(textWidth('')).toBe(0);
  });

  it('shows upper case and turns anything without a glyph into a space', () => {
    expect(ledText('jaden_b won $12,500!')).toBe('JADEN_B WON $12,500!');
    expect(ledText('Café 👑 ok')).toBe('CAF    OK');
    expect(textWidth('é')).toBe(textWidth(' '));
  });

  it('lays runs out after a lead, in their own colours, and pads to a minimum width', () => {
    const t = layoutTape(
      [
        { text: 'I', color: [1, 0, 0] },
        { text: 'I', color: [0, 0, 1] },
      ],
      { lead: 4, minWidth: 30 },
    );
    expect(t.width).toBe(30);
    // the first I's top bar starts at the lead; the second follows one blank column later
    const px = (x: number, y: number) => Array.from(t.data.slice((y * t.width + x) * 4, (y * t.width + x) * 4 + 4));
    expect(px(4, 1)).toEqual([255, 0, 0, 255]);
    expect(px(8, 1)).toEqual([0, 0, 255, 255]);
    // unlit LEDs are opaque black
    expect(px(0, 0)).toEqual([0, 0, 0, 255]);
    expect(px(29, 8)).toEqual([0, 0, 0, 255]);
  });

  it('never grows past its maximum width, and centres text on a sign', () => {
    expect(layoutTape([{ text: 'X'.repeat(2000), color: [1, 1, 1] }], { maxWidth: 4096 }).width).toBe(4096);
    expect(centred(20, 100)).toBe(40);
    expect(centred(120, 100)).toBe(0);
  });
});

describe('how a big win reads', () => {
  const win = (over: Partial<BigWin>): BigWin => ({ name: 'mara_v', game: 'roulette', amount: 350_000, what: 'Straight 17', at: 0, ...over });

  it('money in whole dollars, as a sign shows it', () => {
    expect(wholeDollars(350_000)).toBe('$3,500');
    expect(wholeDollars(1_234_599)).toBe('$12,345');
    expect(wholeDollars(-5)).toBe('$0');
  });

  it('the game and what paid; a slot win leads with its machine', () => {
    expect(detail(win({}))).toBe('Roulette, Straight 17');
    expect(detail(win({ game: 'videopoker', what: 'Royal Flush' }))).toBe('Video Poker, Royal Flush');
    expect(detail(win({ game: 'slots', what: 'Neon Nights, 250x' }))).toBe('Neon Nights, 250x');
    // nothing more to say than the game's name
    expect(detail(win({ game: 'war', what: 'Casino War' }))).toBe('Casino War');
    expect(detail(win({ game: 'blackjack', what: '' }))).toBe('Blackjack');
  });

  it('a toast has the name and amount over what paid', () => {
    expect(toastLines(win({}))).toEqual({ title: 'mara_v won $3,500', sub: 'Roulette, Straight 17' });
    expect(winsCount(1)).toBe('1 big win');
    expect(winsCount(12)).toBe('12 big wins');
  });
});
