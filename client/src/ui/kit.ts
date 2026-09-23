// Shared DOM pieces for every table: the chip tray, bet buttons, the buy-in panel, result pills,
// the dealer's call line, toasts and modals. Built with elements, classes and textContent only:
// the page's CSP blocks inline style attributes and injected <style> tags.

import * as THREE from 'three';
import { BETTING_CHIPS, formatMoney, type Cents, type ChipSpec } from '../../../shared/src/money.ts';
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

export function modal(title: string, body: (HTMLElement | string)[], actions: HTMLButtonElement[]): { close: () => void; root: HTMLElement } {
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
  const close = () => scrim.remove();
  return { close, root: box };
}

/** Ask how much to bring to the table. Resolves with cents, or null if cancelled. */
export function askBuyIn(opts: { min: Cents; max: Cents; balance: Cents; suggested?: Cents; verb?: string }): Promise<Cents | null> {
  return new Promise((resolve) => {
    const max = Math.min(opts.max, Math.floor(opts.balance / 100) * 100);
    const picks = [opts.min, opts.min * 5, opts.min * 20, max].filter((v, i, a) => v >= opts.min && v <= max && a.indexOf(v) === i);
    const input = el('input');
    input.type = 'number';
    input.min = String(opts.min / 100);
    input.max = String(max / 100);
    input.step = '1';
    input.value = String(Math.min(max, opts.suggested ?? picks[1] ?? opts.min) / 100);
    const note = el('p', '', `Balance ${formatMoney(opts.balance)}. This table takes ${formatMoney(opts.min)} to ${formatMoney(opts.max)}.`);
    const quick = el('div', 'row');
    for (const v of picks) quick.append(button(formatMoney(v), () => (input.value = String(v / 100)), { cls: 'ghost' }));
    let m: { close: () => void };
    const done = (v: Cents | null) => {
      m.close();
      resolve(v);
    };
    const ok = button(opts.verb ?? 'Buy in', () => {
      const v = Math.round(Number(input.value)) * 100;
      if (!Number.isFinite(v) || v < opts.min || v > max) {
        toast(`Choose between ${formatMoney(opts.min)} and ${formatMoney(max)}.`, 'err');
        return;
      }
      done(v);
    }, { cls: 'primary' });
    m = modal(max < opts.min ? 'Not enough to sit down' : 'Buy in', [note, quick, input], max < opts.min ? [button('Close', () => done(null))] : [ok, button('Cancel', () => done(null), { cls: 'ghost' })]);
    input.focus();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') ok.click();
      if (e.key === 'Escape') done(null);
    });
  });
}

/** The chip tray: pick a denomination (keys 1-7), plus Undo / Clear / Rebet / x2 and a primary action. */
export class ChipTray {
  readonly root = el('div', 'tray panel');
  private buttons = new Map<number, HTMLButtonElement>();
  selected: ChipSpec = BETTING_CHIPS[1]!;
  private primaryBtn: HTMLButtonElement;

  constructor(handlers: { undo?: () => void; clear?: () => void; rebet?: () => void; double?: () => void; primary?: { label: string; key?: string; run: () => void } }) {
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
    for (const [v, b] of this.buttons) b.setAttribute('aria-pressed', String(v === spec.value));
  }

  setPrimary(label: string, enabled: boolean): void {
    this.primaryBtn.firstChild!.textContent = label;
    this.primaryBtn.disabled = !enabled;
  }

  /** Number keys pick chips; returns true if the key was one of them. */
  key(e: KeyboardEvent): boolean {
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= BETTING_CHIPS.length) {
      this.select(BETTING_CHIPS[n - 1]!);
      return true;
    }
    return false;
  }
}

export class UiKit {
  private dealer: HTMLElement | null = null;
  private dealerTimer = 0;

  constructor(private readonly root: HTMLElement) {}

  toast = toast;
  askBuyIn = askBuyIn;

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
