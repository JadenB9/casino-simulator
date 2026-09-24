#!/usr/bin/env node
// Exact figures for Tower, Mines, Hi-Lo and Crash (docs/rules/online-games.md §5 to §8), worked out
// here from the rules alone in integer and BigInt arithmetic, without importing any game code.
// The unit tests check the same numbers a second time through the engines themselves.
//
//   node docs/math/tower-mines-hilo-crash.mjs

const pct = (num, den, digits = 4) => {
  // num/den as a percentage with `digits` decimals, rounded half up, from BigInts
  const n = BigInt(num) * 10n ** BigInt(digits + 2);
  const d = BigInt(den);
  const q = (2n * n + d) / (2n * d);
  const s = q.toString().padStart(digits + 1, '0');
  return `${s.slice(0, -digits)}.${s.slice(-digits)}%`;
};
const mult = (h) => `${(Number(h) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
const gcd = (a, b) => {
  while (b) [a, b] = [b, a % b];
  return a;
};
const frac = (num, den) => {
  const g = gcd(BigInt(num), BigInt(den));
  return `${BigInt(num) / g}/${BigInt(den) / g}`;
};

// ---------------------------------------------------------------------------------------------
console.log('§5 TOWER: 9 rows; multiplier after k eggs = floor(99 × tiles^k / eggs^k) hundredths');
const TOWER = [
  ['Easy', 4, 1],
  ['Medium', 3, 1],
  ['Hard', 2, 1],
  ['Expert', 3, 2],
  ['Master', 4, 3],
];
for (const [name, tiles, bad] of TOWER) {
  const eggs = tiles - bad;
  const cells = [];
  let lo = null;
  let hi = null;
  for (let k = 1; k <= 9; k++) {
    const T = BigInt(tiles) ** BigInt(k);
    const E = BigInt(eggs) ** BigInt(k);
    const m = (99n * T) / E;
    // return = m × E / (100 T)
    const num = m * E;
    const den = 100n * T;
    cells.push(`${mult(m)} ${pct(num, den)}`);
    const v = Number(num) / Number(den);
    if (lo === null || v < lo[0]) lo = [v, k, num, den];
    if (hi === null || v > hi[0]) hi = [v, k, num, den];
  }
  console.log(`  ${name} (${tiles} tiles, ${bad} dragon${bad > 1 ? 's' : ''}): ${cells.join(' | ')}`);
  console.log(`    lowest ${pct(lo[2], lo[3])} at row ${lo[1]} (${frac(lo[2], lo[3])}), highest ${pct(hi[2], hi[3])} at row ${hi[1]}`);
}

// ---------------------------------------------------------------------------------------------
console.log('\n§6 MINES: 25 tiles; multiplier after k gems with m mines = floor(99 × C(25,k) / C(25−m,k)) hundredths');
const C = (n, k) => {
  if (k < 0 || k > n) return 0n;
  let c = 1n;
  for (let i = 0n; i < BigInt(k); i++) c = (c * (BigInt(n) - i)) / (i + 1n);
  return c;
};
let worst = null;
let exact99 = 0;
let cellsAll = 0;
const perMines = [];
for (let m = 1; m <= 24; m++) {
  let lo = null;
  let hi = null;
  const row = [];
  for (let k = 1; k <= 25 - m; k++) {
    const mm = (99n * C(25, k)) / C(25 - m, k);
    const num = mm * C(25 - m, k);
    const den = 100n * C(25, k);
    if (num * 100n > den * 99n) throw new Error(`mines ${m}/${k} returns more than 99%`);
    if (num * 100n === den * 99n) exact99++;
    cellsAll++;
    const v = Number(num) / Number(den);
    row.push(mm);
    if (lo === null || v < lo[0]) lo = [v, k, num, den];
    if (hi === null || v > hi[0]) hi = [v, k, num, den];
    if (worst === null || v < worst[0]) worst = [v, m, k, num, den];
  }
  perMines.push([m, lo, hi, row]);
}
for (const [m, lo, hi, row] of perMines) {
  const show = row.length <= 8 ? row.map(mult).join(' ') : `${row.slice(0, 5).map(mult).join(' ')} … ${mult(row[row.length - 1])}`;
  console.log(`  ${String(m).padStart(2)} mines: ${show}; return ${pct(lo[2], lo[3])} (${lo[1]} gems) to ${pct(hi[2], hi[3])} (${hi[1]} gems)`);
}
console.log(`  ${cellsAll} cells, all at most 99%; ${exact99} exactly 99%; lowest ${pct(worst[3], worst[4])} (${worst[1]} mines, ${worst[2]} gems)`);

// ---------------------------------------------------------------------------------------------
console.log('\n§7 HI-LO: ranks A=1..K=13, each 1/13; a win at `count` ranks multiplies by 1287/(100 × count)');
const winCount = (r, g) => (g === 'hi' ? (r === 1 ? 12 : r === 13 ? 1 : 14 - r) : r === 1 ? 1 : r === 13 ? 12 : r);
const wins = (r, g, n) => (g === 'hi' ? (r === 1 ? n > 1 : r === 13 ? n === 13 : n >= r) : r === 1 ? n === 1 : r === 13 ? n < 13 : n <= r);
const RANKS = Array.from({ length: 13 }, (_, i) => i + 1);
const NAMES = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
for (const r of RANKS) {
  for (const g of ['hi', 'lo']) if (RANKS.filter((n) => wins(r, g, n)).length !== winCount(r, g)) throw new Error('counts');
}
console.log('  card | higher (count, ×, one-guess return) | lower (count, ×, one-guess return)');
for (const r of RANKS) {
  const cell = (g) => {
    const c = winCount(r, g);
    const f = Math.floor(1287 / c);
    return `${c}/13 ${mult(f)} ${pct(f * c, 1300, 4)}`;
  };
  console.log(`  ${NAMES[r].padStart(4)} | ${cell('hi')} | ${cell('lo')}`);
}
const payMult = (counts) => {
  let num = 1n;
  let den = 1n;
  for (const c of counts) {
    num *= 1287n;
    den *= 100n * BigInt(c);
  }
  return (100n * num) / den;
};
const likelier = (r) => (winCount(r, 'hi') >= winCount(r, 'lo') ? 'hi' : 'lo');
const best1 = (r) => {
  const h = Math.floor(1287 / winCount(r, 'hi')) * winCount(r, 'hi');
  const l = Math.floor(1287 / winCount(r, 'lo')) * winCount(r, 'lo');
  return h !== l ? (h > l ? 'hi' : 'lo') : likelier(r);
};
for (const [label, choose] of [
  ['likelier side', likelier],
  ['best first guess, then the likelier side', null],
]) {
  for (let n = 1; n <= 3; n++) {
    let total = 0n;
    const walk = (r, depth, counts) => {
      if (depth === n) return void (total += payMult(counts));
      const g = choose ? choose(r) : depth === 0 ? best1(r) : likelier(r);
      for (const next of RANKS) if (wins(r, g, next)) walk(next, depth + 1, [...counts, winCount(r, g)]);
    };
    for (const r of RANKS) walk(r, 0, []);
    const den = 100n * 13n ** BigInt(n + 1);
    console.log(`  ${label}, cash out after ${n}: ${pct(total, den, 6)} = ${frac(total, den)} (0.99^${n} = ${(100 * 0.99 ** n).toFixed(4)}%)`);
  }
}
{
  let v = 0n;
  const exact = [];
  for (const r of RANKS) {
    const g = best1(r);
    const c = winCount(r, g);
    const back = BigInt(Math.floor(1287 / c) * c);
    if (back === 1287n) exact.push(NAMES[r]);
  }
  console.log(`  one guess returns exactly 99% on: ${exact.join(', ')} (skip to one of them first: 99.0000%)`);
  void v;
}

// ---------------------------------------------------------------------------------------------
console.log('\n§8 CRASH: m(t) = e^(0.00006 t); crash point c in hundredths with P(c > k) = 99/k, 100 ≤ k < 1,000,000');
const RATE = 0.00006;
const timeTo = (k) => (k <= 100 ? 0 : Math.ceil(Math.log(k / 100) / RATE));
for (const k of [101, 150, 200, 300, 500, 1_000, 10_000, 100_000, 1_000_000]) console.log(`  ${mult(k).padStart(12)} at ${(timeTo(k) / 1000).toFixed(3)} s`);
// The sampler: 1 in 100 at 1.00×, else a bisection of (100, CAP] whose coin at (lo, hi], mid is
// (S(mid) − S(hi)) / (S(lo) − S(hi)), S(x) = 99/x below the cap, 0 at it. Check every coin of the
// production tree against that in integers, and every leaf for a small cap in exact fractions.
const CAP = 1_000_000;
const coin = (lo, hi, mid, cap) => (hi >= cap ? [lo, mid] : [lo * (hi - mid), mid * (hi - lo)]);
let nodes = 0;
const stack = [[100, CAP]];
while (stack.length) {
  const [lo, hi] = stack.pop();
  if (hi - lo === 1) continue;
  const mid = Math.floor((lo + hi) / 2);
  const [num, den] = coin(lo, hi, mid, CAP);
  const L = BigInt(lo);
  const M = BigInt(mid);
  const H = BigInt(hi);
  const S = (x) => (99n * L * M * H) / x;
  const sHi = hi === CAP ? 0n : S(H);
  if (!(Number.isSafeInteger(den) && BigInt(num) * (S(L) - sHi) === BigInt(den) * (S(M) - sHi))) throw new Error(`coin ${lo} ${mid} ${hi}`);
  nodes++;
  stack.push([mid, hi], [lo, mid]);
}
console.log(`  every one of the ${nodes.toLocaleString('en-US')} coins of the production tree is exact`);
{
  const cap = 2_000;
  const leaves = new Map([[100, [1n, 100n]]]);
  const st = [[100, cap, 99n, 100n]];
  while (st.length) {
    const [lo, hi, pn, pd] = st.pop();
    if (hi - lo === 1) {
      leaves.set(hi, [pn, pd]);
      continue;
    }
    const mid = Math.floor((lo + hi) / 2);
    const [num, den] = coin(lo, hi, mid, cap);
    st.push([mid, hi, pn * BigInt(num), pd * BigInt(den)], [lo, mid, pn * BigInt(den - num), pd * BigInt(den)]);
  }
  for (const [k, [pn, pd]] of leaves) {
    const [wn, wd] = k === 100 ? [1n, 100n] : k < cap ? [99n, BigInt(k * (k - 1))] : [99n, BigInt(cap - 1)];
    if (pn * wd !== wn * pd) throw new Error(`leaf ${k}`);
  }
  console.log(`  every leaf of the tree for a cap of 20.00× has P(c = k) = 99/(k(k−1)) exactly (${leaves.size} leaves)`);
}
console.log('  target | wins (0.99/x) | pays | return | SD per bet');
for (const k of [101, 150, 200, 500, 1_000, 10_000, 100_000, 999_999]) {
  const p = 99 / k;
  const x = k / 100;
  const sd = Math.sqrt(p * x * x - 0.99 ** 2);
  console.log(`  ${mult(k).padStart(10)} | ${(100 * p).toPrecision(4)}% | ${mult(k)} | 99.0000% | ${sd.toFixed(3)}`);
}
