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
//   theo           what play has cost on average: each round's stake times its game's edge
//   comp           the cash comps have paid (count challenges and dailies)
// `games` isn't stored: it's how many of the casino's games have a `wins:` row above zero.
//
// Daily challenges: three a day, the same three for everyone, new at midnight Las Vegas time
// (dailyFeats). They're measured on the day's own copies of the tallies, `d:<YYYY-MM-DD>:won`,
// `d:<day>:rounds`, `d:<day>:best`, `d:<day>:wins:<game>`, and their ids name the day
// (`daily:<day>:<0-2>`), so each is earned once per day. Tables drop day rows a few days old.

import { DOLLAR, type Cents } from './money.ts';
import type { GameId } from './engine.ts';
import type { EmoteId } from './protocol.ts';
import { CATALOG } from './games/catalog.ts';
import { isStatMaxTally } from './stats.ts'; // v6 stats6

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
  /** A daily challenge: the casino day (YYYY-MM-DD) it belongs to. */
  daily?: string;
  /**
   * An achievement with cash: the most its moment can happen in one round, however it's played
   * (an upper bound). The cash it pays scales with the round's stake by it (momentRate).
   */
  odds?: number;
  /** A challenge in counts (rounds, games) or a daily: its cash is a comp on play (compCash). */
  comp?: true;
  /** The least the round must have staked for its moment to count (the marquee pieces). */
  minStake?: Cents;
}

const $ = (n: number): Cents => n * DOLLAR;

/** Keys kept as the largest value seen rather than a running sum. */
export function isMaxTally(key: string): boolean {
  return key === 'best' || key.endsWith(':best') || isStatMaxTally(key); // v6 stats6: worst, worst:<game>, streak
}

/** The games "every game" means: everything the floor offers (the dev fixture isn't one). */
export const FEAT_GAMES: readonly GameId[] = (Object.keys(CATALOG) as GameId[]).filter((g) => !CATALOG[g].dev);

// ---------------------------------------------------------------------------------------------
// What a feat's cash may cost the house
//
// Feats must not be worth hunting: the cash they pay must never be more than the play that
// earns them costs, on average, however it's played and at whatever stake. The cost of play is
// the house edge on what was staked, so every rule below pays out of that edge:
//
//   Achievements (a moment: a royal, a straight-up hit). A round staking W at a game whose
//   lowest edge is e costs at least e·W on average; the moment happens in it with chance at most
//   p (Feat.odds, an upper bound over every way of playing). Paying rate·W with
//     rate = MOMENT_SHARE · e / (p · n)        (n: the game's cash achievements)
//   means each round's expected pay over all n of them is at most n · p · rate · W =
//   MOMENT_SHARE · e · W, half of what the round costs, whatever W is and whichever of them
//   is being hunted; and each pays once. A $1 board of Mines with 24 mines (p = 1/25, e = 1%,
//   n = 2) pays Clean Sweep 6¢ (6.25¢, to the cent below), and the listed $10,000 needs a $160,000
//   board.
//
//   Count challenges and dailies (play 100 rounds, win at five games). They're comps: half the
//   house's edge on everything staked so far (`theo`, and a daily also on the day's `theo`),
//   less what comps have already paid (`comp`), up to the listed cash. So comps never pay more
//   than COMP_SHARE of what play has cost.
//
// The two halves add up to the edge itself: all this cash together costs the house no more
// than the players' own expected losses. (The amount challenges, $10,000 won in all and so on,
// are paid as listed.)

/**
 * The lowest house edge each game can be played at (docs/RULES.md), a lower bound: blackjack at
 * basic strategy, craps with full odds behind the line, the best board or table of each online
 * game. Hold'em has no house edge (and the bots play the house's chips), so it pays no cash.
 */
export const GAME_EDGE: Readonly<Record<GameId, number>> = {
  blackjack: 0.003,
  roulette: 0.027,
  craps: 0.003,
  baccarat: 0.0105,
  slots: 0.045,
  videopoker: 0.0045,
  threecard: 0.02,
  holdem: 0,
  war: 0.02,
  bigsix: 0.11,
  sicbo: 0.027,
  plinko: 0.008,
  tower: 0.01,
  mines: 0.01,
  dice: 0.01,
  limbo: 0.01,
  keno: 0.009,
  hilo: 0.01,
  crash: 0.01,
  banditwheel: 0.04,
  coinflip: 0.01,
  wheel: 0.01,
  cases: 0.01,
  diamonds: 0.01,
  letitride: 0.011,
  paigow: 0.025,
  bingo: 0.03,
  pachinko: 0.033,
  highcard: 0,
};

