// The rules of one no-limit Hold'em hand as plain data and small functions that change it in
// place: positions, blinds, who acts next, what they may do, uncalled bets, side pots, showdown
// order and the odd chip. The engine clones its state once per step and calls these; the tests
// and the Monte Carlo run call them directly, millions of times, so they allocate little and
// never read the clock or the network.
//
// Clockwise means increasing seat number (wrapping). Every rule reference is to
// docs/rules/cards-and-machines.md section 4 (Poker TDA rules, Robert's Rules of Poker).

import type { Cents } from '../../money.ts';
import { evaluate } from './eval.ts';

export type Street = 0 | 1 | 2 | 3;
export const STREET_NAMES = ['preflop', 'flop', 'turn', 'river'] as const;

/** What a player did last on this street, as the table shows it. */
export type Move = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin' | 'sb' | 'bb';

export interface Player {
  seat: number;
  /** Two card ints once dealt. Never leaves the server unless shown. */
  hole: number[];
  /** Chips behind when the hand started: table stakes, the most this player can put in. */
  start: Cents;
  /** Everything put in this hand, blinds included (c_i in 4.6). */
  put: Cents;
  /** Put in on the current street (the chips in front of the seat). */
  street: Cents;
  folded: boolean;
  allIn: boolean;
  /** The bet level this player last acted at on this street; null until they act (posting a blind isn't acting). */
  acted: number | null;
  last: Move | null;
  shown: boolean;
  mucked: boolean;
}

export interface Hand {
  id: number;
  sb: Cents;
  bb: Cents;
  button: number;
  sbSeat: number;
  bbSeat: number;
  /** The shuffled deck as card ints; `pos` is the next card. Hidden. */
  deck: number[];
  pos: number;
  board: number[];
  /** Everyone dealt in, in seat order. */
  players: Player[];
  street: Street;
  /** currentBet: the most anyone has put in on this street. */
  bet: Cents;
  /** Size of the last full bet or raise on this street; starts at one big blind. */
  minRaise: Cents;
  toAct: number | null;
  /** The last player to bet or raise; kept through an all-in run-out for the showdown order. */
  aggressor: number | null;
  /** True once no more betting can happen (showdown reached, or an all-in run-out). */
  closed: boolean;
}

export interface Legal {
  /** Chips this player can still put in. */
  behind: Cents;
  /** What calling costs now (capped at behind; 0 when there's nothing to call). */
  toCall: Cents;
  canCheck: boolean;
  /** No bet yet on this street: the choice is check or bet. */
  canBet: boolean;
  /** Facing a bet with more chips than the call, and the action is open to them (TDA 49). */
  canRaise: boolean;
  /** Smallest legal bet or raise, as a street total, rounded up to the step (or all-in if less). */
  minTo: Cents;
  /** All-in, as a street total. */
  maxTo: Cents;
}

// ---------------------------------------------------------------------------------------------
// Positions

/** The seat after `seat` in a sorted list, wrapping. */
export function after(list: readonly number[], seat: number): number {
  for (const s of list) if (s > seat) return s;
  return list[0]!;
}

/**
 * Button and blinds for the next hand (4.2): a moving button, blinds on the next two seats.
 * `fresh` players (just sat down, or back after missing their big blind) wait for the big blind:
 * the button and small blind only land on players already in the game, and a fresh player is
 * dealt in when the big blind reaches them. When fewer than three players are already in the
 * game, everyone who is ready is dealt in (a new game starts). Heads-up, the button posts the
 * small blind, and the player who had the big blind most recently gets the button.
 */
