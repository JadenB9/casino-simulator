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
