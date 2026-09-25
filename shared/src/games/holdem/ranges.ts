// Starting hands as ranges, the way players and their charts talk about them: the 169 kinds of
// two-card hand ("AKs", "T9o", "77"), the standard raise-first-in charts by position for six- and
// nine-handed cash games at a hundred big blinds, and one order of all 169 from best to worst
// built from those charts, so "the top 12%" means the same thing to every bot.
//
// The charts are the common solver-derived opening ranges (a UTG open of about 17% of hands six
// handed, the button about 45%) rounded to the notation players use. A hand's place in the order
// is the tightest chart that opens it, then its Chen score, so within a tier the bigger and more
// connected hands come first (among the hands no chart plays, the bigger ones).

import { chen } from './preflop.ts';

const RANKS = '23456789TJQKA';

/** A hand's kind, 0..168: row = high rank, column = low rank; suited above the diagonal's mirror. */
export function handClass(a: number, b: number): number {
  let r1 = a >> 2;
  let r2 = b >> 2;
  if (r2 > r1) [r1, r2] = [r2, r1];
  if (r1 === r2) return r1 * 13 + r1;
  return (a & 3) === (b & 3) ? r1 * 13 + r2 : r2 * 13 + r1;
}

/** "AKs", "T9o", "77". */
export function className(k: number): string {
  const i = Math.floor(k / 13);
  const j = k % 13;
  if (i === j) return RANKS[i]! + RANKS[i]!;
  return i > j ? RANKS[i]! + RANKS[j]! + 's' : RANKS[j]! + RANKS[i]! + 'o';
}

/** Card combinations of a kind: 6 for a pair, 4 suited, 12 offsuit. */
export function combos(k: number): number {
  const i = Math.floor(k / 13);
  const j = k % 13;
  return i === j ? 6 : i > j ? 4 : 12;
}

function kind(hi: number, lo: number, suited: boolean): number {
  return hi === lo ? hi * 13 + hi : suited ? hi * 13 + lo : lo * 13 + hi;
}

/**
 * The kinds in a range written the usual way: "22+", "A2s+", "ATo+", "KQo", "T9s", "76s-54s",
 * "K9s-K6s", "AK" (both suited and offsuit). Comma separated.
 */
export function parseRange(text: string): Set<number> {
  const out = new Set<number>();
  for (const raw of text.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const dash = part.split('-');
    if (dash.length === 2) {
      // "76s-54s" (connectors down) or "K9s-K6s" (kickers down)
      const [a, b] = dash.map(parseOne);
      const d1 = a!.hi - b!.hi;
      const d2 = a!.lo - b!.lo;
      const steps = Math.max(d1, d2);
      for (let s = 0; s <= steps; s++) addKinds(out, a!.hi - (d1 ? s : 0), a!.lo - (d2 ? s : 0), a!.suit);
      continue;
    }
    const plus = part.endsWith('+');
    const h = parseOne(plus ? part.slice(0, -1) : part);
    if (!plus) addKinds(out, h.hi, h.lo, h.suit);
    else if (h.hi === h.lo) for (let r = h.hi; r < 13; r++) addKinds(out, r, r, '');
    else for (let r = h.lo; r < h.hi; r++) addKinds(out, h.hi, r, h.suit);
  }
  return out;
}

function parseOne(s: string): { hi: number; lo: number; suit: string } {
  const hi = RANKS.indexOf(s[0]!);
  const lo = RANKS.indexOf(s[1]!);
  if (hi < 0 || lo < 0) throw new Error(`bad range part ${s}`);
  return { hi: Math.max(hi, lo), lo: Math.min(hi, lo), suit: s[2] ?? '' };
}

function addKinds(out: Set<number>, hi: number, lo: number, suit: string): void {
  if (hi === lo) out.add(kind(hi, lo, false));
  else {
    if (suit !== 'o') out.add(kind(hi, lo, true));
    if (suit !== 's') out.add(kind(hi, lo, false));
  }
}

// ---------------------------------------------------------------------------------------------
// The charts, tightest first. Each is opened by every chart after it too.

export const CHARTS: readonly { name: string; range: string }[] = [
  { name: 'premium', range: 'QQ+, AK' },
  { name: 'strong', range: 'TT+, AJs+, KQs, AQo+' },
  // nine handed, under the gun (about 10%)
  { name: 'UTG9', range: '77+, ATs+, KTs+, QTs+, JTs, AJo+, KQo' },
  // six handed, under the gun; nine handed, the lojack (about 17%)
  { name: 'UTG', range: '22+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, ATo+, KJo+' },
  // the hijack (about 21%)
  { name: 'HJ', range: '22+, A2s+, K8s+, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, 65s, A9o+, KTo+, QJo' },
  // the cutoff (about 28%)
  { name: 'CO', range: '22+, A2s+, K5s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A8o+, A5o, KTo+, QTo+, JTo' },
  // the button and the small blind (about 45%)
  { name: 'BTN', range: '22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 96s+, 85s+, 74s+, 63s+, 53s+, 43s, A2o+, K8o+, Q9o+, J9o+, T8o+, 98o, 87o' },
  // what a loose player plays (about 65%)
  { name: 'loose', range: '22+, A2s+, K2s+, Q2s+, J2s+, T2s+, 92s+, 82s+, 72s+, 62s+, 52s+, 42s+, 32s, A2o+, K2o+, Q5o+, J7o+, T7o+, 97o+, 86o+, 76o, 65o, 54o' },
];

