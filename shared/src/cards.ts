// Cards, decks and shoes. A card is a two-character code, rank then suit ("As", "Td", "9h"),
// which is also exactly what goes over the wire and what the art is named after.

import { type Rng, shuffle, randInt } from './rng.ts';

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'] as const;
export const SUITS = ['s', 'h', 'd', 'c'] as const;

export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];
export type Card = `${Rank}${Suit}`;

const CARD_RE = /^[A2-9TJQK][shdc]$/;

export function isCard(x: unknown): x is Card {
  return typeof x === 'string' && CARD_RE.test(x);
}

export function rankOf(card: Card): Rank {
  return card[0] as Rank;
}

export function suitOf(card: Card): Suit {
  return card[1] as Suit;
}

/** Ace low: A = 1, 2..10, J = 11, Q = 12, K = 13. */
export function rankNumber(card: Card): number {
  return RANKS.indexOf(rankOf(card)) + 1;
}

/** Ace high: 2..10, J = 11, Q = 12, K = 13, A = 14 (poker ordering). */
export function rankHigh(card: Card): number {
  const n = rankNumber(card);
  return n === 1 ? 14 : n;
}

export function isRed(card: Card): boolean {
  const s = suitOf(card);
  return s === 'h' || s === 'd';
}

/** One 52-card deck in a fixed order (spades, hearts, diamonds, clubs; ace to king). */
export function newDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(`${r}${s}` as Card);
  return deck;
}

/**
 * A multi-deck shoe as plain data, so it can be stored with the table and sent nowhere.
 * `pos` is the next card to deal; the round in which `pos` passes `cutAt` is the last before a
 * reshuffle (the cut card has come out).
 */
export interface Shoe {
  cards: Card[];
  pos: number;
  cutAt: number;
  decks: number;
}

/**
 * Build and shuffle a shoe. `penetration` is how far in the cut card sits (0.75 = three
 * quarters of the cards are dealt before the reshuffle). `cutJitter` moves it by up to that
 * many cards either way, the way a dealer never places it in exactly the same spot.
 */
export function newShoe(rng: Rng, decks: number, penetration: number, cutJitter = 0): Shoe {
  const cards: Card[] = [];
  for (let d = 0; d < decks; d++) cards.push(...newDeck());
  shuffle(rng, cards);
  let cutAt = Math.floor(cards.length * penetration);
  if (cutJitter > 0) cutAt += randInt(rng, 2 * cutJitter + 1) - cutJitter;
  return { cards, pos: 0, cutAt, decks };
}

/** Deal the next card. Mutates the shoe; engines deal from their own copy of the state. */
export function draw(shoe: Shoe): Card {
  const card = shoe.cards[shoe.pos];
  if (card === undefined) throw new Error('draw: the shoe is empty');
  shoe.pos++;
  return card;
}

export function cutCardOut(shoe: Shoe): boolean {
  return shoe.pos >= shoe.cutAt;
}

export function cardsLeft(shoe: Shoe): number {
  return shoe.cards.length - shoe.pos;
}
