// The garage across the street: a showroom with a glass front on the street, a polished floor,
// light strips overhead, and a bay for every car there is. Everyone sees their own collection in
// it (it's drawn for the viewer, from what they own): the dearest car turns on the turntable in the
// middle, the rest stand on plinths down the walls with a plaque each, and the bays still to fill
// have their plaque with the car's name and "Buy at the valet". Someone else walking in sees their
// own cars in the same bays.
//
// The building doesn't depend on the street's light: its walls and ceiling are lit in their own
// colours (the way a showroom is lit all over), the floor shines with the room's reflections, and
// the cars' paint and chrome carry the environment.

import * as THREE from 'three';
import { CARS, carItem } from '../../../../shared/src/items.ts';
import { formatMoney } from '../../../../shared/src/money.ts';
import type { Box, Collider, Post } from '../collision.ts';
import type { CarMaterials } from './materials.ts';
import { MatBatch, carKit, type CarMat } from './models.ts';
import { GARAGE, GARAGE_LOT, collection, type Bay } from './layout.ts';

const G = GARAGE;
const WALL = 0.3;
/** The plaques' atlas: 4 x 4 cells. */
const CELL = 256;
const GRID = 4;

/** A plinth's size, and where its plaque stands (in front of the car's nose). */
const PLINTH = { w: 3.1, d: 5.9, h: 0.08 };
const TURNTABLE_R = 3.3;

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

