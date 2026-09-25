// Everyone else on the floor, drawn from FloorLink's tracks: one Character per remote player,
// placed 200 ms in the past and walking or idling by how fast that drawn position moves. A player
// sitting at a station is drawn at the seat the scene hands back, or hidden if there is none; one
// sitting on a floor seat (a stool, a sofa) is drawn sitting on it.
//
// CapsuleFactory is a plain stand-in (a figure in the player's colours with a name tag) for as
// long as no real CharacterFactory is passed in.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Character, CharacterFactory } from './contract.ts';
import { byteToYaw, type FloorLink, type RemotePlayer } from '../net/presence.ts';
import { serverNow } from '../net/clock.ts';
import { SKIN_TONES, type Look } from '../../../shared/src/look.ts';
import { titleOf } from '../../../shared/src/feats.ts';
import type { EmoteId } from '../../../shared/src/protocol.ts';
import './remote-players.css';

/** Where a seated player is drawn: world metres, and rotation.y in radians. */
export interface SeatPose {
  x: number;
  y?: number;
  z: number;
  yaw: number;
  /** The top of the chair or stool there, metres above the seat's floor; none: they stand. */
  sit?: number | null;
}

export interface RemotePlayersOptions {
  factory?: CharacterFactory;
  /**
   * The seat for the `slot`-th remote player sitting at a station (slots count up from 0 in
   * player-id order, so two people at one table don't share a chair). Null, or no callback at
   * all, hides seated players.
   */
  seatOf?: (station: string, slot: number) => SeatPose | null;
  /**
   * The floor seat (a bar stool, a sofa place) a player sits on, if any: they are drawn sitting on
   * it once their walk there has reached it.
   */
  seatFor?: (id: number) => SeatPose | null;
  /** Ground speed in m/s that reads as a full walk; slower motion blends toward idle. */
  walkSpeed?: number;
  /**
   * Whether someone standing at (x, z) could be seen from the camera now (their room is drawn and
   * they're in view). Anyone who can't be isn't drawn or animated until they can; none: everyone is.
   */
  inView?: (x: number, z: number) => boolean;
  /** Where the camera is: with more than MAX_DRAWN people in view, the nearest are drawn. */
  eye?: () => { x: number; z: number };
  /**
   * Everyone's shadow drawn as one instanced mesh of this shape and material (each character's
   * own, Person.shadow in world/characters.ts, is hidden): one draw call for the whole crowd, as
   * the staff's are.
   */
  shadow?: { geometry: THREE.BufferGeometry; material: THREE.Material };
}

interface Drawn {
  ch: Character;
  x: number;
  z: number;
  speed: number;
  /** x/z hold last frame's drawn position (false after a seat or a hide). */
  onFloor: boolean;
  /** Placed this frame: standing, walking or sitting somewhere they can be drawn. */
  placed: boolean;
  /** Drawn this frame: placed, in view and among the nearest MAX_DRAWN. */
  shown: boolean;
  /** How far from the camera (m), less KEEP_M for one already drawn: the crowd's nearest go first. */
  rank: number;
}

/** A drawn step longer than this (m) in one frame is a snap, not a walk. */
const SNAP_M = 3;
/** How near their seat a floor sitter's drawn walk must come before they're drawn sitting on it. */
const ARRIVED_M = 0.9;
/**
 * The most other players drawn at once: a crowd bigger than this in view (a rush through the
 * doors) shows its nearest, so the frame's cost has a ceiling however many people come.
 */
export const MAX_DRAWN = 40;
/** Someone already drawn counts as this much nearer, so the crowd's edge doesn't flicker. */
const KEEP_M = 1;

export class RemotePlayers {
  readonly group = new THREE.Group();
  private readonly drawn = new Map<number, Drawn>();
  /** Player ids in order (seat slots at a station count up in it). */
  private order: number[] = [];
  private readonly factory: CharacterFactory;
  private readonly walkSpeed: number;
  private readonly offs: (() => void)[];
  private readonly slots = new Map<string, number>();
  private readonly seen: Drawn[] = [];
  private shadows: THREE.InstancedMesh | null = null;

