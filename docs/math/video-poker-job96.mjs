// Jacks or Better 9/6 video poker: exact analysis.
//
// 1. Optimal play: for every one of the 2,598,960 deals, the expected value of
//    all 32 ways to hold is computed exactly (every possible draw from the 47
//    unseen cards), and the best hold is kept.
// 2. The ordered hold list in RULES.md is coded and scored the same way, so
//    its exact return is known, not estimated.
//
// Method: count, for every subset of up to 5 cards, how many final 5-card
// hands contain it (by pay category). The number of final hands that contain
// the held cards and none of the discarded cards then follows from
// inclusion-exclusion over the discards.
//
// Run: node video-poker-job96.mjs            (5 coins: royal pays 4000 = 800 per coin)
//      node video-poker-job96.mjs --royal=250 (1-4 coins: royal pays 250 per coin)
//      node video-poker-job96.mjs --hand=As,Ks,Qs,Js,5s   (exact EV of every hold for one deal)
// Takes well under a minute.

const royalArg = process.argv.find((a) => a.startsWith('--royal='));
const PAY = [0, 1, 2, 3, 4, 6, 9, 25, 50, royalArg ? Number(royalArg.split('=')[1]) : 800]; // per coin
const CAT = ['Nothing', 'Jacks or better', 'Two pair', 'Three of a kind', 'Straight', 'Flush',
  'Full house', 'Four of a kind', 'Straight flush', 'Royal flush'];
const NC = 10;
const RANKS = '23456789TJQKA';
const SUITS = 'cdhs';
const T = 8, J = 9, Q = 10, K = 11, A = 12;

// Binomials.
const Cb = [];
for (let n = 0; n <= 52; n++) {
  Cb.push(new Array(6).fill(0));
  Cb[n][0] = 1;
  for (let k = 1; k <= 5 && k <= n; k++) Cb[n][k] = Cb[n - 1][k - 1] + (k <= n - 1 ? Cb[n - 1][k] : 0);
}
const C47 = [1, 47, 1081, 16215, 178365, 1533939]; // C(47, k)

// Category of a 5-card hand.
const cnt = new Int8Array(13);
function category(h) {
  cnt.fill(0);
  let mask = 0, flush = true;
  for (let i = 0; i < 5; i++) { const r = h[i] >> 2; cnt[r]++; mask |= 1 << r; if ((h[i] & 3) !== (h[0] & 3)) flush = false; }
  let pairs = 0, trips = 0, quads = 0, highPair = false, distinct = 0;
  for (let r = 0; r < 13; r++) {
    if (cnt[r]) distinct++;
    if (cnt[r] === 2) { pairs++; if (r >= J) highPair = true; }
    else if (cnt[r] === 3) trips++;
    else if (cnt[r] === 4) quads++;
  }
  let straight = false;
  if (distinct === 5) {
    const lo = 31 - Math.clz32(mask & -mask), hi = 31 - Math.clz32(mask);
    if (hi - lo === 4 || mask === 0b1000000001111) straight = true;
  }
  if (straight && flush) return mask === 0b1111100000000 ? 9 : 8;
  if (quads) return 7;
  if (trips && pairs) return 6;
  if (flush) return 5;
  if (straight) return 4;
  if (trips) return 3;
  if (pairs === 2) return 2;
  if (highPair) return 1;
  return 0;
}

// Subset counts: cntK[k][idx * NC + cat] = number of final hands containing
// the k-subset with colex index idx, by category.
const cntK = [new Float64Array(NC), new Int32Array(52 * NC), new Int32Array(1326 * NC),
  new Int32Array(22100 * NC), new Int32Array(270725 * NC)];
const cat5 = new Uint8Array(2598960);
const hand = [0, 0, 0, 0, 0];
let idx5 = 0;
for (let e = 4; e < 52; e++) for (let d = 3; d < e; d++) for (let c = 2; c < d; c++)
  for (let b = 1; b < c; b++) for (let a = 0; a < b; a++) {
    hand[0] = a; hand[1] = b; hand[2] = c; hand[3] = d; hand[4] = e;
    const cat = category(hand);
    cat5[idx5++] = cat;
    for (let m = 0; m < 31; m++) {
      let k = 0, idx = 0;
      for (let i = 0; i < 5; i++) if (m & (1 << i)) { k++; idx += Cb[hand[i]][k]; }
      cntK[k][idx * NC + cat]++;
    }
  }

