// The furniture drawn in code: the chairs and stools at every table seat, the lounges' club and
// tub chairs, benches, the pit's round banquette, the bar's high-tops, side tables, the boutique's
// display cases and mannequin plinths, the yard's crates, barrels, pallets, scrap and workbench,
// and the host stands. Each kind is a handful of parts, one per material, merged once; every
// piece of that kind is an instance, so a kind costs a draw call per part however many stand on
// the floor. Pieces in rooms nobody can see are left out of the instances (setRooms), and the
// chair you're sitting in can be hidden (hideChair). Sizes come from furniture-spec.ts, the same
// numbers the floor plan checks and the seats are measured on.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Mats } from './materials.ts';
import { FURNITURE, type ChairKind } from './furniture-spec.ts';
import type { FloorPlan } from './layout.ts';
import type { FurnitureKind } from './rooms.ts';

type Kind = ChairKind | FurnitureKind;

/** A part of a piece in its own frame: its geometry and the material it's drawn in. */
interface Part {
  geo: THREE.BufferGeometry;
  mat: string;
}

/** The seat height each chair kind's geometry is built for; instances are scaled to their own. */
const BUILT_TOP: Record<ChairKind, number> = { chair: 0.58, plush: 0.55, stool: 0.62, 'velvet-stool': 0.62 };

interface Inst {
  matrix: THREE.Matrix4;
  room: string;
  /** For a table's chair: which, so the one you sit in can be hidden. */
  key?: string;
}

export class Furniture {
  readonly group = new THREE.Group();
  private readonly kinds = new Map<Kind, { meshes: THREE.InstancedMesh[]; list: Inst[] }>();
  private visible: Set<string> | null = null;
  private readonly hidden = new Set<string>();

  constructor(plan: FloorPlan, private readonly mats: Mats) {
    this.group.name = 'furniture';
    const lists = new Map<Kind, Inst[]>();
    const push = (kind: Kind, inst: Inst) => lists.set(kind, [...(lists.get(kind) ?? []), inst]);
    const place = (x: number, z: number, yaw: number, sy = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(UP, yaw), new THREE.Vector3(1, sy, 1));
    for (const c of plan.chairs) {
      // a chair faces its table; its geometry faces +z, the sitter's way
      push(c.kind, { matrix: place(c.x, c.z, c.yaw, c.top / BUILT_TOP[c.kind]), room: c.room, key: `${c.station}:${c.slot}` });
    }
    for (const f of plan.furniture) {
      if (!BUILDERS[f.kind]) continue;
      push(f.kind, { matrix: place(f.x, f.z, f.yaw), room: f.room });
    }
    for (const [kind, list] of lists) {
      const parts = merge(BUILDERS[kind]!());
      const meshes = parts.map((p) => {
        const mesh = new THREE.InstancedMesh(p.geo, mats.get(p.mat), list.length);
        mesh.name = `furniture:${kind}:${p.mat}`;
        return mesh;
      });
      for (const m of meshes) this.group.add(m);
      this.kinds.set(kind, { meshes, list });
    }
    this.refresh();
  }

  /** Draw only the pieces in these rooms (null: all of them). */
  setRooms(rooms: Set<string> | null): void {
    this.visible = rooms;
    this.refresh();
  }

  /** Hide the chair at a table's seat (the one you're sitting in), or show it again. */
  hideChair(station: string, slot: number, hide: boolean): void {
    const key = `${station}:${slot}`;
    if (hide === this.hidden.has(key)) return;
    if (hide) this.hidden.add(key);
    else this.hidden.delete(key);
    this.refresh();
  }

  /** Show every chair again. */
  showChairs(): void {
    if (this.hidden.size === 0) return;
    this.hidden.clear();
    this.refresh();
  }

  dispose(): void {
    for (const { meshes } of this.kinds.values()) for (const m of meshes) {
      m.geometry.dispose();
      m.dispose();
    }
    this.group.removeFromParent();
  }

