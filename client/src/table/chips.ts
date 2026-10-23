// Casino chips, drawn in code: the body colour, six edge spots that run over the rim, a printed
// ring and the inlay with the value large in the middle. One face and one side texture per
// denomination, and one set of materials, shared by every chip of that value at every table. A
// pile draws each denomination's chips as one instanced mesh (a chip was a mesh of its own, three
// draws apiece), stacked by hand: a hair off true and turned every which way, with a soft shadow
// on the felt under it.

import * as THREE from 'three';
import { CHIPS, chipBreakdown, type ChipSpec, type Cents } from '../../../shared/src/money.ts';
import { tween, ease } from './tween.ts';
import { GroundShadow, shadowPlane, softRect, type ShadowShape } from './shadow.ts';

export const CHIP_R = 0.0197; // 39 mm across, the standard casino chip
export const CHIP_H = 0.0033;
const MAX_STACK = 20;

const faceCache = new Map<number, THREE.CanvasTexture>();
const sideCache = new Map<number, THREE.CanvasTexture>();

/**
 * The colour a chip prints its value in on its cream inlay: its own body colour, or for a light chip
 * (the white $1, the yellow $1,000, the grey $5,000) its dark ink, which a light colour on cream
 * wasn't readable against.
 */
function inkOf(spec: ChipSpec): string {
  const c = new THREE.Color(spec.body);
  const light = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return light > 0.25 ? spec.ink : spec.body;
}

