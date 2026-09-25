// The bingo hall's station: the caller's stage with the flashboard on its back wall under a
// marquee sign, the blower (a clear dome of tumbling balls with the chute that lifts each called
// ball into the cradle) and the caller's podium, then four long tables of ten places facing it.
// Geometry is merged by material and shared; the view takes over the flashboard's face, the balls
// in the dome and the ball in the cradle while someone plays, and hands them back after.

import * as THREE from 'three';
import type { Quality } from '../../render/engine3d.ts';
import { M, at, box, cyl, merge } from '../slots/cabinet.ts';
import { BOARD_W, BOARD_H, COLUMN_COLOURS, paintBoard, paintSign, paintBallFace } from './art.ts';
import { FOOTPRINT, STAGE_Z0, STAGE_Z1, STAGE_H, STAGE_W, BOARD, BLOWER, PODIUM, TABLE, ROW_Z, ROWS, PER_ROW, seatSpot } from './layout.ts';

export const HALL = 'bg-hall';
export const FLASHBOARD = 'bg-board';
export const DOME_BALLS = 'bg-balls';
export const CRADLE_BALL = 'bg-current';
export const CRADLE_FACE = 'bg-current-face';

/** How many balls tumble in the dome (not all 75: the rest are under the air). */
export const DOME_COUNT = 30;
export const DOME_Y = STAGE_H + BLOWER.standH + BLOWER.r;
export const CRADLE = { x: BLOWER.x + 0.5, y: STAGE_H + BLOWER.standH + 0.36, z: BLOWER.z + 0.05 } as const;
export const BALL_R = 0.038;

interface Shared {
  geo: Record<string, THREE.BufferGeometry>;
  mat: Record<string, THREE.Material>;
  boardMat: THREE.MeshBasicMaterial;
}

let shared: Shared | null = null;

function lit(c: HTMLCanvasElement): THREE.MeshBasicMaterial {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.userData.shared = true;
  return new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
}

