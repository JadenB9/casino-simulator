import { describe, it, expect } from 'vitest';
import { stack, DOCK_GAP, type Box, type Piece } from '../src/table/dock.ts';

// The bottom of a table's screen (table/dock.ts): the panels that go with the bar stack above it,
// never on it or on each other, at any size. Screen px, y down.

const overlap = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

describe('the dock stacks the panels over the bar', () => {
  // a laptop: the tray centred along the bottom
  const bar: Box = { left: 164, top: 710, right: 1115, bottom: 782 };

  it('puts the hands picker over the bar’s left end and the tip panel over its right end', () => {
    const [picker, tip] = stack(bar, [{ at: 'start', w: 227, h: 37 }, { at: 'end', w: 237, h: 40 }], [bar], 1280);
    expect(picker).toEqual({ left: 164, right: 391, bottom: 710 - DOCK_GAP, top: 710 - DOCK_GAP - 37 });
    expect(tip).toEqual({ left: 1115 - 237, right: 1115, bottom: 710 - DOCK_GAP, top: 710 - DOCK_GAP - 40 });
  });

  it('a phone: two panels that can’t share the row go one over the other', () => {
    const phone: Box = { left: 6, top: 676, right: 384, bottom: 790 };
    const boxes = stack(phone, [{ at: 'start', w: 227, h: 37 }, { at: 'end', w: 226, h: 40 }], [phone], 390);
    expect(overlap(boxes[0]!, boxes[1]!)).toBe(false);
    for (const b of boxes) {
      expect(overlap(b, phone)).toBe(false);
      expect(b.left).toBeGreaterThanOrEqual(8);
      expect(b.right).toBeLessThanOrEqual(382);
    }
    expect(boxes[1]!.bottom).toBe(boxes[0]!.top - DOCK_GAP);
  });

  it('a panel over an end slides along the bar past a game’s own panel before it rises', () => {
    // the meters stand over the tray's right end
    const meters: Box = { left: 1000, top: 652, right: 1262, bottom: 704 };
    const [tip] = stack(bar, [{ at: 'end', w: 237, h: 40 }], [bar, meters], 1280);
    expect(overlap(tip!, meters)).toBe(false);
    expect(tip!.right).toBe(1000 - DOCK_GAP);
    expect(tip!.bottom).toBe(710 - DOCK_GAP);
  });

  it('rises when there’s no room left along the bar', () => {
    const narrow: Box = { left: 500, top: 710, right: 780, bottom: 782 };
    const wide: Box = { left: 400, top: 650, right: 900, bottom: 704 };
    const [tip] = stack(narrow, [{ at: 'end', w: 237, h: 40 }], [narrow, wide], 1280);
    expect(overlap(tip!, wide)).toBe(false);
    expect(tip!.bottom).toBe(650 - DOCK_GAP);
  });

  it('keeps a stylesheet-placed panel where it is across, and only ever raises it', () => {
    // the Tips line centred over the bar: just over it, above the picker it would meet
    const pieces: Piece[] = [{ at: 'start', w: 600, h: 37 }, { at: 'css', w: 560, h: 34, left: 360, floor: 696 }];
    const [picker, line] = stack(bar, pieces, [bar], 1280);
    expect(line!.left).toBe(360);
    expect(line!.bottom).toBe(picker!.top - DOCK_GAP);
    // clear of the bar across (Hold'em's tips line left of its bar on a phone on its side), it
    // stays as low as its stylesheet has it, never under the bar's bottom
    const side: Box = { left: 504, top: 120, right: 834, bottom: 382 };
    const [beside] = stack(side, [{ at: 'css', w: 480, h: 30, left: 12, floor: 330 }], [side], 844);
    expect(beside!.bottom).toBe(330);
    const [low] = stack(side, [{ at: 'css', w: 480, h: 30, left: 12, floor: 500 }], [side], 844);
    expect(low!.bottom).toBe(382);
  });

  it('never runs a panel off the screen', () => {
    const left: Box = { left: -20, top: 324, right: 834, bottom: 382 };
    const [picker] = stack(left, [{ at: 'start', w: 230, h: 46 }], [left], 844);
    expect(picker!.left).toBe(8);
    const [wide] = stack(bar, [{ at: 'end', w: 2000, h: 40 }], [bar], 1280);
    expect(wide!.left).toBe(8);
    expect(wide!.right).toBe(1272);
  });
});
