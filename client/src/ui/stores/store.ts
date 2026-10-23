// v7: a store's catalogue (Ace Arms, Maison Home, your apartment's own pieces and upgrades): rows in
// sections, each a thing with its price and a line about it, and a button: Buy (a POST /shop/buy,
// the same purchase as the boutique's, after a confirm that says what your balance will be after,
// and retried with the same op if the answer is lost), or once it's yours whatever the store lets
// you do with it (draw a gun, put a piece in its place), or why not yet.

import '../shop/shop.css';
import './store.css';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import type { BuyResponse } from '../../../../shared/src/items.ts';
import { button, el, modal, toast } from '../kit.ts';
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

/** v1.1: something a section's heading offers (your apartment's Move, Pick up). */
export interface StoreAction {
  label: string;
  run(): void;
}

export interface StoreOpts {
  root: HTMLElement;
  title: string;
  subtitle?: string;
  /** v1.1: a section can carry actions of its own beside its heading (your apartment's Move, Pick up). */
  sections: () => { title: string; rows: StoreRow[]; actions?: StoreAction[] }[];
  sfx?: Sfx;
  /** Something was bought (the world refurnishes, the floor already knows). */
  bought?: (id: string) => void;
  onClose?: () => void;
  /** The purchase call: the boutique's POST /shop/buy unless a dev page brings a stand-in. */
  api?: { buy(item: string, op: string): Promise<BuyResponse> };
}

/** Open a store's sheet; it repaints after every purchase or use. */
export function openStore(o: StoreOpts): Sheet {
  const sheet = openSheet(o.root, { title: o.title, subtitle: o.subtitle, cls: 'store-sheet', onClose: () => {
    offSession();
    o.onClose?.();
  } });
  const money = el('div', 'store-money');
  const balVal = el('span', 'money store-money-val');
  money.append(el('span', 'store-money-label', 'Balance'), balVal);
  const body = el('div', 'store-body');
  sheet.body.append(money, body);
  /** One op per piece until the shop has answered it: a retry after a dropped answer is the same purchase. */
  const ops = new Map<string, string>();
  let busy: string | null = null;
  const paint = () => {
    const balance = session.profile?.balance ?? 0;
    balVal.textContent = formatMoney(balance);
    // keep the scroll where it is, and the focus on the button it was on: a repaint shouldn't
    // jump you back to the top or drop you out of the list
    const scroll = body.scrollTop;
    const focused = body.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.key : undefined;
    body.replaceChildren(
      ...o.sections().map((sec) => {
        const s = el('section', 'store-section');
        const head = el('h3', 'store-head');
        const have = sec.rows.filter((r) => r.owned).length;
        head.append(el('span', 'store-head-title', sec.title));
        if (sec.rows.length > 1) head.append(el('span', 'store-head-count', have ? `${have} of ${sec.rows.length} yours` : `${sec.rows.length} to choose from`));
        if (sec.actions?.length) {
          const acts = el('span', 'store-acts');
          for (const a of sec.actions) {
            acts.append(
              button(a.label, () => {
                a.run();
                if (!sheet.closed) paint();
              }, { cls: 'ghost' }),
            );
          }
          head.append(acts);
        }
        s.append(head);
        for (const r of sec.rows) {
          const short = !r.owned && !r.locked && r.price > balance;
          const row = el('div', `store-row${r.owned ? ' owned' : ''}${r.locked && !r.owned ? ' locked' : ''}${short ? ' short' : ''}`);
          const text = el('div', 'store-text');
          text.append(el('div', 'store-name', r.name), el('div', 'store-about', r.locked && !r.owned ? r.locked : r.about));
          const right = el('div', 'store-right');
          const price = el('div', 'store-price');
          price.append(el('span', 'money', r.owned ? 'Yours' : formatMoney(r.price)));
          if (short) price.append(el('span', 'store-short money', `${formatMoney(r.price - balance)} short`));
          right.append(price);
          const b = el('button', 'btn');
          b.type = 'button';
          b.dataset.key = r.id;
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
            b.textContent = busy === r.id ? 'Buying' : 'Buy';
            b.classList.toggle('primary', !short && !r.locked);
            b.disabled = busy !== null || !!r.locked || short;
            b.setAttribute('aria-label', r.locked ? `${r.name}: ${r.locked}` : short ? `${r.name}, ${formatMoney(r.price)}: ${formatMoney(r.price - balance)} short` : `Buy ${r.name}, ${formatMoney(r.price)}`);
            b.addEventListener('click', () => confirm(r));
            right.append(b);
          }
          row.append(text, right);
          s.append(row);
        }
        return s;
      }),
    );
    body.scrollTop = scroll;
    if (focused) body.querySelector<HTMLElement>(`[data-key="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    sheet.sub.textContent = o.subtitle ?? '';
    sheet.sub.hidden = !o.subtitle;
  };
  /** The confirm: the price, your balance now and after, then the purchase. */
  const confirm = (r: StoreRow) => {
    if (busy) return;
    const now = session.profile?.balance ?? 0;
    const rows = el('div', 'bq-confirm-rows');
    const line = (label: string, value: string, cls = '') => {
      const x = el('div', `bq-confirm-row ${cls}`.trim());
      x.append(el('span', '', label), el('span', 'money', value));
      return x;
    };
    rows.append(line('Your balance', formatMoney(now)), line(r.name, `−${formatMoney(r.price)}`), line('Balance after: ', formatMoney(now - r.price), 'after'));
    const go = button('Buy', () => {
      m.close();
      void buy(r);
    }, { cls: 'primary' });
    const m = modal(`Buy ${r.name}?`, [el('p', 'bq-confirm-price money', formatMoney(r.price)), rows, el('p', 'bq-confirm-note', `${r.about} It comes out of your balance; chips on tables stay where they are.`)], [go, button('Cancel', () => m.close(), { cls: 'ghost' })], () => m.close());
    m.root.classList.add('bq-confirm', 'store-confirm');
    go.focus();
  };
  const buy = async (r: StoreRow) => {
    if (busy) return;
    busy = r.id;
    paint();
    const op = ops.get(r.id) ?? shopApi.newOp();
    ops.set(r.id, op);
    try {
      const res = await (o.api ?? shopApi).buy(r.id, op);
      ops.delete(r.id);
      applyMoney(session, res, res.price);
      const p = session.profile;
      if (p && !p.owned?.includes(r.id)) session.set({ ...p, owned: [...(p.owned ?? []), r.id] });
      o.sfx?.play('chips-stack', { volume: 0.5 });
      toast(`${r.name}: yours for ${formatMoney(res.price)}.`);
      o.bought?.(r.id);
    } catch (err) {
      // a refusal is final for this op; a dropped answer or a server error keeps it, so trying
      // again is a retry of the same purchase and can't pay twice
      const st = (err as { status?: number }).status;
      if (st && st < 500) ops.delete(r.id);
      toast(problemText(err), 'err');
      const body = (err as { body?: { balance?: number; inPlay?: number } }).body;
      const p = session.profile;
      if (p && body?.balance !== undefined && body.inPlay !== undefined) session.set({ ...p, balance: body.balance, inPlay: body.inPlay });
    } finally {
      busy = null;
      if (!sheet.closed) paint();
    }
  };
  // the balance can change while it's open (a win elsewhere, a transfer in)
  const offSession = session.on(() => !sheet.closed && !busy && paint());
  paint();
  return sheet;
}