// Payout-weighted versions.
const payK = cntK.map((arr) => {
  const out = new Float64Array(arr.length / NC);
  for (let i = 0; i < out.length; i++) { let s = 0; for (let c = 0; c < NC; c++) s += PAY[c] * arr[i * NC + c]; out[i] = s; }
  return out;
});

const popcount = (m) => { let n = 0; while (m) { n += m & 1; m >>= 1; } return n; };
const POP = Array.from({ length: 32 }, (_, m) => popcount(m));
// Weight that turns "final hands for this hold" into a common denominator of
// 5 * C(47,5) per deal, matching the combination counts published by Wizard of Odds.
const WEIGHT = [5, 43, 473, 7095, 163185, 7669695];

// ---------- the hold-order list (see RULES.md) ----------
// Entry numbers follow the published optimal list; lower is better.
function isSfWindow(rs) { // rs: distinct ranks ascending
  const lo = rs[0], hi = rs[rs.length - 1];
  if (hi - lo <= 4) return true;
  if (hi === A) { const lo2 = -1, hi2 = rs[rs.length - 2]; return hi2 - lo2 <= 4; }
  return false;
}
function sf3Type(rs) { // 3 distinct suited ranks ascending, known to fit a window
  if (rs[2] === A && rs[2] - rs[0] > 4) return 2;          // ace low
  if (rs[0] === 0 && rs[1] === 1 && rs[2] === 2) return 2;   // 2-3-4
  const gaps = rs[2] - rs[0] - 2;
  let high = 0; for (const r of rs) if (r >= J) high++;
  if (high >= gaps) return 1;
  if ((gaps === 1 && high === 0) || (gaps === 2 && high === 1)) return 2;
  return 3;
}
const NONE = 999;

// Returns the list entry for holding `m` from the dealt hand (ranks rk, suits st,
// dealt category cat). NONE means the hold never appears in the list.
function entryOptimal(m, rk, st, cat) {
  const n = POP[m];
  if (n === 0) return 36;
  if (n === 5) {
    if (cat === 9) return 1; if (cat === 8) return 2; if (cat === 6) return 5;
    if (cat === 5) return 6; if (cat === 4) return 8; return NONE;
  }
  const rs = [], ss = [];
  for (let i = 0; i < 5; i++) if (m & (1 << i)) { rs.push(rk[i]); ss.push(st[i]); }
  rs.sort((x, y) => x - y);
  const suited = ss.every((s) => s === ss[0]);
  let distinct = true; for (let i = 1; i < n; i++) if (rs[i] === rs[i - 1]) distinct = false;
  let high = 0; for (const r of rs) if (r >= J) high++;
  const has = (...want) => want.length === n && want.every((w, i) => rs[i] === w);

  if (n === 4) {
    if (rs[0] === rs[3]) return 3;                                       // four of a kind
    if (!distinct) {
      if (rs[0] === rs[1] && rs[2] === rs[3]) return 10;                 // two pair
      return NONE;
    }
    if (suited && rs[0] >= T) return 4;                                  // 4 to a royal
    if (suited && isSfWindow(rs)) return 9;                              // 4 to a straight flush
    if (suited) return 13;                                               // 4 to a flush
    if (has(T, J, Q, K)) return 14;                                      // unsuited TJQK
    const outside = rs[3] - rs[0] === 3 && rs[3] !== A;
    if (outside) return 16;                                              // 4 to outside straight, 0-2 high
    if (has(J, Q, K, A)) return 19;                                      // inside straight, 4 high
    if (isSfWindow(rs) && high === 3) return 22;                         // inside straight, 3 high
    return NONE;
  }
  if (n === 3) {
    if (rs[0] === rs[2]) return 7;                                       // three of a kind
    if (!distinct) return NONE;
    if (suited && rs[0] >= T) return 12;                                 // 3 to a royal
    if (suited && isSfWindow(rs)) { const t = sf3Type(rs); return t === 1 ? 17 : t === 2 ? 23 : 35; }
    if (has(J, Q, K)) return 24;                                         // unsuited JQK
    return NONE;
  }
  if (n === 2) {
    if (rs[0] === rs[1]) return rs[0] >= J ? 11 : 15;                    // high pair / low pair
    if (suited) {
      if (has(J, Q)) return 18;
      if (has(Q, K) || has(J, K)) return 20;
      if (has(K, A) || has(Q, A) || has(J, A)) return 21;
      if (has(T, J)) return 26;
      if (has(T, Q)) return 28;
      if (has(T, K)) return 31;
      return NONE;
    }
    if (has(J, Q)) return 25;
    if (has(Q, K) || has(J, K)) return 27;
    if (has(K, A) || has(Q, A) || has(J, A)) return 29;
    return NONE;
  }
  // n === 1
  if (rs[0] === J) return 30; if (rs[0] === Q) return 32; if (rs[0] === K) return 33; if (rs[0] === A) return 34;
  return NONE;
}

