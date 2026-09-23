// Three Card Poker: exact analysis by full enumeration.
// Every player hand (22,100) against every dealer hand from the remaining
// 49 cards (18,424) = 407,170,400 deals.
//
// Rules modelled: Ante and Play (Play = Ante), dealer qualifies with queen
// high or better, dealer not qualifying pays Ante 1:1 and pushes Play,
// Ante Bonus 5/4/1 (straight flush/trips/straight) paid when the player
// plays, regardless of the dealer's hand.
//
// Run: node three-card-poker.mjs

const RANKS = '23456789TJQKA';
const rankOf = (c) => c >> 2;   // 0 = deuce ... 12 = ace
const suitOf = (c) => c & 3;

// Categories, high to low: straight flush 5, trips 4, straight 3, flush 2,
// pair 1, high card 0.
const CAT_NAMES = ['High card', 'Pair', 'Flush', 'Straight', 'Three of a kind', 'Straight flush'];

// Returns an integer; a larger value is a better hand, equal values tie.
function score(a, b, c) {
  let r = [rankOf(a), rankOf(b), rankOf(c)].sort((x, y) => y - x);
  const flush = suitOf(a) === suitOf(b) && suitOf(b) === suitOf(c);
  let straightTop = -1;
  if (r[0] - r[1] === 1 && r[1] - r[2] === 1) straightTop = r[0];
  if (r[0] === 12 && r[1] === 1 && r[2] === 0) straightTop = 1; // A-2-3 is the lowest straight
  let cat, tie;
  if (straightTop >= 0 && flush) { cat = 5; tie = straightTop; }
  else if (r[0] === r[2]) { cat = 4; tie = r[0]; }
  else if (straightTop >= 0) { cat = 3; tie = straightTop; }
  else if (flush) { cat = 2; tie = r[0] * 169 + r[1] * 13 + r[2]; }
  else if (r[0] === r[1] || r[1] === r[2]) {
    const pair = r[1];
    const kicker = r[0] === r[1] ? r[2] : r[0];
    cat = 1; tie = pair * 13 + kicker;
  } else { cat = 0; tie = r[0] * 169 + r[1] * 13 + r[2]; }
  return cat * 2197 + tie;
}
const category = (s) => Math.floor(s / 2197);

// All 3-card hands.
const hands = [];
for (let a = 0; a < 52; a++)
  for (let b = a + 1; b < 52; b++)
    for (let c = b + 1; c < 52; c++) {
      const s = score(a, b, c);
      const lo = (a < 32 ? 1 << a : 0) | (b < 32 ? 1 << b : 0) | (c < 32 ? 1 << c : 0);
      const hi = (a >= 32 ? 1 << (a - 32) : 0) | (b >= 32 ? 1 << (b - 32) : 0) | (c >= 32 ? 1 << (c - 32) : 0);
      hands.push({ a, b, c, s, lo, hi });
    }
const N = hands.length; // 22100

// Queen-high threshold for the dealer, Q-6-4 threshold for the player.
const QUEEN_HIGH_MIN = 0 * 2197 + 10 * 169 + 1 * 13 + 0; // Q-3-2, the lowest queen-high hand
const Q64 = 0 * 2197 + 10 * 169 + 4 * 13 + 2;            // Q-6-4

const bonus = (cat) => (cat === 5 ? 5 : cat === 4 ? 4 : cat === 3 ? 1 : 0);

// Hand frequencies.
const catCount = new Array(6).fill(0);
for (const h of hands) catCount[category(h.s)]++;

// Enumerate.
const dist = new Map();           // net result (in antes) -> weight
let optimalEvSum = 0;             // sum over player hands of max(EV(play), -1) * 18424
let q64Agrees = true;
let lowestPlay = null;            // weakest hand for which playing is better than folding
const add = (k, w) => dist.set(k, (dist.get(k) || 0) + w);
const outcome = { win: 0, tie: 0, lose: 0, noQualify: 0, fold: 0 };

