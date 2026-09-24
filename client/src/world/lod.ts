// Far stand-ins for the station models. Up close a table or machine is 10-50 meshes (buttons,
// chips in the rack, rails, the wheel's frets), which is right for playing and far too many draw
// calls across a whole floor. Past FAR_M (MACHINE_FAR_M for the small cabinets) each station
// swaps to a copy baked once at load:
//   - parts smaller than a few centimetres are dropped (nobody can see them from there),
//   - untextured parts are merged into one mesh coloured per vertex, and the glowing ones into
//     one more; each part keeps its own metalness and roughness per vertex too, so chrome and
//     brass still read as metal and felt as cloth. Every station's two merges go into two
//     batches for the whole floor (THREE.BatchedMesh), so all the stand-ins' plain and glowing
//     parts cost two draw calls between them, whichever stations are showing them,
//   - small textured parts (chip stacks, table signs, a reel strip) become their texture's
//     average colour and join those two merges; at that distance a chip is a few pixels,
//   - larger textured and see-through parts are merged per material, so felts, signs and glass
//     keep their own look.
// Everything is shared with the live model (materials, canvas textures), so a sign repainted up
// close is repainted far away too. The swap has a little hysteresis so it doesn't flicker at the
// boundary, and the station you're sitting at always shows the real thing.
//
// Distance alone isn't enough in the pit, where a dozen tables stand within a few metres of each
// other: the real models in view also share a draw-call budget. Nearest first, a station in view
// keeps its real model while what it costs over its stand-in still fits; the rest show their
// stand-ins until the camera comes closer.

import * as THREE from 'three';
import type { Quality } from '../render/engine3d.ts';
import type { WorldStation } from './stations.ts';

const FAR_M = 11;
const NEAR_M = 10;
/**
 * Machines (slots, video poker) are small and stand in dozens: their stand-in is plenty from
 * nearer, which keeps a floor of six slot islands inside the draw-call budget.
 */
const MACHINE_FAR_M = 8;
const MACHINE_NEAR_M = 7;
/** Parts whose bounding sphere is smaller than this (metres) are left out of the far copy. */
const TINY_M = 0.035;
/** Textured parts smaller than this (bounding sphere, metres) are drawn in their average colour. */
const SMALL_M = 0.3;
/**
 * Draw calls the real models in view may cost over their stand-ins. With it the busiest views of
 * the floor stay near 220 calls on High, leaving room under 250 for signs and dealers.
 */
export const STATION_BUDGET = 80;
/** A station already showing its real model counts as this much nearer, so the budget's edge doesn't flicker. */
const KEEP = 0.8;
/** Past this a stand-in drops its own textured parts (felts, signs, bulbs) and is only its batched shape. */
const DISTANT2 = 18 * 18;
const DISTANT_BACK2 = 17 * 17;

type Piece = {
  geo: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  start: number;
  count: number;
  /** Flat colour, for the vertex-coloured merges. */
  color?: THREE.Color;
  /** Metalness and roughness, for the lit merge. */
  pbr?: [number, number];
  /** A reel band's curvature darkening, pow(normal.z, curve), as its shader draws it (reel strips only). */
  curve?: number;
};

/** A station, its baked stand-in, and where it stands (stations never move). */
interface Entry {
  station: WorldStation;
  /** The stand-in's own meshes (textured and see-through parts); its merged parts are in the batches. */
  copy: THREE.Object3D;
  /** Its instances in the solid and glow batches (-1: none). */
  solidId: number;
  glowId: number;
  /** Pinned to its real model or its stand-in (the headless checks), or null to follow the camera. */
  pin: 'real' | 'far' | null;
  x: number;
  z: number;
  /** Squared distances: swap to the stand-in past far2, back to the model inside near2. */
  far2: number;
  near2: number;
  /** World-space bounds, for what's in view. */
  sphere: THREE.Sphere;
  /** Draw calls the real model costs over the stand-in. */
  extra: number;
  /** Per frame: squared distance, and whether the real model is wanted. */
  d2: number;
  real: boolean;
  /** In a room nobody can see from here: neither model nor stand-in is drawn. */
  off: boolean;
  /** What's showing, and whether it's far enough to leave the stand-in's own parts out. */
  state: 'real' | 'far' | 'off';
  distant: boolean;
  /** World-space box, for the doorway test. */
  box: THREE.Box3;
}

