// Machine B, "Neon Nights": 5 reels x 3 rows, 20 fixed lines, wild + scatter free spins.
//
// Base game: exact, by enumerating all 32^5 = 33,554,432 reel-stop combinations
// (every line and the scatter count evaluated on the full 5x3 window).
// Free spins: exact, by solving the retrigger recursion in closed form from the
// base-game distribution (free games use the same reels, all wins x3).
// Optional check: `--simulate=N` plays N paid spins, free games included, with a
// seeded generator and prints the measured return with its standard error.
//
// Run: node slot-b-video-5reel.mjs               (the enumeration takes about a second)
//      node slot-b-video-5reel.mjs --simulate=20000000

import { pathToFileURL } from 'node:url';

export const SYMBOLS = ['WILD', 'SCATTER', 'DIAMOND', 'SEVEN', 'BELL', 'HORSESHOE', 'A', 'K', 'Q', 'J', '10'];
const [W, S, D, SE, BE, HS, A, K, Q, J, T] = SYMBOLS.map((_, i) => i);

// Reel strips, 32 stops each. A stop s shows strip[s], strip[s+1], strip[s+2]
// (wrapping) in the top, middle and bottom rows.
export const STRIPS = [
  [D, T, A, BE, K, Q, SE, J, T, HS, A, S, K, Q, BE, J, T, D, A, K, HS, Q, J, T, SE, A, K, BE, Q, J, HS, T],
  [SE, J, K, W, Q, T, HS, A, J, D, K, Q, BE, S, J, T, W, A, K, HS, Q, BE, J, SE, K, T, W, Q, D, A, HS, BE],
  [A, BE, Q, W, K, D, T, J, HS, A, Q, S, K, SE, W, T, A, BE, J, K, HS, Q, W, A, D, T, K, BE, J, Q, SE, HS],
  [K, T, SE, Q, W, A, HS, J, K, BE, Q, T, D, A, S, J, W, K, HS, Q, A, BE, T, W, J, SE, K, Q, D, A, BE, HS],
  [Q, HS, T, A, D, K, J, W, Q, T, BE, A, S, K, SE, J, Q, HS, T, A, BE, K, W, Q, J, D, T, A, SE, K, BE, HS],
];

// Row (0 top, 1 middle, 2 bottom) on reels 1-5 for each of the 20 lines.
export const LINES = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 2, 1, 0, 1],
  [1, 0, 1, 2, 1], [0, 1, 1, 1, 0], [2, 1, 1, 1, 2], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
  [1, 1, 0, 1, 1], [1, 1, 2, 1, 1], [0, 0, 2, 0, 0], [2, 2, 0, 2, 2], [0, 2, 2, 2, 0],
];

// Line pays in credits per credit bet on the line, for 3, 4, 5 of a kind from reel 1.
export const LINE_PAYS = {
  [D]: [50, 200, 1000], [SE]: [30, 100, 500], [BE]: [20, 75, 250], [HS]: [15, 50, 200],
  [A]: [10, 30, 125], [K]: [10, 25, 100], [Q]: [5, 20, 100], [J]: [5, 15, 75], [T]: [5, 10, 50],
};
// Scatter pays, multiplied by the total bet, by number of scatters anywhere in the window.
export const SCATTER_PAYS = [0, 0, 0, 2, 10, 50];
export const FREE_SPINS = 10, FREE_SPIN_MULTIPLIER = 3, TRIGGER = 3;

const L = 32, NL = LINES.length, BET = NL; // one credit per line

function tables() {
  STRIPS.forEach((s, r) => { if (s.length !== L) throw new Error(`reel ${r + 1} has ${s.length} stops`); });
  if (STRIPS[0].includes(W)) throw new Error('wild must not appear on reel 1');
  // lineSym[r][s * NL + l]: symbol that line l reads on reel r when that reel stops at s.
  const lineSym = STRIPS.map(() => new Int8Array(L * NL));
  for (let r = 0; r < 5; r++) for (let s = 0; s < L; s++) for (let l = 0; l < NL; l++)
    lineSym[r][s * NL + l] = STRIPS[r][(s + LINES[l][r]) % L];
  const scat = STRIPS.map((strip) => Int8Array.from({ length: L }, (_, s) => [0, 1, 2].filter((k) => strip[(s + k) % L] === S).length));
  const pay = new Int32Array(SYMBOLS.length * 6);
  for (const [sym, p] of Object.entries(LINE_PAYS)) { pay[sym * 6 + 3] = p[0]; pay[sym * 6 + 4] = p[1]; pay[sym * 6 + 5] = p[2]; }
  return { lineSym, scat, pay };
}

