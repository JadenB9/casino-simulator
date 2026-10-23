// A big win as a toast: one at a time, in the column of notes under the HUD (stack.ts) that the
// kit's toasts share, so the two never sit on each other (big wins only show on the floor, never
// at a table). The name and amount on one line, what paid under it. Someone else's achievement
// takes a turn the same way: the name and the feat, the game under it. Screen readers hear it
// politely, and each goes into the page's notification history (history.ts).

import './feed.css';
import { el } from '../kit.ts';
import { detail, wholeDollars } from './lines.ts';
import type { BigWin } from '../../../../shared/src/protocol.ts';
import { feedLines } from '../feats/lines.ts';
import { pushNotice } from './stack.ts';
import { remember } from './history.ts';

/** Someone's feat, as the floor tells it. */
interface FeatNews {
  feat: string;
  name: string;
}

const SHOW_MS = 4200;
/** The fade out (theme.css `.toast.out`), and a breath before the next. */
const OUT_MS = 380;
/** A burst of wins shows the latest few, not a backlog. */
const QUEUE_MAX = 3;

export class WinToasts {
  private queue: (BigWin | FeatNews)[] = [];
  private busy = false;
  private timer = 0;
  /** Takes the toast on screen away early. */
  private current: (() => void) | null = null;

  constructor(private readonly root: HTMLElement) {}

  show(w: BigWin | FeatNews): void {
    this.queue.push(w);
    while (this.queue.length > QUEUE_MAX) this.queue.shift();
    if (!this.busy) this.next();
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.queue = [];
    this.busy = false;
    this.current?.();
    this.current = null;
  }

  private next(): void {
    const w = this.queue.shift();
    if (!w) {
      this.busy = false;
      return;
    }
    this.busy = true;
    const t = el('div', 'bigwin-toast panel');
    t.setAttribute('role', 'status');
    const line = el('div', 'bigwin-line');
    if ('feat' in w) {
      // "name earned Royal Flush", the game under it
      const f = feedLines(w.name, w.feat);
      if (!f) {
        this.next();
        return;
      }
      t.classList.add('feat');
      line.append(el('span', 'bigwin-name', f.name), el('span', 'bigwin-won', ' earned '), el('span', 'bigwin-feat', f.what));
      t.append(line, el('div', 'bigwin-sub', f.sub));
      remember({ kind: 'feat', text: `${f.name} earned ${f.what}`, sub: f.sub });
    } else {
      // "name won $12,500": the name and the amount carry the weight
      line.append(el('span', 'bigwin-name', w.name), el('span', 'bigwin-won', ' won '), el('span', 'bigwin-amount money', wholeDollars(w.amount)));
      t.append(line, el('div', 'bigwin-sub', detail(w)));
      remember({ kind: 'win', text: `${w.name} won ${wholeDollars(w.amount)}`, sub: detail(w) });
    }
    this.current = pushNotice(t, SHOW_MS, this.root);
    this.timer = window.setTimeout(() => {
      this.current = null;
      this.next();
    }, SHOW_MS + OUT_MS);
  }
}
