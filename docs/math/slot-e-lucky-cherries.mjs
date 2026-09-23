// Machine E, "Lucky Cherries": 5 reels x 3 rows, 10 fixed lines, fruit symbols, no wild.
// Cherries pay from two on a line. Three or more BONUS symbols anywhere spin the Cherry Wheel:
// 20 equal segments, each a prize in multiples of the total bet, multiplied by 1, 2 or 5 for
// three, four or five BONUS symbols.
//
// Base game: exact, by enumerating all 30^5 = 24,300,000 reel-stop combinations (every line and
// the BONUS count evaluated on the full 5x3 window), and again from symbol counts alone.
// Wheel: exact; its draw is independent of the window, so it only needs the BONUS count.
// Optional check: `--simulate=N` plays N paid spins with a seeded generator.
//
// Run: node slot-e-lucky-cherries.mjs               (the enumeration takes a few seconds)
//      node slot-e-lucky-cherries.mjs --simulate=20000000

import { pathToFileURL } from 'node:url';

export const SYMBOLS = ['SEVEN', 'BELL', 'MELON', 'GRAPES', 'PLUM', 'ORANGE', 'LEMON', 'CHERRY', 'BONUS'];

// Reel strips, 30 stops each. A stop s shows strip[s], strip[s+1], strip[s+2] (wrapping) in the
// top, middle and bottom rows.
export const STRIPS = [
  ['CHERRY', 'LEMON', 'SEVEN', 'PLUM', 'CHERRY', 'ORANGE', 'MELON', 'GRAPES', 'CHERRY', 'LEMON', 'BELL', 'CHERRY', 'PLUM', 'ORANGE', 'BONUS',
   'CHERRY', 'GRAPES', 'LEMON', 'MELON', 'CHERRY', 'PLUM', 'ORANGE', 'BELL', 'CHERRY', 'GRAPES', 'LEMON', 'CHERRY', 'MELON', 'ORANGE', 'PLUM'],
  ['CHERRY', 'ORANGE', 'PLUM', 'CHERRY', 'GRAPES', 'LEMON', 'BELL', 'CHERRY', 'MELON', 'ORANGE', 'LEMON', 'CHERRY', 'PLUM', 'SEVEN', 'GRAPES',
   'CHERRY', 'ORANGE', 'MELON', 'CHERRY', 'LEMON', 'BONUS', 'PLUM', 'CHERRY', 'BELL', 'GRAPES', 'ORANGE', 'CHERRY', 'LEMON', 'MELON', 'PLUM'],
  ['SEVEN', 'LEMON', 'CHERRY', 'ORANGE', 'GRAPES', 'PLUM', 'LEMON', 'MELON', 'CHERRY', 'ORANGE', 'BELL', 'GRAPES', 'LEMON', 'PLUM', 'CHERRY',
   'ORANGE', 'BONUS', 'MELON', 'LEMON', 'GRAPES', 'CHERRY', 'PLUM', 'ORANGE', 'BELL', 'LEMON', 'GRAPES', 'CHERRY', 'ORANGE', 'MELON', 'PLUM'],
  ['BELL', 'ORANGE', 'LEMON', 'GRAPES', 'CHERRY', 'PLUM', 'MELON', 'ORANGE', 'LEMON', 'BONUS', 'GRAPES', 'BELL', 'PLUM', 'CHERRY', 'ORANGE',
   'LEMON', 'MELON', 'SEVEN', 'GRAPES', 'PLUM', 'ORANGE', 'CHERRY', 'BELL', 'LEMON', 'MELON', 'GRAPES', 'ORANGE', 'PLUM', 'CHERRY', 'LEMON'],
  ['LEMON', 'PLUM', 'BELL', 'ORANGE', 'GRAPES', 'LEMON', 'CHERRY', 'PLUM', 'MELON', 'ORANGE', 'SEVEN', 'LEMON', 'GRAPES', 'PLUM', 'BELL',
   'ORANGE', 'CHERRY', 'LEMON', 'MELON', 'PLUM', 'GRAPES', 'BONUS', 'ORANGE', 'BELL', 'LEMON', 'PLUM', 'CHERRY', 'GRAPES', 'ORANGE', 'MELON'],
];

// Row (0 top, 1 middle, 2 bottom) on reels 1-5 for each of the 10 lines.
export const LINES = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 2, 1, 0, 1],
];

// Credits per credit bet on the line for 2, 3, 4 and 5 of a kind on adjacent reels from reel 1.
export const LINE_PAYS = {
  SEVEN: [0, 150, 750, 5000], BELL: [0, 60, 250, 1000], MELON: [0, 50, 200, 750], GRAPES: [0, 40, 150, 500],
  PLUM: [0, 25, 75, 250], ORANGE: [0, 20, 60, 200], LEMON: [0, 15, 50, 150], CHERRY: [3, 10, 50, 200],
};

