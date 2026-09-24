// Blackjack's rules as plain functions over plain data: card values, totals, what a hand may do,
// and one round from the deal to the settlement. The engine drives a round one decision at a
// time and turns what happens into table events and chip moves; the Monte Carlo test drives the
// very same functions millions of times with the strategy chart making the decisions. So the
// edge the test measures is the edge of the code the table runs.
//
// House rules (docs/rules/table-games.md §1.1): 6 decks, cut card at 75%, burn one after each
// shuffle, dealer stands on all 17s, blackjack pays 3:2, double on any two cards, double after
// split, split to 4 hands, split aces once and get one card each, late surrender, the dealer
// peeks with an ace or a ten up, insurance pays 2:1.

import { type Card, type Shoe, newShoe, draw, cutCardOut, cardsLeft } from '../../cards.ts';
import { type Rng, shuffle } from '../../rng.ts';
import { type Cents, payOdds } from '../../money.ts';
import type { GameEvent } from '../../engine.ts';
import type { ErrorCode } from '../../protocol.ts';

export const DECKS = 6;
export const PENETRATION = 0.75;
export const MAX_HANDS = 4;

/**
 * Which betting circle each seat sits at, counting circles from first base (the dealer's left)
 * to third base. The first player to sit down (and every solo player) gets the middle circle;
 * later players fill outward. Cards are dealt and hands played by circle, first base first.
 *
 * A round's spots are numbered the same way: spot s is the circle seat s would take. A solo
 * player who plays n spots plays spots 0 to n - 1, the middle circles outward.
 */
export const SPOT_OF_SEAT: readonly number[] = [3, 2, 4, 1, 5, 0, 6];

/** How many circles one solo player may play at once. */
export const MAX_SPOTS = 5;

export function spotOf(seat: number): number {
  return SPOT_OF_SEAT[seat] ?? seat;
}

// ---------------------------------------------------------------------------------------------
// Cards and totals

const VALUES = new Int8Array(128);
for (const [r, v] of [['A', 1], ['2', 2], ['3', 3], ['4', 4], ['5', 5], ['6', 6], ['7', 7], ['8', 8], ['9', 9], ['T', 10], ['J', 10], ['Q', 10], ['K', 10]] as const) {
  VALUES[r.charCodeAt(0)] = v;
}

/** Blackjack value of a card: ace 1 (the totals decide when it counts 11), faces 10. */
export function cardValue(card: Card): number {
  return VALUES[card.charCodeAt(0)]!;
}

export interface Total {
  total: number;
  /** An ace is still being counted as 11. */
  soft: boolean;
}

/** An ace counts 11 unless that would bust the hand. */
export function handTotal(cards: readonly Card[]): Total {
  let sum = 0;
  let ace = false;
  for (const c of cards) {
    const v = cardValue(c);
    sum += v;
    if (v === 1) ace = true;
  }
  if (ace && sum <= 11) return { total: sum + 10, soft: true };
  return { total: sum, soft: false };
}

/** Two cards making 21. Whether that is a blackjack also depends on the hand not coming from a split. */
export function isTwoCard21(cards: readonly Card[]): boolean {
  return cards.length === 2 && handTotal(cards).total === 21;
}

// ---------------------------------------------------------------------------------------------
// A round

export type Outcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust' | 'surrender' | 'evenmoney';
export type Move = 'hit' | 'stand' | 'double' | 'split' | 'surrender';
export const MOVES: readonly Move[] = ['hit', 'stand', 'double', 'split', 'surrender'];

export interface Hand {
  cards: Card[];
  /** Chips riding on this hand (twice the opening bet once doubled). */
  bet: Cents;
  doubled: boolean;
  /** Came from a split: a two-card 21 here is not a blackjack, and it can't surrender. */
  split: boolean;
  /** One of a pair of split aces: exactly one more card, then it stands. */
  splitAce: boolean;
  /** No more decisions for this hand. */
  done: boolean;
  /** Set once the hand is settled; a standing hand waits for the dealer with null. */
  outcome: Outcome | null;
  /** Chips returned for this hand, stake included. */
  payout: Cents;
}

export type InsuranceState = 'none' | 'offered' | 'taken' | 'declined';

