// The wheel, built in code the way a real one is made. The bowl: a dark lacquered wooden rim, a
// brushed steel ball track turned into its inside, and the veneered apron sloping down to the
// rotor with its eight chrome diamonds. The rotor (wheel head): a chrome rim, the enamelled number
// ring, flocked pockets between raised chrome frets, the veneered cone with its turned rings, and
// the turned chrome turret with its cross arms. And the ball. Pocket order and colours come from
// the shared rules, laid clockwise, so the pocket the ball stops in is the pocket the server drew.
// The surfaces themselves are painted in textures.ts.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WHEEL, type Variant } from '../../../../shared/src/games/roulette/rules.ts';
import type { Quality } from '../../render/engine3d.ts';
import { DIMS, TAU } from './spin.ts';
import { veneer, rimWood, brushedSteel, numberRing, pocketFloor, VENEER_R0, VENEER_R1 } from './textures.ts';

export const WHEEL_R = 0.414;
export const ROTOR_NAME = 'roulette-rotor';
export const BALL_NAME = 'roulette-ball';

/** Rotor-frame angle of the centre of a pocket: wheel position i sits at −(i + ½) pockets. */
export function pocketAngle(v: Variant, pocket: number): number {
  const order = WHEEL[v];
  return -(order.indexOf(pocket) + 0.5) * (TAU / order.length);
}

export function sectorOf(v: Variant): number {
  return TAU / WHEEL[v].length;
}

/** Bowl deflector angles (fixed to the bowl). */
export const DEFLECTORS = Array.from({ length: 8 }, (_, i) => (i + 0.5) * (TAU / 8));

// ------------------------------------------------------------------------------------------------
// Profiles, (radius, height) from outside in, metres above the wheel's base

/** The rim: up the outside past a bead at the foot, over the rounded top, to the track's lip. */
const RIM: [number, number][] = [
  [0.4085, 0],
  [0.4122, 0.0035],
  [0.4135, 0.009],
  [0.4127, 0.0145],
  [0.4131, 0.02],
  [0.414, 0.05],
  [0.4138, 0.0625],
  [0.4128, 0.0695],
  [0.4102, 0.0748],
  [0.406, 0.0782],
  [0.4005, 0.0795],
  [0.3948, 0.0788],
  [0.3902, 0.0766],
  [0.3868, 0.0732],
];

/** The ball track: down the wall, then round the groove the ball runs in to the apron's edge. */
function trackProfile(): [number, number][] {
  const pts: [number, number][] = [
    [0.3868, 0.0732],
    [0.3843, 0.0697],
    [0.3821, 0.0655],
    [0.3803, 0.061],
    [0.3787, 0.0578],
  ];
  // a groove a little wider than the ball, round the ball's centre on the track
  const R = DIMS.ballR + 0.0004;
  for (const deg of [12, 0, -15, -30, -45, -56]) {
    const a = (deg * Math.PI) / 180;
    pts.push([DIMS.trackR + R * Math.cos(a), DIMS.trackY + R * Math.sin(a)]);
  }
  pts.push(DIMS.apron[0]!);
  return pts;
}

/** The apron (the flight uses the same points) and the lip where the bowl meets the rotor. */
const APRON: [number, number][] = [...DIMS.apron, [0.2836, 0.0183], [0.2829, 0.0136], [0.2826, 0.001]];

/** The rotor's chrome: its outer rim, the pockets' outer wall and their inner wall. */
const ROTOR_RIM: [number, number][] = [
  [0.2795, 0.0015],
  [0.28, 0.0035],
  [0.28, 0.0165],
  [0.2793, 0.0183],
  [0.2778, 0.0194],
  [0.2758, 0.0197],
  [DIMS.ringOutR, DIMS.ringOutY],
];
const POCKET_OUTER: [number, number][] = [
  [DIMS.ringInR, DIMS.ringInY],
  [0.2462, 0.0128],
  [0.2456, 0.0118],
  [0.2453, 0.0095],
  [0.2452, DIMS.pocketY],
];
const POCKET_INNER: [number, number][] = [
  [DIMS.pocketInR, DIMS.pocketY],
  [0.1969, 0.011],
  [0.1963, 0.0133],
  [0.195, 0.0146],
  [0.1932, 0.0151],
  [0.1905, 0.0153],
];