  constructor(
    private readonly link: FloorLink,
    parent: THREE.Object3D,
    private readonly opts: RemotePlayersOptions = {},
  ) {
    this.factory = opts.factory ?? new CapsuleFactory();
    this.walkSpeed = opts.walkSpeed ?? 1.75;
    this.group.name = 'remote-players';
    parent.add(this.group);
    for (const p of link.players.values()) this.add(p);
    this.offs = [
      link.on('join', (p) => this.add(p)),
      link.on('leave', (id) => this.remove(id)),
      link.on('look', (id, look) => {
        const ch = this.drawn.get(id)?.ch;
        ch?.setLook(look);
        if (ch) showTitle(ch, look); // v6 feats6
      }),
    ];
  }

  /** The character drawn for a player, if any (for picking, or a camera that follows someone). */
  character(id: number): Character | undefined {
    return this.drawn.get(id)?.ch;
  }

  /** How fast a player is drawn moving, m/s (what the walk blend is made from). */
  speed(id: number): number {
    return this.drawn.get(id)?.speed ?? 0;
  }

  /** Call every frame with the frame's dt in seconds. */
  update(dt: number): void {
    const now = serverNow();
    this.slots.clear();
    const seen = this.seen;
    seen.length = 0;
    const eye = this.opts.eye?.();
    for (const id of this.order) {
      const d = this.drawn.get(id)!;
      d.placed = this.place(d, id, now, dt);
      if (!d.placed) continue;
      const at = d.ch.root.position;
      if (this.opts.inView && !this.opts.inView(at.x, at.z)) continue;
      d.rank = (eye ? Math.hypot(at.x - eye.x, at.z - eye.z) : 0) - (d.shown ? KEEP_M : 0);
      seen.push(d);
    }
    if (seen.length > MAX_DRAWN) {
      seen.sort((a, b) => a.rank - b.rank);
      seen.length = MAX_DRAWN;
    }
    for (const d of this.drawn.values()) d.shown = false;
    for (const d of seen) d.shown = true;
    let n = 0;
    for (const d of this.drawn.values()) {
      const root = d.ch.root;
      root.visible = d.shown;
      // not drawn but there (another room, behind the camera, past the crowd's nearest): the
      // floor's staff and waiters still look at and step round them
      root.userData.offscreen = d.placed && !d.shown;
      if (!d.shown) continue;
      d.ch.update(dt);
      n = this.shade(d, n);
    }
    if (this.shadows) {
      this.shadows.count = n;
      this.shadows.visible = n > 0;
      this.shadows.instanceMatrix.needsUpdate = true;
    }
  }

  /** Put a player where they are drawn this frame; false when they aren't drawn anywhere. */
  private place(d: Drawn, id: number, now: number, dt: number): boolean {
    const p = this.link.players.get(id);
    const pose = p?.track.at(now) ?? null;
    const root = d.ch.root;
    const station = p?.info.at?.station;
    const floorSeat = station ? null : (this.opts.seatFor?.(id) ?? null);
    if (floorSeat && (!pose || Math.hypot(pose.x / 100 - floorSeat.x, pose.z / 100 - floorSeat.z) < ARRIVED_M)) {
      d.onFloor = false;
      d.speed = 0;
      root.position.set(floorSeat.x, floorSeat.y ?? 0, floorSeat.z);
      root.rotation.y = floorSeat.yaw;
      d.ch.setMotion(0);
      d.ch.sit?.(floorSeat.sit ?? null);
      return true;
    }
    // Someone the snapshots show walking has stood up, even if the table hasn't said so yet.
    if (station && !pose?.moving) {
      const slot = this.slots.get(station) ?? 0;
      this.slots.set(station, slot + 1);
      const seat = this.opts.seatOf?.(station, slot) ?? null;
      d.onFloor = false;
      d.speed = 0;
      if (!seat) return false;
      root.position.set(seat.x, seat.y ?? 0, seat.z);
      root.rotation.y = seat.yaw;
      d.ch.setMotion(0);
      d.ch.sit?.(seat.sit ?? null);
      return true;
    }
    d.ch.sit?.(null);
    if (!pose) {
      d.onFloor = false;
      return false;
    }
    const x = pose.x / 100;
    const z = pose.z / 100;
    // Speed from the drawn motion itself, eased so one late snapshot doesn't stutter the walk.
    const step = d.onFloor ? Math.hypot(x - d.x, z - d.z) : 0;
    const v = dt > 0 && step < SNAP_M ? step / dt : 0;
    d.speed += (v - d.speed) * Math.min(1, dt * 8);
    d.x = x;
    d.z = z;
    d.onFloor = true;
    root.position.set(x, 0, z);
    root.rotation.y = byteToYaw(pose.r);
    // Past a walking pace the blend leans toward the run cycle, as it does for your own character.
    d.ch.setMotion(Math.min(2, d.speed / this.walkSpeed));
    return true;
  }

