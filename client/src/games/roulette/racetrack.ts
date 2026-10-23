// The racetrack: the wheel's numbers in their order round a stadium, as the French layout prints
// it beside the grid. Tap a number to bet it and its neighbours (the count is set above the
// track); on the single-zero wheel the four called bets sit inside it. The panel also keeps the
// player's favourite layouts: three slots, each put back down with one tap. The bets themselves
// are worked out in calls.ts and favourites.ts; this file only draws and reports what was picked.
// Built of SVG and buttons, no inline style attributes (the page's CSP); every number and call is
// a focusable control, and the track keeps the wheel's own colours in both themes. It is drawn in
// two shapes and the stylesheet shows one: long and flat, and deeper for a phone held upright,
// where a flat one would leave each number too small a target for a finger.

import { el, button } from '../../ui/kit.ts';
import { formatMoney } from '../../../../shared/src/money.ts';
import { WHEEL, type Variant, colorOf, pocketLabel } from '../../../../shared/src/games/roulette/rules.ts';
import { callsFor, type CallId } from './calls.ts';
import { SLOTS, layoutTotal, type Layout } from './favourites.ts';

const SVG = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** What the player is pointing at on the track. */
export type TrackPick = { kind: 'neighbours'; n: number } | { kind: 'call'; id: CallId };

export interface TrackHandlers {
  /** Put this down. */
  pick(p: TrackPick): void;
  /** The pointer (or focus) is on this (null: off the track), at this screen point. */
  hover(p: TrackPick | null, x: number, y: number): void;
  /** The neighbours count changed. */
  neighbours(k: number): void;
  /** Put favourite `slot` down. */
  placeSlot(slot: number): void;
  /** Keep the chips on the layout as favourite `slot`. */
  saveSlot(slot: number): void;
  close(): void;
}

/** A stadium, in the SVG's own units: W by H, the band of numbers `band` deep. */
interface Shape {
  cls: 'wide' | 'tall';
  W: number;
  H: number;
  band: number;
  /** Where each call sits inside the track (x, y, width, height), near the numbers it covers. */
  calls: Record<CallId, readonly [number, number, number, number]>;
  /** How far under the middle of its box a call's name and its chips line sit, and a number under its cell's. */
  nameDy: number;
  subDy: number;
  numberDy: number;
  // derived: the ends' radius, the band's middle line's radius there, a straight's length, and the whole middle line's
  R: number;
  RM: number;
  straight: number;
  perimeter: number;
}

function shape(s: Omit<Shape, 'R' | 'RM' | 'straight' | 'perimeter'>): Shape {
  const R = s.H / 2;
  const RM = R - s.band / 2;
  const straight = s.W - 2 * R;
  return { ...s, R, RM, straight, perimeter: 2 * straight + 2 * Math.PI * RM };
}

/** Long and flat, as the French layout prints it: the calls in a row. */
const WIDE = shape({
  cls: 'wide', W: 600, H: 150, band: 36,
  calls: { tiers: [44, 43, 132, 64], orphelins: [184, 43, 112, 64], voisins: [304, 43, 152, 64], zero: [464, 43, 92, 64] },
  nameDy: 1, subDy: 19, numberDy: 5,
});
/** Deeper, for a phone held upright: half as deep again a band, and the calls two by two. */
const TALL = shape({
  cls: 'tall', W: 600, H: 240, band: 54,
  calls: { tiers: [86, 64, 210, 52], orphelins: [86, 124, 210, 52], voisins: [304, 64, 210, 52], zero: [304, 124, 210, 52] },
  nameDy: -1, subDy: 17, numberDy: 7,
});

/** A point on the band's middle line at distance s (from the right end's middle, clockwise), and the outward normal there. */
function along(sh: Shape, s: number): { x: number; y: number; nx: number; ny: number } {
  const { W, R, RM, straight, perimeter } = sh;
  const quarter = (Math.PI / 2) * RM;
  let d = ((s % perimeter) + perimeter) % perimeter;
  const arc = (cx: number, a: number) => ({ x: cx + RM * Math.cos(a), y: R + RM * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a) });
  if (d < quarter) return arc(W - R, d / RM);
  d -= quarter;
  if (d < straight) return { x: W - R - d, y: R + RM, nx: 0, ny: 1 };
  d -= straight;
  if (d < Math.PI * RM) return arc(R, Math.PI / 2 + d / RM);
  d -= Math.PI * RM;
  if (d < straight) return { x: R + d, y: R - RM, nx: 0, ny: -1 };
  d -= straight;
  return arc(W - R, (3 * Math.PI) / 2 + d / RM);
}

