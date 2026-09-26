// The bar's menu: drinks and food at casino prices, paid from your balance when you order, and
// brought to you, printed the way a lounge prints its card: each thing drawn in brass line, what
// it is, what it costs and what it does for you. Above it, what's in your hand now (how much is
// left and for how long) and what's on its way; the switch for the drinks' sway on the view. A
// sheet like the cashier's: it holds the keyboard, Esc closes it.

import './shop.css';
import './barmenu.css';
import { BAR_MENU, barItem, type BarItem, type BarModel } from '../../../../shared/src/items.ts';
import { formatMoney } from '../../../../shared/src/money.ts';
import { serverNow } from '../../net/clock.ts';
import { el } from '../kit.ts';
import type { Closable, SessionLike, SfxLike } from '../menu/deps.ts';
import { openSheet } from '../menu/sheet.ts';
import { problemText } from '../menu/parts.ts';
import { heldOrders } from '../../world/consumables/held.ts';
import { drinkFx, onDrinkFx, setDrinkFx } from '../../world/consumables/prefs.ts';
import type { Bar } from './bar.ts';
import { barPriceNow, happyBanner, priceTag } from '../../world/celebs/happy.ts'; // v6 celebs6: happy hour

export interface BarMenuDeps {
  root: HTMLElement;
  bar: Bar;
  session: SessionLike;
  sfx?: Pick<SfxLike, 'play'>;
  onClose?(): void;
}

/** The card's sections, in order, and what's in each. */
const SECTIONS: { title: string; items: string[] }[] = [
  { title: 'Behind the Bar', items: ['cocktail', 'margarita', 'whiskey', 'beer', 'espresso', 'energy-drink'] },
  { title: 'Wine & Champagne', items: ['red-wine', 'champagne', 'dom'] },
  { title: 'Plates', items: ['sliders', 'truffle-fries', 'shrimp-cocktail', 'ribeye', 'lobster', 'caviar'] },
  { title: 'Sweets', items: ['macarons', 'birthday-cake'] },
];

