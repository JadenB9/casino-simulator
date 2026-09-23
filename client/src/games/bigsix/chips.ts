// Chips on the layout. Alone at the table you bet the casino's value chips; at a shared table
// every player gets chips of their own colour, each in their own place on every spot (layout.ts),
// so nobody's bet gets mixed up with anyone else's. Materials are made once per denomination or
// colour and shared by every chip.

import * as THREE from 'three';
import { chipBreakdown, type Cents, type ChipSpec } from '../../../../shared/src/money.ts';
import type { SymbolId } from '../../../../shared/src/games/bigsix/rules.ts';
import { CHIP_R, CHIP_H, chipFaceCanvas } from '../../table/chips.ts';

/** One colour per seat, distinct from each other and from the spots' panels. */
export const SEAT_COLORS = ['#2f6fd6', '#e3a21a', '#8e4fd6', '#27b3cf', '#e0709f', '#e06a28', '#efe6d2', '#8a5a33'] as const;

export function seatColor(seat: number): string {
  return SEAT_COLORS[seat % SEAT_COLORS.length]!;
}

/** Chips here are drawn a little larger than life so they read from the rail. */
export const CHIP_SCALE = 1.35;

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

/** A player's colour chip: no value printed, the colour with white inserts. */
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
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.beginPath();
  g.arc(0, 0, r * 0.5, 0, Math.PI * 2);
  g.fill();
  return c;
}

function valueMaterials(spec: ChipSpec): THREE.Material[] {
  const key = `v${spec.value}`;
  let m = mats.get(key);
  if (!m) {
    const side = new THREE.MeshStandardMaterial({ map: texture(sideCanvas(spec.body, spec.spots), true), roughness: 0.45 });
    const top = new THREE.MeshStandardMaterial({ map: texture(chipFaceCanvas(spec, 128)), roughness: 0.4 });
    m = [side, top, top];
    mats.set(key, m);
  }
  return m;
}

function colorMaterials(color: string): THREE.Material[] {
  const key = `c${color}`;
  let m = mats.get(key);
  if (!m) {
    const side = new THREE.MeshStandardMaterial({ map: texture(sideCanvas(color, '#f7f2ea'), true), roughness: 0.45 });
    const top = new THREE.MeshStandardMaterial({ map: texture(colorFaceCanvas(color)), roughness: 0.4 });
    m = [side, top, top];
    mats.set(key, m);
  }
  return m;
}

const MAX_SHOWN = 12;

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
    for (const c of [...this.children]) this.remove(c);
    const chips: ChipSpec[] = [];
    for (const { chip, count } of chipBreakdown(amount).stacks) for (let i = 0; i < count; i++) chips.push(chip);
    // a big pile shows its top chips only; the tooltip and pills carry the exact amount
    const shown = chips.slice(Math.max(0, chips.length - MAX_SHOWN));
    shown.forEach((spec, i) => {
      const m = new THREE.Mesh(geo, this.style.kind === 'value' ? valueMaterials(spec) : colorMaterials(this.style.color));
      // real stacks are never quite square
      const wobble = ((i * 7919) % 13) / 13 - 0.5;
      m.position.set(wobble * 0.0012, CHIP_H / 2 + i * CHIP_H, (((i * 104729) % 11) / 11 - 0.5) * 0.0012);
      m.rotation.y = (i * 1.7) % (Math.PI * 2);
      this.add(m);
    });
    this.height = shown.length * CHIP_H * CHIP_SCALE;
    return this;
  }
}

/** Every bet on the layout: one pile per (seat, spot), each at its own place. */
export class LayoutChips {
  readonly root = new THREE.Group();
  readonly piles = new Map<string, Pile>();

  constructor(
    private readonly place: (seat: number, key: SymbolId) => THREE.Vector3,
    private readonly styleOf: (seat: number) => PileStyle,
  ) {}

  static id(seat: number, key: string): string {
    return `${seat}|${key}`;
  }

  pile(seat: number, key: SymbolId): Pile | undefined {
    return this.piles.get(LayoutChips.id(seat, key));
  }

  /** Make the layout show exactly these bets. Returns the piles that grew (for the drop animation). */
  sync(bets: Record<number, Partial<Record<SymbolId, Cents>>>): Pile[] {
    const want = new Map<string, Cents>();
    for (const [seat, spots] of Object.entries(bets)) {
      for (const [key, amount] of Object.entries(spots)) if (amount && amount > 0) want.set(LayoutChips.id(Number(seat), key), amount);
    }
    for (const [id, pile] of this.piles) {
      if (!want.has(id)) {
        pile.removeFromParent();
        this.piles.delete(id);
      }
    }
    const grown: Pile[] = [];
    for (const [id, amount] of want) {
      const [seatStr, key] = id.split('|') as [string, SymbolId];
      const seat = Number(seatStr);
      let pile = this.piles.get(id);
      if (pile && pile.amount === amount && pile.style.kind === this.styleOf(seat).kind) continue;
      if (pile && pile.style.kind !== this.styleOf(seat).kind) {
        pile.removeFromParent();
        pile = undefined;
      }
      if (!pile) {
        pile = new Pile(this.styleOf(seat));
        this.piles.set(id, pile);
        this.root.add(pile);
      }
      if (amount > pile.amount) grown.push(pile);
      pile.set(amount);
      pile.position.copy(this.place(seat, key));
    }
    return grown;
  }

  /** Take a pile off the layout without destroying it (for sweeping and paying animations). */
  detach(seat: number, key: SymbolId): Pile | null {
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
