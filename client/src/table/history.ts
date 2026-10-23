// The last rounds at a table this sitting, and what each paid: a small drawer at the top right
// (where Hold'em keeps its hand history), one line while it's closed (the last round's result and
// the sitting so far), the last dozen rounds when it's open. O opens and closes it at every table
// (H is a move at several); it starts empty each time you sit down, from what the table already
// tells the view (nothing more is asked of the server).

import './history.css';
import { formatMoney, type Cents } from '../../../shared/src/money.ts';
import { el } from '../ui/kit.ts';
import { isTyping, overlayCount } from '../ui/keyboard.ts';

/** One round, as the view saw it settle. */
export interface Round {
  /** What it was, in a few words: "20 against 19", "Banker 7 over 5", "Pair of Kings". */
  what: string;
  /** All you put down, and all that came back (stakes returned included). */
  staked: Cents;
  returned: Cents;
  /** A second line when there's more to say: the spots one by one, the side bets. */
  detail?: string;
}

/** How many rounds the drawer keeps. */
export const KEEP = 12;

/** The round's result in words: "+$25", "-$10", "Push" (nothing won or lost), "No bet". */
export function resultText(r: Pick<Round, 'staked' | 'returned'>): { text: string; kind: 'win' | 'lose' | 'push' } {
  const net = r.returned - r.staked;
  if (r.staked === 0 && r.returned === 0) return { text: 'No bet', kind: 'push' };
  if (net === 0) return { text: 'Push', kind: 'push' };
  return { text: formatMoney(net, { sign: true }), kind: net > 0 ? 'win' : 'lose' };
}

export class RoundHistory {
  readonly root = el('aside', 'th-history panel');
  private readonly head = el('button', 'th-history-head');
  private readonly last = el('span', 'th-history-last money');
  private readonly body = el('div', 'th-history-body panel');
  private readonly list = el('ol', 'th-history-list');
  private readonly total = el('div', 'th-history-total');
  private rounds: (Round & { n: number })[] = [];
  private count = 0;
  private net: Cents = 0;

  constructor(parent: HTMLElement, private readonly title = 'History') {
    this.root.setAttribute('aria-label', 'The last rounds at this table');
    this.head.type = 'button';
    this.head.setAttribute('aria-expanded', 'false');
    this.head.title = 'The last rounds at this table and what they paid (O)';
    this.head.append(el('span', 'th-history-title', title), this.last, el('span', 'key', 'O'));
    this.head.addEventListener('click', () => this.toggle());
    this.body.hidden = true;
    this.body.append(this.list, this.total);
    this.root.append(this.head, this.body);
    // (the open list reaches down over the table: the board fit measures only the line, the
    // root, which an absolutely placed list doesn't widen)
    this.root.hidden = true;
    parent.append(this.root);
    addEventListener('keydown', this.onKey);
    this.render();
  }

  /** A round has settled. */
  add(r: Round): void {
    this.count++;
    this.net += r.returned - r.staked;
    this.rounds.unshift({ ...r, n: this.count });
    this.rounds.length = Math.min(this.rounds.length, KEEP);
    this.root.hidden = false;
    this.render();
  }

  /** Show or hide the whole drawer (a view with nothing to list yet keeps it out of the way). */
  show(on: boolean): void {
    this.root.hidden = !on || this.count === 0;
  }

  get open(): boolean {
    return !this.body.hidden;
  }

  toggle(open = !this.open): void {
    this.body.hidden = !open;
    this.head.setAttribute('aria-expanded', String(open));
    this.root.classList.toggle('th-open', open);
  }

  private render(): void {
    const latest = this.rounds[0];
    if (latest) {
      const res = resultText(latest);
      this.last.textContent = res.text;
      this.last.className = `th-history-last money ${res.kind}`;
    } else this.last.textContent = '';
    this.list.replaceChildren(
      ...this.rounds.map((r) => {
        const res = resultText(r);
        const li = el('li', 'th-round');
        const top = el('div', 'th-round-top');
        top.append(el('span', 'th-round-n', `#${r.n}`), el('span', 'th-round-what', r.what), el('b', `th-round-net money ${res.kind}`, res.text));
        li.append(top);
        const sub = [r.staked > 0 ? `Bet ${formatMoney(r.staked)}` : '', r.detail ?? ''].filter(Boolean).join(' · ');
        if (sub) li.append(el('div', 'th-round-sub', sub));
        return li;
      }),
    );
    const sign = this.net === 0 ? '' : this.net > 0 ? ' up' : ' down';
    this.total.replaceChildren(el('span', 'label', `This sitting · ${this.count} round${this.count === 1 ? '' : 's'}`), el('b', `money${sign}`, this.net === 0 ? 'Even' : formatMoney(this.net, { sign: true })));
  }

  dispose(): void {
    removeEventListener('keydown', this.onKey);
    this.root.remove();
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyO' || e.repeat || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (overlayCount() > 0 || isTyping(e) || this.root.hidden) return;
    e.preventDefault();
    this.toggle();
  };
}

/**
 * A round at a table where you can play several hands (Three Card, Let It Ride, Pai Gow, War):
 * each hand's result as it settles (a fold settles early), handed to the history as one round once
 * the last of them has. `vs` is what they played against ("Queen high"), when there is one.
 */
export class RoundLog {
  private hands: { what: string; wagered: Cents; returned: Cents }[] = [];
  private expect = 0;
  vs = '';

  constructor(private readonly history: RoundHistory) {}

  /** A round is dealt to `hands` of yours. */
  start(hands: number): void {
    this.hands = [];
    this.expect = hands;
    this.vs = '';
  }

  /** One of your hands has settled. */
  settle(what: string, wagered: Cents, returned: Cents): void {
    if (this.expect === 0) return;
    this.hands.push({ what, wagered, returned });
    if (this.hands.length < this.expect) return;
    const vs = this.vs ? ` vs ${this.vs}` : '';
    const one = this.hands.length === 1;
    this.history.add({
      what: one ? `${this.hands[0]!.what}${vs}` : `${this.hands.length} hands${vs}`,
      staked: this.hands.reduce((a, h) => a + h.wagered, 0),
      returned: this.hands.reduce((a, h) => a + h.returned, 0),
      detail: one ? undefined : this.hands.map((h) => `${h.what} ${resultText({ staked: h.wagered, returned: h.returned }).text}`).join(', '),
    });
    this.expect = 0;
    this.hands = [];
  }
}
