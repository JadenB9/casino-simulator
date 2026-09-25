// The casino floor. createWorld() builds the room, the stations (each game module's model on
// its spot), the decor, signs and lights, and the player's own character with its controller and
// follow camera, then hands back the handles the rest of the client needs. See README.md.

import * as THREE from 'three';
import type { Engine3D, Quality } from '../render/engine3d.ts';
import { DEFAULT_LOOK, type Look } from '../../../shared/src/look.ts';
import { GAMES } from '../games/index.ts';
import type { CashierPoint, Station, World } from './contract.ts';
import { SPAWN, ceilingAt, planFloor, setVpMode, type FloorPlan } from './layout.ts';
import { Mats, loadTextures } from './materials.ts';
import { Batch } from './batch.ts';
import { Collider } from './collision.ts';
import { collide } from './collide.ts';
import { Furniture } from './furniture.ts';
import { Mannequins } from './mannequins.ts';
import { RoomVisibility } from './visibility.ts';
import { MapOverlay, buildDirectories } from './wayfinding.ts';
import { buildRoom } from './room.ts';
import { buildStations, type WorldStation } from './stations.ts';
import { buildDecor } from './decor.ts';
import { buildSigns, floorSigns, loadSignFonts, signGain } from './signs.ts';
import { GlowMerge, Lighting, buildPools } from './lighting.ts';
import { Props } from './props.ts';
import { Characters } from './characters.ts';
import { Player } from './player.ts';
import { Interact } from './interact.ts';
import { TouchControls } from './touch.ts';
import { StationLod } from './lod.ts';
import { Bloom, FLOOR_BLOOM, MACHINE_BLOOM, PixelRatio, STUDIO_BELOW, STUDIO_BLOOM, TABLE_BLOOM, type BloomLook } from './bloom.ts';
import type { MouseSettings } from './mouse.ts';
import { Emotes, OWN_BUBBLE_Y, BUBBLE_Y, type CharacterSource } from './emotes.ts';
import { Staff, measureSeats, type StaffGesture } from './npcs.ts';
import { lifePoints } from './life-points.ts';
import { FloorLife } from './life/index.ts';
import type { EmoteId } from '../../../shared/src/protocol.ts';
import type { GameId } from '../../../shared/src/engine.ts';
import type { Sfx } from '../audio/sfx.ts';
import { el } from '../ui/kit.ts';
import './world.css';

export type { WorldStation } from './stations.ts';