function build(): Shared {
  const boardCanvas = document.createElement('canvas');
  paintBoard(boardCanvas, { called: [], phase: 'idle', flash: false });
  const boardMat = lit(boardCanvas);
  const signCanvas = document.createElement('canvas');
  paintSign(signCanvas);
  const signMat = lit(signCanvas);
  signMat.color.setScalar(1.2);

  const stageD = STAGE_Z1 - STAGE_Z0;
  const stageZ = (STAGE_Z0 + STAGE_Z1) / 2;
  const wood: THREE.BufferGeometry[] = [
    // the stage's apron and the podium's body
    box(STAGE_W, STAGE_H, stageD, at(0, STAGE_H / 2, stageZ)),
    box(PODIUM.w, PODIUM.h, PODIUM.d, at(PODIUM.x, STAGE_H + PODIUM.h / 2, PODIUM.z)),
    // the podium's sloped reading top
    box(PODIUM.w + 0.06, 0.04, PODIUM.d * 0.8, at(PODIUM.x, STAGE_H + PODIUM.h + 0.03, PODIUM.z + 0.02, -0.25, 0, 0)),
  ];
  const carpet: THREE.BufferGeometry[] = [box(STAGE_W - 0.1, 0.01, stageD - 0.1, at(0, STAGE_H + 0.005, stageZ))];
  const dark: THREE.BufferGeometry[] = [
    // the wall behind the flashboard
    box(STAGE_W, 3.0, 0.1, at(0, 1.5, STAGE_Z0 + 0.05)),
    // the flashboard's cabinet
    box(BOARD.w + 0.16, BOARD.h + 0.16, 0.12, at(0, BOARD.y, BOARD.z - 0.05)),
    // the blower's base
    box(0.46, BLOWER.baseH, 0.4, at(BLOWER.x, STAGE_H + BLOWER.baseH / 2, BLOWER.z)),
  ];
  const brass: THREE.BufferGeometry[] = [
    // the flashboard's trim
    ...frameBars(BOARD.w + 0.1, BOARD.h + 0.1, 0.03, 0.03, at(0, BOARD.y, BOARD.z + 0.02)),
    // the stage's nosing
    box(STAGE_W, 0.03, 0.03, at(0, STAGE_H - 0.015, STAGE_Z1)),
    // the podium's trim and the microphone
    box(PODIUM.w + 0.02, 0.03, 0.02, at(PODIUM.x, STAGE_H + PODIUM.h - 0.1, PODIUM.z + PODIUM.d / 2 + 0.01)),
    cyl(0.008, 0.36, at(PODIUM.x - 0.18, STAGE_H + PODIUM.h + 0.2, PODIUM.z + 0.05, 0.5, 0, 0), 8),
    new THREE.SphereGeometry(0.03, 12, 8).translate(PODIUM.x - 0.18, STAGE_H + PODIUM.h + 0.37, PODIUM.z + 0.14),
    // the blower's column and collar
    cyl(0.06, BLOWER.standH - BLOWER.baseH, at(BLOWER.x, STAGE_H + BLOWER.baseH + (BLOWER.standH - BLOWER.baseH) / 2, BLOWER.z), 16),
    new THREE.TorusGeometry(BLOWER.r * 0.72, 0.022, 8, 32).rotateX(Math.PI / 2).translate(BLOWER.x, DOME_Y - BLOWER.r * 0.68, BLOWER.z),
    // the chute from the dome's top over to the cradle, and the cradle's ring
    chute(),
    new THREE.TorusGeometry(BALL_R * 1.1, 0.008, 8, 20).rotateX(Math.PI / 2).translate(CRADLE.x, CRADLE.y - BALL_R * 0.55, CRADLE.z),
    cyl(0.012, CRADLE.y - BALL_R - STAGE_H, at(CRADLE.x, STAGE_H + (CRADLE.y - BALL_R - STAGE_H) / 2, CRADLE.z), 8),
  ];
  // the tables: a laminated top on two trestles each, and a dauber or two left on them
  const tables: THREE.BufferGeometry[] = [];
  const legs: THREE.BufferGeometry[] = [];
  for (let r = 0; r < ROWS; r++) {
    const z = ROW_Z[r]!;
    tables.push(box(TABLE.w, 0.035, TABLE.d, at(0, TABLE.h - 0.0175, z)));
    for (const x of [-TABLE.w / 2 + 0.3, TABLE.w / 2 - 0.3]) {
      legs.push(box(0.05, TABLE.h - 0.035, TABLE.d - 0.12, at(x, (TABLE.h - 0.035) / 2, z)));
      legs.push(box(0.08, 0.03, TABLE.d - 0.04, at(x, 0.015, z)));
    }
    legs.push(box(TABLE.w - 0.7, 0.04, 0.03, at(0, 0.2, z)));
  }
  const dauber: THREE.BufferGeometry[] = [];
  const caps: THREE.BufferGeometry[] = [];
  for (let s = 0; s < ROWS * PER_ROW; s += 3) {
    const p = seatSpot(s);
    const x = p.x + ((s * 37) % 11) / 100 - 0.05;
    const z = ROW_Z[p.row]! + 0.1;
    dauber.push(cyl(0.022, 0.1, at(x, TABLE.h + 0.05, z), 12));
    caps.push(cyl(0.024, 0.03, at(x, TABLE.h + 0.115, z), 12));
  }

  const geo: Record<string, THREE.BufferGeometry> = {
    wood: merge(wood),
    carpet: merge(carpet),
    dark: merge(dark),
    brass: merge(brass),
    tables: merge(tables),
    legs: merge(legs),
    dauber: merge(dauber),
    caps: merge(caps),
    board: new THREE.PlaneGeometry(BOARD.w, BOARD.h).translate(0, BOARD.y, BOARD.z + 0.012),
    sign: new THREE.PlaneGeometry(1.8, 0.338).translate(0, BOARD.y + BOARD.h / 2 + 0.3, BOARD.z + 0.01),
    signBox: box(1.9, 0.42, 0.1, at(0, BOARD.y + BOARD.h / 2 + 0.3, BOARD.z - 0.05)),
    dome: new THREE.SphereGeometry(BLOWER.r, 32, 20),
    ball: new THREE.SphereGeometry(BALL_R, 16, 12),
    face: new THREE.CircleGeometry(BALL_R * 0.98, 24),
  };
  const mat: Record<string, THREE.Material> = {
    wood: new THREE.MeshStandardMaterial({ color: '#4a2a1c', roughness: 0.5, metalness: 0.05 }),
    carpet: new THREE.MeshStandardMaterial({ color: '#6d1420', roughness: 0.95 }),
    dark: new THREE.MeshStandardMaterial({ color: '#17121a', roughness: 0.7 }),
    brass: new THREE.MeshStandardMaterial({ color: '#d6ad58', roughness: 0.3, metalness: 1 }),
    tables: new THREE.MeshStandardMaterial({ color: '#e6ddc8', roughness: 0.4 }),
    legs: new THREE.MeshStandardMaterial({ color: '#2b2b2e', roughness: 0.4, metalness: 0.6 }),
    dauber: new THREE.MeshStandardMaterial({ color: '#e0306e', roughness: 0.35 }),
    caps: new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.3 }),
    board: boardMat,
    sign: signMat,
    dome: new THREE.MeshStandardMaterial({ color: '#e8f2ff', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.16, depthWrite: false }),
    ball: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.25 }),
  };
  for (const m of Object.values(mat)) m.userData.shared = true;
  for (const g of Object.values(geo)) g.userData.shared = true;
  return { geo, mat, boardMat };
}

function frameBars(w: number, h: number, t: number, d: number, m: THREE.Matrix4): THREE.BufferGeometry[] {
  return [
    box(w + 2 * t, t, d, M().multiplyMatrices(m, at(0, h / 2 + t / 2, 0))),
    box(w + 2 * t, t, d, M().multiplyMatrices(m, at(0, -h / 2 - t / 2, 0))),
    box(t, h, d, M().multiplyMatrices(m, at(w / 2 + t / 2, 0, 0))),
    box(t, h, d, M().multiplyMatrices(m, at(-w / 2 - t / 2, 0, 0))),
  ];
}