/** One number's cell: the band between s0 and s1, as a path. */
function cellPath(sh: Shape, s0: number, s1: number): string {
  const outer: string[] = [];
  const inner: string[] = [];
  const steps = 6;
  const half = sh.band / 2;
  for (let i = 0; i <= steps; i++) {
    const p = along(sh, s0 + ((s1 - s0) * i) / steps);
    outer.push(`${(p.x + p.nx * half).toFixed(2)},${(p.y + p.ny * half).toFixed(2)}`);
    inner.push(`${(p.x - p.nx * half).toFixed(2)},${(p.y - p.ny * half).toFixed(2)}`);
  }
  return `M${outer.join('L')}L${inner.reverse().join('L')}Z`;
}

export class Racetrack {
  readonly root = el('section', 'rl-track panel');
  /** Each number's cell in both shapes. */
  private readonly cells = new Map<number, SVGGElement[]>();
  private readonly count = el('span', 'rl-track-count money');
  private readonly slots: HTMLButtonElement[] = [];
  private readonly saveBtn: HTMLButtonElement;
  private readonly fewer: HTMLButtonElement;
  private readonly more: HTMLButtonElement;
  private saving = false;
  private k: number;
  /** Open as the player left it, and stepped aside while the ball is in play. */
  private wanted = false;
  private away = false;
  private touchTimer = 0;

  constructor(private readonly variant: Variant, private readonly h: TrackHandlers, k: number) {
    this.k = k;
    this.root.setAttribute('aria-label', 'Racetrack and favourite layouts');
    this.root.hidden = true;

    // the head: the neighbours count, the favourites, and close
    const head = el('div', 'rl-track-head');
    const nb = el('div', 'rl-track-nb');
    nb.setAttribute('role', 'group');
    nb.setAttribute('aria-label', 'Neighbours each side');
    this.fewer = button('−', () => this.setCount(this.k - 1), { cls: 'rl-step', title: 'One neighbour fewer each side' });
    this.more = button('+', () => this.setCount(this.k + 1), { cls: 'rl-step', title: 'One neighbour more each side' });
    this.fewer.setAttribute('aria-label', 'One neighbour fewer each side');
    this.more.setAttribute('aria-label', 'One neighbour more each side');
    nb.append(el('span', 'label', 'Neighbours'), this.fewer, this.count, this.more);

    const favs = el('div', 'rl-favs');
    favs.setAttribute('role', 'group');
    favs.setAttribute('aria-label', 'Favourite layouts');
    favs.append(el('span', 'label', 'Favourites'));
    for (let i = 0; i < SLOTS; i++) {
      const b = button(String(i + 1), () => (this.saving ? this.save(i) : h.placeSlot(i)), { cls: 'rl-fav' });
      this.slots.push(b);
      favs.append(b);
    }
    this.saveBtn = button('Save', () => this.setSaving(!this.saving), { cls: 'rl-fav-save', title: 'Keep the chips on the layout as a favourite: press Save, then a slot' });
    favs.append(this.saveBtn);
    const close = button('×', () => h.close(), { cls: 'rl-track-close', title: 'Close the racetrack (L)' });
    close.setAttribute('aria-label', 'Close the racetrack');
    head.append(el('span', 'rl-track-title', 'Racetrack'), nb, favs, close);

    // the track, in both shapes (the stylesheet shows the one that fits)
    this.root.append(head, this.draw(WIDE), this.draw(TALL));
    this.setCount(k, false);
  }