export { SPAWN };
export { lifePoints, type LifePoints, type Seatable, type Stand } from './life-points.ts';
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
  /**
   * A further say on whether a click on the floor may capture the mouse. The world already
   * refuses while seated, while the player is disabled and while a sheet or dialog holds the
   * keyboard (overlayCount), and lets go when any of those starts.
   */
  canCapture?: () => boolean;
  /** The slot islands, one variant each (dev previews); defaults to every slots variant twice. */
  slotVariants?: string[];
  /** The game's sounds, for the ones the floor makes itself (a clap's claps); none: silent. */
  sfx?: Sfx;
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
  /** The far stand-ins and their draw-call budget (for the dev floor and the headless checks). */
  readonly lod: StationLod;
  /** Hold the glow (High's bloom) at nothing and give it back, for the checks that compare the two. */
  glow(on: boolean): void;
  /**
   * What the walker and the camera bump into. Something standing on the floor adds itself here, as
   * dealers in the open staff area do: `collider.post(x, z, 0.28, 1.9, { cam: false })`.
   */
  readonly collider: Collider;
  /** Place the player (dev views, respawn). */
  teleport(x: number, z: number, heading: number): void;
  quality: Quality;
  /** Mouse look: sensitivity (1 = default) and whether a click captures the mouse. Kept in localStorage. */
  readonly mouse: MouseSettings;
  setMouse(o: Partial<MouseSettings>): void;
  /** True while a click has captured the mouse for looking around. */
  readonly mouseCaptured: boolean;
  /** Let a captured mouse go (something is opening over the floor). */
  releaseMouse(): void;
  /**
   * Show an emote over a player: 'me' for your own character, or a floor id, found through the
   * source given to useRemotes(). False when that player has no character drawn. Your own, while
   * you sit at a table, shows at the foot of the view (your character is out of sight there).
   */
  showEmote(who: number | 'me', e: EmoteId): boolean;
  /** Where showEmote finds other players' characters (the app's RemotePlayers); null to forget. */
  useRemotes(source: CharacterSource | null): void;
  /**
   * Whether someone standing at (x, z) could be seen from the camera this frame: in a room being
   * drawn and in view (RemotePlayers' `inView`: nobody else is drawn or animated).
   */
  canSee(x: number, z: number): boolean;
  /** The dealers, bartender and cashier (npcs.ts). */
  readonly staff: Staff;
  /** The floor's life (world/life/): sitting anywhere, waiters, the bartender, bankers, the shopkeeper. */
  readonly life: FloorLife;
  /**
   * A dealer's arm motion at a station ('deal' a card, 'sweep' the chips in, 'pay' a bet) for a
   * table view to call as it animates; false when that station has no dealer.
   */
  dealerGesture(stationId: string, g: StaffGesture): boolean;
  /**
   * A waiter hands over a paid bar order: it goes in your right hand, where everyone sees it. The
   * order's id (from the bar's onOrder), or an item id for your newest paid order of that item.
   */
  holdItem(id: string): void;
  /** Put down what you're holding. */
  dropHeld(): void;
  /** Where holdItem and dropHeld go (the app's bar, ui/shop/bar.ts); null to forget. */
  useBar(bar: { hold(id: string): unknown; drop(): unknown } | null): void;
  /**
   * The room the camera is in, and the rooms being drawn (the rest can't be seen from here).
   * `showAll(true)` draws every room until `showAll(false)` (the headless checks, captures).
   */
  readonly rooms: { readonly current: string; readonly visible: ReadonlySet<string>; showAll(on: boolean): void };
  /** The casino map (the HUD's map button, or N). */
  readonly map: MapOverlay;
  /** The procedural furniture: every table's chairs and stools, the lounges' chairs, and the rest. */
  readonly furniture: Furniture;
}

/**
 * Glossy floor materials that mirror the casino on High: reflection strength, and a polish
 * (roughness) for some. The metals keep the bright studio light (brass reads as brass by it).
 */
