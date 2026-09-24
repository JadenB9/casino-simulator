// The mini-baccarat table as it stands on the floor: a kidney top in burgundy felt, a padded
// leather rail, a wood apron on two pedestals, the dealing shoe on the dealer's left, the clear
// discard holder on the dealer's right, a chip rack and a lit limit placard. Everything is built in
// code (nothing CC0 exists at this quality, see ASSETS.md §4.3); textures are small canvases,
// shared by every baccarat table on the floor.

import * as THREE from 'three';
import type { Quality } from '../../render/engine3d.ts';
import { Felt } from '../../table/felt.ts';
import { CHIP_R, chipFaceCanvas } from '../../table/chips.ts';
import { CHIPS, formatMoney } from '../../../../shared/src/money.ts';
import { engine } from '../../../../shared/src/games/baccarat/engine.ts';
import type { TableConfig } from '../../../../shared/src/engine.ts';
import { repaintable } from '../../table/limit-sign.ts';
import { feltSpec, kidneyGeometry } from './felt.ts';
import { ARC_OVER, CZ, DISCARD, R_RAIL, RACK, RAIL_TUBE, SHOE, TOP_Y, feltOutline, polar } from './layout.ts';

const FONTS = ['600 32px Cinzel', '600 32px "Barlow Condensed"'];

function fontsReady(): boolean {
  return FONTS.every((f) => document.fonts.check(f));
}

/** Load the felt's fonts; call behind the loading screen so the felt is printed in them. */
export async function loadFonts(): Promise<void> {
  await Promise.all(FONTS.map((f) => document.fonts.load(f))).catch(() => {});
}

/** Run `paint` now, and once more when the fonts arrive if they weren't there yet. */
function paintWithFonts(paint: () => void): void {
  paint();
  if (!fontsReady()) void loadFonts().then(paint);
}

// ---------------------------------------------------------------------------------------------
// Shared materials and textures

let feltMat: THREE.MeshStandardMaterial | null = null;
let woodMat: THREE.MeshStandardMaterial | null = null;
let signTex: THREE.CanvasTexture | null = null;

/** The printed felt for floor tables: one texture for every baccarat table. */
function floorFelt(quality: Quality): THREE.MeshStandardMaterial {
  if (!feltMat) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
    feltMat = mat;
    paintWithFonts(() => {
      const f = new Felt(feltSpec(quality === 'high' ? 1100 : 600));
      const painted = f.mesh.material as THREE.MeshStandardMaterial;
      mat.map?.dispose();
      mat.map = painted.map;
      mat.needsUpdate = true;
      f.mesh.geometry.dispose();
    });
  }
  return feltMat;
}

function wood(): THREE.MeshStandardMaterial {
  if (woodMat) return woodMat;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3a2314';
  g.fillRect(0, 0, 512, 64);
  // long grain lines with a slow wave, a few darker streaks
  for (let i = 0; i < 70; i++) {
    const y0 = (i * 64) / 70 + ((i * 37) % 5) * 0.3;
    g.strokeStyle = i % 7 === 0 ? 'rgba(20, 10, 4, 0.5)' : i % 3 === 0 ? 'rgba(120, 72, 40, 0.28)' : 'rgba(26, 14, 6, 0.22)';
    g.lineWidth = i % 7 === 0 ? 1.4 : 0.8;
    g.beginPath();
    for (let x = 0; x <= 512; x += 16) g.lineTo(x, y0 + Math.sin(x / 70 + i) * 1.6);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 1);
  woodMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.05 });
  return woodMat;
}

const leather = new THREE.MeshStandardMaterial({ color: '#1c1310', roughness: 0.48, metalness: 0.02 });
const blackAcrylic = new THREE.MeshStandardMaterial({ color: '#0d0c0d', roughness: 0.22, metalness: 0.1 });
const clearAcrylic = new THREE.MeshStandardMaterial({ color: '#dfe8ee', roughness: 0.08, metalness: 0, transparent: true, opacity: 0.2, depthWrite: false });
const brass = new THREE.MeshStandardMaterial({ color: '#b8904a', roughness: 0.35, metalness: 0.85 });
const cardEdges = new THREE.MeshStandardMaterial({ color: '#efe9dc', roughness: 0.8 });
const cardBack = new THREE.MeshStandardMaterial({ color: '#8e1f27', roughness: 0.6 });

// ---------------------------------------------------------------------------------------------
// Parts

