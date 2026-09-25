// The cars on the ground floor: the valet and the cars called round to the curb, and the garage
// across the street showing your own collection. The city (world/city/) lays out the ground floor,
// the podium and the stalls; `lotCars()` fills its stalls with parked cars. Everything is built into one group that's drawn only while the camera is in the
// ground zone (zones.ts): from the casino or the roof none of it costs a thing.
//
//   const cars = new Cars({ engine, world, now: serverNow, me: () => link.you?.id ?? null, onValet });
//   engine.onFrame((dt) => cars.update(dt));
//   link.subscribe((m) => cars.hear(m));       // the floor's car / cars messages
//   cars.setOwned(profile.owned, profile.name); // your garage

import * as THREE from 'three';
import type { Quality } from '../../render/engine3d.ts';
import type { FloorServerMsg } from '../../../../shared/src/protocol.ts';
import type { CarCall } from '../../../../shared/src/valet.ts';
import { ZONES, inRect } from '../../../../shared/src/zones.ts';
import type { Collider } from '../collision.ts';
import type { CharacterFactoryExt } from '../contract.ts';
import type { SpotProvider } from '../interact.ts';
import { CarMaterials } from './materials.ts';
import { lotCars, type Lot } from './lot.ts';
import { stalls } from './layout.ts';
import { Valet } from './valet.ts';
import { Garage } from './garage.ts';

export { CarMaterials } from './materials.ts';
export { carKit } from './models.ts';
export { CarFleet, lotCars, type Lot } from './lot.ts';

export interface CarsDeps {
  engine: { scene: THREE.Scene; camera: THREE.Camera; renderer: THREE.WebGLRenderer };
  world: {
    collider: Collider;
    player: { position: THREE.Vector3 };
    characterFactory: CharacterFactoryExt;
    quality: Quality;
    spots(fn: SpotProvider): () => void;
  };
  /** Server time (ms): calls play out on the floor's clock. */
  now(): number;
  /** Your floor id, when connected. */
  me(): number | null;
  /** E at the valet's podium. */
  onValet(): void;
  /** Your car pulled up and the valet handed you the keys. */
  onKeys?(call: CarCall): void;
  /** Stand-ins for what the city draws (the podium, a car park in the stacks): the dev page, before the city is in. */
  standIns?: boolean;
}

export class Cars {
  readonly group = new THREE.Group();
  readonly mats: CarMaterials;
  readonly valet: Valet;
  readonly garage: Garage;
  private readonly lot: Lot | null;
  private readonly offSpots: () => void;
  private active = false;

  constructor(private readonly deps: CarsDeps) {
    this.group.name = 'cars';
    const env = deps.engine.scene.environment;
    const aniso = Math.min(8, deps.engine.renderer.capabilities.getMaxAnisotropy());
    this.mats = new CarMaterials(deps.world.quality, env);
    const col = deps.world.collider;
    this.lot = deps.standIns ? lotCars(stalls(), this.mats, { collider: col }) : null;
    this.valet = new Valet({
      mats: this.mats,
      characters: deps.world.characterFactory,
      col,
      now: deps.now,
      me: deps.me,
      player: deps.world.player.position,
      onUse: deps.onValet,
      onKeys: deps.onKeys,
      podium: !!deps.standIns,
    });
    this.garage = new Garage({ mats: this.mats, col, aniso, env });
    this.group.add(this.valet.group, this.garage.group);
    if (this.lot) this.group.add(this.lot.group);
    this.group.visible = false;
    deps.engine.scene.add(this.group);
    this.offSpots = deps.world.spots((p) => (this.active ? this.valet.spots(p) : []));
  }

  /** The valets' models (call once, behind the loading screen or after). */
  load(): Promise<unknown> {
    return this.valet.load();
  }

  /** The floor's messages: a car called or sent back, and what's at the curb after hello. */
  hear(m: FloorServerMsg): void {
    if (m.t === 'car') {
      const { t: _t, ...call } = m;
      this.valet.hear(call);
    } else if (m.t === 'cars') this.valet.all(m.list);
  }

  /** Your collection, for the garage (ids you own; anything not a car is ignored). */
  setOwned(owned: readonly string[] | undefined, name: string): void {
    this.garage.set(owned ?? [], name);
  }

  /** Whether the camera is on the ground floor (the cars are drawn). */
  get shown(): boolean {
    return this.active;
  }

  update(dt: number): void {
    const c = this.deps.engine.camera.position;
    const on = inRect(ZONES.ground, c.x * 100, c.z * 100);
    if (on !== this.active) {
      this.active = on;
      this.group.visible = on;
    }
    this.valet.update(dt, on);
    if (on) this.garage.update(dt);
  }

  setQuality(q: Quality): void {
    const old = this.mats.get('paint');
    this.mats.setQuality(q);
    const now = this.mats.get('paint');
    if (now === old) return;
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material === old) m.material = now;
    });
  }

  dispose(): void {
    this.offSpots();
    this.valet.dispose();
    this.garage.dispose();
    this.lot?.dispose();
    this.mats.dispose();
    this.group.removeFromParent();
  }
}
