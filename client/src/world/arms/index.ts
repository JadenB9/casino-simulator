// v7: guns in hand. V draws the gun you own (v7.4: a choice of them when you own several, and V
// again puts it away; one bought is in your hand at once); drawn, you face where you look and a left click fires (held, an automatic keeps firing),
// the rounds count down and it reloads itself when it's empty. A shot is played at once where you
// are (the kick, the flash, the tracer, the bang) and sent to the floor, which decides what it hit
// (server/src/floor/street.ts): everyone sees your shot and whoever it knocks down. Nobody is hurt.
// In the casino security hears every shot. In the gun store's range the targets take the hits.

import * as THREE from 'three';
import { GUNS, gunItem, type GunItem } from '../../../../shared/src/arms.ts';
import type { FloorServerMsg } from '../../../../shared/src/protocol.ts';
import { RANGE, STORES } from '../../../../shared/src/stores.ts';
import { byteToYaw, yawToByte, type FloorLink } from '../../net/presence.ts';
import { el, toast } from '../../ui/kit.ts';
import { isTyping, overlayCount } from '../../ui/keyboard.ts';
import { calm } from '../../app/comfort.ts';
import type { Sfx } from '../../audio/sfx.ts';
import type { FloorWorld } from '../index.ts';
import type { Person } from '../characters.ts';
import { StreetSounds } from '../drive/sound.ts';
import { disposeGun, gunModel, holdOf } from './models.ts';
import './arms.css';
import { openPicker } from '../../ui/hud/picker.ts';

export interface ArmsDeps {
  engine: { scene: THREE.Scene; camera: THREE.PerspectiveCamera; canvas: HTMLElement; onFrame(fn: (dt: number) => void): () => void };
  world: FloorWorld;
  link: () => FloorLink | null;
  owned: () => readonly string[];
  ui: HTMLElement;
  sfx: Sfx;
  /** Out walking with nothing open (not at a table, not driving). */
  free: () => boolean;
  /** Another player's character. */
  character: (id: number) => Person | undefined;
  /** Knock down someone who isn't a player: a guard (StaffId) or an inmate ('i0'..). */
  knockNpc: (id: string) => void;
}

interface Tracer {
  mesh: THREE.Mesh;
  t: number;
}

const TRACER_S = 0.09;

export class Arms {
  private gun: GunItem | null = null;
  private model: THREE.Group | null = null;
  private rounds = 0;
  private reloadUntil = 0;
  private lastShot = 0;
  private trigger = false;
  private readonly tracers: Tracer[] = [];
  private readonly tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.2, 1.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly flashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4, 1.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly remote = new Map<number, { gun: string; model: THREE.Group }>();
  private readonly sounds: StreetSounds;
  private readonly cross = el('div', 'arms-cross');
  private readonly ammo = el('div', 'arms-ammo panel');
  private readonly gunBtn = el('button', 'arms-touch arms-gun', 'Gun');
  private readonly fireBtn = el('button', 'arms-touch arms-fire', 'Fire');
  private readonly offs: (() => void)[] = [];
  private readonly _v = new THREE.Vector3();
  /** Range targets knocked flat (lane index -> seconds left down). */
  private readonly targets = new Map<number, number>();
  private readonly targetMeshes: THREE.Mesh[] = [];