export function positions(
  eligible: readonly { seat: number; fresh: boolean }[],
  lastButton: number | null,
  lastBB: number | null,
  pick: (n: number) => number,
): { button: number; sb: number; bb: number; dealt: number[] } | null {
  if (eligible.length < 2) return null;
  let settled = eligible.filter((e) => !e.fresh).map((e) => e.seat);
  let fresh = eligible.filter((e) => e.fresh).map((e) => e.seat);
  if (settled.length <= 2) {
    settled = eligible.map((e) => e.seat);
    fresh = [];
  }
  settled.sort((a, b) => a - b);
  if (settled.length === 2) {
    let button: number;
    if (lastBB !== null && settled.includes(lastBB)) button = lastBB;
    else if (lastButton !== null) button = after(settled, lastButton);
    else button = settled[pick(2)]!;
    const bb = settled[0] === button ? settled[1]! : settled[0]!;
    return { button, sb: button, bb, dealt: settled };
  }
  const button = lastButton === null ? settled[pick(settled.length)]! : after(settled, lastButton);
  const sb = after(settled, button);
  const all = [...settled, ...fresh].sort((a, b) => a - b);
  const bb = after(all, sb);
  const dealt = fresh.includes(bb) ? [...settled, bb].sort((a, b) => a - b) : settled;
  return { button, sb, bb, dealt };
}

// ---------------------------------------------------------------------------------------------
// Starting a hand

/**
 * Seat the players, post the blinds and deal two cards each, one at a time, starting left of the
 * button. A short blind posts what it has and is all-in; the amount to call stays the full big
 * blind (4.2).
 */
export function newHand(opts: {
  id: number;
  sb: Cents;
  bb: Cents;
  button: number;
  sbSeat: number;
  bbSeat: number;
  players: readonly { seat: number; stack: Cents }[];
  deck: number[];
}): Hand {
  const players: Player[] = [...opts.players]
    .sort((a, b) => a.seat - b.seat)
    .map((p) => ({ seat: p.seat, hole: [], start: p.stack, put: 0, street: 0, folded: false, allIn: false, acted: null, last: null, shown: false, mucked: false }));
  const h: Hand = {
    id: opts.id,
    sb: opts.sb,
    bb: opts.bb,
    button: opts.button,
    sbSeat: opts.sbSeat,
    bbSeat: opts.bbSeat,
    deck: opts.deck,
    pos: 0,
    board: [],
    players,
    street: 0,
    bet: 0,
    minRaise: opts.bb,
    toAct: null,
    aggressor: null,
    closed: false,
  };
  post(h, player(h, opts.sbSeat)!, opts.sb, 'sb');
  post(h, player(h, opts.bbSeat)!, opts.bb, 'bb');
  h.bet = opts.bb;
  for (let round = 0; round < 2; round++) for (const p of dealOrder(h)) p.hole.push(h.deck[h.pos++]!);
  return h;
}

function post(h: Hand, p: Player, amount: Cents, kind: 'sb' | 'bb'): void {
  const n = Math.min(amount, p.start - p.put);
  p.put += n;
  p.street += n;
  if (p.put === p.start) p.allIn = true;
  p.last = kind;
}

/** Everyone dealt in, clockwise starting left of the button. */
export function dealOrder(h: Hand): Player[] {
  const out: Player[] = [];
  let seat = h.button;
  for (let i = 0; i < h.players.length; i++) {
    seat = after(h.players.map((p) => p.seat), seat);
    out.push(player(h, seat)!);
  }
  return out;
}

export function player(h: Hand, seat: number): Player | undefined {
  return h.players.find((p) => p.seat === seat);
}

// ---------------------------------------------------------------------------------------------
// Betting

export function legal(h: Hand, p: Player, step: Cents): Legal {
  const behind = p.start - p.put;
  const owe = Math.max(0, h.bet - p.street);
  const toCall = Math.min(owe, behind);
  const maxTo = p.street + behind;
  const canCheck = owe === 0;
  let canBet = false;
  let canRaise = false;
  let minTo = maxTo;
  if (behind > 0 && !p.folded && !p.allIn) {
    if (h.bet === 0) {
      canBet = true;
      minTo = Math.min(roundUp(h.bb, step), maxTo);
    } else if (maxTo > h.bet && (p.acted === null || h.bet - p.acted >= h.minRaise)) {
      // A player who already acted may raise only when facing at least one full bet or raise
      // since then; short all-ins add up (TDA 49-A).
      canRaise = true;
      minTo = Math.min(roundUp(h.bet + h.minRaise, step), maxTo);
    }
  }
  return { behind, toCall, canCheck, canBet, canRaise, minTo, maxTo };
}

function roundUp(x: Cents, step: Cents): Cents {
  return Math.ceil(x / step) * step;
}

