// Walking up to things. The nearest station within 1.6 m in front of the player gets a prompt
// ("Press E · Blackjack · $5–$5,000"); E sits down there: the camera flies to the game's play pose
// and onEnter fires. Leaving (Esc, or exitTable() from the app) flies back behind the player.
// The cashier works the same way but only fires onCashier; the app opens the bank over the floor.

import * as THREE from 'three';
import { el } from '../ui/kit.ts';
import type { Player } from './player.ts';
import type { WorldStation } from './stations.ts';
import { playPoseWorld } from './stations.ts';
import type { CashierPoint } from './contract.ts';

const REACH = 1.6;
const FLY_IN = 0.9;
const FLY_OUT = 0.75;

type Target = { kind: 'station'; station: WorldStation; d: number } | { kind: 'cashier'; d: number };

export class Interact {
  private prompt = el('div', 'world-prompt');
  private enterCbs = new Set<(s: WorldStation) => void>();
  private cashierCbs = new Set<() => void>();
  private current: Target | null = null;
  seated: WorldStation | null = null;
  private fly: { from: THREE.Vector3; fromT: THREE.Vector3; to: THREE.Vector3; toT: THREE.Vector3; t: number; dur: number; done: () => void } | null = null;
  private readonly look = new THREE.Vector3();

  constructor(
    private readonly stations: WorldStation[],
    private readonly cashier: CashierPoint,
    private readonly player: Player,
    private readonly camera: THREE.PerspectiveCamera,
    ui: HTMLElement,
    private readonly onEscape: (() => void) | undefined,
  ) {
    this.prompt.hidden = true;
    this.prompt.setAttribute('role', 'status');
    ui.append(this.prompt);
    addEventListener('keydown', this.onKey);
  }

  onEnter(cb: (s: WorldStation) => void): () => void {
    this.enterCbs.add(cb);
    return () => this.enterCbs.delete(cb);
  }

  onCashier(cb: () => void): () => void {
    this.cashierCbs.add(cb);
    return () => this.cashierCbs.delete(cb);
  }

  /** The station the player would enter with E right now (null when none). */
  get focus(): WorldStation | null {
    return this.current?.kind === 'station' ? this.current.station : null;
  }

  update(dt: number): void {
    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + dt / f.dur);
      const k = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
      this.camera.position.lerpVectors(f.from, f.to, k);
      this.look.lerpVectors(f.fromT, f.toT, k);
      this.camera.lookAt(this.look);
      if (f.t >= 1) {
        this.fly = null;
        f.done();
      }
      return;
    }
    if (this.seated || !this.player.isEnabled) {
      this.show(null);
      return;
    }
    this.show(this.pick());
  }

  /** Sit down at a station: fly the camera in and tell the app. */
  enter(s: WorldStation, seat: number | null = null): void {
    if (this.seated) return;
    this.seated = s;
    this.show(null);
    this.player.setEnabled(false);
    this.player.character.root.visible = false;
    const pose = playPoseWorld(s, seat);
    this.flyTo(pose.position, pose.target, FLY_IN, () => {});
    for (const cb of this.enterCbs) cb(s);
  }

  /** Leave the table: fly back behind the player and hand the controls back. */
  exit(): Promise<void> {
    if (!this.seated) return Promise.resolve();
    this.seated = null;
    this.player.character.root.visible = true;
    const back = this.player.followPose();
    return new Promise((resolve) =>
      this.flyTo(back.position, back.target, FLY_OUT, () => {
        this.player.setEnabled(true);
        resolve();
      }),
    );
  }

  dispose(): void {
    removeEventListener('keydown', this.onKey);
    this.prompt.remove();
  }

  private flyTo(to: THREE.Vector3, toT: THREE.Vector3, dur: number, done: () => void): void {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const from = this.camera.position.clone();
    const fromT = from.clone().addScaledVector(dir, from.distanceTo(toT));
    this.fly = { from, fromT, to: to.clone(), toT: toT.clone(), t: 0, dur, done };
  }

  /** The closest thing within reach and roughly in front of the player. */
  private pick(): Target | null {
    const p = this.player.position;
    const fx = Math.sin(this.player.heading);
    const fz = Math.cos(this.player.heading);
    let best: Target | null = null;
    const consider = (qx: number, qz: number, d: number, t: Target) => {
      if (d > REACH) return;
      const dx = qx - p.x;
      const dz = qz - p.z;
      const len = Math.hypot(dx, dz);
      // in front: within about 75 degrees of where the player faces (or practically touching)
      if (len > 0.35 && (dx * fx + dz * fz) / len < 0.26) return;
      if (!best || d < best.d) best = t;
    };
    for (const s of this.stations) {
      const a = s.anchor.position;
      const c = Math.cos(s.yaw);
      const sn = Math.sin(s.yaw);
      const rx = p.x - a.x;
      const rz = p.z - a.z;
      const lx = rx * c - rz * sn;
      const lz = rx * sn + rz * c;
      const hx = s.footprint.width / 2;
      const hz = s.footprint.depth / 2;
      const qx = Math.max(-hx, Math.min(hx, lx));
      const qz = Math.max(-hz, Math.min(hz, lz));
      const d = Math.hypot(lx - qx, lz - qz);
      // nearest point back in world space
      const wx = a.x + qx * c + qz * sn;
      const wz = a.z - qx * sn + qz * c;
      consider(wx, wz, d, { kind: 'station', station: s, d });
    }
    const cd = Math.max(0, Math.hypot(p.x - this.cashier.position.x, p.z - this.cashier.position.z) - 0.6);
    consider(this.cashier.position.x, this.cashier.position.z - 0.6, cd, { kind: 'cashier', d: cd });
    return best;
  }

  private show(t: Target | null): void {
    const same = t && this.current && t.kind === this.current.kind && (t.kind === 'cashier' || (this.current.kind === 'station' && t.station === this.current.station));
    this.current = t;
    if (same) return;
    this.prompt.replaceChildren();
    if (!t) {
      this.prompt.hidden = true;
      return;
    }
    const parts = t.kind === 'cashier' ? ['Cashier'] : [t.station.name, t.station.limits].filter(Boolean);
    this.prompt.append('Press ', el('span', 'world-key', 'E'), ...parts.map((x) => ` · ${x}`));
    this.prompt.hidden = false;
  }

  private onKey = (e: KeyboardEvent): void => {
    const tgt = e.target as HTMLElement | null;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
    if (e.code === 'KeyE' && !e.repeat && !this.seated && !this.fly && this.player.isEnabled && this.current) {
      e.preventDefault();
      if (this.current.kind === 'station') this.enter(this.current.station);
      else for (const cb of this.cashierCbs) cb();
      return;
    }
    if (e.code === 'Escape' && this.seated && !this.fly) {
      if (this.onEscape) this.onEscape();
      else void this.exit();
    }
  };
}
