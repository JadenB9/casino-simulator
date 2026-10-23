// Contact shadows: a soft darkening of the floor under and round everything that stands on it, so
// nothing floats. No shadow maps (every lit fragment would pay for them): each piece's outline is
// drawn on the floor as a flat decal, dark under it and fading out past its edge, and the decals
// of a room are one geometry of a batch of their own (batch.ts), so the whole floor's grounding is
// one draw call however many rooms are showing, and a room nobody can see draws none of it.
//
// An outline is the piece's reach in K directions round its middle, in its own frame (its support
// function): a box's is |cos| w/2 + |sin| d/2, a round thing's its radius, and a table's is
// measured from its model (the parts between the floor and its rail), so a half-moon stays a
// half-moon. The dark core is the outline drawn smaller about its middle; the soft edge runs out to
// the outline grown by `spread`, which is the same shape's reach plus `spread` in every direction,
// so the edge is as wide all the way round. How dark, and how the darkness falls off across the
// edge, come from one small texture: u across the edge, v how dark (each decal's own strength).
//
// What casts: the plan's solids standing on the floor (chairs and stools, islands, counters,
// cabinets, planters, benches, sofas, cases, plinths, columns, the fountain), each table and desk
// by its measured outline, the bingo hall's long tables and stage from its layout, and a strip
// along the foot of every wall where it meets a room's floor. Black at an alpha multiplies what's
// under it, so where two overlap they darken together in any order (no sorting needed), and the
// light pools (lighting.ts), drawn after, still warm the floor round a table.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Batch, type RoomMeshes } from './batch.ts';
import { WALL, roomAt, type FloorPlan, type PlacedFurniture, type Solid } from './layout.ts';
import { FURNITURE, BAR_STOOL } from './furniture-spec.ts';
import { ROW_Z, STAGE_H, STAGE_W, STAGE_Z0, STAGE_Z1, TABLE as BINGO_TABLE } from '../games/bingo/layout.ts';

/** How high the decals lie: over the runners, inlays and rugs (all under a centimetre). */
export const SHADOW_Y = 0.011;

/** One decal: where its middle is, how it's turned, its reach round that middle, how dark and how soft. */
export interface Shadow {
  x: number;
  z: number;
  /** Its frame's turn (Object3D.rotation.y); `reach` is measured in that frame. */
  yaw: number;
  /** Its reach (m) in each of reach.length directions, evenly round from its local +x toward +z. */
  reach: number[];
  /** How dark the core is (0-1, the alpha of black over the floor). */
  k: number;
  /** How far the soft edge runs out past the outline (m). */
  spread: number;
  /** The core is the outline drawn this much smaller about its middle (1: the whole outline is dark). */
  core: number;
  room: string;
}

/** A soft strip along the foot of a wall: from (x0, z0) to (x1, z1) on the wall's face, out along (nx, nz). */
export interface Strip {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  nx: number;
  nz: number;
  k: number;
  spread: number;
  room: string;
}

/** A box's reach (w across its local x, d along its local z) in n directions. */
export function boxReach(w: number, d: number, n = 16): number[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return (Math.abs(Math.cos(a)) * w) / 2 + (Math.abs(Math.sin(a)) * d) / 2;
  });
}

/** A round thing's reach. */
export function roundReach(r: number, n = 16): number[] {
  return new Array<number>(n).fill(r);
}

/** How dark and how soft a piece's shadow is, by how tall it is: taller things gather more of the dark. */
function tone(h: number): { k: number; spread: number } {
  const t = Math.min(h, 2);
  return { k: 0.36 + 0.15 * t, spread: 0.08 + 0.07 * t };
}

/**
 * What's under each kind of piece, as a share of its outline that's dark: a box down to the floor
 * (a counter, a planter, an island's plinth) is dark right to its edge; a chair or a table on legs
 * is dark under its middle and lighter at its edge.
 */
