// The wheel, built in code: a lathed wooden bowl with the ball track and the sloped apron and its
// eight deflectors; the rotor (wheel head) with its number ring, pocket floors and brass frets,
// the cone and the chrome turret; and the ball. Pocket order and colours come from the shared
// rules, laid clockwise, so the pocket the ball stops in is the pocket the server drew.

import * as THREE from 'three';
import { WHEEL, colorOf, pocketLabel, type Variant } from '../../../../shared/src/games/roulette/rules.ts';
import type { Quality } from '../../render/engine3d.ts';
import { DIMS, TAU } from './spin.ts';

export const WHEEL_R = 0.414;
export const ROTOR_NAME = 'roulette-rotor';
export const BALL_NAME = 'roulette-ball';

const FILL = { red: '#a3161c', black: '#141414', green: '#0c7a3c' } as const;
const POCKET = { red: '#7c1015', black: '#0d0d0d', green: '#085a2c' } as const;

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

const textures = new Map<string, THREE.CanvasTexture>();

function stripTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  let t = textures.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    textures.set(key, t);
  }
  return t;
}

/**
 * The number ring as a strip: position i of the wheel occupies the i-th segment from the right,
 * because the lathe's u runs counterclockwise while the wheel order runs clockwise. The strip's
 * bottom is the ring's outer edge, so the numbers stand up toward the centre, as on a real head.
 */
