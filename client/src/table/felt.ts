// Felt layouts: a game describes its printed felt as drawing code plus named regions, and the
// painter turns that into a textured mesh whose clicks come back as region names. The same
// description draws the felt and decides what you clicked, so they can't disagree.

import * as THREE from 'three';

export interface Region {
  id: string;
  /** Local felt coordinates in metres, x across, z toward the player (+z). */
  shape: { kind: 'rect'; x: number; z: number; w: number; d: number } | { kind: 'circle'; x: number; z: number; r: number } | { kind: 'poly'; points: [number, number][] };
  /** Where chips for this region sit, if not the shape's centre. */
  anchor?: [number, number];
}

export interface FeltSpec {
  /** Size of the felt in metres. */
  width: number;
  depth: number;
  color: string;
  /** Pixels per metre for the painted texture (capped at 4096 px per side). */
  resolution?: number;
  paint(g: CanvasRenderingContext2D, px: (metres: number) => number): void;
  regions: Region[];
}

export class Felt {
  readonly mesh: THREE.Mesh;
  readonly spec: FeltSpec;

  constructor(spec: FeltSpec) {
    this.spec = spec;
    const ppm = Math.min(spec.resolution ?? 1400, 4096 / Math.max(spec.width, spec.depth));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(spec.width * ppm);
    canvas.height = Math.round(spec.depth * ppm);
    const g = canvas.getContext('2d')!;
    g.fillStyle = spec.color;
    g.fillRect(0, 0, canvas.width, canvas.height);
    // a faint weave so large felt areas don't look like flat plastic
    g.globalAlpha = 0.05;
    for (let i = 0; i < canvas.width * canvas.height * 0.002; i++) {
      g.fillStyle = i % 2 ? '#000' : '#fff';
      g.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 1.5, 1.5);
    }
    g.globalAlpha = 1;
    g.save();
    g.translate(canvas.width / 2, canvas.height / 2);
    spec.paint(g, (m) => m * ppm);
    g.restore();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(spec.width, spec.depth), mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.name = 'felt';
  }

  /** Which region a local felt point (x, z) is in, if any. Later regions win (props drawn on top). */
  regionAt(x: number, z: number): Region | null {
    for (let i = this.spec.regions.length - 1; i >= 0; i--) {
      const r = this.spec.regions[i]!;
      if (inside(r, x, z)) return r;
    }
    return null;
  }

  anchorOf(id: string): [number, number] | null {
    const r = this.spec.regions.find((x) => x.id === id);
    if (!r) return null;
    if (r.anchor) return r.anchor;
    const s = r.shape;
    if (s.kind === 'poly') {
      const n = s.points.length;
      return [s.points.reduce((a, p) => a + p[0], 0) / n, s.points.reduce((a, p) => a + p[1], 0) / n];
    }
    return [s.x, s.z];
  }
}

function inside(r: Region, x: number, z: number): boolean {
  const s = r.shape;
  if (s.kind === 'rect') return Math.abs(x - s.x) <= s.w / 2 && Math.abs(z - s.z) <= s.d / 2;
  if (s.kind === 'circle') return (x - s.x) ** 2 + (z - s.z) ** 2 <= s.r ** 2;
  let hit = false;
  const p = s.points;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i]!;
    const [xj, zj] = p[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}
