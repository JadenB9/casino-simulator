// The sky and the city round the ground floor and the roof, drawn as cheaply as a view that big
// can be: a dome that follows the camera (one shader: the gradient, the sun, a few streaks of
// cloud, stars at night), the skyline as rings of painted towers at three distances (one
// open cylinder and one canvas each, lit windows in the paint), a handful of near towers merged
// into one mesh, the streets far below the roof as one disc, and the towers' red beacons as one
// point cloud. Everything is generated here; nothing is downloaded.

import * as THREE from 'three';
import { canvasTexture } from '../carpet.ts';

export type SkyKind = 'night' | 'sunset';

/** A seeded random in [0, 1). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SkyLook {
  zenith: string;
  mid: string;
  horizon: string;
  below: string;
  sun: THREE.Color;
  glow: THREE.Color;
  cloud: string;
  stars: number;
}

const LOOKS: Record<SkyKind, SkyLook> = {
  // a city night: deep blue overhead, the streets' orange glow along the horizon
  night: { zenith: '#03050c', mid: '#0b1224', horizon: '#3a2e38', below: '#1a1418', sun: new THREE.Color(0, 0, 0), glow: new THREE.Color('#ff9a52').multiplyScalar(0.0), cloud: '#2a2230', stars: 1 },
  // the sun a finger over the towers: gold at the horizon through rose to a deep violet overhead
  sunset: { zenith: '#1e2350', mid: '#7a4a78', horizon: '#ffae5e', below: '#6a4a58', sun: new THREE.Color('#fff0c8').multiplyScalar(1.5), glow: new THREE.Color('#ff9848'), cloud: '#ff8a70', stars: 0 },
};

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // on the far plane, behind everything
  gl_Position = p.xyww;
}`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uBelow;
uniform vec3 uSun;
uniform vec3 uGlow;
uniform vec3 uCloud;
uniform vec3 uSunDir;
uniform float uStars;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col;
  if (h >= 0.0) {
    col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, h));
    col = mix(col, uZenith, smoothstep(0.18, 0.75, h));
  } else {
    col = mix(uHorizon, uBelow, smoothstep(0.0, 0.2, -h));
  }
  float s = max(dot(d, uSunDir), 0.0);
  // the sun's wide glow along the horizon, a tighter halo, the disc
  float band = exp(-abs(h - uSunDir.y) * 7.0);
  col += uGlow * (pow(s, 6.0) * 0.55 * band + pow(s, 40.0) * 0.8);
  // long thin streaks of cloud low over the horizon, lit from below on the sun's side
  float a = atan(d.x, d.z);
  float c = noise(vec2(a * 9.0, h * 70.0)) * 0.6 + noise(vec2(a * 23.0, h * 160.0)) * 0.4;
  float streak = smoothstep(0.58, 0.8, c) * smoothstep(0.015, 0.05, h) * (1.0 - smoothstep(0.12, 0.3, h));
  col = mix(col, uCloud * (0.45 + 0.75 * pow(s, 3.0)), streak * 0.7);
  col += uSun * smoothstep(0.99955, 0.99975, s);
  // a few stars overhead
  vec2 g = floor(vec2(a * 260.0, h * 420.0));
  col += uStars * step(0.9975, hash(g)) * smoothstep(0.25, 0.6, h) * 0.55;
  // the sun's own disc stays just under the bloom's threshold: its halo is painted here, not left
  // to the glow (a source that bright would take the whole frame's bloom)
  gl_FragColor = vec4(min(col, vec3(1.58)), 1.0);
  #include <colorspace_fragment>
}`;

/** The sky dome: drawn first, on the far plane, following the camera so it never ends. */
export function skyDome(kind: SkyKind, sunDir: THREE.Vector3): THREE.Mesh {
  const L = LOOKS[kind];
  const lin = (hex: string) => new THREE.Color(hex);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: lin(L.zenith) },
      uMid: { value: lin(L.mid) },
      uHorizon: { value: lin(L.horizon) },
      uBelow: { value: lin(L.below) },
      uSun: { value: L.sun },
      uGlow: { value: L.glow },
      uCloud: { value: lin(L.cloud) },
      uSunDir: { value: sunDir.clone().normalize() },
      uStars: { value: L.stars },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
  });
  material.name = `sky-${kind}`;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), material);
  dome.name = `sky:${kind}`;
  dome.renderOrder = -100;
  dome.frustumCulled = false;
  dome.onBeforeRender = (_r, _s, camera) => {
    dome.position.copy(camera.position);
    dome.updateMatrixWorld();
  };
  return dome;
}