const SOLID_CORE = 0.96;
const LEGGED_CORE = 0.85;
/** A table's chair: its seat's own shadow below it, nearly its whole outline (the overhead light's). */
const CHAIR_CORE = 0.9;
/** The furniture kinds on legs or feet (the rest stand on the floor along their whole outline). */
const LEGGED = new Set(['bench', 'side', 'coffee', 'workbench', 'scrap', 'armchair', 'tub', 'sofa', 'plank-bench']);

/**
 * A piece's shadow from its size alone (the city's and the apartment's furniture, a statue's
 * plinth): a box `w` across and `d` deep turned `yaw`, or round (`w` its diameter), `h` tall, on
 * legs or standing on the floor along its whole outline.
 */
export function pieceShadow(o: { x: number; z: number; w: number; d: number; h: number; yaw?: number; round?: boolean; legs?: boolean; room?: string }): Shadow {
  const t = tone(o.h);
  const big = Math.max(o.w, o.d) > 1.2;
  return {
    x: o.x,
    z: o.z,
    yaw: o.yaw ?? 0,
    reach: o.round ? roundReach(o.w / 2, big ? 32 : 16) : boxReach(o.w, o.d, big ? 24 : 16),
    k: t.k,
    spread: t.spread,
    core: o.legs ? LEGGED_CORE : SOLID_CORE,
    room: o.room ?? '',
  };
}

/** Many shadows as one geometry (unindexed, so it merges and checks like any other piece). */
export function shadowsGeometry(shadows: readonly Shadow[], y = SHADOW_Y): THREE.BufferGeometry | null {
  if (shadows.length === 0) return null;
  const parts = shadows.map((s) => {
    const g = shadowGeometry(s, y);
    const flat = g.toNonIndexed();
    g.dispose();
    return flat;
  });
  const out = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  out?.computeBoundingSphere();
  return out;
}

/**
 * The plan's shadows: every solid standing on the floor, the high-tops' tables and stools, the
 * floor lamps by their foot. Stations come from stationShadows (their outlines are measured from
 * their models, which only the browser has).
 */
export function floorShadows(plan: FloorPlan): Shadow[] {
  const out: Shadow[] = [];
  const kinds = new Map<string, PlacedFurniture>(plan.furniture.map((f) => [`${f.room}-${f.kind}-${f.n}`, f]));
  const lampIds = new Set<string>();
  for (const s of plan.solids) if (/^lounge-\d+-lamp-\d+$/.test(s.id)) lampIds.add(s.id);
  const roomOf = (s: Solid) => s.room ?? roomAt(plan, s.x, s.z)?.id ?? 'pit';
  for (const s of plan.solids) {
    if (s.y0 > 0.05) continue;
    const room = roomOf(s);
    const f = kinds.get(s.id);
    const h = s.y1 - s.y0;
    if (f?.kind === 'hightop') {
      // the table on its pedestal, and its three stools (props.ts draws them)
      const t = tone(h);
      out.push({ x: s.x, z: s.z, yaw: 0, reach: roundReach(0.36), k: t.k, spread: t.spread, core: LEGGED_CORE, room });
      const c = Math.cos(f.yaw);
      const n = Math.sin(f.yaw);
      for (const seat of FURNITURE.hightop.seats!) {
        const st = tone(BAR_STOOL.h);
        out.push({ x: s.x + seat.x * c + seat.z * n, z: s.z - seat.x * n + seat.z * c, yaw: 0, reach: roundReach(BAR_STOOL.r - 0.01), k: st.k, spread: st.spread, core: 0.9, room });
      }
      continue;
    }
    if (f?.kind === 'lamp' || lampIds.has(s.id)) {
      // a floor lamp touches the floor with its foot; its solid is the shade's reach
      out.push({ x: s.x, z: s.z, yaw: 0, reach: roundReach(0.16), k: 0.42, spread: 0.12, core: 0.9, room });
      continue;
    }
    const t = tone(h);
    const chair = s.of !== undefined;
    // a table's stool stands on a round foot plate; its chairs and the furniture on legs don't
    const core = chair ? CHAIR_CORE : f !== undefined && LEGGED.has(f.kind) ? LEGGED_CORE : SOLID_CORE;
    const big = Math.max(s.w, s.d) > 1.2;
    const reach = s.round ? roundReach(s.w / 2, big ? 32 : 16) : boxReach(s.w, s.d, big ? 24 : 16);
    out.push({ x: s.x, z: s.z, yaw: s.yaw, reach, k: chair ? t.k * 0.95 : t.k, spread: t.spread, core, room });
  }
  return out;
}