/** The cone: a gentle dome from the pockets' inner wall to the turret, with two turned grooves. */
function coneProfile(): [number, number][] {
  const r0 = 0.1905;
  const y = (r: number) => 0.0153 + 0.0405 * (1 - (r / r0) ** 1.6);
  const pts: [number, number][] = [];
  const grooves = [0.152, 0.093];
  for (let r = r0; r > 0.0405; r -= 0.006) {
    const g = grooves.find((c) => Math.abs(r - c) < 0.004);
    if (g !== undefined) continue;
    pts.push([r, y(r)]);
  }
  // add each groove as a small V cut, in order
  for (const c of grooves) {
    const at = pts.findIndex(([r]) => r < c);
    pts.splice(at, 0, [c + 0.0012, y(c + 0.0012)], [c, y(c) - 0.0009], [c - 0.0012, y(c - 0.0012)]);
  }
  pts.push([0.0405, y(0.0405)]);
  return pts;
}

/** The turret, base flange to finial. The cross arms meet its hub at ARM_Y. */
const TURRET: [number, number][] = [
  [0.0425, 0.0508],
  [0.0428, 0.0538],
  [0.0415, 0.0556],
  [0.0385, 0.0566],
  [0.033, 0.0571],
  [0.0305, 0.0586],
  [0.0302, 0.0612],
  [0.0285, 0.0628],
  [0.024, 0.0638],
  [0.0222, 0.0658],
  [0.0232, 0.0695],
  [0.0228, 0.0735],
  [0.0205, 0.0765],
  [0.0165, 0.0788],
  [0.0128, 0.0805],
  [0.0112, 0.0828],
  [0.0108, 0.0905],
  [0.0128, 0.0918],
  [0.0142, 0.0935],
  [0.0142, 0.0955],
  [0.0125, 0.0968],
  [0.0118, 0.0985],
  [0.0118, 0.1065],
  [0.0132, 0.1078],
  [0.0136, 0.1095],
  [0.0118, 0.1108],
  [0.0085, 0.1118],
  [0.0072, 0.1135],
  [0.0088, 0.1165],
  [0.0094, 0.1195],
  [0.0082, 0.1225],
  [0.0055, 0.1248],
  [0.0022, 0.1258],
  [0, 0.126],
];
const ARM_Y = 0.1025;

/** One cross arm along its own axis (distance from the spindle, radius): collar, taper, knob. */
const ARM: [number, number][] = [
  [0.0035, 0.0105],
  [0.0035, 0.016],
  [0.0046, 0.0168],
  [0.0046, 0.0196],
  [0.0033, 0.0206],
  [0.0026, 0.07],
  [0.0032, 0.0712],
  [0.0032, 0.0734],
  [0.0024, 0.0745],
  [0.0024, 0.0778],
  [0.0045, 0.0802],
  [0.006, 0.0832],
  [0.0063, 0.0858],
  [0.0056, 0.0888],
  [0.0036, 0.0914],
  [0, 0.0924],
];

// ------------------------------------------------------------------------------------------------
// Geometry helpers

function lathe(points: [number, number][], segments: number): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
}

/** A lathe whose v is its radius's place between r0 and r1 (for the polar veneer), u unchanged. */
function radialV(geo: THREE.BufferGeometry, r0: number, r1: number): THREE.BufferGeometry {
  const pos = geo.attributes.position!;
  const uv = geo.attributes.uv!;
  for (let i = 0; i < pos.count; i++) uv.setY(i, (Math.hypot(pos.getX(i), pos.getZ(i)) - r0) / (r1 - r0));
  return geo;
}

/**
 * A convex polygon in the xy plane pushed along z from z0 to z1, flat-shaded so its facets catch
 * the light separately. `lift` raises the far end's top (y above `topFrom`) by that much.
 */
