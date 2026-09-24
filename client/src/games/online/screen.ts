// The website on the computer's monitor: every online game draws inside this frame, so the eight
// of them read as one site. It's built at a fixed 1280 x 800 and mapped onto the four projected
// corners of the 3D monitor every frame (the same projective mapping as the video poker glass),
// so it stays glued to the desk while the camera flies in and is a plain scaled rectangle, with
// crisp text, once the camera sits square to it.
//
//   .os-top    the site's name, the game's name, and the chips you have at this computer
//   .os-side   the bet panel: a game puts its BetBox and its own controls here
//   .os-main   the game's board
//   .os-foot   one line of rules: the return, the limits

import * as THREE from 'three';
import './online.css';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { el } from '../../ui/kit.ts';

export const SCREEN_PX = { w: 1280, h: 800 } as const;

export class OnlineScreen {
  readonly root = el('div', 'os-screen');
  /** The game's board. */
  readonly main = el('div', 'os-main');
  /** The bet panel down the left: BetBox first, then the game's buttons. */
  readonly side = el('div', 'os-side');
  private readonly stack = el('span', 'os-stack-value', '$0');
  private readonly foot = el('div', 'os-foot');
  private transform = '';

  constructor(title: string) {
    const top = el('div', 'os-top');
    const brand = el('div', 'os-brand');
    brand.append(el('span', 'os-brand-mark', 'HOUSE'), el('span', 'os-brand-sub', 'ORIGINALS'));
    const stack = el('div', 'os-stack');
    stack.append(el('span', 'os-stack-label', 'Chips'), this.stack);
    top.append(brand, el('div', 'os-title', title), stack);
    const body = el('div', 'os-body');
    body.append(this.side, this.main);
    this.root.append(top, body, this.foot);
    this.root.hidden = true;
  }

  setStack(cents: Cents): void {
    this.stack.textContent = formatMoney(cents);
  }

