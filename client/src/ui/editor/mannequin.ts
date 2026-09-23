// A tailor's mannequin built from primitives: the stand-in character for the editor (and
// anywhere else) until the world's outfit models load. It follows the same contract as the real
// characters, reads every field of a Look (body, outfit, skin, hair, top, bottom, shoes), idles,
// and swings its arms and legs when told it is walking.

import * as THREE from 'three';
import { DEFAULT_LOOK, SKIN_TONES, type Look } from '../../../../shared/src/look.ts';
import type { Character, CharacterFactory } from '../../world/contract.ts';

type Mat = THREE.MeshStandardMaterial;

interface Rig {
  root: THREE.Group;
  /** Hip height standing still, with the soles on y = 0. */
  baseY: number;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  legs: [THREE.Group, THREE.Group];
  arms: [THREE.Group, THREE.Group];
}

/** Torso outline as (radius, height) pairs from below the waist to the neck, for a lathe. */
function torsoProfile(f: boolean, long: boolean): THREE.Vector2[] {
  const pts: [number, number][] = f
    ? [[long ? 0.155 : 0.13, long ? -0.14 : -0.05], [0.112, 0.02], [0.125, 0.14], [0.15, 0.27], [0.145, 0.36], [0.115, 0.43], [0.05, 0.47], [0, 0.475]]
    : [[long ? 0.16 : 0.14, long ? -0.15 : -0.05], [0.135, 0.02], [0.148, 0.16], [0.17, 0.3], [0.168, 0.4], [0.13, 0.47], [0.055, 0.505], [0, 0.51]];
  return pts.map(([r, y]) => new THREE.Vector2(r, y));
}

function mat(color: string, roughness: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): Mat {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness, metalness: 0, ...extra });
}

function mesh(geo: THREE.BufferGeometry, m: Mat, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  return o;
}

/** A capsule hanging down from its parent's origin. */
function limb(r: number, len: number, m: Mat, from = 0): THREE.Mesh {
  const o = mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 4, 14), m);
  o.position.y = from - len / 2;
  return o;
}

