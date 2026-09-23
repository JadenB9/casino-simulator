// A reel bank: every reel of a machine in one mesh and one draw call. The strips are painted side
// by side into one texture, each band reads its own column, and each reel's scroll, blur and
// brightness come from uniform arrays indexed by a per-vertex reel number. Positions are in stops
// as in reels.ts: `pos = k` puts the centre of stop k on the window's centre line, and a spin
// moves pos down so symbols travel downward and land exactly where the server said.

import * as THREE from 'three';
import { tween, ease } from '../../table/tween.ts';
import { planReel, reelGeometry, type ReelLook, type SpinTiming } from './reels.ts';

const MAX_REELS = 5;

/** The bands of `count` reels, `pitch` apart, merged, with aReel = the reel's index. */
export function bankGeometry(look: ReelLook, count: number, pitch: number): THREE.BufferGeometry {
  const one = reelGeometry(look);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const reel: number[] = [];
  const idx: number[] = [];
  const p = one.getAttribute('position');
  const n = one.getAttribute('normal');
  const t = one.getAttribute('uv');
  const index = one.getIndex()!;
  for (let r = 0; r < count; r++) {
    const x0 = (r - (count - 1) / 2) * pitch;
    const base = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i) + x0, p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(t.getX(i), t.getY(i));
      reel.push(r);
    }
    for (let i = 0; i < index.count; i++) idx.push(base + index.getX(i));
  }
  one.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aReel', new THREE.Float32BufferAttribute(reel, 1));
  g.setIndex(idx);
  return g;
}

const VERT = /* glsl */ `
attribute float aReel;
uniform float uOffset[${MAX_REELS}];
uniform float uBlur[${MAX_REELS}];
uniform float uBright[${MAX_REELS}];
varying vec2 vUv;
varying float vFacing;
varying float vReel;
varying float vOffset;
varying float vBlur;
varying float vBright;
void main() {
  int i = int(aReel + 0.5);
  vUv = uv;
  vFacing = normal.z;
  vReel = aReel;
  vOffset = uOffset[i];
  vBlur = uBlur[i];
  vBright = uBright[i];
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
uniform sampler2D blurMap;
uniform float uStops;
uniform float uReels;
uniform float uCurve;
uniform vec3 uTint;
varying vec2 vUv;
varying float vFacing;
varying float vReel;
varying float vOffset;
varying float vBlur;
varying float vBright;
void main() {
  float s = vOffset + vUv.y;
  // stay a hair inside the column so mip filtering never borrows the next reel's strip
  float u = (vReel + clamp(vUv.x, 0.01, 0.99)) / uReels;
  vec2 tuv = vec2(u, 1.0 - (s + 0.5) / uStops);
  vec3 col = mix(texture2D(map, tuv).rgb, texture2D(blurMap, tuv).rgb, vBlur);
  float shade = pow(max(vFacing, 0.0), uCurve);
  gl_FragColor = vec4(col * uTint * (shade * vBright), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export type BankMaterial = THREE.ShaderMaterial & {
  uniforms: {
    map: { value: THREE.Texture };
    blurMap: { value: THREE.Texture };
    uStops: { value: number };
    uReels: { value: number };
    uCurve: { value: number };
    uTint: { value: THREE.Color };
    uOffset: { value: number[] };
    uBlur: { value: number[] };
    uBright: { value: number[] };
  };
};

export function bankMaterial(map: THREE.Texture, blurMap: THREE.Texture, reels: number, stops: number, curve: number, tint: THREE.ColorRepresentation): BankMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      map: { value: map },
      blurMap: { value: blurMap },
      uStops: { value: stops },
      uReels: { value: reels },
      uCurve: { value: curve },
      uTint: { value: new THREE.Color(tint) },
      uOffset: { value: new Array<number>(MAX_REELS).fill(0) },
      uBlur: { value: new Array<number>(MAX_REELS).fill(0) },
      uBright: { value: new Array<number>(MAX_REELS).fill(1) },
    },
  }) as BankMaterial;
}

/** A canvas of strips as a bank texture: wraps vertically, colour-managed, mipmapped. */
export function bankTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapT = THREE.RepeatWrapping;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  return t;
}

const mod = (x: number, n: number) => ((x % n) + n) % n;

/** The spinning side of a bank: positions, the spin animation, and per-reel brightness. */
export class ReelBank {
  readonly pos: number[];

  constructor(
    readonly material: BankMaterial,
    readonly count: number,
    readonly stops: number,
    /** Where the server's stop sits relative to the centre line: 0 on a stepper, 1 for three rows, 1.5 for four. */
    readonly rowOffset: number,
  ) {
    this.pos = new Array<number>(count).fill(0);
  }

  private place(i: number, p: number, blur: number): void {
    this.pos[i] = p;
    this.material.uniforms.uOffset.value[i] = p;
    this.material.uniforms.uBlur.value[i] = blur;
  }

  /** Show these stops with no animation. */
  set(stops: readonly number[]): void {
    stops.forEach((s, i) => this.place(i, s + this.rowOffset, 0));
  }

  bright(i: number, b: number): void {
    this.material.uniforms.uBright.value[i] = b;
  }

  brightAll(b: number): void {
    for (let i = 0; i < this.count; i++) this.bright(i, b);
  }

  /**
   * Spin every reel to its stop, left to right. Resolves when the last reel settles; `onLand(i)`
   * fires as each one lands. One tween drives them all, so a snap lands every reel at once.
   */
  async spin(targets: readonly number[], timing: (i: number) => SpinTiming, onLand: (i: number) => void): Promise<void> {
    const plans = targets.map((s, i) => planReel(this.pos[i]!, s + this.rowOffset, this.stops, timing(i)));
    const lands = targets.map((_, i) => timing(i).land);
    const total = Math.max(...plans.map((p) => p.end));
    const landed = targets.map(() => false);
    await tween(
      total * 1000,
      (k) => {
        const t = k * total;
        plans.forEach((p, i) => {
          this.place(i, p.at(t), Math.min(1, Math.abs(p.speedAt(t)) / 14));
          if (!landed[i] && (t >= lands[i]! || k >= 1)) {
            landed[i] = true;
            onLand(i);
          }
        });
      },
      ease.linear,
    );
    // exactly on the stops, the numbers kept small
    targets.forEach((s, i) => this.place(i, mod(s + this.rowOffset, this.stops), 0));
  }
}
