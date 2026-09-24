// The boutique's showroom: your character on a turntable in a small room of its own, drawn by the
// game's one renderer the way the character editor's dressing room is. The room is built far
// below the floor, out of every other view; the camera is borrowed while the boutique is open and
// put back when it closes. The camera moves in to whatever is on show: the chest for a chain, the
// mouth for a grill, the left wrist for a watch, the whole figure for clothes.

import * as THREE from 'three';
import type { Look } from '../../../../shared/src/look.ts';
import type { ItemKind } from '../../../../shared/src/items.ts';
import type { Character, CharacterFactory } from '../../world/contract.ts';
import type { EngineLike } from '../menu/deps.ts';

export type Framing = 'full' | 'chest' | 'face' | 'head' | 'wrist' | 'hand';

/** Where the camera looks (character frame, facing the camera at yaw 0), how much height it frames, and which way the figure turns to show it. */
const FRAMES: Record<Framing, { at: [number, number, number]; height: number; yaw: number; sway: number }> = {
  full: { at: [0, 0.97, 0], height: 2.15, yaw: -0.35, sway: 0 },
  chest: { at: [0, 1.43, 0.13], height: 0.62, yaw: -0.25, sway: 0.5 },
  face: { at: [0, 1.62, 0.2], height: 0.3, yaw: -0.3, sway: 0.45 },
  head: { at: [0, 1.7, 0.12], height: 0.62, yaw: -0.4, sway: 0.45 },
  wrist: { at: [0.28, 1.0, 0.06], height: 0.3, yaw: -1.25, sway: 0.35 },
  hand: { at: [-0.2, 1.2, 0.3], height: 0.55, yaw: 0.45, sway: 0.35 },
};

/** The framing that shows off a kind of item. */
export function framingFor(kind: ItemKind | 'held' | null): Framing {
  switch (kind) {
    case 'chain':
      return 'chest';
    case 'grill':
    case 'shades':
      return 'face';
    case 'hat':
      return 'head';
    case 'watch':
      return 'wrist';
    case 'held':
      return 'hand';
    default:
      return 'full';
  }
}

const PODIUM_TOP = 0.07;

