// How feats read: their rewards, a challenge's progress, the groups the sheet lists them in, and
// the line a feed or an unlock card shows. Pure, so the wording is tested next to the list.

import { CATALOG } from '../../../../shared/src/games/catalog.ts';
import type { GameId } from '../../../../shared/src/engine.ts';
import { FEAT_GAMES, casinoDay, dailyFeats, featOf, featsAt, fullStake, momentRate, tallyValue, titleOf, type Feat } from '../../../../shared/src/feats.ts';
import { emoteItem, wornItem } from '../../../../shared/src/items.ts';
import { formatMoney } from '../../../../shared/src/money.ts';

/** Whole dollars: "$1,000,000". */
export function dollars(cents: number): string {
  return formatMoney(Math.floor(Math.max(0, cents) / 100) * 100);
}

/** A tally kept in cents (amounts won) rather than a count. */
export function isMoneyTally(key: string): boolean {
  const k = key.replace(/^d:[^:]+:/, '');
  return k === 'won' || k === 'best' || k.startsWith('won:');
}

export type RewardKind = 'cash' | 'item' | 'emote' | 'title';

/** A feat's rewards, one short phrase each, cash first: "$2,500", "Royal Flush Pendant", "Trophy emote", "Title: Royal". */
export function rewardParts(f: Feat): { kind: RewardKind; text: string }[] {
  const r = f.reward;
  const out: { kind: RewardKind; text: string }[] = [];
  // cash that scales (with the stake, or with play) is "up to" its listed amount
  if (r.cash) out.push({ kind: 'cash', text: f.odds !== undefined || f.comp ? `Up to ${dollars(r.cash)}` : dollars(r.cash) });
  if (r.item) out.push({ kind: 'item', text: wornItem(r.item)?.name ?? r.item });
  if (r.emote) out.push({ kind: 'emote', text: `${emoteItem(r.emote)?.name ?? r.emote} emote` });
  if (r.title) out.push({ kind: 'title', text: `Title: ${r.title}` });
  return out;
}

/** Cents to the cent: "$0.06", "$23.75", "$1,000". */
export function cents(n: number): string {
  return formatMoney(Math.max(0, Math.floor(n)));
}

/** "6¢", "0.19¢", "$2.50": what a dollar staked earns toward an achievement's cash. */
function perDollar(rate: number): string {
  const c = rate * 100;
  if (c >= 100) return `${formatMoney(Math.floor(c))}`;
  const shown = c >= 10 ? Math.floor(c).toString() : c >= 1 ? (Math.floor(c * 10) / 10).toString() : (Math.floor(c * 100) / 100).toString();
  return `${shown}¢`;
}

/**
 * How a feat's cash is worked out, one line for the sheet, or null for cash paid as listed (or
 * none): "6¢ for every $1 the round stakes: the full $10,000 on a $160,000 round." Why is in
 * shared/src/feats.ts: no feat pays more than the play that earns it costs.
 */
export function cashNote(f: Feat): string | null {
  const listed = f.reward.cash ?? 0;
  if (listed <= 0) return null;
  const rate = momentRate(f);
  if (rate) return `${perDollar(rate)} for every $1 the round stakes: the full ${dollars(listed)} on a ${dollars(fullStake(f)!)} round.`;
  if (f.comp) return f.daily ? "A comp: half the house's edge on today's play, up to the amount shown." : "A comp: half the house's edge on all your play, up to the amount shown.";
  return null;
}

/** What an earned feat paid, when it's less than it lists: "Paid $0.06 of $10,000." */
export function paidNote(f: Feat, paid: number | undefined): string | null {
  const listed = f.reward.cash ?? 0;
  if (listed <= 0 || paid === undefined || paid >= listed) return null;
  return `Paid ${cents(paid)} of ${dollars(listed)}`;
}

/** How far along a challenge is, for its bar: 0-1, and "$412,300 of $1,000,000" / "37 of 100". */
export function progressOf(f: Feat, tally: Readonly<Record<string, number>>): { k: number; text: string } | null {
  if (f.kind !== 'challenge' || !f.tally || f.goal === undefined) return null;
  const now = Math.min(tallyValue(tally, f.tally), f.goal);
  const money = isMoneyTally(f.tally);
  const show = (n: number) => (money ? dollars(n) : n.toLocaleString('en-US'));
  return { k: f.goal > 0 ? now / f.goal : 0, text: `${show(now)} of ${show(f.goal)}` };
}

export interface FeatGroup {
  /** 'today' for the day's challenges, 'house' for the ones earned anywhere, else the game. */
  id: 'today' | 'house' | GameId;
  name: string;
  /** Which part of the building: the rail's headings. */
  part: 'The house' | 'Tables' | 'Machines' | 'Online';
  feats: Feat[];
}

const MACHINES = new Set<GameId>(['slots', 'videopoker', 'pachinko']);

/** Everything on the list: today's three, the house's, then each game in the catalog's order. */
export function featGroups(now = Date.now()): FeatGroup[] {
  const games = FEAT_GAMES.map((g): FeatGroup => ({
    id: g,
    name: CATALOG[g].name,
    part: CATALOG[g].online ? 'Online' : MACHINES.has(g) ? 'Machines' : 'Tables',
    feats: featsAt(g),
  }));
  const order: FeatGroup['part'][] = ['Tables', 'Machines', 'Online'];
  games.sort((a, b) => order.indexOf(a.part) - order.indexOf(b.part));
  return [
    { id: 'today', name: 'Today', part: 'The house', feats: dailyFeats(casinoDay(now)) },
    { id: 'house', name: 'Anywhere', part: 'The house', feats: featsAt(null) },
    ...games,
  ];
}

/** The unlock card's small label: what kind of feat it was. */
export function unlockKind(f: Feat): string {
  return f.daily ? 'Daily challenge' : f.kind === 'challenge' ? 'Challenge complete' : 'Achievement';
}

/**
 * The unlock card's small line: the game, then what came with it. `paid` is the cash it paid
 * (the table says); short of the listed amount, the card says so and why.
 */
export function unlockSub(f: Feat, paid?: number): string {
  const listed = f.reward.cash ?? 0;
  const cash = (): string | null => {
    if (listed <= 0) return null;
    const got = paid ?? listed;
    if (got >= listed) return `+${dollars(listed)}`;
    if (f.odds !== undefined) return `+${cents(got)} of ${dollars(listed)}: bet more for the full amount`;
    return `+${cents(got)} of ${dollars(listed)}: comps grow with your play`;
  };
  const parts = [f.game ? CATALOG[f.game].name : null, cash(), ...rewardParts(f).filter((p) => p.kind !== 'cash').map((p) => p.text)];
  return parts.filter(Boolean).join(' · ');
}

/** A feed line for someone else's feat: who and what on top, where under it. */
export function feedLines(name: string, feat: string): { name: string; what: string; sub: string } | null {
  const f = featOf(feat);
  if (!f) return null;
  return { name, what: f.name, sub: f.daily ? 'Daily challenge' : f.game ? CATALOG[f.game].name : f.kind === 'challenge' ? 'Challenge' : 'Achievement' };
}

/** The words a title shows under a name, from a look's `title` (a feat id), or null. */
export function titleText(id: unknown): string | null {
  return titleOf(id)?.reward.title ?? null;
}

/** "Sep 25" (this year) or "Sep 25, 2025". */
export function earnedOn(at: number, now = Date.now()): string {
  const d = new Date(at);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}
