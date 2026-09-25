// The Let It Ride table as it stands on the floor: a wood body cut to the D, a padded rail
// around the players' arc, the dealer's chip rack, the shuffler and the discard holder, and a
// printed felt at floor resolution. The table view lays its own full-resolution felt over it.

import * as THREE from 'three';
import { CHIPS } from '../../../../shared/src/money.ts';
import { DEFAULT_PAYTABLE } from '../../../../shared/src/games/letitride/rules.ts';
import type { Quality } from '../../render/engine3d.ts';
import { CHIP_R } from '../../table/chips.ts';
import { TOP_Y, CENTER_Z, DEALER_Z, RAIL_R, RACK, SHUFFLER, DISCARD, dShape, makeFelt } from './layout.ts';

export const FLOOR_FELT = 'lr-floor-felt';

/** An arc around the table centre at height y, from one end of the dealer's edge to the other. */
class RailCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private readonly r: number,
    private readonly y: number,
    private readonly half: number,
  ) {
    super();
  }
  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const a = -this.half + 2 * this.half * t;
    return target.set(Math.sin(a) * this.r, this.y, CENTER_Z + Math.cos(a) * this.r);
  }
}

function rackChips(): THREE.Group {
  const g = new THREE.Group();
  const specs = CHIPS.filter((c) => !c.payoutOnly).slice(0, 7);
  const len = RACK.d * 0.8;
  const geo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, len, 28);
  const gap = RACK.w / (specs.length * 2);
  // two tubes of each colour, lowest denomination at the dealer's right
  specs.forEach((spec, i) => {
    const mat = new THREE.MeshStandardMaterial({ color: spec.body, roughness: 0.45 });
    for (let k = 0; k < 2; k++) {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = Math.PI / 2;
      m.position.set(RACK.x - RACK.w / 2 + gap * (i * 2 + k + 0.5), TOP_Y + 0.002 + CHIP_R * 0.55, RACK.z);
      g.add(m);
    }
  });
  return g;
}

export function tableModel(quality: Quality): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#3a2314', roughness: 0.55 });
  const leather = new THREE.MeshStandardMaterial({ color: '#1b1411', roughness: 0.62 });
  const metal = new THREE.MeshStandardMaterial({ color: '#1c1b1d', roughness: 0.35, metalness: 0.7 });

  // body: the D, a little larger than the felt, 12 cm deep
  const bodyDepth = 0.12;
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(dShape(RAIL_R + 0.03, DEALER_Z - 0.035), { depth: bodyDepth, bevelEnabled: false, curveSegments: 72 }), wood);
  body.rotation.x = -Math.PI / 2;
  body.position.y = TOP_Y - bodyDepth;
  g.add(body);

  // padded rail on the players' arc, capped where it meets the dealer's edge
  const half = Math.acos((DEALER_Z - 0.01 - CENTER_Z) / RAIL_R);
  const railY = TOP_Y + 0.022;
  const rail = new THREE.Mesh(new THREE.TubeGeometry(new RailCurve(RAIL_R, railY, half), 120, 0.042, 14, false), leather);
  g.add(rail);
  for (const s of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.042, 14, 10), leather);
    cap.position.set(s * Math.sin(half) * RAIL_R, railY, CENTER_Z + Math.cos(half) * RAIL_R);
    g.add(cap);
  }

  // dealer's edge: a wood bumper the length of the straight side
  const edgeHalf = Math.sqrt(RAIL_R ** 2 - (DEALER_Z - CENTER_Z) ** 2);
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(edgeHalf * 2, 0.03, 0.04), wood);
  bumper.position.set(0, TOP_Y + 0.01, DEALER_Z - 0.018);
  g.add(bumper);

  // chip rack, set into the felt
  const rack = new THREE.Mesh(new THREE.BoxGeometry(RACK.w + 0.02, 0.012, RACK.d + 0.014), new THREE.MeshStandardMaterial({ color: '#15110e', roughness: 0.4, metalness: 0.3 }));
  rack.position.set(RACK.x, TOP_Y + 0.004, RACK.z);
  g.add(rack, rackChips());

  // shuffler: a squat grey machine with a lit output tray
  const shuffler = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.09, 0.12), new THREE.MeshStandardMaterial({ color: '#2c2d31', roughness: 0.5, metalness: 0.25 }));
  box.position.y = 0.045;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.004, 0.105), new THREE.MeshStandardMaterial({ color: '#0f1012', roughness: 0.2, metalness: 0.4 }));
  lid.position.y = 0.092;
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.012, 0.04), new THREE.MeshStandardMaterial({ color: '#16171a', roughness: 0.3, emissive: '#1f3b66', emissiveIntensity: 0.35 }));
  tray.position.set(0, 0.012, 0.075);
  shuffler.add(box, lid, tray);
  shuffler.position.set(SHUFFLER.x, TOP_Y, SHUFFLER.z - 0.02);
  g.add(shuffler);

  // discard holder: a smoked acrylic box
  const discard = new THREE.Mesh(
    new THREE.BoxGeometry(0.085, 0.05, 0.11),
    new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.55 }),
  );
  discard.position.set(DISCARD.x, TOP_Y + 0.025, DISCARD.z);
  g.add(discard);

  // two pedestals
  for (const x of [-0.62, 0.62]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, TOP_Y - bodyDepth, 20), metal);
    col.position.set(x, (TOP_Y - bodyDepth) / 2, -0.12);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.03, 28), metal);
    foot.position.set(x, 0.015, -0.12);
    g.add(col, foot);
  }

  const felt = makeFelt(DEFAULT_PAYTABLE, quality === 'high' ? 520 : 320);
  felt.mesh.position.y = TOP_Y + 0.0003;
  felt.mesh.name = FLOOR_FELT;
  g.add(felt.mesh);
  return g;
}