function build(look: Look): Rig {
  const f = look.body === 'f';
  const o = look.outfit;
  const skin = mat(SKIN_TONES[look.skin] ?? SKIN_TONES[2], 0.5);
  const top = mat(look.top, o === 'suit' || o === 'smart' ? 0.62 : 0.85);
  const bottom = mat(look.bottom, 0.8);
  const shoe = mat(look.shoes, 0.35);
  const hair = mat(look.hair, 0.55);

  const longJacket = o === 'suit' || o === 'smart' || o === 'hoodie';
  const sleeves: 'long' | 'short' | 'none' = o === 'suit' || o === 'smart' || o === 'hoodie' || (o === 'punk' && f) ? 'long' : o === 'casual' || o === 'beach' ? 'short' : 'none';
  const legSkin = o === 'beach' || o === 'dress';

  const root = new THREE.Group();
  root.name = 'mannequin';
  const legLen = f ? 0.8 : 0.84;
  // The shoe's sole sits 0.03 below where the leg chain ends.
  const baseY = legLen + 0.01;
  const hips = new THREE.Group();
  hips.position.y = baseY;
  root.add(hips);

  // pelvis
  const pelvis = mesh(new THREE.SphereGeometry(0.14, 24, 16), bottom);
  pelvis.scale.set(f ? 1.14 : 1.04, 0.62, 0.78);
  hips.add(pelvis);

  // legs
  const legs = [-1, 1].map((side) => {
    const leg = new THREE.Group();
    leg.position.set(side * (f ? 0.085 : 0.09), -0.02, 0);
    const thighMat = o === 'dress' ? skin : bottom;
    const shinMat = legSkin ? skin : bottom;
    const thigh = limb(f ? 0.066 : 0.07, 0.44, thighMat);
    const shin = limb(f ? 0.048 : 0.054, 0.42, shinMat, -0.4);
    leg.add(thigh, shin);
    if (o === 'beach') {
      // shorts end above the knee
      const cuff = limb(0.074, 0.26, bottom);
      leg.add(cuff);
    }
    const boot = o === 'punk';
    const flat = o === 'beach';
    const foot = mesh(new THREE.CapsuleGeometry(0.045, 0.12, 4, 12), shoe, 0, -(legLen - (flat ? 0.03 : 0.045)), 0.05);
    foot.rotation.x = Math.PI / 2;
    foot.scale.set(1.05, 1, flat ? 0.45 : 0.8);
    leg.add(foot);
    if (boot) leg.add(limb(0.058, 0.16, shoe, -legLen + 0.18));
    hips.add(leg);
    return leg;
  }) as [THREE.Group, THREE.Group];

  // skirt for the dress: a flared lathe from the waist to the knee
  if (o === 'dress') {
    const skirt = mesh(
      new THREE.LatheGeometry([new THREE.Vector2(0.13, 0.06), new THREE.Vector2(0.17, -0.12), new THREE.Vector2(0.23, -0.42), new THREE.Vector2(0.245, -0.47)], 40),
      mat(look.bottom, 0.7, { side: THREE.DoubleSide }),
    );
    skirt.scale.z = 0.86;
    hips.add(skirt);
  }

  // torso
  const torso = new THREE.Group();
  torso.position.y = 0.07;
  hips.add(torso);
  const body = mesh(new THREE.LatheGeometry(torsoProfile(f, longJacket), 40), top);
  body.scale.set(f ? 1.0 : 1.12, 1, f ? 0.76 : 0.72);
  torso.add(body);
  const shoulderY = f ? 0.39 : 0.415;
  const shoulderX = f ? 0.165 : 0.2;

  if (o === 'suit' || o === 'smart') {
    // shirt front and, on the suit, a tie
    const shirt = mesh(new THREE.BoxGeometry(0.075, 0.16, 0.01), mat('#ece6d8', 0.7), 0, 0.37, f ? 0.112 : 0.118);
    shirt.rotation.x = -0.28;
    torso.add(shirt);
    if (o === 'suit') {
      const dark = new THREE.Color(look.top).getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace).l < 0.4;
      const tie = mesh(new THREE.BoxGeometry(0.03, 0.22, 0.012), mat(dark ? '#7a1f2b' : '#1f2430', 0.45), 0, 0.3, 0.126);
      tie.rotation.x = -0.18;
      torso.add(tie);
    }
  }
  if (o === 'hoodie') {
    const hood = mesh(new THREE.TorusGeometry(0.085, 0.04, 10, 28), top, 0, 0.47, -0.035);
    hood.rotation.x = Math.PI / 2 - 0.35;
    hood.scale.set(1.15, 1, 1);
    torso.add(hood);
  }

  // arms hang from the shoulders
  const upperMat = sleeves === 'none' ? skin : top;
  const lowerMat = sleeves === 'long' ? top : skin;
  const arms = [-1, 1].map((side) => {
    const arm = new THREE.Group();
    arm.position.set(side * shoulderX, shoulderY, 0);
    arm.rotation.z = side * 0.09;
    const cap = mesh(new THREE.SphereGeometry(f ? 0.045 : 0.052, 16, 12), upperMat);
    const upper = limb(f ? 0.04 : 0.046, 0.3, upperMat);
    const lower = limb(f ? 0.034 : 0.038, 0.27, lowerMat, -0.28);
    const hand = mesh(new THREE.SphereGeometry(f ? 0.036 : 0.042, 14, 10), skin, 0, -0.56, 0.005);
    hand.scale.set(0.8, 1.15, 0.6);
    arm.add(cap, upper, lower, hand);
    if (sleeves === 'short') arm.add(limb((f ? 0.04 : 0.046) + 0.008, 0.16, top));
    torso.add(arm);
    return arm;
  }) as [THREE.Group, THREE.Group];

  // neck and head (a smooth egg: it's a mannequin)
  const neckY = f ? 0.47 : 0.5;
  torso.add(mesh(new THREE.CylinderGeometry(0.04, 0.047, 0.1, 16), skin, 0, neckY + 0.02, 0));
  const head = new THREE.Group();
  head.position.y = neckY + 0.17;
  torso.add(head);
  const skull = mesh(new THREE.SphereGeometry(0.1, 32, 24), skin);
  skull.scale.set(0.9, 1.12, 0.98);
  head.add(skull);
  addHair(head, look, hair, f);

  return { root, baseY, hips, torso, head, legs, arms };
}

