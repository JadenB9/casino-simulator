import { describe, it, expect } from 'vitest';
import { meterText, segText } from '../src/games/slots/segments.ts';

describe('slots meters', () => {
  it('show dollars and cents when they fit', () => {
    expect(segText(29_925, 6)).toEqual({ text: '!299.25', ghost: '8888.88' });
    expect(segText(999_999, 6)).toEqual({ text: '9999.99', ghost: '8888.88' });
    expect(segText(300_000_000, 9)).toEqual({ text: '3000000.00', ghost: '8888888.88' });
  });
  it('drop the cents for a high-limit amount rather than show the wrong digits', () => {
    // a $30,000 bet on the 6-place BET meter, a $50,000 one, a win of $12 million on WIN
    expect(segText(3_000_000, 6)).toEqual({ text: '!30000', ghost: '888888' });
    expect(segText(5_000_000, 6)).toEqual({ text: '!50000', ghost: '888888' });
    expect(segText(1_200_000_000, 9)).toEqual({ text: '!12000000', ghost: '888888888' });
  });
  it('show every digit of an amount too big even for whole dollars', () => {
    // a $30 million top award at three $10,000 coins on a 7-place WIN meter
    expect(segText(3_000_000_000, 7)).toEqual({ text: '30000000', ghost: '88888888' });
  });

  it('take as many places as fit the window, and shrink only what fits no other way', () => {
    // DSEG7 at 58px: an 8 is 46px wide, the point 12px (the font's own proportions, near enough)
    let font = '';
    const g = {
      set font(f: string) {
        font = f;
      },
      get font() {
        return font;
      },
      measureText: (t: string) => ({ width: (Number(/(\d+)px/.exec(font)![1]) / 58) * [...t].reduce((w, c) => w + (c === '.' ? 12 : 46), 0) }),
    } as unknown as CanvasRenderingContext2D;
    // the CREDIT window (392px less padding): seven places
    expect(meterText(g, 29_925, 368)).toEqual({ text: '!!299.25', ghost: '88888.88' });
    expect(font).toBe('700 58px DSEG7, monospace');
    expect(meterText(g, 300_000_000, 368)).toEqual({ text: '3000000', ghost: '8888888' });
    expect(font).toBe('700 58px DSEG7, monospace');
    expect(meterText(g, 3_000_000_000, 312).text).toBe('30000000');
    expect(Number(/(\d+)px/.exec(font)![1])).toBeLessThan(58);
  });
});
