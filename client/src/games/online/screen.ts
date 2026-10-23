// The website on the computer's monitor: every online game draws inside this frame, so the twelve
// of them read as one site. It's built at a fixed 1280 x 800 and mapped onto the four projected
// corners of the 3D monitor every frame (the same projective mapping as the video poker glass),
// so it stays glued to the desk while the camera flies in and is a plain scaled rectangle, with
// crisp text, once the camera sits square to it.
//
// On a phone or a tablet held upright the monitor would come out a few inches wide and the page's
// text a few pixels high, so there the page lies flat over the scene instead (the `flat` layout):
// it fills the part of the screen the HUD, the chat and the back chip leave free, its panel at the
// screen's own size (thumb-sized buttons, readable text) and the board scaled into what's left,
// beside the panel on a phone on its side, above it upright.
//
//   .os-top    the site's name, the game's name, and the chips you have at this computer
//   .os-side   the bet panel: the bet, the game's choices, the main button, its facts, the tally
//   .os-stage  holds .os-main, the game's board (950 x 702 design pixels, scaled when flat)
//   .os-head   the board's top row: the last round's result and the recent results
//   .os-foot   one line of rules: the return, the limits, the keys

import * as THREE from 'three';
import './online.css';
import { DOLLAR, formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { el } from '../../ui/kit.ts';
import { bestSpace, fitOf, measureChrome, type Rect } from '../../table/fit.ts';
import { session } from '../../app/session.ts';
import type { SeatMsg, TableSnapshot, TableViewCtx } from '../contract.ts';

export const SCREEN_PX = { w: 1280, h: 800 } as const;
/** The board's design size: the page less the panel, the top bar and the foot (online.css). */
export const BOARD_PX = { w: 950, h: 702 } as const;
/** The board's top row (.os-head): boards keep their own pictures below it. */
export const HEAD_PX = 64;

/**
 * Whether the page lies flat over the scene rather than on the monitor: a screen too small or too
 * tall for a 16:10 monitor to come out readable (a phone either way up, a tablet upright).
 */
export function flatScreen(w = innerWidth, h = innerHeight): boolean {
  return w < 900 || h < 560 || w / h < 1.05;
}

/** A flat page's top bar and board row heights, and the least room its panel keeps upright, px. */
const FLAT_TOP = 46;
const FLAT_HEAD = 42;
const FLAT_PANEL_MIN = 236;
/** How often a flat page measures the controls around it, ms (and at once on a resize). */
const MEASURE_MS = 250;
/** Something that showed keeps its place this long after it hides, so the page doesn't breathe. */
const REMEMBER_MS = 12_000;

export class OnlineScreen {
  readonly root = el('div', 'os-screen');
  /** The game's board. */
  readonly main = el('div', 'os-main');
  /** The bet panel down the left (under the board when flat and upright). */
  readonly side = el('div', 'os-side');
  /** The board's top row: the round's result on the left, the recent results on the right. */
  readonly head = el('div', 'os-head');
  private readonly stage = el('div', 'os-stage');
  /** The board's window: the board itself when on the monitor, its scaled copy when flat. */
  private readonly view = el('div', 'os-view');
  private readonly body = el('div', 'os-body');
  private readonly stack = el('span', 'os-stack-value', '$0');
  private readonly foot = el('div', 'os-foot');
  private transform = '';
  private flat: boolean | null = null;
  private flatKey = '';
  private measuredAt = -Infinity;
  private seen = new Map<Element, { rect: Rect; at: number }>();
  private size = { w: 0, h: 0 };

  constructor(title: string) {
    const top = el('div', 'os-top');
    const brand = el('div', 'os-brand');
    brand.append(el('span', 'os-brand-mark', 'HOUSE'), el('span', 'os-brand-sub', 'ORIGINALS'));
    const stack = el('div', 'os-stack');
    stack.append(el('span', 'os-stack-label', 'Chips'), this.stack);
    top.append(brand, el('div', 'os-title', title), stack);
    this.main.append(this.head);
    this.view.append(this.main);
    this.stage.append(this.view);
    this.body.append(this.side, this.stage);
    this.root.append(top, this.body, this.foot);
    this.root.hidden = true;
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', `${title}, House Originals`);
    // the monitor's page is the board the table keeps in view, not a control over it (table/fit.ts)
    this.root.dataset.fit = 'ignore';
  }

  setStack(cents: Cents): void {
    const t = formatMoney(cents);
    if (this.stack.textContent !== t) this.stack.textContent = t;
  }

  /** The line at the foot of the page: the game's return and limits. */
  setNote(text: string): void {
    if (this.foot.textContent !== text) this.foot.textContent = text;
  }

  /** Whether the page lies flat over the scene now (a phone, a tablet upright). */
  get isFlat(): boolean {
    return this.flat === true;
  }

  /**
   * Map the 1280 x 800 design onto four screen-space points (top-left, top-right, bottom-right,
   * bottom-left) with a projective transform (Heckbert's square-to-quad), or hide it while any
   * corner is behind the camera.
   */
  place(p: ({ x: number; y: number } | null)[]): void {
    if (p.some((q) => q === null)) {
      this.root.hidden = true;
      return;
    }
    const [p0, p1, p2, p3] = p as { x: number; y: number }[];
    const dx1 = p1!.x - p2!.x;
    const dx2 = p3!.x - p2!.x;
    const dx3 = p0!.x - p1!.x + p2!.x - p3!.x;
    const dy1 = p1!.y - p2!.y;
    const dy2 = p3!.y - p2!.y;
    const dy3 = p0!.y - p1!.y + p2!.y - p3!.y;
    const den = dx1 * dy2 - dx2 * dy1;
    const g = den === 0 ? 0 : (dx3 * dy2 - dx2 * dy3) / den;
    const h = den === 0 ? 0 : (dx1 * dy3 - dx3 * dy1) / den;
    const a = p1!.x - p0!.x + g * p1!.x;
    const b = p3!.x - p0!.x + h * p3!.x;
    const d = p1!.y - p0!.y + g * p1!.y;
    const e = p3!.y - p0!.y + h * p3!.y;
    const W = SCREEN_PX.w;
    const H = SCREEN_PX.h;
    this.root.hidden = false;
    // Square to the camera the perspective terms vanish; a 2D matrix keeps the text sharp.
    const t =
      Math.abs(g) < 1e-4 && Math.abs(h) < 1e-4
        ? `matrix(${a / W},${d / W},${b / H},${e / H},${p0!.x},${p0!.y})`
        : `matrix3d(${a / W},${d / W},0,${g / W},${b / H},${e / H},0,${h / H},0,0,1,0,${p0!.x},${p0!.y},0,1)`;
    if (t !== this.transform) this.root.style.transform = this.transform = t;
  }

  /**
   * Call from the view's update(): keeps the page on the monitor's glass as the camera moves. The
   * glass is the board the table keeps in view (table/fit.ts), so on a small window the camera's
   * lens takes in the whole monitor clear of the HUD and the page shrinks with it. A flat page
   * instead fills the free part of the screen (see the top of this file).
   */
  follow(root: THREE.Object3D, camera: THREE.Camera, corners: THREE.Vector3[]): void {
    if (!this.boarded) {
      this.boarded = true;
      fitOf(root)?.setBoard(corners);
    }
    const w = innerWidth;
    const h = innerHeight;
    const flat = flatScreen(w, h);
    if (flat !== this.flat) this.setFlat(flat);
    if (flat) {
      this.layFlat(w, h);
      return;
    }
    // Moved only when a corner did (a camera at rest costs four projections and no DOM work).
    let moved = this.corners.length !== corners.length;
    for (let i = 0; i < corners.length; i++) {
      const q = toScreen(corners[i]!, root, camera);
      const was = this.corners[i];
      if (!q || !was || Math.abs(q.x - was.x) > 0.01 || Math.abs(q.y - was.y) > 0.01) moved = true;
      this.corners[i] = q;
    }
    if (moved || this.root.hidden) this.place(this.corners);
  }

  private boarded = false;
  private corners: ({ x: number; y: number } | null)[] = [];

  private setFlat(on: boolean): void {
    this.flat = on;
    this.flatKey = '';
    this.seen.clear();
    this.measuredAt = -Infinity;
    this.root.classList.toggle('flat', on);
    this.corners = [];
    if (on) {
      this.transform = '';
      this.root.style.transform = 'none';
      // the result and the history read at the screen's own size, over the board
      this.stage.prepend(this.head);
    } else {
      for (const p of ['left', 'top', 'width', 'height', '--os-k', '--os-bw', '--os-bh', '--os-sw']) this.root.style.removeProperty(p);
      this.root.classList.remove('upright', 'sideways');
      this.main.prepend(this.head);
    }
  }

  /**
   * Lie flat in the largest part of the screen clear of the controls (the HUD's clusters, the
   * chat, the back chip, the tips line), measured as the board fit measures them; the panel at the
   * screen's own size and the board scaled into the rest.
   */
  private layFlat(w: number, h: number): void {
    const now = performance.now();
    const resized = w !== this.size.w || h !== this.size.h;
    if (resized) {
      this.size = { w, h };
      this.seen.clear();
    }
    this.root.hidden = false;
    if (!resized && now - this.measuredAt < MEASURE_MS) return;
    this.measuredAt = now;
    const ui = this.root.parentElement;
    const back = document.querySelector('.j4-back');
    const els = [...(ui ? [...ui.children] : []), ...(back ? [back] : [])];
    for (const { el: e, rect } of measureChrome(els, w, h)) this.seen.set(e, { rect, at: now });
    for (const [e, s] of this.seen) if (now - s.at > REMEMBER_MS || !e.isConnected) this.seen.delete(e);
    const obstacles = [...this.seen.values()].map((s) => s.rect);
    // the clear-space search only when the screen or what's on it changed
    const key = [w, h, ...obstacles.flatMap((o) => [o.left, o.top, o.right, o.bottom])].map((x) => Math.round(x)).join(',');
    if (key === this.flatKey) return;
    this.flatKey = key;
    const upright = h > w;
    // The shape the page wants: upright, all the width it can have; on its side, the height.
    const want = upright ? { width: w, height: w * 0.75 } : { width: Math.min(w, h * 2), height: h };
    const b = { left: (w - want.width) / 2, top: (h - want.height) / 2, right: (w + want.width) / 2, bottom: (h + want.height) / 2 };
    const { safe } = bestSpace(b, obstacles, w, h);
    const sw = Math.max(0, safe.right - safe.left);
    const sh = Math.max(0, safe.bottom - safe.top);
    // The board's top row moves above the board when flat (FLAT_TOP, FLAT_HEAD in online.css), so
    // the board's own top is cropped off.
    const bh = BOARD_PX.h - HEAD_PX;
    const rows = FLAT_TOP + FLAT_HEAD;
    let k: number;
    let panelW = 0;
    if (upright) {
      // the panel keeps room under the board for at least the bet and the main button
      k = Math.min(sw / BOARD_PX.w, (sh - rows - FLAT_PANEL_MIN) / bh);
    } else {
      // on its side the height decides the board; the panel takes what's left beside it
      k = (sh - rows) / bh;
      panelW = Math.round(Math.min(400, Math.max(250, sw - BOARD_PX.w * k)));
      k = Math.min(k, (sw - panelW) / BOARD_PX.w);
    }
    k = Math.max(0.2, k);
    const s = this.root.style;
    s.left = `${Math.round(safe.left)}px`;
    s.top = `${Math.round(safe.top)}px`;
    s.width = `${Math.round(sw)}px`;
    s.height = `${Math.round(sh)}px`;
    s.setProperty('--os-k', k.toFixed(4));
    s.setProperty('--os-bw', `${Math.floor(BOARD_PX.w * k)}px`);
    s.setProperty('--os-bh', `${Math.floor(bh * k)}px`);
    s.setProperty('--os-sw', `${panelW}px`);
    this.root.classList.toggle('upright', upright);
    this.root.classList.toggle('sideways', !upright);
  }

  dispose(): void {
    this.root.remove();
  }
}

const v = new THREE.Vector3();

/** A point in the station's local space to CSS pixels, or null when it's behind the camera. */
export function toScreen(local: THREE.Vector3, root: THREE.Object3D, camera: THREE.Camera): { x: number; y: number } | null {
  v.copy(local);
  root.localToWorld(v);
  v.applyMatrix4(camera.matrixWorldInverse);
  if (v.z > -0.01) return null;
  v.applyMatrix4((camera as THREE.PerspectiveCamera).projectionMatrix);
  return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
}

export interface BetBoxOptions {
  label?: string;
  /** Table limits and the step, in cents (whole dollars at every online game). */
  min: Cents;
  max: Cents;
  step: Cents;
  value: Cents;
  onChange?: (value: Cents) => void;
}

/**
 * The bet field every online game shares: dollars typed or nudged with half, double and Max.
 * Max bets the most the table allows or everything you have here, whichever is less. Under it,
 * the same line in every game: what a win of this bet makes (or, where a round can pay many
 * ways, its top pay), with the multiplier and the chance.
 */
export class BetBox {
  readonly root = el('div', 'os-bet');
  private readonly input = el('input', 'os-bet-input');
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly footLabel = el('span', 'os-bet-foot-label');
  private readonly footValue = el('span', 'os-bet-foot-value');
  private readonly footNote = el('span', 'os-bet-foot-note');
  private readonly foot = el('div', 'os-bet-foot');
  private cap: Cents;
  private current: Cents;

  constructor(private readonly opts: BetBoxOptions) {
    this.cap = opts.max;
    this.current = opts.value;
    const head = el('div', 'os-bet-head');
    const label = el('label', 'os-label', opts.label ?? 'Bet');
    head.append(label, el('span', 'os-bet-range', `${formatMoney(opts.min)} to ${formatMoney(opts.max)}`));
    this.input.type = 'text';
    this.input.inputMode = 'numeric';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.id = `os-bet-${++betIds}`;
    label.htmlFor = this.input.id;
    this.input.addEventListener('change', () => this.set(Math.round(Number(this.input.value.replace(/[^0-9.]/g, '')) * 100) || opts.min));
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.input.blur();
    });
    const row = el('div', 'os-bet-row');
    const field = el('div', 'os-bet-field');
    field.append(el('span', 'os-bet-sign', '$'), this.input);
    const nudge = (text: string, title: string, fn: () => void) => {
      const b = el('button', 'os-chip-btn', text);
      b.type = 'button';
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', fn);
      this.buttons.push(b);
      return b;
    };
    row.append(
      field,
      nudge('½', 'Half the bet', () => this.set(this.current / 2)),
      nudge('2×', 'Double the bet', () => this.set(this.current * 2)),
      nudge('Max', 'The most you can bet here', () => this.set(this.cap)),
    );
    this.foot.append(this.footLabel, this.footValue, this.footNote);
    this.foot.hidden = true;
    this.root.append(head, row, this.foot);
    this.set(opts.value);
  }

  get value(): Cents {
    return this.current;
  }

  /** The line under the field: "Profit on win · +$1.00 · 2.00× · 49.50%"; null hides it. */
  setFoot(foot: { label: string; value: string; note?: string; tone?: 'win' | null } | null): void {
    this.foot.hidden = foot === null;
    if (!foot) return;
    if (this.footLabel.textContent !== foot.label) this.footLabel.textContent = foot.label;
    if (this.footValue.textContent !== foot.value) this.footValue.textContent = foot.value;
    const note = foot.note ?? '';
    if (this.footNote.textContent !== note) this.footNote.textContent = note;
    this.footValue.classList.toggle('win', foot.tone === 'win');
  }

  /**
   * Snap to the step and clamp into [min, the most you can bet now]; the owner hears a change
   * (only a change: the same bet again, typed or clamped, is no news).
   */
  set(value: number): void {
    const { min, step } = this.opts;
    const top = Math.max(min, this.cap);
    const v = Math.min(top, Math.max(min, Math.floor(value / step) * step));
    const changed = v !== this.current;
    this.current = v;
    this.input.value = (v / 100).toFixed(v % 100 === 0 ? 0 : 2);
    if (changed) this.opts.onChange?.(v);
  }

  /**
   * The most you can bet right now: the table max or your chips here, whichever is less. A bet
   * over it comes down to it, never below the table minimum (chips short of the minimum leave the
   * bet at the minimum, which the button then won't place), so a view may call this from its
   * redraw without the box calling back for ever.
   */
  setMax(max: Cents): void {
    this.cap = Math.min(this.opts.max, max);
    if (this.current > Math.max(this.opts.min, this.cap)) this.set(this.cap);
  }

  setEnabled(on: boolean): void {
    this.input.disabled = !on;
    for (const b of this.buttons) b.disabled = !on;
  }
}
let betIds = 0;

