// The Bandit Wheel as it stands on the floor: a big wooden wheel in a steel band, hung on a timber
// frame bolted to a heavy base of sleepers, a leather flapper at the top under Rust's red pointer,
// a stencilled sign on the beam and two caged work lamps; in front of it, ten betting terminals in
// an arc, each a painted steel box on a post with the five squares on top and an amber screen, and
// a stool behind it.
//
// Static parts are merged per material when the model is built (the frame, all ten terminals, all
// ten stools), so the station costs about fifteen draw calls up close and bakes to a handful for
// the far copy (world/lod.ts). The rotor (face, band, straps, pegs) is its own group so the view can
// turn it; the flapper is a strip the view bends as each peg goes by.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SLOTS } from '../../../../shared/src/games/banditwheel/rules.ts';
import type { Quality } from '../../render/engine3d.ts';
import {
  HUB_Y, WHEEL_Z, DISC_T, FACE_R, RING_IN, BAND_R, BAND_LIP, PEG_R, PEG_RADIUS, PEG_OUT, PIVOT_R, FLAP_L, FLAP_Z,
  FRAME_Z, POST_X, POST_W, BEAM_Y, BEAM_H, BASE_H, BASE_W, BASE_Z0, BASE_Z1,
  TERMINALS, TERM_R, STOOL_R, TERM_W, TERM_D, TOP_Y, STOOL_TOP, STOOL_SEAT_R, CUP_PITCH, CUP_Z,
  onArc, terminalYaw,
} from './layout.ts';
import { paintWood, paintRust, paintPainted, paintLeather, paintFace, paintPlate, paintSign, drawScreen, texture } from './art.ts';

export const WHEEL_GROUP = 'bw-wheel';
export const ROTOR_NAME = 'bw-rotor';
export const FLAP_NAME = 'bw-flapper';
export const GLOW_NAME = 'bw-glow';
export const SCREENS_NAME = 'bw-screens';
export const LAMPS_NAME = 'bw-lamps';

const SECTOR = (Math.PI * 2) / SLOTS;
/** Texture metres per repeat for the tiling materials. */
const WOOD_M = 0.9;
const METAL_M = 0.6;

// ---------------------------------------------------------------------------------------------
// Geometry helpers: parts placed by a matrix, UVs in metres, merged per material

type Axis = 'x' | 'y' | 'z';

/**
 * A box whose UVs are in texture repeats (so a long beam and a short block show the grain at the
 * same scale), the texture's u running along `grain` wherever a face allows it.
 */
function box(w: number, h: number, d: number, repeat: number, grain: Axis = 'x', offset = 0): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  // BoxGeometry's faces in order +x, −x, +y, −y, +z, −z: which axes u and v run along, and their sizes
  const faces: [Axis, Axis][] = [['z', 'y'], ['z', 'y'], ['x', 'z'], ['x', 'z'], ['x', 'y'], ['x', 'y']];
  const size: Record<Axis, number> = { x: w, y: h, z: d };
  for (let f = 0; f < 6; f++) {
    const [ua, va] = faces[f]!;
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      const u = uv.getX(i);
      const v = uv.getY(i);
      if (va === grain) uv.setXY(i, (v * size[va]) / repeat + offset, (u * size[ua]) / repeat + offset * 0.7);
      else uv.setXY(i, (u * size[ua]) / repeat + offset, (v * size[va]) / repeat + offset * 0.7);
    }
  }
  return geo;
}

