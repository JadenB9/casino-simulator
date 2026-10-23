// Finding your way round a bigger casino: the directory board in the lobby (the floor's plan with
// every room named and a "You are here"), and the Map: a panel over the floor (the HUD's map button
// or M) drawing the rooms, their doors and walls, the tables and machines in them, and you, with
// the way you face, and (1.3) everyone else where they are. Click a room to light it up and read what's there. Both are drawn from the
// floor plan, so a room added to rooms.ts appears on them. v8: beside the plan, every room and
// Find a game (every game in the building, where and how far), and Show the way to either: a line
// on the map, a trail on the floor and a chip that counts down the metres.

import * as THREE from 'three';
import './map.css';
import { el } from '../ui/kit.ts';
import type { Spot } from './interact.ts';
import { isTyping, overlayCount } from '../ui/keyboard.ts';
import { openSheet, type Sheet } from '../ui/menu/sheet.ts';
import { CATALOG } from '../../../shared/src/games/catalog.ts';
import { roomAt, type FloorPlan, type Placement, type PlannedRoom } from './layout.ts';
import { pathLength, type NavGrid, type Pt } from './life/nav.ts';
import { calm } from '../app/comfort.ts';
import { FURNITURE } from './furniture-spec.ts';
import { stationName } from './stations.ts';
import { isKey, keyLabel, keyed, modified } from '../ui/keys.ts';

const DIRECTORY_W = FURNITURE.directory.w;

/** Each room's colour on the plans: its own, from its signs and floor. */
const TINT: Record<string, string> = {
  lobby: '#6d6456',
  pit: '#6e2230',
  slots: '#5a1f5c',
  bar: '#1d5856',
  lounge: '#6a4424',
  poker: '#22386a',
  salon: '#1c5a3c',
  online: '#16503a',
  yard: '#6a4418',
  bank: '#6a5a36',
  boutique: '#7a6230',
  parlour: '#7a2456',
  cardroom: '#6a1418',
  bingo: '#2a4a7a',
};

/** What's in a room, for the map and the directory: its games, then what else it has. */
export function roomContents(plan: FloorPlan, id: string): { games: string[]; about: string } {
  const names: string[] = [];
  for (const s of plan.stations) {
    if (s.room !== id) continue;
    const n = s.game === 'slots' ? (CATALOG.slots.variants.find((v) => v.id === s.variant)?.name ?? 'Slots') : stationName(s.game, s.variant);
    if (!names.includes(n)) names.push(n);
  }
  return { games: names, about: plan.rooms.find((r) => r.id === id)?.about ?? '' };
}

// --- the directory board ---------------------------------------------------------------------------

/** Draw the building's plan into a rect of a 2D canvas: rooms, walls, names; `you` gets a star. */
function drawPlan(g: CanvasRenderingContext2D, plan: FloorPlan, x: number, y: number, w: number, h: number, you: { x: number; z: number } | null): void {
  const R = plan.room;
  const k = Math.min(w / (R.x1 - R.x0), h / (R.z1 - R.z0));
  const ox = x + (w - (R.x1 - R.x0) * k) / 2;
  const oy = y + (h - (R.z1 - R.z0) * k) / 2;
  const px = (wx: number) => ox + (wx - R.x0) * k;
  const py = (wz: number) => oy + (wz - R.z0) * k;
  for (const r of plan.rooms) {
    g.fillStyle = TINT[r.id] ?? '#444';
    g.globalAlpha = 0.85;
    g.fillRect(px(r.bounds.x0), py(r.bounds.z0), (r.bounds.x1 - r.bounds.x0) * k, (r.bounds.z1 - r.bounds.z0) * k);
  }
  g.globalAlpha = 1;
  // tables and machines, faintly
  g.fillStyle = 'rgba(255, 240, 210, 0.22)';
  for (const s of plan.stations) {
    g.save();
    g.translate(px(s.x), py(s.z));
    g.rotate(-s.yaw);
    g.fillRect((-s.fp.width / 2) * k, (-s.fp.depth / 2) * k, s.fp.width * k, s.fp.depth * k);
    g.restore();
  }
  // walls (a doorway is a gap in them)
  g.strokeStyle = '#d8b06a';
  g.lineWidth = Math.max(2, k * 0.3);
  g.lineCap = 'square';
  for (const p of plan.wallPieces) {
    if (p.y0 > 0) continue;
    g.beginPath();
    if (p.axis === 'x') {
      g.moveTo(px(p.a0), py(p.c));
      g.lineTo(px(p.a1), py(p.c));
    } else {
      g.moveTo(px(p.c), py(p.a0));
      g.lineTo(px(p.c), py(p.a1));
    }
    g.stroke();
  }
  // room names
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const r of plan.rooms) {
    const cx = px(r.cx);
    const cy = py(r.cz);
    const rw = (r.bounds.x1 - r.bounds.x0) * k;
    const words = r.name.toUpperCase().split(' ');
    let size = Math.min(26, rw / 7);
    g.font = `600 ${size}px "Cinzel", Georgia, serif`;
    // one line if it fits, else two
    const one = words.join(' ');
    const lines = g.measureText(one).width < rw * 0.86 ? [one] : [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')];
    const widest = Math.max(...lines.map((l) => g.measureText(l).width));
    if (widest > rw * 0.9) size *= (rw * 0.9) / widest;
    g.font = `600 ${size}px "Cinzel", Georgia, serif`;
    g.fillStyle = '#fff4dc';
    g.shadowColor = 'rgba(0,0,0,0.8)';
    g.shadowBlur = 6;
    lines.forEach((l, i) => g.fillText(l, cx, cy + (i - (lines.length - 1) / 2) * size * 1.15));
    g.shadowBlur = 0;
  }
  if (you) {
    const cx = px(you.x);
    const cy = py(you.z);
    g.fillStyle = '#ff4b3e';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 7 : 16;
      g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    g.fill();
    g.strokeStyle = '#fff4dc';
    g.lineWidth = 2;
    g.stroke();
  }
}

