// Far stand-ins for the station models. Up close a table or machine is 10-50 meshes (buttons,
// chips in the rack, rails, the wheel's frets), which is right for playing and far too many draw
// calls across a whole floor. Past FAR_M each station swaps to a copy baked once at load:
//   - parts smaller than a few centimetres are dropped (nobody can see them from there),
//   - untextured parts are merged into one mesh coloured per vertex, and the glowing ones into
//     one more, so they cost two draw calls however many parts they came from,
//   - small textured parts (chip stacks, table signs, a reel strip) become their texture's
//     average colour and join those two merges; at that distance a chip is a few pixels,
//   - larger textured and see-through parts are merged per material, so felts, signs and glass
//     keep their own look.
// Everything is shared with the live model (materials, canvas textures), so a sign repainted up
// close is repainted far away too. The swap has a little hysteresis so it doesn't flicker at the
// boundary, and the station you're sitting at always shows the real thing.

import * as THREE from 'three';
import type { Quality } from '../render/engine3d.ts';
import type { WorldStation } from './stations.ts';

const FAR_M = 11;
const NEAR_M = 10;
/** Parts whose bounding sphere is smaller than this (metres) are left out of the far copy. */
const TINY_M = 0.035;
/** Textured parts smaller than this (bounding sphere, metres) are drawn in their average colour. */
const SMALL_M = 0.3;

type Piece = { geo: THREE.BufferGeometry; matrix: THREE.Matrix4; start: number; count: number };

/** A station, its baked stand-in, and where it stands (stations never move). */
interface Entry {
  station: WorldStation;
  copy: THREE.Object3D;
  x: number;
  z: number;
}

export class StationLod {
  private readonly entries: Entry[] = [];
  private readonly solid: THREE.Material;
  private readonly glow: THREE.MeshBasicMaterial;
  private readonly cam = new THREE.Vector3();

  constructor(stations: WorldStation[], quality: Quality) {
    this.solid =
      quality === 'high'
        ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.18, side: THREE.DoubleSide })
        : new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.glow = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const at = new THREE.Vector3();
    for (const s of stations) {
      const copy = this.bake(s.model);
      copy.name = `far:${s.id}`;
      copy.visible = false;
      s.model.parent!.add(copy);
      s.anchor.getWorldPosition(at);
      this.entries.push({ station: s, copy, x: at.x, z: at.z });
    }
  }

  /** Show the real model near the camera and the stand-in further away. */
  update(camera: THREE.Camera, seated: WorldStation | null): void {
    camera.getWorldPosition(this.cam);
    for (const { station, copy, x, z } of this.entries) {
      const d2 = (x - this.cam.x) ** 2 + (z - this.cam.z) ** 2;
      const was = copy.visible;
      const far = station !== seated && (was ? d2 > NEAR_M * NEAR_M : d2 > FAR_M * FAR_M);
      if (far === was) continue;
      station.model.visible = !far;
      copy.visible = far;
    }
  }

  dispose(): void {
    for (const { copy } of this.entries) {
      copy.traverse((o) => {
        if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) o.geometry.dispose();
      });
      copy.removeFromParent();
    }
    this.solid.dispose();
    this.glow.dispose();
  }

  private bake(model: THREE.Object3D): THREE.Object3D {
    const out = new THREE.Group();
    // The copy sits beside the model under the same anchor, so pieces are placed in the model's
    // parent's frame.
    out.position.copy(model.position);
    out.quaternion.copy(model.quaternion);
    out.scale.copy(model.scale);
    model.updateWorldMatrix(true, true);
    const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert();

    const solid: (Piece & { color: THREE.Color })[] = [];
    const glow: (Piece & { color: THREE.Color })[] = [];
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
      // strip's average colour.
      const sm = mats[0];
      if (!(o instanceof THREE.InstancedMesh) && mats.length === 1 && sm instanceof THREE.ShaderMaterial && radius < SMALL_M && !Object.keys(geo.morphAttributes).length) {
        const avg = averageColor(sm.uniforms.map?.value);
        if (avg) {
          const tint = sm.uniforms.uTint?.value;
          if (tint instanceof THREE.Color) avg.multiply(tint);
          glow.push({ geo, matrix, start: 0, count: total0, color: avg });
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
            else solid.push({ ...piece, color: avg });
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
        const lit = e && m.emissiveIntensity > 0 && e.r + e.g + e.b > 0.05;
        if (lit) glow.push({ ...piece, color: e.clone().multiplyScalar(m.emissiveIntensity).add(m.color.clone().multiplyScalar(0.15)) });
        else solid.push({ ...piece, color: m.color.clone() });
      }
    });

    if (solid.length) out.add(new THREE.Mesh(merge(solid, 'color'), this.solid));
    if (glow.length) out.add(new THREE.Mesh(merge(glow, 'color'), this.glow));
    for (const [mat, pieces] of byMaterial) {
      const mesh = new THREE.Mesh(merge(pieces, 'uv'), mat);
      // A see-through part drawn after the solid ones, as it would be in the live model.
      mesh.renderOrder = mat.transparent ? 1 : 0;
      out.add(mesh);
    }
    return out;
  }
}

/**
 * One indexed geometry from many pieces, positions and normals moved into the model's frame.
 * `extra` is a per-piece colour (the vertex-coloured merges) or the pieces' own UVs.
 */
function merge(pieces: (Piece & { color?: THREE.Color })[], extra: 'color' | 'uv'): THREE.BufferGeometry {
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
        second[o3] = c.r;
        second[o3 + 1] = c.g;
        second[o3 + 2] = c.b;
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