const REFLECTIVE: [string, number, number?][] = [
  ['marble-floor', 0.55, 0.15],
  ['marble-black', 0.8],
  ['mirror', 1.0],
  ['lacquer', 0.8],
  ['lacquer-red', 0.6],
  ['wood', 0.45],
  ['wainscot', 0.35],
];

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
  const seatsOf = (g: GameId, v: string) => GAMES[g].seats(v);
  const plan = planFloor((g) => GAMES[g].footprint, opts.slotVariants, { seats: seatsOf });
  const mats = new Mats(quality, tex, aniso);
  const col = new Collider();
  const batch = new Batch();

  const glow = new GlowMerge();
  const { chandeliers, downlights } = buildRoom(plan, batch, mats, glow);
  const stationRoot = new THREE.Group();
  stationRoot.name = 'stations';
  root.add(stationRoot);
  const { stations, vpMode } = buildStations(plan, stationRoot, quality, col);
  // bar-top video poker changes the bar's counter, its stools and what fits round them
  if (vpMode !== plan.vpMode) setVpMode(plan, vpMode);
  // walls and everything solid block the walker and the camera, as the plan was checked
  collide(plan, col);
  const lod = new StationLod(stations, quality);
  const decor = buildDecor(plan, stations, batch, mats, glow);
  buildPools(decor.pools, downlights, plan, batch, mats);
  const signSpecs = [...floorSigns(plan, batch, mats), ...decor.signs];
  const staticMeshes = batch.build(root, 'floor');
  const glowMeshes = glow.build(root);
  const signs = buildSigns(signSpecs, root, quality, aniso);
  const furniture = new Furniture(plan, mats);
  root.add(furniture.group);
  const directories = buildDirectories(plan, root, aniso);
  progress(0.55);

  const props = new Props(quality);
  root.add(props.group);
  const lighting = new Lighting(plan, quality);
  root.add(lighting.group);

  const characters = new Characters(quality, mats.get('blob'));
  const look = opts.look ?? DEFAULT_LOOK;
  // the bartender and the cage's tellers come with the floor's life (world/life/)
  const staff = new Staff(characters, stations, plan, col, { skip: ['bartender', 'cashier'] });
  root.add(staff.group);
  const mannequins = new Mannequins(characters, plan);
  root.add(mannequins.group);
  await Promise.all([
    props.build(decor.props, chandeliers),
    characters.load(look).catch((err) => console.warn('character failed to load', err)),
    staff.load().catch((err) => console.warn('staff failed to load', err)),
    mannequins.load().catch((err) => console.warn('mannequins failed to load', err)),
  ]);
  // which seats have a chair or stool (other players sit on them; everywhere else they stand)
  measureSeats(stations, (s) => GAMES[s.game].seats(s.variant), [props.group, furniture.group]);
  progress(0.85);

  const character = characters.create(look, opts.name ?? '');
  character.setName('');
  root.add(character.root);
  const canvas = renderer.domElement;
  const player = new Player(character, engine.camera, col, (x, z) => ceilingAt(plan, x, z, 0.3), canvas, () => opts.canCapture?.() ?? true);
  player.spawn(SPAWN.x, SPAWN.z, SPAWN.yaw);

  const cashierAnchor = new THREE.Object3D();
  cashierAnchor.name = 'cashier';
  cashierAnchor.position.set(plan.cashier.x, 0, plan.cashier.counter.z1);
  root.add(cashierAnchor);
  const cashier: CashierPoint = { id: 'cashier', anchor: cashierAnchor, position: new THREE.Vector3(plan.cashier.x, 0, plan.cashier.z) };
  const ui = opts.ui ?? document.getElementById('ui') ?? document.body;
  const interact = new Interact(stations, cashier, player, engine.camera, ui, opts.onEscape);
  // Rooms nobody can see from where the camera is aren't drawn: their walls and ceilings, their
  // furniture and props, their stations and staff.
  const visibility = new RoomVisibility(plan);
  const applyRooms = () => {
    const vis = visibility.visible;
    for (const r of plan.rooms) {
      staticMeshes.setRoom(r.id, vis.has(r.id));
      glowMeshes.setRoom(r.id, vis.has(r.id));
    }
    furniture.setRooms(vis);
    props.setRooms(vis);
    mannequins.setRooms(vis);
    for (const d of directories.meshes) d.visible = vis.has(d.userData.room as string);
  };
  const sees = (room: string, box: THREE.Box3) => visibility.sees(room, box);
  let everything = false;
  // the map opens on the floor, not at a table (blackjack's N is "no insurance")
  const map = new MapOverlay({ plan, ui, you: () => ({ x: player.position.x, z: player.position.z, heading: player.heading }), canOpen: () => !interact.seated && player.isEnabled });
  // v6 world6: E at a directory board opens it big (the Map, as the Floor Directory)
  interact.spots(map.spots);
  // On the floor with the mouse free (after Esc, or before the first click on the dev floor): how
  // to get looking around back. Only where there's a mouse to hold (the player knows).
  const hint = el('div', 'world-hint');
  hint.append(el('span', 'world-key', 'Click'), 'to look around');
  hint.hidden = true;
  ui.append(hint);
  // Phones and tablets: the thumb stick, drag-to-look, the action button and Leave at a table.
  const touch = new TouchControls({ player, ui, seated: () => interact.seated, focus: () => interact.focus, spot: () => interact.spot, sensitivity: () => player.mouseSettings.sensitivity });
  const life = new FloorLife({ root, camera: engine.camera, characters, plan, points: lifePoints(plan), player, interact, collider: col, staff: staff.posts });
  await life.load();

  const bloom = new Bloom(engine);
  const pr = new PixelRatio(renderer);
  // bloom's extra passes would otherwise reset the counters mid-frame; world.update() resets them
  renderer.info.autoReset = false;
  const applyQuality = (q: Quality) => {
    bloom.setEnabled(q === 'high');
    pr.set(q === 'high');
  };
  applyQuality(quality);

  // compile every shader now, behind the loading screen, so the first frames and "Press E" don't
  // stall: what's hidden too (far stand-ins, the staff's still copies, characters out of view),
  // shown for the compile only, or it compiles on the spot the first time it comes into view
  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o.visible) return;
    hidden.push(o);
    o.visible = true;
  });
  try {
    await renderer.compileAsync(scene, engine.camera);
  } catch {
    /* compiled lazily instead */
  } finally {
    for (const o of hidden) o.visible = false;
  }
  // The floor's own reflections (High): the casino captured from inside the doors and
  // prefiltered, for the polished marble, lacquer and wood, so they mirror its warm lights and
  // signs instead of a studio.
  let reflections: THREE.WebGLRenderTarget | null = null;
  const reflect = () => {
    if (reflections || quality !== 'high') return;
    const pmrem = new THREE.PMREMGenerator(renderer);
    // the floor as it stands: not the player, not the chandeliers' passing glints
    props.glinting = false;
    const shown = character.root.visible;
    character.root.visible = false;
    // from the main aisle just inside the vestibule: the pit, its lights and the signs ahead, the doors behind
    reflections = pmrem.fromScene(scene, 0, 0.1, 60, { size: 256, position: new THREE.Vector3(0, 1.6, plan.entrance.z0 - 1.5) });
    character.root.visible = shown;
    props.glinting = true;
    pmrem.dispose();
    for (const [name, k, rough] of REFLECTIVE) {
      const m = mats.get(name) as THREE.MeshStandardMaterial;
      if (!m.isMeshStandardMaterial) continue;
      m.envMap = reflections.texture;
      m.envMapIntensity = k;
      if (rough !== undefined) m.roughness = rough;
      m.needsUpdate = true;
    }
  };

  // with the shaders compiled, the capture is only the drawing
  reflect();
  progress(1);

  const emotes = new Emotes({ ui, sfx: opts.sfx, ears: () => engine.camera.position });
  let remotes: CharacterSource | null = null;
  let bar: Parameters<FloorWorld['useBar']>[0] = null;

  let bloomLook: BloomLook = FLOOR_BLOOM;
  let lastCalls = 0;
  let lastTris = 0;
  const focusAt = new THREE.Vector3();

  const world: FloorWorld = {
    stations,
    cashier,
    characterFactory: characters,
    plan,
    quality,
    lod,
    glow: (on) => bloom.mute(!on),
    collider: col,
    player: {
      character,
      position: player.position,
      setEnabled: (on) => player.setEnabled(on),
      state: () => ({ x: player.position.x, z: player.position.z, yaw: player.heading, moving: player.speed > 0.05 }),
      teleport: (x, z, yaw) => player.spawn(x, z, yaw),
    },
    onEnter: (cb) => interact.onEnter(cb),
    onCashier: (cb) => interact.onCashier(cb),
    exitTable: () => {
      furniture.showChairs();
      return interact.exit();
    },
    enter: (s, seat = null) => {
      const ws = stations.find((x) => x.id === s.id);
      if (!ws) return;
      interact.enter(ws, seat);
      if (seat !== null) furniture.hideChair(ws.id, seat, true);
    },
    aim: (seat) => {
      // the chair you sit in is under the camera: leave it out while you're there
      const at = interact.seated;
      if (at) {
        furniture.showChairs();
        furniture.hideChair(at.id, seat, true);
      }
      interact.aim(seat);
    },
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
      mannequins.refresh();
      if (signs) (signs.mesh.material as THREE.MeshBasicMaterial).color.setScalar(signGain(q));
      lighting.setQuality(q);
      characters.setQuality(q);
      void props.setQuality(q).then(() => reflect());
      applyQuality(q);
    },
    update(dt) {
      lastCalls = renderer.info.render.calls;
      lastTris = renderer.info.render.triangles;
      renderer.info.reset();
      life.early(dt);
      player.update(dt);
      interact.update(dt);
      const idle = player.awaitingClick && !interact.seated;
      if (hint.hidden === idle) hint.hidden = !idle;
      touch.update();
      if (!everything && visibility.update(engine.camera)) applyRooms();
      lighting.setRoom(visibility.room);
      lod.update(engine.camera, interact.seated, everything ? null : visibility.visible, everything ? null : sees);
      character.update(dt);
      staff.update(dt, engine.camera, interact.seated, everything ? null : visibility.visible, everything ? null : sees);
      map.update(dt);
      life.update(dt, visibility.visible, sees);
      emotes.update(dt);
      const f = world.focus;
      lighting.setFocus(f && f.zone !== 'slots' && f.zone !== 'parlour' && f.game !== 'videopoker' ? focusAt.copy(f.anchor.position) : null);
      lighting.update(dt);
      // Seated, the camera is a metre from lit felt, cards and brass: nothing on a table glows
      // there; at a machine its own lights do, a little.
      const seat = interact.seated;
      const studio = engine.camera.position.y < STUDIO_BELOW;
      const want = studio ? STUDIO_BLOOM : !seat ? FLOOR_BLOOM : seat.zone === 'slots' || seat.zone === 'parlour' || seat.game === 'videopoker' ? MACHINE_BLOOM : TABLE_BLOOM;
      if (want !== bloomLook) {
        bloomLook = want;
        bloom.setLook(want);
      }
      props.update(dt);
      characters.updateLabels(engine.camera);
      bloom.update(dt);
      pr.update(dt);
      life.late(dt);
    },
    stats: () => ({ calls: lastCalls, triangles: lastTris, programs: renderer.info.programs?.length ?? 0, pixelRatio: renderer.getPixelRatio() }),
    teleport: (x, z, heading) => player.spawn(x, z, heading),
    get mouse() {
      return player.mouseSettings;
    },
    setMouse: (o) => player.setMouse(o),
    get mouseCaptured() {
      return player.captured;
    },
    releaseMouse: () => player.release(),
    showEmote(who, e) {
      const own = who === 'me';
      const ch = own ? character : remotes?.character(who);
      if (!ch) return false;
      emotes.show(ch, e, own ? OWN_BUBBLE_Y : BUBBLE_Y, { own, screen: own && interact.seated !== null });
      return true;
    },
    useRemotes(source) {
      remotes = source;
    },
    canSee: (x, z) => everything || visibility.seesPerson(x, z),
    staff,
    life,
    dealerGesture: (id, g) => staff.gesture(id, g),
    holdItem: (id) => void bar?.hold(id),
    dropHeld: () => void bar?.drop(),
    useBar(b) {
      bar = b;
    },
    rooms: {
      get current() {
        return visibility.room;
      },
      get visible() {
        return visibility.visible;
      },
      showAll(on) {
        everything = on;
        if (on) visibility.all();
        applyRooms();
        if (!on) visibility.update(engine.camera) && applyRooms();
      },
    },
    map,
    furniture,
    dispose() {
      map.dispose();
      directories.dispose();
      mannequins.dispose();
      furniture.dispose();
      hint.remove();
      touch.dispose();
      emotes.dispose();
      life.dispose();
      staff.dispose();
      lod.dispose();
      interact.dispose();
      player.dispose();
      character.dispose();
      bloom.dispose();
      reflections?.dispose();
      renderer.info.autoReset = true;
      signs?.texture.dispose();
      for (const m of [...staticMeshes.meshes, ...glowMeshes.meshes]) m.dispose();
      mats.dispose();
      root.removeFromParent();
    },
  };
  return world;
}
