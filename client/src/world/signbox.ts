// Shared by the signs this module hangs (marquee.ts, tally.ts): a whole sign as one geometry, so it
// is one draw call. Housing, trim and rods are vertex-coloured boxes with no UVs (uv = -1); the
// display faces carry UVs from 0 to 1, reading left to right from their own side. The sign's
// shader lights the housing with a fixed key light (enough to read its edges in a dark room) and
// draws the faces however that sign draws them.

import * as THREE from 'three';

export class Merge {
  private pos: number[] = [];
  private nrm: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation, ry = 0): void {
    const g = new THREE.BoxGeometry(sx, sy, sz).rotateY(ry).translate(x, y, z);
    this.add(g, new THREE.Color(color), false);
  }

  /** A display face centred at (x, y, z), facing +z turned by `ry`. */
  face(x: number, y: number, z: number, w: number, h: number, ry: number): void {
    const g = new THREE.PlaneGeometry(w, h).rotateY(ry).translate(x, y, z);
    this.add(g, new THREE.Color(0, 0, 0), true);
  }

  /** A rod from `y0` up to `y1` with a brass collar at each end. */
  rod(x: number, z: number, y0: number, y1: number, chrome: THREE.ColorRepresentation, brass: THREE.ColorRepresentation): void {
    this.box(x, (y0 + y1) / 2, z, 0.014, y1 - y0, 0.014, chrome);
    this.box(x, y0 + 0.015, z, 0.05, 0.03, 0.05, brass);
    this.box(x, y1 - 0.01, z, 0.09, 0.02, 0.09, brass);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }

  private add(g: THREE.BufferGeometry, color: THREE.Color, face: boolean): void {
    const base = this.pos.length / 3;
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const t = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      if (face) this.uv.push(t.getX(i), t.getY(i));
      else this.uv.push(-1, -1);
      this.col.push(color.r, color.g, color.b);
    }
    for (const i of g.index!.array) this.idx.push(i + base);
    g.dispose();
  }
}

/** Vertex shader for a sign: passes the face UVs, the housing colour and its key light. */
export const SIGN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vLight;
  void main() {
    vUv = uv;
    vColor = color;
    vec3 n = normalize(mat3(modelMatrix) * normal);
    vLight = 0.35 + 0.65 * max(dot(n, normalize(vec3(0.25, 0.85, 0.45))), 0.0) + 0.25 * max(dot(n, vec3(0.0, 0.0, -1.0)), 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** A sign's fragment shader: the housing lit, and `face` (GLSL setting `c` from vUv) for the faces. */
export function signFragment(pars: string, face: string): string {
  return /* glsl */ `
  ${pars}
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vLight;
  void main() {
    vec3 c;
    if (vUv.x < -0.5) {
      c = vColor * vLight;
    } else {
      ${face}
    }
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
}

export const SIGN_COLORS = {
  body: '#15110d',
  brass: '#9c7a3c',
  chrome: '#7d8288',
} as const;
