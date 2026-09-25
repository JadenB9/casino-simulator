// Machine G, "Straw, Sticks & Bricks": 5 reels x 3 rows, 20 fixed lines, the WOLF wild on reels
// 2-5, three pigs and four farmhouse pictures on the lines, and three houses (STRAW, STICKS, BRICK)
// that never pay on a line. Six or more houses anywhere in the window start the Blowdown:
//
//   - the houses stay put; the other cells spin on their own, three spins to start;
//   - before each spin every standing house may be rebuilt one grade up: straw -> sticks 12 in 200,
//     sticks -> brick 8 in 200, brick -> gold mansion 3 in 200 (a mansion stays a mansion);
//   - on each spin every empty cell builds a house with chance 1 in 25, straw, sticks or brick
//     6 : 3 : 1 out of 10; a spin that builds anything puts the count back to three;
//   - when the spins run out (or all fifteen cells are built) the wolf blows every house down and
//     each pays a prize drawn evenly from its grade's list, in total bets:
//       straw 1 1 1 2 2 3, sticks 2 3 3 4 5 8, brick 5 6 8 10 15 20, mansion 50;
//   - all fifteen built is the Whole Street: 1,000 total bets on top.
//
// Base game: exact, by enumerating all 30^5 = 24,300,000 reel-stop combinations (every line and
// the houses on the full 5x3 window), and again from symbol counts alone.
// Blowdown: exact, by a backward recursion over (houses standing k, spins left r). Every empty cell
// builds independently with the same chance each spin, so the number built on a spin is
// Binomial(15 - k, 1/25) and the process (k, r) is a Markov chain on its own; a standing house's
// grade moves only by its own rebuild rolls, which are independent of the chain; and prizes are
// drawn at the end, independently of everything. So with
//   h_g(k, r) = expected prize of a house of grade g,  v(k, r) = expected prizes of houses still to
//   land plus the Whole Street,  f(k, r) = chance of the Whole Street,
// h_g(k, r) = sum_j Bin(15-k)(j) [ (1 - u_g) h_g(k', r') + u_g h_{g+1}(k', r') ],
// v(k, r)   = sum_j Bin(15-k)(j) [ j sum_g pi_g h_g(k', r') + v(k', r') ],
// with k' = k + j, r' = 3 if j > 0 else r - 1, and at k = 15 or r = 0: h_g = the mean of g's list,
// v = 1,000 at k = 15 else 0, f = 1 at k = 15 else 0. A Blowdown started by n_g houses of grade g
// (k = sum n_g) is worth sum_g n_g h_g(k, 3) + v(k, 3) total bets. The machine's own test checks
// this recursion against an exhaustive walk of every draw sequence on a small grid.
//
// Run: node slot-g-straw-sticks-bricks.mjs              (the enumeration takes a few seconds)
//      node slot-g-straw-sticks-bricks.mjs --simulate=10000000

import { pathToFileURL } from 'node:url';

export const SYMBOLS = ['WOLF', 'BRICKPIG', 'STICKPIG', 'STRAWPIG', 'POT', 'CHURN', 'APPLE', 'TURNIP', 'STRAW', 'STICKS', 'BRICK'];