  private draw(sh: Shape): SVGSVGElement {
    const { W, H } = sh;
    const track = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: `rl-track-svg ${sh.cls}`, role: 'group', 'aria-label': 'The wheel in order: a number and its neighbours' });
    track.append(svg('rect', { x: 0.5, y: 0.5, width: W - 1, height: H - 1, rx: sh.R - 0.5, class: 'rl-track-bg' }));
    const order = WHEEL[this.variant];
    const cell = sh.perimeter / order.length;
    order.forEach((n, i) => {
      const s = i * cell;
      const g = svg('g', { class: `rl-cell ${colorOf(n)}`, tabindex: 0, role: 'button' });
      g.dataset.n = String(n);
      const path = svg('path', { d: cellPath(sh, s - cell / 2, s + cell / 2) });
      const mid = along(sh, s);
      const label = svg('text', { x: mid.x.toFixed(1), y: (mid.y + sh.numberDy).toFixed(1), 'text-anchor': 'middle' });
      label.textContent = pocketLabel(n);
      g.append(path, label);
      this.hookup(g, { kind: 'neighbours', n });
      this.cells.set(n, [...(this.cells.get(n) ?? []), g]);
      track.append(g);
    });
    const inner = svg('g', { class: 'rl-track-inner' });
    const calls = callsFor(this.variant);
    if (calls.length === 0) {
      const hint = svg('text', { x: W / 2, y: H / 2 + sh.numberDy, 'text-anchor': 'middle', class: 'rl-track-hint' });
      hint.textContent = 'Pick a number to bet it and its neighbours';
      inner.append(hint);
    }
    for (const c of calls) {
      const [x, y, w, h] = sh.calls[c.id];
      const g = svg('g', { class: 'rl-call', tabindex: 0, role: 'button' });
      g.append(svg('rect', { x, y, width: w, height: h, rx: 8 }));
      const name = svg('text', { x: x + w / 2, y: y + h / 2 + sh.nameDy, 'text-anchor': 'middle', class: 'rl-call-name' });
      name.textContent = c.short.toUpperCase();
      const chips = svg('text', { x: x + w / 2, y: y + h / 2 + sh.subDy, 'text-anchor': 'middle', class: 'rl-call-sub' });
      chips.textContent = `${c.pieces.reduce((a, p) => a + p.units, 0)} chips`;
      g.append(name, chips);
      this.hookup(g, { kind: 'call', id: c.id });
      inner.append(g);
    }
    track.append(inner);
    return track;
  }

  private hookup(g: SVGGElement, p: TrackPick): void {
    const label = p.kind === 'call' ? callsFor(this.variant).find((c) => c.id === p.id)!.name : `${pocketLabel(p.n)} and its neighbours`;
    g.setAttribute('aria-label', label);
    g.addEventListener('click', () => this.h.pick(p));
    g.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      this.h.pick(p);
    });
    g.addEventListener('pointerenter', (e) => {
      clearTimeout(this.touchTimer);
      this.h.hover(p, e.clientX, e.clientY);
    });
    g.addEventListener('pointermove', (e) => this.h.hover(p, e.clientX, e.clientY));
    g.addEventListener('pointerleave', (e) => {
      // a finger lifts as it taps: its card stays a moment, as a tap on the layout's does
      clearTimeout(this.touchTimer);
      if (e.pointerType === 'touch') this.touchTimer = window.setTimeout(() => this.h.hover(null, 0, 0), 2400);
      else this.h.hover(null, 0, 0);
    });
    g.addEventListener('focus', () => {
      const r = g.getBoundingClientRect();
      this.h.hover(p, r.left + r.width / 2, r.top);
    });
    g.addEventListener('blur', () => this.h.hover(null, 0, 0));
  }

  /** Whether the player has it open (it may be stepped aside for a spin). */
  get open(): boolean {
    return this.wanted;
  }

  show(on: boolean): void {
    this.wanted = on;
    if (!on) this.setSaving(false);
    this.root.hidden = !this.wanted || this.away;
  }

  /** Step aside while the ball is in play, and come back after. */
  stepAside(on: boolean): void {
    this.away = on;
    if (on) clearTimeout(this.touchTimer);
    this.root.hidden = !this.wanted || this.away;
  }

  dispose(): void {
    clearTimeout(this.touchTimer);
    this.root.remove();
  }

  /** Light these numbers on the track (the ones the hovered bet covers). */
  light(numbers: readonly number[]): void {
    const set = new Set(numbers);
    for (const [n, gs] of this.cells) for (const g of gs) g.classList.toggle('lit', set.has(n));
  }

  /** Bets can go down now (a closed window greys the track). */
  setOpen(open: boolean): void {
    this.root.classList.toggle('closed', !open);
  }

  /** What each favourite holds, for its button. */
  setSlots(slots: readonly (Layout | null)[]): void {
    slots.forEach((s, i) => {
      const b = this.slots[i]!;
      b.firstChild!.textContent = s ? `${i + 1} · ${formatMoney(layoutTotal(s))}` : `${i + 1}`;
      b.classList.toggle('empty', !s);
      b.title = s ? `Favourite ${i + 1}: ${Object.keys(s).length} spots, ${formatMoney(layoutTotal(s))}. Press to put it down` : `Favourite ${i + 1} is empty: press Save, then this slot`;
      b.disabled = !this.saving && !s;
    });
  }

  private setSaving(on: boolean): void {
    this.saving = on;
    this.root.classList.toggle('saving', on);
    this.saveBtn.setAttribute('aria-pressed', String(on));
    this.saveBtn.firstChild!.textContent = on ? 'Pick a slot' : 'Save';
    for (const b of this.slots) b.disabled = !on && b.classList.contains('empty');
  }

  private save(slot: number): void {
    this.h.saveSlot(slot);
    this.setSaving(false);
  }

  private setCount(k: number, tell = true): void {
    this.k = Math.max(1, Math.min(4, k));
    this.count.textContent = String(this.k);
    this.fewer.disabled = this.k <= 1;
    this.more.disabled = this.k >= 4;
    if (tell) this.h.neighbours(this.k);
  }

  get neighbours(): number {
    return this.k;
  }
}
