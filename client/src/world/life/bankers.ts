// The cage's bankers, one at each teller window in a navy blazer. "Press E · Bank" at a window:
// the banker turns to you, greets you by name with a nod and an open hand ("Good evening, Jaden."),
// and the bank's sheet opens beside them, so you watch them work: a top-up is nodded through and
// counted out onto the counter ("Here's your $40,000.01. Good luck out there."), a refusal gets a
// shake of the head. Between customers they count the drawer now and then and look up at whoever
// comes near.
//
// While the sheet is up the camera stands at the window, the banker on the left of the view and
// the sheet on the right (wide screens), and it eases back behind you when you leave.

import * as THREE from 'three';
import type { Cents } from '../../../../shared/src/money.ts';
import type { Spot } from '../interact.ts';
import type { Member } from './crew.ts';
import type { LifeCtx } from './ctx.ts';
import { bankerBye, bankerHello, bankerPaid, bankerRefused } from './lines.ts';
import { lerpAngle, smooth } from './rounds.ts';

/** A window's prompt shows within this of where its customer stands (m). */
const REACH = 1.3;
/** How much of the counter's front each window answers for (the windows are 2.6 m apart). */
const WINDOW = 1.6;
/** The banker's body turns at most this far toward you (rad); the head does the rest. */
const TURN = 0.55;
/** Seconds between the greeting and the sheet (long enough to see who's talking). */
const SHEET_AFTER = 0.35;
/** The camera's move to the window and back (s). */
const FLY_IN = 0.8;
const FLY_OUT = 0.6;

export type BankEvent = { kind: 'loan'; amount: Cents } | { kind: 'refused' };

interface Teller {
  m: Member;
  home: { x: number; z: number; yaw: number };
  customer: { x: number; z: number; yaw: number };
  /** The window on the counter's front. */
  front?: { x: number; z: number };
  /** Seconds until they next count the drawer. */
  idle: number;
}

export class Bankers {
  readonly tellers: Teller[] = [];
  /** The window you're at (from E until you close the sheet). */
  private serving: Teller | null = null;
  private pending = 0;
  private open: (() => void) | null = null;
  private n = 0;
  private fly: { from: THREE.Vector3; fromAt: THREE.Vector3; to: THREE.Vector3; toAt: THREE.Vector3; t: number; dur: number; back: boolean } | null = null;
  private readonly at = new THREE.Vector3();

  constructor(
    private readonly ctx: LifeCtx,
    /** Opens the bank's sheet (the cashier's own E). */
    private readonly useCashier: () => void,
  ) {
    for (const [i, w] of ctx.points.bank.windows.slice(0, 3).entries()) {
      const m = ctx.crew.add('banker', w.banker.x, w.banker.z, w.banker.yaw);
      this.tellers.push({ m, home: w.banker, customer: w.customer, front: w.front, idle: 9 + i * 7 });
    }
  }

  /**
   * "Bank" at each window with a banker: anywhere in front of the window's stretch of the counter
   * (its nearest point), so walking up to the cage anywhere near a window finds it.
   */
  spots = (p: { x: number; z: number }): Spot[] => {
    const out: Spot[] = [];
    for (const [i, t] of this.tellers.entries()) {
      const f = t.front ?? { x: (t.customer.x + t.home.x) / 2, z: (t.customer.z + t.home.z) / 2 };
      // the customers' side of the counter only (the cage runs along the north wall)
      if (p.z < f.z - 0.05) continue;
      const x = Math.max(f.x - WINDOW / 2, Math.min(f.x + WINDOW / 2, p.x));
      const d = Math.max(0, Math.hypot(x - p.x, f.z - p.z) - 0.45);
      if (d > REACH) continue;
      out.push({ key: `bank:${i}`, x, z: f.z, d, label: 'Bank', use: () => this.visit(t) });
    }
    return out;
  };

  /** Greet, then open the sheet. */
  visit(t: Teller): void {
    this.serving = t;
    const name = this.ctx.app()?.name() ?? null;
    this.ctx.speech.say(t.m.ch.root, bankerHello(name, new Date().getHours(), this.n++), 'Banker');
    this.ctx.crew.play(t.m, 'greet');
    this.pending = SHEET_AFTER;
    this.open = () => {
      this.useCashier();
      // the sheet stands beside the banker, not over them (wide screens; life.css)
      document.querySelector('.bank-sheet')?.closest('.sheet-scrim')?.classList.add('at-window');
      this.flyTo(t);
    };
  }