// The Cherry Wheel, clockwise from the pointer at segment 0: prizes in multiples of the total bet.
export const WHEEL = [5, 10, 6, 15, 5, 10, 6, 20, 5, 12, 6, 25, 5, 10, 6, 15, 5, 12, 6, 100];
// Wheel multiplier by the number of BONUS symbols (index = count; three or more spin the wheel).
export const WHEEL_MULT = [0, 0, 0, 1, 2, 5];
export const TRIGGER = 3;

const L = 30, R = 5, ROWS = 3, NL = LINES.length, BET = NL; // one credit per line

function tables() {
  const sym = (s) => SYMBOLS.indexOf(s);
  const lineSym = STRIPS.map((strip) => {
    const t = new Int8Array(L * NL);
    for (let s = 0; s < L; s++) for (let l = 0; l < NL; l++) t[s * NL + l] = sym(strip[(s + LINES[l][STRIPS.indexOf(strip)]) % L]);
    return t;
  });
  const bonus = STRIPS.map((strip) => {
    const t = new Int8Array(L);
    for (let s = 0; s < L; s++) for (let k = 0; k < ROWS; k++) if (strip[(s + k) % L] === 'BONUS') t[s]++;
    return t;
  });
  const pay = new Int32Array(SYMBOLS.length * 6);
  for (const [s, p] of Object.entries(LINE_PAYS)) for (let n = 2; n <= 5; n++) pay[sym(s) * 6 + n] = p[n - 2];
  return { lineSym, bonus, pay, B: sym('BONUS') };
}

// Line credits for one window, at one credit per line.
export function lineCredits(stops, tb) {
  let win = 0;
  for (let l = 0; l < NL; l++) {
    const f = tb.lineSym[0][stops[0] * NL + l];
    if (f === tb.B) continue;
    let n = 1;
    while (n < R && tb.lineSym[n][stops[n] * NL + l] === f) n++;
    win += tb.pay[f * 6 + n];
  }
  return win;
}

export function bonusCount(stops, tb) {
  let k = 0;
  for (let r = 0; r < R; r++) k += tb.bonus[r][stops[r]];
  return k;
}

function exact(tb) {
  // hist[w * 6 + k]: windows paying w line credits with k BONUS symbols (10 lines x 5,000 at most)
  const hist = new Float64Array(6 * (NL * 5000 + 1));
  const byK = Array.from({ length: 6 }, () => ({ n: 0, sumW: 0 }));
  const s = [0, 0, 0, 0, 0];
  let lineSum = 0, top = 0, topWays = 0;
  for (s[0] = 0; s[0] < L; s[0]++) for (s[1] = 0; s[1] < L; s[1]++) for (s[2] = 0; s[2] < L; s[2]++)
    for (s[3] = 0; s[3] < L; s[3]++) for (s[4] = 0; s[4] < L; s[4]++) {
      const w = lineCredits(s, tb);
      const k = bonusCount(s, tb);
      lineSum += w;
      byK[k].n++;
      byK[k].sumW += w;
      hist[w * 6 + k]++;
      if (w > top) { top = w; topWays = 1; } else if (w === top) topWays++;
    }
  return { hist, byK, lineSum, top, topWays };
}

function lineReturnFromCounts() {
  const f = (r, x) => STRIPS[r].filter((s) => s === x).length / L;
  let ret = 0;
  const rows = [];
  for (const [x, pays] of Object.entries(LINE_PAYS)) {
    for (let n = 2; n <= 5; n++) {
      let p = 1;
      for (let r = 0; r < n; r++) p *= f(r, x);
      if (n < 5) p *= 1 - f(n, x);
      if (pays[n - 2]) rows.push([x, n, pays[n - 2], p * L ** 5, pays[n - 2] * p]);
      ret += pays[n - 2] * p;
    }
  }
  return { ret, rows };
}

function sfc32(a, b, c, d) {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0; const u = (t + d) | 0; c = (c + u) | 0;
    return (u >>> 0) / 4294967296;
  };
}

function simulate(n, tb) {
  const rnd = sfc32(0x9e3779b9, 0x243f6a88, 0xb7e15162, 20260923);
  const stops = [0, 0, 0, 0, 0];
  let sum = 0, sumSq = 0, wheels = 0;
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < R; r++) stops[r] = Math.floor(rnd() * L);
    let x = lineCredits(stops, tb) / BET;
    const k = bonusCount(stops, tb);
    if (k >= TRIGGER) { wheels++; x += WHEEL[Math.floor(rnd() * WHEEL.length)] * WHEEL_MULT[k]; }
    sum += x; sumSq += x * x;
  }
  const mean = sum / n, sd = Math.sqrt(sumSq / n - mean * mean);
  return { mean, sd, se: sd / Math.sqrt(n), wheels };
}

