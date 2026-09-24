// Generators that make an engine's next deal come out as a test wants it, so exact hands can be
// played through the real engine. Each answers the engine's own Fisher-Yates draws with the
// position of the card wanted next; anything that draws further throws.

import { type Card, newDeck, isCard } from '../../src/cards.ts';
import type { Rng } from '../../src/rng.ts';

/** "Ks Kd 10c" to cards (a 10 may be written 10 or T). */
export function cards(s: string): Card[] {
  return s.split(' ').map((c) => {
    const x = c.length === 3 ? `T${c[2]}` : c;
    if (!isCard(x)) throw new Error(`bad card ${c}`);
    return x;
  });
}

/**
 * A fresh-deck deal (Three Card Poker's dealHands): `top` comes out in that order, each hand's
 * three cards in spot order and then the dealer's.
 */
export function stackedDeck(top: Card[]): Rng {
  const cur = newDeck();
  const draws: number[] = [];
  top.forEach((card, t) => {
    const i = cur.length - 1 - t;
    const j = cur.indexOf(card);
    draws.push(j);
    [cur[i], cur[j]] = [cur[j]!, cur[i]!];
  });
  let k = 0;
  return {
    next32() {
      if (k >= draws.length) throw new Error('stacked deck used up');
      return draws[k++]!;
    },
  };
}

/**
 * A `decks`-deck shoe (Casino War's): `top` comes out first (the burn card, then the cards in the
 * order they are dealt), followed by the rest of the decks.
 */
export function stackedShoe(top: Card[], decks: number): Rng {
  const start: Card[] = [];
  for (let d = 0; d < decks; d++) start.push(...newDeck());
  const rest = start.slice();
  for (const c of top) {
    const k = rest.indexOf(c);
    if (k < 0) throw new Error(`more than ${decks} of ${c}`);
    rest.splice(k, 1);
  }
  const target = [...top, ...rest];
  const cur = start.slice();
  const draws: number[] = [];
  for (let i = cur.length - 1; i > 0; i--) {
    const j = cur.lastIndexOf(target[i]!, i);
    draws.push(j);
    [cur[i], cur[j]] = [cur[j]!, cur[i]!];
  }
  let k = 0;
  return {
    next32() {
      if (k >= draws.length) throw new Error('stacked shoe used up');
      return draws[k++]!;
    },
  };
}