/** Scale a geometry's UVs (cylinders, tori, discs keep their layout but tile at a sensible size). */
function scaleUv(geo: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

class Parts {
  private list: THREE.BufferGeometry[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();

  /** Add `geo` rotated by `rot` (radians, XYZ) and moved to `at`, after `pre` if given. */
  add(geo: THREE.BufferGeometry, at: [number, number, number], rot: [number, number, number] = [0, 0, 0], pre?: THREE.Matrix4): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    this.q.setFromEuler(this.e.set(...rot));
    this.m.compose(new THREE.Vector3(...at), this.q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(this.m);
    if (pre) g.applyMatrix4(pre);
    this.list.push(g);
    return this;
  }

  /** Everything added so far, placed again by `m` (the same terminal at another spot on the arc). */
  copies(ms: THREE.Matrix4[]): Parts {
    const out = new Parts();
    for (const m of ms) for (const g of this.list) out.list.push(g.clone().applyMatrix4(m));
    for (const g of this.list) g.dispose();
    this.list = [];
    return out;
  }

  mesh(mat: THREE.Material, name: string): THREE.Mesh | null {
    if (this.list.length === 0) return null;
    const merged = mergeGeometries(this.list, false)!;
    for (const g of this.list) g.dispose();
    this.list = [];
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = name;
    return mesh;
  }
}

/** The same surface seen from the other side: triangles wound the other way, normals flipped. */
function inward(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  for (const name of ['position', 'normal', 'uv']) {
    const a = g.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!a) continue;
    for (let i = 0; i < a.count; i += 3) {
      for (let c = 0; c < a.itemSize; c++) {
        const t = a.getComponent(i + 1, c);
        a.setComponent(i + 1, c, a.getComponent(i + 2, c));
        a.setComponent(i + 2, c, t);
      }
    }
  }
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < n.array.length; i++) (n.array as Float32Array)[i] = -(n.array as Float32Array)[i]!;
  return g;
}

/** A hexagonal bolt head, lying on the xy plane facing +z. */
function boltHead(r = 0.011, h = 0.007): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, h, 6).rotateX(Math.PI / 2).translate(0, 0, h / 2);
}

// ---------------------------------------------------------------------------------------------
// Materials: the tiling paints are shared by every wheel; the screens are each station's own

interface Shared {
  wood: THREE.MeshStandardMaterial;
  rust: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  paint: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial;
  face: THREE.MeshStandardMaterial;
  plate: THREE.MeshStandardMaterial;
  sign: THREE.MeshStandardMaterial;
  bulb: THREE.MeshBasicMaterial;
}

const shared = new Map<Quality, Shared>();

function materials(quality: Quality): Shared {
  let m = shared.get(quality);
  if (m) return m;
  const high = quality === 'high';
  const tile = (c: HTMLCanvasElement) => texture(c, { repeat: true, anisotropy: high ? 8 : 2 });
  const woodTex = tile(paintWood(high ? 512 : 256));
  const rustTex = tile(paintRust(high ? 512 : 256));
  const paintTex = tile(paintPainted(high ? 512 : 256));
  const faceTex = texture(paintFace(high ? 2048 : 1024), { anisotropy: high ? 8 : 4 });
  const plateTex = texture(paintPlate(high ? 1024 : 512), { anisotropy: 8 });
  const signTex = texture(paintSign(high ? 1024 : 512), { anisotropy: 4 });
  const leatherTex = texture(paintLeather());
  m = {
    wood: new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.92, metalness: 0, ...(high ? { bumpMap: woodTex, bumpScale: 1.6 } : {}) }),
    rust: new THREE.MeshStandardMaterial({ map: rustTex, roughness: 0.86, metalness: 0.35, ...(high ? { bumpMap: rustTex, bumpScale: 1.2 } : {}) }),
    steel: new THREE.MeshStandardMaterial({ color: '#8f877b', roughness: 0.38, metalness: 0.85 }),
    paint: new THREE.MeshStandardMaterial({ map: paintTex, roughness: 0.78, metalness: 0.15 }),
    leather: new THREE.MeshStandardMaterial({ map: leatherTex, roughness: 0.7, metalness: 0 }),
    red: new THREE.MeshStandardMaterial({ color: '#c8431f', roughness: 0.62, metalness: 0.25 }),
    // the paint is the thing to read: a touch of its own light so it holds up in a dim corner
    face: new THREE.MeshStandardMaterial({ map: faceTex, emissive: '#ffffff', emissiveMap: faceTex, emissiveIntensity: 0.14, roughness: 0.74, metalness: 0 }),
    plate: new THREE.MeshStandardMaterial({ map: plateTex, emissive: '#ffffff', emissiveMap: plateTex, emissiveIntensity: 0.1, roughness: 0.7, metalness: 0.1 }),
    sign: new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.8, metalness: 0.3, side: THREE.DoubleSide }),
    bulb: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.55, 0.8) }),
  };
  shared.set(quality, m);
  return m;
}