function prism(poly: [number, number][], z0: number, z1: number, lift = 0, topFrom = Infinity): THREE.BufferGeometry {
  const pos: number[] = [];
  const at = (p: [number, number], z: number): THREE.Vector3 => new THREE.Vector3(p[0], p[1] + (p[1] > topFrom && z === z1 ? lift : 0), z);
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    const a = at(p, z0);
    const b = at(q, z0);
    const c = at(q, z1);
    const d = at(p, z1);
    tri(a, b, c);
    tri(a, c, d);
  }
  for (let i = 1; i < n - 1; i++) {
    tri(at(poly[0]!, z0), at(poly[i + 1]!, z0), at(poly[i]!, z0));
    tri(at(poly[0]!, z1), at(poly[i]!, z1), at(poly[i + 1]!, z1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * A diamond deflector: a rhombus base, long axis along x, rising in four facets to a smaller flat
 * rhombus on top, like a cut stone. Flat-shaded.
 */
function diamondGeometry(length: number, width: number, height: number, top: number): THREE.BufferGeometry {
  const base = [
    new THREE.Vector3(length / 2, 0, 0),
    new THREE.Vector3(0, 0, width / 2),
    new THREE.Vector3(-length / 2, 0, 0),
    new THREE.Vector3(0, 0, -width / 2),
  ];
  const crown = base.map((p) => new THREE.Vector3(p.x * top, height, p.z * top));
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    tri(base[i]!, crown[j]!, base[j]!);
    tri(base[i]!, crown[i]!, crown[j]!);
  }
  tri(crown[0]!, crown[2]!, crown[1]!);
  tri(crown[0]!, crown[3]!, crown[2]!);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------------------------------------
// Materials, made once per quality (and per variant for the ring and pockets) and shared

interface WheelMaterials {
  rim: THREE.MeshStandardMaterial;
  track: THREE.MeshStandardMaterial;
  veneer: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  ball: THREE.MeshStandardMaterial;
}

const materialCache = new Map<Quality, WheelMaterials>();
const PHYSICAL_ONLY = ['clearcoat', 'clearcoatRoughness', 'sheen', 'sheenColor', 'sheenRoughness', 'anisotropy', 'anisotropyRotation'] as const;

/** A physical material on High; on Low the standard one, without the physical-only layers. */
function surface(high: boolean, p: THREE.MeshPhysicalMaterialParameters): THREE.MeshStandardMaterial {
  if (high) return new THREE.MeshPhysicalMaterial(p);
  const q: Record<string, unknown> = { ...p };
  for (const k of PHYSICAL_ONLY) delete q[k];
  return new THREE.MeshStandardMaterial(q as THREE.MeshStandardMaterialParameters);
}
const faceCache = new Map<string, { ring: THREE.Material; pockets: THREE.Material }>();

/**
 * On High the lacquered wood is a physical material with a thin clear coat over the grain, the
 * steel track is brushed (anisotropic) and the ball has a soft sheen; on Low they're standard
 * materials with the same maps.
 */
function wheelMaterials(q: Quality): WheelMaterials {
  const cached = materialCache.get(q);
  if (cached) return cached;
  const high = q === 'high';
  const Physical = (p: THREE.MeshPhysicalMaterialParameters) => surface(high, p);

  const rimMaps = rimWood(q);
  const rimMap = rimMaps.map.clone();
  const rimSurface = rimMaps.surface.clone();
  for (const t of [rimMap, rimSurface]) t.repeat.set(5, 1);
  const rim = Physical({
    map: rimMap,
    roughness: 1,
    roughnessMap: rimSurface,
    bumpMap: rimSurface,
    bumpScale: 0.5,
    clearcoat: 0.55,
    clearcoatRoughness: 0.07,
    side: THREE.DoubleSide,
  });

  const ven = veneer(q);
  const veneerMat = Physical({
    map: ven.map,
    roughness: 1,
    roughnessMap: ven.surface,
    bumpMap: ven.surface,
    bumpScale: 0.35,
    clearcoat: 0.4,
    clearcoatRoughness: 0.12,
    side: THREE.DoubleSide,
  });

  const steel = brushedSteel(q);
  const steelNormal = steel.normal.clone();
  const steelRough = steel.roughness.clone();
  for (const t of [steelNormal, steelRough]) t.repeat.set(16, 1);
  const track = Physical({
    color: '#c4c8cd',
    metalness: 1,
    roughness: 1,
    roughnessMap: steelRough,
    normalMap: steelNormal,
    normalScale: new THREE.Vector2(0.5, 0.5),
    anisotropy: 0.6,
    anisotropyRotation: Math.PI / 2,
    side: THREE.DoubleSide,
  });

  const chrome = new THREE.MeshStandardMaterial({ color: '#dde0e4', metalness: 1, roughness: 0.1, side: THREE.DoubleSide });
  const ball = Physical({ color: '#efe8d8', roughness: 0.16, sheen: 0.5, sheenColor: new THREE.Color('#fff4e2'), sheenRoughness: 0.45 });
  const m = { rim, track, veneer: veneerMat, chrome, ball };
  materialCache.set(q, m);
  return m;
}

function faceMaterials(v: Variant, q: Quality): { ring: THREE.Material; pockets: THREE.Material } {
  const key = `${v}:${q}`;
  let m = faceCache.get(key);
  if (!m) {
    m = {
      ring: new THREE.MeshStandardMaterial({ map: numberRing(v, q), roughness: 0.3, side: THREE.DoubleSide }),
      pockets: new THREE.MeshStandardMaterial({ map: pocketFloor(v, q), roughness: 0.95, side: THREE.DoubleSide }),
    };
    faceCache.set(key, m);
  }
  return m;
}

// ------------------------------------------------------------------------------------------------

/** The whole wheel, origin at the centre of its base on the table top. */
export function buildWheel(v: Variant, quality: Quality): THREE.Group {
  const high = quality === 'high';
  const seg = high ? 160 : 72;
  const m = wheelMaterials(quality);
  const faces = faceMaterials(v, quality);
  const g = new THREE.Group();
  g.name = 'roulette-wheel';
  g.userData.variant = v;

  // The bowl
  g.add(
    new THREE.Mesh(lathe(RIM, seg), m.rim),
    new THREE.Mesh(lathe(trackProfile(), seg), m.track),
    new THREE.Mesh(radialV(lathe(APRON, seg), VENEER_R0, VENEER_R1), m.veneer),
  );

  // Diamonds on the apron, alternately along the ball's path and across it, lying on the slope.
  const slope = (DIMS.apron[1]![1] - DIMS.apron[2]![1]) / (DIMS.apron[1]![0] - DIMS.apron[2]![0]);
  const r = DIMS.deflectorR;
  const surf = DIMS.apron[2]![1] + (r - DIMS.apron[2]![0]) * slope;
  const diamonds = new THREE.InstancedMesh(diamondGeometry(0.036, 0.0135, 0.0064, 0.42), m.chrome, DEFLECTORS.length);
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const turn = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  DEFLECTORS.forEach((a, i) => {
    tangent.set(Math.cos(a), 0, -Math.sin(a));
    radial.set(Math.sin(a), slope, Math.cos(a)).normalize();
    normal.crossVectors(radial, tangent).normalize();
    basis.makeBasis(tangent, normal, radial);
    if (i % 2 === 1) basis.multiply(turn);
    basis.setPosition(r * Math.sin(a), surf - 0.0006, r * Math.cos(a));
    diamonds.setMatrixAt(i, basis);
  });
  diamonds.instanceMatrix.needsUpdate = true;
  g.add(diamonds);

  // The rotor turns; everything on it is in its frame.
  const rotor = new THREE.Group();
  rotor.name = ROTOR_NAME;

  const arm = lathe(ARM, high ? 20 : 12).rotateZ(-Math.PI / 2);
  const arms = [0, 1, 2, 3].map((i) =>
    arm
      .clone()
      .rotateY((i * Math.PI) / 2)
      .translate(0, ARM_Y, 0),
  );
  const chromeParts = [lathe(ROTOR_RIM, seg), lathe(POCKET_OUTER, seg), lathe(POCKET_INNER, seg), lathe(TURRET, high ? 64 : 32), ...arms];
  rotor.add(new THREE.Mesh(mergeGeometries(chromeParts), m.chrome));

  rotor.add(
    new THREE.Mesh(
      lathe(
        [
          [DIMS.ringOutR, DIMS.ringOutY],
          [DIMS.ringInR, DIMS.ringInY],
        ],
        seg * 2,
      ),
      faces.ring,
    ),
    new THREE.Mesh(
      lathe(
        [
          [0.2452, DIMS.pocketY],
          [DIMS.pocketInR, DIMS.pocketY],
        ],
        seg * 2,
      ),
      faces.pockets,
    ),
    new THREE.Mesh(radialV(lathe(coneProfile(), seg), VENEER_R0, VENEER_R1), m.veneer),
  );

  // Frets: one per pocket boundary, a blade with a chamfered ridge, rising toward the rim.
  const n = WHEEL[v].length;
  const t = 0.0024;
  const c = 0.0012;
  const y0 = DIMS.pocketY;
  const y1 = DIMS.fretTop - 0.0012;
  const blade = prism(
    [
      [-t / 2, y0],
      [t / 2, y0],
      [t / 2, y1 - c],
      [0, y1],
      [-t / 2, y1 - c],
    ],
    DIMS.pocketInR + 0.0002,
    0.2453,
    0.0012,
    y0 + 0.002,
  );
  const frets = new THREE.InstancedMesh(blade, m.chrome, n);
  const mtx = new THREE.Matrix4();
  for (let k = 0; k < n; k++) frets.setMatrixAt(k, mtx.makeRotationY(-k * (TAU / n)));
  frets.instanceMatrix.needsUpdate = true;
  rotor.add(frets);
  g.add(rotor);

  const ball = new THREE.Mesh(new THREE.SphereGeometry(DIMS.ballR, 32, 24), m.ball);
  ball.name = BALL_NAME;
  ball.visible = false;
  g.add(ball);
  return g;
}