// Penalty-card exceptions (footnotes A-F of the list). Each one moves a hold to a
// fractional position between two list lines for the specific hands it covers.
function withExceptions(m, e, rk, st) {
  if (e !== 12 && e !== 18 && e !== 23 && e !== 26 && e !== 28 && e !== 31) return e;
  const held = [], disc = [];
  for (let i = 0; i < 5; i++) (m & (1 << i) ? held : disc).push(i);
  const suit = st[held[0]];
  const hr = held.map((i) => rk[i]).sort((x, y) => x - y);
  const flushPenalty = disc.some((i) => st[i] === suit);
  if (e === 12) {
    // A: 3 to a royal holding both the T and the A loses to 4 to a flush when the
    // off-suit fifth card is a T or one of the two missing royal ranks.
    if (hr[0] !== T || hr[2] !== A) return e;
    const same = disc.filter((i) => st[i] === suit), other = disc.filter((i) => st[i] !== suit);
    if (same.length !== 1 || other.length !== 1) return e;
    const r = rk[other[0]];
    return r === T || ((r === J || r === Q || r === K) && !hr.includes(r)) ? 13.5 : e;
  }
  if (e === 18) {
    // B: suited QJ with an off-suit K and A loses to J-Q-K-A when the fifth card
    // is a 9 or a flush penalty card.
    const dr = disc.map((i) => rk[i]);
    if (!(dr.includes(K) && dr.includes(A))) return e;
    const fifth = disc.find((i) => rk[i] !== K && rk[i] !== A);
    return fifth !== undefined && (rk[fifth] === 7 || st[fifth] === suit) ? 19.5 : e;
  }
  if (e === 23) {
    // C: 3 to a straight flush spanning 5 ranks with 1 high card beats 4 to an inside
    // straight with 3 high cards, unless a discard is a straight penalty card
    // (a rank that fills the straight-flush draw's window).
    let high = 0; for (const r of hr) if (r >= J) high++;
    if (hr[2] - hr[0] !== 4 || high !== 1) return e;
    const penalty = disc.some((i) => rk[i] > hr[0] && rk[i] < hr[2] && !hr.includes(rk[i]));
    return penalty ? e : 21.5;
  }
  // D: suited TJ drops below unsuited KJ with a flush penalty card.
  if (e === 26) return flushPenalty ? 27.5 : e;
  // E: suited TQ drops below unsuited AQ with a flush penalty card.
  if (e === 28) return flushPenalty ? 29.5 : e;
  // F: suited TK drops below K alone when a 9 and a flush penalty card are discarded.
  if (e === 31) return flushPenalty && disc.some((i) => rk[i] === 7) ? 33.5 : e;
  return e;
}

function entrySimple(m, rk, st, cat) {
  const n = POP[m];
  if (n === 0) return 16;
  if (n === 5) {
    if (cat === 9 || cat === 8) return 1;
    if (cat === 6 || cat === 5 || cat === 4) return 3;
    return NONE;
  }
  // Trips share line 3 with dealt made hands; ranking trips at 3.1 keeps a dealt full house whole.
  const rs = [], ss = [];
  for (let i = 0; i < 5; i++) if (m & (1 << i)) { rs.push(rk[i]); ss.push(st[i]); }
  rs.sort((x, y) => x - y);
  const suited = ss.every((s) => s === ss[0]);
  let distinct = true; for (let i = 1; i < n; i++) if (rs[i] === rs[i - 1]) distinct = false;
  let high = 0; for (const r of rs) if (r >= J) high++;
  if (n === 4) {
    if (rs[0] === rs[3]) return 1;
    if (!distinct) return rs[0] === rs[1] && rs[2] === rs[3] ? 5 : NONE;
    if (suited && rs[0] >= T) return 2;
    if (suited && isSfWindow(rs)) return 4;
    if (suited) return 8;
    if (rs[3] - rs[0] === 3 && rs[3] !== A) return 10;
    return NONE;
  }
  if (n === 3) {
    if (rs[0] === rs[2]) return 3.1;
    if (!distinct) return NONE;
    if (suited && rs[0] >= T) return 7;
    if (suited && isSfWindow(rs)) return 12;
    return NONE;
  }
  if (n === 2) {
    if (rs[0] === rs[1]) return rs[0] >= J ? 6 : 9;
    if (high === 2) return suited ? 11 : 13 + (rs[0] + rs[1]) / 100;  // prefer the lowest two
    if (suited && rs[0] === T && rs[1] >= J && rs[1] <= K) return 14;
    return NONE;
  }
  return rs[0] >= J ? 15 : NONE;                                     // one high card
}