export interface RingSpec {
  /** Distance from the ring's middle, the height of the canvas's top and bottom edges (m). */
  radius: number;
  y0: number;
  y1: number;
  seed: number;
  /** Towers' heights as a share of the ring's height, low and high. */
  low: number;
  high: number;
  /** Silhouette colour, the haze at the ring's foot, lit windows (share) and how bright they read. */
  body: string;
  haze: string;
  lit: number;
  glow: number;
  kind: SkyKind;
  /** Toward the sun (radians about y, 0 = +z, as the cylinder's own angle). */
  sunAngle?: number;
  /** Canvas width; a quarter of it tall. */
  size: number;
}

/**
 * A ring of towers painted on a canvas and wrapped round an open cylinder, seen from inside.
 * Against the sun the towers are dark shapes with a lit edge; away from it their faces take the
 * low light. Windows are the canvas's own brightest pixels (the bloom's threshold takes the
 * brightest few).
 */
export function skylineRing(s: RingSpec): THREE.Mesh {
  const W = s.size;
  const H = W / 4;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const rnd = rng(s.seed);
  const mPerPx = (Math.PI * 2 * s.radius) / W;
  const yPerPx = (s.y1 - s.y0) / H;
  // a building's window pitch: about 1.8 m by 3.6 m
  const wx = Math.max(2, Math.round(1.8 / mPerPx));
  const wy = Math.max(2, Math.round(3.6 / yPerPx));
  const body = new THREE.Color(s.body);
  const haze = new THREE.Color(s.haze);
  const warm = new THREE.Color(s.kind === 'sunset' ? '#ff9a5c' : '#ffb870');
  let x = 0;
  while (x < W) {
    const w = Math.round((14 + rnd() * 46) / mPerPx);
    const tall = rnd() < 0.12 ? 1 : 0.65;
    const top = Math.round(H * (s.low + (s.high - s.low) * Math.pow(rnd(), 1.6) * tall));
    const angle = ((x + w / 2) / W) * Math.PI * 2;
    // lit by the low sun on the side away from it: how much this tower's face turns to the light
    const face = s.sunAngle === undefined ? 0 : Math.max(0, -Math.cos(angle - s.sunAngle));
    const col = body.clone().lerp(warm, face * 0.32);
    drawTower(g, x, w, top, H, col, haze, rnd, wx, wy, s.lit, s.kind, face);
    // gaps between some towers, where the next ring shows through
    x += w + (rnd() < 0.3 ? Math.round(rnd() * 20) : 0);
  }
  const tex = canvasTexture(c, 4);
  tex.wrapT = THREE.ClampToEdgeWrapping;
  const material = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1, 1, 1).multiplyScalar(s.glow), side: THREE.BackSide, alphaTest: 0.5, fog: false });
  material.name = 'skyline';
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(s.radius, s.radius, s.y1 - s.y0, 96, 1, true), material);
  mesh.position.y = (s.y0 + s.y1) / 2;
  mesh.name = 'skyline';
  mesh.renderOrder = -90;
  return mesh;
}

function drawTower(g: CanvasRenderingContext2D, x: number, w: number, top: number, H: number, col: THREE.Color, haze: THREE.Color, rnd: () => number, wx: number, wy: number, lit: number, kind: SkyKind, face: number): void {
  const y = H - top;
  // the body fades into the haze toward its foot
  const grad = g.createLinearGradient(0, y, 0, H);
  grad.addColorStop(0, `#${col.getHexString()}`);
  grad.addColorStop(1, `#${col.clone().lerp(haze, 0.7).getHexString()}`);
  g.fillStyle = grad;
  g.fillRect(x, y, w, top);
  // a setback or two, a crown, a mast
  const kindOf = rnd();
  if (kindOf < 0.3 && w > 8) {
    const sw = Math.round(w * (0.45 + rnd() * 0.3));
    const sh = Math.round(top * (0.06 + rnd() * 0.12));
    g.fillStyle = `#${col.getHexString()}`;
    g.fillRect(x + Math.round((w - sw) / 2), y - sh, sw, sh);
    if (rnd() < 0.5) g.fillRect(x + Math.round(w / 2), y - sh - Math.round(top * 0.12), 1, Math.round(top * 0.12));
  } else if (kindOf < 0.42) {
    g.fillStyle = `#${col.getHexString()}`;
    g.fillRect(x + Math.round(w / 2), y - Math.round(top * 0.15), Math.max(1, Math.round(w * 0.04)), Math.round(top * 0.15));
  }
  // the lit edge against the sun
  if (kind === 'sunset' && face < 0.2) {
    g.fillStyle = 'rgba(255,190,120,0.55)';
    g.fillRect(x, y, w, 1);
  }
  // windows: rows of them, some lit; whole floors lit or dark now and then
  const light = kind === 'night' ? ['#ffd9a0', '#ffe8c4', '#cfe0ff', '#ffc27a'] : ['#ffd08a', '#ffe0b0', '#ffb070'];
  const pad = Math.max(1, Math.round(wx * 0.3));
  for (let yy = y + wy; yy < H - wy; yy += wy) {
    const floor = rnd();
    const rowLit = floor < 0.15 ? 0 : floor > 0.93 ? 0.9 : lit;
    for (let xx = x + pad; xx < x + w - pad - 1; xx += wx) {
      if (rnd() > rowLit) continue;
      g.fillStyle = light[Math.floor(rnd() * light.length)]!;
      g.globalAlpha = 0.55 + rnd() * 0.45;
      g.fillRect(xx, yy, Math.max(1, wx - pad), Math.max(1, Math.round(wy * 0.55)));
    }
  }
  g.globalAlpha = 1;
  // a lit crown on some
  if (rnd() < 0.14 && w > 6) {
    g.fillStyle = kind === 'night' ? '#e8f0ff' : '#ffe2b0';
    g.fillRect(x + 1, y + 1, w - 2, Math.max(1, Math.round(wy * 0.4)));
  }
}

