// "Hands 1 2 3": how many spots a solo player plays at the tables that deal each player a hand of
// their own (blackjack, Three Card Poker, Casino War). A small panel just above the chip tray,
// shown while bets can go down at a solo table; the table keeps the choice from round to round
// (games/spots.ts), and this only shows it and asks for a change.

import { el } from '../../ui/kit.ts';
import './multihand.css';

export class SpotPicker {
  readonly root = el('div', 'mh-picker panel');
  private readonly buttons: HTMLButtonElement[] = [];
  private current = 1;

  constructor(max: number, onPick: (n: number) => void, word = 'Hands') {
    const seg = el('div', 'mh-seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', `${word} to play`);
    for (let n = 1; n <= max; n++) {
      const b = el('button', 'mh-n', String(n));
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.title = n === 1 ? 'Play one hand' : `Play ${n} hands at once`;
      b.addEventListener('click', () => {
        if (n !== this.current) onPick(n);
      });
      this.buttons.push(b);
      seg.append(b);
    }
    this.root.append(el('span', 'mh-word', word), seg);
    this.root.hidden = true;
    this.set(1);
  }

  /** Show the table's count. */
  set(n: number): void {
    this.current = n;
    this.buttons.forEach((b, i) => b.setAttribute('aria-checked', String(i + 1 === n)));
  }

  /** While bets can go down at a solo table (a shared table plays one spot each). */
  show(on: boolean): void {
    this.root.hidden = !on;
  }
}
