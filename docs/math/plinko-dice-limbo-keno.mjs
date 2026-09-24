// Plinko, Dice, Limbo and Keno: exact returns, by enumeration over every outcome, in integer
// arithmetic (BigInt), independent of the game code. docs/rules/online-games.md publishes what
// this prints.
//
//   Plinko  every one of the 2^rows paths of all 27 boards (rows 8-16, Low/Medium/High)
//   Dice    all 10,000 rolls against every target, with each win floored to the cent
//   Limbo   the draw R = floor(99 / U): the chance it reaches each target, from the draw's own
//           interval arithmetic on a grid of U, and the return per target
//   Keno    every C(40, 10) = 847,660,528 set of ten, counted by hits (hypergeometric), for
//           picks 1-10 on all four paytables
//
// Run: node plinko-dice-limbo-keno.mjs

const C = (n, k) => {
  if (k < 0 || k > n) return 0n;
  let r = 1n;
  for (let i = 1; i <= k; i++) r = (r * BigInt(n - k + i)) / BigInt(i);
  return r;
};
const gcd = (a, b) => (b === 0n ? a : gcd(b, a % b));
/** num/den as an exact percentage when it terminates (Plinko), else to `digits` places. */
function percent(num, den, digits = 6) {
  const g = gcd(num, den);
  num /= g;
  den /= g;
  let scale = 1n;
  for (let d = 0; d <= 30; d++, scale *= 10n) {
    if ((num * 100n * scale) % den === 0n) {
      const s = ((num * 100n * scale) / den).toString().padStart(d + 1, '0');
      return d ? `${s.slice(0, -d)}.${s.slice(-d)}` : s;
    }
  }
  const v = (num * 100n * 10n ** BigInt(digits) * 10n) / den;
  const r = (v + 5n) / 10n;
  const s = r.toString().padStart(digits + 1, '0');
  return `${s.slice(0, -digits)}.${s.slice(-digits)}`;
}
const frac = (num, den) => {
  const g = gcd(num, den);
  return `${num / g}/${den / g}`;
};
/** Hundredths from a printed multiplier (5.6 -> 560). */
const h = (x) => BigInt(Math.round(x * 100));

// ---------------------------------------------------------------------------------------------
// Plinko: Stake's tables, left bin to right.

const PLINKO = {
  8: { low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6], medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13], high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29] },
  9: { low: [5.6, 2, 1.6, 1, 0.7, 0.7, 1, 1.6, 2, 5.6], medium: [18, 4, 1.7, 0.9, 0.5, 0.5, 0.9, 1.7, 4, 18], high: [43, 7, 2, 0.6, 0.2, 0.2, 0.6, 2, 7, 43] },
  10: { low: [8.9, 3, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 3, 8.9], medium: [22, 5, 2, 1.4, 0.6, 0.4, 0.6, 1.4, 2, 5, 22], high: [76, 10, 3, 0.9, 0.3, 0.2, 0.3, 0.9, 3, 10, 76] },
  11: { low: [8.4, 3, 1.9, 1.3, 1, 0.7, 0.7, 1, 1.3, 1.9, 3, 8.4], medium: [24, 6, 3, 1.8, 0.7, 0.5, 0.5, 0.7, 1.8, 3, 6, 24], high: [120, 14, 5.2, 1.4, 0.4, 0.2, 0.2, 0.4, 1.4, 5.2, 14, 120] },
  12: { low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10], medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33], high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170] },
  13: { low: [8.1, 4, 3, 1.9, 1.2, 0.9, 0.7, 0.7, 0.9, 1.2, 1.9, 3, 4, 8.1], medium: [43, 13, 6, 3, 1.3, 0.7, 0.4, 0.4, 0.7, 1.3, 3, 6, 13, 43], high: [260, 37, 11, 4, 1, 0.2, 0.2, 0.2, 0.2, 1, 4, 11, 37, 260] },
  14: { low: [7.1, 4, 1.9, 1.4, 1.3, 1.1, 1, 0.5, 1, 1.1, 1.3, 1.4, 1.9, 4, 7.1], medium: [58, 15, 7, 4, 1.9, 1, 0.5, 0.2, 0.5, 1, 1.9, 4, 7, 15, 58], high: [420, 56, 18, 5, 1.9, 0.3, 0.2, 0.2, 0.2, 0.3, 1.9, 5, 18, 56, 420] },
  15: { low: [15, 8, 3, 2, 1.5, 1.1, 1, 0.7, 0.7, 1, 1.1, 1.5, 2, 3, 8, 15], medium: [88, 18, 11, 5, 3, 1.3, 0.5, 0.3, 0.3, 0.5, 1.3, 3, 5, 11, 18, 88], high: [620, 83, 27, 8, 3, 0.5, 0.2, 0.2, 0.2, 0.2, 0.5, 3, 8, 27, 83, 620] },
  16: { low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16], medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110], high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000] },
};

