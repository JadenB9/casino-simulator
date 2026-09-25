// The emote wheel's keys and layout: 1 to 6 pick the gestures in EMOTES order (so a new one on
// the end never moves the others' keys), anything else picks nothing, and six buttons sit round
// the hub evenly, the first at the top.

import { describe, it, expect } from 'vitest';
import { FREE_EMOTES as EMOTES } from '../../shared/src/protocol.ts';
import { emoteForKey, wheelSpot } from '../src/ui/social/emotes.ts';

describe('emote wheel', () => {
  it('number keys pick the gestures in order, 67 on 6', () => {
    expect(EMOTES.map((_, i) => emoteForKey(String(i + 1)))).toEqual([...EMOTES]);
    expect(emoteForKey('1')).toBe('wave');
    expect(emoteForKey('3')).toBe('clap');
    expect(emoteForKey('6')).toBe('sixseven');
    for (const k of ['0', '7', '9', '12', '-1', '1.5', 'g', 'Enter', ' ', '']) expect(emoteForKey(k)).toBeNull();
  });

  it('six buttons round the hub, evenly and clockwise from the top', () => {
    const n = EMOTES.length;
    const spots = EMOTES.map((_, i) => wheelSpot(i, n, 84));
    expect(spots[0]!.x).toBeCloseTo(0);
    expect(spots[0]!.y).toBeCloseTo(-84);
    // clockwise on screen (y grows downward): the second is up and to the right
    expect(spots[1]!.x).toBeGreaterThan(0);
    expect(spots[1]!.y).toBeLessThan(0);
    for (const [i, s] of spots.entries()) {
      expect(Math.hypot(s.x, s.y)).toBeCloseTo(84);
      const next = spots[(i + 1) % n]!;
      // neighbours all the same distance apart: 60 degrees on a wheel of six, room for 60 px buttons
      expect(Math.hypot(next.x - s.x, next.y - s.y)).toBeCloseTo(84);
    }
  });
});
