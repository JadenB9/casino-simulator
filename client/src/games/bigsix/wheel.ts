// The Big Six wheel, built in code: a lacquered wheel standing upright in a round cabinet, its
// face painted with the 54 stops (a note on each bill stop, the Star and the Crown), brass
// dividers and spokes, a peg on every boundary, marquee bulbs round the cabinet, and the leather
// clapper hanging from a brass bracket at the top. The wheel turns about the hub (local z); the
// cabinet, the bulbs and the clapper's hinge stay put.
//
// Local coordinates: metres, hub at the origin, the face toward +z, up +y.

import * as THREE from 'three';
import type { Quality } from '../../render/engine3d.ts';
import { WHEEL as STOPS_ORDER, STOPS } from '../../../../shared/src/games/bigsix/rules.ts';
import { SYMBOL_COLOR, billValue, drawNote, drawStar, drawCrown } from './art.ts';
import { GEO, SECTOR } from './spin.ts';

export const ROTOR_NAME = 'bigsix-rotor';
export const FLAP_NAME = 'bigsix-flap';
export const BULBS_NAME = 'bigsix-bulbs';
export const GLOW_NAME = 'bigsix-glow';

/**
 * The painted face and the band of stops on it (the stops run out past the pegs, so the clapper's
 * tip always points into a stop's colour), then the wheel's rim and the cabinet round it.
 */
export const FACE_R = 0.772;
export const BAND_IN = 0.47;
export const RIM_R = 0.795;
export const FRAME_IN = 0.808;
export const FRAME_OUT = 0.9;
export const BULB_R = 0.854;
/** Where each note stands on its stop, and how long it is. */
const NOTE_R = 0.64;
const NOTE_L = 0.172;
/** Pegs stand out of the face up to PEG_Z1; the clapper swings between them at FLAP_Z. */
const PEG_Z1 = 0.068;
export const FLAP_Z = 0.046;
/** Where the crest's sign sits above the hub. */
export const CREST_Y = 1.02;

const SERIF = 'Cinzel, Georgia, serif';

// ---------------------------------------------------------------------------------------------
// The face

