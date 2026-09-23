// Casino chips, drawn in code: a body color, six edge inserts, an inner ring and the value. One
// texture per denomination, shared by every chip of that value; stacks are instanced.

import * as THREE from 'three';
import { CHIPS, chipBreakdown, type ChipSpec, type Cents } from '../../../shared/src/money.ts';
import { tween, ease } from './tween.ts';

export const CHIP_R = 0.0197; // 39 mm across, the standard casino chip
export const CHIP_H = 0.0033;
const MAX_STACK = 20;

const faceCache = new Map<number, THREE.CanvasTexture>();
const sideCache = new Map<number, THREE.CanvasTexture>();

export function chipFaceCanvas(spec: ChipSpec, size = 256): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = size / 2;
  g.translate(r, r);
  g.fillStyle = spec.body;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  // edge inserts
  g.fillStyle = spec.spots;
  for (let i = 0; i < 6; i++) {
    g.save();
    g.rotate((i / 6) * Math.PI * 2);
    g.fillRect(-r * 0.13, -r, r * 0.26, r * 0.2);
    g.restore();
  }
  // inlay
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.beginPath();
  g.arc(0, 0, r * 0.6, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = spec.body;
  g.lineWidth = r * 0.05;
  g.beginPath();
  g.arc(0, 0, r * 0.52, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = spec.body === '#f3efe6' ? '#23407a' : spec.body;
  g.font = `600 ${Math.round(r * (spec.label.length > 3 ? 0.36 : 0.46))}px "Barlow Condensed", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(spec.label, 0, r * 0.02);
  return c;
}

function faceTexture(spec: ChipSpec): THREE.CanvasTexture {
  let t = faceCache.get(spec.value);
  if (!t) {
    t = new THREE.CanvasTexture(chipFaceCanvas(spec));
    t.colorSpace = THREE.SRGBColorSpace;
    faceCache.set(spec.value, t);
  }
  return t;
}

function sideTexture(spec: ChipSpec): THREE.CanvasTexture {
  let t = sideCache.get(spec.value);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 16;
    const g = c.getContext('2d')!;
    g.fillStyle = spec.body;
    g.fillRect(0, 0, 256, 16);
    g.fillStyle = spec.spots;
    for (let i = 0; i < 6; i++) g.fillRect(i * (256 / 6) + 8, 0, 256 / 6 / 3, 16);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    sideCache.set(spec.value, t);
  }
  return t;
}

const geo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 40);

function chipMaterials(spec: ChipSpec): THREE.Material[] {
  const side = new THREE.MeshStandardMaterial({ map: sideTexture(spec), roughness: 0.45 });
  const top = new THREE.MeshStandardMaterial({ map: faceTexture(spec), roughness: 0.4 });
  return [side, top, top];
}

/** A pile of chips worth `amount`, built largest denomination at the bottom, in columns of 20. */
export class ChipStack extends THREE.Group {
  amount: Cents = 0;

  set(amount: Cents): void {
    this.amount = amount;
    for (const child of [...this.children]) this.remove(child);
    const { stacks } = chipBreakdown(amount);
    let column = 0;
    let height = 0;
    for (const { chip, count } of stacks) {
      const mats = chipMaterials(chip);
      for (let i = 0; i < count; i++) {
        if (height >= MAX_STACK) {
          column++;
          height = 0;
        }
        const m = new THREE.Mesh(geo, mats);
        const angle = column * 2.1;
        const off = column === 0 ? 0 : CHIP_R * 2.1;
        m.position.set(Math.cos(angle) * off, CHIP_H / 2 + height * CHIP_H, Math.sin(angle) * off);
        m.rotation.y = (i * 1.7) % (Math.PI * 2);
        this.add(m);
        height++;
      }
    }
  }
}

/** Slide a stack between two local points (paying out, collecting). */
export async function slideStack(stack: THREE.Object3D, to: THREE.Vector3, ms = 420): Promise<void> {
  const from = stack.position.clone();
  await tween(ms, (k) => {
    stack.position.lerpVectors(from, to, k);
    stack.position.y = from.y + (to.y - from.y) * k + Math.sin(Math.PI * k) * 0.01;
  }, ease.out);
}

/** The denominations a player can bet with, drawn for the chip tray (canvases, not data: URLs, which the page's CSP blocks). */
export function chipTrayCanvases(): { spec: ChipSpec; canvas: HTMLCanvasElement }[] {
  return CHIPS.filter((c) => !c.payoutOnly).map((spec) => ({ spec, canvas: chipFaceCanvas(spec, 100) }));
}
