// The city beyond the casino floor: the elevators and the two places they go (the ground floor
// with the valet and the street, the roof terrace), and the switching between them.
//
// The world is one scene; the casino, the ground floor and the roof are patches of it far apart
// (shared/src/zones.ts). Only the zone you're in is drawn: the casino's pieces are hidden while
// you're elsewhere, and the other zones are built the first time you go there and hidden when you
// leave. Other players in another zone aren't drawn either. You move between zones only by the
// server's word (`tp`: the elevator, or the law taking you to jail and letting you out). README.md
// here has the rest.

import * as THREE from 'three';
import type { Quality } from '../../render/engine3d.ts';
import type { Sfx } from '../../audio/sfx.ts';
import type { Batch } from '../batch.ts';
import type { GlowMerge, Lighting } from '../lighting.ts';
import type { Mats } from '../materials.ts';
import type { Collider } from '../collision.ts';
import type { Player } from '../player.ts';
import type { Interact, Spot } from '../interact.ts';
import type { Seatable } from '../life-points.ts';
import type { FloorClientMsg, FloorServerMsg } from '../../../../shared/src/protocol.ts';
import { LIFTS, floorOf } from '../../../../shared/src/lifts.ts';
import { ZONES, zoneOf, type ZoneId } from '../../../../shared/src/zones.ts';
import { calm } from '../../app/comfort.ts';
import { toast } from '../../ui/kit.ts';
import { Bank, CAR_H, panelTexture } from './bank.ts';
import { defineCityMats } from './kit.ts';
import { buildGround } from './ground.ts';
import { buildRoof, SUN_DIR } from './roof.ts';
import { openPanel, RideScreen, type PanelHandle } from './ride.ts';
import { LiftSounds } from './sound.ts';
import type { ZoneBuild } from './zone.ts';

export { LIFTS } from '../../../../shared/src/lifts.ts';
export { GROUND, ROOF, VALET_STAND, PICKUP, ENTRANCES, stalls } from './plan.ts';

/** What the floor socket gives the city (FloorLink has all of it). */
export interface CityLink {
  send(msg: FloorClientMsg): boolean;
  subscribe(fn: (msg: FloorServerMsg) => void): () => void;
  readonly players: ReadonlyMap<number, { last: { x: number; z: number } | null }>;
}

export interface CityDeps {
  /** Where the zones go (the floor's root). */
  root: THREE.Object3D;
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  mats: Mats;
  col: Collider;
  quality: Quality;
  ui: HTMLElement;
  sfx?: Sfx;
}

/** What the city needs of the floor once it's all built. */
export interface CityFloor {
  player: Player;
  interact: Interact;
  /** The light rig: out of the casino the zone's light replaces the rooms'. */
  lighting: Lighting;
  /** The casino's own pieces, hidden while you're in another zone. */
  casino: THREE.Object3D[];
  /** Sit-anywhere: more seats (a zone's, once it's built), and getting up (the server moved you). */
  addSeats(seats: Seatable[]): void;
  standUp(): void;
  /** At a table (the elevator won't go, and a move from the server waits for the app). */
  seated(): boolean;
}

type Ride =
  | { phase: 'closing'; to: ZoneId; car: number; t: number }
  | { phase: 'riding'; from: ZoneId; to: ZoneId; t: number; screen: RideScreen; tp: { x: number; z: number; r: number } | null; building: boolean; ready: boolean; placed: boolean }
  | { phase: 'arriving'; to: ZoneId; car: number; t: number };

/** The zones' own light while you're out there: the hemisphere's sky, ground and strength, and the sun. */
const LIGHT = {
  ground: {
    outside: { sky: new THREE.Color('#40507e'), ground: new THREE.Color('#2a1c14'), k: 1.05, sun: new THREE.Color('#8ea4d8'), sunK: 0.3, dir: new THREE.Vector3(0.35, 0.62, -0.7) },
    inside: { sky: new THREE.Color('#fff0dc'), ground: new THREE.Color('#4a3020'), k: 1.75, sun: new THREE.Color('#ffe8cc'), sunK: 0.5, dir: new THREE.Vector3(-0.4, 0.8, 0.5) },
  },
  roof: {
    outside: { sky: new THREE.Color('#ffc8a4'), ground: new THREE.Color('#5a3a4a'), k: 1.3, sun: new THREE.Color('#ffa860'), sunK: 1.7, dir: SUN_DIR },
    inside: { sky: new THREE.Color('#ffc8a4'), ground: new THREE.Color('#5a3a4a'), k: 1.3, sun: new THREE.Color('#ffa860'), sunK: 1.7, dir: SUN_DIR },
  },
};

