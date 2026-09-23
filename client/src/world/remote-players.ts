// Everyone else on the floor, drawn from FloorLink's tracks: one Character per remote player,
// placed 200 ms in the past and walking or idling by how fast that drawn position moves. A player
// sitting at a station is drawn at the seat the scene hands back, or hidden if there is none.
//
// CapsuleFactory is a plain stand-in (a figure in the player's colours with a name tag) for as
// long as no real CharacterFactory is passed in.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Character, CharacterFactory } from './contract.ts';
import { byteToYaw, type FloorLink, type RemotePlayer } from '../net/presence.ts';
import { serverNow } from '../net/clock.ts';
import { SKIN_TONES, type Look } from '../../../shared/src/look.ts';
import './remote-players.css';

/** Where a seated player is drawn: world metres, and rotation.y in radians. */
export interface SeatPose {
  x: number;
  y?: number;
  z: number;
  yaw: number;
}

export interface RemotePlayersOptions {
  factory?: CharacterFactory;
  /**
   * The seat for the `slot`-th remote player sitting at a station (slots count up from 0 in
   * player-id order, so two people at one table don't share a chair). Null, or no callback at
   * all, hides seated players.
   */
  seatOf?: (station: string, slot: number) => SeatPose | null;
  /** Ground speed in m/s that reads as a full walk; slower motion blends toward idle. */
  walkSpeed?: number;
}

interface Drawn {
  ch: Character;
  x: number;
  z: number;
  speed: number;
  /** x/z hold last frame's drawn position (false after a seat or a hide). */
  onFloor: boolean;
}

/** A drawn step longer than this (m) in one frame is a snap, not a walk. */
const SNAP_M = 3;

export class RemotePlayers {
  readonly group = new THREE.Group();
  private readonly drawn = new Map<number, Drawn>();
  private readonly factory: CharacterFactory;
  private readonly walkSpeed: number;
  private readonly offs: (() => void)[];

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
      link.on('look', (id, look) => this.drawn.get(id)?.ch.setLook(look)),
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
    const slots = new Map<string, number>();
    for (const id of [...this.drawn.keys()].sort((a, b) => a - b)) {
      const d = this.drawn.get(id)!;
      const p = this.link.players.get(id);
      const pose = p?.track.at(now) ?? null;
      const root = d.ch.root;
      const station = p?.info.at?.station;
      // Someone the snapshots show walking has stood up, even if the table hasn't said so yet.
      if (station && !pose?.moving) {
        const slot = slots.get(station) ?? 0;
        slots.set(station, slot + 1);
        const seat = this.opts.seatOf?.(station, slot) ?? null;
        root.visible = seat !== null;
        d.onFloor = false;
        d.speed = 0;
        if (seat) {
          root.position.set(seat.x, seat.y ?? 0, seat.z);
          root.rotation.y = seat.yaw;
          d.ch.setMotion(0);
          d.ch.update(dt);
        }
        continue;
      }
      if (!pose) {
        root.visible = false;
        d.onFloor = false;
        continue;
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
      root.visible = true;
      root.position.set(x, 0, z);
      root.rotation.y = byteToYaw(pose.r);
      // Past a walking pace the blend leans toward the run cycle, as it does for your own character.
      d.ch.setMotion(Math.min(2, d.speed / this.walkSpeed));
      d.ch.update(dt);
    }
  }

  dispose(): void {
    for (const off of this.offs) off();
    for (const id of [...this.drawn.keys()]) this.remove(id);
    this.group.removeFromParent();
  }

  private add(p: RemotePlayer): void {
    if (this.drawn.has(p.info.id)) return;
    const ch = this.factory.create(p.info.look, p.info.name);
    ch.root.visible = false; // until its first update places it
    this.group.add(ch.root);
    this.drawn.set(p.info.id, { ch, x: 0, z: 0, speed: 0, onFloor: false });
  }

  private remove(id: number): void {
    const d = this.drawn.get(id);
    if (!d) return;
    d.ch.root.removeFromParent();
    d.ch.dispose();
    this.drawn.delete(id);
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

  update(dt: number): void {
    // A step bob and a little sway, scaled by how much of a walk this is.
    this.phase = (this.phase + dt * 11 * this.motion) % (Math.PI * 2);
    this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.035 * this.motion;
    this.body.rotation.z = Math.sin(this.phase) * 0.04 * this.motion;
    this.body.rotation.x = 0.06 * this.motion;
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