export class StationLod {
  private readonly entries: Entry[] = [];
  private readonly solid: THREE.Material;
  private readonly glow: THREE.MeshBasicMaterial;
  private readonly solidBatch: THREE.BatchedMesh | null;
  private readonly glowBatch: THREE.BatchedMesh | null;
  private readonly cam = new THREE.Vector3();
  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();
  private readonly order: Entry[] = [];
  /** Draw calls the real models in view may cost over their stand-ins (see STATION_BUDGET). */
  budget = STATION_BUDGET;

  private readonly high: boolean;

  constructor(stations: WorldStation[], quality: Quality) {
    this.high = quality === 'high';
    this.solid = this.high ? pbrMaterial() : new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.glow = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const baked = stations.map((s) => {
      const b = this.bake(s.model);
      b.copy.name = `far:${s.id}`;
      b.copy.visible = false;
      s.model.parent!.add(b.copy);
      return b;
    });
    // every stand-in's merged parts, in one batch per material beside the stations
    const parent = stations[0]?.anchor.parent ?? null;
    this.solidBatch = batch(baked.map((b) => b.solid), this.solid, 'far:solid');
    this.glowBatch = batch(baked.map((b) => b.glow), this.glow, 'far:glow');
    const toParent = new THREE.Matrix4();
    if (parent) {
      parent.updateWorldMatrix(true, false);
      toParent.copy(parent.matrixWorld).invert();
      if (this.solidBatch) parent.add(this.solidBatch);
      if (this.glowBatch) parent.add(this.glowBatch);
    }
    const at = new THREE.Vector3();
    const place = new THREE.Matrix4();
    const add = (target: THREE.BatchedMesh | null, geo: THREE.BufferGeometry | null): number => {
      if (!target || !geo) return -1;
      const id = target.addInstance(target.addGeometry(geo));
      target.setMatrixAt(id, place);
      target.setVisibleAt(id, false);
      geo.dispose();
      return id;
    };
    stations.forEach((s, i) => {
      const { copy, solid, glow } = baked[i]!;
      copy.updateWorldMatrix(true, false);
      place.multiplyMatrices(toParent, copy.matrixWorld);
      s.anchor.getWorldPosition(at);
      const machine = s.zone === 'slots' || s.zone === 'bar' || s.zone === 'online';
      const far = machine ? MACHINE_FAR_M : FAR_M;
      const near = machine ? MACHINE_NEAR_M : NEAR_M;
      const sphere = new THREE.Box3().setFromObject(s.model).getBoundingSphere(new THREE.Sphere());
      const extra = Math.max(0, meshes(s.model) - meshes(copy));
      this.entries.push({
        station: s,
        copy,
        solidId: add(this.solidBatch, solid),
        glowId: add(this.glowBatch, glow),
        pin: null,
        x: at.x,
        z: at.z,
        far2: far * far,
        near2: near * near,
        sphere,
        extra,
        d2: 0,
        real: true,
        off: false,
        state: 'real',
        distant: false,
        box: new THREE.Box3().setFromObject(s.model),
      });
    });
  }

  /**
   * Hold a station on its real model or its stand-in, or let it follow the camera again (null).
   * Takes effect at once. For the headless checks, which compare the two.
   */
  pin(stationId: string, mode: 'real' | 'far' | null): void {
    const e = this.entries.find((x) => x.station.id === stationId);
    if (!e) return;
    e.pin = mode;
    if (mode) this.set(e, mode);
  }

