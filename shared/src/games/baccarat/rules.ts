// Baccarat (punto banco) as pure functions: point values, the drawing rules, one coup from a
// shoe, the house's shoe procedure, and what each bet returns. The engine, the exact
// enumeration and the Monte Carlo test all run these same functions, so a mistake in any of
// them shows up in every check at once.
//
// Rules and sources: docs/rules/table-games.md §4.

import { type Card, type Rank, type Shoe, newShoe, draw, rankOf } from '../../cards.ts';
import type { Rng } from '../../rng.ts';
import { type Cents, payOdds } from '../../money.ts';

export const DECKS = 8;
/** The cut card goes in this many cards from the bottom of the shoe. */
export const CUT_FROM_BOTTOM = 16;

// ---------------------------------------------------------------------------------------------
// Points

/** Ace 1, two to nine at face value, tens and pictures 0. */
export const POINTS: Readonly<Record<Rank, number>> = {
  A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 0, J: 0, Q: 0, K: 0,
};

export function points(card: Card): number {
  return POINTS[rankOf(card)];
}

/** A hand's total is the sum of its points, keeping only the last digit. */
export function handTotal(cards: readonly Card[]): number {
  let t = 0;
  for (const c of cards) t += POINTS[rankOf(c)];
  return t % 10;
}

/**
 * After a shuffle the dealer turns the first card up and burns that many more. Here tens and
 * pictures count 10, not 0, and the ace counts 1.
 */
export function burnCount(card: Card): number {
  const p = POINTS[rankOf(card)];
  return p === 0 ? 10 : p;
}

/** Two cards of the same rank (K-K, 10-10). J-Q is not a pair. */
export function isPair(a: Card, b: Card): boolean {
  return rankOf(a) === rankOf(b);
}

// ---------------------------------------------------------------------------------------------
// Drawing rules (tableau)

export type Hand = 'player' | 'banker';
export type Winner = Hand | 'tie';

/** An 8 or 9 on the first two cards. If either hand has one, both stand. */
export function isNatural(twoCardTotal: number): boolean {
  return twoCardTotal >= 8;
}

/** The Player draws on 0-5 and stands on 6-7 (8-9 is a natural). */
export function playerDraws(total: number): boolean {
  return total <= 5;
}

/**
 * When the Player drew, the Banker's move depends on its own two-card total (rows 0-7) and the
 * point value of the Player's third card (columns 0-9), not on the Player's total. D = draw,
 * S = stand. The same table as docs/rules/table-games.md §4.2.
 */
export const BANKER_TABLEAU: readonly string[] = [
  'DDDDDDDDDD', // 0
  'DDDDDDDDDD', // 1
  'DDDDDDDDDD', // 2
  'DDDDDDDDSD', // 3: stands only against an 8
  'SSDDDDDDSS', // 4: draws against 2-7
  'SSSSDDDDSS', // 5: draws against 4-7
  'SSSSSSDDSS', // 6: draws against 6-7
  'SSSSSSSSSS', // 7
];

/**
 * Whether the Banker draws. `playerThird` is the point value of the Player's third card, or
 * null when the Player stood, in which case the Banker plays like the Player: draw on 0-5.
 */
export function bankerDraws(total: number, playerThird: number | null): boolean {
  if (playerThird === null) return total <= 5;
  return BANKER_TABLEAU[total]?.[playerThird] === 'D';
}

/**
 * Who takes the next card once the first four are out, or null when the coup is over. The
 * arguments are point values in the order each hand received them. No hand ever gets more than
 * three cards.
 */
export function nextDraw(player: readonly number[], banker: readonly number[]): Hand | null {
  if (banker.length > 2) return null;
  const b = (banker[0]! + banker[1]!) % 10;
  if (player.length > 2) return bankerDraws(b, player[2]!) ? 'banker' : null;
  const p = (player[0]! + player[1]!) % 10;
  if (isNatural(p) || isNatural(b)) return null;
  if (playerDraws(p)) return 'player';
  return bankerDraws(b, null) ? 'banker' : null;
}

export function winnerOf(playerTotal: number, bankerTotal: number): Winner {
  return playerTotal > bankerTotal ? 'player' : bankerTotal > playerTotal ? 'banker' : 'tie';
}

// ---------------------------------------------------------------------------------------------
// A coup

