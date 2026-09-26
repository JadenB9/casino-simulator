// v7: driving your own cars on the ground floor. Your car at the valet's curb (once the keys are
// in your hand), your car where you last parked it, or any car in your garage ("Take it out": it
// comes out onto the street by the garage door): E gets in. W and S drive and brake (and reverse),
// A and D steer, Space is the handbrake, H the horn, C looks from the driver's seat, E gets out and
// leaves it parked there, for everyone to see.
//
// Your car is a Rig (cars/valet.ts) driven by physics.ts, pushed out of everything solid (the
// world's collider, the doorways, the traffic, people), with a crash when it hits something hard: a
// thump, a jolt of the camera, the speed gone. While you drive, the walker's position is the car's,
// so presence carries it to everyone (a driver may go faster: server/src/floor/presence.ts), and
// everyone draws your car there (anyone's car they're driving, and every car left parked).

import * as THREE from 'three';
import { carItem } from '../../../../shared/src/items.ts';
import type { PlayerInfo } from '../../../../shared/src/protocol.ts';
import { CURB } from '../../../../shared/src/valet.ts';
import { ZONES, inRect } from '../../../../shared/src/zones.ts';
import { serverNow } from '../../net/clock.ts';
import { byteToYaw, type FloorLink } from '../../net/presence.ts';
import { el, toast } from '../../ui/kit.ts';
import { isTyping, overlayCount } from '../../ui/keyboard.ts';
import { calm } from '../../app/comfort.ts';
import type { Sfx } from '../../audio/sfx.ts';
import type { FloorWorld } from '../index.ts';
import { Collider } from '../collision.ts';
import { carKit } from '../cars/models.ts';
import { CAR_SPECS } from '../cars/specs.ts';
import { GARAGE, collection } from '../cars/layout.ts';
import { Rig } from '../cars/valet.ts';
import type { CarMaterials } from '../cars/materials.ts';
import { boxesTouch, type RoadCar } from '../city/parking.ts';
import { STORES } from '../../../../shared/src/stores.ts';
import { handlingOf, mph, stepCar, type CarState, type Handling } from './physics.ts';
import { StreetSounds } from './sound.ts';
import './drive.css';

export interface DrivingDeps {
  engine: { scene: THREE.Scene; camera: THREE.PerspectiveCamera; onFrame(fn: (dt: number) => void): () => void };
  world: FloorWorld;
  mats: CarMaterials;
  link: () => FloorLink | null;
  /** The cars you own (the profile's). */
  owned: () => readonly string[];
  /** Your car the valet has at the curb, if any (and whether the keys are in your hand). */
  curb: () => { car: string; slot: number; ready: boolean } | null;
  ui: HTMLElement;
  sfx: Sfx;
  /** Out walking on the floor, nothing open: E may get you in. */
  free: () => boolean;
}

/** Where a garage car comes out: the street's inner lane by the garage's door, facing up it. */
const OUT_OF_GARAGE = { x: 162.2, z: 18, yaw: Math.PI };
/** How near a car's middle you must be to get in (m). */
const REACH = 3.4;
/** Wait this long for the floor to say you're in before giving up (ms). */
const CONFIRM_MS = 3000;
/** A crash this hard (m/s into something) makes a sound and shakes the camera. */
const CRASH_V = 3;

interface Mine {
  car: string;
  rig: Rig;
  s: CarState;
  h: Handling;
  hl: number;
  hw: number;
  /** Sent the floor our getting in, when (performance ms); confirmed once it says so. */
  sentAt: number;
  confirmed: boolean;
  /** The seat (car-local) and whether you're seen in it (an open car). */
  seat: THREE.Vector3;
  shown: boolean;
}

interface Drawn {
  car: string;
  rig: Rig;
  x: number;
  z: number;
  yaw: number;
}

/** What the driving needs of another player's character: to seat it in their car. */
interface RemoteBody {
  root: THREE.Object3D;
  sit?: (top: number | null) => void;
}

