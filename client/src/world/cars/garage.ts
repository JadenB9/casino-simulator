// The garage across the street: a showroom with a glass front on the street, drawn for whoever is
// looking from what they own. Walk in and your dearest car turns on a turntable ahead of you; the
// rest stand in a grid of lit plinths behind it, aisles between them, each under its own spot with
// a plaque; the bays still to fill have their plaque with "Buy at the valet". A lounge sits in the
// corner by the glass, dark oak slats run along the back wall under your name, and a warm cove of
// light runs round the ceiling.
//
// Nothing here is lit by real lights: the walls, ceiling and plinths carry their light in their
// colours, the polished floor is baked with the spots' pools and the cars' reflections (repainted
// when the collection changes) and shines with the room's reflections, and the cars reflect a
// showroom of their own (soft boxes overhead), which is what lights paint and chrome here.

import * as THREE from 'three';
import { CARS, carItem } from '../../../../shared/src/items.ts';
import { formatMoney } from '../../../../shared/src/money.ts';
import type { Quality } from '../../render/engine3d.ts';
import type { Box, Collider, Post } from '../collision.ts';
import { CarMaterials } from './materials.ts';
import { MatBatch, carKit, type CarMat } from './models.ts';
import { CAR_SPECS } from './specs.ts';
import { GARAGE, GARAGE_LOT, LOUNGE, collection, type Bay } from './layout.ts';

const G = GARAGE;
const WALL = 0.3;
const W = G.x1 - G.x0;
const D = G.z1 - G.z0;
const CX = (G.x0 + G.x1) / 2;
const CZ = (G.z0 + G.z1) / 2;
/** The plaques' atlas: 4 x 4 cells. */
const CELL = 256;
const GRID = 4;
const PLINTH = { w: 3.2, d: 6.3, h: 0.1 };
const TURNTABLE_R = 3.3;
/** The floor's bake: pixels per metre. */
const FLOOR_PX = 56;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function texture(c: HTMLCanvasElement, aniso: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

/** A self-lit piece: its colour in the vertices, a gradient from `low` to `high` metres (light from the cove above). */
function lit(b: THREE.BufferGeometry, color: string, k0 = 0.7, k1 = 1): THREE.BufferGeometry {
  const g = b.index ? b.toNonIndexed() : b;
  for (const n of Object.keys(g.attributes)) if (n !== 'position') g.deleteAttribute(n);
  const p = g.getAttribute('position');
  const c = new Float32Array(p.count * 3);
  const base = new THREE.Color(color);
  for (let i = 0; i < p.count; i++) {
    const k = k0 + (k1 - k0) * THREE.MathUtils.clamp(p.getY(i) / G.height, 0, 1);
    c[i * 3] = base.r * k;
    c[i * 3 + 1] = base.g * k;
    c[i * 3 + 2] = base.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function mergeLit(list: THREE.BufferGeometry[], alpha = false): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  for (const g of list) {
    const p = g.getAttribute('position');
    const c = g.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      if (alpha) col.push(c.getX(i), c.getY(i), c.getZ(i), c.getW(i));
      else col.push(c.getX(i), c.getY(i), c.getZ(i));
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, alpha ? 4 : 3));
  out.computeBoundingSphere();
  return out;
}

/**
 * The showroom the cars reflect: a dark room with long soft boxes overhead and a warm band round
 * the walls, prefiltered once.
 */
function showroomEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(30, 12, 30), new THREE.MeshBasicMaterial({ color: '#0d0c0b', side: THREE.BackSide }));
  room.position.y = 5;
  scene.add(room);
  const panel = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.8, 4.5) });
  for (const x of [-5, 0, 5]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 14), panel);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, 10.8, 0);
    scene.add(m);
  }
  const warm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.1, 0.6) });
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(30, 1.2), warm);
    m.rotation.y = (i * Math.PI) / 2;
    m.position.set(Math.sin(m.rotation.y) * -14.9, 7.5, Math.cos(m.rotation.y) * -14.9);
    scene.add(m);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#2a2622' }));
  scene.add(floor);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.geometry.dispose();
  });
  panel.dispose();
  warm.dispose();
  return env;
}