/** What each does for you, in a few words (effects.ts has the numbers). */
const DOES: Record<string, string> = {
  beer: 'Loosens you up',
  'red-wine': 'A warm glow',
  cocktail: 'Goes to your head',
  whiskey: 'Goes to your head',
  margarita: 'A warm glow',
  champagne: 'You sparkle · 4 min',
  dom: 'Pop it and spray it',
  espresso: 'Quicker on your feet · 3 min',
  'energy-drink': 'Quickest on your feet · 2 min',
  sliders: 'Well fed · 5 min',
  'truffle-fries': 'Well fed · 4 min',
  'shrimp-cocktail': 'Well fed · 4 min',
  ribeye: 'Well fed · 8 min',
  lobster: 'Well fed · 7 min',
  caviar: 'Well fed · 5 min',
  macarons: 'Well fed · 3 min',
  'birthday-cake': 'Blow out the candles',
};

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
    title: 'The Bar',
    subtitle: 'Paid when you order and brought to you, one after another if you order a round. Each lasts five minutes in your hand, or until you sit down to play.',
    cls: 'bar-sheet dine-sheet',
    onClose: () => {
      clearInterval(clock);
      for (const off of offs) off();
      deps.onClose?.();
    },
  });

  // what's in your hand, your balance, the switch
  const top = el('div', 'dine-top');
  const hand = el('div', 'dine-hand');
  const handIcon = glyphCanvas(null, 34, 44);
  const handText = el('div', 'dine-hand-text');
  const status = el('div', 'bar-status');
  status.setAttribute('aria-live', 'polite');
  const meter = el('div', 'dine-meter');
  const meterFill = el('div', 'dine-meter-fill');
  meter.append(meterFill);
  const putDown = el('button', 'btn ghost bar-down dine-down', 'Put it down');
  putDown.type = 'button';
  putDown.addEventListener('click', () => void bar.drop());
  handText.append(status, meter);
  hand.append(handIcon, handText, putDown);

  const side = el('div', 'dine-side');
  const balance = el('div', 'bar-balance');
  const balVal = el('span', 'money');
  balance.append(el('span', 'bar-balance-label', 'Balance'), balVal);
  const fx = el('button', 'dine-switch');
  fx.type = 'button';
  const fxKnob = el('span', 'dine-switch-knob');
  fx.append(fxKnob, el('span', 'dine-switch-label', 'Drinks sway the view'));
  const paintFx = () => fx.setAttribute('aria-pressed', String(drinkFx()));
  fx.addEventListener('click', () => setDrinkFx(!drinkFx()));
  offs.push(onDrinkFx(paintFx));
  paintFx();
  side.append(balance, fx);
  top.append(hand, side);

  const note = el('p', 'bar-note');
  note.setAttribute('aria-live', 'polite');

  const buttons = new Map<string, HTMLButtonElement>();
  let busy: string | null = null;
  const row = (it: BarItem) => {
    const r = el('div', 'bar-item dine-item');
    r.dataset.id = it.id;
    const text = el('div', 'bar-text');
    const line = el('div', 'dine-line');
    line.append(el('span', 'bar-name', it.name), el('span', 'dine-dots'), priceTag(it.price)); // v6 celebs6: struck through and halved in happy hour
    const under = el('div', 'dine-under');
    under.append(el('span', 'bar-about', it.about));
    const does = DOES[it.id];
    if (does) under.append(el('span', 'dine-does', does));
    text.append(line, under);
    const order = el('button', 'btn bar-order', 'Order');
    order.type = 'button';
    order.setAttribute('aria-label', `Order ${it.name}, ${formatMoney(it.price)}`);
    order.addEventListener('click', () => void place(it));
    buttons.set(it.id, order);
    r.append(glyphCanvas(it, 30, 40), text, order);
    return r;
  };
  const listed = new Set(SECTIONS.flatMap((s) => s.items));
  // anything added to the menu later still shows, with its kind
  const extra = BAR_MENU.filter((i) => !listed.has(i.id));
  const section = (title: string, items: readonly BarItem[]) => {
    const box = el('div', 'bar-section dine-section');
    box.append(el('div', 'section-label dine-label', title));
    for (const it of items) box.append(row(it));
    return box;
  };
  const pick = (ids: string[]) => ids.map((id) => barItem(id)).filter((i): i is BarItem => !!i);
  const cols = el('div', 'bar-cols dine-cols');
  const drinks = el('div', 'dine-col');
  const food = el('div', 'dine-col');
  drinks.append(section(SECTIONS[0]!.title, [...pick(SECTIONS[0]!.items), ...extra.filter((i) => i.kind === 'drink')]), section(SECTIONS[1]!.title, pick(SECTIONS[1]!.items)));
  food.append(section(SECTIONS[2]!.title, [...pick(SECTIONS[2]!.items), ...extra.filter((i) => i.kind === 'food')]), section(SECTIONS[3]!.title, pick(SECTIONS[3]!.items)));
  cols.append(drinks, food);

  const done = el('button', 'btn ghost', 'Close');
  done.type = 'button';
  done.addEventListener('click', () => sheet.close());
  const foot = el('div', 'sheet-foot bar-foot dine-foot');
  foot.append(note, el('span', 'dine-keys', 'Q takes a sip or a bite. Stand facing someone with a drink to toast.'), done);
  sheet.body.append(top, happyBanner(), cols, foot); // v6 celebs6: happy hour's line

  let shown: string | null = null;
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
    const it = held ? barItem(held.item) : null;
    let level = 0;
    if (held) {
      const h = [...heldOrders()].find((o) => o.order === held.order);
      level = h?.state?.level ?? 1;
      const done = h?.state?.done ?? false;
      lines.push(done ? `In your hand: ${it?.name ?? 'an order'}, finished.` : `In your hand: ${it?.name ?? 'a drink'}, ${left(held.until - serverNow())} left.`);
    }
    const coming = bar.pending.map((o) => barItem(o.item)?.name ?? 'an order');
    if (coming.length) lines.push(`On its way: ${coming.join(', ')}.`);
    status.textContent = lines.join(' ') || 'Nothing in your hand.';
    putDown.hidden = !held;
    meter.hidden = !held;
    meterFill.style.transform = `scaleX(${Math.max(0, Math.min(1, level))})`;
    hand.classList.toggle('empty', !held);
    const key = it?.id ?? null;
    if (key !== shown) {
      shown = key;
      drawGlyph(handIcon, it, 34, 44);
    }
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