/** Far enough to see the skyline from the roof; the casino keeps the engine's own. */
const FAR_AWAY = 700;

/** Standing this near a car's doorway (m), outside it, offers "Call the elevator". */
const CALL_REACH = 2.4;

export class City {
  zone: ZoneId = 'casino';
  readonly casinoBank: Bank;
  private readonly zones = new Map<ZoneId, ZoneBuild>();
  private readonly preparing = new Map<ZoneId, Promise<void>>();
  private readonly ceilings = new Set<(x: number, z: number) => number | null>();
  private floor: CityFloor | null = null;
  private link: CityLink | null = null;
  private offLink: (() => void) | null = null;
  private ride: Ride | null = null;
  private panel: PanelHandle | null = null;
  private readonly sounds: LiftSounds;
  private readonly nearFar: number;
  private quality: Quality;
  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();
  private readonly body = new THREE.Box3();
  private readonly people: { x: number; z: number }[] = [];
  /** The light rig as the casino set it, to give back. */
  private sunWas: { color: THREE.Color; pos: THREE.Vector3 } | null = null;
  private lightMix = 0;
  private lightSide: 'inside' | 'outside' = 'outside';
  private readonly hemiTo = { sky: new THREE.Color(), ground: new THREE.Color() };
  /**
   * The app's way off a table (cashing out through the table's session). A move from the server
   * while you sit at one (the law's) stands you up with it, once you're placed.
   */
  leaveTable: (() => void) | null = null;
  /** Tests and the e2e script: what happened with the last ride. */
  lastRide: { to: ZoneId; ok: boolean; msg?: string } | null = null;

  constructor(
    private readonly deps: CityDeps,
    batch: Batch,
    glow: GlowMerge,
  ) {
    defineCityMats(deps.mats);
    this.quality = deps.quality;
    this.sounds = new LiftSounds(deps.sfx);
    this.nearFar = deps.camera.far;
    // the casino's bank stands in the lobby: its pieces go in with the lobby's (drawn and hidden
    // with the room, no draw calls of their own)
    const room = batch.room;
    const glowRoom = glow.room;
    batch.room = 'lobby';
    glow.room = 'lobby';
    this.casinoBank = new Bank(LIFTS.casino, batch, glow, deps.mats, deps.col, { height: 3.4, clad: 'marble-black', trim: 'brass', door: 'lift-door' }, panelTexture('casino'));
    batch.room = room;
    glow.room = glowRoom;
    deps.root.add(this.casinoBank.group);
    this.hearDoors(this.casinoBank);
  }

  /** The floor's walker, prompts and seats, once they exist. */
  attach(floor: CityFloor): void {
    this.floor = floor;
    this.sunWas = { color: floor.lighting.sun.color.clone(), pos: floor.lighting.sun.position.clone() };
    floor.interact.spots((p) => this.spots(p));
  }

  /** The floor socket: rides go through it, and the server's moves (`tp`) come back on it. */
  useLink(link: CityLink | null): void {
    this.offLink?.();
    this.offLink = null;
    this.link = link;
    if (!link) return;
    this.offLink = link.subscribe((m) => {
      if (m.t === 'tp') this.moved(m.x / 100, m.z / 100, m.r);
      else if (m.t === 'lift.no') this.refused(m.msg);
    });
  }

  /** The bank in the zone you're in. */
  get bank(): Bank {
    return this.zone === 'casino' ? this.casinoBank : this.zones.get(this.zone)!.bank;
  }

  /** True from choosing a floor until the doors have opened on it. */
  get riding(): boolean {
    return this.ride !== null;
  }

  /** The ceiling over a point in the city (a car's, the canopies'), or null for the floor's own. */
  ceilingAt(x: number, z: number): number | null {
    const zone = zoneOf(x * 100, z * 100);
    if (!zone) return null;
    const bank = zone === 'casino' ? this.casinoBank : this.zones.get(zone)?.bank;
    if (bank && bank.carAt(x, z, 0.02) >= 0) return CAR_H;
    for (const fn of this.ceilings) {
      const c = fn(x, z);
      if (c !== null) return c;
    }
    if (zone === 'casino') return null;
    return this.zones.get(zone)?.ceilingAt(x, z) ?? 6;
  }

  /**
   * Whether someone at (x, z) could be seen from the camera: in the zone you're in and in view.
   * In the casino the floor's own doorway culling says the rest (`inCasino`).
   */
  sees(x: number, z: number, inCasino: (x: number, z: number) => boolean): boolean {
    const zone = zoneOf(x * 100, z * 100) ?? 'casino';
    if (zone !== this.zone) return false;
    if (zone === 'casino') return inCasino(x, z);
    const b = this.body;
    b.min.set(x - 0.45, 0, z - 0.45);
    b.max.set(x + 0.45, 2.7, z + 0.45);
    return this.frustum.intersectsBox(b);
  }

