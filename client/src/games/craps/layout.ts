// The craps layout, generated from data: one end's layout (drawn for the right end and mirrored
// for the left, the way both ends of a real table carry a full layout) and the proposition box
// between them. Arrangement after the Scarne layout (Commons "Craps table diagram"): the place
// numbers across the dealer's side reading 4 5 SIX 8 NINE 10 with the Don't Come Bar at the end,
// COME, the FIELD, the Don't Pass Bar and the PASS LINE wrapping around the end, BIG 6 / 8 in
// the corner. Payout wording on the felt comes from the same tables the server pays from.

import type { FeltSpec, Region } from '../../table/felt.ts';
import { PROPS, HARD_PAYS, POINTS, type Ratio } from '../../../../shared/src/games/craps/rules.ts';

export const FELT_W = 3.24;
export const FELT_D = 1.16;
export const FELT_COLOR = '#1b5a3a';

const INK = 'rgba(246, 238, 214, 0.93)';
const GOLD = '#ecc76e';
const RED = '#d8432f';
const LINE = 0.0055;

// ---------------------------------------------------------------------------------------------
// Geometry of the right end (x > 0). z runs from the dealers' side (-) to the players' rail (+).

const X_IN = 0.34;
const BOX_W = 0.155;
export const ROW = { top: -0.53, strip: -0.472, main: -0.268, bottom: -0.22 };
const DC_X: [number, number] = [X_IN + 6 * BOX_W, 1.42];
const COME = { x: [X_IN, 1.42], z: [-0.2, 0.03] } as const;
const FIELD = { x: [X_IN, 1.2], z: [0.05, 0.27] } as const;
const BIG = { x: [1.22, 1.42], z: [0.05, 0.27] } as const;
const DP = { z: [0.29, 0.39], x: [1.42, 1.5] } as const;
const PASS = { z: [0.39, 0.53], x: [1.5, 1.62] } as const;
const ODDS_Z: [number, number] = [0.53, 0.58];

/**
 * Inner edge of a number's box, in right-end coordinates. Both ends read 4 5 SIX 8 NINE 10 from
 * left to right (Scarne), so on the mirrored left end the order runs the other way from the
 * centre: 4 sits next to the Don't Come Bar at the outer end.
 */
function boxX(n: number, end: 1 | -1 = 1): number {
  const i = POINTS.indexOf(n as (typeof POINTS)[number]);
  return X_IN + (end === 1 ? i : 5 - i) * BOX_W;
}
export function boxCenter(n: number, end: 1 | -1 = 1): number {
  return boxX(n, end) + BOX_W / 2;
}

// The proposition box in the middle (shared by both ends).
const C = { x: 0.225, ce: [0.235, 0.3] as [number, number] };
const PROP_ROWS = {
  seven: [-0.52, -0.42],
  hardA: [-0.4, -0.25],
  hardB: [-0.24, -0.09],
  one: [-0.07, 0.08],
  two: [0.1, 0.23],
  craps: [0.25, 0.36],
  ce: [-0.4, 0.36],
} as const;

interface Cell {
  id: string;
  x: [number, number];
  z: readonly [number, number];
}

const THIRD = (2 * C.x) / 3;
const CENTER_CELLS: Cell[] = [
  { id: 'any7', x: [-C.x, C.x], z: PROP_ROWS.seven },
  { id: 'hard6', x: [-C.x, 0], z: PROP_ROWS.hardA },
  { id: 'hard10', x: [0, C.x], z: PROP_ROWS.hardA },
  { id: 'hard8', x: [-C.x, 0], z: PROP_ROWS.hardB },
  { id: 'hard4', x: [0, C.x], z: PROP_ROWS.hardB },
  { id: 'acedeuce', x: [-C.x, -C.x + THIRD], z: PROP_ROWS.one },
  { id: 'aces', x: [-C.x + THIRD, C.x - THIRD], z: PROP_ROWS.one },
  { id: 'boxcars', x: [C.x - THIRD, C.x], z: PROP_ROWS.one },
  { id: 'yo', x: [-C.x, -C.x + THIRD], z: PROP_ROWS.two },
  { id: 'horn', x: [-C.x + THIRD, C.x - THIRD], z: PROP_ROWS.two },
  { id: 'yo#2', x: [C.x - THIRD, C.x], z: PROP_ROWS.two },
  { id: 'anycraps', x: [-C.x, C.x], z: PROP_ROWS.craps },
];

