// The boutique's showroom: your character on a turntable in a small room of its own, drawn by the
// game's one renderer the way the character editor's dressing room is. The room is built far
// below the floor, out of every other view; the camera is borrowed while the boutique is open and
// put back when it closes. The camera moves in to whatever is on show: the chest for a chain, the
// mouth for a grill, the left wrist for a watch, the whole figure for clothes and rides.
//
// v6: it also previews what isn't worn. An emote is acted out (the character's gesture, when it
// has one); an effect changes the room's light (a follow spot, a disco, gold light) and drops
// what it drops (confetti, bills, sparks, coins) round the plinth; the statue is you, cast in gold.

import * as THREE from 'three';
import type { Look } from '../../../../shared/src/look.ts';
import type { ItemKind } from '../../../../shared/src/items.ts';
import type { EmoteId } from '../../../../shared/src/protocol.ts';
import type { Character, CharacterFactory } from '../../world/contract.ts';
import type { EngineLike } from '../menu/deps.ts';
import { calmScale, fewer } from '../../app/comfort.ts';

export type Framing = 'full' | 'chest' | 'face' | 'head' | 'wrist' | 'hand';

/** Where the camera looks (character frame, facing the camera at yaw 0), how much height it frames, and which way the figure turns to show it. */
const FRAMES: Record<Framing, { at: [number, number, number]; height: number; yaw: number; sway: number }> = {
  full: { at: [0, 0.97, 0], height: 2.15, yaw: -0.35, sway: 0 },
  chest: { at: [0, 1.43, 0.13], height: 0.62, yaw: -0.25, sway: 0.5 },
  // (v7.2: wider on the small pieces, so a pose, a body or a height never leaves them out of shot)
  face: { at: [0, 1.62, 0.2], height: 0.38, yaw: -0.3, sway: 0.45 },
  head: { at: [0, 1.7, 0.12], height: 0.62, yaw: -0.4, sway: 0.45 },
  wrist: { at: [0.26, 1.02, 0.06], height: 0.5, yaw: -1.25, sway: 0.35 },
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
function room(at: THREE.Vector3): { group: THREE.Group; pivot: THREE.Group; vitrine: THREE.Group; mood(m: Mood, t: number): void; dispose(): void } {
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

  // v6: the effects' lights, off until a preview wants them
  const spot = new THREE.SpotLight('#fff6e8', 0, 9, 0.2, 0.35, 1.2);
  spot.position.set(0, 5.2, 0.4);
  spot.target.position.set(0, 0.6, 0);
  const gold = new THREE.PointLight('#ffb640', 0, 8, 1.2);
  gold.position.set(0.9, 2.2, 1.6);
  const disco = ['#ff3d6e', '#3ddcff', '#b36bff', '#ffd23d'].map((c) => {
    const l = new THREE.PointLight(c, 0, 6, 1.5);
    group.add(l);
    return l;
  });
  // a mirror ball over the plinth, for the disco
  const ball = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.2, 2),
    new THREE.MeshStandardMaterial({ color: '#d8dde4', metalness: 1, roughness: 0.08, flatShading: true, emissive: '#1c2028' }),
  );
  ball.position.set(0, 2.3, -0.2);
  ball.visible = false;
  // the follow spot's beam through the haze, and its pool on the plinth
  const beamMat = new THREE.MeshBasicMaterial({ color: '#fff1d6', transparent: true, opacity: 0.075, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.7, 5.2, 48, 1, true), beamMat);
  beam.position.set(0, PODIUM_TOP + 2.6, 0);
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(0.62, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#fff0d0', transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  pool.position.y = PODIUM_TOP + 0.003;
  beam.visible = pool.visible = false;
  group.add(spot, spot.target, gold, ball, beam, pool);

  // the private collection's vitrine: a glass cylinder on the plinth, brass rings top and foot, a
  // cap, and a streak of reflected light down the glass so it reads as glass from every side
  const vitrine = new THREE.Group();
  const brass = new THREE.MeshStandardMaterial({ color: '#c9a24b', metalness: 1, roughness: 0.28 });
  const glassMat = new THREE.MeshStandardMaterial({ color: '#9fb6be', transparent: true, opacity: 0.05, roughness: 0.04, metalness: 0.2, depthWrite: false, side: THREE.DoubleSide });
  const H = 2.3;
  const R = 0.6;
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 72, 1, true), glassMat);
  glass.position.y = PODIUM_TOP + H / 2;
  const streakMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const streak = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.002, R + 0.002, H * 0.94, 12, 1, true, -0.55, 0.16), streakMat);
  streak.position.y = PODIUM_TOP + H / 2;
  const foot = new THREE.Mesh(new THREE.TorusGeometry(R, 0.018, 10, 96), brass);
  foot.rotation.x = Math.PI / 2;
  foot.position.y = PODIUM_TOP + 0.018;
  const top = foot.clone();
  top.position.y = PODIUM_TOP + H;
  const cap = new THREE.Mesh(new THREE.CircleGeometry(R, 72).rotateX(Math.PI / 2), glassMat);
  cap.position.y = PODIUM_TOP + H;
  vitrine.add(glass, streak, foot, top, cap);
  vitrine.visible = false;
  group.add(vitrine);
  const base = { key: key.intensity, rim: rim.intensity, fill: fill.intensity };

  return {
    group,
    pivot,
    vitrine,
    mood(m: Mood, clock: number) {
      // calm (app/comfort.ts): the disco's lights and ball turn at a third of the pace
      const t = clock * calmScale(1 / 3);
      const dim = m === 'spot' ? 0.12 : m === 'disco' ? 0.18 : m === 'gold' ? 0.55 : m === 'vault' ? 0.45 : 1;
      key.intensity = base.key * dim;
      rim.intensity = base.rim * (m === 'gold' ? 0.9 : dim);
      fill.intensity = base.fill * dim;
      spot.intensity = m === 'spot' ? 140 : m === 'vault' ? 70 : 0;
      gold.intensity = m === 'gold' ? 60 : 0;
      ball.visible = m === 'disco';
      beam.visible = m === 'spot';
      pool.visible = m === 'spot' || m === 'vault';
      ball.rotation.y = t * 0.8;
      disco.forEach((l, i) => {
        const a = t * 1.3 + (i * Math.PI) / 2;
        l.intensity = m === 'disco' ? 22 : 0;
        l.position.set(Math.cos(a) * 1.6, 1.2 + Math.sin(t * 2 + i) * 0.6, Math.sin(a) * 1.6);
      });
    },
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

/** The room's light for an effect's preview. */
export type Mood = 'none' | 'spot' | 'disco' | 'gold' | 'vault';

/** What falls or flies round the plinth in an effect's preview. */
export type Shower = 'confetti' | 'bills' | 'sparks' | 'coins';

const SHOWER_COUNT: Record<Shower, number> = { confetti: 260, bills: 70, sparks: 220, coins: 90 };
const SHOWER_COLORS: Record<Shower, string[]> = {
  confetti: ['#f2c14e', '#e8a531', '#c8242f', '#f4e3b0', '#b01d2a'],
  bills: ['#b9c9a4', '#a8bb91', '#c6d3b3'],
  sparks: ['#fff3c4', '#ffd98a', '#ffffff'],
  coins: ['#e0b84a', '#f2cf6b', '#c99a2e'],
};

/** Particles for a preview: one instanced mesh, moved on the CPU (a few hundred at most). */
class Particles {
  readonly mesh: THREE.InstancedMesh;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly spin: Float32Array;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(readonly kind: Shower) {
    const n = SHOWER_COUNT[kind];
    const geo =
      kind === 'coins' ? new THREE.CylinderGeometry(0.03, 0.03, 0.005, 18)
      : kind === 'bills' ? new THREE.PlaneGeometry(0.16, 0.068)
      : kind === 'sparks' ? new THREE.PlaneGeometry(0.018, 0.018)
      : new THREE.PlaneGeometry(0.035, 0.022);
    const mat =
      kind === 'sparks' ? new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      : kind === 'coins' ? new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.85, roughness: 0.3 })
      : new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.spin = new Float32Array(n * 3);
    const colors = SHOWER_COLORS[kind];
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      this.mesh.setColorAt(i, c.set(colors[i % colors.length]!));
      this.reset(i, true);
    }
  }

  private reset(i: number, first: boolean): void {
    const p = this.pos;
    const v = this.vel;
    const j = i * 3;
    if (this.kind === 'sparks') {
      // six fountains in a ring round the plinth
      const a = ((i % 6) / 6) * Math.PI * 2 + 0.3;
      p[j] = Math.cos(a) * 0.95;
      p[j + 1] = 0.05;
      p[j + 2] = Math.sin(a) * 0.95;
      v[j] = (Math.random() - 0.5) * 0.5;
      v[j + 1] = 2.4 + Math.random() * 1.4;
      v[j + 2] = (Math.random() - 0.5) * 0.5;
      if (first) p[j + 1] = -Math.random() * 3; // staggered: they start below and wait their turn
    } else {
      const r = 0.25 + Math.sqrt(Math.random()) * 0.9;
      const a = Math.random() * Math.PI * 2;
      p[j] = Math.cos(a) * r;
      p[j + 1] = first ? Math.random() * 3.2 : 3.2 + Math.random() * 0.6;
      p[j + 2] = Math.sin(a) * r;
      v[j] = (Math.random() - 0.5) * 0.2;
      v[j + 1] = this.kind === 'coins' ? -1.6 - Math.random() : this.kind === 'bills' ? -0.35 - Math.random() * 0.2 : -0.5 - Math.random() * 0.3;
      v[j + 2] = (Math.random() - 0.5) * 0.2;
    }
    this.spin[j] = Math.random() * 6;
    this.spin[j + 1] = Math.random() * 6;
    this.spin[j + 2] = Math.random() * 6;
  }

  update(dt: number, t: number): void {
    // calm (app/comfort.ts): a third of them
    const n = fewer(SHOWER_COUNT[this.kind]);
    this.mesh.count = n;
    const p = this.pos;
    const v = this.vel;
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      if (this.kind === 'sparks') {
        if (p[j + 1]! < 0) {
          p[j + 1]! += dt * 3;
          if (p[j + 1]! >= 0) this.reset(i, false);
          this.m.makeScale(0, 0, 0);
          this.mesh.setMatrixAt(i, this.m);
          continue;
        }
        v[j + 1]! -= 5.5 * dt;
      } else if (this.kind !== 'coins') {
        // paper flutters: a sideways sway as it falls
        p[j]! += Math.sin(t * 2.2 + i) * dt * 0.25;
      }
      p[j]! += v[j]! * dt;
      p[j + 1]! += v[j + 1]! * dt;
      p[j + 2]! += v[j + 2]! * dt;
      if (p[j + 1]! < 0.02) this.reset(i, false);
      const s = this.spin;
      this.e.set(s[j]! + t * (1.5 + (i % 5)), s[j + 1]! + t * 2, s[j + 2]!);
      this.q.setFromEuler(this.e);
      this.v.set(p[j]!, p[j + 1]!, p[j + 2]!);
      this.m.compose(this.v, this.q, this.one);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

/** The statue's gold: brushed, warm, catching the key and the rim. */
function statueGold(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#a8843a', metalness: 0.85, roughness: 0.46, emissive: '#2a1c06', emissiveIntensity: 0.2 });
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
  private mood: Mood = 'none';
  private cased = false;
  private shower: Particles | null = null;
  private gold: THREE.MeshStandardMaterial | null = null;
  /** The materials the character wore before it was cast in gold. */
  private readonly worn = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

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

  /** v6: an effect's preview: the room's light and what falls round the plinth (null: nothing). */
  preview(mood: Mood, shower: Shower | null): void {
    this.mood = mood;
    if (this.shower?.kind !== shower) {
      this.shower?.dispose();
      this.shower = shower ? new Particles(shower) : null;
      if (this.shower) this.built.group.add(this.shower.mesh);
    }
  }

  /**
   * v6: a piece of the private collection stands in a glass case, lit from above. A close-up (a
   * chain, a crown) puts the camera inside the glass, so there it keeps only the light.
   */
  vitrine(on: boolean): void {
    this.cased = on;
  }

  /** v6: cast the figure in gold (the statue's preview), or give it its own clothes back. */
  gilded(on: boolean): void {
    if (on) {
      this.gold ??= statueGold();
      return;
    }
    for (const [mesh, mat] of this.worn) mesh.material = mat;
    this.worn.clear();
    this.gold?.dispose();
    this.gold = null;
  }

  /** v6: act out an emote, if the character can; false if it can't. */
  gesture(e: EmoteId): boolean {
    if (!this.character.gesture) return false;
    this.character.gesture(e);
    return true;
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
    // the model can fill in after a look change, so the gold goes on every frame it's wanted
    if (this.gold) {
      const gold = this.gold;
      this.character.root.traverse((o) => {
        const m = o as THREE.Mesh;
        // (the contact shadow under the feet is a see-through card: it stays a shadow)
        if (!m.isMesh || m.material === gold || (m.material as THREE.Material).transparent) return;
        this.worn.set(m, m.material);
        m.material = gold;
      });
    }
    this.built.vitrine.visible = this.cased && this.framing === 'full';
    this.built.mood(this.mood === 'none' && this.cased ? 'vault' : this.mood, this.clock);
    this.shower?.update(dt, this.clock);
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
    this.gilded(false);
    this.shower?.dispose();
    this.character.dispose();
    this.built.dispose();
    this.cam.position.copy(this.camBefore.position);
    this.cam.quaternion.copy(this.camBefore.quaternion);
  }
}
