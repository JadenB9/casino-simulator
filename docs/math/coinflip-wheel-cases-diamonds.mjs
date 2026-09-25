#!/usr/bin/env node
// Exact figures for Coinflip, Wheel, Cases and Diamonds (docs/rules/online-games.md §9 to §12),
// worked out here from the rules alone in integer and BigInt arithmetic, without importing any
// game code. The unit tests check the same numbers a second time through the engines themselves.
//
//   node docs/math/coinflip-wheel-cases-diamonds.mjs

const pct = (num, den, digits = 4) => {
  // num/den as a percentage with `digits` decimals, rounded half up, from BigInts
  const n = BigInt(num) * 10n ** BigInt(digits + 2);
  const d = BigInt(den);
  const q = (2n * n + d) / (2n * d);
  const s = q.toString().padStart(digits + 1, '0');
  return `${s.slice(0, -digits)}.${s.slice(-digits)}%`;
};
const mult = (h) => `${(Number(h) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
const sd = (pairs, total) => {
  // the SD of one round's net result, from [ways, hundredths] pairs out of `total`
  let m = 0;
  let m2 = 0;
  for (const [w, x] of pairs) {
    const net = x / 100 - 1;
    m += (w / total) * net;
    m2 += (w / total) * net * net;
  }
  return Math.sqrt(m2 - m * m).toFixed(4);
};

// ---------------------------------------------------------------------------------------------
console.log('§9 COINFLIP: k right calls in a row pay 99 × 2^k hundredths');
console.log('k  multiplier            P(k right)      return  SD');
for (const k of [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20]) {
  const m = 99n * 2n ** BigInt(k);
  const den = 2n ** BigInt(k);
  // P = 1/2^k; return = m × P / 100
  const ret = pct(m, 100n * den);
  console.log(`${String(k).padStart(2)} ${mult(m).padStart(16)}  1 in ${den.toLocaleString('en-US').padStart(9)}   ${ret}  ${sd([[1, Number(m)], [Number(den) - 1, 0]], Number(den))}`);
}
// any stopping rule: E[next] = ½ × 99 × 2^(k+1) = 99 × 2^k, so flipping on is worth exactly the cash-out
let fair = true;
for (let k = 1; k < 20; k++) if (99n * 2n ** BigInt(k + 1) !== 2n * 99n * 2n ** BigInt(k)) fair = false;
console.log(`flipping on from k is worth exactly the cash-out at k, for k = 1..19: ${fair}`);

// ---------------------------------------------------------------------------------------------
console.log('\n§10 WHEEL: one segment of n, uniform; return = Σ multipliers / (100 n)');
const LOW_TEN = [150, 120, 120, 120, 0, 120, 120, 120, 120, 0];
const MEDIUM_PAYS = {
  10: [190, 150, 200, 150, 300],
  20: [150, 200, 200, 200, 150, 300, 180, 200, 200, 200],
  30: [150, 150, 200, 150, 200, 200, 150, 300, 150, 200, 200, 170, 400, 150, 200],
  40: [200, 300, 200, 150, 300, 150, 150, 200, 150, 300, 150, 200, 200, 160, 200, 150, 300, 150, 200, 150],
  50: [200, 150, 300, 150, 200, 150, 200, 150, 150, 300, 150, 200, 150, 200, 150, 150, 500, 150, 200, 150, 200, 150, 300, 150, 200],
};
const wheel = (risk, n) => {
  if (risk === 'Low') return Array.from({ length: n }, (_, i) => LOW_TEN[i % 10]);
  if (risk === 'High') return Array.from({ length: n }, (_, i) => (i === 0 ? 99 * n : 0));
  const pays = MEDIUM_PAYS[n];
  return Array.from({ length: n }, (_, i) => (n === 10 ? (i % 2 ? pays[(i - 1) / 2] : 0) : i % 2 ? 0 : pays[i / 2]));
};
for (const risk of ['Low', 'Medium', 'High']) {
  for (const n of [10, 20, 30, 40, 50]) {
    const w = wheel(risk, n);
    const counts = new Map();
    for (const m of w) counts.set(m, (counts.get(m) ?? 0) + 1);
    const sum = w.reduce((a, b) => a + b, 0);
    const table = [...counts].sort((a, b) => b[0] - a[0]).map(([m, c]) => `${mult(m)} ×${c}`).join(', ');
    console.log(`${risk.padEnd(6)} ${String(n).padStart(2)}  ${pct(sum, 100 * n)}  SD ${sd([...counts].map(([m, c]) => [c, m]), n)}  ${table}`);
  }
}

// ---------------------------------------------------------------------------------------------
console.log('\n§11 CASES: weights out of 1,000,000; return = Σ weight × multiplier / 10^8');
const CASES = {
  Starter: [[20, 215925], [50, 216824], [80, 226900], [120, 136140], [150, 90760], [200, 56725], [300, 34035], [500, 17018], [1000, 5673]],
  Classic: [[10, 300215], [30, 233795], [60, 176400], [100, 117600], [150, 78400], [250, 49000], [500, 27440], [1000, 11760], [2500, 3920], [5000, 1470]],
  'High Roller': [[10, 376340], [25, 249004], [50, 171180], [100, 91296], [200, 57060], [400, 34236], [1000, 13694], [2500, 4565], [5000, 1712], [10000, 685], [25000, 228]],
  Vault: [[5, 390800], [20, 262850], [50, 158564], [100, 90608], [200, 56630], [500, 28315], [1500, 9061], [5000, 2265], [15000, 680], [50000, 170], [100000, 57]],
};
for (const [name, items] of Object.entries(CASES)) {
  const W = items.reduce((a, [, w]) => a + w, 0);
  const sum = items.reduce((a, [m, w]) => a + m * w, 0);
  const more = items.filter(([m]) => m > 100).reduce((a, [, w]) => a + w, 0);
  console.log(`${name.padEnd(12)} weights ${W.toLocaleString('en-US')}  Σ w·m ${sum.toLocaleString('en-US')}  return ${pct(sum, 100 * W)}  SD ${sd(items.map(([m, w]) => [w, m]), W)}  pays more than the case ${pct(more, W, 2)}`);
  console.log('   ' + items.map(([m, w]) => `${mult(m)} ${w >= 10_000 ? pct(w, W, 2) : `1 in ${Math.round(W / w).toLocaleString('en-US')}`}`).join(' · '));
}

// ---------------------------------------------------------------------------------------------
console.log('\n§12 DIAMONDS: 5 gems, 7 colours each; every one of the 7^5 hands enumerated');
const PAYS = { five: 6699, four: 500, fullhouse: 400, three: 300, twopair: 200, pair: 10, none: 0 };
const ways = { five: 0, four: 0, fullhouse: 0, three: 0, twopair: 0, pair: 0, none: 0 };
for (let i = 0; i < 7 ** 5; i++) {
  const counts = new Array(7).fill(0);
  for (let k = 0, x = i; k < 5; k++, x = Math.floor(x / 7)) counts[x % 7]++;
  const g = counts.filter((c) => c > 0).sort((a, b) => b - a);
  const p = g[0] === 5 ? 'five' : g[0] === 4 ? 'four' : g[0] === 3 ? (g[1] === 2 ? 'fullhouse' : 'three') : g[0] === 2 ? (g[1] === 2 ? 'twopair' : 'pair') : 'none';
  ways[p]++;
}
let sum = 0;
let stake = 0;
const STAKE = { five: 5000, four: 500, fullhouse: 400, three: 300, twopair: 200, pair: 10, none: 0 };
for (const p of Object.keys(PAYS)) {
  sum += ways[p] * PAYS[p];
  stake += ways[p] * STAKE[p];
  console.log(`${p.padEnd(10)} ${String(ways[p]).padStart(5)} hands  ${pct(ways[p], 16807)}  pays ${mult(PAYS[p])}`);
}
console.log(`return ${pct(sum, 1680700)} (Σ ${sum.toLocaleString('en-US')} hundredths over 16,807 hands); SD ${sd(Object.keys(PAYS).map((p) => [ways[p], PAYS[p]]), 16807)}`);
console.log(`Stake's table (five of a kind 50×) returns ${pct(stake, 1680700)}; five of a kind at X returns 99% when 7X = 1,663,893 − ${(sum - 7 * 6699).toLocaleString('en-US')}, X = ${(1663893 - (sum - 7 * 6699)) / 7}`);