// 30 stops each. A stop s shows strip[s], strip[s+1], strip[s+2] (wrapping) in rows 0-2.
export const STRIPS = [
  ['BRICKPIG', 'TURNIP', 'APPLE', 'STRAW', 'STRAW', 'STICKS', 'POT', 'CHURN', 'STRAWPIG', 'TURNIP', 'APPLE', 'STICKPIG', 'POT', 'CHURN', 'TURNIP',
   'APPLE', 'APPLE', 'STRAWPIG', 'POT', 'TURNIP', 'CHURN', 'BRICKPIG', 'TURNIP', 'APPLE', 'STICKPIG', 'CHURN', 'TURNIP', 'POT', 'APPLE', 'TURNIP'],
  ['WOLF', 'TURNIP', 'APPLE', 'STRAW', 'STICKS', 'POT', 'CHURN', 'STRAWPIG', 'TURNIP', 'BRICKPIG', 'APPLE', 'STICKPIG', 'POT', 'CHURN', 'TURNIP',
   'CHURN', 'WOLF', 'STRAWPIG', 'POT', 'APPLE', 'CHURN', 'TURNIP', 'APPLE', 'STICKPIG', 'BRICKPIG', 'TURNIP', 'POT', 'APPLE', 'TURNIP', 'CHURN'],
  ['STICKPIG', 'TURNIP', 'APPLE', 'STRAW', 'STRAW', 'BRICK', 'CHURN', 'WOLF', 'TURNIP', 'BRICKPIG', 'APPLE', 'STICKPIG', 'POT', 'CHURN', 'TURNIP',
   'CHURN', 'APPLE', 'STRAWPIG', 'POT', 'TURNIP', 'CHURN', 'WOLF', 'APPLE', 'STICKPIG', 'TURNIP', 'POT', 'BRICKPIG', 'TURNIP', 'APPLE', 'CHURN'],
  ['APPLE', 'TURNIP', 'POT', 'STRAW', 'STICKS', 'POT', 'CHURN', 'WOLF', 'TURNIP', 'BRICKPIG', 'APPLE', 'STICKPIG', 'POT', 'CHURN', 'APPLE',
   'TURNIP', 'CHURN', 'STRAWPIG', 'WOLF', 'TURNIP', 'CHURN', 'STICKPIG', 'APPLE', 'POT', 'BRICKPIG', 'TURNIP', 'APPLE', 'TURNIP', 'CHURN', 'POT'],
  ['CHURN', 'TURNIP', 'APPLE', 'STRAW', 'STRAW', 'POT', 'WOLF', 'STRAWPIG', 'TURNIP', 'BRICKPIG', 'APPLE', 'STICKPIG', 'POT', 'CHURN', 'TURNIP',
   'APPLE', 'STRAWPIG', 'POT', 'TURNIP', 'CHURN', 'WOLF', 'STICKPIG', 'TURNIP', 'POT', 'BRICKPIG', 'APPLE', 'CHURN', 'APPLE', 'TURNIP', 'STICKPIG'],
];

// Row (0 top .. 2 bottom) on reels 1-5 for each of the 20 lines.
export const LINES = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 2, 1, 0, 1],
  [1, 0, 1, 2, 1], [0, 1, 1, 1, 0], [2, 1, 1, 1, 2], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
  [1, 1, 0, 1, 1], [1, 1, 2, 1, 1], [0, 0, 2, 0, 0], [2, 2, 0, 2, 2], [0, 2, 2, 2, 0],
];

// Credits per credit bet on the line for 3, 4 and 5 of a kind on adjacent reels from reel 1.
// The WOLF stands in for every symbol but the houses and pays nothing on its own (reel 1 has none).
export const LINE_PAYS = {
  BRICKPIG: [40, 200, 800], STICKPIG: [30, 100, 400], STRAWPIG: [20, 75, 250],
  POT: [10, 40, 125], CHURN: [8, 30, 100], APPLE: [5, 15, 60], TURNIP: [4, 10, 50],
};
export const HOUSES = ['STRAW', 'STICKS', 'BRICK'];
export const TRIGGER = 6;
export const BONUS = {
  cells: 15,
  respins: 3,
  land: [1, 25],
  grade: [6, 3, 1],
  gradeDen: 10,
  upgrade: [12, 8, 3, 0],
  upgradeDen: 200,
  prizes: [[1, 1, 1, 2, 2, 3], [2, 3, 3, 4, 5, 8], [5, 6, 8, 10, 15, 20], [50]],
  street: 1000,
};

const L = 30, R = 5, NL = LINES.length, BET = NL; // one credit per line
const sym = (s) => SYMBOLS.indexOf(s);
const W = sym('WOLF');