  /**
   * Show the real model near the camera and the stand-in further away, within the budget. In a
   * room that can't be seen (`rooms`, from visibility.ts), or outside the doorway it's seen
   * through (`sees`), neither.
   */
  update(camera: THREE.Camera, seated: WorldStation | null, rooms: Set<string> | null = null, sees: ((room: string, box: THREE.Box3) => boolean) | null = null): void {
    camera.updateMatrixWorld();
    camera.getWorldPosition(this.cam);
    this.frustum.setFromProjectionMatrix(this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const order = this.order;
    order.length = 0;
    for (const e of this.entries) {
      const free = e.station !== seated && !e.pin;
      e.off = free && !!rooms && (!rooms.has(e.station.room) || (!!sees && !sees(e.station.room, e.box)));
      if (e.off) continue;
      e.d2 = (e.x - this.cam.x) ** 2 + (e.z - this.cam.z) ** 2;
      // near enough by distance (with hysteresis), and in view: it competes for the budget
      e.real = e.station === seated || (e.state === 'real' ? e.d2 <= e.far2 : e.d2 <= e.near2);
      if (e.pin) e.real = e.pin === 'real';
      else if (e.real && e.station !== seated && this.frustum.intersectsSphere(e.sphere)) order.push(e);
      // far off, the stand-in's own textured parts go too (its shape and colours stay in the batches)
      e.distant = !e.pin && (e.distant ? e.d2 > DISTANT_BACK2 : e.d2 > DISTANT2);
    }
    // nearest first (the ones already real a little nearer still), each while it fits; the table
    // you're sitting at is paid for first
    order.sort((a, b) => rank(a) - rank(b));
    let spent = seated ? (this.entries.find((e) => e.station === seated)?.extra ?? 0) : 0;
    for (const e of order) {
      spent += e.extra;
      if (spent > this.budget) e.real = false;
    }
    for (const e of this.entries) this.set(e, e.off ? 'off' : e.real ? 'real' : 'far');
  }

  /** Real model, stand-in (with its own parts unless distant) or nothing. */
  private set(e: Entry, state: 'real' | 'far' | 'off'): void {
    const own = state === 'far' && !e.distant;
    if (e.state === state && e.copy.visible === own) return;
    const was = e.state;
    e.state = state;
    e.station.model.visible = state === 'real';
    e.copy.visible = own;
    if (was === state) return;
    const far = state === 'far';
    if (e.solidId >= 0) this.solidBatch!.setVisibleAt(e.solidId, far);
    if (e.glowId >= 0) this.glowBatch!.setVisibleAt(e.glowId, far);
  }

  dispose(): void {
    for (const { copy } of this.entries) {
      copy.traverse((o) => {
        if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) o.geometry.dispose();
      });
      copy.removeFromParent();
    }
    for (const b of [this.solidBatch, this.glowBatch]) {
      b?.dispose();
      b?.removeFromParent();
    }
    this.solid.dispose();
    this.glow.dispose();
  }

