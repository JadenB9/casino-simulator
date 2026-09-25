// The machine: Sakura Storm in its island. The island's base, the machine's pearl-and-pink body,
// the board behind glass with its brass nails, rails, pockets and the centre piece round the
// screen, an LED ring round the window, the crown with its name, the trays, the handle and the
// data lamp on top. Geometry is merged by material and shared by every machine on the floor (a
// row of them costs a dozen draw calls each); the parts a player's view animates are named, and
// the view gives each its own material while it plays and hands the shared one back after.
//
// Local frame: x across, y up, the player at +z. The board's (u, v) sit at x = u,
// y = BOARD_Y + v, on the plane z = FACE_Z.

import * as THREE from 'three';
import type { Quality } from '../../render/engine3d.ts';
import { M, at, box, cyl, merge, roundedRect } from '../slots/cabinet.ts';
import { BOARD_W, BOARD_H, CENTRE, RAIL_R, INNER_R, LANE_FROM, LANE_TO, FRAME, HESO, TULIPS, ATTACKER, PINS, BALL_R, PIN_R } from './board.ts';
import { paintFace, paintScreen, paintCrown, paintData, paintLeds, paintTopLamp, LED_COUNT, type ScreenState } from './art.ts';

export const FOOTPRINT = { width: 0.6, depth: 0.52 };
/** The board's bottom edge, the face's plane, and where a ball's centre runs. */
export const BOARD_Y = 1.03;
export const FACE_Z = 0.07;
export const BALL_Z = FACE_Z + BALL_R + 0.0006;
export const GLASS_Z = FACE_Z + 0.022;
/** The stool, and where you look from sitting on it. */
export const SEAT_Z = 0.64;
export const PLAY_POSE = { position: [0, 1.37, 0.84] as [number, number, number], target: [0, 1.285, FACE_Z] as [number, number, number] };

export const MACHINE = 'pa-machine';
export const LCD = 'pa-lcd';
export const LEDS = 'pa-leds';
export const LID = 'pa-lid';
export const KNOB = 'pa-knob';
export const DATA = 'pa-data';
export const TRAY = 'pa-tray';
export const TOP_LAMP = 'pa-toplamp';

/** A board point in the machine's frame. */
export function boardPoint(u: number, v: number, z = BALL_Z): THREE.Vector3 {
  return new THREE.Vector3(u, BOARD_Y + v, z);
}

const WIN_W = BOARD_W;
const WIN_H = BOARD_H;
const BODY_W = 0.56;
const BODY_Y0 = 0.76;
const BODY_Y1 = 1.8;

interface Shared {
  geo: Record<string, THREE.BufferGeometry>;
  mat: Record<string, THREE.Material>;
  pinGeo: THREE.BufferGeometry;
  pinMat: THREE.Material;
  lcdCanvas: HTMLCanvasElement;
  lcdTex: THREE.CanvasTexture;
  dataCanvas: HTMLCanvasElement;
  dataTex: THREE.CanvasTexture;
  ledTex: THREE.DataTexture;
}

let shared: Shared | null = null;

function canvasTex(c: HTMLCanvasElement, aniso = 4): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.userData.shared = true;
  return t;
}

/** A tube along a closed rounded rectangle, its u running once round (for the LED ring). */
function ringGeometry(w: number, h: number, r: number, radius: number, z: number): THREE.BufferGeometry {
  const path = new THREE.Path();
  roundedRect(path, -w / 2, -h / 2, w, h, r);
  const pts2 = path.getSpacedPoints(160);
  const curve = new THREE.CatmullRomCurve3(pts2.map((p) => new THREE.Vector3(p.x, p.y, 0)), true);
  const g = new THREE.TubeGeometry(curve, 240, radius, 6, true);
  g.translate(0, 0, z);
  return g;
}

/** An arc of rail: a thin tube round the field's centre from a0 to a1 (radians, board angles). */
function railArc(r: number, a0: number, a1: number, thick: number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 64; i++) {
    const a = a0 + ((a1 - a0) * i) / 64;
    pts.push(boardPoint(CENTRE.u + Math.cos(a) * r, CENTRE.v + Math.sin(a) * r, FACE_Z + thick));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 96, thick, 6, false);
}

