// The machine's screen as DOM, laid exactly over the cabinet's screen: the blue pay glass with
// the bet's coin column in red, the status line, five cards with their HELD labels, and the WIN /
// BET / CREDITS meters. It is built at a fixed 800 x 600 and mapped onto the four projected
// corners of the 3D screen every frame, so it stays glued to the machine while the camera moves
// and is a plain scaled rectangle (crisp text) once the camera sits square to it.

import * as THREE from 'three';
import type { Card } from '../../../../shared/src/cards.ts';
import { PAYTABLE, HAND_NAMES } from '../../../../shared/src/games/videopoker/hands.ts';
import { el } from '../../ui/kit.ts';
import { tween, ease } from '../../table/tween.ts';

export const DESIGN_W = 800;
export const DESIGN_H = 600;

const base = import.meta.env.BASE_URL;
const cardUrl = (card: Card | null) => `${base}assets/cards/${card ?? 'back-red'}.svg`;

/** Screen names, as the glass prints them. */
export const GLASS_NAMES: readonly string[] = HAND_NAMES.map((n) => n.replace('Four of a Kind', '4 of a Kind').replace('Three of a Kind', '3 of a Kind').replace('Two Pair', '2 Pair').toUpperCase());

interface Slot {
  root: HTMLButtonElement;
  held: HTMLElement;
  img: HTMLImageElement;
  card: Card | null;
}

export class MachineScreen {
  readonly root = el('div', 'vp-screen');
  private rows = new Map<number, { row: HTMLElement; cells: HTMLElement[] }>();
  private slots: Slot[] = [];
  private status = el('div', 'vp-status');
  private winValue = el('span', 'vp-value', '0');
  private betValue = el('span', 'vp-value', '5');
  private creditValue = el('span', 'vp-value', '0');
  private cash = el('span', 'vp-cash', '');
  private help = el('div', 'vp-help');
  readonly denomButton = el('button', 'vp-denom', '$1');

  constructor(onCard: (i: number) => void, onDenom: () => void) {
    const pays = el('div', 'vp-pays');
    for (const row of PAYTABLE) {
      const r = el('div', 'vp-row');
      const cells = row.pays.map((p) => el('span', 'vp-cell', String(p)));
      r.append(el('span', 'vp-name', GLASS_NAMES[row.rank]!), ...cells);
      pays.append(r);
      this.rows.set(row.rank, { row: r, cells });
    }

    const cards = el('div', 'vp-cards');
    for (let i = 0; i < 5; i++) {
      const root = el('button', 'vp-slot');
      root.type = 'button';
      root.title = `Hold card ${i + 1} (${i + 1})`;
      const held = el('span', 'vp-held', 'HELD');
      const img = el('img', 'vp-card');
      img.alt = '';
      img.draggable = false;
      img.src = cardUrl(null);
      root.append(held, img);
      // A mouse press shouldn't leave focus on the card, or Space would press it again.
      root.addEventListener('mousedown', (e) => e.preventDefault());
      root.addEventListener('click', () => onCard(i));
      cards.append(root);
      this.slots.push({ root, held, img, card: null });
    }

    this.denomButton.type = 'button';
    this.denomButton.title = 'Coin value (D)';
    this.denomButton.addEventListener('mousedown', (e) => e.preventDefault());
    this.denomButton.addEventListener('click', onDenom);
    const meter = (label: string, value: HTMLElement, extra?: HTMLElement) => {
      const m = el('div', 'vp-meter');
      m.append(el('span', 'vp-label', label), value);
      if (extra) m.append(extra);
      return m;
    };
    const bar = el('div', 'vp-bar');
    bar.append(this.denomButton, meter('WIN', this.winValue), meter('BET', this.betValue), meter('CREDITS', this.creditValue, this.cash));

    this.help.hidden = true;
    this.help.append(
      el('h3', '', 'JACKS OR BETTER · 9/6'),
      el('p', '', 'Bet 1 to 5 coins and deal five cards. Hold any of them, then draw: the rest are replaced from the same deck. A pair of jacks or better returns the bet.'),
      el('p', '', 'Return with perfect play: 99.54% at 5 coins (the royal pays 4,000), 98.37% at 1 to 4 coins (250 a coin).'),
      el('p', 'vp-keys', 'HOLD 1-5   ·   DEAL / DRAW Space   ·   BET ONE ↑ ↓   ·   BET MAX B   ·   COIN VALUE D   ·   PAYS H'),
    );
    this.root.append(pays, this.status, cards, bar, this.help);
  }

