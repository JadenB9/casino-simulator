// Light on the felt. The Tips mark: at craps the control Tips recommends is a spot on the layout
// (the pass line, the odds behind it, a box), so its tip-pick is drawn there, the spot's own
// printed shape lit from underneath and breathing slowly, under any chips on it. And the point's
// mark: while the puck is ON, the point's number box is outlined in a steady light, so the point
// reads at a glance from the far end of the table.

import * as THREE from 'three';
import type { Region } from '../../table/felt.ts';
import { REGIONS, numberBox } from './layout.ts';
import { wave } from '../../app/comfort.ts';

export class PointMark {
  readonly root = new THREE.Group();
  private readonly edge = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.35, 1.18, 0.82), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  private readonly fill = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.92, 0.7), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  private key = '';
  private k = 0;

  constructor(private readonly y: number) {
    this.root.name = 'craps-point-mark';
  }

  /** Outline the box of `point` at this end (1 right, -1 left); null takes it away. */
  set(point: number | null, end: 1 | -1): void {
    const key = point === null ? '' : `${point}|${end}`;
    if (key === this.key) return;
    this.key = key;
    this.clearMeshes();
    this.k = 0;
    this.edge.opacity = 0;
    this.fill.opacity = 0;
    if (point === null) return;
    // shape y is -z, so lying the shape flat puts it back on the felt's z
    const [x0, z0, x1, z1] = numberBox(point, end);
    const t = 0.006;
    const rect = (a: number, b: number, c: number, d: number) => [new THREE.Vector2(a, -b), new THREE.Vector2(c, -b), new THREE.Vector2(c, -d), new THREE.Vector2(a, -d)];
    const frame = new THREE.Shape(rect(x0, z0, x1, z1));
    frame.holes.push(new THREE.Path(rect(x0 + t, z0 + t, x1 - t, z1 - t).reverse()));
    for (const [geo, mat] of [[new THREE.ShapeGeometry(new THREE.Shape(rect(x0 + t, z0 + t, x1 - t, z1 - t))), this.fill], [new THREE.ShapeGeometry(frame), this.edge]] as const) {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = this.y;
      m.renderOrder = 1;
      this.root.add(m);
    }
  }

  /** Fades in when the point is set, then holds steady (a mark, not a flash). */
  update(dt: number): void {
    if (!this.key || this.k >= 1) return;
    this.k = Math.min(1, this.k + dt / 0.45);
    this.edge.opacity = 0.62 * this.k;
    this.fill.opacity = 0.07 * this.k;
  }

  dispose(): void {
    this.clearMeshes();
    this.root.removeFromParent();
    this.edge.dispose();
    this.fill.dispose();
  }

  private clearMeshes(): void {
    for (const c of this.root.children) (c as THREE.Mesh).geometry.dispose();
    this.root.clear();
  }
}

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
