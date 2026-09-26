import { describe, expect, it } from 'vitest';
import { separate, type Tower } from '../src/world/city/sky.ts';

const overlaps = (a: Tower, b: Tower) =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2 && Math.min((a.y0 ?? 0) + a.h, (b.y0 ?? 0) + b.h) > Math.max(a.y0 ?? 0, b.y0 ?? 0);

describe('towers never stand in each other', () => {
  it('pulls overlapping towers apart or drops slivers', () => {
    const list: Tower[] = [];
    let s = 7;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 200; i++) list.push({ x: r() * 200, z: r() * 200, w: 8 + r() * 20, d: 8 + r() * 20, h: 20 + r() * 80 });
    const out = separate(list);
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(overlaps(out[i]!, out[j]!)).toBe(false);
    expect(out.length).toBeGreaterThan(20);
  });
  it('keeps towers that only stack at different heights', () => {
    const out = separate([{ x: 0, z: 0, w: 10, d: 10, h: 10 }, { x: 0, z: 0, w: 10, d: 10, h: 10, y0: 20 }]);
    expect(out.length).toBe(2);
  });
});
