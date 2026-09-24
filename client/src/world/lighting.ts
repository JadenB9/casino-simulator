// The light rig. Every lit fragment pays for every light, and changing the number of lights
// recompiles every material, so the count is fixed: a warm hemisphere and one directional light
// always, plus (High only) four spots: two wide pools over the pit rows, one over the poker room,
// and a focus spot that glides to whichever table the player is nearest or playing. Warm pools
// on the carpet under tables, banks and lamps are additive decals, not lights.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Quality } from '../render/engine3d.ts';
import type { Batch } from './batch.ts';
import type { Mats } from './materials.ts';
import { PIT_CEILING, inRect, type FloorPlan } from './layout.ts';
import { canvasTexture } from './carpet.ts';

export class Lighting {
  readonly group = new THREE.Group();
  readonly hemi = new THREE.HemisphereLight('#ffd6a6', '#3a1810', 1.35);
  readonly sun = new THREE.DirectionalLight('#ffe2bc', 0.55);
  private spots: THREE.SpotLight[] = [];
  readonly focus: THREE.SpotLight;
  private focusTo = new THREE.Vector3();
  private focusFrom = new THREE.Vector3();
  private focusOn = false;

  constructor(plan: FloorPlan, quality: Quality) {
    this.group.name = 'lights';
    this.sun.position.set(-6, 10, 8);
    this.sun.target.position.set(0, 0, 0);
    this.group.add(this.hemi, this.sun, this.sun.target);

    const P = plan.pit;
    const pitZ = (plan.staff.z0 + plan.staff.z1) / 2;
    const rowN = plan.stations.find((s) => s.zone === 'pit' && s.yaw !== 0)?.z ?? pitZ - 2;
    const rowS = plan.stations.find((s) => s.zone === 'pit' && s.yaw === 0)?.z ?? pitZ + 2;
    const wide = (x: number, z: number, tx: number, tz: number, intensity: number, angle: number) => {
      const s = new THREE.SpotLight('#ffcf94', intensity, 16, angle, 0.7, 1.6);
      s.position.set(x, PIT_CEILING - 0.4, z);
      s.target.position.set(tx, 0.8, tz);
      return s;
    };
    this.spots.push(wide((P.x0 + P.x1) / 2, rowN + 0.6, (P.x0 + P.x1) / 2, rowN, 80, 1.05));
    this.spots.push(wide((P.x0 + P.x1) / 2, rowS - 0.6, (P.x0 + P.x1) / 2, rowS, 80, 1.05));
    const pk = plan.pokerRoom;
    const poker = new THREE.SpotLight('#ffcf94', 40, 12, 0.95, 0.7, 1.6);
    poker.position.set((pk.x0 + pk.x1) / 2 + 0.8, 3.3, (pk.z0 + pk.z1) / 2);
    poker.target.position.set((pk.x0 + pk.x1) / 2 + 1.2, 0.8, (pk.z0 + pk.z1) / 2);
    this.spots.push(poker);
    this.focus = new THREE.SpotLight('#ffd9a3', 0, 9, 0.62, 0.55, 1.5);
    this.focus.position.set(0, 3.2, 0);
    this.spots.push(this.focus);
    this.setQuality(quality);
  }

  setQuality(q: Quality): void {
    for (const s of this.spots) {
      if (q === 'high') this.group.add(s, s.target);
      else this.group.remove(s, s.target);
    }
    this.hemi.intensity = q === 'high' ? 1.35 : 1.9;
    this.sun.intensity = q === 'high' ? 0.55 : 0.8;
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
  }
}

/**
 * Warm pools on the carpet: one additive decal mesh for all of them. Under tables, banks and lamps
 * a pool with a bright middle and a long soft edge, amber like incandescent light on red carpet;
 * under the low ceiling's downlights over the aisles, a small faint scallop each.
 */
export function buildPools(pools: { x: number; z: number; r: number }[], downlights: [number, number][], plan: FloorPlan, b: Batch, m: Mats): void {
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
  for (const p of pools) flat(p.x, p.z, p.r, 0.014);
  // downlights over the walkways only: over stations and furniture their scallop would land on tops
  for (const [x, z] of downlights) {
    if (!plan.aisles.some((a) => inRect(a, x, z, -0.4)) && !inRect(plan.entrance, x, z, -0.4)) continue;
    flat(x, z, 0.85, 0.012);
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

type Place = THREE.Matrix4 | { x?: number; y?: number; z?: number; rx?: number; ry?: number };

/**
 * The floor's glowing strips and discs (the slot islands' LED underglow and corner bars, the
 * cove, the downlights, shelf and counter lights): one unlit mesh coloured per vertex for all of
 * them, so they cost one draw call between them instead of one per colour.
 */
export class GlowMerge {
  private readonly pieces: THREE.BufferGeometry[] = [];

  add(geo: THREE.BufferGeometry, color: THREE.Color, place: Place): void {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
    g.applyMatrix4(place instanceof THREE.Matrix4 ? place : new THREE.Matrix4().compose(new THREE.Vector3(place.x ?? 0, place.y ?? 0, place.z ?? 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(place.rx ?? 0, place.ry ?? 0, 0, 'YXZ')), new THREE.Vector3(1, 1, 1)));
    const n = g.getAttribute('position').count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set([color.r, color.g, color.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    this.pieces.push(g);
  }

  box(color: THREE.Color, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, ry = 0): void {
    this.add(new THREE.BoxGeometry(sx, sy, sz), color, { x: cx, y: cy, z: cz, ry });
  }

  /** One mesh of everything added, under `parent` (null when nothing was). */
  build(parent: THREE.Object3D): THREE.Mesh | null {
    if (this.pieces.length === 0) return null;
    const merged = mergeGeometries(this.pieces, false);
    for (const p of this.pieces) p.dispose();
    this.pieces.length = 0;
    if (!merged) return null;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ vertexColors: true }));
    mesh.name = 'floor:glow';
    mesh.matrixAutoUpdate = false;
    parent.add(mesh);
    return mesh;
  }
}