/** The share of a round's cost achievements may pay back, and comps the rest. */
export const MOMENT_SHARE = 0.5;
export const COMP_SHARE = 0.5;
/** A moment that gives a pendant counts only on a round staking this much. */
export const MARQUEE_STAKE: Cents = 25 * DOLLAR;

/** What a round's play costs on average at a game (its lowest edge), in whole cents. */
export function theoOf(game: GameId, wagered: Cents): Cents {
  return Math.floor(wagered * (GAME_EDGE[game] ?? 0));
}

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

const A = (id: string, game: GameId | undefined, name: string, about: string, reward: Reward, odds?: number): Feat => ({
  id,
  kind: 'achievement',
  ...(game ? { game } : {}),
  name,
  about,
  reward,
  ...(reward.cash ? { odds: odds ?? 1 } : {}),
  // a pendant for a moment wants a real bet behind it
  ...(reward.item ? { minStake: MARQUEE_STAKE } : {}),
});
/** A count challenge: its cash is a comp. */
const comp = (f: Feat): Feat => ({ ...f, comp: true });
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
  comp(C('rounds-100', undefined, 'Regular', 'Play 100 rounds.', 'rounds', 100, { cash: $(1_000) })),
  comp(C('rounds-1000', undefined, 'Fixture', 'Play 1,000 rounds.', 'rounds', 1_000, { cash: $(5_000), title: 'Regular' })),
  comp(C('rounds-10000', undefined, 'Part of the Furniture', 'Play 10,000 rounds.', 'rounds', 10_000, { cash: $(25_000), title: 'Lifer' })),
  // nearly any round wins it (the lowest edge on the floor is 0.3%): a title, not cash
  A('first-win', undefined, "Beginner's Luck", 'Win a round at any game.', { title: 'Rookie' }),
  comp(C('games-5', undefined, 'Tour of the Floor', 'Win at five different games.', 'games', 5, { cash: $(5_000) })),
  C('games-all', undefined, 'Champion', 'Win at every game in the house.', 'games', FEAT_GAMES.length, { item: 'champion-jacket', title: 'Champion' }),

  // --- blackjack -----------------------------------------------------------------------------
  A('bj-blackjack', 'blackjack', 'Twenty-One', 'Get a blackjack.', { cash: $(500) }, 0.05),
  A('bj-double', 'blackjack', 'Doubled Up', 'Win a hand you doubled down on.', { cash: $(750) }, 0.6),
  A('bj-split', 'blackjack', 'Two for Two', 'Split a pair and win both hands.', { cash: $(2_500) }, 0.05),
  C('bj-naturals', 'blackjack', 'Blackjack Royalty', 'Get 21 blackjacks.', 'bj:naturals', 21, { item: 'twentyone-pendant', title: 'Twenty-One' }),

  // --- roulette ------------------------------------------------------------------------------
  A('rl-straight', 'roulette', 'Straight Up', 'Hit a number straight up.', { cash: $(1_000) }, 1),
  A('rl-zero', 'roulette', 'Green', 'Hit 0 or 00 straight up.', { cash: $(5_000), title: 'Green' }, 0.053),

  // --- craps ---------------------------------------------------------------------------------
  A('cr-point', 'craps', 'Point Made', 'Win a pass line bet when the shooter makes the point.', { cash: $(750) }, 0.28),
  A('cr-hard', 'craps', 'The Hard Way', 'Win a hardway bet.', { cash: $(2_500) }, 0.1),
  A('cr-long', 'craps', 'Long Shot', 'Win on aces or boxcars at 30 to 1.', { cash: $(5_000) }, 1 / 18),

  // --- baccarat ------------------------------------------------------------------------------
  A('bc-natural', 'baccarat', 'Natural Nine', 'Win a bet on a hand dealt a natural nine.', { cash: $(1_000) }, 0.1),
  A('bc-tie', 'baccarat', 'Dead Heat', 'Win a tie bet.', { cash: $(2_500) }, 0.1),
  A('bc-pair', 'baccarat', 'Pair Dealt', 'Win a Player or Banker pair bet.', { cash: $(2_500) }, 0.15),

  // --- slots ---------------------------------------------------------------------------------
  A('sl-bonus', 'slots', 'Bonus Round', 'Start free games, the Cherry Wheel or the Blowdown.', { cash: $(1_000) }, 0.03),
  A('sl-hundred', 'slots', 'Hundred Times', 'Win 100 times your bet on one spin.', { cash: $(5_000) }, 0.01),
  A('sl-jackpot', 'slots', 'Jackpot', "Hit a machine's top award.", { item: 'horseshoe-pendant', cash: $(25_000), title: 'Jackpot' }, 0.04),
  // v6 pigs6: Straw, Sticks & Bricks' Whole Street, 1 in 235,070 paid spins there (docs/rules/cards-and-machines.md §3.10)
  A('sl-street', 'slots', 'The Whole Street', 'Build all fifteen houses in a Blowdown on Straw, Sticks & Bricks.', { cash: $(50_000), title: 'Homebuilder' }, 1 / 235_000),

  // --- video poker ---------------------------------------------------------------------------
  A('vp-quads', 'videopoker', 'Four of a Kind', 'Draw four of a kind.', { cash: $(2_500) }, 0.003),
  A('vp-straight-flush', 'videopoker', 'Straight Flush', 'Draw a straight flush.', { cash: $(10_000) }, 0.0005),
  A('vp-royal', 'videopoker', 'Royal Flush', 'Draw a royal flush.', { item: 'royal-pendant', cash: $(50_000), title: 'Royal' }, 0.0001),

  // --- three card poker ----------------------------------------------------------------------
  A('tc-trips', 'threecard', 'Trips', 'Get three of a kind at Three Card Poker.', { cash: $(2_500) }, 0.0024),
  A('tc-straight-flush', 'threecard', 'Three-Card Straight Flush', 'Get a straight flush at Three Card Poker.', { cash: $(5_000) }, 0.0022),

  // --- hold'em -------------------------------------------------------------------------------
  // Hold'em has no house edge (and the bots' chips are the house's): its feats pay no cash
  A('he-pot', 'holdem', 'Take It Down', "Win a pot at Hold'em.", { title: 'Grinder' }),
  A('he-boat', 'holdem', 'Full Boat', 'Win a showdown with a full house or better.', { title: 'Captain' }),
  A('he-quads', 'holdem', 'Quads', 'Win a showdown with four of a kind or better.', { title: 'Shark' }),

  // --- casino war ----------------------------------------------------------------------------
  A('wr-war', 'war', 'Going to War', 'Go to war and win.', { cash: $(750) }, 0.04),
  A('wr-tie', 'war', 'Tie Breaker', 'Win the tie bet.', { cash: $(2_500) }, 0.08),

  // --- big six -------------------------------------------------------------------------------
  A('b6-twenty', 'bigsix', 'Twenty Dollar Bill', 'Win on the $20.', { cash: $(1_000) }, 2 / 54),
  A('b6-star', 'bigsix', 'Star Turn', 'Win on the Star or the Crown at 40 to 1.', { cash: $(5_000) }, 2 / 54),

  // --- sic bo --------------------------------------------------------------------------------
  A('sb-total', 'sicbo', 'Four or Seventeen', 'Win a bet on a total of 4 or 17.', { cash: $(2_500) }, 6 / 216),
  A('sb-triple', 'sicbo', 'Triple', 'Win a triple bet.', { cash: $(5_000) }, 6 / 216),

  // --- the online games ----------------------------------------------------------------------
  A('pk-edge', 'plinko', 'Edge of the Board', 'Land a Plinko ball in an end bin.', { cash: $(1_000) }, 2 / 256),
  A('pk-top', 'plinko', 'Top Bin', 'Land in an end bin of the 16-row board on High.', { cash: $(25_000), title: 'Plinko King' }, 2 / 65_536),
  A('tw-top', 'tower', 'Top of the Tower', 'Climb all nine rows.', { cash: $(2_500) }, 0.076),
  A('mn-gems', 'mines', 'Gem Hunter', 'Cash out with ten gems or more.', { cash: $(1_000) }, 0.6),
  A('mn-clear', 'mines', 'Clean Sweep', 'Clear every gem off the board.', { cash: $(10_000), title: 'Minesweeper' }, 1 / 25),
  A('dc-long', 'dice', 'Long Odds', 'Win a roll at a 5% chance or less.', { cash: $(1_000) }, 0.05),
  A('lb-10x', 'limbo', 'Ten Times', 'Win at a 10x target or higher.', { cash: $(1_000) }, 0.099),
  A('lb-100x', 'limbo', 'Hundred Times', 'Win at a 100x target or higher.', { cash: $(10_000) }, 0.0099),
  A('kn-catch', 'keno', 'Big Catch', 'Hit six numbers or more in one game.', { cash: $(2_500) }, 0.0074),
  A('kn-sweep', 'keno', 'Every Pick', 'Hit every number with five picks or more.', { cash: $(10_000) }, 0.0004),
  A('hl-streak', 'hilo', 'On a Roll', 'Call eight cards right in a row and cash out.', { cash: $(2_500) }, 0.53),
  A('cs-10x', 'crash', 'Liftoff', 'Cash out at 10x or higher.', { cash: $(1_000) }, 0.099),
  A('cs-100x', 'crash', 'Moonshot', 'Cash out at 100x or higher.', { cash: $(25_000), title: 'Rocketeer' }, 0.0099),

  A('cf-five', 'coinflip', 'Called It', 'Call five flips right in a row and cash out.', { cash: $(1_000) }, 1 / 32),
  A('cf-ten', 'coinflip', 'Heads or Tails', 'Call ten flips right in a row and cash out.', { cash: $(10_000), title: 'Lucky Coin' }, 1 / 1_024),
  A('wh-big', 'wheel', 'Big Segment', 'Land a segment paying 10x or more.', { cash: $(1_000) }, 1 / 20),
  A('wh-top', 'wheel', 'Top of the Wheel', 'Land the top segment of the 50-segment High wheel.', { cash: $(10_000) }, 1 / 50),
  A('ca-epic', 'cases', 'Epic Pull', 'Open an epic item or better (20x or more).', { cash: $(1_000) }, 0.99 / 20),
  A('ca-legendary', 'cases', 'Legendary', 'Open a legendary item or better (100x or more).', { cash: $(5_000) }, 0.99 / 100),
  A('dm-four', 'diamonds', 'Four Alike', 'Set down four gems of a colour.', { cash: $(750) }, 210 / 16_807),
  A('dm-five', 'diamonds', 'Five Alike', 'Set down five gems of one colour.', { cash: $(10_000), title: 'Jeweller' }, 7 / 16_807),

  // --- the bandit wheel ----------------------------------------------------------------------
  A('bw-10', 'banditwheel', 'Ten to One', 'Win on the 10.', { cash: $(1_000) }, 2 / 25),
  A('bw-20', 'banditwheel', 'Bandit Twenty', 'Win on the 20.', { cash: $(2_500) }, 1 / 25),

  // --- the bingo hall and the pachinko parlour --------------------------------------------------
  A('bg-bingo', 'bingo', 'Bingo', 'Complete a pattern on one of your cards.', { cash: $(500) }, 1),
  A('bg-blackout', 'bingo', 'Blackout', 'Cover a whole card in time to be paid for it.', { cash: $(10_000), title: 'Caller' }, 0.005),
  A('pa-jackpot', 'pachinko', 'Fever', 'Hit a jackpot on the reels.', { cash: $(750) }, 0.04),
  A('pa-chain', 'pachinko', 'Eight in a Chain', 'Chain eight jackpots from one ball.', { cash: $(10_000) }, 0.0004),

  // --- let it ride and pai gow -----------------------------------------------------------------
  A('lr-ride', 'letitride', 'Let It Ride', 'Win with all three bets left riding.', { cash: $(1_000) }, 0.25),
  A('lr-straight-flush', 'letitride', 'Rode a Straight Flush', 'Make a straight flush or better at Let It Ride.', { cash: $(10_000) }, 0.00002),
  A('pg-fortune', 'paigow', 'Fortune', 'Hit four of a kind or better on the Fortune bonus.', { cash: $(5_000) }, 0.005),
  A('pg-aces', 'paigow', 'Five Aces', 'Hit five aces (the joker one of them) on the Fortune bonus.', { cash: $(10_000), title: 'Dragon' }, 0.0001),

  // --- each game's amount won ------------------------------------------------------------------
  ...FEAT_GAMES.map((g) =>
    C(`won-${g}`, g, GAME_WON_NAMES[g], `Win $50,000 at ${CATALOG[g].name}.`, `won:${g}`, GAME_WON_GOAL, GAME_EDGE[g] > 0 ? { cash: $(2_500) } : { title: 'Rounder' }),
  ),
];