/** The lobby's directory boards: the floor's plan on a lit face on each board's stand. */
export function buildDirectories(plan: FloorPlan, parent: THREE.Object3D, anisotropy: number): { meshes: THREE.Mesh[]; dispose(): void } {
  const meshes: THREE.Mesh[] = [];
  const textures: THREE.Texture[] = [];
  const spec = FURNITURE.directory;
  for (const f of plan.furniture) {
    if (f.kind !== 'directory') continue;
    const W = 900;
    const H = 980;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    g.fillStyle = '#0d0b0a';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#8a6a34';
    g.lineWidth = 4;
    g.strokeRect(14, 14, W - 28, H - 28);
    g.textAlign = 'center';
    g.fillStyle = '#f1d59a';
    g.font = '64px "Limelight", Georgia, serif';
    g.fillText('Casino Simulator', W / 2, 96);
    g.font = '600 26px "Cinzel", Georgia, serif';
    g.fillStyle = '#c9b07a';
    g.fillText('FLOOR  DIRECTORY', W / 2, 140);
    // (1.3: the plan a little shorter, so all fourteen rooms fit under it clear of YOU ARE HERE)
    drawPlan(g, plan, 40, 162, W - 80, 520, { x: f.x, z: f.z });
    // the legend: every room and what's in it, two columns
    g.textAlign = 'left';
    const rooms = [...plan.rooms].sort((a, b) => a.name.localeCompare(b.name));
    rooms.forEach((r, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 52 + col * ((W - 104) / 2);
      const y = 714 + row * 31;
      g.fillStyle = TINT[r.id] ?? '#444';
      g.fillRect(x, y - 11, 18, 18);
      g.fillStyle = '#f4efe4';
      g.font = '600 20px "Cinzel", Georgia, serif';
      g.fillText(r.name.toUpperCase(), x + 28, y + 5);
    });
    g.fillStyle = '#ff4b3e';
    g.font = '600 20px "Cinzel", Georgia, serif';
    g.textAlign = 'center';
    g.fillText('★  YOU ARE HERE', W / 2, H - 26);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    textures.push(tex);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(spec.w - 0.12, 1.5), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1, 1, 1).multiplyScalar(0.92) }));
    mesh.name = 'directory';
    const turn = new THREE.Matrix4().makeRotationY(f.yaw);
    mesh.position.set(f.x, 1.46, f.z).add(new THREE.Vector3(0, 0, 0.052).applyMatrix4(turn));
    mesh.rotation.y = f.yaw;
    mesh.userData.room = f.room;
    parent.add(mesh);
    meshes.push(mesh);
  }
  return {
    meshes,
    dispose() {
      for (const m of meshes) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
        m.removeFromParent();
      }
      for (const t of textures) t.dispose();
    },
  };
}

// --- the map -----------------------------------------------------------------------------------

const NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, cls?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (cls) e.setAttribute('class', cls);
  return e;
}

/** A folded map, for the HUD's button. */
function mapIcon(): SVGSVGElement {
  const s = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, 'ico');
  s.append(svgEl('path', { d: 'M3.5 6.5l5.5-2.5 6 2.5 5.5-2.5v13.5l-5.5 2.5-6-2.5-5.5 2.5z' }), svgEl('path', { d: 'M9 4v13.5' }), svgEl('path', { d: 'M15 6.5V20' }));
  return s;
}

export interface MapDeps {
  plan: FloorPlan;
  /** Where DOM overlays go (#ui). */
  ui: HTMLElement;
  /** Where you are and which way you face (Object3D.rotation.y). */
  you: () => { x: number; z: number; heading: number };
  /** Whether the map may open now (not in the middle of something that holds the keys). */
  canOpen?: () => boolean;
  /** v6 city6: out of the casino (the ground floor, the roof), that zone's map instead. */
  elsewhere?: () => ElsewhereMap | null;
  /** v8: the camera, for the way's arrow (where to go from the way you look). */
  camera?: THREE.Camera;
  /**
   * v8: whether the way can be shown now: 'on' walking the casino's floor, 'hide' for a while (at a
   * table, in a panel that has the controls), 'off' out of the casino altogether (it's let go).
   */
  route?: () => 'on' | 'hide' | 'off';
}

/** 1.3: someone else on the map (metres), where you'd see them if you were there. */
export interface MapPerson {
  id: number;
  name: string;
  x: number;
  z: number;
}

/** v6 city6: a map of somewhere else (city/map.ts): its body, you on it, and what to call where you are. */
export interface ElsewhereMap {
  title: string;
  body: HTMLElement;
  you: SVGGElement;
  here(x: number, z: number): string;
}

// --- the way there (v8) ----------------------------------------------------------------------------
//
// "Show the way" from the map, to a room or to a game: a path over the waiters' walkable grid
// (life/nav.ts: A* pulled tight, so it turns only at corners), drawn on the map from you to there,
// and on the floor as a short trail of soft brass chevrons a few metres ahead of you, drifting the
// way to go (still while calm). A chip under the HUD names where you're going, how far it is and
// which way to turn; it says when you're there and goes, or Stop ends it. Walk off the line and
// the way is worked out again from where you are.

/** Where the way leads: a room (arrived on walking into it), or a table or machine (arrived beside it). */
export interface Destination {
  /** What the chip calls it ("Blackjack", "the Bar"). */
  name: string;
  /** Where the walk ends (metres). */
  x: number;
  z: number;
  /** A room: arrived once you're in it. */
  room?: string;
}

/** A game on the floor as the Find a game list shows it: every station of one name. */
export interface GameSpot {
  key: string;
  name: string;
  section: GameSection;
  /** The rooms it's in (names), in the plan's order, and every placement of it. */
  rooms: string[];
  stations: Placement[];
}

export type GameSection = 'Tables' | 'Machines' | 'Online lounge';
const SECTIONS: readonly GameSection[] = ['Tables', 'Machines', 'Online lounge'];

