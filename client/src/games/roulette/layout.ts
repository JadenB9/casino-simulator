// The printed layout as geometry: where every number box, outside box and chip spot sits on the
// felt, and which bet a point on the felt means. Pure data and arithmetic (no DOM, no three.js),
// built from the same spot table the server settles with, so the felt, the hit zones and the
// payouts can't disagree. The shared tests walk every spot through it.
//
// Table-local metres: x runs along the table away from the wheel (row 1, next to the zeros, to
// row 12), z runs toward the players. Column 3 (3, 6 ... 36) is on the dealer's side, column 1
// on the players' side, then the dozens, then the even-money boxes along the players' edge.

import { type Variant, type Spot, DOUBLE_ZERO, spotsOf, spotByKey } from '../../../../shared/src/games/roulette/rules.ts';

/** Row pitch (along x) and column pitch (along z) of the number grid. */
export const CW = 0.12;
export const CD = 0.125;
/** The zero boxes' width, the "2 to 1" boxes' width, the dozens and even-money strips' depth. */
export const ZW = 0.11;
export const COLW = 0.12;
export const DZ = 0.1;
export const EZ = 0.1;
/** Left edge of the zeros and of row 1; the dealer-side edge of column 3. */
export const XZ = -0.41;
export const X0 = XZ + ZW;
export const ZT = -0.32;
/** The players' edge of column 1 (streets and six lines sit on it), and the outer edges. */
export const ZN = ZT + 3 * CD;
export const ZD = ZN + DZ;
export const ZE = ZD + EZ;
export const XR = X0 + 12 * CW;
export const XC = XR + COLW;

/** Where chips sit and how close a click must be to a line or an intersection to mean it. */
const POINT_R = 0.021;
const LINE_R = 0.017;

export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

type Target =
  | { key: string; kind: 'point'; x: number; z: number }
  | { key: string; kind: 'line'; x1: number; z1: number; x2: number; z2: number }
  | { key: string; kind: 'rect'; rect: Rect };

export interface LayoutGeometry {
  variant: Variant;
  /** Number boxes by pocket (0 and 00 included). */
  cells: Map<number, Rect>;
  /** Outside boxes by bet kind. */
  boxes: Map<string, Rect>;
  /** Chip position for every spot key. */
  anchors: Map<string, [number, number]>;
  targets: Target[];
}

export const rowX = (r: number) => X0 + (r - 0.5) * CW;
export const rowEdge = (k: number) => X0 + k * CW;
export const colZ = (c: number) => ZT + (3.5 - c) * CD;
/** Boundary between column c and column c + 1. */
export const colEdge = (c: number) => ZT + (3 - c) * CD;
const rowOf = (n: number) => Math.ceil(n / 3);
const colOf = (n: number) => n - 3 * (rowOf(n) - 1);

const rectFromEdges = (x1: number, x2: number, z1: number, z2: number): Rect => ({ x: (x1 + x2) / 2, z: (z1 + z2) / 2, w: Math.abs(x2 - x1), d: Math.abs(z2 - z1) });

/** The zero boxes. On the double-zero layout 0 takes the players' side and 00 the dealer's, splitting column 2. */
export function zeroRects(v: Variant): Map<number, Rect> {
  const m = new Map<number, Rect>();
  if (v === 'american') {
    m.set(0, rectFromEdges(XZ, X0, ZT + 1.5 * CD, ZN));
    m.set(DOUBLE_ZERO, rectFromEdges(XZ, X0, ZT, ZT + 1.5 * CD));
  } else {
    m.set(0, rectFromEdges(XZ, X0, ZT, ZN));
  }
  return m;
}

const EVEN_MONEY = ['low', 'even', 'red', 'black', 'odd', 'high'] as const;