function main() {
  const tb = tables();
  const N = L ** R;
  const t0 = Date.now();
  const { hist, byK, lineSum, top, topWays } = exact(tb);
  const ms = Date.now() - t0;
  const pK = byK.map((b) => b.n / N);
  const EV = WHEEL.reduce((a, b) => a + b, 0) / WHEEL.length;
  const EV2 = WHEEL.reduce((a, b) => a + b * b, 0) / WHEEL.length;

  // per paid spin, in units of the total bet: X = W + V * m(K) when K >= 3
  let EW = 0, EW2 = 0, hitsNoWheel = 0;
  for (let i = 0; i < hist.length; i++) {
    if (!hist[i]) continue;
    const w = Math.floor(i / 6) / BET, k = i % 6;
    EW += w * hist[i]; EW2 += w * w * hist[i];
    if (w > 0 && k < TRIGGER) hitsNoWheel += hist[i];
  }
  EW /= N; EW2 /= N;
  let wheelRet = 0, cross = 0, wheel2 = 0, pT = 0;
  for (let k = TRIGGER; k <= R; k++) {
    wheelRet += pK[k] * WHEEL_MULT[k] * EV;
    cross += (byK[k].sumW / BET / N) * WHEEL_MULT[k] * EV;
    wheel2 += pK[k] * WHEEL_MULT[k] ** 2 * EV2;
    pT += pK[k];
  }
  const EX = EW + wheelRet, EX2 = EW2 + 2 * cross + wheel2;
  const counts = lineReturnFromCounts();

  console.log('MACHINE E - Lucky Cherries (5x3, 10 lines, Cherry Wheel)');
  console.log(`Enumerated ${N.toLocaleString('en-US')} windows in ${ms} ms\n`);
  console.log('Symbol counts per reel (of 30):');
  for (const x of SYMBOLS) console.log(`  ${x.padEnd(7)} ${STRIPS.map((s) => String(s.filter((y) => y === x).length).padStart(2)).join(' ')}`);
  console.log('\nLine pays from counts (per line, per credit):');
  console.log('  Symbol  n  Pays         Ways       Return');
  for (const [x, n, pay, ways, ret] of counts.rows) console.log(`  ${x.padEnd(7)} ${n} ${String(pay).padStart(5)} ${String(Math.round(ways)).padStart(12)} ${ret.toFixed(6).padStart(12)}`);
  console.log(`  line return from counts:      ${(counts.ret * 100).toFixed(6)}%`);
  console.log(`  line return from enumeration: ${((lineSum / N / BET) * 100).toFixed(6)}%  (${lineSum / BET} per line of 30^5)`);
  console.log('\nBONUS symbols in the window:');
  for (let k = 0; k <= R; k++) console.log(`  ${k}: ${byK[k].n.toString().padStart(9)}  ${(pK[k] * 100).toFixed(6)}%`);
  console.log(`\nWheel: mean prize ${EV} x total bet, multiplier 1/2/5 for 3/4/5 BONUS`);
  console.log(`Wheel spins:                   1 in ${(1 / pT).toFixed(2)} paid spins`);
  console.log(`Line return:                   ${(EW * 100).toFixed(6)}%`);
  console.log(`Wheel return:                  ${(wheelRet * 100).toFixed(6)}%`);
  console.log(`TOTAL RETURN TO PLAYER:        ${(EX * 100).toFixed(6)}%`);
  console.log(`Hit frequency (anything paid): ${(((hitsNoWheel + pT * N) / N) * 100).toFixed(4)}%`);
  console.log(`Standard deviation per paid spin (wheel included): ${Math.sqrt(EX2 - EX * EX).toFixed(4)} x total bet`);
  console.log(`Largest line win: ${top} credits (${top / BET} x total bet), ${topWays} way(s) in 30^5`);

  const arg = process.argv.find((a) => a.startsWith('--simulate='));
  if (arg) {
    const n = Number(arg.split('=')[1]);
    const t1 = Date.now();
    const r = simulate(n, tb);
    console.log(`\nSimulation, ${n.toLocaleString('en-US')} paid spins (seeded sfc32), ${((Date.now() - t1) / 1000).toFixed(1)} s:`);
    console.log(`  measured return ${(r.mean * 100).toFixed(4)}% +/- ${(r.se * 100).toFixed(4)}% (1 SE); SD per spin ${r.sd.toFixed(4)}`);
    console.log(`  wheel spins ${r.wheels} (1 in ${(n / r.wheels).toFixed(1)})`);
    console.log(`  difference from exact: ${((r.mean - EX) / r.se).toFixed(2)} SE`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