/** Every game in the building, one entry a name (a high limit table has its own), A to Z within each section. */
export function gameSpots(plan: FloorPlan): GameSpot[] {
  const by = new Map<string, GameSpot>();
  for (const s of plan.stations) {
    const info = CATALOG[s.game];
    if (!info || info.dev) continue;
    const base = stationName(s.game, s.variant);
    const name = s.tier === 'high' ? `High Limit ${base}` : base;
    let g = by.get(name);
    if (!g) {
      const section: GameSection = info.online ? 'Online lounge' : info.multiplayer || s.game === 'bingo' ? 'Tables' : 'Machines';
      by.set(name, (g = { key: name, name, section, rooms: [], stations: [] }));
    }
    g.stations.push(s);
    const room = plan.rooms.find((r) => r.id === s.room)?.name;
    if (room && !g.rooms.includes(room)) g.rooms.push(room);
  }
  return [...by.values()].sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section) || a.name.localeCompare(b.name));
}

/** Where to stand to play a station: on its players' side, a step back from its edge. */
export function standAt(s: Placement): { x: number; z: number } {
  const d = s.fp.depth / 2 + 0.75;
  return { x: s.x + Math.sin(s.yaw) * d, z: s.z + Math.cos(s.yaw) * d };
}

/** How long a path is from the point nearest (x, z) on it to its end, and that point's place along it. */
export function along(path: readonly Pt[], x: number, z: number): { at: number; left: number; off: number } {
  let total = 0;
  let best = Infinity;
  let at = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const t = len > 1e-9 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (len * len))) : 0;
    const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
    if (d < best) {
      best = d;
      at = total + len * t;
    }
    total += len;
  }
  if (path.length === 1) best = Math.hypot(path[0]!.x - x, path[0]!.z - z);
  return { at, left: Math.max(0, total - at), off: best };
}

/** The point `s` metres along a path, and the way it goes there (unit), into `out`. */
function pointAlong(path: readonly Pt[], s: number, out: { x: number; z: number; dx: number; dz: number }): void {
  let rest = s;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (rest <= len || i + 2 === path.length) {
      const t = len > 1e-9 ? Math.max(0, Math.min(1, rest / len)) : 0;
      out.x = a.x + (b.x - a.x) * t;
      out.z = a.z + (b.z - a.z) * t;
      out.dx = len > 1e-9 ? (b.x - a.x) / len : 0;
      out.dz = len > 1e-9 ? (b.z - a.z) / len : 1;
      return;
    }
    rest -= len;
  }
  const p = path[path.length - 1] ?? { x: 0, z: 0 };
  out.x = p.x;
  out.z = p.z;
  out.dx = 0;
  out.dz = 1;
}

/** "24 m", "6 m", "here": to the nearest metre close up, the nearest five further off. */
export function distanceText(m: number): string {
  if (m < 1.5) return 'here';
  return `${m < 12 ? Math.round(m) : Math.round(m / 5) * 5} m`;
}

/** The trail on the floor: how far ahead it reaches, the chevrons' spacing, and how fast they drift (m/s). */
const TRAIL_AHEAD = 13;
const TRAIL_START = 1.1;
const TRAIL_GAP = 0.8;
const TRAIL_DRIFT = 0.55;
const TRAIL_MAX = Math.ceil(TRAIL_AHEAD / TRAIL_GAP) + 2;
/** Arrived beside a station within this (m); further off the line than this, the way is found again. */
const ARRIVE_M = 1.4;
const STRAY_M = 1.8;
/** Seconds the chip says you're there before it goes. */
const THERE_S = 3;
/** The trail's brass (added onto the floor: darker is fainter). */
const TRAIL_COLOR = new THREE.Color('#ffcf7a').multiplyScalar(0.9);

/** A chevron lying on the floor pointing +z (the way to go), 0.34 m across. */
function chevron(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0.13);
  s.lineTo(0.17, -0.05);
  s.lineTo(0.11, -0.1);
  s.lineTo(0, 0.02);
  s.lineTo(-0.11, -0.1);
  s.lineTo(-0.17, -0.05);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  // the shape is drawn in x/y: lay it on the floor, its point toward +z
  g.rotateX(Math.PI / 2);
  g.scale(1, 1, -1);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  return g;
}

/** The trail itself: one instanced mesh, the chevrons placed along the path each frame it's shown. */
class Trail {
  readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly c = new THREE.Color();
  private readonly at = { x: 0, z: 0, dx: 0, dz: 1 };
  private drift = 0;

  constructor(parent: THREE.Object3D) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    mat.name = 'route-trail';
    this.mesh = new THREE.InstancedMesh(chevron(), mat, TRAIL_MAX);
    this.mesh.name = 'route-trail';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    this.mesh.setColorAt(0, this.c.setRGB(0, 0, 0));
    parent.add(this.mesh);
  }

  /** Lay the chevrons ahead of `from` metres along the path (none: hidden). */
  place(path: readonly Pt[] | null, from: number, left: number, dt: number, still: boolean): void {
    if (!path || path.length < 2) {
      this.mesh.visible = false;
      return;
    }
    this.drift = still ? 0 : (this.drift + dt * TRAIL_DRIFT) % TRAIL_GAP;
    const end = from + Math.min(left, TRAIL_AHEAD);
    let n = 0;
    for (let s = from + TRAIL_START + this.drift; s < end && n < TRAIL_MAX; s += TRAIL_GAP) {
      pointAlong(path, s, this.at);
      // in from nothing near you, out to nothing at the trail's far end
      const k = smoothstep(Math.min(1, (s - from - TRAIL_START) / 1.2)) * smoothstep(Math.min(1, (end - s) / 2.4));
      if (k <= 0.01) continue;
      this.q.setFromAxisAngle(this.up, Math.atan2(this.at.dx, this.at.dz));
      this.p.set(this.at.x, 0.018, this.at.z);
      this.mesh.setMatrixAt(n, this.m.compose(this.p, this.q, this.s));
      this.mesh.setColorAt(n, this.c.copy(TRAIL_COLOR).multiplyScalar(k));
      n++;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

/** An arrow pointing up (the way you look), for the chip; turned toward the way to go. */
function arrowIcon(): SVGSVGElement {
  const s = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, 'ico map-way-arrow');
  s.append(svgEl('path', { d: 'M12 3.5l6.5 13-6.5-3.6-6.5 3.6z' }));
  return s;
}

function closeIcon(): SVGSVGElement {
  const s = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, 'ico');
  s.append(svgEl('path', { d: 'M6.5 6.5l11 11M17.5 6.5l-11 11' }));
  return s;
}

