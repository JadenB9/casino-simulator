// The printed Sic Bo layout as geometry: where each of the 52 bets sits on the felt, where its
// chips go, and which bet a point on the felt means. Pure data and arithmetic (no DOM, no
// three.js), keyed by the server's spot keys; the felt, the click zones and the lights are all
// drawn from it, and the shared tests check it against the server's spot table.
//
// The classic layout, dealer side first (table-local metres, x across, z toward the players):
//   ODD | SMALL | double 1 2 3 | triples 1-3 | ANY TRIPLE | triples 4-6 | double 4 5 6 | BIG | EVEN
//   totals 4 to 17
//   the fifteen two-dice combinations
//   single numbers 1 to 6

export interface Rect {
  /** Centre and size. */
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface Area {
  key: string;
  rect: Rect;
  /** Where chips for this bet sit: clear of the numeral or dice printed in the box. */
  anchor: [number, number];
}

/** Layout width, and its left edge. */
export const LW = 2.1;
export const X0 = -LW / 2;
/** Row edges, dealer side to players: the top row, totals, combinations, singles. */
export const ZA = -0.25;
export const ZB = ZA + 0.28;
export const ZC = ZB + 0.15;
export const ZD = ZC + 0.15;
export const ZE = ZD + 0.14;

/** Top row widths, left to right. */
export const W_EVEN = 0.2;
export const W_SMALL = 0.3;
export const W_DOUBLE = 0.12;
export const W_TRIPLE = 0.11;
export const W_ANY = 0.16;

const edges = (x1: number, x2: number, z1: number, z2: number): Rect => ({ x: (x1 + x2) / 2, z: (z1 + z2) / 2, w: x2 - x1, d: z2 - z1 });

function build(): Map<string, Area> {
  const areas = new Map<string, Area>();
  const add = (key: string, rect: Rect, anchor: [number, number]) => areas.set(key, { key, rect, anchor });

  // top row
  let x = X0;
  const next = (w: number) => {
    const from = x;
    x += w;
    return [from, x] as const;
  };
  const tall = (key: string, w: number, chipsAt: number) => {
    const [a, b] = next(w);
    add(key, edges(a, b, ZA, ZB), [(a + b) / 2, ZA + chipsAt]);
  };
  tall('odd', W_EVEN, 0.19);
  tall('small', W_SMALL, 0.2);
  for (const f of [1, 2, 3]) tall(`double:${f}`, W_DOUBLE, 0.222);
  const third = (ZB - ZA) / 3;
  const column = (faces: number[]) => {
    const [a, b] = next(W_TRIPLE);
    faces.forEach((f, i) => {
      const r = edges(a, b, ZA + i * third, ZA + (i + 1) * third);
      add(`triple:${f}`, r, [r.x, r.z + 0.012]);
    });
  };
  column([1, 2, 3]);
  tall('anytriple', W_ANY, 0.228);
  column([4, 5, 6]);
  for (const f of [4, 5, 6]) tall(`double:${f}`, W_DOUBLE, 0.222);
  tall('big', W_SMALL, 0.2);
  tall('even', W_EVEN, 0.19);

  // totals, 4 to 17
  const tw = LW / 14;
  for (let t = 4; t <= 17; t++) {
    const a = X0 + (t - 4) * tw;
    add(`total:${t}`, edges(a, a + tw, ZB, ZC), [a + tw / 2, ZB + 0.108]);
  }

  // two-dice combinations, in the usual order: 1-2 ... 1-6, 2-3 ... 5-6
  const cw = LW / 15;
  let i = 0;
  for (let p = 1; p <= 5; p++) {
    for (let q = p + 1; q <= 6; q++) {
      const a = X0 + i * cw;
      add(`combo:${p}-${q}`, edges(a, a + cw, ZC, ZD), [a + cw / 2, ZC + 0.108]);
      i++;
    }
  }

  // single numbers
  const sw = LW / 6;
  for (let f = 1; f <= 6; f++) {
    const a = X0 + (f - 1) * sw;
    add(`single:${f}`, edges(a, a + sw, ZD, ZE), [a + sw * 0.8, (ZD + ZE) / 2]);
  }
  return areas;
}

const AREAS = build();

/** Every bet's box and chip spot, by spot key. */
export function areas(): ReadonlyMap<string, Area> {
  return AREAS;
}

export function areaOf(key: string): Area | null {
  return AREAS.get(key) ?? null;
}

export function anchorOf(key: string): [number, number] | null {
  return AREAS.get(key)?.anchor ?? null;
}

function inRect(r: Rect, x: number, z: number): boolean {
  return Math.abs(x - r.x) <= r.w / 2 && Math.abs(z - r.z) <= r.d / 2;
}

/** The bet a point on the felt means, or null off the layout. Boxes share edges only, so a point on one goes to the first. */
export function spotAt(x: number, z: number): string | null {
  for (const a of AREAS.values()) if (inRect(a.rect, x, z)) return a.key;
  return null;
}
