// Chips on the Sic Bo layout. Single player uses the casino's value chips; at a shared table each
// player bets chips of their own colour, so a glance tells whose bet is whose, stacked on top of
// each other on a shared spot. Materials are made once per denomination or colour and shared.

import * as THREE from 'three';
import { chipBreakdown, type Cents, type ChipSpec } from '../../../../shared/src/money.ts';
import { CHIP_R, CHIP_H, chipFaceCanvas } from '../../table/chips.ts';

/** One colour per seat, distinct from each other and from the layout's jade, red and gold. */
export const SEAT_COLORS = ['#2f6fd6', '#e3a21a', '#8e4fd6', '#27b3cf', '#e0709f', '#e06a28', '#efe6d2', '#8a5a33'] as const;

export function seatColor(seat: number): string {
  return SEAT_COLORS[seat % SEAT_COLORS.length]!;
}

/** A little larger than life, so a chip reads against a 15 cm box from the rail. */
export const CHIP_SCALE = 1.2;

export type PileStyle = { kind: 'value' } | { kind: 'color'; color: string };

const geo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 36);
const mats = new Map<string, THREE.Material[]>();

function texture(c: HTMLCanvasElement, wrap = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (wrap) t.wrapS = THREE.RepeatWrapping;
  return t;
}

function sideCanvas(body: string, spots: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 16;
  const g = c.getContext('2d')!;
  g.fillStyle = body;
  g.fillRect(0, 0, 256, 16);
  g.fillStyle = spots;
  for (let i = 0; i < 6; i++) g.fillRect(i * (256 / 6) + 8, 0, 256 / 6 / 3, 16);
  return c;
}

/** A player's colour chip: no value printed, their colour with white inserts. */
function colorFaceCanvas(color: string): HTMLCanvasElement {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = size / 2;
  g.translate(r, r);
  g.fillStyle = color;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f7f2ea';
  for (let i = 0; i < 8; i++) {
    g.save();
    g.rotate((i / 8) * Math.PI * 2);
    g.fillRect(-r * 0.09, -r, r * 0.18, r * 0.22);
    g.restore();
  }
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = r * 0.06;
  g.beginPath();
  g.arc(0, 0, r * 0.56, 0, Math.PI * 2);
  g.stroke();
  return c;
}

function materialsFor(key: string, make: () => THREE.Material[]): THREE.Material[] {
  let m = mats.get(key);
  if (!m) {
    m = make();
    mats.set(key, m);
  }
  return m;
}

function valueMaterials(spec: ChipSpec): THREE.Material[] {
  return materialsFor(`v${spec.value}`, () => {
    const top = new THREE.MeshStandardMaterial({ map: texture(chipFaceCanvas(spec, 128)), roughness: 0.4 });
    return [new THREE.MeshStandardMaterial({ map: texture(sideCanvas(spec.body, spec.spots), true), roughness: 0.45 }), top, top];
  });
}

function colorMaterials(color: string): THREE.Material[] {
  return materialsFor(`c${color}`, () => {
    const top = new THREE.MeshStandardMaterial({ map: texture(colorFaceCanvas(color)), roughness: 0.4 });
    return [new THREE.MeshStandardMaterial({ map: texture(sideCanvas(color, '#f7f2ea'), true), roughness: 0.45 }), top, top];
  });
}

const MAX_SHOWN = 10;

/** A pile worth `amount`, largest chips at the bottom. Its origin is at its base. */
export class Pile extends THREE.Group {
  amount: Cents = 0;
  height = 0;

  constructor(readonly style: PileStyle) {
    super();
    this.scale.setScalar(CHIP_SCALE);
  }

  set(amount: Cents): this {
    this.amount = amount;
    this.clear();
    const chips: ChipSpec[] = [];
    for (const { chip, count } of chipBreakdown(amount).stacks) for (let i = 0; i < count; i++) chips.push(chip);
    // a tall pile shows its top chips only; the tooltip and the pills carry the exact amount
    const shown = chips.slice(Math.max(0, chips.length - MAX_SHOWN));
    shown.forEach((spec, i) => {
      const m = new THREE.Mesh(geo, this.style.kind === 'value' ? valueMaterials(spec) : colorMaterials(this.style.color));
      // real stacks are never quite square
      m.position.set((((i * 7919) % 13) / 13 - 0.5) * 0.0012, CHIP_H / 2 + i * CHIP_H, (((i * 104729) % 11) / 11 - 0.5) * 0.0012);
      m.rotation.y = (i * 1.7) % (Math.PI * 2);
      this.add(m);
    });
    this.height = shown.length * CHIP_H * CHIP_SCALE;
    return this;
  }
}

/** Everything on the layout: one pile per (seat, spot), stacked in seat order on a shared spot. */
export class LayoutChips {
  readonly root = new THREE.Group();
  private readonly piles = new Map<string, Pile>();

  constructor(
    private readonly anchor: (key: string) => [number, number] | null,
    private readonly styleOf: (seat: number) => PileStyle,
    private readonly y: number,
  ) {}

  private static id(seat: number, key: string): string {
    return `${seat}|${key}`;
  }

  /** Make the layout show exactly these bets. Returns the piles that grew (for the drop animation). */
  sync(bets: Record<number, Record<string, Cents>>): Pile[] {
    const want = new Map<string, Cents>();
    for (const [seat, spots] of Object.entries(bets)) for (const [key, amount] of Object.entries(spots)) if (amount > 0) want.set(LayoutChips.id(Number(seat), key), amount);
    const grown: Pile[] = [];
    const touched = new Set<string>();
    for (const [id, pile] of this.piles) {
      if (want.has(id)) continue;
      pile.removeFromParent();
      this.piles.delete(id);
      touched.add(id.split('|')[1]!);
    }
    for (const [id, amount] of want) {
      const [seatStr, key] = id.split('|') as [string, string];
      let pile = this.piles.get(id);
      if (pile && pile.amount === amount) continue;
      if (!pile) {
        pile = new Pile(this.styleOf(Number(seatStr)));
        this.piles.set(id, pile);
        this.root.add(pile);
      }
      if (amount > pile.amount) grown.push(pile);
      pile.set(amount);
      touched.add(key);
    }
    for (const key of touched) this.restack(key);
    return grown;
  }

  /** Seats' piles on one spot sit on top of each other, lowest seat first. */
  restack(key: string): void {
    const a = this.anchor(key);
    if (!a) return;
    const here = [...this.piles.entries()].filter(([id]) => id.endsWith(`|${key}`)).sort((x, y) => Number(x[0].split('|')[0]) - Number(y[0].split('|')[0]));
    let h = 0;
    for (const [, pile] of here) {
      pile.position.set(a[0], this.y + h, a[1]);
      h += pile.height;
    }
  }

  /** Height of everything stacked on a spot (for the ghost chip and the pills). */
  heightAt(key: string): number {
    let h = 0;
    for (const [id, pile] of this.piles) if (id.endsWith(`|${key}`)) h += pile.height;
    return h;
  }

  /** Every pile on a spot, for lighting a winner. */
  pilesAt(key: string): Pile[] {
    return [...this.piles.entries()].filter(([id]) => id.endsWith(`|${key}`)).map(([, p]) => p);
  }

  /** Take a pile off the layout without destroying it (for the sweep and the payout animations). */
  detach(seat: number, key: string): Pile | null {
    const id = LayoutChips.id(seat, key);
    const pile = this.piles.get(id);
    if (!pile) return null;
    this.piles.delete(id);
    return pile;
  }

  clear(): void {
    for (const pile of this.piles.values()) pile.removeFromParent();
    this.piles.clear();
  }
}
