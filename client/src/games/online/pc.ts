// The computer every online game is played on: a desk with a monitor, keyboard and mouse, and a
// gaming chair, as it stands in the online lounge. The monitor's glass is where the game's screen
// goes: its corners are exported so the DOM screen (screen.ts) maps onto it exactly and the play
// camera sits square to it. On the floor the glass shows the game's own attract picture.
//
// Every static part is merged per material when the model is built, so a desk costs six draw
// calls up close however many boxes it's made of; the lounge holds a dozen of them.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Pose } from '../../table/stage.ts';

/** The monitor's glass, metres: a 27-inch panel at 16:10, the shape of the DOM screen. */
export const SCREEN_W = 0.58;
export const SCREEN_H = 0.3625;
const DESK_TOP = 0.74;
/** Desk from z = -0.65 to 0.05, chair behind it: the whole station centres on the origin. */
const DESK_Z = -0.3;
const SCREEN_CENTER = new THREE.Vector3(0, 1.06, -0.47);
/** How far the play camera sits from the glass: the screen fills about three quarters of the view. */
const VIEW_DISTANCE = 0.46;

export const PC_FOOTPRINT = { width: 1.2, depth: 1.6 };
/** The middle of the chair's seat, facing the monitor (-z); its cushion tops out at SEAT_TOP. */
export const PC_SEAT: [number, number, number] = [0, 0, 0.46];
export const SEAT_TOP = 0.515;

/** The glass's corners in station coordinates: top-left, top-right, bottom-right, bottom-left. */
export function pcScreenCorners(): THREE.Vector3[] {
  const hw = SCREEN_W / 2;
  const hh = SCREEN_H / 2;
  const z = SCREEN_CENTER.z + 0.0125;
  return [
    new THREE.Vector3(-hw, SCREEN_CENTER.y + hh, z),
    new THREE.Vector3(hw, SCREEN_CENTER.y + hh, z),
    new THREE.Vector3(hw, SCREEN_CENTER.y - hh, z),
    new THREE.Vector3(-hw, SCREEN_CENTER.y - hh, z),
  ];
}

/** Square to the glass, at a seated eye's distance. */
export function pcPose(): Pose {
  return { position: [0, SCREEN_CENTER.y, SCREEN_CENTER.z + VIEW_DISTANCE], target: [0, SCREEN_CENTER.y, SCREEN_CENTER.z] };
}

/**
 * A canvas texture for the monitor on the floor: `draw` paints a 512 x 320 picture of the game
 * (its name and something of its board), which reads from across the lounge.
 */
export function attractTexture(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 320;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0e1a24';
  g.fillRect(0, 0, c.width, c.height);
  draw(g, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

type Part = { geo: THREE.BufferGeometry; at: [number, number, number]; rot?: [number, number, number] };

const box = (w: number, h: number, d: number, at: [number, number, number], rot?: [number, number, number]): Part => ({ geo: new THREE.BoxGeometry(w, h, d), at, rot });
const cyl = (rTop: number, rBottom: number, h: number, at: [number, number, number], rot?: [number, number, number], seg = 16): Part => ({ geo: new THREE.CylinderGeometry(rTop, rBottom, h, seg), at, rot });

/** Bake parts into one geometry (one draw call for their material). */
function merged(parts: Part[]): THREE.BufferGeometry {
  const m = new THREE.Matrix4();
  const e = new THREE.Euler();
  const geos = parts.map(({ geo, at, rot }) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(m.makeRotationFromEuler(e.set(...(rot ?? [0, 0, 0]))).setPosition(...at));
    return g;
  });
  const out = mergeGeometries(geos, false)!;
  for (const g of geos) g.dispose();
  for (const p of parts) p.geo.dispose();
  return out;
}

// Shared by every desk in the lounge; the trim colours are shared per colour.
let mats: Record<'wood' | 'metal' | 'plastic' | 'fabric', THREE.MeshStandardMaterial> | null = null;
const accents = new Map<string, THREE.MeshStandardMaterial>();

function materials(accent: string) {
  mats ??= {
    wood: new THREE.MeshStandardMaterial({ color: '#3a281b', roughness: 0.55, metalness: 0.02 }),
    metal: new THREE.MeshStandardMaterial({ color: '#2b2c30', roughness: 0.35, metalness: 0.75 }),
    plastic: new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.42, metalness: 0.1 }),
    fabric: new THREE.MeshStandardMaterial({ color: '#1c1d22', roughness: 0.92 }),
  };
  let a = accents.get(accent);
  if (!a) {
    a = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.6 });
    accents.set(accent, a);
  }
  return { ...mats, accent: a };
}

