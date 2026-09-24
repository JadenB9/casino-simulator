// Cocktail waiters: in a teal waistcoat with a tray on the left hand, each walking a round of the
// floor (routes.ts) timed by the shared clock, so everyone sees them in the same places: collecting a
// tray of drinks at the bar, setting one down at each stop, and back. They step round people in
// their way (a sidestep drawn on top of the round, which never changes its timing).
//
// Walk up to one and "Press E · Order a drink": they stop, turn to you and ask, and the bar's menu
// opens. An order paid for (from a waiter, the menu anywhere, or the counter) is brought over by
// the waiter who took it or the nearest free one: to the bar's pickup, the drink onto the tray when
// the bartender has it ready, to you (a seat, a sofa, wherever you stand), a hand held out, and it's
// yours (world.holdItem). Then back to their round. At a game table the drink waits at the bar until
// you stand up. Those walks are this screen's own: everyone else sees the waiter's round, and the
// drink in your hand once you have it.

import * as THREE from 'three';
import type { BarModel, BarOrder } from '../../../../shared/src/items.ts';
import { barItem } from '../../../../shared/src/items.ts';
import { overlayCount } from '../../ui/keyboard.ts';
import type { Spot } from '../interact.ts';
import type { Member } from './crew.ts';
import type { LifeCtx } from './ctx.ts';
import { TRAY } from './motions.ts';
import type { Pt } from './nav.ts';
import type { WaiterRound } from './routes.ts';
import { WAITER_SPEED, lerpAngle, smooth, type Round } from './rounds.ts';
import type { Trays } from './tray.ts';
import { waiterBrings, waiterNoted, waiterTakes } from './lines.ts';

/** The walk cycle's own pace (characters.ts): motion 1 is this many m/s. */
const WALK_CYCLE = 1.75;
const ACCEL = 1.4;
/** A waiter's E prompt shows within this (m). */
const REACH = 1.3;
/** How close to you a waiter stops to hand a drink over (m), and to someone in their way. */
const HAND_M = 1.0;
const AHEAD_M = 1.5;
const SIDESTEP = 0.55;
/** How long a waiter waits for you to pick from the menu before going back to work (s). */
const ATTEND_S = 45;

type Job =
  | { kind: 'attend'; t: number; order: BarOrder | null }
  | { kind: 'deliver'; order: BarOrder; ready: () => boolean; taken?: () => void; phase: 'bar' | 'wait' | 'guest' | 'hand' | 'back'; t: number; goal: Pt | null; handed: boolean; replan: number };

export interface Waiter {
  m: Member;
  round: Round;
  offset: number;
  tray: THREE.Mesh;
  load: string;
  job: Job | null;
  /** Walking a path of this screen's own (a job), with the speed got up to. */
  walk: { path: Pt[]; i: number; v: number } | null;
  /** A sidestep round someone, eased. */
  side: number;
  /** Easing back onto the round after a job: where from and how far through. */
  rejoin: { x: number; z: number; yaw: number; t: number } | null;
  served: string;
  said: number;
}

export class Waiters {
  readonly list: Waiter[] = [];
  private n = 0;

  constructor(
    private readonly ctx: LifeCtx,
    rounds: WaiterRound[],
    private readonly trays: Trays,
    parent: THREE.Object3D,
  ) {
    for (const r of rounds) {
      const s = r.round.at(ctx.now() + r.offset);
      const m = ctx.crew.add('waiter', s.x, s.z, s.heading);
      m.hold = TRAY;
      const tray = trays.mesh();
      parent.add(tray);
      this.list.push({ m, round: r.round, offset: r.offset, tray, load: '', job: null, walk: null, side: 0, rejoin: null, served: '', said: 0 });
    }
  }

  /** "Order a drink" at a waiter in reach who isn't carrying someone's order. */
  spots = (p: { x: number; z: number }): Spot[] => {
    const out: Spot[] = [];
    for (const [i, w] of this.list.entries()) {
      if (w.job?.kind === 'deliver' || !w.m.shown) continue;
      const d = Math.hypot(w.m.x - p.x, w.m.z - p.z) - 0.3;
      if (d > REACH) continue;
      out.push({ key: `waiter:${i}`, x: w.m.x, z: w.m.z, d: Math.max(0, d), label: 'Order a drink', use: () => this.attend(w) });
    }
    return out;
  };

  /** The waiter stops, turns to you and asks; the menu opens. */
  attend(w: Waiter): void {
    const app = this.ctx.app();
    if (!app) return;
    this.local(w);
    w.job = { kind: 'attend', t: 0, order: null };
    w.walk = null;
    this.ctx.speech.say(w.m.ch.root, waiterTakes(this.n++), 'Waiter');
    app.openBarMenu();
  }