export class MapOverlay {
  private sheet: Sheet | null = null;
  private readonly button: HTMLButtonElement;
  private youEl: SVGGElement | null = null;
  private roomsEl = new Map<string, SVGRectElement>();
  private caption: HTMLElement | null = null;
  private picked: string | null = null;
  private here = '';
  private hudCheck = 0;
  private alt: ElsewhereMap | null = null;
  /** 1.3: everyone else, on whichever map is open (usePeople). */
  private people: (() => MapPerson[]) | null = null;
  private peopleEl: SVGGElement | null = null;
  private peopleWait = 0;
  // --- v8: the way there ---
  /** Where the trail on the floor hangs (the world adds it to the floor). */
  readonly guide = new THREE.Group();
  private grid: NavGrid | null = null;
  private trail: Trail | null = null;
  private route: { dest: Destination; path: Pt[] | null; again: number; there: number } | null = null;
  private chip: { root: HTMLElement; arrow: SVGSVGElement; to: HTMLElement; far: HTMLElement; text: string; turn: number } | null = null;
  /** The open map's own parts for the way: the line, each station's shape (by placement id), the games list. */
  private routeEl: SVGPolylineElement | null = null;
  private stationEls = new Map<string, SVGRectElement>();
  private tab: 'rooms' | 'games' = 'rooms';
  private pickedGame: string | null = null;
  private readonly look = new THREE.Vector3();
  private readonly ahead = { x: 0, z: 0, dx: 0, dz: 1 };

  private readonly offKeys: () => void;

  constructor(private readonly deps: MapDeps) {
    const b = el('button', 'hud-btn map-btn');
    b.type = 'button';
    this.offKeys = keyed(() => {
      b.title = `Map (${keyLabel('map')})`;
      b.setAttribute('aria-label', `Map of the casino (${keyLabel('map')})`);
    });
    b.append(mapIcon());
    b.addEventListener('click', () => this.toggle());
    this.button = b;
    this.guide.name = 'route';
    addEventListener('keydown', this.onKey);
  }

  get open(): boolean {
    return this.sheet !== null;
  }

  /** 1.3: who else is where you are, for the map to show them (null with no floor to ask). */
  usePeople(fn: (() => MapPerson[]) | null): void {
    this.people = fn;
  }

  /** v8: the walkable floor the way is found over (the floor's life builds it: life/nav.ts). */
  useGrid(grid: NavGrid | null): void {
    this.grid = grid;
  }

  /** v8: where the way leads now, or null. */
  get destination(): Destination | null {
    return this.route?.dest ?? null;
  }

  /** v8: the way as it's worked out now (for the checks), or null. */
  get way(): readonly Pt[] | null {
    return this.route?.path ?? null;
  }

  toggle(): void {
    if (this.sheet) this.close();
    else this.show();
  }

  /**
   * Open the map. Read at a directory board it opens as the Floor Directory: wider, the plan
   * beside a legend of every room and what's in it, as the board has (a click on either lights
   * the room up). v8: both have the rooms and Find a game beside the plan, and a way to either.
   */
  show(directory = false, tab?: 'rooms' | 'games'): void {
    if (this.sheet) return;
    // v6 city6: out of the casino, where you are
    const alt = directory ? null : (this.deps.elsewhere?.() ?? null);
    if (alt) {
      const sheet = openSheet(this.deps.ui, { title: alt.title, subtitle: '', cls: 'map-sheet', onClose: () => this.closed() });
      this.sheet = sheet;
      this.alt = alt;
      this.button.setAttribute('aria-pressed', 'true');
      sheet.body.append(alt.body);
      this.youEl = alt.you;
      sheet.panel.addEventListener('keydown', (e) => {
        if (isKey(e, 'map') && !modified(e) && !isTyping(e)) {
          e.preventDefault();
          this.close();
        }
      });
      this.here = '';
      this.update(0);
      return;
    }
    if (tab) this.tab = tab;
    else if (directory) this.tab = 'rooms';
    const sheet = openSheet(this.deps.ui, { title: directory ? 'Floor Directory' : 'Casino Map', subtitle: '', cls: directory ? 'map-sheet map-directory' : 'map-sheet', onClose: () => this.closed() });
    this.sheet = sheet;
    this.button.setAttribute('aria-pressed', 'true');
    this.caption = el('div', 'map-caption');
    this.caption.setAttribute('aria-live', 'polite');
    const plan = el('div', 'map-plan');
    plan.append(this.draw(), this.caption);
    sheet.body.append(plan, this.side());
    // the map key closes it again from inside the panel (the sheet keeps other keys to itself)
    sheet.panel.addEventListener('keydown', (e) => {
      if (isKey(e, 'map') && !modified(e) && !isTyping(e)) {
        e.preventDefault();
        this.close();
      }
    });
    this.here = '';
    this.update(0);
    // what you're on your way to, else where you are
    const going = this.route?.dest;
    const game = going && !going.room ? gameSpots(this.deps.plan).find((g) => g.name === going.name) : undefined;
    if (game) this.pickGame(game.key, false);
    else this.pick(going?.room ?? this.here);
    this.drawRoute();
  }

  close(): void {
    this.sheet?.close();
  }