interface Parked extends Drawn {
  solid: ReturnType<Collider['box']> | null;
}

export class Driving {
  readonly group = new THREE.Group();
  private mine: Mine | null = null;
  private readonly others = new Map<number, Drawn>();
  private readonly parked = new Map<number, Parked>();
  private readonly keys = new Set<string>();
  private readonly doors = new Collider();
  private readonly sounds: StreetSounds;
  private readonly hud = el('div', 'drive-hud panel');
  private readonly speedEl = el('div', 'drive-speed');
  private readonly offs: (() => void)[] = [];
  private shake = 0;
  private view: 'chase' | 'seat' = 'chase';
  private readonly cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), set: false };
  private lastCrash = 0;
  private hornAt = 0;
  /** Your car just parked is kept drawn until then (performance ms), while the floor confirms it. */
  private keepMine = 0;
  private readonly _v = new THREE.Vector3();
  private readonly _w = new THREE.Vector3();

  constructor(private readonly d: DrivingDeps) {
    this.group.name = 'driving';
    d.engine.scene.add(this.group);
    this.sounds = new StreetSounds(d.sfx);
    this.hud.hidden = true;
    const name = el('div', 'drive-name');
    const keysHint = el('div', 'drive-keys', 'W S drive · A D steer · Space handbrake · H horn · C view · E get out');
    this.hud.append(this.speedEl, name, keysHint);
    d.ui.append(this.hud);
    // the doorways a car can't go through (a walker can)
    const doorway = (x: number, z0: number, z1: number) => this.doors.box(x, (z0 + z1) / 2, 0.8, z1 - z0 + 0.6, 0, 3);
    doorway(127.7, -2.4, 2.4);
    for (const s of Object.values(STORES)) doorway(s.room.x0, s.door.z0, s.door.z1);
    doorway(167, -26.2, -23.8);
    doorway(GARAGE.x0, GARAGE.doorZ - GARAGE.doorW / 2, GARAGE.doorZ + GARAGE.doorW / 2);
    this.offs.push(d.world.spots((p) => this.spots(p)));
    this.offs.push(d.engine.onFrame((dt) => this.update(dt)));
    d.world.city.onFoot = () => this.mine === null;
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKey);
    addEventListener('blur', this.onBlur);
  }

  /** Driving now (the app keeps punches, rides and tables off while you are). */
  get driving(): boolean {
    return this.mine !== null;
  }

  /** The car you're driving (for the checks). */
  get state(): Readonly<CarState> | null {
    return this.mine?.s ?? null;
  }

  // --- getting in and out ------------------------------------------------------------------------

  /** What E offers: your car at the curb, your parked car, your cars in the garage. */
  private *spots(p: THREE.Vector3): Generator<{ key: string; x: number; z: number; d: number; label: string; any?: boolean; use(): void }> {
    if (this.mine || !this.d.free() || !inRect(ZONES.ground, p.x * 100, p.z * 100)) return;
    const curb = this.d.curb();
    if (curb?.ready) {
      const c = CURB[curb.slot]!;
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < REACH) yield { key: `drive:curb:${curb.car}`, x: c.x, z: c.z, d: Math.max(0, d - 1.5), label: `Drive the ${carItem(curb.car)?.name ?? 'car'}`, any: true, use: () => this.getIn(curb.car, c.x, c.z, Math.PI) };
    }
    const me = this.d.link()?.you?.id;
    const mineParked = me !== undefined ? this.parked.get(me) : undefined;
    if (mineParked) {
      const d = Math.hypot(p.x - mineParked.x, p.z - mineParked.z);
      if (d < REACH) yield { key: `drive:parked:${mineParked.car}`, x: mineParked.x, z: mineParked.z, d: Math.max(0, d - 1.5), label: `Drive the ${carItem(mineParked.car)?.name ?? 'car'}`, any: true, use: () => this.getIn(mineParked.car, mineParked.x, mineParked.z, mineParked.yaw) };
    }
    // the garage: your cars in their bays
    if (p.x > GARAGE.x0 && p.x < GARAGE.x1 && p.z > GARAGE.z0 && p.z < GARAGE.z1) {
      for (const c of collection(this.d.owned())) {
        if (!c.owned) continue;
        const d = Math.hypot(p.x - c.bay.x, p.z - c.bay.z);
        if (d < REACH + 0.6) yield { key: `drive:garage:${c.car}`, x: c.bay.x, z: c.bay.z, d: Math.max(0, d - 2), label: `Take the ${carItem(c.car)?.name ?? 'car'} out`, any: true, use: () => this.getIn(c.car, OUT_OF_GARAGE.x, OUT_OF_GARAGE.z, OUT_OF_GARAGE.yaw) };
      }
    }
  }

  /** Into `car`, standing at (x, z) facing `yaw`. */
  getIn(car: string, x: number, z: number, yaw: number): boolean {
    const link = this.d.link();
    if (this.mine || !link?.you || !carItem(car) || !this.d.owned().includes(car)) return false;
    const kit = carKit(car);
    const spec = CAR_SPECS[car]!;
    const rig = new Rig(car, this.d.mats);
    this.group.add(rig.root);
    const wheelbase = spec.front - spec.rear;
    const cabin = spec.cabin ? (spec.cabin[0]![0] + spec.cabin.at(-1)![0]) / 2 : spec.open ? (spec.open.cockpit[0] + spec.open.cockpit[1]) / 2 : 0;
    this.mine = {
      car,
      rig,
      s: { x, z, yaw, v: 0, steer: 0 },
      h: handlingOf(car, { wheelbase, height: kit.height }),
      hl: kit.length / 2,
      hw: kit.width / 2,
      sentAt: performance.now(),
      confirmed: false,
      seat: new THREE.Vector3(0.36, spec.sill + 0.02, cabin - 0.15),
      shown: !!spec.open || spec.sill > 0.7,
    };
    // your parked one is the car now
    const me = link.you.id;
    this.unpark(me);
    const w = this.d.world;
    w.walker.setEnabled(false);
    w.player.character.sit?.(0.34);
    link.send({ t: 'drive', car });
    this.cam.set = false;
    (this.hud.querySelector('.drive-name') as HTMLElement).textContent = carItem(car)?.name ?? '';
    this.hud.hidden = false;
    this.keys.clear();
    this.sounds.engineAt(0, 0);
    this.place();
    return true;
  }

  /** Out of the car, on the driver's side; it stays where it is. */
  getOut(quiet = false): void {
    const m = this.mine;
    if (!m) return;
    this.mine = null;
    const w = this.d.world;
    const left = { x: Math.cos(m.s.yaw), z: -Math.sin(m.s.yaw) };
    const at = { x: m.s.x + left.x * (m.hw + 0.55), z: m.s.z + left.z * (m.hw + 0.55) };
    w.collider.resolve(at, 0.3);
    w.player.character.sit?.(null);
    w.player.character.root.visible = true;
    w.walker.speed = 0;
    w.walker.spawn(at.x, at.z, m.s.yaw + Math.PI / 2);
    w.walker.setEnabled(true);
    this.d.world.city.roadCars = [];
    this.sounds.engineAt(null);
    this.hud.hidden = true;
    const link = this.d.link();
    // left parked where it stands, for everyone (the floor confirms with the player's `parked`)
    const me = link?.you?.id;
    if (me !== undefined && m.confirmed) {
      this.park(me, m.car, m.s.x, m.s.z, m.s.yaw, m.rig);
      this.keepMine = performance.now() + 4000;
    }
    else m.rig.dispose();
    if (m.confirmed) link?.send({ t: 'drive', car: null });
    if (!quiet && !m.confirmed) toast("The car wouldn't start. Try again in a moment.");
  }

  // --- every frame ----------------------------------------------------------------------------

  private update(dt: number): void {
    this.syncOthers(dt);
    const m = this.mine;
    if (!m) return;
    const w = this.d.world;
    const link = this.d.link();
    if (!m.confirmed) {
      if (link?.you?.car === m.car) m.confirmed = true;
      else if (performance.now() - m.sentAt > CONFIRM_MS) {
        this.getOut();
        return;
      }
    }
    // a panel over the floor, a table, the law: out you get
    if (w.seated || !inRect(ZONES.ground, m.s.x * 100, m.s.z * 100)) {
      this.getOut(true);
      return;
    }
    const k = this.keys;
    let throttle = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let steer = (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0);
    const stick = w.walker.stickInput;
    if (throttle === 0 && steer === 0 && stick) {
      throttle = stick.y;
      steer = -stick.x;
    }
    const handbrake = k.has('Space');
    const was = m.s.v;
    const before = { x: m.s.x, z: m.s.z };
    stepCar(m.s, { throttle: overlayCount() > 0 ? 0 : throttle, steer, handbrake }, m.h, Math.min(dt, 0.05));
    this.collide(m, dt);
    if (handbrake && Math.abs(m.s.v) > 8 && Math.abs(m.s.steer) > 0.1 && Math.random() < dt * 3) this.sounds.screech(0, 0.4);
    if (was > 12 && m.s.v < 2 && throttle < 0) this.sounds.screech(0, 0.5);
    m.rig.roll(Math.hypot(m.s.x - before.x, m.s.z - before.z) * Math.sign(m.s.v || 1), m.s.steer);
    this.place();
    // the engine: its note with the speed, louder under throttle
    this.sounds.engineAt(Math.min(1, Math.abs(m.s.v) / m.h.top), Math.max(0, throttle));
    this.speedEl.textContent = `${mph(m.s.v)} mph`;
    this.camera(dt);
    // the traffic brakes for (and crashes into) the car
    this.d.world.city.roadCars = [this.roadCar(m)];
  }

  /** Put the car, the walker (its position is the car's, for presence) and you in the seat. */
  private place(): void {
    const m = this.mine!;
    const w = this.d.world;
    m.rig.root.position.set(m.s.x, 0, m.s.z);
    m.rig.root.rotation.y = m.s.yaw;
    w.walker.position.set(m.s.x, 0, m.s.z);
    w.walker.heading = m.s.yaw;
    w.walker.speed = Math.abs(m.s.v);
    const ch = w.player.character;
    m.rig.root.updateMatrixWorld(true);
    ch.root.position.copy(this._v.copy(m.seat).applyMatrix4(m.rig.root.matrixWorld));
    ch.root.rotation.y = m.s.yaw;
    ch.root.visible = m.shown && this.view === 'chase';
    ch.setMotion(0);
  }

  /** Pushed out of whatever the car ran into; a crash if it hit hard. */
  private collide(m: Mine, dt: number): void {
    const s = m.s;
    const fx = Math.sin(s.yaw);
    const fz = Math.cos(s.yaw);
    const r = m.hw * 0.92;
    const reach = Math.max(0, m.hl - r);
    let pushX = 0;
    let pushZ = 0;
    const cols = [this.d.world.collider, this.doors];
    for (const off of [reach, 0, -reach]) {
      for (const col of cols) {
        const p = { x: s.x + fx * off + pushX, z: s.z + fz * off + pushZ };
        const x0 = p.x;
        const z0 = p.z;
        col.resolve(p, r);
        pushX += p.x - x0;
        pushZ += p.z - z0;
      }
    }
    // other people on the road: the car stops short of them
    for (const [, o] of this.walkersNear(s.x, s.z)) {
      const dx = s.x - o.x;
      const dz = s.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = m.hw + 0.35;
      if (d < min && d > 1e-3) {
        pushX += (dx / d) * (min - d);
        pushZ += (dz / d) * (min - d);
      }
    }
    // the traffic, and cars others are driving
    const me = this.roadCar(m);
    const traffic = this.d.world.city.traffic()?.cars() ?? [];
    for (const o of [...traffic, ...[...this.others.values()].map((d) => this.drawnCar(d))]) {
      if (Math.hypot(o.x - s.x, o.z - s.z) > m.hl + o.hl + 1 || !boxesTouch(me, o)) continue;
      const dx = s.x - o.x;
      const dz = s.z - o.z;
      const d = Math.hypot(dx, dz) || 1;
      pushX += (dx / d) * 0.35;
      pushZ += (dz / d) * 0.35;
      const rel = Math.abs(s.v - o.v * Math.cos(o.yaw - s.yaw));
      this.crash(Math.max(rel, Math.abs(s.v)), (s.x + o.x) / 2, (s.z + o.z) / 2);
      s.v *= -0.2;
    }
    const push = Math.hypot(pushX, pushZ);
    if (push < 1e-4) return;
    s.x += pushX;
    s.z += pushZ;
    // how fast it was going into what it hit
    const nx = pushX / push;
    const nz = pushZ / push;
    const into = -(fx * nx + fz * nz) * s.v;
    if (into > 0.5) {
      if (into > CRASH_V) this.crash(into, s.x - nx * m.hw, s.z - nz * m.hw);
      // head on it stops (a small bounce back), a glancing blow scrubs speed and slides along
      const head = Math.abs(fx * nx + fz * nz);
      s.v = head > 0.7 ? -s.v * 0.18 : s.v * (1 - head * 0.8);
    }
    void dt;
  }

  private crash(speed: number, x: number, z: number): void {
    const now = performance.now();
    if (now - this.lastCrash < 350) return;
    this.lastCrash = now;
    const hard = Math.min(1, speed / 20);
    this.sounds.crash(hard);
    if (!calm()) this.shake = 0.25 + hard * 0.35;
    void x;
    void z;
  }

  /** The chase camera (or the driver's eyes), eased; shaken by a crash. */
  private camera(dt: number): void {
    const m = this.mine!;
    const cam = this.d.engine.camera;
    const fx = Math.sin(m.s.yaw);
    const fz = Math.cos(m.s.yaw);
    const back = 6.2 + Math.min(3, Math.abs(m.s.v) * 0.08) + m.hl * 0.4;
    const up = 2.1 + (m.shown && m.rig.root ? 0.3 : 0);
    let pos: THREE.Vector3;
    let look: THREE.Vector3;
    if (this.view === 'seat') {
      pos = this._v.copy(m.seat).setY(m.seat.y + 0.95).applyMatrix4(m.rig.root.matrixWorld);
      look = this._w.set(m.s.x + fx * 20, 1.0, m.s.z + fz * 20);
      cam.position.copy(pos);
      cam.lookAt(look);
    } else {
      pos = this._v.set(m.s.x - fx * back * Math.sign(m.s.v >= -0.5 ? 1 : 1), up, m.s.z - fz * back);
      look = this._w.set(m.s.x + fx * 3, 1.1, m.s.z + fz * 3);
      // keep the camera out of walls: back off along its ray, as the walker's camera does
      const origin = { x: m.s.x, y: 1.4, z: m.s.z };
      const dir = { x: pos.x - m.s.x, y: pos.y - 1.4, z: pos.z - m.s.z };
      const len = Math.hypot(dir.x, dir.y, dir.z);
      const hit = this.d.world.collider.raycast(origin, { x: dir.x / len, y: dir.y / len, z: dir.z / len }, len + 0.3) - 0.3;
      if (hit < len) pos.set(origin.x + (dir.x / len) * Math.max(1.2, hit), origin.y + (dir.y / len) * Math.max(1.2, hit), origin.z + (dir.z / len) * Math.max(1.2, hit));
      if (!this.cam.set) {
        this.cam.pos.copy(pos);
        this.cam.look.copy(look);
        this.cam.set = true;
      }
      const k = 1 - Math.exp(-dt * 6);
      this.cam.pos.lerp(pos, k);
      this.cam.look.lerp(look, 1 - Math.exp(-dt * 10));
      cam.position.copy(this.cam.pos);
      cam.lookAt(this.cam.look);
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      const a = this.shake * 0.25;
      cam.position.x += (Math.random() - 0.5) * a;
      cam.position.y += (Math.random() - 0.5) * a;
    }
  }

  private roadCar(m: Mine): RoadCar {
    return { x: m.s.x, z: m.s.z, yaw: m.s.yaw, v: m.s.v, hl: m.hl, hw: m.hw };
  }

  private drawnCar(d: Drawn): RoadCar {
    const kit = carKit(d.car);
    return { x: d.x, z: d.z, yaw: d.yaw, v: 0, hl: kit.length / 2, hw: kit.width / 2 };
  }

  /** Other people standing near (x, z) on the ground floor (not driving). */
  private *walkersNear(x: number, z: number): Generator<[number, { x: number; z: number }]> {
    const link = this.d.link();
    if (!link) return;
    const now = serverNow();
    for (const [id, p] of link.players) {
      if (p.info.car || p.info.at) continue;
      const pose = p.track.at(now);
      if (!pose) continue;
      const px = pose.x / 100;
      const pz = pose.z / 100;
      if (Math.abs(px - x) < 6 && Math.abs(pz - z) < 6) yield [id, { x: px, z: pz }];
    }
  }

  // --- everyone else's cars -------------------------------------------------------------------

  /** Draw the cars others are driving, and every parked car, from the floor's roster. */
  private syncOthers(dt: number): void {
    const link = this.d.link();
    const onGround = this.d.world.zone === 'ground';
    this.group.visible = onGround;
    if (!link) return;
    const now = serverNow();
    const seen = new Set<number>();
    const parkedSeen = new Set<number>();
    const road: RoadCar[] = [];
    const consider = (id: number, info: PlayerInfo) => {
      if (info.parked && carItem(info.parked.car) && !(id === link.you?.id && this.mine)) {
        parkedSeen.add(id);
        const p = info.parked;
        const had = this.parked.get(id);
        if (!had || had.car !== p.car || Math.hypot(had.x - p.x / 100, had.z - p.z / 100) > 0.2) this.park(id, p.car, p.x / 100, p.z / 100, byteToYaw(p.r));
      }
    };
    for (const [id, p] of link.players) {
      consider(id, p.info);
      if (!p.info.car || !carItem(p.info.car)) continue;
      const pose = p.track.at(now);
      if (!pose) continue;
      seen.add(id);
      let d = this.others.get(id);
      if (!d || d.car !== p.info.car) {
        d?.rig.dispose();
        const rig = new Rig(p.info.car, this.d.mats);
        this.group.add(rig.root);
        d = { car: p.info.car, rig, x: pose.x / 100, z: pose.z / 100, yaw: byteToYaw(pose.r) };
        this.others.set(id, d);
      }
      const x = pose.x / 100;
      const z = pose.z / 100;
      const step = Math.hypot(x - d.x, z - d.z);
      // a turn eased to the new heading, the short way round
      const yaw = byteToYaw(pose.r);
      const dy = Math.atan2(Math.sin(yaw - d.yaw), Math.cos(yaw - d.yaw));
      d.yaw += dy * Math.min(1, dt * 10);
      d.rig.roll(step < 5 ? step : 0, Math.max(-0.5, Math.min(0.5, dy * 2)));
      d.x = x;
      d.z = z;
      d.rig.root.position.set(x, 0, z);
      d.rig.root.rotation.y = d.yaw;
      road.push(this.drawnCar(d));
      // the driver: seated in it (seen in an open car), not walking beside it
      const ch = this.remoteCharacter(id);
      if (ch) {
        const spec = CAR_SPECS[p.info.car]!;
        const cabin = spec.cabin ? (spec.cabin[0]![0] + spec.cabin.at(-1)![0]) / 2 : spec.open ? (spec.open.cockpit[0] + spec.open.cockpit[1]) / 2 : 0;
        d.rig.root.updateMatrixWorld(true);
        ch.root.position.copy(this._v.set(0.36, spec.sill + 0.02, cabin - 0.15).applyMatrix4(d.rig.root.matrixWorld));
        ch.root.rotation.y = d.yaw;
        ch.root.visible = onGround && (!!spec.open || spec.sill > 0.7);
        ch.sit?.(0.34);
      }
    }
    const you = link.you;
    if (you) consider(you.id, you);
    for (const [id, d] of [...this.others]) {
      if (seen.has(id)) continue;
      d.rig.dispose();
      this.others.delete(id);
      this.remoteCharacter(id)?.sit?.(null);
    }
    // (your own, just left, stands until the floor's word on it arrives)
    for (const id of [...this.parked.keys()]) if (!parkedSeen.has(id) && !(id === link.you?.id && performance.now() < this.keepMine)) this.unpark(id);
    if (!this.mine) this.d.world.city.roadCars = road;
    else this.d.world.city.roadCars = [this.roadCar(this.mine), ...road];
  }

  private remoteCharacter(id: number): RemoteBody | undefined {
    return this.characterOf?.(id);
  }

  /** Where RemotePlayers' characters are found (the app sets it). */
  characterOf: ((id: number) => RemoteBody | undefined) | null = null;

  private park(id: number, car: string, x: number, z: number, yaw: number, rig?: Rig): void {
    this.unpark(id);
    const r = rig ?? new Rig(car, this.d.mats);
    if (!rig) this.group.add(r.root);
    r.root.position.set(x, 0, z);
    r.root.rotation.y = yaw;
    const kit = carKit(car);
    const solid = this.d.world.collider.box(x, z, kit.width, kit.length, yaw, 1.3);
    this.parked.set(id, { car, rig: r, x, z, yaw, solid });
  }

  private unpark(id: number): void {
    const p = this.parked.get(id);
    if (!p) return;
    p.rig.dispose();
    if (p.solid) {
      const boxes = this.d.world.collider.boxes;
      const i = boxes.indexOf(p.solid);
      if (i >= 0) boxes.splice(i, 1);
    }
    this.parked.delete(id);
  }

  // --- keys -------------------------------------------------------------------------------------

  private onKey = (e: KeyboardEvent): void => {
    if (!this.mine) return;
    if (isTyping(e)) return;
    if (e.type === 'keyup') {
      this.keys.delete(e.code);
      return;
    }
    if (overlayCount() > 0) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      this.keys.add(e.code);
      e.preventDefault();
      return;
    }
    if (e.repeat) return;
    if (e.code === 'KeyE') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (Math.abs(this.mine.s.v) > 3) {
        toast('Slow down to get out.');
        return;
      }
      this.getOut();
    } else if (e.code === 'KeyH') {
      const now = performance.now();
      if (now - this.hornAt > 500) {
        this.hornAt = now;
        this.sounds.horn(0, 0.5);
      }
    } else if (e.code === 'KeyC') {
      this.view = this.view === 'chase' ? 'seat' : 'chase';
      this.cam.set = false;
    }
  };

  private onBlur = (): void => {
    this.keys.clear();
  };

  /** The traffic hit your car (or you hit it): the sound and the jolt. */
  hitByTraffic(speed: number): void {
    if (this.mine) this.crash(speed, this.mine.s.x, this.mine.s.z);
  }

  /** A car horn out on the street (the traffic's), `at` metres. */
  horn(at: { x: number; z: number }): void {
    const cam = this.d.engine.camera.position;
    this.sounds.horn(Math.hypot(at.x - cam.x, at.z - cam.z), 0.35);
  }

  /** A knock from the traffic: a thump. */
  knocked(speed: number): void {
    this.sounds.crash(Math.min(1, speed / 25) * 0.6);
  }

  dispose(): void {
    this.getOut(true);
    for (const off of this.offs) off();
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onKey);
    removeEventListener('blur', this.onBlur);
    for (const id of [...this.parked.keys()]) this.unpark(id);
    for (const d of this.others.values()) d.rig.dispose();
    this.others.clear();
    this.sounds.dispose();
    this.hud.remove();
    this.group.removeFromParent();
  }
}