  /** Every frame, after the walker has moved. */
  update(dt: number): void {
    const f = this.floor;
    if (!f) return;
    const p = f.player.position;
    this.syncZone();
    const cam = this.deps.camera;
    cam.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    // everyone in this zone, you first: the doors' sensors, the traffic
    this.people.length = 0;
    this.people.push({ x: p.x, z: p.z });
    for (const r of this.link?.players.values() ?? []) {
      if (!r.last) continue;
      if ((zoneOf(r.last.x, r.last.z) ?? 'casino') === this.zone) this.people.push({ x: r.last.x / 100, z: r.last.z / 100 });
    }
    this.bank.update(dt, this.people);
    const z = this.zones.get(this.zone);
    z?.update(dt, this.people, calm());
    this.step(dt);
  }

  /** After the light rig's own update: out of the casino the zone's light replaces the rooms'. */
  light(dt: number): void {
    const f = this.floor;
    if (this.zone === 'casino' || !f) return;
    const l = f.lighting;
    const z = this.zones.get(this.zone);
    const side = z?.light(f.player.position.x, f.player.position.z) ?? 'outside';
    if (side !== this.lightSide) this.lightSide = side;
    const L = LIGHT[this.zone as 'ground' | 'roof'][this.lightSide];
    const k = this.lightMix < 1 ? 1 : 1 - Math.exp(-dt * 3);
    this.lightMix = 1;
    l.hemi.color.lerp(this.hemiTo.sky.copy(L.sky), k);
    l.hemi.groundColor.lerp(this.hemiTo.ground.copy(L.ground), k);
    const hk = L.k * (this.quality === 'high' ? 1 : 1.3);
    l.hemi.intensity += (hk - l.hemi.intensity) * k;
    l.sun.color.lerp(L.sun, k);
    l.sun.intensity += (L.sunK * (this.quality === 'high' ? 1 : 1.25) - l.sun.intensity) * k;
    l.sun.position.copy(l.sun.target.position).addScaledVector(L.dir, 50);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    for (const z of this.zones.values()) z.setQuality(q);
  }

  /** Build a zone now if it isn't yet (the ride does it behind the dark), and compile its shaders. */
  prepare(zone: ZoneId): Promise<void> {
    if (zone === 'casino') return Promise.resolve();
    let p = this.preparing.get(zone);
    if (!p) {
      p = this.compile(zone);
      this.preparing.set(zone, p);
    }
    return p;
  }

  private async compile(zone: Exclude<ZoneId, 'casino'>): Promise<void> {
    const z = this.build(zone);
    // shown for the compile only (it's dark, or you're about to be there)
    const shown = z.group.visible;
    z.group.visible = true;
    try {
      await this.deps.renderer.compileAsync(z.group, this.deps.camera, this.deps.scene);
    } catch {
      /* compiled when first drawn instead */
    }
    z.group.visible = shown || this.zone === zone;
  }

  /**
   * Another slice's roof over part of a zone (the garage's, the jail's): the follow camera keeps
   * under it. The returned function takes it back.
   */
  addCeiling(fn: (x: number, z: number) => number | null): () => void {
    this.ceilings.add(fn);
    return () => this.ceilings.delete(fn);
  }

  /** Call a car in this zone, as E does in front of the doors. */
  call(car?: number): void {
    const f = this.floor;
    if (!f) return;
    const i = car ?? this.bank.nearest(f.player.position.x, f.player.position.z).car;
    this.bank.call(i);
  }

  /**
   * Take the elevator to `to` from where you stand (you must be in a car, or at the doors: the
   * checks and the e2e scripts step you in). False when there's no going.
   */
  go(to: ZoneId): boolean {
    const f = this.floor;
    if (!f || this.ride || to === this.zone || f.seated()) return false;
    const p = f.player.position;
    let car = this.bank.carAt(p.x, p.z, 0.05);
    if (car < 0) {
      const n = this.bank.nearest(p.x, p.z);
      if (n.d > CALL_REACH + 1) return false;
      car = n.car;
    }
    this.panel?.close();
    this.start(to, car);
    return true;
  }

  dispose(): void {
    this.offLink?.();
    this.panel?.close();
    if (this.ride?.phase === 'riding') this.ride.screen.cancel();
    this.ride = null;
    for (const z of this.zones.values()) z.dispose();
    this.zones.clear();
    this.casinoBank.dispose();
    this.deps.camera.far = this.nearFar;
    this.deps.camera.updateProjectionMatrix();
  }