console.log('PLINKO: return per board = sum over all 2^rows paths of the bin multiplier, over 2^rows');
console.log('| Rows | Low | Medium | High | Top pay odds (either edge) |');
console.log('|---:|---:|---:|---:|---:|');
const plinkoSd = [];
for (const rows of Object.keys(PLINKO).map(Number)) {
  const cells = [];
  for (const risk of ['low', 'medium', 'high']) {
    const m = PLINKO[rows][risk].map(h);
    // Count every path: a path is a rows-bit integer, its bin is its number of set bits.
    const count = new Array(rows + 1).fill(0n);
    for (let bits = 0; bits < 2 ** rows; bits++) {
      let k = 0;
      for (let b = bits; b; b &= b - 1) k++;
      count[k]++;
    }
    count.forEach((c, k) => {
      if (c !== C(rows, k)) throw new Error('path count');
    });
    let num = 0n;
    let sq = 0n;
    for (let k = 0; k <= rows; k++) {
      num += count[k] * m[k];
      sq += count[k] * m[k] * m[k];
    }
    const den = 100n * 2n ** BigInt(rows);
    cells.push(`${percent(num, den)}%`);
    // SD in bets: sqrt(E[m^2] - E[m]^2), m in units of the bet.
    const n = 2 ** rows;
    const mean = Number(num) / 100 / n;
    const sd = Math.sqrt(Number(sq) / 10_000 / n - mean * mean);
    plinkoSd.push(`${rows} ${risk} ${sd.toFixed(4)}`);
  }
  console.log(`| ${rows} | ${cells.join(' | ')} | 1 in ${(2 ** (rows - 1)).toLocaleString('en-US')} |`);
}
console.log('SD per drop, in bets:', plinkoSd.join(', '));

// ---------------------------------------------------------------------------------------------
// Dice: 10,000 rolls (0.00-99.99 as 0-9999). Roll Under T wins on roll < T (T winning rolls);
// Roll Over T wins on roll > T (9999 - T). A win pays floor(bet * 9900 / chance) cents.

console.log('\nDICE: all 10,000 rolls against every target, paid with the cent floor');
const diceReturn = (bet, over, target) => {
  let won = 0n;
  for (let roll = 0; roll < 10_000; roll++) if (over ? roll > target : roll < target) won++;
  const pays = (BigInt(bet) * 9900n) / won;
  return { won, pays, num: won * pays, den: 10_000n * BigInt(bet) };
};
for (const bet of [100, 200, 500, 1_000, 2_500, 10_000, 100_000]) {
  let exact = 0;
  let worst = { num: 1n, den: 1n, chance: 0 };
  for (let c = 1; c <= 9_800; c++) {
    // Both sides give the same count; check they agree, then use Under.
    const u = diceReturn(bet, false, c);
    if (c % 997 === 0) {
      const o = diceReturn(bet, true, 9_999 - c);
      if (o.num !== u.num) throw new Error('over and under differ');
    }
    if (u.num * 100n === 99n * u.den) exact++;
    if (u.num * worst.den < worst.num * u.den) worst = { num: u.num, den: u.den, chance: c };
  }
  console.log(`$${bet / 100}: exactly 99% at ${exact} of 9,800 chances; lowest ${percent(worst.num, worst.den, 4)}% at ${(worst.chance / 100).toFixed(2)}%`);
}
console.log('| Win chance | Multiplier | $1 win pays | Return at $1 | Return at $100 |');
console.log('|---:|---:|---:|---:|---:|');
for (const c of [1, 100, 1_000, 2_500, 3_333, 4_950, 5_000, 6_000, 7_000, 9_000, 9_706, 9_800]) {
  const a = diceReturn(100, false, c);
  const b = diceReturn(10_000, false, c);
  console.log(`| ${(c / 100).toFixed(2)}% | ${(9900 / c).toFixed(4)}× | $${(Number(a.pays) / 100).toFixed(2)} | ${percent(a.num, a.den, 4)}% | ${percent(b.num, b.den, 4)}% |`);
}

