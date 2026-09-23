// Casino War rules: card ranks, the Tie and War payouts, settlement, the exact odds and the
// six-deck shoe. Everything here is a pure function of cards and bets, and the engine, the exact
// enumeration and the Monte Carlo test all call the same functions, so the numbers the tests check
// are the numbers the table pays. Rules and sources: docs/rules/table-games.md section 7.

import { type Card, type Shoe, newShoe, draw, rankHigh } from '../../cards.ts';
import { type Cents, payOdds } from '../../money.ts';
import type { Rng } from '../../rng.ts';

export const DECKS = 6;
export const SHOE_CARDS = DECKS * 52;
/** The cover card goes a quarter of the way up from the bottom (58 Pa. Code 651a.5(d)); only the round it comes out in deals past it. */
export const CUT_FROM_BOTTOM = SHOE_CARDS / 4;
/** Cards the dealer burns, face down and unseen, before the war deal (651a.9(f)). */
export const WAR_BURN = 3;

export interface WarRules {
  /** The Tie bet pays this to 1 when the first two cards tie (651a.10(a)(2): 10). */
  tiePays: number;
  /**
   * The War raise pays this to 1 when the war cards tie as well. 651a.10(a)(3) pays 2 to 1, the
   * same thing as the bonus equal to the original bet that Wizard of Odds lists for the Mirage; 1
   * is the "no bonus" rule, where a tie in the war just wins the raise even money.
   */
  warTiePays: number;
}

export const DEFAULT_RULES: WarRules = { tiePays: 10, warTiePays: 2 };

function isPays(x: unknown, max: number): x is number {
  return Number.isSafeInteger(x) && (x as number) >= 1 && (x as number) <= max;
}

/** The rules from a table's options, falling back to the defaults for anything malformed. */
export function rulesOf(options: Record<string, unknown>): WarRules {
  return {
    tiePays: isPays(options.tiePays, 100) ? options.tiePays : DEFAULT_RULES.tiePays,
    warTiePays: isPays(options.warTiePays, 10) ? options.warTiePays : DEFAULT_RULES.warTiePays,
  };
}

// ---------------------------------------------------------------------------------------------
// Ranks

/** Deuce 2 up to ace 14. Aces are always high and suits never matter (651a.6). */
export function value(card: Card): number {
  return rankHigh(card);
}

/** 1 when `a` outranks `b`, -1 when it is lower, 0 for a tie. */
export function compare(a: Card, b: Card): -1 | 0 | 1 {
  const d = value(a) - value(b);
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}

// ---------------------------------------------------------------------------------------------
// Settlement

export interface Bets {
  /** The main bet (the Initial Wager); every seat in the round has one. */
  bet: Cents;
  /** The optional Tie bet, placed with the main bet. */
  tie: Cents;
}

export type Choice = 'war' | 'surrender';

/** One seat's cards for a round: the deal, and after a tie the player's choice and the war cards. */
export interface Hand {
  player: Card;
  dealer: Card;
  choice?: Choice;
  war?: { player: Card; dealer: Card };
}

export type Outcome = 'win' | 'lose' | 'surrender' | 'war-win' | 'war-tie' | 'war-lose';

export interface Settlement {
  outcome: Outcome;
  /** What each spot gives back to the stack, stake included; 0 means the bet lost. */
  bet: Cents;
  /** The War raise (always equal to the bet); 0 when there was no war or it lost. */
  war: Cents;
  tie: Cents;
  wagered: Cents;
  returned: Cents;
}

/**
 * The deal on its own: what the Tie bet returns, and what the main bet returns, or null on a tie
 * (the player chooses to surrender or go to war first). A higher card wins even money, a lower
 * one loses, and a tie wins the Tie bet (651a.9(a)).
 */
export function settleDeal(bets: Bets, player: Card, dealer: Card, rules: WarRules): { cmp: -1 | 0 | 1; bet: Cents | null; tie: Cents } {
  const cmp = compare(player, dealer);
  const tie = cmp === 0 && bets.tie > 0 ? bets.tie * (rules.tiePays + 1) : 0;
  const bet = cmp > 0 ? 2 * bets.bet : cmp < 0 ? 0 : null;
  return { cmp, bet, tie };
}

/**
 * Settle one seat's round.
 *
 * - Surrendering a tie gives back half the bet (651a.9(c)(1)).
 * - Going to war adds a raise equal to the bet. A higher war card pushes the bet and pays the
 *   raise even money; a tie in the war pushes the bet and pays the raise `warTiePays` to 1; a
 *   lower one loses both (651a.9(g), 651a.10(a)(3)).
 * - The Tie bet is settled on the deal alone, whatever the player does next.
 */