/** One betting circle in the round. */
export interface Spot {
  /** The spot, numbered like the seats (a solo player's extra circles go on from their own). */
  seat: number;
  /** The opening bet. */
  base: Cents;
  hands: Hand[];
  insurance: InsuranceState;
  /** The insurance bet, half the opening bet when taken (0 for even money). */
  insured: Cents;
  /** Everything this seat has put down this round, and everything paid back to it. */
  wagered: Cents;
  returned: Cents;
  /** Chips of this seat still on the layout. */
  live: Cents;
}

export type Stage = 'insurance' | 'play' | 'done';

export interface Round {
  /** By circle, first base (the dealer's left) first: the order cards are dealt and hands are played. */
  spots: Spot[];
  /** Up card, hole card, then the dealer's draws. */
  dealer: Card[];
  holeUp: boolean;
  stage: Stage;
  /** The hand whose decision the table is waiting for. */
  turn: { spot: number; hand: number } | null;
  /** The dealer looked under an ace or a ten. */
  peeked: boolean;
  dealerBlackjack: boolean;
}

/** The shoe and randomness a round deals from, and where its events go (null: nobody watching). */
export interface Dealing {
  shoe: Shoe;
  rng: Rng;
  out: GameEvent[] | null;
}

export interface Fault {
  code: ErrorCode;
  msg: string;
}

function emit(d: Dealing, e: GameEvent): void {
  if (d.out) d.out.push(e);
}

/** A freshly shuffled shoe with the burn card already gone. */
export function openShoe(rng: Rng): Shoe {
  const shoe = newShoe(rng, DECKS, PENETRATION);
  draw(shoe);
  return shoe;
}

function newHand(bet: Cents, cards: Card[] = []): Hand {
  return { cards, bet, doubled: false, split: false, splitAce: false, done: false, outcome: null, payout: 0 };
}

export function isBlackjack(hand: Hand): boolean {
  return !hand.split && isTwoCard21(hand.cards);
}

/**
 * The shoe ran dry mid-round (only possible with a full table and a run of splits, since 78
 * cards sit behind the cut card): shuffle the discards, not the cards on the table, and keep
 * dealing. The cut card is long gone, so the round ends with a full shuffle.
 */
function reshuffleDiscards(r: Round, d: Dealing): void {
  const onTable = new Map<Card, number>();
  const note = (c: Card) => onTable.set(c, (onTable.get(c) ?? 0) + 1);
  r.dealer.forEach(note);
  for (const s of r.spots) for (const h of s.hands) h.cards.forEach(note);
  const discards: Card[] = [];
  for (const c of d.shoe.cards) {
    const n = onTable.get(c) ?? 0;
    if (n > 0) onTable.set(c, n - 1);
    else discards.push(c);
  }
  shuffle(d.rng, discards);
  d.shoe.cards = discards;
  d.shoe.pos = 0;
  d.shoe.cutAt = 0;
  emit(d, { type: 'shuffle', discards: true });
}

function nextCard(r: Round, d: Dealing): Card {
  if (cardsLeft(d.shoe) === 0) reshuffleDiscards(r, d);
  const card = draw(d.shoe);
  if (d.shoe.pos === d.shoe.cutAt) emit(d, { type: 'cut' });
  return card;
}

function dealTo(r: Round, si: number, hi: number, d: Dealing): Card {
  const card = nextCard(r, d);
  const s = r.spots[si]!;
  s.hands[hi]!.cards.push(card);
  emit(d, { type: 'card', seat: s.seat, hand: hi, card });
  return card;
}

function dealDealer(r: Round, d: Dealing, hole: boolean): void {
  const card = nextCard(r, d);
  r.dealer.push(card);
  // The hole card goes out face down: its identity stays on the server until the flip.
  emit(d, { type: 'dealer-card', card: hole ? null : card });
}

/** Settle one hand: record the outcome, pay what comes back, take its chips off the layout. */
function settleHand(s: Spot, hi: number, outcome: Outcome, payout: Cents, d: Dealing): void {
  const h = s.hands[hi]!;
  h.outcome = outcome;
  h.payout = payout;
  h.done = true;
  s.returned += payout;
  s.live -= h.bet;
  emit(d, { type: 'result', seat: s.seat, hand: hi, outcome, bet: h.bet, payout });
}

function settleInsurance(s: Spot, payout: Cents, d: Dealing): void {
  s.returned += payout;
  s.live -= s.insured;
  emit(d, { type: 'insurance-result', seat: s.seat, bet: s.insured, payout });
}