/**
 * A big primary button for the page's main action (Bet, Drop, Cash out). `key` is printed on it
 * as a keycap (from data-key, in CSS, so the button's text stays its label).
 */
export function actionButton(text: string, onClick: () => void, kind: 'go' | 'cash' | 'plain' = 'go', key?: string): HTMLButtonElement {
  const b = el('button', `os-action ${kind}`, text);
  b.type = 'button';
  if (key) keycap(b, key);
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', onClick);
  return b;
}

/** Print a key on a control as its keycap, or take it off with null. */
export function keycap(b: HTMLElement, key: string | null): void {
  if (key) b.dataset.key = key;
  else delete b.dataset.key;
  if (key && !b.getAttribute('aria-keyshortcuts')) b.setAttribute('aria-keyshortcuts', key === '␣' || key === 'Space' ? 'Space' : key);
}

/** Label, look and state of an action button, written only when they change. */
export function paintButton(b: HTMLButtonElement, label: string, kind: 'go' | 'cash' | 'plain', disabled: boolean): void {
  if (b.textContent !== label) b.textContent = label;
  if (!b.classList.contains(kind)) {
    b.classList.remove('go', 'cash', 'plain');
    b.classList.add(kind);
  }
  if (b.disabled !== disabled) b.disabled = disabled;
}