function numberRing(v: Variant): THREE.CanvasTexture {
  const order = WHEEL[v];
  const n = order.length;
  const midR = (DIMS.ringOutR + DIMS.ringInR) / 2;
  const slant = Math.hypot(DIMS.ringOutR - DIMS.ringInR, DIMS.ringOutY - DIMS.ringInY);
  const W = 4096;
  const H = Math.round((W * slant) / (TAU * midR));
  return stripTexture(`ring:${v}`, W, H, (g) => {
    const seg = W / n;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    order.forEach((p, i) => {
      const x = (n - 1 - i) * seg;
      g.fillStyle = FILL[colorOf(p)];
      g.fillRect(x, 0, seg + 1, H);
      g.fillStyle = '#f4ead2';
      g.font = `600 ${Math.round(H * 0.66)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
      g.fillText(pocketLabel(p), x + seg / 2, H * 0.54);
    });
    // brass separators and edges
    g.fillStyle = '#d7b46a';
    for (let i = 0; i <= n; i++) g.fillRect(Math.round(i * seg) - 1, 0, 2, H);
    g.fillRect(0, 0, W, 2);
    g.fillRect(0, H - 3, W, 3);
  });
}

function pocketFloor(v: Variant): THREE.CanvasTexture {
  const order = WHEEL[v];
  const n = order.length;
  const W = 2048;
  const H = Math.round((W * (DIMS.pocketOutR - DIMS.pocketInR)) / (TAU * DIMS.restR));
  return stripTexture(`pockets:${v}`, W, H, (g) => {
    const seg = W / n;
    order.forEach((p, i) => {
      const x = (n - 1 - i) * seg;
      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, POCKET[colorOf(p)]);
      grad.addColorStop(1, FILL[colorOf(p)]);
      g.fillStyle = grad;
      g.fillRect(x, 0, seg + 1, H);
    });
  });
}

function lathe(points: [number, number][], segments: number, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  const m = new THREE.Mesh(geo, mat);
  return m;
}

export interface WheelMaterials {
  wood: THREE.MeshStandardMaterial;
  apron: THREE.MeshStandardMaterial;
  cone: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
}

export function wheelMaterials(): WheelMaterials {
  return {
    wood: new THREE.MeshStandardMaterial({ color: '#2a1209', roughness: 0.28, side: THREE.DoubleSide }),
    apron: new THREE.MeshStandardMaterial({ color: '#3f1f10', roughness: 0.34, side: THREE.DoubleSide }),
    cone: new THREE.MeshStandardMaterial({ color: '#4a2915', roughness: 0.22, side: THREE.DoubleSide }),
    brass: new THREE.MeshStandardMaterial({ color: '#cfa857', roughness: 0.28, metalness: 1, side: THREE.DoubleSide }),
    chrome: new THREE.MeshStandardMaterial({ color: '#e4e7ea', roughness: 0.14, metalness: 1 }),
  };
}

/** The whole wheel, origin at the centre of its base on the table top. */
export function buildWheel(v: Variant, quality: Quality): THREE.Group {
  const seg = quality === 'high' ? 144 : 72;
  const m = wheelMaterials();
  const g = new THREE.Group();
  g.name = 'roulette-wheel';
  g.userData.variant = v;

  // The bowl: outer rim and ball track (polished), then the apron sloping to the rotor.
  g.add(
    lathe(
      [
        [0.41, 0],
        [0.414, 0.028],
        [0.413, 0.06],
        [0.408, 0.071],
        [0.4, 0.0765],
        [0.392, 0.0755],
        [0.386, 0.068],
        [0.379, 0.052],
        [0.374, 0.0452],
        [0.372, 0.044],
      ],
      seg,
      m.wood,
    ),
    lathe([...DIMS.apron, [0.282, 0.014], [0.281, 0]], seg, m.apron),
  );
  const inlay = new THREE.Mesh(new THREE.TorusGeometry(0.4015, 0.0022, 8, seg), m.brass);
  inlay.rotation.x = Math.PI / 2;
  inlay.position.y = 0.0768;
  g.add(inlay);

  // deflectors: alternately lying along the track and standing across it
  const diamond = new THREE.OctahedronGeometry(1, 0);
  DEFLECTORS.forEach((a, i) => {
    const d = new THREE.Mesh(diamond, m.chrome);
    const r = DIMS.deflectorR;
    const surf = DIMS.apron[2]![1] + ((r - 0.3) / (0.35 - 0.3)) * (DIMS.apron[1]![1] - DIMS.apron[2]![1]);
    d.position.set(r * Math.sin(a), surf + 0.004, r * Math.cos(a));
    d.rotation.y = a;
    if (i % 2 === 0) d.scale.set(0.021, 0.0055, 0.008);
    else d.scale.set(0.007, 0.0105, 0.017);
    g.add(d);
  });

  // The rotor turns; everything on it is in its frame.
  const rotor = new THREE.Group();
  rotor.name = ROTOR_NAME;
  rotor.add(
    lathe(
      [
        [0.2795, 0.002],
        [0.2795, 0.0172],
        [DIMS.ringOutR, DIMS.ringOutY],
      ],
      seg,
      m.brass,
    ),
  );
  const ringMat = new THREE.MeshStandardMaterial({ map: numberRing(v), roughness: 0.34, side: THREE.DoubleSide });
  rotor.add(
    lathe(
      [
        [DIMS.ringOutR, DIMS.ringOutY],
        [DIMS.ringInR, DIMS.ringInY],
      ],
      seg * 2,
      ringMat,
    ),
  );
  rotor.add(
    lathe(
      [
        [DIMS.ringInR, DIMS.ringInY],
        [DIMS.pocketOutR, DIMS.pocketY],
      ],
      seg,
      m.brass,
    ),
  );
  const floorMat = new THREE.MeshStandardMaterial({ map: pocketFloor(v), roughness: 0.5, side: THREE.DoubleSide });
  rotor.add(
    lathe(
      [
        [DIMS.pocketOutR, DIMS.pocketY],
        [DIMS.pocketInR, DIMS.pocketY - 0.0005],
      ],
      seg * 2,
      floorMat,
    ),
  );
  rotor.add(
    lathe(
      [
        [DIMS.pocketInR, DIMS.pocketY - 0.0005],
        [0.1945, 0.0145],
        [0.186, 0.018],
      ],
      seg,
      m.brass,
    ),
    lathe(
      [
        [0.186, 0.018],
        [0.14, 0.03],
        [0.09, 0.0435],
        [0.05, 0.052],
        [0.034, 0.0565],
      ],
      seg,
      m.cone,
    ),
  );

  // frets: one per pocket boundary, radial
  const n = WHEEL[v].length;
  const fretLen = DIMS.pocketOutR - DIMS.pocketInR;
  const fretH = DIMS.fretTop - DIMS.pocketY;
  const frets = new THREE.InstancedMesh(new THREE.BoxGeometry(0.0022, fretH, fretLen), m.brass, n);
  const mid = (DIMS.pocketOutR + DIMS.pocketInR) / 2;
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < n; k++) {
    const a = -k * (TAU / n);
    q.setFromAxisAngle(up, a);
    mtx.compose(new THREE.Vector3(mid * Math.sin(a), DIMS.pocketY + fretH / 2, mid * Math.cos(a)), q, new THREE.Vector3(1, 1, 1));
    frets.setMatrixAt(k, mtx);
  }
  frets.instanceMatrix.needsUpdate = true;
  rotor.add(frets);

  // turret: base, spindle, four arms with knobs, cap
  const turret = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.012, 32), m.chrome);
  base.position.y = 0.062;
  const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.009, 0.05, 20), m.chrome);
  spindle.position.y = 0.09;
  turret.add(base, spindle);
  const armGeo = new THREE.CylinderGeometry(0.0038, 0.0038, 0.064, 12);
  const knobGeo = new THREE.SphereGeometry(0.0082, 16, 12);
  for (let i = 0; i < 4; i++) {
    const armPivot = new THREE.Group();
    armPivot.rotation.y = (i / 4) * TAU;
    const bar = new THREE.Mesh(armGeo, m.chrome);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(0, 0.108, 0.032);
    const knob = new THREE.Mesh(knobGeo, m.chrome);
    knob.position.set(0, 0.108, 0.066);
    armPivot.add(bar, knob);
    turret.add(armPivot);
  }
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.0105, 20, 14), m.chrome);
  cap.position.y = 0.117;
  turret.add(cap);
  rotor.add(turret);
  g.add(rotor);

  const ball = new THREE.Mesh(new THREE.SphereGeometry(DIMS.ballR, 24, 16), new THREE.MeshStandardMaterial({ color: '#f6f2e8', roughness: 0.22 }));
  ball.name = BALL_NAME;
  ball.visible = false;
  g.add(ball);
  return g;
}