/**
 * Deal a round: one card to each circle from first base, the dealer's up card, a second card
 * each, then the hole card. Runs on to the first decision the table has to wait for (insurance
 * with an ace up, otherwise the first hand to play) or, if nobody has a decision, to the end.
 */
export function startRound(bets: readonly { seat: number; bet: Cents }[], d: Dealing): Round {
  const spots: Spot[] = [...bets]
    .sort((a, b) => spotOf(a.seat) - spotOf(b.seat))
    .map(({ seat, bet }) => ({ seat, base: bet, hands: [newHand(bet)], insurance: 'none', insured: 0, wagered: bet, returned: 0, live: bet }));
  const r: Round = { spots, dealer: [], holeUp: false, stage: 'play', turn: null, peeked: false, dealerBlackjack: false };
  for (let i = 0; i < spots.length; i++) dealTo(r, i, 0, d);
  dealDealer(r, d, false);
  for (let i = 0; i < spots.length; i++) dealTo(r, i, 0, d);
  dealDealer(r, d, true);
  if (cardValue(r.dealer[0]!) === 1) {
    r.stage = 'insurance';
    for (const s of spots) s.insurance = 'offered';
    emit(d, { type: 'insurance' });
    return r;
  }
  afterInsurance(r, d);
  return r;
}

/**
 * Insurance (or, on a blackjack, even money) with an ace up. Insurance is half the opening bet
 * and pays 2:1 if the hole card is a ten. Even money pays the blackjack 1:1 on the spot and ends
 * the hand. Once every circle has answered, the dealer peeks.
 */
export function decideInsurance(r: Round, seat: number, take: boolean, d: Dealing): Fault | null {
  if (r.stage !== 'insurance') return { code: 'WRONG_PHASE', msg: 'Insurance is only offered with an ace up.' };
  const s = r.spots.find((x) => x.seat === seat);
  if (!s || s.insurance !== 'offered') return { code: 'WRONG_PHASE', msg: "You've already answered." };
  const evenMoney = isBlackjack(s.hands[0]!);
  s.insurance = take ? 'taken' : 'declined';
  let amount = 0;
  if (take && !evenMoney) {
    amount = payOdds(s.base, 1, 2);
    s.insured = amount;
    s.wagered += amount;
    s.live += amount;
  }
  emit(d, { type: 'insured', seat, take, amount, evenMoney });
  if (take && evenMoney) settleHand(s, 0, 'evenmoney', 2 * s.base, d);
  if (r.spots.every((x) => x.insurance !== 'offered')) afterInsurance(r, d);
  return null;
}

/** What insurance would cost this seat right now (0 when it's even money or not on offer). */
export function insuranceCost(r: Round, seat: number): Cents {
  const s = r.spots.find((x) => x.seat === seat);
  if (!s || r.stage !== 'insurance' || s.insurance !== 'offered' || isBlackjack(s.hands[0]!)) return 0;
  return payOdds(s.base, 1, 2);
}

function afterInsurance(r: Round, d: Dealing): void {
  r.stage = 'play';
  const up = cardValue(r.dealer[0]!);
  if (up === 1 || up === 10) {
    r.peeked = true;
    r.dealerBlackjack = isTwoCard21(r.dealer);
    emit(d, { type: 'peek', blackjack: r.dealerBlackjack });
    if (r.dealerBlackjack) {
      revealHole(r, d);
      settleAgainstBlackjack(r, d);
      finish(r, d);
      return;
    }
  }
  // No dealer blackjack: insurance loses, and blackjacks are paid 3:2 right away.
  for (const s of r.spots) if (s.insured > 0) settleInsurance(s, 0, d);
  for (const s of r.spots) {
    const h = s.hands[0]!;
    if (h.outcome === null && isBlackjack(h)) settleHand(s, 0, 'blackjack', s.base + payOdds(s.base, 3, 2), d);
  }
  advance(r, d);
}

/**
 * The peek found a dealer blackjack, so the round ends before anyone decides anything. A player
 * blackjack pushes; every other hand loses its opening bet and nothing more. By construction
 * there is nothing more on the layout (no double or split can have happened), but the loss is
 * computed from the opening bet anyway, so the rule holds even if the flow above ever changes.
 */
