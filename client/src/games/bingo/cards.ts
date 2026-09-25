// A bingo card on the screen: printed paper with the B-I-N-G-O header in the balls' colours, 25
// cells with the free centre starred, and daubs of ink on every number called. With auto daub off,
// a called number on your card pulses until you daub it (a click); the caller checks every card
// either way, so a missed daub never costs a prize. Wins ring their pattern's cells and hang a tag
// on the card with what it paid.

import { el } from '../../ui/kit.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { LETTERS, FREE, LINES, CORNERS, CELLS, PATTERN_NAMES, toGo, type Pattern } from '../../../../shared/src/games/bingo/rules.ts';
import type { CardView } from '../../../../shared/src/games/bingo/protocol.ts';
import { multText } from './art.ts';

/** The cells a pattern was completed with on this card, given every ball called by then. */
export function patternCells(nums: readonly number[], called: ReadonlySet<number>, p: Pattern): number[] {
  const marked = (c: number) => c === FREE || called.has(nums[c]!);
  if (p === 'corners') return [...CORNERS];
  if (p === 'blackout') return Array.from({ length: CELLS }, (_, c) => c);
  return LINES.filter((l) => l.every(marked)).flat();
}

export class CardEl {
  readonly root = el('div', 'bg-card');
  private readonly cells: HTMLElement[] = [];
  private readonly tags = el('div', 'bg-card-tags');
  private readonly need = el('div', 'bg-card-need');
  /** Numbers daubed on this card. */
  private readonly daubed = new Set<number>();

  constructor(
    readonly card: CardView,
    private readonly onDaub: (card: CardEl, n: number) => void,
  ) {
    const head = el('div', 'bg-card-head');
    LETTERS.forEach((l, i) => head.append(el('div', `bg-letter c${i}`, l)));
    const grid = el('div', 'bg-grid');
    card.nums.forEach((n, cell) => {
      const c = el('button', 'bg-cell');
      c.type = 'button';
      if (cell === FREE) {
        c.classList.add('free', 'daubed');
        c.textContent = '★';
        c.title = 'Free';
      } else {
        c.textContent = String(n);
        c.addEventListener('click', () => this.onDaub(this, n));
      }
      this.cells.push(c);
      grid.append(c);
    });
    const foot = el('div', 'bg-card-foot');
    foot.append(el('span', 'bg-card-price money', `${formatMoney(card.stake)} card`), this.need);
    this.root.append(head, grid, foot, this.tags);
    for (const [p, w] of Object.entries(card.won)) if (w) this.tag(p as Pattern, w.paid, 0);
  }

  /** Daub (or show as called, waiting for a daub) every number on the card that has been called. */
  mark(called: ReadonlySet<number>, auto: boolean): void {
    this.card.nums.forEach((n, cell) => {
      if (cell === FREE || !called.has(n)) return;
      if (auto) this.daub(n, false);
      else if (!this.daubed.has(n)) this.cells[cell]!.classList.add('called');
    });
  }

  /** Ink on a number (fresh: with the dauber's splash). Only called numbers take ink. */
  daub(n: number, fresh = true): void {
    const cell = this.card.nums.indexOf(n);
    if (cell < 0 || this.daubed.has(n)) return;
    this.daubed.add(n);
    const c = this.cells[cell]!;
    c.classList.remove('called');
    c.classList.add('daubed');
    if (fresh) {
      c.classList.add('fresh');
      setTimeout(() => c.classList.remove('fresh'), 500);
    }
  }

  has(n: number): boolean {
    return this.card.nums.includes(n);
  }

  isDaubed(n: number): boolean {
    return this.daubed.has(n);
  }

  /** What the card still needs: the fewest numbers for a prize still open, or nothing. */
  setNeed(called: ReadonlySet<number>, open: Pattern[]): void {
    let best: { p: Pattern; n: number } | null = null;
    for (const p of open) {
      if (this.card.won[p]) continue;
      const n = toGo(this.card.nums, called, p);
      if (!best || n < best.n) best = { p, n };
    }
    this.need.textContent = best ? `${PATTERN_NAMES[best.p]} · ${best.n} to go` : '';
    this.root.classList.toggle('one-to-go', best?.n === 1);
  }

  /** A prize: ring its cells and hang the tag. */
  win(p: Pattern, call: number, mult: number, paid: Cents, called: ReadonlySet<number>): void {
    this.card.won[p] = { call, paid };
    for (const cell of patternCells(this.card.nums, called, p)) this.cells[cell]!.classList.add('win');
    this.root.classList.add('won');
    this.tag(p, paid, mult);
  }

  private tag(p: Pattern, paid: Cents, mult: number): void {
    const t = el('div', `bg-tag ${p}`);
    t.append(el('span', '', PATTERN_NAMES[p]), el('span', 'money', `+${formatMoney(paid)}${mult ? ` · ${multText(mult)}` : ''}`));
    this.tags.append(t);
  }
}
