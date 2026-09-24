// The bartender, behind the counter in a wine-red waistcoat: strolls along the bar now and then,
// looks up at whoever comes near, and makes every order paid for. "Press E · Order" at the counter
// brings them over to you and opens the bar's menu. Each order is made in front of you (a cocktail
// shaken and poured, a bottle or a plate fetched from the back): if you're at the bar it's handed
// straight across the counter, otherwise it goes to the pickup end for a waiter to bring.

import * as THREE from 'three';
import type { BarOrder } from '../../../../shared/src/items.ts';
import { barItem } from '../../../../shared/src/items.ts';
import { serverNow } from '../../net/clock.ts';
import type { Spot } from '../interact.ts';
import type { Member } from './crew.ts';
import type { LifeCtx } from './ctx.ts';
import { bartenderServes, bartenderTakes } from './lines.ts';
import { lerpAngle } from './rounds.ts';
import type { Waiters } from './waiters.ts';

const WALK_CYCLE = 1.75;
/** Behind the counter: pace (m/s). */
const PACE = 1.0;
/** Your side of the bar counts as "at the bar" this far out from the customers' strip (m). */
const AT_BAR_M = 0.9;

interface Ticket {
  order: BarOrder;
  phase: 'queued' | 'making' | 'pass' | 'waiting' | 'across' | 'done';
  t: number;
  /** A waiter has it (or it went across the counter). */
  gone: boolean;
}

export class Bartender {
  readonly m: Member;
  private readonly line: { x: number; z0: number; z1: number };
  private target: number | null = null;
  private rest = 6;
  private readonly tickets: Ticket[] = [];
  private attending = 0;
  private n = 0;

  constructor(
    private readonly ctx: LifeCtx,
    private readonly waiters: Waiters,
  ) {
    const b = ctx.points.bar;
    // the working line, as near the counter as the strip allows
    this.line = { x: Math.min(b.tender.x0, b.tender.x1) + 0.05, z0: Math.min(b.tender.z0, b.tender.z1), z1: Math.max(b.tender.z0, b.tender.z1) };
    const z = Math.max(this.line.z0, Math.min(this.line.z1, b.pickup.z - 3));
    this.m = ctx.crew.add('bartender', this.line.x, z, b.tender.yaw);
  }

  /** "Order" anywhere along your side of the counter. */
  spots = (p: { x: number; z: number }): Spot[] => {
    const f = this.ctx.points.bar.front;
    const x0 = Math.min(f.x0, f.x1);
    const x1 = Math.max(f.x0, f.x1);
    const z0 = Math.min(f.z0, f.z1);
    const z1 = Math.max(f.z0, f.z1);
    if (p.z < z0 || p.z > z1 || p.x < x0 - 0.6 || p.x > x1 + 0.4) return [];
    // the counter's edge straight ahead of you
    const cx = x1 + 0.35;
    const d = Math.max(0, Math.abs(cx - p.x) - 0.5);
    return [{ key: 'bar', x: cx, z: p.z, d, label: 'Order', use: () => this.attend() }];
  };

  /** Over to you, a word, and the menu. */
  attend(): void {
    const app = this.ctx.app();
    if (!app) return;
    this.target = this.clampZ(this.ctx.player.position.z);
    this.attending = 8;
    this.ctx.speech.say(this.m.ch.root, bartenderTakes(this.n++), 'Bartender');
    app.openBarMenu();
  }

  /** A paid order: made next, then across the counter or to a waiter. */
  take(order: BarOrder): void {
    this.tickets.push({ order, phase: 'queued', t: 0, gone: false });
  }

  update(dt: number): void {
    const me = this.ctx.player.position;
    const app = this.ctx.app();
    this.attending = Math.max(0, this.attending - dt);
    const ticket = this.tickets.find((t) => t.phase !== 'done' && t.phase !== 'waiting') ?? null;
    // the order in hand waits at the pickup for its waiter
    for (const t of this.tickets) if (t.phase === 'waiting' && t.gone) t.phase = 'done';
    while (this.tickets.length && this.tickets[0]!.phase === 'done') this.tickets.shift();
    if (ticket) this.make(ticket, dt, me, app !== null);
    else if (this.attending > 0 && this.atBar(me.x, me.z)) this.target = this.clampZ(me.z);
    else this.stroll(dt);
    this.move(dt);
    // face the customers, or where you're walking
    const want = this.target !== null && Math.abs(this.target - this.m.z) > 0.05 ? (this.target > this.m.z ? 0 : Math.PI) : this.ctx.points.bar.tender.yaw;
    this.m.yaw = lerpAngle(this.m.yaw, want, 1 - Math.exp(-dt * 6));
    this.m.look = this.attending > 0 || ticket?.phase === 'across' ? head(me.x, me.z) : null;
  }