export interface Coup {
  /** Cards in the order each hand got them. */
  player: Card[];
  banker: Card[];
  playerTotal: number;
  bankerTotal: number;
  winner: Winner;
  /** Either hand had 8 or 9 on its first two cards. */
  natural: boolean;
  playerPair: boolean;
  bankerPair: boolean;
}

export function coupOf(player: Card[], banker: Card[]): Coup {
  const playerTotal = handTotal(player);
  const bankerTotal = handTotal(banker);
  return {
    player,
    banker,
    playerTotal,
    bankerTotal,
    winner: winnerOf(playerTotal, bankerTotal),
    natural: isNatural(handTotal(player.slice(0, 2))) || isNatural(handTotal(banker.slice(0, 2))),
    playerPair: isPair(player[0]!, player[1]!),
    bankerPair: isPair(banker[0]!, banker[1]!),
  };
}

/** Deal one coup: Player, Banker, Player, Banker, then third cards by the tableau, Player's first. */
export function dealCoup(next: () => Card): Coup {
  const player = [next()];
  const banker = [next()];
  player.push(next());
  banker.push(next());
  const pv = player.map(points);
  const bv = banker.map(points);
  for (let hand = nextDraw(pv, bv); hand !== null; hand = nextDraw(pv, bv)) {
    const c = next();
    if (hand === 'player') {
      player.push(c);
      pv.push(points(c));
    } else {
      banker.push(c);
      bv.push(points(c));
    }
  }
  return coupOf(player, banker);
}

// ---------------------------------------------------------------------------------------------
// The shoe procedure

export interface Burn {
  /** The card turned face up; the `count` cards burned after it stay face down and unseen. */
  card: Card;
  count: number;
}

/** A new 8-deck shoe: shuffled, the cut card 16 from the bottom, and the burn done. */
export function freshShoe(rng: Rng): { shoe: Shoe; burn: Burn } {
  const shoe = newShoe(rng, DECKS, 1);
  shoe.cutAt = shoe.cards.length - CUT_FROM_BOTTOM;
  const card = draw(shoe);
  const count = burnCount(card);
  shoe.pos += count;
  return { shoe, burn: { card, count } };
}

/** The table's shoe between coups. Plain data, stored with the table's state. */
export interface ShoeTrack {
  shoe: Shoe | null;
  /** Shoes started at this table. */
  shoeNo: number;
  /** The cut card came out during the last coup, so the next coup is the last of this shoe. */
  lastHand: boolean;
  /** The last hand has been dealt: shuffle before the next coup. */
  shuffleNext: boolean;
}

export function newTrack(): ShoeTrack {
  return { shoe: null, shoeNo: 0, lastHand: false, shuffleNext: false };
}

export interface PlayedCoup {
  coup: Coup;
  /** Set when this coup started a new shoe. */
  burn: Burn | null;
  /** The cut card came out just before this card of the coup (0-5), or null. */
  cut: number | null;
}

/**
 * Deal the next coup the way the house does: shuffle and burn when the shoe is new or finished;
 * when the cut card comes out, finish that coup, deal one more, then shuffle. The 16 cards
 * behind the cut card always cover both (six cards at most each). Mutates `t`.
 */
export function playCoup(t: ShoeTrack, rng: Rng): PlayedCoup {
  let burn: Burn | null = null;
  if (t.shoe === null || t.shuffleNext) {
    const fresh = freshShoe(rng);
    t.shoe = fresh.shoe;
    t.shoeNo++;
    t.lastHand = false;
    t.shuffleNext = false;
    burn = fresh.burn;
  }
  const shoe = t.shoe;
  const start = shoe.pos;
  const coup = dealCoup(() => draw(shoe));
  let cut: number | null = null;
  if (t.lastHand) {
    t.lastHand = false;
    t.shuffleNext = true;
  } else if (start <= shoe.cutAt && shoe.cutAt < shoe.pos) {
    t.lastHand = true;
    cut = shoe.cutAt - start;
  }
  return { coup, burn, cut };
}

// ---------------------------------------------------------------------------------------------
// Bets and what they return

export const SPOTS = ['player', 'banker', 'tie', 'playerPair', 'bankerPair'] as const;
export type Spot = (typeof SPOTS)[number];
export type Bets = Partial<Record<Spot, Cents>>;

