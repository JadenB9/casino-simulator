// The light rig. Every lit fragment pays for every light, and changing the number of lights
// recompiles every material, so the count is fixed: a warm hemisphere and one directional light
// always, plus (High only) three spots and a focus spot that glides to whichever table the player
// is nearest or playing. The three spots light the room you're in (the pit's two rows of tables,
// the poker room, the salon): walking into another room they fade out, move and fade up there.
// The hemisphere takes the colour of the room you're in, a little at a time. Warm pools on the
// floor under tables, banks and lamps are additive decals, not lights.

import * as THREE from 'three';
import type { Quality } from '../render/engine3d.ts';
import { Batch, type RoomMeshes } from './batch.ts';
import type { Mats } from './materials.ts';
import { PIT_CEILING, inRect, type FloorPlan, type PlannedRoom } from './layout.ts';
import type { SpotItem } from './rooms.ts';
import { canvasTexture } from './carpet.ts';

/** How many spots light the room you're in. */
const SPOTS = 3;

export class Lighting {
  readonly group = new THREE.Group();
  readonly hemi = new THREE.HemisphereLight('#ffd6a6', '#3a1810', 1.35);
  readonly sun = new THREE.DirectionalLight('#ffe2bc', 0.55);
  private spots: THREE.SpotLight[] = [];
  readonly focus: THREE.SpotLight;
  private focusTo = new THREE.Vector3();
  private focusFrom = new THREE.Vector3();
  private focusOn = false;
  private quality: Quality;
  /** Each room's spots (the pit's from its rows), and where the rig is heading. */
  private readonly roomSpots = new Map<string, SpotItem[]>();
  private readonly ambient = new Map<string, { sky: THREE.Color; ground: THREE.Color; k: number }>();
  private room = '';
  private fade = 1;
  private pending: string | null = null;

  constructor(plan: FloorPlan, quality: Quality) {
    this.group.name = 'lights';
    this.quality = quality;
    this.sun.position.set(-6, 10, 8);
    this.sun.target.position.set(0, 0, 0);
    this.group.add(this.hemi, this.sun, this.sun.target);
    for (const r of plan.rooms) {
      this.roomSpots.set(r.id, spotsOf(plan, r));
      const a = r.style.ambient;
      this.ambient.set(r.id, { sky: new THREE.Color(a.sky), ground: new THREE.Color(a.ground), k: a.k });
    }
    for (let i = 0; i < SPOTS; i++) {
      const s = new THREE.SpotLight('#ffcf94', 0, 16, 1, 0.7, 1.6);
      this.spots.push(s);
    }
    this.focus = new THREE.SpotLight('#ffd9a3', 0, 9, 0.62, 0.55, 1.5);
    this.focus.position.set(0, 3.2, 0);
    this.spots.push(this.focus);
    this.setQuality(quality);
    this.setRoom('pit', true);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    for (const s of this.spots) {
      if (q === 'high') this.group.add(s, s.target);
      else this.group.remove(s, s.target);
    }
    const a = this.ambient.get(this.room);
    this.hemi.intensity = (a?.k ?? 1.35) * (q === 'high' ? 1 : 1.4);
    this.sun.intensity = q === 'high' ? 0.55 : 0.8;
  }

  /** The room the camera is in: its spots and its ambient light. */
  setRoom(room: string, now = false): void {
    if (room === this.room && !now) return;
    if (now) {
      this.room = room;
      this.place(room);
      this.fade = 1;
      const a = this.ambient.get(room);
      if (a) {
        this.hemi.color.copy(a.sky);
        this.hemi.groundColor.copy(a.ground);
      }
      return;
    }
    this.pending = room;
  }

  /** Aim the focus spot at a table (null lets it fade out). */
  setFocus(p: THREE.Vector3 | null): void {
    if (!p) {
      this.focusOn = false;
      return;
    }
    if (!this.focusOn && this.focus.intensity < 1) {
      this.focusFrom.copy(p);
      this.focus.target.position.copy(p);
    }
    this.focusOn = true;
    this.focusTo.copy(p);
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 3);
    this.focusFrom.lerp(this.focusTo, k);
    this.focus.target.position.set(this.focusFrom.x, 0.78, this.focusFrom.z);
    this.focus.position.set(this.focusFrom.x + 0.3, 3.2, this.focusFrom.z + 0.9);
    // Bright enough to lift the table out of the room, not so bright that gold felt printing and
    // brass pass the bloom threshold when the camera is a metre away.
    const want = this.focusOn ? 16 : 0;
    this.focus.intensity += (want - this.focus.intensity) * (1 - Math.exp(-dt * 4));

    // the room's spots: fade out, move to the new room, fade up
    if (this.pending !== null) {
      this.fade = Math.max(0, this.fade - dt / 0.25);
      if (this.fade === 0) {
        this.room = this.pending;
        this.pending = null;
        this.place(this.room);
      }
    } else {
      this.fade = Math.min(1, this.fade + dt / 0.35);
    }
    const list = this.roomSpots.get(this.room) ?? [];
    this.spots.slice(0, SPOTS).forEach((s, i) => (s.intensity = (list[i]?.k ?? 0) * this.fade));
    // the ambient drifts to the room's colour
    const a = this.ambient.get(this.pending ?? this.room);
    if (a) {
      const t = 1 - Math.exp(-dt * 2.5);
      this.hemi.color.lerp(a.sky, t);
      this.hemi.groundColor.lerp(a.ground, t);
      const target = a.k * (this.quality === 'high' ? 1 : 1.4);
      this.hemi.intensity += (target - this.hemi.intensity) * t;
    }
  }

  private place(room: string): void {
    const list = this.roomSpots.get(room) ?? [];
    this.spots.slice(0, SPOTS).forEach((s, i) => {
      const sp = list[i];
      if (!sp) {
        s.intensity = 0;
        return;
      }
      s.angle = sp.angle;
      s.position.set(sp.x, (sp as SpotItem & { y?: number }).y ?? 3.3, sp.z);
      s.target.position.set(sp.tx, 0.8, sp.tz);
      s.target.updateMatrixWorld();
    });
  }
}