// ---------------------------------------------------------------------------------------------
// Regions. Ids are `<end>|<spot>`: end R (right), L (left) or C (centre). A spot is a bet spot
// ('pass', 'field', 'hard8'...) or one of the number-box parts: 'box6' (come odds or a place
// bet), 'dc6' (the don't come strip: lay odds or a lay bet), 'buy4'; 'passodds' is behind the line.

function rect(id: string, x: readonly [number, number], z: readonly [number, number], mirror: boolean): Region {
  const [x0, x1] = mirror ? [-x[1], -x[0]] : [x[0], x[1]];
  return { id, shape: { kind: 'rect', x: (x0 + x1) / 2, z: (z[0] + z[1]) / 2, w: x1 - x0, d: z[1] - z[0] } };
}

function poly(id: string, pts: [number, number][], mirror: boolean): Region {
  return { id, shape: { kind: 'poly', points: pts.map(([x, z]) => [mirror ? -x : x, z]) } };
}

function endRegions(end: 'R' | 'L'): Region[] {
  const m = end === 'L';
  const out: Region[] = [];
  const r = (spot: string, x: readonly [number, number], z: readonly [number, number]) => out.push(rect(`${end}|${spot}`, x, z, m));
  r('passodds', [X_IN, PASS.x[1]], ODDS_Z);
  out.push(poly(`${end}|pass`, [[X_IN, PASS.z[0]], [PASS.x[0], PASS.z[0]], [PASS.x[0], ROW.top], [PASS.x[1], ROW.top], [PASS.x[1], PASS.z[1]], [X_IN, PASS.z[1]]], m));
  out.push(poly(`${end}|dontpass`, [[X_IN, DP.z[0]], [DP.x[0], DP.z[0]], [DP.x[0], ROW.top], [DP.x[1], ROW.top], [DP.x[1], DP.z[1]], [X_IN, DP.z[1]]], m));
  r('come', COME.x, COME.z);
  r('field', FIELD.x, FIELD.z);
  // Big 6 / Big 8: the corner square split on its diagonal
  const [bx0, bx1] = BIG.x;
  const [bz0, bz1] = BIG.z;
  out.push(poly(`${end}|big6`, [[bx0, bz0], [bx1, bz0], [bx0, bz1]], m));
  out.push(poly(`${end}|big8`, [[bx1, bz0], [bx1, bz1], [bx0, bz1]], m));
  r('dontcome', DC_X, [ROW.top, ROW.bottom]);
  for (const n of POINTS) {
    const x: [number, number] = [boxX(n, m ? -1 : 1), boxX(n, m ? -1 : 1) + BOX_W];
    r(`dc${n}`, x, [ROW.top, ROW.strip]);
    if (n === 4 || n === 10) {
      r(`box${n}`, x, [ROW.strip, ROW.main]);
      r(`buy${n}`, x, [ROW.main, ROW.bottom]);
    } else r(`box${n}`, x, [ROW.strip, ROW.bottom]);
  }
  return out;
}

function centerRegions(): Region[] {
  const out = CENTER_CELLS.map((c) => rect(`C|${c.id}`, c.x, c.z, false));
  out.push(rect('C|ce', C.ce, PROP_ROWS.ce, false), rect('C|ce#2', C.ce, PROP_ROWS.ce, true));
  return out;
}

export const REGIONS: Region[] = [...endRegions('R'), ...endRegions('L'), ...centerRegions()];

/**
 * The printed box a bet sits in, as [x0, z0, x1, z1] on the felt, for lighting it up: the pass
 * line's long strip along the rail, a come bet's number box, a hardway or prop cell.
 */