  /** The waiter attending you now, if any (an order placed now is theirs). */
  attending(): Waiter | null {
    return this.list.find((w) => w.job?.kind === 'attend') ?? null;
  }

  /**
   * Bring `order` over: the waiter who took it, else the free one nearest the bar. `ready` says
   * when the bartender has it, `taken` hears it go onto the tray. False when every waiter is busy.
   */
  deliver(order: BarOrder, ready: () => boolean, taken?: () => void): boolean {
    const pickup = this.ctx.points.bar.pickup;
    let w = this.attending();
    if (!w) {
      let best = Infinity;
      for (const c of this.list) {
        if (c.job) continue;
        const d = Math.hypot(c.m.x - pickup.x, c.m.z - pickup.z);
        if (d < best) {
          best = d;
          w = c;
        }
      }
    }
    if (!w) return false;
    if (w.job?.kind === 'attend') this.ctx.speech.say(w.m.ch.root, waiterNoted(this.n++), 'Waiter');
    this.local(w);
    w.job = { kind: 'deliver', order, ready, taken, phase: 'bar', t: 0, goal: null, handed: false, replan: 0 };
    w.walk = this.pathTo(w, pickup);
    return true;
  }

  /** Every frame, before the crew draws them. */
  update(dt: number): void {
    const now = this.ctx.now();
    for (const w of this.list) {
      if (w.job) {
        this.work(w, dt, now);
      } else {
        this.follow(w, dt, now);
        this.avoid(w, dt);
      }
    }
  }

  /** After the crew has posed them: each tray onto its waiter's hand, level, with its load. */
  place(): void {
    const hand = new THREE.Vector3();
    const cam = this.ctx.camera.getWorldPosition(new THREE.Vector3());
    for (const w of this.list) {
      // a tray further off than this is a few pixels: not worth its draw call
      const near = Math.hypot(w.m.x - cam.x, w.m.z - cam.z) < TRAY_M;
      const shown = near && w.m.shown && w.m.poser.where('handL', hand) !== null;
      w.tray.visible = shown;
      if (!shown) continue;
      const fx = Math.sin(w.m.yaw);
      const fz = Math.cos(w.m.yaw);
      // the palm is a hand's length on from the wrist, the tray on it
      w.tray.position.set(hand.x + fx * TRAY_AHEAD - fz * TRAY_OUT, hand.y + TRAY_UP, hand.z + fz * TRAY_AHEAD + fx * TRAY_OUT);
      w.tray.rotation.set(0, w.m.yaw, 0);
      const load = this.loadOf(w);
      const key = load.join(',');
      if (key !== w.load) {
        w.load = key;
        w.tray.geometry = this.trays.geometry(load);
      }
    }
  }

  dispose(): void {
    for (const w of this.list) w.tray.removeFromParent();
  }

  // --- the round ------------------------------------------------------------------------------

  private follow(w: Waiter, dt: number, now: number): void {
    const s = w.round.at(now + w.offset);
    let x = s.x;
    let z = s.z;
    let yaw = s.heading;
    if (w.rejoin) {
      // back from a job: ease onto where the round has got to
      w.rejoin.t += dt / 0.6;
      const k = smooth(w.rejoin.t);
      x = w.rejoin.x + (x - w.rejoin.x) * k;
      z = w.rejoin.z + (z - w.rejoin.z) * k;
      yaw = lerpAngle(w.rejoin.yaw, yaw, k);
      if (w.rejoin.t >= 1) w.rejoin = null;
    }
    w.m.x = x;
    w.m.z = z;
    w.m.yaw = yaw;
    w.m.motion = s.speed / WALK_CYCLE;
    w.m.look = null;
    // a drink set down at each serving stop, once per visit
    if (s.stop?.kind === 'serve' && s.serving > 0) {
      const key = `${Math.floor((now + w.offset) / w.round.period)}:${s.stop.x}:${s.stop.z}`;
      if (key !== w.served) {
        w.served = key;
        this.ctx.crew.play(w.m, 'serve');
      }
    }
  }

  // --- a job of this screen's own ---------------------------------------------------------------

