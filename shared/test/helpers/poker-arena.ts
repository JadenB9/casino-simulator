// Bots against bots, many hands, fast: the rules' hand (rules.ts), the engine's own situation
// builder (situation.ts) and reads (reads.ts), and the bots' decide(), without the table around
// them. Hands are cash-game hands at 100 big blinds, every stack topped back up between hands.
//
// Duplicate format: each deal is played once per seating, the players rotated round the table
// with the same cards in the same seats, so every player holds every seat's cards once. Luck in
// the cards mostly cancels out and a few thousand deals separate strong players from weak ones.

import * as R from '../../src/games/holdem/rules.ts';
import { decide, drawBot, PERSONAS, type BotDecision, type BotSituation } from '../../src/games/holdem/bots.ts';
import { situationOf, type PublicHand } from '../../src/games/holdem/situation.ts';
import { observe, type Act, type Reads } from '../../src/games/holdem/reads.ts';
import { type Rng, shuffle } from '../../src/rng.ts';
import { seededRng } from './seeded.ts';

export interface ArenaPlayer {
  name: string;
  /** A bot's persona (for its tilt); none for a fixed strategy. */
  persona?: string;
  tilt?: number;
  /** A bot's persona and skill, or any other strategy. */
  act: (sit: BotSituation, rng: Rng) => BotDecision;
}

/** A bot as the engine seats it: this persona, at this skill, with tilt coming and going. */
export function botPlayer(name: string, persona: string, skill: number): ArenaPlayer {
  const p = PERSONAS[persona]!;
  const me: ArenaPlayer = {
    name,
    persona,
    tilt: 0,
    act: (sit: BotSituation, rng: Rng) => decide(sit, p, rng, { skill, tilt: me.tilt ?? 0 }),
  };
  return me;
}

/** `n` bots as the engine would seat them at this big blind (cents), named by persona. */
export function drawnTable(bb: number, n: number, seed: number, tag = ''): ArenaPlayer[] {
  const rng = seededRng(seed * 7919 + bb);
  return Array.from({ length: n }, (_, i) => {
    const b = drawBot(bb, rng);
    return botPlayer(`${tag}${b.persona}${i + 1} ${b.skill.toFixed(2)}`, b.persona, b.skill);
  });
}

/** Calls every bet, checks when it can: the "always call" player. */
export const alwaysCall = (name: string): ArenaPlayer => ({
  name,
  act: (sit) => (sit.legal.toCall > 0 ? { kind: 'call' } : { kind: 'check' }),
});

/** Raises (or bets) the pot every chance it gets, else calls: the "always raise" player. */
export const alwaysRaise = (name: string): ArenaPlayer => ({
  name,
  act: (sit) => {
    const l = sit.legal;
    if (l.canBet || l.canRaise) {
      const to = Math.max(l.minTo, sit.bet + sit.pot + l.toCall);
      return to >= l.maxTo ? { kind: 'allin' } : { kind: sit.bet === 0 ? 'bet' : 'raise', to: Math.ceil(to / sit.step) * sit.step };
    }
    return l.toCall > 0 ? { kind: 'call' } : { kind: 'check' };
  },
});

/** Min-raises (or min-bets) every chance it gets, else calls: small-ball pressure. */
export const alwaysMinRaise = (name: string): ArenaPlayer => ({
  name,
  act: (sit) => {
    const l = sit.legal;
    if (l.canBet || l.canRaise) return l.minTo >= l.maxTo ? { kind: 'allin' } : { kind: sit.bet === 0 ? 'bet' : 'raise', to: l.minTo };
    return l.toCall > 0 ? { kind: 'call' } : { kind: 'check' };
  },
});

/** Moves all-in every hand. */
export const alwaysShove = (name: string): ArenaPlayer => ({
  name,
  act: (sit) => (sit.legal.behind > 0 ? { kind: 'allin' } : { kind: 'check' }),
});

export interface ArenaStats {
  decisions: number;
  refused: number;
  ms: number;
  slowestMs: number;
}

/**
 * One hand: `order[seat]` is the player in that seat (seats 0..n-1), the button on `button`.
 * Returns each seat's net, in big blinds.
 */