export function spotRect(id: string, end: 1 | -1): [number, number, number, number] | null {
  if (id === 'pass') {
    const [x0, x1] = end === 1 ? [X_IN, PASS.x[1]] : [-PASS.x[1], -X_IN];
    return [x0, PASS.z[0], x1, PASS.z[1]];
  }
  const come = /^come(\d+)$/.exec(id);
  const key = come ? `${end === 1 ? 'R' : 'L'}|box${come[1]}` : `C|${id}`;
  const s = REGIONS.find((r) => r.id === key)?.shape;
  return s?.kind === 'rect' ? [s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2] : null;
}

/** A region id -> which end it's on and which spot it is ('R|box6' -> { end: 1, spot: 'box6' }). */
export function parseRegion(id: string): { end: 1 | -1 | 0; spot: string } {
  const [e, rest] = id.split('|') as [string, string];
  return { end: e === 'R' ? 1 : e === 'L' ? -1 : 0, spot: rest.replace(/#\d+$/, '') };
}

// ---------------------------------------------------------------------------------------------
// Where chips sit, in right-end coordinates (mirror x for the left end). Centre bets ignore the end.

const CENTER_OF: Record<string, [number, number]> = Object.fromEntries(
  CENTER_CELLS.filter((c) => !c.id.includes('#')).map((c) => [c.id, [(c.x[0] + c.x[1]) / 2, (c.z[0] + c.z[1]) / 2 + 0.018]]),
);
CENTER_OF.ce = [(C.ce[0] + C.ce[1]) / 2, 0.02];
CENTER_OF.any7 = [0.118, -0.468];
CENTER_OF.anycraps = [0.1, 0.305];

/** Where a bet (or its odds) sits. `end` is 1 for the right end, -1 for the left. */
export function chipSpot(id: string, part: 'flat' | 'odds', end: 1 | -1): [number, number] {
  const m = /^(come|dontcome|place|buy|lay|big|hard)(\d+)$/.exec(id);
  let at: [number, number];
  if (id in CENTER_OF) return CENTER_OF[id]!;
  if (m && m[1] !== 'big' && m[1] !== 'hard') {
    const n = Number(m[2]);
    const bx = boxCenter(n, end);
    const kind = m[1];
    if (kind === 'come') at = part === 'odds' ? [bx + 0.032, -0.4] : [bx - 0.028, -0.392];
    else if (kind === 'dontcome') at = part === 'odds' ? [bx + 0.035, -0.5] : [bx - 0.03, -0.5];
    else if (kind === 'place') at = [bx, n === 4 || n === 10 ? -0.305 : -0.31];
    else if (kind === 'buy') at = [bx, -0.244];
    else at = [bx + 0.04, -0.33]; // lay
  } else {
    switch (id) {
      case 'pass':
        // odds sit behind the flat bet, toward the player, still inside the band (the armrest hides the felt beyond it)
        at = part === 'odds' ? [0.8, 0.496] : [0.8, 0.432];
        break;
      case 'dontpass':
        at = part === 'odds' ? [0.855, 0.33] : [0.8, 0.33];
        break;
      case 'come':
        at = [0.92, -0.085];
        break;
      case 'dontcome':
        at = [(DC_X[0] + DC_X[1]) / 2, -0.43];
        break;
      case 'field':
        at = [0.62, 0.215];
        break;
      case 'big6':
        at = [BIG.x[0] + 0.06, BIG.z[0] + 0.06];
        break;
      case 'big8':
        at = [BIG.x[1] - 0.06, BIG.z[1] - 0.06];
        break;
      default:
        at = [0.8, 0];
    }
  }
  return [at[0] * end, at[1]];
}

/** Where the puck sits: OFF in the Don't Come Bar, ON at the top of the point's box. */
export function puckSpot(point: number | null, end: 1 | -1): [number, number] {
  if (point === null) return [((DC_X[0] + DC_X[1]) / 2) * end, -0.32];
  return [boxCenter(point, end) * end, -0.442];
}

/** Where the dice come to rest on an end: in the come area, after coming off the end wall. */
export const DICE_REST: [number, number] = [1.12, -0.02];

// ---------------------------------------------------------------------------------------------
// Printing

/** "a:b" as the felt prints it: "for" includes the stake, so 4:1 is "5 for 1". */
export function forWording(r: Ratio): string {
  return `${r[0] + r[1]} for ${r[1]}`;
}

type G = CanvasRenderingContext2D;
type Px = (m: number) => number;

function font(g: G, px: Px, size: number, weight = 600, family = 'Cinzel, Georgia, serif'): void {
  g.font = `${weight} ${Math.round(px(size))}px ${family}`;
}

function strokeRect(g: G, px: Px, x0: number, z0: number, x1: number, z1: number): void {
  g.strokeRect(px(x0), px(z0), px(x1 - x0), px(z1 - z0));
}

function text(g: G, px: Px, s: string, x: number, z: number, size: number, color = INK, weight = 600): void {
  font(g, px, size, weight);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(s, px(x), px(z));
}

/** A die face as printed on layouts: a white rounded square with red pips. */
function die(g: G, px: Px, cx: number, cz: number, size: number, face: number): void {
  const h = size / 2;
  g.fillStyle = '#f4efe3';
  g.beginPath();
  g.roundRect(px(cx - h), px(cz - h), px(size), px(size), px(size * 0.18));
  g.fill();
  g.fillStyle = '#b3121c';
  const pips: Record<number, [number, number][]> = {
    1: [[0, 0]],
    2: [[-1, -1], [1, 1]],
    3: [[-1, -1], [0, 0], [1, 1]],
    4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
    6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
  };
  for (const [dx, dz] of pips[face]!) {
    g.beginPath();
    g.arc(px(cx + dx * size * 0.27), px(cz + dz * size * 0.27), px(size * 0.095), 0, Math.PI * 2);
    g.fill();
  }
}

function dicePair(g: G, px: Px, cx: number, cz: number, size: number, a: number, b: number): void {
  die(g, px, cx - size * 0.58, cz, size, a);
  die(g, px, cx + size * 0.58, cz, size, b);
}

/** Paint one end, in right-end coordinates; `m` = -1 mirrors it onto the left end. */
function paintEnd(g: G, px: Px, m: 1 | -1): void {
  g.save();
  g.scale(m, 1);
  // Text must read the right way round on both ends: flip text back when mirrored.
  const say = (s: string, x: number, z: number, size: number, color = INK, weight = 600, skew = 0, rotate = 0) => {
    g.save();
    g.translate(px(x), px(z));
    g.scale(m, 1);
    if (rotate) g.rotate(rotate * m);
    if (skew) g.transform(1, 0, skew, 1, 0, 0);
    font(g, px, size, weight);
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(s, 0, 0);
    g.restore();
  };
  g.strokeStyle = INK;
  g.lineWidth = px(LINE);

  // PASS LINE: along the rail and around the end
  g.beginPath();
  g.moveTo(px(X_IN), px(PASS.z[0]));
  g.lineTo(px(PASS.x[0]), px(PASS.z[0]));
  g.lineTo(px(PASS.x[0]), px(ROW.top));
  g.moveTo(px(X_IN), px(PASS.z[1]));
  g.lineTo(px(PASS.x[1]), px(PASS.z[1]));
  g.moveTo(px(X_IN), px(ROW.top));
  g.lineTo(px(PASS.x[1]), px(ROW.top));
  g.moveTo(px(X_IN), px(ROW.top));
  g.lineTo(px(X_IN), px(PASS.z[1]));
  g.stroke();
  say('PASS LINE', 0.82, (PASS.z[0] + PASS.z[1]) / 2 + 0.004, 0.085, INK, 700);
  say('PASS LINE', (PASS.x[0] + PASS.x[1]) / 2, (ROW.top + PASS.z[0]) / 2 - 0.06, 0.062, INK, 700, 0, -Math.PI / 2);

  // Don't Pass Bar, with the barred 12 shown as 6-6
  g.beginPath();
  g.moveTo(px(X_IN), px(DP.z[0]));
  g.lineTo(px(DP.x[0]), px(DP.z[0]));
  g.lineTo(px(DP.x[0]), px(ROW.top));
  g.stroke();
  say("Don't Pass Bar", 0.66, (DP.z[0] + DP.z[1]) / 2 + 0.002, 0.046, INK, 600);
  g.save();
  g.translate(px(0.96), px((DP.z[0] + DP.z[1]) / 2));
  g.scale(m, 1);
  dicePair(g, px, 0, 0, 0.042, 6, 6);
  g.restore();
  say("Don't Pass Bar", (DP.x[0] + DP.x[1]) / 2, -0.12, 0.04, INK, 600, 0, -Math.PI / 2);

  // COME
  strokeRect(g, px, COME.x[0], COME.z[0], COME.x[1], COME.z[1]);
  say('COME', 0.86, (COME.z[0] + COME.z[1]) / 2 + 0.008, 0.15, RED, 700);

  // FIELD: 2 and 12 circled with what they pay
  strokeRect(g, px, FIELD.x[0], FIELD.z[0], FIELD.x[1], FIELD.z[1]);
  const fz = FIELD.z[0] + 0.075;
  say('3 · 4 · 9 · 10 · 11', 0.77, fz, 0.07, GOLD, 700);
  for (const [n, x, words] of [[2, 0.415, 'PAYS DOUBLE'], [12, 1.125, 'PAYS TRIPLE']] as const) {
    g.beginPath();
    g.arc(px(x), px(fz), px(0.052), 0, Math.PI * 2);
    g.stroke();
    say(String(n), x, fz + 0.002, 0.06, GOLD, 700);
    say(words, x, fz + 0.083, 0.021, INK, 700);
  }
  say('FIELD', 0.77, FIELD.z[1] - 0.05, 0.075, INK, 700);

  // BIG 6 / BIG 8 in the corner
  g.strokeStyle = INK;
  strokeRect(g, px, BIG.x[0], BIG.z[0], BIG.x[1], BIG.z[1]);
  g.beginPath();
  g.moveTo(px(BIG.x[1]), px(BIG.z[0]));
  g.lineTo(px(BIG.x[0]), px(BIG.z[1]));
  g.stroke();
  say('6', BIG.x[0] + 0.058, BIG.z[0] + 0.07, 0.085, RED, 800);
  say('8', BIG.x[1] - 0.058, BIG.z[1] - 0.064, 0.085, RED, 800);
  say('BIG', BIG.x[0] + 0.058, BIG.z[0] + 0.02, 0.022, INK, 700);
  say('BIG', BIG.x[1] - 0.058, BIG.z[1] - 0.12, 0.022, INK, 700);

  // Place numbers and the Don't Come Bar across the dealers' side
  strokeRect(g, px, X_IN, ROW.top, DC_X[1], ROW.bottom);
  g.beginPath();
  g.moveTo(px(X_IN), px(ROW.strip));
  g.lineTo(px(DC_X[0]), px(ROW.strip));
  g.stroke();
  for (const n of POINTS) {
    const x0 = boxX(n, m);
    g.beginPath();
    g.moveTo(px(x0 + BOX_W), px(ROW.top));
    g.lineTo(px(x0 + BOX_W), px(ROW.bottom));
    g.stroke();
    const label = n === 6 ? 'SIX' : n === 9 ? 'NINE' : String(n);
    const word = n === 6 || n === 9;
    const cz = n === 4 || n === 10 ? -0.37 : -0.355;
    say(label, x0 + BOX_W / 2, cz, word ? 0.058 : 0.1, INK, 700, word ? -0.25 : 0);
    if (n === 4 || n === 10) {
      g.beginPath();
      g.moveTo(px(x0), px(ROW.main));
      g.lineTo(px(x0 + BOX_W), px(ROW.main));
      g.stroke();
      say('BUY', x0 + BOX_W / 2, (ROW.main + ROW.bottom) / 2, 0.026, GOLD, 700);
    }
  }
  say("Don't", (DC_X[0] + DC_X[1]) / 2, -0.47, 0.034, INK, 600);
  say('Come', (DC_X[0] + DC_X[1]) / 2, -0.43, 0.034, INK, 600);
  say('Bar', (DC_X[0] + DC_X[1]) / 2, -0.39, 0.034, INK, 600);
  g.save();
  g.translate(px((DC_X[0] + DC_X[1]) / 2), px(-0.255));
  g.scale(m, 1);
  dicePair(g, px, 0, 0, 0.036, 6, 6);
  g.restore();
  g.restore();
}

function paintCenter(g: G, px: Px): void {
  g.strokeStyle = INK;
  g.lineWidth = px(LINE);
  strokeRect(g, px, -C.x, PROP_ROWS.seven[0], C.x, PROP_ROWS.craps[1]);
  for (const c of CENTER_CELLS) strokeRect(g, px, c.x[0], c.z[0], c.x[1], c.z[1]);
  const mid = (z: readonly [number, number]) => (z[0] + z[1]) / 2;

  const seven = forWording(PROPS.any7.pays);
  text(g, px, 'SEVEN', 0, mid(PROP_ROWS.seven) + 0.004, 0.058, RED, 800);
  text(g, px, seven, -0.16, mid(PROP_ROWS.seven), 0.024);
  text(g, px, seven, 0.16, mid(PROP_ROWS.seven), 0.024);

  const hard = (n: 4 | 6 | 8 | 10, x: number, z: readonly [number, number]) => {
    dicePair(g, px, x, mid(z) - 0.022, 0.05, n / 2, n / 2);
    text(g, px, `HARD ${n}`, x, mid(z) + 0.034, 0.024, INK, 700);
    text(g, px, forWording(HARD_PAYS[n]), x, mid(z) + 0.059, 0.019, GOLD, 700);
  };
  hard(6, -C.x / 2, PROP_ROWS.hardA);
  hard(10, C.x / 2, PROP_ROWS.hardA);
  hard(8, -C.x / 2, PROP_ROWS.hardB);
  hard(4, C.x / 2, PROP_ROWS.hardB);

  const one = (x: number, z: readonly [number, number], a: number, b: number, pays: Ratio) => {
    dicePair(g, px, x, mid(z) - 0.018, 0.04, a, b);
    text(g, px, forWording(pays), x, mid(z) + 0.038, 0.019, GOLD, 700);
  };
  one(-C.x + THIRD / 2, PROP_ROWS.one, 1, 2, PROPS.acedeuce.pays);
  one(0, PROP_ROWS.one, 1, 1, PROPS.aces.pays);
  one(C.x - THIRD / 2, PROP_ROWS.one, 6, 6, PROPS.boxcars.pays);
  one(-C.x + THIRD / 2, PROP_ROWS.two, 5, 6, PROPS.yo.pays);
  one(C.x - THIRD / 2, PROP_ROWS.two, 5, 6, PROPS.yo.pays);
  text(g, px, 'HORN', 0, mid(PROP_ROWS.two) - 0.016, 0.03, INK, 700);
  text(g, px, '2 · 3 · 11 · 12', 0, mid(PROP_ROWS.two) + 0.02, 0.017, GOLD, 700);

  const craps = forWording(PROPS.anycraps.pays);
  text(g, px, 'ANY CRAPS', 0, mid(PROP_ROWS.craps) + 0.003, 0.04, RED, 800);
  text(g, px, craps, -0.17, mid(PROP_ROWS.craps), 0.02);
  text(g, px, craps, 0.17, mid(PROP_ROWS.craps), 0.02);

  // C & E circles down both sides of the box
  for (const side of [-1, 1]) {
    const x = side * (C.ce[0] + C.ce[1]) / 2;
    for (let i = 0; i < 8; i++) {
      const z = PROP_ROWS.ce[0] + 0.05 + i * 0.094;
      const letter = i % 2 === 0 ? 'C' : 'E';
      g.beginPath();
      g.arc(px(x), px(z), px(0.027), 0, Math.PI * 2);
      g.stroke();
      text(g, px, letter, x, z + 0.002, 0.03, letter === 'C' ? INK : GOLD, 700);
    }
  }
  text(g, px, 'NO CALL BETS', 0, 0.43, 0.024, INK, 700);
}

export function feltSpec(): FeltSpec {
  return {
    width: FELT_W,
    depth: FELT_D,
    color: FELT_COLOR,
    resolution: 1260,
    paint(g, px) {
      paintEnd(g, px, 1);
      paintEnd(g, px, -1);
      paintCenter(g, px);
    },
    regions: REGIONS,
  };
}
