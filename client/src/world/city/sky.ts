// The sky and the city round the ground floor and the roof, drawn as cheaply as a view that big
// can be: a dome that follows the camera (one shader: the gradient, the sun, a few streaks of
// cloud, stars at night), the skyline as rings of painted towers at three distances (one
// open cylinder and one canvas each, lit windows in the paint), a handful of near towers merged
// into one mesh, the streets far below the roof as one disc, and the towers' red beacons as one
// point cloud. Everything is generated here; nothing is downloaded.

import * as THREE from 'three';
import { canvasTexture } from '../carpet.ts';
import { canvas } from '../textures.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { calmUniform } from '../../app/comfort.ts';

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
  /** v7.4: false for the building you're standing on (its roof is your floor): no parapet or plant room. */
  crown?: boolean;
}

/**
 * v7: towers that would stand in each other (their facades fought, windows flickering through
 * windows) are pulled apart: a later one that overlaps an earlier one gives up the overlap along
 * whichever side costs it less, leaving a gap, or is left out if that would leave a sliver.
 */
export function separate(list: readonly Tower[], gap = 0.6): Tower[] {
  const out: Tower[] = [];
  for (const t0 of list) {
    let t: Tower | null = { ...t0 };
    for (const o of out) {
      if (!t) break;
      const c: Tower = t;
      const lo = Math.max(c.y0 ?? 0, o.y0 ?? 0);
      const hi = Math.min((c.y0 ?? 0) + c.h, (o.y0 ?? 0) + o.h);
      if (hi <= lo) continue;
      const ox: number = (c.w + o.w) / 2 + gap - Math.abs(c.x - o.x);
      const oz: number = (c.d + o.d) / 2 + gap - Math.abs(c.z - o.z);
      if (ox <= 0 || oz <= 0) continue;
      // shrink away from the other along the cheaper axis
      if (ox / c.w <= oz / c.d) {
        const w: number = c.w - ox;
        t = w < 4 ? null : { ...c, w, x: c.x + (Math.sign(c.x - o.x) || 1) * (ox / 2) };
      } else {
        const d: number = c.d - oz;
        t = d < 4 ? null : { ...c, d, z: c.z + (Math.sign(c.z - o.z) || 1) * (oz / 2) };
      }
    }
    if (t) out.push(t);
  }
  return out;
}

/**
 * Near towers (v7.4): each one is an office block in a curtain wall or a residential tower of
 * punched windows in stone, so there are two facade materials; the stone or glass is tinted per
 * tower (vertex colours, a little brighter near the street's light), and its bays are its own
 * width, so no two towers read as one wallpaper. On top, a parapet, a plant room and on some a
 * water tank, all one plain mesh. Towers standing on the street get a storefront podium: shops,
 * lit or shuttered, their names over the windows. Four draw calls however many towers.
 */
