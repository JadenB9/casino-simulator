// The pieces the effects are made of, each one draw call however many there are:
//
// - Bits: small solid things that tumble and land (confetti, bills, coins). One InstancedMesh; the
//   simulation is a few hundred points on the CPU, which is less work than it sounds and lets a
//   piece land on the floor and lie flat where it fell.
// - Sparks: glowing streaks (the cold-spark fountains, golden hour's glitter). Positions and
//   velocities go to the GPU as instanced attributes and the vertex shader draws each one as a
//   short streak along its motion, facing the camera; additive, bright enough to bloom on High.
// - Beams: soft cones of light (a follow spot, the disco's moving heads), additive and faded at the
//   edges by the angle they're seen at, so they read as light in haze rather than as cones.
// - Pools: light landing on the floor, as an additive disc.
//
// Calm (app/comfort.ts): Bits and Sparks keep one piece in three of what they're asked for, and bits
// tumble at less than half the spin, so every effect built from them thins out on its own.

import * as THREE from 'three';
import { calm, calmScale } from '../../app/comfort.ts';

const _q = new THREE.Quaternion();
const _r = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Flat on the floor, face up, turned `yaw` about the vertical (for a piece built in the XY plane). */
export function flatQuat(out: THREE.Quaternion, yaw: number, plane = true): THREE.Quaternion {
  out.setFromAxisAngle(_up, yaw);
  if (plane) out.multiply(_r.setFromAxisAngle(_a.set(1, 0, 0), -Math.PI / 2));
  return out;
}

export class Bits {
  readonly mesh: THREE.InstancedMesh;
  readonly max: number;
  /** How many are alive; they're kept packed at the front. */
  n = 0;
  readonly p: Float32Array;
  readonly v: Float32Array;
  /** Orientation (quaternion) and spin (axis xyz, rad/s). */
  readonly q: Float32Array;
  readonly w: Float32Array;
  readonly size: Float32Array;
  readonly age: Float32Array;
  /** Per piece: a random 0-1, for sway phases and the like. */
  readonly seed: Float32Array;
  readonly landed: Uint8Array;
  private readonly colors: Float32Array;
  private thin = 0;

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, max: number, name: string) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.name = name;
    this.mesh.count = 0;
    // they fly about: never culled as one, and nothing hides behind them
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.colors = new Float32Array(max * 3).fill(1);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(this.colors, 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.q = new Float32Array(max * 4);
    this.w = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.age = new Float32Array(max);
    this.seed = new Float32Array(max);
    this.landed = new Uint8Array(max);
  }

  /** A new piece; -1 when they're all in use. */
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, color: THREE.Color, spin: number): number {
    if (calm() && ++this.thin % 3 !== 0) return -1;
    if (this.n >= this.max) return -1;
    const i = this.n++;
    this.p.set([x, y, z], i * 3);
    this.v.set([vx, vy, vz], i * 3);
    _q.setFromEuler(new THREE.Euler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28));
    _q.toArray(this.q, i * 4);
    _a.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    this.w.set([_a.x, _a.y, _a.z, spin * calmScale(0.4)], i * 4);
    this.size[i] = size;
    this.age[i] = 0;
    this.seed[i] = Math.random();
    this.landed[i] = 0;
    this.colors.set([color.r, color.g, color.b], i * 3);
    return i;
  }

  /** Turn piece i by its spin for dt. */
  spin(i: number, dt: number, k = 1): void {
    const w = this.w;
    _q.fromArray(this.q, i * 4);
    _r.setFromAxisAngle(_a.set(w[i * 4]!, w[i * 4 + 1]!, w[i * 4 + 2]!), w[i * 4 + 3]! * dt * k);
    _q.multiply(_r).toArray(this.q, i * 4);
  }

  /** Lay piece i on the floor at height y, face up. */
  land(i: number, y: number, plane = true): void {
    this.landed[i] = 1;
    this.p[i * 3 + 1] = y;
    this.v.fill(0, i * 3, i * 3 + 3);
    flatQuat(_q, this.seed[i]! * 6.28, plane).toArray(this.q, i * 4);
  }

  /**
   * How high piece i lies if it lands now at (its x, z): on the floor at `base`, or on top of the
   * pieces already lying within `r` of it, `step` each (paper piles up; nothing lies inside another,
   * so nothing flickers).
   */
  pile(i: number, base: number, r: number, step: number): number {
    const x = this.p[i * 3]!;
    const z = this.p[i * 3 + 2]!;
    let top = base - step;
    const r2 = r * r;
    for (let j = 0; j < this.n; j++) {
      if (!this.landed[j] || j === i) continue;
      const dx = this.p[j * 3]! - x;
      const dz = this.p[j * 3 + 2]! - z;
      if (dx * dx + dz * dz < r2) top = Math.max(top, this.p[j * 3 + 1]!);
    }
    return top + step;
  }

  /** Remove piece i (the last one takes its place). */
  kill(i: number): void {
    const j = --this.n;
    if (i === j) return;
    this.p.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.v.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.q.copyWithin(i * 4, j * 4, j * 4 + 4);
    this.w.copyWithin(i * 4, j * 4, j * 4 + 4);
    this.colors.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.size[i] = this.size[j]!;
    this.age[i] = this.age[j]!;
    this.seed[i] = this.seed[j]!;
    this.landed[i] = this.landed[j]!;
  }

  /** Write the pieces to the GPU, every one scaled by `k` (shrinking away at the end). */
  commit(k = 1): void {
    const m = this.mesh;
    for (let i = 0; i < this.n; i++) {
      _p.fromArray(this.p, i * 3);
      _q.fromArray(this.q, i * 4);
      const s = this.size[i]! * k;
      _m.compose(_p, _q, _s.set(s, s, s));
      m.setMatrixAt(i, _m);
    }
    m.count = this.n;
    m.instanceMatrix.clearUpdateRanges();
    m.instanceMatrix.addUpdateRange(0, this.n * 16);
    m.instanceMatrix.needsUpdate = true;
    const c = m.instanceColor!;
    c.clearUpdateRanges();
    c.addUpdateRange(0, this.n * 3);
    c.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
  }
}

