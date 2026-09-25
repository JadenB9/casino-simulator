// Happy hour on this screen (shared/src/happyhour.ts): when the floor last said it is, and the bar
// menu's prices while it's on, the full price struck through beside the half. The server prices
// the order when it's paid, whatever this shows; this only keeps the menu honest about it.

import './happy.css';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { halfPrice, type HappyHour } from '../../../../shared/src/happyhour.ts';
import { serverNow } from '../../net/clock.ts';

let current: HappyHour | null = null;
/** Tags and banners on screen, redrawn every second while they're in the page. */
const live = new Set<() => boolean>();
let timer = 0;

/** What the floor said: the happy hour going on, or the next. */
export function setHappyHour(h: HappyHour | null): void {
  current = h;
  redraw();
}

export function happyHour(): HappyHour | null {
  return current;
}

export function happyOn(now = serverNow()): boolean {
  return current !== null && now >= current.start && now < current.end;
}

/** What a bar price comes to right now. */
export function barPriceNow(price: Cents): Cents {
  return happyOn() ? halfPrice(price) : price;
}

/** "11:42" */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A menu price: the price, or in happy hour the full price struck through and the half beside it. */
export function priceTag(price: Cents): HTMLElement {
  const tag = document.createElement('span');
  tag.className = 'bar-price money';
  let shown: boolean | null = null;
  let seen = false;
  const draw = () => {
    // (gone once it has been on the page and left it)
    if (!tag.isConnected && seen) return false;
    seen ||= tag.isConnected;
    const on = happyOn();
    if (on === shown) return true;
    shown = on;
    tag.classList.toggle('happy', on);
    if (!on) {
      tag.replaceChildren(formatMoney(price));
      return true;
    }
    const was = document.createElement('s');
    was.className = 'happy-was';
    was.textContent = formatMoney(price);
    const now = document.createElement('span');
    now.className = 'happy-now';
    now.textContent = formatMoney(halfPrice(price));
    tag.replaceChildren(was, now);
    return true;
  };
  watch(draw);
  return tag;
}

/** A line over the menu while happy hour is on: "Happy hour: everything half price, 11:42 left." */
export function happyBanner(): HTMLElement {
  const b = document.createElement('p');
  b.className = 'happy-banner';
  b.hidden = true;
  const word = document.createElement('span');
  word.className = 'happy-banner-word';
  word.textContent = 'Happy hour';
  const text = document.createElement('span');
  b.append(word, text);
  let seen = false;
  watch(() => {
    if (!b.isConnected && seen) return false;
    seen ||= b.isConnected;
    const on = happyOn();
    b.hidden = !on;
    if (on) text.textContent = `Everything half price, ${clockText(current!.end - serverNow())} left.`;
    return true;
  });
  return b;
}

function watch(draw: () => boolean): void {
  draw();
  live.add(draw);
  if (!timer) timer = window.setInterval(redraw, 1000);
}

function redraw(): void {
  for (const draw of live) if (!draw()) live.delete(draw);
  if (live.size === 0 && timer) {
    clearInterval(timer);
    timer = 0;
  }
}