/**
 * A chip's face, `size` px square: the body, six edge spots (curved to the rim, as the inserts are
 * cut), a ring of fine printed dashes, the inlay with a keyline and the value, and a soft sheen
 * that reads as the chip's gloss whichever way it's turned.
 */
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
  // edge spots: six inserts, cut to the rim
  g.fillStyle = spec.spots;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const half = 0.2;
    g.beginPath();
    g.arc(0, 0, r, a - half, a + half);
    g.arc(0, 0, r * 0.78, a + half * 0.92, a - half * 0.92, true);
    g.closePath();
    g.fill();
  }
  // the printed ring between the spots and the inlay: fine dashes in the spots' colour
  g.strokeStyle = spec.spots;
  g.globalAlpha = 0.85;
  g.lineWidth = r * 0.035;
  g.setLineDash([r * 0.05, r * 0.06]);
  g.beginPath();
  g.arc(0, 0, r * 0.71, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  g.globalAlpha = 1;
  // the inlay: a cream label with its edge, and a keyline in the value's colour
  g.fillStyle = 'rgba(250, 246, 238, 0.96)';
  g.beginPath();
  g.arc(0, 0, r * 0.6, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(0, 0, 0, 0.28)';
  g.lineWidth = r * 0.025;
  g.stroke();
  g.strokeStyle = inkOf(spec);
  g.lineWidth = r * 0.045;
  g.beginPath();
  g.arc(0, 0, r * 0.51, 0, Math.PI * 2);
  g.stroke();
  // the value, as large as the inlay takes
  g.fillStyle = inkOf(spec);
  const n = spec.label.length;
  g.font = `600 ${Math.round(r * (n > 4 ? 0.34 : n > 3 ? 0.4 : n > 2 ? 0.48 : 0.56))}px "Barlow Condensed", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(spec.label, 0, r * 0.03);
  // the gloss: lighter in the middle, a touch darker toward the rim (the same at any turn)
  const sheen = g.createRadialGradient(0, -r * 0.1, r * 0.1, 0, 0, r);
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
  sheen.addColorStop(0.7, 'rgba(255, 255, 255, 0)');
  sheen.addColorStop(1, 'rgba(0, 0, 0, 0.18)');
  g.fillStyle = sheen;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  return c;
}

/**
 * A chip's edge, all the way round: the body with the six spots across it, and darker along both
 * rims, so the chips of a pile read one from the next.
 */
export function chipSideCanvas(spec: ChipSpec): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 16;
  const g = c.getContext('2d')!;
  g.fillStyle = spec.body;
  g.fillRect(0, 0, 256, 16);
  g.fillStyle = spec.spots;
  for (let i = 0; i < 6; i++) g.fillRect(i * (256 / 6) + 8, 0, 256 / 6 / 3, 16);
  // rounded over at the rims: darker at the top and bottom, a little lighter along the middle
  const shade = g.createLinearGradient(0, 0, 0, 16);
  shade.addColorStop(0, 'rgba(0, 0, 0, 0.42)');
  shade.addColorStop(0.2, 'rgba(0, 0, 0, 0.05)');
  shade.addColorStop(0.5, 'rgba(255, 255, 255, 0.1)');
  shade.addColorStop(0.8, 'rgba(0, 0, 0, 0.05)');
  shade.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
  g.fillStyle = shade;
  g.fillRect(0, 0, 256, 16);
  return c;
}

function faceTexture(spec: ChipSpec): THREE.CanvasTexture {
  let t = faceCache.get(spec.value);
  if (!t) {
    t = new THREE.CanvasTexture(chipFaceCanvas(spec));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.userData.shared = true;
    faceCache.set(spec.value, t);
  }
  return t;
}

function sideTexture(spec: ChipSpec): THREE.CanvasTexture {
  let t = sideCache.get(spec.value);
  if (!t) {
    t = new THREE.CanvasTexture(chipSideCanvas(spec));
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.userData.shared = true;
    sideCache.set(spec.value, t);
  }
  return t;
}

/** A chip: the edge, then both faces in one group (two draws a pile per denomination, not three). */
function chipGeometry(): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 40);
  // CylinderGeometry lays its index out edge first, then the top and bottom caps
  const [side, top, bottom] = g.groups;
  g.clearGroups();
  g.addGroup(side!.start, side!.count, 0);
  g.addGroup(top!.start, top!.count + bottom!.count, 1);
  g.userData.shared = true;
  return g;
}

const geo = chipGeometry();
const materials = new Map<number, THREE.Material[]>();

/** The edge and the faces of a denomination, made once and shared by every chip of it. */
function chipMaterials(spec: ChipSpec): THREE.Material[] {
  let m = materials.get(spec.value);
  if (!m) {
    const side = new THREE.MeshStandardMaterial({ map: sideTexture(spec), roughness: 0.42 });
    const top = new THREE.MeshStandardMaterial({ map: faceTexture(spec), roughness: 0.36 });
    side.userData.shared = top.userData.shared = true;
    m = [side, top];
    materials.set(spec.value, m);
  }
  return m;
}

let pileShadow: ShadowShape | null = null;
/** The soft round shadow under a pile, a chip's width; GroundShadow.radius widens it for more columns. */
function shadowShape(): ShadowShape {
  return (pileShadow ??= {
    geometry: shadowPlane(2 * CHIP_R, 2 * CHIP_R, 0.006),
    alpha: softRect(2 * CHIP_R, 2 * CHIP_R, CHIP_R, 0.006, 32),
    strength: 0.34,
    follow: 'disc',
    under: 0,
  });
}

/** A small, fixed scatter per place in the pile, so a pile looks stacked by hand and the same each time. */
function scatter(i: number): number {
  const s = Math.sin(i * 12.9898 + 4.1) * 43758.5453;
  return s - Math.floor(s) - 0.5;
}

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

/** A pile of chips worth `amount`, built largest denomination at the bottom, in columns of 20. */
export class ChipStack extends THREE.Group {
  amount: Cents = 0;
  private readonly shadow = new GroundShadow(this, shadowShape());

  constructor() {
    super();
    this.shadow.radius = 0;
    this.add(this.shadow);
    // a pile taken off the table gives its instances' buffers back (drawn again, three uploads them again)
    this.addEventListener('removed', () => {
      for (const c of this.children) if (c instanceof THREE.InstancedMesh) c.dispose();
    });
  }

  set(amount: Cents): void {
    this.amount = amount;
    for (const child of [...this.children]) {
      if (child === this.shadow) continue;
      this.remove(child);
      // a pile's instances are its own (the geometry and materials are shared)
      if (child instanceof THREE.InstancedMesh) child.dispose();
    }
    const { stacks } = chipBreakdown(amount);
    let column = 0;
    let height = 0;
    let n = 0;
    let reach = 0;
    for (const { chip, count } of stacks) {
      const mesh = new THREE.InstancedMesh(geo, chipMaterials(chip), count);
      for (let i = 0; i < count; i++) {
        if (height >= MAX_STACK) {
          column++;
          height = 0;
        }
        const angle = column * 2.1;
        const off = column === 0 ? 0 : CHIP_R * 2.1;
        // each chip a fraction of a millimetre off true, and turned its own way
        _p.set(Math.cos(angle) * off + scatter(n) * 0.0007, CHIP_H / 2 + height * CHIP_H, Math.sin(angle) * off + scatter(n + 50) * 0.0007);
        _q.setFromAxisAngle(UP, (n * 1.7) % (Math.PI * 2));
        mesh.setMatrixAt(i, _m4.compose(_p, _q, ONE));
        reach = Math.max(reach, off);
        height++;
        n++;
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      this.add(mesh);
    }
    // the shadow takes in every column
    this.shadow.radius = n === 0 ? 0 : 1 + reach / CHIP_R;
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
