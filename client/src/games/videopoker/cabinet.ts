// The machine as it stands on the floor, built from boxes and printed glass: a slant-top upright
// whose 4:3 screen tips back toward a seated player, a lit button deck and padded armrest in front,
// belly glass below, a lit sign and candle on top, and a stool. The screen and the buttons are
// named so the play view can find them, and the screen's geometry is exported so the play camera
// and the DOM screen line up with it exactly.

import * as THREE from 'three';
import type { Pose } from '../../table/stage.ts';
import { PAYTABLE, HAND_NAMES } from '../../../../shared/src/games/videopoker/hands.ts';

export const SCREEN_W = 0.44;
export const SCREEN_H = 0.33;
const TILT = (24 * Math.PI) / 180;
const SCREEN_CENTER = new THREE.Vector3(0, 1.06, 0.035);
const DECK_TOP = 0.86;
const BUTTON_Z = 0.205;
/** The model is built with the screen near z = 0 and shifted so machine plus stool center on the origin. */
const SHIFT_Z = -0.31;

/** Footprint of machine and stool, and where the player sits, in the shifted (local) frame. */
export const FOOTPRINT = { width: 0.74, depth: 1.36 };
export const SEAT: [number, number, number] = [0, 0, 0.78 + SHIFT_Z];
/** On the button deck between the buttons and the armrest, where a big win's chips land. */
export const DECK_POINT = new THREE.Vector3(0, DECK_TOP + 0.002, 0.3 + SHIFT_Z);

/** The screen's corners in machine coordinates: top-left, top-right, bottom-right, bottom-left. */
export function screenCorners(): THREE.Vector3[] {
  const m = new THREE.Matrix4().makeRotationX(-TILT).setPosition(SCREEN_CENTER.x, SCREEN_CENTER.y, SCREEN_CENTER.z + SHIFT_Z);
  return [
    [-1, 1],
    [1, 1],
    [1, -1],
    [-1, -1],
  ].map(([x, y]) => new THREE.Vector3((x! * SCREEN_W) / 2, (y! * SCREEN_H) / 2, 0.007).applyMatrix4(m));
}

/**
 * Where a seated player's eyes are: square to the screen, so the DOM screen is a plain scaled
 * rectangle (crisp text), and a little low, so the button deck shows below it.
 */
export function machinePose(): Pose {
  const normal = new THREE.Vector3(0, Math.sin(TILT), Math.cos(TILT));
  const up = new THREE.Vector3(0, Math.cos(TILT), -Math.sin(TILT));
  const eye = SCREEN_CENTER.clone().setZ(SCREEN_CENTER.z + SHIFT_Z).addScaledVector(normal, 0.62).addScaledVector(up, -0.05);
  const target = eye.clone().addScaledVector(normal, -1);
  return { position: [eye.x, eye.y, eye.z], target: [target.x, target.y, target.z] };
}

export type ButtonId = 'pays' | 'betone' | 'hold0' | 'hold1' | 'hold2' | 'hold3' | 'hold4' | 'betmax' | 'deal';

interface ButtonSpec {
  id: ButtonId;
  lines: string[];
  key: string;
  x: number;
  w: number;
  /** Lens color, lit and unlit. */
  face: string;
  ink: string;
}

// Left to right as on the deck; the five holds sit under the five cards.
export const BUTTONS: readonly ButtonSpec[] = [
  { id: 'pays', lines: ['SEE', 'PAYS'], key: 'H', x: -0.283, w: 0.056, face: '#7fb2ff', ink: '#0b1a4a' },
  { id: 'betone', lines: ['BET', 'ONE'], key: '↑', x: -0.214, w: 0.056, face: '#ffb347', ink: '#3a1a00' },
  ...[0, 1, 2, 3, 4].map((i) => ({ id: `hold${i}` as ButtonId, lines: ['HOLD'], key: String(i + 1), x: (i - 2) * 0.064, w: 0.054, face: '#fff4d6', ink: '#3a2a10' })),
  { id: 'betmax', lines: ['BET', 'MAX'], key: 'B', x: 0.214, w: 0.056, face: '#ffb347', ink: '#3a1a00' },
  { id: 'deal', lines: ['DEAL', 'DRAW'], key: 'SPACE', x: 0.285, w: 0.066, face: '#7ee08a', ink: '#06300f' },
];