export interface GarageDeps {
  col: Collider;
  aniso: number;
  renderer: THREE.WebGLRenderer;
  quality: Quality;
  /** The street's car materials (for the fittings in brass and chrome). */
  mats: CarMaterials;
}

export class Garage {
  readonly group = new THREE.Group();
  /** The cars in here reflect the showroom, not the street. */
  readonly carMats: CarMaterials;
  private readonly shown = new THREE.Group();
  private readonly turntable = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];
  private shownGeos: THREE.BufferGeometry[] = [];
  private readonly env: THREE.Texture;
  private readonly plaqueCanvas: HTMLCanvasElement;
  private readonly plaqueTex: THREE.CanvasTexture;
  private readonly plaqueMat: THREE.MeshBasicMaterial;
  private readonly nameCanvas: HTMLCanvasElement;
  private readonly nameTex: THREE.CanvasTexture;
  private readonly floorCanvas: HTMLCanvasElement;
  private readonly floorTex: THREE.CanvasTexture;
  private carCols: (Box | Post)[] = [];
  private key = '';
  private name = '';
  /** Your dearest car and where it stands, for the camera as you walk in (null: none yet). */
  best: { car: string; bay: Bay } | null = null;

  constructor(private readonly deps: GarageDeps) {
    this.group.name = 'garage';
    this.env = showroomEnv(deps.renderer);
    this.carMats = new CarMaterials(deps.quality, this.env);
    this.group.add(this.shown, this.turntable);
    [this.plaqueCanvas] = canvas(CELL * GRID, CELL * GRID);
    this.plaqueTex = texture(this.plaqueCanvas, deps.aniso);
    this.plaqueMat = new THREE.MeshBasicMaterial({ map: this.plaqueTex });
    [this.nameCanvas] = canvas(1024, 256);
    this.nameTex = texture(this.nameCanvas, deps.aniso);
    [this.floorCanvas] = canvas(Math.round(W * FLOOR_PX), Math.round(D * FLOOR_PX));
    this.floorTex = texture(this.floorCanvas, deps.aniso);
    this.disposables.push(this.plaqueTex, this.plaqueMat, this.nameTex, this.floorTex, this.carMats, this.env);
    this.buildShell();
    this.set([], '');
  }

  private buildShell(): void {
    const self: THREE.BufferGeometry[] = [];
    const add = (geo: THREE.BufferGeometry, color: string, k0 = 0.62, k1 = 1) => self.push(lit(geo, color, k0, k1));
    const fit = new MatBatch();
    const doorA = G.doorZ - G.doorW / 2;
    const doorB = G.doorZ + G.doorW / 2;
    // the side walls in warm plaster, washed with light from the cove (lighter up top), pilasters
    add(new THREE.BoxGeometry(W, G.height, WALL).translate(CX, G.height / 2, G.z0), '#cfc3ae', 0.55, 1);
    add(new THREE.BoxGeometry(W, G.height, WALL).translate(CX, G.height / 2, G.z1), '#cfc3ae', 0.55, 1);
    for (let x = G.x0 + 4; x < G.x1 - 1; x += 4)
      for (const [z, s] of [[G.z0 + WALL / 2, 1], [G.z1 - WALL / 2, -1]] as const) add(new THREE.BoxGeometry(0.5, G.height, 0.14).translate(x, G.height / 2, z + s * 0.07), '#bfb29b', 0.5, 0.95);
    // the back wall: dark oak slats floor to ceiling, the whole width
    add(new THREE.BoxGeometry(WALL, G.height, D).translate(G.x1, G.height / 2, CZ), '#1d140d');
    for (let z = G.z0 + 0.3; z < G.z1 - 0.2; z += 0.22) add(new THREE.BoxGeometry(0.05, G.height - 0.4, 0.1).translate(G.x1 - WALL / 2 - 0.035, (G.height - 0.4) / 2 + 0.1, z), '#6a4a2f', 0.45, 1.05);
    // the glass front's frame over the glass and outside: a dark fascia, the roof's edge
    add(new THREE.BoxGeometry(WALL, 0.9, D).translate(G.x0, G.height - 0.45, CZ), '#17181b');
    add(new THREE.BoxGeometry(0.2, 1.1, D + 0.6).translate(G.x0 - 0.25, G.height - 0.35, CZ), '#1c1d21');
    add(new THREE.BoxGeometry(W + 0.6, 0.3, D + 0.6).translate(CX, G.height + 0.15, CZ), '#222428');
    // a dark ceiling, and a cove of warm light round its edge
    add(new THREE.BoxGeometry(W, 0.12, D).translate(CX, G.height - 0.06, CZ), '#1a191b', 1, 1);
    for (const [x, z, w, d] of [[CX, G.z0 + WALL / 2 + 0.12, W - 0.6, 0.12], [CX, G.z1 - WALL / 2 - 0.12, W - 0.6, 0.12], [G.x1 - WALL / 2 - 0.12, CZ, 0.12, D - 0.6]] as const)
      fit.add('glow', new THREE.BoxGeometry(w, 0.05, d).translate(x, G.height - 0.25, z), '#9a7a52');
    // the glass: mullions every 2.4 m, the door's gap and its leaves slid open
    const glassY = (G.height - 0.9) / 2;
    const glassH = G.height - 0.9;
    const glass: THREE.BufferGeometry[] = [];
    for (const [a, b] of [[G.z0, doorA], [doorB, G.z1]] as const) {
      glass.push(lit(new THREE.BoxGeometry(0.03, glassH, b - a).translate(G.x0, glassY, (a + b) / 2), '#ffffff', 1, 1));
      const n = Math.max(1, Math.round((b - a) / 2.4));
      for (let i = 0; i <= n; i++) fit.add('trim', new THREE.BoxGeometry(0.1, glassH, 0.08).translate(G.x0, glassY, a + ((b - a) * i) / n), '#121315');
    }
    fit.add('metal', new THREE.BoxGeometry(0.14, 0.12, G.doorW + 0.2).translate(G.x0, glassH - 0.06, G.doorZ), '#8a8d92');
    for (const s of [-1, 1]) glass.push(lit(new THREE.BoxGeometry(0.03, glassH - 0.2, G.doorW / 2).translate(G.x0 + 0.16, glassY - 0.1, G.doorZ + s * (G.doorW * 0.75)), '#ffffff', 1, 1));
    // the bays: lit plinths with a brass edge and a glow under their lip; the turntable's base
    for (const { bay } of collection([])) {
      const m = new THREE.Matrix4().makeRotationY(bay.yaw).setPosition(bay.x, 0, bay.z);
      if (bay.hero) {
        add(new THREE.CylinderGeometry(TURNTABLE_R + 0.25, TURNTABLE_R + 0.3, 0.05, 64).translate(bay.x, 0.025, bay.z), '#0f0f11', 1, 1);
        fit.add('glow', new THREE.TorusGeometry(TURNTABLE_R + 0.31, 0.012, 4, 96).rotateX(Math.PI / 2).translate(bay.x, 0.01, bay.z), '#8c6a3c');
        continue;
      }
      add(new THREE.BoxGeometry(PLINTH.w, PLINTH.h, PLINTH.d).translate(0, PLINTH.h / 2 + 0.02, 0).applyMatrix4(m), '#141416', 1, 1);
      for (const sx of [-1, 1]) fit.add('trim', new THREE.BoxGeometry(0.03, 0.025, PLINTH.d + 0.03).translate((sx * PLINTH.w) / 2, PLINTH.h + 0.015, 0), '#8f7032', m);
      for (const sz of [-1, 1]) fit.add('trim', new THREE.BoxGeometry(PLINTH.w + 0.03, 0.025, 0.03).translate(0, PLINTH.h + 0.015, (sz * PLINTH.d) / 2), '#8f7032', m);
      fit.add('glow', new THREE.BoxGeometry(PLINTH.w - 0.1, 0.012, PLINTH.d - 0.1).translate(0, 0.012, 0), '#6e5234', m);
      // the plaque's stand, beside the front wheel on the aisle side
      const lm = new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(PLINTH.w / 2 + 0.55, 0, 1.2));
      fit.add('trim', new THREE.BoxGeometry(0.05, 0.9, 0.05).translate(0, 0.45, 0), '#1c1d20', lm);
      fit.add('trim', new THREE.BoxGeometry(0.04, 0.36, 0.5).rotateZ(0.6).translate(0.05, 0.98, 0), '#1c1d20', lm);
      const lp = new THREE.Vector3().applyMatrix4(lm);
      this.deps.col.post(lp.x, lp.z, 0.16, 1.1, { cam: false });
    }
    // a spot over every bay: the fitting in the ceiling and its lamp
    for (const { bay } of collection([])) {
      fit.add('trim', new THREE.CylinderGeometry(0.2, 0.2, 0.1, 16).translate(bay.x, G.height - 0.17, bay.z), '#0c0c0d');
      fit.add('glow', new THREE.CircleGeometry(0.14, 16).rotateX(Math.PI / 2).translate(bay.x, G.height - 0.225, bay.z), '#fff1dc');
    }
    // the lounge in the corner by the glass: a rug, two sofas facing over a low table, a lamp, a palm
    const L = LOUNGE;
    const lx = (L.x0 + L.x1) / 2;
    const lz = (L.z0 + L.z1) / 2;
    add(new THREE.BoxGeometry(6.2, 0.012, 5).translate(lx, 0.02, lz), '#3a2a22', 1, 1);
    for (const s of [-1, 1]) {
      fit.add('trim', new THREE.BoxGeometry(3, 0.42, 0.95).translate(lx, 0.21, lz + s * 1.9), '#5b3a26');
      fit.add('trim', new THREE.BoxGeometry(3, 0.5, 0.22).translate(lx, 0.62, lz + s * 2.28), '#4d311f');
      for (const e of [-1, 1]) fit.add('trim', new THREE.BoxGeometry(0.2, 0.3, 0.95).translate(lx + e * 1.4, 0.55, lz + s * 1.9), '#4d311f');
      this.deps.col.box(lx, lz + s * 2, 3.1, 1.1, 0, 0.9, { cam: false });
    }
    fit.add('trim', new THREE.BoxGeometry(1.6, 0.06, 0.9).translate(lx, 0.4, lz), '#101012');
    fit.add('metal', new THREE.BoxGeometry(1.5, 0.37, 0.8).translate(lx, 0.185, lz), '#8f7032');
    this.deps.col.box(lx, lz, 1.7, 1, 0, 0.5, { cam: false });
    fit.add('trim', new THREE.CylinderGeometry(0.4, 0.34, 0.8, 16).translate(L.x1 - 0.8, 0.4, L.z0 + 0.8), '#1f2023');
    fit.add('trim', new THREE.IcosahedronGeometry(0.75, 1).scale(1, 1.6, 1).translate(L.x1 - 0.8, 1.8, L.z0 + 0.8), '#2e4a2b');
    this.deps.col.post(L.x1 - 0.8, L.z0 + 0.8, 0.45, 1.6, { cam: false });
    // a planter in the back corners
    for (const z of [G.z0 + 1.2, G.z1 - 1.2]) {
      fit.add('trim', new THREE.CylinderGeometry(0.45, 0.38, 0.8, 16).translate(G.x1 - 1.2, 0.4, z), '#1f2023');
      fit.add('trim', new THREE.IcosahedronGeometry(0.75, 1).scale(1, 1.5, 1).translate(G.x1 - 1.2, 1.7, z), '#2e4a2b');
      this.deps.col.post(G.x1 - 1.2, z, 0.5, 1.6, { cam: false });
    }

    const selfGeo = mergeLit(self);
    const selfMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.group.add(new THREE.Mesh(selfGeo, selfMat));
    this.disposables.push(selfGeo, selfMat);
    for (const [m, geo] of fit.build()) {
      this.group.add(new THREE.Mesh(geo, this.deps.mats.get(m as CarMat)));
      this.disposables.push(geo);
    }
    const glassGeo = mergeLit(glass);
    const glassMat = new THREE.MeshStandardMaterial({ color: '#a9bcc6', transparent: true, opacity: 0.14, roughness: 0.05, metalness: 0.2, envMap: this.env, envMapIntensity: 0.6, depthWrite: false });
    const glassMesh = new THREE.Mesh(glassGeo, glassMat);
    glassMesh.renderOrder = 2;
    this.group.add(glassMesh);
    this.disposables.push(glassGeo, glassMat);
    this.buildCones();
    this.buildFloor();
    this.buildSign();
    this.buildNameWall();
    // walls stop the walker and the camera; the door's gap lets you in
    const col = this.deps.col;
    col.box(G.x1, CZ, WALL, D, 0, G.height);
    col.box(CX, G.z0, W, WALL, 0, G.height);
    col.box(CX, G.z1, W, WALL, 0, G.height);
    col.box(G.x0, (G.z0 + doorA) / 2, WALL, doorA - G.z0, 0, G.height);
    col.box(G.x0, (doorB + G.z1) / 2, WALL, G.z1 - doorB, 0, G.height);
  }

  /** The spots' beams: a faint cone of light from each fitting down over its bay (one additive mesh). */
  private buildCones(): void {
    const parts: THREE.BufferGeometry[] = [];
    for (const { bay } of collection([])) {
      const h = G.height - 0.3;
      const cone = new THREE.CylinderGeometry(0.16, bay.hero ? 3.2 : 2.4, h, 24, 1, true).translate(bay.x, h / 2 + 0.05, bay.z);
      const g = cone.toNonIndexed();
      for (const n of Object.keys(g.attributes)) if (n !== 'position') g.deleteAttribute(n);
      const p = g.getAttribute('position');
      const c = new Float32Array(p.count * 4);
      for (let i = 0; i < p.count; i++) {
        // brightest at the lamp, gone by the floor
        const a = 0.11 * Math.pow(THREE.MathUtils.clamp(p.getY(i) / G.height, 0, 1), 1.6);
        c.set([1, 0.93, 0.8, a], i * 4);
      }
      g.setAttribute('color', new THREE.BufferAttribute(c, 4));
      parts.push(g);
      cone.dispose();
    }
    const geo = mergeLit(parts, true);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 3;
    this.group.add(mesh);
    this.disposables.push(geo, mat);
  }

  /** The polished floor: its bake (repainted with the collection), lit by itself, shining with the room. */
  private buildFloor(): void {
    const mat = new THREE.MeshStandardMaterial({ map: this.floorTex, emissiveMap: this.floorTex, emissive: '#ffffff', emissiveIntensity: 0.85, roughness: 0.22, metalness: 0, envMap: this.env, envMapIntensity: 0.35 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), mat);
    floor.position.set(CX, 0.015, CZ);
    this.group.add(floor);
    // the forecourt, from the city's sidewalk (it ends at the lot's edge) to the glass: pale stone
    const lot = GARAGE_LOT;
    const [fc, fg] = canvas(256, 256);
    fg.fillStyle = '#8d8a84';
    fg.fillRect(0, 0, 256, 256);
    fg.strokeStyle = '#6f6c66';
    fg.lineWidth = 2;
    fg.strokeRect(1, 1, 254, 254);
    const ft = texture(fc, this.deps.aniso);
    ft.wrapS = ft.wrapT = THREE.RepeatWrapping;
    const fw = G.x0 - lot.x0;
    ft.repeat.set(fw / 1.2, (lot.z1 - lot.z0) / 1.2);
    const fmat = new THREE.MeshStandardMaterial({ map: ft, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    const fore = new THREE.Mesh(new THREE.PlaneGeometry(fw, lot.z1 - lot.z0).rotateX(-Math.PI / 2), fmat);
    fore.position.set(lot.x0 + fw / 2, 0.01, (lot.z0 + lot.z1) / 2);
    this.group.add(fore);
    this.disposables.push(mat, floor.geometry, ft, fmat, fore.geometry);
  }

  /**
   * The floor's bake: dark polished stone in big squares, a warm band along the walls under the
   * cove, a pool of light under every spot, and under each car a soft reflection of its paint.
   */
  private paintFloor(layout: { bay: Bay; car: string; owned: boolean }[]): void {
    const c = this.floorCanvas;
    const g = c.getContext('2d')!;
    const px = (x: number) => (x - G.x0) * FLOOR_PX;
    const pz = (z: number) => (z - G.z0) * FLOOR_PX;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#16140f';
    g.fillRect(0, 0, c.width, c.height);
    // the stone's squares
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 2;
    for (let x = 0; x <= W; x += 1.2) g.strokeRect(px(G.x0 + x), 0, 0, c.height);
    for (let z = 0; z <= D; z += 1.2) g.strokeRect(0, pz(G.z0 + z), c.width, 0);
    g.globalCompositeOperation = 'lighter';
    const glow = (x: number, z: number, r: number, color: string, a: number) => {
      const gr = g.createRadialGradient(px(x), pz(z), 0, px(x), pz(z), r * FLOOR_PX);
      gr.addColorStop(0, color.replace('A', String(a)));
      gr.addColorStop(1, color.replace('A', '0'));
      g.fillStyle = gr;
      g.fillRect(px(x - r), pz(z - r), 2 * r * FLOOR_PX, 2 * r * FLOOR_PX);
    };
    // the cove's light along the walls
    const band = (x0: number, z0: number, x1: number, z1: number, horizontal: boolean) => {
      const gr = horizontal ? g.createLinearGradient(0, pz(z0), 0, pz(z1)) : g.createLinearGradient(px(x0), 0, px(x1), 0);
      gr.addColorStop(0, 'rgba(120,92,58,0.45)');
      gr.addColorStop(1, 'rgba(120,92,58,0)');
      g.fillStyle = gr;
      g.fillRect(px(Math.min(x0, x1)), pz(Math.min(z0, z1)), Math.abs(px(x1) - px(x0)), Math.abs(pz(z1) - pz(z0)));
    };
    band(G.x0, G.z0, G.x1, G.z0 + 2.5, true);
    band(G.x0, G.z1, G.x1, G.z1 - 2.5, true);
    band(G.x1, G.z0, G.x1 - 2.5, G.z1, false);
    for (const { bay, car, owned } of layout) {
      glow(bay.x, bay.z, bay.hero ? 5 : 4, 'rgba(255,232,196,A)', 0.42);
      if (!owned) continue;
      // the car's paint, blurred out across the polish around it
      const paint = new THREE.Color(CAR_SPECS[car]!.gold ? '#d9a93e' : CAR_SPECS[car]!.paint);
      const k = carKit(car);
      g.save();
      g.translate(px(bay.x), pz(bay.z));
      g.rotate(-bay.yaw);
      g.filter = 'blur(18px)';
      g.fillStyle = `rgba(${Math.round(paint.r * 255)},${Math.round(paint.g * 255)},${Math.round(paint.b * 255)},0.55)`;
      g.fillRect((-k.width / 2 - 0.35) * FLOOR_PX, (-k.length / 2 - 0.3) * FLOOR_PX, (k.width + 0.7) * FLOOR_PX, (k.length + 0.6) * FLOOR_PX);
      g.filter = 'none';
      g.restore();
    }
    g.globalCompositeOperation = 'source-over';
    this.floorTex.needsUpdate = true;
  }

  /** The name over the glass, on the street side: brass capitals on the dark fascia. */
  private buildSign(): void {
    const [c, g] = canvas(1024, 128);
    g.fillStyle = '#1c1d21';
    g.fillRect(0, 0, 1024, 128);
    g.fillStyle = '#d6b25e';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '600 64px "Playfair Display", Georgia, serif';
    g.fillText('T H E   G A R A G E', 512, 60);
    const tex = texture(c, this.deps.aniso);
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.5), mat);
    sign.position.set(G.x0 - 0.37, G.height - 0.35, CZ);
    sign.rotation.y = -Math.PI / 2;
    this.group.add(sign);
    this.disposables.push(tex, mat, sign.geometry);
  }

  /** On the slats of the back wall, lit from behind: whose collection this is, and how much of it. */
  private buildNameWall(): void {
    const mat = new THREE.MeshBasicMaterial({ map: this.nameTex, transparent: true });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25), mat);
    wall.position.set(G.x1 - WALL / 2 - 0.1, 3.5, CZ);
    wall.rotation.y = -Math.PI / 2;
    this.group.add(wall);
    this.disposables.push(mat, wall.geometry);
  }

  private paintName(n: number): void {
    const g = this.nameCanvas.getContext('2d')!;
    g.clearRect(0, 0, 1024, 256);
    // a halo behind the letters, as if lit from behind the slats
    const halo = g.createRadialGradient(512, 140, 20, 512, 140, 420);
    halo.addColorStop(0, 'rgba(255,196,120,0.35)');
    halo.addColorStop(1, 'rgba(255,196,120,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, 1024, 256);
    g.textAlign = 'center';
    g.fillStyle = '#e6cf9c';
    g.font = '500 28px "Inter", Arial, sans-serif';
    g.fillText('T H E   C O L L E C T I O N   O F', 512, 70);
    g.fillStyle = '#fff1d0';
    g.font = '600 92px "Playfair Display", Georgia, serif';
    g.fillText(this.name || 'Our Guest', 512, 160, 980);
    g.fillStyle = '#cdb68c';
    g.font = '500 28px "Inter", Arial, sans-serif';
    g.fillText(n ? `${n} of ${CARS.length} cars` : 'No cars yet. The valet across the street sells them.', 512, 220);
    this.nameTex.needsUpdate = true;
  }

  /** Show this person's cars (ids they own; anything that isn't a car is ignored). */
  set(owned: readonly string[], name: string): void {
    const cars = owned.filter((id) => carItem(id));
    const key = `${name}|${[...cars].sort().join(',')}`;
    if (key === this.key) return;
    this.key = key;
    this.name = name;
    for (const g of this.shownGeos) g.dispose();
    this.shownGeos = [];
    this.shown.clear();
    this.turntable.clear();
    const col = this.deps.col;
    for (const c of this.carCols) {
      const list = ('hx' in c ? col.boxes : col.posts) as (Box | Post)[];
      const i = list.indexOf(c);
      if (i >= 0) list.splice(i, 1);
    }
    this.carCols = [];

    const layout = collection(cars);
    this.best = layout[0]!.owned ? { car: layout[0]!.car, bay: layout[0]!.bay } : null;
    const batch = new MatBatch();
    const hero = new MatBatch();
    for (const { bay, car, owned: have } of layout) {
      if (!have) continue;
      const k = carKit(car);
      if (bay.hero) {
        hero.car({ id: car, matrix: new THREE.Matrix4().makeTranslation(0, 0.1, 0) });
        this.carCols.push(col.post(bay.x, bay.z, Math.min(2.7, k.length / 2), k.height));
      } else {
        batch.car({ id: car, matrix: new THREE.Matrix4().makeRotationY(bay.yaw).setPosition(bay.x, PLINTH.h + 0.02, bay.z) });
        this.carCols.push(col.box(bay.x, bay.z, k.width, k.length, bay.yaw, k.height));
      }
    }
    for (const [m, geo] of batch.build()) {
      this.shown.add(new THREE.Mesh(geo, this.carMats.get(m)));
      this.shownGeos.push(geo);
    }
    const heroBay = layout[0]!.bay;
    this.turntable.position.set(heroBay.x, 0, heroBay.z);
    this.turntable.rotation.y = heroBay.yaw;
    const disc = new MatBatch().add('trim', new THREE.CylinderGeometry(TURNTABLE_R, TURNTABLE_R, 0.05, 64).translate(0, 0.075, 0), '#1b1c20');
    for (let i = 0; i < 24; i++) disc.add('metal', new THREE.BoxGeometry(0.02, 0.005, TURNTABLE_R * 0.9).translate(0, 0.1, TURNTABLE_R * 0.45).applyMatrix4(new THREE.Matrix4().makeRotationY((i / 24) * Math.PI * 2)), '#6d6a64');
    for (const [b, mats] of [[disc, this.deps.mats], [hero, this.carMats]] as const)
      for (const [m, geo] of b.build()) {
        this.turntable.add(new THREE.Mesh(geo, mats.get(m)));
        this.shownGeos.push(geo);
      }
    this.paintPlaques(layout);
    this.paintName(cars.length);
    this.paintFloor(layout);
  }

  /** Every bay's plaque, drawn into the atlas and set on its stand (the turntable's beside it). */
  private paintPlaques(layout: { bay: Bay; car: string; owned: boolean }[]): void {
    const g = this.plaqueCanvas.getContext('2d')!;
    const v: number[] = [];
    const uv: number[] = [];
    layout.forEach(({ bay, car, owned }, i) => {
      const item = carItem(car)!;
      const cx = (i % GRID) * CELL;
      const cy = Math.floor(i / GRID) * CELL;
      g.fillStyle = owned ? '#15161a' : '#232428';
      g.fillRect(cx, cy, CELL, CELL * 0.72);
      g.strokeStyle = owned ? '#b8913f' : '#55575c';
      g.lineWidth = 3;
      g.strokeRect(cx + 8, cy + 8, CELL - 16, CELL * 0.72 - 16);
      g.textAlign = 'center';
      g.fillStyle = owned ? '#e8d7ae' : '#a7a39b';
      g.font = '600 25px "Playfair Display", Georgia, serif';
      g.fillText(item.name, cx + CELL / 2, cy + 62, CELL - 30);
      g.font = '500 20px "Inter", Arial, sans-serif';
      g.fillStyle = owned ? '#b8913f' : '#8a8780';
      g.fillText(formatMoney(item.price), cx + CELL / 2, cy + 100, CELL - 30);
      g.fillStyle = owned ? '#8f8a7e' : '#d6b25e';
      g.font = '500 17px "Inter", Arial, sans-serif';
      g.fillText(owned ? 'In your collection' : 'Buy at the valet', cx + CELL / 2, cy + 142, CELL - 30);
      const m = new THREE.Matrix4();
      if (bay.hero) {
        // on its own stand at the turntable's edge, towards the door
        m.makeTranslation(bay.x - TURNTABLE_R - 0.8, 0.95, bay.z - 1.5).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2 - 0.5)).multiply(new THREE.Matrix4().makeRotationX(-0.45));
      } else {
        // on the stand beside the front wheel, tilted up, facing the aisle
        m.makeRotationY(bay.yaw).setPosition(bay.x, 0, bay.z);
        m.multiply(new THREE.Matrix4().makeTranslation(PLINTH.w / 2 + 0.55 + 0.03, 0.98, 1.2)).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)).multiply(new THREE.Matrix4().makeRotationX(-0.6));
      }
      const q = new THREE.PlaneGeometry(0.46, 0.33).applyMatrix4(m).toNonIndexed();
      const p = q.getAttribute('position');
      const u = q.getAttribute('uv');
      for (let k = 0; k < p.count; k++) {
        v.push(p.getX(k), p.getY(k), p.getZ(k));
        uv.push((cx + u.getX(k) * CELL) / (CELL * GRID), 1 - (cy + (1 - u.getY(k)) * CELL * 0.72) / (CELL * GRID));
      }
      q.dispose();
    });
    this.plaqueTex.needsUpdate = true;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    this.shown.add(new THREE.Mesh(geo, this.plaqueMat));
    this.shownGeos.push(geo);
    const hero = layout[0]!.bay;
    const stand = new MatBatch().add('trim', new THREE.BoxGeometry(0.06, 0.8, 0.06).translate(hero.x - TURNTABLE_R - 0.8, 0.4, hero.z - 1.5), '#1c1d20').build();
    for (const [m, geo2] of stand) {
      this.shown.add(new THREE.Mesh(geo2, this.deps.mats.get(m)));
      this.shownGeos.push(geo2);
    }
  }

  /** The camera's view of your dearest car as you walk in: from the aisle, three-quarters on. */
  bestView(): { from: THREE.Vector3; at: THREE.Vector3 } | null {
    if (!this.best) return null;
    const b = this.best.bay;
    return { from: new THREE.Vector3(b.x - 6.2, 2.1, b.z - 3.4), at: new THREE.Vector3(b.x, 0.8, b.z) };
  }

  setQuality(q: Quality): void {
    const old = this.carMats.get('paint');
    this.carMats.setQuality(q);
    const now = this.carMats.get('paint');
    if (old === now) return;
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material === old) m.material = now;
    });
  }

  update(dt: number): void {
    this.turntable.rotation.y += dt * 0.18;
  }

  dispose(): void {
    for (const g of this.shownGeos) g.dispose();
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
