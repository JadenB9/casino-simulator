// A cocktail waiter's tray and what's on it: a round silver tray with up to three drinks (the
// glasses and bottles the bar serves, and a plate for food), one vertex-coloured mesh per tray and
// one material for them all. Kept level on the waiter's upturned left hand.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BarModel } from '../../../../shared/src/items.ts';

type RGB = [number, number, number];
const SILVER: RGB = [0.72, 0.72, 0.7];
const GLASS: RGB = [0.62, 0.7, 0.74];
const WINE: RGB = [0.22, 0.01, 0.03];
const CHAMPAGNE: RGB = [0.78, 0.6, 0.22];
const WHISKEY: RGB = [0.5, 0.2, 0.03];
const AMBER: RGB = [0.24, 0.09, 0.02];
const GREEN: RGB = [0.03, 0.12, 0.05];
const GOLD: RGB = [0.8, 0.62, 0.25];
const CHINA: RGB = [0.86, 0.85, 0.8];
const COFFEE: RGB = [0.08, 0.035, 0.015];
const OLIVE: RGB = [0.2, 0.3, 0.05];
const FOOD: RGB = [0.62, 0.36, 0.14];

function paint(g: THREE.BufferGeometry, c: RGB): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
  return g.index ? g.toNonIndexed() : g;
}

const lathe = (pts: [number, number][], c: RGB, segs = 16) => paint(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs), c);
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);

/** One item standing on the tray at (x, z), its foot on the tray's top. */
function item(model: BarModel, x: number, z: number): THREE.BufferGeometry[] {
  const y = 0.012;
  switch (model) {
    case 'martini':
      return [at(lathe([[0.0001, 0], [0.028, 0], [0.004, 0.006], [0.003, 0.07], [0.048, 0.125], [0.045, 0.127], [0.004, 0.075]], GLASS), x, y, z), at(lathe([[0.0001, 0.08], [0.04, 0.118], [0.0001, 0.118]], [0.75, 0.8, 0.78]), x, y, z), at(paint(new THREE.SphereGeometry(0.008, 8, 6), OLIVE), x + 0.01, y + 0.1, z)];
    case 'wine':
      return [at(lathe([[0.0001, 0], [0.03, 0], [0.004, 0.006], [0.0035, 0.07], [0.034, 0.1], [0.037, 0.14], [0.033, 0.17], [0.031, 0.17]], GLASS), x, y, z), at(lathe([[0.0001, 0.075], [0.028, 0.095], [0.034, 0.118], [0.0001, 0.118]], WINE), x, y, z)];
    case 'flute':
      return [at(lathe([[0.0001, 0], [0.028, 0], [0.003, 0.006], [0.003, 0.07], [0.021, 0.1], [0.023, 0.2], [0.021, 0.2]], GLASS), x, y, z), at(lathe([[0.0001, 0.075], [0.02, 0.1], [0.0215, 0.17], [0.0001, 0.17]], CHAMPAGNE), x, y, z)];
    case 'rocks':
      return [at(lathe([[0.0001, 0], [0.037, 0], [0.038, 0.08], [0.035, 0.08], [0.034, 0.01], [0.0001, 0.01]], GLASS), x, y, z), at(lathe([[0.0001, 0.011], [0.033, 0.011], [0.033, 0.045], [0.0001, 0.045]], WHISKEY), x, y, z)];
    case 'bottle':
      return [at(lathe([[0.0001, 0], [0.03, 0], [0.03, 0.12], [0.026, 0.135], [0.012, 0.165], [0.0115, 0.2], [0.0001, 0.2]], AMBER), x, y, z), at(lathe([[0.0305, 0.03], [0.0305, 0.08]], [0.78, 0.7, 0.5]), x, y, z)];
    case 'magnum':
      return [at(lathe([[0.0001, 0], [0.04, 0], [0.04, 0.16], [0.034, 0.2], [0.016, 0.24], [0.015, 0.3], [0.0001, 0.3]], GREEN), x, y, z), at(lathe([[0.0165, 0.23], [0.017, 0.26], [0.016, 0.305], [0.0001, 0.308]], GOLD), x, y, z)];
    case 'cup':
      return [at(lathe([[0.0001, 0], [0.058, 0.002], [0.06, 0.008], [0.0001, 0.006]], CHINA, 20), x, y, z), at(lathe([[0.0001, 0.006], [0.022, 0.006], [0.028, 0.03], [0.03, 0.052], [0.027, 0.052], [0.0001, 0.034]], CHINA, 20), x, y, z), at(lathe([[0.0001, 0.045], [0.027, 0.045]], COFFEE, 20), x, y, z)];
    case 'plate':
      return [at(lathe([[0.0001, 0], [0.075, 0], [0.1, 0.008], [0.104, 0.012], [0.1, 0.012], [0.075, 0.004], [0.0001, 0.004]], CHINA, 24), x, y, z), at(paint(new THREE.SphereGeometry(0.055, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1), FOOD), x, y + 0.004, z)];
  }
}

/** Where drinks stand on the tray: a triangle round its middle; a single order in the middle. */
const SPOTS: [number, number][] = [
  [0.075, 0.05],
  [-0.075, 0.05],
  [0, -0.08],
];

export class Trays {
  readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.32 });
  private readonly cache = new Map<string, THREE.BufferGeometry>();

  /** The tray carrying `load` (one item goes in the middle). */
  geometry(load: readonly BarModel[]): THREE.BufferGeometry {
    const key = load.join(',');
    let g = this.cache.get(key);
    if (!g) {
      const parts: THREE.BufferGeometry[] = [paint(new THREE.CylinderGeometry(0.2, 0.19, 0.012, 32).translate(0, 0.006, 0), SILVER), paint(new THREE.TorusGeometry(0.2, 0.006, 5, 36).rotateX(Math.PI / 2).translate(0, 0.012, 0), SILVER)];
      if (load.length === 1) parts.push(...item(load[0]!, 0, 0));
      else load.slice(0, 3).forEach((m, i) => parts.push(...item(m, SPOTS[i]![0], SPOTS[i]![1])));
      g = mergeGeometries(parts, false)!;
      for (const p of parts) p.dispose();
      g.computeBoundingSphere();
      this.cache.set(key, g);
    }
    return g;
  }

  /** A tray mesh for one waiter (its geometry is swapped as the load changes). */
  mesh(): THREE.Mesh {
    const m = new THREE.Mesh(this.geometry([]), this.material);
    m.name = 'waiter-tray';
    m.visible = false;
    return m;
  }

  dispose(): void {
    for (const g of this.cache.values()) g.dispose();
    this.material.dispose();
  }
}
