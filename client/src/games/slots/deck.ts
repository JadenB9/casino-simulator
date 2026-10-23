// What every slot machine puts over the screen, the same at all seven (view.ts and play.ts drive
// it): the button deck along the bottom (Insert, Pays, the coin value, the bet with − and +, Max
// bet, Auto and Spin), the feature banner, the count-up meter that counts a big win in under the
// celebration and says when it can be cut short, and the session: what you've bet and been paid
// at this machine since you sat down.
//
// The deck's children keep one order, which slots.css lays out per screen by position: insert,
// pays, sep, coin, down, bet, up, max, sep, auto, spin, net.

import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { el, button } from '../../ui/kit.ts';
import { wait } from '../../table/tween.ts';
import { mountAutoDeck, type AutoDeck } from './autodeck.ts';
import type { SpinFn } from './auto.ts';
import { timesBet } from './moments.ts';

export interface DeckOpts {
  ui: HTMLElement;
  canvas: HTMLElement;
  /** A 3-reel machine bets coins (1 to 3); a 5-reel one credits per line on every line. */
  stepper: boolean;
  lines: number;
  insert(): void;
  pays(): void;
  nextCoin(): void;
  /** One coin (or credit per line) more or less. */
  step(dir: 1 | -1): void;
  max(): void;
  /** The session's breakdown opened or closed from the deck (an upright screen). */
  session(): void;
  spin: SpinFn;
  bet(): Cents;
  seated(): boolean;
  say(text: string): void;
  changed(): void;
}

export interface Deck {
  root: HTMLElement;
  insertBtn: HTMLButtonElement;
  paysBtn: HTMLButtonElement;
  coinBtn: HTMLButtonElement;
  downBtn: HTMLButtonElement;
  upBtn: HTMLButtonElement;
  maxBtn: HTMLButtonElement;
  netBtn: HTMLButtonElement;
  auto: AutoDeck;
  spinBtn: HTMLButtonElement;
  /** Show the bet: coins (or credits per line), the coin's value and the total. */
  showBet(coins: number, coin: string, total: Cents): void;
  dispose(): void;
}

