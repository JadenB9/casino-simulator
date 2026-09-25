// Achievements and challenges ("feats"). An achievement is a thing done once at a game (a
// blackjack, a royal flush, a point made); a challenge is an amount reached (a million won in all).
// The server decides both from the rounds the tables settle (server/src/feats.ts); the client only
// shows them. Each feat is earned once per account and pays its reward once: cash to the balance
// (a 'grant' ledger row keyed by the feat, so it can't pay twice), a piece or an emote that is
// never sold (items.ts, `reward`), and sometimes a title to wear under your name.
//
// Ids are stored in D1 (casino_feats) and in saved looks (look.title), so an id never changes
// once it has shipped.
//
// Tallies (casino_tally, one row per account and key) are what challenges are measured on:
//   won            cents won in rounds that made a profit (a round's profit: returned - wagered)
//   rounds         rounds played with money on them
//   best           the biggest profit on one round (kept as a maximum, not a sum)
//   won:<game>     cents won at that game
//   wins:<game>    rounds won at that game (games with one are the "games" count below)
//   bj:naturals    blackjacks dealt to you and paid
// `games` isn't stored: it's how many of the casino's games have a `wins:` row above zero.

import { DOLLAR, type Cents } from './money.ts';
import type { GameId } from './engine.ts';
import type { EmoteId } from './protocol.ts';
import { CATALOG } from './games/catalog.ts';

export type FeatKind = 'achievement' | 'challenge';

export interface Reward {
  /** Cents to the balance. */
  cash?: Cents;
  /** A worn reward item (items.ts SHOP_ITEMS with `reward`). */
  item?: string;
  /** A reward emote (protocol.ts REWARD_EMOTES). */
  emote?: EmoteId;
  /** A title the player may wear under their name ("High Roller"). */
  title?: string;
}

export interface Feat {
  id: string;
  kind: FeatKind;
  /** The game it's earned at, if one. */
  game?: GameId;
  name: string;
  /** What to do, one line: "Get a blackjack.", "Win $1,000,000 in all." */
  about: string;
  /**
   * For a challenge, the target on its tally (feats progress, GET /feats): shown as a bar. The
   * tally key is `tally`.
   */
  goal?: number;
  tally?: string;
  reward: Reward;
}

const $ = (n: number): Cents => n * DOLLAR;

/** Keys kept as the largest value seen rather than a running sum. */
export function isMaxTally(key: string): boolean {
  return key === 'best';
}

/** The games "every game" means: everything the floor offers (the dev fixture isn't one). */
export const FEAT_GAMES: readonly GameId[] = (Object.keys(CATALOG) as GameId[]).filter((g) => !CATALOG[g].dev);

/** How much a game's own amount challenge asks you to win there. */
export const GAME_WON_GOAL: Cents = $(50_000);

/** Each game's amount challenge: its id, name and the title it gives (none). */
const GAME_WON_NAMES: Record<GameId, string> = {
  blackjack: 'Card Counter',
  roulette: 'Wheel Watcher',
  craps: 'Hot Hand',
  baccarat: 'Punto Banco',
  slots: 'One-Armed Bandit',
  videopoker: 'Pay Table',
  threecard: 'Three of a Trade',
  holdem: 'Card Room Shark',
  war: 'War Chest',
  bigsix: 'Money Wheel',
  sicbo: 'Tai Sai',
  plinko: 'Peg Board',
  tower: 'Climber',
  mines: 'Prospector',
  dice: 'Dice Roller',
  limbo: 'Under the Bar',
  keno: 'Ticket Writer',
  hilo: 'Card Reader',
  crash: 'Flight Plan',
  banditwheel: 'Camp Regular',
  coinflip: 'Heads or Tails',
  wheel: 'Round and Round',
  cases: 'Case Closed',
  diamonds: 'Gem Cutter',
  letitride: 'Let It Ride',
  paigow: 'Two Hands',
  bingo: 'Full Card',
  pachinko: 'Silver Balls',
  highcard: 'High Card',
};

