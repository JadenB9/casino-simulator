// Reels: the visible band of a drum, textured with the machine's strip. The drum doesn't turn as
// a mesh; the strip scrolls through a small shader, which lets a 22-stop stepper reel and a
// 32-stop video reel share one mesh shape and keeps the drum from poking out of the cabinet.
// Positions are in stops: `pos = k` puts stop k on the band's centre line, and a spin moves pos
// down (symbols travel downward) to land exactly where the server said.

import * as THREE from 'three';
import { tween, ease } from '../../table/tween.ts';

export interface ReelLook {
  width: number;
  /** Drum radius and the angle one stop spans on it. */
  radius: number;
  stopAngle: number;
  /** Half the band's arc, radians (the window hides the rest). */
  arcHalf: number;
  /** How hard the band darkens toward its top and bottom (a lit drum's curvature). */
  curve: number;
}

/** The band, centred at the origin with its front at z = 0; uv.y counts stops below the centre line. */
export function reelGeometry(look: ReelLook): THREE.BufferGeometry {
  const segs = 28;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= segs; j++) {
    const phi = look.arcHalf - (2 * look.arcHalf * j) / segs;
    const y = look.radius * Math.sin(phi);
    const z = look.radius * Math.cos(phi) - look.radius;
    for (const side of [0, 1]) {
      pos.push((side - 0.5) * look.width, y, z);
      nor.push(0, Math.sin(phi), Math.cos(phi));
      uv.push(side, -phi / look.stopAngle);
    }
  }
  for (let j = 0; j < segs; j++) {
    const a = j * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const VERT = /* glsl */ `
varying vec2 vUv;
varying float vFacing;
void main() {
  vUv = uv;
  vFacing = normal.z;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
uniform sampler2D blurMap;
uniform float uStops;
uniform float uOffset;
uniform float uBlur;
uniform float uBright;
uniform float uCurve;
uniform vec3 uTint;
varying vec2 vUv;
varying float vFacing;
void main() {
  float s = uOffset + vUv.y;
  vec2 tuv = vec2(vUv.x, 1.0 - (s + 0.5) / uStops);
  vec3 col = mix(texture2D(map, tuv).rgb, texture2D(blurMap, tuv).rgb, uBlur);
  float shade = pow(max(vFacing, 0.0), uCurve);
  gl_FragColor = vec4(col * uTint * (shade * uBright), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export type ReelMaterial = THREE.ShaderMaterial & {
  uniforms: {
    map: { value: THREE.Texture };
    blurMap: { value: THREE.Texture };
    uStops: { value: number };
    uOffset: { value: number };
    uBlur: { value: number };
    uBright: { value: number };
    uCurve: { value: number };
    uTint: { value: THREE.Color };
  };
};

export function reelMaterial(map: THREE.Texture, blurMap: THREE.Texture, stops: number, curve: number, tint: THREE.ColorRepresentation = '#ffffff'): ReelMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      map: { value: map },
      blurMap: { value: blurMap },
      uStops: { value: stops },
      uOffset: { value: 0 },
      uBlur: { value: 0 },
      uBright: { value: 1 },
      uCurve: { value: curve },
      uTint: { value: new THREE.Color(tint) },
    },
  }) as ReelMaterial;
}

/** A canvas as a reel texture: wraps vertically, colour-managed, mipmapped. */
export function stripTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapT = THREE.RepeatWrapping;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  return t;
}

const mod = (x: number, n: number) => ((x % n) + n) % n;

export interface SpinTiming {
  /** Seconds from the press until this reel starts. */
  delay: number;
  /** Seconds from the press until this reel lands on its stop. */
  land: number;
  /** Nominal speed, stops per second (the real speed is adjusted a little so the stop comes round on time). */
  speed: number;
  kick: number;
  accel: number;
  decel: number;
  bounce: number;
  bounceAmp: number;
}

/**
 * The whole path of one reel as position(t): a small wind-up, spin-up, a steady run, then a
 * cubic ease into the target with a short jolt past it and back, like a stepper settling. The
 * speed is tuned so the target stop arrives exactly at `land`.
 */
export function planReel(from: number, target: number, stops: number, t: SpinTiming): { at(time: number): number; speedAt(time: number): number; end: number } {
  const cruiseStart = t.delay + t.kick + t.accel;
  const decelStart = t.land - t.decel;
  const k = t.accel / 2 + (decelStart - cruiseStart) + t.decel / 3;
  const base = mod(from - target, stops);
  const dist = base + stops * Math.max(1, Math.round((t.speed * k - base) / stops));
  const v = dist / k;
  const p1 = from - (v * t.accel) / 2;
  const p2 = p1 - v * (decelStart - cruiseStart);
  const goal = from - dist;
  return {
    end: t.land + t.bounce,
    at(time) {
      if (time <= t.delay) return from;
      if (time < t.delay + t.kick) return from + 0.22 * Math.sin((Math.PI * (time - t.delay)) / t.kick);
      if (time < cruiseStart) {
        const u = time - t.delay - t.kick;
        return from - (0.5 * v * u * u) / t.accel;
      }
      if (time < decelStart) return p1 - v * (time - cruiseStart);
      if (time < t.land) {
        const u = (time - decelStart) / t.decel;
        return p2 - ((v * t.decel) / 3) * (1 - (1 - u) ** 3);
      }
      if (time < t.land + t.bounce) {
        const u = (time - t.land) / t.bounce;
        return goal - t.bounceAmp * Math.sin(Math.PI * u) * (1 - u);
      }
      return goal;
    },
    speedAt(time) {
      if (time <= t.delay + t.kick || time >= t.land) return 0;
      if (time < cruiseStart) return (v * (time - t.delay - t.kick)) / t.accel;
      if (time < decelStart) return v;
      const u = (time - decelStart) / t.decel;
      return v * (1 - u) ** 2;
    },
  };
}

/** A machine's reels: the meshes, their positions and the spin animation. */
export class ReelSet {
  readonly pos: number[];
  private readonly restore: THREE.Material[];

  constructor(
    readonly meshes: THREE.Mesh[],
    readonly materials: ReelMaterial[],
    readonly stops: number,
    /** 0 for steppers (stop on the centre line), 1 for the 5-reel (the server's stop is the top row). */
    readonly rowOffset: number,
  ) {
    this.pos = meshes.map(() => 0);
    this.restore = meshes.map((m) => m.material as THREE.Material);
    meshes.forEach((m, i) => (m.material = materials[i]!));
  }

  /** Show these stops with no animation. */
  set(stops: readonly number[]): void {
    stops.forEach((s, i) => this.place(i, s + this.rowOffset, 0));
  }

  private place(i: number, p: number, blur: number): void {
    this.pos[i] = p;
    const u = this.materials[i]!.uniforms;
    u.uOffset.value = p;
    u.uBlur.value = blur;
  }

  bright(i: number, b: number): void {
    this.materials[i]!.uniforms.uBright.value = b;
  }

  /**
   * Spin every reel to its stop. Resolves when the last reel settles; `onLand(i)` fires as each
   * one lands. Driven by one tween, so a snap (finishAll) lands every reel on its stop at once.
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
          const speed = Math.abs(p.speedAt(t));
          this.place(i, p.at(t), Math.min(1, speed / 14));
          if (!landed[i] && (t >= lands[i]! || k >= 1)) {
            landed[i] = true;
            onLand(i);
          }
        });
      },
      ease.linear,
    );
    // keep the numbers small; the picture is the same
    this.pos.forEach((p, i) => this.place(i, mod(Math.round(p), this.stops), 0));
  }

  dispose(): void {
    this.meshes.forEach((m, i) => (m.material = this.restore[i]!));
    for (const m of this.materials) m.dispose();
  }
}