export function mountDeck(o: DeckOpts): Deck {
  const root = el('div', 'slots-deck panel');
  const paysBtn = button('Pays', () => o.pays(), { key: 'I', cls: 'ghost slots-pays-btn' });
  paysBtn.setAttribute('aria-haspopup', 'dialog');
  const coinBtn = button('', () => o.nextCoin(), { key: 'C', title: 'Coin value (C, Shift+C or ← → to step)' });
  coinBtn.classList.add('slots-coin');
  const less = o.stepper ? 'One coin less' : 'One credit less on each line';
  const more = o.stepper ? 'One coin more' : 'One credit more on each line';
  const downBtn = button('−', () => o.step(-1), { key: '↓', title: `${less} (↓)` });
  downBtn.setAttribute('aria-label', less);
  downBtn.classList.add('slots-step');
  const upBtn = button('+', () => o.step(1), { key: '↑', title: `${more} (↑)` });
  upBtn.setAttribute('aria-label', more);
  upBtn.classList.add('slots-step');
  // the bet: what you're betting over the total, which is the number that matters
  const bet = el('div', 'slots-bet');
  const betWhat = el('span', 'slots-bet-what');
  const betAmount = el('span', 'slots-bet-amount');
  bet.append(betWhat, betAmount);
  bet.setAttribute('aria-live', 'polite');
  const maxBtn = button('Max bet', () => o.max(), { key: 'A', title: o.stepper ? 'Bet three coins (A)' : 'Bet the most on every line (A)' });
  const insertBtn = button('Insert', () => o.insert(), { cls: 'ghost', title: 'Add money to this machine' });
  const netBtn = button('', () => o.session(), { cls: 'ghost slots-net', title: 'This session: spins, time, bet, paid and the best win' });
  netBtn.setAttribute('aria-haspopup', 'dialog');
  netBtn.setAttribute('aria-expanded', 'false');
  // Spin (tap for one, hold to keep going) and Auto: each next spin only once the last has settled
  const auto = mountAutoDeck({ spin: o.spin, deck: root, canvas: o.canvas, ui: o.ui, bet: o.bet, seated: o.seated, say: o.say, changed: o.changed });
  const sep = () => el('div', 'sep');
  root.append(insertBtn, paysBtn, sep(), coinBtn, downBtn, bet, upBtn, maxBtn, sep(), auto.autoBtn, auto.spinBtn, netBtn);
  o.ui.append(root);
  // a video machine plays every line: the deck says how many (a narrow screen keeps it short)
  const lines = o.stepper ? null : el('span', 'slots-bet-lines', ` · ${o.lines} lines`);
  return {
    root,
    insertBtn,
    paysBtn,
    coinBtn,
    downBtn,
    upBtn,
    maxBtn,
    netBtn,
    auto,
    spinBtn: auto.spinBtn,
    showBet(coins, coin, total) {
      coinBtn.firstChild!.textContent = `Coin ${coin}`;
      if (lines) betWhat.replaceChildren(`${coins} per line`, lines);
      else betWhat.textContent = `${coins} coin${coins > 1 ? 's' : ''}`;
      betAmount.textContent = formatMoney(total);
    },
    dispose() {
      auto.dispose();
      root.remove();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// the feature banner ("Free games", "Cherry Wheel", "Blowdown")

export class Banner {
  readonly root: HTMLElement;
  private readonly tier = el('div', 'tier');
  private readonly amount = el('div', 'amount');
  private gen = 0;

  constructor(ui: HTMLElement, cls: string) {
    this.root = el('div', cls);
    this.root.hidden = true;
    this.root.append(this.tier, this.amount);
    ui.append(this.root);
  }

  show(tier: string, amount: string, cls?: string): void {
    this.gen++;
    if (cls) this.root.className = cls;
    this.root.classList.remove('out');
    this.tier.textContent = tier;
    this.amount.textContent = amount;
    this.root.hidden = false;
  }

  /** Fade out, then hide (a fade, not a vanish; the next show() takes it back at once). */
  hide(): void {
    if (this.root.hidden) return;
    const g = ++this.gen;
    this.root.classList.add('out');
    void wait(240).then(() => {
      if (g !== this.gen) return;
      this.root.hidden = true;
      this.root.classList.remove('out');
    });
  }

  /** Gone at once (a fresh picture of the machine). */
  clear(): void {
    this.gen++;
    this.root.hidden = true;
    this.root.classList.remove('out');
  }
}

// ---------------------------------------------------------------------------------------------
// the count-up meter under the celebration banner: the win climbing, and how many bets it is

const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export class CountUp {
  readonly root: HTMLElement;
  private readonly label = el('div', 'label', 'Win');
  private readonly amount = el('div', 'amount');
  private readonly times = el('div', 'times');
  private readonly hint = el('div', 'skip');
  private shown = '';

  constructor(ui: HTMLElement, cls: string) {
    this.root = el('div', cls);
    this.root.hidden = true;
    this.hint.hidden = true;
    this.root.append(this.label, this.amount, this.times, this.hint);
    ui.append(this.root);
  }

  /** The meter at `win` of a `bet` (written only when what it reads changes). */
  show(label: string, win: Cents, bet: Cents): void {
    const amount = formatMoney(win);
    const key = `${label}|${amount}`;
    this.root.hidden = false;
    if (key === this.shown) return;
    this.shown = key;
    this.label.textContent = label;
    this.amount.textContent = amount;
    this.times.textContent = win >= bet ? timesBet(win, bet) : '';
  }

  /** It can be cut short now (Space, a click, a tap): say so; false takes the hint away. */
  skippable(on: boolean): void {
    if (on) this.hint.textContent = coarse() ? 'Tap to skip' : 'Space or click to skip';
    this.hint.hidden = !on;
  }

  /** The count has landed on its total: a small pop on the amount (none while calm, slots.css). */
  landed(): void {
    this.root.classList.remove('landed');
    void this.root.offsetWidth;
    this.root.classList.add('landed');
    this.skippable(false);
  }

  hide(): void {
    this.root.hidden = true;
    this.root.classList.remove('landed');
    this.hint.hidden = true;
    this.shown = '';
  }
}

/** The big win's count: quick off the mark and slowing into the total, the way a meter lands. */
export const countEase = (k: number): number => 1 - (1 - k) * (1 - k);

// ---------------------------------------------------------------------------------------------
// the session: what this sitting at the machine has come to

export class SessionLog {
  spins = 0;
  bet: Cents = 0;
  paid: Cents = 0;
  best: Cents = 0;
  bestBet: Cents = 0;
  readonly since = performance.now();

  add(bet: Cents, win: Cents): void {
    this.spins++;
    this.bet += bet;
    this.paid += win;
    if (win > this.best) {
      this.best = win;
      this.bestBet = bet;
    }
  }

  get net(): Cents {
    return this.paid - this.bet;
  }
}

/** "4:07", "1:02:45": time at the machine. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The net in the deck's words: "+$4.50", "−$1.25", "$0.00". */
export function netText(net: Cents): string {
  return net === 0 ? formatMoney(0) : formatMoney(net, { sign: true });
}

/**
 * The session readout: a small panel at the top right on a wide screen (always there), and on an
 * upright one the net in the deck, its button opening the same panel just over the deck.
 */
export class SessionPanel {
  readonly root = el('div', 'slots-session panel');
  private readonly rows: Record<'spins' | 'bet' | 'paid' | 'net' | 'best', HTMLElement>;
  private readonly time = el('span', 'money');
  private shownTime = '';
  private outside: ((e: PointerEvent) => void) | null = null;

  constructor(
    ui: HTMLElement,
    private readonly log: SessionLog,
    private readonly deck: Deck,
  ) {
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', 'This session at the machine');
    this.root.append(el('div', 'slots-session-head', 'This session'));
    const row = (label: string, value: HTMLElement, cls = '') => {
      const r = el('div', `slots-session-row ${cls}`.trim());
      r.append(el('span', '', label), value);
      this.root.append(r);
      return value;
    };
    row('Time', this.time);
    this.rows = {
      spins: row('Spins', el('span', 'money')),
      bet: row('Bet', el('span', 'money')),
      paid: row('Paid', el('span', 'money')),
      net: row('Net', el('span', 'money'), 'net'),
      best: row('Best win', el('span', 'money')),
    };
    ui.append(this.root);
    this.refresh();
    this.tick();
  }

  /** After a spin: write what changed. */
  refresh(): void {
    const s = this.log;
    this.rows.spins.textContent = String(s.spins);
    this.rows.bet.textContent = formatMoney(s.bet);
    this.rows.paid.textContent = formatMoney(s.paid);
    this.rows.net.textContent = netText(s.net);
    this.rows.net.parentElement!.classList.toggle('up', s.net > 0);
    // the best win, and how many bets it was when it beat its bet
    this.rows.best.textContent = s.best > 0 ? `${formatMoney(s.best)}${s.best > s.bestBet ? ` · ${Math.floor(s.best / s.bestBet)}x` : ''}` : '–';
    const btn = this.deck.netBtn;
    btn.replaceChildren(el('span', 'slots-net-label', 'Net'), el('span', 'slots-net-value', netText(s.net)));
    btn.setAttribute('aria-label', `Session: net ${netText(s.net)} after ${s.spins} spin${s.spins === 1 ? '' : 's'}`);
  }

  /** Once a frame: the clock, written only when its second changes. */
  tick(): void {
    const t = clock(performance.now() - this.log.since);
    if (t === this.shownTime) return;
    this.shownTime = t;
    this.time.textContent = t;
  }

  get open(): boolean {
    return this.root.classList.contains('open');
  }

  /** On an upright screen, from the deck's Net: the panel just over the deck. */
  toggle(): void {
    if (this.open) {
      this.close();
      return;
    }
    const d = this.deck.root.getBoundingClientRect();
    this.root.style.bottom = `${Math.round(innerHeight - d.top + 10)}px`;
    this.root.classList.add('open');
    this.deck.netBtn.setAttribute('aria-expanded', 'true');
    this.outside = (e) => {
      const t = e.target as Node;
      if (!this.root.contains(t) && !this.deck.netBtn.contains(t)) this.close();
    };
    addEventListener('pointerdown', this.outside, true);
  }

  close(): void {
    this.root.classList.remove('open');
    this.root.style.bottom = '';
    this.deck.netBtn.setAttribute('aria-expanded', 'false');
    if (this.outside) removeEventListener('pointerdown', this.outside, true);
    this.outside = null;
  }

  dispose(): void {
    this.close();
    this.root.remove();
  }
}
