// Wearables: the boutique's pieces on a character, and a bar order in its right hand.
//
// Every piece is fitted to the outfit model it goes on, once per model, from that model's rest
// pose: where the neck, collarbones and chest are for a chain, the mouth for a grill, the left
// wrist for a watch, the eyes for shades, the crown of the head for a hat. A piece is built in the
// character's frame (metres, y up, facing +z), then carried into the skeleton's bind space and
// skinned rigidly to one bone, so it moves with the body as it idles, walks and waves.
//
// A character's pieces are merged by material into skinned meshes on its own skeleton: metal,
// enamel, lenses and felt share one "jewel" material that reads colour, metalness and roughness
// per vertex, and diamonds use the "gem" material (white metal, faceted normals, a glint). A LOD
// keeps the full set within a few metres; further off only the chain (as one plain gold rope) and
// the hat are drawn. Both materials reflect a small dim casino, dark with bright warm downlights,
// instead of the scene's bright studio: that contrast is what makes gold read as gold.
//
// Special clothes add no meshes. They dress the character in the outfit model they are cut from
// (dressed()) and swap its body material for one of their own (gold lamé, satin lapels, velvet,
// fur, diamonds), which picks the cloth out by each vertex's Look slot and rest position.
//
// A bar order is held in the right hand: a glass, bottle, cup or plate skinned to the wrist, and
// an additive clip on the character's own mixer brings the forearm up to carry it, walking or not.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Look } from '../../../shared/src/look.ts';
import { barItem, itemOfKind, type BarModel } from '../../../shared/src/items.ts';
import { serverNow } from '../net/clock.ts';

type V3 = THREE.Vector3;
const V = (x = 0, y = 0, z = 0): V3 => new THREE.Vector3(x, y, z);

// --- finishes ----------------------------------------------------------------------------------
// Colour in linear RGB (vertex colours are linear), metalness and roughness, per vertex.

interface Finish {
  c: readonly [number, number, number];
  m: number;
  r: number;
}
const fin = (r: number, g: number, b: number, m: number, rough: number): Finish => ({ c: [r, g, b], m, r: rough });

// Measured reflectances: 18k yellow gold is a little paler than pure gold, rose gold has copper
// in it, white gold is rhodium-plated.
const GOLD = fin(1.0, 0.72, 0.33, 1, 0.16);
const GOLD_SOFT = fin(1.0, 0.72, 0.33, 1, 0.3);
const ROSE = fin(0.97, 0.58, 0.45, 1, 0.17);
const WHITE_GOLD = fin(0.8, 0.79, 0.76, 1, 0.12);
const STEEL = fin(0.62, 0.62, 0.62, 1, 0.22);
const ENAMEL = fin(0.006, 0.006, 0.008, 0, 0.16);
const DIAL = fin(0.58, 0.42, 0.22, 0.85, 0.3);
const DIAL_ICE = fin(0.72, 0.74, 0.78, 0.9, 0.2);
const HANDS = fin(0.012, 0.012, 0.014, 0.5, 0.25);
const FELT = fin(0.014, 0.013, 0.012, 0, 0.9);
const STRAW = fin(0.58, 0.44, 0.24, 0, 0.8);
const RIBBON = fin(0.01, 0.01, 0.01, 0, 0.5);

/** The finish of each metal an item can be made in. */
const METALS = { gold: GOLD, rose: ROSE, white: WHITE_GOLD } as const;
type Metal = keyof typeof METALS;

// --- the environment the metal reflects --------------------------------------------------------

let env: THREE.Texture | null = null;
let envStarted = false;
const reflective = new Set<THREE.MeshStandardMaterial>();
const clock = { t: 0, frame: -1 };

function reflect(m: THREE.MeshStandardMaterial): void {
  reflective.add(m);
  if (env) {
    m.envMap = env;
    m.needsUpdate = true;
  }
}

/**
 * Runs before any wearable is drawn: keeps the glint clock and, the first time, builds the casino
 * the metal reflects (after that frame, with the renderer that drew it).
 */
function beforeDraw(renderer: THREE.WebGLRenderer): void {
  const frame = renderer.info.render.frame;
  if (frame !== clock.frame) {
    clock.frame = frame;
    clock.t = performance.now() / 1000;
    for (const u of timeUniforms) u.value = clock.t;
  }
  if (envStarted) return;
  envStarted = true;
  queueMicrotask(() => {
    env = casinoEnvironment(renderer);
    for (const m of reflective) {
      m.envMap = env;
      m.needsUpdate = true;
    }
  });
}

const timeUniforms: { value: number }[] = [];

function lit(r: number, g: number, b: number, side: THREE.Side = THREE.FrontSide): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), side, toneMapped: false });
}

/**
 * A small dim casino, prefiltered once: dark warm walls and carpet, a grid of hot downlights, a few
 * chandeliers, the glow of slot banks at eye level and a jeweller's key light in front. Polished
 * metal is mostly dark with sharp warm highlights in it, the way it looks on a casino floor.
 */
function casinoEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(14, 5, 14), lit(0.028, 0.02, 0.015, THREE.BackSide));
  room.position.y = 1.1;
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2), lit(0.07, 0.012, 0.01));
  carpet.position.y = -1.35;
  scene.add(room, carpet);

  const spot = new THREE.CircleGeometry(0.1, 16).rotateX(Math.PI / 2);
  const at: THREE.Matrix4[] = [];
  for (let x = -6; x <= 6; x += 1.1) for (let z = -6; z <= 6; z += 1.1) at.push(new THREE.Matrix4().makeTranslation(x + 0.25, 2.2, z - 0.35));
  const downlights = new THREE.InstancedMesh(spot, lit(9, 6.6, 4), at.length);
  at.forEach((m, i) => downlights.setMatrixAt(i, m));
  scene.add(downlights);
  for (const [x, z] of [
    [2.8, 2.2],
    [-3.2, 2.6],
    [2.4, -3.1],
    [-3.1, -2.5],
  ] as const) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 10), lit(3.2, 2.3, 1.3));
    c.position.set(x, 1.5, z);
    scene.add(c);
  }
  const band = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 0.9, 48, 1, true), lit(0.32, 0.19, 0.08, THREE.BackSide));
  band.position.y = -0.1;
  scene.add(band);
  // the jeweller's lamp: a broad soft panel above and in front, and a cooler fill from one side
  const key = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.2).rotateX(Math.PI / 2), lit(5, 4.3, 3.4));
  key.position.set(0.6, 2.3, 2.4);
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.8), lit(0.9, 1.0, 1.15));
  fill.position.set(-4.5, 0.8, 1.5);
  fill.rotation.y = Math.PI / 2;
  scene.add(key, fill);
  for (const [x, y, z, w, h, d, r, g, b] of [
    [6.9, 0.4, 1.2, 0.1, 0.5, 2.8, 1.8, 0.9, 0.3],
    [-6.9, 0.7, -2.2, 0.1, 0.3, 3, 1.6, 0.22, 0.12],
    [1.6, 0.5, 6.9, 3.2, 0.35, 0.1, 1.2, 0.85, 0.4],
    [-2.6, 1.3, -6.9, 2.4, 0.22, 0.1, 0.25, 0.9, 1.1],
  ] as const) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lit(r, g, b));
    m.position.set(x, y, z);
    scene.add(m);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const out = pmrem.fromScene(scene, 0.012, 0.05, 30).texture;
  pmrem.dispose();
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  return out;
}

// --- shared materials --------------------------------------------------------------------------

const NOISE_GLSL = /* glsl */ `
float wHash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 wHash33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float wNoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wHash13(i), wHash13(i + vec3(1,0,0)), f.x), mix(wHash13(i + vec3(0,1,0)), wHash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(wHash13(i + vec3(0,0,1)), wHash13(i + vec3(1,0,1)), f.x), mix(wHash13(i + vec3(0,1,1)), wHash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// A diamond's facets: a normal tilted a different way in every little cell, and a glint that
// comes and goes as the clock turns, a little coloured by the stone's fire.
vec3 wFacet(vec3 p, float cells) { return wHash33(floor(p * cells)) - 0.5; }
vec3 wGlint(vec3 p, float cells, float t) {
  vec3 c = floor(p * cells);
  float h = wHash13(c + 11.0);
  float phase = fract(h * 13.7 + t * (0.18 + 0.5 * h));
  float g = pow(max(0.0, 1.0 - abs(phase - 0.5) * 9.0), 3.0);
  vec3 fire = 0.62 + 0.38 * cos(6.2831 * (h * 3.0 + vec3(0.0, 0.33, 0.67)));
  return fire * g;
}
`;

let jewelMat: THREE.MeshStandardMaterial | null = null;

/** Metal, enamel, lenses, felt: one material, colour and finish per vertex. */
function jewel(): THREE.MeshStandardMaterial {
  if (jewelMat) return jewelMat;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 1, roughness: 1, envMapIntensity: 1.35 });
  m.name = 'jewel';
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 pbr;\nvarying vec2 vPbr;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPbr = pbr;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPbr;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= vPbr.y;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= vPbr.x;');
  };
  m.customProgramCacheKey = () => 'wear-jewel-1';
  reflect(m);
  jewelMat = m;
  return m;
}

let gemMat: THREE.MeshStandardMaterial | null = null;