  /** A station's stand-in: its own meshes, and its merged plain and glowing parts for the batches. */
  private bake(model: THREE.Object3D): { copy: THREE.Object3D; solid: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null } {
    const out = new THREE.Group();
    // The copy sits beside the model under the same anchor, so pieces are placed in the model's
    // parent's frame.
    out.position.copy(model.position);
    out.quaternion.copy(model.quaternion);
    out.scale.copy(model.scale);
    model.updateWorldMatrix(true, true);
    const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert();

    const solid: Piece[] = [];
    const glow: Piece[] = [];
    // A lit part's colour, metalness and roughness. On Low the stand-in is Lambert, which can't
    // show metal; darkening it a little by its metalness keeps chrome from reading as white.
    const lit = (m: THREE.MeshStandardMaterial, color: THREE.Color): { color: THREE.Color; pbr: [number, number] } => {
      const metal = m.isMeshStandardMaterial ? m.metalness : 0;
      const rough = m.isMeshStandardMaterial ? m.roughness : 0.8;
      if (!this.high) color.multiplyScalar(1 - 0.55 * metal);
      return { color, pbr: [metal, rough] };
    };
    const byMaterial = new Map<THREE.Material, Piece[]>();

    model.traverseVisible((o) => {
      if (!(o instanceof THREE.Mesh) || o instanceof THREE.SkinnedMesh) return;
      const geo = o.geometry as THREE.BufferGeometry;
      if (!geo.attributes.position) return;
      // An instanced mesh is measured across all its instances (a ring of bulbs, not one bulb).
      const holder = o instanceof THREE.InstancedMesh ? o : geo;
      if (!holder.boundingSphere) holder.computeBoundingSphere();
      const radius = holder.boundingSphere!.radius * o.matrixWorld.getMaxScaleOnAxis();
      if (radius < TINY_M) return;
      const matrix = new THREE.Matrix4().multiplyMatrices(toModel, o.matrixWorld);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const total0 = geo.index ? geo.index.count : geo.attributes.position.count;
      // A small custom-shaded part drawing a texture (a reel strip behind its glass): lit, in the
      // strip's average colour, darkening toward the band's top and bottom as the reel shader does.
      const sm = mats[0];
      if (!(o instanceof THREE.InstancedMesh) && mats.length === 1 && sm instanceof THREE.ShaderMaterial && radius < SMALL_M && !Object.keys(geo.morphAttributes).length) {
        const avg = averageColor(sm.uniforms.map?.value);
        if (avg) {
          const tint = sm.uniforms.uTint?.value;
          if (tint instanceof THREE.Color) avg.multiply(tint);
          const bright = sm.uniforms.uBright?.value;
          avg.multiplyScalar(typeof bright === 'number' ? bright : Array.isArray(bright) ? (bright[0] ?? 1) : 1);
          const curve = sm.uniforms.uCurve?.value;
          glow.push({ geo, matrix, start: 0, count: total0, color: avg, curve: typeof curve === 'number' ? curve : undefined });
          return;
        }
      }
      if (o instanceof THREE.InstancedMesh) {
        // Already one draw call; share it as it is, clock and all (bulbs that chase).
        const inst = new THREE.InstancedMesh(o.geometry, o.material, o.count);
        inst.instanceMatrix = o.instanceMatrix;
        if (o.instanceColor) inst.instanceColor = o.instanceColor;
        inst.onBeforeRender = o.onBeforeRender;
        matrix.decompose(inst.position, inst.quaternion, inst.scale);
        out.add(inst);
        return;
      }
      // Custom shaders and per-vertex colours need attributes a merge would drop: keep those
      // parts whole (sharing geometry and material), one draw call each as before.
      if (mats.some((m) => m instanceof THREE.ShaderMaterial || (m as THREE.MeshStandardMaterial).vertexColors) || Object.keys(geo.morphAttributes).length) {
        const whole = new THREE.Mesh(geo, o.material);
        matrix.decompose(whole.position, whole.quaternion, whole.scale);
        whole.renderOrder = o.renderOrder;
        out.add(whole);
        return;
      }
      const total = geo.index ? geo.index.count : geo.attributes.position.count;
      const groups = Array.isArray(o.material) && geo.groups.length ? geo.groups : [{ start: 0, count: total, materialIndex: 0 }];
      for (const g of groups) {
        const mat = mats[g.materialIndex ?? 0];
        if (!mat || !mat.visible) continue;
        const piece: Piece = { geo, matrix, start: g.start, count: Math.min(g.count, total - g.start) };
        const m = mat as THREE.MeshStandardMaterial;
        const textured = !!(m.map || m.emissiveMap || m.alphaMap);
        const clear = m.transparent || m.opacity < 1 || m.alphaTest > 0;
        if (textured && !clear && radius < SMALL_M && m.map && !m.emissiveMap && !m.alphaMap && m.color) {
          const avg = averageColor(m.map);
          if (avg) {
            avg.multiply(m.color);
            // unlit parts (a screen, a lit panel) stay lit
            if ((m as THREE.Material as THREE.MeshBasicMaterial).isMeshBasicMaterial) glow.push({ ...piece, color: avg });
            else solid.push({ ...piece, ...lit(m, avg) });
            continue;
          }
        }
        if (textured || clear || !m.color) {
          const list = byMaterial.get(mat) ?? [];
          list.push(piece);
          byMaterial.set(mat, list);
          continue;
        }
        const e = m.emissive;
        const glowing = e && m.emissiveIntensity > 0 && e.r + e.g + e.b > 0.05;
        if (glowing) glow.push({ ...piece, color: e.clone().multiplyScalar(m.emissiveIntensity).add(m.color.clone().multiplyScalar(0.15)) });
        else solid.push({ ...piece, ...lit(m, m.color.clone()) });
      }
    });

    for (const [mat, pieces] of byMaterial) {
      const mesh = new THREE.Mesh(merge(pieces, 'uv'), mat);
      // A see-through part drawn after the solid ones, as it would be in the live model.
      mesh.renderOrder = mat.transparent ? 1 : 0;
      out.add(mesh);
    }
    return { copy: out, solid: solid.length ? merge(solid, 'color', this.high) : null, glow: glow.length ? merge(glow, 'color') : null };
  }
}