  private refresh(): void {
    for (const { meshes, list } of this.kinds.values()) {
      let n = 0;
      for (const inst of list) {
        if (this.visible && !this.visible.has(inst.room)) continue;
        if (inst.key && this.hidden.has(inst.key)) continue;
        for (const m of meshes) m.setMatrixAt(n, inst.matrix);
        n++;
      }
      for (const m of meshes) {
        m.count = n;
        m.visible = n > 0;
        m.instanceMatrix.needsUpdate = true;
        m.computeBoundingSphere();
      }
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/** One geometry per material from a piece's parts. */
function merge(parts: Part[]): Part[] {
  const by = new Map<string, THREE.BufferGeometry[]>();
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    by.set(p.mat, [...(by.get(p.mat) ?? []), g]);
  }
  return [...by].map(([mat, geos]) => {
    const g = mergeGeometries(geos, false)!;
    g.computeBoundingSphere();
    return { geo: g, mat };
  });
}

// --- pieces ----------------------------------------------------------------------------------------

/** Give an open surface a second, inward-facing copy of its faces (the materials are one-sided). */
function addInside(g: THREE.BufferGeometry): void {
  const index = g.getIndex();
  if (!index) return;
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  const n = pos.count;
  const p2 = new Float32Array(n * 6);
  const n2 = new Float32Array(n * 6);
  const u2 = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      p2[i * 3 + k] = p2[(n + i) * 3 + k] = pos.getComponent(i, k);
      n2[i * 3 + k] = nrm.getComponent(i, k);
      n2[(n + i) * 3 + k] = -nrm.getComponent(i, k);
    }
    for (let k = 0; k < 2; k++) u2[i * 2 + k] = u2[(n + i) * 2 + k] = uv.getComponent(i, k);
  }
  const idx: number[] = Array.from(index.array as ArrayLike<number>);
  for (let t = 0; t < index.count; t += 3) idx.push(index.getX(t) + n, index.getX(t + 2) + n, index.getX(t + 1) + n);
  g.setAttribute('position', new THREE.BufferAttribute(p2, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(n2, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(u2, 2));
  g.setIndex(idx);
}

type At = { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number };

function placed(g: THREE.BufferGeometry, at: At): THREE.BufferGeometry {
  return g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(at.x ?? 0, at.y ?? 0, at.z ?? 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(at.rx ?? 0, at.ry ?? 0, at.rz ?? 0, 'YXZ')), new THREE.Vector3(1, 1, 1)));
}
const box = (mat: string, w: number, h: number, d: number, at: At): Part => ({ geo: placed(new THREE.BoxGeometry(w, h, d), at), mat });
const cyl = (mat: string, r0: number, r1: number, h: number, at: At, seg = 16): Part => ({ geo: placed(new THREE.CylinderGeometry(r0, r1, h, seg), at), mat });
const ring = (mat: string, r: number, tube: number, at: At, seg = 24): Part => ({ geo: placed(new THREE.TorusGeometry(r, tube, 6, seg), { rx: Math.PI / 2, ...at }), mat });

/** A casino table chair: upholstered seat and back on a dark wood frame, a brass foot ring. */
function chair(): Part[] {
  const t = BUILT_TOP.chair;
  const out: Part[] = [
    box('upholstery', 0.44, 0.07, 0.42, { y: t - 0.035, z: 0.01 }),
    box('upholstery', 0.4, 0.32, 0.06, { y: t + 0.24, z: -0.2, rx: -0.12 }),
    box('beam', 0.46, 0.05, 0.44, { y: t - 0.095 }),
  ];
  for (const x of [-0.19, 0.19]) {
    for (const z of [-0.18, 0.18]) out.push(box('beam', 0.036, t - 0.12, 0.036, { x, y: (t - 0.12) / 2, z }));
    // the back's posts, raked back a little
    out.push(box('beam', 0.036, 0.46, 0.036, { x, y: t + 0.2, z: -0.215, rx: -0.12 }));
  }
  out.push(box('beam', 0.44, 0.045, 0.04, { y: t + 0.42, z: -0.245, rx: -0.12 }));
  // the foot ring, brass, between the legs
  for (const [x, z, w, d] of [
    [0, 0.18, 0.38, 0.018],
    [0, -0.18, 0.38, 0.018],
    [0.19, 0, 0.018, 0.36],
    [-0.19, 0, 0.018, 0.36],
  ] as const) out.push(box('brass', w, 0.018, d, { x, y: 0.2, z }));
  return out;
}

