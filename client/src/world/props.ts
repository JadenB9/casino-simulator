// Loose props from GLB files (palms, plants, stools, couches, bottles, glasses, lamps, doors,
// chandeliers), scaled to a real size and drawn instanced: one draw call per mesh part of each
// prop, however many stand on the floor. Chandeliers are the Quaternius piece on Low and a Poly
// Haven hero chandelier on High (loaded only when High is on), where their crystal and brass
// catch the light now and then: brief glints, all of them one point cloud and one draw call.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Quality } from '../render/engine3d.ts';
import type { PropKind, PropPlace } from './decor.ts';
import type { Chandelier } from './room.ts';
import { hdr } from './materials.ts';
import { MODEL_BASE } from './characters.ts';
import { modelBytes } from '../render/model-bytes.ts';
import { calmUniform } from '../app/comfort.ts';

/**
 * Each prop's file and what its size measures. `foot`: stood on the middle of its foot (a palm's
 * trunk, a plant's own pot) rather than the middle of its whole spread: a palm's fronds reach
 * further one way than the other, and centred on them its trunk came out at the planter's edge.
 * `upright`: tipped about its foot so its trunk stands straight up out of the pot (the palm's
 * leans a few degrees).
 */
const FILES: Record<Exclude<PropKind, 'chandelier'>, { file: string; fit: 'height' | 'length'; foot?: boolean; upright?: boolean }> = {
  stool: { file: 'stool.glb', fit: 'height' },
  couch: { file: 'couch.glb', fit: 'length' },
  palm: { file: 'palm.glb', fit: 'height', foot: true, upright: true },
  'plant-a': { file: 'plant-a.glb', fit: 'height', foot: true },
  'plant-b': { file: 'plant-b.glb', fit: 'height', foot: true },
  'lamp-floor': { file: 'lamp-floor.glb', fit: 'height' },
  'bottle-tall': { file: 'bottle-tall.glb', fit: 'height' },
  'bottle-red': { file: 'bottle-red.glb', fit: 'height' },
  'bottle-white': { file: 'bottle-white.glb', fit: 'height' },
  'glass-cocktail': { file: 'glass-cocktail.glb', fit: 'height' },
  door: { file: 'door.glb', fit: 'height' },
};

/**
 * Parts drawn right on another part's surface (a bottle's label on its glass): pushed out this
 * much across their long axis, so the two never share a plane and flicker.
 */
const PROUD: Record<string, number> = { LightBrown: 1.02 };

/**
 * Models whose colours are toned down under the floor's warm light: the palm's atlas is a toy's
 * lime and tan, multiplied here toward a real potted palm's deeper green and bark.
 */
const TINT: Record<string, string> = { 'palm.glb': '#b4c09a' };

/** Materials that should glow: lamp shades and bulbs. */
const GLOWS: Record<string, THREE.Color> = {
  Light: hdr('#ffe2b0', 2.4),
  Chandelier_02_bulb: hdr('#ffe6c0', 3.2),
};

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
}

/** One kind's instanced meshes (a mesh per part), where each piece stands and in which room. */
interface Set {
  meshes: THREE.InstancedMesh[];
  parts: Part[];
  at: THREE.Matrix4[];
  rooms: string[];
}

export class Props {
  readonly group = new THREE.Group();
  private loader = new GLTFLoader();
  private highChandeliers: THREE.Object3D | null = null;
  private sparkle: THREE.Points | null = null;
  private readonly sparkleUniforms = { uTime: { value: 0 }, uScale: { value: 400 }, uColor: { value: hdr('#fff1d6', 3.4) }, uCalm: calmUniform };
  private lowChandeliers: THREE.Object3D | null = null;
  private lambert = new Map<THREE.Material, THREE.Material>();
  private standard = new Map<THREE.Material, THREE.Material>();
  private quality: Quality;
  private readonly sets: Set[] = [];
  private visible: globalThis.Set<string> | null = null;

  constructor(quality: Quality) {
    this.group.name = 'props';
    this.quality = quality;
  }

