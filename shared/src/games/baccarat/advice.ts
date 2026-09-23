// Tips at the baccarat table. Nothing is decided once the cards are out, so the tip is about the
// bets: which one gives the house the least and which the most. The edges are the exact ones for
// eight decks with ties counted (docs/rules/table-games.md §4.4); the enumeration test checks them
// against its own count of every coup.

import { SPOTS, SPOT_NAMES, type Spot } from './rules.ts';

/** Expected loss per unit bet. */
export const HOUSE_EDGE: Readonly<Record<Spot, number>> = {
  banker: 114_753_351_728 / 10_847_218_479_825,
  player: 241_149_546_272 / 19_524_993_263_685,
  tie: 103_841_353_768 / 723_147_898_655,
  playerPair: 43 / 415,
  bankerPair: 43 / 415,
};

/** The bet with the lowest house edge: the one a tip points at. */
export function bestBet(): Spot {
  return SPOTS.reduce((best, s) => (HOUSE_EDGE[s] < HOUSE_EDGE[best] ? s : best));
}

function worstBet(): Spot {
  return SPOTS.reduce((worst, s) => (HOUSE_EDGE[s] > HOUSE_EDGE[worst] ? s : worst));
}

/** "1.06%", "14.4%": two decimals under 10%, one above. */
function percent(x: number): string {
  return `${(x * 100).toFixed(x < 0.1 ? 2 : 1)}%`;
}

/** The betting window's tip: "Banker has the lowest house edge (1.06%), Tie the highest (14.4%)". */
export function bettingTip(): string {
  const low = bestBet();
  const high = worstBet();
  return `${SPOT_NAMES[low]} has the lowest house edge (${percent(HOUSE_EDGE[low])}), ${SPOT_NAMES[high]} the highest (${percent(HOUSE_EDGE[high])})`;
}