/** A basic (self-lit) piece: its colour in the vertices, a little darker lower down (fake light from above). */
function lit(b: THREE.BufferGeometry, color: string, top: number): THREE.BufferGeometry {
  const g = b.index ? b.toNonIndexed() : b;
  for (const n of Object.keys(g.attributes)) if (n !== 'position') g.deleteAttribute(n);
  const p = g.getAttribute('position');
  const c = new Float32Array(p.count * 3);
  const base = new THREE.Color(color);
  for (let i = 0; i < p.count; i++) {
    const k = 0.72 + 0.28 * THREE.MathUtils.clamp(p.getY(i) / top, 0, 1);
    c[i * 3] = base.r * k;
    c[i * 3 + 1] = base.g * k;
    c[i * 3 + 2] = base.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

export interface GarageDeps {
  mats: CarMaterials;
  col: Collider;
  aniso: number;
  env: THREE.Texture | null;
}

export class Garage {
  readonly group = new THREE.Group();
  /** The per-person part: cars, plaques, the hero on its turntable. */
  private readonly shown = new THREE.Group();
  private readonly turntable = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];
  private shownGeos: THREE.BufferGeometry[] = [];
  private readonly plaqueCanvas: HTMLCanvasElement;
  private readonly plaqueTex: THREE.CanvasTexture;
  private readonly plaqueMat: THREE.MeshBasicMaterial;
  private readonly nameCanvas: HTMLCanvasElement;
  private readonly nameTex: THREE.CanvasTexture;
  private carCols: (Box | Post)[] = [];
  private key = '';
  private name = '';

  constructor(private readonly deps: GarageDeps) {
    this.group.name = 'garage';
    this.group.add(this.shown, this.turntable);
    this.buildShell();
    const [pc] = canvas(CELL * GRID, CELL * GRID);
    this.plaqueCanvas = pc;
    this.plaqueTex = texture(pc, deps.aniso);
    this.plaqueMat = new THREE.MeshBasicMaterial({ map: this.plaqueTex });
    const [nc] = canvas(1024, 256);
    this.nameCanvas = nc;
    this.nameTex = texture(nc, deps.aniso);
    this.disposables.push(this.plaqueTex, this.plaqueMat, this.nameTex);
    this.buildNameWall();
    this.set([], '');
  }

  /** The shell: floor, walls, the glass front with its door, the ceiling and its lights, the plinths. */
  private buildShell(): void {
    const basic = new MatBatch();
    const self: THREE.BufferGeometry[] = [];
    const wallC = '#d8d2c6';
    const add = (geo: THREE.BufferGeometry, color: string) => self.push(lit(geo, color, G.height));
    const cx = (G.x0 + G.x1) / 2;
    const cz = (G.z0 + G.z1) / 2;
    const W = G.x1 - G.x0;
    const D = G.z1 - G.z0;
    // walls: the back, the two ends, and the front's solid base and top over the glass
    add(new THREE.BoxGeometry(WALL, G.height, D).translate(G.x1, G.height / 2, cz), wallC);
    add(new THREE.BoxGeometry(W, G.height, WALL).translate(cx, G.height / 2, G.z0), wallC);
    add(new THREE.BoxGeometry(W, G.height, WALL).translate(cx, G.height / 2, G.z1), wallC);
    add(new THREE.BoxGeometry(WALL, 0.9, D).translate(G.x0, G.height - 0.45, cz), '#1c1d20');
    // the outside: the fascia over the glass and the roof's edge, dark stone
    add(new THREE.BoxGeometry(0.2, 1.1, D + 0.6).translate(G.x0 - 0.25, G.height - 0.35, cz), '#24262a');
    add(new THREE.BoxGeometry(W + 0.6, 0.3, D + 0.6).translate(cx, G.height + 0.15, cz), '#2a2c30');
    // the ceiling, and a dark reveal round its edge
    add(new THREE.BoxGeometry(W, 0.12, D).translate(cx, G.height - 0.06, cz), '#e9e5dd');
    for (let i = 0; i < 6; i++) {
      const z = G.z0 + 3 + (i * (D - 6)) / 5;
      // a light strip let into the ceiling
      basic.add('glow', new THREE.BoxGeometry(W - 4, 0.012, 0.3).translate(cx, G.height - 0.124, z), '#fff4e2');
    }
    // the glass front: mullions every 2.4 m, the door's gap, its two leaves slid open
    const doorA = G.doorZ - G.doorW / 2;
    const doorB = G.doorZ + G.doorW / 2;
    const glassY = (G.height - 0.9) / 2;
    const glassH = G.height - 0.9;
    const glass: THREE.BufferGeometry[] = [];
    for (const [a, b] of [[G.z0, doorA], [doorB, G.z1]] as const) {
      glass.push(new THREE.BoxGeometry(0.03, glassH, b - a).translate(G.x0, glassY, (a + b) / 2));
      for (let z = a; z <= b + 1e-6; z += (b - a) / Math.max(1, Math.round((b - a) / 2.4))) basic.add('trim', new THREE.BoxGeometry(0.12, glassH, 0.1).translate(G.x0, glassY, z), '#1a1b1e');
    }
    basic.add('metal', new THREE.BoxGeometry(0.16, 0.14, G.doorW + 0.2).translate(G.x0, glassH - 0.07, G.doorZ), '#9a9ea4');
    for (const s of [-1, 1]) {
      glass.push(new THREE.BoxGeometry(0.03, glassH - 0.2, G.doorW / 2).translate(G.x0 + 0.16, glassY - 0.1, G.doorZ + s * (G.doorW / 2 + G.doorW / 4 - 0.1)));
      basic.add('metal', new THREE.BoxGeometry(0.05, glassH - 0.2, 0.05).translate(G.x0 + 0.16, glassY - 0.1, G.doorZ + s * (G.doorW / 2 + 0.05)), '#9a9ea4');
    }
    // the plinths and the turntable's base
    for (const bay of collection([]).map((c) => c.bay)) {
      if (bay.hero) {
        add(new THREE.CylinderGeometry(TURNTABLE_R + 0.25, TURNTABLE_R + 0.3, 0.04, 48).translate(bay.x, 0.02, bay.z), '#141416');
        basic.add('trim', new THREE.TorusGeometry(TURNTABLE_R + 0.26, 0.02, 6, 64).rotateX(Math.PI / 2).translate(bay.x, 0.04, bay.z), '#8f7032');
        continue;
      }
      const m = new THREE.Matrix4().makeRotationY(bay.yaw).setPosition(bay.x, 0, bay.z);
      add(new THREE.BoxGeometry(PLINTH.w, PLINTH.h, PLINTH.d).translate(0, PLINTH.h / 2, 0).applyMatrix4(m), '#17181b');
      // a brass-coloured edge round its top (satin, so it doesn't flare in the strip lights)
      for (const sx of [-1, 1]) basic.add('trim', new THREE.BoxGeometry(0.03, 0.03, PLINTH.d + 0.03).translate((sx * PLINTH.w) / 2, PLINTH.h - 0.01, 0), '#8f7032', m);
      for (const sz of [-1, 1]) basic.add('trim', new THREE.BoxGeometry(PLINTH.w + 0.03, 0.03, 0.03).translate(0, PLINTH.h - 0.01, (sz * PLINTH.d) / 2), '#8f7032', m);
      // the plaque's lectern, at the nose end
      const lm = new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(0, 0, PLINTH.d / 2 + 0.55));
      basic.add('trim', new THREE.BoxGeometry(0.06, 0.9, 0.06).translate(0, 0.45, 0), '#1c1d20', lm);
      basic.add('trim', new THREE.BoxGeometry(0.5, 0.36, 0.04).rotateX(-0.6).translate(0, 0.98, 0.05), '#1c1d20', lm);
      this.deps.col.post(new THREE.Vector3(0, 0, 0).applyMatrix4(lm).x, new THREE.Vector3(0, 0, 0).applyMatrix4(lm).z, 0.18, 1.1, { cam: false });
    }
    const selfGeo = mergeLit(self);
    const selfMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.group.add(new THREE.Mesh(selfGeo, selfMat));
    this.disposables.push(selfGeo, selfMat);
    for (const [m, geo] of basic.build()) {
      this.group.add(new THREE.Mesh(geo, this.deps.mats.get(m as CarMat)));
      this.disposables.push(geo);
    }
    const glassGeo = mergeLit(glass.map((g) => lit(g, '#ffffff', 1)));
    const glassMat = new THREE.MeshStandardMaterial({ color: '#a9bcc6', transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.2, envMap: this.deps.env, envMapIntensity: 1, depthWrite: false });
    const glassMesh = new THREE.Mesh(glassGeo, glassMat);
    glassMesh.renderOrder = 2;
    this.group.add(glassMesh);
    this.disposables.push(glassGeo, glassMat);
    this.buildFloor();
    this.buildSign();
    // walls stop the walker and the camera; the door's gap lets you in
    const col = this.deps.col;
    col.box(G.x1, cz, WALL, D, 0, G.height);
    col.box(cx, G.z0, W, WALL, 0, G.height);
    col.box(cx, G.z1, W, WALL, 0, G.height);
    col.box(G.x0, (G.z0 + doorA) / 2, WALL, doorA - G.z0, 0, G.height);
    col.box(G.x0, (doorB + G.z1) / 2, WALL, G.z1 - doorB, 0, G.height);
  }

  /** Polished concrete in big squares, lit by its own colour, shining with the room's reflections. */
  private buildFloor(): void {
    const [c, g] = canvas(1024, 1024);
    g.fillStyle = '#3b3936';
    g.fillRect(0, 0, 1024, 1024);
    let seed = 5;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 9000; i++) {
      const v = 52 + Math.floor(rnd() * 14);
      g.fillStyle = `rgba(${v},${v - 2},${v - 4},0.5)`;
      g.fillRect(rnd() * 1024, rnd() * 1024, 2, 2);
    }
    g.strokeStyle = 'rgba(20,19,18,0.8)';
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, 1021, 1021);
    const tex = texture(c, this.deps.aniso);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const W = G.x1 - G.x0;
    const D = G.z1 - G.z0;
    tex.repeat.set(W / 2.4, D / 2.4);
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.55, roughness: 0.32, metalness: 0, envMap: this.deps.env, envMapIntensity: 0.14 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), mat);
    floor.position.set((G.x0 + G.x1) / 2, 0.015, (G.z0 + G.z1) / 2);
    this.group.add(floor);
    // the forecourt between the sidewalk and the glass: pale stone
    const lot = GARAGE_LOT;
    const [fc, fg] = canvas(256, 256);
    fg.fillStyle = '#8d8a84';
    fg.fillRect(0, 0, 256, 256);
    fg.strokeStyle = '#6f6c66';
    fg.lineWidth = 2;
    fg.strokeRect(1, 1, 254, 254);
    const ft = texture(fc, this.deps.aniso);
    ft.wrapS = ft.wrapT = THREE.RepeatWrapping;
    // from the city's sidewalk (it ends at the lot's edge) to the glass
    const fw = G.x0 - lot.x0;
    ft.repeat.set(fw / 1.2, (lot.z1 - lot.z0) / 1.2);
    const fmat = new THREE.MeshStandardMaterial({ map: ft, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    const fore = new THREE.Mesh(new THREE.PlaneGeometry(fw, lot.z1 - lot.z0).rotateX(-Math.PI / 2), fmat);
    fore.position.set(lot.x0 + fw / 2, 0.01, (lot.z0 + lot.z1) / 2);
    this.group.add(fore);
    this.disposables.push(tex, mat, floor.geometry, ft, fmat, fore.geometry);
  }

  /** The name over the glass, on the street side: brass capitals on the dark fascia. */
  private buildSign(): void {
    const [c, g] = canvas(1024, 128);
    g.fillStyle = '#24262a';
    g.fillRect(0, 0, 1024, 128);
    g.fillStyle = '#d6b25e';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '600 64px "Playfair Display", Georgia, serif';
    g.fillText('T H E   G A R A G E', 512, 60);
    const tex = texture(c, this.deps.aniso);
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.5), mat);
    sign.position.set(G.x0 - 0.37, G.height - 0.35, (G.z0 + G.z1) / 2);
    sign.rotation.y = -Math.PI / 2;
    this.group.add(sign);
    this.disposables.push(tex, mat, sign.geometry);
  }

  /** The back wall's lettering: whose collection this is, and how much of it there is. */
  private buildNameWall(): void {
    const mat = new THREE.MeshBasicMaterial({ map: this.nameTex, transparent: true });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), mat);
    wall.position.set(G.x1 - WALL / 2 - 0.02, 3.6, (G.z0 + G.z1) / 2);
    wall.rotation.y = -Math.PI / 2;
    this.group.add(wall);
    this.disposables.push(mat, wall.geometry);
  }

  private paintName(n: number): void {
    const g = this.nameCanvas.getContext('2d')!;
    g.clearRect(0, 0, 1024, 256);
    g.textAlign = 'center';
    g.fillStyle = '#2a2622';
    g.font = '500 30px "Inter", Arial, sans-serif';
    g.fillText('T H E   C O L L E C T I O N   O F', 512, 70);
    g.fillStyle = '#1b1814';
    g.font = '600 92px "Playfair Display", Georgia, serif';
    g.fillText(this.name || 'Our Guest', 512, 160);
    g.fillStyle = '#6d6252';
    g.font = '500 30px "Inter", Arial, sans-serif';
    g.fillText(n ? `${n} of ${CARS.length} cars` : 'No cars yet. The valet sells them, across the street.', 512, 220);
    this.nameTex.needsUpdate = true;
  }

  /** Show this person's cars (ids they own; anything that isn't a car is ignored). */
  set(owned: readonly string[], name: string): void {
    const cars = owned.filter((id) => carItem(id));
    const key = `${name}|${[...cars].sort().join(',')}`;
    if (key === this.key) return;
    this.key = key;
    this.name = name;
    // the old display and its colliders out
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
    const batch = new MatBatch();
    const hero = new MatBatch();
    for (const { bay, car, owned: have } of layout) {
      if (!have) continue;
      const k = carKit(car);
      if (bay.hero) {
        hero.car({ id: car, matrix: new THREE.Matrix4().makeTranslation(0, 0.1, 0) });
        this.carCols.push(col.post(bay.x, bay.z, Math.min(2.7, k.length / 2), k.height));
      } else {
        batch.car({ id: car, matrix: new THREE.Matrix4().makeRotationY(bay.yaw).setPosition(bay.x, PLINTH.h, bay.z) });
        this.carCols.push(col.box(bay.x, bay.z, k.width, k.length, bay.yaw, k.height));
      }
    }
    for (const [m, geo] of batch.build()) {
      this.shown.add(new THREE.Mesh(geo, this.deps.mats.get(m)));
      this.shownGeos.push(geo);
    }
    const heroBay = layout[0]!.bay;
    this.turntable.position.set(heroBay.x, 0, heroBay.z);
    this.turntable.rotation.y = heroBay.yaw;
    // the turntable's disc turns with the car on it
    const disc = new MatBatch().add('trim', new THREE.CylinderGeometry(TURNTABLE_R, TURNTABLE_R, 0.06, 64).translate(0, 0.07, 0), '#1d1e22');
    for (let i = 0; i < 24; i++) disc.add('metal', new THREE.BoxGeometry(0.02, 0.005, TURNTABLE_R * 0.9).translate(0, 0.102, TURNTABLE_R * 0.45).applyMatrix4(new THREE.Matrix4().makeRotationY((i / 24) * Math.PI * 2)), '#6d6a64');
    for (const b of [disc, hero])
      for (const [m, geo] of b.build()) {
        this.turntable.add(new THREE.Mesh(geo, this.deps.mats.get(m)));
        this.shownGeos.push(geo);
      }
    this.paintPlaques(layout);
    this.paintName(cars.length);
  }

  /** Every bay's plaque, drawn into the atlas and set on its lectern (the turntable's on its rim). */
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
      // where the plaque goes: on the lectern (tilted towards the aisle) or on the turntable's rim
      const m = new THREE.Matrix4();
      if (bay.hero) {
        m.makeTranslation(bay.x - TURNTABLE_R - 0.9, 0, bay.z).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
        m.multiply(new THREE.Matrix4().makeTranslation(0, 0.95, 0));
      } else {
        m.makeRotationY(bay.yaw).setPosition(bay.x, 0, bay.z);
        // just proud of the lectern's board (its face tilts back 0.6 rad)
        m.multiply(new THREE.Matrix4().makeTranslation(0, 0.98 + 0.03 * Math.sin(0.6), PLINTH.d / 2 + 0.6 + 0.03 * Math.cos(0.6))).multiply(new THREE.Matrix4().makeRotationX(-0.6));
      }
      const q = new THREE.PlaneGeometry(0.46, 0.33).applyMatrix4(m);
      const p = q.toNonIndexed().getAttribute('position');
      const u = q.toNonIndexed().getAttribute('uv');
      for (let k = 0; k < p.count; k++) {
        v.push(p.getX(k), p.getY(k), p.getZ(k));
        uv.push((cx + u.getX(k) * CELL) / (CELL * GRID), 1 - (cy + (1 - u.getY(k)) * CELL * 0.72) / (CELL * GRID));
      }
    });
    this.plaqueTex.needsUpdate = true;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    this.shown.add(new THREE.Mesh(geo, this.plaqueMat));
    this.shownGeos.push(geo);
    // the hero's plaque needs a stand too
    const hero = layout[0]!.bay;
    const stand = new MatBatch().add('trim', new THREE.BoxGeometry(0.06, 0.8, 0.06).translate(hero.x - TURNTABLE_R - 0.9, 0.4, hero.z), '#1c1d20').build();
    for (const [m, geo2] of stand) {
      this.shown.add(new THREE.Mesh(geo2, this.deps.mats.get(m)));
      this.shownGeos.push(geo2);
    }
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

function mergeLit(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  for (const g of list) {
    const p = g.getAttribute('position');
    const c = g.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      col.push(c.getX(i), c.getY(i), c.getZ(i));
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}
