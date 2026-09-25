// What a visit and a gift box say on screen: a notice when someone walks in ("Seraphina Vale just
// walked in through the lobby") or a box turns up, a small card while a celebrity is on the floor
// saying where they are (so you can go and find them), and the photo you get with them: their
// name, the tip and the line they said. Text goes in with textContent only.

import { el } from '../../ui/kit.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { calm } from '../../app/comfort.ts';

const SHOW_MS = 5200;
const OUT_MS = 380;
const QUEUE_MAX = 3;

export interface Notice {
  /** A small-caps word over the line ("Sighting", "Gift box"). */
  tag: string;
  title: string;
  sub?: string;
}

/** Notices, one at a time, under the HUD a little below the big-win toasts' row. */
export class Notices {
  private box: HTMLElement | null = null;
  private queue: Notice[] = [];
  private busy = false;
  private timer = 0;

  constructor(private readonly root: HTMLElement) {}

  show(n: Notice): void {
    this.queue.push(n);
    while (this.queue.length > QUEUE_MAX) this.queue.shift();
    if (!this.busy) this.next();
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.queue = [];
    this.box?.remove();
    this.box = null;
  }

  private next(): void {
    const n = this.queue.shift();
    if (!n) {
      this.busy = false;
      return;
    }
    this.busy = true;
    if (!this.box) {
      this.box = el('div', 'celeb-notices');
      this.box.setAttribute('role', 'status');
      this.box.setAttribute('aria-live', 'polite');
      this.root.append(this.box);
    }
    const t = el('div', 'celeb-notice panel');
    t.append(el('div', 'celeb-notice-tag', n.tag), el('div', 'celeb-notice-title', n.title));
    if (n.sub) t.append(el('div', 'celeb-notice-sub', n.sub));
    this.box.replaceChildren(t);
    this.timer = window.setTimeout(() => {
      t.classList.add('out');
      this.timer = window.setTimeout(() => {
        t.remove();
        this.next();
      }, OUT_MS);
    }, SHOW_MS);
  }
}

/** Where the cards at the right go, one under the other (a celebrity on the floor, happy hour). */
function stack(root: HTMLElement): HTMLElement {
  let s = root.querySelector<HTMLElement>(':scope > .celeb-stack');
  if (!s) {
    s = el('div', 'celeb-stack');
    root.append(s);
  }
  return s;
}

/** The card while a celebrity is on the floor: who, and where they are now. */
export class Sighting {
  private card: HTMLElement | null = null;
  private where: HTMLElement | null = null;
  private shown = '';

  constructor(private readonly root: HTMLElement) {}

  /** Show `name` (known for `known`) in `room`, `metres` from you; null takes the card down. */
  set(s: { name: string; known: string; room: string; metres: number; met: boolean } | null): void {
    if (!s) {
      this.card?.remove();
      this.card = null;
      this.shown = '';
      return;
    }
    if (!this.card || this.shown !== s.name) {
      this.card?.remove();
      const c = el('div', calm() ? 'celeb-sighting panel calm' : 'celeb-sighting panel');
      c.append(el('div', 'celeb-sighting-tag', 'On the floor'), el('div', 'celeb-sighting-name', s.name), el('div', 'celeb-sighting-known', s.known));
      this.where = el('div', 'celeb-sighting-where');
      c.append(this.where);
      stack(this.root).prepend(c);
      this.card = c;
      this.shown = s.name;
    }
    // (v6 city6: Infinity when you're out of the casino, a ride away)
    const near = !Number.isFinite(s.metres) ? 'in the casino' : s.metres < 4 ? 'right here' : `${Math.round(s.metres)} m away`;
    this.where!.textContent = s.met ? `${s.room} · met tonight` : `${s.room} · ${near}`;
    this.card.classList.toggle('met', s.met);
  }

  dispose(): void {
    this.set(null);
  }
}

/** Happy hour's card: half price at the bar, and the minutes left. */
export class HappyCard {
  private card: HTMLElement | null = null;
  private clock: HTMLElement | null = null;

  constructor(private readonly root: HTMLElement) {}

  /** Show the time left (`left` like "11:42"); null takes the card down. */
  set(left: string | null): void {
    if (left === null) {
      this.card?.remove();
      this.card = null;
      return;
    }
    if (!this.card) {
      const c = el('div', 'happy-card panel');
      const row = el('div', 'happy-card-left');
      this.clock = el('span', 'happy-card-clock');
      row.append(el('span', '', 'Everything on the menu'), this.clock);
      c.append(el('div', 'happy-card-tag', 'Happy hour'), el('div', 'happy-card-title', 'Half price at the bar'), row);
      stack(this.root).append(c);
      this.card = c;
    }
    this.clock!.textContent = left;
  }

  dispose(): void {
    this.set(null);
  }
}

/** The photo with a celebrity (or a gift box's find): a card that slides in at the right and goes. */
export function photoCard(root: HTMLElement, p: { tag: string; title: string; amount: Cents; line?: string; foot?: string; picture?: HTMLCanvasElement | null }): void {
  const card = el('div', 'celeb-photo panel');
  card.setAttribute('role', 'status');
  const frame = el('div', `celeb-photo-frame${p.picture ? ' shot' : ''}`);
  if (p.picture) {
    p.picture.className = 'celeb-photo-picture';
    p.picture.setAttribute('aria-hidden', 'true');
    frame.append(p.picture);
  }
  const caption = el('div', 'celeb-photo-caption');
  caption.append(el('div', 'celeb-photo-tag', p.tag), el('div', 'celeb-photo-title', p.title));
  frame.append(caption);
  card.append(frame, el('div', 'celeb-photo-amount money', `+${formatMoney(p.amount)}`));
  if (p.line) card.append(el('div', 'celeb-photo-line', p.line));
  if (p.foot) card.append(el('div', 'celeb-photo-foot', p.foot));
  root.querySelector('.celeb-photo')?.remove();
  root.append(card);
  setTimeout(() => card.classList.add('out'), 6200);
  setTimeout(() => card.remove(), 6700);
}