export interface SegOption<T> {
  value: T;
  label: string;
  title?: string;
  /** A key that picks it, printed on it as a keycap. */
  key?: string;
}

/** A segmented choice on the shared `os-seg` look: risk, rows, Classic/Low/Medium/High. */
export class SegChoice<T extends string | number> {
  readonly root = el('div', 'os-seg');
  private readonly buttons = new Map<T, HTMLButtonElement>();
  private current: T;

  constructor(
    options: readonly SegOption<T>[],
    value: T,
    private readonly onPick: (value: T) => void,
  ) {
    this.current = value;
    this.root.setAttribute('role', 'group');
    for (const o of options) {
      const b = el('button', '', o.label);
      b.type = 'button';
      if (o.title) b.title = o.title;
      if (o.key) keycap(b, o.key);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => this.pick(o.value));
      this.buttons.set(o.value, b);
      this.root.append(b);
    }
    this.set(value);
  }

  get value(): T {
    return this.current;
  }

  /** Show `value` as the choice (no callback). */
  set(value: T): void {
    this.current = value;
    for (const [v, b] of this.buttons) {
      b.classList.toggle('on', v === value);
      b.setAttribute('aria-pressed', String(v === value));
    }
  }

  /** Choose `value` as a click would (the callback runs); false when it can't be chosen now. */
  pick(value: T): boolean {
    const b = this.buttons.get(value);
    if (!b || b.disabled) return false;
    if (value === this.current) return true;
    this.set(value);
    this.onPick(value);
    return true;
  }

  /** Choose the option after (1) or before (-1) the current one; false at either end. */
  step(dir: 1 | -1): boolean {
    const values = [...this.buttons.keys()];
    const next = values[values.indexOf(this.current) + dir];
    return next !== undefined && this.pick(next);
  }

  /** Name the whole choice for a screen reader ("Risk"). */
  label(text: string): this {
    this.root.setAttribute('aria-label', text);
    return this;
  }

  setEnabled(on: boolean): void {
    for (const b of this.buttons.values()) if (b.disabled === on) b.disabled = !on;
  }

  /** Ring the option the tips recommend; null clears it. */
  tip(value: T | null): void {
    for (const [v, b] of this.buttons) b.classList.toggle('tip-pick', v === value);
  }
}

