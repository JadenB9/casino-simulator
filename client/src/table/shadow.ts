// Soft contact shadows on the felt: under every card and every pile of chips, so they sit on the
// cloth instead of floating over it. A shadow lies flat on the table under its owner's middle (it
// never tilts with a card turning over), takes the owner's footprint (a card's narrows as it turns
// on edge), falls on the card beneath where a card lies on another in a hand, and fades and
// spreads as its owner rises (a card dealt through the air, a pile slid across). The felt's height
// is the table's (TableStage.addFelt notes it): an owner with no felt under it has no shadow.
// Shadows are never picked, measured (fit.ts, celebrate.ts skip `userData.decor`) or written to
// the depth buffer.

import * as THREE from 'three';

/** The world height of the felt under `o`: its table's, as TableStage.addFelt noted it (null without one). */
export function feltHeight(o: THREE.Object3D): number | null {
  for (let p = o.parent; p; p = p.parent) {
    const y = p.userData.feltY as number | undefined;
    // (the frame's own matrices: the table's is worked out before what lies on it)
    if (y !== undefined) return _felt.set(0, y, 0).applyMatrix4(p.matrixWorld).y;
  }
  return null;
}

const _felt = new THREE.Vector3();
const _m = new THREE.Matrix4();

export interface ShadowShape {
  /** A flat plane in xz (normal +y) the shadow is drawn on, its soft edge inside it. */
  geometry: THREE.BufferGeometry;
  /** The softened footprint, as an alpha map (white dark). */
  alpha: THREE.Texture;
  /** How dark it is under an owner lying on the felt. */
  strength: number;
  /** 'card': the owner's own across and along, laid flat; 'disc': square to the table, scaled by `radius()`. */
  follow: 'card' | 'disc';
  /** The owner's underside below its origin, m (half a card's thickness; 0 for a pile standing on its base). */
  under: number;
}

export class GroundShadow extends THREE.Mesh {
  /** For a 'disc': how wide the footprint is now, as a multiple of the shape's own size. */
  radius = 1;

  constructor(
    private readonly owner: THREE.Object3D,
    private readonly shape: ShadowShape,
  ) {
    // both sides: a face-down card's footprint comes out mirrored
    super(shape.geometry, new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: shape.alpha, transparent: true, opacity: shape.strength, depthWrite: false, side: THREE.DoubleSide }));
    this.name = 'ground-shadow';
    this.userData.decor = true;
    this.matrixAutoUpdate = false;
    this.raycast = () => {};
  }

  override updateMatrixWorld(): void {
    this.place();
  }

  override updateWorldMatrix(): void {
    this.place();
  }

  private place(): void {
    const feltY = feltHeight(this.owner);
    const mat = this.material as THREE.MeshBasicMaterial;
    if (feltY === null || this.radius <= 0) {
      mat.opacity = 0;
      this.visible = false;
      return;
    }
    const e = this.owner.matrixWorld.elements;
    const sy = Math.hypot(e[4]!, e[5]!, e[6]!);
    const under = e[13]! - this.shape.under * sy;
    const h = under - feltY;
    // on the felt, or just under a card lying on another (so it falls on that one's face)
    const y = this.shape.follow === 'card' && h > 0.0003 && h < 0.004 ? under - 0.00005 : feltY + 0.0001;
    const up = Math.max(0, h);
    const spread = 1 + Math.min(0.6, up * 7);
    mat.opacity = this.shape.strength * (1 - THREE.MathUtils.smoothstep(up, 0.004, 0.07));
    this.visible = mat.opacity > 0.01;
    if (this.shape.follow === 'card') {
      // the owner's own across and along, laid flat: its footprint at any turn
      _m.set(e[0]! * spread, 0, e[8]! * spread, e[12]!, 0, 1, 0, y, e[2]! * spread, 0, e[10]! * spread, e[14]!, 0, 0, 0, 1);
    } else {
      const s = spread * this.radius * Math.hypot(e[0]!, e[1]!, e[2]!);
      _m.set(s, 0, 0, e[12]!, 0, 1, 0, y, 0, 0, s, e[14]!, 0, 0, 0, 1);
    }
    this.matrixWorld.copy(_m);
  }
}

/** A soft rounded rectangle `w` x `h` with corners `r`, softened over `reach` past its edge: an alpha map. */
export function softRect(w: number, h: number, r: number, reach: number, px = 48): THREE.Texture {
  const W = px;
  const H = Math.max(2, Math.round((W * (h + 2 * reach)) / (w + 2 * reach)));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  const sx = (w + 2 * reach) / W;
  const sz = (h + 2 * reach) / H;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      // signed distance to the outline: dark a little inside it, easing to nothing at the reach
      const x = Math.abs((i + 0.5) * sx - (w / 2 + reach)) - (w / 2 - r);
      const z = Math.abs((j + 0.5) * sz - (h / 2 + reach)) - (h / 2 - r);
      const d = Math.hypot(Math.max(x, 0), Math.max(z, 0)) + Math.min(Math.max(x, z), 0) - r;
      const k = THREE.MathUtils.smoothstep(d, -reach * 0.25, reach);
      const a = Math.round(255 * (1 - k) * (1 - k));
      img.data.set([a, a, a, 255], (j * W + i) * 4);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.userData.shared = true;
  return t;
}

/** The flat plane a soft rectangle is drawn on: `w` x `h` and its reach all round, lying in xz. */
export function shadowPlane(w: number, h: number, reach: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w + 2 * reach, h + 2 * reach).rotateX(-Math.PI / 2);
  g.userData.shared = true;
  return g;
}