/** Just over the floor's own inlays and runners (room.ts lays them up to 8 mm). */
export const FLOOR_TOP = 0.011;

/**
 * Paper in the air (confetti, bills): gravity, then air holding it to a slow fall, swaying and
 * tumbling as it goes, until it lands flat on the floor where it stays, on top of whatever
 * landed there first (`size`: how near counts as on top).
 */
export function stepPaper(b: Bits, dt: number, o: { fall: number; sway: number; drag: number; size: number }): void {
  const floor = FLOOR_TOP;
  const drag = Math.exp(-dt * o.drag);
  const p = b.p;
  const v = b.v;
  for (let i = 0; i < b.n; i++) {
    b.age[i]! += dt;
    if (b.landed[i]) continue;
    const k = i * 3;
    v[k]! *= drag;
    v[k + 2]! *= drag;
    // Going up, gravity and the air slow it; coming down, the air holds it to a slow fall (a
    // little different for every piece), which it settles into within a fraction of a second.
    const fall = o.fall * (0.75 + 0.5 * b.seed[i]!);
    if (v[k + 1]! > 0) v[k + 1] = v[k + 1]! * drag - 9.8 * dt;
    else v[k + 1] = -fall + (v[k + 1]! + fall) * Math.exp((-dt * 9.8) / fall);
    const t = b.age[i]!;
    const ph = b.seed[i]! * 40;
    // side to side as it comes down, like a leaf: only once it's falling
    const falling = v[k + 1]! < 0 ? 1 : 0;
    p[k]! += (v[k]! + falling * o.sway * Math.sin(t * 3.1 + ph)) * dt;
    p[k + 1]! += v[k + 1]! * dt;
    p[k + 2]! += (v[k + 2]! + falling * o.sway * Math.cos(t * 2.3 + ph * 1.3)) * dt;
    b.spin(i, dt);
    if (p[k + 1]! <= floor) b.land(i, b.pile(i, floor, o.size, 0.0006));
  }
}

// --- sparks ----------------------------------------------------------------------------------------

const SPARK_VERTEX = /* glsl */ `
  attribute vec3 aPos;
  attribute vec3 aVel;
  attribute float aHeat;
  attribute vec3 aTint;
  uniform float uLen;
  uniform float uWidth;
  varying float vHeat;
  varying vec2 vQ;
  varying vec3 vTint;
  void main() {
    vTint = aTint;
    vec4 a = modelViewMatrix * vec4(aPos, 1.0);
    vec4 b = modelViewMatrix * vec4(aPos - aVel * uLen, 1.0);
    vec2 d = b.xy - a.xy;
    float l = length(d);
    vec2 dir = l > 1e-5 ? d / l : vec2(0.0, 1.0);
    vec2 side = vec2(-dir.y, dir.x);
    float w = uWidth * (0.45 + 0.55 * aHeat);
    // from a little ahead of the head (so it's round) back along the tail
    vec4 v = mix(a - vec4(dir * w * 0.5, 0.0, 0.0), b, position.y);
    v.xy += side * position.x * w;
    gl_Position = projectionMatrix * v;
    vHeat = aHeat;
    vQ = vec2(position.x * 2.0, position.y);
  }
`;