export function towers(list: Tower[], kind: SkyKind, seed: number, o: { high: boolean; street?: boolean }): THREE.Group {
  const size = o.high ? 1024 : 512;
  const rnd = rng(seed ^ 0x5eed);
  const office: Box[] = [];
  const homes: Box[] = [];
  const crown: Box[] = [];
  const shops: Box[] = [];
  for (const t of separate(list)) {
    const y0 = t.y0 ?? 0;
    const isOffice = rnd() < 0.5;
    const tint = pickTint(isOffice ? OFFICE_TINTS : STONE_TINTS, rnd);
    // one repeat of the tile is 16 bays across and 16 floors up; a tower's bays are 1.5 to 2.1 m
    const bay = 1.5 + rnd() * 0.6;
    const uv = { su: 1 / (COLS * bay), sv: 1 / (ROWS * FLOOR_M), ou: rnd(), ov: Math.floor(rnd() * ROWS) / ROWS + 0.001 };
    (isOffice ? office : homes).push({ x: t.x, y: y0 + t.h / 2, z: t.z, w: t.w, h: t.h, d: t.d, tint, uv, lift: !!o.street && y0 === 0 });
    // the crown: a parapet round the roof, a plant room in one corner, a water tank in another
    const top = y0 + t.h;
    if (t.crown === false) continue;
    const dark = tint.clone().multiplyScalar(0.5);
    crown.push({ x: t.x, y: top + 0.35, z: t.z, w: t.w + 0.3, h: 1.3, d: t.d + 0.3, tint: dark });
    const sx = rnd() < 0.5 ? -1 : 1;
    const sz = rnd() < 0.5 ? -1 : 1;
    const pw = t.w * (0.25 + rnd() * 0.15);
    const pd = t.d * (0.25 + rnd() * 0.15);
    const ph = 2.8 + rnd() * 2.2;
    crown.push({ x: t.x + sx * (t.w / 2 - pw / 2 - 1), y: top + 1 + ph / 2, z: t.z + sz * (t.d / 2 - pd / 2 - 1), w: pw, h: ph, d: pd, tint: dark.clone().multiplyScalar(0.8) });
    if (!isOffice && rnd() < 0.6) {
      const r = 1.3 + rnd() * 0.5;
      crown.push({ x: t.x - sx * (t.w / 2 - r - 1.2), y: top + 1 + 2.4, z: t.z - sz * (t.d / 2 - r - 1.2), w: r * 2, h: 2.6, d: r * 2, tint: new THREE.Color('#3a2a22'), round: true });
      crown.push({ x: t.x - sx * (t.w / 2 - r - 1.2), y: top + 1 + 0.55, z: t.z - sz * (t.d / 2 - r - 1.2), w: r * 1.6, h: 1.1, d: r * 1.6, tint: new THREE.Color('#1c1c20') });
    }
    // a storefront round the foot of a tower standing on the street
    // (only in the zone whose street you walk, and on towers standing on it: not the lobby's, on its roof)
    if (o.street && y0 === 0 && t.h > 12) shops.push({ x: t.x, y: PODIUM / 2, z: t.z, w: t.w + 0.3, h: PODIUM, d: t.d + 0.3, tint: new THREE.Color(1, 1, 1), uv: { su: 1 / SHOPS_M, sv: 1 / PODIUM, ou: rnd(), ov: 0 } });
  }
  const group = new THREE.Group();
  group.name = 'towers';
  const glow = kind === 'night' ? 1.15 : 0.9;
  const add = (boxes: Box[], mat: THREE.Material, name: string) => {
    if (!boxes.length) return;
    mat.name = 'towers';
    const mesh = new THREE.Mesh(mergeBoxes(boxes), mat);
    mesh.name = name;
    group.add(mesh);
  };
  // (each tile drawn only if some tower wears it)
  const facade = (boxes: Box[], tile: () => Tile, name: string) => {
    if (!boxes.length) return;
    const t = tile();
    add(boxes, new THREE.MeshLambertMaterial({ map: t.map, emissiveMap: t.lit, emissive: new THREE.Color(1, 1, 1).multiplyScalar(glow), vertexColors: true }), name);
  };
  facade(office, () => officeTile(kind, seed, size), 'towers:office');
  facade(homes, () => homesTile(kind, seed + 1, size), 'towers:homes');
  add(crown, new THREE.MeshLambertMaterial({ vertexColors: true }), 'towers:crown');
  if (shops.length) {
    // 48 m of shops a repeat: twice the facades' width, so a metre of it is as sharp
    const s = storefrontTextures(seed, Math.min(2048, size * 2));
    add(shops, new THREE.MeshLambertMaterial({ map: s.map, emissiveMap: s.lit, emissive: new THREE.Color(1, 1, 1).multiplyScalar(0.85), vertexColors: true }), 'towers:shops');
  }
  return group;
}

/** The storefront podium's height (m): one tall shop storey and its fascia; its tile's length. */
const PODIUM = 5.6;
const SHOPS_M = 48;
/** A floor's height (m). */
const FLOOR_M = 3.6;