/** Pavé diamonds: bright white metal broken into facets, each catching the light on its own. */
function gem(): THREE.MeshStandardMaterial {
  if (gemMat) return gemMat;
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.95, 0.96, 1.0), metalness: 1, roughness: 0.05, envMapIntensity: 2.1, emissive: new THREE.Color(0.05, 0.055, 0.065) });
  m.name = 'gem';
  const time = { value: 0 };
  timeUniforms.push(time);
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = time;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 facet;\nvarying vec3 vFacet;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacet = facet;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vFacet;\nuniform float uTime;\n${NOISE_GLSL}`)
      .replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\nnormal = normalize(normal + (viewMatrix * vec4(wFacet(vFacet, 650.0) * 1.1, 0.0)).xyz);',
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += wGlint(vFacet, 650.0, uTime) * 3.2;');
  };
  m.customProgramCacheKey = () => 'wear-gem-1';
  reflect(m);
  gemMat = m;
  return m;
}

let glassMat: THREE.MeshStandardMaterial | null = null;

/** Clear drinking glass: mostly reflection, drawn after everything solid. */
function glass(): THREE.MeshStandardMaterial {
  if (glassMat) return glassMat;
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.9, 0.94, 0.95), metalness: 0, roughness: 0.03, transparent: true, opacity: 0.26, envMapIntensity: 3, depthWrite: false });
  m.name = 'glass';
  reflect(m);
  glassMat = m;
  return m;
}

// --- fitting a model ---------------------------------------------------------------------------

/** The template a character is cloned from (characters.ts), as much of it as this module reads. */
export interface TemplateLike {
  root: THREE.Object3D;
  geometry: THREE.BufferGeometry;
  slot: Uint8Array;
}

const SLOT = { skin: 0, hair: 2, hairShade: 3, brows: 4, top: 5, bottom: 6, shoes: 7, fixed: 255 } as const;

/** One outfit model measured at rest, in the character's frame. */
interface Fit {
  id: number;
  female: boolean;
  names: string[];
  /** Character frame to the bind space of a vertex riding bone i. */
  toBind: THREE.Matrix4[];
  /** Rest position of each bone. */
  at: V3[];
  /** Mid-line x and the neck's axis z; the neck's base height. */
  cx: number;
  zc: number;
  neckY: number;
  /** Rest positions (xyz...) of the vertices a piece has to clear. */
  torso: Float32Array;
  headSkin: Float32Array;
  head: Float32Array;
  forearmL: Float32Array;
  /** Where the eyes are (centres), the mouth, the chin. */
  eyes: [V3, V3];
  mouthY: number;
  /** Per-vertex rest position and normal, and the Look slot, for special clothes. */
  rest: THREE.BufferAttribute;
  restN: THREE.BufferAttribute;
  slot: THREE.BufferAttribute;
  /** The jacket's front opening, for lapels: half-width at the button and at the collar. */
  lapel: { yB: number; yC: number; v0: number; v1: number };
  /** Each bone's rotation at rest, for turning it in the character's frame. */
  quats: THREE.Quaternion[];
}

const fits = new WeakMap<THREE.BufferGeometry, Fit>();
let fitSeq = 0;

function boneIndex(fit: Fit, name: string): number {
  return fit.names.indexOf(name.replace(/\./g, ''));
}

function fitFor(tpl: TemplateLike, female: boolean): Fit | null {
  const known = fits.get(tpl.geometry);
  if (known) return known;
  let mesh: THREE.SkinnedMesh | null = null;
  tpl.root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as THREE.SkinnedMesh;
  });
  if (!mesh) return null;
  const body = mesh as THREE.SkinnedMesh;
  tpl.root.updateMatrixWorld(true);
  const bones = body.skeleton.bones;
  const names = bones.map((b) => b.name.replace(/\./g, ''));
  const toBind = bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, body.skeleton.boneInverses[i]!).multiply(body.bindMatrix).invert());
  const at = bones.map((b) => b.getWorldPosition(V()));
  const idx = (n: string) => names.indexOf(n);

  const geo = body.geometry;
  const n = geo.getAttribute('position').count;
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  const normals = geo.getAttribute('normal');
  const rest = new Float32Array(n * 3);
  const restN = new Float32Array(n * 3);
  const main = new Int16Array(n);
  const v = V();
  // A vertex's normal at rest turns with the bone that carries most of it.
  const turnOf = bones.map((b, i) =>
    new THREE.Matrix3().getNormalMatrix(
      new THREE.Matrix4().multiplyMatrices(body.matrixWorld, body.bindMatrixInverse).multiply(b.matrixWorld).multiply(body.skeleton.boneInverses[i]!).multiply(body.bindMatrix),
    ),
  );
  for (let i = 0; i < n; i++) {
    body.getVertexPosition(i, v).applyMatrix4(body.matrixWorld);
    v.toArray(rest, i * 3);
    let best = 0;
    let bw = -1;
    for (let c = 0; c < 4; c++) {
      const w = sw.getComponent(i, c);
      if (w > bw) {
        bw = w;
        best = c;
      }
    }
    main[i] = si.getComponent(i, best);
    v.fromBufferAttribute(normals, i).applyMatrix3(turnOf[main[i]!]!).normalize();
    v.toArray(restN, i * 3);
  }
  const pick = (test: (bone: string, slot: number, i: number) => boolean): Float32Array => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) if (test(names[main[i]!] ?? '', tpl.slot[i]!, i)) out.push(rest[i * 3]!, rest[i * 3 + 1]!, rest[i * 3 + 2]!);
    return Float32Array.from(out);
  };
  const neck = at[idx('Neck')] ?? V(0, 1.48, 0.08);
  const head = at[idx('Head')] ?? V(0, 1.55, 0.09);
  const cx = neck.x;
  const zc = neck.z;
  const headAll = pick((b) => b === 'Head');
  const headSkin = pick((b, s) => b === 'Head' && s === SLOT.skin);

  // Eyes: the dark little pieces at the front of the face, one cluster each side of the mid-line.
  // Some models draw them in the brows' material; there the cluster is the brows' and the eye
  // is a finger below it.
  const eyeSide = (side: number, slot: number): V3 | null => {
    const sum = V();
    let k = 0;
    for (let i = 0; i < n; i++) {
      if (names[main[i]!] !== 'Head' || tpl.slot[i] !== slot) continue;
      const x = rest[i * 3]! - cx;
      const y = rest[i * 3 + 1]!;
      const z = rest[i * 3 + 2]!;
      if (Math.sign(x) !== side || Math.abs(x) > 0.075 || Math.abs(x) < 0.012 || z < head.z + 0.08 || y < head.y + 0.05 || y > head.y + 0.14) continue;
      sum.add(V(rest[i * 3]!, y, z));
      k++;
    }
    return k >= 4 ? sum.divideScalar(k) : null;
  };
  const eye = (side: number): V3 =>
    eyeSide(side, SLOT.fixed) ?? eyeSide(side, SLOT.brows)?.add(V(0, -0.014, -0.004)) ?? V(cx + side * 0.042, head.y + 0.1, head.z + 0.125);
  const eyeL = eye(1);
  const eyeR = eye(-1);
  const eyeY = Math.min(eyeL.y, eyeR.y);
  // The chin: the lowest point of the face near the mid-line, at the front.
  let chinY = Infinity;
  for (let i = 0; i < headSkin.length; i += 3) {
    if (Math.abs(headSkin[i]! - cx) < 0.02 && headSkin[i + 2]! > head.z + 0.06) chinY = Math.min(chinY, headSkin[i + 1]!);
  }
  if (!Number.isFinite(chinY)) chinY = head.y - 0.02;
  const mouthY = chinY + (eyeY - chinY) * 0.36;

  // The jacket's opening: how far the shirt (fixed-colour cloth on the chest) reaches each side
  // of the mid-line near the bottom and the top of the opening. Models without one get a V.
  let yB = neck.y - 0.3;
  const yC = neck.y - 0.03;
  let v0 = 0.012;
  let v1 = 0.05;
  const shirt: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const b = names[main[i]!] ?? '';
    if (tpl.slot[i] !== SLOT.fixed || !/^(Chest|Torso|Abdomen)$/.test(b)) continue;
    if (rest[i * 3 + 2]! < zc + 0.06) continue;
    shirt.push([Math.abs(rest[i * 3]! - cx), rest[i * 3 + 1]!]);
  }
  if (shirt.length > 20) {
    yB = Math.min(...shirt.map((p) => p[1])) + 0.01;
    const top = shirt.filter((p) => p[1] > yC - 0.06).map((p) => p[0]);
    if (top.length) v1 = Math.max(0.03, Math.min(0.075, Math.max(...top)));
  }

  const fit: Fit = {
    id: ++fitSeq,
    female,
    names,
    toBind,
    at,
    cx,
    zc,
    neckY: neck.y,
    torso: pick((b) => /^(Chest|Neck|Torso|Abdomen|ShoulderL|ShoulderR)$/.test(b)),
    headSkin,
    head: headAll,
    forearmL: pick((b) => b === 'LowerArmL' || b === 'WristL'),
    eyes: [eyeL, eyeR],
    mouthY,
    rest: new THREE.BufferAttribute(rest, 3),
    restN: new THREE.BufferAttribute(restN, 3),
    slot: new THREE.BufferAttribute(Float32Array.from(tpl.slot), 1),
    lapel: { yB, yC, v0, v1 },
    quats: bones.map((b) => b.getWorldQuaternion(new THREE.Quaternion())),
  };
  fits.set(tpl.geometry, fit);
  return fit;
}

/**
 * How far along `d` from `o` the surface is: the furthest of the points within `radius` of the
 * ray, measured along it. -Infinity when the ray misses everything.
 */
function support(points: Float32Array, o: V3, d: V3, radius: number): number {
  let best = -Infinity;
  const r2 = radius * radius;
  for (let i = 0; i < points.length; i += 3) {
    const px = points[i]! - o.x;
    const py = points[i + 1]! - o.y;
    const pz = points[i + 2]! - o.z;
    const s = px * d.x + py * d.y + pz * d.z;
    if (s <= 0 || s <= best) continue;
    const q = px * px + py * py + pz * pz - s * s;
    if (q < r2) best = s;
  }
  return best;
}

// --- building pieces ---------------------------------------------------------------------------

type Paint = Finish | ((p: V3) => Finish);

/** Triangles for one material, gathered from many pieces, each riding its own bone. */
class Bucket {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private pbr: number[] = [];
  private fac: number[] = [];
  private skin: number[] = [];
  private idx: number[] = [];
  private n = 0;

  constructor(
    private readonly fit: Fit,
    private readonly facets: boolean,
  ) {}

  /** Add `geo` placed by `m` in the character frame, riding bone `bone`. */
  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, paint: Paint | null, bone: number): void {
    const toBind = this.fit.toBind[bone] ?? this.fit.toBind[0]!;
    const nmA = _nA.getNormalMatrix(m);
    const nmB = _nB.getNormalMatrix(toBind);
    const P = geo.getAttribute('position');
    const N = geo.getAttribute('normal');
    const count = P.count;
    for (let k = 0; k < count; k++) {
      _p.fromBufferAttribute(P, k).applyMatrix4(m);
      if (this.facets) this.fac.push(_p.x, _p.y, _p.z);
      if (paint) {
        const f = typeof paint === 'function' ? paint(_p) : paint;
        this.col.push(f.c[0], f.c[1], f.c[2]);
        this.pbr.push(f.m, f.r);
      }
      _p.applyMatrix4(toBind);
      this.pos.push(_p.x, _p.y, _p.z);
      _q.fromBufferAttribute(N, k).applyMatrix3(nmA).applyMatrix3(nmB).normalize();
      this.nor.push(_q.x, _q.y, _q.z);
      this.skin.push(bone, 0, 0, 0);
    }
    const index = geo.getIndex();
    if (index) for (let i = 0; i < index.count; i++) this.idx.push(this.n + index.getX(i));
    else for (let i = 0; i < count; i++) this.idx.push(this.n + i);
    this.n += count;
    geo.dispose();
  }

  get empty(): boolean {
    return this.n === 0;
  }

  build(): THREE.BufferGeometry | null {
    if (this.n === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    if (this.col.length) {
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
      g.setAttribute('pbr', new THREE.Float32BufferAttribute(this.pbr, 2));
    }
    if (this.facets) g.setAttribute('facet', new THREE.Float32BufferAttribute(this.fac, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skin, 4));
    const w = new Float32Array(this.n * 4);
    for (let i = 0; i < this.n; i++) w[i * 4] = 1;
    g.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const _p = V();
const _q = V();
const _nA = new THREE.Matrix3();
const _nB = new THREE.Matrix3();

interface Out {
  metal: Bucket;
  gem: Bucket;
  glass: Bucket;
}

/** A matrix from an origin and three axes (x, y, z columns). */
function frame(o: V3, x: V3, y: V3, z: V3): THREE.Matrix4 {
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(o);
}

/** Axes for something lying on a surface: x along `t`, z out along `n` (made square to t). */
function surfaceFrame(o: V3, t: V3, n: V3): THREE.Matrix4 {
  const x = t.clone().normalize();
  const z = n.clone().addScaledVector(x, -n.dot(x)).normalize();
  const y = z.clone().cross(x).normalize();
  return frame(o, x, y, z);
}

// --- chains --------------------------------------------------------------------------------------

interface ChainSpec {
  style: 'rope' | 'figaro' | 'cuban';
  /** How far the front hangs below the back of the neck, and the chain's width (m). */
  drop: number;
  width: number;
  iced?: boolean;
  pendant?: 'dice' | 'ace';
}

const CHAINS: Record<string, ChainSpec> = {
  'rope-chain': { style: 'rope', drop: 0.15, width: 0.0068 },
  figaro: { style: 'figaro', drop: 0.16, width: 0.0064 },
  'cuban-link': { style: 'cuban', drop: 0.125, width: 0.0118 },
  'iced-cuban': { style: 'cuban', drop: 0.12, width: 0.0136, iced: true },
  'dice-pendant': { style: 'cuban', drop: 0.17, width: 0.0088, pendant: 'dice' },
  'ace-pendant': { style: 'rope', drop: 0.17, width: 0.0062, pendant: 'ace' },
};

interface Path {
  curve: THREE.CatmullRomCurve3;
  length: number;
  /** The outward direction at a fraction u of the way round (front centre is u = 0). */
  out(u: number): V3;
}

/**
 * The line a necklace takes on this body: round the base of the neck at the back and sides,
 * then down over the collarbones to its lowest point on the chest, pushed out to rest on
 * whatever the outfit has there (a collar, a hood, bare skin).
 */
function chainPath(fit: Fit, drop: number, thick: number): Path {
  const K = 96;
  const yTop = fit.neckY + (fit.female ? 0.004 : 0.012);
  const pts: V3[] = [];
  const outs: V3[] = [];
  const rs: number[] = [];
  for (let k = 0; k < K; k++) {
    const th = (k / K) * Math.PI * 2;
    const front = Math.pow((1 + Math.cos(th)) / 2, 2.2);
    const y = yTop - drop * front;
    const side = Math.sin(th) ** 2;
    const d = V(Math.sin(th), 0.55 * side * (1 - front), Math.cos(th)).normalize();
    const o = V(fit.cx + Math.sin(th) * 0.015, y - d.y * 0.02, fit.zc + Math.cos(th) * 0.015);
    let s = support(fit.torso, o, d, 0.016);
    if (!Number.isFinite(s)) s = 0.07;
    rs.push(s);
    pts.push(o);
    outs.push(d);
  }
  // Smooth the reach round the loop (the surface comes from sparse vertices) without letting it
  // sink in: each sample takes the most of its neighbours, then the average of that.
  const most = rs.map((_, k) => Math.max(rs[(k + K - 1) % K]!, rs[k]!, rs[(k + 1) % K]!));
  const smooth = most.map((_, k) => {
    let sum = 0;
    for (let j = -3; j <= 3; j++) sum += most[(k + j + K) % K]!;
    return sum / 7;
  });
  const clear = thick / 2 + 0.0022;
  const loop = pts.map((o, k) => o.clone().addScaledVector(outs[k]!, smooth[k]! + clear));
  const curve = new THREE.CatmullRomCurve3(loop, true, 'centripetal');
  return {
    curve,
    length: curve.getLength(),
    out: (u) => {
      const f = (((u % 1) + 1) % 1) * K;
      const a = Math.floor(f);
      return outs[a % K]!.clone().lerp(outs[(a + 1) % K]!, f - a).normalize();
    },
  };
}

/** A curve given by a function (a strand twisting round a chain's centre line). */
class Strand extends THREE.Curve<V3> {
  constructor(private readonly at: (u: number, target: V3) => V3) {
    super();
  }
  override getPoint(u: number, target = V()): V3 {
    return this.at(u, target);
  }
}

/** A link: a ring `len` long and `wide` across, its wire `tube` thick, lying in its xy plane. */
function link(len: number, wide: number, tube: number, flat: number, segs = 12): THREE.BufferGeometry {
  const R = (wide - tube) / 2;
  const g = new THREE.TorusGeometry(R, tube / 2, 6, segs);
  g.scale((len - tube) / 2 / R, 1, flat);
  return g;
}

function buildChain(fit: Fit, spec: ChainSpec, out: Out, chest: number): Path {
  const path = chainPath(fit, spec.drop * (fit.female ? 0.9 : 1), spec.width);
  const { curve, length } = path;
  const w = spec.width;
  if (spec.style === 'rope') {
    // three strands twisted round each other
    const turns = Math.round(length / (w * 1.25));
    const segs = turns * 10;
    const frames = Array.from({ length: segs + 1 }, (_, i) => {
      const u = (i / segs) % 1;
      const t = curve.getTangentAt(u);
      const n = path.out(u);
      n.addScaledVector(t, -n.dot(t)).normalize();
      return { n, b: t.clone().cross(n) };
    });
    for (let s = 0; s < 3; s++) {
      const strand = new Strand((u, target) => {
        const f = frames[Math.min(segs, Math.round(u * segs))]!;
        const a = u * turns * Math.PI * 2 + (s * Math.PI * 2) / 3;
        return target.copy(curve.getPointAt(u % 1)).addScaledVector(f.n, Math.cos(a) * w * 0.27).addScaledVector(f.b, Math.sin(a) * w * 0.27);
      });
      strand.arcLengthDivisions = segs * 2;
      out.metal.add(new THREE.TubeGeometry(strand, segs, w * 0.27, 5, true), new THREE.Matrix4(), GOLD, chest);
    }
    return path;
  }
  // Links along the path, spaced so the loop closes on a whole number of them.
  const pattern = spec.style === 'figaro' ? [1, 1, 1, 2.2] : [1];
  const unit = spec.style === 'figaro' ? w * 1.35 : w * 0.64;
  const cycle = pattern.reduce((a, b) => a + b, 0) * unit;
  const cycles = Math.max(1, Math.round(length / cycle));
  const scale = length / (cycles * cycle);
  let s = 0;
  let i = 0;
  const base = spec.style === 'figaro' ? null : link(w * 1.2, w, w * 0.34, 0.55, 12);
  const ice = spec.iced ? link(w * 1.02, w * 0.84, w * 0.2, 0.5, 12) : null;
  while (s < length - 1e-6) {
    const k = pattern[i % pattern.length]!;
    const len = k * unit * scale;
    const u = (s + len / 2) / length;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const m = surfaceFrame(p, t, path.out(u));
    if (spec.style === 'figaro') {
      // a cable chain: every other link turned a quarter round
      const g = link(len * 1.18, w, w * 0.3, 0.8, k > 1 ? 18 : 12);
      if (i % 2) g.rotateX(Math.PI / 2);
      out.metal.add(g, m, GOLD, chest);
    } else {
      // a curb: the links twisted to lie flat against each other, alternately
      const twist = (i % 2 ? 1 : -1) * 0.5;
      const r = new THREE.Matrix4().makeRotationX(twist);
      out.metal.add(base!.clone(), m.clone().multiply(r), GOLD, chest);
      if (ice) out.gem.add(ice.clone(), m.clone().multiply(r).multiply(new THREE.Matrix4().makeTranslation(0, 0, w * 0.1)), null, chest);
    }
    s += len;
    i++;
  }
  base?.dispose();
  ice?.dispose();
  return path;
}

/** Where the front of the chain hangs lowest, and how the chest faces there. */
function lowest(path: Path): { p: V3; t: V3; n: V3 } {
  let best = 0;
  let by = Infinity;
  for (let k = 0; k < 64; k++) {
    const y = path.curve.getPointAt(k / 64).y;
    if (y < by) {
      by = y;
      best = k / 64;
    }
  }
  return { p: path.curve.getPointAt(best), t: path.curve.getTangentAt(best), n: path.out(best) };
}

function buildPendant(fit: Fit, kind: 'dice' | 'ace', path: Path, out: Out, chest: number): void {
  const at = lowest(path);
  // hang straight down from the chain, resting against the chest
  const down = V(0, -1, 0);
  const face = at.n.clone().setY(0).normalize();
  const bail = at.p.clone().addScaledVector(down, 0.004);
  // a small ring the chain runs through: in the plane of "up" and "out", its axis along the chain
  const along = at.t.clone().setY(0).normalize();
  out.metal.add(link(0.011, 0.008, 0.0024, 1, 12), frame(bail, face.clone().cross(along).cross(along).negate().normalize(), V(0, 1, 0), along).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)), GOLD, chest);
  if (kind === 'ace') {
    const r = 0.022;
    const c = bail.clone().addScaledVector(down, r + 0.006);
    const s = support(fit.torso, c.clone().addScaledVector(face, -0.08), face, 0.02);
    if (Number.isFinite(s)) c.copy(c.clone().addScaledVector(face, -0.08).addScaledVector(face, s + 0.004));
    const m = frame(c, face.clone().cross(V(0, 1, 0)).negate(), V(0, 1, 0), face);
    // the medallion: a thick disc with a raised rim, the spade in black enamel, diamonds round it
    const disc = new THREE.CylinderGeometry(r, r, 0.0034, 40).rotateX(Math.PI / 2);
    out.metal.add(disc, m, GOLD, chest);
    out.metal.add(new THREE.TorusGeometry(r - 0.0012, 0.0016, 8, 48), m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.0017)), GOLD, chest);
    out.gem.add(new THREE.TorusGeometry(r - 0.0042, 0.0013, 6, 48), m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.0019)), null, chest);
    const spade = new THREE.ExtrudeGeometry(spadeShape(0.0135), { depth: 0.0007, bevelEnabled: false, curveSegments: 10 });
    out.metal.add(spade, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.001, 0.0017)), ENAMEL, chest);
    return;
  }
  // two dice side by side, paved in diamonds, with black pips, hanging at easy angles
  const size = 0.0165;
  for (const [dx, spin, tilt] of [
    [-0.0095, 0.35, 0.18],
    [0.0095, -0.5, -0.12],
  ] as const) {
    const c = bail.clone().addScaledVector(down, size * 0.9 + 0.004).addScaledVector(face.clone().cross(V(0, 1, 0)).negate(), dx);
    const s = support(fit.torso, c.clone().addScaledVector(face, -0.08), face, 0.02);
    if (Number.isFinite(s)) c.copy(c.clone().addScaledVector(face, -0.08).addScaledVector(face, s + size / 2 + 0.001));
    const m = frame(c, face.clone().cross(V(0, 1, 0)).negate(), V(0, 1, 0), face).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(tilt, spin, 0.2 * spin)));
    out.gem.add(new RoundedBoxGeometry(size, size, size, 2, size * 0.16), m, null, chest);
    for (const [nx, ny, nz, pips] of DIE_FACES) {
      for (const [px, py] of PIPS[pips]!) {
        const pip = new THREE.CylinderGeometry(size * 0.085, size * 0.085, size * 0.02, 12).rotateX(Math.PI / 2);
        const n = V(nx, ny, nz);
        const t = Math.abs(ny) > 0.5 ? V(1, 0, 0) : V(0, 1, 0).cross(n).normalize();
        const b = n.clone().cross(t);
        const pm = frame(n.clone().multiplyScalar(size / 2 + 0.0001).addScaledVector(t, px * size * 0.26).addScaledVector(b, py * size * 0.26), t, b, n);
        out.metal.add(pip, m.clone().multiply(pm), ENAMEL, chest);
      }
    }
  }
}

/** Faces of a die (outward normal, pips); opposite faces add to seven. */
const DIE_FACES: [number, number, number, number][] = [
  [0, 0, 1, 1],
  [0, 0, -1, 6],
  [1, 0, 0, 3],
  [-1, 0, 0, 4],
  [0, 1, 0, 5],
  [0, -1, 0, 2],
];
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
};

/** A spade, `h` tall, centred on the origin. */
function spadeShape(h: number): THREE.Shape {
  const s = new THREE.Shape();
  const k = h / 2;
  s.moveTo(0, k);
  s.bezierCurveTo(-0.12 * h, 0.3 * h, -0.55 * h, 0.12 * h, -0.5 * h, -0.14 * h);
  s.bezierCurveTo(-0.46 * h, -0.34 * h, -0.2 * h, -0.36 * h, -0.06 * h, -0.2 * h);
  s.bezierCurveTo(-0.08 * h, -0.34 * h, -0.14 * h, -0.44 * h, -0.2 * h, -k);
  s.lineTo(0.2 * h, -k);
  s.bezierCurveTo(0.14 * h, -0.44 * h, 0.08 * h, -0.34 * h, 0.06 * h, -0.2 * h);
  s.bezierCurveTo(0.2 * h, -0.36 * h, 0.46 * h, -0.34 * h, 0.5 * h, -0.14 * h);
  s.bezierCurveTo(0.55 * h, 0.12 * h, 0.12 * h, 0.3 * h, 0, k);
  return s;
}

// --- grills ------------------------------------------------------------------------------------

interface GrillSpec {
  metal: Metal;
  rows: 1 | 2;
  top: number;
  iced?: boolean;
}

const GRILLS: Record<string, GrillSpec> = {
  'gold-top-six': { metal: 'gold', rows: 1, top: 6 },
  'full-gold': { metal: 'gold', rows: 2, top: 8 },
  'rose-gold': { metal: 'rose', rows: 2, top: 8 },
  'diamond-set': { metal: 'white', rows: 2, top: 8, iced: true },
};

/** Teeth across the front of the mouth, following the face round, just proud of it. */
function buildGrill(fit: Fit, spec: GrillSpec, out: Out, headBone: number): void {
  const tw = fit.female ? 0.0072 : 0.008;
  const rows: [number, number, number][] = [[fit.mouthY + 0.0055, spec.top, fit.female ? 0.0094 : 0.0104]];
  if (spec.rows === 2) rows.push([fit.mouthY - 0.0058, spec.top, fit.female ? 0.0078 : 0.0086]);
  const metal = METALS[spec.metal];
  for (const [y, count, th] of rows) {
    for (let i = 0; i < count; i++) {
      const x = fit.cx + (i - (count - 1) / 2) * tw * 1.04;
      // the face's front at this point, and which way it faces (from its neighbours)
      const z = (xx: number) => {
        const s = support(fit.headSkin, V(xx, y, fit.zc), V(0, 0, 1), 0.009);
        return Number.isFinite(s) ? fit.zc + s : fit.zc + 0.14;
      };
      const z0 = z(x);
      const slope = (z(x + 0.006) - z(x - 0.006)) / 0.012;
      const n = V(-slope, 0, 1).normalize();
      const o = V(x, y, z0).addScaledVector(n, 0.0024);
      const m = surfaceFrame(o, V(1, 0, slope), n);
      const tooth = new RoundedBoxGeometry(tw * 0.94, th, 0.0036, 2, 0.0011);
      out.metal.add(tooth, m, metal, headBone);
      if (spec.iced) out.gem.add(new RoundedBoxGeometry(tw * 0.78, th * 0.8, 0.0012, 1, 0.0004), m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.0018)), null, headBone);
    }
  }
}

// --- watches -------------------------------------------------------------------------------------

function buildWatch(fit: Fit, iced: boolean, out: Out): void {
  const fore = boneIndex(fit, 'LowerArm.L');
  const wristI = boneIndex(fit, 'Wrist.L');
  if (fore < 0 || wristI < 0) return;
  const elbow = fit.at[fore]!;
  const wrist = fit.at[wristI]!;
  const axis = wrist.clone().sub(elbow).normalize();
  const c = wrist.clone().addScaledVector(axis, -0.028);
  // the arm's radius there, from the forearm's own vertices
  let r = 0;
  for (let i = 0; i < fit.forearmL.length; i += 3) {
    const p = V(fit.forearmL[i]!, fit.forearmL[i + 1]!, fit.forearmL[i + 2]!).sub(c);
    const along = p.dot(axis);
    if (Math.abs(along) > 0.012) continue;
    r = Math.max(r, p.addScaledVector(axis, -along).length());
  }
  if (r === 0) r = 0.028;
  // the back of the wrist: outward from the body, a little forward
  const outward = c.clone().sub(V(fit.cx, c.y, fit.zc)).setY(0).normalize().add(V(0, 0, 0.35)).normalize();
  outward.addScaledVector(axis, -outward.dot(axis)).normalize();
  const side = axis.clone().cross(outward).normalize();
  const band = frame(c, outward, side, axis);
  const metal = iced ? WHITE_GOLD : GOLD;
  // bracelet: a flat band round the wrist, the case and dial on the back of it
  const bandR = r + 0.0026;
  const ring = new THREE.TorusGeometry(bandR, 0.0017, 6, 40);
  ring.scale(1, 1, 5.2);
  out.metal.add(ring, band, metal, fore);
  // the dial: 3 o'clock toward the hand, 12 round the wrist
  const caseAt = c.clone().addScaledVector(outward, bandR + 0.0032);
  const face = frame(caseAt, axis, outward.clone().cross(axis).normalize(), outward);
  out.metal.add(new THREE.CylinderGeometry(0.0165, 0.017, 0.0068, 36).rotateX(Math.PI / 2), face, metal, fore);
  out.metal.add(new THREE.CylinderGeometry(0.0138, 0.0138, 0.0008, 36).rotateX(Math.PI / 2), face.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.0034)), iced ? DIAL_ICE : DIAL, fore);
  // the hands at ten past ten: the minute hand on the two, the hour hand just past the ten
  for (const [ang, len] of [
    [-1.05, 0.0105],
    [0.96, 0.0072],
  ] as const) {
    const hand = new THREE.BoxGeometry(0.0011, len, 0.0005).translate(0, len / 2, 0);
    out.metal.add(hand, face.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.0041)).multiply(new THREE.Matrix4().makeRotationZ(ang)), HANDS, fore);
  }
  if (iced) out.gem.add(new THREE.TorusGeometry(0.0153, 0.0017, 6, 40), face.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.0036)), null, fore);
  else out.metal.add(new THREE.TorusGeometry(0.0154, 0.0012, 6, 40), face.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.0035)), GOLD, fore);
}

// --- shades --------------------------------------------------------------------------------------

/** An aviator lens: a teardrop, `w` wide, drooping to the outside (+x, or -x for side -1). */
function aviatorShape(w: number, h: number, side: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = (k: number) => side * k * w;
  s.moveTo(x(-0.5), 0.42 * h);
  s.bezierCurveTo(x(-0.2), 0.55 * h, x(0.3), 0.55 * h, x(0.5), 0.38 * h);
  s.bezierCurveTo(x(0.62), 0.1 * h, x(0.5), -0.45 * h, x(0.12), -0.52 * h);
  s.bezierCurveTo(x(-0.25), -0.58 * h, x(-0.5), -0.2 * h, x(-0.5), 0.42 * h);
  return s;
}

function buildShades(fit: Fit, out: Out, headBone: number): void {
  const [eyeL, eyeR] = fit.eyes;
  const mid = eyeL.clone().add(eyeR).multiplyScalar(0.5);
  const half = Math.max(0.03, Math.abs(eyeL.x - eyeR.x) / 2);
  const w = half * 1.38;
  const h = w * 0.8;
  const zFace = Math.max(eyeL.z, eyeR.z) + 0.012;
  for (const side of [1, -1]) {
    const eye = side > 0 ? eyeL : eyeR;
    const o = V(eye.x + side * 0.004, eye.y - 0.004, zFace);
    // turned a little round the face, the teardrop drooping to the outside
    const m = new THREE.Matrix4().makeTranslation(o.x, o.y, o.z).multiply(new THREE.Matrix4().makeRotationY(side * 0.2));
    const lens = new THREE.ShapeGeometry(aviatorShape(w, h, side), 12);
    const top = eye.y + h * 0.5;
    out.metal.add(
      lens,
      m,
      (p) => {
        const k = THREE.MathUtils.clamp((top - p.y) / h, 0, 1);
        const g = 0.012 + 0.05 * k;
        return fin(g * 1.3, g * 0.8, g * 0.45, 0.35, 0.05);
      },
      headBone,
    );
    // the back of the lens (the outline mirrored, then turned round to face in)
    const back = new THREE.ShapeGeometry(aviatorShape(w, h, -side), 12).rotateY(Math.PI);
    out.metal.add(back, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.0005)), fin(0.02, 0.013, 0.008, 0.2, 0.2), headBone);
    // wire rim round the lens
    const rim = aviatorShape(w, h, side).getSpacedPoints(48).map((p) => V(p.x, p.y, 0.0004));
    out.metal.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rim, true), 64, 0.0009, 5, true), m, GOLD, headBone);
    // temple: from the outer top corner back along the side of the head
    const hinge = new THREE.Vector3(side * 0.5 * w, 0.36 * h, 0).applyMatrix4(m);
    const headSide = fit.cx + side * (half + 0.064);
    const ear = V(headSide, hinge.y - 0.004, fit.zc + 0.02);
    const temple = new THREE.CatmullRomCurve3([hinge, V(headSide - side * 0.004, hinge.y, hinge.z - 0.03), ear, ear.clone().add(V(0, -0.018, -0.02))]);
    out.metal.add(new THREE.TubeGeometry(temple, 16, 0.0011, 5, false), new THREE.Matrix4(), GOLD, headBone);
  }
  // the double bridge
  for (const [dy, bow] of [
    [0.0085, 0.004],
    [0.0035, -0.001],
  ] as const) {
    const a = V(eyeR.x + 0.004 + w * 0.46, mid.y + dy, zFace + 0.002);
    const b = V(eyeL.x - 0.004 - w * 0.46, mid.y + dy, zFace + 0.002);
    const bridge = new THREE.QuadraticBezierCurve3(a, V(mid.x, mid.y + dy + bow, zFace + 0.006), b);
    out.metal.add(new THREE.TubeGeometry(bridge, 10, 0.001, 5, false), new THREE.Matrix4(), GOLD, headBone);
  }
}

// --- hats ----------------------------------------------------------------------------------------

function buildHat(fit: Fit, straw: boolean, out: Out, headBone: number): void {
  // Find the height where the head (with its hair) is as wide as the hat's band, from the top down.
  const band = fit.female ? 0.104 : 0.1;
  let x0 = 0;
  let z0 = 0;
  let k = 0;
  let top = -Infinity;
  for (let i = 0; i < fit.headSkin.length; i += 3) {
    x0 += fit.headSkin[i]!;
    z0 += fit.headSkin[i + 2]!;
    k++;
  }
  x0 /= k;
  z0 /= k;
  for (let i = 1; i < fit.head.length; i += 3) top = Math.max(top, fit.head[i]!);
  let y = top;
  for (; y > top - 0.2; y -= 0.004) {
    let r = 0;
    for (let i = 0; i < fit.head.length; i += 3) {
      if (Math.abs(fit.head[i + 1]! - y) > 0.004) continue;
      r = Math.max(r, Math.hypot(fit.head[i]! - x0, (fit.head[i + 2]! - z0) * 0.88));
    }
    if (r >= band * 0.97) break;
  }
  const seat = Math.min(y, top - 0.05);
  const felt = straw ? STRAW : FELT;
  // tipped a touch forward and to one side, the way a hat is worn
  const m = new THREE.Matrix4()
    .makeTranslation(x0, seat, z0)
    .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.09, 0, -0.06)))
    .multiply(new THREE.Matrix4().makeScale(0.93, 1, 1.07));
  const crown = [
    [band + 0.002, -0.004],
    [band + 0.003, 0.03],
    [band - 0.002, 0.075],
    [band - 0.012, 0.104],
    [band - 0.03, 0.114],
    [band - 0.052, 0.112],
    [band - 0.07, 0.096],
    [0.001, 0.094],
  ].map(([r, yy]) => new THREE.Vector2(r!, yy!));
  const crownGeo = new THREE.LatheGeometry(crown, 36);
  // the pinch at the front of the crown
  const pos = crownGeo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const pz = pos.getZ(i);
    const py = pos.getY(i);
    if (pz > 0 && py > 0.05) pos.setX(i, px * (1 - 0.2 * Math.min(1, pz / band) * Math.min(1, (py - 0.05) / 0.05)));
  }
  crownGeo.computeVertexNormals();
  out.metal.add(crownGeo, m, felt, headBone);
  // band
  out.metal.add(new THREE.CylinderGeometry(band + 0.0045, band + 0.0048, 0.024, 36, 1, true).translate(0, 0.012, 0), m, RIBBON, headBone);
  // brim: snapped down at the front, up at the back and sides
  const brim = new THREE.LatheGeometry(
    [
      [band, 0.0022],
      [band + 0.068, 0.0022],
      [band + 0.071, 0],
      [band + 0.068, -0.0022],
      [band, -0.0022],
    ].map(([r, yy]) => new THREE.Vector2(r!, yy!)),
    48,
  );
  const bp = brim.getAttribute('position');
  for (let i = 0; i < bp.count; i++) {
    const px = bp.getX(i);
    const pz = bp.getZ(i);
    const r = Math.hypot(px, pz);
    const t = Math.max(0, (r - band) / 0.07);
    const a = Math.atan2(px, pz);
    bp.setY(i, bp.getY(i) + t * t * (0.02 - 0.034 * Math.max(0, Math.cos(a)) ** 2) + t * 0.006);
  }
  brim.computeVertexNormals();
  out.metal.add(brim, m, felt, headBone);
}

// --- held orders ---------------------------------------------------------------------------------

const WATER = fin(0.8, 0.85, 0.85, 0, 0.05);

/**
 * A bar order in the hand. Built upright in its own frame (origin where the fingers close round
 * it, +y up), then turned into the hand: at rest the arm hangs, so "up" is the direction the
 * thumb points, which the carrying pose turns up.
 */
function handFrame(fit: Fit): { m: THREE.Matrix4; bone: number } | null {
  const wristI = boneIndex(fit, 'Wrist.R');
  if (wristI < 0) return null;
  const wrist = fit.at[wristI]!;
  // the fingers hang down from the wrist; the palm faces in toward the body
  const mid = boneIndex(fit, 'Middle4.R');
  const fingers = mid >= 0 && fit.at[mid]!.distanceTo(wrist) > 0.03 ? fit.at[mid]!.clone().sub(wrist).normalize() : V(0, -1, 0.1).normalize();
  const inward = V(1, 0, 0);
  // the item's up is forward at rest, which the carrying pose turns up; its front faces out
  const up = V(0, 0, 1).addScaledVector(fingers, -fingers.z).normalize();
  const outZ = inward.clone().negate().addScaledVector(up, up.x).normalize();
  const grip = wrist.clone().addScaledVector(fingers, 0.05).addScaledVector(inward, 0.02);
  return { m: frame(grip, up.clone().cross(outZ).normalize(), up, outZ), bone: wristI };
}

function buildHeld(fit: Fit, model: BarModel, out: Out): void {
  const h = handFrame(fit);
  if (!h) return;
  const add = (g: THREE.BufferGeometry, paint: Paint | null, bucket: 'metal' | 'glass' = 'metal', local?: THREE.Matrix4) =>
    out[bucket].add(g, local ? h.m.clone().multiply(local) : h.m, paint, h.bone);
  const lathe = (pts: [number, number][], segs = 24) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);
  const at = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
  switch (model) {
    case 'bottle': {
      // an amber beer bottle held round its body, a cream label
      const glassy = fin(0.2, 0.07, 0.01, 0, 0.1);
      add(lathe([[0.0001, -0.07], [0.029, -0.07], [0.03, -0.066], [0.03, 0.03], [0.026, 0.045], [0.0125, 0.075], [0.0115, 0.108], [0.0135, 0.112], [0.012, 0.118], [0.0001, 0.118]]), glassy);
      add(lathe([[0.0304, -0.03], [0.0304, 0.018]]), fin(0.72, 0.62, 0.42, 0, 0.6));
      add(lathe([[0.0122, 0.108], [0.0132, 0.113], [0.0122, 0.118], [0.0001, 0.119]]), GOLD_SOFT);
      break;
    }
    case 'magnum': {
      // a dark green champagne bottle, gold foil on the neck, a cream shield label
      const green = fin(0.01, 0.045, 0.02, 0, 0.08);
      add(lathe([[0.0001, -0.1], [0.038, -0.1], [0.04, -0.094], [0.04, 0.03], [0.034, 0.07], [0.016, 0.11], [0.0145, 0.16], [0.0001, 0.162]], 28), green);
      add(lathe([[0.0162, 0.1], [0.0168, 0.116], [0.0152, 0.163], [0.0001, 0.166]], 28), GOLD_SOFT);
      add(lathe([[0.0404, -0.05], [0.0404, 0.02]], 28), fin(0.75, 0.68, 0.52, 0, 0.55));
      break;
    }
    case 'flute': {
      add(lathe([[0.0001, -0.075], [0.028, -0.075], [0.029, -0.072], [0.004, -0.068], [0.003, -0.01], [0.012, 0.004], [0.022, 0.05], [0.023, 0.13], [0.0215, 0.13], [0.0205, 0.05], [0.011, 0.007]]), null, 'glass');
      add(lathe([[0.0001, 0.006], [0.011, 0.009], [0.0198, 0.05], [0.0205, 0.1], [0.0001, 0.1]]), fin(0.75, 0.55, 0.18, 0, 0.05));
      break;
    }
    case 'martini': {
      add(lathe([[0.0001, -0.075], [0.03, -0.075], [0.031, -0.072], [0.004, -0.068], [0.003, 0.0], [0.05, 0.06], [0.052, 0.062], [0.049, 0.062], [0.004, 0.004]]), null, 'glass');
      add(lathe([[0.0001, 0.006], [0.042, 0.05], [0.0001, 0.05]]), WATER);
      add(new THREE.SphereGeometry(0.0065, 12, 8).scale(1, 1.25, 1), fin(0.12, 0.2, 0.02, 0, 0.35), 'metal', at(0.008, 0.035, 0));
      add(new THREE.CylinderGeometry(0.0008, 0.0008, 0.06, 5), fin(0.6, 0.45, 0.25, 0, 0.6), 'metal', at(0.004, 0.045, 0).multiply(new THREE.Matrix4().makeRotationZ(0.35)));
      break;
    }
    case 'wine': {
      add(lathe([[0.0001, -0.075], [0.03, -0.075], [0.031, -0.072], [0.0045, -0.068], [0.0035, -0.005], [0.03, 0.02], [0.037, 0.06], [0.031, 0.1], [0.0295, 0.1], [0.0355, 0.06], [0.0285, 0.022]]), null, 'glass');
      add(lathe([[0.0001, 0.0], [0.028, 0.02], [0.0335, 0.045], [0.0001, 0.045]]), fin(0.12, 0.004, 0.012, 0, 0.05));
      break;
    }
    case 'rocks': {
      add(lathe([[0.0001, -0.035], [0.037, -0.035], [0.038, 0.045], [0.035, 0.045], [0.034, -0.025], [0.0001, -0.025]]), null, 'glass');
      add(lathe([[0.0001, -0.024], [0.0335, -0.024], [0.0335, 0.008], [0.0001, 0.008]]), fin(0.45, 0.16, 0.02, 0, 0.05));
      add(new RoundedBoxGeometry(0.026, 0.026, 0.026, 2, 0.004), fin(0.7, 0.75, 0.78, 0, 0.1), 'glass', at(0.004, 0.012, -0.004).multiply(new THREE.Matrix4().makeRotationY(0.5)));
      break;
    }
    case 'cup': {
      // an espresso cup on its saucer
      const china = fin(0.85, 0.83, 0.78, 0, 0.18);
      add(lathe([[0.0001, -0.03], [0.058, -0.028], [0.06, -0.022], [0.0001, -0.026]], 32), china);
      add(lathe([[0.0001, -0.024], [0.022, -0.024], [0.028, 0.0], [0.03, 0.022], [0.028, 0.022], [0.026, 0.004], [0.0001, 0.004]], 28), china);
      add(lathe([[0.0001, 0.016], [0.027, 0.016]], 28), fin(0.05, 0.022, 0.01, 0, 0.3));
      add(new THREE.TorusGeometry(0.009, 0.0028, 6, 14, Math.PI * 1.3), china, 'metal', at(0.031, 0.006, 0).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI * 0.65)));
      break;
    }
    case 'plate': {
      // a white plate, held level by its rim, with the order on it
      const china = fin(0.85, 0.84, 0.8, 0, 0.2);
      add(lathe([[0.0001, -0.004], [0.075, -0.004], [0.1, 0.004], [0.104, 0.008], [0.1, 0.008], [0.075, 0.0], [0.0001, 0.0]], 36), china, 'metal', at(0, 0, PLATE_Z));
      break;
    }
  }
}

/** Where a plate's centre sits from the hand holding its rim: toward the body, in front of it. */
const PLATE_Z = -0.085;

/** What goes on the plate, by order. */
function buildPlateFood(fit: Fit, item: string, out: Out): void {
  const h = handFrame(fit);
  if (!h) return;
  const hand = h.m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.002, PLATE_Z));
  const put = (g: THREE.BufferGeometry, f: Finish, x: number, y: number, z: number, rot = 0) =>
    out.metal.add(g, hand.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z)).multiply(new THREE.Matrix4().makeRotationY(rot)), f, h.bone);
  const bun = fin(0.55, 0.26, 0.07, 0, 0.55);
  switch (item) {
    case 'sliders':
      for (const [x, z] of [
        [-0.03, 0.012],
        [0.028, 0.02],
        [0.0, -0.028],
      ] as const) {
        put(new THREE.SphereGeometry(0.022, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1), bun, x, 0.022, z);
        put(new THREE.CylinderGeometry(0.021, 0.021, 0.008, 14), fin(0.12, 0.04, 0.02, 0, 0.7), x, 0.014, z);
        put(new THREE.CylinderGeometry(0.023, 0.023, 0.003, 14), fin(0.8, 0.5, 0.05, 0, 0.5), x, 0.0185, z);
        put(new THREE.CylinderGeometry(0.02, 0.021, 0.008, 14), bun, x, 0.006, z);
      }
      break;
    case 'truffle-fries':
      for (let i = 0; i < 22; i++) {
        const a = i * 2.4;
        const r = 0.01 + (i % 5) * 0.009;
        put(new THREE.BoxGeometry(0.007, 0.007, 0.055), fin(0.78, 0.5, 0.12, 0, 0.6), Math.cos(a) * r, 0.006 + (i % 3) * 0.006, Math.sin(a) * r, a);
      }
      break;
    case 'shrimp-cocktail':
      put(new THREE.CylinderGeometry(0.035, 0.03, 0.02, 20), fin(0.8, 0.84, 0.86, 0, 0.1), 0, 0.01, 0);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        put(new THREE.TorusGeometry(0.014, 0.0065, 6, 12, Math.PI * 1.2), fin(0.9, 0.35, 0.18, 0, 0.35), Math.cos(a) * 0.03, 0.024, Math.sin(a) * 0.03, -a);
      }
      break;
    case 'lobster':
      put(new THREE.CapsuleGeometry(0.02, 0.08, 4, 12).rotateX(Math.PI / 2).scale(1, 0.7, 1), fin(0.6, 0.05, 0.02, 0, 0.35), 0, 0.016, 0);
      for (const s of [-1, 1]) put(new THREE.SphereGeometry(0.014, 10, 8).scale(1, 0.7, 1.6), fin(0.6, 0.05, 0.02, 0, 0.35), s * 0.028, 0.014, -0.052, s * 0.4);
      put(new THREE.CylinderGeometry(0.014, 0.012, 0.016, 12), fin(0.85, 0.62, 0.12, 0, 0.2), 0.05, 0.008, 0.03);
      break;
    case 'caviar':
      put(new THREE.CylinderGeometry(0.03, 0.03, 0.014, 24), STEEL, 0, 0.007, 0);
      put(new THREE.CylinderGeometry(0.027, 0.027, 0.002, 24), fin(0.01, 0.01, 0.012, 0, 0.12), 0, 0.0142, 0);
      for (const [x, z] of [
        [0.05, 0.01],
        [0.04, -0.035],
        [-0.045, 0.03],
      ] as const)
        put(new THREE.CylinderGeometry(0.014, 0.014, 0.005, 14), fin(0.7, 0.5, 0.2, 0, 0.6), x, 0.003, z);
      break;
  }
}

// --- assembling a character's set -----------------------------------------------------------------

interface Built {
  metal: THREE.BufferGeometry | null;
  gem: THREE.BufferGeometry | null;
  glass: THREE.BufferGeometry | null;
  users: number;
}

const built = new Map<string, Built>();

function acquire(key: string, make: (out: Out) => void, fit: Fit): Built {
  let b = built.get(key);
  if (!b) {
    const out: Out = { metal: new Bucket(fit, false), gem: new Bucket(fit, true), glass: new Bucket(fit, false) };
    make(out);
    b = { metal: out.metal.build(), gem: out.gem.build(), glass: out.glass.build(), users: 0 };
    built.set(key, b);
  }
  b.users++;
  return b;
}

function release(key: string): void {
  const b = built.get(key);
  if (!b || --b.users > 0) return;
  built.delete(key);
  b.metal?.dispose();
  b.gem?.dispose();
  b.glass?.dispose();
}

/** The pieces a look wears, split into the big (seen from afar) and the small. */
function pieces(look: Look): { big: string[]; small: string[] } {
  const big: string[] = [];
  const small: string[] = [];
  if (itemOfKind(look.chain, 'chain')) big.push(look.chain!);
  if (itemOfKind(look.hat, 'hat')) big.push(look.hat!);
  if (itemOfKind(look.grill, 'grill')) small.push(look.grill!);
  if (itemOfKind(look.watch, 'watch')) small.push(look.watch!);
  if (itemOfKind(look.shades, 'shades')) small.push(look.shades!);
  return { big, small };
}

function buildPieces(fit: Fit, ids: string[], out: Out): void {
  const chest = Math.max(0, boneIndex(fit, 'Chest'));
  const head = Math.max(0, boneIndex(fit, 'Head'));
  for (const id of ids) {
    const chain = CHAINS[id];
    if (chain) {
      const path = buildChain(fit, chain, out, chest);
      if (chain.pendant) buildPendant(fit, chain.pendant, path, out, chest);
      continue;
    }
    const grill = GRILLS[id];
    if (grill) buildGrill(fit, grill, out, head);
    else if (id === 'gold-watch' || id === 'iced-watch') buildWatch(fit, id === 'iced-watch', out);
    else if (id === 'gold-aviators') buildShades(fit, out, head);
    else if (id === 'black-fedora' || id === 'panama-hat') buildHat(fit, id === 'panama-hat', out, head);
  }
}

/** The chain as one plain gold rope, for far away. */
function buildFarChain(fit: Fit, id: string, out: Out): void {
  const chain = CHAINS[id];
  if (!chain) return;
  const path = chainPath(fit, chain.drop * (fit.female ? 0.9 : 1), chain.width);
  out.metal.add(new THREE.TubeGeometry(path.curve, 64, chain.width * 0.5, 5, true), new THREE.Matrix4(), GOLD_SOFT, Math.max(0, boneIndex(fit, 'Chest')));
}

// --- the carrying pose ---------------------------------------------------------------------------

const holdClips = new WeakMap<Fit, THREE.AnimationClip>();

/**
 * The right arm carrying something: the upper arm a little forward and out, the elbow bent so the
 * forearm points ahead, as an additive clip (it rides on top of idling and walking). Each turn is
 * made in the character's frame and carried into the bone's own, from the model at rest.
 */
function holdClip(fit: Fit): THREE.AnimationClip | null {
  const known = holdClips.get(fit);
  if (known) return known;
  const tracks: THREE.KeyframeTrack[] = [];
  const turn = (bone: string, axis: V3, angle: number) => {
    const i = boneIndex(fit, bone);
    if (i < 0) return;
    const q = fit.quats[i]!;
    const local = axis.clone().applyQuaternion(q.clone().invert()).normalize();
    const d = new THREE.Quaternion().setFromAxisAngle(local, angle);
    tracks.push(new THREE.QuaternionKeyframeTrack(`${fit.names[i]}.quaternion`, [0, 1], [d.x, d.y, d.z, d.w, d.x, d.y, d.z, d.w]));
  };
  turn('UpperArm.R', V(1, 0, 0), -0.32);
  turn('UpperArm.R', V(0, 0, 1), -0.14);
  turn('LowerArm.R', V(1, 0, 0), -1.3);
  if (!tracks.length) return null;
  // two turns on one bone: fold them into a single track
  const merged = new Map<string, THREE.Quaternion>();
  for (const t of tracks) {
    const q = new THREE.Quaternion(t.values[0], t.values[1], t.values[2], t.values[3]);
    const was = merged.get(t.name);
    merged.set(t.name, was ? was.multiply(q) : q);
  }
  const clip = new THREE.AnimationClip(
    'carry',
    1,
    [...merged].map(([name, q]) => new THREE.QuaternionKeyframeTrack(name, [0, 1], [q.x, q.y, q.z, q.w, q.x, q.y, q.z, q.w])),
    THREE.AdditiveAnimationBlendMode,
  );
  holdClips.set(fit, clip);
  return clip;
}

// --- special clothes -----------------------------------------------------------------------------

interface ClothesSpec {
  /** The outfit model it is cut from, per body. */
  outfit: { m: string; f: string };
  top: string;
  bottom: string;
  shoes: string;
  cloth: 'lame' | 'tux' | 'velvet' | 'fur' | 'studs';
}

const CLOTHES: Record<string, ClothesSpec> = {
  'gold-tracksuit': { outfit: { m: 'hoodie', f: 'smart' }, top: '#c9962e', bottom: '#c9962e', shoes: '#e8e4dc', cloth: 'lame' },
  'white-tuxedo': { outfit: { m: 'suit', f: 'smart' }, top: '#e9e2d0', bottom: '#111114', shoes: '#0b0b0d', cloth: 'tux' },
  'velvet-jacket': { outfit: { m: 'suit', f: 'smart' }, top: '#5a0d1c', bottom: '#111114', shoes: '#0b0b0d', cloth: 'velvet' },
  'fur-coat': { outfit: { m: 'suit', f: 'dress' }, top: '#ddd0b8', bottom: '#141416', shoes: '#0b0b0d', cloth: 'fur' },
  'diamond-suit': { outfit: { m: 'suit', f: 'dress' }, top: '#0e0e11', bottom: '#0e0e11', shoes: '#0b0b0d', cloth: 'studs' },
};

/**
 * The look as it is drawn: special clothes put on the outfit they are cut from, in their own
 * colours. The stored look keeps the player's own outfit for when they take them off.
 */
export function dressed(look: Look): Look {
  const c = look.clothes ? CLOTHES[look.clothes] : undefined;
  if (!c) return look;
  return { ...look, outfit: c.outfit[look.body], top: c.top, bottom: c.bottom, shoes: c.shoes };
}

const clothesMats = new Map<string, THREE.MeshPhysicalMaterial>();

const CLOTH_GLSL: Record<ClothesSpec['cloth'], { color?: string; pbr?: string; normal?: string; emissive?: string; sheen?: string }> = {
  // metallic lamé: the folds shimmer; two white stripes down the outside of the arms and legs
  lame: {
    color: `
      float stripe = cloth * step(0.955, abs(vRestN.x)) * step(vRest.y, uNeckY - 0.1) * step(0.2, vRest.y) * (1.0 - step(abs(vRest.x - uCx), 0.16) * step(0.95, vRest.y));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.84, 0.8), stripe);`,
    pbr: `metalnessFactor = mix(metalnessFactor, 0.92, cloth * (1.0 - stripe)); roughnessFactor = mix(roughnessFactor, 0.3, cloth * (1.0 - stripe));`,
    normal: `normal = normalize(normal + cloth * (1.0 - stripe) * (viewMatrix * vec4((vec3(wNoise(vRest * 38.0), wNoise(vRest * 38.0 + 7.1), wNoise(vRest * 38.0 + 3.7)) - 0.5) * 0.9 + (wFacet(vRest, 260.0)) * 0.25, 0.0)).xyz);`,
  },
  // an ivory dinner jacket with black satin lapels and collar
  tux: {
    color: `
      float lap = top * lapel(vRest, vRestN);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.006, 0.006, 0.007), lap);`,
    pbr: `roughnessFactor = mix(roughnessFactor, 0.62, top); roughnessFactor = mix(roughnessFactor, 0.2, lap); roughnessFactor = mix(roughnessFactor, 0.5, bottom); roughnessFactor = mix(roughnessFactor, 0.16, shoes);`,
  },
  // burgundy velvet (a sheen at the edges, soft in the middle), a black satin shawl collar
  velvet: {
    color: `
      float lap = top * lapel(vRest, vRestN);
      diffuseColor.rgb = mix(diffuseColor.rgb * 0.8, vec3(0.006, 0.006, 0.007), lap);`,
    pbr: `roughnessFactor = mix(roughnessFactor, 0.95, top * (1.0 - lap)); roughnessFactor = mix(roughnessFactor, 0.22, lap); roughnessFactor = mix(roughnessFactor, 0.16, shoes);`,
    normal: `normal = normalize(normal + top * (1.0 - lap) * (viewMatrix * vec4(wFacet(vRest, 900.0) * 0.12, 0.0)).xyz);`,
    sheen: `material.sheenColor *= top * (1.0 - lap);`,
  },
  // long fur: clumps and strands, a soft sheen, no shine at all
  fur: {
    color: `
      float clump = wNoise(vRest * 70.0);
      float strand = wNoise(vRest * vec3(900.0, 260.0, 900.0));
      diffuseColor.rgb *= mix(vec3(1.0), vec3(0.62 + 0.45 * clump) * vec3(0.9 + 0.12 * strand), top);`,
    pbr: `roughnessFactor = mix(roughnessFactor, 1.0, top);`,
    normal: `normal = normalize(normal + top * (viewMatrix * vec4((vec3(wNoise(vRest * 70.0), wNoise(vRest * 70.0 + 5.0), wNoise(vRest * 70.0 + 9.0)) - 0.5) * 1.4 + wFacet(vRest, 1100.0) * 0.7, 0.0)).xyz);`,
    sheen: `material.sheenColor *= top;`,
  },
  // black wool sewn with diamonds: a scatter of tiny stones that catch the light and glint
  studs: {
    color: `
      vec3 cell = floor(vRest * 90.0);
      vec3 cen = (cell + 0.5 + (wHash33(cell) - 0.5) * 0.6) / 90.0;
      float stud = cloth * step(0.35, wHash13(cell + 3.0)) * (1.0 - smoothstep(0.0015, 0.0021, length(vRest - cen)));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.92, 0.95), stud);`,
    pbr: `roughnessFactor = mix(roughnessFactor, 0.72, cloth); metalnessFactor = mix(metalnessFactor, 1.0, stud); roughnessFactor = mix(roughnessFactor, 0.05, stud);`,
    normal: `normal = normalize(normal + stud * (viewMatrix * vec4(wFacet(vRest, 1800.0) * 1.2, 0.0)).xyz);`,
    emissive: `totalEmissiveRadiance += stud * (wGlint(vRest, 90.0, uTime) * 4.0 + vec3(0.06));`,
  },
};

/** A special clothes' body material for one outfit model (the lapels depend on the model). */
function clothesMaterial(id: string, fit: Fit): THREE.MeshPhysicalMaterial | null {
  const spec = CLOTHES[id];
  if (!spec) return null;
  const key = `${id}|${fit.id}`;
  const known = clothesMats.get(key);
  if (known) return known;
  const code = CLOTH_GLSL[spec.cloth];
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0, roughness: 0.8, envMapIntensity: 1.1 });
  if (code.sheen) {
    m.sheen = 1;
    m.sheenColor = spec.cloth === 'fur' ? new THREE.Color(0.85, 0.78, 0.66) : new THREE.Color(0.95, 0.35, 0.42);
    m.sheenRoughness = spec.cloth === 'fur' ? 0.62 : 0.4;
  }
  m.name = `clothes:${id}`;
  const time = { value: 0 };
  timeUniforms.push(time);
  const L = fit.lapel;
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = time;
    s.uniforms.uCx = { value: fit.cx };
    s.uniforms.uNeckY = { value: fit.neckY };
    s.uniforms.uLapel = { value: new THREE.Vector4(L.yB, L.yC, L.v0, L.v1) };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float wSlot;\nattribute vec3 wRest;\nattribute vec3 wRestN;\nvarying float vSlot;\nvarying vec3 vRest;\nvarying vec3 vRestN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSlot = wSlot;\nvRest = wRest;\nvRestN = wRestN;');
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vSlot; varying vec3 vRest; varying vec3 vRestN;
uniform float uTime; uniform float uCx; uniform float uNeckY; uniform vec4 uLapel;
${NOISE_GLSL}
// The jacket's lapels: a band beside the front opening from the button up to the collar, wider
// at the top, and the collar round the back of the neck.
float lapel(vec3 p, vec3 n) {
  float dx = abs(p.x - uCx);
  float t = clamp((p.y - uLapel.x) / (uLapel.y - uLapel.x), 0.0, 1.0);
  float inner = mix(uLapel.z, uLapel.w, t);
  float outer = inner + mix(0.008, 0.052, smoothstep(0.0, 0.85, t)) * (1.0 - smoothstep(0.9, 1.0, t) * 0.3);
  float front = step(0.25, n.z) * step(uLapel.x, p.y) * step(p.y, uLapel.y + 0.02);
  float band = step(inner - 0.004, dx) * step(dx, outer);
  float collar = step(uLapel.y - 0.015, p.y) * step(n.z, 0.6) * step(dx, 0.085);
  return max(front * band, collar);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float top = 1.0 - step(0.5, abs(vSlot - 5.0));
float bottom = 1.0 - step(0.5, abs(vSlot - 6.0));
float shoes = 1.0 - step(0.5, abs(vSlot - 7.0));
float cloth = max(top, bottom);
float stripe = 0.0; float lap = 0.0; float stud = 0.0;
${code.color ?? ''}`,
      )
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${code.pbr ?? ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${code.normal ?? ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${code.emissive ?? ''}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${code.sheen ? `#ifdef USE_SHEEN\n${code.sheen}\n#endif` : ''}`);
  };
  m.customProgramCacheKey = () => `wear-clothes-${spec.cloth}-${fit.id}`;
  reflect(m);
  clothesMats.set(key, m);
  return m;
}

// --- one character's wearables -----------------------------------------------------------------------

interface Attached {
  /** What is hung (compared with what the look wants), and the shared builds it holds. */
  key: string;
  builds: string[];
  holder: THREE.Object3D;
}

/** What one character wears, kept in step with its look (see characters.ts). */
export class Wearables {
  private model: THREE.Object3D | null = null;
  private fit: Fit | null = null;
  private set: Attached | null = null;
  private hand: Attached | null = null;
  private plain: THREE.Material | null = null;
  private suit: THREE.Material | null = null;
  private carry: THREE.AnimationAction | null = null;
  private carryMixer: THREE.AnimationMixer | null = null;
  private carrying = false;
  private timer = 0;

  /**
   * Put on what `look` wears. Called whenever the look is painted onto a shown model, with that
   * model, its body mesh and mixer, and the template it was cloned from.
   */
  dress(look: Look, tpl: TemplateLike, model: THREE.Object3D, body: THREE.SkinnedMesh, mixer: THREE.AnimationMixer | null): void {
    const fit = fitFor(tpl, look.body === 'f');
    if (!fit) return;
    if (model !== this.model) {
      // a new model: everything hung on the old one went with it
      this.drop(this.set);
      this.drop(this.hand);
      this.set = null;
      this.hand = null;
      this.carry = null;
      this.carryMixer = null;
      this.carrying = false;
      this.model = model;
    }
    this.fit = fit;

    // special clothes: their own body material, reading each vertex's slot and rest position
    if (body.material !== this.suit) this.plain = body.material as THREE.Material;
    const suit = look.clothes ? clothesMaterial(look.clothes, fit) : null;
    if (suit) {
      const g = body.geometry;
      if (g.getAttribute('wRest') !== fit.rest) {
        g.setAttribute('wRest', fit.rest);
        g.setAttribute('wRestN', fit.restN);
        g.setAttribute('wSlot', fit.slot);
      }
      body.material = suit;
      // the diamonds' glint keeps time even when nothing else is worn
      body.onBeforeRender = beforeDraw;
    } else if (this.plain) {
      body.material = this.plain;
    }
    this.suit = suit;

    // jewellery, watch, shades, hat
    const { big, small } = pieces(look);
    const key = big.length || small.length ? `${fit.id}|${big.join(',')}|${small.join(',')}` : '';
    if (key !== (this.set?.key ?? '')) {
      this.drop(this.set);
      this.set = key ? this.attachSet(fit, body, big, small, key) : null;
    }

    // a bar order in the hand, until its time runs out
    const now = serverNow();
    const held = look.held && barItem(look.held.item) && look.held.until > now ? look.held : null;
    const item = held ? barItem(held.item)! : null;
    const handKey = item ? `${fit.id}|held|${item.model === 'plate' ? item.id : item.model}` : '';
    if (handKey !== (this.hand?.key ?? '')) {
      this.drop(this.hand);
      this.hand = item ? this.attachHeld(fit, body, item.model, item.id, handKey) : null;
    }
    clearTimeout(this.timer);
    if (held) this.timer = window.setTimeout(() => this.putDown(), Math.min(2 ** 31 - 1, held.until - now + 50));
    this.pose(mixer, model, !!held);
  }

  /** The body material to use now: the special clothes' own, or the plain one given. */
  body(m: THREE.Material): THREE.Material {
    this.plain = m;
    return this.suit ?? m;
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.drop(this.set);
    this.drop(this.hand);
    this.set = null;
    this.hand = null;
    this.model = null;
  }

  /** The order's time ran out: it leaves the hand (the look still says it; nobody draws it). */
  private putDown(): void {
    this.drop(this.hand);
    this.hand = null;
    if (this.carryMixer && this.model) this.pose(this.carryMixer, this.model, false);
  }

  private pose(mixer: THREE.AnimationMixer | null, model: THREE.Object3D, on: boolean): void {
    if (!mixer || !this.fit || on === this.carrying) return;
    if (!this.carry || this.carryMixer !== mixer) {
      if (!on) return;
      const clip = holdClip(this.fit);
      if (!clip) return;
      this.carry = mixer.clipAction(clip, model);
      this.carryMixer = mixer;
    }
    this.carrying = on;
    if (on) this.carry.reset().fadeIn(0.35).play();
    else this.carry.fadeOut(0.35);
  }

  private attachSet(fit: Fit, body: THREE.SkinnedMesh, big: string[], small: string[], key: string): Attached {
    const nearKey = `${key}|near`;
    const farKey = `${fit.id}|far|${big.join(',')}`;
    const near = acquire(nearKey, (out) => buildPieces(fit, [...big, ...small], out), fit);
    const chain = big.find((id) => CHAINS[id]);
    const far = acquire(
      farKey,
      (out) => {
        if (chain) buildFarChain(fit, chain, out);
        buildPieces(fit, big.filter((id) => !CHAINS[id]), out);
      },
      fit,
    );
    const lod = new THREE.LOD();
    lod.name = 'wearables';
    const nearGroup = new THREE.Group();
    const farGroup = new THREE.Group();
    this.skinned(near, body, nearGroup);
    this.skinned(far, body, farGroup);
    lod.addLevel(nearGroup, 0, 0.08);
    lod.addLevel(farGroup, FAR_M, 0.08);
    this.model!.add(lod);
    return { key, builds: [nearKey, farKey], holder: lod };
  }

  private attachHeld(fit: Fit, body: THREE.SkinnedMesh, model: BarModel, item: string, key: string): Attached {
    const b = acquire(
      key,
      (out) => {
        buildHeld(fit, model, out);
        if (model === 'plate') buildPlateFood(fit, item, out);
      },
      fit,
    );
    const holder = new THREE.Group();
    holder.name = 'held';
    this.skinned(b, body, holder);
    this.model!.add(holder);
    return { key, builds: [key], holder };
  }

  /** Skinned meshes for a built set, on this character's own skeleton. */
  private skinned(b: Built, body: THREE.SkinnedMesh, into: THREE.Object3D): void {
    for (const [g, mat] of [
      [b.metal, jewel()],
      [b.gem, gem()],
      [b.glass, glass()],
    ] as const) {
      if (!g) continue;
      const m = new THREE.SkinnedMesh(g, mat);
      m.bind(body.skeleton, body.bindMatrix);
      // skinned bounds don't follow the animation; these ride a small character, never cull alone
      m.frustumCulled = false;
      m.onBeforeRender = beforeDraw;
      into.add(m);
    }
  }

  private drop(a: Attached | null): void {
    if (!a) return;
    a.holder.removeFromParent();
    // the geometry is shared; the last one to let go disposes it
    for (const k of a.builds) release(k);
  }
}

/** Past this distance (m) a character's small pieces aren't drawn, and its chain is one plain rope. */
const FAR_M = 9;