/** The chute: a tube from the top of the dome, over, and down into the cradle. */
function chute(): THREE.BufferGeometry {
  const top = new THREE.Vector3(BLOWER.x, DOME_Y + BLOWER.r, BLOWER.z);
  const curve = new THREE.CatmullRomCurve3([
    top,
    new THREE.Vector3(BLOWER.x, DOME_Y + BLOWER.r + 0.14, BLOWER.z),
    new THREE.Vector3((BLOWER.x + CRADLE.x) / 2, DOME_Y + BLOWER.r + 0.2, BLOWER.z + 0.02),
    new THREE.Vector3(CRADLE.x, DOME_Y + BLOWER.r + 0.06, CRADLE.z),
    new THREE.Vector3(CRADLE.x, CRADLE.y + BALL_R * 1.6, CRADLE.z),
  ]);
  return new THREE.TubeGeometry(curve, 48, 0.012, 8, false);
}

/** The path a called ball takes up the chute to the cradle, for the view's animation. */
export function chutePath(): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(BLOWER.x, DOME_Y, BLOWER.z),
    new THREE.Vector3(BLOWER.x, DOME_Y + BLOWER.r + 0.14, BLOWER.z + 0.03),
    new THREE.Vector3((BLOWER.x + CRADLE.x) / 2, DOME_Y + BLOWER.r + 0.2, BLOWER.z + 0.05),
    new THREE.Vector3(CRADLE.x, DOME_Y + BLOWER.r + 0.06, CRADLE.z + 0.03),
    new THREE.Vector3(CRADLE.x, CRADLE.y, CRADLE.z),
  ]);
}

export interface HallHandle {
  board: THREE.Mesh;
  domeBalls: THREE.InstancedMesh;
  cradle: THREE.Mesh;
  cradleFace: THREE.Mesh;
}

/** A ball's resting spot in the dome, from its index (a heap at the bottom). */
export function domeRest(i: number): THREE.Vector3 {
  const a = i * 2.399963;
  const ring = Math.sqrt(i / DOME_COUNT);
  const r = (BLOWER.r - BALL_R * 1.2) * ring * 0.95;
  const y = DOME_Y - BLOWER.r + BALL_R * 1.1 + (1 - ring) * 0.09 + (i % 3) * 0.02;
  return new THREE.Vector3(BLOWER.x + Math.cos(a) * r, y, BLOWER.z + Math.sin(a) * r);
}

export function hallModel(_quality: Quality): THREE.Group {
  shared ??= build();
  const s = shared;
  const g = new THREE.Group();
  g.name = HALL;
  for (const k of ['wood', 'carpet', 'dark', 'brass', 'tables', 'legs', 'dauber', 'caps', 'sign']) {
    const m = new THREE.Mesh(s.geo[k]!, s.mat[k]!);
    m.name = `bg-${k}`;
    g.add(m);
  }
  const signBox = new THREE.Mesh(s.geo.signBox!, s.mat.dark!);
  const board = new THREE.Mesh(s.geo.board!, s.boardMat);
  board.name = FLASHBOARD;
  g.add(signBox, board);

  const dome = new THREE.Mesh(s.geo.dome!, s.mat.dome!);
  dome.position.set(BLOWER.x, DOME_Y, BLOWER.z);
  dome.renderOrder = 2;
  g.add(dome);
  const balls = new THREE.InstancedMesh(s.geo.ball!, s.mat.ball!, DOME_COUNT);
  balls.name = DOME_BALLS;
  const m4 = new THREE.Matrix4();
  const c = new THREE.Color();
  for (let i = 0; i < DOME_COUNT; i++) {
    balls.setMatrixAt(i, m4.makeTranslation(domeRest(i)));
    balls.setColorAt(i, c.set(COLUMN_COLOURS[i % 5]!));
  }
  g.add(balls);

  const cradle = new THREE.Mesh(s.geo.ball!, new THREE.MeshStandardMaterial({ color: '#e9e6df', roughness: 0.25 }));
  cradle.name = CRADLE_BALL;
  cradle.position.set(CRADLE.x, CRADLE.y, CRADLE.z);
  cradle.scale.setScalar(1.4);
  cradle.visible = false;
  const faceCanvas = document.createElement('canvas');
  paintBallFace(faceCanvas, null);
  const face = new THREE.Mesh(s.geo.face!, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(faceCanvas), transparent: true }));
  face.name = CRADLE_FACE;
  face.position.set(0, 0, BALL_R * 1.01);
  cradle.add(face);
  g.add(cradle);

  const handle: HallHandle = { board, domeBalls: balls, cradle, cradleFace: face };
  g.userData.bingo = handle;
  return g;
}

export { FOOTPRINT, BOARD_W, BOARD_H };
