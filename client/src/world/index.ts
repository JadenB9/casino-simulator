// The casino floor. createWorld() builds the room, the stations (each game module's model on
// its spot), the decor, signs and lights, and the player's own character with its controller and
// follow camera, then hands back the handles the rest of the client needs. See README.md.

import * as THREE from 'three';
import type { Engine3D, Quality } from '../render/engine3d.ts';
import { DEFAULT_LOOK, type Look } from '../../../shared/src/look.ts';
import { GAMES } from '../games/index.ts';
import type { CashierPoint, Station, World } from './contract.ts';
import { planFloor, type FloorPlan } from './layout.ts';
import { Mats, loadTextures } from './materials.ts';
import { Batch } from './batch.ts';
import { Collider } from './collision.ts';
import { buildRoom } from './room.ts';
import { buildStations, type WorldStation } from './stations.ts';
import { buildDecor } from './decor.ts';
import { buildSigns, floorSigns, loadSignFonts } from './signs.ts';
import { Lighting, buildPools } from './lighting.ts';
import { Props } from './props.ts';
import { Characters } from './characters.ts';
import { Player } from './player.ts';
import { Interact } from './interact.ts';
import { StationLod } from './lod.ts';
import { Bloom, PixelRatio } from './bloom.ts';
import './world.css';

export type { WorldStation } from './stations.ts';

/** Where a player first appears: inside the doors on the marble, facing into the casino (-z). */
export const SPAWN = { x: 0, z: 12.8, yaw: Math.PI };
export type { World } from './contract.ts';

export interface WorldOptions {
  /** The player's look and name (the name tag over your own head stays hidden). */
  look?: Look;
  name?: string;
  /** Defaults to the engine's quality. */
  quality?: Quality;
  /** Where DOM overlays (the "Press E" prompt) go. Defaults to #ui. */
  ui?: HTMLElement;
  /**
   * Esc while seated. Without a handler the world leaves the table itself; the app passes one
   * when leaving needs a confirmation (live bets), and calls exitTable() when it's done.
   */
  onEscape?: () => void;
  /** Loading progress, 0 to 1. */
  onProgress?: (k: number) => void;
}

export interface FloorWorld extends World {
  stations: WorldStation[];
  characterFactory: Characters;
  plan: FloorPlan;
  onEnter(cb: (station: WorldStation) => void): () => void;
  /** Sit down at a station as if E were pressed there (the app's lobby list can use this). */
  enter(station: Station, seat?: number | null): void;
  /** At the table you're at, move the camera to this seat's view of it. */
  aim(seat: number): void;
  /** The station you're sitting at (from pressing E until you stand up), if any. */
  readonly seated: WorldStation | null;
  /** The station the player is standing at, if any. */
  readonly focus: WorldStation | null;
  /** Draw calls and triangles of the last frame (renderer.info, counted across the bloom passes). */
  stats(): { calls: number; triangles: number; programs: number; pixelRatio: number };
  /** Place the player (dev views, respawn). */
  teleport(x: number, z: number, heading: number): void;
  quality: Quality;
}