function build(): Shared {
  const faceCanvas = document.createElement('canvas');
  paintFace(faceCanvas);
  const faceTex = canvasTex(faceCanvas, 8);
  const lcdCanvas = document.createElement('canvas');
  paintScreen(lcdCanvas, idleScreen(0));
  const lcdTex = canvasTex(lcdCanvas);
  const crownCanvas = document.createElement('canvas');
  paintCrown(crownCanvas);
  const crownTex = canvasTex(crownCanvas);
  const lampCanvas = document.createElement('canvas');
  paintTopLamp(lampCanvas);
  const lampTex = canvasTex(lampCanvas);
  const dataCanvas = document.createElement('canvas');
  paintData(dataCanvas, { jackpots: 0, spins: 0, best: 0, fever: false });
  const dataTex = canvasTex(dataCanvas);
  const ledData = new Uint8Array(LED_COUNT * 4);
  paintLeds(ledData, 'idle', 0);
  const ledTex = new THREE.DataTexture(ledData, LED_COUNT, 1);
  ledTex.colorSpace = THREE.SRGBColorSpace;
  ledTex.wrapS = THREE.RepeatWrapping;
  ledTex.needsUpdate = true;
  ledTex.userData.shared = true;

  const winY = BOARD_Y + WIN_H / 2;
  // --- the island's base and counter
  const dark: THREE.BufferGeometry[] = [
    box(FOOTPRINT.width, BODY_Y0 - 0.04, 0.42, at(0, (BODY_Y0 - 0.04) / 2, -0.05)),
    // the kick panel under the trays, set back for the knees
    box(BODY_W, 0.3, 0.06, at(0, BODY_Y0 + 0.02, 0.08)),
    // the back of the machine and the island's upper wall
    box(FOOTPRINT.width, BODY_Y1 - BODY_Y0 + 0.2, 0.2, at(0, (BODY_Y0 + BODY_Y1 + 0.2) / 2, -0.15)),
  ];
  // --- the body: a lacquered pink frame round the window; pearl trays and trim
  const frameShape = new THREE.Shape();
  roundedRect(frameShape, -BODY_W / 2, BODY_Y0 + 0.14, BODY_W, BODY_Y1 - BODY_Y0 - 0.14, 0.035);
  const hole = new THREE.Path();
  roundedRect(hole, -WIN_W / 2 - 0.004, BOARD_Y - 0.004, WIN_W + 0.008, WIN_H + 0.008, 0.03);
  frameShape.holes.push(hole);
  const bodyFrame = new THREE.ExtrudeGeometry(frameShape, { depth: 0.04, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2, curveSegments: 10 });
  bodyFrame.translate(0, 0, FACE_Z - 0.01);
  const pearl: THREE.BufferGeometry[] = [
    // the upper tray: a deep dish across the front
    box(BODY_W - 0.02, 0.05, 0.16, at(0, BODY_Y0 + 0.21, 0.13)),
    // the lower tray
    box(BODY_W - 0.12, 0.04, 0.13, at(-0.04, BODY_Y0 + 0.07, 0.13)),
    // the body's sides down to the base
    box(BODY_W, 0.14, 0.12, at(0, BODY_Y0 + 0.07, 0.05)),
  ];
  // --- pink: the body, the crown's arch, the pockets
  const crownShape = new THREE.Shape();
  crownShape.moveTo(-BODY_W / 2 + 0.02, 0);
  crownShape.lineTo(BODY_W / 2 - 0.02, 0);
  crownShape.quadraticCurveTo(BODY_W / 2 - 0.02, 0.12, 0, 0.14);
  crownShape.quadraticCurveTo(-BODY_W / 2 + 0.02, 0.12, -BODY_W / 2 + 0.02, 0);
  const crown = new THREE.ExtrudeGeometry(crownShape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2, curveSegments: 12 });
  crown.translate(0, BODY_Y1 - 0.02, FACE_Z - 0.02);
  pearl.push(box(BODY_W - 0.02, 0.018, 0.02, at(0, BODY_Y0 + 0.245, 0.215)));
  const pink: THREE.BufferGeometry[] = [
    bodyFrame,
    crown,
    // the heso's cup and the tulips' bases
    box(0.022, 0.012, 0.016, at(HESO.u, BOARD_Y + HESO.v - 0.012, FACE_Z + 0.008)),
    ...TULIPS.map((t) => box(0.02, 0.01, 0.014, at(t.u, BOARD_Y + t.v - 0.012, FACE_Z + 0.007))),
    // the attacker's housing
    box(ATTACKER.hw * 2 + 0.02, 0.022, 0.014, at(ATTACKER.u, BOARD_Y + ATTACKER.v - 0.016, FACE_Z + 0.007)),
  ];
  // the tulips' petals, open like a cup either side of the mouth
  for (const t of TULIPS) {
    for (const s of [-1, 1]) {
      const petal = new THREE.SphereGeometry(0.009, 10, 8);
      petal.scale(0.7, 1.3, 0.5);
      petal.rotateZ(s * -0.45);
      petal.translate(t.u + s * 0.011, BOARD_Y + t.v + 0.002, FACE_Z + 0.007);
      pink.push(petal);
    }
  }
  // --- chrome: the bezel round the glass, the rails, the handle's plate, the tray's rim
  const bezelShape = new THREE.Shape();
  roundedRect(bezelShape, -WIN_W / 2 - 0.018, BOARD_Y - 0.018, WIN_W + 0.036, WIN_H + 0.036, 0.04);
  const bezelHole = new THREE.Path();
  roundedRect(bezelHole, -WIN_W / 2, BOARD_Y, WIN_W, WIN_H, 0.028);
  bezelShape.holes.push(bezelHole);
  const bezel = new THREE.ExtrudeGeometry(bezelShape, { depth: 0.008, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 3, curveSegments: 10 });
  bezel.translate(0, 0, 0.114);
  const chrome: THREE.BufferGeometry[] = [
    bezel,
    railArc(RAIL_R + 0.002, -Math.PI / 2 - 0.3, (3 * Math.PI) / 2 + 0.3, 0.0022),
    railArc(INNER_R - 0.002, LANE_TO, LANE_FROM, 0.0018),
    // the ball tray's inner rim
    box(BODY_W - 0.04, 0.006, 0.006, at(0, BODY_Y0 + 0.237, 0.2)),
    // the handle's plate
    cyl(0.04, 0.012, at(0.2, BODY_Y0 + 0.1, 0.195, Math.PI / 2, 0, 0), 28),
  ];
  // --- the centre piece: a gold frame round the screen, a stage ledge under it
  const yakuShape = new THREE.Shape();
  roundedRect(yakuShape, -FRAME.hw - 0.012, -FRAME.hh - 0.012, 2 * FRAME.hw + 0.024, 2 * FRAME.hh + 0.024, FRAME.round + 0.008);
  const yakuHole = new THREE.Path();
  roundedRect(yakuHole, -FRAME.hw + 0.006, -FRAME.hh + 0.006, 2 * FRAME.hw - 0.012, 2 * FRAME.hh - 0.012, FRAME.round - 0.004);
  yakuShape.holes.push(yakuHole);
  const yaku = new THREE.ExtrudeGeometry(yakuShape, { depth: 0.012, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 2, curveSegments: 8 });
  yaku.translate(FRAME.u, BOARD_Y + FRAME.v, FACE_Z);
  const gold: THREE.BufferGeometry[] = [
    yaku,
    // the stage: a clear ledge under the screen (drawn gold-edged)
    box(2 * FRAME.hw - 0.01, 0.004, 0.014, at(FRAME.u, BOARD_Y + FRAME.v - FRAME.hh - 0.013, FACE_Z + 0.007)),
    // the warp holes' rims
    ...[-1, 1].map((s) => new THREE.TorusGeometry(0.008, 0.0018, 6, 16).translate(FRAME.u + s * (FRAME.hw + 0.009), BOARD_Y + FRAME.v + 0.035, FACE_Z + 0.013)),
  ];

  const geo: Record<string, THREE.BufferGeometry> = {
    dark: merge(dark),
    pearl: merge(pearl),
    pink: merge(pink),
    chrome: merge(chrome),
    gold: merge(gold),
    face: new THREE.PlaneGeometry(WIN_W, WIN_H).translate(0, winY, FACE_Z),
    lcd: new THREE.PlaneGeometry(2 * FRAME.hw - 0.012, 2 * FRAME.hh - 0.012).translate(FRAME.u, BOARD_Y + FRAME.v, FACE_Z + 0.009),
    glass: new THREE.PlaneGeometry(WIN_W, WIN_H).translate(0, winY, GLASS_Z),
    crownSign: new THREE.PlaneGeometry(0.34, 0.085).translate(0, BODY_Y1 + 0.055, FACE_Z + 0.037),
    leds: merge([
      ringGeometry(WIN_W + 0.052, WIN_H + 0.052, 0.05, 0.0045, 0.113),
      // the wings: a strip down each side of the body
      ...[-1, 1].map((s) => new THREE.PlaneGeometry(0.012, 0.62).rotateZ(Math.PI / 2).translate(0, 0, 0).rotateZ(-Math.PI / 2).translate(s * (BODY_W / 2 - 0.012), BOARD_Y + WIN_H / 2, 0.1165)),
    ]),
    topLamp: new THREE.PlaneGeometry(WIN_W - 0.04, 0.13).translate(0, BOARD_Y + WIN_H + 0.092, 0.1105),
    lid: new THREE.BoxGeometry(ATTACKER.hw * 2, ATTACKER.hh * 2, 0.006).translate(0, ATTACKER.hh, 0),
    knob: new THREE.CylinderGeometry(0.03, 0.034, 0.03, 24).rotateX(Math.PI / 2),
    knobGrip: new THREE.BoxGeometry(0.008, 0.05, 0.034),
    data: new THREE.PlaneGeometry(0.2, 0.075),
    dataBox: new THREE.BoxGeometry(0.22, 0.095, 0.05),
  };
  const mat: Record<string, THREE.Material> = {
    dark: new THREE.MeshStandardMaterial({ color: '#241a22', roughness: 0.55, metalness: 0.1 }),
    pearl: new THREE.MeshStandardMaterial({ color: '#f6eff4', roughness: 0.25, metalness: 0.1 }),
    pink: new THREE.MeshStandardMaterial({ color: '#d6286a', roughness: 0.2, metalness: 0.25 }),
    chrome: new THREE.MeshStandardMaterial({ color: '#f1f3f6', roughness: 0.22, metalness: 0.85 }),
    gold: new THREE.MeshStandardMaterial({ color: '#e7b94c', roughness: 0.22, metalness: 1 }),
    face: new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.45, metalness: 0 }),
    lcd: new THREE.MeshBasicMaterial({ map: lcdTex, toneMapped: false }),
    glass: new THREE.MeshStandardMaterial({ color: '#dfe8ff', roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.08, depthWrite: false }),
    crownSign: new THREE.MeshBasicMaterial({ map: crownTex, toneMapped: false }),
    topLamp: new THREE.MeshBasicMaterial({ map: lampTex, toneMapped: false }),
    leds: new THREE.MeshBasicMaterial({ map: ledTex, toneMapped: false }),
    data: new THREE.MeshBasicMaterial({ map: dataTex, toneMapped: false }),
  };
  // tone the lit parts up a little so the bloom finds them
  (mat.leds as THREE.MeshBasicMaterial).color.setScalar(1.6);
  (mat.crownSign as THREE.MeshBasicMaterial).color.setScalar(1.15);
  const pinGeo = new THREE.CylinderGeometry(PIN_R, PIN_R, 0.009, 6).rotateX(Math.PI / 2).translate(0, 0, FACE_Z + 0.0045);
  const pinMat = new THREE.MeshStandardMaterial({ color: '#d7b25e', roughness: 0.28, metalness: 1 });
  for (const m of [...Object.values(mat), pinMat]) m.userData.shared = true;
  for (const g of [...Object.values(geo), pinGeo]) g.userData.shared = true;
  return { geo, mat, pinGeo, pinMat, lcdCanvas, lcdTex, dataCanvas, dataTex, ledTex };
}

