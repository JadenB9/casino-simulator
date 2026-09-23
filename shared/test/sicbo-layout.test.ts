import { describe, it, expect } from 'vitest';
import { spots, spotName } from '../src/games/sicbo/rules.ts';
import { areas, areaOf, anchorOf, spotAt, LW, X0, ZA, ZB, ZC, ZD, ZE, type Rect } from '../../client/src/games/sicbo/layout.ts';

// The client's printed layout and its click zones, checked against the server's spot table: every
// bet has one box, the boxes tile the layout without overlapping, and a chip put down on a bet's
// spot sits inside that bet's box and clicks back to it.

/** The table's chips, drawn a little larger than life on this layout (sicbo/chips.ts). */
const CHIP_RADIUS = 0.0197 * 1.2;

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2)) *
  Math.max(0, Math.min(a.z + a.d / 2, b.z + b.d / 2) - Math.max(a.z - a.d / 2, b.z - b.d / 2));

describe('sic bo layout geometry', () => {
  it('has exactly one box for every bet the server settles', () => {
    expect([...areas().keys()].sort()).toEqual([...spots().keys()].sort());
  });

  it('tiles the layout with boxes that never overlap', () => {
    const list = [...areas().values()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) expect(overlap(list[i]!.rect, list[j]!.rect), `${list[i]!.key} / ${list[j]!.key}`).toBeLessThan(1e-12);
    }
    const covered = list.reduce((n, a) => n + a.rect.w * a.rect.d, 0);
    expect(covered).toBeCloseTo(LW * (ZE - ZA), 9);
    for (const a of list) {
      expect(a.rect.x - a.rect.w / 2).toBeGreaterThanOrEqual(X0 - 1e-9);
      expect(a.rect.x + a.rect.w / 2).toBeLessThanOrEqual(X0 + LW + 1e-9);
      expect(a.rect.z - a.rect.d / 2).toBeGreaterThanOrEqual(ZA - 1e-9);
      expect(a.rect.z + a.rect.d / 2).toBeLessThanOrEqual(ZE + 1e-9);
    }
  });

  it('puts every chip inside its own box, where a click lands on that bet', () => {
    for (const spot of spots().values()) {
      const a = areaOf(spot.key)!;
      const [x, z] = anchorOf(spot.key)!;
      expect(spotAt(x, z), spotName(spot)).toBe(spot.key);
      const r = a.rect;
      expect(Math.min(x - (r.x - r.w / 2), r.x + r.w / 2 - x, z - (r.z - r.d / 2), r.z + r.d / 2 - z), spot.key).toBeGreaterThanOrEqual(CHIP_RADIUS);
    }
  });

  it('clicks every point of a box back to its bet, and nothing off the layout', () => {
    for (const a of areas().values()) {
      const r = a.rect;
      for (const [fx, fz] of [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]] as const) {
        const x = r.x - r.w / 2 + fx * r.w;
        const z = r.z - r.d / 2 + fz * r.d;
        expect(spotAt(x, z), a.key).toBe(a.key);
      }
    }
    expect(spotAt(X0 - 0.01, 0)).toBeNull();
    expect(spotAt(0, ZA - 0.01)).toBeNull();
    expect(spotAt(0, ZE + 0.01)).toBeNull();
    expect(spotAt(-X0 + 0.01, 0.2)).toBeNull();
  });

  it('follows the classic arrangement', () => {
    const at = (key: string) => areaOf(key)!.rect;
    // odd and small at the left end, big and even at the right, the triples in the middle
    expect(at('odd').x).toBeLessThan(at('small').x);
    expect(at('small').x).toBeLessThan(at('double:1').x);
    expect(at('double:3').x).toBeLessThan(at('triple:1').x);
    expect(at('triple:1').x).toBeLessThan(at('anytriple').x);
    expect(at('anytriple').x).toBeLessThan(at('triple:4').x);
    expect(at('triple:6').x).toBeLessThan(at('double:4').x);
    expect(at('double:6').x).toBeLessThan(at('big').x);
    expect(at('big').x).toBeLessThan(at('even').x);
    expect(at('anytriple').x).toBeCloseTo(0, 9);
    for (let f = 1; f <= 3; f++) expect(at(`triple:${f}`).x).toBeCloseTo(at('triple:1').x, 9);
    // rows, dealer side first
    for (const k of ['small', 'big', 'odd', 'even', 'anytriple', 'double:1', 'triple:5']) expect(at(k).z).toBeLessThan(ZB);
    for (let t = 4; t <= 17; t++) {
      expect(at(`total:${t}`).z).toBeCloseTo((ZB + ZC) / 2, 9);
      if (t > 4) expect(at(`total:${t}`).x).toBeGreaterThan(at(`total:${t - 1}`).x);
    }
    const combos = [...spots().values()].filter((s) => s.kind === 'combo').map((s) => at(s.key));
    for (const r of combos) expect(r.z).toBeCloseTo((ZC + ZD) / 2, 9);
    for (let i = 1; i < combos.length; i++) expect(combos[i]!.x).toBeGreaterThan(combos[i - 1]!.x);
    for (let f = 1; f <= 6; f++) {
      expect(at(`single:${f}`).z).toBeCloseTo((ZD + ZE) / 2, 9);
      if (f > 1) expect(at(`single:${f}`).x).toBeGreaterThan(at(`single:${f - 1}`).x);
    }
    // symmetric about the middle of the table
    expect(at('small').x).toBeCloseTo(-at('big').x, 9);
    expect(at('odd').x).toBeCloseTo(-at('even').x, 9);
    expect(at('double:1').x).toBeCloseTo(-at('double:6').x, 9);
  });
});