  // --- zones -------------------------------------------------------------------------------------

  /** Follow the walker into whatever zone it stands in now. */
  private syncZone(): void {
    const p = this.floor?.player.position;
    if (!p) return;
    const here = zoneOf(p.x * 100, p.z * 100) ?? 'casino';
    if (here !== this.zone) this.enter(here);
  }

  private build(zone: Exclude<ZoneId, 'casino'>): ZoneBuild {
    const had = this.zones.get(zone);
    if (had) return had;
    const d = this.deps;
    const z = zone === 'ground' ? buildGround(d.mats, d.col, this.quality) : buildRoof(d.mats, d.col, this.quality);
    z.group.visible = false;
    d.root.add(z.group);
    this.zones.set(zone, z);
    this.hearDoors(z.bank);
    this.floor?.addSeats(z.seats);
    return z;
  }

  /** You're in another zone now: draw it and nothing else. */
  private enter(zone: ZoneId): void {
    const f = this.floor;
    this.zone = zone;
    // a panel still open in the zone you left goes with it
    this.panel?.close();
    if (zone !== 'casino') this.build(zone);
    for (const [id, z] of this.zones) z.group.visible = id === zone;
    for (const o of f?.casino ?? []) o.visible = zone === 'casino';
    this.casinoBank.group.visible = zone === 'casino';
    const cam = this.deps.camera;
    cam.far = zone === 'casino' ? this.nearFar : FAR_AWAY;
    cam.updateProjectionMatrix();
    const l = f?.lighting;
    if (!l) return;
    if (zone === 'casino') {
      // the rig's own again: its rooms' ambient drifts back, the sun as it was
      if (this.sunWas) {
        l.sun.color.copy(this.sunWas.color);
        l.sun.position.copy(this.sunWas.pos);
      }
      l.sun.intensity = this.quality === 'high' ? 0.55 : 0.8;
      l.setRoom('lobby', true);
    } else {
      l.setRoom(`zone:${zone}`);
      l.setFocus(null);
      this.lightMix = 0;
    }
  }

  // --- the ride ----------------------------------------------------------------------------------

  /** What E offers at the elevators: calling a car at its doors, the panel inside. */
  private spots(p: THREE.Vector3): Spot[] {
    if (this.ride || this.panel) return [];
    const bank = this.bank;
    const inCar = bank.carAt(p.x, p.z, 0.02);
    if (inCar >= 0) {
      return [{ key: `lift:panel:${this.zone}:${inCar}`, x: p.x, z: p.z, d: 0, label: 'Choose a floor', any: true, use: () => this.openPanel(inCar) }];
    }
    const n = bank.nearest(p.x, p.z);
    if (n.d > CALL_REACH || bank.isOpen(n.car)) return [];
    const w = bank.doorway(n.car);
    // (the doorway's middle stands in for the whole portal: anywhere in front of it is close enough)
    return [{ key: `lift:call:${this.zone}:${n.car}`, x: w.x, z: w.z, d: Math.max(0, n.d - 1.2), label: 'Call the elevator', use: () => bank.call(n.car) }];
  }

  private openPanel(car: number): void {
    if (this.panel || this.ride) return;
    const f = this.floor;
    if (f?.seated()) return;
    // the car you're in waits for you
    this.bank.call(car);
    this.panel = openPanel(
      this.deps.ui,
      this.zone,
      (to) => {
        this.panel = null;
        this.start(to, car);
      },
      () => {
        this.panel = null;
      },
    );
  }

  private start(to: ZoneId, car: number): void {
    const f = this.floor;
    if (!f) return;
    // the walker stops, turns to face the doors in the middle of the car, and the camera stands
    // at the car's back
    f.player.setEnabled(false);
    const c = this.bank.centre(car);
    f.player.spawn(c.x, c.z, this.bank.yaw);
    this.bank.held = car;
    this.sounds.doors();
    this.ride = { phase: 'closing', to, car, t: 0 };
    this.lastRide = null;
    this.placeRideCamera(this.bank, car);
  }

