// The blackjack table as it stands on the floor: a lacquered wooden half-moon with a padded
// leather rail, the printed felt, the dealer's chip rack, the shoe on the dealer's left, the
// continuous shuffling machine on the dealer's right (the dealer feeds each round's cards into it,
// and it keeps the shoe topped up with shuffled decks) and a lit limit sign. Everything is built in code (there
// is no CC0 casino table good enough to use), with small canvas textures shared by every table.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHIPS, formatMoney, type ChipSpec } from '../../../../shared/src/money.ts';
import { chipFaceCanvas, CHIP_R } from '../../table/chips.ts';
import { engine } from '../../../../shared/src/games/blackjack/engine.ts';
import type { TableConfig } from '../../../../shared/src/engine.ts';
import { repaintable } from '../../table/limit-sign.ts';
import { DECKS } from '../../../../shared/src/games/blackjack/rules.ts';
import { BODY_RX, BODY_RZ, DEALER_Z, DISCARD, RACK, RAIL_RX, RAIL_RZ, SHOE, TOP_Y } from './layout.ts';
import { feltGeometry, floorFeltMaterial } from './felt.ts';

let shared: {
  wood: THREE.Material;
  darkWood: THREE.Material;
  leather: THREE.Material;
  brass: THREE.Material;
  acrylic: THREE.Material;
  smoke: THREE.Material;
  rackBody: THREE.Material;
  cardBack: THREE.Material;
} | null = null;

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}

/** Mahogany: long wavy grain lines over a warm base. */
function woodTexture(base: string, dark: string): THREE.CanvasTexture {
  return canvasTexture(512, 256, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 90; i++) {
      const y0 = Math.random() * 256;
      g.strokeStyle = dark;
      g.globalAlpha = 0.08 + Math.random() * 0.22;
      g.lineWidth = 0.6 + Math.random() * 2.2;
      g.beginPath();
      for (let x = 0; x <= 512; x += 16) {
        const y = y0 + Math.sin(x / (40 + i) + i) * 3 + Math.sin(x / 9 + i * 1.7) * 0.6;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  }, [3, 1]);
}

/** Leather: a dark hide with a fine pebble. */
function leatherTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = '#170d09';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5000; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.4)' : 'rgba(95,62,44,0.16)';
      const r = 0.6 + Math.random() * 1.6;
      g.beginPath();
      g.arc(Math.random() * 256, Math.random() * 256, r, 0, Math.PI * 2);
      g.fill();
    }
  }, [24, 1]);
}

function cardBackTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 180, (g) => {
    g.fillStyle = '#f3efe6';
    g.fillRect(0, 0, 128, 180);
    g.fillStyle = '#9b1b22';
    g.fillRect(8, 8, 112, 164);
    g.strokeStyle = 'rgba(243,239,230,0.45)';
    g.lineWidth = 1.5;
    for (let i = -180; i < 180; i += 10) {
      g.beginPath();
      g.moveTo(8 + i, 8);
      g.lineTo(8 + i + 164, 172);
      g.moveTo(120 - i, 8);
      g.lineTo(120 - i - 164, 172);
      g.stroke();
    }
  });
}

function materials() {
  if (shared) return shared;
  shared = {
    wood: new THREE.MeshPhysicalMaterial({ map: woodTexture('#5a2c17', '#2a1208'), roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.25 }),
    darkWood: new THREE.MeshStandardMaterial({ map: woodTexture('#2c170d', '#120804'), roughness: 0.6 }),
    leather: new THREE.MeshPhysicalMaterial({ map: leatherTexture(), roughness: 0.5, sheen: 0.25, sheenColor: new THREE.Color('#4a3024'), clearcoat: 0.2, clearcoatRoughness: 0.5 }),
    brass: new THREE.MeshStandardMaterial({ color: '#b8904a', metalness: 0.85, roughness: 0.32 }),
    acrylic: new THREE.MeshPhysicalMaterial({ color: '#dfe6ea', roughness: 0.08, transparent: true, opacity: 0.28, clearcoat: 1 }),
    smoke: new THREE.MeshPhysicalMaterial({ color: '#16110e', roughness: 0.22, clearcoat: 0.9, clearcoatRoughness: 0.1 }),
    rackBody: new THREE.MeshStandardMaterial({ color: '#1b1411', roughness: 0.5 }),
    cardBack: new THREE.MeshStandardMaterial({ map: cardBackTexture(), roughness: 0.6 }),
  };
  return shared;
}

// Chips standing on edge in the rack's channels: a tube whose side shows the chip edges.
const tubeMaterials = new Map<number, THREE.Material[]>();
function chipTubeMaterials(spec: ChipSpec): THREE.Material[] {
  let mats = tubeMaterials.get(spec.value);
  if (!mats) {
    const count = 28;
    const side = canvasTexture(256, count * 12, (g) => {
      for (let i = 0; i < count; i++) {
        g.fillStyle = spec.body;
        g.fillRect(0, i * 12, 256, 12);
        g.fillStyle = spec.spots;
        const turn = Math.random() * 256;
        for (let k = 0; k < 6; k++) g.fillRect((turn + k * (256 / 6)) % 256, i * 12 + 1, 256 / 18, 10);
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(0, i * 12 + 11, 256, 1);
      }
    });
    const face = new THREE.CanvasTexture(chipFaceCanvas(spec, 128));
    face.colorSpace = THREE.SRGBColorSpace;
    const cap = new THREE.MeshStandardMaterial({ map: face, roughness: 0.4 });
    mats = [new THREE.MeshStandardMaterial({ map: side, roughness: 0.45 }), cap, cap];
    tubeMaterials.set(spec.value, mats);
  }
  return mats;
}

