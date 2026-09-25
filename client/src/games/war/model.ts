// The Casino War table as it stands on the floor: a wood body cut to the D, a padded rail around
// the players' arc, the dealer's chip rack, the six-deck shoe on the dealer's left, the discard
// holder on the right, a lit limits sign and the printed felt. Everything is built in code; the
// table view lays its own full-resolution felt and the discard stack over it.

import * as THREE from 'three';
import { CHIPS, formatMoney } from '../../../../shared/src/money.ts';
import { DEFAULT_RULES, DECKS } from '../../../../shared/src/games/war/rules.ts';
import { engine } from '../../../../shared/src/games/war/engine.ts';
import type { TableConfig } from '../../../../shared/src/engine.ts';
import { repaintable } from '../../table/limit-sign.ts';
import type { Quality } from '../../render/engine3d.ts';
import { CHIP_R } from '../../table/chips.ts';
import { CARD_H, CARD_W } from '../../table/cards.ts';
import { TOP_Y, CENTER_Z, DEALER_Z, RAIL_R, RACK, SHOE, DISCARD, dShape, makeFelt } from './layout.ts';

export const FLOOR_FELT = 'wr-floor-felt';

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let shared: {
  wood: THREE.Material;
  leather: THREE.Material;
  metal: THREE.Material;
  brass: THREE.Material;
  smoke: THREE.Material;
  acrylic: THREE.Material;
  back: THREE.Material;
  edge: THREE.Material;
} | null = null;

function materials() {
  if (shared) return shared;
  // the house card back: a fine red lattice inside a white border, as on the shoe's top card
  const back = canvasTexture(128, 180, (g) => {
    g.fillStyle = '#f4efe6';
    g.fillRect(0, 0, 128, 180);
    g.fillStyle = '#9d1b22';
    g.fillRect(8, 8, 112, 164);
    g.strokeStyle = 'rgba(244,239,230,0.55)';
    g.lineWidth = 1.4;
    for (let i = -180; i < 180; i += 9) {
      g.beginPath();
      g.moveTo(8 + i, 8);
      g.lineTo(8 + i + 164, 172);
      g.moveTo(120 - i, 8);
      g.lineTo(120 - i - 164, 172);
      g.stroke();
    }
  });
  shared = {
    wood: new THREE.MeshPhysicalMaterial({ color: '#43220f', roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.3 }),
    leather: new THREE.MeshPhysicalMaterial({ color: '#1c1310', roughness: 0.55, sheen: 0.3, sheenColor: new THREE.Color('#4a3024') }),
    metal: new THREE.MeshStandardMaterial({ color: '#1c1b1d', roughness: 0.35, metalness: 0.7 }),
    brass: new THREE.MeshStandardMaterial({ color: '#b8904a', metalness: 0.85, roughness: 0.32 }),
    smoke: new THREE.MeshPhysicalMaterial({ color: '#16110e', roughness: 0.22, clearcoat: 0.9, clearcoatRoughness: 0.1 }),
    acrylic: new THREE.MeshPhysicalMaterial({ color: '#dfe6ea', roughness: 0.08, transparent: true, opacity: 0.28, clearcoat: 1 }),
    back: new THREE.MeshStandardMaterial({ map: back, roughness: 0.6 }),
    edge: new THREE.MeshStandardMaterial({ color: '#ece6d8', roughness: 0.8 }),
  };
  return shared;
}

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

function rack(): THREE.Group {
  const g = new THREE.Group();
  const tray = new THREE.Mesh(new THREE.BoxGeometry(RACK.w + 0.02, 0.012, RACK.d + 0.014), new THREE.MeshStandardMaterial({ color: '#15110e', roughness: 0.4, metalness: 0.3 }));
  tray.position.set(RACK.x, TOP_Y + 0.004, RACK.z);
  g.add(tray);
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

/** A six-deck shoe: a smoked wedge with its cards sloping down to the mouth, the top card showing. */
function shoe(m: ReturnType<typeof materials>): THREE.Group {
  const g = new THREE.Group();
  const profile = new THREE.Shape();
  profile.moveTo(0, 0);
  profile.lineTo(0.22, 0);
  profile.lineTo(0.22, 0.095);
  profile.lineTo(0.055, 0.074);
  profile.lineTo(0, 0.028);
  profile.lineTo(0, 0);
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(profile, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1 }), m.smoke);
  body.position.set(-0.03, 0, -0.05);
  // the cards inside, seen through the open top, and the one at the mouth
  const stack = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.06, CARD_W + 0.002), [m.edge, m.edge, m.back, m.edge, m.edge, m.edge]);
  stack.position.set(0.1, 0.05, 0);
  stack.rotation.z = 0.13;
  const top = new THREE.Mesh(new THREE.BoxGeometry(CARD_H, 0.0015, CARD_W), [m.edge, m.edge, m.back, m.edge, m.edge, m.edge]);
  top.rotation.z = 0.36;
  top.position.set(0.012, 0.052, 0);
  g.add(body, stack, top);
  g.position.copy(SHOE.pos);
  g.rotation.y = SHOE.yaw;
  return g;
}

function discardHolder(m: ReturnType<typeof materials>): THREE.Group {
  const g = new THREE.Group();
  const w = 0.078;
  const d = 0.102;
  const h = 0.11;
  const t = 0.003;
  const base = new THREE.Mesh(new THREE.BoxGeometry(w, t, d), m.acrylic);
  base.position.y = t / 2;
  const back = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), m.acrylic);
  back.position.set(0, h / 2, -d / 2);
  const left = new THREE.Mesh(new THREE.BoxGeometry(t, h, d), m.acrylic);
  left.position.set(-w / 2, h / 2, 0);
  const right = left.clone();
  right.position.x = w / 2;
  const front = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.35, t), m.acrylic);
  front.position.set(0, (h * 0.35) / 2, d / 2);
  g.add(base, back, left, right, front);
  g.position.set(DISCARD.x, TOP_Y, DISCARD.z);
  return g;
}

