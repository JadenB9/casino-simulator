// What two cards amount to on a board, the way a player sizes them up: a made hand's class (the
// nuts, a set, top pair with a good kicker, an underpair, air), the draws it has, and the board's
// texture. The bots use it for their own hand and, many times per decision, for the hands they
// deal their opponents when they narrow a range by what that opponent has done. So it works on
// card ints and never allocates.

import { evaluate, FLUSH, STRAIGHT, TRIPS, TWO_PAIR, PAIR, FULL_HOUSE } from './eval.ts';

// STRAIGHT_TOP without the table: top rank of the best straight in a 13-bit rank mask, or -1.
function straightTop(m: number): number {
  for (let t = 12; t >= 4; t--) if (((m >> (t - 4)) & 31) === 31) return t;
  return (m & 0x100f) === 0x100f ? 3 : -1;
}

function bits(m: number): number {
  let n = 0;
  for (let b = m; b; b &= b - 1) n++;
  return n;
}

function hi(m: number): number {
  return 31 - Math.clz32(m);
}

export interface Texture {
  /** 0 dry (K72 rainbow) to 1 soaking wet (JT9 two-tone). */
  wet: number;
  /** The most cards of one suit on the board. */
  suited: number;
  /** A pair (or more) on the board. */
  paired: boolean;
  /** Three or more board cards within a five-rank window: straights are out there. */
  connected: boolean;
  /** The top board rank, 0 (deuce) to 12 (ace). */
  top: number;
}

export function texture(board: ArrayLike<number>, nb: number = board.length): Texture {
  const suits = [0, 0, 0, 0];
  let mask = 0;
  let paired = false;
  for (let i = 0; i < nb; i++) {
    const c = board[i]!;
    suits[c & 3]!++;
    const bit = 1 << (c >> 2);
    if (mask & bit) paired = true;
    mask |= bit;
  }
  const suited = Math.max(suits[0]!, suits[1]!, suits[2]!, suits[3]!);
  // the most board ranks in any five-rank window (the wheel's ace counts low too)
  let run = 0;
  for (let t = 0; t <= 8; t++) run = Math.max(run, bits((mask >> t) & 31));
  if (mask & (1 << 12)) run = Math.max(run, bits(mask & 0xf) + 1);
  const connected = run >= 3;
  let wet = suited >= 3 ? 0.55 : suited === 2 && nb <= 4 ? 0.25 : 0;
  wet += run >= 4 ? 0.5 : run === 3 ? 0.35 : run === 2 && nb <= 4 ? 0.1 : 0;
  if (paired) wet -= 0.1;
  return { wet: Math.max(0, Math.min(1, wet)), suited, paired, connected, top: hi(mask) };
}

export interface Holding {
  /** 0 (nothing) to 1 (the nuts): how happy a player is to get chips in with it. */
  score: number;
  /** The made hand's score alone, without the draws. */
  made: number;
  /** 0 none, 1 gutshot, 2 flush draw or open-ender, 3 both (a combo draw). */
  draw: number;
  /** The flush draw is to the ace (or the best flush left). */
  nutDraw: boolean;
  /** Hole cards above every board card. */
  overs: number;
}

const seven = new Int32Array(7);

/**
 * Size up hole cards `a`, `b` on the first `nb` cards of `board` (3 to 5). Made hands are graded
 * against the board: a set is not trips on a paired board, top pair's kicker matters, and a
 * straight or flush the board itself makes is worth little.
 */