/** The terminals' screens: one canvas for the whole station, redrawn by the view once a second. */
export interface Screens {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
}

function screens(): { screens: Screens; mat: THREE.MeshStandardMaterial } {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  drawScreen(c, { kind: 'idle' });
  const tex = texture(c);
  const mat = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 1.25, roughness: 0.3, metalness: 0 });
  return { screens: { canvas: c, texture: tex }, mat };
}

// ---------------------------------------------------------------------------------------------
// The rotor: face, disc, steel band and its bolts, the iron straps over the centre, the hub, the pegs

function buildRotor(m: Shared, quality: Quality): THREE.Group {
  const rotor = new THREE.Group();
  rotor.name = ROTOR_NAME;
  const seg = quality === 'high' ? 160 : 96;

  const face = new THREE.Mesh(new THREE.CircleGeometry(FACE_R, seg), m.face);
  face.position.z = 0.0008;
  face.name = 'bw-face';
  rotor.add(face);

  // the disc behind the paint: two thick boards' worth of timber
  const wood = new Parts();
  wood.add(scaleUv(new THREE.CylinderGeometry(FACE_R + 0.01, FACE_R + 0.01, DISC_T, seg, 1, false), 5, 0.2), [0, 0, -DISC_T / 2], [Math.PI / 2, 0, 0]);

  const rust = new Parts();
  // the band: an iron hoop round the rim with a lip over the paint
  const hoopW = DISC_T + BAND_LIP + 0.006;
  rust.add(scaleUv(new THREE.CylinderGeometry(BAND_R, BAND_R, hoopW, seg, 1, true), 11, 0.18), [0, 0, BAND_LIP - hoopW / 2], [Math.PI / 2, 0, 0]);
  rust.add(scaleUv(new THREE.RingGeometry(FACE_R - 0.006, BAND_R, seg, 1), 3, 3), [0, 0, BAND_LIP]);
  rust.add(inward(scaleUv(new THREE.CylinderGeometry(FACE_R - 0.006, FACE_R - 0.006, BAND_LIP, seg, 1, true), 11, 0.05)), [0, 0, BAND_LIP / 2], [Math.PI / 2, 0, 0]);
  // two bolts per slot through the lip, and the plate where the hoop's ends overlap
  const lipR = (FACE_R + BAND_R) / 2;
  for (let i = 0; i < SLOTS * 2; i++) {
    const a = (i + 0.5) * (SECTOR / 2);
    rust.add(boltHead(0.0075, 0.006), [lipR * Math.sin(a), lipR * Math.cos(a), BAND_LIP], [0, 0, -a]);
  }
  const seamA = Math.PI * 1.08;
  rust.add(box(0.09, 0.03, 0.006, METAL_M, 'x', 0.3), [BAND_R * Math.sin(seamA), BAND_R * Math.cos(seamA), BAND_LIP - hoopW / 2 + 0.03], [0, Math.PI / 2, -seamA + Math.PI / 2]);
  // iron straps across the cream centre, bolted at each end, not quite square to each other
  const straps = [0.14, 1.64, 3.2, 4.66];
  for (const a of straps) {
    const len = RING_IN + 0.035;
    rust.add(box(0.052, len, 0.009, METAL_M, 'y', a), [Math.sin(a) * len * 0.5, Math.cos(a) * len * 0.5, 0.0045], [0, 0, -a]);
    for (const r of [0.13, RING_IN - 0.01]) rust.add(boltHead(0.012, 0.008), [Math.sin(a) * r, Math.cos(a) * r, 0.009], [0, 0, -a]);
  }
  // the hub: a plate, a thick washer and a big nut on the axle
  rust.add(scaleUv(new THREE.CylinderGeometry(0.12, 0.12, 0.014, 32), 0.6, 0.6), [0, 0, 0.012], [Math.PI / 2, 0, 0]);
  rust.add(new THREE.CylinderGeometry(0.07, 0.07, 0.016, 24), [0, 0, 0.027], [Math.PI / 2, 0, 0]);
  rust.add(new THREE.CylinderGeometry(0.052, 0.052, 0.05, 6), [0, 0, 0.06], [Math.PI / 2, 0, 0]);

  // the pegs: steel pins on every boundary, rubbed bright by the flapper
  const steel = new Parts();
  for (let i = 0; i < SLOTS; i++) {
    const a = i * SECTOR;
    const [x, y] = [PEG_R * Math.sin(a), PEG_R * Math.cos(a)];
    steel.add(new THREE.CylinderGeometry(PEG_RADIUS, PEG_RADIUS, PEG_OUT, 10), [x, y, PEG_OUT / 2], [Math.PI / 2, 0, 0]);
    steel.add(new THREE.SphereGeometry(PEG_RADIUS * 1.45, 10, 6), [x, y, PEG_OUT]);
  }
  steel.add(new THREE.CylinderGeometry(0.02, 0.02, 0.012, 16), [0, 0, 0.09], [Math.PI / 2, 0, 0]);

  for (const mesh of [wood.mesh(m.wood, 'bw-rotor-wood'), rust.mesh(m.rust, 'bw-rotor-iron'), steel.mesh(m.steel, 'bw-pegs')]) if (mesh) rotor.add(mesh);

  // the light over the slot that came up, moved onto it by the view (slot 0 spans φ from π/2 − S to π/2)
  const glow = new THREE.Mesh(
    new THREE.RingGeometry(RING_IN + 0.01, FACE_R - 0.01, 8, 1, Math.PI / 2 - SECTOR, SECTOR),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.15, 0.75), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  glow.name = GLOW_NAME;
  glow.position.z = 0.002;
  glow.visible = false;
  rotor.add(glow);
  return rotor;
}

