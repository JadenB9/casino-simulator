// The boutique's shopkeeper, in a black blazer behind the counter. "Press E · Browse" at the
// counter (or at a mannequin, which opens the boutique at what it wears): a welcome with both hands
// and a word by name, then the boutique opens. Leaving, a goodbye ("Wear it well." if something new
// is on). Between customers they keep the shop: polishing a glass case, straightening a mannequin's
// jacket, then back behind the counter, and back at once when someone comes to it.

import type { Spot } from '../interact.ts';
import type { Stand } from '../life-points.ts';
import type { Member } from './crew.ts';
import type { LifeCtx } from './ctx.ts';
import { shopBye, shopHello } from './lines.ts';
import type { Pt } from './nav.ts';
import { lerpAngle } from './rounds.ts';
import * as THREE from 'three';

export interface Boutique {
  keeper: Stand;
  customer: Stand;
  cases: (Stand & { top: number })[];
  mannequins: (Stand & { item?: string })[];
}

const REACH = 1.4;
const PACE = 0.9;
const WALK_CYCLE = 1.75;
/** Seconds between the welcome and the boutique opening. */
const OPEN_AFTER = 0.9;

type Chore = { kind: 'go'; path: Pt[]; i: number; then: 'polish' | 'adjust' | 'home'; face: number } | { kind: 'work'; left: number } | null;

export class Shopkeeper {
  readonly m: Member;
  private chore: Chore = null;
  private rest = 10;
  private n = 0;
  private pending: { t: number; item?: string } | null = null;
  private visiting: { look: string } | null = null;

  constructor(
    private readonly ctx: LifeCtx,
    private readonly shop: Boutique,
  ) {
    this.m = ctx.crew.add('shopkeeper', shop.keeper.x, shop.keeper.z, shop.keeper.yaw);
  }

  spots = (p: { x: number; z: number }): Spot[] => {
    const out: Spot[] = [];
    const c = this.shop.customer;
    const d = Math.max(0, Math.hypot(c.x - p.x, c.z - p.z) - 0.35);
    if (d <= REACH) out.push({ key: 'boutique', x: c.x, z: c.z, d, label: 'Browse', use: () => this.welcome() });
    for (const [i, mq] of this.shop.mannequins.entries()) {
      if (!mq.item) continue;
      const dm = Math.max(0, Math.hypot(mq.x - p.x, mq.z - p.z) - 0.6);
      if (dm <= 1.2) out.push({ key: `mannequin:${i}`, x: mq.x, z: mq.z, d: dm, label: 'Browse', use: () => this.welcome(mq.item) });
    }
    return out;
  };

  /** A welcome, then the boutique (at `item` if given). */
  welcome(item?: string): void {
    const app = this.ctx.app();
    if (!app) return;
    this.home();
    this.ctx.crew.play(this.m, 'welcome');
    this.ctx.speech.say(this.m.ch.root, shopHello(app.name(), new Date().getHours(), this.n++), 'Boutique');
    this.pending = { t: OPEN_AFTER, item };
  }

  update(dt: number): void {
    const me = this.ctx.player.position;
    if (this.pending) {
      this.pending.t -= dt;
      if (this.pending.t <= 0) {
        const item = this.pending.item;
        this.pending = null;
        this.visiting = { look: this.lookKey() };
        this.ctx.app()?.openShop(item);
      }
    } else if (this.visiting && !document.querySelector('.boutique')) {
      // back from the boutique: something new on means something was bought
      const bought = this.lookKey() !== this.visiting.look;
      this.visiting = null;
      this.ctx.speech.say(this.m.ch.root, shopBye(bought, this.n++), 'Boutique');
    }
    // someone at the counter: back behind it, and look at them
    const c = this.shop.customer;
    const near = Math.hypot(me.x - c.x, me.z - c.z) < 3.2;
    if (near && this.away()) this.home();
    this.m.look = near ? new THREE.Vector3(me.x, 1.5, me.z) : null;
    this.work(dt, near);
  }

  /** What you wear now (a purchase in the boutique puts it on). */
  private lookKey(): string {
    return JSON.stringify((this.ctx.player.character as { currentLook?: unknown }).currentLook ?? null);
  }

  private away(): boolean {
    return Math.hypot(this.m.x - this.shop.keeper.x, this.m.z - this.shop.keeper.z) > 0.2 && !(this.chore?.kind === 'go' && this.chore.then === 'home');
  }

  private home(): void {
    this.ctx.crew.still(this.m);
    const path = this.ctx.grid.path({ x: this.m.x, z: this.m.z }, this.shop.keeper);
    this.chore = path && path.length > 1 ? { kind: 'go', path, i: 1, then: 'home', face: this.shop.keeper.yaw } : null;
    if (!this.chore) {
      this.m.x = this.shop.keeper.x;
      this.m.z = this.shop.keeper.z;
    }
  }

  private work(dt: number, near: boolean): void {
    const ch = this.chore;
    if (!ch) {
      this.m.motion = 0;
      this.m.yaw = lerpAngle(this.m.yaw, this.shop.keeper.yaw, 1 - Math.exp(-dt * 4));
      this.rest -= dt;
      if (this.rest > 0 || near) return;
      this.rest = 14 + ((this.n++ * 11) % 12);
      // a case to polish or a mannequin to straighten, in turn
      const cases = this.shop.cases;
      const mqs = this.shop.mannequins;
      const pickCase = (this.n % 2 === 0 && cases.length) || !mqs.length;
      const spot = pickCase ? cases[this.n % Math.max(1, cases.length)] : mqs[this.n % mqs.length];
      if (!spot) return;
      const path = this.ctx.grid.path({ x: this.m.x, z: this.m.z }, spot);
      if (path && path.length > 1) this.chore = { kind: 'go', path, i: 1, then: pickCase ? 'polish' : 'adjust', face: spot.yaw };
      return;
    }
    if (ch.kind === 'work') {
      this.m.motion = 0;
      ch.left -= dt;
      if (ch.left <= 0) this.home();
      return;
    }
    // walking a chore's path
    const t = ch.path[ch.i]!;
    const dx = t.x - this.m.x;
    const dz = t.z - this.m.z;
    const d = Math.hypot(dx, dz);
    const step = PACE * dt;
    if (d <= step) {
      this.m.x = t.x;
      this.m.z = t.z;
      ch.i++;
    } else {
      this.m.x += (dx / d) * step;
      this.m.z += (dz / d) * step;
      this.m.yaw = lerpAngle(this.m.yaw, Math.atan2(dx, dz), 1 - Math.exp(-dt * 7));
    }
    this.m.motion = PACE / WALK_CYCLE;
    if (ch.i < ch.path.length) return;
    this.m.motion = 0;
    this.m.yaw = ch.face;
    if (ch.then === 'home') {
      this.chore = null;
      return;
    }
    this.ctx.crew.play(this.m, ch.then);
    this.chore = { kind: 'work', left: ch.then === 'polish' ? 4.3 : 3.5 };
  }
}
