// Machine F, "Gold Rush": 5 reels x 4 rows, 40 fixed lines, WILD on reels 2-5, NUGGET scatters.
// Three, four or five NUGGETs anywhere start 8, 10 or 15 free games with sticky wilds: every
// WILD that lands during the free games stays where it landed until they end. Free games spin
// their own strips (one WILD on reels 2-5, no NUGGET), so they cannot retrigger.
//
// Base game: exact, by enumerating all 32^5 = 33,554,432 reel-stop combinations (every line and
// the NUGGET count evaluated on the full 5x4 window), and again from symbol counts alone.
// Free games: exact, in closed form. A line reads one cell per reel; each cell's symbol and its
// sticky history depend only on its own reel, the reels are independent, and every row of a
// uniformly stopped strip shows the same symbol distribution. So in free game t (1-based) a cell
// on reel r >= 2 is WILD with probability 1 - (1 - q)^t (q = WILDs on the strip / 32: it landed
// in this game or an earlier one) and shows symbol X with probability (1 - q)^(t-1) * f(X), and
// every line has the same expected pay, which is a sum of products of those per-reel terms.
// Optional check: `--simulate=N` plays N paid spins, free games included, with a seeded generator.
//
// Run: node slot-f-gold-rush.mjs                (the enumeration takes several seconds)
//      node slot-f-gold-rush.mjs --simulate=20000000

import { pathToFileURL } from 'node:url';

export const SYMBOLS = ['WILD', 'NUGGET', 'CART', 'PICK', 'LANTERN', 'PAN', 'A', 'K', 'Q', 'J', '10'];

// Base-game strips, 32 stops each. A stop s shows strip[s] .. strip[s+3] (wrapping) in rows 0-3.
export const STRIPS = [
  ['CART', '10', 'A', 'J', 'PAN', 'K', 'Q', 'LANTERN', '10', 'A', 'PICK', 'J', 'K', '10', 'Q', 'PAN',
   'NUGGET', 'A', 'LANTERN', 'J', 'K', 'CART', 'Q', '10', 'PAN', 'A', 'J', 'PICK', 'K', 'LANTERN', 'Q', '10'],
  ['WILD', 'Q', 'A', 'PAN', 'J', 'K', 'CART', '10', 'A', 'LANTERN', 'Q', 'J', 'PICK', 'K', 'NUGGET', 'A',
   'WILD', '10', 'PAN', 'Q', 'LANTERN', 'J', 'K', 'CART', 'A', '10', 'Q', 'PICK', 'J', 'PAN', 'K', 'LANTERN'],
  ['K', 'A', 'WILD', 'J', 'LANTERN', 'Q', '10', 'PICK', 'A', 'K', 'PAN', 'J', 'CART', 'Q', 'A', '10',
   'LANTERN', 'K', 'WILD', 'J', 'PAN', 'NUGGET', 'Q', 'A', 'PICK', 'K', '10', 'J', 'CART', 'Q', 'PAN', 'LANTERN'],
  ['J', 'PAN', 'K', 'A', 'NUGGET', 'Q', 'WILD', '10', 'CART', 'J', 'LANTERN', 'K', 'A', 'PICK', 'Q', 'PAN',
   '10', 'J', 'K', 'LANTERN', 'A', 'Q', 'WILD', 'CART', 'J', '10', 'PAN', 'K', 'A', 'PICK', 'Q', 'LANTERN'],
  ['A', 'LANTERN', 'Q', 'K', '10', 'WILD', 'J', 'PAN', 'A', 'PICK', 'Q', 'K', 'CART', 'J', 'LANTERN', '10',
   'A', 'NUGGET', 'Q', 'PAN', 'K', 'WILD', 'J', 'A', '10', 'PICK', 'Q', 'LANTERN', 'K', 'CART', 'J', 'PAN'],
];

