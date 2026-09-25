// The Tips mark on the felt. At craps the control Tips recommends is a spot on the layout (the
// pass line, the odds behind it, a box), so its tip-pick is drawn there: the spot's own printed
// shape, lit from underneath and breathing slowly, under any chips on it.

import * as THREE from 'three';
import type { Region } from '../../table/felt.ts';
import { REGIONS } from './layout.ts';
import { wave } from '../../app/comfort.ts';

export class SpotRing {
  readonly root = new THREE.Group();
  private readonly mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.45, 1.15, 0.62),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  private key: string | null = null;
  private t = 0;

  constructor(private readonly y: number) {
    this.root.name = 'craps-tip-ring';
  }

  /** Ring `spot` at this end of the table (1 right, -1 left); null clears it. */
  set(spot: string | null, end: 1 | -1): void {
    const key = spot ? `${end === 1 ? 'R' : 'L'}|${spot}` : null;
    if (key === this.key) return;
    this.key = key;
    this.clearMeshes();
    this.t = 0;
    if (!key) return;
    for (const r of REGIONS) if (r.id === key) this.root.add(this.mesh(r));
  }

  update(dt: number): void {
    if (!this.key) return;
    this.t += dt;
    // fade in, then breathe between faint and clear
    this.mat.opacity = Math.min(1, this.t * 3) * (0.16 + 0.1 * (0.5 + 0.5 * wave(this.t * 2.6)));
  }

  dispose(): void {
    this.clearMeshes();
    this.root.removeFromParent();
    this.mat.dispose();
  }

  private clearMeshes(): void {
    for (const c of this.root.children) (c as THREE.Mesh).geometry.dispose();
    this.root.clear();
  }

  private mesh(r: Region): THREE.Mesh {
    const s = r.shape;
    let geo: THREE.BufferGeometry;
    let at: [number, number] = [0, 0];
    if (s.kind === 'rect') {
      geo = new THREE.PlaneGeometry(s.w, s.d);
      at = [s.x, s.z];
    } else if (s.kind === 'circle') {
      geo = new THREE.CircleGeometry(s.r, 40);
      at = [s.x, s.z];
    } else {
      // shape y is -z so that lying the shape flat puts it back on the felt's z
      const shape = new THREE.Shape(s.points.map(([x, z]) => new THREE.Vector2(x, -z)));
      geo = new THREE.ShapeGeometry(shape);
    }
    const m = new THREE.Mesh(geo, this.mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(at[0], this.y, at[1]);
    m.renderOrder = 1;
    return m;
  }
}
