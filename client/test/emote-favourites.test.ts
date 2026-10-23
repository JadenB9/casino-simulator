// The emotes kept per browser (ui/social/favourites.ts): the starred ones the chat box offers, the
// last one made (Space on the wheel), and the one send limit the wheel and the chat share.

import { describe, expect, it } from 'vitest';
import { EmoteGate, FAV_DEFAULT, FAV_MAX, favourites, lastEmote, noteEmote, onFavourites, toggleFavourite } from '../src/ui/social/favourites.ts';
import { FREE_EMOTES } from '../../shared/src/protocol.ts';

function memory(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('favourite emotes', () => {
  it('are the first four free ones until you star any', () => {
    expect(favourites(memory())).toEqual([...FREE_EMOTES.slice(0, 4)]);
    expect(FAV_DEFAULT).toEqual(FREE_EMOTES.slice(0, 4));
    expect(favourites(null)).toEqual([...FAV_DEFAULT]);
  });

  it('star and unstar, in the order starred, the oldest going past the limit', () => {
    const s = memory();
    let heard = 0;
    const off = onFavourites(() => heard++);
    expect(toggleFavourite('clap', s)).toBe(false); // one of the defaults: unstarred
    expect(favourites(s)).toEqual(['wave', 'cheer', 'thumbs']);
    expect(toggleFavourite('griddy', s)).toBe(true);
    expect(favourites(s)).toEqual(['wave', 'cheer', 'thumbs', 'griddy']);
    for (const e of ['shrug', 'sixseven', 'floss'] as const) toggleFavourite(e, s);
    expect(favourites(s)).toHaveLength(FAV_MAX);
    expect(favourites(s)[0]).toBe('cheer');
    expect(heard).toBe(5);
    off();
  });

  it('keep only real emotes, whatever was stored', () => {
    const s = memory();
    s.setItem('casino.emotes.favs', JSON.stringify(['wave', 'nope', 7, 'wave', 'bow']));
    expect(favourites(s)).toEqual(['wave', 'bow']);
    s.setItem('casino.emotes.favs', '{broken');
    expect(favourites(s)).toEqual([...FAV_DEFAULT]);
  });
});

describe('the last emote', () => {
  it('is remembered, and only a real one', () => {
    const s = memory();
    expect(lastEmote(s)).toBeNull();
    noteEmote('backflip', s);
    expect(lastEmote(s)).toBe('backflip');
    s.setItem('casino.emotes.last', 'moonwalk-ish');
    expect(lastEmote(s)).toBeNull();
  });
});

describe('the emote send limit', () => {
  it('lets three through at once, then one about every two seconds', () => {
    const gate = new EmoteGate(0);
    expect([gate.take(0), gate.take(0), gate.take(0), gate.take(0)]).toEqual([true, true, true, false]);
    expect(gate.take(2000)).toBe(false); // 0.9 of a token back: the server's 1.0 with room to spare
    expect(gate.take(2300)).toBe(true);
    expect(gate.take(60_000) && gate.take(60_000) && gate.take(60_000)).toBe(true);
    expect(gate.take(60_000)).toBe(false);
  });
});
