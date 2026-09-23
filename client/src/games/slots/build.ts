// The later machines' cabinets, built from a Skin: the side profile extruded to width, a bezel
// plate with the window cut through it, printed glass from one atlas, one mesh for all the reels,
// the meters, the screen overlay or payline, a bulb ring and a candle, plus whatever the skin adds
// (the Cherry Wheel). Geometry is merged by material and cached per machine and quality, so a
// cabinet is about ten draw calls and a bank of them shares every buffer and texture.

import * as THREE from 'three';
import type { Quality } from '../../render/engine3d.ts';
import { LINEUP } from '../../../../shared/src/games/slots/lineup.ts';
import { at, box, bulbMaterial, candleColor, cyl, extrudeProfile, frame, merge, panel, roundedRect, slab, solid } from './cabinet.ts';
import { REGIONS } from './glass.ts';
import { bankGeometry, bankMaterial, bankTexture, type BankMaterial } from './bank.ts';
import { blurStrips, EMPTY_OVERLAY, paintLineOverlay, paintSkinAtlas, paintSkinMeters, paintStrips, type Skin, type SkinId, type SkinLayout, type OverlaySpec, type StripSource } from './skin.ts';

/** What the table view needs to drive a skinned cabinet. Lives on the model's userData.slots2. */
export interface SkinnedHandle {
  machine: SkinId;
  skin: Skin;
  root: THREE.Group;
  /** All the reels, one mesh. */
  bank: THREE.Mesh;
  /** Texture pairs for each strip set (Gold Rush: base, then free games). */
  strips: { sharp: THREE.Texture; blurred: THREE.Texture }[];
  stops: number;
  meters: THREE.Mesh;
  overlay: THREE.Mesh | null;
  payline: THREE.Mesh | null;
  bulbs: THREE.InstancedMesh;
  candleTint: THREE.Mesh;
  candleWhite: THREE.Mesh;
  printed: THREE.Mesh;
  /** Named parts a skin added (the Cherry Wheel). */
  extra: Record<string, THREE.Object3D>;
  scale: number;
  clock: { value: number };
}

/** A skin that adds moving parts builds them per cabinet from shared buffers. */
export interface SkinExtras {
  /** Add parts to a new cabinet; returns them by name for the view. */
  add(root: THREE.Group, l: SkinLayout, scale: number): Record<string, THREE.Object3D>;
}

export interface SkinEntry {
  skin: Skin;
  sets: StripSource[];
  idle: number[];
  overlay?: OverlaySpec;
  extras?: SkinExtras;
}

const REGISTRY = new Map<SkinId, SkinEntry>();

/** Each machine file registers its skin, strips and extras here (index.ts imports them). */
export function registerSkin(entry: SkinEntry): void {
  REGISTRY.set(entry.skin.id, entry);
}

export function skinEntry(id: SkinId): SkinEntry {
  const e = REGISTRY.get(id);
  if (!e) throw new Error(`slots: no skin for ${id}`);
  return e;
}

// ---------------------------------------------------------------------------------------------
// placement on the cabinet

/** The pay glass plane: centred on the top box face, leaning back with it. */
export function payMatrix(l: SkinLayout, lift: number): THREE.Matrix4 {
  const [z0, y0] = l.pay.bottom;
  const [z1, y1] = l.pay.top;
  const tilt = Math.atan2(z0 - z1, y1 - y0);
  return at(0, (y0 + y1) / 2 + Math.sin(tilt) * lift, (z0 + z1) / 2 + Math.cos(tilt) * lift, -tilt);
}

function deckMatrix(l: SkinLayout, x: number, lift: number): THREE.Matrix4 {
  const [z0, y0] = l.deck.front;
  const [z1, y1] = l.deck.back;
  const slope = Math.atan2(y1 - y0, z0 - z1);
  return at(x, (y0 + y1) / 2 + Math.cos(slope) * lift, (z0 + z1) / 2 + Math.sin(slope) * lift, -(Math.PI / 2 - slope));
}

/** Where the win meter's readout sits, in cabinet coordinates (the result pill hangs above it). */
export function winMeterAt(l: SkinLayout): THREE.Vector3 {
  return new THREE.Vector3((840 / 1024 - 0.5) * l.meters.w, l.meters.cy + l.meters.h / 2 + 0.028, l.plate.zBack + l.plate.depth + 0.02);
}

// ---------------------------------------------------------------------------------------------
// parts shared by every cabinet of one machine