// ---------- single-hand mode ----------
const handArg = process.argv.find((a) => a.startsWith('--hand='));
if (handArg) {
  const parse = (t) => RANKS.indexOf(t[0].toUpperCase()) * 4 + SUITS.indexOf(t[1].toLowerCase());
  const cards = handArg.slice(7).split(',').map(parse).sort((x, y) => x - y);
  if (cards.length !== 5 || cards.some((c) => c < 0) || new Set(cards).size !== 5) throw new Error('need 5 distinct cards like As,Ks,Qs,Js,5s');
  const Wm = new Float64Array(32);
  for (let m = 0; m < 32; m++) {
    let k = 0, idx = 0;
    for (let i = 0; i < 5; i++) if (m & (1 << i)) { k++; idx += Cb[cards[i]][k]; }
    Wm[m] = k === 5 ? PAY[cat5[idx]] : k === 0 ? payK[0][0] : payK[k][idx];
  }
  for (let bit = 1; bit < 32; bit <<= 1) for (let m = 0; m < 32; m++) if (!(m & bit)) Wm[m] -= Wm[m | bit];
  const name = (c) => RANKS[c >> 2] + SUITS[c & 3];
  const holds = [...Array(32).keys()].map((m) => ({ m, ev: Wm[m] / C47[5 - POP[m]] })).sort((a, b) => b.ev - a.ev);
  console.log(`Deal: ${cards.map(name).join(' ')}  (royal ${PAY[9]} per coin)`);
  for (const { m, ev } of holds.slice(0, 8))
    console.log(`  hold [${[0, 1, 2, 3, 4].filter((i) => m & (1 << i)).map((i) => name(cards[i])).join(' ') || 'nothing'}]  EV ${ev.toFixed(6)}`);
  process.exit(0);
}

// ---------- main loop over all deals ----------
const W = new Float64Array(32);
const f = new Float64Array(32);
const subIdx = new Int32Array(32);
const subK = new Int8Array(32);
const rk = [0, 0, 0, 0, 0], st = [0, 0, 0, 0, 0];

const strategies = {
  optimal: { sum: 0, dist: new Float64Array(NC) },
  listNoExceptions: { sum: 0, dist: new Float64Array(NC), wrong: 0, ambiguous: 0 },
  listWithExceptions: { sum: 0, dist: new Float64Array(NC), wrong: 0, ambiguous: 0 },
  simple: { sum: 0, dist: new Float64Array(NC), wrong: 0, ambiguous: 0 },
};

function addDist(dist, m, nHeld) {
  // final-hand categories for hold m: inclusion-exclusion over supersets
  for (let s = m; s < 32; s = (s + 1) | m) {
    const sign = (POP[s] - nHeld) & 1 ? -1 : 1;
    if (s === 31) dist[cat5[subIdx[31]]] += sign * WEIGHT[nHeld];
    else { const k = subK[s], base = subIdx[s] * NC, arr = cntK[k]; for (let c = 0; c < NC; c++) dist[c] += sign * arr[base + c] * WEIGHT[nHeld]; }
  }
}

const EXAMPLES = { listNoExceptions: [], listWithExceptions: [] };
const cardName = (c) => RANKS[c >> 2] + SUITS[c & 3];