/** A tower near enough to stand in 3D: its footprint's middle, size and height (m). */
export interface Tower {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** Its foot (the roof's towers stand on the streets far below). */
  y0?: number;
}

/**
 * Near towers as one merged mesh: facades of glass and stone with windows at a real pitch
 * (world-projected, so every tower keeps the same floor height), lit windows in the emissive map,
 * a flat roof. The sun and the hemisphere light them.
 */
export function towers(list: Tower[], kind: SkyKind, seed: number): THREE.Mesh {
  const geos: THREE.BufferGeometry[] = [];
  for (const t of list) {
    const g = new THREE.BoxGeometry(t.w, t.h, t.d);
    g.translate(t.x, (t.y0 ?? 0) + t.h / 2, t.z);
    // world-projected UVs: one texture repeat is 8 windows across and 8 floors up
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const off = (t.x * 0.37 + t.z * 0.61) % 1;
    for (let i = 0; i < pos.count; i++) {
      const nx = Math.abs(nor.getX(i));
      const ny = Math.abs(nor.getY(i));
      const u = ny > 0.5 ? 0 : nx > 0.5 ? pos.getZ(i) : pos.getX(i);
      const v = ny > 0.5 ? 0 : pos.getY(i);
      uv.setXY(i, u / 27.2 + off, v / 28.8 + 0.001);
    }
    geos.push(g);
  }
  const merged = mergeBoxes(geos);
  const { map, lit } = facadeTextures(kind, seed);
  const material = new THREE.MeshLambertMaterial({ map, emissiveMap: lit, emissive: new THREE.Color(1, 1, 1).multiplyScalar(kind === 'night' ? 1.5 : 1.1) });
  material.name = 'towers';
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = 'towers';
  return mesh;
}

function mergeBoxes(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let verts = 0;
  let idx = 0;
  for (const g of list) {
    verts += g.getAttribute('position').count;
    idx += g.index!.count;
  }
  const pos = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const index = new Uint32Array(idx);
  let v = 0;
  let k = 0;
  for (const g of list) {
    pos.set(g.getAttribute('position').array as Float32Array, v * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, v * 3);
    uv.set(g.getAttribute('uv').array as Float32Array, v * 2);
    const gi = g.index!.array;
    for (let i = 0; i < gi.length; i++) index[k++] = gi[i]! + v;
    v += g.getAttribute('position').count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

/**
 * A facade tile, 16 windows across and 8 floors up (1.7 m by 3.6 m each): a stone spandrel at
 * each floor, a mullion between windows and a pier every fourth, glass catching the sky high in
 * each pane; the emissive map holds which windows are lit (some with their blinds half down).
 */
function facadeTextures(kind: SkyKind, seed: number): { map: THREE.Texture; lit: THREE.Texture } {
  const COLS = 16;
  const ROWS = 8;
  const S = 512;
  const cw = S / COLS;
  const ch = S / ROWS;
  const a = document.createElement('canvas');
  const b = document.createElement('canvas');
  a.width = a.height = b.width = b.height = S;
  const ga = a.getContext('2d')!;
  const gb = b.getContext('2d')!;
  const rnd = rng(seed);
  const stone = kind === 'night' ? '#4a4a50' : '#8a7870';
  ga.fillStyle = stone;
  ga.fillRect(0, 0, S, S);
  gb.fillStyle = '#000';
  gb.fillRect(0, 0, S, S);
  const glassTop = kind === 'night' ? '#2a3448' : '#c08a70';
  const glassLow = kind === 'night' ? '#0e121c' : '#3a3448';
  for (let j = 0; j < ROWS; j++) {
    const floorLit = rnd() < 0.18 ? 0.02 : rnd() < 0.12 ? 0.85 : kind === 'night' ? 0.34 : 0.14;
    const y = j * ch;
    // the floor's spandrel band along its foot
    for (let i = 0; i < COLS; i++) {
      const pier = i % 4 === 0 ? 3 : 1;
      const x = i * cw + pier;
      const w = cw - pier - 1;
      const h = ch * 0.66;
      const gy = y + ch * 0.12;
      const grad = ga.createLinearGradient(0, gy, 0, gy + h);
      grad.addColorStop(0, glassTop);
      grad.addColorStop(0.45, glassLow);
      grad.addColorStop(1, glassLow);
      ga.fillStyle = grad;
      ga.fillRect(x, gy, w, h);
      if (rnd() < floorLit) {
        const c = ['#ffcf8a', '#ffe0b0', '#ffd49a', '#e0e8ff', '#ffb870'][Math.floor(rnd() * 5)]!;
        const blind = rnd() < 0.3 ? h * (0.3 + rnd() * 0.4) : 0;
        gb.fillStyle = c;
        gb.globalAlpha = 0.35 + rnd() * 0.5;
        gb.fillRect(x, gy + blind, w, h - blind);
        gb.globalAlpha = 1;
        if (blind) {
          ga.fillStyle = '#b8a890';
          ga.fillRect(x, gy, w, blind);
        }
      }
    }
    // a thin shadow line under each spandrel
    ga.fillStyle = 'rgba(0,0,0,0.25)';
    ga.fillRect(0, y + ch * 0.78, S, 2);
  }
  const map = canvasTexture(a, 8);
  const lit = canvasTexture(b, 8);
  return { map, lit };
}

/** The streets far below the roof: a grid of lit avenues and dark blocks on one disc. */
export function cityBelow(radius: number, y: number, seed: number): THREE.Mesh {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const rnd = rng(seed);
  g.fillStyle = '#1c1418';
  g.fillRect(0, 0, S, S);
  // blocks, their roofs catching a little of the sky
  const block = 34;
  for (let y = 0; y < S; y += block) {
    for (let x = 0; x < S; x += block) {
      const k = 0.7 + rnd() * 0.5;
      g.fillStyle = `rgb(${Math.round(52 * k)},${Math.round(40 * k)},${Math.round(50 * k)})`;
      g.fillRect(x + 5, y + 5, block - 10, block - 10);
      if (rnd() < 0.35) {
        g.fillStyle = 'rgba(255,200,140,0.5)';
        g.fillRect(x + 8 + rnd() * 14, y + 8 + rnd() * 14, 2, 2);
      }
    }
  }
  // the avenues' street lights and the traffic on them
  for (let i = 0; i <= S; i += block) {
    for (let t = 0; t < S; t += 6) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,190,110,0.8)' : 'rgba(255,220,170,0.55)';
      g.fillRect(i - 1, t, 2, 2);
      g.fillRect(t, i - 1, 2, 2);
    }
  }
  const tex = canvasTexture(c, 8);
  tex.repeat.set(radius / 160, radius / 160);
  const material = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1, 1, 1).multiplyScalar(1.1) });
  material.name = 'city-below';
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.name = 'city-below';
  mesh.renderOrder = -95;
  return mesh;
}