function settleAgainstBlackjack(r: Round, d: Dealing): void {
  for (let si = r.spots.length - 1; si >= 0; si--) {
    const s = r.spots[si]!;
    if (s.insured > 0) settleInsurance(s, 3 * s.insured, d);
    for (let hi = s.hands.length - 1; hi >= 0; hi--) {
      const h = s.hands[hi]!;
      if (h.outcome !== null) continue;
      if (isBlackjack(h)) settleHand(s, hi, 'push', h.bet, d);
      else settleHand(s, hi, 'lose', hi === 0 ? Math.max(0, h.bet - s.base) : h.bet, d);
    }
  }
}

/** The legal moves for a hand, by the rules only (the engine also checks the seat can pay). */
export function legalMoves(r: Round, s: Spot, h: Hand): Record<Move, boolean> {
  const open = r.stage === 'play' && !h.done && h.outcome === null;
  const two = h.cards.length === 2;
  const pair = two && cardValue(h.cards[0]!) === cardValue(h.cards[1]!);
  const aces = pair && cardValue(h.cards[0]!) === 1;
  return {
    hit: open && !h.splitAce && handTotal(h.cards).total < 21,
    stand: open,
    double: open && two && !h.splitAce && !h.doubled,
    split: open && pair && s.hands.length < MAX_HANDS && !(aces && h.split),
    surrender: open && two && s.hands.length === 1 && !h.split && !h.doubled,
  };
}

/** What a move costs on top of what's already down: a double or a split puts up the bet again. */
export function moveCost(s: Spot, h: Hand, move: Move): Cents {
  if (move === 'double') return h.bet;
  if (move === 'split') return s.base;
  return 0;
}

/** The spot and hand whose turn it is, if any. */
export function current(r: Round): { spot: Spot; hand: Hand; si: number; hi: number } | null {
  if (!r.turn) return null;
  const spot = r.spots[r.turn.spot]!;
  return { spot, hand: spot.hands[r.turn.hand]!, si: r.turn.spot, hi: r.turn.hand };
}

/** A player's decision on the hand whose turn it is. */
export function play(r: Round, seat: number, move: Move, d: Dealing): Fault | null {
  const c = current(r);
  if (r.stage !== 'play' || !c) return { code: 'WRONG_PHASE', msg: 'There is no hand to play right now.' };
  if (c.spot.seat !== seat) return { code: 'NOT_YOUR_TURN', msg: "It isn't your turn." };
  const { spot: s, hand: h, si, hi } = c;
  if (!legalMoves(r, s, h)[move]) return { code: 'BAD_REQUEST', msg: refusal(move) };

  switch (move) {
    case 'hit':
      dealTo(r, si, hi, d);
      break;
    case 'stand':
      h.done = true;
      emit(d, { type: 'stand', seat, hand: hi });
      break;
    case 'double':
      s.wagered += h.bet;
      s.live += h.bet;
      h.bet *= 2;
      h.doubled = true;
      emit(d, { type: 'double', seat, hand: hi, bet: h.bet });
      dealTo(r, si, hi, d);
      h.done = true;
      break;
    case 'split': {
      const aces = cardValue(h.cards[0]!) === 1;
      const moved = h.cards.pop()!;
      const next = newHand(s.base, [moved]);
      h.split = next.split = true;
      h.splitAce = next.splitAce = aces;
      s.hands.splice(hi + 1, 0, next);
      s.wagered += s.base;
      s.live += s.base;
      emit(d, { type: 'split', seat, hand: hi, bet: s.base });
      dealTo(r, si, hi, d);
      if (aces) {
        // Split aces get one card each and are finished.
        dealTo(r, si, hi + 1, d);
        h.done = next.done = true;
      }
      break;
    }
    case 'surrender':
      settleHand(s, hi, 'surrender', payOdds(h.bet, 1, 2), d);
      break;
  }
  if (h.outcome === null) {
    const t = handTotal(h.cards).total;
    if (t > 21) settleHand(s, hi, 'bust', 0, d);
    else if (t === 21) h.done = true;
  }
  if (h.done) advance(r, d);
  return null;
}

function refusal(move: Move): string {
  switch (move) {
    case 'double':
      return 'You can only double on your first two cards.';
    case 'split':
      return 'You can split two cards of the same value, up to four hands (aces once).';
    case 'surrender':
      return 'Surrender is only allowed on your first two cards, before anything else.';
    default:
      return "That move isn't allowed on this hand.";
  }
}