/** Paint the face on a `size`-pixel square: canvas centre = hub, canvas up = the wheel's up at rest. */
export function paintFace(g: CanvasRenderingContext2D, size: number): void {
  const ppm = size / (2 * FACE_R);
  const R = (m: number) => m * ppm;
  g.save();
  g.translate(size / 2, size / 2);

  // the inner disc: dark lacquer with a gold sunburst and a lettered ring
  const inner = g.createRadialGradient(0, 0, R(0.05), 0, 0, R(BAND_IN));
  inner.addColorStop(0, '#3a1d10');
  inner.addColorStop(1, '#170b06');
  g.fillStyle = inner;
  g.beginPath();
  g.arc(0, 0, R(BAND_IN), 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(226, 182, 84, 0.14)';
  g.lineWidth = R(0.004);
  for (let i = 0; i < STOPS; i++) {
    const a = (i + 0.5) * SECTOR;
    g.beginPath();
    g.moveTo(R(0.14) * Math.sin(a), -R(0.14) * Math.cos(a));
    g.lineTo(R(0.36) * Math.sin(a), -R(0.36) * Math.cos(a));
    g.stroke();
  }
  g.strokeStyle = 'rgba(226, 182, 84, 0.55)';
  g.lineWidth = R(0.003);
  for (const r of [0.375, 0.445]) {
    g.beginPath();
    g.arc(0, 0, R(r), 0, Math.PI * 2);
    g.stroke();
  }
  // "BIG SIX" and stars, round the ring between those two lines
  g.fillStyle = '#e2b654';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `600 ${R(0.044)}px ${SERIF}`;
  const words = ['BIG SIX', 'MONEY WHEEL', 'BIG SIX', 'MONEY WHEEL'];
  words.forEach((w, i) => {
    const mid = (i / words.length) * Math.PI * 2;
    const per = 0.036 / 0.41; // radians per letter at this radius
    const start = mid - ((w.length - 1) * per) / 2;
    for (let k = 0; k < w.length; k++) {
      g.save();
      g.rotate(start + k * per);
      g.fillText(w[k]!, 0, -R(0.41));
      g.restore();
    }
    g.save();
    g.rotate(mid + Math.PI / words.length);
    g.translate(0, -R(0.41));
    drawStar(g, R(0.016));
    g.restore();
  });

  // the stops
  for (let i = 0; i < STOPS; i++) {
    const key = STOPS_ORDER[i]!;
    g.save();
    g.rotate((i + 0.5) * SECTOR);
    // the wedge, a little darker toward the hub
    const wedge = g.createLinearGradient(0, -R(BAND_IN), 0, -R(FACE_R));
    const base = new THREE.Color(SYMBOL_COLOR[key]);
    wedge.addColorStop(0, `#${base.clone().multiplyScalar(0.62).getHexString()}`);
    wedge.addColorStop(1, `#${base.getHexString()}`);
    g.fillStyle = wedge;
    g.beginPath();
    g.arc(0, 0, R(FACE_R), -Math.PI / 2 - SECTOR / 2, -Math.PI / 2 + SECTOR / 2);
    g.arc(0, 0, R(BAND_IN), -Math.PI / 2 + SECTOR / 2, -Math.PI / 2 - SECTOR / 2, true);
    g.closePath();
    g.fill();
    // the label ring: the value in cream, or a small picture
    const v = billValue(key);
    g.save();
    g.translate(0, -R(0.5));
    if (v !== null) {
      g.fillStyle = '#f6efe0';
      g.font = `700 ${R(v >= 10 ? 0.034 : 0.04)}px ${SERIF}`;
      g.fillText(String(v), 0, R(0.002));
    } else if (key === 'star') {
      drawStar(g, R(0.022));
    } else {
      drawCrown(g, R(0.042));
    }
    g.restore();
    // the note, standing with its top toward the rim, or the big picture
    g.save();
    g.translate(0, -R(NOTE_R));
    if (v !== null) drawNote(g, v, R(NOTE_L), R(0.058), true);
    else if (key === 'star') drawStar(g, R(0.054));
    else drawCrown(g, R(0.07));
    g.restore();
    g.restore();
  }
  // the lines between stops, painted under the brass dividers
  g.strokeStyle = '#1a0f08';
  g.lineWidth = R(0.004);
  for (let i = 0; i < STOPS; i++) {
    const a = i * SECTOR;
    g.beginPath();
    g.moveTo(R(BAND_IN) * Math.sin(a), -R(BAND_IN) * Math.cos(a));
    g.lineTo(R(FACE_R) * Math.sin(a), -R(FACE_R) * Math.cos(a));
    g.stroke();
  }
  g.restore();
}

function faceTexture(quality: Quality): THREE.CanvasTexture {
  const size = quality === 'high' ? 2048 : 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  paintFace(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function hubTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.translate(size / 2, size / 2);
  const grad = g.createRadialGradient(-30, -40, 10, 0, 0, size / 2);
  grad.addColorStop(0, '#5a2a18');
  grad.addColorStop(1, '#1f0d07');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(0, 0, size / 2, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#e2b654';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(0, 0, size / 2 - 10, 0, Math.PI * 2);
  g.stroke();
  drawStar(g, size * 0.33);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function crestTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 320;
  const g = c.getContext('2d')!;
  g.fillStyle = '#140a06';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#d8b06a';
  g.lineWidth = 8;
  g.strokeRect(18, 18, c.width - 36, c.height - 36);
  g.lineWidth = 2;
  g.strokeRect(34, 34, c.width - 68, c.height - 68);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#f1d59a';
  g.font = `700 150px ${SERIF}`;
  g.fillText('BIG SIX', c.width / 2, c.height / 2 + 8);
  for (const x of [120, c.width - 120]) {
    g.save();
    g.translate(x, c.height / 2);
    drawStar(g, 58);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------------------------------------
// The pieces

function annulus(rOut: number, rIn: number): THREE.Shape {
  const s = new THREE.Shape();
  s.absarc(0, 0, rOut, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, rIn, 0, Math.PI * 2, true);
  s.holes.push(hole);
  return s;
}

/** A point at clockwise angle a from the top, radius r (the wheel's own convention). */
function polar(r: number, a: number): [number, number] {
  return [r * Math.sin(a), r * Math.cos(a)];
}

function buildRotor(quality: Quality, mats: Mats): THREE.Group {
  const rotor = new THREE.Group();
  rotor.name = ROTOR_NAME;
  const seg = quality === 'high' ? 128 : 72;

  const back = new THREE.Mesh(new THREE.CylinderGeometry(RIM_R - 0.004, RIM_R - 0.004, 0.045, seg).rotateX(Math.PI / 2), mats.darkWood);
  back.position.z = -0.0225;
  rotor.add(back);

  const tex = faceTexture(quality);
  const faceMat = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.2, roughness: 0.42, metalness: 0 });
  const face = new THREE.Mesh(new THREE.CircleGeometry(FACE_R, seg), faceMat);
  face.position.z = 0.0012;
  rotor.add(face);

  const rim = new THREE.Mesh(new THREE.TorusGeometry((FACE_R + RIM_R) / 2, (RIM_R - FACE_R) / 2 + 0.002, quality === 'high' ? 16 : 8, seg), mats.lacquer);
  rotor.add(rim);

  // the light over the stop that came up, moved onto it by the view (stop 0 spans φ from π/2 − S to π/2)
  const glow = new THREE.Mesh(
    new THREE.RingGeometry(BAND_IN + 0.004, FACE_R - 0.004, 6, 1, Math.PI / 2 - SECTOR, SECTOR),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.25, 1.05, 0.7), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  glow.name = GLOW_NAME;
  glow.position.z = 0.0022;
  glow.visible = false;
  rotor.add(glow);

  const ringIn = new THREE.Mesh(new THREE.TorusGeometry(BAND_IN, 0.0065, 8, seg), mats.brass);
  ringIn.position.z = 0.003;
  const ringOut = new THREE.Mesh(new THREE.TorusGeometry(FACE_R, 0.005, 8, seg), mats.brass);
  ringOut.position.z = 0.003;
  rotor.add(ringIn, ringOut);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const zAxis = new THREE.Vector3(0, 0, 1);

  // a brass divider on every boundary, and a peg standing out of the face near its end
  const divLen = FACE_R - BAND_IN;
  const dividers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.0038, divLen, 0.004), mats.brass, STOPS);
  const pegGeo = new THREE.CylinderGeometry(GEO.pegRadius, GEO.pegRadius, PEG_Z1, 12).rotateX(Math.PI / 2);
  const pegs = new THREE.InstancedMesh(pegGeo, mats.pegBrass, STOPS);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(GEO.pegRadius * 1.35, 12, 8), mats.pegBrass, STOPS);
  for (let k = 0; k < STOPS; k++) {
    const a = k * SECTOR;
    q.setFromAxisAngle(zAxis, -a);
    const [dx, dy] = polar(BAND_IN + divLen / 2, a);
    dividers.setMatrixAt(k, m.compose(new THREE.Vector3(dx, dy, 0.003), q, one));
    const [px, py] = polar(GEO.pegR, a);
    pegs.setMatrixAt(k, m.compose(new THREE.Vector3(px, py, PEG_Z1 / 2), q, one));
    heads.setMatrixAt(k, m.compose(new THREE.Vector3(px, py, PEG_Z1), q, one));
  }
  rotor.add(dividers, pegs, heads);

  // turned spokes from the hub to the band, over the lacquer
  const spokes = quality === 'high' ? 12 : 8;
  const spokeLen = BAND_IN - 0.11;
  const spokeGeo = new THREE.CylinderGeometry(0.0085, 0.0125, spokeLen, 10);
  const spokeMesh = new THREE.InstancedMesh(spokeGeo, mats.brass, spokes);
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2 + SECTOR / 2;
    q.setFromAxisAngle(zAxis, -a);
    const [sx, sy] = polar(0.11 + spokeLen / 2, a);
    spokeMesh.setMatrixAt(k, m.compose(new THREE.Vector3(sx, sy, 0.014), q, one));
  }
  rotor.add(spokeMesh);

  // the hub: a brass boss with the house star on its cap
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.115, 0.042, 48).rotateX(Math.PI / 2), mats.brass);
  hub.position.z = 0.021;
  const cap = new THREE.Mesh(new THREE.CircleGeometry(0.084, 48), new THREE.MeshStandardMaterial({ map: hubTexture(), roughness: 0.35, metalness: 0.2 }));
  cap.position.z = 0.0425;
  rotor.add(hub, cap);
  return rotor;
}