export const SPOT_NAMES: Readonly<Record<Spot, string>> = {
  player: 'Player',
  banker: 'Banker',
  tie: 'Tie',
  playerPair: 'Player Pair',
  bankerPair: 'Banker Pair',
};

/** What a win pays, a:b. The Banker's 19:20 is 1:1 less the 5% commission. */
export const PAYS: Readonly<Record<Spot, readonly [number, number]>> = {
  player: [1, 1],
  banker: [19, 20],
  tie: [8, 1],
  playerPair: [11, 1],
  bankerPair: [11, 1],
};

export const COMMISSION_PERCENT = 5;

/** Which limits key a spot is checked against: `default` is the Player/Banker limit. */
export function limitKey(spot: Spot): 'default' | 'tie' | 'pair' {
  return spot === 'tie' ? 'tie' : spot === 'playerPair' || spot === 'bankerPair' ? 'pair' : 'default';
}

export type SpotOutcome = 'win' | 'lose' | 'push';

export interface SpotResult {
  bet: Cents;
  outcome: SpotOutcome;
  /** Back to the stack, stake included. */
  returned: Cents;
  /** The 5% taken from a winning Banker bet (0 otherwise). */
  commission: Cents;
}

type Outcome = Pick<Coup, 'winner' | 'playerPair' | 'bankerPair'>;

function won(bet: Cents, win: Cents, commission = 0): SpotResult {
  return { bet, outcome: 'win', returned: bet + win, commission };
}

const lost = (bet: Cents): SpotResult => ({ bet, outcome: 'lose', returned: 0, commission: 0 });
const pushed = (bet: Cents): SpotResult => ({ bet, outcome: 'push', returned: bet, commission: 0 });

/**
 * Settle one bet. A tie pushes Player and Banker bets. The commission is 5% of a winning Banker
 * bet, taken when it is paid: 5 cents a dollar, exact because bets are whole dollars (payOdds
 * throws on anything that isn't a whole number of cents, and the table's $1 step never lets one
 * through). Pair bets are settled on each hand's first two cards, whoever wins the coup.
 */
export function settleSpot(spot: Spot, bet: Cents, c: Outcome): SpotResult {
  switch (spot) {
    case 'player':
      if (c.winner === 'tie') return pushed(bet);
      return c.winner === 'player' ? won(bet, payOdds(bet, ...PAYS.player)) : lost(bet);
    case 'banker': {
      if (c.winner === 'tie') return pushed(bet);
      if (c.winner !== 'banker') return lost(bet);
      const commission = payOdds(bet, COMMISSION_PERCENT, 100);
      return won(bet, bet - commission, commission);
    }
    case 'tie':
      return c.winner === 'tie' ? won(bet, payOdds(bet, ...PAYS.tie)) : lost(bet);
    case 'playerPair':
      return c.playerPair ? won(bet, payOdds(bet, ...PAYS.playerPair)) : lost(bet);
    case 'bankerPair':
      return c.bankerPair ? won(bet, payOdds(bet, ...PAYS.bankerPair)) : lost(bet);
  }
}

export interface SeatResult {
  spots: Partial<Record<Spot, SpotResult>>;
  wagered: Cents;
  returned: Cents;
  commission: Cents;
}

export function settleBets(bets: Bets, c: Outcome): SeatResult {
  const r: SeatResult = { spots: {}, wagered: 0, returned: 0, commission: 0 };
  for (const spot of SPOTS) {
    const bet = bets[spot];
    if (!bet) continue;
    const s = settleSpot(spot, bet, c);
    r.spots[spot] = s;
    r.wagered += bet;
    r.returned += s.returned;
    r.commission += s.commission;
  }
  return r;
}

export function betTotal(bets: Bets | undefined): Cents {
  let t = 0;
  if (bets) for (const spot of SPOTS) t += bets[spot] ?? 0;
  return t;
}

// ---------------------------------------------------------------------------------------------
// Seats

/**
 * Seat numbers as printed on the felt, 1-7 from the dealer's left. The host hands out seat 0
 * first, so the first player sits in the middle (4) and later arrivals fill outwards, the way
 * people pick seats at a real table. Settlement runs from the highest seat number down.
 */
export const SEAT_NUMBERS: readonly number[] = [4, 3, 5, 2, 6, 1, 7];

export function seatNumber(seat: number): number {
  return SEAT_NUMBERS[seat] ?? seat + 1;
}