interface Box {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  tint: THREE.Color;
  /** World-projected facade UVs (scale and offset); none: one flat colour. */
  uv?: { su: number; sv: number; ou: number; ov: number };
  /** Brighter toward the foot (the street's light on it). */
  lift?: boolean;
  /** A short octagonal drum instead of a box (a water tank). */
  round?: boolean;
}

const OFFICE_TINTS = ['#aeb8c8', '#9fb2b0', '#c2b49c', '#b8b8bc', '#a4acbc'];
const STONE_TINTS = ['#c9b89a', '#b7a58e', '#a4715e', '#c4c0b6', '#8e8274', '#b89a82'];

function pickTint(list: string[], rnd: () => number): THREE.Color {
  const c = new THREE.Color(list[Math.floor(rnd() * list.length)]!);
  const k = 0.9 + rnd() * 0.2;
  return c.multiplyScalar(k);
}

/** Boxes (and drums) into one geometry with normals, per-vertex colours and facade UVs. */
function mergeBoxes(list: Box[]): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  const col = new THREE.Color();
  for (const b of list) {
    const g = b.round ? new THREE.CylinderGeometry(b.w / 2, b.w / 2, b.h, 8) : new THREE.BoxGeometry(b.w, b.h, b.d);
    g.translate(b.x, b.y, b.z);
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const y0 = b.y - b.h / 2;
    for (let i = 0; i < pos.count; i++) {
      const nx = Math.abs(nor.getX(i));
      const ny = Math.abs(nor.getY(i));
      if (b.uv) {
        // world-projected: along the face and up it; roofs take the tile's corner (a pier)
        const u = ny > 0.5 ? 0 : nx > 0.5 ? pos.getZ(i) : pos.getX(i);
        const v = ny > 0.5 ? 0 : pos.getY(i) - (b.lift === undefined ? y0 : 0);
        uv.setXY(i, ny > 0.5 ? 0.001 : u * b.uv.su + b.uv.ou, ny > 0.5 ? 0.001 : v * b.uv.sv + b.uv.ov);
      } else uv.setXY(i, 0, 0);
      // the street's glow on the lower floors: 1.5 at the foot, 1 by 30 m up
      const lift = b.lift ? 1 + 0.5 * Math.max(0, 1 - pos.getY(i) / 30) : 1;
      col.copy(b.tint).multiplyScalar(lift);
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geos.push(g.index ? g.toNonIndexed() : g);
    if (g.index) g.dispose();
  }
  const out = mergeGeometries(geos)!;
  for (const g of geos) g.dispose();
  out.computeBoundingSphere();
  return out;
}

type Tile = { map: THREE.Texture; lit: THREE.Texture };

/**
 * The two facade tiles, 16 bays across and 16 floors up each (a bay 64 px, a floor 64 at 1024):
 *   office  a curtain wall: vision glass over a dark spandrel at each floor, aluminium mullions;
 *           a floor is dark, all lit or lit along a run of bays, cool light with the ceiling's
 *           fittings brightest and the desks' partitions dark across the foot of the glass
 *   homes   punched windows in stone with sills and heads, every other pair closer together;
 *           a quarter of the rooms lit warm, some with curtains drawn to the sides, some with a
 *           blind half down, now and then a television's blue; furniture dark across the foot
 * The albedo is drawn light and neutral (the tower's vertex colour tints it); lit rooms are in the
 * emissive map only. Sunset: fewer rooms lit, the glass catching the warm sky.
 */

const COLS = 16;
const ROWS = 16;

function tileCanvases(S: number): [CanvasRenderingContext2D, CanvasRenderingContext2D, HTMLCanvasElement, HTMLCanvasElement] {
  const [a, ga] = canvas(S);
  const [b, gb] = canvas(S);
  gb.fillStyle = '#000';
  gb.fillRect(0, 0, S, S);
  return [ga, gb, a, b];
}