  /**
   * v8: show the way to somewhere: on the floor and the map, the chip naming it. Null stops. False
   * when there's no way there from here (or no floor to find it over).
   */
  go(dest: Destination | null): boolean {
    if (!dest) {
      this.stop();
      return true;
    }
    const you = this.deps.you();
    const path = this.grid?.path({ x: you.x, z: you.z }, { x: dest.x, z: dest.z }) ?? null;
    if (!path) return false;
    this.route = { dest, path, again: 1.5, there: 0 };
    this.ensureChip();
    this.paintChip(true);
    this.drawRoute();
    return true;
  }

  /** v8: the way to the nearest of a game's tables or machines (by the walk there). */
  goToGame(key: string): boolean {
    const g = gameSpots(this.deps.plan).find((x) => x.key === key);
    if (!g || !this.grid) return false;
    const you = this.deps.you();
    // the three nearest as the crow flies, then the shortest walk of those
    const near = g.stations
      .map((s) => ({ s, at: standAt(s) }))
      .sort((a, b) => Math.hypot(a.at.x - you.x, a.at.z - you.z) - Math.hypot(b.at.x - you.x, b.at.z - you.z))
      .slice(0, 3);
    let best: { at: { x: number; z: number }; len: number } | null = null;
    for (const n of near) {
      const p = this.grid.path({ x: you.x, z: you.z }, n.at);
      if (!p) continue;
      const len = pathLength(p);
      if (!best || len < best.len) best = { at: n.at, len };
    }
    return best ? this.go({ name: g.name, x: best.at.x, z: best.at.z }) : false;
  }

  /** v8: the way into a room (through its nearest door). */
  goToRoom(id: string): boolean {
    const r = this.deps.plan.rooms.find((q) => q.id === id);
    if (!r) return false;
    const at = this.roomEntry(r);
    return this.go({ name: r.name.startsWith('The ') ? r.name : `the ${r.name}`, x: at.x, z: at.z, room: r.id });
  }

  /** Stop showing the way. */
  stop(): void {
    this.route = null;
    this.trail?.place(null, 0, 0, 0, true);
    this.chip?.root.remove();
    this.chip = null;
    this.drawRoute();
  }

  /**
   * "Read the directory" in front of a directory board (Interact's spot provider): E opens the
   * board's plan big, as the Map, where you are shown live and a click on a room says what's
   * there.
   */
  spots = (p: { x: number; z: number }): Spot[] => {
    const out: Spot[] = [];
    for (const f of this.deps.plan.furniture) {
      if (f.kind !== 'directory') continue;
      const nx = Math.sin(f.yaw);
      const nz = Math.cos(f.yaw);
      const ahead = (p.x - f.x) * nx + (p.z - f.z) * nz;
      if (ahead < 0.1) continue;
      // the nearest point of the board's face
      const along = Math.max(-DIRECTORY_W / 2, Math.min(DIRECTORY_W / 2, (p.x - f.x) * nz - (p.z - f.z) * nx));
      const x = f.x + along * nz;
      const z = f.z - along * nx;
      const d = Math.max(0, Math.hypot(p.x - x, p.z - z) - 0.5);
      if (d <= 1.4) out.push({ key: `directory:${f.n}`, x, z, d, label: 'Read the directory', use: () => this.show(true) });
    }
    return out;
  };

  /** Every frame: you on the map while it's open; the HUD's button once there is a HUD; the way. */
  update(dt: number): void {
    this.hudCheck -= dt;
    if (this.hudCheck <= 0) {
      this.hudCheck = 0.5;
      const bar = document.querySelector('.hud .hud-right');
      if (bar && this.button.parentElement !== bar) bar.insertBefore(this.button, bar.querySelector('.hud-btn'));
    }
    this.follow(dt);
    if (!this.sheet || !this.youEl) return;
    if ((this.peopleWait -= dt) <= 0) {
      this.peopleWait = 0.25;
      this.drawPeople();
    }
    const you = this.deps.you();
    // Object3D yaw turns +z toward +x; on the map +z is down, so the arrow turns the other way
    this.youEl.setAttribute('transform', `translate(${you.x.toFixed(2)} ${you.z.toFixed(2)}) rotate(${((-you.heading * 180) / Math.PI).toFixed(1)})`);
    // v6 city6: somewhere else says where you are itself
    if (this.alt) {
      const here = this.alt.here(you.x, you.z);
      if (here !== this.here) {
        this.here = here;
        this.sheet.sub.textContent = here;
        this.sheet.sub.hidden = !here;
      }
      return;
    }
    const here = roomAt(this.deps.plan, you.x, you.z)?.id ?? '';
    if (here !== this.here) {
      this.here = here;
      const r = this.deps.plan.rooms.find((q) => q.id === here);
      this.sheet.sub.textContent = r ? `You are in ${r.name.startsWith('The ') ? '' : 'the '}${r.name}` : '';
      this.sheet.sub.hidden = !r;
      for (const [id, rect] of this.roomsEl) rect.classList.toggle('here', id === here);
    }
  }

  dispose(): void {
    this.offKeys();
    this.close();
    this.stop();
    this.trail?.dispose();
    this.guide.removeFromParent();
    this.button.remove();
    removeEventListener('keydown', this.onKey);
  }

  /** v8: the way, each frame it's shown: arrived yet, found again if you've wandered off it, the trail and the chip. */
  private follow(dt: number): void {
    const r = this.route;
    if (!r) return;
    const state = this.deps.route?.() ?? 'on';
    if (state === 'off') {
      this.stop();
      return;
    }
    const you = this.deps.you();
    if (r.there > 0) {
      r.there -= dt;
      this.trail?.place(null, 0, 0, 0, true);
      if (r.there <= 0) this.stop();
      return;
    }
    const inside = r.dest.room ? roomAt(this.deps.plan, you.x, you.z)?.id === r.dest.room : false;
    if (inside || (!r.dest.room && Math.hypot(you.x - r.dest.x, you.z - r.dest.z) < ARRIVE_M)) {
      // there: the chip says so for a moment
      r.there = THERE_S;
      r.path = null;
      this.paintChip(true);
      this.drawRoute();
      return;
    }
    let pos = r.path ? along(r.path, you.x, you.z) : null;
    r.again -= dt;
    // wandered off the line (or there was none): worked out again from here, now and then
    if ((!pos || pos.off > STRAY_M) && r.again <= 0) {
      r.again = 1.5;
      r.path = this.grid?.path({ x: you.x, z: you.z }, { x: r.dest.x, z: r.dest.z }) ?? r.path;
      pos = r.path ? along(r.path, you.x, you.z) : null;
      this.drawRoute();
    }
    const shown = state === 'on' && !!pos && !!r.path;
    if (this.chip && this.chip.root.hidden === shown) this.chip.root.hidden = !shown;
    if (!shown || !pos) {
      this.trail?.place(null, 0, 0, 0, true);
      return;
    }
    (this.trail ??= new Trail(this.guide)).place(r.path, pos.at, pos.left, dt, calm());
    this.paintChip(false, pos);
  }

