// What the bank's screens say: a statement line in words, amounts typed as dollars, rates as
// percentages. Pure, so the tests can read them.

import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { FUND_NAME, formatPrice, formatUnits, termOf, type StatementLine } from '../../../../shared/src/bank.ts';
import { STATUE, barItem, carItem, effectItem, emoteItem, wornItem } from '../../../../shared/src/items.ts';
import { gunItem } from '../../../../shared/src/arms.ts';
import { apartmentItem, homeItem } from '../../../../shared/src/estate.ts';
import { CATALOG, isGameId } from '../../../../shared/src/games/catalog.ts';

/**
 * Dollars as typed ("1,250", "$99.5", "12.05") to cents; null for anything else. At most two
 * decimals, nothing negative, nothing past a trillion.
 */
export function parseDollars(text: string): Cents | null {
  const t = text.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d{1,13}(\.\d{0,2})?$/.test(t) || t === '') return null;
  const [whole, frac = ''] = t.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** Parts per million or basis points as a percentage: "0.015%", "3.5%". */
export function percent(parts: number, per: number): string {
  return `${Number(((parts / per) * 100).toFixed(4))}%`;
}

function gameOf(tableId: string | null | undefined): string {
  if (!tableId) return '';
  if (tableId.startsWith('solo:')) {
    const g = tableId.split(':')[1];
    return g && isGameId(g) ? CATALOG[g].name : '';
  }
  const game = Object.values(CATALOG).find((g) => g.prefix === tableId.slice(0, 2));
  return game?.name ?? '';
}

function itemName(id: string | null | undefined): string {
  if (!id) return 'an item';
  if (id === STATUE.id) return STATUE.name;
  return wornItem(id)?.name ?? emoteItem(id)?.name ?? barItem(id)?.name ?? effectItem(id)?.name ?? carItem(id)?.name ?? gunItem(id)?.name ?? homeItem(id)?.name ?? apartmentItem(id)?.name ?? id;
}

/** v7: where a kept purchase was made: the valet's cars, the gun store, the home store, else the boutique. */
function shopOf(id: string | null | undefined): string {
  if (carItem(id)) return 'Cars';
  if (gunItem(id)) return 'Ace Arms';
  if (homeItem(id) || apartmentItem(id)) return 'Maison Home';
  return 'Boutique';
}

function dayOf(ref: string | null | undefined): string {
  if (!ref) return '';
  const d = new Date(`${ref}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? ref : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export type Account = 'Checking' | 'Savings' | 'Deposits' | FundName | 'Tables';
type FundName = typeof FUND_NAME;

/** A statement line in words: what happened, and which account it's on. */
export function describe(l: StatementLine): { text: string; account: Account } {
  const game = gameOf(l.ref);
  const at = (s: string) => (game ? `${s} · ${game}` : s);
  if (l.src === 'ledger') {
    switch (l.kind) {
      case 'grant':
        if (l.id.startsWith('grant:')) return { text: 'Opening balance', account: 'Checking' };
        if (l.id.startsWith('daily:')) return { text: 'Daily bonus', account: 'Checking' };
        if (l.id.startsWith('celeb:')) return { text: 'Tip from a celebrity', account: 'Checking' };
        if (l.id.startsWith('gift:')) return { text: 'Gift box', account: 'Checking' };
        if (l.id.startsWith('feat:')) return { text: 'Achievement reward', account: 'Checking' };
        return { text: 'Credit from the house', account: 'Checking' };
      case 'buyin':
        return { text: at('Bought in'), account: 'Tables' };
      case 'cashout':
        return { text: at('Cashed out'), account: 'Tables' };
      case 'refund':
        return { text: at('Chips refunded'), account: 'Tables' };
      case 'loan':
        return { text: "Cashier's top-up", account: 'Checking' };
    }
    return { text: l.kind, account: 'Checking' };
  }
  if (l.src === 'item') return { text: `${shopOf(l.ref)} · ${itemName(l.ref)}`, account: 'Checking' };
  // v7: an inmate took it
  if (l.src === 'order' && l.kind === 'theft') return { text: 'Stolen in the county jail', account: 'Checking' };
  if (l.src === 'order' && l.kind === 'bail') return { text: "Paid someone's bail", account: 'Checking' };
  if (l.src === 'order') return { text: `${l.kind === 'fx' ? 'Effect' : 'Bar'} · ${itemName(l.ref)}`, account: 'Checking' };
  const price = l.ref?.includes(':') ? formatPrice(Number(l.ref.split(':')[1])) : '';
  const units = l.units ? formatUnits(Math.abs(l.units)) : '';
  switch (l.kind) {
    case 'save':
      return { text: 'Moved to savings', account: 'Savings' };
    case 'unsave':
      return { text: 'Moved from savings', account: 'Savings' };
    case 'interest':
      return { text: `Interest for ${dayOf(l.ref)}`, account: 'Savings' };
    case 'lock':
      return { text: 'Term deposit opened', account: 'Deposits' };
    case 'unlock':
      return { text: (l.gain ?? 0) >= 0 ? `Term deposit repaid, ${formatMoney(l.gain ?? 0)} interest` : `Term deposit broken early, ${formatMoney(-(l.gain ?? 0))} fee`, account: 'Deposits' };
    case 'buy':
      return { text: `Bought ${units} units at ${price}`, account: FUND_NAME };
    case 'sell':
      return { text: `Sold ${units} units at ${price}`, account: FUND_NAME };
    case 'send':
      return { text: `Sent to ${l.peer ?? 'a player'}`, account: 'Checking' };
    case 'receive':
      return { text: `From ${l.peer ?? 'a player'}`, account: 'Checking' };
  }
  return { text: l.kind, account: 'Checking' };
}

/** The line's amount as the statement shows it: the change to checking, or else to the bank account. */
export function lineAmount(l: StatementLine): Cents {
  if (l.src === 'bank' && (l.kind === 'interest')) return l.banked;
  return l.cash;
}

/** "in 3 h 20 min", "in 45 s", or "now" */
export function until(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `in ${s} s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `in ${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
  return `in ${Math.round(h / 24)} days`;
}

export function termLabel(id: string): string {
  return termOf(id)?.label ?? id;
}