function top(quality: Quality): THREE.Object3D {
  const g = new THREE.Group();
  const felt = new THREE.Mesh(kidneyGeometry(), floorFelt(quality));
  felt.rotation.x = -Math.PI / 2;
  felt.position.y = TOP_Y;
  felt.name = 'bc-felt-static';
  g.add(felt);

  // the top's body under the felt and rail: the table's outline pushed out under the rail
  const outline = feltOutline(R_RAIL + RAIL_TUBE * 0.7, 64).map(([x, z]) => new THREE.Vector2(x, -z));
  const apron = new THREE.Mesh(
    new THREE.ExtrudeGeometry(new THREE.Shape(outline), { depth: 0.07, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 3, curveSegments: 8 }),
    wood(),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = TOP_Y - 0.086;
  g.add(apron);

  // padded rail: a flattened partial torus around the players' side, capped at the dealer's edge
  const arc = Math.PI + 2 * ARC_OVER;
  const railGeo = new THREE.TorusGeometry(R_RAIL, RAIL_TUBE, 18, quality === 'high' ? 128 : 64, arc);
  railGeo.rotateZ(-ARC_OVER);
  const rail = new THREE.Mesh(railGeo, leather);
  rail.rotation.x = Math.PI / 2;
  rail.scale.z = 0.72;
  rail.position.set(0, TOP_Y + 0.012, CZ);
  g.add(rail);
  for (const a of [-ARC_OVER, Math.PI + ARC_OVER]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(RAIL_TUBE, 18, 12), leather);
    const [x, z] = polar(R_RAIL, a);
    cap.position.set(x, TOP_Y + 0.012, z);
    cap.scale.set(1, 0.72, 1);
    g.add(cap);
  }
  // a thin brass bead where the felt meets the rail
  const beadGeo = new THREE.TorusGeometry(R_RAIL - RAIL_TUBE + 0.002, 0.0028, 6, quality === 'high' ? 128 : 64, arc);
  beadGeo.rotateZ(-ARC_OVER);
  const bead = new THREE.Mesh(beadGeo, brass);
  bead.rotation.x = Math.PI / 2;
  bead.position.set(0, TOP_Y + 0.002, CZ);
  g.add(bead);
  return g;
}

function pedestals(): THREE.Object3D {
  const g = new THREE.Group();
  const h = TOP_Y - 0.1;
  for (const x of [-0.5, 0.5]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, h, 20), wood());
    post.position.set(x, h / 2, -0.06);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.27, 0.035, 32), blackAcrylic);
    base.position.set(x, 0.0175, -0.06);
    g.add(post, base);
  }
  return g;
}

/** A dealing shoe: a black acrylic wedge whose mouth faces the middle of the table. */
function shoe(): THREE.Object3D {
  const g = new THREE.Group();
  const profile = new THREE.Shape([
    new THREE.Vector2(0.1, 0),
    new THREE.Vector2(0.1, 0.1),
    new THREE.Vector2(-0.05, 0.058),
    new THREE.Vector2(-0.1, 0.03),
    new THREE.Vector2(-0.1, 0),
  ]);
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(profile, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 }), blackAcrylic);
  body.position.z = -0.06;
  g.add(body);
  // the next card, face down on the slope behind the mouth, and the brass finger plate
  const slope = Math.atan2(0.058 - 0.03, 0.05);
  const card = new THREE.Mesh(new THREE.PlaneGeometry(0.055, 0.089), cardBack);
  card.rotation.set(-Math.PI / 2, 0, 0);
  const holder = new THREE.Group();
  holder.position.set(-0.075, 0.047, 0);
  holder.rotation.z = slope;
  holder.add(card);
  card.position.y = 0.002;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.004, 0.09), brass);
  plate.position.set(-0.1, 0.03, 0);
  g.add(holder, plate);
  g.position.set(SHOE.x, TOP_Y, SHOE.z);
  g.rotation.y = SHOE.yaw;
  g.name = 'bc-shoe';
  return g;
}

/** The clear discard holder; the view grows the stack inside it as cards are dealt. */
function discard(): THREE.Object3D {
  const g = new THREE.Group();
  const w = 0.078;
  const d = 0.104;
  const h = 0.14;
  const t = 0.004;
  for (const [sx, sz, px, pz] of [[w, t, 0, d / 2], [w, t, 0, -d / 2], [t, d, w / 2, 0], [t, d, -w / 2, 0]] as const) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), clearAcrylic);
    wall.position.set(px, h / 2, pz);
    g.add(wall);
  }
  const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.006, d), blackAcrylic);
  floor.position.y = 0.003;
  g.add(floor);
  const stack = new THREE.Mesh(new THREE.BoxGeometry(0.0635, 1, 0.0889), cardEdges);
  stack.name = 'bc-discard-stack';
  stack.visible = false;
  g.add(stack);
  g.position.set(DISCARD.x, TOP_Y, DISCARD.z);
  g.rotation.y = DISCARD.yaw;
  g.name = 'bc-discard';
  return g;
}

