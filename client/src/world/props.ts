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

const FILES: Record<Exclude<PropKind, 'chandelier'>, { file: string; fit: 'height' | 'length' }> = {
  stool: { file: 'stool.glb', fit: 'height' },
  couch: { file: 'couch.glb', fit: 'length' },
  palm: { file: 'palm.glb', fit: 'height' },
  'plant-a': { file: 'plant-a.glb', fit: 'height' },
  'plant-b': { file: 'plant-b.glb', fit: 'height' },
  'lamp-floor': { file: 'lamp-floor.glb', fit: 'height' },
  'bottle-tall': { file: 'bottle-tall.glb', fit: 'height' },
  'bottle-red': { file: 'bottle-red.glb', fit: 'height' },
  'bottle-white': { file: 'bottle-white.glb', fit: 'height' },
  'glass-cocktail': { file: 'glass-cocktail.glb', fit: 'height' },
  door: { file: 'door.glb', fit: 'height' },
};

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
  private readonly sparkleUniforms = { uTime: { value: 0 }, uScale: { value: 400 }, uColor: { value: hdr('#fff1d6', 3.4) } };
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
          const { parts, size, min } = await this.load(spec.file);
          const len = spec.fit === 'height' ? size.y : Math.max(size.x, size.z);
          const mats = list.map((p) => {
            const s = p.size / len;
            // stand the model on its base, centred on the spot
            return new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(_up, p.ry), new THREE.Vector3(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-(min.x + size.x / 2), -min.y, -(min.z + size.z / 2)));
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

  private cache = new Map<string, Promise<{ parts: Part[]; size: THREE.Vector3; min: THREE.Vector3 }>>();

  private load(file: string): Promise<{ parts: Part[]; size: THREE.Vector3; min: THREE.Vector3 }> {
    let p = this.cache.get(file);
    if (!p) {
      p = this.loader.loadAsync(MODEL_BASE + file).then((gltf) => {
        const parts: Part[] = [];
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const src = mesh.material as THREE.MeshStandardMaterial;
          const glow = GLOWS[src.name];
          const material = glow ? new THREE.MeshBasicMaterial({ color: glow, map: src.map }) : src;
          material.name = src.name;
          parts.push({ geometry: mesh.geometry, material, matrix: mesh.matrixWorld.clone() });
        });
        const box = new THREE.Box3().setFromObject(gltf.scene);
        return { parts, size: box.getSize(new THREE.Vector3()), min: box.min.clone() };
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

const GLINT_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uScale;
attribute float aPhase;
attribute float aSpeed;
varying float vGlint;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // mostly dark, now and then a sharp flash
  vGlint = pow(max(sin(uTime * aSpeed + aPhase), 0.0), 28.0);
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