interface Parts {
  body: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
  printed: THREE.BufferGeometry;
  leds: THREE.BufferGeometry | null;
  bodyMat: THREE.MeshStandardMaterial;
  trimMat: THREE.MeshStandardMaterial;
  printedMat: THREE.MeshStandardMaterial;
  ledMat: THREE.MeshBasicMaterial;
  bankGeo: THREE.BufferGeometry;
  bankMat: BankMaterial;
  strips: { sharp: THREE.CanvasTexture; blurred: THREE.CanvasTexture; canvas: HTMLCanvasElement; blurCanvas: HTMLCanvasElement }[];
  stops: number;
  meterGeo: THREE.PlaneGeometry;
  meterMat: THREE.MeshBasicMaterial;
  overlayGeo: THREE.PlaneGeometry | null;
  overlayMat: THREE.MeshBasicMaterial | null;
  paylineGeo: THREE.PlaneGeometry | null;
  paylineMat: THREE.MeshBasicMaterial;
  bulbGeo: THREE.SphereGeometry;
  bulbMat: THREE.MeshBasicMaterial;
  bulbSpots: THREE.Vector3[];
  bulbColors: THREE.Color[];
  candleGeo: THREE.CylinderGeometry;
  candleWhite: THREE.MeshBasicMaterial;
  candleTint: THREE.MeshBasicMaterial;
  atlas: THREE.CanvasTexture;
  scale: number;
}

const cache = new Map<string, Parts>();
const clock = { value: 0 };
const idleMode = { value: 0 };

function bodyParts(skin: Skin): THREE.BufferGeometry[] {
  const l = skin.layout;
  const parts = [extrudeProfile(l.profile, l.width, l.bevel)];
  if (l.lever) parts.push(new THREE.SphereGeometry(0.034, 18, 12).toNonIndexed().applyMatrix4(at(l.width / 2 + 0.05, 1.42, 0.06)));
  return parts;
}

function trimParts(skin: Skin): THREE.BufferGeometry[] {
  const l = skin.layout;
  const parts: THREE.BufferGeometry[] = [];
  const p = l.plate;
  const outline = new THREE.Shape();
  roundedRect(outline, -p.w / 2, -p.h / 2, p.w, p.h, 0.03);
  const hole = new THREE.Path();
  const w = l.window;
  roundedRect(hole, -w.w / 2, w.cy - p.cy - w.h / 2, w.w, w.h, 0.014);
  outline.holes.push(hole);
  parts.push(slab(outline, p.depth, 0.006, p.zBack).applyMatrix4(at(0, p.cy, 0)));
  parts.push(...frame(l.pay.w, l.pay.h, 0.012, 0.016, payMatrix(l, 0.012)));
  parts.push(...frame(l.belly.w, l.belly.h, 0.01, 0.014, at(0, l.belly.cy, l.belly.z + 0.012)));
  parts.push(box(l.width - 0.02, 0.018, 0.022, at(0, l.deck.front[1] - 0.012, l.deck.front[0] + 0.006)));
  const [cx, cy, cz] = l.candle;
  parts.push(cyl(0.036, 0.022, at(cx, cy + 0.011, cz)));
  parts.push(cyl(0.034, 0.012, at(cx, cy + 0.022 + 0.15 + 0.006, cz)));
  if (l.lever) {
    const x = l.width / 2 + 0.05;
    parts.push(box(0.05, 0.1, 0.12, at(l.width / 2 + 0.02, 1.02, 0.06)));
    parts.push(cyl(0.012, 0.38, at(x, 1.22, 0.06), 12));
  }
  return parts;
}

function printedParts(skin: Skin): THREE.BufferGeometry[] {
  const l = skin.layout;
  const P = REGIONS;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(panel(l.pay.w, l.pay.h, P.pay, payMatrix(l, l.bevel + 0.002)));
  parts.push(panel(l.belly.w, l.belly.h, P.belly, at(0, l.belly.cy, l.belly.z + l.bevel + 0.002)));
  l.deck.xs.forEach((x, i) => parts.push(panel(l.deck.bw, l.deck.bh, P.buttons[i]!, deckMatrix(l, x, l.bevel + 0.003))));
  // the dark inside of the reel box, behind the reels
  parts.push(solid(new THREE.PlaneGeometry(l.window.w + 0.02, l.window.h + 0.06).toNonIndexed().applyMatrix4(at(0, l.window.cy, l.plate.zBack + 0.016)), P.black));
  return parts;
}

