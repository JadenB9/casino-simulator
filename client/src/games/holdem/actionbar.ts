// The action bar under the table: Fold, Check or Call, Bet or Raise with a slider and pot-size
// presets, All-in. Keys: F fold, C check/call, R or Enter bet/raise the slider amount, A all-in
// (press twice), Q W E set a third of the pot, half the pot, the pot; arrows nudge the slider.
// Every amount is a street total, the same as the engine's `raise.to`.

import { el } from '../../ui/kit.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import type { HoldemAction, HoldemLegalView } from '../../../../shared/src/games/holdem/protocol.ts';

const PRESETS: { key: string; label: string; frac: number }[] = [
  { key: 'Q', label: '⅓ pot', frac: 1 / 3 },
  { key: 'W', label: '½ pot', frac: 1 / 2 },
  { key: 'E', label: 'Pot', frac: 1 },
];

function keyed(label: string, key: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', `btn ${cls}`);
  b.type = 'button';
  const text = el('span', 'he-btn-text', label);
  b.append(text, el('span', 'key', key));
  b.addEventListener('click', onClick);
  return b;
}

export class ActionBar {
  readonly root = el('div', 'he-bar panel');
  private readonly note = el('div', 'he-bar-note');
  private readonly clock = el('div', 'he-bar-clock money');
  private readonly fold: HTMLButtonElement;
  private readonly call: HTMLButtonElement;
  private readonly raise: HTMLButtonElement;
  private readonly allin: HTMLButtonElement;
  private readonly presets: HTMLButtonElement[] = [];
  private readonly slider = el('input', 'he-slider');
  private readonly amountBox = el('input', 'he-amount money');
  private readonly sizing = el('div', 'he-sizing');
  private readonly acts = el('div', 'he-acts');
  private readonly back: HTMLButtonElement;
  private legal: HoldemLegalView | null = null;
  private total: Cents = 0;
  private amount: Cents = 0;
  private armed = 0;