// ---------------------------------------------------------------------------------------------
// The flapper: a leather strap the view bends, under a red steel pointer

/** Rings along the strap and the strap's size: wide at the hinge, narrowing to the tip. */
const FLAP_RINGS = 14;
const FLAP_W0 = 0.056;
const FLAP_W1 = 0.03;
const FLAP_DEPTH = 0.03;

export class Flapper {
  readonly mesh: THREE.Mesh;
  private readonly pos: THREE.BufferAttribute;
  private bent = NaN;

  constructor(mat: THREE.Material) {
    const n = FLAP_RINGS + 1;
    const positions = new Float32Array(n * 4 * 3);
    const uvs = new Float32Array(n * 4 * 2);
    const index: number[] = [];
    for (let j = 0; j < n; j++) {
      const v = j / FLAP_RINGS;
      for (let k = 0; k < 4; k++) {
        uvs[(j * 4 + k) * 2] = k === 0 || k === 3 ? 0 : 1;
        uvs[(j * 4 + k) * 2 + 1] = 1 - v;
      }
      if (j < FLAP_RINGS) {
        for (let k = 0; k < 4; k++) {
          const a = j * 4 + k;
          const b = j * 4 + ((k + 1) % 4);
          index.push(a, a + 4, b, b, a + 4, b + 4);
        }
      }
    }
    const last = FLAP_RINGS * 4;
    index.push(last, last + 1, last + 2, last, last + 2, last + 3); // the tip
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(positions, 3);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(index);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = FLAP_NAME;
    this.mesh.position.set(0, HUB_Y + PIVOT_R, WHEEL_Z + FLAP_Z);
    this.bend(0);
  }