function outline(rx: number, rz: number, back: number): THREE.Shape {
  // Shape coordinates: x across, y = -z (so the dealer edge is at positive y).
  const s = new THREE.Shape();
  s.moveTo(-rx, back);
  s.lineTo(rx, back);
  s.lineTo(rx, -DEALER_Z);
  s.absellipse(0, -DEALER_Z, rx, rz, 0, Math.PI, true);
  s.lineTo(-rx, back);
  return s;
}

function tableTop(m: ReturnType<typeof materials>): THREE.Object3D {
  const g = new THREE.Group();
  const top = new THREE.Mesh(
    new THREE.ExtrudeGeometry(outline(BODY_RX, BODY_RZ, -DEALER_Z + 0.06), { depth: 0.06, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 64 }),
    m.wood,
  );
  top.rotation.x = -Math.PI / 2;
  top.position.y = TOP_Y - 0.072;
  g.add(top);

  const felt = new THREE.Mesh(feltGeometry(), floorFeltMaterial());
  felt.rotation.x = -Math.PI / 2;
  felt.position.y = TOP_Y;
  g.add(felt);

  // The padded rail: a flattened tube along the players' arc, with rounded ends.
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 96; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 96;
    points.push(new THREE.Vector3(RAIL_RX * Math.sin(a), 0, DEALER_Z + RAIL_RZ * Math.cos(a)));
  }
  const rail = new THREE.Group();
  rail.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 160, 0.052, 18, false), m.leather));
  for (const end of [points[0]!, points.at(-1)!]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.052, 18, 12), m.leather);
    cap.position.copy(end);
    rail.add(cap);
  }
  rail.scale.y = 0.62;
  rail.position.y = TOP_Y + 0.014;
  g.add(rail);

  // Pedestal and plinth under the dealer side.
  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(1.3, TOP_Y - 0.12, 0.44), m.darkWood);
  cabinet.position.set(0, (TOP_Y - 0.12) / 2 + 0.05, -0.2);
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.05, 0.54), m.darkWood);
  plinth.position.set(0, 0.025, -0.2);
  const band = new THREE.Mesh(new THREE.BoxGeometry(1.31, 0.012, 0.445), m.brass);
  band.position.set(0, TOP_Y - 0.14, -0.2);
  g.add(cabinet, plinth, band);
  return g;
}

function chipRack(m: ReturnType<typeof materials>): THREE.Object3D {
  const g = new THREE.Group();
  const w = 0.64;
  const d = 0.11;
  const tray = new THREE.Mesh(new THREE.BoxGeometry(w, 0.024, d), m.rackBody);
  tray.position.set(0, TOP_Y + 0.012, RACK.z);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.012, 0.006, 0.01), m.brass);
  lip.position.set(0, TOP_Y + 0.024, RACK.z + d / 2);
  g.add(tray, lip);
  const byValue = new Map(CHIPS.map((c) => [c.value, c]));
  const order = [100_000, 50_000, 10_000, 10_000, 2_500, 2_500, 2_500, 500, 500, 100];
  const tube = new THREE.CylinderGeometry(CHIP_R, CHIP_R, 0.094, 28);
  order.forEach((value, i) => {
    const mesh = new THREE.Mesh(tube, chipTubeMaterials(byValue.get(value)!));
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(-w / 2 + 0.034 + i * 0.0635, TOP_Y + 0.03, RACK.z);
    g.add(mesh);
  });
  return g;
}

function shoe(m: ReturnType<typeof materials>): THREE.Object3D {
  const g = new THREE.Group();
  const profile = new THREE.Shape();
  profile.moveTo(0, 0);
  profile.lineTo(0.24, 0);
  profile.lineTo(0.24, 0.1);
  profile.lineTo(0.06, 0.078);
  profile.lineTo(0, 0.03);
  profile.lineTo(0, 0);
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(profile, { depth: 0.104, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1 }), m.smoke);
  body.position.set(-0.03, 0, -0.052);
  // The top card showing at the mouth.
  const card = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.0015, 0.086), m.cardBack);
  card.rotation.z = -0.36;
  card.rotation.y = Math.PI / 2;
  card.position.set(-0.004, 0.047, 0);
  g.add(body, card);
  g.position.copy(SHOE.pos);
  g.rotation.y = SHOE.yaw;
  return g;
}

let csmFace: THREE.CanvasTexture | null = null;

/**
 * A continuous shuffling machine where a discard holder would be: a charcoal cabinet with a brushed
 * steel top, the loading tray the dealer drops each round's cards into (a steel rim round a dark
 * well, the last card lying in it), and an amber readout on the face toward the players. The
 * readout's texture is shared by every table.
 */