export type MoveKind = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export type MoveResult =
  | { ok: true; move: Move; added: Cents }
  | { ok: false; code: 'BAD_REQUEST' | 'LIMIT' | 'NOT_ENOUGH_CHIPS'; msg: string };

/**
 * Apply one decision by the player to act. `to` is the street total for a bet or raise. Bets and
 * raises are whole multiples of `step` except an all-in, which is whatever is left.
 */
export function applyMove(h: Hand, p: Player, kind: MoveKind, to: Cents | undefined, step: Cents): MoveResult {
  const l = legal(h, p, step);
  switch (kind) {
    case 'fold':
      if (l.canCheck) return { ok: false, code: 'BAD_REQUEST', msg: 'Nothing to call: check instead.' };
      fold(p);
      return { ok: true, move: 'fold', added: 0 };
    case 'check':
      if (!l.canCheck) return { ok: false, code: 'BAD_REQUEST', msg: `It's ${l.toCall} to call.` };
      p.acted = h.bet;
      p.last = 'check';
      return { ok: true, move: 'check', added: 0 };
    case 'call': {
      if (l.canCheck) return applyMove(h, p, 'check', undefined, step);
      const added = commitTo(p, p.street + l.toCall);
      p.acted = h.bet;
      p.last = p.allIn ? 'allin' : 'call';
      return { ok: true, move: p.last, added };
    }
    case 'allin': {
      if (l.behind === 0) return { ok: false, code: 'BAD_REQUEST', msg: 'No chips left to bet.' };
      if (l.maxTo <= h.bet) return applyMove(h, p, 'call', undefined, step);
      if (h.bet > 0 && !l.canRaise) return { ok: false, code: 'BAD_REQUEST', msg: 'The betting is not open to you: call or fold.' };
      return raiseTo(h, p, l.maxTo);
    }
    case 'bet':
    case 'raise': {
      if (kind === 'bet' && h.bet > 0) return { ok: false, code: 'BAD_REQUEST', msg: 'There is already a bet: raise instead.' };
      if (kind === 'raise' && h.bet === 0) return { ok: false, code: 'BAD_REQUEST', msg: 'Nobody has bet: bet instead.' };
      if (kind === 'raise' && !l.canRaise) {
        return { ok: false, code: 'BAD_REQUEST', msg: l.maxTo <= h.bet ? 'You can only call or fold.' : 'The betting is not open to you: call or fold.' };
      }
      if (kind === 'bet' && !l.canBet) return { ok: false, code: 'BAD_REQUEST', msg: 'You cannot bet now.' };
      if (to === undefined || !Number.isSafeInteger(to) || to <= 0) return { ok: false, code: 'BAD_REQUEST', msg: 'Bad amount.' };
      if (to > l.maxTo) return { ok: false, code: 'NOT_ENOUGH_CHIPS', msg: 'That is more than your stack.' };
      if (to < l.maxTo) {
        if (to < l.minTo) return { ok: false, code: 'LIMIT', msg: kind === 'bet' ? 'The minimum bet is the big blind.' : 'That raise is below the minimum.' };
        if (to % step !== 0) return { ok: false, code: 'LIMIT', msg: 'Bet in whole dollars.' };
      }
      return raiseTo(h, p, to);
    }
  }
}

function commitTo(p: Player, to: Cents): Cents {
  const added = to - p.street;
  p.street = to;
  p.put += added;
  if (p.put === p.start) p.allIn = true;
  return added;
}

/** A bet or raise to `to`. A full one resets the minimum raise; a short all-in doesn't (4.4). */
function raiseTo(h: Hand, p: Player, to: Cents): MoveResult {
  const prev = h.bet;
  const added = commitTo(p, to);
  if (to - prev >= h.minRaise) h.minRaise = to - prev;
  h.bet = to;
  p.acted = to;
  h.aggressor = p.seat;
  p.last = p.allIn ? 'allin' : prev === 0 ? 'bet' : 'raise';
  return { ok: true, move: p.last, added };
}

/** Fold, including out of turn when a player leaves. Their chips stay in the pot. */
export function fold(p: Player): void {
  p.folded = true;
  p.last = 'fold';
}