  private work(w: Waiter, dt: number, now: number): void {
    const job = w.job!;
    job.t += dt;
    const me = this.ctx.player.position;
    if (job.kind === 'attend') {
      this.face(w, me.x, me.z, dt);
      w.m.motion = 0;
      w.m.look = headOf(me);
      // the menu closed without an order (or it's been a long while): back to work
      if ((job.t > 1 && overlayCount() === 0) || job.t > ATTEND_S) this.back(w);
      return;
    }
    const app = this.ctx.app();
    // the drink's time ran out, or nobody's here to take it
    if (job.order.until <= now * 1000 || !app) {
      this.back(w);
      return;
    }
    switch (job.phase) {
      case 'bar':
        if (this.walk(w, dt)) {
          job.phase = 'wait';
          job.t = 0;
        }
        break;
      case 'wait': {
        const p = this.ctx.points.bar.pickup;
        this.face(w, p.x + Math.sin(p.yaw), p.z + Math.cos(p.yaw), dt);
        w.m.motion = 0;
        // onto the tray once the bartender has it, and off to you (not while you're at a table)
        if (job.ready() && job.t > 1.2 && !app.atTable()) {
          job.taken?.();
          job.phase = 'guest';
          job.goal = this.besideYou(w);
          w.walk = job.goal ? this.pathTo(w, job.goal) : null;
          if (!w.walk) this.back(w);
        }
        break;
      }
      case 'guest': {
        job.replan -= dt;
        // you've moved on: after you
        if (job.goal && job.replan <= 0 && Math.hypot(me.x - job.goal.x, me.z - job.goal.z) > HAND_M + 0.9) {
          job.replan = 0.6;
          job.goal = this.besideYou(w);
          w.walk = job.goal ? this.pathTo(w, job.goal) : null;
        }
        if (app.atTable()) {
          // sat down to play on the way: back to the bar to wait
          job.phase = 'bar';
          w.walk = this.pathTo(w, this.ctx.points.bar.pickup);
          break;
        }
        const close = Math.hypot(me.x - w.m.x, me.z - w.m.z) <= HAND_M + 0.15;
        if (!w.walk || this.walk(w, dt) || close) {
          w.walk = null;
          job.phase = 'hand';
          job.t = 0;
          this.ctx.crew.play(w.m, 'handOver');
        }
        break;
      }
      case 'hand':
        this.face(w, me.x, me.z, dt);
        w.m.motion = 0;
        w.m.look = headOf(me);
        if (!job.handed && job.t > 0.6) {
          job.handed = true;
          app.holdItem(job.order.id);
          const name = barItem(job.order.item)?.name.toLowerCase() ?? 'drink';
          this.ctx.speech.say(w.m.ch.root, waiterBrings(name, this.n++), 'Waiter');
        }
        if (job.t > 1.5) this.back(w);
        break;
      case 'back':
        this.walk(w, dt);
        break;
    }
  }

  /** Back to the round: walk to where it will have got to, then ease onto it. */
  private back(w: Waiter): void {
    const now = this.ctx.now();
    w.m.look = null;
    const here = { x: w.m.x, z: w.m.z };
    let t = now;
    let s = w.round.at(t + w.offset);
    for (let k = 0; k < 3; k++) {
      t = now + Math.hypot(s.x - here.x, s.z - here.z) / WAITER_SPEED + 0.8;
      s = w.round.at(t + w.offset);
    }
    const path = this.ctx.grid.path(here, s);
    if (!path || path.length < 2) {
      w.job = null;
      w.walk = null;
      w.rejoin = { x: w.m.x, z: w.m.z, yaw: w.m.yaw, t: 0 };
      return;
    }
    w.job = { kind: 'deliver', order: { id: '', item: '', price: 0, at: 0, until: Infinity }, ready: () => true, phase: 'back', t: 0, goal: null, handed: true, replan: 0 };
    w.walk = { path, i: 1, v: 0 };
  }