  /** The chip under the HUD: where to, how far, which way (and Stop). */
  private ensureChip(): void {
    if (this.chip) return;
    const root = el('div', 'map-way');
    root.setAttribute('role', 'status');
    const arrow = arrowIcon();
    const to = el('span', 'map-way-to');
    const far = el('span', 'map-way-far');
    const stop = el('button', 'map-way-stop');
    stop.type = 'button';
    stop.setAttribute('aria-label', 'Stop showing the way');
    stop.title = 'Stop showing the way';
    stop.append(closeIcon());
    stop.addEventListener('click', () => this.stop());
    root.append(arrow, to, far, stop);
    this.deps.ui.append(root);
    this.chip = { root, arrow, to, far, text: '', turn: Number.NaN };
  }

  /** Write the chip: only what changed (the distance in steps, the arrow in 10 degree steps). */
  private paintChip(fresh: boolean, pos?: { at: number; left: number }): void {
    const c = this.chip;
    const r = this.route;
    if (!c || !r) return;
    const there = r.there > 0;
    const text = there ? `You're at ${r.dest.name}` : `${r.dest.name}`;
    if (fresh || text !== c.text) {
      c.text = text;
      c.to.textContent = text;
      c.root.classList.toggle('there', there);
    }
    const far = there || !pos ? '' : distanceText(pos.left);
    if (c.far.textContent !== far) c.far.textContent = far;
    if (there || !pos || !r.path) {
      c.arrow.style.visibility = there ? 'hidden' : '';
      return;
    }
    c.arrow.style.visibility = '';
    // which way the next stretch goes, from the way the camera looks
    const cam = this.deps.camera;
    if (!cam) return;
    const p = this.ahead;
    pointAlong(r.path, pos.at + 2.5, p);
    const you = this.deps.you();
    cam.getWorldDirection(this.look);
    const want = Math.atan2(p.x - you.x, p.z - you.z);
    const facing = Math.atan2(this.look.x, this.look.z);
    let turn = ((facing - want) * 180) / Math.PI;
    turn = ((((turn + 180) % 360) + 360) % 360) - 180;
    const step = Math.round(turn / 10) * 10;
    if (step !== c.turn) {
      c.turn = step;
      c.arrow.style.transform = `rotate(${step}deg)`;
    }
  }

  /** A room's way in: a step inside its door nearest you, else its middle. */
  private roomEntry(r: PlannedRoom): { x: number; z: number } {
    const you = this.deps.you();
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    for (const d of this.deps.plan.doors) {
      if (d.a !== r.id && d.b !== r.id) continue;
      const mid = (d.a0 + d.a1) / 2;
      const door = d.axis === 'x' ? { x: mid, z: d.c } : { x: d.c, z: mid };
      // a step into the room from the door
      const into = d.axis === 'x' ? { x: door.x, z: door.z + (r.cz > door.z ? 1.2 : -1.2) } : { x: door.x + (r.cx > door.x ? 1.2 : -1.2), z: door.z };
      if (this.grid && !this.grid.isClear(into.x, into.z)) continue;
      const dd = Math.hypot(into.x - you.x, into.z - you.z);
      if (dd < bestD) {
        bestD = dd;
        best = into;
      }
    }
    return best ?? { x: r.cx, z: r.cz };
  }

  /** 1.3: a dot and a name for everyone else on this map, under you (redrawn a few times a second). */
  private drawPeople(): void {
    const you = this.youEl;
    if (!you?.parentNode) return;
    if (!this.peopleEl || this.peopleEl.parentNode !== you.parentNode) {
      this.peopleEl?.remove();
      this.peopleEl = svgEl('g', {}, 'map-people');
      you.parentNode.insertBefore(this.peopleEl, you);
    }
    // sized from your own dot, so each map's scale fits
    const r = Number(you.querySelector('circle:not(.map-you-halo)')?.getAttribute('r') ?? 0.55);
    const list = this.people?.() ?? [];
    const g = this.peopleEl;
    g.replaceChildren();
    for (const p of list) {
      const dot = svgEl('g', { transform: `translate(${p.x.toFixed(2)} ${p.z.toFixed(2)})` }, 'map-person');
      const title = svgEl('title');
      title.textContent = p.name;
      const name = svgEl('text', { y: (-r * 1.9).toFixed(2), 'font-size': (r * 2.1).toFixed(2), 'text-anchor': 'middle' });
      name.textContent = p.name;
      dot.append(title, svgEl('circle', { r: (r * 0.85).toFixed(2), 'stroke-width': (r * 0.3).toFixed(2) }), name);
      g.append(dot);
    }
    if (this.sheet) this.sheet.panel.dataset.people = String(list.length);
  }

  private closed(): void {
    this.peopleEl = null;
    this.peopleWait = 0;
    this.sheet = null;
    this.alt = null;
    this.youEl = null;
    this.roomsEl.clear();
    this.stationEls.clear();
    this.routeEl = null;
    this.caption = null;
    this.button.setAttribute('aria-pressed', 'false');
  }