/** The screen as it sits on the floor between players. */
export function idleScreen(t: number): ScreenState {
  return { t, mode: 'idle', reels: [7, 3, 7], stopped: [true, true, true], holds: 0, line: '' };
}

export interface MachineHandle {
  lcd: THREE.Mesh;
  leds: THREE.Mesh;
  lid: THREE.Mesh;
  knob: THREE.Object3D;
  data: THREE.Mesh;
  tray: THREE.InstancedMesh;
}

/** One machine in its island. */
export function machineModel(quality: Quality): THREE.Group {
  shared ??= build();
  const s = shared;
  const g = new THREE.Group();
  g.name = MACHINE;
  const mesh = (name: string, geo = s.geo[name]!, mat = s.mat[name]!) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = `pa-${name}`;
    g.add(m);
    return m;
  };
  for (const k of ['dark', 'pearl', 'pink', 'chrome', 'gold', 'face', 'crownSign']) mesh(k);
  mesh('topLamp').name = TOP_LAMP;
  const glass = mesh('glass');
  glass.renderOrder = 2;
  const lcd = mesh('lcd');
  lcd.name = LCD;
  const leds = mesh('leds');
  leds.name = LEDS;

  const pins = new THREE.InstancedMesh(s.pinGeo, s.pinMat, PINS.length);
  const m4 = new THREE.Matrix4();
  PINS.forEach((p, i) => pins.setMatrixAt(i, m4.makeTranslation(p.u, BOARD_Y + p.v, 0)));
  pins.name = 'pa-pins';
  g.add(pins);

  const lid = new THREE.Mesh(s.geo.lid!, s.mat.pink!);
  lid.name = LID;
  lid.position.set(ATTACKER.u, BOARD_Y + ATTACKER.v - ATTACKER.hh, FACE_Z + 0.012);
  g.add(lid);

  const knob = new THREE.Group();
  knob.name = KNOB;
  knob.position.set(0.2, BODY_Y0 + 0.1, 0.215);
  knob.add(new THREE.Mesh(s.geo.knob!, s.mat.chrome!), new THREE.Mesh(s.geo.knobGrip!, s.mat.pink!));
  g.add(knob);

  // the data lamp on the island's wall above the machine
  const dataBox = new THREE.Mesh(s.geo.dataBox!, s.mat.dark!);
  dataBox.position.set(0, BODY_Y1 + 0.2, -0.02);
  const data = new THREE.Mesh(s.geo.data!, s.mat.data!);
  data.name = DATA;
  data.position.set(0, BODY_Y1 + 0.2, 0.0051);
  g.add(dataBox, data);

  // balls waiting in the upper tray
  const trayCount = quality === 'high' ? 48 : 24;
  const tray = new THREE.InstancedMesh(ballGeometry(), ballMaterial(), trayCount);
  tray.name = TRAY;
  const r = (i: number) => ((Math.sin(i * 91.7) + 1) * 43758.5453) % 1;
  for (let i = 0; i < trayCount; i++) {
    const row = Math.floor(i / 16);
    const x = -0.2 + (i % 16) * 0.012 + (row % 2) * 0.006 + (r(i) - 0.5) * 0.002;
    tray.setMatrixAt(i, m4.makeTranslation(x, BODY_Y0 + 0.24 + row * 0.008, 0.16 + row * 0.009 + (r(i + 7) - 0.5) * 0.004));
  }
  g.add(tray);

  const handle: MachineHandle = { lcd, leds, lid, knob, data, tray };
  g.userData.pachinko = handle;
  return g;
}

let ballGeo: THREE.BufferGeometry | null = null;
let ballMat: THREE.MeshStandardMaterial | null = null;

/** The steel ball: chrome that shows the room. */
export function ballGeometry(): THREE.BufferGeometry {
  if (!ballGeo) {
    ballGeo = new THREE.SphereGeometry(BALL_R, 14, 10);
    ballGeo.userData.shared = true;
  }
  return ballGeo;
}

export function ballMaterial(): THREE.MeshStandardMaterial {
  if (!ballMat) {
    ballMat = new THREE.MeshStandardMaterial({ color: '#f2f4f7', roughness: 0.08, metalness: 1, envMapIntensity: 1.6 });
    ballMat.userData.shared = true;
  }
  return ballMat;
}

/** The shared screen, data and LED materials, for a view that swaps in its own and puts these back. */
export function sharedLit(): { lcd: THREE.Material; data: THREE.Material; leds: THREE.Material } {
  shared ??= build();
  return { lcd: shared.mat.lcd!, data: shared.mat.data!, leds: shared.mat.leds! };
}