  async build(places: PropPlace[], chandeliers: Chandelier[]): Promise<void> {
    const byKind = new Map<PropKind, PropPlace[]>();
    for (const p of places) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p]);
    await Promise.all(
      [...byKind].map(async ([kind, list]) => {
        if (kind === 'chandelier') return;
        const spec = FILES[kind];
        try {
          const { parts, size, min, foot } = await this.load(spec.file);
          // stand the model on its base, centred on the spot (by its foot, or its bounds), and
          // tipped upright about its foot (then measured again, stood up)
          const cx = spec.foot ? foot.x : min.x + size.x / 2;
          const cz = spec.foot ? foot.y : min.z + size.z / 2;
          let local = new THREE.Matrix4().makeTranslation(-cx, -min.y, -cz);
          let height = size.y;
          if (spec.upright) {
            local = upright(parts, foot, min.y, size.y).multiply(local);
            const [y0, y1] = heightOf(parts, local);
            local.premultiply(new THREE.Matrix4().makeTranslation(0, -y0, 0));
            height = y1 - y0;
          }
          const len = spec.fit === 'height' ? height : Math.max(size.x, size.z);
          const mats = list.map((p) => {
            const s = p.size / len;
            return new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(_up, p.ry), new THREE.Vector3(s, s, s)).multiply(local);
          });
          this.group.add(this.instance(kind, parts, mats, list.map((p) => p.room)));
        } catch (err) {
          console.warn(`prop ${kind} failed to load`, err);
        }
      }),
    );
    this.chandelierSpots = chandeliers;
    await this.chandeliers(this.quality);
  }

  private chandelierSpots: Chandelier[] = [];

  /** Hang chandeliers (top at each spot) for this quality, loading the High piece on first use. */
  private async chandeliers(q: Quality): Promise<void> {
    const spots = this.chandelierSpots;
    if (spots.length === 0) return;
    const make = async (file: string, scale: number) => {
      const { parts, size, min } = await this.load(file);
      const mats = spots.map((p) => {
        const s = (p.size * scale) / size.y;
        return new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-(min.x + size.x / 2), -(min.y + size.y), -(min.z + size.z / 2)));
      });
      return this.instance(`chandelier:${file}`, parts, mats, spots.map((p) => p.room));
    };
    try {
      if (q === 'high' && !this.highChandeliers) {
        this.highChandeliers = await make('chandelier-high.glb', 1);
        this.group.add(this.highChandeliers);
        this.sparkle = this.glints(this.highChandeliers);
        if (this.sparkle) this.group.add(this.sparkle);
      }
      if (q === 'low' && !this.lowChandeliers) {
        this.lowChandeliers = await make('chandelier-low.glb', 0.95 / 1.5);
        this.group.add(this.lowChandeliers);
      }
    } catch (err) {
      console.warn('chandelier failed to load', err);
    }
    if (this.highChandeliers) this.highChandeliers.visible = q === 'high';
    if (this.sparkle) this.sparkle.visible = q === 'high';
    if (this.lowChandeliers) this.lowChandeliers.visible = q === 'low' || !this.highChandeliers;
  }

  /** Per frame: the glints' clock. */
  update(dt: number): void {
    this.sparkleUniforms.uTime.value += dt;
  }

  /** Hide or show the glints (they'd be stray dots in the floor's reflection capture). */
  set glinting(on: boolean) {
    if (this.sparkle) this.sparkle.visible = on && this.quality === 'high';
  }

  /**
   * Glints on the chandeliers: points scattered over each one's arms and drops (a seeded pick of
   * its own vertices), each flashing briefly at its own moment and rate. Additive and past the
   * bloom threshold at their peak, so a flash blooms a little and is gone.
   */
  private glints(chandeliers: THREE.Object3D): THREE.Points | null {
    const bodies = chandeliers.children.filter((c): c is THREE.InstancedMesh => (c as THREE.InstancedMesh).isInstancedMesh && !(c.userData.source as THREE.Material | undefined)?.name?.endsWith('bulb'));
    const body = bodies[0];
    if (!body) return null;
    const pos = body.geometry.attributes.position!;
    const PER = 40;
    let seed = 20260923;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const points: number[] = [];
    const phase: number[] = [];
    const speed: number[] = [];
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    for (let i = 0; i < body.count; i++) {
      body.getMatrixAt(i, m);
      for (let k = 0; k < PER; k++) {
        v.fromBufferAttribute(pos, Math.floor(rnd() * pos.count)).applyMatrix4(m);
        points.push(v.x, v.y, v.z);
        phase.push(rnd() * Math.PI * 2);
        speed.push(0.7 + rnd() * 1.6);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    g.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
    g.setAttribute('aSpeed', new THREE.Float32BufferAttribute(speed, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: this.sparkleUniforms,
      vertexShader: GLINT_VERTEX,
      fragmentShader: GLINT_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const cloud = new THREE.Points(g, material);
    cloud.name = 'chandelier-glints';
    cloud.frustumCulled = false;
    // points are sized in pixels: the viewport's height over the view's height at one metre
    const size = new THREE.Vector2();
    cloud.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getDrawingBufferSize(size);
      const fov = (camera as THREE.PerspectiveCamera).fov ?? 55;
      this.sparkleUniforms.uScale.value = size.y / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    };
    return cloud;
  }

  async setQuality(q: Quality): Promise<void> {
    if (q === this.quality) return;
    this.quality = q;
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = this.materialFor(mesh.userData.source as THREE.Material, q);
    });
    await this.chandeliers(q);
  }

  private instance(name: string, parts: Part[], at: THREE.Matrix4[], rooms: string[]): THREE.Group {
    const g = new THREE.Group();
    g.name = `prop:${name}`;
    const meshes: THREE.InstancedMesh[] = [];
    for (const part of parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, this.materialFor(part.material, this.quality), at.length);
      mesh.userData.source = part.material;
      g.add(mesh);
      meshes.push(mesh);
    }
    const set: Set = { meshes, parts, at, rooms };
    this.sets.push(set);
    this.fill(set);
    return g;
  }

  /** Draw only the props standing in these rooms (null: all of them). */
  setRooms(rooms: globalThis.Set<string> | null): void {
    this.visible = rooms;
    for (const set of this.sets) this.fill(set);
  }

  /** Write the instances of the rooms on show, packed at the front. */
  private fill(set: Set): void {
    const m = new THREE.Matrix4();
    set.meshes.forEach((mesh, k) => {
      const part = set.parts[k]!;
      let n = 0;
      set.at.forEach((a, i) => {
        if (this.visible && !this.visible.has(set.rooms[i]!)) return;
        mesh.setMatrixAt(n++, m.multiplyMatrices(a, part.matrix));
      });
      mesh.count = n;
      mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  }

  private cache = new Map<string, Promise<{ parts: Part[]; size: THREE.Vector3; min: THREE.Vector3; foot: THREE.Vector2 }>>();

  private load(file: string): Promise<{ parts: Part[]; size: THREE.Vector3; min: THREE.Vector3; foot: THREE.Vector2 }> {
    let p = this.cache.get(file);
    if (!p) {
      p = modelBytes(MODEL_BASE + file).then((bytes) => this.loader.parseAsync(bytes, MODEL_BASE)).then((gltf) => {
        const parts: Part[] = [];
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const src = mesh.material as THREE.MeshStandardMaterial;
          const glow = GLOWS[src.name];
          // a bulb sits in its cup and a label on its glass: drawn pulled toward the eye as well, so
          // where their edges still touch the part under them it never shows through
          const decal = glow || (PROUD[src.name] && file.startsWith('bottle'));
          const tint = TINT[file];
          const material = glow ? new THREE.MeshBasicMaterial({ color: glow, map: src.map }) : decal || tint ? src.clone() : src;
          if (tint) (material as THREE.MeshStandardMaterial).color.multiply(new THREE.Color(tint));
          if (decal) Object.assign(material, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
          material.name = src.name;
          parts.push({ geometry: PROUD[src.name] && file.startsWith('bottle') ? proud(mesh.geometry, PROUD[src.name]!) : mesh.geometry, material, matrix: mesh.matrixWorld.clone() });
        });
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3());
        return { parts, size, min: box.min.clone(), foot: footOf(parts, box.min.y, size.y) };
      });
      this.cache.set(file, p);
    }
    return p;
  }

  /** Standard materials on High; the same colours and maps in Lambert on Low. */
  private materialFor(src: THREE.Material, q: Quality): THREE.Material {
    const std = src as THREE.MeshStandardMaterial;
    if (!std.isMeshStandardMaterial) return src;
    if (q === 'high') {
      let m = this.standard.get(src);
      if (!m) {
        // GLB props come in shiny; cloth, plants and wood want a matte finish
        const c = std.clone();
        c.metalness = Math.min(c.metalness, 0.2);
        c.roughness = Math.max(c.roughness, 0.55);
        m = c;
        this.standard.set(src, m);
      }
      return m;
    }
    let m = this.lambert.get(src);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: std.color, map: std.map, transparent: std.transparent, opacity: std.opacity, alphaTest: std.alphaTest, side: std.side });
      m.name = src.name;
      this.lambert.set(src, m);
    }
    return m;
  }
}

