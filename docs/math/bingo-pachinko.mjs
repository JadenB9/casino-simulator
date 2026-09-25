// Bingo and Pachinko: exact returns in integer arithmetic (BigInt), independent of the game code.
// docs/rules/parlour-games.md publishes what this prints.
//
//   Bingo     for one card and a uniformly shuffled 75-ball order: after n calls the card has k of
//             its 24 numbers marked with chance C(24, k) C(51, n - k) / C(75, n), every k-subset
//             of its cells equally likely. Four corners (4 cells) and blackout (24) are then
//             single ratios; a line counts the k-subsets holding one of the 12 lines, found here
//             by walking all 2^24 subsets of the card (the engine's tests do it by
//             inclusion-exclusion as well). Each pattern's prize bands then give its share.
//   Pachinko  one ball's tree: 20 pockets, 32 reel stops, and a chain of jackpots that goes on
//             while the jackpot's number (0-9) is odd, to at most 8.
//
// Run: node bingo-pachinko.mjs   (the 2^24 walk takes a few seconds)

const C = (n, k) => {
  if (k < 0 || k > n) return 0n;
  let r = 1n;
  for (let i = 1; i <= k; i++) r = (r * BigInt(n - k + i)) / BigInt(i);
  return r;
};
const gcd = (a, b) => (b === 0n ? a : gcd(b, a % b));
function percent(num, den, digits = 9) {
  const v = (num * 100n * 10n ** BigInt(digits) * 10n) / den;
  const r = (v + 5n) / 10n;
  const s = r.toString().padStart(digits + 1, '0');
  return `${s.slice(0, -digits)}.${s.slice(-digits)}`;
}

// ---------------------------------------------------------------------------------------------
// Bingo

const FREE = 12;
const lines = [];
for (let r = 0; r < 5; r++) lines.push([0, 1, 2, 3, 4].map((c) => r * 5 + c));
for (let c = 0; c < 5; c++) lines.push([0, 1, 2, 3, 4].map((r) => r * 5 + c));
lines.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);
const bit = (cell) => (cell < FREE ? cell : cell - 1);
const masks = lines.map((l) => l.filter((c) => c !== FREE).reduce((m, c) => m | (1 << bit(c)), 0));

// k-subsets of the 24 numbered cells that hold a whole line
const withLine = new Array(25).fill(0n);
const pop = (x) => {
  let n = 0;
  for (let b = x; b; b &= b - 1) n++;
  return n;
};
for (let s = 0; s < 1 << 24; s++) {
  for (const m of masks) {
    if ((s & m) === m) {
      withLine[pop(s)]++;
      break;
    }
  }
}

/** P(pattern complete after n calls) as [num, den]. */
function by(p, n) {
  if (n <= 0) return [0n, 1n];
  if (p === 'corners') return [C(n, 4), C(75, 4)];
  if (p === 'blackout') return [C(n, 24), C(75, 24)];
  let num = 0n;
  for (let k = 0; k <= 24; k++) num += withLine[k] * C(51, n - k);
  return [num, C(75, n)];
}

const PRIZES = {
  line: [[12, 5000], [16, 2000], [20, 800], [25, 300], [30, 150], [35, 80], [40, 40]],
  corners: [[12, 10000], [16, 4000], [20, 1200], [25, 500], [30, 200], [35, 50]],
  blackout: [[45, 2000000], [50, 250000], [55, 20000]],
};

// a common denominator for the whole card: every P(by n) is over C(75, n) or C(75, 4) or C(75, 24)
let total = [0n, 1n];
const add = ([a, b], [c, d]) => {
  const n = a * d + c * b;
  const m = b * d;
  const g = gcd(n, m);
  return [n / g, m / g];
};
console.log('Bingo, one card (prizes in multiples of the price)');
for (const p of ['line', 'corners', 'blackout']) {
  let share = [0n, 1n];
  let from = 0;
  for (const [upTo, mult] of PRIZES[p]) {
    const [a, b] = by(p, upTo);
    const [c, d] = by(p, from);
    const chance = [a * d - c * b, b * d];
    share = add(share, [chance[0] * BigInt(mult), chance[1] * 100n]);
    console.log(`  ${p.padEnd(8)} calls ${String(from + 1).padStart(2)}-${String(upTo).padEnd(2)} pays ${String(mult / 100).padStart(6)}x  chance ${percent(chance[0], chance[1], 7)}%`);
    from = upTo;
  }
  console.log(`  ${p} share of the return: ${percent(share[0], share[1])}%`);
  total = add(total, share);
}
console.log(`  RETURN ${percent(total[0], total[1])}%  (exact: ${total[0]}/${total[1]})`);
const expLine = Array.from({ length: 75 }, (_, n) => by('line', n)).reduce((acc, [a, b]) => acc + Number((b - a) * 10n ** 12n / b) / 1e12, 0);
console.log(`  a card's first line comes on call ${expLine.toFixed(3)} on average`);

// ---------------------------------------------------------------------------------------------
// Pachinko

console.log('\nPachinko, one ball (balls back per ball bought)');
// pockets: 1/20 start (4 balls), 1/20 left tulip (3), 1/20 right tulip (3); reels 1/32; chain on odd of 0-9 up to 8
let num = 0n;
const den = 20n * 32n * 10n ** 8n;
// walk the chain: at depth d (1-based), 5 odd digits go on (unless d = 8), 5 even end it
function chain(depth, ways) {
  // ways: number of digit sequences reaching this jackpot, out of 10^(depth-1)
  const wEven = ways * 5n;
  const wOdd = ways * 5n;
  const scale = 10n ** BigInt(8 - depth);
  if (depth === 8) return (wEven + wOdd) * BigInt(8 * 150) * scale;
  return wEven * BigInt(depth * 150) * scale + chain(depth + 1, wOdd);
}
num += 2n * 3n * 32n * 10n ** 8n; // tulips
num += 1n * 4n * 32n * 10n ** 8n; // the start pocket's own 4 balls
num += chain(1, 1n); // jackpots, over 10^8 for the digits and 1 reel stop of 32
console.log(`  tulips ${percent(2n * 3n, 20n)}%, start pocket ${percent(4n, 20n)}%, jackpots ${percent(chain(1, 1n), den)}%`);
console.log(`  RETURN ${percent(num, den, 11)}%`);