export interface NumberFieldOptions {
  label: string;
  /** Printed after the number: '×', '%'. */
  suffix?: string;
  format: (value: number) => string;
  value: number;
  /** The typed number (already stripped to digits and a point), or omitted for a read-only field. */
  onCommit?: (typed: number) => void;
}

let fieldIds = 0;

/**
 * A labelled number the player types (a multiplier, a win chance, a target) or only reads (the
 * profit on a win). It commits on Enter or when it loses focus; the owner snaps the value and
 * writes it back with set(), and anything that isn't a number puts the last value back.
 */
export class NumberField {
  readonly root = el('div', 'os-num');
  readonly input = el('input', 'os-num-input');
  private readonly label = el('label', 'os-label');
  private readonly note = el('span', 'os-num-note');
  private readonly field = el('div', 'os-field');
  private current: number;

  constructor(private readonly opts: NumberFieldOptions) {
    this.current = opts.value;
    this.label.textContent = opts.label;
    this.input.id = `os-num-${++fieldIds}`;
    this.label.htmlFor = this.input.id;
    const head = el('div', 'os-num-head');
    head.append(this.label, this.note);
    this.input.type = 'text';
    this.input.inputMode = 'decimal';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.readOnly = !opts.onCommit;
    if (!opts.onCommit) this.root.classList.add('readonly');
    this.field.append(this.input);
    if (opts.suffix) this.field.append(el('span', 'os-num-suffix', opts.suffix));
    this.input.addEventListener('change', () => this.commit());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.input.blur();
    });
    this.root.append(head, this.field);
    this.set(opts.value);
  }

  get value(): number {
    return this.current;
  }

  set(value: number): void {
    this.current = value;
    const t = this.opts.format(value);
    if (this.input.value !== t) this.input.value = t;
  }

  setLabel(text: string): void {
    if (this.label.textContent !== text) this.label.textContent = text;
  }

  /** A few words on the right of the label ("98.70% at this bet"). */
  setNote(text: string, tone: 'win' | 'lose' | null = null): void {
    this.note.textContent = text;
    this.note.className = `os-num-note${tone ? ` ${tone}` : ''}`;
  }

  /** A square button at the end of the field (swap over and under). */
  addButton(text: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', 'os-num-btn', text);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => {
      e.preventDefault();
      onClick();
    });
    this.field.append(b);
    return b;
  }

  setEnabled(on: boolean): void {
    this.input.disabled = !on;
    for (const b of this.field.querySelectorAll('button')) b.disabled = !on;
  }

  private commit(): void {
    const typed = Number(this.input.value.replace(/[^0-9.]/g, ''));
    if (this.opts.onCommit && this.input.value.trim() !== '' && Number.isFinite(typed)) this.opts.onCommit(typed);
    this.input.value = this.opts.format(this.current);
  }
}