const BUTTON_D = 0.036;
const BUTTON_H = 0.012;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

function texture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Paint now, and again once the web fonts it uses have loaded (canvas text doesn't wait for them). */
function paintWithFonts(t: THREE.CanvasTexture, paint: () => void): void {
  paint();
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  void Promise.all(['600 20px "Barlow Condensed"', '700 20px Cinzel', '20px Limelight'].map((f) => fonts.load(f).catch(() => []))).then(() => {
    paint();
    t.needsUpdate = true;
  });
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function buttonLabel(spec: ButtonSpec): THREE.CanvasTexture {
  const W = 256;
  const H = Math.round((W * BUTTON_D) / spec.w);
  const { c, g } = canvas(W, H);
  const t = texture(c);
  paintWithFonts(t, () => {
    g.fillStyle = spec.face;
    g.fillRect(0, 0, W, H);
    // A soft lens edge, the way a backlit button reads.
    g.strokeStyle = 'rgba(0,0,0,0.28)';
    g.lineWidth = 10;
    g.strokeRect(0, 0, W, H);
    g.fillStyle = spec.ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const size = spec.lines.length > 1 ? 46 : 58;
    g.font = `600 ${size}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    const top = spec.lines.length > 1 ? H * 0.3 : H * 0.38;
    spec.lines.forEach((line, i) => g.fillText(line, W / 2, top + i * size * 0.92));
    // The keyboard shortcut as a small keycap along the bottom edge.
    g.font = `600 30px "Barlow Condensed", sans-serif`;
    const kw = Math.max(40, g.measureText(spec.key).width + 22);
    g.globalAlpha = 0.75;
    g.lineWidth = 3;
    g.strokeStyle = spec.ink;
    roundRect(g, W / 2 - kw / 2, H - 48, kw, 36, 7);
    g.stroke();
    g.fillText(spec.key, W / 2, H - 29);
    g.globalAlpha = 1;
  });
  return t;
}

/** The attract screen shown while nobody plays: the pay glass and GAME OVER. */
function attractScreen(): THREE.CanvasTexture {
  const { c, g } = canvas(800, 600);
  const t = texture(c);
  const back = new Image();
  const paint = () => {
    g.fillStyle = '#0a1672';
    g.fillRect(0, 0, 800, 600);
    g.fillStyle = '#1d3fd8';
    g.fillRect(12, 10, 776, 252);
    PAYTABLE.forEach((row, i) => {
      const y = 10 + i * 28;
      g.fillStyle = '#d4141f';
      g.fillRect(12 + 250 + 4 * 105, y, 106, 28);
      g.strokeStyle = '#0b1a6e';
      g.lineWidth = 2;
      g.strokeRect(12, y, 776, 28);
      g.fillStyle = '#ffe600';
      g.font = '600 22px "Barlow Condensed", sans-serif';
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.fillText(HAND_NAMES[row.rank]!.toUpperCase(), 24, y + 15);
      g.textAlign = 'right';
      row.pays.forEach((p, col) => g.fillText(String(p), 12 + 250 + (col + 1) * 105 - 12, y + 15));
    });
    for (let i = 0; i < 5; i++) {
      const x = 400 + (i - 2) * 150 - 68;
      if (back.complete && back.naturalWidth) g.drawImage(back, x, 336, 136, 190);
      else {
        g.fillStyle = '#b3202a';
        g.fillRect(x, 336, 136, 190);
      }
    }
    g.textAlign = 'center';
    g.fillStyle = '#ff4a3d';
    g.font = '600 34px "Barlow Condensed", sans-serif';
    g.fillText('GAME OVER', 400, 292);
    g.fillStyle = '#ffe600';
    g.font = '600 24px "Barlow Condensed", sans-serif';
    g.textAlign = 'right';
    g.fillText('CREDITS 0', 780, 568);
    g.textAlign = 'left';
    g.fillText('BET 5', 330, 568);
  };
  back.onload = () => {
    paint();
    t.needsUpdate = true;
  };
  back.src = `${import.meta.env.BASE_URL}assets/cards/back-red.svg`;
  paintWithFonts(t, paint);
  return t;
}

function bellyGlass(): THREE.CanvasTexture {
  const { c, g } = canvas(512, 512);
  const t = texture(c);
  paintWithFonts(t, () => {
    g.fillStyle = '#0d0c22';
    g.fillRect(0, 0, 512, 512);
    // Deco sunburst behind the title.
    g.save();
    g.translate(256, 250);
    for (let i = 0; i < 36; i++) {
      g.rotate((Math.PI * 2) / 36);
      g.fillStyle = i % 2 ? 'rgba(216,176,106,0.10)' : 'rgba(216,176,106,0.04)';
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(-18, -360);
      g.lineTo(18, -360);
      g.fill();
    }
    g.restore();
    g.strokeStyle = '#d8b06a';
    g.lineWidth = 4;
    g.strokeRect(18, 18, 476, 476);
    g.lineWidth = 1.5;
    g.strokeRect(28, 28, 456, 456);
    g.textAlign = 'center';
    g.fillStyle = '#f1d59a';
    g.font = '64px Limelight, Georgia, serif';
    g.fillText('JACKS', 256, 196);
    g.font = '30px Limelight, Georgia, serif';
    g.fillText('OR BETTER', 256, 244);
    g.font = '700 26px Cinzel, Georgia, serif';
    g.fillStyle = '#e8e2d2';
    g.fillText('DRAW POKER', 256, 308);
    g.font = '600 22px "Barlow Condensed", sans-serif';
    g.fillStyle = '#d8b06a';
    g.fillText('9 / 6  FULL PAY   ·   $1  $5  $25', 256, 346);
    g.font = '600 17px "Barlow Condensed", sans-serif';
    g.fillStyle = 'rgba(232,226,210,0.8)';
    g.fillText('MALFUNCTION VOIDS ALL PAYS AND PLAYS', 256, 438);
    g.fillText('ONLY HIGHEST WINNER PAID', 256, 462);
  });
  return t;
}

function topperSign(): THREE.CanvasTexture {
  const { c, g } = canvas(512, 150);
  const t = texture(c);
  paintWithFonts(t, () => {
    g.fillStyle = '#12091c';
    g.fillRect(0, 0, 512, 150);
    g.strokeStyle = '#d8b06a';
    g.lineWidth = 5;
    roundRect(g, 10, 10, 492, 130, 14);
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffd766';
    g.font = '58px Limelight, Georgia, serif';
    g.fillText('JACKS OR BETTER', 256, 72);
    g.font = '600 20px "Barlow Condensed", sans-serif';
    g.fillStyle = '#f4efe4';
    g.fillText('VIDEO POKER', 256, 120);
  });
  return t;
}

// Geometry and materials shared by every machine on the floor. Buttons and the screen get their
// own materials per machine because the play view lights them.
const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 32);
const lacquer = new THREE.MeshStandardMaterial({ color: '#131016', roughness: 0.62, metalness: 0.12 });
const trim = new THREE.MeshStandardMaterial({ color: '#b8894a', roughness: 0.3, metalness: 0.85 });
const leather = new THREE.MeshStandardMaterial({ color: '#5a1418', roughness: 0.55 });
const rubber = new THREE.MeshStandardMaterial({ color: '#0c0b0d', roughness: 0.8 });
const bezel = new THREE.MeshStandardMaterial({ color: '#08080a', roughness: 0.25, metalness: 0.4 });
let glassTex: THREE.CanvasTexture | null = null;
let topperTex: THREE.CanvasTexture | null = null;

function part(geo: THREE.BufferGeometry, mat: THREE.Material, size: [number, number, number], pos: [number, number, number]): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(...size);
  m.position.set(...pos);
  return m;
}

/** The machine and its stool, facing +z. */
export function cabinetModel(): THREE.Group {
  glassTex ??= bellyGlass();
  topperTex ??= topperSign();
  const outer = new THREE.Group();
  outer.name = 'videopoker-machine';
  const g = new THREE.Group();
  g.position.z = SHIFT_Z;
  outer.add(g);

  // Base: kick plate, body, belly glass, trim.
  g.add(part(box, rubber, [0.62, 0.08, 0.5], [0, 0.04, -0.08]));
  g.add(part(box, lacquer, [0.64, 0.72, 0.56], [0, 0.44, -0.08]));
  const belly = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshStandardMaterial({ map: glassTex, emissiveMap: glassTex, emissive: '#ffffff', emissiveIntensity: 0.55, roughness: 0.2 }));
  belly.position.set(0, 0.45, 0.2005);
  g.add(belly);
  g.add(part(box, trim, [0.52, 0.012, 0.012], [0, 0.705, 0.2]));
  g.add(part(box, trim, [0.52, 0.012, 0.012], [0, 0.195, 0.2]));

  // Button deck, armrest and the buttons themselves.
  g.add(part(box, lacquer, [0.66, 0.06, 0.34], [0, DECK_TOP - 0.03, 0.23]));
  g.add(part(box, trim, [0.66, 0.008, 0.008], [0, DECK_TOP, 0.4]));
  const arm = part(cyl, leather, [0.04, 0.7, 0.04], [0, DECK_TOP - 0.01, 0.43]);
  arm.rotation.z = Math.PI / 2;
  g.add(arm);
  for (const spec of BUTTONS) {
    const tex = buttonLabel(spec);
    const btn = new THREE.Group();
    btn.name = `vp-btn-${spec.id}`;
    const body = part(box, new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.5 }), [spec.w + 0.006, BUTTON_H, BUTTON_D + 0.006], [0, BUTTON_H / 2, 0]);
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(spec.w, BUTTON_D), new THREE.MeshStandardMaterial({ map: tex, color: '#6a6a6a', emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.25, roughness: 0.3 }));
    lens.name = 'lens';
    lens.rotation.x = -Math.PI / 2;
    lens.position.y = BUTTON_H + 0.0006;
    btn.add(body, lens);
    btn.position.set(spec.x, DECK_TOP, BUTTON_Z);
    g.add(btn);
  }

  // Head: the tilted screen housing with its bezel and speaker slots.
  const head = new THREE.Group();
  head.position.copy(SCREEN_CENTER);
  head.rotation.x = -TILT;
  head.add(part(box, lacquer, [0.64, 0.5, 0.28], [0, 0.02, -0.14]));
  // the bezel's face a few millimetres behind the screen, so the two never share a depth
  head.add(part(box, bezel, [0.5, 0.39, 0.01], [0, 0, -0.0015]));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), new THREE.MeshBasicMaterial({ map: attractScreen() }));
  screen.name = 'vp-screen';
  screen.position.z = 0.007;
  head.add(screen);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) head.add(part(box, rubber, [0.03, 0.006, 0.004], [side * 0.285, 0.1 - i * 0.022, 0.002]));
  }
  head.add(part(box, trim, [0.64, 0.01, 0.01], [0, 0.27, 0]));
  g.add(head);

  // Spine behind the head, the lit sign and the candle.
  g.add(part(box, lacquer, [0.64, 0.62, 0.26], [0, 1.05, -0.23]));
  g.add(part(box, lacquer, [0.66, 0.22, 0.2], [0, 1.46, -0.2]));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.176), new THREE.MeshStandardMaterial({ map: topperTex, emissiveMap: topperTex, emissive: '#ffffff', emissiveIntensity: 0.9, roughness: 0.3 }));
  sign.position.set(0, 1.46, -0.0995);
  g.add(sign);
  g.add(part(box, trim, [0.66, 0.012, 0.012], [0, 1.35, -0.1]));
  g.add(part(cyl, trim, [0.03, 0.03, 0.03], [0, 1.585, -0.2]));
  g.add(part(cyl, new THREE.MeshStandardMaterial({ color: '#2d5bff', emissive: '#2d5bff', emissiveIntensity: 0.9 }), [0.024, 0.07, 0.024], [0, 1.635, -0.2]));
  g.add(part(cyl, new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff6e0', emissiveIntensity: 0.9 }), [0.024, 0.05, 0.024], [0, 1.695, -0.2]));

  // Bill acceptor on the deck's right, with its green bezel.
  g.add(part(box, rubber, [0.07, 0.05, 0.05], [0.25, DECK_TOP + 0.025, 0.08]));
  g.add(part(box, new THREE.MeshStandardMaterial({ color: '#1b8f3a', emissive: '#1b8f3a', emissiveIntensity: 0.6 }), [0.05, 0.004, 0.002], [0.25, DECK_TOP + 0.03, 0.106]));

  // Stool.
  g.add(part(cyl, trim, [0.2, 0.02, 0.2], [0, 0.01, 0.78]));
  g.add(part(cyl, trim, [0.03, 0.62, 0.03], [0, 0.33, 0.78]));
  g.add(part(cyl, leather, [0.2, 0.08, 0.2], [0, 0.66, 0.78]));

  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return outer;
}