export async function createWorld(engine: Engine3D, opts: WorldOptions = {}): Promise<FloorWorld> {
  let quality: Quality = opts.quality ?? engine.quality;
  const renderer = engine.renderer;
  const scene = engine.scene;
  const progress = opts.onProgress ?? (() => {});
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  progress(0.05);
  const [tex] = await Promise.all([loadTextures(aniso), loadSignFonts(), ...Object.values(GAMES).map((g) => g.preload?.().catch(() => {}))]);
  progress(0.35);

  const root = new THREE.Group();
  root.name = 'floor';
  scene.add(root);
  const plan = planFloor((g) => GAMES[g].footprint);
  const mats = new Mats(quality, tex, aniso);
  const col = new Collider();
  const batch = new Batch();

  const { chandeliers } = buildRoom(plan, batch, mats, col);
  const stationRoot = new THREE.Group();
  stationRoot.name = 'stations';
  root.add(stationRoot);
  const { stations, vpMode } = buildStations(plan, stationRoot, quality, col);
  const lod = new StationLod(stations, quality);
  const decor = buildDecor(plan, stations, vpMode, batch, mats, col);
  buildPools(decor.pools, batch, mats);
  const signSpecs = [...floorSigns(plan, batch, mats), ...decor.signs];
  const staticMeshes = batch.build(root, 'floor');
  const signs = buildSigns(signSpecs, root, quality, aniso);
  progress(0.55);

  const props = new Props(quality);
  root.add(props.group);
  const lighting = new Lighting(plan, quality);
  root.add(lighting.group);

  const characters = new Characters(quality, mats.get('blob'));
  const look = opts.look ?? DEFAULT_LOOK;
  await Promise.all([props.build(decor.props, chandeliers), characters.load(look).catch((err) => console.warn('character failed to load', err))]);
  progress(0.85);

  const character = characters.create(look, opts.name ?? '');
  character.setName('');
  root.add(character.root);
  const canvas = renderer.domElement;
  const player = new Player(character, engine.camera, col, plan.pit, canvas);
  player.spawn(SPAWN.x, SPAWN.z, SPAWN.yaw);

  const cashierAnchor = new THREE.Object3D();
  cashierAnchor.name = 'cashier';
  cashierAnchor.position.set(plan.cashier.x, 0, plan.cashier.counter.z1);
  root.add(cashierAnchor);
  const cashier: CashierPoint = { id: 'cashier', anchor: cashierAnchor, position: new THREE.Vector3(plan.cashier.x, 0, plan.cashier.z) };
  const ui = opts.ui ?? document.getElementById('ui') ?? document.body;
  const interact = new Interact(stations, cashier, player, engine.camera, ui, opts.onEscape);

  const bloom = new Bloom(engine);
  const pr = new PixelRatio(renderer);
  // bloom's extra passes would otherwise reset the counters mid-frame; world.update() resets them
  renderer.info.autoReset = false;
  const applyQuality = (q: Quality) => {
    bloom.setEnabled(q === 'high');
    pr.set(q === 'high');
  };
  applyQuality(quality);

  // compile every shader now, behind the loading screen, so the first frames and "Press E" don't stall
  try {
    await renderer.compileAsync(scene, engine.camera);
  } catch {
    /* compiled lazily instead */
  }
  progress(1);

  let lastCalls = 0;
  let lastTris = 0;
  const focusAt = new THREE.Vector3();

  const world: FloorWorld = {
    stations,
    cashier,
    characterFactory: characters,
    plan,
    quality,
    player: {
      character,
      position: player.position,
      setEnabled: (on) => player.setEnabled(on),
      state: () => ({ x: player.position.x, z: player.position.z, yaw: player.heading, moving: player.speed > 0.05 }),
      teleport: (x, z, yaw) => player.spawn(x, z, yaw),
    },
    onEnter: (cb) => interact.onEnter(cb),
    onCashier: (cb) => interact.onCashier(cb),
    exitTable: () => interact.exit(),
    enter: (s, seat = null) => {
      const ws = stations.find((x) => x.id === s.id);
      if (ws) interact.enter(ws, seat);
    },
    aim: (seat) => interact.aim(seat),
    get seated() {
      return interact.seated;
    },
    get focus() {
      return interact.seated ?? interact.focus;
    },
    setQuality(q) {
      if (q === quality) return;
      quality = q;
      world.quality = q;
      mats.swap(root, q);
      if (signs) (signs.mesh.material as THREE.MeshBasicMaterial).color.setScalar(q === 'high' ? 2.4 : 1.6);
      lighting.setQuality(q);
      characters.setQuality(q);
      void props.setQuality(q);
      applyQuality(q);
    },
    update(dt) {
      lastCalls = renderer.info.render.calls;
      lastTris = renderer.info.render.triangles;
      renderer.info.reset();
      player.update(dt);
      interact.update(dt);
      lod.update(engine.camera, interact.seated);
      character.update(dt);
      const f = world.focus;
      lighting.setFocus(f && f.zone !== 'slots' && f.game !== 'videopoker' ? focusAt.copy(f.anchor.position) : null);
      lighting.update(dt);
      // Seated, the camera is a metre from lit felt and brass: only real light sources (neon,
      // bulbs, the machines' glass) should bloom there, not the printing on the table.
      const close = interact.seated !== null;
      bloom.pass.threshold = close ? 2.4 : 1.05;
      bloom.pass.strength = close ? 0.3 : 0.42;
      characters.updateLabels(engine.camera);
      bloom.update(dt);
      pr.update(dt);
    },
    stats: () => ({ calls: lastCalls, triangles: lastTris, programs: renderer.info.programs?.length ?? 0, pixelRatio: renderer.getPixelRatio() }),
    teleport: (x, z, heading) => player.spawn(x, z, heading),
    dispose() {
      lod.dispose();
      interact.dispose();
      player.dispose();
      character.dispose();
      bloom.dispose();
      renderer.info.autoReset = true;
      signs?.texture.dispose();
      for (const m of staticMeshes) m.geometry.dispose();
      mats.dispose();
      root.removeFromParent();
    },
  };
  return world;
}