/** A lit room seen through a pane: brightest at the ceiling, dimmer down the room, the foot dark. */
function room(gb: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: THREE.Color, k: number, rnd: () => number, office: boolean): void {
  const grad = gb.createLinearGradient(0, y, 0, y + h);
  const at = (f: number) => `rgb(${Math.round(c.r * 255 * f * k)},${Math.round(c.g * 255 * f * k)},${Math.round(c.b * 255 * f * k)})`;
  grad.addColorStop(0, at(1));
  grad.addColorStop(0.18, at(office ? 0.95 : 0.85));
  grad.addColorStop(0.6, at(office ? 0.62 : 0.55));
  grad.addColorStop(1, at(0.3));
  gb.fillStyle = grad;
  gb.fillRect(x, y, w, h);
  if (office) {
    // the ceiling's fittings, a bright line across the top of the glass
    gb.fillStyle = at(1.1);
    gb.fillRect(x, y + h * 0.04, w, Math.max(1, h * 0.035));
    // partitions and screens across the foot
    gb.fillStyle = at(0.14);
    gb.fillRect(x, y + h * 0.72, w, h * 0.28);
    if (rnd() < 0.5) {
      gb.fillStyle = 'rgb(120,150,190)';
      gb.fillRect(x + rnd() * (w - 6), y + h * 0.66, Math.max(3, w * 0.12), h * 0.06);
    }
  } else {
    // furniture against the light: a sofa's back, a lamp, a chair
    gb.fillStyle = at(0.12);
    const n = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const fw = w * (0.25 + rnd() * 0.4);
      const fh = h * (0.12 + rnd() * 0.2);
      gb.fillRect(x + rnd() * (w - fw), y + h - fh, fw, fh);
    }
    if (rnd() < 0.35) {
      // a lamp's warm spot on the wall
      const lx = x + w * (0.2 + rnd() * 0.6);
      const ly = y + h * 0.45;
      const spot = gb.createRadialGradient(lx, ly, 0, lx, ly, w * 0.35);
      spot.addColorStop(0, 'rgba(255,220,160,0.55)');
      spot.addColorStop(1, 'rgba(255,220,160,0)');
      gb.fillStyle = spot;
      gb.fillRect(x, y, w, h);
    }
  }
}

function officeTile(kind: SkyKind, seed: number, S: number): Tile {
  const [ga, gb, a, b] = tileCanvases(S);
  const rnd = rng(seed);
  const cw = S / COLS;
  const ch = S / ROWS;
  const night = kind === 'night';
  // aluminium frame everywhere, then glass
  ga.fillStyle = '#9aa0a8';
  ga.fillRect(0, 0, S, S);
  const skyTop = night ? '#46546e' : '#d8a888';
  const skyLow = night ? '#141a26' : '#4a4658';
  for (let j = 0; j < ROWS; j++) {
    const y = j * ch;
    const spandrel = ch * 0.3;
    // the spandrel: dark glass over the slab
    ga.fillStyle = night ? '#23272e' : '#3a3438';
    ga.fillRect(0, y + ch - spandrel, S, spandrel);
    const vy = y + 3;
    const vh = ch - spandrel - 5;
    // how the floor is lit: dark, all on, or a run of bays (the cleaners, a late team)
    const r = rnd();
    const lit = night ? (r < 0.52 ? 'dark' : r < 0.64 ? 'all' : 'run') : r < 0.8 ? 'dark' : 'run';
    const run0 = Math.floor(rnd() * COLS);
    const runN = 2 + Math.floor(rnd() * 6);
    const tone = new THREE.Color(['#d8e0f0', '#f0e8d8', '#e4e4e0'][Math.floor(rnd() * 3)]!);
    const k = (lit === 'all' ? 0.42 : 0.5) + rnd() * 0.25;
    for (let i = 0; i < COLS; i++) {
      const x = i * cw + 2;
      const w = cw - 4;
      const grad = ga.createLinearGradient(0, vy, 0, vy + vh);
      grad.addColorStop(0, skyTop);
      grad.addColorStop(0.5, skyLow);
      grad.addColorStop(1, skyLow);
      ga.fillStyle = grad;
      ga.fillRect(x, vy, w, vh);
      const on = lit === 'all' ? rnd() < 0.92 : lit === 'run' ? (i - run0 + COLS) % COLS < runN : false;
      if (on) room(gb, x, vy, w, vh, tone, k * (0.85 + rnd() * 0.15), rnd, true);
    }
  }
  return { map: canvasTexture(a, 8), lit: canvasTexture(b, 8) };
}