/** The bingo hall (one station the size of the hall): its four long tables and the caller's stage. */
export function bingoShadows(st: { x: number; z: number; yaw: number; room: string }): Shadow[] {
  const out: Shadow[] = [];
  const c = Math.cos(st.yaw);
  const n = Math.sin(st.yaw);
  const at = (lx: number, lz: number) => ({ x: st.x + lx * c + lz * n, z: st.z - lx * n + lz * c });
  const t = tone(BINGO_TABLE.h);
  for (const z of ROW_Z) out.push({ ...at(0, z), yaw: st.yaw, reach: boxReach(BINGO_TABLE.w, BINGO_TABLE.d, 24), k: t.k, spread: t.spread, core: LEGGED_CORE, room: st.room });
  const s = tone(STAGE_H + 0.3);
  out.push({ ...at(0, (STAGE_Z0 + STAGE_Z1) / 2), yaw: st.yaw, reach: boxReach(STAGE_W, STAGE_Z1 - STAGE_Z0, 24), k: s.k, spread: s.spread, core: SOLID_CORE, room: st.room });
  return out;
}

/** The soft strips along the foot of every wall, on each room's side of it (none across a doorway). */
export function wallStrips(plan: FloorPlan): Strip[] {
  const out: Strip[] = [];
  const byId = new Map(plan.rooms.map((r) => [r.id, r]));
  for (const w of plan.wallPieces) {
    // a lintel over a doorway, or wall standing on another wall's top: nothing meets the floor
    if (w.y0 > 0.001) continue;
    for (const side of ['neg', 'pos'] as const) {
      const id = w[side];
      if (!id) continue;
      const r = byId.get(id);
      if (!r) continue;
      const s = side === 'neg' ? -1 : 1;
      // the face is on this room's side of the centre line; the strip runs along the room's own span
      const face = w.c + s * (WALL / 2);
      const span: [number, number] = w.axis === 'x' ? [r.inner.x0, r.inner.x1] : [r.inner.z0, r.inner.z1];
      const a0 = Math.max(w.a0, span[0]);
      const a1 = Math.min(w.a1, span[1]);
      if (a1 - a0 < 0.05) continue;
      const strip = w.axis === 'x' ? { x0: a0, z0: face, x1: a1, z1: face, nx: 0, nz: s } : { x0: face, z0: a0, x1: face, z1: a1, nx: s, nz: 0 };
      out.push({ ...strip, k: 0.38, spread: 0.34, room: id });
    }
  }
  return out;
}

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _local = new THREE.Matrix4();

/**
 * A model's reach in n directions round its frame's origin (`frame`: the station's anchor), from
 * its parts between y0 and y1 above the floor: the table and its rail, its pedestal and legs, not
 * the signs and lamps over it. Null when nothing of it is in that band. World matrices must be up
 * to date.
 */
