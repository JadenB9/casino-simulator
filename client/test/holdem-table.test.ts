import { describe, it, expect } from 'vitest';
import { chairSpots, oval, slotEdge, DEALER_GAP, RR } from '../src/games/holdem/table.ts';

// Where the Hold'em view draws each seat round the felt: yours nearest the camera, and nobody in
// the dealer's place in the middle of the far side (where the tray is).

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9);

describe("Hold'em seat layout", () => {
  it('your seat is the middle of the near side at every table size', () => {
    for (const n of [6, 9]) {
      const e = slotEdge(0, n);
      close(e.x, 0);
      close(e.z, RR);
    }
  });

  it('nine seats leave the dealer their place, the way the chairs do', () => {
    // the chairs: ten places round the oval (0 to 9), place 5 (the far side's middle) skipped
    expect(chairSpots().length).toBe(9);
    for (let k = 0; k < 9; k++) {
      const e = slotEdge(k, 9);
      // well clear of the tray on the far side
      expect(e.z < 0 && Math.abs(e.x) < DEALER_GAP + 0.1).toBe(false);
      // the same ten places (on the felt's edge), the dealer's skipped
      const place = oval((k < 5 ? k : k + 1) / 10);
      close(e.x, place.x);
      close(e.z, place.z);
      // and even about the middle, so the table looks the same from both ends
      if (k > 0) {
        const m = slotEdge(9 - k, 9);
        close(e.x, -m.x);
        close(e.z, m.z);
      }
    }
  });

  it('six seats keep their places, the dealer between the two on the far side', () => {
    for (let k = 0; k < 6; k++) {
      const e = slotEdge(k, 6);
      const was = oval(k / 7);
      close(e.x, was.x);
      close(e.z, was.z);
      expect(e.z < 0 && Math.abs(e.x) < DEALER_GAP).toBe(false);
    }
  });
});
