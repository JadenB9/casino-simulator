// A big win as a toast: one at a time, under the HUD in the row the dealer's line uses at a table
// (toasts only show on the floor, so the two never meet). The name and amount on one line, what
// paid under it. Screen readers hear it politely.

import './feed.css';
import { el } from '../kit.ts';
import { detail, wholeDollars } from './lines.ts';
import type { BigWin } from '../../../../shared/src/protocol.ts';

const SHOW_MS = 4200;
const OUT_MS = 380;
/** A burst of wins shows the latest few, not a backlog. */
const QUEUE_MAX = 3;

export class WinToasts {
  private box: HTMLElement | null = null;
  private queue: BigWin[] = [];
  private busy = false;
  private timer = 0;

  constructor(private readonly root: HTMLElement) {}

  show(w: BigWin): void {
    this.queue.push(w);
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
    const w = this.queue.shift();
    if (!w) {
      this.busy = false;
      return;
    }
    this.busy = true;
    if (!this.box) {
      this.box = el('div', 'bigwin-toasts pass');
      this.box.setAttribute('role', 'status');
      this.box.setAttribute('aria-live', 'polite');
      this.root.append(this.box);
    }
    const t = el('div', 'bigwin-toast panel');
    const line = el('div', 'bigwin-line');
    // "name won $12,500": the name and the amount carry the weight
    line.append(el('span', 'bigwin-name', w.name), el('span', 'bigwin-won', ' won '), el('span', 'bigwin-amount money', wholeDollars(w.amount)));
    t.append(line, el('div', 'bigwin-sub', detail(w)));
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
