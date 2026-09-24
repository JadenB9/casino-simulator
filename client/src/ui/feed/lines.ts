// How a big win reads: on the LED sign, in a toast, and in the day's tally. Pure, so the wording
// is tested next to the rules that make it.

import { CATALOG } from '../../../../shared/src/games/catalog.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import type { BigWin } from '../../../../shared/src/protocol.ts';

/** Whole dollars, the way a sign or a meter shows money: "$12,500". */
export function wholeDollars(amount: Cents): string {
  return formatMoney(Math.floor(Math.max(0, amount) / 100) * 100);
}

/**
 * What paid, with the game: "Roulette, Straight 17", "Video Poker, Royal Flush". A slot win
 * already starts with its machine's name ("Neon Nights, 250x"), which says more than "Slots".
 */
export function detail(w: Pick<BigWin, 'game' | 'what'>): string {
  const game = CATALOG[w.game]?.name ?? '';
  if (w.game === 'slots') return w.what || game;
  if (!w.what || w.what === game) return game;
  return `${game}, ${w.what}`;
}

/** The toast's two lines. */
export function toastLines(w: BigWin): { title: string; sub: string } {
  return { title: `${w.name} won ${wholeDollars(w.amount)}`, sub: detail(w) };
}

/** "1 big win" / "12 big wins". */
export function winsCount(n: number): string {
  return `${n} big win${n === 1 ? '' : 's'}`;
}