/** Label and value rows under the bet panel, under a small caption: a board's return, the chance of its top pay. */
export class InfoList {
  readonly root = el('div', 'os-infobox');
  private readonly list = el('dl', 'os-info');
  private readonly rows = new Map<string, { label: HTMLElement; value: HTMLElement }>();

  constructor(caption?: string) {
    if (caption) this.root.append(el('div', 'os-caption', caption));
    this.root.append(this.list);
  }

  set(key: string, label: string, value: string, tone: 'win' | 'lose' | null = null): void {
    let row = this.rows.get(key);
    if (!row) {
      const r = el('div', 'os-info-row');
      row = { label: el('dt', ''), value: el('dd', '') };
      r.append(row.label, row.value);
      this.list.append(r);
      this.rows.set(key, row);
    }
    if (row.label.textContent !== label) row.label.textContent = label;
    if (row.value.textContent !== value) row.value.textContent = value;
    const cls = tone ?? '';
    if (row.value.className !== cls) row.value.className = cls;
  }
}

/**
 * The last results, newest on the right, in the board's top row: green when the round paid more
 * than the bet. `accent` colours a pill's edge (Plinko's bin, a case item's rarity).
 */
export class ResultStrip {
  readonly root = el('div', 'os-strip');

  constructor(private readonly size = 8) {
    this.root.setAttribute('aria-label', 'Recent results');
  }

  push(text: string, win: boolean, fresh = true, accent?: string): void {
    const pill = el('span', `os-strip-item${win ? ' win' : ''}${fresh ? ' fresh' : ''}`, text);
    if (accent) {
      pill.classList.add('accent');
      pill.style.setProperty('--os-accent', accent);
    }
    this.root.append(pill);
    while (this.root.childElementCount > this.size) this.root.firstElementChild!.remove();
  }

  clear(): void {
    this.root.replaceChildren();
  }
}

/**
 * What the last round came to, at the left of the board's top row, the same in every game: the
 * money won or lost and the multiplier, green for a profit, quiet for a loss, plain for the bet
 * back. Read out to a screen reader as it changes.
 */
export class RoundResult {
  readonly root = el('div', 'os-round');
  private readonly amount = el('span', 'os-round-amt');
  private readonly mult = el('span', 'os-round-x');

  constructor() {
    this.root.setAttribute('aria-live', 'polite');
    this.root.append(this.amount, this.mult);
    this.root.hidden = true;
  }

  show(bet: Cents, payout: Cents, mult: number | null, fresh = true): void {
    const net = payout - bet;
    const tone = net > 0 ? 'win' : net < 0 ? 'lose' : 'even';
    this.root.className = `os-round ${tone}${fresh ? ' fresh' : ''}`;
    // restart the slide-in for a result like the last one
    if (fresh) {
      this.root.classList.remove('fresh');
      void this.root.offsetWidth;
      this.root.classList.add('fresh');
    }
    this.amount.textContent = net > 0 ? `Won ${formatMoney(net)}` : net < 0 ? `Lost ${formatMoney(-net)}` : 'Bet back';
    this.mult.textContent = mult === null ? '' : multText(mult);
    this.mult.hidden = mult === null;
    this.root.hidden = false;
  }

  clear(): void {
    this.root.hidden = true;
  }
}

/** How many bets the session chart keeps (the oldest drop off as new ones come). */
const CHART_POINTS = 120;

/**
 * Bets, wagered and profit since sitting down at this computer, with a small line of the profit
 * bet by bet: green above the line it started from, red below.
 */
export class SessionTally {
  readonly root = el('div', 'os-tally');
  private bets = 0;
  private wagered = 0;
  private net = 0;
  private readonly betsEl = el('span', 'os-stat-value', '0');
  private readonly wageredEl = el('span', 'os-stat-value', '$0');
  private readonly netEl = el('span', 'os-stat-value', '$0');
  private readonly path: number[] = [0];
  private readonly chart = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private readonly line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  private readonly zero = document.createElementNS('http://www.w3.org/2000/svg', 'line');

  constructor() {
    const stats = el('div', 'os-stats');
    const stat = (label: string, value: HTMLElement) => {
      const s = el('div', 'os-stat');
      s.append(el('span', 'os-stat-label', label), value);
      return s;
    };
    const profit = stat('Profit', this.netEl);
    profit.classList.add('os-stat-chart');
    stats.append(stat('Bets', this.betsEl), stat('Wagered', this.wageredEl), profit);
    // the profit bet by bet, a faint line behind the profit's own figure
    this.chart.setAttribute('class', 'os-chart');
    this.chart.setAttribute('viewBox', '0 0 100 24');
    this.chart.setAttribute('preserveAspectRatio', 'none');
    this.chart.setAttribute('aria-hidden', 'true');
    this.zero.setAttribute('class', 'os-chart-zero');
    this.line.setAttribute('class', 'os-chart-line');
    this.chart.append(this.zero, this.line);
    this.chart.style.display = 'none';
    profit.prepend(this.chart);
    this.root.append(el('div', 'os-caption', 'This session'), stats);
  }