function tables() {
  const lineSym = STRIPS.map((strip, r) => {
    const t = new Int8Array(L * NL);
    for (let s = 0; s < L; s++) for (let l = 0; l < NL; l++) t[s * NL + l] = sym(strip[(s + LINES[l][r]) % L]);
    return t;
  });
  // houses[r][stop * 3 + g]: houses of grade g reel r shows in the window
  const houses = STRIPS.map((strip) => {
    const t = new Int8Array(L * 3);
    for (let s = 0; s < L; s++) for (let k = 0; k < 3; k++) {
      const g = HOUSES.indexOf(strip[(s + k) % L]);
      if (g >= 0) t[s * 3 + g]++;
    }
    return t;
  });
  const pay = new Int32Array(SYMBOLS.length * 6);
  for (const [s, p] of Object.entries(LINE_PAYS)) for (let n = 3; n <= 5; n++) pay[sym(s) * 6 + n] = p[n - 3];
  return { lineSym, houses, pay };
}

export function lineCredits(stops, tb) {
  let win = 0;
  for (let l = 0; l < NL; l++) {
    const f = tb.lineSym[0][stops[0] * NL + l];
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

const count = (strip, x) => strip.filter((s) => s === x).length;

/** Expected line credits per line from symbol counts alone (every line sees the same distribution). */
export function baseLineFromCounts() {
  let ret = 0;
  for (const [x, pays] of Object.entries(LINE_PAYS)) {
    let p = count(STRIPS[0], x) / L;
    const a = (r) => (count(STRIPS[r], x) + count(STRIPS[r], 'WOLF')) / L;
    for (let n = 2; n <= 5; n++) {
      p *= a(n - 1);
      if (n >= 3) ret += pays[n - 3] * p * (n < 5 ? 1 - a(n) : 1);
    }
  }
  return ret;
}

/** The Blowdown recursion: tables h[k][r][g], v[k][r], f[k][r]. */
export function blowdown(b = BONUS) {
  const N = b.cells, RS = b.respins, G = b.prizes.length;
  const p = b.land[0] / b.land[1];
  const pi = [...b.grade.map((w) => w / b.gradeDen), ...new Array(G - b.grade.length).fill(0)];
  const mean = b.prizes.map((t) => t.reduce((a, x) => a + x, 0) / t.length);
  const choose = (n, k) => { let c = 1; for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1); return c; };
  const h = [], v = [], f = [];
  for (let k = N; k >= 0; k--) {
    h[k] = []; v[k] = []; f[k] = [];
    for (let r = 0; r <= RS; r++) {
      if (k === N || r === 0) { h[k][r] = [...mean]; v[k][r] = k === N ? b.street : 0; f[k][r] = k === N ? 1 : 0; continue; }
      const hk = new Array(G).fill(0);
      let vk = 0, fk = 0;
      for (let j = 0; j <= N - k; j++) {
        const pj = choose(N - k, j) * p ** j * (1 - p) ** (N - k - j);
        const nk = k + j, nr = j > 0 ? RS : r - 1;
        const hn = h[nk][nr];
        for (let g = 0; g < G; g++) {
          const u = (b.upgrade[g] ?? 0) / b.upgradeDen;
          hk[g] += pj * ((1 - u) * hn[g] + (u > 0 ? u * hn[g + 1] : 0));
        }
        let fresh = 0;
        for (let g = 0; g < G; g++) fresh += pi[g] * hn[g];
        vk += pj * (j * fresh + v[nk][nr]);
        fk += pj * f[nk][nr];
      }
      h[k][r] = hk; v[k][r] = vk; f[k][r] = fk;
    }
  }
  return { h, v, f };
}

export function exact() {
  const tb = tables();
  const bd = blowdown();
  const s = [0, 0, 0, 0, 0];
  let lineSum = 0, sumSq = 0, hits = 0, triggers = 0, bonus = 0, street = 0, top = 0;
  const byK = new Array(16).fill(0);
  for (s[0] = 0; s[0] < L; s[0]++) for (s[1] = 0; s[1] < L; s[1]++) for (s[2] = 0; s[2] < L; s[2]++)
    for (s[3] = 0; s[3] < L; s[3]++) for (s[4] = 0; s[4] < L; s[4]++) {
      const w = lineCredits(s, tb);
      const n = [0, 0, 0];
      for (let r = 0; r < R; r++) for (let g = 0; g < 3; g++) n[g] += tb.houses[r][s[r] * 3 + g];
      const k = n[0] + n[1] + n[2];
      byK[k]++;
      lineSum += w;
      sumSq += w * w;
      if (w > top) top = w;
      if (k >= TRIGGER) {
        triggers++;
        const hk = bd.h[k][BONUS.respins];
        bonus += n[0] * hk[0] + n[1] * hk[1] + n[2] * hk[2] + bd.v[k][BONUS.respins];
        street += bd.f[k][BONUS.respins];
      }
      if (w > 0 || k >= TRIGGER) hits++;
    }
  const N = L ** R;
  return { N, lineSum, byK, base: lineSum / N / BET, bonus: bonus / N, triggers, hits, street: street / N, top, baseSd: Math.sqrt(sumSq / N / BET / BET - (lineSum / N / BET) ** 2) };
}

function sfc32(a, b, c, d) {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0; const u = (t + d) | 0; c = (c + u) | 0;
    return (u >>> 0) / 4294967296;
  };
}