  /** Where to stand to hand you something: within reach of you, on open floor, nearest the waiter. */
  private besideYou(w: Waiter): Pt | null {
    const me = this.ctx.player.position;
    const grid = this.ctx.grid;
    let best: Pt | null = null;
    let bestD = Infinity;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      for (const r of [HAND_M, HAND_M + 0.3, HAND_M + 0.6]) {
        const p = { x: me.x + Math.sin(ang) * r, z: me.z + Math.cos(ang) * r };
        if (!grid.isClear(p.x, p.z)) continue;
        // nearest the way the waiter comes, a little in favour of the nearer ring
        const d = Math.hypot(p.x - w.m.x, p.z - w.m.z) + r * 2;
        if (d < bestD) {
          bestD = d;
          best = p;
        }
        break;
      }
    }
    return best ?? grid.nearestClear(me.x, me.z, 2.5);
  }

  private pathTo(w: Waiter, to: Pt): { path: Pt[]; i: number; v: number } | null {
    const path = this.ctx.grid.path({ x: w.m.x, z: w.m.z }, to);
    return path && path.length >= 2 ? { path, i: 1, v: w.walk?.v ?? 0 } : null;
  }

  /** Along the job's path; true on arrival. */
  private walk(w: Waiter, dt: number): boolean {
    const wk = w.walk;
    if (!wk) return true;
    let left = 0;
    let prev = { x: w.m.x, z: w.m.z };
    for (let i = wk.i; i < wk.path.length; i++) {
      left += Math.hypot(wk.path[i]!.x - prev.x, wk.path[i]!.z - prev.z);
      prev = wk.path[i]!;
    }
    // up to pace, and down again to stop where the path ends
    wk.v = Math.min(wk.v + ACCEL * dt, WAITER_SPEED, Math.sqrt(2 * ACCEL * Math.max(0, left)) + 0.05);
    let step = wk.v * dt;
    while (step > 0 && wk.i < wk.path.length) {
      const t = wk.path[wk.i]!;
      const dx = t.x - w.m.x;
      const dz = t.z - w.m.z;
      const d = Math.hypot(dx, dz);
      if (d <= step) {
        w.m.x = t.x;
        w.m.z = t.z;
        step -= d;
        wk.i++;
      } else {
        w.m.x += (dx / d) * step;
        w.m.z += (dz / d) * step;
        step = 0;
      }
    }
    const t = wk.path[Math.min(wk.i, wk.path.length - 1)]!;
    if (Math.hypot(t.x - w.m.x, t.z - w.m.z) > 0.02) w.m.yaw = lerpAngle(w.m.yaw, Math.atan2(t.x - w.m.x, t.z - w.m.z), 1 - Math.exp(-dt * 7));
    w.m.motion = wk.v / WALK_CYCLE;
    if (wk.i >= wk.path.length) {
      w.m.motion = 0;
      wk.v = 0;
      if (w.job?.kind === 'deliver' && w.job.phase === 'back') {
        w.job = null;
        w.walk = null;
        w.rejoin = { x: w.m.x, z: w.m.z, yaw: w.m.yaw, t: 0 };
      }
      return true;
    }
    return false;
  }

  /** A job starts from where the waiter is drawn now. */
  private local(w: Waiter): void {
    w.rejoin = null;
    w.side = 0;
  }

  private face(w: Waiter, x: number, z: number, dt: number): void {
    if (Math.hypot(x - w.m.x, z - w.m.z) < 0.05) return;
    w.m.yaw = lerpAngle(w.m.yaw, Math.atan2(x - w.m.x, z - w.m.z), 1 - Math.exp(-dt * 6));
  }

  /** A sidestep round anyone in the way ahead (on top of the round; the round's timing is untouched). */
  private avoid(w: Waiter, dt: number): void {
    let want = 0;
    if (w.m.motion > 0.1) {
      const fx = Math.sin(w.m.yaw);
      const fz = Math.cos(w.m.yaw);
      const others = [...this.ctx.people(), ...this.list.filter((o) => o !== w).map((o) => ({ x: o.m.x, z: o.m.z }))];
      let nearest = AHEAD_M;
      for (const p of others) {
        const dx = p.x - w.m.x;
        const dz = p.z - w.m.z;
        const ahead = dx * fx + dz * fz;
        const across = dx * fz - dz * fx;
        if (ahead <= 0.1 || ahead >= nearest || Math.abs(across) > SIDESTEP + 0.1) continue;
        nearest = ahead;
        // step to the side away from them (their left if they're dead ahead)
        want = across > 0 ? -SIDESTEP : SIDESTEP;
      }
      // only onto open floor
      if (want !== 0 && !this.ctx.grid.isClear(w.m.x + fz * want, w.m.z - fx * want)) want = -want;
      if (want !== 0 && !this.ctx.grid.isClear(w.m.x + fz * want, w.m.z - fx * want)) want = 0;
    }
    w.side += (want - w.side) * (1 - Math.exp(-dt * 3));
    if (Math.abs(w.side) > 1e-3) {
      w.m.x += Math.cos(w.m.yaw) * w.side;
      w.m.z -= Math.sin(w.m.yaw) * w.side;
    }
  }

  /** What's on the tray now: the round's drinks, an order being brought, or nothing. */
  private loadOf(w: Waiter): BarModel[] {
    const job = w.job;
    if (job?.kind === 'deliver' && job.phase !== 'back') {
      const onTray = job.phase === 'guest' || (job.phase === 'hand' && !job.handed);
      const model = barItem(job.order.item)?.model;
      return onTray && model ? [model] : [];
    }
    if (job) return [];
    return w.round.at(this.ctx.now() + w.offset).tray;
  }
}

/** Trays are drawn out to here from the camera (m). */
const TRAY_M = 12;
/** Where the tray sits from the wrist bone: ahead along the hand, out from it, and up on the palm. */
const TRAY_AHEAD = 0.07;
const TRAY_OUT = 0.0;
const TRAY_UP = 0.045;

const _head = new THREE.Vector3();
function headOf(p: THREE.Vector3): THREE.Vector3 {
  return _head.set(p.x, 1.5, p.z);
}