interface Mats {
  darkWood: THREE.Material;
  lacquer: THREE.Material;
  brass: THREE.Material;
  pegBrass: THREE.Material;
  leather: THREE.Material;
}

/** The clapper: a brass bracket on the cabinet's crown and the leather tongue that hangs from it. */
function buildClapper(mats: Mats): { bracket: THREE.Group; flap: THREE.Group } {
  const bracket = new THREE.Group();
  const block = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.07), mats.brass);
  block.position.set(0, FRAME_OUT - 0.005, 0.02);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.03, FLAP_Z + 0.02), mats.brass);
  arm.position.set(0, GEO.pivotR + 0.012, (FLAP_Z + 0.02) / 2);
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.03, 16).rotateX(Math.PI / 2), mats.brass);
  pin.position.set(0, GEO.pivotR, FLAP_Z);
  bracket.add(block, arm, pin);

  // the tongue: wide at the hinge, narrowing to a rounded point that reaches between the pegs
  const L = GEO.flapL;
  const s = new THREE.Shape();
  s.moveTo(-0.024, 0.014);
  s.lineTo(0.024, 0.014);
  s.lineTo(0.013, -L + 0.016);
  s.quadraticCurveTo(0, -L - 0.006, -0.013, -L + 0.016);
  s.closePath();
  const tongue = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 2 }), mats.leather);
  tongue.position.z = -0.003;
  // a line of stitching round the edge, a shade lighter
  const seam = new THREE.Mesh(
    new THREE.ShapeGeometry(s).scale(0.8, 0.9, 1).translate(0, -0.004, 0),
    new THREE.MeshStandardMaterial({ color: '#c08a55', roughness: 0.75, transparent: true, opacity: 0.35 }),
  );
  seam.position.z = 0.0046;
  const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.03, 0.016), mats.brass);
  clamp.position.set(0, 0.002, 0);
  const rivets = [-0.016, 0.016].map((x) => {
    const r = new THREE.Mesh(new THREE.SphereGeometry(0.004, 10, 8), mats.pegBrass);
    r.position.set(x, 0.002, 0.008);
    return r;
  });
  const flap = new THREE.Group();
  flap.name = FLAP_NAME;
  flap.position.set(0, GEO.pivotR, FLAP_Z);
  flap.add(tongue, seam, clamp, ...rivets);
  return { bracket, flap };
}