  /** Write a drawn player's shadow into the shared instances (its own is hidden); the next free slot. */
  private shade(d: Drawn, n: number): number {
    const s = this.opts.shadow;
    const own = (d.ch as { shadow?: THREE.Object3D | null }).shadow;
    if (!s || !own) return n;
    own.visible = false;
    if (!this.shadows || n >= this.shadows.instanceMatrix.count) {
      // room for twice as many, keeping this frame's shadows so far
      const was = this.shadows;
      const next = new THREE.InstancedMesh(s.geometry, s.material, Math.max(16, (n + 1) * 2));
      if (was) next.instanceMatrix.array.set(was.instanceMatrix.array.subarray(0, n * 16));
      next.name = 'remote-shadows';
      next.frustumCulled = false;
      next.renderOrder = 1;
      was?.removeFromParent();
      was?.dispose();
      this.group.add(next);
      this.shadows = next;
    }
    // the shadow stays on the floor under someone sitting (Person moves it for the drop)
    own.updateWorldMatrix(true, false);
    this.shadows.setMatrixAt(n, own.matrixWorld);
    return n + 1;
  }

  dispose(): void {
    for (const off of this.offs) off();
    for (const id of [...this.drawn.keys()]) this.remove(id);
    this.shadows?.dispose();
    this.group.removeFromParent();
  }

  private add(p: RemotePlayer): void {
    if (this.drawn.has(p.info.id)) return;
    const ch = this.factory.create(p.info.look, p.info.name);
    showTitle(ch, p.info.look); // v6 feats6
    ch.root.visible = false; // until its first update places it
    this.group.add(ch.root);
    this.drawn.set(p.info.id, { ch, x: 0, z: 0, speed: 0, onFloor: false, placed: false, shown: false, rank: 0 });
    this.order = [...this.drawn.keys()].sort((a, b) => a - b);
  }

  private remove(id: number): void {
    const d = this.drawn.get(id);
    if (!d) return;
    d.ch.root.removeFromParent();
    d.ch.dispose();
    this.drawn.delete(id);
    this.order = [...this.drawn.keys()].sort((a, b) => a - b);
  }
}

// ---------------------------------------------------------------------------------------------
// Stand-in characters

interface Shapes {
  legs: THREE.BufferGeometry;
  torso: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  hair: THREE.BufferGeometry;
  nose: THREE.BufferGeometry;
}

// Every stand-in shares one set of shapes; only the materials carry a player's colours.
let shapes: Shapes | null = null;

