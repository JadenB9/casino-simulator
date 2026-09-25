import { describe, it, expect } from 'vitest';
import { segText } from '../src/games/slots/segments.ts';

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
  it('fill with nines past every place', () => {
    expect(segText(100_000_000, 6)).toEqual({ text: '999999', ghost: '888888' });
  });
});