export function playHand(
  order: readonly ArenaPlayer[],
  button: number,
  deck: number[],
  reads: Reads,
  rng: Rng,
  stats: ArenaStats,
  opts: { bb?: number; stackBB?: number } = {},
): number[] {
  const bb = opts.bb ?? 200;
  const step = Math.min(100, bb / 2);
  const n = order.length;
  const seats = Array.from({ length: n }, (_, i) => i);
  const sb = R.after(seats, button);
  const bbSeat = n === 2 ? R.after(seats, button) : R.after(seats, sb);
  const h = R.newHand({
    id: 1,
    sb: bb / 2,
    bb,
    button,
    sbSeat: n === 2 ? button : sb,
    bbSeat,
    players: seats.map((seat) => ({ seat, stack: (opts.stackBB ?? 100) * bb })),
    deck,
  });
  const pub: PublicHand & { acts: Act[] } = { acts: [], pre: { raises: 0, limpers: 0 }, streetRaises: 0, prevAggressor: null };
  const names: Record<number, string> = {};
  seats.forEach((s) => (names[s] = order[s]!.name));
  let from = h.bbSeat;
  for (;;) {
    if (R.livePlayers(h).length <= 1) {
      R.endStreet(h);
      break;
    }
    const p = R.nextToAct(h, from);
    if (!p) {
      pub.prevAggressor = h.aggressor;
      R.endStreet(h);
      pub.streetRaises = 0;
      if (h.street === 3) break;
      if (R.ableCount(h) < 2) {
        h.closed = true;
        while (h.street < 3) R.dealStreet(h);
        break;
      }
      R.dealStreet(h);
      from = h.button;
      continue;
    }
    const sit = situationOf(h, p.seat, pub, reads, names, step);
    const t0 = performance.now();
    const d = order[p.seat]!.act(sit, rng);
    const ms = performance.now() - t0;
    stats.ms += ms;
    stats.slowestMs = Math.max(stats.slowestMs, ms);
    stats.decisions++;
    const prevBet = h.bet;
    let r = R.applyMove(h, p, d.kind, d.to, step);
    if (!r.ok) {
      stats.refused++;
      r = { ok: true, move: R.timeoutMove(h, p), added: 0 };
    }
    const raised = h.bet > prevBet;
    const mv = r.move;
    const kind = mv === 'fold' ? 'f' : mv === 'check' ? 'x' : raised ? (prevBet === 0 ? 'b' : 'r') : 'c';
    const before = R.potTotal(h) - r.added;
    pub.acts.push({ seat: p.seat, street: h.street, kind, to: p.street, size: raised ? Math.round(((p.street - prevBet) / Math.max(1, before)) * 100) / 100 : 0, allIn: p.allIn });
    if (raised) {
      pub.streetRaises++;
      if (h.street === 0) pub.pre.raises++;
    } else if (h.street === 0 && mv === 'call' && pub.pre.raises === 0) pub.pre.limpers++;
    from = p.seat;
  }
  const values = new Map<number, number>();
  const live = R.livePlayers(h);
  if (live.length > 1) for (const p of live) values.set(p.seat, R.handValue(h, p));
  const net = h.players.map((p) => -p.put);
  for (const a of R.awardPots(h, values)) for (const w of a.winners) net[w.seat]! += w.amount;
  observe(reads, names, pub.acts, new Set(order.map((p) => p.name)));
  // tilt, as the engine does it
  h.players.forEach((_, seat) => {
    const who = order[seat]!;
    if (who.tilt === undefined || !who.persona) return;
    const lost = -net[seat]! / bb;
    let tilt = who.tilt * 0.85;
    if (lost >= 25) tilt += PERSONAS[who.persona]!.tilt * Math.min(1, lost / 80);
    who.tilt = Math.min(1, tilt);
  });
  return net.map((x) => x / bb);
}

export interface MatchResult {
  name: string;
  /** Big blinds won per 100 hands, and its standard error. */
  bb100: number;
  se: number;
  hands: number;
}

/**
 * A duplicate match: `deals` deals at a table of these players, each deal played once per
 * rotation of the seats (all n of them), reads kept by name across the match.
 */
export function duplicateMatch(players: readonly ArenaPlayer[], deals: number, seed: number, stats: ArenaStats, opts: { bb?: number; stackBB?: number; reads?: Reads } = {}): MatchResult[] {
  const n = players.length;
  const deckRng = seededRng(seed);
  const botRng = seededRng(seed ^ 0x5bd1e995);
  const reads: Reads = opts.reads ?? {};
  const sums = players.map(() => ({ sum: 0, sq: 0 }));
  for (let d = 0; d < deals; d++) {
    const deck = shuffle(deckRng, Array.from({ length: 52 }, (_, i) => i));
    const button = d % n;
    const perDeal = new Array(n).fill(0);
    for (let rot = 0; rot < n; rot++) {
      const order = Array.from({ length: n }, (_, seat) => players[(seat + rot) % n]!);
      const net = playHand(order, button, [...deck], reads, botRng, stats, opts);
      net.forEach((x, seat) => (perDeal[(seat + rot) % n] += x / n));
    }
    perDeal.forEach((x, i) => {
      sums[i]!.sum += x;
      sums[i]!.sq += x * x;
    });
  }
  return players.map((p, i) => {
    const mean = sums[i]!.sum / deals;
    const sd = Math.sqrt(Math.max(0, sums[i]!.sq / deals - mean * mean) * (deals / Math.max(1, deals - 1)));
    return { name: p.name, bb100: mean * 100, se: (sd / Math.sqrt(deals)) * 100, hands: deals * n };
  });
}

export function table(results: readonly MatchResult[]): string {
  return results.map((r) => `  ${r.name.padEnd(18)} ${(r.bb100 >= 0 ? '+' : '') + r.bb100.toFixed(1).padStart(7)} bb/100  SE ${r.se.toFixed(1).padStart(5)}  (${r.hands} hands)`).join('\n');
}
