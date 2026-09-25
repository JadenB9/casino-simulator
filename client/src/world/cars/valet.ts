// The valet out front: the podium with its key box and sign, the valet behind it, and the cars
// called round to the curb. A call (the floor's `car` message, everyone hears it) plays out on the
// server's clock, so everyone out front sees the same thing: the car pulls out of the lot and down
// the drive into its space, a runner gets out of the driver's door and hands the keys over, the
// car waits at the curb, and when its time is up (or it's sent back) it drives off down the street.

import * as THREE from 'three';
import { ARRIVE_MS, CURB, VALET_STAND, type CarCall } from '../../../../shared/src/valet.ts';
import { carItem } from '../../../../shared/src/items.ts';
import type { Look } from '../../../../shared/src/look.ts';
import { uniformOutfit } from '../characters.ts';
import type { Box, Collider } from '../collision.ts';
import type { Character, CharacterFactoryExt } from '../contract.ts';
import type { Spot } from '../interact.ts';
import { turnToward } from '../npcs.ts';
import { MatBatch, bodyGeometries, carKit, wheelGeometries, wheelMatrix, type CarMat } from './models.ts';
import type { CarMaterials } from './materials.ts';
import { along, arrivalPath, departurePath, pathLength } from './layout.ts';

/** The valets' uniform: a black vest over a white shirt, a red tie's worth of colour in the vest. */
const VALET_LOOKS: Look[] = [
  { v: 1, body: 'm', outfit: uniformOutfit('vest'), skin: 2, hair: '#1b1512', top: '#5c1a1f', bottom: '#15161a', shoes: '#0c0c0e' },
  { v: 1, body: 'f', outfit: uniformOutfit('vest'), skin: 5, hair: '#0e0c0b', top: '#5c1a1f', bottom: '#15161a', shoes: '#0c0c0e' },
];

/** The podium faces the lobby's doors (-x); its valet stands behind it. */
const STAND_YAW = -Math.PI / 2;
/** Seconds the drive in takes out of ARRIVE_MS; the rest is the handover. */
const DRIVE_S = ARRIVE_MS / 1000 - 3;
/** Seconds to drive away. */
const LEAVE_S = 12;
const WALK = 1.35;

/** A car rigged to drive: its body, and its four wheels to turn. */
class Rig {
  readonly root = new THREE.Group();
  private readonly wheels: THREE.Group[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private spin = 0;
  readonly radius: number;
  readonly half: number;

  constructor(readonly car: string, mats: CarMaterials) {
    const kit = carKit(car);
    this.radius = kit.wheels[0]!.y;
    this.half = kit.width / 2;
    // driven: its lamps are on
    for (const [m, gs] of bodyGeometries(car)) for (const g of gs) this.mesh(this.root, g, mats.get(m === 'lamp' ? 'glow' : m));
    const wheel = wheelGeometries(car);
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Group();
      w.matrixAutoUpdate = false;
      w.matrix.copy(wheelMatrix(kit, i));
      for (const [m, gs] of wheel) for (const g of gs) this.mesh(w, g, mats.get(m));
      this.wheels.push(w);
      this.root.add(w);
    }
  }

  private mesh(parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material): void {
    this.geos.push(g);
    parent.add(new THREE.Mesh(g, m));
  }

  /** Roll the wheels on by `d` metres. */
  roll(d: number): void {
    this.spin += d / this.radius;
    const kit = carKit(this.car);
    this.wheels.forEach((w, i) => w.matrix.copy(wheelMatrix(kit, i, this.spin)));
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const g of new Set(this.geos)) g.dispose();
  }
}

interface Out {
  call: CarCall;
  rig: Rig;
  /** How far along its path it was last frame (to roll the wheels by the difference). */
  d: number;
  leaving: boolean;
  runner: { ch: Character; t: number; to: THREE.Vector3; back: THREE.Vector3; handed: boolean; gone: boolean } | null;
  /** While it stands at the curb, it's in the way like any car. */
  solid: Box | null;
}

export interface ValetDeps {
  mats: CarMaterials;
  characters: CharacterFactoryExt;
  col: Collider;
  /** Server time now (ms). */
  now(): number;
  /** Your account id (your own car's keys come to you), and where you stand. */
  me(): number | null;
  player: THREE.Vector3;
  /** The valet's E: open the valet's panel. */
  onUse(): void;
  /** Your car is at the curb and the keys are in your hand. */
  onKeys?(call: CarCall): void;
  /** Build a podium, key box and sign (the city builds the real podium; the dev page wants one). */
  podium?: boolean;
}