// Win in credits for one spin given five stops (used by the simulator and as a spot check).
export function spinWin(stops, tb) {
  const { lineSym, scat, pay } = tb;
  let win = 0, sc = 0;
  for (let l = 0; l < NL; l++) {
    const first = lineSym[0][stops[0] * NL + l];
    if (first === S) continue;
    let n = 1;
    while (n < 5) { const x = lineSym[n][stops[n] * NL + l]; if (x === first || x === W) n++; else break; }
    win += pay[first * 6 + n];
  }
  for (let r = 0; r < 5; r++) sc += scat[r][stops[r]];
  return { win: win + SCATTER_PAYS[sc] * BET, trigger: sc >= TRIGGER, lineWin: win };
}

function exact(tb) {
  const { lineSym, scat, pay } = tb;
  const [ls0, ls1, ls2, ls3, ls4] = lineSym;
  const MAXW = 30000;
  const hist = new Float64Array(MAXW), histT = new Float64Array(MAXW);
  let lineSum = 0, scatterSum = 0;
  const f = new Int8Array(NL), a2 = new Uint8Array(NL), a3 = new Uint8Array(NL), alive = new Int32Array(NL);
  for (let s1 = 0; s1 < L; s1++) {
    for (let l = 0; l < NL; l++) f[l] = ls0[s1 * NL + l];
    for (let s2 = 0; s2 < L; s2++) {
      for (let l = 0; l < NL; l++) { const x = ls1[s2 * NL + l]; a2[l] = f[l] !== S && (x === f[l] || x === W) ? 1 : 0; }
      for (let s3 = 0; s3 < L; s3++) {
        for (let l = 0; l < NL; l++) { const x = ls2[s3 * NL + l]; a3[l] = a2[l] && (x === f[l] || x === W) ? 1 : 0; }
        for (let s4 = 0; s4 < L; s4++) {
          let fixed = 0, k = 0;
          for (let l = 0; l < NL; l++) if (a3[l]) {
            const x = ls3[s4 * NL + l];
            if (x === f[l] || x === W) alive[k++] = l; else fixed += pay[f[l] * 6 + 3];
          }
          const sc4 = scat[0][s1] + scat[1][s2] + scat[2][s3] + scat[3][s4];
          for (let s5 = 0; s5 < L; s5++) {
            let w = fixed;
            for (let i = 0; i < k; i++) {
              const l = alive[i], x = ls4[s5 * NL + l];
              w += pay[f[l] * 6 + (x === f[l] || x === W ? 5 : 4)];
            }
            const sc = sc4 + scat[4][s5];
            const sp = SCATTER_PAYS[sc] * BET;
            lineSum += w; scatterSum += sp;
            hist[w + sp]++;
            if (sc >= TRIGGER) histT[w + sp]++;
          }
        }
      }
    }
  }
  return { hist, histT, lineSum, scatterSum };
}

// Exact line return from symbol counts alone (every line has the same distribution,
// because each reel stop is uniform and a line reads one row per reel).
function lineReturnFromCounts() {
  const count = STRIPS.map((strip) => SYMBOLS.map((_, sym) => strip.filter((x) => x === sym).length));
  let num = 0; const rows = [];
  for (const sym of Object.keys(LINE_PAYS).map(Number)) {
    const ge = [0, count[0][sym]]; // ways (out of L^n) to get at least n in a row
    for (let r = 1; r < 5; r++) ge.push(ge[r] * (count[r][sym] + count[r][W]));
    for (let n = 3; n <= 5; n++) {
      const exactly = ge[n] * L ** (5 - n) - (n < 5 ? ge[n + 1] * L ** (4 - n) : 0);
      const p = LINE_PAYS[sym][n - 3];
      num += p * exactly;
      rows.push([SYMBOLS[sym], n, p, exactly]);
    }
  }
  return { num, den: L ** 5, rows };
}

function sfc32(a, b, c, d) {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b | 0) + d | 0; d = d + 1 | 0;
    a = b ^ b >>> 9; b = c + (c << 3) | 0; c = c << 21 | c >>> 11; c = c + t | 0;
    return (t >>> 0) / 4294967296;
  };
}

function simulate(n, tb) {
  const rand = sfc32(0x9e3779b9, 0x243f6a88, 0xb7e15162, 0x12345678);
  const stops = [0, 0, 0, 0, 0];
  const spin = () => { for (let r = 0; r < 5; r++) stops[r] = Math.floor(rand() * L); return spinWin(stops, tb); };
  let sum = 0, sumSq = 0, features = 0, freeSpins = 0;
  for (let i = 0; i < n; i++) {
    const base = spin();
    let x = base.win;
    if (base.trigger) {
      features++;
      let left = FREE_SPINS;
      while (left > 0) {
        left--; freeSpins++;
        const fs = spin();
        x += FREE_SPIN_MULTIPLIER * fs.win;
        if (fs.trigger) left += FREE_SPINS;
      }
    }
    sum += x; sumSq += x * x;
  }
  const mean = sum / n / BET, sd = Math.sqrt(sumSq / n - (sum / n) ** 2) / BET;
  return { mean, sd, se: sd / Math.sqrt(n), features, freeSpins };
}