const _up = new THREE.Vector3(0, 1, 0);

/**
 * The middle of a model's foot (x, z): the bounds of everything in the lowest 3% of its height.
 * layout.ts's LEAVES are measured from the same point.
 */
export function footOf(parts: readonly { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[], y0: number, h: number): THREE.Vector2 {
  const v = new THREE.Vector3();
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const p of parts) {
    const pos = p.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(p.matrix);
      if (v.y > y0 + h * 0.03) continue;
      x0 = Math.min(x0, v.x);
      x1 = Math.max(x1, v.x);
      z0 = Math.min(z0, v.z);
      z1 = Math.max(z1, v.z);
    }
  }
  return x0 <= x1 ? new THREE.Vector2((x0 + x1) / 2, (z0 + z1) / 2) : new THREE.Vector2();
}

/**
 * The turn about a model's foot (its foot at the origin) that stands its trunk up straight: the
 * trunk followed up from the foot in slices to 60% of the height, and the line from the foot to
 * the last slice's middle turned to vertical.
 */
export function upright(parts: readonly { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[], foot: THREE.Vector2, y0: number, h: number): THREE.Matrix4 {
  const pts: THREE.Vector3[] = [];
  for (const p of parts) {
    const pos = p.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(p.matrix));
  }
  // the foot's reach, then each slice's middle near the last one's
  let r = 0;
  for (const v of pts) if (v.y <= y0 + h * 0.03) r = Math.max(r, Math.hypot(v.x - foot.x, v.z - foot.y));
  let cx = foot.x;
  let cz = foot.y;
  let top = 0;
  for (let t = 0.05; t <= 0.6 + 1e-9; t += 0.05) {
    const ys = y0 + t * h;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const v of pts) {
      if (Math.abs(v.y - ys) > h * 0.025 || Math.hypot(v.x - cx, v.z - cz) > r * 1.6) continue;
      x0 = Math.min(x0, v.x);
      x1 = Math.max(x1, v.x);
      z0 = Math.min(z0, v.z);
      z1 = Math.max(z1, v.z);
    }
    if (x0 > x1) continue;
    cx = (x0 + x1) / 2;
    cz = (z0 + z1) / 2;
    top = t * h;
  }
  if (top <= 0) return new THREE.Matrix4();
  const lean = new THREE.Vector3(cx - foot.x, top, cz - foot.y).normalize();
  return new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(lean, _up));
}