/**
 * Hair as two shells over the skull: the crown all the way round down to the hairline, and the
 * back and sides further down with the face left open at +Z (a wedge cut through the crown
 * would notch the forehead).
 */
function hairShell(r: number, hairline: number, back: number, open: number, m: Mat): THREE.Group {
  const g = new THREE.Group();
  const crown = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 12, 0, Math.PI * 2, 0, hairline), m);
  const sides = new THREE.Mesh(new THREE.SphereGeometry(r * 0.995, 32, 16, Math.PI / 2 + open, Math.PI * 2 - 2 * open, 0, back), m);
  g.add(crown, sides);
  g.scale.set(0.93, 1.1, 1.0);
  return g;
}

function addHair(head: THREE.Group, look: Look, m: Mat, f: boolean): void {
  const o = look.outfit;
  if (o === 'punk') {
    // shaved sides and a crest front to back
    const crest = mesh(new THREE.SphereGeometry(0.1, 20, 14), m, 0, 0.075, -0.01);
    crest.scale.set(0.24, 0.72, 1.08);
    head.add(crest);
    if (f) head.add(hairShell(0.104, 0.1, Math.PI * 0.55, 1.3, m));
    return;
  }
  if (!f) {
    const c = hairShell(0.106, Math.PI * 0.3, Math.PI * 0.47, 1.0, m);
    c.position.set(0, 0.01, -0.004);
    head.add(c);
    return;
  }
  if (o === 'smart') {
    // a bob to the jaw
    const c = hairShell(0.112, Math.PI * 0.33, Math.PI * 0.68, 0.95, m);
    c.position.y = 0.004;
    head.add(c);
    return;
  }
  // long hair falling down the back
  head.add(hairShell(0.11, Math.PI * 0.32, Math.PI * 0.62, 0.95, m));
  const fall = mesh(new THREE.CapsuleGeometry(0.075, 0.2, 4, 14), m, 0, -0.1, -0.055);
  fall.scale.set(1.25, 1, 0.55);
  head.add(fall);
}

function disposeTree(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const x of mats) x.dispose();
  });
}

export class Mannequin implements Character {
  readonly root = new THREE.Group();
  private rig: Rig;
  private look: Look;
  private time = 0;
  private speed = 0;
  private phase = 0;

  constructor(look: Look = DEFAULT_LOOK) {
    this.look = look;
    this.rig = build(look);
    this.root.add(this.rig.root);
  }

  setLook(look: Look): void {
    if (JSON.stringify(look) === JSON.stringify(this.look)) return;
    this.look = look;
    this.root.remove(this.rig.root);
    disposeTree(this.rig.root);
    this.rig = build(look);
    this.root.add(this.rig.root);
    this.update(0);
  }

  setMotion(speed: number): void {
    this.speed = Math.max(0, Math.min(1, speed));
  }

  setName(_name: string): void {
    // A mannequin wears no name tag; the floor draws names for real characters.
  }

  update(dt: number): void {
    this.time += dt;
    this.phase += dt * (1.6 + 6.4 * this.speed);
    const r = this.rig;
    const t = this.time;
    const walk = this.speed;
    const swing = Math.sin(this.phase) * 0.55 * walk;
    const breathe = Math.sin(t * 1.7) * 0.006 * (1 - walk);
    r.torso.scale.set(1 + breathe * 0.4, 1 + breathe, 1 + breathe * 0.6);
    r.legs[0].rotation.x = swing;
    r.legs[1].rotation.x = -swing;
    r.arms[0].rotation.x = -swing * 0.8 + Math.sin(t * 0.9) * 0.015 * (1 - walk);
    r.arms[1].rotation.x = swing * 0.8 - Math.sin(t * 0.9 + 0.6) * 0.015 * (1 - walk);
    r.hips.position.y = r.baseY + Math.abs(Math.cos(this.phase)) * 0.025 * walk;
    r.head.rotation.y = Math.sin(t * 0.37) * 0.05 * (1 - walk);
  }

  dispose(): void {
    disposeTree(this.rig.root);
    this.root.removeFromParent();
  }
}

export const mannequins: CharacterFactory = {
  create(look: Look, _name: string): Character {
    return new Mannequin(look);
  },
};