function canvasTexture(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * A jeweller's room: a black lacquered plinth with a brass edge, a deep oxblood backdrop with
 * out-of-focus lights, and spotlights with a short reach (60 m down, they never touch the floor).
 */
function room(at: THREE.Vector3): { group: THREE.Group; pivot: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  group.name = 'showroom';
  group.position.copy(at);

  const floorTex = canvasTexture(512, 512, (g) => {
    const r = g.createRadialGradient(256, 256, 0, 256, 256, 256);
    r.addColorStop(0, '#2c1a14');
    r.addColorStop(0.2, '#1c110d');
    r.addColorStop(0.6, '#0b0706');
    r.addColorStop(1, '#050303');
    g.fillStyle = r;
    g.fillRect(0, 0, 512, 512);
  });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(7, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: floorTex }));
  group.add(floor);

  const wallTex = canvasTexture(1024, 512, (g) => {
    const v = g.createLinearGradient(0, 0, 0, 512);
    v.addColorStop(0, '#040202');
    v.addColorStop(0.4, '#170709');
    v.addColorStop(0.52, '#22090c');
    v.addColorStop(0.66, '#0e0506');
    v.addColorStop(1, '#040303');
    g.fillStyle = v;
    g.fillRect(0, 0, 1024, 512);
    // the shop's lights, far off and out of focus
    g.globalCompositeOperation = 'lighter';
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 60; i++) {
      const x = rnd() * 1024;
      const y = 190 + rnd() * 110;
      const rad = 5 + rnd() * 18;
      const col = rnd() < 0.85 ? '255,196,120' : '255,236,210';
      const a = 0.04 + rnd() * 0.13;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(${col},${a})`);
      gr.addColorStop(0.7, `rgba(${col},${a * 0.6})`);
      gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
    }
  });
  const wall = new THREE.Mesh(new THREE.SphereGeometry(9, 48, 24), new THREE.MeshBasicMaterial({ map: wallTex, side: THREE.BackSide }));
  wall.position.y = 1.2;
  group.add(wall);

  const lacquer = new THREE.MeshStandardMaterial({ color: '#0d0b0a', roughness: 0.22, metalness: 0 });
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, PODIUM_TOP, 64), lacquer);
  plinth.position.y = PODIUM_TOP / 2;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.635, 0.008, 8, 128), new THREE.MeshStandardMaterial({ color: '#c9a24b', metalness: 1, roughness: 0.25 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = PODIUM_TOP;
  group.add(plinth, ring);

  // key from the front right, a strong rim behind (the edges of gold catch it), a soft fill
  const key = new THREE.SpotLight('#fff1dc', 34, 9, 0.5, 0.65, 1.4);
  key.position.set(1.5, 3.0, 2.4);
  key.target.position.set(0, 1.1, 0);
  const rim = new THREE.SpotLight('#ffe2b8', 48, 8, 0.55, 0.7, 1.4);
  rim.position.set(-1.7, 2.6, -2.0);
  rim.target.position.set(0, 1.3, 0);
  const fill = new THREE.PointLight('#f2dcc4', 7, 7, 1.6);
  fill.position.set(-2.0, 1.4, 2.3);
  group.add(key, key.target, rim, rim.target, fill);

  const pivot = new THREE.Group();
  pivot.position.y = PODIUM_TOP;
  group.add(pivot);

  return {
    group,
    pivot,
    dispose() {
      group.removeFromParent();
      group.remove(pivot);
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.map?.dispose();
        mat.dispose();
      });
    },
  };
}

export interface ShowroomOpts {
  engine: EngineLike;
  characters: CharacterFactory;
  look: Look;
  name: string;
  /** Where the room is built. Default: 60 m below the floor, beside the editor's. */
  at?: THREE.Vector3;
  /** The part of the screen the figure should sit in (the rest is the boutique's panel). */
  area(): { x0: number; y0: number; x1: number; y1: number };
}

/** The showroom with your character in it, turning slowly, the camera on whatever is shown. */
export class Showroom {
  readonly character: Character;
  private readonly built: ReturnType<typeof room>;
  private readonly cam: THREE.PerspectiveCamera;
  private readonly camBefore: { position: THREE.Vector3; quaternion: THREE.Quaternion };
  private readonly offFrame: () => void;
  private framing: Framing = 'full';
  private yaw = FRAMES.full.yaw;
  private base = FRAMES.full.yaw;
  private clock = 0;
  private held = 0;
  private fixed: number | null = null;
  private readonly camAt = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private placed = false;

  constructor(private readonly opts: ShowroomOpts) {
    this.cam = opts.engine.camera;
    this.camBefore = { position: this.cam.position.clone(), quaternion: this.cam.quaternion.clone() };
    this.built = room(opts.at ?? new THREE.Vector3(9, -60, 0));
    opts.engine.scene.add(this.built.group);
    this.character = opts.characters.create(opts.look, opts.name);
    this.character.setName('');
    this.character.setMotion(0);
    this.built.pivot.add(this.character.root);
    this.built.pivot.rotation.y = this.yaw;
    this.offFrame = opts.engine.onFrame((dt) => this.update(dt));
  }

  setLook(look: Look): void {
    this.character.setLook(look);
  }

  /** Move the camera in to show this (and turn the figure to show it). */
  show(f: Framing): void {
    if (f === this.framing) return;
    this.framing = f;
    this.base = FRAMES[f].yaw;
    this.clock = 0;
  }

  /** Turn by hand (a drag): the slow turn waits a moment before it takes over again. */
  turn(by: number): void {
    this.base += by;
    this.held = 2.5;
  }

  /** Hold the figure still at this turn (null lets it turn again). */
  still(yaw: number | null): void {
    this.fixed = yaw;
  }

  /** Re-frame after the window or the panel changed size. */
  reframe(): void {
    this.placed = false;
  }

  private update(dt: number): void {
    this.clock += dt;
    const f = FRAMES[this.framing];
    if (this.held > 0) this.held -= dt;
    else if (f.sway === 0) this.base += dt * 0.28;
    // full figure: a slow turn; close-ups: an easy sway either side of the angle that shows it
    const want = this.fixed ?? this.base + f.sway * Math.sin(this.clock * 0.45);
    this.yaw += (want - this.yaw) * (this.fixed !== null ? 1 : Math.min(1, dt * 3));
    this.built.pivot.rotation.y = this.yaw;
    this.character.update(dt);
    this.place(dt);
  }

  /** The camera: the framed point centred in the free part of the screen, the framed height filling most of it. */
  private place(dt: number): void {
    const f = FRAMES[this.framing];
    const a = this.opts.area();
    const vw = innerWidth;
    const vh = innerHeight;
    const half = Math.tan(THREE.MathUtils.degToRad(this.cam.fov) / 2);
    const frac = Math.max(0.2, (a.y1 - a.y0) / vh);
    const d = f.height / (2 * half * frac * 0.86);
    const cx = ((a.x0 + a.x1) / 2 / vw) * 2 - 1;
    const cy = -(((a.y0 + a.y1) / 2 / vh) * 2 - 1);
    // the point turns with the figure (with its resting turn, not the sway, so the camera stays calm)
    const focus = this.built.group.position.clone().add(new THREE.Vector3(...f.at).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.fixed ?? this.base)).add(new THREE.Vector3(0, PODIUM_TOP, 0));
    const halfH = d * half;
    const halfW = halfH * (vw / vh);
    // a little above the point, looking slightly down, like a customer at the counter
    const pos = focus.clone().add(new THREE.Vector3(0, d * 0.12, d));
    const look = new THREE.Vector3(focus.x - cx * halfW, focus.y - cy * halfH, focus.z);
    const k = this.placed ? 1 - Math.exp(-dt * 5) : 1;
    this.camAt.lerp(pos, k);
    this.camLook.lerp(look, k);
    if (!this.placed) {
      this.camAt.copy(pos);
      this.camLook.copy(look);
      this.placed = true;
    }
    this.cam.position.copy(this.camAt);
    this.cam.lookAt(this.camLook);
  }

  dispose(): void {
    this.offFrame();
    this.character.dispose();
    this.built.dispose();
    this.cam.position.copy(this.camBefore.position);
    this.cam.quaternion.copy(this.camBefore.quaternion);
  }
}