/** The lowest and highest point of a model's parts placed by `m`. */
function heightOf(parts: readonly { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[], m: THREE.Matrix4): [number, number] {
  const v = new THREE.Vector3();
  const w = new THREE.Matrix4();
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of parts) {
    w.multiplyMatrices(m, p.matrix);
    const pos = p.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(w);
      y0 = Math.min(y0, v.y);
      y1 = Math.max(y1, v.y);
    }
  }
  return [y0, y1];
}

/** A copy of a part scaled by k about its middle across its two short axes (its long one kept). */
function proud(g: THREE.BufferGeometry, k: number): THREE.BufferGeometry {
  const out = g.clone();
  out.computeBoundingBox();
  const box = out.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const long = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
  const s = new THREE.Vector3(k, k, k);
  s[long] = 1;
  out.translate(-c.x, -c.y, -c.z).scale(s.x, s.y, s.z).translate(c.x, c.y, c.z);
  return out;
}

const GLINT_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uScale;
uniform float uCalm;
attribute float aPhase;
attribute float aSpeed;
varying float vGlint;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // mostly dark, now and then a sharp flash; calm (app/comfort.ts): a slow, soft shimmer instead
  float at = uTime * aSpeed + aPhase;
  vGlint = mix(pow(max(sin(at), 0.0), 28.0), 0.35 * pow(max(sin(at / 3.0), 0.0), 6.0), uCalm);
  gl_PointSize = max(1.0, 0.075 * uScale / -mv.z) * (0.35 + 0.65 * vGlint);
  gl_Position = projectionMatrix * mv;
}`;

const GLINT_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vGlint;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float core = smoothstep(0.5, 0.0, length(p));
  // a four-pointed star: two thin crossed streaks through a soft core
  float star = max(0.0, 1.0 - abs(p.x) * 10.0) * max(0.0, 1.0 - abs(p.y) * 2.1) + max(0.0, 1.0 - abs(p.y) * 10.0) * max(0.0, 1.0 - abs(p.x) * 2.1);
  float a = (core * core * 0.8 + star * 0.7) * vGlint;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
