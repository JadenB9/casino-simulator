// Achievements and challenges ("feats"). An achievement is a thing done once at a game (a
// blackjack, a royal flush, a point made); a challenge is an amount reached (a million won in all).
// The server decides both from the rounds the tables settle (server/src/feats.ts); the client only
// shows them. Each feat is earned once per account and pays its reward once: cash to the balance
// (a 'grant' ledger row keyed by the feat, so it can't pay twice), a piece or an emote that is
// never sold (items.ts, `reward`), and sometimes a title to wear under your name.
//
// Ids are stored in D1 (casino_feats) and in saved looks (look.title), so an id never changes
// once it has shipped.

import type { Cents } from './money.ts';
import type { GameId } from './engine.ts';
import type { EmoteId } from './protocol.ts';

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

/** The list; the feats slice fills it in (every id here is final once shipped). */
export const FEATS: readonly Feat[] = [
  { id: 'won-1m', kind: 'challenge', name: 'Millionaire', about: 'Win $1,000,000 in all.', goal: 100_000_000, tally: 'won', reward: { emote: 'trophy', title: 'Millionaire' } },
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

/** GET /feats: what you've earned and how far along each tally is. */
export interface FeatsResponse {
  feats: { feat: string; at: number }[];
  /** Tally key to value (cents for amounts, counts otherwise). */
  tally: Record<string, number>;
}
