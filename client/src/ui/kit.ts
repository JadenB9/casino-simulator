// Shared DOM pieces for every table: the chip tray, bet buttons, the buy-in panel, result pills,
// the dealer's call line, toasts and modals. Built with elements, classes and textContent only:
// the page's CSP blocks inline style attributes and injected <style> tags.

import * as THREE from 'three';
import { BETTING_CHIPS, formatMoney, type Cents, type ChipSpec } from '../../../shared/src/money.ts';
import { REFILL_BELOW, REFILL_TO } from '../../../shared/src/bank.ts';
import { holdKeyboard } from './keyboard.ts';
import { chipTrayCanvases } from '../table/chips.ts';
import type { TableStage } from '../table/stage.ts';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function button(label: string, onClick: () => void, opts: { cls?: string; key?: string; title?: string } = {}): HTMLButtonElement {
  const b = el('button', `btn ${opts.cls ?? ''}`.trim());
  b.type = 'button';
  b.append(document.createTextNode(label));
  if (opts.key) b.append(el('span', 'key', opts.key));
  if (opts.title) b.title = opts.title;
  b.addEventListener('click', onClick);
  return b;
}

let toastBox: HTMLElement | null = null;

export function toast(msg: string, kind: 'info' | 'err' = 'info', ms = 3200): void {
  if (!toastBox) {
    toastBox = el('div', 'toasts pass');
    document.getElementById('ui')!.append(toastBox);
  }
  const t = el('div', `toast panel ${kind === 'err' ? 'err' : ''}`, msg);
  t.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  toastBox.append(t);
  setTimeout(() => t.remove(), ms);
}

/**
 * A dialog over the game. It holds the keyboard while it's up (ui/keyboard.ts): Esc calls
 * `onEscape`, and no key reaches the floor or the table behind it.
 */
export function modal(title: string, body: (HTMLElement | string)[], actions: HTMLButtonElement[], onEscape: () => void = () => {}): { close: () => void; root: HTMLElement } {
  const scrim = el('div', 'scrim');
  const box = el('div', 'modal panel');
  box.setAttribute('role', 'dialog');
  box.append(el('h2', '', title));
  for (const b of body) box.append(typeof b === 'string' ? el('p', '', b) : b);
  const row = el('div', 'row');
  row.append(...actions);
  box.append(row);
  scrim.append(box);
  document.getElementById('ui')!.append(scrim);
  const release = holdKeyboard(box, onEscape);
  (box.querySelector<HTMLElement>('input, .btn.primary') ?? actions[0] ?? box).focus({ preventScroll: true });
  const close = () => {
    release();
    scrim.remove();
  };
  return { close, root: box };
}

/** Ask how much to bring to the table. Resolves with cents, or null if cancelled. */
export function askBuyIn(opts: { min: Cents; max: Cents; balance: Cents; suggested?: Cents; verb?: string }, signal?: AbortSignal): Promise<Cents | null> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(null);
    const max = Math.min(opts.max, Math.floor(opts.balance / 100) * 100);
    const note = el('p', '', `Balance ${formatMoney(opts.balance)}. This table takes ${formatMoney(opts.min)} to ${formatMoney(opts.max)}.`);
    let m: { close: () => void };
    const done = (v: Cents | null) => {
      signal?.removeEventListener('abort', cancel);
      m.close();
      resolve(v);
    };
    // The table this was asked for has gone (left, closed): take the question away with it.
    const cancel = () => done(null);
    signal?.addEventListener('abort', cancel);
    const dismiss = () => done(null);
    if (max < opts.min) {
      const loan = el('p', '', `Under ${formatMoney(REFILL_BELOW)} in all, chips on tables included? The cashier tops you up to ${formatMoney(REFILL_TO)}.`);
      m = modal('Not enough to sit down', [note, loan], [button('Close', dismiss)], dismiss);
      return;
    }
    const picks = [opts.min, opts.min * 5, opts.min * 20, max].filter((v, i, a) => v >= opts.min && v <= max && a.indexOf(v) === i);
    const input = el('input');
    input.type = 'number';
    input.min = String(opts.min / 100);
    input.max = String(max / 100);
    input.step = '1';
    input.value = String(Math.min(max, opts.suggested ?? picks[1] ?? opts.min) / 100);
    const quick = el('div', 'row');
    // the last pick is everything you have when the table would take more
    const all = max < opts.max;
    for (const v of picks) quick.append(button(all && v === max ? `All ${formatMoney(v)}` : formatMoney(v), () => (input.value = String(v / 100)), { cls: 'ghost' }));
    const ok = button(opts.verb ?? 'Buy in', () => {
      const v = Math.round(Number(input.value)) * 100;
      if (!Number.isFinite(v) || v < opts.min || v > max) {
        toast(`Choose between ${formatMoney(opts.min)} and ${formatMoney(max)}.`, 'err');
        return;
      }
      done(v);
    }, { cls: 'primary' });
    m = modal('Buy in', [note, quick, input], [ok, button('Cancel', dismiss, { cls: 'ghost' })], dismiss);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') ok.click();
    });
  });
}