export interface PcOptions {
  /** What the monitor shows on the floor (see attractTexture). */
  attract: THREE.Texture;
  /** The chair's trim colour: each game has its own, so a row of desks reads at a glance. */
  accent?: string;
}

export function pcModel(opts: PcOptions): THREE.Group {
  const m = materials(opts.accent ?? '#19d27c');
  const g = new THREE.Group();
  g.name = 'online-pc';

  // Desk: top, modesty panel, two T-legs.
  const deskWood = merged([box(1.2, 0.035, 0.7, [0, DESK_TOP - 0.0175, DESK_Z]), box(1.12, 0.32, 0.02, [0, DESK_TOP - 0.2, DESK_Z - 0.3])]);
  const deskMetal = merged([
    ...[-0.54, 0.54].flatMap((x) => [box(0.05, DESK_TOP - 0.035, 0.05, [x, (DESK_TOP - 0.035) / 2, DESK_Z]), box(0.06, 0.03, 0.62, [x, 0.015, DESK_Z])]),
    // Monitor stand: foot plate and neck.
    box(0.26, 0.012, 0.18, [0, DESK_TOP + 0.006, SCREEN_CENTER.z - 0.02]),
    box(0.05, 0.19, 0.03, [0, DESK_TOP + 0.1, SCREEN_CENTER.z - 0.05]),
  ]);
  // Monitor shell, keyboard and mouse.
  const plastic = merged([
    box(SCREEN_W + 0.024, SCREEN_H + 0.024, 0.025, [0, SCREEN_CENTER.y, SCREEN_CENTER.z]),
    box(0.44, 0.022, 0.14, [-0.04, DESK_TOP + 0.011, -0.05], [0.06, 0, 0]),
    box(0.065, 0.03, 0.11, [0.33, DESK_TOP + 0.015, -0.04]),
    // Chair: gas lift and a five-spoke base with casters.
    cyl(0.028, 0.028, 0.3, [0, 0.27, PC_SEAT[2]]),
    ...[0, 1, 2, 3, 4].map((i) => {
      const a = (i / 5) * Math.PI * 2;
      return box(0.04, 0.03, 0.3, [Math.sin(a) * 0.15, 0.08, PC_SEAT[2] + Math.cos(a) * 0.15], [0, a, 0]);
    }),
    ...[0, 1, 2, 3, 4].map((i) => {
      const a = (i / 5) * Math.PI * 2;
      return cyl(0.025, 0.025, 0.03, [Math.sin(a) * 0.29, 0.035, PC_SEAT[2] + Math.cos(a) * 0.29], [0, 0, Math.PI / 2], 10);
    }),
  ]);
  // Chair: seat, backrest, headrest, arms.
  const fabric = merged([
    box(0.52, 0.09, 0.5, [0, 0.47, PC_SEAT[2]]),
    box(0.5, 0.66, 0.09, [0, 0.86, PC_SEAT[2] + 0.26], [-0.12, 0, 0]),
    box(0.3, 0.14, 0.08, [0, 1.25, PC_SEAT[2] + 0.32], [-0.12, 0, 0]),
    ...[-0.27, 0.27].map((x): Part => box(0.06, 0.03, 0.26, [x, 0.66, PC_SEAT[2] + 0.02])),
  ]);
  const accent = merged([
    ...[-0.19, 0.19].map((x): Part => box(0.07, 0.6, 0.095, [x, 0.87, PC_SEAT[2] + 0.26], [-0.12, 0, 0])),
    box(0.4, 0.02, 0.095, [0, 1.1, PC_SEAT[2] + 0.29], [-0.12, 0, 0]),
  ]);
  for (const [geo, mat] of [
    [deskWood, m.wood],
    [deskMetal, m.metal],
    [plastic, m.plastic],
    [fabric, m.fabric],
    [accent, m.accent],
  ] as const) {
    g.add(new THREE.Mesh(geo, mat));
  }

  // The glass: the attract picture on the floor; the DOM screen covers it while you play.
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), new THREE.MeshBasicMaterial({ map: opts.attract, toneMapped: false }));
  glass.name = 'pc-screen';
  glass.position.set(0, SCREEN_CENTER.y, SCREEN_CENTER.z + 0.0126);
  g.add(glass);
  return g;
}