// ---------------------------------------------------------------------------------------------
// Limbo: R = floor(99 / U) in hundredths, clamped to [100, 10^8], U uniform on (0, 1).
// R >= X exactly when U <= 99 / X, so P(R >= X) = 99 / X and a bet on X returns
// X * 99 / X / 100 = 99%. This checks the draw's interval arithmetic (the engine's method,
// rebuilt here) against that boundary at every X up to 20,000 and a spread above.

console.log('\nLIMBO: P(R >= X) = 99/X, checked at the boundary U = 99/X for each X');
const CAP = 100_000_000n;
const clampR = (x) => (x < 100n ? 100n : x > CAP ? CAP : x);
/** The engine's draw on a fixed digit sequence of U (base 2^32, most significant first). */
function drawOn(digits) {
  let num = 99n;
  let a = 0n;
  for (const d of digits) {
    a = (a << 32n) | d;
    num <<= 32n;
    const lo = clampR(num / (a + 1n));
    const hi = a === 0n ? CAP : clampR(num / a);
    if (lo === hi) return lo;
  }
  throw new Error('undecided');
}
const words = (x, k) => Array.from({ length: k }, (_, i) => (x >> (32n * BigInt(k - 1 - i))) & 0xffffffffn);
let checked = 0;
const targets = [];
for (let X = 101; X <= 20_000; X++) targets.push(X);
for (let X = 20_000; X <= 100_000_000; X = Math.ceil(X * 1.013)) targets.push(X);
targets.push(100_000_000);
for (const X of targets) {
  const k = 3;
  const edge = (99n << (32n * BigInt(k))) / BigInt(X);
  const below = drawOn(words(edge - 1n, k).concat([0x9e3779b9n]));
  const above = drawOn(words(edge + 1n, k).concat([0x9e3779b9n]));
  if (below !== BigInt(X) || above !== BigInt(X - 1)) throw new Error(`boundary at ${X}`);
  checked++;
}
console.log(`boundary exact at ${checked.toLocaleString('en-US')} targets from 1.01x to 1,000,000x; every target returns 99.000000%`);
console.log('| Target | Win chance | SD per bet |');
console.log('|---:|---:|---:|');
for (const X of [101, 150, 200, 1_000, 10_000, 100_000, 1_000_000, 100_000_000]) {
  const p = 99 / X;
  const x = X / 100;
  const sd = Math.sqrt(p * x * x - 0.99 * 0.99);
  console.log(`| ${x.toLocaleString('en-US', { minimumFractionDigits: 2 })}× | ${(p * 100).toPrecision(4)}% | ${sd.toFixed(4)} |`);
}

// ---------------------------------------------------------------------------------------------
// Keno: 40 numbers, 10 drawn. For p picks the number of 10-sets with exactly h hits is
// C(p, h) * C(40 - p, 10 - h); summed over h it is C(40, 10).