/**
 * The tray's Max. 'bet': at a table with one main bet (blackjack, war), a press puts the most
 * that bet takes, or all your chips, down at once. 'pick': at a layout of many spots, Max is
 * picked like a chip and every spot clicked while it is gets the most it takes.
 */
export type TrayMax = { mode: 'bet'; run: () => void } | { mode: 'pick' };

/**
 * The Max button every table shares: gold, with its M key. A tray builds its own; a game with
 * its own bet panel can use this for the same look.
 */
export function maxButton(onClick: () => void, title = 'Max: the most this bet takes, or all your chips if that is less (M)'): HTMLButtonElement {
  const b = el('button', 'btn max-btn');
  b.type = 'button';
  b.title = title;
  b.append(document.createTextNode('Max'), el('span', 'key', 'M'));
  b.addEventListener('click', onClick);
  return b;
}

/** The chip tray: pick a denomination (keys 1-9 and 0), plus Undo / Clear / Rebet / x2, Max and a primary action. */
export class ChipTray {
  readonly root = el('div', 'tray panel');
  private buttons = new Map<number, HTMLButtonElement>();
  selected: ChipSpec = BETTING_CHIPS[1]!;
  private primaryBtn: HTMLButtonElement;
  /** The Max button, when the table has one. */
  readonly maxBtn: HTMLButtonElement | null = null;
  private readonly maxMode: TrayMax | null;
  private maxOn = false;

  constructor(handlers: {
    undo?: () => void;
    clear?: () => void;
    rebet?: () => void;
    double?: () => void;
    primary?: { label: string; key?: string; run: () => void };
    max?: TrayMax;
  }) {
    const chips = el('div', 'chips');
    chipTrayCanvases().forEach(({ spec, canvas }, i) => {
      const b = el('button', 'chip-btn');
      b.type = 'button';
      b.title = `${formatMoney(spec.value)} chip (${i + 1})`;
      canvas.className = 'chip-canvas';
      b.append(canvas);
      b.addEventListener('click', () => this.select(spec));
      this.buttons.set(spec.value, b);
      chips.append(b);
    });
    this.maxMode = handlers.max ?? null;
    if (this.maxMode) {
      const mode = this.maxMode;
      this.maxBtn = mode.mode === 'bet'
        ? maxButton(() => mode.run())
        : maxButton(() => this.pickMax(), 'Max: pick it, then click a spot to bet the most it takes, or all your chips if that is less (M)');
      chips.append(this.maxBtn);
    }
    const acts = el('div', 'acts');
    if (handlers.undo) acts.append(button('Undo', handlers.undo, { key: '⌫' }));
    if (handlers.clear) acts.append(button('Clear', handlers.clear, { key: 'X' }));
    if (handlers.rebet) acts.append(button('Rebet', handlers.rebet, { key: 'R' }));
    if (handlers.double) acts.append(button('×2', handlers.double, { key: '⇧R' }));
    this.primaryBtn = button(handlers.primary?.label ?? '', handlers.primary?.run ?? (() => {}), { cls: 'primary', key: handlers.primary?.key ?? 'Space' });
    if (!handlers.primary) this.primaryBtn.hidden = true;
    this.root.append(chips, el('div', 'sep'), acts, this.primaryBtn);
    this.select(this.selected);
  }

  select(spec: ChipSpec): void {
    this.selected = spec;
    this.maxOn = false;
    for (const [v, b] of this.buttons) b.setAttribute('aria-pressed', String(v === spec.value));
    if (this.maxMode?.mode === 'pick') this.maxBtn!.setAttribute('aria-pressed', 'false');
  }