for (let i = 0; i < N; i++) {
  const p = hands[i];
  const pcat = category(p.s);
  let win = 0, tie = 0, lose = 0, nq = 0;
  for (let j = 0; j < N; j++) {
    const d = hands[j];
    if ((p.lo & d.lo) | (p.hi & d.hi)) continue;
    if (d.s < QUEEN_HIGH_MIN) nq++;
    else if (p.s > d.s) win++;
    else if (p.s === d.s) tie++;
    else lose++;
  }
  const total = win + tie + lose + nq; // 18424
  const b = bonus(pcat);
  const evPlay = (b * total + nq * 1 + win * 2 - lose * 2) / total;
  const shouldPlay = evPlay > -1;
  const q64Play = p.s >= Q64;
  if (shouldPlay !== q64Play) q64Agrees = false;
  if (shouldPlay && (lowestPlay === null || p.s < lowestPlay.s)) lowestPlay = p;
  optimalEvSum += Math.max(evPlay, -1) * total;

  // Distribution under the Q-6-4 rule.
  if (q64Play) {
    add(b + 1, nq); add(b + 2, win); add(b + 0, tie); add(b - 2, lose);
    outcome.win += win; outcome.tie += tie; outcome.lose += lose; outcome.noQualify += nq;
  } else {
    add(-1, total);
    outcome.fold += total;
  }
}

const TOTAL = N * 18424;
let mean = 0, m2 = 0, playWeight = 0, numerator = 0;
for (const [k, w] of dist) { mean += k * w; m2 += k * k * w; numerator += k * w; }
mean /= TOTAL; m2 /= TOTAL;
const sd = Math.sqrt(m2 - mean * mean);
playWeight = outcome.win + outcome.tie + outcome.lose + outcome.noQualify;
const avgWager = 1 + playWeight / TOTAL;

const nameOf = (h) => [h.a, h.b, h.c].map((c) => RANKS[rankOf(c)]).sort((x, y) => RANKS.indexOf(y) - RANKS.indexOf(x)).join('-');

console.log('THREE CARD POKER - exact enumeration');
console.log('Player/dealer deals enumerated:', TOTAL.toLocaleString('en-US'));
console.log('\n3-card hand frequencies (of 22,100):');
for (let k = 5; k >= 0; k--) console.log(`  ${CAT_NAMES[k].padEnd(16)} ${String(catCount[k]).padStart(6)}  ${(catCount[k] / N).toFixed(6)}`);
console.log('\nOptimal play/fold decision matches "play Q-6-4 or better":', q64Agrees);
console.log('Weakest hand worth playing:', nameOf(lowestPlay));
console.log('\nAnte & Play, Ante Bonus 1/4/5, Q-6-4 strategy (units = one Ante):');
const keys = [...dist.keys()].sort((x, y) => x - y);
for (const k of keys) {
  const w = dist.get(k);
  console.log(`  net ${String(k).padStart(3)}  ${String(w).padStart(11)}  ${(w / TOTAL).toFixed(6)}  ${(k * w / TOTAL).toFixed(6)}`);
}
console.log(`  expected value per Ante      ${mean.toFixed(6)}  = ${numerator} / ${TOTAL}  (house edge ${(-mean * 100).toFixed(4)}%)`);
console.log(`  optimal-decision EV check    ${(optimalEvSum / TOTAL).toFixed(6)}`);
console.log(`  average total wager (antes)  ${avgWager.toFixed(6)}`);
console.log(`  element of risk              ${(-mean / avgWager * 100).toFixed(4)}%`);
console.log(`  standard deviation per round ${sd.toFixed(4)} antes`);
console.log(`  P(play) ${(playWeight / TOTAL).toFixed(6)}  P(fold) ${(outcome.fold / TOTAL).toFixed(6)}`);
console.log(`  dealer does not qualify (when played) ${(outcome.noQualify / TOTAL).toFixed(6)}`);

// Pair Plus: depends only on the player's three cards.
console.log('\nPair Plus pay tables (straight flush-trips-straight-flush-pair):');
const tables = [
  [40, 30, 6, 4, 1], [35, 33, 6, 4, 1], [40, 25, 6, 4, 1], [35, 25, 6, 4, 1],
  [50, 30, 6, 3, 1], [40, 30, 5, 4, 1], [40, 25, 5, 4, 1], [40, 30, 6, 3, 1],
];
for (const t of tables) {
  const pays = { 5: t[0], 4: t[1], 3: t[2], 2: t[3], 1: t[4], 0: -1 };
  let e = 0, e2 = 0;
  for (let k = 0; k <= 5; k++) { e += pays[k] * catCount[k]; e2 += pays[k] * pays[k] * catCount[k]; }
  const ev = e / N; const v = e2 / N - ev * ev;
  console.log(`  ${t.join('-').padEnd(12)} EV ${ev.toFixed(6)} (edge ${(-ev * 100).toFixed(2)}%, exact ${e}/22100)  SD ${Math.sqrt(v).toFixed(4)}  hit ${( (N - catCount[0]) / N * 100).toFixed(2)}%`);
}