  /** The line at the foot of the page: the game's return and limits. */
  setNote(text: string): void {
    this.foot.textContent = text;
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

  /** Call from the view's update(): keeps the page on the monitor's glass as the camera moves. */
  follow(root: THREE.Object3D, camera: THREE.Camera, corners: THREE.Vector3[]): void {
    this.place(corners.map((c) => toScreen(c, root, camera)));
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
 * Max bets the most the table allows or everything you have here, whichever is less.
 */
export class BetBox {
  readonly root = el('div', 'os-bet');
  private readonly input = el('input', 'os-bet-input');
  private readonly buttons: HTMLButtonElement[] = [];
  private cap: Cents;
  private current: Cents;

  constructor(private readonly opts: BetBoxOptions) {
    this.cap = opts.max;
    this.current = opts.value;
    const head = el('div', 'os-bet-head');
    head.append(el('span', 'os-label', opts.label ?? 'Bet'), el('span', 'os-bet-range', `${formatMoney(opts.min)} to ${formatMoney(opts.max)}`));
    this.input.type = 'text';
    this.input.inputMode = 'numeric';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.addEventListener('change', () => this.set(Math.round(Number(this.input.value.replace(/[^0-9.]/g, '')) * 100) || opts.min));
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.input.blur();
    });
    const row = el('div', 'os-bet-row');
    const field = el('label', 'os-bet-field');
    field.append(el('span', 'os-bet-sign', '$'), this.input);
    const nudge = (text: string, title: string, fn: () => void) => {
      const b = el('button', 'os-chip-btn', text);
      b.type = 'button';
      b.title = title;
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
    this.root.append(head, row);
    this.set(opts.value);
  }

  get value(): Cents {
    return this.current;
  }

  /** Snap to the step and clamp into [min, the most you can bet now]. */
  set(value: number): void {
    const { min, step } = this.opts;
    const top = Math.max(min, this.cap);
    const v = Math.min(top, Math.max(min, Math.floor(value / step) * step));
    this.current = v;
    this.input.value = (v / 100).toFixed(v % 100 === 0 ? 0 : 2);
    this.opts.onChange?.(v);
  }

  /** The most you can bet right now: the table max or your chips here, whichever is less. */
  setMax(max: Cents): void {
    this.cap = Math.min(this.opts.max, max);
    if (this.current > this.cap) this.set(this.cap);
  }

  setEnabled(on: boolean): void {
    this.input.disabled = !on;
    for (const b of this.buttons) b.disabled = !on;
  }
}

/** A big primary button for the page's main action (Bet, Drop, Cash out). */
export function actionButton(text: string, onClick: () => void, kind: 'go' | 'cash' | 'plain' = 'go'): HTMLButtonElement {
  const b = el('button', `os-action ${kind}`, text);
  b.type = 'button';
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', onClick);
  return b;
}

// ---------------------------------------------------------------------------------------------
// Added with Plinko, Dice, Limbo and Keno (additions only; nothing above changes): a segmented
// choice, a typed number field, a key-value list, the recent-results strip, the session tally,
// a synthesized tone, the celebration threshold, and the site's bar for the desks' attract pictures.

export interface SegOption<T> {
  value: T;
  label: string;
  title?: string;
}

/** A segmented choice on the shared `os-seg` look: risk, rows, Classic/Low/Medium/High. */
export class SegChoice<T extends string | number> {
  readonly root = el('div', 'os-seg');
  private readonly buttons = new Map<T, HTMLButtonElement>();
  private current: T;

  constructor(options: readonly SegOption<T>[], value: T, onPick: (value: T) => void) {
    this.current = value;
    for (const o of options) {
      const b = el('button', '', o.label);
      b.type = 'button';
      if (o.title) b.title = o.title;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        if (o.value === this.current) return;
        this.set(o.value);
        onPick(o.value);
      });
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
    for (const [v, b] of this.buttons) b.classList.toggle('on', v === value);
  }

  setEnabled(on: boolean): void {
    for (const b of this.buttons.values()) b.disabled = !on;
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

/**
 * A labelled number the player types (a multiplier, a win chance, a target) or only reads (the
 * profit on a win). It commits on Enter or when it loses focus; the owner snaps the value and
 * writes it back with set(), and anything that isn't a number puts the last value back.
 */
export class NumberField {
  readonly root = el('div', 'os-num');
  readonly input = el('input', 'os-num-input');
  private readonly label = el('span', 'os-label');
  private readonly note = el('span', 'os-num-note');
  private readonly field = el('label', 'os-field');
  private current: number;

  constructor(private readonly opts: NumberFieldOptions) {
    this.current = opts.value;
    this.label.textContent = opts.label;
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
    this.input.value = this.opts.format(value);
  }

  setLabel(text: string): void {
    this.label.textContent = text;
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
    row.label.textContent = label;
    row.value.textContent = value;
    row.value.className = tone ?? '';
  }
}

/** The last few results along the top of a board, newest on the right: green paid more than the bet. */
export class ResultStrip {
  readonly root = el('div', 'os-strip');

  constructor(private readonly size = 8) {}

  push(text: string, win: boolean, fresh = true): void {
    this.root.append(el('span', `os-strip-item${win ? ' win' : ''}${fresh ? ' fresh' : ''}`, text));
    while (this.root.childElementCount > this.size) this.root.firstElementChild!.remove();
  }

  clear(): void {
    this.root.replaceChildren();
  }
}

/** Bets, wagered and profit since sitting down at this computer. */
export class SessionTally {
  readonly root = el('div', 'os-tally');
  private bets = 0;
  private wagered = 0;
  private net = 0;
  private readonly betsEl = el('span', 'os-stat-value', '0');
  private readonly wageredEl = el('span', 'os-stat-value', '$0');
  private readonly netEl = el('span', 'os-stat-value', '$0');

  constructor() {
    const stats = el('div', 'os-stats');
    const stat = (label: string, value: HTMLElement) => {
      const s = el('div', 'os-stat');
      s.append(el('span', 'os-stat-label', label), value);
      return s;
    };
    stats.append(stat('Bets', this.betsEl), stat('Wagered', this.wageredEl), stat('Profit', this.netEl));
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

/**
 * One synthesized note through the site's master gain, so mute and volume cover it: a peg's tick,
 * a keno pop, a win's chime. Silent until the page has had a gesture.
 */
export function siteTone(
  sfx: { muted: boolean; audio: AudioContext; out: AudioNode },
  freq: number,
  ms: number,
  opts: { type?: OscillatorType; gain?: number; at?: number; to?: number } = {},
): void {
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
  g.fillStyle = '#6f8196';
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
  g.append(head, control);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Added with Tower, Mines, Hi-Lo and Crash (additions only; nothing above changes): the multiplier
// and percent text those four print, the pop over their boards when a round ends in a payout,
// Hi-Lo's trail of cards, and Crash's table of everyone's bets.

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

  /** Pop the result for `ms` (0 keeps it up until hide()). */
  show(mult: number, payout: Cents, bet: Cents, ms = 0): void {
    this.hide();
    const win = payout > bet;
    const box = el('div', `os-result os-pop${win ? '' : ' lose'}`);
    box.append(el('div', 'os-result-mult', multText(mult)), el('div', 'os-result-paid', `${win ? 'Won' : 'Paid'} ${formatMoney(payout)}`));
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

  constructor() {
    const head = el('div', 'os-players-head');
    head.append(this.count, this.total);
    const cols = el('div', 'os-players-row os-players-cols');
    cols.append(el('span', '', 'Player'), el('span', '', 'Bet'), el('span', '', 'Cashed'), el('span', '', 'Profit'));
    this.root.append(head, cols, this.list);
    this.set([]);
  }

  set(rows: PlayerRow[]): void {
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