  /** The plan as an SVG in the floor's own metres: north up, south (the doors) down. */
  private draw(): SVGSVGElement {
    const plan = this.deps.plan;
    const R = plan.room;
    const pad = 0.6;
    const svg = svgEl('svg', { viewBox: `${R.x0 - pad} ${R.z0 - pad} ${R.x1 - R.x0 + 2 * pad} ${R.z1 - R.z0 + 2 * pad}`, role: 'img', 'aria-label': 'The casino floor, north at the top' }, 'map-svg');
    const rooms = svgEl('g');
    for (const r of plan.rooms) {
      const rect = svgEl('rect', { x: r.bounds.x0, y: r.bounds.z0, width: r.bounds.x1 - r.bounds.x0, height: r.bounds.z1 - r.bounds.z0, fill: TINT[r.id] ?? '#444' }, 'map-room');
      rect.addEventListener('click', () => this.pick(r.id));
      rooms.append(rect);
      this.roomsEl.set(r.id, rect);
    }
    const stations = svgEl('g', {}, 'map-stations');
    for (const s of plan.stations) {
      const rect = svgEl('rect', { x: -s.fp.width / 2, y: -s.fp.depth / 2, width: s.fp.width, height: s.fp.depth, rx: Math.min(0.3, s.fp.depth / 3), transform: `translate(${s.x} ${s.z}) rotate(${((-s.yaw * 180) / Math.PI).toFixed(1)})` });
      stations.append(rect);
      this.stationEls.set(s.id, rect);
    }
    const walls = svgEl('g', {}, 'map-walls');
    for (const p of plan.wallPieces) {
      if (p.y0 > 0) continue;
      walls.append(p.axis === 'x' ? svgEl('line', { x1: p.a0, y1: p.c, x2: p.a1, y2: p.c }) : svgEl('line', { x1: p.c, y1: p.a0, x2: p.c, y2: p.a1 }));
    }
    const glass = svgEl('g', {}, 'map-glass');
    for (const w of plan.windows) glass.append(w.axis === 'x' ? svgEl('line', { x1: w.a0, y1: w.c, x2: w.a1, y2: w.c }) : svgEl('line', { x1: w.c, y1: w.a0, x2: w.c, y2: w.a1 }));
    const labels = svgEl('g', {}, 'map-labels');
    for (const r of plan.rooms) labels.append(...this.label(r));
    // the entrance, marked
    const d = plan.door;
    const entry = svgEl('g', {}, 'map-entry');
    entry.append(svgEl('path', { d: `M ${(d.x0 + d.x1) / 2} ${d.z + 0.2} l -0.8 1.1 h 1.6 z` }));
    // v8: the way, when one is shown (under you)
    const route = svgEl('polyline', { points: '' }, 'map-route');
    this.routeEl = route;
    const you = svgEl('g', {}, 'map-you');
    you.append(svgEl('circle', { r: 1.3 }, 'map-you-halo'), svgEl('circle', { r: 0.55 }), svgEl('path', { d: 'M 0 1.6 L -0.55 0.45 L 0.55 0.45 Z' }));
    this.youEl = you;
    svg.append(rooms, stations, walls, glass, labels, entry, route, you);
    return svg;
  }