let signTexture: THREE.CanvasTexture | null = null;

/** The sign's face for a table at these limits (the floor's shows the Standard table's). */
function paintSign(g: CanvasRenderingContext2D, cfg: TableConfig): void {
  const bet = cfg.limits.bet ?? cfg.limits.default;
  const tie = cfg.limits.tie ?? cfg.limits.default;
  g.fillStyle = '#0d0a08';
  g.fillRect(0, 0, 512, 320);
  g.strokeStyle = 'rgba(216,176,106,0.8)';
  g.lineWidth = 4;
  g.strokeRect(10, 10, 492, 300);
  g.textAlign = 'center';
  g.fillStyle = '#f1d59a';
  g.font = '600 46px Cinzel, Georgia, serif';
  g.fillText('CASINO WAR', 256, 76);
  g.fillStyle = '#fff4dc';
  g.font = '600 74px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.fillText(`${formatMoney(bet.min)} – ${formatMoney(bet.max)}`, 256, 162);
  g.fillStyle = '#d8b06a';
  g.font = '600 25px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.fillText(`${DECKS} DECKS · TIE BET ${formatMoney(tie.min)} – ${formatMoney(tie.max)}`, 256, 218);
  g.fillText(`TIE PAYS ${DEFAULT_RULES.tiePays} TO 1 · SURRENDER OR GO TO WAR`, 256, 252);
  g.fillText(`A TIE IN THE WAR PAYS THE RAISE ${DEFAULT_RULES.warTiePays} TO 1`, 256, 286);
}

/** The lit limits sign on the dealer's right, painted from the table's own config. */
function limitSign(m: ReturnType<typeof materials>): THREE.Group {
  if (!signTexture) signTexture = canvasTexture(512, 320, (g) => paintSign(g, engine.config('', 'multi')));
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.2, 12), m.brass);
  post.position.y = 0.1;
  const face = new THREE.MeshStandardMaterial({ map: signTexture, emissive: '#ffffff', emissiveMap: signTexture, emissiveIntensity: 0.85, roughness: 0.4 });
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.125, 0.016), [m.smoke, m.smoke, m.smoke, m.smoke, face, m.smoke]);
  panel.position.y = 0.23;
  panel.rotation.x = -0.1;
  g.add(post, panel);
  g.position.set(-0.66, TOP_Y, DEALER_Z - 0.02);
  g.rotation.y = 0.36;
  repaintable(g, face, { width: 512, height: 320, paint: paintSign });
  return g;
}

export function tableModel(quality: Quality): THREE.Group {
  const m = materials();
  const g = new THREE.Group();
  g.name = 'war-table';

  // body: the D, a little larger than the felt, 12 cm deep
  const bodyDepth = 0.12;
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(dShape(RAIL_R + 0.03, DEALER_Z - 0.035), { depth: bodyDepth, bevelEnabled: false, curveSegments: 72 }), m.wood);
  body.rotation.x = -Math.PI / 2;
  // (its top 3 mm under the felt: at the felt's own 0.3 mm the wood fought through the whole felt)
  body.position.y = TOP_Y - bodyDepth - 0.003;
  g.add(body);

  // padded rail on the players' arc, capped where it meets the dealer's edge
  const half = Math.acos((DEALER_Z - 0.01 - CENTER_Z) / RAIL_R);
  const railY = TOP_Y + 0.022;
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new RailCurve(RAIL_R, railY, half), 120, 0.042, 14, false), m.leather));
  for (const s of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.042, 14, 10), m.leather);
    cap.position.set(s * Math.sin(half) * RAIL_R, railY, CENTER_Z + Math.cos(half) * RAIL_R);
    g.add(cap);
  }

  // dealer's edge: a wood bumper the length of the straight side
  const edgeHalf = Math.sqrt(RAIL_R ** 2 - (DEALER_Z - CENTER_Z) ** 2);
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(edgeHalf * 2, 0.03, 0.04), m.wood);
  bumper.position.set(0, TOP_Y + 0.01, DEALER_Z - 0.018);
  g.add(bumper);

  g.add(rack(), shoe(m), discardHolder(m), limitSign(m));

  // two pedestals
  for (const x of [-0.55, 0.55]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, TOP_Y - bodyDepth, 20), m.metal);
    col.position.set(x, (TOP_Y - bodyDepth) / 2, -0.12);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.03, 28), m.metal);
    foot.position.set(x, 0.015, -0.12);
    g.add(col, foot);
  }

  const felt = makeFelt(DEFAULT_RULES, quality === 'high' ? 520 : 320);
  felt.mesh.position.y = TOP_Y + 0.0003;
  felt.mesh.name = FLOOR_FELT;
  g.add(felt.mesh);
  return g;
}

/** Face-down cards in the discard holder, as tall as `count` cards. */
export function discardStack(): { mesh: THREE.Mesh; set(count: number): void } {
  const m = materials();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, 1, CARD_H), [m.edge, m.edge, m.back, m.edge, m.edge, m.edge]);
  mesh.position.copy(DISCARD);
  return {
    mesh,
    set(count: number) {
      const h = Math.max(0.0001, count * 0.00032);
      mesh.visible = count > 0;
      mesh.scale.y = h;
      mesh.position.y = DISCARD.y + h / 2;
    },
  };
}