/** Check if free, otherwise fold: the action clock and a dropped player (4.8, TDA 31). */
export function timeoutMove(h: Hand, p: Player): 'check' | 'fold' {
  if (h.bet - p.street <= 0) {
    p.acted = h.bet;
    p.last = 'check';
    return 'check';
  }
  fold(p);
  return 'fold';
}

export function livePlayers(h: Hand): Player[] {
  return h.players.filter((p) => !p.folded);
}

/**
 * Who acts next, clockwise after `from`, or null when the betting round is over: everyone who
 * can still bet has acted and matched the bet, or nobody is left to bet against.
 */
export function nextToAct(h: Hand, from: number): Player | null {
  let live = 0;
  let able = 0;
  let lone: Player | null = null;
  for (const p of h.players) {
    if (p.folded) continue;
    live++;
    if (!p.allIn) {
      able++;
      lone = p;
    }
  }
  if (live <= 1 || able === 0) return null;
  if (able === 1 && lone!.street >= h.bet) return null;
  const n = h.players.length;
  let i = h.players.findIndex((p) => p.seat > from);
  if (i < 0) i = 0;
  for (let k = 0; k < n; k++) {
    const p = h.players[(i + k) % n]!;
    if (!p.folded && !p.allIn && (p.acted === null || p.street < h.bet)) return p;
  }
  return null;
}

/** Players who can still put chips in. */
export function ableCount(h: Hand): number {
  let n = 0;
  for (const p of h.players) if (!p.folded && !p.allIn) n++;
  return n;
}

/**
 * End a betting round: give back the part of the last bet nobody matched (4.5, TDA 16-B and 67-A),
 * then pull the street's bets into the middle. A folded player's chips are dead money and never
 * come back, even if they were the biggest bet.
 */
export function endStreet(h: Hand): { seat: number; amount: Cents } | null {
  let top: Player | null = null;
  for (const p of h.players) if (!p.folded && (top === null || p.put > top.put)) top = p;
  let uncalled: { seat: number; amount: Cents } | null = null;
  if (top) {
    let second = 0;
    for (const p of h.players) if (p !== top && p.put > second) second = p.put;
    const excess = Math.min(top.put - second, top.street);
    if (excess > 0) {
      top.put -= excess;
      top.street -= excess;
      top.allIn = top.put === top.start;
      uncalled = { seat: top.seat, amount: excess };
    }
  }
  for (const p of h.players) {
    p.street = 0;
    p.acted = null;
    if (p.last !== 'fold' && p.last !== 'allin') p.last = null;
  }
  h.bet = 0;
  h.minRaise = h.bb;
  h.toAct = null;
  return uncalled;
}

/**
 * Burn one and turn the next street's cards (three for the flop, then one, then one). A street
 * that will be bet starts with no aggressor; an all-in run-out (`closed`) keeps the last one,
 * because the showdown order goes by the final betting round.
 */
export function dealStreet(h: Hand): number[] {
  h.pos++; // burn
  const n = h.street === 0 ? 3 : 1;
  const cards = h.deck.slice(h.pos, h.pos + n);
  h.pos += n;
  h.board.push(...cards);
  h.street = (h.street + 1) as Street;
  if (!h.closed) h.aggressor = null;
  return cards;
}

// ---------------------------------------------------------------------------------------------
// Pots

export interface Pot {
  amount: Cents;
  eligible: number[];
}

/**
 * Main and side pots from what everyone put in (4.6): one level per distinct amount among
 * players still in; each pot takes that slice from everyone, folded players included, and only
 * players who reached the level can win it. `collectedOnly` leaves out the current street's
 * bets, for drawing the middle of the table while a round is still being bet.
 */
export function computePots(players: readonly Player[], collectedOnly = false): Pot[] {
  const c = (p: Player) => (collectedOnly ? p.put - p.street : p.put);
  const live = players.filter((p) => !p.folded);
  const levels = [...new Set(live.map(c))].filter((x) => x > 0).sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of players) amount += Math.min(c(p), level) - Math.min(c(p), prev);
    pots.push({ amount, eligible: live.filter((p) => c(p) >= level).map((p) => p.seat) });
    prev = level;
  }
  // Dead money above the highest live level (players who bet and then folded) plays in the top pot.
  let extra = 0;
  for (const p of players) extra += Math.max(0, c(p) - prev);
  if (extra > 0) {
    const top = pots.at(-1);
    if (top) top.amount += extra;
    else pots.push({ amount: extra, eligible: live.map((p) => p.seat) });
  }
  return pots;
}