  /**
   * Bend the strap so its tip sits `phi` radians round from straight down (positive: pushed
   * clockwise). A strap pushed at its tip curls like a cantilever: its slope grows along it as
   * s(2L − s), reaching 1.5 φ at the tip, which puts the chord (hinge to tip) at φ.
   */
  bend(phi: number): void {
    if (Math.abs(phi - this.bent) < 1e-5) return;
    this.bent = phi;
    const p = this.pos.array as Float32Array;
    let x = 0;
    let y = 0;
    const ds = FLAP_L / FLAP_RINGS;
    for (let j = 0; j <= FLAP_RINGS; j++) {
      const s = j * ds;
      const slope = (1.5 * phi * s * (2 * FLAP_L - s)) / (FLAP_L * FLAP_L);
      if (j > 0) {
        const mid = s - ds / 2;
        const a = (1.5 * phi * mid * (2 * FLAP_L - mid)) / (FLAP_L * FLAP_L);
        x += Math.sin(a) * ds;
        y -= Math.cos(a) * ds;
      }
      const w = (FLAP_W0 + (FLAP_W1 - FLAP_W0) * (s / FLAP_L)) / 2;
      // across the strap in the face's plane, and front to back
      const nx = Math.cos(slope);
      const ny = Math.sin(slope);
      const corners: [number, number][] = [[-w, FLAP_DEPTH / 2], [w, FLAP_DEPTH / 2], [w, -FLAP_DEPTH / 2], [-w, -FLAP_DEPTH / 2]];
      corners.forEach(([u, z], k) => {
        const o = (j * 4 + k) * 3;
        p[o] = x + nx * u;
        p[o + 1] = y + ny * u;
        p[o + 2] = z;
      });
    }
    this.pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.mesh.geometry.computeBoundingSphere();
  }
}

// ---------------------------------------------------------------------------------------------
// The frame, the base, the pointer, the lamps and the sign