  /** A 'pick' Max is the current choice: a click on a spot bets the most it takes. */
  get maxPicked(): boolean {
    return this.maxOn;
  }

  /** Pick Max (in 'pick' mode) in place of a chip. */
  pickMax(): void {
    if (this.maxMode?.mode !== 'pick') return;
    this.maxOn = true;
    for (const b of this.buttons.values()) b.setAttribute('aria-pressed', 'false');
    this.maxBtn!.setAttribute('aria-pressed', 'true');
  }

  /**
   * The table's largest bet: chips above it go back in the rack (the smallest always stays), and a
   * picked chip that went moves to the largest one left.
   */
  setChipMax(max: Cents): void {
    let largest: ChipSpec | null = null;
    for (const spec of BETTING_CHIPS) {
      const hide = spec.value > max && spec !== BETTING_CHIPS[0];
      this.buttons.get(spec.value)!.hidden = hide;
      if (!hide) largest = spec;
    }
    if (this.buttons.get(this.selected.value)!.hidden && largest) {
      const keepMax = this.maxOn;
      this.select(largest);
      if (keepMax) this.pickMax();
    }
  }

  setPrimary(label: string, enabled: boolean): void {
    this.primaryBtn.firstChild!.textContent = label;
    this.primaryBtn.disabled = !enabled;
  }

  /**
   * Number keys pick chips (a chip this table keeps in the rack does nothing) and M is Max;
   * returns true if the key was one of them.
   */
  key(e: KeyboardEvent): boolean {
    // 1-9 left to right, and 0 for the tenth
    const n = e.key === '0' ? 10 : Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= BETTING_CHIPS.length) {
      const spec = BETTING_CHIPS[n - 1]!;
      if (!this.buttons.get(spec.value)!.hidden) this.select(spec);
      return true;
    }
    if (this.maxMode && (e.key === 'm' || e.key === 'M') && !e.shiftKey) {
      if (this.maxMode.mode === 'bet') this.maxMode.run();
      else this.pickMax();
      return true;
    }
    return false;
  }
}

export class UiKit {
  private dealer: HTMLElement | null = null;
  private dealerTimer = 0;
  private readonly gone = new AbortController();

  constructor(private readonly root: HTMLElement) {}

  toast = toast;
  askBuyIn = (opts: Parameters<typeof askBuyIn>[0]): Promise<Cents | null> => askBuyIn(opts, this.gone.signal);

  /** The table is going away: close any prompt it asked, its dealer line and its tip. */
  dispose(): void {
    this.gone.abort();
    clearTimeout(this.dealerTimer);
    this.dealer?.remove();
    this.dealer = null;
    this.tipEl?.remove();
    this.tipEl = null;
  }

  private tipEl: HTMLElement | null = null;

  /**
   * The Tips line above the controls ("Basic strategy: double 11 against a 6"); null hides it.
   * Views call this only while the player has Tips on.
   */
  tip(text: string | null): void {
    if (text === null) {
      if (this.tipEl) this.tipEl.hidden = true;
      return;
    }
    if (!this.tipEl) {
      this.tipEl = el('div', 'tip-line panel');
      this.tipEl.setAttribute('aria-live', 'polite');
      this.root.append(this.tipEl);
    }
    this.tipEl.replaceChildren(el('span', 'tip-label', 'Tip'), text);
    this.tipEl.hidden = false;
  }

  /** One line of dealer talk at the top of the screen ("Dealer has 16", "No more bets"). */
  say(text: string, ms = 2600): void {
    if (!this.dealer) {
      this.dealer = el('div', 'dealer-line panel');
      this.dealer.setAttribute('aria-live', 'polite');
      this.root.append(this.dealer);
    }
    this.dealer.textContent = text;
    this.dealer.hidden = false;
    clearTimeout(this.dealerTimer);
    this.dealerTimer = window.setTimeout(() => this.dealer && (this.dealer.hidden = true), ms);
  }

  /** A result pill pinned to a spot on the table. */
  pill(stage: TableStage, at: THREE.Vector3, text: string, kind: 'win' | 'lose' | 'push', ms = 2600): void {
    const p = el('div', `pill ${kind}`, text);
    const obj = stage.label(p, at);
    setTimeout(() => {
      obj.removeFromParent();
      p.remove();
    }, ms);
  }
}