const BY_ID = new Map(FEATS.map((f) => [f.id, f]));

/** How many cash achievements each game has (they share its round's budget). */
const MOMENTS_AT = new Map<GameId | undefined, number>();
for (const f of FEATS) if (f.odds !== undefined) MOMENTS_AT.set(f.game, (MOMENTS_AT.get(f.game) ?? 0) + 1);

/** An achievement's cash per cent staked in the round that earns it, or null (it pays no cash, or its cash is listed). */
export function momentRate(f: Feat): number | null {
  if (f.odds === undefined || !f.reward.cash || !f.game) return null;
  return (MOMENT_SHARE * (GAME_EDGE[f.game] ?? 0)) / (f.odds * (MOMENTS_AT.get(f.game) ?? 1));
}

/** The stake at which an achievement pays its whole listed cash. */
export function fullStake(f: Feat): Cents | null {
  const rate = momentRate(f);
  // (less a hair, so binary rounding can't push a whole dollar amount up to the next)
  return rate ? Math.ceil(f.reward.cash! / rate / DOLLAR - 1e-9) * DOLLAR : null;
}

/**
 * The cash a feat pays: an achievement's scaled by its round's stake, a comp's by play so far
 * (`tally`, the account's totals: `theo` and `comp`, and for a daily its day's `theo`), anything
 * else as listed. Whole cents, never below 0.
 */