function buildFrame(m: Shared): THREE.Object3D[] {
  const wood = new Parts();
  const rust = new Parts();
  const red = new Parts();
  const bulbs = new Parts();
  let o = 0.13;
  const off = () => (o = (o * 7.13 + 0.37) % 1);

  // the base: five railway sleepers side by side, steel straps round the ends
  const sleepers = 5;
  const sd = (BASE_Z1 - BASE_Z0 - 0.04) / sleepers;
  for (let i = 0; i < sleepers; i++) {
    const z = BASE_Z0 + 0.02 + sd * (i + 0.5);
    wood.add(box(BASE_W - (i % 2) * 0.06, BASE_H - (i === 0 || i === sleepers - 1 ? 0.015 : 0), sd - 0.012, WOOD_M, 'x', off()), [0, BASE_H / 2, z]);
  }
  for (const x of [-BASE_W / 2 + 0.2, BASE_W / 2 - 0.2]) {
    rust.add(box(0.07, 0.006, BASE_Z1 - BASE_Z0 + 0.012, METAL_M, 'z', off()), [x, BASE_H + 0.003, (BASE_Z0 + BASE_Z1) / 2]);
    rust.add(box(0.07, BASE_H, 0.006, METAL_M, 'y', off()), [x, BASE_H / 2, BASE_Z1 + 0.003]);
    for (const zz of [BASE_Z0 + 0.1, (BASE_Z0 + BASE_Z1) / 2, BASE_Z1 - 0.1]) rust.add(boltHead(0.012, 0.008), [x, BASE_H + 0.006, zz], [-Math.PI / 2, 0, 0]);
    for (const y of [0.08, BASE_H - 0.08]) rust.add(boltHead(0.012, 0.008), [x, y, BASE_Z1 + 0.006]);
  }

  // the posts, the beam across the top, the post behind the wheel that carries the axle
  const postTop = BEAM_Y + BEAM_H / 2;
  for (const x of [-POST_X, POST_X]) wood.add(box(POST_W, postTop - BASE_H, POST_W, WOOD_M, 'y', off()), [x, (postTop + BASE_H) / 2, FRAME_Z]);
  const beamW = 2 * POST_X + POST_W + 0.24;
  wood.add(box(beamW, BEAM_H, POST_W + 0.02, WOOD_M, 'x', off()), [0, BEAM_Y, FRAME_Z]);
  const backTop = BEAM_Y - BEAM_H / 2;
  wood.add(box(0.2, backTop - BASE_H, 0.19, WOOD_M, 'y', off()), [0, (backTop + BASE_H) / 2, FRAME_Z]);
  // knee braces in the top corners, struts from the base up the back of the posts
  for (const s of [-1, 1]) {
    wood.add(box(0.5, 0.1, 0.1, WOOD_M, 'x', off()), [s * (POST_X - 0.26), BEAM_Y - BEAM_H / 2 - 0.17, FRAME_Z], [0, 0, -s * (Math.PI / 4)]);
    const len = 1.45;
    const ang = Math.atan2(1.05, 0.55);
    wood.add(box(len, 0.11, 0.11, WOOD_M, 'x', off()), [s * (POST_X - 0.29), BASE_H + 0.5, FRAME_Z - 0.15], [0, 0, s * ang]);
  }
  // iron plates bolted over the joints
  const plate = (x: number, y: number, z: number, w: number, h: number) => {
    rust.add(box(w, h, 0.008, METAL_M, 'x', off()), [x, y, z]);
    for (const dx of [-w / 2 + 0.03, w / 2 - 0.03]) for (const dy of [-h / 2 + 0.03, h / 2 - 0.03]) rust.add(boltHead(0.011, 0.008), [x + dx, y + dy, z + 0.004]);
  };
  const front = FRAME_Z + POST_W / 2 + 0.006;
  for (const x of [-POST_X, POST_X]) {
    plate(x, BEAM_Y, front + 0.01, 0.28, 0.24);
    plate(x, BASE_H + 0.14, front, 0.22, 0.22);
  }
  plate(0, BASE_H + 0.16, FRAME_Z + 0.1, 0.26, 0.2);

  // the axle out of the back post into the hub
  rust.add(new THREE.CylinderGeometry(0.045, 0.045, WHEEL_Z - DISC_T - FRAME_Z + 0.02, 20), [0, HUB_Y, (WHEEL_Z - DISC_T + FRAME_Z + 0.1) / 2], [Math.PI / 2, 0, 0]);
  rust.add(new THREE.CylinderGeometry(0.1, 0.11, 0.02, 24), [0, HUB_Y, FRAME_Z + 0.105], [Math.PI / 2, 0, 0]);

  // the pointer's arm: a steel bracket out from the beam over the band, the flapper's hinge pin under it
  const pivotY = HUB_Y + PIVOT_R;
  const armZ0 = FRAME_Z + POST_W / 2;
  const armZ1 = WHEEL_Z + FLAP_Z + FLAP_DEPTH / 2 + 0.03;
  const armLen = armZ1 - armZ0;
  const armTop = BEAM_Y - BEAM_H / 2;
  rust.add(box(0.07, 0.022, armLen, METAL_M, 'z', off()), [0, armTop - 0.011, armZ0 + armLen / 2]);
  const clevisBottom = pivotY - 0.035;
  for (const z of [armZ1, WHEEL_Z + FLAP_Z - FLAP_DEPTH / 2 - 0.012]) {
    rust.add(box(0.06, armTop - clevisBottom, 0.01, METAL_M, 'y', off()), [0, (armTop + clevisBottom) / 2, z]);
  }
  rust.add(new THREE.CylinderGeometry(0.006, 0.006, FLAP_DEPTH + 0.05, 10), [0, pivotY, WHEEL_Z + FLAP_Z], [Math.PI / 2, 0, 0]);
  for (const z of [armZ1 + 0.008, WHEEL_Z + FLAP_Z - FLAP_DEPTH / 2 - 0.02]) rust.add(boltHead(0.011, 0.008), [0, pivotY, z], [0, z > WHEEL_Z ? 0 : Math.PI, 0]);
  // Rust's red pointer: a painted steel triangle over the hinge, pointing at the slot on top
  const tri = new THREE.Shape();
  tri.moveTo(-0.055, 0.075);
  tri.lineTo(0.055, 0.075);
  tri.lineTo(0, -0.03);
  tri.closePath();
  red.add(new THREE.ExtrudeGeometry(tri, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 }), [0, pivotY + 0.012, armZ1 + 0.006]);
  for (const x of [-0.03, 0.03]) rust.add(boltHead(0.007, 0.005), [x, pivotY + 0.07, armZ1 + 0.016]);

  // two caged work lamps on the posts, turned in toward the face
  const lamps: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const lamp = new Parts();
    lamp.add(new THREE.CylinderGeometry(0.05, 0.065, 0.1, 16), [0, 0, 0], [Math.PI / 2, 0, 0]);
    lamp.add(new THREE.TorusGeometry(0.065, 0.004, 6, 20), [0, 0, 0.1]);
    lamp.add(new THREE.TorusGeometry(0.06, 0.004, 6, 20), [0, 0, 0.16]);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      lamp.add(new THREE.CylinderGeometry(0.0035, 0.0035, 0.13, 5), [Math.cos(a) * 0.063, Math.sin(a) * 0.063, 0.115], [Math.PI / 2, 0, 0]);
    }
    lamp.add(box(0.04, 0.04, 0.12, METAL_M, 'z', off()), [0, 0, -0.1]);
    const place = new THREE.Matrix4().compose(
      new THREE.Vector3(s * POST_X, 2.28, FRAME_Z + POST_W / 2 + 0.12),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -s * 0.62, 0, 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    );
    const iron = lamp.copies([place]).mesh(m.rust, 'bw-lamp');
    if (iron) lamps.push(iron);
    bulbs.add(new THREE.SphereGeometry(0.036, 14, 10), [0, 0, 0.1], [0, 0, 0], place);
  }
  const bulbMesh = bulbs.mesh(m.bulb, LAMPS_NAME);

  // the sign on the beam: a sheet of corrugated iron, wired to two uprights
  const signW = 1.5;
  const signH = signW / 4;
  const sheet = new THREE.PlaneGeometry(signW, signH, 44, 1);
  const sp = sheet.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < sp.count; i++) sp.setZ(i, Math.sin((sp.getX(i) / signW) * 22 * Math.PI * 2) * 0.008);
  sheet.computeVertexNormals();
  const signY = BEAM_Y + BEAM_H / 2 + signH / 2 + 0.03;
  const signMesh = new THREE.Mesh(sheet, m.sign);
  signMesh.position.set(0, signY, FRAME_Z + POST_W / 2 + 0.02);
  signMesh.rotation.x = -0.06;
  signMesh.name = 'bw-sign';
  for (const x of [-signW / 2 + 0.12, signW / 2 - 0.12]) rust.add(box(0.04, signH + 0.06, 0.012, METAL_M, 'y', off()), [x, signY - 0.02, FRAME_Z + POST_W / 2 + 0.006]);

  const out: THREE.Object3D[] = [signMesh, ...lamps];
  for (const mesh of [wood.mesh(m.wood, 'bw-frame-wood'), rust.mesh(m.rust, 'bw-frame-iron'), red.mesh(m.red, 'bw-pointer'), bulbMesh]) if (mesh) out.push(mesh);
  return out;
}