// Free-game strips, 32 stops each: one WILD on reels 2-5, no NUGGET.
export const FREE_STRIPS = [
  ['CART', 'J', 'A', 'Q', 'PAN', '10', 'K', 'LANTERN', 'J', 'Q', 'PICK', 'A', '10', 'K', 'J', 'PAN',
   'Q', 'LANTERN', 'A', 'CART', 'J', '10', 'K', 'Q', 'PICK', 'PAN', 'A', 'J', 'LANTERN', 'K', 'Q', '10'],
  ['WILD', 'J', 'K', 'PAN', 'A', '10', 'Q', 'CART', 'J', 'LANTERN', 'K', 'A', 'PICK', '10', 'J', 'Q',
   'PAN', 'A', 'LANTERN', 'K', 'J', '10', 'CART', 'Q', 'A', 'PICK', 'J', 'K', 'PAN', '10', 'Q', 'LANTERN'],
  ['Q', 'A', 'J', 'LANTERN', '10', 'K', 'PICK', 'J', 'A', 'PAN', 'Q', 'WILD', '10', 'K', 'J', 'CART',
   'A', 'LANTERN', 'Q', 'PAN', 'J', '10', 'K', 'PICK', 'A', 'Q', 'LANTERN', 'J', 'CART', 'K', '10', 'PAN'],
  ['K', '10', 'J', 'A', 'CART', 'Q', 'LANTERN', 'J', 'PAN', 'K', '10', 'A', 'PICK', 'J', 'Q', 'LANTERN',
   'K', 'A', '10', 'J', 'WILD', 'Q', 'PAN', 'A', 'CART', 'K', 'J', 'PICK', '10', 'Q', 'LANTERN', 'PAN'],
  ['J', 'PAN', 'Q', 'A', '10', 'LANTERN', 'K', 'J', 'CART', 'Q', 'A', 'PICK', '10', 'J', 'K', 'PAN',
   'Q', 'LANTERN', 'A', 'J', '10', 'K', 'CART', 'Q', 'PICK', 'J', 'A', 'WILD', '10', 'K', 'LANTERN', 'PAN'],
];

// Row (0 top .. 3 bottom) on reels 1-5 for each of the 40 lines.
export const LINES = [
  [1, 1, 1, 1, 1], [2, 2, 2, 2, 2], [0, 0, 0, 0, 0], [3, 3, 3, 3, 3], [0, 1, 2, 1, 0],
  [3, 2, 1, 2, 3], [1, 2, 3, 2, 1], [2, 1, 0, 1, 2], [0, 1, 1, 1, 0], [3, 2, 2, 2, 3],
  [1, 0, 0, 0, 1], [2, 3, 3, 3, 2], [1, 2, 2, 2, 1], [2, 1, 1, 1, 2], [0, 0, 1, 0, 0],
  [3, 3, 2, 3, 3], [1, 1, 0, 1, 1], [2, 2, 3, 2, 2], [1, 1, 2, 1, 1], [2, 2, 1, 2, 2],
  [0, 1, 0, 1, 0], [3, 2, 3, 2, 3], [1, 0, 1, 0, 1], [2, 3, 2, 3, 2], [1, 2, 1, 2, 1],
  [2, 1, 2, 1, 2], [0, 0, 1, 2, 3], [3, 3, 2, 1, 0], [0, 1, 2, 3, 3], [3, 2, 1, 0, 0],
  [1, 0, 1, 2, 1], [2, 3, 2, 1, 2], [0, 1, 2, 2, 2], [3, 2, 1, 1, 1], [1, 1, 1, 0, 0],
  [2, 2, 2, 3, 3], [0, 0, 0, 1, 2], [3, 3, 3, 2, 1], [1, 2, 1, 0, 1], [2, 1, 2, 3, 2],
];

// Credits per credit bet on the line for 3, 4 and 5 of a kind on adjacent reels from reel 1.
// WILD stands in for every symbol but NUGGET and pays nothing on its own (reel 1 has none).
export const LINE_PAYS = {
  CART: [75, 250, 1000], PICK: [50, 150, 500], LANTERN: [30, 100, 400], PAN: [25, 75, 250],
  A: [12, 40, 150], K: [12, 35, 125], Q: [5, 25, 100], J: [5, 20, 80], '10': [5, 15, 60],
};
// Free games by the number of NUGGETs (index = count; three or more start them).
export const FREE_GAMES = [0, 0, 0, 8, 10, 15];
export const TRIGGER = 3;

const L = 32, R = 5, ROWS = 4, NL = LINES.length, BET = NL; // one credit per line
const sym = (s) => SYMBOLS.indexOf(s);
const W = sym('WILD'), N = sym('NUGGET');

function tables(strips) {
  const lineSym = strips.map((strip, r) => {
    const t = new Int8Array(L * NL);
    for (let s = 0; s < L; s++) for (let l = 0; l < NL; l++) t[s * NL + l] = sym(strip[(s + LINES[l][r]) % L]);
    return t;
  });
  const nuggets = strips.map((strip) => {
    const t = new Int8Array(L);
    for (let s = 0; s < L; s++) for (let k = 0; k < ROWS; k++) if (strip[(s + k) % L] === 'NUGGET') t[s]++;
    return t;
  });
  const pay = new Int32Array(SYMBOLS.length * 6);
  for (const [s, p] of Object.entries(LINE_PAYS)) for (let n = 3; n <= 5; n++) pay[sym(s) * 6 + n] = p[n - 3];
  return { lineSym, nuggets, pay };
}

