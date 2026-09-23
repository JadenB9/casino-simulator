import { it, expect } from 'vitest';
import { evaluate, categoryOf, STRAIGHT_FLUSH } from '../src/games/holdem/eval.ts';
import {
  type Hand,
  type MoveKind,
  newHand,
  nextToAct,
  applyMove,
  legal,
  endStreet,
  dealStreet,
  ableCount,
  livePlayers,
  awardPots,
  handValue,
} from '../src/games/holdem/rules.ts';
import { type Rng, shuffle, randInt, randUnit } from '../src/rng.ts';
import { Tally, mcRng, mcRounds, chiSquareUniform } from './helpers/stats.ts';

// shared/ compiles without DOM or Node types, so reach the console through globalThis.
const log = (...args: unknown[]) => (globalThis as { console?: { log(...a: unknown[]): void } }).console?.log(...args);

it('every 7-card hand (133,784,560) lands in the documented categories, with 4,824 distinct values', () => {
  const counts = new Array(10).fill(0);
  const seen = new Uint8Array(1 << 24);
  const b = new Int32Array(7);
  for (let c0 = 0; c0 < 46; c0++) {
    b[0] = c0;
    for (let c1 = c0 + 1; c1 < 47; c1++) {
      b[1] = c1;
      for (let c2 = c1 + 1; c2 < 48; c2++) {
        b[2] = c2;
        for (let c3 = c2 + 1; c3 < 49; c3++) {
          b[3] = c3;
          for (let c4 = c3 + 1; c4 < 50; c4++) {
            b[4] = c4;
            for (let c5 = c4 + 1; c5 < 51; c5++) {
              b[5] = c5;
              for (let c6 = c5 + 1; c6 < 52; c6++) {
                b[6] = c6;
                const v = evaluate(b, 7);
                seen[v] = 1;
                const cat = categoryOf(v);
                counts[cat === STRAIGHT_FLUSH && ((v >> 16) & 15) === 12 ? 9 : cat]++;
              }
            }
          }
        }
      }
    }
  }
  let distinct = 0;
  for (let i = 0; i < seen.length; i++) distinct += seen[i]!;
  log('7-card categories (high card .. royal):', counts.join(', '), 'distinct', distinct);
  expect(counts).toEqual([23_294_460, 58_627_800, 31_433_400, 6_461_620, 6_180_020, 4_047_644, 3_473_184, 224_848, 37_260, 4_324]);
  expect(distinct).toBe(4_824);
});

it('deals every one of the 1,326 starting hands equally often (chi-square)', () => {
  const n = mcRounds(2_000_000);
  const rng = mcRng(1326);
  const counts = new Float64Array(52 * 52);
  const stacks = [0, 1, 2, 3, 4, 5].map((seat) => ({ seat, stack: 10_000 }));
  for (let i = 0; i < n; i++) {
    const deck = shuffle(rng, Array.from({ length: 52 }, (_, k) => k));
    const h = newHand({ id: i, sb: 50, bb: 100, button: i % 6, sbSeat: (i + 1) % 6, bbSeat: (i + 2) % 6, players: stacks, deck });
    // the seat on the button is dealt last: its cards are the 6th and 12th off the deck
    const [a, b] = h.players.find((p) => p.seat === i % 6)!.hole as [number, number];
    counts[Math.min(a, b) * 52 + Math.max(a, b)]!++;
  }
  const cells: number[] = [];
  for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) cells.push(counts[a * 52 + b]!);
  expect(cells).toHaveLength(1_326);
  const chi = chiSquareUniform(cells);
  // 1,325 degrees of freedom: mean 1,325, SD about 51.5; four SD either side
  log(`deal uniformity: n=${n} chi2=${chi.toFixed(1)} (df 1325)`);
  expect(chi).toBeLessThan(1_325 + 4 * 51.5);
  expect(chi).toBeGreaterThan(1_325 - 4 * 51.5);
});

/** One hand where every seat plays the same random strategy; returns each seat's net, in big blinds. */
function randomHand(id: number, seats: number, button: number, stack: number, bb: number, rng: Rng): number[] {
  const deck = shuffle(rng, Array.from({ length: 52 }, (_, k) => k));
  const sbSeat = (button + 1) % seats;
  const bbSeat = (button + 2) % seats;
  const players = Array.from({ length: seats }, (_, seat) => ({ seat, stack }));
  const h: Hand = newHand({ id, sb: bb / 2, bb, button, sbSeat, bbSeat, players, deck });
  const step = bb / 10;
  let from = h.bbSeat;
  for (;;) {
    if (livePlayers(h).length <= 1) {
      endStreet(h);
      break;
    }
    const p = nextToAct(h, from);
    if (!p) {
      endStreet(h);
      if (h.street === 3) break;
      if (ableCount(h) < 2) {
        h.closed = true;
        while (h.street < 3) dealStreet(h);
        break;
      }
      dealStreet(h);
      from = h.button;
      continue;
    }
    const l = legal(h, p, step);
    const u = randUnit(rng);
    let kind: MoveKind;
    let to: number | undefined;
    if (u < 0.04) kind = 'allin';
    else if (u < 0.25 && (l.canBet || l.canRaise)) {
      kind = l.canBet ? 'bet' : 'raise';
      const span = Math.floor((l.maxTo - l.minTo) / step);
      to = Math.min(l.maxTo, l.minTo + randInt(rng, Math.min(span, 40) + 1) * step);
    } else if (u < 0.55 && !l.canCheck) kind = 'fold';
    else kind = l.canCheck ? 'check' : 'call';
    if (kind === 'allin' && h.bet > 0 && !l.canRaise) kind = 'call';
    const r = applyMove(h, p, kind, to, step);
    if (!r.ok) throw new Error(`random strategy made an illegal move: ${kind} ${to} (${r.msg})`);
    from = p.seat;
  }
  const values = new Map<number, number>();
  const live = livePlayers(h);
  if (live.length > 1) for (const p of live) values.set(p.seat, handValue(h, p));
  const net = h.players.map((p) => -p.put);
  for (const a of awardPots(h, values)) for (const w of a.winners) net[w.seat]! += w.amount;
  return net.map((x) => x / bb);
}

it('with identical strategies and no rake, every seat breaks even (each within 3 SE)', () => {
  const n = mcRounds(300_000);
  const seats = 6;
  const rng = mcRng(20260922);
  const tallies = Array.from({ length: seats }, () => new Tally());
  let total = 0;
  for (let i = 0; i < n; i++) {
    // the button moves one seat every hand, so each seat plays every position equally often
    const net = randomHand(i, seats, i % seats, 100 * 100, 100, rng);
    let sum = 0;
    net.forEach((x, s) => {
      tallies[s]!.add(x);
      sum += x;
    });
    total += Math.abs(sum);
  }
  // money only moves between seats
  expect(total).toBeLessThan(1e-6);
  tallies.forEach((t, s) => {
    // Tally counts in big blinds here, so its "edge" percentages are hundredths of a big blind.
    log(t.summary(`holdem seat ${s}`, 0));
    log(`holdem seat ${s}: ${t.average >= 0 ? '+' : ''}${t.average.toFixed(4)} BB/hand, SE ${t.se.toFixed(4)} BB, z ${(t.average / t.se).toFixed(2)}, SD ${t.sd.toFixed(2)} BB, n ${t.n}`);
    expect(Math.abs(t.average)).toBeLessThanOrEqual(3 * t.se);
  });
});