/** The salon's tub chair: a curved velvet back round a deep seat, on tapered brass legs. */
function plushChair(): Part[] {
  const t = BUILT_TOP.plush;
  const back = new THREE.CylinderGeometry(0.25, 0.24, 0.44, 20, 1, true, Math.PI * 0.35, Math.PI * 1.3);
  back.scale(1, 1, 0.9);
  // an open half-cylinder: draw its inside by adding the faces turned round
  addInside(back);
  const out: Part[] = [
    box('velvet-green', 0.48, 0.1, 0.46, { y: t - 0.05 }),
    { geo: placed(back, { y: t + 0.2, z: -0.02 }), mat: 'velvet-green' },
    cyl('velvet-green', 0.26, 0.26, 0.05, { y: t + 0.43, z: -0.02 }, 20),
    box('brass', 0.5, 0.03, 0.48, { y: t - 0.115 }),
  ];
  for (const x of [-0.2, 0.2]) for (const z of [-0.19, 0.19]) out.push(cyl('brass', 0.022, 0.012, t - 0.13, { x, y: (t - 0.13) / 2, z }, 8));
  return out;
}

/** The salon's lounge tub chair: the table chair's shape, broader and lower. */
function tubChair(): Part[] {
  const s = FURNITURE.tub;
  const t = s.top!;
  const r = s.w / 2 - 0.02;
  const back = new THREE.CylinderGeometry(r, r - 0.02, s.h - t, 24, 1, true, Math.PI * 0.32, Math.PI * 1.36);
  addInside(back);
  return [
    box('velvet-green', s.w - 0.06, 0.14, s.d - 0.08, { y: t - 0.07 }),
    { geo: placed(back, { y: t + (s.h - t) / 2 - 0.02 }), mat: 'velvet-green' },
    cyl('velvet-green', r + 0.01, r + 0.01, 0.06, { y: s.h - 0.03 }, 24),
    box('velvet-green', s.w - 0.02, t - 0.22, s.d - 0.04, { y: 0.1 + (t - 0.22) / 2 }),
    box('brass', s.w, 0.03, s.d - 0.02, { y: 0.09 }),
    ...[-1, 1].flatMap((e) => [-1, 1].map((f) => cyl('brass', 0.02, 0.014, 0.08, { x: e * (s.w / 2 - 0.08), y: 0.04, z: f * (s.d / 2 - 0.08) }, 8))),
  ];
}

/** A backless stool: a round cushion on a chrome post, a foot ring. */
function stool(velvet: boolean): Part[] {
  const t = BUILT_TOP.stool;
  const seat = velvet ? 'velvet-green' : 'upholstery';
  const metal = velvet ? 'brass' : 'chrome';
  return [
    cyl(seat, 0.155, 0.15, 0.07, { y: t - 0.035 }, 20),
    cyl(metal, 0.16, 0.16, 0.015, { y: t - 0.078 }, 20),
    cyl(metal, 0.022, 0.03, t - 0.08, { y: (t - 0.08) / 2 }, 10),
    cyl(metal, 0.15, 0.15, 0.02, { y: 0.01 }, 20),
    ring(metal, 0.12, 0.011, { y: 0.3 }),
    box(metal, 0.24, 0.014, 0.014, { y: 0.3 }),
    box(metal, 0.014, 0.014, 0.24, { y: 0.3 }),
  ];
}

/** A leather club chair: a deep box of a seat, rolled arms, a low back. */
function armchair(): Part[] {
  const s = FURNITURE.armchair;
  const t = s.top!;
  return [
    box('leather', s.w - 0.1, t - 0.16, s.d - 0.06, { y: 0.08 + (t - 0.16) / 2 }),
    box('leather', s.w - 0.3, 0.1, s.d - 0.22, { y: t - 0.05, z: 0.07 }),
    ...[-1, 1].map((e) => box('leather', 0.15, 0.62, s.d - 0.04, { x: e * (s.w / 2 - 0.075), y: 0.39 })),
    ...[-1, 1].map((e) => cyl('leather', 0.08, 0.08, s.d - 0.04, { x: e * (s.w / 2 - 0.075), y: 0.7, rx: Math.PI / 2 }, 12)),
    box('leather', s.w, s.h - 0.12, 0.16, { y: 0.08 + (s.h - 0.12) / 2, z: -s.d / 2 + 0.08 }),
    ...[-1, 1].flatMap((e) => [-1, 1].map((f) => box('beam', 0.06, 0.08, 0.06, { x: e * (s.w / 2 - 0.08), y: 0.04, z: f * (s.d / 2 - 0.08) }))),
  ];
}

