// Tipping the dealer at every table with one (shared/src/tip.ts): a small panel with the table
// minimum and twice it, K and ⇧K. It shows while you're seated, sitting on the right end of the
// table's chip tray (and away with it while a hand is being decided), or in the bottom-right corner
// at a table without one; the chips come off your stack once the table has taken them, and the
// dealer thanks whoever tipped.

import './tip.css';
import { formatMoney, type Cents } from '../../../shared/src/money.ts';
import { el } from '../ui/kit.ts';
import { isTyping, overlayCount } from '../ui/keyboard.ts';

/** Space between the panel and the tray, or a panel it keeps clear of, in CSS px. */
const GAP = 8;

export class TipControl {
  readonly root = el('div', 'tip-dealer panel');
  private readonly buttons: [HTMLButtonElement, HTMLButtonElement];
  private amounts: [Cents, Cents] = [0, 0];
  private seated = false;
  private trayGone = false;

  constructor(
    private readonly parent: HTMLElement,
    private readonly send: (amount: Cents) => void,
  ) {
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Tip the dealer');
    this.buttons = [this.button(0, 'K'), this.button(1, '⇧K')];
    this.root.append(el('span', 'tip-dealer-label', 'Tip dealer'), ...this.buttons);
    this.root.hidden = true;
    parent.append(this.root);
    addEventListener('keydown', this.onKey);
  }

  /** The table's tips and your stack there; null while you aren't seated (the panel hides). */
  set(amounts: [Cents, Cents], stack: Cents | null): void {
    this.amounts = amounts;
    this.seated = stack !== null && amounts[0] > 0;
    this.root.hidden = !this.seated || this.trayGone;
    this.buttons.forEach((b, i) => {
      b.firstChild!.textContent = formatMoney(amounts[i]!);
      b.disabled = stack === null || stack < amounts[i]!;
      b.title = `Tip the dealer ${formatMoney(amounts[i]!)} from your chips (${i === 0 ? 'K' : 'Shift K'})`;
    });
  }

  /**
   * Keep to the tray: just over its right end, wherever the window's size put it, slid left along
   * it past a panel in the way (a game's meters beside the tray) or, with no room left, raised
   * over that panel. A tray the view has hidden (a hand being played, a decision up) takes the
   * panel with it. Its own element, so the board fit (fit.ts) keeps the table clear of it. (The
   * chat keeps out of the way itself: it rises over whatever is under it.)
   */
  place(): void {
    if (!this.seated) return;
    const tray = this.parent.querySelector<HTMLElement>('.tray');
    const r = tray?.getBoundingClientRect();
    this.trayGone = !!r && r.width === 0;
    this.root.hidden = this.trayGone;
    if (!r || this.trayGone) {
      this.root.style.right = this.root.style.bottom = '';
      return;
    }
    const w = this.root.offsetWidth;
    const h = this.root.offsetHeight;
    const others: DOMRect[] = [];
    for (const e of this.parent.querySelectorAll<HTMLElement>('.panel')) {
      if (e === this.root || tray!.contains(e) || e.closest('.chat')) continue;
      const o = e.getBoundingClientRect();
      if (o.width > 0 && o.height > 0) others.push(o);
    }
    let right = r.right;
    let bottom = r.top - GAP;
    for (let n = 0; n < 8; n++) {
      const hit = others.find((o) => o.left < right && right - w < o.right && o.top < bottom && bottom - h < o.bottom);
      if (!hit) break;
      if (hit.left - GAP - w >= r.left) right = hit.left - GAP;
      else bottom = hit.top - GAP;
    }
    this.root.style.right = `${Math.round(Math.max(8, innerWidth - right))}px`;
    this.root.style.bottom = `${Math.round(innerHeight - bottom)}px`;
  }

  dispose(): void {
    removeEventListener('keydown', this.onKey);
    this.root.remove();
  }

  private button(i: 0 | 1, key: string): HTMLButtonElement {
    const b = el('button', 'btn ghost');
    b.type = 'button';
    b.append(document.createTextNode(''), el('span', 'key', key));
    b.addEventListener('click', () => this.tip(i));
    return b;
  }

  private tip(i: 0 | 1): void {
    // K still asks while a hand is on (the table says to wait for it); not when there's no seat
    if (!this.seated || this.buttons[i].disabled) return;
    this.send(this.amounts[i]);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyK' || e.repeat || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (overlayCount() > 0 || isTyping(e)) return;
    e.preventDefault();
    this.tip(e.shiftKey ? 1 : 0);
  };
}

/** What the dealer says to a tip: to you, or about someone else at the table. */
export function thanks(name: string, mine: boolean): string {
  if (mine) return 'Thank you. Good luck.';
  return `Thank you for the tip, ${name}.`;
}