  /** What happened in the sheet: the banker's answer. */
  react(e: BankEvent): void {
    const t = this.serving ?? this.nearest();
    if (!t) return;
    if (e.kind === 'loan') {
      this.ctx.crew.play(t.m, 'nod');
      // then the notes, counted out onto the counter
      const say = bankerPaid(e.amount, this.n++);
      setTimeout(() => {
        this.ctx.crew.play(t.m, 'count');
        this.ctx.speech.say(t.m.ch.root, say, 'Banker', 2.02, 5.5);
      }, 850);
    } else {
      this.ctx.crew.play(t.m, 'shake');
      this.ctx.speech.say(t.m.ch.root, bankerRefused(this.n++), 'Banker');
    }
  }

  /** The sheet closed: a goodbye, and the camera back behind you. */
  left(): void {
    const t = this.serving;
    this.serving = null;
    if (t) this.ctx.speech.say(t.m.ch.root, bankerBye(this.n++), 'Banker', 2.02, 2.4);
    if (this.fly || this.flown) {
      this.ctx.player.character.root.visible = true;
      const cam = this.ctx.camera;
      const from = cam.position.clone();
      const fromAt = from.clone().add(cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(2));
      this.fly = { from, fromAt, to: from, toAt: fromAt, t: 0, dur: FLY_OUT, back: true };
    }
    this.flown = false;
  }

  private flown = false;

  update(dt: number): void {
    if (this.pending > 0) {
      this.pending -= dt;
      if (this.pending <= 0) {
        this.open?.();
        this.open = null;
      }
    }
    const me = this.ctx.player.position;
    for (const t of this.tellers) {
      const mine = this.serving === t || (this.pending > 0 && this.serving === t);
      let want = t.home.yaw;
      if (mine) {
        const toward = Math.atan2(me.x - t.home.x, me.z - t.home.z);
        const d = Math.atan2(Math.sin(toward - t.home.yaw), Math.cos(toward - t.home.yaw));
        want = t.home.yaw + Math.max(-TURN, Math.min(TURN, d));
        t.m.look = this.at.set(me.x, 1.5, me.z).clone();
      } else {
        t.m.look = null;
        // between customers, the drawer counted now and then
        t.idle -= dt;
        if (t.idle <= 0) {
          t.idle = 16 + ((this.n++ * 13) % 17);
          this.ctx.crew.play(t.m, 'count');
        }
      }
      t.m.yaw = lerpAngle(t.m.yaw, want, 1 - Math.exp(-dt * 5));
      t.m.x = t.home.x;
      t.m.z = t.home.z;
      t.m.motion = 0;
    }
  }

  /** After the walker has placed the camera: the camera at the window, or on its way back. */
  late(dt: number): void {
    const f = this.fly;
    if (!f) return;
    const cam = this.ctx.camera;
    f.t = Math.min(1, f.t + dt / f.dur);
    const k = smooth(f.t);
    if (f.back) {
      // from the window back to wherever the walker has put the camera this frame
      const to = cam.position.clone();
      const toAt = to.clone().add(cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(2));
      cam.position.lerpVectors(f.from, to, k);
      cam.lookAt(this.at.lerpVectors(f.fromAt, toAt, k));
    } else {
      cam.position.lerpVectors(f.from, f.to, k);
      cam.lookAt(this.at.lerpVectors(f.fromAt, f.toAt, k));
    }
    if (f.t >= 1 && f.back) this.fly = null;
  }

  /** The camera to the window: behind your shoulder, the banker on the left of the view. */
  private flyTo(t: Teller): void {
    const cam = this.ctx.camera as THREE.PerspectiveCamera;
    // wide screens only: on a narrow one the sheet covers the view anyway
    if (cam.aspect < 1.25) return;
    const c = t.customer;
    const fx = Math.sin(c.yaw);
    const fz = Math.cos(c.yaw);
    const to = new THREE.Vector3(c.x - fx * 1.25 + fz * 0.35, 1.62, c.z - fz * 1.25 - fx * 0.35);
    const head = new THREE.Vector3(t.home.x, 1.62, t.home.z);
    // turn the view right of the banker, so they stand a quarter in from the left edge
    const dir = head.clone().sub(to).normalize();
    const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect);
    const off = Math.atan(0.46 * Math.tan(half));
    const turned = dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), -off);
    const toAt = to.clone().addScaledVector(turned, 2).setY(1.42);
    const from = cam.position.clone();
    const fromAt = from.clone().add(cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(2));
    this.fly = { from, fromAt, to, toAt, t: 0, dur: FLY_IN, back: false };
    this.flown = true;
    // your own avatar would stand in the middle of that view (as at a table, it steps out of it)
    this.ctx.player.character.root.visible = false;
  }

  private nearest(): Teller | null {
    const me = this.ctx.player.position;
    let best: Teller | null = null;
    let d = 4;
    for (const t of this.tellers) {
      const dd = Math.hypot(t.customer.x - me.x, t.customer.z - me.z);
      if (dd < d) {
        d = dd;
        best = t;
      }
    }
    return best;
  }
}