  private make(t: Ticket, dt: number, me: { x: number; z: number }, hasApp: boolean): void {
    t.t += dt;
    const item = barItem(t.order.item);
    const pickup = this.ctx.points.bar.pickup;
    switch (t.phase) {
      case 'queued':
        // make it in front of you if you're at the bar, else at the pickup end
        this.target = this.clampZ(this.atBar(me.x, me.z) ? me.z : pickup.z);
        if (Math.abs(this.m.z - this.target) < 0.08) {
          t.phase = 'making';
          t.t = 0;
          this.ctx.crew.play(this.m, item?.kind === 'food' || item?.model === 'magnum' || item?.model === 'bottle' ? 'fetch' : 'mix');
        }
        break;
      case 'making':
        if (this.ctx.crew.playing(this.m) > 0) break;
        this.hold(t.order, true);
        t.t = 0;
        t.phase = this.atBar(me.x, me.z) && hasApp ? 'across' : 'pass';
        if (t.phase === 'across') {
          this.target = this.clampZ(me.z);
          this.ctx.crew.play(this.m, 'handOver');
        }
        break;
      case 'across':
        this.target = this.clampZ(me.z);
        if (t.t > 0.6 && !t.gone) {
          t.gone = true;
          this.hold(t.order, false);
          this.ctx.app()?.holdItem(t.order.id);
          this.ctx.speech.say(this.m.ch.root, bartenderServes(item?.name.toLowerCase() ?? 'drink', this.n++), 'Bartender');
        }
        if (t.t > 1.4) t.phase = 'done';
        break;
      case 'pass':
        // over to the pickup end, and a waiter comes for it
        this.target = this.clampZ(pickup.z);
        if (Math.abs(this.m.z - this.target) < 0.1) {
          const ok = this.waiters.deliver(t.order, () => true, () => {
            t.gone = true;
            this.hold(t.order, false);
            this.ctx.crew.play(this.m, 'handOver');
          });
          if (ok) {
            t.phase = 'waiting';
          } else if (this.waiters.list.length === 0) {
            // no waiters on this floor: across the counter it goes, wherever you are
            this.hold(t.order, false);
            this.ctx.app()?.holdItem(t.order.id);
            t.phase = 'done';
          }
        }
        break;
    }
  }

  /** The drink or plate in the bartender's hand (the look's held order), or not. */
  private hold(order: BarOrder, on: boolean): void {
    const look = { ...this.m.ch.currentLook };
    if (on) look.held = { item: order.item, order: `bar-${order.id}`.slice(0, 40), until: serverNow() + 120_000 };
    else delete look.held;
    this.m.ch.setLook(look);
  }

  private atBar(x: number, z: number): boolean {
    const f = this.ctx.points.bar.front;
    return x >= Math.min(f.x0, f.x1) - AT_BAR_M && x <= Math.max(f.x0, f.x1) + 0.5 && z >= Math.min(f.z0, f.z1) - 0.3 && z <= Math.max(f.z0, f.z1) + 0.3;
  }

  private clampZ(z: number): number {
    return Math.max(this.line.z0, Math.min(this.line.z1, z));
  }

  /** Now and then a few steps along the bar. */
  private stroll(dt: number): void {
    if (this.target !== null) return;
    this.rest -= dt;
    if (this.rest > 0) return;
    const span = this.line.z1 - this.line.z0;
    // a deterministic enough wander: along to somewhere a couple of metres off
    const to = this.m.z + (((this.n++ * 7919) % 100) / 100 - 0.5) * Math.min(6, span);
    this.target = this.clampZ(to);
    this.rest = 8 + ((this.n * 37) % 14);
  }

  private move(dt: number): void {
    if (this.target === null) {
      this.m.motion = 0;
      return;
    }
    const dz = this.target - this.m.z;
    const step = Math.min(Math.abs(dz), PACE * dt);
    this.m.z += Math.sign(dz) * step;
    this.m.motion = Math.abs(dz) > 0.05 ? PACE / WALK_CYCLE : 0;
    if (Math.abs(dz) <= 0.02) this.target = this.attending > 0 ? this.target : null;
  }
}

const _head = new THREE.Vector3();
function head(x: number, z: number): THREE.Vector3 {
  return _head.set(x, 1.45, z);
}