const KENO = {
  classic: [[0, 3.96], [0, 1.9, 4.5], [0, 1, 3.1, 10.4], [0, 0.8, 1.8, 5, 22.5], [0, 0.25, 1.4, 4.1, 16.5, 36], [0, 0, 1, 3.68, 7, 16.5, 40], [0, 0, 0.47, 3, 4.5, 14, 31, 60], [0, 0, 0, 2.2, 4, 13, 22, 55, 70], [0, 0, 0, 1.55, 3, 8, 15, 44, 60, 85], [0, 0, 0, 1.4, 2.25, 4.5, 8, 17, 50, 80, 100]],
  low: [[0.7, 1.85], [0, 2, 3.8], [0, 1.1, 1.38, 26], [0, 0, 2.2, 7.9, 90], [0, 0, 1.5, 4.2, 13, 300], [0, 0, 1.1, 2, 6.2, 100, 700], [0, 0, 1.1, 1.6, 3.5, 15, 225, 700], [0, 0, 1.1, 1.5, 2, 5.5, 39, 100, 800], [0, 0, 1.1, 1.3, 1.7, 2.5, 7.5, 50, 250, 1000], [0, 0, 1.1, 1.2, 1.3, 1.8, 3.5, 13, 50, 250, 1000]],
  medium: [[0.4, 2.75], [0, 1.8, 5.1], [0, 0, 2.8, 50], [0, 0, 1.7, 10, 100], [0, 0, 1.4, 4, 14, 390], [0, 0, 0, 3, 9, 180, 710], [0, 0, 0, 2, 7, 30, 400, 800], [0, 0, 0, 2, 4, 11, 67, 400, 900], [0, 0, 0, 2, 2.5, 5, 15, 100, 500, 1000], [0, 0, 0, 1.6, 2, 4, 7, 26, 100, 500, 1000]],
  high: [[0, 3.96], [0, 0, 17.1], [0, 0, 0, 81.5], [0, 0, 0, 10, 259], [0, 0, 0, 4.5, 48, 450], [0, 0, 0, 0, 11, 350, 710], [0, 0, 0, 0, 7, 90, 400, 800], [0, 0, 0, 0, 5, 20, 270, 600, 900], [0, 0, 0, 0, 4, 11, 56, 500, 800, 1000], [0, 0, 0, 0, 3.5, 8, 13, 63, 500, 800, 1000]],
};

console.log('\nKENO: return per table = sum over hits of C(p,h) C(40-p,10-h) mult_h, over C(40,10)');
const ALL = C(40, 10);
console.log(`C(40,10) = ${ALL}`);
console.log('| Picks | Classic | Low | Medium | High |');
console.log('|---:|---:|---:|---:|---:|');
const kenoFracs = [];
const kenoSd = [];
for (let p = 1; p <= 10; p++) {
  const cells = [];
  let total = 0n;
  for (let hits = 0; hits <= p; hits++) total += C(p, hits) * C(40 - p, 10 - hits);
  if (total !== ALL) throw new Error('hit counts');
  for (const risk of ['classic', 'low', 'medium', 'high']) {
    const m = KENO[risk][p - 1].map(h);
    let num = 0n;
    let sq = 0n;
    for (let hits = 0; hits <= p; hits++) {
      const ways = C(p, hits) * C(40 - p, 10 - hits);
      num += ways * m[hits];
      sq += ways * m[hits] * m[hits];
    }
    cells.push(`${percent(num, ALL * 100n, 4)}%`);
    kenoFracs.push(`${risk} ${p}: ${frac(num, ALL * 100n)}`);
    const mean = Number(num) / 100 / Number(ALL);
    kenoSd.push(`${risk} ${p} ${Math.sqrt(Number(sq) / 10_000 / Number(ALL) - mean * mean).toFixed(3)}`);
  }
  console.log(`| ${p} | ${cells.join(' | ')} |`);
}
console.log('As fractions:', kenoFracs.join('; '));
console.log('SD per game, in bets:', kenoSd.join(', '));
console.log('| Picks | P(0 hits) .. P(p hits) |');
for (let p = 1; p <= 10; p++) {
  const row = [];
  for (let hits = 0; hits <= p; hits++) row.push(`${percent(C(p, hits) * C(40 - p, 10 - hits), ALL, 6)}%`);
  console.log(`| ${p} | ${row.join(', ')} |`);
}
