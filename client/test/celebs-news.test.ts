import { describe, it, expect } from 'vitest';
import { sightingTitle } from '../src/world/celebs/news.ts';
import { planFloor } from '../src/world/layout.ts';
import { GAMES } from '../src/games/index.ts';

// The notice when a celebrity is already out on the floor names the room they're in, with one
// "the" in front of it whatever the room calls itself ("The Pit").

describe('sightingTitle', () => {
  it('says who just walked in', () => {
    expect(sightingTitle('Seraphina Vale', 'Lobby', true)).toBe('Seraphina Vale just walked in through the lobby');
  });

  it('names the room with one article', () => {
    expect(sightingTitle('Silas Quill', 'The Pit', false)).toBe('Silas Quill is on the floor, in the Pit');
    expect(sightingTitle('Silas Quill', 'Slots Hall', false)).toBe('Silas Quill is on the floor, in the Slots Hall');
    expect(sightingTitle('Silas Quill', null, false)).toBe('Silas Quill is on the floor');
  });

  it('never doubles "the" for any room on the floor', () => {
    for (const r of planFloor((g) => GAMES[g].footprint, undefined, { seats: (g, v) => GAMES[g].seats(v) }).rooms) expect(sightingTitle('X', r.name, false)).not.toMatch(/the the/i);
  });
});