  constructor(private readonly d: ArmsDeps) {
    this.sounds = new StreetSounds(d.sfx);
    this.cross.hidden = true;
    this.ammo.hidden = true;
    // v7.1: on a touch screen, a Gun button (draw, next, put away) and a Fire button to hold
    this.gunBtn.type = 'button';
    this.fireBtn.type = 'button';
    this.gunBtn.hidden = true;
    this.fireBtn.hidden = true;
    this.gunBtn.addEventListener('click', () => this.toggle());
    this.fireBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!this.gun) return;
      this.fire();
      if (this.gun.auto) this.trigger = true;
    });
    this.fireBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    d.ui.append(this.cross, this.ammo, this.gunBtn, this.fireBtn);
    this.buildTargets();
    this.offs.push(d.world.walker.onClick(() => this.click(), 10));
    this.offs.push(d.engine.onFrame((dt) => this.update(dt)));
    addEventListener('keydown', this.onKey);
    d.engine.canvas.addEventListener('pointerdown', this.onDown);
    addEventListener('pointerup', this.onUp);
    addEventListener('blur', this.onUp);
  }

  /** The gun drawn, if any. */
  get drawn(): GunItem | null {
    return this.gun;
  }

  /** The floor's shots (everyone's, yours included) and the roster's guns. */
  hear(m: FloorServerMsg): void {
    if (m.t !== 'shot') return;
    const link = this.d.link();
    const me = link?.you?.id;
    if (m.id !== me) {
      const ch = this.d.character(m.id);
      const info = link?.players.get(m.id)?.info;
      const g = gunItem(info?.gun);
      if (ch) {
        ch.kick();
        const from = ch.muzzle(this._v) ?? ch.root.position.clone().setY(1.35);
        this.tracer(from, byteToYaw(m.r), m.d);
        this.flash(from);
        const cam = this.d.engine.camera.position;
        this.sounds.shot(g ? weight(g) : 0.5, Math.hypot(from.x - cam.x, from.z - cam.z));
      }
    }
    if (m.hit === null) return;
    // the one it hit goes down, a moment after the bang
    setTimeout(() => this.knock(m.hit!, m.id, m.r), 60);
  }

  private knock(hit: number | string, shooter: number, r: number): void {
    const me = this.d.link()?.you?.id;
    if (typeof hit === 'string') {
      this.d.knockNpc(hit);
      return;
    }
    if (hit === me) {
      const yaw = byteToYaw(r);
      this.d.world.walker.knock(Math.sin(yaw), Math.cos(yaw), 0.8);
      const who = this.d.link()?.players.get(shooter)?.info.name;
      toast(who ? `${who} shot you. You're down, not hurt.` : "You've been shot. You're down, not hurt.");
      return;
    }
    (this.d.character(hit)?.gesture as ((e: string) => void) | undefined)?.('knock');
  }

  // --- drawing and firing ----------------------------------------------------------------------

  // v7.4: V, and only V: out comes your gun (a choice of them when you own more than one), and
  // V again puts it away. Left click fires it.
  private onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'KeyV' || e.repeat || isTyping(e) || overlayCount() > 0 || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!this.d.free()) return;
    e.preventDefault();
    this.toggle();
  };

  /** V (or the touch Gun button): put the drawn gun away, or draw one: yours, or the one you pick. */
  toggle(): void {
    if (!this.d.free()) return;
    if (this.gun) {
      this.holster();
      return;
    }
    const mine = GUNS.filter((g) => this.d.owned().includes(g.id));
    if (!mine.length) {
      toast('No guns yet. Ace Arms across the street sells them.');
      return;
    }
    if (mine.length === 1) {
      this.draw(mine[0]!);
      return;
    }
    openPicker({
      root: this.d.ui,
      title: 'Your guns',
      subtitle: 'Pick one to draw. V puts it away again.',
      key: 'KeyV',
      rows: mine.map((g) => ({ id: g.id, name: g.name, note: `${g.mag} rounds${g.auto ? ', automatic' : ''}` })),
      pick: (id) => {
        const g = mine.find((x) => x.id === id);
        if (g && this.d.free()) this.draw(g);
      },
    });
  }

  draw(g: GunItem): void {
    this.holster(true);
    this.gun = g;
    this.rounds = g.mag;
    this.reloadUntil = 0;
    this.model = gunModel(g);
    const ch = this.d.world.player.character as unknown as Person;
    ch.holdGun(holdOf(g.model), this.model);
    this.d.world.walker.faceLook = true;
    this.d.link()?.send({ t: 'draw', gun: g.id });
    this.cross.hidden = false;
    this.paintAmmo();
  }

  holster(quiet = false): void {
    if (!this.gun) return;
    this.gun = null;
    this.trigger = false;
    const ch = this.d.world.player.character as unknown as Person;
    ch.holdGun(0, null);
    if (this.model) disposeGun(this.model);
    this.model = null;
    this.d.world.walker.faceLook = false;
    if (!quiet) this.d.link()?.send({ t: 'draw', gun: null });
    this.cross.hidden = true;
    this.ammo.hidden = true;
  }

  private click(): boolean {
    if (!this.gun) return false;
    if (!this.d.free()) return true;
    this.fire();
    return true;
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button === 0 && this.gun?.auto && this.d.world.walker.captured) this.trigger = true;
  };

  private onUp = (): void => {
    this.trigger = false;
  };

  private fire(): void {
    const g = this.gun!;
    const now = performance.now();
    if (now - this.lastShot < 1000 / g.rate) return;
    if (now < this.reloadUntil) return;
    if (this.rounds <= 0) {
      this.sounds.click();
      this.reload();
      return;
    }
    this.lastShot = now;
    this.rounds--;
    const w = this.d.world.walker;
    const look = w.aim;
    const ch = this.d.world.player.character as unknown as Person;
    ch.kick();
    const from = ch.muzzle(this._v)?.clone() ?? w.position.clone().setY(1.35);
    // how far the shot goes before a wall stops it (the floor says what it hits)
    const dir = { x: Math.sin(look.yaw), y: 0, z: Math.cos(look.yaw) };
    const wall = this.d.world.collider.raycast({ x: from.x, y: 1.3, z: from.z }, dir, g.range);
    const reach = Math.min(g.range, wall);
    this.tracer(from, look.yaw, reach);
    this.flash(from);
    this.sounds.shot(weight(g));
    if (!calm()) this.shakeCam(0.02 + 0.03 * weight(g));
    this.range(from, look.yaw, reach);
    this.d.link()?.send({ t: 'shoot', r: yawToByte(look.yaw) });
    this.paintAmmo();
    if (this.rounds === 0) this.reload();
  }

  private reload(): void {
    const g = this.gun;
    if (!g || performance.now() < this.reloadUntil) return;
    this.reloadUntil = performance.now() + g.reload * 1000;
    setTimeout(() => {
      if (this.gun !== g) return;
      this.rounds = g.mag;
      this.sounds.click();
      this.paintAmmo();
    }, g.reload * 1000);
    this.paintAmmo();
  }

  private paintAmmo(): void {
    const g = this.gun;
    if (!g) return;
    this.ammo.hidden = false;
    const reloading = performance.now() < this.reloadUntil;
    this.ammo.textContent = `${g.name} · ${reloading ? 'reloading' : `${this.rounds} / ${g.mag}`} · R next gun`;
  }

  private shake = 0;
  private shakeCam(k: number): void {
    this.shake = Math.max(this.shake, k);
  }

  // --- the look of it ----------------------------------------------------------------------------

  private tracer(from: THREE.Vector3, yaw: number, dist: number): void {
    const len = Math.max(0.5, dist);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, len), this.tracerMat);
    m.position.set(from.x + (Math.sin(yaw) * len) / 2, from.y, from.z + (Math.cos(yaw) * len) / 2);
    m.rotation.y = yaw;
    this.d.engine.scene.add(m);
    this.tracers.push({ mesh: m, t: TRACER_S });
  }

  private flash(at: THREE.Vector3): void {
    if (calm()) return;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), this.flashMat);
    m.position.copy(at);
    this.d.engine.scene.add(m);
    this.tracers.push({ mesh: m, t: 0.05 });
  }

  // --- the range's targets -----------------------------------------------------------------------

  private buildTargets(): void {
    const geo = new THREE.BoxGeometry(0.03, 0.9, 0.55);
    const face = new THREE.MeshLambertMaterial({ color: '#efe6d2', emissive: '#2a2418' });
    for (const z of RANGE.lanes) {
      const m = new THREE.Mesh(geo, face);
      m.position.set(RANGE.x1 - 0.4, 1.35, z);
      m.name = 'range-target';
      this.targetMeshes.push(m);
      this.d.engine.scene.add(m);
    }
  }

  /** A shot in the gun store's range: the lane's target it crosses flips back. */
  private range(from: THREE.Vector3, yaw: number, reach: number): void {
    const s = STORES.guns.room;
    if (from.x < s.x0 || from.x > s.x1 || from.z < s.z0 || from.z > s.z1) return;
    const dx = Math.sin(yaw);
    if (dx <= 0.1) return;
    const t = (RANGE.x1 - 0.4 - from.x) / dx;
    if (t > reach + 12 || t < 0) return;
    const z = from.z + Math.cos(yaw) * t;
    RANGE.lanes.forEach((lz, i) => {
      if (Math.abs(z - lz) < 0.3) {
        this.targets.set(i, 1.2);
        this.sounds.click();
      }
    });
  }

  // --- every frame -------------------------------------------------------------------------------

  private update(dt: number): void {
    const world = this.d.world;
    // put it away for a table, a car, the menu
    if (this.gun && !this.d.free()) this.holster();
    const touch = document.documentElement.classList.contains('touch-ui') && this.d.free() && this.d.owned().some((id) => gunItem(id));
    if (this.gunBtn.hidden === touch) this.gunBtn.hidden = !touch;
    const fire = touch && !!this.gun;
    if (this.fireBtn.hidden === fire) this.fireBtn.hidden = !fire;
    this.gunBtn.textContent = this.gun ? 'Next gun' : 'Gun';
    if (this.gun) {
      const ch = world.player.character as unknown as Person;
      ch.aimGun(-world.walker.aim.pitch * 0.8);
      if (this.trigger && this.gun.auto) this.fire();
      if (this.reloadUntil && performance.now() > this.reloadUntil) {
        this.reloadUntil = 0;
        this.paintAmmo();
      }
    }
    if (this.shake > 0) {
      const cam = this.d.engine.camera;
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 0.4);
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]!;
      t.t -= dt;
      if (t.t > 0) continue;
      t.mesh.removeFromParent();
      t.mesh.geometry.dispose();
      this.tracers.splice(i, 1);
    }
    // the targets flip back and stand again
    this.targetMeshes.forEach((m, i) => {
      const left = this.targets.get(i) ?? 0;
      const want = left > 0 ? -1.3 : 0;
      m.rotation.z += (want - m.rotation.z) * Math.min(1, dt * 12);
      if (left > 0) this.targets.set(i, left - dt);
      m.visible = world.zone === 'ground';
    });
    // everyone else's drawn guns, in their hands
    const link = this.d.link();
    const seen = new Set<number>();
    for (const [id, p] of link?.players ?? []) {
      const g = gunItem(p.info.gun);
      const ch = this.d.character(id);
      if (!g || !ch) continue;
      seen.add(id);
      const had = this.remote.get(id);
      if (had?.gun === g.id) continue;
      if (had) disposeGun(had.model);
      const model = gunModel(g);
      ch.holdGun(holdOf(g.model), model);
      this.remote.set(id, { gun: g.id, model });
    }
    for (const [id, r] of [...this.remote]) {
      if (seen.has(id)) continue;
      this.d.character(id)?.holdGun(0, null);
      disposeGun(r.model);
      this.remote.delete(id);
    }
  }

  dispose(): void {
    this.holster(true);
    for (const off of this.offs) off();
    removeEventListener('keydown', this.onKey);
    this.d.engine.canvas.removeEventListener('pointerdown', this.onDown);
    removeEventListener('pointerup', this.onUp);
    removeEventListener('blur', this.onUp);
    for (const m of this.targetMeshes) m.removeFromParent();
    this.cross.remove();
    this.ammo.remove();
    this.gunBtn.remove();
    this.fireBtn.remove();
  }
}

/** How heavy a gun sounds and kicks, 0.3 .. 1. */
function weight(g: GunItem): number {
  return Math.min(1, 0.3 + g.kick * 0.3);
}