  private step(dt: number): void {
    const r = this.ride;
    if (!r) return;
    const f = this.floor!;
    r.t += dt;
    if (r.phase === 'closing') {
      this.placeRideCamera(this.bank, r.car);
      if (!this.bank.isShut(r.car) && r.t < 3) return;
      // shut: ask the floor, and ride while it answers
      const screen = new RideScreen(this.deps.ui, this.zone, r.to);
      this.sounds.ride(screen.secs + 0.6);
      this.ride = { phase: 'riding', from: this.zone, to: r.to, t: 0, screen, tp: null, building: false, ready: false, placed: false };
      if (this.link) {
        if (!this.link.send({ t: 'lift', to: r.to })) this.refused('The elevator can’t reach the floor right now. Try again.');
      } else {
        // the dev floor, with no server: the car goes where the server would send it
        const a = LIFTS[r.to].arrive;
        (this.ride as Extract<Ride, { phase: 'riding' }>).tp = { x: a.x / 100, z: a.z / 100, r: a.r };
      }
      return;
    }
    if (r.phase === 'riding') {
      const counted = r.screen.update(dt);
      // once it's dark: build the other zone (the first time) and compile it, out of sight
      if (!r.building && r.t > 0.42) {
        r.building = true;
        void this.prepare(r.to).then(() => {
          if (this.ride === r) r.ready = true;
        });
      }
      // dark enough: the move happens out of sight
      if (r.tp && r.ready && !r.placed && r.t > 0.4) {
        r.placed = true;
        f.player.spawn(r.tp.x, r.tp.z, (r.tp.r / 256) * Math.PI * 2);
        this.syncZone();
        const car = Math.max(0, this.bank.carAt(r.tp.x, r.tp.z, 0.1));
        this.bank.shut(car);
        this.bank.held = car;
        this.placeRideCamera(this.bank, car);
      }
      if (!r.tp && r.t > 6) {
        this.refused('The elevator didn’t come. Try again.');
        return;
      }
      if (r.placed) this.placeRideCamera(this.bank, Math.max(0, this.bank.held));
      if (counted && r.placed) {
        r.screen.finish();
        this.sounds.chime(floorOf(r.to).level < floorOf(r.from).level);
        this.ride = { phase: 'arriving', to: r.to, car: Math.max(0, this.bank.held), t: 0 };
        this.lastRide = { to: r.to, ok: true };
      }
      return;
    }
    // arriving: the dark lifts on the car, then the doors open and you're free to walk out
    this.placeRideCamera(this.bank, r.car);
    if (r.t > 0.45 && this.bank.held === r.car) {
      this.bank.held = -1;
      this.sounds.doors();
    }
    if (r.t > 1.2) {
      this.ride = null;
      f.player.setEnabled(true);
    }
  }

  /** The camera at the back corner of the car, looking over your shoulder at the doors. */
  private placeRideCamera(bank: Bank, car: number): void {
    const c = bank.centre(car);
    const w = bank.doorway(car);
    const nx = w.x - c.x;
    const nz = w.z - c.z;
    const len = Math.hypot(nx, nz) || 1;
    const ux = nx / len;
    const uz = nz / len;
    const cam = this.deps.camera;
    cam.position.set(c.x - ux * 0.62 - uz * 0.38, 1.95, c.z - uz * 0.62 + ux * 0.38);
    cam.lookAt(w.x, 1.3, w.z);
  }

  private refused(msg: string): void {
    const r = this.ride;
    if (!r || r.phase !== 'riding' || r.placed) {
      // (a ride asked for some other way, a script's)
      if (!r) toast(msg);
      return;
    }
    r.screen.cancel();
    this.bank.held = -1;
    this.ride = null;
    this.floor?.player.setEnabled(true);
    this.lastRide = { to: r.to, ok: false, msg };
    toast(msg);
  }

  /**
   * The server moved you: the lift's answer (the ride shows it when it's dark), or the law taking
   * you away or letting you go, which happens at once.
   */
  private moved(x: number, z: number, r: number): void {
    const ride = this.ride;
    if (ride?.phase === 'riding' && !ride.placed) {
      ride.tp = { x, z, r };
      return;
    }
    const f = this.floor;
    if (!f) return;
    this.panel?.close();
    const zone = zoneOf(x * 100, z * 100) ?? 'casino';
    if (zone !== 'casino') this.build(zone);
    f.standUp();
    f.player.spawn(x, z, (r / 256) * Math.PI * 2);
    this.syncZone();
    // (placed first, so the camera flies back from the table to behind you where you are now)
    if (f.seated()) this.leaveTable?.();
  }

  private hearDoors(bank: Bank): void {
    bank.onDoor = (car, opening) => {
      const f = this.floor;
      if (!f || bank !== this.bank) return;
      // only the doors you're by make a sound
      const w = bank.doorway(car);
      if (Math.hypot(w.x - f.player.position.x, w.z - f.player.position.z) > 6) return;
      if (opening) this.sounds.chime();
      this.sounds.doors(0.035);
    };
  }
}

export { ZONES };