  constructor(
    private readonly send: (a: HoldemAction) => void,
    private readonly sitout: (on: boolean) => void,
  ) {
    this.fold = keyed('Fold', 'F', 'he-fold', () => this.doFold());
    this.call = keyed('Check', 'C', 'he-call', () => this.doCall());
    this.raise = keyed('Raise', 'R', 'primary he-raise', () => this.doRaise());
    this.allin = keyed('All-in', 'A', 'he-allin', () => this.doAllIn());
    for (const p of PRESETS) {
      const b = keyed(p.label, p.key, 'ghost he-preset', () => this.preset(p.frac));
      this.presets.push(b);
    }
    this.slider.type = 'range';
    this.slider.addEventListener('input', () => this.setAmount(Number(this.slider.value)));
    this.slider.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.nudge(e.deltaY < 0 ? 1 : -1);
    });
    this.amountBox.type = 'number';
    this.amountBox.step = '1';
    this.amountBox.addEventListener('change', () => this.setAmount(Math.round(Number(this.amountBox.value)) * 100));
    this.amountBox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.setAmount(Math.round(Number(this.amountBox.value)) * 100);
        this.doRaise();
      }
    });
    this.back = keyed("I'm back", 'B', 'primary he-back', () => this.sitout(false));
    const dollar = el('span', 'he-dollar', '$');
    const amountWrap = el('label', 'he-amount-wrap');
    amountWrap.append(dollar, this.amountBox);
    this.sizing.append(...this.presets, this.slider, amountWrap);
    this.acts.append(this.fold, this.call, this.raise, this.allin);
    const head = el('div', 'he-bar-head');
    head.append(this.note, this.clock);
    this.root.append(head, this.sizing, this.acts, this.back);
    this.set(null, { total: 0, note: '', sittingOut: false });
  }

  /** Show the choices for this turn, or a status line when it isn't the player's turn. */
  set(legal: HoldemLegalView | null, info: { total: Cents; note: string; sittingOut: boolean }): void {
    const fresh = JSON.stringify(legal) !== JSON.stringify(this.legal);
    this.legal = legal;
    this.total = info.total;
    this.note.textContent = info.note;
    this.back.hidden = !info.sittingOut;
    this.root.classList.toggle('he-live', !!legal);
    this.root.classList.toggle('he-idle', !legal);
    this.sizing.hidden = !legal || (!legal.bet && !legal.raise);
    this.acts.hidden = !legal;
    if (!legal) {
      this.clock.textContent = '';
      this.armed = 0;
      return;
    }
    this.fold.disabled = !legal.fold;
    this.call.disabled = false;
    this.fold.title = legal.fold ? '' : 'Checking is free';
    this.label(this.call, legal.check ? 'Check' : legal.callAllIn ? `Call all-in ${formatMoney(legal.call)}` : `Call ${formatMoney(legal.call)}`);
    const range = legal.bet ?? legal.raise;
    this.raise.disabled = !range;
    this.allin.disabled = legal.behind === 0 || (!range && legal.call === 0);
    this.label(this.allin, `All-in ${formatMoney(legal.street + legal.behind)}`);
    if (range) {
      this.slider.min = String(range.min);
      this.slider.max = String(range.max);
      this.slider.step = String(legal.step);
      this.slider.disabled = range.min >= range.max;
      this.amountBox.min = String(Math.floor(range.min / 100));
      this.amountBox.max = String(Math.floor(range.max / 100));
      for (const p of this.presets) p.disabled = range.min >= range.max;
      if (fresh) this.setAmount(range.min);
    } else if (!legal.call && !legal.check) this.allin.disabled = true;
    if (fresh) {
      this.armed = 0;
      this.allin.classList.remove('he-armed');
    }
  }

  /** After sending a move: nothing more can be sent until the table answers with the next view. */
  lock(): void {
    this.legal = null;
    this.armed = 0;
    this.allin.classList.remove('he-armed');
    for (const b of [this.fold, this.call, this.raise, this.allin, ...this.presets]) b.disabled = true;
    this.slider.disabled = true;
  }

  /** Countdown text for the player's own turn. */
  setClock(ms: number | null, bank: boolean): void {
    if (ms === null || !this.legal) {
      this.clock.textContent = '';
      this.clock.classList.remove('he-bank');
      return;
    }
    const s = Math.ceil(ms / 1000);
    this.clock.textContent = `${bank ? 'Time bank ' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.clock.classList.toggle('he-bank', bank);
  }

  private label(b: HTMLButtonElement, text: string): void {
    b.querySelector('.he-btn-text')!.textContent = text;
  }

  private setAmount(to: Cents): void {
    const l = this.legal;
    const range = l?.bet ?? l?.raise;
    if (!l || !range) return;
    let v = Number.isFinite(to) ? to : range.min;
    if (v < range.max) v = Math.ceil(v / l.step) * l.step;
    v = Math.max(range.min, Math.min(range.max, v));
    this.amount = v;
    this.slider.value = String(v);
    this.amountBox.value = String(v % 100 === 0 ? v / 100 : (v / 100).toFixed(2));
    const verb = l.bet ? 'Bet' : 'Raise to';
    this.label(this.raise, v >= range.max ? `All-in ${formatMoney(v)}` : `${verb} ${formatMoney(v)}`);
  }

  /** A fraction of the pot: a bet of that size, or a raise of that size over a call. */
  private preset(frac: number): void {
    const l = this.legal;
    if (!l) return;
    const pot = this.total + l.call;
    const to = l.bet ? frac * this.total : l.street + l.call + frac * pot;
    this.setAmount(Math.round(to));
  }

  private nudge(dir: number): void {
    const l = this.legal;
    if (!l || !(l.bet ?? l.raise)) return;
    this.setAmount(this.amount + dir * Math.max(l.step, Math.round(this.total / 20 / l.step) * l.step || l.step));
  }

  private doFold(): void {
    if (this.legal?.fold) this.send({ type: 'fold' });
  }

  private doCall(): void {
    const l = this.legal;
    if (!l) return;
    this.send(l.check ? { type: 'check' } : { type: 'call' });
  }

  private doRaise(): void {
    const l = this.legal;
    const range = l?.bet ?? l?.raise;
    if (!l || !range) return;
    if (this.amount >= range.max) this.send({ type: 'allin' });
    else this.send(l.bet ? { type: 'bet', amount: this.amount } : { type: 'raise', to: this.amount });
  }

  /** All-in asks twice: the first press arms the button for three seconds. */
  private doAllIn(): void {
    if (!this.legal || this.allin.disabled) return;
    const now = performance.now();
    if (now - this.armed < 3000) {
      this.armed = 0;
      this.allin.classList.remove('he-armed');
      this.send({ type: 'allin' });
      return;
    }
    this.armed = now;
    this.label(this.allin, 'Confirm all-in');
    this.allin.classList.add('he-armed');
    setTimeout(() => {
      if (this.armed === now) {
        this.armed = 0;
        this.allin.classList.remove('he-armed');
        if (this.legal) this.label(this.allin, `All-in ${formatMoney(this.legal.street + this.legal.behind)}`);
      }
    }, 3000);
  }

  key(e: KeyboardEvent): boolean {
    const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    if (k === 'B' && !this.back.hidden) {
      this.sitout(false);
      return true;
    }
    if (!this.legal) return false;
    switch (k) {
      case 'F':
        this.doFold();
        return true;
      case 'C':
        this.doCall();
        return true;
      case 'R':
      case 'Enter':
        this.doRaise();
        return true;
      case 'A':
        this.doAllIn();
        return true;
      case 'ArrowUp':
      case 'ArrowRight':
        this.nudge(1);
        return true;
      case 'ArrowDown':
      case 'ArrowLeft':
        this.nudge(-1);
        return true;
    }
    const p = PRESETS.find((x) => x.key === k);
    if (p) {
      this.preset(p.frac);
      return true;
    }
    return false;
  }
}
