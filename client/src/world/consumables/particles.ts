// Small things in the air: champagne sprayed from a bottle, the glints round someone who's had
// champagne, a clink's spark, the smoke off blown-out candles, an espresso's steam, confetti for a
// birthday. One pool of soft round points per scene (two draws: glowing and plain), moved on the
// CPU, sized in metres. And the bubbles rising in a glass, which ride the glass.

import * as THREE from 'three';

const VERT = /* glsl */ `
attribute float size;
attribute float alpha;
attribute vec3 color;
varying vec3 vColor;
varying float vAlpha;
uniform float uScale;
void main() {
  vColor = color;
  vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, size * uScale / max(0.05, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.35, 1.0, d)) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function material(glow: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 400 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

export interface Burst {
  at: THREE.Vector3;
  /** Mean velocity (m/s) and how widely each one strays from it (m/s). */
  vel?: THREE.Vector3;
  spread?: number;
  /** Also scattered this far round `at` (m). */
  scatter?: number;
  n: number;
  color: THREE.Color | readonly THREE.Color[];
  /** Size (m) at birth and at death. */
  size: [number, number];
  life: [number, number];
  /** m/s² down. */
  gravity?: number;
  /** Fraction of speed lost per second. */
  drag?: number;
  alpha?: number;
  /** Twinkle: the alpha flickers. */
  twinkle?: boolean;
  glow?: boolean;
}

const MAX = 1400;

class Pool {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(MAX * 3);
  private readonly col = new Float32Array(MAX * 3);
  private readonly size = new Float32Array(MAX);
  private readonly alpha = new Float32Array(MAX);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly age = new Float32Array(MAX);
  private readonly life = new Float32Array(MAX);
  private readonly s0 = new Float32Array(MAX);
  private readonly s1 = new Float32Array(MAX);
  private readonly a0 = new Float32Array(MAX);
  private readonly grav = new Float32Array(MAX);
  private readonly drag = new Float32Array(MAX);
  private readonly twinkle = new Uint8Array(MAX);
  private n = 0;
  private readonly geo = new THREE.BufferGeometry();

  constructor(glow: boolean) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.points = new THREE.Points(this.geo, material(glow));
    this.points.name = glow ? 'dine-glints' : 'dine-drops';
    this.points.frustumCulled = false;
    // after the glass and the characters
    this.points.renderOrder = 5;
  }

  add(b: Burst, rand: () => number = Math.random): void {
    const cols = Array.isArray(b.color) ? (b.color as THREE.Color[]) : [b.color as THREE.Color];
    for (let k = 0; k < b.n; k++) {
      if (this.n >= MAX) return;
      const i = this.n++;
      const sc = b.scatter ?? 0;
      this.pos[i * 3] = b.at.x + (rand() - 0.5) * 2 * sc;
      this.pos[i * 3 + 1] = b.at.y + (rand() - 0.5) * 2 * sc;
      this.pos[i * 3 + 2] = b.at.z + (rand() - 0.5) * 2 * sc;
      const sp = b.spread ?? 0;
      this.vel[i * 3] = (b.vel?.x ?? 0) + (rand() - 0.5) * 2 * sp;
      this.vel[i * 3 + 1] = (b.vel?.y ?? 0) + (rand() - 0.5) * 2 * sp;
      this.vel[i * 3 + 2] = (b.vel?.z ?? 0) + (rand() - 0.5) * 2 * sp;
      const c = cols[Math.floor(rand() * cols.length)]!;
      this.col[i * 3] = c.r;
      this.col[i * 3 + 1] = c.g;
      this.col[i * 3 + 2] = c.b;
      this.age[i] = 0;
      this.life[i] = b.life[0] + rand() * (b.life[1] - b.life[0]);
      this.s0[i] = b.size[0];
      this.s1[i] = b.size[1];
      this.a0[i] = b.alpha ?? 1;
      this.grav[i] = b.gravity ?? 0;
      this.drag[i] = b.drag ?? 0;
      this.twinkle[i] = b.twinkle ? 1 : 0;
      this.size[i] = b.size[0];
      this.alpha[i] = 0;
    }
  }

  update(dt: number, t: number): void {
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      const age = this.age[i]! + dt;
      if (age >= this.life[i]!) continue;
      if (j !== i) this.move(i, j);
      this.age[j] = age;
      const k = age / this.life[j]!;
      const d = Math.max(0, 1 - this.drag[j]! * dt);
      this.vel[j * 3] = this.vel[j * 3]! * d;
      this.vel[j * 3 + 1] = this.vel[j * 3 + 1]! * d - this.grav[j]! * dt;
      this.vel[j * 3 + 2] = this.vel[j * 3 + 2]! * d;
      this.pos[j * 3] = this.pos[j * 3]! + this.vel[j * 3]! * dt;
      this.pos[j * 3 + 1] = this.pos[j * 3 + 1]! + this.vel[j * 3 + 1]! * dt;
      this.pos[j * 3 + 2] = this.pos[j * 3 + 2]! + this.vel[j * 3 + 2]! * dt;
      this.size[j] = this.s0[j]! + (this.s1[j]! - this.s0[j]!) * k;
      // in quickly, out slowly
      let a = this.a0[j]! * Math.min(1, age / 0.08) * (1 - k * k);
      if (this.twinkle[j]) a *= 0.35 + 0.65 * Math.abs(Math.sin(t * 9 + j * 1.7));
      this.alpha[j] = a;
      j++;
    }
    this.n = j;
    this.geo.setDrawRange(0, j);
    for (const name of ['position', 'color', 'size', 'alpha']) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }

  get count(): number {
    return this.n;
  }

  private move(i: number, j: number): void {
    for (const a of [this.pos, this.col, this.vel]) {
      a[j * 3] = a[i * 3]!;
      a[j * 3 + 1] = a[i * 3 + 1]!;
      a[j * 3 + 2] = a[i * 3 + 2]!;
    }
    for (const a of [this.life, this.s0, this.s1, this.a0, this.grav, this.drag]) a[j] = a[i]!;
    this.twinkle[j] = this.twinkle[i]!;
  }
}

/** The pools of one scene. */
export class Sparks {
  private readonly glow = new Pool(true);
  private readonly plain = new Pool(false);
  private last = performance.now();
  private clock = 0;
  private readonly size = new THREE.Vector2();

  constructor(scene: THREE.Object3D) {
    scene.add(this.glow.points, this.plain.points);
    const tick = (r: THREE.WebGLRenderer, _s: THREE.Scene, cam: THREE.Camera) => {
      const k = r.getDrawingBufferSize(this.size).y * 0.5 * (cam as THREE.PerspectiveCamera).projectionMatrix.elements[5]!;
      (this.glow.points.material as THREE.ShaderMaterial).uniforms.uScale!.value = k;
      (this.plain.points.material as THREE.ShaderMaterial).uniforms.uScale!.value = k;
      const now = performance.now();
      if (now - this.last < 3) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.clock += dt;
      this.glow.update(dt, this.clock);
      this.plain.update(dt, this.clock);
    };
    this.glow.points.onBeforeRender = tick;
    this.plain.points.onBeforeRender = tick;
  }

  burst(b: Burst): void {
    (b.glow ? this.glow : this.plain).add(b);
  }

  get live(): number {
    return this.glow.count + this.plain.count;
  }
}

const pools = new WeakMap<THREE.Object3D, Sparks>();

/** The pool for whatever scene `o` is in (null while it's in none). */
export function sparksFor(o: THREE.Object3D): Sparks | null {
  let top: THREE.Object3D = o;
  while (top.parent) top = top.parent;
  if (!(top as THREE.Scene).isScene) return null;
  let p = pools.get(top);
  if (!p) {
    p = new Sparks(top);
    pools.set(top, p);
  }
  return p;
}

// --- bubbles in a glass --------------------------------------------------------------------------

const BUBBLES = 14;

/** Bubbles rising from the bottom of a glass to the drink's surface, in the glass's own frame. */
export class Fizz {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(BUBBLES * 3);
  private readonly phase = new Float32Array(BUBBLES);
  private readonly geo = new THREE.BufferGeometry();

  constructor(
    private readonly bottom: THREE.Vector3,
    private readonly r: number,
    color: THREE.Color,
  ) {
    const col = new Float32Array(BUBBLES * 3);
    const size = new Float32Array(BUBBLES);
    const alpha = new Float32Array(BUBBLES);
    for (let i = 0; i < BUBBLES; i++) {
      this.phase[i] = (i * 0.618) % 1;
      col.set([color.r, color.g, color.b], i * 3);
      size[i] = 0.0022 + (i % 3) * 0.0006;
      alpha[i] = 0.8;
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    this.points = new THREE.Points(this.geo, fizzMaterial());
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  /** Rise, up to `top` (the drink's surface height in the glass's frame); none when there's no drink. */
  update(t: number, top: number): void {
    const h = top - this.bottom.y;
    this.points.visible = h > 0.004;
    if (!this.points.visible) return;
    for (let i = 0; i < BUBBLES; i++) {
      const u = (this.phase[i]! + t * (0.35 + (i % 4) * 0.08)) % 1;
      // a few columns, each from a point on the bottom, wobbling a little as they rise
      const col = i % 4;
      const a = col * 1.9 + 0.4;
      const rr = this.r * (0.25 + 0.2 * col);
      this.pos[i * 3] = this.bottom.x + Math.cos(a) * rr + Math.sin(t * 7 + i) * 0.0008;
      this.pos[i * 3 + 1] = this.bottom.y + u * h;
      this.pos[i * 3 + 2] = this.bottom.z + Math.sin(a) * rr;
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
  }
}

let fizzMat: THREE.ShaderMaterial | null = null;
function fizzMaterial(): THREE.ShaderMaterial {
  if (fizzMat) return fizzMat;
  fizzMat = material(true);
  fizzMat.uniforms.uScale!.value = 500;
  return fizzMat;
}

/** The bubbles' material scales with the view like the pool's. */
export function fizzScale(k: number): void {
  if (fizzMat) fizzMat.uniforms.uScale!.value = k;
}