// --- the card's drawings ------------------------------------------------------------------------

function glyphCanvas(it: BarItem | null, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.className = 'dine-glyph';
  c.setAttribute('aria-hidden', 'true');
  drawGlyph(c, it, w, h);
  return c;
}

/** The thing, in thin brass line: its glass, bottle, cup or plate, and a touch of what's in it. */
function drawGlyph(c: HTMLCanvasElement, it: BarItem | null, w: number, h: number): void {
  const k = Math.min(3, Math.max(1, Math.round(globalThis.devicePixelRatio || 1)));
  c.width = w * k;
  c.height = h * k;
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  const g = c.getContext('2d');
  if (!g) return;
  g.setTransform(k, 0, 0, k, 0, 0);
  g.clearRect(0, 0, w, h);
  if (!it) return;
  // drawn on a 30 x 40 grid, centred
  g.translate((w - 30 * (h / 40)) / 2, 0);
  g.scale(h / 40, h / 40);
  g.lineWidth = 1.25;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const line = '#d8b06a';
  const fill = FILLS[it.id] ?? 'rgba(216, 176, 106, 0.28)';
  g.strokeStyle = line;
  const path = (pts: [number, number][], close = false) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    if (close) g.closePath();
  };
  const pour = (pts: [number, number][]) => {
    path(pts, true);
    g.fillStyle = fill;
    g.fill();
  };
  const model: BarModel = it.model;
  switch (model) {
    case 'flute':
      pour([[12.2, 12], [17.8, 12], [17.4, 22], [15, 25], [12.6, 22]]);
      path([[11.5, 5], [12, 22], [15, 26], [18, 22], [18.5, 5]]);
      g.stroke();
      path([[15, 26], [15, 34]]);
      g.stroke();
      path([[11, 35], [19, 35]]);
      g.stroke();
      break;
    case 'martini':
      pour([[8.5, 11], [21.5, 11], [15, 19]]);
      path([[6, 8], [24, 8], [15, 20], [6, 8]]);
      g.stroke();
      path([[15, 20], [15, 34]]);
      g.stroke();
      path([[10, 35], [20, 35]]);
      g.stroke();
      g.beginPath();
      g.arc(17.5, 12, 1.5, 0, Math.PI * 2);
      g.fillStyle = '#6e7a2a';
      g.fill();
      break;
    case 'margarita':
      pour([[6.5, 11], [23.5, 11], [18.5, 15], [16.5, 19], [13.5, 19], [11.5, 15]]);
      path([[4, 9], [26, 9], [19, 14], [17, 20], [13, 20], [11, 14], [4, 9]]);
      g.stroke();
      path([[15, 20], [15, 34]]);
      g.stroke();
      path([[10, 35], [20, 35]]);
      g.stroke();
      g.beginPath();
      g.arc(24, 8, 3, 0, Math.PI * 2);
      g.stroke();
      break;
    case 'wine':
      pour([[9.5, 14], [20.5, 14], [19, 19.5], [15, 21.5], [11, 19.5]]);
      path([[10, 5], [9, 14], [11, 20], [15, 22], [19, 20], [21, 14], [20, 5]]);
      g.stroke();
      path([[15, 22], [15, 34]]);
      g.stroke();
      path([[10, 35], [20, 35]]);
      g.stroke();
      break;
    case 'rocks':
      pour([[8.8, 24], [21.2, 24], [21, 33], [9, 33]]);
      path([[8, 16], [9, 34], [21, 34], [22, 16]]);
      g.stroke();
      g.strokeRect(12, 22, 5, 5);
      break;
    case 'cup':
      pour([[10.5, 23], [19.5, 23], [18.6, 28], [11.4, 28]]);
      path([[9.5, 21], [11, 30], [19, 30], [20.5, 21]]);
      g.stroke();
      g.beginPath();
      g.arc(21.5, 24.5, 2.4, -1.4, 1.4);
      g.stroke();
      path([[5, 32], [25, 32]]);
      g.stroke();
      for (const x of [12.5, 16.5]) {
        g.beginPath();
        g.moveTo(x, 18);
        g.bezierCurveTo(x - 2, 15, x + 2, 13, x, 10);
        g.stroke();
      }
      break;
    case 'bottle':
      pour([[11.3, 20], [18.7, 20], [18.7, 34], [11.3, 34]]);
      path([[13.5, 4], [13.5, 11], [11, 16], [11, 35], [19, 35], [19, 16], [16.5, 11], [16.5, 4]]);
      g.stroke();
      g.strokeRect(11, 22, 8, 6);
      break;
    case 'magnum':
      path([[13.2, 2], [13.2, 11], [9, 17], [9, 37], [21, 37], [21, 17], [16.8, 11], [16.8, 2]]);
      g.fillStyle = 'rgba(40, 80, 50, 0.55)';
      g.fill();
      g.stroke();
      g.fillStyle = '#d8b06a';
      g.fillRect(13, 2, 4, 6);
      g.strokeRect(10.5, 24, 9, 7);
      break;
    case 'can':
      path([[10, 6], [20, 6], [21, 8], [21, 34], [20, 36], [10, 36], [9, 34], [9, 8]], true);
      g.stroke();
      pour([[9.6, 15], [20.4, 15], [20.4, 26], [9.6, 26]]);
      path([[11, 21], [14, 17], [14, 21], [17, 17]]);
      g.strokeStyle = '#9fe24a';
      g.stroke();
      break;
    case 'cake':
      path([[3, 34], [27, 34]]);
      g.stroke();
      pour([[7, 24], [23, 24], [23, 33], [7, 33]]);
      g.strokeRect(7, 24, 16, 9);
      path([[7, 28.5], [23, 28.5]]);
      g.stroke();
      for (const x of [11, 15, 19]) {
        path([[x, 24], [x, 17]]);
        g.stroke();
        g.beginPath();
        g.ellipse(x, 14.5, 1.1, 2, 0, 0, Math.PI * 2);
        g.fillStyle = '#f1c35a';
        g.fill();
      }
      break;
    case 'plate': {
      path([[3, 31], [27, 31]]);
      g.stroke();
      g.beginPath();
      g.ellipse(15, 31, 12, 2.6, 0, 0, Math.PI);
      g.stroke();
      g.beginPath();
      // the food, a mound or pieces
      if (it.id === 'sliders' || it.id === 'macarons') {
        for (const x of [9, 15, 21]) {
          g.beginPath();
          g.arc(x, 27.5, 3, Math.PI, 0);
          g.closePath();
          g.fillStyle = fill;
          g.fill();
          g.stroke();
        }
      } else if (it.id === 'truffle-fries') {
        for (let i = 0; i < 7; i++) {
          path([[8 + i * 2.2, 30], [10 + i * 2.2 - (i % 2) * 3, 21 + (i % 3)]]);
          g.stroke();
        }
      } else {
        g.beginPath();
        g.ellipse(15, 29, 8, 5, 0, Math.PI, 0);
        g.closePath();
        g.fillStyle = fill;
        g.fill();
        g.stroke();
      }
      break;
    }
  }
}

/** The colour of what's in it, for the little drawings. */
const FILLS: Record<string, string> = {
  beer: 'rgba(214, 150, 40, 0.55)',
  'red-wine': 'rgba(130, 20, 40, 0.8)',
  cocktail: 'rgba(210, 225, 220, 0.35)',
  whiskey: 'rgba(190, 110, 30, 0.6)',
  champagne: 'rgba(230, 200, 110, 0.55)',
  espresso: 'rgba(70, 40, 20, 0.9)',
  margarita: 'rgba(200, 220, 120, 0.5)',
  'energy-drink': 'rgba(40, 40, 45, 0.9)',
  sliders: 'rgba(180, 110, 50, 0.7)',
  'truffle-fries': 'rgba(220, 170, 70, 0.6)',
  'shrimp-cocktail': 'rgba(235, 120, 80, 0.65)',
  lobster: 'rgba(200, 50, 30, 0.7)',
  caviar: 'rgba(30, 30, 35, 0.9)',
  ribeye: 'rgba(150, 50, 40, 0.75)',
  macarons: 'rgba(210, 150, 170, 0.7)',
  'birthday-cake': 'rgba(90, 45, 25, 0.9)',
};
