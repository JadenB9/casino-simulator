// How feats read: their rewards, a challenge's progress, the groups the sheet lists them in, and
// the line a feed or an unlock card shows. Pure, so the wording is tested next to the list.

import { CATALOG } from '../../../../shared/src/games/catalog.ts';
import type { GameId } from '../../../../shared/src/engine.ts';
import { FEAT_GAMES, casinoDay, dailyFeats, featOf, featsAt, tallyValue, titleOf, type Feat } from '../../../../shared/src/feats.ts';
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
  if (r.cash) out.push({ kind: 'cash', text: dollars(r.cash) });
  if (r.item) out.push({ kind: 'item', text: wornItem(r.item)?.name ?? r.item });
  if (r.emote) out.push({ kind: 'emote', text: `${emoteItem(r.emote)?.name ?? r.emote} emote` });
  if (r.title) out.push({ kind: 'title', text: `Title: ${r.title}` });
  return out;
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

/** The unlock card's small line: the game, then what came with it. */
export function unlockSub(f: Feat): string {
  const parts = [f.game ? CATALOG[f.game].name : null, ...rewardParts(f).map((p) => (p.kind === 'cash' ? `+${p.text}` : p.text))];
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