function build(v: Variant): LayoutGeometry {
  const cells = zeroRects(v);
  for (let n = 1; n <= 36; n++) cells.set(n, { x: rowX(rowOf(n)), z: colZ(colOf(n)), w: CW, d: CD });
  const boxes = new Map<string, Rect>();
  for (let k = 1; k <= 3; k++) boxes.set(`dozen${k}`, rectFromEdges(rowEdge(4 * k - 4), rowEdge(4 * k), ZN, ZD));
  EVEN_MONEY.forEach((kind, j) => boxes.set(kind, rectFromEdges(rowEdge(2 * j), rowEdge(2 * j + 2), ZD, ZE)));
  for (let c = 1; c <= 3; c++) boxes.set(`column${c}`, { x: (XR + XC) / 2, z: colZ(c), w: COLW, d: CD });

  const anchors = new Map<string, [number, number]>();
  const targets: Target[] = [];
  const point = (key: string, x: number, z: number) => {
    anchors.set(key, [x, z]);
    targets.push({ key, kind: 'point', x, z });
  };
  const line = (key: string, x1: number, z1: number, x2: number, z2: number) => {
    anchors.set(key, [(x1 + x2) / 2, (z1 + z2) / 2]);
    targets.push({ key, kind: 'line', x1, z1, x2, z2 });
  };
  const rect = (key: string, r: Rect) => {
    anchors.set(key, [r.x, r.z]);
    targets.push({ key, kind: 'rect', rect: r });
  };

  for (const spot of spotsOf(v).values()) {
    const nums = spot.numbers;
    const hasZero = nums.includes(0) || nums.includes(DOUBLE_ZERO);
    switch (spot.kind) {
      case 'straight':
        rect(spot.key, cells.get(nums[0]!)!);
        break;
      case 'split': {
        if (hasZero) {
          zeroSplit(v, spot, line);
          break;
        }
        const [a, b] = nums as [number, number];
        if (b === a + 1) {
          // side by side in a row: the line between their columns
          const r = rowOf(a);
          line(spot.key, rowEdge(r - 1), colEdge(colOf(a)), rowEdge(r), colEdge(colOf(a)));
        } else {
          // one row after the other: the line between the rows
          const r = rowOf(a);
          const c = colOf(a);
          line(spot.key, rowEdge(r), colZ(c) - CD / 2, rowEdge(r), colZ(c) + CD / 2);
        }
        break;
      }
      case 'street':
        if (hasZero) {
          // trios sit on the zero edge where it meets a column line (0-1-2, 00-2-3, 0-2-3), or the 0/00 line (0-00-2)
          point(spot.key, X0, nums.includes(1) ? colEdge(1) : nums.includes(3) ? colEdge(2) : ZT + 1.5 * CD);
        } else {
          const r = rowOf(nums[0]!);
          line(spot.key, rowEdge(r - 1), ZN, rowEdge(r), ZN);
        }
        break;
      case 'corner':
        point(spot.key, rowEdge(rowOf(nums[0]!)), colEdge(colOf(nums[0]!)));
        break;
      case 'sixline':
        point(spot.key, rowEdge(rowOf(nums[0]!)), ZN);
        break;
      case 'topline':
      case 'firstfour':
        point(spot.key, X0, ZN);
        break;
      default:
        rect(spot.key, boxes.get(spot.kind)!);
    }
  }
  return { variant: v, cells, boxes, anchors, targets };
}

function zeroSplit(v: Variant, spot: Spot, line: (key: string, x1: number, z1: number, x2: number, z2: number) => void): void {
  const nums = spot.numbers;
  if (nums.includes(0) && nums.includes(DOUBLE_ZERO)) {
    line(spot.key, XZ, ZT + 1.5 * CD, X0, ZT + 1.5 * CD);
    return;
  }
  const zero = nums.includes(0) ? 0 : DOUBLE_ZERO;
  const n = nums.find((x) => x !== zero)!; // the number across the zero edge
  const c = colOf(n);
  let z1 = colZ(c) - CD / 2;
  let z2 = colZ(c) + CD / 2;
  if (v === 'american' && n === 2) {
    // column 2 borders both zeros: 0 along its players' half, 00 along its dealer's half
    const mid = ZT + 1.5 * CD;
    if (zero === 0) z1 = mid;
    else z2 = mid;
  }
  line(spot.key, X0, z1, X0, z2);
}

const GEOMETRY: Partial<Record<Variant, LayoutGeometry>> = {};

export function layoutOf(v: Variant): LayoutGeometry {
  return (GEOMETRY[v] ??= build(v));
}

function distToSegment(px: number, pz: number, x1: number, z1: number, x2: number, z2: number): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / len2));
  return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
}

function inRect(r: Rect, x: number, z: number): boolean {
  return Math.abs(x - r.x) <= r.w / 2 && Math.abs(z - r.z) <= r.d / 2;
}

/** The bet a point on the felt means: intersections first, then lines, then boxes. */
export function spotAt(v: Variant, x: number, z: number): Spot | null {
  const g = layoutOf(v);
  let best: { key: string; d: number } | null = null;
  for (const t of g.targets) {
    if (t.kind !== 'point') continue;
    const d = Math.hypot(x - t.x, z - t.z);
    if (d <= POINT_R && (!best || d < best.d)) best = { key: t.key, d };
  }
  if (!best) {
    for (const t of g.targets) {
      if (t.kind !== 'line') continue;
      const d = distToSegment(x, z, t.x1, t.z1, t.x2, t.z2);
      if (d <= LINE_R && (!best || d < best.d)) best = { key: t.key, d };
    }
  }
  if (!best) {
    for (const t of g.targets) if (t.kind === 'rect' && inRect(t.rect, x, z)) return spotByKey(v, t.key);
    return null;
  }
  return spotByKey(v, best.key);
}

/** Where the chips for a spot sit. */
export function anchorOf(v: Variant, key: string): [number, number] | null {
  return layoutOf(v).anchors.get(key) ?? null;
}

/** The boxes to light for a spot: its numbers, and the outside box itself. */
export function rectsFor(v: Variant, spot: Spot): Rect[] {
  const g = layoutOf(v);
  const out = spot.numbers.map((n) => g.cells.get(n)!).filter(Boolean);
  const box = g.boxes.get(spot.kind);
  if (box) out.push(box);
  return out;
}