export function cashFor(f: Feat, ctx: { stake?: Cents; tally?: Readonly<Record<string, number>> }): Cents {
  const listed = f.reward.cash ?? 0;
  if (listed <= 0) return 0;
  if (f.odds !== undefined) {
    const rate = momentRate(f) ?? 0;
    // (a millionth of a cent over, so 0.1 × 10,000 isn't floored to 999 by binary rounding)
    return Math.max(0, Math.min(listed, Math.floor(rate * (ctx.stake ?? 0) + 1e-6)));
  }
  if (f.comp) {
    const t = ctx.tally ?? {};
    let room = Math.floor(COMP_SHARE * (t.theo ?? 0)) - (t.comp ?? 0);
    if (f.daily) room = Math.min(room, Math.floor(COMP_SHARE * (t[`d:${f.daily}:theo`] ?? 0)));
    return Math.max(0, Math.min(listed, room));
  }
  return listed;
}
const DAILY_ID = /^daily:(\d{4}-\d{2}-\d{2}):(\d)$/;

export function featOf(id: unknown): Feat | null {
  if (typeof id !== 'string') return null;
  const known = BY_ID.get(id);
  if (known) return known;
  const m = DAILY_ID.exec(id);
  return m ? (dailyFeats(m[1]!)[Number(m[2])] ?? null) : null;
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
  // `games`, or a day's `d:<day>:games`: the games with a win (that day)
  const games = /^(d:\d{4}-\d{2}-\d{2}:)?games$/.exec(key);
  if (games) return FEAT_GAMES.filter((g) => (tally[`${games[1] ?? ''}wins:${g}`] ?? 0) > 0).length;
  return tally[key] ?? 0;
}