export function measureReach(model: THREE.Object3D, frame: THREE.Object3D, n = 32, y0 = 0.03, y1 = 0.96): number[] | null {
  const reach = new Array<number>(n).fill(-Infinity);
  const cos = Array.from({ length: n }, (_, i) => Math.cos((i / n) * Math.PI * 2));
  const sin = Array.from({ length: n }, (_, i) => Math.sin((i / n) * Math.PI * 2));
  _local.copy(frame.matrixWorld).invert();
  const box = new THREE.Box3();
  let any = false;
  const take = (geo: THREE.BufferGeometry, matrix: THREE.Matrix4) => {
    if (!geo.boundingBox) geo.computeBoundingBox();
    box.copy(geo.boundingBox!).applyMatrix4(matrix);
    if (box.max.y < y0 || box.min.y > y1) return;
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      if (_v.y < y0 || _v.y > y1) continue;
      any = true;
      for (let k = 0; k < n; k++) {
        const d = _v.x * cos[k]! + _v.z * sin[k]!;
        if (d > reach[k]!) reach[k] = d;
      }
    }
  };
  model.traverseVisible((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (o as THREE.SkinnedMesh).isSkinnedMesh) return;
    const geo = mesh.geometry as THREE.BufferGeometry;
    if (!geo?.attributes?.position) return;
    const toLocal = new THREE.Matrix4().multiplyMatrices(_local, mesh.matrixWorld);
    const inst = o as THREE.InstancedMesh;
    if (inst.isInstancedMesh) {
      for (let i = 0; i < inst.count; i++) {
        inst.getMatrixAt(i, _m);
        take(geo, _m.premultiply(toLocal));
      }
    } else take(geo, toLocal);
  });
  return any ? reach : null;
}

/**
 * Each table, wheel and desk by its measured outline (machines stand in islands, which are solids;
 * video poker on the bar is on the counter), and the bingo hall's tables and stage.
 */
export function stationShadows(stations: readonly { id: string; zone: string; room: string; yaw: number; anchor: THREE.Object3D; model: THREE.Object3D }[], vpOnFloor: boolean): Shadow[] {
  const out: Shadow[] = [];
  for (const s of stations) {
    const p = s.anchor.position;
    if (s.zone === 'hall') {
      out.push(...bingoShadows({ x: p.x, z: p.z, yaw: s.yaw, room: s.room }));
      continue;
    }
    const measured = s.zone === 'pit' || s.zone === 'poker' || s.zone === 'feature' || s.zone === 'wheel' || s.zone === 'online' || (s.zone === 'bar' && vpOnFloor);
    if (!measured) continue;
    const shadow = modelShadow(s.model, s.anchor, s.room);
    if (shadow) out.push(shadow);
  }
  return out;
}

/**
 * A table's, wheel's or machine's shadow from its own model, in its anchor's place and turn (the
 * floor's stations, the dev room's one): null when nothing of it stands near the floor.
 */
export function modelShadow(model: THREE.Object3D, anchor: THREE.Object3D, room = ''): Shadow | null {
  const reach = measureReach(model, anchor);
  if (!reach) return null;
  return centred({ x: anchor.position.x, z: anchor.position.z, yaw: anchor.rotation.y, reach, k: 0.58, spread: 0.19, core: 0.82, room });
}

/** The outline's corners: where each direction's edge meets the next one's. */
export function outline(reach: readonly number[], grow = 0, scale = 1): [number, number][] {
  const n = reach.length;
  const step = (Math.PI * 2) / n;
  const sd = Math.sin(step);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a0 = i * step;
    const a1 = a0 + step;
    const h0 = reach[i]! * scale + grow;
    const h1 = reach[(i + 1) % n]! * scale + grow;
    out.push([(h0 * Math.sin(a1) - h1 * Math.sin(a0)) / sd, (h1 * Math.cos(a0) - h0 * Math.cos(a1)) / sd]);
  }
  return out;
}

/** The same shadow with its middle moved to the middle of its outline (a measured one may sit off its origin). */
export function centred(s: Shadow): Shadow {
  const pts = outline(s.reach);
  let cx = 0;
  let cz = 0;
  for (const [x, z] of pts) {
    cx += x;
    cz += z;
  }
  cx /= pts.length;
  cz /= pts.length;
  const n = s.reach.length;
  const reach = s.reach.map((r, i) => r - (cx * Math.cos((i / n) * Math.PI * 2) + cz * Math.sin((i / n) * Math.PI * 2)));
  const c = Math.cos(s.yaw);
  const sn = Math.sin(s.yaw);
  return { ...s, x: s.x + cx * c + cz * sn, z: s.z - cx * sn + cz * c, reach };
}

/**
 * A shadow's decal, in world space: a fan of the core about the middle (u 0) and a band out to the
 * grown outline (u 1), v its strength. Indexed, facing up.
 */