/** Stand the hand whose turn it is (the turn timer ran out). */
export function standCurrent(r: Round, d: Dealing): void {
  const c = current(r);
  if (!c) return;
  c.hand.done = true;
  emit(d, { type: 'stand', seat: c.spot.seat, hand: c.hi, auto: true });
  advance(r, d);
}

/**
 * A seat is leaving mid-round: decline any insurance offer and stand every hand it still has.
 * The hands then settle normally when the dealer plays.
 */
export function standSeat(r: Round, seat: number, d: Dealing): void {
  const si = r.spots.findIndex((x) => x.seat === seat);
  if (si < 0 || r.stage === 'done') return;
  const s = r.spots[si]!;
  // Declining may be the last answer the dealer was waiting for, which can end the round.
  if (r.stage === 'insurance' && s.insurance === 'offered') decideInsurance(r, seat, false, d);
  if (isOver(r)) return;
  const active = r.turn?.spot === si;
  s.hands.forEach((h, hi) => {
    if (h.done) return;
    // A split hand still waiting for its second card gets it before it stands.
    if (h.cards.length === 1) dealTo(r, si, hi, d);
    const t = handTotal(h.cards).total;
    if (t > 21) settleHand(s, hi, 'bust', 0, d);
    else h.done = true;
  });
  if (active && r.stage === 'play') advance(r, d);
}

export function isOver(r: Round): boolean {
  return r.stage === 'done';
}

/** Move the turn to the next hand that needs a decision, or on to the dealer. */
function advance(r: Round, d: Dealing): void {
  let si = r.turn?.spot ?? 0;
  let hi = r.turn?.hand ?? 0;
  for (; si < r.spots.length; si++, hi = 0) {
    const s = r.spots[si]!;
    for (; hi < s.hands.length; hi++) {
      const h = s.hands[hi]!;
      if (h.done) continue;
      // The second hand of a split gets its second card when its turn comes, as at a real table.
      if (h.cards.length === 1) dealTo(r, si, hi, d);
      if (handTotal(h.cards).total === 21) {
        h.done = true;
        continue;
      }
      r.turn = { spot: si, hand: hi };
      emit(d, { type: 'turn', seat: s.seat, hand: hi });
      return;
    }
  }
  r.turn = null;
  dealerPlays(r, d);
  settle(r, d);
  finish(r, d);
}

function revealHole(r: Round, d: Dealing): void {
  r.holeUp = true;
  emit(d, { type: 'hole', card: r.dealer[1]! });
}

/** Dealer must draw to 16 and stand on all 17s. */
export function dealerStands(cards: readonly Card[]): boolean {
  return handTotal(cards).total >= 17;
}

function dealerPlays(r: Round, d: Dealing): void {
  revealHole(r, d);
  // With every hand already busted, surrendered or paid, the dealer turns the hole card and stops.
  const waiting = r.spots.some((s) => s.hands.some((h) => h.outcome === null));
  if (waiting) {
    while (!dealerStands(r.dealer)) dealDealer(r, d, false);
  }
  const t = handTotal(r.dealer);
  emit(d, { type: 'dealer', total: t.total, bust: t.total > 21, drew: r.dealer.length > 2 });
}

/** Compare every standing hand with the dealer, right to left (third base first). */
function settle(r: Round, d: Dealing): void {
  const dealer = handTotal(r.dealer).total;
  for (let si = r.spots.length - 1; si >= 0; si--) {
    const s = r.spots[si]!;
    for (let hi = s.hands.length - 1; hi >= 0; hi--) {
      const h = s.hands[hi]!;
      if (h.outcome !== null) continue;
      const mine = handTotal(h.cards).total;
      if (dealer > 21 || mine > dealer) settleHand(s, hi, 'win', 2 * h.bet, d);
      else if (mine === dealer) settleHand(s, hi, 'push', h.bet, d);
      else settleHand(s, hi, 'lose', 0, d);
    }
  }
}

/** The round is over. If the cut card came out during it, shuffle now and burn one. */
function finish(r: Round, d: Dealing): void {
  r.stage = 'done';
  r.turn = null;
  if (cutCardOut(d.shoe)) {
    d.shoe = openShoe(d.rng);
    emit(d, { type: 'shuffle' });
    emit(d, { type: 'burn' });
  }
}

/** Cards on the table in this round (for the discard tray's height). */
export function cardsOnTable(r: Round): number {
  let n = r.dealer.length;
  for (const s of r.spots) for (const h of s.hands) n += h.cards.length;
  return n;
}