function simulate(n) {
  const tb = tables();
  const rnd = sfc32(0x9e3779b9, 0x243f6a88, 0xb7e15162, 20260925);
  const draw = (m) => Math.floor(rnd() * m);
  const stops = [0, 0, 0, 0, 0];
  let sum = 0, sumSq = 0;
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < R; r++) stops[r] = draw(L);
    let x = lineCredits(stops, tb) / BET;
    const grid = [];
    for (let r = 0; r < R; r++) for (let row = 0; row < 3; row++) {
      const g = HOUSES.indexOf(STRIPS[r][(stops[r] + row) % L]);
      grid.push(g < 0 ? null : g);
    }
    if (grid.filter((g) => g !== null).length >= TRIGGER) {
      let left = BONUS.respins;
      const full = () => grid.every((g) => g !== null);
      while (left > 0 && !full()) {
        grid.forEach((g, c) => { if (g !== null && draw(BONUS.upgradeDen) < BONUS.upgrade[g]) grid[c] = g + 1; });
        let built = false;
        for (let c = 0; c < grid.length; c++) {
          if (grid[c] !== null || draw(BONUS.land[1]) >= BONUS.land[0]) continue;
          let k = draw(BONUS.gradeDen), g = 0;
          while (k >= BONUS.grade[g]) k -= BONUS.grade[g++];
          grid[c] = g;
          built = true;
        }
        left = built ? BONUS.respins : left - 1;
      }
      for (const g of grid) if (g !== null) x += BONUS.prizes[g][draw(BONUS.prizes[g].length)];
      if (full()) x += BONUS.street;
    }
    sum += x;
    sumSq += x * x;
  }
  const m = sum / n;
  return { rtp: m, sd: Math.sqrt(sumSq / n - m * m) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const e = exact();
  const pct = (x, d = 4) => (x * 100).toFixed(d) + '%';
  console.log('Straw, Sticks & Bricks: 30^5 windows, 20 lines');
  console.log(`  line wins      ${pct(e.base)}   (from symbol counts: ${pct(baseLineFromCounts())})`);
  console.log(`  Blowdown       ${pct(e.bonus)}   started 1 in ${(e.N / e.triggers).toFixed(2)} paid spins`);
  console.log(`  total          ${pct(e.base + e.bonus)}`);
  console.log(`  hit frequency  ${pct(e.hits / e.N)}   (1 in ${(e.N / e.hits).toFixed(2)})`);
  console.log(`  Whole Street   1 in ${Math.round(1 / e.street).toLocaleString('en-US')} paid spins`);
  console.log(`  base-game SD   ${e.baseSd.toFixed(4)} bets; best line total ${e.top} credits`);
  const arg = process.argv.find((a) => a.startsWith('--simulate='));
  if (arg) {
    const n = Number(arg.split('=')[1]);
    const s = simulate(n);
    console.log(`  simulated      ${pct(s.rtp)} over ${n.toLocaleString('en-US')} spins, SD ${s.sd.toFixed(3)} bets`);
  }
}