  add(wagered: Cents, returned: Cents): void {
    this.bets++;
    this.wagered += wagered;
    this.net += returned - wagered;
    this.betsEl.textContent = this.bets.toLocaleString('en-US');
    this.wageredEl.textContent = formatMoney(this.wagered);
    this.netEl.textContent = formatMoney(this.net, { sign: true });
    this.netEl.className = `os-stat-value${this.net > 0 ? ' win' : this.net < 0 ? ' lose' : ''}`;
    this.path.push(this.net);
    if (this.path.length > CHART_POINTS + 1) this.path.shift();
    this.draw();
  }

  private draw(): void {
    const pts = this.path;
    if (pts.length < 3) return;
    let lo = 0;
    let hi = 0;
    for (const p of pts) {
      if (p < lo) lo = p;
      if (p > hi) hi = p;
    }
    const span = hi - lo || 1;
    const y = (p: number) => (22 - ((p - lo) / span) * 20).toFixed(2);
    const step = 100 / (pts.length - 1);
    this.line.setAttribute('points', pts.map((p, i) => `${(i * step).toFixed(2)},${y(p)}`).join(' '));
    this.zero.setAttribute('x1', '0');
    this.zero.setAttribute('x2', '100');
    this.zero.setAttribute('y1', y(0));
    this.zero.setAttribute('y2', y(0));
    this.chart.classList.toggle('up', this.net > 0);
    this.chart.classList.toggle('down', this.net < 0);
    this.chart.style.display = '';
  }
}

/** Commit whatever is being typed on this page (a bet, a multiplier) before acting on it. */
export function commitTyping(root: HTMLElement): void {
  const a = document.activeElement;
  if (a instanceof HTMLInputElement && root.contains(a)) a.blur();
}

/**
 * A celebration only for a return that beats the stake by a real margin: ten times the bet
 * and up is nice, a hundred big, a thousand huge. Anything less shows on the page and nowhere else.
 */
export function winTier(returned: Cents, bet: Cents): 'nice' | 'big' | 'huge' | null {
  if (bet <= 0 || returned < bet * 10) return null;
  if (returned >= bet * 1000) return 'huge';
  return returned >= bet * 100 ? 'big' : 'nice';
}

type ToneSfx = { muted: boolean; audio: AudioContext; out: AudioNode };

/**
 * One synthesized note through the site's master gain, so mute and volume cover it: a peg's tick,
 * a keno pop, a win's chime. Silent until the page has had a gesture.
 */
export function siteTone(sfx: ToneSfx, freq: number, ms: number, opts: { type?: OscillatorType; gain?: number; at?: number; to?: number } = {}): void {
  if (sfx.muted) return;
  const ctx = sfx.audio;
  if (ctx.state !== 'running') return;
  const start = ctx.currentTime + (opts.at ?? 0) / 1000;
  const end = start + ms / 1000;
  const osc = ctx.createOscillator();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, start);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, end);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.05, start + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(g).connect(sfx.out);
  osc.start(start);
  osc.stop(end + 0.02);
}

/**
 * The site's sound for a round that has played out, the same in every game: a rising chime for a
 * win (longer the bigger it is), a single note for the bet back, a low fall for a loss. The
 * biggest wins add the table's celebration chime on top (celebrate()).
 */
export function resultTone(sfx: ToneSfx, payout: Cents, bet: Cents): void {
  if (payout > bet) {
    const x = bet > 0 ? payout / bet : 1;
    const notes = x >= 10 ? [660, 880, 1175, 1568] : x >= 3 ? [784, 988, 1319] : [784, 1175];
    notes.forEach((f, i) => siteTone(sfx, f, 140, { type: 'triangle', gain: 0.05, at: i * 70 }));
  } else if (payout > 0 && payout === bet) siteTone(sfx, 587, 110, { type: 'triangle', gain: 0.04 });
  else siteTone(sfx, 220, 130, { gain: 0.045, to: 165 });
}

/** The thud for a bet the chips here can't cover. */
export function shortTone(sfx: ToneSfx): void {
  siteTone(sfx, 150, 120, { type: 'sawtooth', gain: 0.03 });
}

/**
 * The site's top bar painted on a desk's attract picture (pc.ts attractTexture), so a row of
 * desks reads as one site. Returns the y where the page below the bar starts.
 */
export function drawSiteBar(g: CanvasRenderingContext2D, w: number, title: string): number {
  g.fillStyle = '#1a2c38';
  g.fillRect(0, 0, w, 42);
  g.fillStyle = '#2f4553';
  g.fillRect(0, 42, w, 2);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.font = '800 19px system-ui, sans-serif';
  g.fillStyle = '#eef3f8';
  g.fillText('HOUSE', 16, 22);
  const x = 16 + g.measureText('HOUSE').width + 7;
  g.font = '600 11px system-ui, sans-serif';
  g.fillStyle = '#8b9cb0';
  g.fillText('ORIGINALS', x, 23);
  g.font = '700 18px system-ui, sans-serif';
  g.fillStyle = '#eef3f8';
  g.textAlign = 'right';
  g.fillText(title, w - 16, 22);
  g.textAlign = 'left';
  return 44;
}

/** A block of the bet panel: a label (and an optional note on its right) over a control. */
export function labelled(label: string, control: HTMLElement, note?: HTMLElement): HTMLElement {
  const g = el('div', 'os-group');
  const head = el('div', 'os-group-head');
  head.append(el('span', 'os-label', label));
  if (note) head.append(note);
  if (!control.getAttribute('aria-label')) control.setAttribute('aria-label', label);
  g.append(head, control);
  return g;
}