/** A room's spots: the pit's two wide pools over its rows, or what the room asks for. */
function spotsOf(plan: FloorPlan, r: PlannedRoom): (SpotItem & { y?: number })[] {
  if (r.id === 'pit') {
    const P = plan.pit;
    const rowN = plan.stations.find((s) => s.room === 'pit' && s.zone === 'pit' && s.yaw !== 0)?.z ?? (P.z0 + P.z1) / 2 - 2;
    const rowS = plan.stations.find((s) => s.room === 'pit' && s.zone === 'pit' && s.yaw === 0)?.z ?? (P.z0 + P.z1) / 2 + 2;
    const cx = (P.x0 + P.x1) / 2;
    return [
      { x: cx, z: rowN + 0.6, tx: cx, tz: rowN, k: 80, angle: 1.05, y: PIT_CEILING - 0.4 },
      { x: cx, z: rowS - 0.6, tx: cx, tz: rowS, k: 80, angle: 1.05, y: PIT_CEILING - 0.4 },
    ];
  }
  return r.spots.map((s) => ({ ...s, y: r.style.ceiling - 0.1 }));
}

/**
 * Warm pools on the floor: one additive decal mesh for all of them, per room. Under tables, banks
 * and lamps a pool with a bright middle and a long soft edge, amber like incandescent light on red
 * carpet; under the ceilings' downlights over the walkways, a small faint scallop each.
 */
export function buildPools(pools: { x: number; z: number; r: number; room: string }[], downlights: { x: number; z: number; room: string }[], plan: FloorPlan, b: Batch, m: Mats): void {
  m.define1('pool-warm', () => {
    const tex = canvasTexture(poolCanvas(128), 1);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color('#ff9f4a').multiplyScalar(0.15), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  });
  const mat = m.get('pool-warm');
  const flat = (x: number, z: number, r: number, y: number) => {
    const g = new THREE.PlaneGeometry(r * 2, r * 2);
    b.add(g, mat, new THREE.Matrix4().makeRotationX(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(x, y, z)));
  };
  for (const p of pools) {
    b.room = p.room;
    flat(p.x, p.z, p.r, 0.014);
  }
  // downlights over the walkways only: over stations and furniture their scallop would land on tops
  for (const d of downlights) {
    if (!plan.aisles.some((a) => inRect(a, d.x, d.z, -0.4))) continue;
    b.room = d.room;
    flat(d.x, d.z, 0.85, 0.012);
  }
}

/** A pool's falloff: a warm middle, then a long, soft edge (no ring where it ends). */
function poolCanvas(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    // a smooth bell: bright middle, gentle shoulder, fades to nothing at the edge
    const a = Math.pow(Math.cos((t * Math.PI) / 2), 2.2);
    g.addColorStop(t, `rgba(255,255,255,${a.toFixed(3)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

/** The glows' colours, pushed past 1 so they bloom (and still read bright without bloom). */
export const GLOW = {
  /** The pit's cove strip, washing the fascia. */
  warm: new THREE.Color('#ffd39a').multiplyScalar(2.6),
  /** Pendant diffusers and the cashier's window lights. */
  soft: new THREE.Color('#ffc98a').multiplyScalar(1.25),
  /** The low ceiling's downlights. */
  bulb: new THREE.Color('#fff0d0').multiplyScalar(1.12),
  /** Shelf and counter light strips. */
  shelf: new THREE.Color('#ffb266').multiplyScalar(2.2),
};

type GlowPlace = THREE.Matrix4 | { x?: number; y?: number; z?: number; rx?: number; ry?: number };

/**
 * The floor's glowing strips and discs (the slot islands' LED underglow and corner bars, the
 * coves, the downlights, shelf and counter lights): one unlit mesh coloured per vertex for all of
 * them, kept per room, so they cost one draw call between them instead of one per colour.
 */
export class GlowMerge {
  private readonly batch = new Batch();
  private readonly material = new THREE.MeshBasicMaterial({ vertexColors: true });

  /** Where the next pieces go. */
  set room(id: string) {
    this.batch.room = id;
  }

  get room(): string {
    return this.batch.room;
  }

  add(geo: THREE.BufferGeometry, color: THREE.Color, place: GlowPlace): void {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
    g.applyMatrix4(place instanceof THREE.Matrix4 ? place : new THREE.Matrix4().compose(new THREE.Vector3(place.x ?? 0, place.y ?? 0, place.z ?? 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(place.rx ?? 0, place.ry ?? 0, 0, 'YXZ')), new THREE.Vector3(1, 1, 1)));
    const n = g.getAttribute('position').count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set([color.r, color.g, color.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    this.batch.raw(g, this.material);
  }

  box(color: THREE.Color, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, ry = 0): void {
    this.add(new THREE.BoxGeometry(sx, sy, sz), color, { x: cx, y: cy, z: cz, ry });
  }

  /** One mesh of everything added, under `parent`. */
  build(parent: THREE.Object3D): RoomMeshes {
    this.material.name = 'glow';
    const out = this.batch.build(parent, 'floor');
    for (const m of out.meshes) m.name = 'floor:glow';
    return out;
  }
}