/** Tier 0..CHARTS.length: the tightest chart holding the kind (CHARTS.length for none). */
export const TIER = new Uint8Array(169).fill(CHARTS.length);
{
  const seen = new Set<number>();
  CHARTS.forEach((c, t) => {
    for (const k of parseRange(c.range)) {
      if (!seen.has(k)) {
        seen.add(k);
        TIER[k] = t;
      }
    }
  });
}

/** Every kind, best first. */
export const ORDER: readonly number[] = (() => {
  const all = Array.from({ length: 169 }, (_, k) => k);
  const key = (k: number) => {
    const i = Math.floor(k / 13);
    const j = k % 13;
    const hi = Math.max(i, j);
    const lo = Math.min(i, j);
    // Chen's score in the charted tiers; below them the high card matters most (Q4o is a
    // better hand than 43o, though Chen scores the connected one higher)
    if (TIER[k]! >= CHARTS.length - 1) return hi * 16 + lo + (i > j ? 6 : 0) + (hi - lo <= 2 ? 2 : 0);
    // a card of each rank, suited when the kind is
    return chen(hi * 4, lo * 4 + (i > j ? 0 : 1)) * 100 + hi * 13 + lo;
  };
  return all.sort((x, y) => TIER[x]! - TIER[y]! || key(y) - key(x));
})();

/** For each kind, the share of all 1,326 starting hands at least as good: AA is 0.45%, 72o 100%. */
export const TOP = new Float64Array(169);
/** The share of starting hands better than this kind (TOP minus its own share). */
export const ABOVE = new Float64Array(169);
/** Cumulative combos through each place in ORDER, for dealing from a range. */
const CUM = new Float64Array(169);
{
  let n = 0;
  ORDER.forEach((k, i) => {
    ABOVE[k] = n / 1326;
    n += combos(k);
    TOP[k] = n / 1326;
    CUM[i] = n;
  });
}

/** The share of hands a chart opens: CHART_WIDTH[t] for tier t (every tier up to t together). */
export const CHART_WIDTH: readonly number[] = CHARTS.map((_, t) => {
  let n = 0;
  for (let k = 0; k < 169; k++) if (TIER[k]! <= t) n += combos(k);
  return n / 1326;
});

/** Where a hand ranks among all starting hands, 0 (best) to 1: the middle of its kind's share. */
export function strength(a: number, b: number): number {
  const k = handClass(a, b);
  return (ABOVE[k]! + TOP[k]!) / 2;
}

/**
 * A kind from the top `w` of all hands, weighted by combos (a random place in the first w of
 * 1,326, then the kind there). `u` is uniform in [0, 1).
 */
export function kindInTop(w: number, u: number): number {
  const target = u * Math.max(1, Math.min(1326, w * 1326));
  let lo = 0;
  let hi = 168;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (CUM[mid]! > target) hi = mid;
    else lo = mid + 1;
  }
  return ORDER[lo]!;
}

/**
 * One concrete pair of cards of kind `k`, avoiding the `dead` cards (a 52-entry 0/1 array), as
 * [a, b], or null when every combination of it is dead. `r` picks among the live ones.
 */
export function dealKind(k: number, dead: Uint8Array, r: number, out: Int32Array, at: number): boolean {
  const i = Math.floor(k / 13);
  const j = k % 13;
  const hi = Math.max(i, j);
  const lo = Math.min(i, j);
  const n = combos(k);
  // walk the combos from a random start and take the first live one
  const start = Math.floor(r * n);
  for (let s = 0; s < n; s++) {
    const c = (start + s) % n;
    let x: number;
    let y: number;
    if (i === j) {
      // the six pairs of suits
      const PA = [0, 0, 0, 1, 1, 2];
      const PB = [1, 2, 3, 2, 3, 3];
      x = hi * 4 + PA[c]!;
      y = hi * 4 + PB[c]!;
    } else if (i > j) {
      x = hi * 4 + c;
      y = lo * 4 + c;
    } else {
      const sa = Math.floor(c / 3);
      const sb0 = c % 3;
      const sb = sb0 >= sa ? sb0 + 1 : sb0;
      x = hi * 4 + sa;
      y = lo * 4 + sb;
    }
    if (dead[x] === 0 && dead[y] === 0) {
      out[at] = x;
      out[at + 1] = y;
      return true;
    }
  }
  return false;
}
