// The bar's menu: drinks and food at casino prices, paid from your balance when you order, and
// brought to you. It says what's on its way and what's in your hand, with how long it stays
// there. A sheet like the cashier's: it holds the keyboard, Esc closes it.

import './shop.css';
import { BAR_MENU, barItem, type BarItem } from '../../../../shared/src/items.ts';
import { formatMoney } from '../../../../shared/src/money.ts';
import { serverNow } from '../../net/clock.ts';
import { el } from '../kit.ts';
import type { Closable, SessionLike, SfxLike } from '../menu/deps.ts';
import { openSheet } from '../menu/sheet.ts';
import { problemText } from '../menu/parts.ts';
import type { Bar } from './bar.ts';
import { barPriceNow, happyBanner, priceTag } from '../../world/celebs/happy.ts'; // v6 celebs6: happy hour

export interface BarMenuDeps {
  root: HTMLElement;
  bar: Bar;
  session: SessionLike;
  sfx?: Pick<SfxLike, 'play'>;
  onClose?(): void;
}

/** "4 min", "40 s" */
function left(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`;
}

export function openBarMenu(deps: BarMenuDeps): Closable {
  const { bar, session } = deps;
  let clock = 0;
  const offs: (() => void)[] = [];
  const sheet = openSheet(deps.root, {
    title: 'Bar',
    subtitle: 'Paid when you order, brought to you. It stays in your hand five minutes, or until you sit down to play.',
    cls: 'bar-sheet',
    onClose: () => {
      clearInterval(clock);
      for (const off of offs) off();
      deps.onClose?.();
    },
  });

  const balance = el('div', 'bar-balance');
  const balVal = el('span', 'money');
  balance.append(el('span', 'bar-balance-label', 'Balance'), balVal);

  const status = el('div', 'bar-status');
  status.setAttribute('aria-live', 'polite');
  const note = el('p', 'bar-note');
  note.setAttribute('aria-live', 'polite');

  const buttons = new Map<string, HTMLButtonElement>();
  let busy: string | null = null;
  const section = (label: string, items: readonly BarItem[]) => {
    const box = el('div', 'bar-section');
    box.append(el('div', 'section-label', label));
    for (const it of items) {
      const row = el('div', 'bar-item');
      const text = el('div', 'bar-text');
      text.append(el('span', 'bar-name', it.name), el('span', 'bar-about', it.about));
      const order = el('button', 'btn bar-order', 'Order');
      order.type = 'button';
      order.setAttribute('aria-label', `Order ${it.name}, ${formatMoney(it.price)}`);
      order.addEventListener('click', () => void place(it));
      buttons.set(it.id, order);
      row.append(text, priceTag(it.price), order); // v6 celebs6: struck through and halved in happy hour
      box.append(row);
    }
    return box;
  };

  const cols = el('div', 'bar-cols');
  cols.append(section('Drinks', BAR_MENU.filter((i) => i.kind === 'drink')), section('Food', BAR_MENU.filter((i) => i.kind === 'food')));
  const done = el('button', 'btn ghost', 'Close');
  done.type = 'button';
  done.addEventListener('click', () => sheet.close());
  const putDown = el('button', 'btn ghost bar-down', 'Put it down');
  putDown.type = 'button';
  putDown.addEventListener('click', () => void bar.drop());
  const foot = el('div', 'sheet-foot bar-foot');
  foot.append(status, putDown, done);
  sheet.body.append(balance, happyBanner(), cols, note, foot); // v6 celebs6: happy hour's line

  const paint = () => {
    const p = session.profile;
    balVal.textContent = formatMoney(p?.balance ?? 0);
    for (const [id, b] of buttons) {
      const it = barItem(id)!;
      b.disabled = busy !== null || (p?.balance ?? 0) < barPriceNow(it.price); // v6 celebs6
      b.textContent = busy === id ? 'Ordering' : 'Order';
    }
    const lines: string[] = [];
    const held = bar.held();
    if (held) lines.push(`In your hand: ${barItem(held.item)?.name ?? 'a drink'}, ${left(held.until - serverNow())} left.`);
    const coming = bar.pending.map((o) => barItem(o.item)?.name ?? 'an order');
    if (coming.length) lines.push(`On its way: ${coming.join(', ')}.`);
    status.textContent = lines.join(' ') || 'Nothing in your hand.';
    putDown.hidden = !held;
  };

  const place = async (it: BarItem) => {
    if (busy) return;
    busy = it.id;
    note.textContent = '';
    note.className = 'bar-note';
    paint();
    try {
      const paid = await bar.order(it.id);
      deps.sfx?.play('chips-handle', { volume: 0.45 });
      note.textContent = `${it.name}, ${formatMoney(paid.price)}. It's on its way.`; // v6 celebs6: what was paid
      note.className = 'bar-note ok';
    } catch (err) {
      note.textContent = problemText(err);
      note.className = 'bar-note err';
    } finally {
      busy = null;
      paint();
    }
  };

  offs.push(session.on(paint), bar.onChange(paint));
  clock = window.setInterval(paint, 1000);
  paint();
  return { root: sheet.root, close: () => sheet.close() };
}