// Line credits for one base-game window, at one credit per line.
export function lineCredits(stops, tb) {
  let win = 0;
  for (let l = 0; l < NL; l++) {
    const f = tb.lineSym[0][stops[0] * NL + l];
    if (f === N) continue;
    let n = 1;
    while (n < R) {
      const x = tb.lineSym[n][stops[n] * NL + l];
      if (x !== f && x !== W) break;
      n++;
    }
    win += tb.pay[f * 6 + n];
  }
  return win;
}

// Line credits for a free-game window with sticky wilds: held[r][row] is true where a WILD sticks.
export function freeCredits(stops, held, tb) {
  let win = 0;
  for (let l = 0; l < NL; l++) {
    const f = tb.lineSym[0][stops[0] * NL + l];
    let n = 1;
    while (n < R) {
      const x = held[n][LINES[l][n]] ? W : tb.lineSym[n][stops[n] * NL + l];
      if (x !== f && x !== W) break;
      n++;
    }
    win += tb.pay[f * 6 + n];
  }
  return win;
}

const count = (strip, x) => strip.filter((s) => s === x).length;

// Expected line credits per line in a window whose reel r shows X with probability a[r](X)
// (X or WILD, for reels 2-5) — the same product for base and free games.
function perLine(a1, aRest) {
  let ret = 0;
  for (const [x, pays] of Object.entries(LINE_PAYS)) {
    let p = a1(x);
    for (let n = 2; n <= 5; n++) {
      p *= aRest(n - 1, x);
      if (n >= 3) ret += pays[n - 3] * p * (n < 5 ? 1 - aRest(n, x) : 1);
    }
  }
  return ret;
}

export function baseLineFromCounts() {
  return perLine((x) => count(STRIPS[0], x) / L, (r, x) => (count(STRIPS[r], x) + count(STRIPS[r], 'WILD')) / L);
}

/** Expected line credits per line in free game t (1-based) with sticky wilds. */
export function freeLine(t) {
  const q = FREE_STRIPS.map((s) => count(s, 'WILD') / L);
  return perLine(
    (x) => count(FREE_STRIPS[0], x) / L,
    (r, x) => 1 - (1 - q[r]) ** t + (1 - q[r]) ** (t - 1) * (count(FREE_STRIPS[r], x) / L),
  );
}

/** Expected free-game winnings, in total bets, for a feature of `games` free games. */
export function featureValue(games) {
  let v = 0;
  for (let t = 1; t <= games; t++) v += freeLine(t); // per line per line-credit = per total bet
  return v;
}

function exact(tb) {
  const byK = Array.from({ length: 6 }, () => ({ n: 0, sumW: 0, sumW2: 0 }));
  const s = [0, 0, 0, 0, 0];
  let lineSum = 0, hits = 0, top = 0, topWays = 0;
  for (s[0] = 0; s[0] < L; s[0]++) for (s[1] = 0; s[1] < L; s[1]++) for (s[2] = 0; s[2] < L; s[2]++)
    for (s[3] = 0; s[3] < L; s[3]++) for (s[4] = 0; s[4] < L; s[4]++) {
      const w = lineCredits(s, tb);
      let k = 0;
      for (let r = 0; r < R; r++) k += tb.nuggets[r][s[r]];
      lineSum += w;
      const b = byK[k];
      b.n++; b.sumW += w; b.sumW2 += w * w;
      if (w > 0 || k >= TRIGGER) hits++;
      if (w > top) { top = w; topWays = 1; } else if (w === top) topWays++;
    }
  return { byK, lineSum, hits, top, topWays };
}

function sfc32(a, b, c, d) {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0; const u = (t + d) | 0; c = (c + u) | 0;
    return (u >>> 0) / 4294967296;
  };
}

function simulate(n, tb, ftb) {
  const rnd = sfc32(0x9e3779b9, 0x243f6a88, 0xb7e15162, 20260924);
  const stops = [0, 0, 0, 0, 0];
  let sum = 0, sumSq = 0, features = 0, freeSum = 0;
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < R; r++) stops[r] = Math.floor(rnd() * L);
    let credits = lineCredits(stops, tb);
    let k = 0;
    for (let r = 0; r < R; r++) k += tb.nuggets[r][stops[r]];
    if (k >= TRIGGER) {
      features++;
      const held = Array.from({ length: R }, () => [false, false, false, false]);
      for (let g = 0; g < FREE_GAMES[k]; g++) {
        for (let r = 0; r < R; r++) stops[r] = Math.floor(rnd() * L);
        for (let r = 1; r < R; r++) for (let row = 0; row < ROWS; row++) if (FREE_STRIPS[r][(stops[r] + row) % L] === 'WILD') held[r][row] = true;
        const fw = freeCredits(stops, held, ftb);
        credits += fw;
        freeSum += fw;
      }
    }
    const x = credits / BET;
    sum += x; sumSq += x * x;
  }
  const mean = sum / n, sd = Math.sqrt(sumSq / n - mean * mean);
  return { mean, sd, se: sd / Math.sqrt(n), features, free: freeSum / BET / Math.max(1, features) };
}