export function potTotal(h: Hand): Cents {
  let t = 0;
  for (const p of h.players) t += p.put;
  return t;
}

// ---------------------------------------------------------------------------------------------
// Rake

/** The house's share of a raked pot, and the most it takes from one hand, in big blinds. */
export const RAKE_RATE = 0.05;
export const RAKE_CAP_BBS = 3;

/**
 * The rake on this hand's pot: 5% to the cent below, at most three big blinds, and nothing when
 * the hand ended before the flop ("no flop, no drop"). Call once the last bets are swept in.
 */
export function rakeOf(h: Hand): Cents {
  if (h.board.length < 3) return 0;
  return Math.min(Math.floor(potTotal(h) * RAKE_RATE), RAKE_CAP_BBS * h.bb);
}

// ---------------------------------------------------------------------------------------------
// Showdown

/**
 * The order hands are tabled (4.5, TDA 18-A): the last player to bet or raise on the final
 * betting round first; if nobody bet, the first player left of the button; then clockwise.
 */
export function showdownOrder(h: Hand): number[] {
  const live = livePlayers(h).map((p) => p.seat);
  if (live.length === 0) return [];
  const first = h.aggressor !== null && live.includes(h.aggressor) ? h.aggressor : after(live, h.button);
  const i = live.indexOf(first);
  return [...live.slice(i), ...live.slice(0, i)];
}

export function handValue(h: Hand, p: Player): number {
  const cards = [...p.hole, ...h.board];
  return evaluate(cards, cards.length);
}

export interface Award {
  /** 0 is the main pot, 1.. the side pots. */
  pot: number;
  amount: Cents;
  winners: { seat: number; amount: Cents }[];
  /** Winning hand value, or -1 when nobody else was left to contest it. */
  value: number;
}

/** Seats ordered clockwise starting with the first seat left of the button. */
export function leftOfButton(seats: number[], button: number): number[] {
  return [...seats].sort((a, b) => (a > button ? a - button : a - button + 1000) - (b > button ? b - button : b - button + 1000));
}

/**
 * Split each pot among the best hands still claiming it. Pots split to the cent; the odd cents
 * go one each to the winners in seat order starting left of the button (4.6, TDA 21-A).
 * `values` holds each live player's hand value; mucked players have given up their claim.
 */
export function awardPots(h: Hand, values: ReadonlyMap<number, number>, mucked: ReadonlySet<number> = new Set(), rake: Cents = 0): Award[] {
  const pots = computePots(h.players);
  // The house's rake comes out of the pots in proportion, the odd cents from the main pot.
  if (rake > 0) {
    const total = pots.reduce((a, p) => a + p.amount, 0);
    let left = rake;
    for (let i = pots.length - 1; i >= 1; i--) {
      const take = Math.floor((pots[i]!.amount * rake) / total);
      pots[i]!.amount -= take;
      left -= take;
    }
    if (pots[0]) pots[0].amount -= left;
  }
  const awards: Award[] = [];
  pots.forEach((pot, i) => {
    let claim = pot.eligible.filter((s) => !mucked.has(s));
    if (claim.length === 0) claim = pot.eligible;
    let best = -1;
    let winners = claim;
    if (claim.length > 1) {
      for (const s of claim) best = Math.max(best, values.get(s) ?? -1);
      winners = claim.filter((s) => (values.get(s) ?? -1) === best);
    }
    const ordered = leftOfButton(winners, h.button);
    const share = Math.floor(pot.amount / ordered.length);
    const odd = pot.amount - share * ordered.length;
    awards.push({
      pot: i,
      amount: pot.amount,
      winners: ordered.map((seat, k) => ({ seat, amount: share + (k < odd ? 1 : 0) })),
      value: best,
    });
  });
  return awards;
}