function homesTile(kind: SkyKind, seed: number, S: number): Tile {
  const [ga, gb, a, b] = tileCanvases(S);
  const rnd = rng(seed);
  const cw = S / COLS;
  const ch = S / ROWS;
  const night = kind === 'night';
  // the wall: stone in courses, a faint grain
  ga.fillStyle = '#b8b2a8';
  ga.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += ch / 6) {
    ga.fillStyle = 'rgba(0,0,0,0.06)';
    ga.fillRect(0, y, S, 1);
  }
  for (let i = 0; i < S * 6; i++) {
    const v = rnd() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
    ga.fillStyle = v;
    ga.fillRect(rnd() * S, rnd() * S, 2, 2);
  }
  const warm = ['#ffd49a', '#ffc987', '#ffe2b8', '#ffbf7a', '#ffd9a8'];
  for (let j = 0; j < ROWS; j++) {
    const y = j * ch;
    // the floor's slab band
    ga.fillStyle = 'rgba(0,0,0,0.14)';
    ga.fillRect(0, y + ch - 6, S, 6);
    for (let i = 0; i < COLS; i++) {
      // windows in pairs: the pair's two sit closer together
      const pairOff = i % 2 === 0 ? cw * 0.12 : -cw * 0.12;
      const w = cw * 0.52;
      const x = i * cw + (cw - w) / 2 + pairOff;
      const h = ch * 0.52;
      const wy = y + ch * 0.2;
      // head and sill
      ga.fillStyle = '#d8d2c6';
      ga.fillRect(x - 3, wy - 5, w + 6, 5);
      ga.fillRect(x - 4, wy + h, w + 8, 6);
      ga.fillStyle = 'rgba(0,0,0,0.35)';
      ga.fillRect(x - 4, wy + h + 6, w + 8, 2);
      // the glass, the sky in it
      const grad = ga.createLinearGradient(0, wy, 0, wy + h);
      grad.addColorStop(0, night ? '#3a4660' : '#d0a080');
      grad.addColorStop(0.55, night ? '#10141e' : '#3e3a48');
      grad.addColorStop(1, night ? '#0c0f16' : '#2a2834');
      ga.fillStyle = grad;
      ga.fillRect(x, wy, w, h);
      // the frame's middle bar
      ga.fillStyle = '#2a2a2e';
      ga.fillRect(x + w / 2 - 1, wy, 2, h);
      if (rnd() < (night ? 0.27 : 0.09)) {
        const tv = rnd() < 0.08;
        const c = new THREE.Color(tv ? '#8fb4ff' : warm[Math.floor(rnd() * warm.length)]!);
        room(gb, x, wy, w, h, c, (tv ? 0.55 : 0.7) + rnd() * 0.3, rnd, false);
        const style = rnd();
        if (style < 0.35) {
          // curtains drawn to the sides, lit through
          const cw2 = w * (0.16 + rnd() * 0.1);
          const cc = `rgba(${Math.round(c.r * 180)},${Math.round(c.g * 120)},${Math.round(c.b * 80)},0.9)`;
          gb.fillStyle = cc;
          gb.fillRect(x, wy, cw2, h);
          gb.fillRect(x + w - cw2, wy, cw2, h);
        } else if (style < 0.6) {
          // a blind part way down: glowing softly through it
          const bh = h * (0.25 + rnd() * 0.45);
          gb.fillStyle = `rgba(${Math.round(c.r * 150)},${Math.round(c.g * 120)},${Math.round(c.b * 90)},1)`;
          gb.fillRect(x, wy, w, bh);
          ga.fillStyle = '#c8bca8';
          ga.fillRect(x, wy, w, bh);
        }
        // the frame's bar over the light
        gb.fillStyle = '#000';
        gb.fillRect(x + w / 2 - 1, wy, 2, h);
      } else if (rnd() < 0.3) {
        // drawn curtains in a dark room
        ga.fillStyle = ['#6a5a4a', '#4a4e58', '#7a6a58', '#5a4640'][Math.floor(rnd() * 4)]!;
        ga.fillRect(x, wy, w, h);
      }
    }
  }
  return { map: canvasTexture(a, 8), lit: canvasTexture(b, 8) };
}