// ---------------------------------------------------------------------------------------------
// Daily challenges

/** How many a day. */
export const DAILY_COUNT = 3;
/** Day rows a table keeps sending and D1 keeps, counting today. */
export const DAILY_KEEP_DAYS = 3;

interface DailySpec {
  /** The tally, after `d:<day>:` (`wins:*` picks a game). */
  key: 'won' | 'rounds' | 'games' | 'best' | 'wins:*';
  goal: number;
  name: string;
  about: string;
  cash: Cents;
}

/**
 * The pool, in kinds; a day takes one from each of three kinds. A daily's id is its day and slot,
 * and what it asks is worked out again from the day, so entries are only ever added at the end.
 */
const DAILY_POOL: readonly (readonly DailySpec[])[] = [
  [
    { key: 'won', goal: $(2_500), name: 'Good Day', about: 'Win $2,500 today.', cash: $(500) },
    { key: 'won', goal: $(10_000), name: 'Big Day', about: 'Win $10,000 today.', cash: $(1_500) },
  ],
  [
    { key: 'rounds', goal: 50, name: 'Keep Playing', about: 'Play 50 rounds today.', cash: $(500) },
    { key: 'rounds', goal: 150, name: 'All Day', about: 'Play 150 rounds today.', cash: $(1_000) },
  ],
  [
    { key: 'games', goal: 3, name: 'Three Tables', about: 'Win at three different games today.', cash: $(750) },
    { key: 'games', goal: 5, name: 'Around the Floor', about: 'Win at five different games today.', cash: $(1_500) },
  ],
  [
    { key: 'best', goal: $(1_000), name: 'One Good Round', about: 'Win $1,000 in one round today.', cash: $(750) },
    { key: 'best', goal: $(5_000), name: 'One Big Round', about: 'Win $5,000 in one round today.', cash: $(1_500) },
  ],
  [{ key: 'wins:*', goal: 5, name: 'Five at the Table', about: 'Win five rounds of one game today.', cash: $(750) }],
];

