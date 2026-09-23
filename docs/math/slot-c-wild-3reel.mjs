// Machine C, "5x Wild": high-volatility 3-reel, 1 payline, 1-3 coins (linear).
// 22 physical stops per reel, 72 virtual stops per reel, cycle 72^3 = 373,248.
// The 5X symbol is wild for 7s and bars and multiplies the win: one 5X pays x5,
// two pay x25. Three 5X pay the top award.
//
// Run: node slot-c-wild-3reel.mjs

import { pathToFileURL } from 'node:url';

export const VIRTUAL_STOPS = 72;

// [symbol, weight] for physical stops 0..21. WX = 5X wild, BL = blank.
export const REELS = [
  [['WX', 2], ['BL', 4], ['1B', 3], ['BL', 5], ['2B', 2], ['BL', 4], ['7', 2], ['BL', 5], ['1B', 3], ['BL', 4], ['3B', 2],
   ['BL', 5], ['1B', 2], ['BL', 4], ['2B', 2], ['BL', 5], ['1B', 2], ['BL', 4], ['3B', 1], ['BL', 5], ['2B', 2], ['BL', 4]],
  [['WX', 2], ['BL', 4], ['2B', 2], ['BL', 5], ['1B', 3], ['BL', 4], ['3B', 2], ['BL', 5], ['1B', 2], ['BL', 4], ['7', 2],
   ['BL', 5], ['2B', 2], ['BL', 4], ['1B', 2], ['BL', 5], ['3B', 2], ['BL', 4], ['1B', 2], ['BL', 5], ['2B', 2], ['BL', 4]],
  [['WX', 1], ['BL', 5], ['1B', 3], ['BL', 4], ['3B', 2], ['BL', 5], ['2B', 2], ['BL', 4], ['1B', 3], ['BL', 5], ['7', 2],
   ['BL', 4], ['1B', 2], ['BL', 5], ['2B', 2], ['BL', 4], ['3B', 2], ['BL', 5], ['1B', 2], ['BL', 4], ['2B', 2], ['BL', 4]],
];

// Base pays per coin; the multiplier applies when 5X symbols complete the win.
export const BASE = { '7': 100, '3B': 40, '2B': 25, '1B': 10 };
export const ANY_BAR = 5;
export const THREE_WILDS = 5000;
export const TWO_WILDS_ONLY = 10;   // two 5X with a symbol they cannot complete (for example a blank)
export const ONE_WILD_ONLY = 2;     // one 5X and no other win

const isBar = (s) => s === '3B' || s === '2B' || s === '1B';

// Returns [combination name, pay per coin]. Only the highest win is paid.
export function evaluate(line) {
  const wilds = line.filter((s) => s === 'WX').length;
  if (wilds === 3) return ['5X 5X 5X', THREE_WILDS];
  const rest = line.filter((s) => s !== 'WX');
  const mult = 5 ** wilds;
  let best = 0, name = '';
  if (rest.every((s) => s === rest[0]) && BASE[rest[0]]) { best = BASE[rest[0]] * mult; name = `Three ${rest[0]}`; }
  if (rest.every(isBar) && ANY_BAR * mult > best) { best = ANY_BAR * mult; name = 'Any three bars'; }
  if (best > 0) return [wilds ? `${name} with ${wilds} wild` : name, best];
  if (wilds === 2) return ['Two 5X, no line win', TWO_WILDS_ONLY];
  if (wilds === 1) return ['One 5X, no line win', ONE_WILD_ONLY];
  return ['No win', 0];
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

  console.log('MACHINE C - 5x Wild (3 reels, 1 line, 72 virtual stops per reel)');
  console.log('Symbol weights per reel (of 72):');
  for (const sym of ['WX', '7', '3B', '2B', '1B', 'BL']) {
    const w = REELS.map((r) => r.filter(([s]) => s === sym).reduce((t, [, x]) => t + x, 0));
    const n = REELS.map((r) => r.filter(([s]) => s === sym).length);
    console.log(`  ${sym.padEnd(3)} weights ${w.map((x) => String(x).padStart(2)).join(' ')}   physical stops ${n.join(' ')}`);
  }
  console.log(`\n${'Combination'.padEnd(30)} ${'Pays'.padStart(5)} ${'Count'.padStart(7)} ${'Probability'.padStart(12)} ${'Return'.padStart(9)}`);
  const rows = [...tally.entries()].sort((a, b) => b[1].pay - a[1].pay || b[1].n - a[1].n);
  for (const [name, { n, pay }] of rows)
    console.log(`${name.padEnd(30)} ${String(pay).padStart(5)} ${String(n).padStart(7)} ${(n / total).toFixed(8).padStart(12)} ${(n * pay / total).toFixed(6).padStart(9)}`);
  console.log(`${'Total'.padEnd(30)} ${''.padStart(5)} ${String(total).padStart(7)}`);
  console.log(`\nReturn to player: ${sum} / ${total} = ${(rtp * 100).toFixed(4)}%`);
  console.log(`Hit frequency:    ${hits} / ${total} = ${(hits / total * 100).toFixed(4)}%`);
  console.log(`Standard deviation per spin: ${sd.toFixed(4)} (units of the amount bet)`);
  console.log(`Top award (three 5X): 1 in ${(total / tally.get('5X 5X 5X').n).toFixed(0)} spins`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
