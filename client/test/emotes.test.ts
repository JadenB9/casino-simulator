// The emote wheel's keys and layout: 1 to 6 pick the free gestures in order (so a new one never
// moves their keys), Q to P the outer ring's ten by key position, anything else nothing; six
// buttons round the hub and ten round the outside, evenly, the first of each at the top; and
// what's locked is what you neither have for free nor own.

import { describe, it, expect } from 'vitest';
import { EMOTES, FREE_EMOTES, REWARD_EMOTES, SHOP_EMOTES } from '../../shared/src/protocol.ts';
import { emoteForKey, hasEmote, keyOf, lockedEmotes, lockedLabel, WHEEL_EMOTES, wheelLayout, wheelSpot } from '../src/ui/social/emotes.ts';
import { EMOTE_LABELS } from '../src/ui/social/icons.ts';

describe('emote wheel', () => {
  it('number keys pick the free gestures in order, 67 on 6', () => {
    expect(FREE_EMOTES.map((_, i) => emoteForKey(String(i + 1)))).toEqual([...FREE_EMOTES]);
    expect(emoteForKey('1')).toBe('wave');
    expect(emoteForKey('3')).toBe('clap');
    expect(emoteForKey('6')).toBe('sixseven');
    for (const k of ['0', '7', '9', '12', '-1', '1.5', 'g', 'a', 'Enter', ' ', '']) expect(emoteForKey(k)).toBeNull();
  });

  it('the top row of letters picks the outer ring, by key position', () => {
    const outer = [...SHOP_EMOTES.slice(0, 8), ...REWARD_EMOTES];
    expect([...'QWERTYUIOP'].map((l) => emoteForKey(l.toLowerCase(), `Key${l}`))).toEqual(outer);
    // v7.4: the Twerk, after the rewards, on the key after P
    expect(emoteForKey('[', 'BracketLeft')).toBe('twerk');
    expect(emoteForKey('q')).toBe('throwback');
    expect(emoteForKey('W')).toBe('griddy');
    expect(emoteForKey('p')).toBe('moonwalk');
    // the physical key wins over the letter it types (an AZERTY board's A is where Q is)
    expect(emoteForKey('a', 'KeyQ')).toBe('throwback');
    expect(emoteForKey('q', 'KeyA')).toBeNull();
    // G closes the wheel, and walking keys other than W mean nothing to it
    for (const [k, c] of [['g', 'KeyG'], ['s', 'KeyS'], ['d', 'KeyD']]) expect(emoteForKey(k!, c)).toBeNull();
    for (const e of EMOTES) expect(emoteForKey(keyOf(e).toLowerCase(), /\d/.test(keyOf(e)) ? '' : keyOf(e) === '[' ? 'BracketLeft' : `Key${keyOf(e)}`)).toBe(e);
  });

  it('shows every emote once, the free six inside and the eleven others outside', () => {
    expect([...WHEEL_EMOTES].sort()).toEqual([...EMOTES].sort());
    const layout = wheelLayout();
    expect(layout).toHaveLength(17);
    expect(layout.filter((b) => b.ring === 0).map((b) => b.e)).toEqual([...FREE_EMOTES]);
    expect(layout.filter((b) => b.ring === 1).map((b) => b.e)).toEqual([...SHOP_EMOTES.slice(0, 8), ...REWARD_EMOTES, 'twerk']);
    for (const e of EMOTES) expect(EMOTE_LABELS[e]).toBeTruthy();
  });

  it('each ring is even and clockwise from the top, with room between buttons', () => {
    const layout = wheelLayout();
    for (const ring of [0, 1] as const) {
      const spots = layout.filter((b) => b.ring === ring);
      const r = Math.hypot(spots[0]!.x, spots[0]!.y);
      expect(spots[0]!.x).toBeCloseTo(0);
      expect(spots[0]!.y).toBeCloseTo(-r);
      // clockwise on screen (y grows downward): the second is up and to the right
      expect(spots[1]!.x).toBeGreaterThan(0);
      expect(spots[1]!.y).toBeLessThan(0);
      const gap = Math.hypot(spots[1]!.x - spots[0]!.x, spots[1]!.y - spots[0]!.y);
      // the buttons are 58 and 54 px across, with a price tab under the outer ones
      expect(gap).toBeGreaterThan(ring ? 90 : 80);
      for (const [i, s] of spots.entries()) {
        expect(Math.hypot(s.x, s.y)).toBeCloseTo(r);
        const next = spots[(i + 1) % spots.length]!;
        expect(Math.hypot(next.x - s.x, next.y - s.y)).toBeCloseTo(gap);
      }
    }
    // the rings don't touch: the inner's outer edge is well inside the outer's inner edge
    const inner = Math.hypot(layout[0]!.x, layout[0]!.y);
    const outer = Math.hypot(layout[6]!.x, layout[6]!.y);
    expect(outer - 27 - (inner + 29)).toBeGreaterThan(15);
    // (wheelSpot is the old six-button spacing, still)
    expect(Math.hypot(wheelSpot(1, 6, 84).x - wheelSpot(0, 6, 84).x, wheelSpot(1, 6, 84).y - wheelSpot(0, 6, 84).y)).toBeCloseTo(84);
  });

  it('locks what you neither have for free nor own', () => {
    const all = [...SHOP_EMOTES.slice(0, 8), ...REWARD_EMOTES, 'twerk'];
    expect(lockedEmotes(undefined)).toEqual(all);
    expect(lockedEmotes([])).toEqual(all);
    // owned lists items and emotes together; the items mean nothing here
    const owned = ['gold-chain', 'throwback', 'dab', 'moonwalk', 'skateboard'];
    expect(lockedEmotes(owned)).toEqual(['griddy', 'floss', 'robot', 'backflip', 'moneyfan', 'bow', 'trophy', 'twerk']);
    expect(lockedEmotes([...SHOP_EMOTES, ...REWARD_EMOTES])).toEqual([]);
    const have = new Set(owned);
    for (const e of FREE_EMOTES) expect(hasEmote(e, new Set())).toBe(true);
    expect(hasEmote('throwback', have)).toBe(true);
    expect(hasEmote('backflip', have)).toBe(false);
  });

  it('a locked one says its price, or what earns it', () => {
    expect(lockedLabel('throwback')).toEqual({ tag: '$150K', line: '$150,000 in the boutique', reward: false });
    expect(lockedLabel('backflip').tag).toBe('$500K');
    const trophy = lockedLabel('trophy');
    expect(trophy.reward).toBe(true);
    expect(trophy.tag).toBe('Reward');
    expect(trophy.line).toMatch(/^Earned/);
    expect(lockedLabel('moonwalk').reward).toBe(true);
  });
});