/** Chip rolls lying in the dealer's rack, largest denominations in the middle. */
function rack(): THREE.Object3D {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(RACK.w, 0.028, RACK.d), blackAcrylic);
  base.position.y = 0.014;
  g.add(base);
  const order = [500, 2_500, 10_000, 50_000, 100_000, 100_000, 50_000, 10_000, 2_500, 500];
  const len = RACK.d - 0.014;
  const step = (RACK.w - 0.03) / order.length;
  order.forEach((value, i) => {
    const spec = CHIPS.find((c) => c.value === value)!;
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(CHIP_R, CHIP_R, len, 24), rollMaterials(spec.value, spec.body, spec.spots, Math.round(len / 0.0033)));
    roll.rotation.x = Math.PI / 2;
    roll.position.set(-RACK.w / 2 + 0.015 + step * (i + 0.5), 0.028 + CHIP_R * 0.55, 0);
    g.add(roll);
  });
  g.position.set(RACK.x, TOP_Y, RACK.z);
  return g;
}

const rollCache = new Map<number, THREE.Material[]>();

function rollMaterials(value: number, body: string, spots: string, chips: number): THREE.Material[] {
  const hit = rollCache.get(value);
  if (hit) return hit;
  // one chip's edge, repeated along the roll: body colour, an edge-spot insert, a thin seam
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 16;
  const g = c.getContext('2d')!;
  g.fillStyle = body;
  g.fillRect(0, 0, 64, 16);
  g.fillStyle = spots;
  for (let i = 0; i < 4; i++) g.fillRect(i * 16 + 4, 2, 6, 12);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, 0, 64, 1);
  const side = new THREE.CanvasTexture(c);
  side.colorSpace = THREE.SRGBColorSpace;
  side.wrapS = side.wrapT = THREE.RepeatWrapping;
  side.repeat.set(3, chips);
  const face = new THREE.CanvasTexture(chipFaceCanvas(CHIPS.find((x) => x.value === value)!, 128));
  face.colorSpace = THREE.SRGBColorSpace;
  const mats = [new THREE.MeshStandardMaterial({ map: side, roughness: 0.45 }), new THREE.MeshStandardMaterial({ map: face, roughness: 0.4 }), new THREE.MeshStandardMaterial({ map: face, roughness: 0.4 })];
  rollCache.set(value, mats);
  return mats;
}

/** The lit limit placard standing on the felt at the dealer's left, beside the shoe. */
function limitSign(): THREE.Object3D {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.014, 0.05), blackAcrylic);
  base.position.y = 0.007;
  const panel = new THREE.Group();
  panel.position.set(0, 0.012, 0.004);
  panel.rotation.x = -0.32;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.006), blackAcrylic);
  back.position.y = 0.05;
  if (!signTex) {
    const c = document.createElement('canvas');
    c.width = 600;
    c.height = 380;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    signTex = tex;
    paintWithFonts(() => {
      paintSign(c.getContext('2d')!, engine.config('', 'multi'));
      tex.needsUpdate = true;
    });
  }
  const faceMat = new THREE.MeshStandardMaterial({ map: signTex, emissive: '#ffffff', emissiveMap: signTex, emissiveIntensity: 0.75, roughness: 0.35 });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.152, 0.096), faceMat);
  face.position.set(0, 0.05, 0.0032);
  panel.add(back, face);
  g.add(base, panel);
  g.position.set(0.86, TOP_Y, -0.455);
  g.rotation.y = -0.5;
  repaintable(g, faceMat, { width: 600, height: 380, paint: paintSign });
  return g;
}

/** The sign's face for a table at these limits (the floor's shows the Standard table's). */
function paintSign(g: CanvasRenderingContext2D, cfg: TableConfig): void {
  const c = g.canvas;
  const main = cfg.limits.default;
  g.fillStyle = '#120d0b';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#c9a25a';
  g.lineWidth = 4;
  g.strokeRect(14, 14, c.width - 28, c.height - 28);
  g.textAlign = 'center';
  g.fillStyle = '#f1d59a';
  g.font = '600 64px Cinzel, Georgia, serif';
  g.fillText('BACCARAT', c.width / 2, 100);
  g.fillStyle = '#f4efe4';
  g.font = '600 50px "Barlow Condensed", sans-serif';
  g.fillText(`MIN ${formatMoney(main.min)}   MAX ${formatMoney(main.max)}`, c.width / 2, 185);
  g.fillStyle = '#c9c0ad';
  g.font = '600 32px "Barlow Condensed", sans-serif';
  g.fillText('TIE PAYS 8 TO 1  ·  PAIRS PAY 11 TO 1', c.width / 2, 255);
  g.fillText('5% COMMISSION ON BANKER WINS', c.width / 2, 305);
}

export function buildTable(quality: Quality): THREE.Group {
  const g = new THREE.Group();
  g.name = 'baccarat-table';
  g.add(top(quality), pedestals(), shoe(), discard(), rack(), limitSign());
  return g;
}

/** Set how tall the discard pile is (cards are about 0.3 mm thick). */
export function setDiscardHeight(anchor: THREE.Object3D, cards: number): void {
  const stack = anchor.getObjectByName('bc-discard-stack');
  if (!stack) return;
  const h = Math.max(0, cards) * 0.0003;
  stack.visible = h > 0;
  stack.scale.y = Math.max(h, 0.0001);
  stack.position.y = 0.006 + h / 2;
}