// ---------------------------------------------------------------------------------------------
// The terminals and the stools

function buildTerminals(m: Shared, screenMat: THREE.Material): THREE.Object3D[] {
  // one terminal, console-local (its player at +z), then copied round the arc
  const paint = new Parts();
  const rust = new Parts();
  const steel = new Parts();
  const plate = new Parts();
  const screen = new Parts();
  const conH = 0.1;
  const conY = TOP_Y - conH / 2;
  paint.add(box(TERM_W, conH, TERM_D, 0.5, 'x', 0.2), [0, conY, 0]);
  // a lip round the top so chips can't slide off, and a kick of rust along the front
  rust.add(box(TERM_W + 0.012, 0.014, 0.01, METAL_M, 'x', 0.4), [0, TOP_Y + 0.002, TERM_D / 2 + 0.002]);
  rust.add(box(0.01, 0.014, TERM_D, METAL_M, 'z', 0.5), [-TERM_W / 2 - 0.002, TOP_Y + 0.002, 0]);
  rust.add(box(0.01, 0.014, TERM_D, METAL_M, 'z', 0.6), [TERM_W / 2 + 0.002, TOP_Y + 0.002, 0]);
  // the post and its foot
  rust.add(box(0.09, conY - conH / 2 - 0.02, 0.09, METAL_M, 'y', 0.7), [0, (conY - conH / 2 + 0.02) / 2, -0.04]);
  rust.add(box(0.28, 0.02, 0.24, METAL_M, 'x', 0.8), [0, 0.01, -0.04]);
  for (const x of [-0.11, 0.11]) for (const z of [-0.13, 0.05]) rust.add(boltHead(0.01, 0.008), [x, 0.02, z], [-Math.PI / 2, 0, 0]);
  // rivets along the console's front
  for (let k = 0; k < 6; k++) steel.add(new THREE.SphereGeometry(0.0045, 6, 4), [-TERM_W / 2 + 0.03 + k * ((TERM_W - 0.06) / 5), conY - 0.03, TERM_D / 2 + 0.001]);
  // the five squares
  plate.add(new THREE.PlaneGeometry(CUP_PITCH * 5, CUP_PITCH * 1.25), [0, TOP_Y + 0.0007, CUP_Z], [-Math.PI / 2, 0, 0]);
  // the screen in its hood at the back, tilted up at the player
  const hoodZ = -TERM_D / 2 + 0.04;
  const tilt = -0.42;
  const hood = new THREE.Matrix4().compose(new THREE.Vector3(0, TOP_Y + 0.055, hoodZ), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, 0, 0)), new THREE.Vector3(1, 1, 1));
  paint.add(box(0.21, 0.12, 0.05, 0.5, 'x', 0.1), [0, 0, 0], [0, 0, 0], hood);
  screen.add(new THREE.PlaneGeometry(0.17, 0.085), [0, 0, 0.0255], [0, 0, 0], hood);

  // the stool: a timber seat on an iron post, a foot ring
  const stool = new Parts();
  const stoolWood = new Parts();
  const stoolZ = STOOL_R - TERM_R;
  stool.add(new THREE.CylinderGeometry(0.03, 0.03, STOOL_TOP - 0.04, 12), [0, (STOOL_TOP - 0.04) / 2, stoolZ]);
  stool.add(scaleUv(new THREE.CylinderGeometry(0.19, 0.2, 0.02, 20), 0.6, 0.6), [0, 0.01, stoolZ]);
  stool.add(new THREE.TorusGeometry(0.15, 0.011, 6, 22), [0, 0.3, stoolZ], [Math.PI / 2, 0, 0]);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.4;
    stool.add(new THREE.CylinderGeometry(0.008, 0.008, 0.15, 6), [Math.cos(a) * 0.075, 0.3, stoolZ + Math.sin(a) * 0.075], [0, -a, Math.PI / 2]);
  }
  // one board's worth of grain across the seat: the caps map the texture flat, so scale evenly
  stoolWood.add(scaleUv(new THREE.CylinderGeometry(STOOL_SEAT_R, STOOL_SEAT_R - 0.012, 0.045, 22), 0.38, 0.38), [0, STOOL_TOP - 0.0225, stoolZ]);

  const places: THREE.Matrix4[] = [];
  for (let i = 0; i < TERMINALS; i++) {
    const [x, z] = onArc(i, TERM_R);
    places.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, terminalYaw(i), 0)), new THREE.Vector3(1, 1, 1)));
  }
  const out: THREE.Object3D[] = [];
  const meshes: [Parts, THREE.Material, string][] = [
    [paint, m.paint, 'bw-terminals'],
    [rust, m.rust, 'bw-terminal-iron'],
    [steel, m.steel, 'bw-terminal-rivets'],
    [plate, m.plate, 'bw-plates'],
    [screen, screenMat, SCREENS_NAME],
    [stool, m.rust, 'bw-stools'],
    [stoolWood, m.wood, 'bw-stool-seats'],
  ];
  for (const [parts, mat, name] of meshes) {
    const mesh = parts.copies(places).mesh(mat, name);
    if (mesh) out.push(mesh);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

/** The station, centred at the origin: the wheel toward −z, the terminals and their players toward +z. */
export function wheelModel(quality: Quality): THREE.Group {
  const m = materials(quality);
  const g = new THREE.Group();
  g.name = WHEEL_GROUP;
  const rotor = buildRotor(m, quality);
  rotor.position.set(0, HUB_Y, WHEEL_Z);
  g.add(rotor);
  const flapper = new Flapper(m.leather);
  g.add(flapper.mesh);
  g.userData.flapper = flapper;
  g.add(...buildFrame(m));
  const s = screens();
  g.add(...buildTerminals(m, s.mat));
  g.userData.screens = s.screens;
  return g;
}