/** One batch holding all these geometries (their instances are added by the caller), or null for none. */
function batch(geos: (THREE.BufferGeometry | null)[], material: THREE.Material, name: string): THREE.BatchedMesh | null {
  const list = geos.filter((g): g is THREE.BufferGeometry => g !== null);
  if (list.length === 0) return null;
  const vertices = list.reduce((n, g) => n + g.attributes.position!.count, 0);
  const indices = list.reduce((n, g) => n + (g.index?.count ?? 0), 0);
  const b = new THREE.BatchedMesh(list.length, vertices, indices, material);
  b.name = name;
  return b;
}

/** Where an entry stands in the budget's queue: its distance, less for one already real. */
function rank(e: Entry): number {
  return e.state === 'real' ? e.d2 * KEEP * KEEP : e.d2;
}

/**
 * How many draw calls an object makes at most when shown: one per visible mesh, or one per group
 * for a mesh of several materials. The object's own visibility doesn't matter (a hidden stand-in).
 */
function meshes(o: THREE.Object3D): number {
  let n = 0;
  const count = (m: THREE.Object3D) => {
    const mesh = m as THREE.Mesh;
    if (!mesh.isMesh) return;
    n += Array.isArray(mesh.material) ? Math.max(1, mesh.geometry.groups.filter((g) => (mesh.material as THREE.Material[])[g.materialIndex ?? 0]?.visible).length) : 1;
  };
  count(o);
  for (const child of o.children) child.traverseVisible(count);
  return n;
}

/**
 * The lit stand-ins' material: vertex colours, and metalness and roughness from a per-vertex
 * `pbr` attribute in place of the material's single values, so one draw call carries brass,
 * chrome, wood and felt each with its own finish.
 */
function pbrMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 pbr;\nvarying vec2 vPbr;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPbr = pbr;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPbr;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPbr.y;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.x;');
  };
  m.customProgramCacheKey = () => 'station-lod-pbr';
  return m;
}

/**
 * One indexed geometry from many pieces, positions and normals moved into the model's frame.
 * `extra` is a per-piece colour (the vertex-coloured merges) or the pieces' own UVs; `pbr` adds
 * each piece's metalness and roughness.
 */
