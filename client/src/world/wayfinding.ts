// Finding your way round a bigger casino: the directory board in the lobby (the floor's plan with
// every room named and a "You are here"), and the Map: a panel over the floor (the HUD's map button
// or N) drawing the rooms, their doors and walls, the tables and machines in them, and you, with
// the way you face. Click a room to light it up and read what's there. Both are drawn from the
// floor plan, so a room added to rooms.ts appears on them.

import * as THREE from 'three';
import './map.css';
import { el } from '../ui/kit.ts';
import { isTyping, overlayCount } from '../ui/keyboard.ts';
import { openSheet, type Sheet } from '../ui/menu/sheet.ts';
import { CATALOG } from '../../../shared/src/games/catalog.ts';
import { roomAt, type FloorPlan, type PlannedRoom } from './layout.ts';
import { FURNITURE } from './furniture-spec.ts';
import { stationName } from './stations.ts';

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
    drawPlan(g, plan, 40, 170, W - 80, 560, { x: f.x, z: f.z });
    // the legend: every room and what's in it, two columns
    g.textAlign = 'left';
    const rooms = [...plan.rooms].sort((a, b) => a.name.localeCompare(b.name));
    rooms.forEach((r, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 52 + col * ((W - 104) / 2);
      const y = 770 + row * 34;
      g.fillStyle = TINT[r.id] ?? '#444';
      g.fillRect(x, y - 11, 18, 18);
      g.fillStyle = '#f4efe4';
      g.font = '600 20px "Cinzel", Georgia, serif';
      g.fillText(r.name.toUpperCase(), x + 28, y + 5);
    });
    g.fillStyle = '#ff4b3e';
    g.font = '600 20px "Cinzel", Georgia, serif';
    g.textAlign = 'center';
    g.fillText('★  YOU ARE HERE', W / 2, H - 30);
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

  constructor(private readonly deps: MapDeps) {
    const b = el('button', 'hud-btn map-btn');
    b.type = 'button';
    b.title = 'Map (N)';
    b.setAttribute('aria-label', 'Map of the casino (N)');
    b.append(mapIcon());
    b.addEventListener('click', () => this.toggle());
    this.button = b;
    addEventListener('keydown', this.onKey);
  }

  get open(): boolean {
    return this.sheet !== null;
  }

  toggle(): void {
    if (this.sheet) this.close();
    else this.show();
  }

  show(): void {
    if (this.sheet) return;
    const sheet = openSheet(this.deps.ui, { title: 'Casino Map', subtitle: '', cls: 'map-sheet', onClose: () => this.closed() });
    this.sheet = sheet;
    this.button.setAttribute('aria-pressed', 'true');
    sheet.body.append(this.draw());
    this.caption = el('div', 'map-caption');
    sheet.body.append(this.caption);
    // N closes it again from inside the panel (the sheet keeps other keys to itself)
    sheet.panel.addEventListener('keydown', (e) => {
      if (e.code === 'KeyN' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e)) {
        e.preventDefault();
        this.close();
      }
    });
    this.here = '';
    this.update(0);
    this.pick(this.here);
  }

  close(): void {
    this.sheet?.close();
  }

  /** Every frame: you on the map while it's open; the HUD's button once there is a HUD. */
  update(dt: number): void {
    this.hudCheck -= dt;
    if (this.hudCheck <= 0) {
      this.hudCheck = 0.5;
      const bar = document.querySelector('.hud .hud-right');
      if (bar && this.button.parentElement !== bar) bar.insertBefore(this.button, bar.querySelector('.hud-btn'));
    }
    if (!this.sheet || !this.youEl) return;
    const you = this.deps.you();
    // Object3D yaw turns +z toward +x; on the map +z is down, so the arrow turns the other way
    this.youEl.setAttribute('transform', `translate(${you.x.toFixed(2)} ${you.z.toFixed(2)}) rotate(${((-you.heading * 180) / Math.PI).toFixed(1)})`);
    const here = roomAt(this.deps.plan, you.x, you.z)?.id ?? '';
    if (here !== this.here) {
      this.here = here;
      const r = this.deps.plan.rooms.find((q) => q.id === here);
      this.sheet.sub.textContent = r ? `You are in the ${r.name}` : '';
      this.sheet.sub.hidden = !r;
      for (const [id, rect] of this.roomsEl) rect.classList.toggle('here', id === here);
    }
  }

  dispose(): void {
    this.close();
    this.button.remove();
    removeEventListener('keydown', this.onKey);
  }

  private closed(): void {
    this.sheet = null;
    this.youEl = null;
    this.roomsEl.clear();
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
      stations.append(svgEl('rect', { x: -s.fp.width / 2, y: -s.fp.depth / 2, width: s.fp.width, height: s.fp.depth, rx: Math.min(0.3, s.fp.depth / 3), transform: `translate(${s.x} ${s.z}) rotate(${((-s.yaw * 180) / Math.PI).toFixed(1)})` }));
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
    const you = svgEl('g', {}, 'map-you');
    you.append(svgEl('circle', { r: 1.3 }, 'map-you-halo'), svgEl('circle', { r: 0.55 }), svgEl('path', { d: 'M 0 1.6 L -0.55 0.45 L 0.55 0.45 Z' }));
    this.youEl = you;
    svg.append(rooms, stations, walls, glass, labels, entry, you);
    return svg;
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

  /** Light a room up and say what's in it. */
  private pick(id: string): void {
    this.picked = id;
    for (const [rid, rect] of this.roomsEl) rect.classList.toggle('on', rid === id);
    const cap = this.caption;
    if (!cap) return;
    cap.replaceChildren();
    const r = this.deps.plan.rooms.find((q) => q.id === id);
    if (!r) {
      cap.append(el('p', 'map-hint', 'Click a room to see what’s there.'));
      return;
    }
    const { games, about } = roomContents(this.deps.plan, id);
    cap.append(el('h3', 'map-name', r.name));
    if (about) cap.append(el('p', 'map-about', about));
    if (games.length) cap.append(el('p', 'map-games', games.join(' · ')));
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'KeyN' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
    if (this.sheet) return; // the panel's own listener closes it
    if (overlayCount() > 0 || (this.deps.canOpen && !this.deps.canOpen())) return;
    e.preventDefault();
    this.show();
  };
}