/** An upholstered bench, buttoned red velvet on a dark frame with brass feet. */
function bench(): Part[] {
  const s = FURNITURE.bench;
  const t = s.top!;
  const out: Part[] = [box('velvet', s.w, 0.1, s.d, { y: t - 0.05 }), box('beam', s.w - 0.06, 0.08, s.d - 0.06, { y: t - 0.14 })];
  for (const x of [-(s.w / 2 - 0.1), s.w / 2 - 0.1]) for (const z of [-(s.d / 2 - 0.08), s.d / 2 - 0.08]) out.push(cyl('beam', 0.03, 0.022, t - 0.18, { x, y: (t - 0.18) / 2 + 0.03, z }, 8), cyl('brass', 0.026, 0.026, 0.04, { x, y: 0.02, z }, 8));
  return out;
}

/** The pit's round banquette: a ring of velvet seat round a raised back, about the palm's planter. */
function banquette(): Part[] {
  const s = FURNITURE.banquette;
  const R = s.w / 2;
  const t = s.top!;
  const seat = new THREE.LatheGeometry(
    [
      [0.78, t],
      [R - 0.02, t],
      [R, t - 0.04],
      [R, 0.1],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
    48,
  );
  const back = new THREE.LatheGeometry(
    [
      [0.8, t - 0.01],
      [0.8, s.h - 0.06],
      [0.74, s.h],
      [0.62, s.h],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
    48,
  );
  const plinth = new THREE.LatheGeometry(
    [
      [R - 0.04, 0.1],
      [R - 0.04, 0],
      [0.6, 0],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
    48,
  );
  return [
    { geo: seat, mat: 'velvet' },
    { geo: back, mat: 'velvet' },
    { geo: plinth, mat: 'lacquer' },
    ring('brass', R - 0.01, 0.012, { y: 0.1 }, 64),
    ring('brass', 0.68, 0.015, { y: s.h }, 48),
  ];
}

/** A bar-height round table on a brass pedestal (its stools are the bar's, props.ts). */
function hightop(): Part[] {
  const h = FURNITURE.hightop.h;
  return [
    cyl('marble-black', 0.36, 0.36, 0.04, { y: h - 0.02 }, 28),
    ring('brass', 0.36, 0.012, { y: h - 0.02 }, 40),
    cyl('brass', 0.035, 0.035, h - 0.06, { y: (h - 0.06) / 2 }, 10),
    cyl('lacquer', 0.3, 0.32, 0.04, { y: 0.02 }, 24),
    ring('brass', 0.12, 0.01, { y: 0.34 }),
  ];
}

function sideTable(): Part[] {
  const s = FURNITURE.side;
  return [cyl('marble-black', s.w / 2, s.w / 2, 0.035, { y: s.h - 0.018 }, 24), cyl('brass', 0.025, 0.025, s.h - 0.05, { y: (s.h - 0.05) / 2 }, 8), cyl('brass', 0.18, 0.2, 0.03, { y: 0.015 }, 20)];
}

/** A jeweller's case: a lit glass top over a velvet tray of gold, on a black lacquer base. */
function displayCase(): Part[] {
  const s = FURNITURE.case;
  const base = s.h - 0.18;
  const out: Part[] = [
    box('lacquer', s.w, base, s.d, { y: base / 2 }),
    box('brass', s.w + 0.02, 0.03, s.d + 0.02, { y: base }),
    box('velvet', s.w - 0.1, 0.02, s.d - 0.1, { y: base + 0.02 }),
    box('glass', s.w - 0.04, 0.16, s.d - 0.04, { y: base + 0.1 }),
    box('case-light', s.w - 0.12, 0.012, 0.02, { y: s.h - 0.03, z: -s.d / 2 + 0.06 }),
  ];
  for (const x of [-1, 1]) for (const z of [-1, 1]) out.push(box('brass', 0.02, 0.18, 0.02, { x: x * (s.w / 2 - 0.02), y: base + 0.09, z: z * (s.d / 2 - 0.02) }));
  // the pieces on the velvet: chains coiled in rings, grills, watch faces
  for (let i = 0; i < 5; i++) {
    const x = -s.w / 2 + 0.2 + i * ((s.w - 0.4) / 4);
    out.push(ring('brass', 0.07 - (i % 2) * 0.015, 0.009, { x, y: base + 0.04, z: -0.08 }, 20));
    out.push(box(i % 2 ? 'chrome' : 'brass', 0.09, 0.02, 0.05, { x, y: base + 0.04, z: 0.1 }));
  }
  return out;
}

/** The round plinth a mannequin stands on. */
function plinth(): Part[] {
  return [cyl('marble-black', 0.4, 0.42, 0.12, { y: 0.06 }, 28), ring('brass', 0.41, 0.012, { y: 0.12 }, 40)];
}

/** A shipping crate, planks with steel corners. */
function crate(): Part[] {
  const s = FURNITURE.crate;
  const out: Part[] = [box('planks', s.w, s.h, s.d, { y: s.h / 2 })];
  for (const x of [-1, 1]) for (const z of [-1, 1]) out.push(box('steel', 0.05, s.h + 0.01, 0.05, { x: (x * (s.w - 0.04)) / 2, y: s.h / 2, z: (z * (s.d - 0.04)) / 2 }));
  return out;
}

function barrel(): Part[] {
  const s = FURNITURE.barrel;
  return [cyl('rust', s.w / 2 - 0.02, s.w / 2 - 0.02, s.h, { y: s.h / 2 }, 20), ...[0.2, 0.5, 0.8].map((y) => ring('steel', s.w / 2 - 0.01, 0.014, { y: y * s.h }))];
}

/** A burning drum: a rusted barrel with holes punched round it, the fire at its mouth. */
function drumFire(): Part[] {
  const s = FURNITURE['drum-fire'];
  const out = barrel().map((p) => ({ ...p }));
  out.push(cyl('fire', s.w / 2 - 0.05, s.w / 2 - 0.12, 0.14, { y: s.h - 0.05 }, 16));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    out.push(box('fire', 0.05, 0.05, 0.01, { x: Math.sin(a) * (s.w / 2 - 0.015), y: 0.35, z: Math.cos(a) * (s.w / 2 - 0.015), ry: a }));
  }
  return out;
}

/** Four pallets stacked, a little out of true. */
function pallets(): Part[] {
  const s = FURNITURE.pallets;
  const out: Part[] = [];
  for (let k = 0; k < 4; k++) {
    const y = k * 0.155;
    const turn = (k % 2 ? 1 : -1) * 0.03;
    for (let i = 0; i < 6; i++) out.push(box('planks', s.w - 0.02, 0.022, 0.12, { x: 0, y: y + 0.13, z: -s.d / 2 + 0.09 + i * ((s.d - 0.18) / 5), ry: turn }));
    for (const x of [-(s.w / 2 - 0.06), 0, s.w / 2 - 0.06]) out.push(box('planks', 0.1, 0.1, s.d - 0.04, { x, y: y + 0.07, ry: turn }));
  }
  return out;
}

/** A heap of scrap: sheet, pipe, a tyre, planks, a drum on its side. */
function scrap(): Part[] {
  const s = FURNITURE.scrap;
  return [
    box('rust', 1.2, 0.05, 0.9, { x: -0.1, y: 0.3, z: 0.05, rx: 0.3, rz: 0.2 }),
    box('rust', 0.9, 0.05, 0.7, { x: 0.3, y: 0.55, z: -0.1, rx: -0.5, rz: -0.3 }),
    cyl('rust', 0.26, 0.26, 0.8, { x: -0.5, y: 0.26, z: -0.35, rz: Math.PI / 2, ry: 0.4 }, 16),
    cyl('steel', 0.04, 0.04, 1.5, { x: 0.2, y: 0.6, z: 0.35, rz: 1.1, ry: -0.3 }, 8),
    ring('fabric', 0.32, 0.11, { x: 0.55, y: 0.15, z: 0.35, rx: 0 }, 20),
    box('planks', 1.4, 0.04, 0.16, { x: 0, y: 0.82, z: 0, rx: 0.1, rz: 0.4 }),
    box('steel', 0.5, 0.35, 0.4, { x: 0.55, y: 0.18, z: -0.4, ry: 0.5 }),
    box('rust', 0.6, 0.04, 0.5, { x: -0.1, y: s.h - 0.25, z: 0.1, rx: 0.9, rz: -0.2 }),
  ];
}

/** A workbench: a thick timber top on steel legs, a vice, a lamp, tools. */
function workbench(): Part[] {
  const s = FURNITURE.workbench;
  const out: Part[] = [box('planks', s.w, 0.07, s.d, { y: s.h - 0.035 }), box('planks', s.w - 0.1, 0.03, s.d - 0.1, { y: 0.25 })];
  for (const x of [-(s.w / 2 - 0.06), s.w / 2 - 0.06]) for (const z of [-(s.d / 2 - 0.06), s.d / 2 - 0.06]) out.push(box('steel', 0.06, s.h - 0.07, 0.06, { x, y: (s.h - 0.07) / 2, z }));
  out.push(box('steel', 0.16, 0.12, 0.14, { x: s.w / 2 - 0.2, y: s.h + 0.06, z: s.d / 2 - 0.12 }));
  out.push(box('rust', 0.3, 0.06, 0.12, { x: -0.3, y: s.h + 0.03, z: 0.1, ry: 0.4 }));
  out.push(cyl('steel', 0.015, 0.015, 0.5, { x: -s.w / 2 + 0.2, y: s.h + 0.25, z: -s.d / 2 + 0.12 }, 6));
  out.push(cyl('fire', 0.06, 0.08, 0.1, { x: -s.w / 2 + 0.2, y: s.h + 0.48, z: -s.d / 2 + 0.12 }, 10));
  return out;
}

/** A plank laid across two crates. */
function plankBench(): Part[] {
  const s = FURNITURE['plank-bench'];
  const t = s.top!;
  return [box('planks', s.w, 0.06, s.d, { y: t - 0.03 }), ...[-0.62, 0.62].map((x) => box('planks', 0.42, t - 0.06, s.d - 0.04, { x, y: (t - 0.06) / 2 })), ...[-0.62, 0.62].map((x) => box('steel', 0.44, 0.03, 0.03, { x, y: t - 0.1, z: s.d / 2 - 0.02 }))];
}

/** A host stand: a wood desk with a marble top and a small brass lamp. */
function podium(): Part[] {
  const s = FURNITURE.podium;
  return [
    box('wood', s.w - 0.06, s.h - 0.04, s.d - 0.06, { y: (s.h - 0.04) / 2 }),
    box('marble-black', s.w, 0.04, s.d, { y: s.h - 0.02, rx: -0.12 }),
    box('brass', s.w - 0.04, 0.03, 0.02, { y: 0.4, z: s.d / 2 - 0.02 }),
    cyl('brass', 0.01, 0.01, 0.3, { x: s.w / 2 - 0.12, y: s.h + 0.15, z: -0.1 }, 6),
    cyl('shade', 0.07, 0.09, 0.08, { x: s.w / 2 - 0.12, y: s.h + 0.3, z: -0.1 }, 12),
  ];
}

/** The directory's stand: two brass posts and a lacquer frame (its face is drawn by wayfinding.ts). */
function directoryStand(): Part[] {
  const s = FURNITURE.directory;
  return [
    box('lacquer', s.w, 1.62, 0.1, { y: 1.46 }),
    box('brass', s.w + 0.04, 0.04, 0.12, { y: 2.29 }),
    box('brass', s.w + 0.04, 0.04, 0.12, { y: 0.63 }),
    ...[-1, 1].map((e) => box('brass', 0.06, 0.62, 0.06, { x: e * (s.w / 2 - 0.12), y: 0.31 })),
    box('marble-black', s.w * 0.7, 0.05, s.d, { y: 0.025 }),
  ];
}

const BUILDERS: Partial<Record<Kind, () => Part[]>> = {
  chair,
  plush: plushChair,
  stool: () => stool(false),
  'velvet-stool': () => stool(true),
  tub: tubChair,
  armchair,
  bench,
  banquette,
  hightop,
  side: sideTable,
  case: displayCase,
  mannequin: plinth,
  crate,
  barrel,
  'drum-fire': drumFire,
  pallets,
  scrap,
  workbench,
  'plank-bench': plankBench,
  podium,
  directory: directoryStand,
};