function merge(pieces: Piece[], extra: 'color' | 'uv', pbr = false): THREE.BufferGeometry {
  let vertices = 0;
  let indices = 0;
  const ranges = pieces.map((p) => {
    const pos = p.geo.attributes.position!;
    const index = p.geo.index;
    // The vertices this piece's triangles use: its whole vertex buffer when indexed (index
    // values can point anywhere), or just its range when not.
    const v0 = index ? 0 : p.start;
    const vn = index ? pos.count : p.count;
    vertices += vn;
    indices += p.count;
    return { v0, vn };
  });
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const second = new Float32Array(vertices * (extra === 'color' ? 3 : 2));
  const finish = pbr ? new Float32Array(vertices * 2) : null;
  const index = new Uint32Array(indices);
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  let vo = 0;
  let io = 0;
  pieces.forEach((p, i) => {
    const { v0, vn } = ranges[i]!;
    const pos = p.geo.attributes.position!;
    // Normals for a part that has none are worked out on a copy: the live model's geometry is
    // shared and stays as it is.
    const nrm = p.geo.attributes.normal ?? withNormals(p.geo).attributes.normal!;
    const uv = p.geo.attributes.uv;
    nm.getNormalMatrix(p.matrix);
    for (let k = 0; k < vn; k++) {
      const o3 = (vo + k) * 3;
      v.fromBufferAttribute(pos, v0 + k).applyMatrix4(p.matrix);
      position[o3] = v.x;
      position[o3 + 1] = v.y;
      position[o3 + 2] = v.z;
      v.fromBufferAttribute(nrm, v0 + k).applyMatrix3(nm).normalize();
      normal[o3] = v.x;
      normal[o3 + 1] = v.y;
      normal[o3 + 2] = v.z;
      if (extra === 'color') {
        const c = p.color!;
        // the shader's shade uses the band's own normal, before any transform
        const sh = p.curve === undefined ? 1 : Math.pow(Math.max(nrm.getZ(v0 + k), 0), p.curve);
        second[o3] = c.r * sh;
        second[o3 + 1] = c.g * sh;
        second[o3 + 2] = c.b * sh;
        if (finish) {
          finish[(vo + k) * 2] = p.pbr?.[0] ?? 0;
          finish[(vo + k) * 2 + 1] = p.pbr?.[1] ?? 0.8;
        }
      } else if (uv) {
        const o2 = (vo + k) * 2;
        second[o2] = uv.getX(v0 + k);
        second[o2 + 1] = uv.getY(v0 + k);
      }
    }
    if (p.geo.index) {
      const src = p.geo.index;
      for (let k = 0; k < p.count; k++) index[io + k] = src.getX(p.start + k) + vo;
    } else {
      for (let k = 0; k < p.count; k++) index[io + k] = vo + k;
    }
    vo += vn;
    io += p.count;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute(extra, new THREE.BufferAttribute(second, extra === 'color' ? 3 : 2));
  if (finish) g.setAttribute('pbr', new THREE.BufferAttribute(finish, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

const averages = new WeakMap<THREE.Texture, THREE.Color | null>();
let sampler: CanvasRenderingContext2D | null | undefined;

/**
 * A texture's average colour (linear), from an 8x8 downscale of its image; null for images a
 * canvas can't draw (compressed or data textures). Worked out once per texture.
 */
function averageColor(tex: unknown): THREE.Color | null {
  if (!(tex instanceof THREE.Texture)) return null;
  if (averages.has(tex)) return averages.get(tex)?.clone() ?? null;
  let out: THREE.Color | null = null;
  const img = tex.image as CanvasImageSource | undefined;
  // not loaded yet: no answer this time, but don't remember that
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement && !(img.complete && img.naturalWidth > 0)) return null;
  const drawable = typeof HTMLCanvasElement !== 'undefined' && (img instanceof HTMLCanvasElement || img instanceof HTMLImageElement || img instanceof ImageBitmap || (typeof OffscreenCanvas !== 'undefined' && img instanceof OffscreenCanvas));
  if (drawable) {
    if (sampler === undefined) {
      const c = document.createElement('canvas');
      c.width = c.height = 8;
      sampler = c.getContext('2d', { willReadFrequently: true });
    }
    try {
      if (sampler) {
        sampler.clearRect(0, 0, 8, 8);
        sampler.drawImage(img!, 0, 0, 8, 8);
        const px = sampler.getImageData(0, 0, 8, 8).data;
        const c = new THREE.Color();
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let i = 0; i < px.length; i += 4) {
          const a = px[i + 3]! / 255;
          if (a < 0.05) continue;
          c.setRGB(px[i]! / 255, px[i + 1]! / 255, px[i + 2]! / 255, tex.colorSpace === THREE.SRGBColorSpace ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace);
          r += c.r * a;
          g += c.g * a;
          b += c.b * a;
          n += a;
        }
        if (n > 0) out = new THREE.Color(r / n, g / n, b / n);
      }
    } catch {
      out = null; // an image from elsewhere, or not decoded yet
    }
  }
  averages.set(tex, out);
  return out?.clone() ?? null;
}

function withNormals(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const copy = geo.clone();
  copy.computeVertexNormals();
  return copy;
}