export function settle(bets: Bets, hand: Hand, rules: WarRules): Settlement {
  const deal = settleDeal(bets, hand.player, hand.dealer, rules);
  const tie = deal.tie;
  let outcome: Outcome;
  let bet = 0;
  let war = 0;
  let raise = 0;
  if (deal.bet !== null) {
    outcome = deal.cmp > 0 ? 'win' : 'lose';
    bet = deal.bet;
  } else if (hand.choice === 'surrender') {
    outcome = 'surrender';
    bet = payOdds(bets.bet, 1, 2);
  } else if (hand.choice === 'war' && hand.war) {
    raise = bets.bet;
    const w = compare(hand.war.player, hand.war.dealer);
    if (w < 0) {
      outcome = 'war-lose';
    } else {
      outcome = w > 0 ? 'war-win' : 'war-tie';
      bet = bets.bet;
      war = raise * ((w > 0 ? 1 : rules.warTiePays) + 1);
    }
  } else {
    throw new Error('settle: a tie needs a choice, and a war its cards');
  }
  return { outcome, bet, war, tie, wagered: bets.bet + bets.tie + raise, returned: bet + war + tie };
}

// ---------------------------------------------------------------------------------------------
// Strategy and exact odds

/**
 * Exact odds from the rank counts of a full shoe, per unit bet. A tie on the deal comes up
 * 23 times in 311 with six decks. After it, the three burned cards are unseen, so they don't
 * change the chances of the next two: the war cards come from the 310 cards left, 22 of the tied
 * rank and 24 of every other.
 *
 * `goToWar` and `surrender` are the main bet's expected result when the player always does that on
 * a tie; `war` and `surrender` differ only on ties, where going to war gives `warAfterTie` against
 * surrender's -1/2. `tieBet` is the Tie bet's.
 */
export function exactOdds(rules: WarRules = DEFAULT_RULES): { pTie: number; warAfterTie: number; goToWar: number; surrender: number; tieBet: number } {
  const n = 4 * DECKS;
  const total = SHOE_CARDS * (SHOE_CARDS - 1);
  const ties = 13 * n * (n - 1);
  const left = SHOE_CARDS - 2;
  const warTotal = left * (left - 1);
  const warTies = (n - 2) * (n - 3) + 12 * n * (n - 1);
  const warWins = (warTotal - warTies) / 2;
  const warEv = (warWins + warTies * rules.warTiePays - 2 * warWins) / warTotal;
  const pTie = ties / total;
  return {
    pTie,
    warAfterTie: warEv,
    goToWar: pTie * warEv,
    surrender: pTie * -0.5,
    tieBet: (ties * rules.tiePays - (total - ties)) / total,
  };
}

/**
 * The best play on a tie. Going to war risks two units to win one (two on a tie in the war) and
 * expects to lose 0.315 of the bet (0.389 without the bonus); surrendering loses 0.5 for sure.
 * Whatever rank tied, the war cards come from the rest of the shoe blind, so it is always war.
 */
export function bestChoice(rules: WarRules = DEFAULT_RULES): Choice {
  return exactOdds(rules).warAfterTie > -0.5 ? 'war' : 'surrender';
}

// ---------------------------------------------------------------------------------------------
// The shoe

/** A fresh shoe: six decks shuffled, the cover card a quarter from the bottom, the first card burned (651a.8(b)). */
export function openShoe(rng: Rng): Shoe {
  const shoe = newShoe(rng, DECKS, 1);
  shoe.cutAt = shoe.cards.length - CUT_FROM_BOTTOM;
  draw(shoe);
  return shoe;
}

/**
 * The cover card sits just in front of card `cutAt`. It comes out when that card is needed, at the
 * start of a round or during it; the round is finished and then the cards are reshuffled
 * (651a.8(d)). So the shoe is due for a shuffle once card `cutAt` has been dealt.
 */
export function shuffleDue(shoe: Shoe | null): boolean {
  return shoe === null || shoe.pos > shoe.cutAt;
}

function next(shoe: Shoe, out: { cut: boolean }): Card {
  if (shoe.pos === shoe.cutAt) out.cut = true;
  return draw(shoe);
}

/**
 * The deal: one card face up to each of `players` in order, then one to the dealer (651a.8(c)).
 * Mutates the shoe; `cut` says the cover card came out, so this is the shoe's last round.
 */
export function dealRound(shoe: Shoe, players: number): { cards: Card[]; dealer: Card; cut: boolean } {
  const out = { cut: false };
  const cards: Card[] = [];
  for (let i = 0; i < players; i++) cards.push(next(shoe, out));
  const dealer = next(shoe, out);
  return { cards, dealer, cut: out.cut };
}

/** The war deal: burn three face down, then one card to each of `players` at war and one to the dealer (651a.9(f)). */
export function dealWar(shoe: Shoe, players: number): { cards: Card[]; dealer: Card; cut: boolean } {
  const out = { cut: false };
  for (let i = 0; i < WAR_BURN; i++) next(shoe, out);
  const cards: Card[] = [];
  for (let i = 0; i < players; i++) cards.push(next(shoe, out));
  const dealer = next(shoe, out);
  return { cards, dealer, cut: out.cut };
}

// ---------------------------------------------------------------------------------------------
// Names, for the dealer's calls

const NAMES = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
const PLURALS = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];

/** "Ace", "Ten", "Seven". */
export function cardName(card: Card): string {
  return NAMES[value(card) - 2]!;
}

/** "Aces", "Sixes": a tie, called by rank. */
export function pluralName(card: Card): string {
  return PLURALS[value(card) - 2]!;
}