  setCoins(coins: number): void {
    this.betValue.textContent = String(coins);
    for (const { cells } of this.rows.values()) cells.forEach((c, i) => c.classList.toggle('on', i === coins - 1));
  }

  /** Highlight one pay row: 'made' dimly after the deal, 'win' flashing, 'paid' steady. */
  setRow(rank: number | null, kind: 'made' | 'win' | 'paid' = 'win'): void {
    for (const [r, { row }] of this.rows) {
      row.classList.toggle('made', r === rank && kind === 'made');
      row.classList.toggle('win', r === rank && kind === 'win');
      row.classList.toggle('paid', r === rank && kind === 'paid');
    }
  }

  setStatus(text: string, kind: 'hand' | 'over' | 'dim' | 'info' = 'hand'): void {
    this.status.textContent = text;
    this.status.className = `vp-status ${kind}`;
  }

  setMeters(win: number, credits: number, cash: string): void {
    // Machines print meters as bare numbers, like the glass: 4000, not 4,000.
    this.winValue.textContent = String(win);
    this.creditValue.textContent = String(credits);
    this.cash.textContent = cash;
  }

  setDenom(label: string, enabled: boolean): void {
    this.denomButton.textContent = label;
    this.denomButton.disabled = !enabled;
  }

  setHeld(i: number, on: boolean): void {
    this.slots[i]!.held.classList.toggle('on', on);
  }

  setHoldable(on: boolean): void {
    for (const s of this.slots) s.root.disabled = !on;
  }

  /** Show a card (or the back) with no animation. */
  setCard(i: number, card: Card | null): void {
    const s = this.slots[i]!;
    s.card = card;
    s.img.src = cardUrl(card);
    s.img.style.transform = '';
  }

  /** Turn a card over to its back, squeezing it edge-on and out again. */
  async flipOut(i: number, ms = 90): Promise<void> {
    const s = this.slots[i]!;
    if (!s.card) return;
    await tween(ms, (k) => (s.img.style.transform = `scaleX(${1 - k})`), ease.inOut);
    this.setCard(i, null);
  }

  /** Flip a new card in from its back. */
  async flipIn(i: number, card: Card, ms = 120): Promise<void> {
    const s = this.slots[i]!;
    await tween(ms / 2, (k) => (s.img.style.transform = `scaleX(${1 - k})`), ease.inOut);
    s.card = card;
    s.img.src = cardUrl(card);
    await tween(ms / 2, (k) => (s.img.style.transform = `scaleX(${k})`), ease.out);
    s.img.style.transform = '';
  }

  toggleHelp(): void {
    this.help.hidden = !this.help.hidden;
  }

  /**
   * Map the 800 x 600 design onto four screen-space points (top-left, top-right, bottom-right,
   * bottom-left) with a projective transform (Heckbert's square-to-quad), or hide it if any corner
   * is behind the camera.
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
    const W = DESIGN_W;
    const H = DESIGN_H;
    this.root.hidden = false;
    // Square to the camera the perspective terms vanish; a 2D matrix keeps the text sharp.
    const t =
      Math.abs(g) < 1e-4 && Math.abs(h) < 1e-4
        ? `matrix(${a / W},${d / W},${b / H},${e / H},${p0!.x},${p0!.y})`
        : `matrix3d(${a / W},${d / W},0,${g / W},${b / H},${e / H},0,${h / H},0,0,1,0,${p0!.x},${p0!.y},0,1)`;
    if (t !== this.transform) this.root.style.transform = this.transform = t;
  }

  private transform = '';
}

const v = new THREE.Vector3();

/** A point in the table's local space to CSS pixels, or null when it's behind the camera. */
export function toScreen(local: THREE.Vector3, root: THREE.Object3D, camera: THREE.Camera): { x: number; y: number } | null {
  v.copy(local);
  root.localToWorld(v);
  v.applyMatrix4(camera.matrixWorldInverse);
  if (v.z > -0.01) return null;
  v.applyMatrix4((camera as THREE.PerspectiveCamera).projectionMatrix);
  return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
}