const SHOP_NAMES = ['PHARMACY', 'DELI', 'CAFE', 'WINE & SPIRITS', 'PIZZA', 'FLOWERS', 'BAKERY', 'NAILS', 'OPTICAL', 'SUSHI', 'LAUNDRY', 'SHOES', 'BOOKS', 'NEWS', 'BAR', 'NOODLES', 'GELATO', 'TAILOR', 'BARBER', 'MARKET', 'DINER', 'JEWELRY', 'TOBACCO', 'FITNESS'];
const SIGN_COLORS = ['#ffdca0', '#ff8a6a', '#9fe0ff', '#ffe27a', '#ff9ad0', '#b8ffb0', '#ffffff'];

/**
 * The storefront band, 24 m of shops a repeat (1024 px across, the podium's height up): shops 4
 * to 7 m wide between stone piers, each with its name over the window (lit letters), an awning on
 * some, the window lit warm with shelves and a door, or a steel shutter pulled down for the night.
 */
function storefrontTextures(seed: number, W: number): Tile {
  const H = Math.round((W / SHOPS_M) * PODIUM * 2);
  const [a, ga] = canvas(W, H);
  const [b, gb] = canvas(W, H);
  const rnd = rng(seed ^ 0x5409);
  const px = W / SHOPS_M;
  ga.fillStyle = '#6a645c';
  ga.fillRect(0, 0, W, H);
  gb.fillStyle = '#000';
  gb.fillRect(0, 0, W, H);
  // canvas y runs down; the texture's v runs up, so the foot is at the canvas's bottom
  const fascia = { y0: H * 0.06, y1: H * 0.24 };
  const win = { y0: H * 0.3, y1: H * 0.98 };
  let x = 0;
  const names = [...SHOP_NAMES].sort(() => rnd() - 0.5);
  let n = 0;
  while (x < W - 2 * px) {
    const pier = 0.45 * px;
    let w = (4 + rnd() * 3) * px;
    if (W - (x + w) < 3.5 * px) w = W - x;
    // the pier
    ga.fillStyle = '#8a8276';
    ga.fillRect(x, 0, pier, H);
    const sx = x + pier;
    const sw = w - pier;
    // the fascia and its lettering
    ga.fillStyle = '#1a1a1e';
    ga.fillRect(sx, fascia.y0, sw, fascia.y1 - fascia.y0);
    const open = rnd() < 0.72;
    const name = names[n++ % names.length]!;
    const sign = SIGN_COLORS[Math.floor(rnd() * SIGN_COLORS.length)]!;
    const fs = Math.min((fascia.y1 - fascia.y0) * 0.62, (sw * 0.9) / (name.length * 0.62));
    for (const g of [ga, gb]) {
      g.font = `600 ${fs.toFixed(0)}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = g === ga ? '#e8e0d0' : open ? sign : '#3a3024';
      g.fillText(name, sx + sw / 2, (fascia.y0 + fascia.y1) / 2);
    }
    if (open) {
      // the window: the shop lit inside, shelves and goods, a door with its bright glass
      const c = new THREE.Color(['#ffe6c0', '#fff4e4', '#e6eeff', '#ffd8a8', '#f4f0e8'][Math.floor(rnd() * 5)]!).multiplyScalar(0.55 + rnd() * 0.35);
      const grad = gb.createLinearGradient(0, win.y0, 0, win.y1);
      grad.addColorStop(0, `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`);
      grad.addColorStop(1, `rgb(${Math.round(c.r * 120)},${Math.round(c.g * 110)},${Math.round(c.b * 100)})`);
      gb.fillStyle = grad;
      gb.fillRect(sx + 2, win.y0, sw - 4, win.y1 - win.y0);
      for (let s = 0; s < 3; s++) {
        const sy = win.y0 + (win.y1 - win.y0) * (0.3 + s * 0.22);
        gb.fillStyle = 'rgba(60,40,30,0.8)';
        gb.fillRect(sx + 4, sy, sw * 0.62, 2);
        for (let k = 0; k < 10; k++) {
          gb.fillStyle = `hsl(${Math.floor(rnd() * 360)},30%,${25 + Math.floor(rnd() * 20)}%)`;
          const gw = 0.12 * px + rnd() * 0.2 * px;
          const gh = 0.15 * px + rnd() * 0.3 * px;
          gb.fillRect(sx + 6 + rnd() * (sw * 0.6 - gw), sy - gh, gw, gh);
        }
      }
      ga.fillStyle = '#20242a';
      ga.fillRect(sx + 2, win.y0, sw - 4, win.y1 - win.y0);
      // the door, and its frame
      const dx = sx + sw * 0.72;
      const dw = Math.min(sw * 0.22, 1.1 * px);
      gb.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 250)},${Math.round(c.b * 240)})`;
      gb.fillRect(dx, win.y0 + (win.y1 - win.y0) * 0.1, dw, (win.y1 - win.y0) * 0.9);
      for (const g of [ga, gb]) {
        g.fillStyle = '#101012';
        g.fillRect(dx - 2, win.y0 + (win.y1 - win.y0) * 0.1, 3, (win.y1 - win.y0) * 0.9);
        g.fillRect(dx + dw - 1, win.y0 + (win.y1 - win.y0) * 0.1, 3, (win.y1 - win.y0) * 0.9);
      }
      // mullions across the window
      for (const g of [ga, gb]) {
        g.fillStyle = '#101012';
        g.fillRect(sx, win.y0, sw, 3);
        g.fillRect(sx + sw * 0.36, win.y0, 3, win.y1 - win.y0);
      }
      if (rnd() < 0.45) {
        // an awning over it
        const cols = [['#7a1e22', '#e8dcc8'], ['#1e3a5a', '#e8e0d0'], ['#244a2a', '#e0d8c0'], ['#2a2a2a', '#9a8a6a']][Math.floor(rnd() * 4)]!;
        const stripe = 0.35 * px;
        for (let k = 0; sx + k * stripe < sx + sw; k++) {
          ga.fillStyle = cols[k % 2]!;
          ga.fillRect(sx + k * stripe, fascia.y1, Math.min(stripe, sx + sw - (sx + k * stripe)), win.y0 - fascia.y1 + 4);
        }
        gb.fillStyle = '#000';
        gb.fillRect(sx, fascia.y1, sw, win.y0 - fascia.y1 + 4);
      }
    } else {
      // a roll-down shutter: steel slats, a little of the street's light on it
      for (let y = win.y0; y < win.y1; y += 4) {
        ga.fillStyle = (y / 4) % 2 < 1 ? '#8c9096' : '#72767c';
        ga.fillRect(sx + 2, y, sw - 4, 4);
      }
      ga.fillStyle = '#4a4e54';
      ga.fillRect(sx + 2, win.y0 - 6, sw - 4, 6);
    }
    x += w;
  }
  return { map: canvasTexture(a, 8), lit: canvasTexture(b, 8) };
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
  // (steady while calm: comfort.ts's uniform, shared)
  private readonly uniforms = { uTime: { value: 0 }, uScale: { value: 600 }, uSteady: calmUniform };

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

  update(dt: number): void {
    this.uniforms.uTime.value += dt;
  }
}
