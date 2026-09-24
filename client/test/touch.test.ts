// The phone controls' arithmetic: what the thumb stick reads for a thumb's travel, and how far the
// view opens up on an upright screen.

import { describe, it, expect } from 'vitest';
import { stickInput } from '../src/world/touch.ts';
import { FOV, fovFor } from '../src/render/engine3d.ts';

describe('the thumb stick', () => {
  it('reads nothing at rest or inside the dead zone', () => {
    expect(stickInput(0, 0)).toEqual({ x: 0, y: 0, run: false });
    expect(stickInput(4, -4)).toEqual({ x: 0, y: 0, run: false });
    expect(stickInput(NaN, 3)).toEqual({ x: 0, y: 0, run: false });
  });

  it('walks forward when pushed up to the rim, and the screen y axis points down', () => {
    const up = stickInput(0, -46);
    expect(up.x).toBeCloseTo(0, 9);
    expect(up.y).toBeCloseTo(1, 9);
    expect(up.run).toBe(false);
    expect(stickInput(0, 46).y).toBeCloseTo(-1, 9);
    expect(stickInput(46, 0).x).toBeCloseTo(1, 9);
    expect(stickInput(-46, 0).x).toBeCloseTo(-1, 9);
  });

  it('creeps in between: the pace climbs from the dead zone to the rim', () => {
    // half the travel is (0.5 - 0.14) / 0.86 of a walk
    expect(stickInput(0, -23).y).toBeCloseTo((0.5 - 0.14) / 0.86, 9);
    const paces = [8, 15, 25, 35, 46].map((d) => stickInput(0, -d).y);
    for (let i = 1; i < paces.length; i++) expect(paces[i]).toBeGreaterThan(paces[i - 1]!);
  });

  it('keeps the direction of a diagonal push', () => {
    const m = stickInput(30, -30);
    // up and to the right: forward and right in equal parts
    expect(m.x).toBeGreaterThan(0);
    expect(m.x).toBeCloseTo(m.y, 9);
    expect(Math.hypot(m.x, m.y)).toBeCloseTo((Math.hypot(30, 30) / 46 - 0.14) / 0.86, 9);
  });

  it('holds a walk just past the rim and runs once the thumb is well past it', () => {
    const past = stickInput(0, -55);
    expect(past.y).toBeCloseTo(1, 9);
    expect(past.run).toBe(false);
    const far = stickInput(0, -70);
    expect(far.y).toBeCloseTo(1, 9);
    expect(far.run).toBe(true);
  });
});

describe('the field of view', () => {
  it('stays at the landscape angle on a wide or square screen', () => {
    expect(fovFor(16 / 9)).toBe(FOV);
    expect(fovFor(844 / 390)).toBe(FOV);
    expect(fovFor(1)).toBe(FOV);
    expect(fovFor(0)).toBe(FOV);
    expect(fovFor(NaN)).toBe(FOV);
  });

  it('opens up on an upright phone: about 75 degrees tall and 39 across at 390 x 844', () => {
    const aspect = 390 / 844;
    const v = fovFor(aspect);
    expect(v).toBeCloseTo(74.9, 1);
    const across = 2 * Math.atan(Math.tan(((v / 2) * Math.PI) / 180) * aspect) * (180 / Math.PI);
    expect(across).toBeCloseTo(39, 0);
  });

  it('widens steadily as the screen narrows', () => {
    const vs = [0.9, 0.75, 0.6, 0.46, 0.4].map(fovFor);
    for (let i = 1; i < vs.length; i++) expect(vs[i]).toBeGreaterThan(vs[i - 1]!);
    expect(vs[0]).toBeGreaterThan(FOV);
  });
});