/** The last few bets at this computer, newest first: a pocket version of the site's My Bets table. */
export class BetLog {
  readonly root = el('div', 'os-log');
  private readonly body = el('div', 'os-log-body');

  constructor(caption: string, columns: readonly string[], private readonly size = 5) {
    const head = el('div', 'os-log-row os-log-head');
    for (const c of columns) head.append(el('span', '', c));
    this.root.append(el('div', 'os-caption', caption), head, this.body);
  }

  /** One bet; the last cell (what came back) is coloured by `win`. */
  push(cells: readonly string[], win: boolean, fresh = true): void {
    const row = el('div', `os-log-row${fresh ? ' fresh' : ''}`);
    cells.forEach((c, i) => row.append(el('span', i === cells.length - 1 ? (win ? 'win' : 'lose') : '', c)));
    this.body.prepend(row);
    while (this.body.childElementCount > this.size) this.body.lastElementChild!.remove();
  }

  clear(): void {
    this.body.replaceChildren();
  }
}

/**
 * The bet panel on a desk's attract picture, down the left under drawSiteBar: labelled fields,
 * then the green action button. Returns the panel's width, where the game's own picture starts.
 */
export function drawAttractPanel(g: CanvasRenderingContext2D, top: number, h: number, fields: readonly [string, string][], action: string): number {
  const w = 132;
  g.fillStyle = '#1a2c38';
  g.fillRect(0, top, w, h - top);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  // Manual and Auto, as the page's panel opens
  g.fillStyle = '#0f1e29';
  g.beginPath();
  g.roundRect(10, top + 10, 112, 24, 12);
  g.fill();
  g.fillStyle = '#2f4553';
  g.beginPath();
  g.roundRect(12, top + 12, 54, 20, 10);
  g.fill();
  g.font = '700 10px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillStyle = '#eef3f8';
  g.fillText('Manual', 39, top + 22);
  g.fillStyle = '#8b9cb0';
  g.fillText('Auto', 94, top + 22);
  g.textAlign = 'left';
  let y = top + 52;
  for (const [label, value] of fields) {
    g.fillStyle = '#a7b4c6';
    g.font = '600 11px system-ui, sans-serif';
    g.fillText(label, 12, y);
    g.fillStyle = '#0f1e29';
    g.beginPath();
    g.roundRect(10, y + 8, 112, 28, 4);
    g.fill();
    g.fillStyle = '#eef3f8';
    g.font = '600 15px system-ui, sans-serif';
    g.fillText(value, 18, y + 23);
    y += 52;
  }
  g.fillStyle = '#1fd65f';
  g.beginPath();
  g.roundRect(10, y + 2, 112, 36, 5);
  g.fill();
  g.fillStyle = '#06210f';
  g.font = '800 16px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(action, w / 2, y + 21);
  g.textAlign = 'left';
  return w;
}

const multFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "2.34×", "1,013.76×" from hundredths. */
export function multText(hundredths: number): string {
  return `${multFormat.format(hundredths / 100)}×`;
}

/** "75.00%" from a probability. */
export function pctText(p: number, digits = 2): string {
  return `${(p * 100).toFixed(digits)}%`;
}

/**
 * The multiplier and what it paid, popped over the board in the site's result box. Green only
 * when the return beats the stake; a return of the stake itself (a 1.00× crash cash-out) is plain.
 */
export class OutcomePop {
  private box: HTMLElement | null = null;
  private timer = 0;

  constructor(private readonly parent: HTMLElement) {}

  /** Pop the result for `ms` (0 keeps it up until hide()); `line` replaces "Won $X" under it. */
  show(mult: number, payout: Cents, bet: Cents, ms = 0, line?: string): void {
    this.hide();
    const win = payout > bet;
    const box = el('div', `os-result os-pop${win ? '' : ' lose'}`);
    box.append(el('div', 'os-result-mult', multText(mult)), el('div', 'os-result-paid', line ?? `${win ? 'Won' : 'Paid'} ${formatMoney(payout)}`));
    this.parent.append(box);
    this.box = box;
    if (ms > 0) this.timer = window.setTimeout(() => this.hide(), ms);
  }

  hide(): void {
    clearTimeout(this.timer);
    this.box?.remove();
    this.box = null;
  }
}

export interface TrailEntry {
  /** A card code ("Ks"): its art is the casino's own card faces. */
  card: string;
  caption: string;
  tone: 'win' | 'lose' | 'plain';
}

/**
 * A row of small cards with a caption under each (Start, Skip, ▲ 1.07×), newest on the right;
 * the oldest slide off the left edge.
 */
export class CardTrail {
  readonly root = el('div', 'os-trail');
  private readonly list = el('div', 'os-trail-list');

  constructor(private readonly size = 12) {
    this.root.append(this.list);
  }

  push(e: TrailEntry, fresh = true): void {
    const item = el('div', `os-trail-item ${e.tone}${fresh ? ' fresh' : ''}`);
    const img = el('img', 'os-trail-card');
    img.alt = e.card;
    img.draggable = false;
    img.src = `${import.meta.env.BASE_URL}assets/cards/${e.card}.svg`;
    item.append(img, el('span', 'os-trail-cap', e.caption));
    this.list.append(item);
    while (this.list.childElementCount > this.size) this.list.firstElementChild!.remove();
  }

  clear(): void {
    this.list.replaceChildren();
  }
}