function parts(entry: SkinEntry, quality: Quality): Parts {
  const skin = entry.skin;
  const key = `${skin.id}:${quality}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const l = skin.layout;
  const scale = quality === 'low' ? 0.5 : 1;
  const atlasCanvas = document.createElement('canvas');
  paintSkinAtlas(atlasCanvas, skin, scale);
  const atlas = new THREE.CanvasTexture(atlasCanvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 8;
  const stripScale = quality === 'low' ? 0.6 : 1;
  const strips = entry.sets.map((set) => {
    const canvas = paintStrips(skin, set, stripScale);
    const blurCanvas = blurStrips(canvas, skin.cell.h * stripScale * 1.8);
    return { canvas, blurCanvas, sharp: bankTexture(canvas), blurred: bankTexture(blurCanvas) };
  });
  const stops = entry.sets[0]!.strips[0]!.length;
  const meterCanvas = document.createElement('canvas');
  paintSkinMeters(meterCanvas, skin.meter, null, scale);
  const meterTex = new THREE.CanvasTexture(meterCanvas);
  meterTex.colorSpace = THREE.SRGBColorSpace;
  let overlayMat: THREE.MeshBasicMaterial | null = null;
  if (entry.overlay) {
    const oc = document.createElement('canvas');
    paintLineOverlay(oc, entry.overlay, EMPTY_OVERLAY, scale);
    const ot = new THREE.CanvasTexture(oc);
    ot.colorSpace = THREE.SRGBColorSpace;
    overlayMat = new THREE.MeshBasicMaterial({ map: ot, transparent: true, depthWrite: false, toneMapped: false });
  }
  const top = skin.topper(l);
  const p: Parts = {
    body: merge([...bodyParts(skin), ...top.body]),
    trim: merge([...trimParts(skin), ...top.trim]),
    printed: merge([...printedParts(skin), ...top.printed]),
    leds: top.leds ?? null,
    bodyMat: new THREE.MeshStandardMaterial(l.body),
    trimMat: new THREE.MeshStandardMaterial(l.trim),
    // backlit glass: most of its light is its own, so the room's warm light doesn't wash it out
    printedMat: new THREE.MeshStandardMaterial({ map: atlas, color: '#707070', emissiveMap: atlas, emissive: '#ffffff', emissiveIntensity: 0.55, roughness: 0.6, metalness: 0, envMapIntensity: 0.3 }),
    ledMat: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    bankGeo: bankGeometry(l.reels.look, l.reels.count, l.reels.pitch),
    bankMat: bankMaterial(strips[0]!.sharp, strips[0]!.blurred, l.reels.count, stops, l.reels.look.curve, skin.tint),
    strips,
    stops,
    meterGeo: new THREE.PlaneGeometry(l.meters.w, l.meters.h),
    meterMat: new THREE.MeshBasicMaterial({ map: meterTex, toneMapped: false }),
    overlayGeo: entry.overlay ? new THREE.PlaneGeometry(l.window.w, l.window.h) : null,
    overlayMat,
    paylineGeo: entry.overlay ? null : new THREE.PlaneGeometry(l.window.w - 0.01, 0.0035),
    paylineMat: new THREE.MeshBasicMaterial({ color: '#ff3326', toneMapped: false }),
    bulbGeo: new THREE.SphereGeometry(top.bulbs.radius, 10, 8),
    bulbMat: bulbMaterial(clock, idleMode),
    bulbSpots: top.bulbs.spots,
    bulbColors: top.bulbs.colors,
    candleGeo: new THREE.CylinderGeometry(0.03, 0.03, 0.075, 20),
    candleWhite: new THREE.MeshBasicMaterial({ color: '#fff8ec', toneMapped: false }),
    candleTint: new THREE.MeshBasicMaterial({ color: candleColor(LINEUP[skin.id].denoms[0]!), toneMapped: false }),
    atlas,
    scale,
  };
  cache.set(key, p);
  // canvases painted before a web font arrived get painted again once it has
  if (typeof document !== 'undefined' && document.fonts && document.fonts.status !== 'loaded') {
    void document.fonts.ready.then(() => repaint(entry, p, stripScale));
  }
  return p;
}

function repaint(entry: SkinEntry, p: Parts, stripScale: number): void {
  paintSkinAtlas(p.atlas.image as HTMLCanvasElement, entry.skin, p.scale);
  p.atlas.needsUpdate = true;
  paintSkinMeters(p.meterMat.map!.image as HTMLCanvasElement, entry.skin.meter, null, p.scale);
  p.meterMat.map!.needsUpdate = true;
  entry.sets.forEach((set, i) => {
    const s = p.strips[i]!;
    const fresh = paintStrips(entry.skin, set, stripScale);
    s.canvas.getContext('2d')!.drawImage(fresh, 0, 0);
    s.blurCanvas.getContext('2d')!.drawImage(blurStrips(fresh, entry.skin.cell.h * stripScale * 1.8), 0, 0);
    s.sharp.needsUpdate = true;
    s.blurred.needsUpdate = true;
  });
  if (p.overlayMat && entry.overlay) {
    paintLineOverlay(p.overlayMat.map!.image as HTMLCanvasElement, entry.overlay, EMPTY_OVERLAY, p.scale);
    p.overlayMat.map!.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------------------------
// one cabinet

export function buildSkinned(id: SkinId, quality: Quality): THREE.Group {
  const entry = skinEntry(id);
  const skin = entry.skin;
  const p = parts(entry, quality);
  const l = skin.layout;
  const root = new THREE.Group();
  root.name = `slots-${id}`;
  const printed = new THREE.Mesh(p.printed, p.printedMat);
  root.add(new THREE.Mesh(p.body, p.bodyMat), new THREE.Mesh(p.trim, p.trimMat), printed);
  if (p.leds) root.add(new THREE.Mesh(p.leds, p.ledMat));

  const bank = new THREE.Mesh(p.bankGeo, p.bankMat);
  bank.position.set(0, l.window.cy, l.reels.zFront);
  root.add(bank);
  // the decor bank shows a quiet window
  const rowOffset = l.reels.rows === 1 ? 0 : (l.reels.rows - 1) / 2;
  entry.idle.forEach((s, i) => (p.bankMat.uniforms.uOffset.value[i] = s + rowOffset));

  const meters = new THREE.Mesh(p.meterGeo, p.meterMat);
  meters.position.set(0, l.meters.cy, l.plate.zBack + l.plate.depth + 0.0015);
  root.add(meters);
  let overlay: THREE.Mesh | null = null;
  let payline: THREE.Mesh | null = null;
  if (p.overlayGeo && p.overlayMat) {
    overlay = new THREE.Mesh(p.overlayGeo, p.overlayMat);
    overlay.position.set(0, l.window.cy, l.reels.zFront + 0.003);
    overlay.renderOrder = 2;
    root.add(overlay);
  }
  if (p.paylineGeo) {
    payline = new THREE.Mesh(p.paylineGeo, p.paylineMat);
    payline.position.set(0, l.window.cy, l.reels.zFront + 0.003);
    root.add(payline);
  }

  const bulbs = new THREE.InstancedMesh(p.bulbGeo, p.bulbMat, p.bulbSpots.length);
  const m = new THREE.Matrix4();
  p.bulbSpots.forEach((s, i) => {
    bulbs.setMatrixAt(i, m.makeTranslation(s.x, s.y, s.z));
    bulbs.setColorAt(i, p.bulbColors[i]!);
  });
  bulbs.instanceMatrix.needsUpdate = true;
  if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
  bulbs.computeBoundingSphere();
  // one clock for every cabinet: whichever bulb ring renders first advances it
  bulbs.onBeforeRender = () => {
    clock.value = performance.now() / 1000;
  };
  root.add(bulbs);

  const [cx, cy, cz] = l.candle;
  const candleTint = new THREE.Mesh(p.candleGeo, p.candleTint);
  candleTint.position.set(cx, cy + 0.022 + 0.0375, cz);
  const candleWhite = new THREE.Mesh(p.candleGeo, p.candleWhite);
  candleWhite.position.set(cx, cy + 0.022 + 0.075 + 0.0375, cz);
  root.add(candleTint, candleWhite);

  const extra = entry.extras ? entry.extras.add(root, l, p.scale) : {};

  const handle: SkinnedHandle = {
    machine: id,
    skin,
    root,
    bank,
    strips: p.strips.map((s) => ({ sharp: s.sharp, blurred: s.blurred })),
    stops: p.stops,
    meters,
    overlay,
    payline,
    bulbs,
    candleTint,
    candleWhite,
    printed,
    extra,
    scale: p.scale,
    clock,
  };
  root.userData.slots2 = handle;
  return root;
}