/** Games still without moments of their own: a big multiple stands in until they have some. */
const TEN_X: Partial<Record<GameId, string>> = {
  coinflip: 'Called It',
  wheel: 'Top Segment',
  cases: 'Good Case',
  diamonds: 'Rough Diamond',
  letitride: 'Rode It Home',
  paigow: 'Dragon Hand',
  bingo: 'Bingo',
  pachinko: 'Jackpot Tulip',
};

/** A round that paid back this many times its stake earns the stand-in above. */
export const TEN_X_MULTIPLE = 10;

const A = (id: string, game: GameId | undefined, name: string, about: string, reward: Reward): Feat => ({ id, kind: 'achievement', ...(game ? { game } : {}), name, about, reward });
const C = (id: string, game: GameId | undefined, name: string, about: string, tally: string, goal: number, reward: Reward): Feat => ({
  id,
  kind: 'challenge',
  ...(game ? { game } : {}),
  name,
  about,
  tally,
  goal,
  reward,
});

export const FEATS: readonly Feat[] = [
  // --- everywhere: amounts won, the biggest single rounds, rounds played, games won at -----------
  C('won-10k', undefined, 'On the Board', 'Win $10,000 in all.', 'won', $(10_000), { cash: $(1_000) }),
  C('won-100k', undefined, 'Six Figures', 'Win $100,000 in all.', 'won', $(100_000), { cash: $(5_000) }),
  C('won-1m', undefined, 'Millionaire', 'Win $1,000,000 in all.', 'won', $(1_000_000), { emote: 'trophy', title: 'Millionaire' }),
  C('won-10m', undefined, 'Tycoon', 'Win $10,000,000 in all.', 'won', $(10_000_000), { item: 'golden-board', title: 'Tycoon' }),
  C('won-100m', undefined, 'House Money', 'Win $100,000,000 in all.', 'won', $(100_000_000), { cash: $(1_000_000), title: 'Legend' }),
  C('round-10k', undefined, 'Big Night', 'Win $10,000 in one round.', 'best', $(10_000), { cash: $(2_500) }),
  C('round-50k', undefined, 'Smooth Operator', 'Win $50,000 in one round.', 'best', $(50_000), { emote: 'moonwalk' }),
  C('round-1m', undefined, 'High Roller', 'Win $1,000,000 in one round.', 'best', $(1_000_000), { item: 'high-roller-shades', title: 'High Roller' }),
  C('rounds-100', undefined, 'Regular', 'Play 100 rounds.', 'rounds', 100, { cash: $(1_000) }),
  C('rounds-1000', undefined, 'Fixture', 'Play 1,000 rounds.', 'rounds', 1_000, { cash: $(5_000), title: 'Regular' }),
  C('rounds-10000', undefined, 'Part of the Furniture', 'Play 10,000 rounds.', 'rounds', 10_000, { cash: $(25_000), title: 'Lifer' }),
  A('first-win', undefined, "Beginner's Luck", 'Win a round at any game.', { cash: $(500) }),
  C('games-5', undefined, 'Tour of the Floor', 'Win at five different games.', 'games', 5, { cash: $(5_000) }),
  C('games-all', undefined, 'Champion', 'Win at every game in the house.', 'games', FEAT_GAMES.length, { item: 'champion-jacket', title: 'Champion' }),

  // --- blackjack -----------------------------------------------------------------------------
  A('bj-blackjack', 'blackjack', 'Twenty-One', 'Get a blackjack.', { cash: $(500) }),
  A('bj-double', 'blackjack', 'Doubled Up', 'Win a hand you doubled down on.', { cash: $(750) }),
  A('bj-split', 'blackjack', 'Two for Two', 'Split a pair and win both hands.', { cash: $(2_500) }),
  C('bj-naturals', 'blackjack', 'Blackjack Royalty', 'Get 21 blackjacks.', 'bj:naturals', 21, { item: 'twentyone-pendant', title: 'Twenty-One' }),

  // --- roulette ------------------------------------------------------------------------------
  A('rl-straight', 'roulette', 'Straight Up', 'Hit a number straight up.', { cash: $(1_000) }),
  A('rl-zero', 'roulette', 'Green', 'Hit 0 or 00 straight up.', { cash: $(5_000), title: 'Green' }),

  // --- craps ---------------------------------------------------------------------------------
  A('cr-point', 'craps', 'Point Made', 'Win a pass line bet when the shooter makes the point.', { cash: $(750) }),
  A('cr-hard', 'craps', 'The Hard Way', 'Win a hardway bet.', { cash: $(2_500) }),
  A('cr-long', 'craps', 'Long Shot', 'Win on aces or boxcars at 30 to 1.', { cash: $(5_000) }),

  // --- baccarat ------------------------------------------------------------------------------
  A('bc-natural', 'baccarat', 'Natural Nine', 'Win a bet on a hand dealt a natural nine.', { cash: $(1_000) }),
  A('bc-tie', 'baccarat', 'Dead Heat', 'Win a tie bet.', { cash: $(2_500) }),
  A('bc-pair', 'baccarat', 'Pair Dealt', 'Win a Player or Banker pair bet.', { cash: $(2_500) }),

  // --- slots ---------------------------------------------------------------------------------
  A('sl-bonus', 'slots', 'Bonus Round', 'Start free games or the Cherry Wheel.', { cash: $(1_000) }),
  A('sl-hundred', 'slots', 'Hundred Times', 'Win 100 times your bet on one spin.', { cash: $(5_000) }),
  A('sl-jackpot', 'slots', 'Jackpot', "Hit a machine's top award.", { item: 'horseshoe-pendant', cash: $(25_000), title: 'Jackpot' }),

  // --- video poker ---------------------------------------------------------------------------
  A('vp-quads', 'videopoker', 'Four of a Kind', 'Draw four of a kind.', { cash: $(2_500) }),
  A('vp-straight-flush', 'videopoker', 'Straight Flush', 'Draw a straight flush.', { cash: $(10_000) }),
  A('vp-royal', 'videopoker', 'Royal Flush', 'Draw a royal flush.', { item: 'royal-pendant', cash: $(50_000), title: 'Royal' }),

  // --- three card poker ----------------------------------------------------------------------
  A('tc-trips', 'threecard', 'Trips', 'Get three of a kind at Three Card Poker.', { cash: $(2_500) }),
  A('tc-straight-flush', 'threecard', 'Three-Card Straight Flush', 'Get a straight flush at Three Card Poker.', { cash: $(5_000) }),

  // --- hold'em -------------------------------------------------------------------------------
  A('he-pot', 'holdem', 'Take It Down', "Win a pot at Hold'em.", { cash: $(500) }),
  A('he-boat', 'holdem', 'Full Boat', 'Win a showdown with a full house or better.', { cash: $(2_500) }),
  A('he-quads', 'holdem', 'Quads', 'Win a showdown with four of a kind or better.', { cash: $(10_000), title: 'Shark' }),

  // --- casino war ----------------------------------------------------------------------------
  A('wr-war', 'war', 'Going to War', 'Go to war and win.', { cash: $(750) }),
  A('wr-tie', 'war', 'Tie Breaker', 'Win the tie bet.', { cash: $(2_500) }),

  // --- big six -------------------------------------------------------------------------------
  A('b6-twenty', 'bigsix', 'Twenty Dollar Bill', 'Win on the $20.', { cash: $(1_000) }),
  A('b6-star', 'bigsix', 'Star Turn', 'Win on the Star or the Crown at 40 to 1.', { cash: $(5_000) }),

  // --- sic bo --------------------------------------------------------------------------------
  A('sb-total', 'sicbo', 'Four or Seventeen', 'Win a bet on a total of 4 or 17.', { cash: $(2_500) }),
  A('sb-triple', 'sicbo', 'Triple', 'Win a triple bet.', { cash: $(5_000) }),

  // --- the online games ----------------------------------------------------------------------
  A('pk-edge', 'plinko', 'Edge of the Board', 'Land a Plinko ball in an end bin.', { cash: $(1_000) }),
  A('pk-top', 'plinko', 'Top Bin', 'Land in an end bin of the 16-row board on High.', { cash: $(25_000), title: 'Plinko King' }),
  A('tw-top', 'tower', 'Top of the Tower', 'Climb all nine rows.', { cash: $(2_500) }),
  A('mn-gems', 'mines', 'Gem Hunter', 'Cash out with ten gems or more.', { cash: $(1_000) }),
  A('mn-clear', 'mines', 'Clean Sweep', 'Clear every gem off the board.', { cash: $(10_000), title: 'Minesweeper' }),
  A('dc-long', 'dice', 'Long Odds', 'Win a roll at a 5% chance or less.', { cash: $(1_000) }),
  A('lb-10x', 'limbo', 'Ten Times', 'Win at a 10x target or higher.', { cash: $(1_000) }),
  A('lb-100x', 'limbo', 'Hundred Times', 'Win at a 100x target or higher.', { cash: $(10_000) }),
  A('kn-catch', 'keno', 'Big Catch', 'Hit six numbers or more in one game.', { cash: $(2_500) }),
  A('kn-sweep', 'keno', 'Every Pick', 'Hit every number with five picks or more.', { cash: $(10_000) }),
  A('hl-streak', 'hilo', 'On a Roll', 'Call eight cards right in a row and cash out.', { cash: $(2_500) }),
  A('cs-10x', 'crash', 'Liftoff', 'Cash out at 10x or higher.', { cash: $(1_000) }),
  A('cs-100x', 'crash', 'Moonshot', 'Cash out at 100x or higher.', { cash: $(25_000), title: 'Rocketeer' }),

  // --- the bandit wheel ----------------------------------------------------------------------
  A('bw-10', 'banditwheel', 'Ten to One', 'Win on the 10.', { cash: $(1_000) }),
  A('bw-20', 'banditwheel', 'Bandit Twenty', 'Win on the 20.', { cash: $(2_500) }),

  // --- the newest games: a big multiple until they have moments of their own -------------------
  ...(Object.entries(TEN_X) as [GameId, string][]).map(([g, name]) =>
    A(`${CATALOG[g].prefix}-10x`, g, name, `Win ${TEN_X_MULTIPLE} times your stake in one round of ${CATALOG[g].name}.`, { cash: $(1_000) }),
  ),

  // --- each game's amount won ------------------------------------------------------------------
  ...FEAT_GAMES.map((g) => C(`won-${g}`, g, GAME_WON_NAMES[g], `Win $50,000 at ${CATALOG[g].name}.`, `won:${g}`, GAME_WON_GOAL, { cash: $(2_500) })),
];

const BY_ID = new Map(FEATS.map((f) => [f.id, f]));

export function featOf(id: unknown): Feat | null {
  return typeof id === 'string' ? (BY_ID.get(id) ?? null) : null;
}

/** The feat whose title this is (a look's `title` is a feat id), or null. */
export function titleOf(id: unknown): Feat | null {
  const f = featOf(id);
  return f?.reward.title ? f : null;
}

/** A game's feats, in list order (achievements first where the list has them so). */
export function featsAt(game: GameId | null): Feat[] {
  return FEATS.filter((f) => (f.game ?? null) === game);
}

/**
 * A tally as challenges read it, from the stored rows: `games` counts the casino's games with a
 * win; anything else is its row (0 when there isn't one).
 */
export function tallyValue(tally: Readonly<Record<string, number>>, key: string): number {
  if (key === 'games') return FEAT_GAMES.filter((g) => (tally[`wins:${g}`] ?? 0) > 0).length;
  return tally[key] ?? 0;
}

/** GET /feats: what you've earned and how far along each tally is. */
export interface FeatsResponse {
  feats: { feat: string; at: number }[];
  /** Tally key to value (cents for amounts, counts otherwise). */
  tally: Record<string, number>;
}
