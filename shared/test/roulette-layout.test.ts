import { describe, it, expect } from 'vitest';
import { type Variant, DOUBLE_ZERO, spotsOf, spotName } from '../src/games/roulette/rules.ts';
import { layoutOf, spotAt, anchorOf, rowEdge, colEdge, colZ, rowX, X0, XZ, ZT, ZN, CD } from '../../client/src/games/roulette/layout.ts';

// The client's printed layout and its click zones, checked against the server's spot table: every
// legal bet can be reached by clicking where its chips sit, and no two bets share a spot.

const VARIANTS: Variant[] = ['american', 'european'];

describe('roulette layout geometry', () => {
  it('gives every spot a chip position that clicks back to that spot', () => {
    for (const v of VARIANTS) {
      for (const spot of spotsOf(v).values()) {
        const a = anchorOf(v, spot.key);
        expect(a, `${v} ${spot.key}`).not.toBeNull();
        expect(spotAt(v, a![0], a![1])?.key, `${v} ${spotName(spot)}`).toBe(spot.key);
      }
    }
  });

  it('puts no two spots in the same place', () => {
    for (const v of VARIANTS) {
      const seen = new Map<string, string>();
      for (const [key, [x, z]] of layoutOf(v).anchors) {
        const at = `${x.toFixed(4)},${z.toFixed(4)}`;
        expect(seen.get(at), `${key} and ${seen.get(at)} at ${at}`).toBeUndefined();
        seen.set(at, key);
      }
      expect(layoutOf(v).anchors.size).toBe(spotsOf(v).size);
    }
  });

  it('reads clicks on boxes, lines and corners as the bets a dealer would', () => {
    const at = (v: Variant, x: number, z: number) => spotAt(v, x, z)?.key ?? null;
    // 17 is row 6, column 2; 20 is row 7, column 2
    expect(at('american', rowX(6), colZ(2))).toBe('straight:17');
    expect(at('american', rowEdge(6) + 0.004, colZ(2) + 0.01)).toBe('split:17-20');
    expect(at('american', rowX(6), colEdge(2) - 0.006)).toBe('split:17-18');
    expect(at('american', rowEdge(6) + 0.005, colEdge(2) - 0.004)).toBe('corner:17-18-20-21');
    expect(at('american', rowX(6), ZN + 0.008)).toBe('street:16-17-18');
    expect(at('american', rowEdge(6), ZN)).toBe('sixline:16-17-18-19-20-21');
    expect(at('american', X0, ZN)).toBe('topline:0-1-2-3-37');
    expect(at('european', X0, ZN)).toBe('firstfour:0-1-2-3');
    expect(at('american', (XZ + X0) / 2, ZT + 1.5 * CD)).toBe('split:0-37');
    expect(at('american', (XZ + X0) / 2, ZT + 2.2 * CD)).toBe('straight:0');
    expect(at('american', (XZ + X0) / 2, ZT + 0.5 * CD)).toBe(`straight:${DOUBLE_ZERO}`);
    expect(at('american', X0, ZT + 1.5 * CD)).toBe('street:0-2-37');
    expect(at('american', X0, colEdge(1))).toBe('street:0-1-2');
    expect(at('american', X0, colEdge(2))).toBe('street:2-3-37');
    expect(at('american', X0, ZT + 1.8 * CD)).toBe('split:0-2');
    expect(at('american', X0, ZT + 1.2 * CD)).toBe('split:2-37');
    expect(at('american', X0, colZ(3))).toBe('split:3-37');
    expect(at('european', X0, colZ(3))).toBe('split:0-3');
    expect(at('european', X0, colEdge(2))).toBe('street:0-2-3');
    expect(at('european', (XZ + X0) / 2, ZT + 0.5 * CD)).toBe('straight:0');
    // outside boxes
    const g = layoutOf('american');
    for (const [kind, r] of g.boxes) expect(at('american', r.x, r.z)).toBe(kind);
    // off the layout
    expect(at('american', XZ - 0.2, 0)).toBeNull();
  });
});
