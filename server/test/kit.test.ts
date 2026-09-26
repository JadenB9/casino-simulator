import { describe, expect, it } from 'vitest';
import { kitOf } from '../src/floor/index.ts';

describe("the floor's kit header", () => {
  it('keeps only known guns and cars and a step 0-3', () => {
    expect(kitOf('guns=compact-9,nope;cars=spectre-ev,fake;home=2')).toEqual({ guns: ['compact-9'], cars: ['spectre-ev'], home: 2, homes: [] });
    expect(kitOf(null)).toEqual({ guns: [], cars: [], home: 0, homes: [] });
    expect(kitOf('home=99').home).toBe(3);
  });
});