  /** v8: the way on the open map, or none. */
  private drawRoute(): void {
    const line = this.routeEl;
    if (!line) return;
    const path = this.route?.path;
    line.setAttribute('points', path ? path.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`).join(' ') : '');
    line.classList.toggle('on', !!path);
  }

  /** v8: beside the plan, the rooms (the board's legend) and Find a game, as two tabs. */
  private side(): HTMLElement {
    const side = el('div', 'map-side');
    const tabs = el('div', 'map-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Rooms or games');
    const panel = el('div', 'map-tabpanel');
    panel.setAttribute('role', 'tabpanel');
    panel.id = `map-panel-${++mapSeq}`;
    const make = (id: 'rooms' | 'games', label: string) => {
      const b = el('button', 'map-tab', label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', panel.id);
      b.addEventListener('click', () => show(id));
      return b;
    };
    const buttons = { rooms: make('rooms', 'Rooms'), games: make('games', 'Find a game') };
    const show = (id: 'rooms' | 'games') => {
      this.tab = id;
      for (const [k, b] of Object.entries(buttons)) {
        b.setAttribute('aria-selected', String(k === id));
        b.tabIndex = k === id ? 0 : -1;
      }
      panel.replaceChildren(id === 'rooms' ? this.legend() : this.games());
    };
    // the arrow keys move between the two, as a tab list does
    tabs.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const next = this.tab === 'rooms' ? 'games' : 'rooms';
      show(next);
      buttons[next].focus();
    });
    tabs.append(buttons.rooms, buttons.games);
    side.append(tabs, panel);
    show(this.tab);
    return side;
  }

  /** Every room, A to Z, with its colour and what's there: the board's legend, readable. */
  private legend(): HTMLElement {
    const list = el('ol', 'map-legend');
    for (const r of [...this.deps.plan.rooms].sort((a, b) => a.name.localeCompare(b.name))) {
      const { games, about } = roomContents(this.deps.plan, r.id);
      const item = el('li', 'map-legend-room');
      const pick = el('button', 'map-legend-pick');
      pick.type = 'button';
      pick.dataset.room = r.id;
      const swatch = el('span', 'map-swatch');
      swatch.style.background = TINT[r.id] ?? '#444';
      pick.append(swatch, el('span', 'map-legend-name', r.name));
      pick.addEventListener('click', () => this.pick(r.id));
      item.append(pick);
      if (about) item.append(el('p', 'map-legend-what', about));
      if (games.length) item.append(el('p', 'map-legend-games', games.join(' · ')));
      list.append(item);
    }
    return list;
  }

  /** v8: Find a game: every game in the building by section, the rooms it's in and how far the nearest is. */
  private games(): HTMLElement {
    const box = el('div', 'map-games-list');
    const you = this.deps.you();
    for (const section of SECTIONS) {
      const spots = gameSpots(this.deps.plan).filter((g) => g.section === section);
      if (!spots.length) continue;
      box.append(el('h3', 'map-games-head', section));
      const list = el('ul', 'map-games-section');
      for (const g of spots) {
        const near = Math.min(...g.stations.map((s) => Math.hypot(s.x - you.x, s.z - you.z)));
        const item = el('li');
        const b = el('button', 'map-game');
        b.type = 'button';
        b.dataset.game = g.key;
        b.setAttribute('aria-pressed', String(this.pickedGame === g.key));
        b.append(el('span', 'map-game-name', g.name), el('span', 'map-game-where', g.rooms.join(' · ')), el('span', 'map-game-far', distanceText(near)));
        b.addEventListener('click', () => this.pickGame(g.key));
        item.append(b);
        list.append(item);
      }
      box.append(list);
    }
    return box;
  }

  private label(r: PlannedRoom): SVGTextElement[] {
    const w = r.bounds.x1 - r.bounds.x0;
    const words = r.name.toUpperCase().split(' ');
    const size = Math.min(1.05, w / 9);
    const one = words.join(' ');
    // about 0.72 of the size per letter in Cinzel's capitals
    const lines = one.length * size * 0.72 < w * 0.9 ? [one] : [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')];
    return lines.map((l, i) => {
      const t = svgEl('text', { x: r.cx, y: r.cz + (i - (lines.length - 1) / 2) * size * 1.2, 'font-size': size.toFixed(2), 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
      t.textContent = l;
      return t;
    });
  }

  /** Light a room up and say what's in it, with the way there (v8). */
  private pick(id: string): void {
    this.picked = id;
    this.pickedGame = null;
    this.mark(null);
    for (const [rid, rect] of this.roomsEl) rect.classList.toggle('on', rid === id);
    const cap = this.caption;
    if (!cap) return;
    cap.replaceChildren();
    const r = this.deps.plan.rooms.find((q) => q.id === id);
    if (!r) {
      cap.append(el('p', 'map-hint', 'Pick a room on the plan or in the list, or a game under Find a game, to see the way there.'));
      return;
    }
    const { games, about } = roomContents(this.deps.plan, id);
    const head = el('div', 'map-cap-head');
    head.append(el('h3', 'map-name', r.name));
    const you = this.deps.you();
    const inside = roomAt(this.deps.plan, you.x, you.z)?.id === id;
    if (inside) head.append(el('span', 'map-cap-note', 'You are here'));
    else if (this.route?.dest.room === id) head.append(this.stopButton(() => this.pick(id)));
    else head.append(this.wayButton(`Show the way to ${r.name}`, () => this.goToRoom(id)));
    cap.append(head);
    if (about) cap.append(el('p', 'map-about', about));
    if (games.length) cap.append(el('p', 'map-games', games.join(' · ')));
  }

  /** v8: light a game's tables or machines up, say where they are, and offer the way to the nearest. */
  private pickGame(key: string, scroll = true): void {
    const g = gameSpots(this.deps.plan).find((x) => x.key === key);
    if (!g) return;
    this.pickedGame = key;
    this.picked = null;
    for (const rect of this.roomsEl.values()) rect.classList.remove('on');
    this.mark(g);
    const list = this.sheet?.body.querySelectorAll<HTMLButtonElement>('.map-game');
    list?.forEach((b) => {
      const on = b.dataset.game === key;
      b.setAttribute('aria-pressed', String(on));
      if (on && scroll) b.scrollIntoView?.({ block: 'nearest' });
    });
    const cap = this.caption;
    if (!cap) return;
    cap.replaceChildren();
    const head = el('div', 'map-cap-head');
    const going = this.route && !this.route.dest.room && this.route.dest.name === g.name;
    head.append(el('h3', 'map-name', g.name), going ? this.stopButton(() => this.pickGame(key, false)) : this.wayButton(`Show the way to ${g.name}`, () => this.goToGame(key)));
    cap.append(head);
    const kind = g.section === 'Machines' ? (g.stations.length === 1 ? 'machine' : 'machines') : g.section === 'Online lounge' ? (g.stations.length === 1 ? 'computer' : 'computers') : g.stations.length === 1 ? 'table' : 'tables';
    cap.append(el('p', 'map-about', `${g.stations.length} ${kind} in ${listOf(g.rooms.map((n) => (n.startsWith('The ') ? n : `the ${n}`)))}`));
  }

  /** The way's button in the caption: shows the way and closes the map; says so if there's none. */
  private wayButton(label: string, go: () => boolean): HTMLButtonElement {
    const b = el('button', 'btn primary map-way-go', 'Show the way');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => {
      if (go()) this.close();
      else {
        b.disabled = true;
        b.textContent = 'No way from here';
      }
    });
    return b;
  }

  /** v8: in the caption of where the way already leads: it says so, and Stop ends it (then `again` redraws the caption). */
  private stopButton(again: () => void): HTMLElement {
    const box = el('span', 'map-cap-going');
    const b = el('button', 'btn map-way-go', 'Stop');
    b.type = 'button';
    b.setAttribute('aria-label', 'Stop showing the way');
    b.addEventListener('click', () => {
      this.stop();
      again();
    });
    box.append(el('span', 'map-cap-note', 'On the way'), b);
    return box;
  }

  /** Light up one game's stations on the plan (null: none). */
  private mark(g: GameSpot | null): void {
    const on = new Set(g?.stations.map((s) => s.id) ?? []);
    for (const [id, rect] of this.stationEls) rect.classList.toggle('on', on.has(id));
  }

  private onKey = (e: KeyboardEvent): void => {
    // (a press the panel's own listener used to close it comes on up here too: not a new open)
    if (!isKey(e, 'map') || e.repeat || e.defaultPrevented || modified(e) || isTyping(e)) return;
    if (this.sheet) return; // the panel's own listener closes it
    if (overlayCount() > 0 || (this.deps.canOpen && !this.deps.canOpen())) return;
    e.preventDefault();
    this.show();
  };
}

let mapSeq = 0;

/** "a", "a and b", "a, b and c". */
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
