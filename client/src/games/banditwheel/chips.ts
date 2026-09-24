// Chips in the terminals' cups. Every player's chips sit on their own terminal, so they are the
// casino's value chips at any table size. Materials are made once per denomination and shared by
// every chip.

import * as THREE from 'three';
import { chipBreakdown, type Cents, type ChipSpec } from '../../../../shared/src/money.ts';
import type { WheelNumber } from '../../../../shared/src/games/banditwheel/rules.ts';
import { CHIP_R, CHIP_H, chipFaceCanvas } from '../../table/chips.ts';

const geo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 32);
const mats = new Map<number, THREE.Material[]>();

function sideCanvas(spec: ChipSpec): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 16;
  const g = c.getContext('2d')!;
  g.fillStyle = spec.body;
  g.fillRect(0, 0, 256, 16);
  g.fillStyle = spec.spots;
  for (let i = 0; i < 6; i++) g.fillRect(i * (256 / 6) + 8, 0, 256 / 6 / 3, 16);
  return c;
}

function materialsFor(spec: ChipSpec): THREE.Material[] {
  let m = mats.get(spec.value);
  if (!m) {
    const tex = (c: HTMLCanvasElement, wrap = false) => {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      if (wrap) t.wrapS = THREE.RepeatWrapping;
      return t;
    };
    const side = new THREE.MeshStandardMaterial({ map: tex(sideCanvas(spec), true), roughness: 0.45 });
    const top = new THREE.MeshStandardMaterial({ map: tex(chipFaceCanvas(spec, 128)), roughness: 0.4 });
    m = [side, top, top];
    mats.set(spec.value, m);
  }
  return m;
}

const MAX_SHOWN = 14;

/** A pile worth `amount`, largest chips at the bottom. Its origin is at its base. */
export class Pile extends THREE.Group {
  amount: Cents = 0;
  height = 0;

  set(amount: Cents): this {
    this.amount = amount;
    for (const c of [...this.children]) this.remove(c);
    const chips: ChipSpec[] = [];
    for (const { chip, count } of chipBreakdown(amount).stacks) for (let i = 0; i < count; i++) chips.push(chip);
    // a big pile shows its top chips only; the labels and the panel carry the exact amount
    const shown = chips.slice(Math.max(0, chips.length - MAX_SHOWN));
    shown.forEach((spec, i) => {
      const m = new THREE.Mesh(geo, materialsFor(spec));
      // real stacks are never quite square
      const wobble = ((i * 7919) % 13) / 13 - 0.5;
      m.position.set(wobble * 0.0012, CHIP_H / 2 + i * CHIP_H, (((i * 104729) % 11) / 11 - 0.5) * 0.0012);
      m.rotation.y = (i * 1.7) % (Math.PI * 2);
      this.add(m);
    });
    this.height = shown.length * CHIP_H;
    return this;
  }
}

/** Every bet at the wheel: one pile per (seat, number), each in its cup. */
export class CupChips {
  readonly root = new THREE.Group();
  readonly piles = new Map<string, Pile>();

  constructor(private readonly place: (seat: number, key: WheelNumber) => THREE.Vector3) {}

  static id(seat: number, key: number): string {
    return `${seat}|${key}`;
  }

  pile(seat: number, key: WheelNumber): Pile | undefined {
    return this.piles.get(CupChips.id(seat, key));
  }

  /** Show exactly these bets. Returns the piles that grew (for the drop animation). */
  sync(bets: Record<number, Partial<Record<WheelNumber, Cents>>>): Pile[] {
    const want = new Map<string, Cents>();
    for (const [seat, spots] of Object.entries(bets)) {
      for (const [key, amount] of Object.entries(spots)) if (amount && amount > 0) want.set(CupChips.id(Number(seat), Number(key)), amount);
    }
    for (const [id, pile] of this.piles) {
      if (!want.has(id)) {
        pile.removeFromParent();
        this.piles.delete(id);
      }
    }
    const grown: Pile[] = [];
    for (const [id, amount] of want) {
      const [seatStr, keyStr] = id.split('|') as [string, string];
      let pile = this.piles.get(id);
      if (pile && pile.amount === amount) continue;
      if (!pile) {
        pile = new Pile();
        this.piles.set(id, pile);
        this.root.add(pile);
      }
      if (amount > pile.amount) grown.push(pile);
      pile.set(amount);
      pile.position.copy(this.place(Number(seatStr), Number(keyStr) as WheelNumber));
    }
    return grown;
  }

  /** Take a pile out of its cup without destroying it (for the drop and payout animations). */
  detach(seat: number, key: WheelNumber): Pile | null {
    const id = CupChips.id(seat, key);
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