function main() {
  const tb = tables();
  const t0 = Date.now();
  const { hist, histT, lineSum, scatterSum } = exact(tb);
  const N = L ** 5;
  let EW = 0, EW2 = 0, EWT = 0, pT = 0, hits = 0;
  for (let w = 0; w < hist.length; w++) {
    if (!hist[w]) continue;
    EW += w * hist[w]; EW2 += w * w * hist[w]; if (w > 0) hits += hist[w];
    EWT += w * histT[w]; pT += histT[w];
  }
  EW /= N; EW2 /= N; EWT /= N; pT /= N;

  const m = FREE_SPIN_MULTIPLIER, F = FREE_SPINS;
  if (F * pT >= 1) throw new Error('retrigger rate makes the feature unbounded');
  const EA = m * EW / (1 - F * pT);
  const EA2 = (m * m * EW2 + 2 * m * F * EWT * EA + pT * F * (F - 1) * EA * EA) / (1 - F * pT);
  const EF = F * EA, EF2 = F * EA2 + F * (F - 1) * EA * EA;
  const EX = EW + pT * EF, EX2 = EW2 + 2 * EWT * EF + pT * EF2;

  const lr = lineReturnFromCounts();
  console.log('MACHINE B - Neon Nights (5x3, 20 lines, 1 credit per line, total bet 20 credits)');
  console.log(`Base-game enumeration: ${N.toLocaleString('en-US')} stop combinations in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log('\nSymbol counts per reel (32 stops each):');
  for (let sym = 0; sym < SYMBOLS.length; sym++)
    console.log(`  ${SYMBOLS[sym].padEnd(10)} ${STRIPS.map((s) => String(s.filter((x) => x === sym).length).padStart(2)).join(' ')}`);
  console.log('\nLine wins (exact, from symbol counts; each line has this distribution):');
  console.log(`  ${'Symbol'.padEnd(10)} ${'n'.padStart(2)} ${'Pays'.padStart(5)} ${'Ways of 32^5'.padStart(13)} ${'Return per line'.padStart(16)}`);
  for (const [name, n, p, ways] of lr.rows) console.log(`  ${name.padEnd(10)} ${String(n).padStart(2)} ${String(p).padStart(5)} ${String(ways).padStart(13)} ${(p * ways / lr.den).toFixed(6).padStart(16)}`);
  console.log(`  line return from counts:      ${lr.num} / ${lr.den} = ${(lr.num / lr.den * 100).toFixed(6)}%`);
  console.log(`  line return from enumeration: ${(lineSum / N / BET * 100).toFixed(6)}%`);
  console.log(`\nScatter pays return:           ${(scatterSum / N / BET * 100).toFixed(6)}%`);
  console.log(`Base game return (lines + scatters): ${(EW / BET * 100).toFixed(6)}%`);
  console.log(`Base game hit frequency:       ${(hits / N * 100).toFixed(4)}%  (1 in ${(N / hits).toFixed(2)})`);
  console.log(`Feature trigger probability:   ${(pT * 100).toFixed(6)}%  (1 in ${(1 / pT).toFixed(2)} paid spins)`);
  console.log(`Expected free spins per feature: ${(F / (1 - F * pT)).toFixed(4)}`);
  console.log(`Expected feature win:          ${(EF / BET).toFixed(4)} x total bet`);
  console.log(`Free-spin contribution:        ${(pT * EF / BET * 100).toFixed(6)}%  (analytic)`);
  console.log(`TOTAL RETURN TO PLAYER:        ${(EX / BET * 100).toFixed(6)}%`);
  console.log(`Standard deviation per paid spin (incl. feature): ${(Math.sqrt(EX2 - EX * EX) / BET).toFixed(4)} x total bet`);
  console.log(`Standard deviation per spin, base game only:      ${(Math.sqrt(EW2 - EW * EW) / BET).toFixed(4)} x total bet`);
  let top = 0; for (let w = hist.length - 1; w > 0; w--) if (hist[w]) { top = w; break; }
  console.log(`Largest single base-game spin: ${top} credits (${top / BET} x total bet), ${hist[top]} way(s) in 32^5`);

  const simArg = process.argv.find((a) => a.startsWith('--simulate='));
  if (simArg) {
    const n = Number(simArg.split('=')[1]);
    const t1 = Date.now();
    const r = simulate(n, tb);
    console.log(`\nSimulation, ${n.toLocaleString('en-US')} paid spins (seeded sfc32), ${((Date.now() - t1) / 1000).toFixed(1)} s:`);
    console.log(`  measured return ${(r.mean * 100).toFixed(4)}% +/- ${(r.se * 100).toFixed(4)}% (1 SE); SD per spin ${r.sd.toFixed(4)}`);
    console.log(`  features ${r.features} (1 in ${(n / r.features).toFixed(1)}), free spins played ${r.freeSpins} (${(r.freeSpins / r.features).toFixed(3)} per feature)`);
    console.log(`  difference from exact: ${((r.mean - EX / BET) / r.se).toFixed(2)} SE`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