function makeShapes(): Shapes {
  return {
    legs: new THREE.CapsuleGeometry(0.14, 0.5, 4, 12),
    torso: new THREE.CapsuleGeometry(0.21, 0.34, 4, 14),
    head: new THREE.SphereGeometry(0.125, 20, 14),
    hair: new THREE.SphereGeometry(0.132, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
    nose: new THREE.BoxGeometry(0.035, 0.045, 0.05),
  };
}

export class CapsuleFactory implements CharacterFactory {
  create(look: Look, name: string): Character {
    return new CapsuleCharacter(look, name);
  }
}

class CapsuleCharacter implements Character {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly top = cloth();
  private readonly bottom = cloth();
  private readonly skin = cloth();
  private readonly hair = cloth();
  private readonly tag: CSS2DObject;
  private readonly label = document.createElement('div');
  private motion = 0;
  private phase = 0;
  /** An emote being acted out: a hop for a cheer, a little sway for the rest. */
  private act: { hop: boolean; t: number } | null = null;

  constructor(look: Look, name: string) {
    const s = (shapes ??= makeShapes());
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      this.body.add(m);
    };
    part(s.legs, this.bottom, 0, 0.39, 0);
    part(s.torso, this.top, 0, 1.12, 0);
    part(s.head, this.skin, 0, 1.64, 0);
    part(s.hair, this.hair, 0, 1.655, -0.006);
    part(s.nose, this.skin, 0, 1.625, 0.125); // faces +z, the way rotation.y = 0 looks
    this.root.add(this.body);
    this.label.className = 'remote-tag';
    this.label.textContent = name;
    this.tag = new CSS2DObject(this.label);
    this.tag.position.y = 1.98;
    this.root.add(this.tag);
    this.setLook(look);
  }

  setLook(look: Look): void {
    this.top.color.set(look.top);
    this.bottom.color.set(look.bottom);
    this.skin.color.set(SKIN_TONES[look.skin] ?? SKIN_TONES[2]);
    this.hair.color.set(look.hair);
    this.body.scale.setScalar(look.body === 'f' ? 0.95 : 1);
  }

  setMotion(speed: number): void {
    this.motion = Math.max(0, Math.min(1, speed));
  }

  setName(name: string): void {
    this.label.textContent = name;
  }

  gesture(e: EmoteId): void {
    this.act = { hop: e === 'cheer', t: 0 };
  }

  update(dt: number): void {
    // A step bob and a little sway, scaled by how much of a walk this is.
    this.phase = (this.phase + dt * 11 * this.motion) % (Math.PI * 2);
    this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.035 * this.motion;
    this.body.rotation.z = Math.sin(this.phase) * 0.04 * this.motion;
    this.body.rotation.x = 0.06 * this.motion;
    if (this.act) {
      const a = this.act;
      a.t += dt;
      if (a.t > 1.2) this.act = null;
      else if (a.hop) this.body.position.y += 0.14 * Math.abs(Math.sin((Math.PI * a.t) / 0.4));
      else this.body.rotation.z += 0.08 * Math.sin(a.t * 12) * (1 - a.t / 1.2);
    }
  }

  dispose(): void {
    // CSS2DObject only removes its element when it is itself detached, not when an ancestor is.
    this.tag.removeFromParent();
    this.label.remove();
    for (const m of [this.top, this.bottom, this.skin, this.hair]) m.dispose();
  }
}

function cloth(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0 });
}

// v6 feats6: the title a player wears (a feat's, shared/src/feats.ts), on a line of its own under
// the name in their tag. The tag's text is the name (setName writes it), so the title is a child
// element added after it, and taken off again when they stop wearing one.
function showTitle(ch: Character, look: Look): void {
  const tag = (ch as { tag?: { element?: HTMLElement } }).tag?.element ?? (ch as unknown as { label?: HTMLElement }).label;
  if (!tag) return;
  const title = titleOf(look.title)?.reward.title ?? null;
  let line = tag.querySelector<HTMLElement>('.tag-title');
  tag.classList.toggle('titled', title !== null);
  if (!title) {
    line?.remove();
    return;
  }
  if (!line) {
    line = document.createElement('span');
    line.className = 'tag-title';
    tag.append(line);
  }
  line.textContent = title;
}