function shuffler(m: ReturnType<typeof materials>): THREE.Object3D {
  const g = new THREE.Group();
  const w = 0.13;
  const d = 0.15;
  const h = 0.066;
  const cabinet = new THREE.MeshStandardMaterial({ color: '#26262a', roughness: 0.5, metalness: 0.25 });
  const steel = new THREE.MeshStandardMaterial({ color: '#a4a7ac', roughness: 0.3, metalness: 0.85 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cabinet);
  body.position.y = h / 2;
  const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.004, d), steel);
  top.position.y = h + 0.002;
  // the loading tray: a dark well framed by a raised steel rim, a card lying in it
  const tw = 0.074;
  const td = 0.1;
  const tz = -0.014;
  const well = new THREE.Mesh(new THREE.BoxGeometry(tw, 0.002, td), m.rackBody);
  well.position.set(0, h + 0.005, tz);
  const card = new THREE.Mesh(new THREE.BoxGeometry(0.063, 0.0015, 0.088), m.cardBack);
  card.position.set(0, h + 0.0068, tz);
  // the rim's four sides as one mesh
  const rail = (rw: number, rd: number, x: number, z: number) => new THREE.BoxGeometry(rw, 0.009, rd).translate(x, h + 0.0085, z);
  const rim = new THREE.Mesh(
    mergeGeometries([
      rail(tw + 0.012, 0.006, 0, tz - td / 2 - 0.003),
      rail(tw + 0.012, 0.006, 0, tz + td / 2 + 0.003),
      rail(0.006, td, -tw / 2 - 0.003, tz),
      rail(0.006, td, tw / 2 + 0.003, tz),
    ])!,
    steel,
  );
  g.add(body, top, well, card, rim);
  if (!csmFace) {
    csmFace = canvasTexture(256, 64, (c) => {
      c.fillStyle = '#0a0806';
      c.fillRect(0, 0, 256, 64);
      c.fillStyle = '#ffae3d';
      c.font = '600 34px "Barlow Condensed", "Arial Narrow", sans-serif';
      c.textAlign = 'center';
      c.fillText('6 DECKS  ·  SHUFFLED', 128, 44);
    });
  }
  const glow = new THREE.MeshStandardMaterial({ map: csmFace, emissive: '#ffffff', emissiveMap: csmFace, emissiveIntensity: 0.8, roughness: 0.3 });
  const readout = new THREE.Mesh(new THREE.PlaneGeometry(0.092, 0.023), glow);
  readout.position.set(0, h * 0.6, d / 2 + 0.0008);
  g.add(readout);
  g.position.copy(DISCARD);
  return g;
}

let signTexture: THREE.CanvasTexture | null = null;

/** The sign's face for a table at these limits (the floor's shows the Standard table's). */
function paintSign(g: CanvasRenderingContext2D, cfg: TableConfig): void {
  const lim = cfg.limits.default;
  g.fillStyle = '#0d0a08';
  g.fillRect(0, 0, 512, 320);
  g.strokeStyle = 'rgba(216,176,106,0.8)';
  g.lineWidth = 4;
  g.strokeRect(10, 10, 492, 300);
  g.textAlign = 'center';
  g.fillStyle = '#f1d59a';
  g.font = '600 46px Cinzel, Georgia, serif';
  g.fillText('BLACKJACK', 256, 76);
  g.fillStyle = '#fff4dc';
  g.font = '600 74px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.fillText(`${formatMoney(lim.min)} – ${formatMoney(lim.max)}`, 256, 162);
  g.fillStyle = '#d8b06a';
  g.font = '600 25px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.fillText(`${DECKS} DECKS · DOUBLE AFTER SPLIT · SPLIT TO 4 HANDS`, 256, 218);
  g.fillText('LATE SURRENDER · DEALER STANDS ON ALL 17s', 256, 252);
  g.fillText('BLACKJACK PAYS 3 TO 2', 256, 286);
}

function limitSign(m: ReturnType<typeof materials>): THREE.Object3D {
  if (!signTexture) signTexture = canvasTexture(512, 320, (g) => paintSign(g, engine.config('', 'multi')));
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.2, 12), m.brass);
  post.position.y = 0.1;
  const face = new THREE.MeshStandardMaterial({ map: signTexture, emissive: '#ffffff', emissiveMap: signTexture, emissiveIntensity: 0.85, roughness: 0.4 });
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.125, 0.016), [m.smoke, m.smoke, m.smoke, m.smoke, face, m.smoke]);
  panel.position.y = 0.23;
  panel.rotation.x = -0.1;
  g.add(post, panel);
  g.position.set(-0.84, TOP_Y, DEALER_Z - 0.035);
  g.rotation.y = 0.42;
  repaintable(g, face, { width: 512, height: 320, paint: paintSign });
  return g;
}

export function tableModel(): THREE.Group {
  const m = materials();
  const g = new THREE.Group();
  g.name = 'blackjack-table';
  g.add(tableTop(m), chipRack(m), shoe(m), shuffler(m), limitSign(m));
  return g;
}