let deal = 0;
for (let e = 4; e < 52; e++) for (let d = 3; d < e; d++) for (let c = 2; c < d; c++)
  for (let b = 1; b < c; b++) for (let a = 0; a < b; a++) {
    hand[0] = a; hand[1] = b; hand[2] = c; hand[3] = d; hand[4] = e;
    for (let i = 0; i < 5; i++) { rk[i] = hand[i] >> 2; st[i] = hand[i] & 3; }
    for (let m = 0; m < 32; m++) {
      let k = 0, idx = 0;
      for (let i = 0; i < 5; i++) if (m & (1 << i)) { k++; idx += Cb[hand[i]][k]; }
      subIdx[m] = idx; subK[m] = k;
      W[m] = k === 5 ? PAY[cat5[idx]] : k === 0 ? payK[0][0] : payK[k][idx];
    }
    // Möbius transform over supersets: f[h] = sum_{s ⊇ h} (-1)^{|s|-|h|} W[s]
    for (let m = 0; m < 32; m++) f[m] = W[m];
    for (let bit = 1; bit < 32; bit <<= 1)
      for (let m = 0; m < 32; m++) if (!(m & bit)) f[m] -= f[m | bit];

    // Optimal hold (exact comparison of fractions f/C47).
    let best = 0;
    for (let m = 1; m < 32; m++) {
      const lhs = f[m] * C47[5 - POP[best]], rhs = f[best] * C47[5 - POP[m]];
      if (lhs > rhs) best = m;
    }
    const ev = (m) => f[m] / C47[5 - POP[m]];
    const bestEv = ev(best);
    strategies.optimal.sum += bestEv;
    addDist(strategies.optimal.dist, best, POP[best]);

    const cat = cat5[deal];
    for (const [name, fn] of [['listNoExceptions', (m) => entryOptimal(m, rk, st, cat)],
      ['listWithExceptions', (m) => withExceptions(m, entryOptimal(m, rk, st, cat), rk, st)],
      ['simple', (m) => entrySimple(m, rk, st, cat)]]) {
      let pick = -1, pickE = NONE + 1, tie = false;
      for (let m = 0; m < 32; m++) {
        const en = fn(m);
        if (en < pickE) { pickE = en; pick = m; tie = false; }
        else if (en === pickE && Math.abs(ev(m) - ev(pick)) > 1e-12) tie = true;
      }
      const s = strategies[name];
      s.sum += ev(pick);
      addDist(s.dist, pick, POP[pick]);
      if (ev(pick) < bestEv - 1e-12) {
        s.wrong++;
        if (EXAMPLES[name] && EXAMPLES[name].length < 12) {
          const held = [0, 1, 2, 3, 4].filter((i) => pick & (1 << i)).map((i) => cardName(hand[i])).join(' ');
          const opt = [0, 1, 2, 3, 4].filter((i) => best & (1 << i)).map((i) => cardName(hand[i])).join(' ');
          EXAMPLES[name].push(`${hand.map(cardName).join(' ')} | list holds [${held}] ${ev(pick).toFixed(4)} | best [${opt}] ${bestEv.toFixed(4)}`);
        }
      }
      if (tie) s.ambiguous++;
    }
    deal++;
  }

const DEALS = 2598960;
console.log('JACKS OR BETTER 9/6 - exact analysis over', DEALS.toLocaleString('en-US'), 'deals; royal pays', PAY[9], 'per coin');
for (const [name, s] of Object.entries(strategies)) {
  const ret = s.sum / DEALS;
  const tot = s.dist.reduce((x, y) => x + y, 0);
  let m1 = 0, m2 = 0;
  for (let c = 0; c < NC; c++) { const p = s.dist[c] / tot; m1 += PAY[c] * p; m2 += PAY[c] * PAY[c] * p; }
  console.log(`\n[${name}] return ${(ret * 100).toFixed(6)}%  (check ${(m1 * 100).toFixed(6)}%)  SD per hand (units of total bet) ${Math.sqrt(m2 - m1 * m1).toFixed(4)} bets`);
  if (s.wrong !== undefined) console.log(`  deals where this list is worse than optimal: ${s.wrong}  (same-line ties with different EV: ${s.ambiguous})`);
  for (let c = NC - 1; c >= 0; c--) {
    const p = s.dist[c] / tot;
    console.log(`  ${CAT[c].padEnd(16)} ${String(PAY[c]).padStart(4)}  ${Math.round(s.dist[c]).toString().padStart(18)}  ${p.toFixed(8)}  ${(PAY[c] * p).toFixed(8)}`);
  }
  console.log(`  total combinations ${Math.round(tot)}`);
}
for (const [name, list] of Object.entries(EXAMPLES)) {
  console.log(`\nfirst deals where [${name}] loses EV:`);
  for (const line of list) console.log('  ' + line);
}
