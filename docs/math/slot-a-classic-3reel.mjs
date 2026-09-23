// Machine A, "Classic Sevens": 3 reels, 1 payline, 1-3 coins (pays scale linearly).
// Each reel has 22 physical stops (11 symbols alternating with 11 blanks). A
// 64-entry virtual reel maps random numbers to physical stops; a stop's weight is
// how many of the 64 virtual stops point at it. The whole cycle is 64^3 = 262,144
// equally likely outcomes, all enumerated below.
//
// Run: node slot-a-classic-3reel.mjs

import { pathToFileURL } from 'node:url';

export const VIRTUAL_STOPS = 64;

// [symbol, weight] for physical stops 0..21 on each reel.
// Symbols: 7 = red seven, 3B/2B/1B = triple/double/single bar, CH = cherry, BL = blank.
export const REELS = [
  [['7', 2], ['BL', 3], ['1B', 4], ['BL', 3], ['CH', 4], ['BL', 2], ['2B', 4], ['BL', 3], ['1B', 3], ['BL', 2], ['3B', 3],
   ['BL', 3], ['CH', 4], ['BL', 2], ['1B', 3], ['BL', 3], ['2B', 3], ['BL', 2], ['CH', 4], ['BL', 3], ['3B', 2], ['BL', 2]],
  [['7', 2], ['BL', 3], ['2B', 3], ['BL', 3], ['CH', 4], ['BL', 3], ['1B', 4], ['BL', 3], ['3B', 3], ['BL', 3], ['2B', 3],
   ['BL', 3], ['1B', 3], ['BL', 3], ['CH', 4], ['BL', 3], ['2B', 2], ['BL', 3], ['1B', 3], ['BL', 2], ['3B', 2], ['BL', 2]],
  [['7', 2], ['BL', 3], ['1B', 4], ['BL', 3], ['3B', 3], ['BL', 3], ['2B', 3], ['BL', 3], ['CH', 3], ['BL', 3], ['1B', 4],
   ['BL', 3], ['2B', 3], ['BL', 3], ['3B', 3], ['BL', 3], ['1B', 3], ['BL', 3], ['CH', 3], ['BL', 2], ['2B', 2], ['BL', 2]],
];

// Pays per coin bet. Only the highest win on the line is paid.
export const PAYS = {
  'Three 7s': 1000,
  'Three triple bars': 100,
  'Three double bars': 50,
  'Three single bars': 20,
  'Any three bars': 5,
  'Three cherries': 20,
  'Cherries on reels 1 and 2': 5,
  'Cherry on reel 1': 2,
};

const isBar = (s) => s === '3B' || s === '2B' || s === '1B';

// Returns [combination name, pay per coin] for the three payline symbols.
export function evaluate([a, b, c]) {
  if (a === '7' && b === '7' && c === '7') return ['Three 7s', PAYS['Three 7s']];
  if (a === '3B' && b === '3B' && c === '3B') return ['Three triple bars', PAYS['Three triple bars']];
  if (a === '2B' && b === '2B' && c === '2B') return ['Three double bars', PAYS['Three double bars']];
  if (a === '1B' && b === '1B' && c === '1B') return ['Three single bars', PAYS['Three single bars']];
  if (isBar(a) && isBar(b) && isBar(c)) return ['Any three bars', PAYS['Any three bars']];
  if (a === 'CH' && b === 'CH' && c === 'CH') return ['Three cherries', PAYS['Three cherries']];
  if (a === 'CH' && b === 'CH') return ['Cherries on reels 1 and 2', PAYS['Cherries on reels 1 and 2']];
  if (a === 'CH') return ['Cherry on reel 1', PAYS['Cherry on reel 1']];
  return ['No win', 0];
}

// Virtual reel: index 0..63 -> physical stop. This is the table the server uses:
// draw a uniform integer in [0, 64) per reel, look up the physical stop, and the
// client spins that reel to that stop.
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
    tally.set(name, (tally.get(name) || 0) + 1);
    total++; sum += pay; sumSq += pay * pay; if (pay > 0) hits++;
  }
  const rtp = sum / total, sd = Math.sqrt(sumSq / total - rtp * rtp);

  console.log('MACHINE A - Classic Sevens (3 reels, 1 line, 64 virtual stops per reel)');
  console.log('Symbol weights per reel (of 64):');
  for (const sym of ['7', '3B', '2B', '1B', 'CH', 'BL']) {
    const w = REELS.map((r) => r.filter(([s]) => s === sym).reduce((t, [, x]) => t + x, 0));
    const n = REELS.map((r) => r.filter(([s]) => s === sym).length);
    console.log(`  ${sym.padEnd(3)} weights ${w.map((x) => String(x).padStart(2)).join(' ')}   physical stops ${n.join(' ')}`);
  }
  console.log(`\n${'Combination'.padEnd(28)} ${'Pays'.padStart(5)} ${'Count'.padStart(7)} ${'Probability'.padStart(12)} ${'Return'.padStart(9)}`);
  for (const name of [...Object.keys(PAYS), 'No win']) {
    const n = tally.get(name) || 0, pay = PAYS[name] || 0;
    console.log(`${name.padEnd(28)} ${String(pay).padStart(5)} ${String(n).padStart(7)} ${(n / total).toFixed(8).padStart(12)} ${(n * pay / total).toFixed(6).padStart(9)}`);
  }
  console.log(`${'Total'.padEnd(28)} ${''.padStart(5)} ${String(total).padStart(7)}`);
  console.log(`\nReturn to player: ${sum} / ${total} = ${(rtp * 100).toFixed(4)}%`);
  console.log(`Hit frequency:    ${hits} / ${total} = ${(hits / total * 100).toFixed(4)}%`);
  console.log(`Standard deviation per spin: ${sd.toFixed(4)} (units of the amount bet)`);
  console.log(`Top award (three 7s): 1 in ${(total / tally.get('Three 7s')).toFixed(0)} spins`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
