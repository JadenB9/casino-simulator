// Poker hand category counts for evaluator tests: every 5-card hand
// (2,598,960) and every 7-card set (133,784,560, best five of seven).
// Run: node holdem-hand-counts.mjs     (about half a minute)

const NAMES = ['High card', 'One pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush',
  'Full house', 'Four of a kind', 'Straight flush', 'Royal flush'];

// STRAIGHT[mask] is true when the 13-bit rank mask holds five consecutive ranks
// (A-2-3-4-5 counts; bit 0 = deuce, bit 12 = ace).
const STRAIGHT = new Uint8Array(8192);
for (let m = 0; m < 8192; m++) {
  let ok = (m & 0b1000000001111) === 0b1000000001111; // wheel A-2-3-4-5
  for (let lo = 0; lo <= 8; lo++) if (((m >> lo) & 31) === 31) ok = true;
  STRAIGHT[m] = ok ? 1 : 0;
}
const ROYAL = 0b1111100000000;

const rankCount = new Int8Array(13);
const suitCount = new Int8Array(4);
const suitMask = new Int32Array(4);
const bucket = new Int32Array(5); // number of ranks held exactly k times
let rankMask = 0;

function add(c) {
  const r = c >> 2, s = c & 3, old = rankCount[r];
  bucket[old]--; bucket[old + 1]++; rankCount[r] = old + 1;
  if (old === 0) rankMask |= 1 << r;
  suitCount[s]++; suitMask[s] |= 1 << r;
}
function remove(c) {
  const r = c >> 2, s = c & 3, old = rankCount[r];
  bucket[old]--; bucket[old - 1]++; rankCount[r] = old - 1;
  if (old === 1) rankMask &= ~(1 << r);
  suitCount[s]--; suitMask[s] &= ~(1 << r);
}
function category() {
  for (let s = 0; s < 4; s++) if (suitCount[s] >= 5) {
    const m = suitMask[s];
    if ((m & ROYAL) === ROYAL) return 9;
    return STRAIGHT[m] ? 8 : 5;       // quads or a full house cannot coexist with a flush in 7 cards
  }
  if (bucket[4]) return 7;
  if (bucket[3] >= 2 || (bucket[3] && bucket[2])) return 6;
  if (STRAIGHT[rankMask]) return 4;
  if (bucket[3]) return 3;
  if (bucket[2] >= 2) return 2;
  if (bucket[2]) return 1;
  return 0;
}

function enumerate(k) {
  const counts = new Array(10).fill(0);
  bucket.fill(0); bucket[0] = 13;
  const rec = (start, depth) => {
    if (depth === k) { counts[category()]++; return; }
    for (let c = start; c <= 52 - (k - depth); c++) { add(c); rec(c + 1, depth + 1); remove(c); }
  };
  rec(0, 0);
  return counts;
}

for (const k of [5, 7]) {
  const t0 = Date.now();
  const counts = enumerate(k);
  const total = counts.reduce((a, b) => a + b, 0);
  console.log(`\n${k}-card hands: ${total.toLocaleString('en-US')} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  for (let c = 9; c >= 0; c--) console.log(`  ${NAMES[c].padEnd(16)} ${counts[c].toLocaleString('en-US').padStart(12)}  ${(counts[c] / total).toFixed(8)}`);
}