/** The whole wheel on its column: `floorY` is how far below the hub the floor is. */
export function buildWheel(quality: Quality, floorY: number): THREE.Group {
  const g = new THREE.Group();
  const mats: Mats = {
    darkWood: new THREE.MeshStandardMaterial({ color: '#2a130a', roughness: 0.6 }),
    lacquer: new THREE.MeshStandardMaterial({ color: '#5a2412', roughness: 0.28, metalness: 0.05 }),
    brass: new THREE.MeshStandardMaterial({ color: '#c9a24b', roughness: 0.3, metalness: 1 }),
    pegBrass: new THREE.MeshStandardMaterial({ color: '#e0c07a', roughness: 0.22, metalness: 1 }),
    leather: new THREE.MeshStandardMaterial({ color: '#9a5a30', roughness: 0.72 }),
  };
  const seg = quality === 'high' ? 128 : 72;

  // the cabinet: a round back board, a thick moulded ring round the wheel with brass edges
  const board = new THREE.Mesh(new THREE.CylinderGeometry(FRAME_OUT, FRAME_OUT, 0.03, seg).rotateX(Math.PI / 2), mats.darkWood);
  board.position.z = -0.115;
  const ring = new THREE.Mesh(
    new THREE.ExtrudeGeometry(annulus(FRAME_OUT, FRAME_IN), { depth: 0.1, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: quality === 'high' ? 4 : 1, curveSegments: seg }),
    mats.lacquer,
  );
  ring.position.z = -0.1;
  const trimOut = new THREE.Mesh(new THREE.TorusGeometry(FRAME_OUT + 0.004, 0.007, 8, seg), mats.brass);
  trimOut.position.z = 0.004;
  const trimIn = new THREE.Mesh(new THREE.TorusGeometry(FRAME_IN - 0.004, 0.005, 8, seg), mats.brass);
  trimIn.position.z = 0.006;
  g.add(board, ring, trimOut, trimIn);

  // marquee bulbs in brass cups round the ring (their colour is their light: the view dims and chases them)
  const nBulbs = quality === 'high' ? 36 : 24;
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0135, 14, 10), new THREE.MeshBasicMaterial({ color: '#ffffff' }), nBulbs);
  bulbs.name = BULBS_NAME;
  const cups = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.019, 0.016, 0.012, 20).rotateX(Math.PI / 2), mats.brass, nBulbs);
  const m = new THREE.Matrix4();
  const lit = new THREE.Color(1.9, 1.45, 0.78);
  for (let k = 0; k < nBulbs; k++) {
    const [x, y] = polar(BULB_R, ((k + 0.5) / nBulbs) * Math.PI * 2);
    bulbs.setMatrixAt(k, m.makeTranslation(x, y, 0.02));
    bulbs.setColorAt(k, lit);
    cups.setMatrixAt(k, m.makeTranslation(x, y, 0.009));
  }
  g.add(cups, bulbs);

  g.add(buildRotor(quality, mats));
  const { bracket, flap } = buildClapper(mats);
  g.add(bracket, flap);

  // the crest over the clapper: a lit sign on a moulded board
  const crestBoard = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.24, 0.07), mats.lacquer);
  crestBoard.position.set(0, CREST_Y, -0.06);
  const crestTex = crestTexture();
  const crest = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, 0.1875),
    new THREE.MeshStandardMaterial({ map: crestTex, emissive: '#ffffff', emissiveMap: crestTex, emissiveIntensity: 0.7, roughness: 0.5 }),
  );
  crest.position.set(0, CREST_Y, -0.0245);
  const crestTrim = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.012, 0.08), mats.brass);
  crestTrim.position.set(0, CREST_Y - 0.126, -0.06);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.06), mats.darkWood);
  neck.position.set(0, FRAME_OUT + 0.02, -0.07);
  g.add(crestBoard, crest, crestTrim, neck);

  // the column, the axle into the hub, and a plinth on the floor
  const colH = floorY;
  const column = new THREE.Mesh(new THREE.BoxGeometry(0.24, colH, 0.2), mats.darkWood);
  column.position.set(0, -colH / 2, -0.23);
  const colTrim = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, 0.22), mats.brass);
  colTrim.position.set(0, -floorY + 0.2, -0.23);
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.1, 24).rotateX(Math.PI / 2), mats.brass);
  axle.position.z = -0.08;
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.12, 0.42), mats.lacquer);
  plinth.position.set(0, -floorY + 0.06, -0.2);
  const plinthTrim = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.014, 0.44), mats.brass);
  plinthTrim.position.set(0, -floorY + 0.125, -0.2);
  g.add(column, colTrim, axle, plinth, plinthTrim);
  return g;
}
