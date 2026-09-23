// Machine D, "Diamond Line": a classic 3-reel, 1 payline, 1-3 coins (linear).
// 22 physical stops per reel, 64 virtual stops per reel, cycle 64^3 = 262,144.
// The DIAMOND is wild for every symbol, cherries included, and doubles the win it is part of:
// one DIAMOND pays x2, two pay x4. Three DIAMONDs pay the top award.
//
// Run: node slot-d-diamond-line.mjs

import { pathToFileURL } from 'node:url';

export const VIRTUAL_STOPS = 64;

// [symbol, weight] for physical stops 0..21. DI = diamond wild, CH = cherry, BL = blank.
export const REELS = [
  [['DI', 2], ['BL', 3], ['1B', 3], ['BL', 4], ['CH', 2], ['BL', 4], ['2B', 3], ['BL', 4], ['1B', 3], ['BL', 3], ['7', 2],
   ['BL', 3], ['3B', 2], ['BL', 4], ['1B', 3], ['BL', 4], ['2B', 2], ['BL', 3], ['CH', 1], ['BL', 4], ['3B', 2], ['BL', 3]],
  [['DI', 2], ['BL', 3], ['2B', 3], ['BL', 4], ['1B', 3], ['BL', 4], ['3B', 2], ['BL', 3], ['CH', 2], ['BL', 4], ['1B', 3],
   ['BL', 3], ['7', 2], ['BL', 3], ['2B', 2], ['BL', 4], ['1B', 3], ['BL', 4], ['3B', 2], ['BL', 4], ['CH', 1], ['BL', 3]],
  [['DI', 1], ['BL', 3], ['1B', 3], ['BL', 4], ['3B', 2], ['BL', 4], ['2B', 3], ['BL', 4], ['CH', 1], ['BL', 3], ['7', 2],
   ['BL', 3], ['1B', 3], ['BL', 4], ['2B', 3], ['BL', 4], ['3B', 2], ['BL', 4], ['1B', 3], ['BL', 4], ['CH', 1], ['BL', 3]],
];

// Pays per coin before the diamond multiplier.
export const THREE = { '7': 80, '3B': 40, '2B': 25, '1B': 10, CH: 10 };
export const ANY_BAR = 5;
export const CHERRIES = [0, 2, 5, 10]; // by the number of cherries on the line, diamonds counted as cherries
export const THREE_DIAMONDS = 1000;
export const MULTIPLIER = 2; // per diamond in the win

const isBar = (s) => s === '3B' || s === '2B' || s === '1B';

// Returns [combination name, pay per coin]. Only the highest win is paid.
export function evaluate(line) {
  const d = line.filter((s) => s === 'DI').length;
  if (d === 3) return ['Diamond Diamond Diamond', THREE_DIAMONDS];
  const rest = line.filter((s) => s !== 'DI');
  const mult = MULTIPLIER ** d;
  const tag = d ? ` with ${d} diamond${d > 1 ? 's' : ''}` : '';
  let best = 0, name = '';
  const consider = (label, pay) => { if (pay * mult > best) { best = pay * mult; name = label; } };
  if (rest.every((s) => s === rest[0]) && THREE[rest[0]]) consider(rest[0] === 'CH' ? 'Three cherries' : `Three ${rest[0]}`, THREE[rest[0]]);
  if (rest.every(isBar)) consider('Any three bars', ANY_BAR);
  const cherries = rest.filter((s) => s === 'CH').length + d;
  if (cherries >= 1 && cherries <= 2) consider(cherries === 2 ? 'Two cherries' : 'One cherry', CHERRIES[cherries]);
  return best > 0 ? [name + tag, best] : ['No win', 0];
}

export function virtualReel(reel) {
  const map = [];
  reel.forEach(([, w], stop) => { for (let i = 0; i < w; i++) map.push(stop); });
  return map;
}

function main() {
  const maps = REELS.map((r, i) => {
    const m = virtualReel(r);
    if (r.length !== 22 || m.length !== VIRTUAL_STOPS) throw new Error(`reel ${i + 1}: ${r.length} stops, ${m.length} weights`);
    return m;
  });
  const tally = new Map();
  let total = 0, sum = 0, sumSq = 0, hits = 0;
  for (const v1 of maps[0].keys()) for (const v2 of maps[1].keys()) for (const v3 of maps[2].keys()) {
    const line = [REELS[0][maps[0][v1]][0], REELS[1][maps[1][v2]][0], REELS[2][maps[2][v3]][0]];
    const [name, pay] = evaluate(line);
    const t = tally.get(name) || { n: 0, pay }; t.n++; tally.set(name, t);
    total++; sum += pay; sumSq += pay * pay; if (pay > 0) hits++;
  }
  const rtp = sum / total, sd = Math.sqrt(sumSq / total - rtp * rtp);

  console.log('MACHINE D - Diamond Line (3 reels, 1 line, 64 virtual stops per reel)');
  console.log('Symbol weights per reel (of 64):');
  for (const sym of ['DI', '7', '3B', '2B', '1B', 'CH', 'BL']) {
    const w = REELS.map((r) => r.filter(([s]) => s === sym).reduce((t, [, x]) => t + x, 0));
    const n = REELS.map((r) => r.filter(([s]) => s === sym).length);
    console.log(`  ${sym.padEnd(3)} weights ${w.map((x) => String(x).padStart(2)).join(' ')}   physical stops ${n.join(' ')}`);
  }
  console.log(`\n${'Combination'.padEnd(32)} ${'Pays'.padStart(5)} ${'Count'.padStart(7)} ${'Probability'.padStart(12)} ${'Return'.padStart(9)}`);
  const rows = [...tally.entries()].sort((a, b) => b[1].pay - a[1].pay || b[1].n - a[1].n);
  for (const [name, { n, pay }] of rows)
    console.log(`${name.padEnd(32)} ${String(pay).padStart(5)} ${String(n).padStart(7)} ${(n / total).toFixed(8).padStart(12)} ${(n * pay / total).toFixed(6).padStart(9)}`);
  console.log(`${'Total'.padEnd(32)} ${''.padStart(5)} ${String(total).padStart(7)}`);
  console.log(`\nReturn to player: ${sum} / ${total} = ${(rtp * 100).toFixed(4)}%`);
  console.log(`Hit frequency:    ${hits} / ${total} = ${(hits / total * 100).toFixed(4)}%`);
  console.log(`Standard deviation per spin: ${sd.toFixed(4)} (units of the amount bet)`);
  console.log(`Top award (three diamonds): 1 in ${(total / tally.get('Diamond Diamond Diamond').n).toFixed(0)} spins`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