function main() {
  const seen = new Set(LINES.map((l) => l.join('')));
  if (seen.size !== NL || NL !== 40) throw new Error('the 40 lines must be distinct');
  for (const s of [...STRIPS, ...FREE_STRIPS]) if (s.length !== L) throw new Error('strips have 32 stops');
  if (STRIPS[0].includes('WILD') || FREE_STRIPS[0].includes('WILD')) throw new Error('reel 1 has no WILD');
  const tb = tables(STRIPS), ftb = tables(FREE_STRIPS);
  const T = L ** R;
  const t0 = Date.now();
  const { byK, lineSum, hits, top, topWays } = exact(tb);
  const ms = Date.now() - t0;
  const pK = byK.map((b) => b.n / T);

  let EW = 0, EW2 = 0;
  for (const b of byK) { EW += b.sumW / BET; EW2 += b.sumW2 / BET / BET; }
  EW /= T; EW2 /= T;
  let featRet = 0, pT = 0;
  const fv = FREE_GAMES.map((g) => featureValue(g));
  for (let k = TRIGGER; k <= R; k++) { featRet += pK[k] * fv[k]; pT += pK[k]; }
  const EX = EW + featRet;

  console.log('MACHINE F - Gold Rush (5x4, 40 lines, sticky-wild free games)');
  console.log(`Enumerated ${T.toLocaleString('en-US')} windows in ${ms} ms\n`);
  console.log('Symbol counts per reel (of 32), base / free:');
  for (const x of SYMBOLS) console.log(`  ${x.padEnd(8)} ${STRIPS.map((s) => String(count(s, x)).padStart(2)).join(' ')}   /  ${FREE_STRIPS.map((s) => String(count(s, x)).padStart(2)).join(' ')}`);
  console.log(`\nLine return from counts:      ${(baseLineFromCounts() * 100).toFixed(6)}%`);
  console.log(`Line return from enumeration: ${((lineSum / T / BET) * 100).toFixed(6)}%  (${lineSum / BET} per line of 32^5)`);
  console.log('\nNUGGETs in the window:');
  for (let k = 0; k <= R; k++) console.log(`  ${k}: ${String(byK[k].n).padStart(9)}  ${(pK[k] * 100).toFixed(6)}%`);
  console.log('\nFree games (sticky wilds), expected line pay per line per game:');
  for (let t = 1; t <= FREE_GAMES[R]; t++) console.log(`  game ${String(t).padStart(2)}: ${freeLine(t).toFixed(6)}`);
  for (let k = TRIGGER; k <= R; k++) console.log(`  ${k} NUGGETs: ${FREE_GAMES[k]} free games worth ${fv[k].toFixed(6)} x total bet`);
  console.log(`\nFeature started:               1 in ${(1 / pT).toFixed(2)} paid spins`);
  console.log(`Base game return:              ${(EW * 100).toFixed(6)}%`);
  console.log(`Free-game return:              ${(featRet * 100).toFixed(6)}%`);
  console.log(`TOTAL RETURN TO PLAYER:        ${(EX * 100).toFixed(6)}%`);
  console.log(`Base hit frequency (a line win or a feature): ${((hits / T) * 100).toFixed(4)}%`);
  console.log(`Standard deviation per spin, base game only: ${Math.sqrt(EW2 - EW * EW).toFixed(4)} x total bet`);
  console.log(`Largest base-game line win: ${top} credits (${top / BET} x total bet), ${topWays} way(s) in 32^5`);

  const arg = process.argv.find((a) => a.startsWith('--simulate='));
  if (arg) {
    const n = Number(arg.split('=')[1]);
    const t1 = Date.now();
    const r = simulate(n, tb, ftb);
    console.log(`\nSimulation, ${n.toLocaleString('en-US')} paid spins (seeded sfc32), ${((Date.now() - t1) / 1000).toFixed(1)} s:`);
    console.log(`  measured return ${(r.mean * 100).toFixed(4)}% +/- ${(r.se * 100).toFixed(4)}% (1 SE); SD per spin ${r.sd.toFixed(4)}`);
    console.log(`  features ${r.features} (1 in ${(n / r.features).toFixed(1)}), ${r.free.toFixed(3)} x total bet each`);
    console.log(`  difference from exact: ${((r.mean - EX) / r.se).toFixed(2)} SE`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