export function shadowGeometry(s: Shadow, y = SHADOW_Y): THREE.BufferGeometry {
  const n = s.reach.length;
  const inner = outline(s.reach, 0, s.core);
  const outer = outline(s.reach, s.spread);
  const c = Math.cos(s.yaw);
  const sn = Math.sin(s.yaw);
  const pos = new Float32Array((2 * n + 1) * 3);
  const uv = new Float32Array((2 * n + 1) * 2);
  const put = (i: number, lx: number, lz: number, u: number) => {
    pos[i * 3] = s.x + lx * c + lz * sn;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = s.z - lx * sn + lz * c;
    uv[i * 2] = u;
    uv[i * 2 + 1] = s.k;
  };
  put(0, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    put(1 + i, inner[i]![0], inner[i]![1], 0);
    put(1 + n + i, outer[i]![0], outer[i]![1], 1);
  }
  const index: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    // (counter-clockwise seen from above: the outline runs from +x toward +z, which is clockwise there)
    index.push(0, 1 + j, 1 + i);
    index.push(1 + i, 1 + j, 1 + n + j, 1 + i, 1 + n + j, 1 + n + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

/** A wall's strip: a quad from the wall's face (u 0) out along its normal (u 1). */
export function stripGeometry(s: Strip, y = SHADOW_Y): THREE.BufferGeometry {
  const ox = s.nx * s.spread;
  const oz = s.nz * s.spread;
  const pos = new Float32Array([s.x0, y, s.z0, s.x1, y, s.z1, s.x1 + ox, y, s.z1 + oz, s.x0 + ox, y, s.z0 + oz]);
  const uv = new Float32Array([0, s.k, 0, s.k, 1, s.k, 1, s.k]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // which way round faces up depends on which side of the wall the strip lies
  const up = (s.x1 - s.x0) * oz - (s.z1 - s.z0) * ox < 0;
  g.setIndex(up ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
  return g;
}

/** The falloff across a shadow's edge (u: 0 at the core, 1 at the edge) times its strength (v). */
export function shadowTexture(): THREE.DataTexture {
  const W = 128;
  const H = 32;
  const data = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++) {
    const k = j / (H - 1);
    for (let i = 0; i < W; i++) {
      const t = i / (W - 1);
      // steep at first, then a long tail that meets the floor without a line
      const f = (1 - t) * (1 - t) * (1 + 1.6 * t);
      const o = (j * W + i) * 4;
      data[o] = data[o + 1] = data[o + 2] = 255;
      data[o + 3] = Math.round(255 * f * k);
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** The decals' material: black at the texture's alpha, pulled toward the eye over the floor it lies on. */
export function shadowMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color: 0x000000, map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  m.name = 'contact-shadow';
  return m;
}

/** The floor's contact shadows: one batch, a part per room. */
export class Grounding {
  readonly meshes: RoomMeshes;
  readonly count: number;
  private readonly texture = shadowTexture();
  private readonly material = shadowMaterial(this.texture);

  constructor(shadows: readonly Shadow[], strips: readonly Strip[], parent: THREE.Object3D) {
    const b = new Batch();
    for (const s of shadows) {
      b.room = s.room;
      b.raw(shadowGeometry(s), this.material);
    }
    for (const s of strips) {
      b.room = s.room;
      b.raw(stripGeometry(s), this.material);
    }
    this.count = shadows.length + strips.length;
    this.meshes = b.build(parent, 'floor');
    for (const m of this.meshes.meshes) {
      m.name = 'floor:contact-shadows';
      // before the other see-through things (the light pools, glass): black over the floor
      // multiplies, so the order among the shadows themselves doesn't matter
      m.renderOrder = -1;
      m.sortObjects = false;
    }
  }

  setRoom(room: string, visible: boolean): void {
    this.meshes.setRoom(room, visible);
  }

  dispose(): void {
    for (const m of this.meshes.meshes) {
      m.dispose();
      m.removeFromParent();
    }
    this.material.dispose();
    this.texture.dispose();
  }
}