const SPARK_FRAGMENT = /* glsl */ `
  uniform vec3 uHot;
  uniform vec3 uCool;
  uniform float uGain;
  varying float vHeat;
  varying vec2 vQ;
  varying vec3 vTint;
  void main() {
    float across = 1.0 - abs(vQ.x);
    float m = across * across * (1.0 - vQ.y * 0.85);
    // hot white at birth, cooling to the spark's own colour
    vec3 c = mix(uCool * vTint, uHot, vHeat * vHeat) * uGain * m * smoothstep(0.0, 0.2, vHeat);
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Sparks {
  readonly mesh: THREE.Mesh;
  readonly max: number;
  n = 0;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly pos: THREE.InstancedBufferAttribute;
  private readonly vel: THREE.InstancedBufferAttribute;
  private readonly heat: THREE.InstancedBufferAttribute;
  private readonly tint: THREE.InstancedBufferAttribute;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private thin = 0;
  readonly uniforms: { uLen: { value: number }; uWidth: { value: number }; uHot: { value: THREE.Color }; uCool: { value: THREE.Color }; uGain: { value: number } };

  constructor(max: number, o: { hot: THREE.ColorRepresentation; cool: THREE.ColorRepresentation; gain: number; width: number; len: number; name: string }) {
    this.max = max;
    const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(quad.getIndex());
    g.setAttribute('position', quad.getAttribute('position'));
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.vel = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.heat = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', this.pos);
    g.setAttribute('aVel', this.vel);
    g.setAttribute('aHeat', this.heat);
    g.setAttribute('aTint', this.tint);
    g.instanceCount = 0;
    this.geometry = g;
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.uniforms = {
      uLen: { value: o.len },
      uWidth: { value: o.width },
      uHot: { value: new THREE.Color(o.hot) },
      uCool: { value: new THREE.Color(o.cool) },
      uGain: { value: o.gain },
    };
    const material = new THREE.ShaderMaterial({
      name: o.name,
      uniforms: this.uniforms,
      vertexShader: SPARK_VERTEX,
      fragmentShader: SPARK_FRAGMENT,
      transparent: true,
      depthWrite: false,
      // the streaks are built facing the camera in whichever winding their motion gives
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = o.name;
    this.mesh.frustumCulled = false;
  }

  /** A spark; `tint` colours it as it cools (white: the material's own colours). */
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, tint?: THREE.Color): void {
    if (calm() && ++this.thin % 3 !== 0) return;
    if (this.n >= this.max) return;
    const i = this.n++;
    (this.pos.array as Float32Array).set([x, y, z], i * 3);
    (this.vel.array as Float32Array).set([vx, vy, vz], i * 3);
    (this.tint.array as Float32Array).set(tint ? [tint.r, tint.g, tint.b] : [1, 1, 1], i * 3);
    this.age[i] = 0;
    this.life[i] = life;
    (this.heat.array as Float32Array)[i] = 1;
  }

  /** Move every spark: gravity `g`, air `drag` (per second), and bounce off the floor a little. */
  step(dt: number, g = 9.8, drag = 0.6): void {
    const p = this.pos.array as Float32Array;
    const v = this.vel.array as Float32Array;
    const h = this.heat.array as Float32Array;
    const d = Math.exp(-dt * drag);
    for (let i = 0; i < this.n; i++) {
      this.age[i]! += dt;
      if (this.age[i]! >= this.life[i]!) {
        this.kill(i);
        i--;
        continue;
      }
      const k = i * 3;
      v[k + 1]! -= g * dt;
      v[k]! *= d;
      v[k + 1]! *= d;
      v[k + 2]! *= d;
      p[k]! += v[k]! * dt;
      p[k + 1]! += v[k + 1]! * dt;
      p[k + 2]! += v[k + 2]! * dt;
      if (p[k + 1]! < 0.01 && v[k + 1]! < 0) {
        p[k + 1] = 0.01;
        v[k + 1] = -v[k + 1]! * 0.25;
        v[k]! *= 0.5;
        v[k + 2]! *= 0.5;
      }
      h[i] = 1 - this.age[i]! / this.life[i]!;
    }
  }

  private kill(i: number): void {
    const j = --this.n;
    if (i === j) return;
    const p = this.pos.array as Float32Array;
    const v = this.vel.array as Float32Array;
    p.copyWithin(i * 3, j * 3, j * 3 + 3);
    v.copyWithin(i * 3, j * 3, j * 3 + 3);
    (this.tint.array as Float32Array).copyWithin(i * 3, j * 3, j * 3 + 3);
    this.age[i] = this.age[j]!;
    this.life[i] = this.life[j]!;
    (this.heat.array as Float32Array)[i] = (this.heat.array as Float32Array)[j]!;
  }

  commit(): void {
    this.geometry.instanceCount = this.n;
    for (const [a, size] of [
      [this.pos, 3],
      [this.vel, 3],
      [this.heat, 1],
      [this.tint, 3],
    ] as const) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * size);
      a.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// --- beams ------------------------------------------------------------------------------------------

/** A cone with its apex at the origin opening down -y to radius 1 at y = -1 (scale it to size). */
export function beamGeometry(segments = 28): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(0.015, 1, 1, segments, 6, true).translate(0, -0.5, 0);
}

const BEAM_VERTEX = /* glsl */ `
  varying vec3 vN;
  varying vec3 vView;
  varying float vAlong;
  varying float vY;
  varying vec3 vTint;
  void main() {
    mat4 m = modelMatrix;
    #ifdef USE_INSTANCING
      m = m * instanceMatrix;
    #endif
    vec4 world = m * vec4(position, 1.0);
    vec4 view = viewMatrix * world;
    vN = normalize(mat3(viewMatrix) * mat3(m) * normal);
    vView = -view.xyz;
    vAlong = -position.y;
    vY = world.y;
    vTint = vec3(1.0);
    #ifdef USE_INSTANCING_COLOR
      vTint = instanceColor;
    #endif
    gl_Position = projectionMatrix * view;
  }