export interface PlayerRow {
  name: string;
  bet: Cents;
  /** Hundredths cashed out at, or null while riding (or lost). */
  cashed: number | null;
  payout: Cents;
  busted: boolean;
  you: boolean;
}

/** Everyone's bets this round, biggest first: who, how much, and where they got out (or didn't). */
export class PlayersTable {
  readonly root = el('div', 'os-players');
  private readonly count = el('span', 'os-players-count');
  private readonly total = el('span', 'os-players-total');
  private readonly list = el('div', 'os-players-list');
  private key = '';

  constructor() {
    const head = el('div', 'os-players-head');
    head.append(this.count, this.total);
    const cols = el('div', 'os-players-row os-players-cols');
    cols.append(el('span', '', 'Player'), el('span', '', 'Bet'), el('span', '', 'Cashed'), el('span', '', 'Profit'));
    this.root.append(head, cols, this.list);
    this.set([]);
  }

  set(rows: PlayerRow[]): void {
    // the same rows again (most syncs) change nothing on the page
    const key = JSON.stringify(rows);
    if (key === this.key) return;
    this.key = key;
    const sorted = [...rows].sort((a, b) => Number(b.you) - Number(a.you) || b.bet - a.bet || a.name.localeCompare(b.name));
    this.count.textContent = `${rows.length} ${rows.length === 1 ? 'player' : 'players'}`;
    this.total.textContent = formatMoney(rows.reduce((n, r) => n + r.bet, 0));
    this.list.replaceChildren(
      ...sorted.map((r) => {
        const tone = r.cashed !== null ? 'win' : r.busted ? 'lose' : 'live';
        const row = el('div', `os-players-row ${tone}${r.you ? ' you' : ''}`);
        const profit = r.cashed !== null ? formatMoney(r.payout - r.bet, { sign: true }) : r.busted ? formatMoney(-r.bet) : '';
        row.append(
          el('span', 'os-players-name', r.name),
          el('span', 'os-players-bet', formatMoney(r.bet)),
          el('span', 'os-players-at', r.cashed !== null ? multText(r.cashed) : r.busted ? 'Crashed' : '—'),
          el('span', 'os-players-profit', profit),
        );
        return row;
      }),
    );
    if (rows.length === 0) this.list.append(el('div', 'os-players-empty', 'No bets yet this round'));
  }
}

/**
 * "Add chips", beside the chips at the top of the page, the way a site's wallet button sits by the
 * balance. With chips here it tops the stack up from your balance (as much as the table's buy-in
 * still has room for); with none, after a bust or a buy-in turned down, it buys in. It follows the
 * table snapshot and the seat messages its game already gets, and waits while chips are moving.
 */
export class AddChips {
  readonly button = el('button', 'os-add', 'Add chips');
  private status: SeatMsg['status'] = 'watching';
  private stack: Cents = 0;
  private buyIn = { min: 0, max: 0 };
  private asking = false;
  /** A top-up sent and not yet landed: the table takes one at a time. */
  private sent = false;

  constructor(screen: OnlineScreen, private readonly ctx: Pick<TableViewCtx, 'kit' | 'link'>) {
    this.button.type = 'button';
    this.button.title = 'Add chips from your balance';
    this.button.addEventListener('mousedown', (e) => e.preventDefault());
    this.button.addEventListener('click', () => void this.ask());
    screen.root.querySelector('.os-stack')?.append(this.button);
    this.paint();
  }

  table(snap: TableSnapshot): void {
    this.buyIn = snap.meta.config.buyIn;
    this.status = snap.you.status;
    this.stack = snap.you.stack;
    this.sent = false;
    this.paint();
  }

  seat(msg: SeatMsg): void {
    // any seat message after a top-up means it landed (or was turned down, with an err before it)
    if (msg.stack !== this.stack || msg.status !== this.status) this.sent = false;
    this.status = msg.status;
    this.stack = msg.stack;
    this.paint();
  }

  /** The table turned something down: a top-up in flight isn't one any more. */
  refused(): void {
    this.sent = false;
    this.paint();
  }

  private room(): Cents {
    const r = Math.max(0, this.buyIn.max - this.stack);
    return r - (r % DOLLAR);
  }

  private paint(): void {
    const seated = this.status === 'seated';
    this.button.textContent = seated || this.status === 'buying_in' ? 'Add chips' : 'Buy in';
    this.button.disabled = this.asking || this.sent || (this.status !== 'seated' && this.status !== 'watching') || (seated && this.room() < DOLLAR);
    this.button.title = seated && this.room() < DOLLAR ? `This table takes ${formatMoney(this.buyIn.max)} at most` : 'Add chips from your balance';
  }

  private async ask(): Promise<void> {
    const p = session.profile;
    if (!p || this.asking || this.sent) return;
    const seated = this.status === 'seated';
    if (!seated && this.status !== 'watching') return;
    const max = seated ? this.room() : this.buyIn.max;
    if (max < DOLLAR) return;
    this.asking = true;
    this.paint();
    const amount = await this.ctx.kit.askBuyIn({
      min: seated ? DOLLAR : this.buyIn.min,
      max,
      balance: p.balance,
      verb: seated ? 'Add chips' : 'Buy in',
      title: seated ? 'Add chips' : 'Buy in',
      ...(seated ? { note: `You have ${formatMoney(this.stack)} here, and this table takes ${formatMoney(this.buyIn.max)} at most: add up to ${formatMoney(max)}.` } : {}),
    });
    this.asking = false;
    if (amount && this.status === 'seated') {
      this.sent = true;
      this.ctx.link.topUp(amount);
    } else if (amount && this.status === 'watching') this.ctx.link.buyIn(amount);
    this.paint();
  }
}