export function classify(a: number, b: number, board: ArrayLike<number>, nb: number): Holding {
  seven[0] = a;
  seven[1] = b;
  let bm = 0;
  let bm2 = 0;
  const bs = [0, 0, 0, 0];
  const bsm = [0, 0, 0, 0];
  for (let i = 0; i < nb; i++) {
    const c = board[i]!;
    seven[2 + i] = c;
    const bit = 1 << (c >> 2);
    if (bm & bit) bm2 |= bit;
    bm |= bit;
    bs[c & 3]!++;
    bsm[c & 3]! |= bit;
  }
  const v = evaluate(seven, 2 + nb);
  const cat = v >> 20;
  const ra = a >> 2;
  const rb = b >> 2;
  const topBoard = hi(bm);
  const pocket = ra === rb;
  const hiHole = Math.max(ra, rb);
  const loHole = Math.min(ra, rb);
  const boardSuit = Math.max(bs[0]!, bs[1]!, bs[2]!, bs[3]!);
  let made = 0;

  if (cat >= FULL_HOUSE) {
    // Quads or a full house that uses a hole card (a full board house with nothing is a chop).
    const bv = nb === 5 ? evaluate(board, 5) : -1;
    made = v === bv ? 0.35 : cat === FULL_HOUSE && !pocket && !(bm & (1 << ra)) && !(bm & (1 << rb)) ? 0.35 : 0.97;
  } else if (cat === FLUSH) {
    // How many better flush cards are still out: none is the nut flush.
    const fs = bs[0]! >= 3 ? 0 : bs[1]! >= 3 ? 1 : bs[2]! >= 3 ? 2 : 3;
    const mine = ((a & 3) === fs ? 1 << ra : 0) | ((b & 3) === fs ? 1 << rb : 0);
    if (mine === 0) made = 0.3;
    else {
      const top = hi(mine);
      let better = 0;
      for (let r = 12; r > top; r--) if (!(bsm[fs]! & (1 << r))) better++;
      made = better === 0 ? 0.95 : better === 1 ? 0.9 : Math.max(0.72, 0.86 - better * 0.03);
      if (bm2) made -= 0.08;
    }
  } else if (cat === STRAIGHT) {
    const top = (v >> 16) & 15;
    const boardTop = straightTop(bm);
    if (boardTop >= top) made = 0.3;
    else {
      made = 0.85;
      if (boardSuit >= 3) made -= 0.15;
      if (bm2) made -= 0.08;
      // the low end of a straight (a 6 on 789T) can be beaten by a bigger one
      if (straightTop(bm | (1 << Math.min(12, top + 1))) > top) made -= 0.06;
    }
  } else if (cat === TRIPS) {
    const t = (v >> 16) & 15;
    if (pocket) made = 0.9; // a set
    else if (ra === t || rb === t) made = 0.74 + (ra === t ? rb : ra) * 0.01; // trips, by the kicker
    else made = 0.12; // trips on the board
    if (boardSuit >= 4 || (boardSuit >= 3 && nb === 5)) made -= 0.12;
  } else if (cat === TWO_PAIR) {
    const p1 = (v >> 16) & 15;
    const useA = (bm & (1 << ra)) !== 0 && !(bm2 & (1 << ra));
    const useB = (bm & (1 << rb)) !== 0 && !(bm2 & (1 << rb));
    if (!pocket && useA && useB) made = p1 === topBoard ? 0.8 : 0.72; // two pair with both cards
    else made = pairScore(ra, rb, pocket, bm, bm2, topBoard);
    if (boardSuit >= 4 || (boardSuit >= 3 && nb === 5)) made -= 0.1;
  } else if (cat === PAIR) {
    made = pairScore(ra, rb, pocket, bm, bm2, topBoard);
    if (boardSuit >= 4 || (boardSuit >= 3 && nb === 5)) made -= 0.06;
  } else {
    // high card: ace high has some showdown value
    made = 0.04 + hiHole * 0.008 + loHole * 0.002;
  }

  // Draws, on the flop and turn.
  let draw = 0;
  let nutDraw = false;
  if (nb < 5 && cat < STRAIGHT) {
    const all = bm | (1 << ra) | (1 << rb);
    let outs = 0;
    for (let r = 0; r < 13; r++) {
      const bit = 1 << r;
      if (all & bit) continue;
      const top = straightTop(all | bit);
      if (top >= 0 && top > straightTop(bm | bit)) outs++;
    }
    const straight = outs >= 2 ? 2 : outs === 1 ? 1 : 0;
    let flush = false;
    for (let s = 0; s < 4; s++) {
      const n = bs[s]! + ((a & 3) === s ? 1 : 0) + ((b & 3) === s ? 1 : 0);
      if (n === 4 && bs[s]! < 4) {
        flush = true;
        const mine = ((a & 3) === s ? 1 << ra : 0) | ((b & 3) === s ? 1 << rb : 0);
        const top = hi(mine);
        nutDraw = true;
        for (let r = 12; r > top; r--) if (!(bsm[s]! & (1 << r))) nutDraw = false;
      }
    }
    draw = flush && straight ? 3 : flush || straight === 2 ? 2 : straight;
  }
  let overs = 0;
  if (ra > topBoard) overs++;
  if (rb > topBoard) overs++;

  let score = made;
  if (draw === 3) score = Math.max(score + 0.08, 0.52);
  else if (draw === 2) score = Math.max(score + 0.05, nutDraw ? 0.46 : 0.42);
  else if (draw === 1) score = Math.max(score + 0.02, 0.22);
  return { score: Math.min(1, score), made, draw, nutDraw, overs };
}

/** One pair: an overpair, top pair by its kicker, second pair, the rest. */
function pairScore(ra: number, rb: number, pocket: boolean, bm: number, bm2: number, top: number): number {
  if (pocket) {
    if (ra > top) return 0.7 + ra * 0.008; // overpair: AA 0.8, 99 0.76
    // an underpair: how many board ranks are above it
    let above = 0;
    for (let r = ra + 1; r < 13; r++) if (bm & (1 << r)) above++;
    return above === 1 ? 0.42 : 0.3;
  }
  const hitA = (bm & (1 << ra)) !== 0 && !(bm2 & (1 << ra));
  const hitB = (bm & (1 << rb)) !== 0 && !(bm2 & (1 << rb));
  if (!hitA && !hitB) {
    // the pair is on the board: a high card hand
    return 0.04 + Math.max(ra, rb) * 0.008;
  }
  const r = hitA ? ra : rb;
  const kicker = hitA ? rb : ra;
  if (r === top) return 0.56 + kicker * 0.012; // top pair: AK on K72 0.7, K4 0.6
  let above = 0;
  for (let x = r + 1; x < 13; x++) if (bm & (1 << x)) above++;
  return above === 1 ? 0.42 + kicker * 0.004 : 0.3;
}