export class Valet {
  readonly group = new THREE.Group();
  /** Cars out, by call (`id:at`): a player's new car and the one it replaces, driving off, can both be. */
  private readonly out = new Map<string, Out>();
  private readonly staff: Character;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly extra: { dispose(): void }[] = [];

  constructor(private readonly deps: ValetDeps) {
    this.group.name = 'valet';
    if (deps.podium) this.buildStand();
    this.staff = deps.characters.create(VALET_LOOKS[0]!, '');
    this.staff.setName('');
    this.staff.root.position.set(VALET_STAND.x + 0.8, 0, VALET_STAND.z);
    this.staff.root.rotation.y = STAND_YAW;
    this.group.add(this.staff.root);
    deps.col.post(VALET_STAND.x + 0.8, VALET_STAND.z, 0.3, 1.9, { cam: false });
  }

  load(): Promise<unknown> {
    return Promise.all(VALET_LOOKS.map((l) => this.deps.characters.load(l).catch(() => {})));
  }

  /** A podium in walnut and brass, a key box on a post behind it, and a sign on the sidewalk (stand-ins for the city's). */
  private buildStand(): void {
    const { x, z } = VALET_STAND;
    const b = new MatBatch();
    const wood = '#3a2416';
    const brass = '#9a7732';
    b.add('trim', new THREE.BoxGeometry(0.62, 1.05, 0.5).translate(x, 0.525, z), wood);
    b.add('trim', new THREE.BoxGeometry(0.72, 0.05, 0.62).rotateZ(-0.12).translate(x - 0.02, 1.1, z), wood);
    b.add('metal', new THREE.BoxGeometry(0.66, 0.04, 0.54).translate(x, 0.04, z), brass);
    // a brass rail round the front panel, not a sheet of it
    for (const y of [0.18, 0.92]) b.add('metal', new THREE.BoxGeometry(0.02, 0.025, 0.5).translate(x - 0.315, y, z), brass);
    for (const d of [-0.24, 0.24]) b.add('metal', new THREE.BoxGeometry(0.02, 0.76, 0.025).translate(x - 0.315, 0.55, z + d), brass);
    // a reading lamp on the desk
    b.add('metal', new THREE.CylinderGeometry(0.008, 0.008, 0.22, 6).translate(x + 0.2, 1.23, z + 0.18), brass);
    b.add('glow', new THREE.CylinderGeometry(0.06, 0.035, 0.05, 12).translate(x + 0.16, 1.34, z + 0.18), '#ffe7b8');
    // the key box: a cabinet on a post, rows of hooks
    const kx = x + 1.5;
    const kz = z + 0.9;
    b.add('trim', new THREE.BoxGeometry(0.12, 1.4, 0.12).translate(kx, 0.7, kz), '#1d1e21');
    b.add('trim', new THREE.BoxGeometry(0.16, 0.8, 0.62).translate(kx, 1.65, kz), wood);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) b.add('metal', new THREE.BoxGeometry(0.03, 0.05, 0.02).translate(kx - 0.09, 1.38 + r * 0.16, kz - 0.22 + c * 0.11), brass);
    // the sign's frame (its face is drawn below)
    const sx = x - 1.3;
    const sz = z - 1.1;
    for (const d of [-0.28, 0.28]) b.add('metal', new THREE.CylinderGeometry(0.015, 0.015, 1.25, 6).translate(sx, 0.62, sz + d), brass);
    b.add('trim', new THREE.BoxGeometry(0.05, 0.62, 0.62).translate(sx, 0.95, sz), '#15161a');
    for (const [m, geo] of b.build()) {
      this.geos.push(geo);
      this.group.add(new THREE.Mesh(geo, this.deps.mats.get(m as CarMat)));
    }
    // the sign's face, both sides: VALET in brass capitals, what it costs underneath
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#15161a';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#b8913f';
    g.lineWidth = 4;
    g.strokeRect(14, 14, 228, 228);
    g.fillStyle = '#d8b25a';
    g.textAlign = 'center';
    g.font = '600 58px "Playfair Display", Georgia, serif';
    g.fillText('VALET', 128, 112);
    g.font = '500 22px "Inter", Arial, sans-serif';
    g.fillStyle = '#cfc6b4';
    g.fillText('CARS BROUGHT ROUND', 128, 158);
    g.fillText('BUY AT THE STAND', 128, 190);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: '#b9b2a6' });
    const face = new THREE.PlaneGeometry(0.58, 0.58);
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(face, mat);
      m.position.set(sx + side * 0.027, 0.95, sz);
      m.rotation.y = side * Math.PI / 2;
      this.group.add(m);
    }
    this.extra.push(tex, mat, face);
    this.deps.col.box(x, z, 0.62, 0.5, 0, 1.1, { cam: false });
    this.deps.col.post(kx, kz, 0.12, 2);
    this.deps.col.post(sx, sz, 0.35, 1.3, { cam: false });
  }

  /** E at the podium: from the lobby side or either end. */
  *spots(p: THREE.Vector3): Iterable<Spot> {
    const { x, z } = VALET_STAND;
    const d = Math.max(0, Math.hypot(p.x - x, p.z - z) - 0.4);
    if (d < 2.2) yield { key: 'valet', x, z, d, label: 'Valet', any: d < 0.9, use: () => this.deps.onUse() };
  }

  /** The floor says a car was called (or sent back). */
  hear(call: CarCall): void {
    const key = `${call.id}:${call.at}`;
    const same = this.out.get(key);
    if (same) {
      same.call = call;
      return;
    }
    // a different car of theirs in the same space: the old one drives off now
    const now = this.deps.now();
    for (const o of this.out.values()) if (o.call.id === call.id && o.call.until > now) o.call = { ...o.call, until: now };
    if (!carItem(call.car) || call.slot >= CURB.length || call.until <= now) return;
    const rig = new Rig(call.car, this.deps.mats);
    this.group.add(rig.root);
    this.out.set(key, { call, rig, d: 0, leaving: false, runner: null, solid: null });
  }

  /** Everything at the curb, as the floor has it after hello. */
  all(list: CarCall[]): void {
    for (const [key, o] of [...this.out]) if (!list.some((c) => c.id === o.call.id && c.at === o.call.at)) this.drop(key);
    for (const c of list) this.hear(c);
  }

  /** Your car at the curb (or on its way), for the panel. */
  /** Your car on its way in: where it is now, and whether the keys are in your hand yet (the camera watches). */
  arriving(): { key: string; call: CarCall; at: THREE.Vector3; handed: boolean } | null {
    const id = this.deps.me();
    const now = this.deps.now();
    for (const [key, o] of this.out)
      if (o.call.id === id && o.call.until > now && now - o.call.at < ARRIVE_MS + 4000) return { key, call: o.call, at: o.rig.root.position, handed: !!o.runner?.handed };
    return null;
  }

  mine(): CarCall | null {
    const id = this.deps.me();
    const now = this.deps.now();
    for (const o of this.out.values()) if (o.call.id === id && o.call.until > now) return o.call;
    return null;
  }

  private unsolid(o: Out): void {
    if (!o.solid) return;
    const i = this.deps.col.boxes.indexOf(o.solid);
    if (i >= 0) this.deps.col.boxes.splice(i, 1);
    o.solid = null;
  }

  private drop(key: string): void {
    const o = this.out.get(key);
    if (!o) return;
    o.rig.dispose();
    if (o.runner && !o.runner.gone) {
      o.runner.ch.root.removeFromParent();
      o.runner.ch.dispose();
    }
    this.unsolid(o);
    this.out.delete(key);
  }

  update(dt: number, active: boolean): void {
    const now = this.deps.now();
    this.staff.update(dt);
    // the valet at the podium looks at whoever comes up to it
    const p = this.deps.player;
    const sx = this.staff.root.position.x;
    const sz = this.staff.root.position.z;
    const near = Math.hypot(p.x - sx, p.z - sz) < 5;
    const want = near ? this.staff.root.rotation.y + turnToward(this.staff.root.rotation.y, sx, sz, p.x, p.z) : STAND_YAW;
    this.staff.root.rotation.y += (want - this.staff.root.rotation.y) * Math.min(1, dt * 3);
    for (const [key, o] of this.out) {
      const t = (now - o.call.at) / 1000;
      const leaveT = (now - o.call.until) / 1000;
      if (leaveT >= LEAVE_S) {
        this.drop(key);
        continue;
      }
      if (!active) continue;
      let pose: { x: number; z: number; yaw: number };
      if (leaveT >= 0) {
        const path = departurePath(o.call.slot);
        const L = pathLength(path);
        // pulls away gently and picks up speed down the street
        const k = Math.min(1, leaveT / LEAVE_S);
        const d = L * k * k;
        pose = along(path, d);
        if (!o.leaving) {
          o.leaving = true;
          o.d = 0;
          this.unsolid(o);
        }
        o.rig.roll(d - o.d);
        o.d = d;
      } else {
        const path = arrivalPath(o.call.slot);
        const L = pathLength(path);
        const k = Math.min(1, Math.max(0, t / DRIVE_S));
        // eased in and out: pulls out of the stall, cruises down the drive, stops at the curb
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        const d = L * e;
        pose = along(path, d);
        o.rig.roll(d - o.d);
        o.d = d;
        if (k >= 1) {
          if (!o.solid) {
            const kit = carKit(o.call.car);
            o.solid = this.deps.col.box(pose.x, pose.z, kit.width, kit.length, pose.yaw, kit.height, { cam: false });
          }
          this.handover(o, dt, t - DRIVE_S);
        }
      }
      o.rig.root.position.set(pose.x, 0, pose.z);
      // turn with the path, smoothly (the path's corners are cut by the easing of the yaw)
      const cur = o.rig.root.rotation.y;
      const diff = Math.atan2(Math.sin(pose.yaw - cur), Math.cos(pose.yaw - cur));
      o.rig.root.rotation.y = cur + diff * Math.min(1, dt * 6);
    }
  }

  /**
   * The runner: out of the driver's door (the sidewalk side), over to the car's owner if they're
   * waiting at the curb (anyone else's car: to the curb's edge), the keys handed over, and back to
   * the podium, where they go in behind it.
   */
  private handover(o: Out, dt: number, t: number): void {
    const c = CURB[o.call.slot] ?? CURB[0]!;
    if (!o.runner) {
      if (t > 20) return; // arrived long ago (seen after the fact): no one gets out
      const ch = this.deps.characters.create(VALET_LOOKS[1]!, '');
      ch.setName('');
      this.group.add(ch.root);
      const door = new THREE.Vector3(c.x - o.rig.half - 0.35, 0, c.z - 0.3);
      const mine = o.call.id === this.deps.me();
      const p = this.deps.player;
      const meet = mine && Math.hypot(p.x - door.x, p.z - door.z) < 7 ? new THREE.Vector3(p.x, 0, p.z) : new THREE.Vector3(c.x - o.rig.half - 1.4, 0, c.z);
      // stop short of the person
      const dir = meet.clone().sub(door);
      const len = dir.length();
      const to = len > 0.9 ? door.clone().addScaledVector(dir.normalize(), len - 0.85) : door.clone();
      ch.root.position.copy(door);
      o.runner = { ch, t: 0, to, back: new THREE.Vector3(VALET_STAND.x + 0.4, 0, VALET_STAND.z + 1.2), handed: false, gone: false };
    }
    const r = o.runner;
    if (r.gone) return;
    r.t += dt;
    const ch = r.ch;
    const walkTo = (target: THREE.Vector3) => {
      const pos = ch.root.position;
      const dx = target.x - pos.x;
      const dz = target.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.05) {
        ch.setMotion(0);
        return true;
      }
      const step = Math.min(dist, WALK * dt);
      pos.x += (dx / dist) * step;
      pos.z += (dz / dist) * step;
      ch.root.rotation.y = Math.atan2(dx, dz);
      ch.setMotion(1);
      return false;
    };
    if (!r.handed) {
      if (walkTo(r.to)) {
        const p = this.deps.player;
        ch.root.rotation.y = Math.atan2(p.x - ch.root.position.x, p.z - ch.root.position.z);
        ch.gesture?.('pay' as never);
        r.handed = true;
        r.t = 0;
        if (o.call.id === this.deps.me()) this.deps.onKeys?.(o.call);
      }
    } else if (r.t > 1.6 && walkTo(r.back)) {
      // back behind the podium: gone in with the keys box
      ch.root.removeFromParent();
      ch.dispose();
      r.gone = true;
      return;
    }
    ch.update(dt);
  }

  dispose(): void {
    for (const key of [...this.out.keys()]) this.drop(key);
    this.staff.dispose();
    for (const g of this.geos) g.dispose();
    for (const e of this.extra) e.dispose();
    this.group.removeFromParent();
  }
}
