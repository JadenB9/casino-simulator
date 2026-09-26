// v7: a store's catalogue (Ace Arms, Maison Home, your apartment's own pieces and upgrades): rows in
// sections, each a thing with its price and a line about it, and a button: Buy (a POST /shop/buy,
// the same purchase as the boutique's, retried with the same op if it's lost), or once it's yours
// whatever the store lets you do with it (draw a gun, put a piece in its place), or why not yet.

import './store.css';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { el, toast } from '../kit.ts';
import { openSheet, type Sheet } from '../menu/sheet.ts';
import { problemText } from '../menu/parts.ts';
import { applyMoney } from '../shop/bar.ts';
import * as shopApi from '../shop/api.ts';
import { session } from '../../app/session.ts';
import type { Sfx } from '../../audio/sfx.ts';

export interface StoreRow {
  id: string;
  name: string;
  price: Cents;
  about: string;
  /** Yours already. */
  owned: boolean;
  /** Why it can't be bought yet (the step before, an apartment first). */
  locked?: string | null;
  /** What to do with it once it's yours ("Draw", "Put it here"), and whether that's done already. */
  use?: { label: string; done?: boolean; run(): void };
}

export interface StoreOpts {
  root: HTMLElement;
  title: string;
  subtitle?: string;
  sections: () => { title: string; rows: StoreRow[] }[];
  sfx?: Sfx;
  /** Something was bought (the world refurnishes, the floor already knows). */
  bought?: (id: string) => void;
  onClose?: () => void;
}

/** Open a store's sheet; it repaints after every purchase or use. */
export function openStore(o: StoreOpts): Sheet {
  const sheet = openSheet(o.root, { title: o.title, subtitle: o.subtitle, cls: 'store-sheet', onClose: o.onClose });
  const body = el('div', 'store-body');
  sheet.body.append(body);
  const ops = new Map<string, string>();
  let busy = false;
  const paint = () => {
    const balance = session.profile?.balance ?? 0;
    body.replaceChildren(
      ...o.sections().map((sec) => {
        const s = el('section', 'store-section');
        s.append(el('h3', 'store-head', sec.title));
        for (const r of sec.rows) {
          const row = el('div', `store-row${r.owned ? ' owned' : ''}`);
          const text = el('div', 'store-text');
          text.append(el('div', 'store-name', r.name), el('div', 'store-about', r.locked && !r.owned ? r.locked : r.about));
          const right = el('div', 'store-right');
          right.append(el('div', 'store-price money', r.owned ? 'Yours' : formatMoney(r.price)));
          const b = el('button', 'btn');
          b.type = 'button';
          if (r.owned) {
            if (r.use) {
              b.textContent = r.use.done ? '✓ ' + r.use.label : r.use.label;
              b.disabled = !!r.use.done;
              b.classList.toggle('primary', !r.use.done);
              b.addEventListener('click', () => {
                r.use!.run();
                paint();
              });
              right.append(b);
            }
          } else {
            b.textContent = 'Buy';
            b.classList.add('primary');
            b.disabled = busy || !!r.locked || r.price > balance;
            if (r.price > balance && !r.locked) b.title = 'Not enough on your balance';
            b.addEventListener('click', () => void buy(r));
            right.append(b);
          }
          row.append(text, right);
          s.append(row);
        }
        return s;
      }),
    );
    sheet.sub.textContent = `${o.subtitle ? `${o.subtitle} · ` : ''}Balance ${formatMoney(balance)}`;
    sheet.sub.hidden = false;
  };
  const buy = async (r: StoreRow) => {
    if (busy) return;
    busy = true;
    paint();
    const op = ops.get(r.id) ?? shopApi.newOp();
    ops.set(r.id, op);
    try {
      const res = await shopApi.buy(r.id, op);
      applyMoney(session, res, res.price);
      const p = session.profile;
      if (p && !p.owned?.includes(r.id)) session.set({ ...p, owned: [...(p.owned ?? []), r.id] });
      o.sfx?.play('chips-stack', { volume: 0.5 });
      toast(`${r.name}: yours for ${formatMoney(res.price)}.`);
      o.bought?.(r.id);
    } catch (err) {
      toast(problemText(err), 'err');
      const body = (err as { body?: { balance?: number; inPlay?: number } }).body;
      const p = session.profile;
      if (p && body?.balance !== undefined && body.inPlay !== undefined) session.set({ ...p, balance: body.balance, inPlay: body.inPlay });
    } finally {
      busy = false;
      ops.delete(r.id);
      if (!sheet.closed) paint();
    }
  };
  paint();
  return sheet;
}