`;

const BEAM_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uK;
  uniform float uTime;
  varying vec3 vN;
  varying vec3 vView;
  varying float vAlong;
  varying float vY;
  varying vec3 vTint;
  void main() {
    // seen side-on, a cone of light in haze is brightest through its middle and fades to its edges
    float face = abs(dot(normalize(vN), normalize(vView)));
    float a = pow(face, 2.4);
    // brighter near the lens, thinning out toward the floor, gone where it meets it
    a *= mix(1.0, 0.35, vAlong) * smoothstep(0.0, 0.5, vY);
    // the haze drifts
    a *= 0.85 + 0.15 * sin(vY * 3.1 + uTime * 0.7 + vAlong * 5.0);
    gl_FragColor = vec4(uColor * vTint * a * uK, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function beamMaterial(color: THREE.ColorRepresentation, k: number, name: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    uniforms: { uColor: { value: new THREE.Color(color) }, uK: { value: k }, uTime: { value: 0 } },
    vertexShader: BEAM_VERTEX,
    fragmentShader: BEAM_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

/** Place a unit beam (beamGeometry) from `from` to `to`, `r` metres wide where it lands. */
export function aimBeam(out: THREE.Matrix4, from: THREE.Vector3, to: THREE.Vector3, r: number): THREE.Matrix4 {
  const d = _a.subVectors(to, from);
  const len = d.length();
  _q.setFromUnitVectors(_s.set(0, -1, 0), d.divideScalar(len || 1));
  return out.compose(from, _q, _p.set(r, len, r));
}

// --- pools --------------------------------------------------------------------------------------------

/** A disc of light on the floor: `edge` 0 is soft all the way, near 1 a crisp rim (a theatre spot). */
export function poolTexture(edge: number): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const inner = Math.max(0.01, edge * 0.9);
    const a = t < inner ? 1 - 0.25 * (t / inner) : 0.75 * Math.pow(Math.max(0, 1 - (t - inner) / (1 - inner)), 1.6);
    g.addColorStop(t, `rgba(255,255,255,${a.toFixed(3)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function poolMaterial(map: THREE.Texture, color: THREE.Color, name: string): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ map, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.name = name;
  return m;
}

/** A flat disc on the floor, radius 1 (scale it). */
export function poolGeometry(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
}