const BEACON_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uScale;
uniform float uSteady;
attribute float aPhase;
varying float vOn;
void main() {
  // aircraft warning lights: a slow blink, each tower on its own beat (steady when calm)
  float blink = step(0.55, fract(uTime * 0.5 + aPhase));
  vOn = mix(blink, 0.8, uSteady);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uScale * 1.6 / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const BEACON_FRAGMENT = /* glsl */ `
varying float vOn;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  float a = smoothstep(0.5, 0.0, d) * vOn;
  gl_FragColor = vec4(vec3(3.2, 0.25, 0.18) * a, a);
}`;

/** Red lights on the tallest towers' tops, blinking slowly (steady when calm). */
export class Beacons {
  readonly points: THREE.Points;
  private readonly uniforms = { uTime: { value: 0 }, uScale: { value: 600 }, uSteady: { value: 0 } };

  constructor(at: THREE.Vector3[], seed: number) {
    const rnd = rng(seed);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(at.flatMap((p) => [p.x, p.y, p.z]), 3));
    g.setAttribute('aPhase', new THREE.Float32BufferAttribute(at.map(() => rnd()), 1));
    const material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: BEACON_VERTEX, fragmentShader: BEACON_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(g, material);
    this.points.name = 'beacons';
    this.points.frustumCulled = false;
    const size = new THREE.Vector2();
    this.points.onBeforeRender = (renderer, _s, camera) => {
      renderer.getDrawingBufferSize(size);
      this.uniforms.uScale.value = size.y / (2 * Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov ?? 55) / 2));
    };
  }

  update(dt: number, calm: boolean): void {
    this.uniforms.uTime.value += dt;
    this.uniforms.uSteady.value = calm ? 1 : 0;
  }
}
