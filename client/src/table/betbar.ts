// The bet bar every card table shares: the kit's chip tray (ui/kit.ts) with what a player needs to
// read off it at a glance. Each chip shows its number key; Undo, Clear, Rebet and x2 go dim when
// they have nothing to do (no bet down, no last round to repeat) instead of answering a press with
// nothing; and the table puts the bet itself on the primary button ("Deal $125"), which with
// nothing down deals last round's bets again in one press. The tray's look (betbar.css) reaches
// every table's tray, the wheels' and the dice games' too.

import './betbar.css';
import { BETTING_CHIPS, formatMoney, type Cents } from '../../../shared/src/money.ts';
import { ChipTray, el } from '../ui/kit.ts';

type Handlers = ConstructorParameters<typeof ChipTray>[0];
type Act = 'undo' | 'clear' | 'rebet' | 'double';
const ACTS: readonly Act[] = ['undo', 'clear', 'rebet', 'double'];

export class BetBar extends ChipTray {
  private readonly acts = new Map<Act, HTMLButtonElement>();
  private readonly keys = new Map<number, HTMLElement>();

  constructor(handlers: Handlers) {
    super(handlers);
    this.root.classList.add('bet-bar');
    // the tray builds its buttons in this order, each one the table asked for
    const buttons = [...this.root.querySelectorAll<HTMLButtonElement>('.acts .btn')];
    for (const a of ACTS) if (handlers[a]) this.acts.set(a, buttons.shift()!);
    // each chip's number key, under it (touch screens hide keys)
    this.root.querySelectorAll<HTMLButtonElement>('.chip-btn').forEach((b, i) => {
      const k = el('span', 'chip-key');
      k.setAttribute('aria-hidden', 'true');
      b.append(k);
      this.keys.set(BETTING_CHIPS[i]!.value, k);
    });
    this.number();
  }

  override setChipMax(max: Cents, min = 0): void {
    super.setChipMax(max, min);
    this.number();
  }

  /** Which of Undo, Clear, Rebet and x2 have something to do now (the rest go dim). */
  setActs(on: Partial<Record<Act, boolean>>): void {
    for (const [a, b] of this.acts) if (on[a] !== undefined) b.disabled = !on[a];
  }

  /**
   * The primary button with the bet on it: "Deal $125" with chips down, "Deal $125" too with none
   * down but last round's to repeat (the table deals it again in one press), "Deal" (dim) when
   * there's nothing to deal.
   */
  setDeal(word: string, down: Cents, again: Cents, ok: boolean): void {
    const amount = down > 0 ? down : again;
    this.setPrimary(amount > 0 ? `${word} ${formatMoney(amount)}` : word, ok);
  }

  /** The keys follow the chips on show: 1 for the first, 0 for a tenth. */
  private number(): void {
    let n = 0;
    for (const spec of BETTING_CHIPS) {
      const k = this.keys.get(spec.value);
      const b = k?.parentElement;
      if (!k || !b) continue;
      if (b.hidden) continue;
      n++;
      k.textContent = n > 9 ? (n === 10 ? '0' : '') : String(n);
    }
  }
}
