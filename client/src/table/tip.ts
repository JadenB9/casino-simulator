// Tipping the dealer at every table with one (shared/src/tip.ts): a small panel with the table
// minimum and twice it, K and ⇧K. It shows while you're seated, over the right end of the table's
// bar (the dock, dock.ts, puts it there before it's ever drawn: placed a frame late, it used to
// show over Deal first), and away with the chip tray while a hand is being decided; the chips come
// off your stack once the table has taken them, and the dealer thanks whoever tipped.

import './tip.css';
import { formatMoney, type Cents } from '../../../shared/src/money.ts';
import { el } from '../ui/kit.ts';
import { isTyping, overlayCount } from '../ui/keyboard.ts';

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
   * A tray the view has hidden (a hand being played, a decision up) takes the panel with it. Where
   * it sits is the dock's (dock.ts): over the right end of whatever bar is showing, clear of the
   * panels beside it, at any window size. (The chat keeps out of the way itself: it rises over
   * whatever is under it.)
   */
  place(): void {
    if (!this.seated) return;
    const tray = this.parent.querySelector<HTMLElement>('.tray');
    this.trayGone = !!tray && tray.offsetWidth === 0;
    this.root.hidden = this.trayGone;
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