/** The games a "five wins" daily picks from: the ones with a table or a machine to walk up to. */
const DAILY_GAMES: readonly GameId[] = ['blackjack', 'roulette', 'craps', 'baccarat', 'slots', 'videopoker', 'threecard', 'war', 'bigsix', 'sicbo', 'banditwheel', 'plinko', 'dice', 'mines'];

/** A small hash of the day: the same picks for everyone, every time it's asked. */
function daySeed(day: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < day.length; i++) h = Math.imul(h ^ day.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const DAILY_CACHE = new Map<string, Feat[]>();

/** A casino day's three challenges (the day as casinoDay writes it). */
export function dailyFeats(day: string): Feat[] {
  const known = DAILY_CACHE.get(day);
  if (known) return known;
  const rand = daySeed(day);
  const kinds = DAILY_POOL.map((_, i) => i);
  const picked: Feat[] = [];
  for (let slot = 0; slot < DAILY_COUNT; slot++) {
    const kind = kinds.splice(Math.floor(rand() * kinds.length), 1)[0]!;
    const opts = DAILY_POOL[kind]!;
    const spec = opts[Math.floor(rand() * opts.length)]!;
    const game = spec.key === 'wins:*' ? DAILY_GAMES[Math.floor(rand() * DAILY_GAMES.length)]! : undefined;
    picked.push({
      id: `daily:${day}:${slot}`,
      kind: 'challenge',
      ...(game ? { game } : {}),
      name: game ? `Five at ${CATALOG[game].name}` : spec.name,
      about: game ? `Win five rounds of ${CATALOG[game].name} today.` : spec.about,
      tally: `d:${day}:${game ? `wins:${game}` : spec.key}`,
      goal: spec.goal,
      reward: { cash: spec.cash },
      daily: day,
      comp: true,
    });
  }
  if (DAILY_CACHE.size > 16) DAILY_CACHE.clear();
  DAILY_CACHE.set(day, picked);
  return picked;
}

const DAY_FORMAT = (() => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    return null;
  }
})();

/** The casino's date (Las Vegas time), YYYY-MM-DD: when the dailies turn over (as floor/wins.ts counts its days). */
export function casinoDay(now: number): string {
  if (DAY_FORMAT) {
    const parts = DAY_FORMAT.formatToParts(new Date(now));
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    const y = get('year');
    const m = get('month');
    const d = get('day');
    if (y && m && d) return `${y}-${m}-${d}`;
  }
  return new Date(now).toISOString().slice(0, 10);
}

/** GET /feats: what you've earned (and the cash each paid) and how far along each tally is. */
export interface FeatsResponse {
  feats: { feat: string; at: number; paid?: Cents }[];
  /** Tally key to value (cents for amounts, counts otherwise). */
  tally: Record<string, number>;
}
