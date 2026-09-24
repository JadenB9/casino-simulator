// Sit anywhere: every chair, stool, sofa place and bench the building lists (lifePoints' seats).
// Walk up to a free one and "Press E · Sit": the character glides onto it, turns to face the way it
// faces and sits (characters.ts sit()), and the camera swings round behind and a little above; the
// mouse still looks around. E ("Stand up"), Esc with the mouse free, or walking gets you up.
//
// The floor arbitrates (sit and stand on the floor socket, shared/src/seats.ts): the sit goes out at
// once and a seat someone else got first comes back as `seat.no`, which stands you up with the
// floor's friendly note. Everyone's seats come in as `player { seat }` news, kept here in a SeatBook
// the remote players draw from (seatPoseOf) and the prompts check (a taken seat isn't offered).
//
// Getting on: whatever the player's circle overlaps at the seat (the stool's post, the couch's box)
// is set aside while they sit, and each piece comes back once they've walked clear of it.

import type { Box, Collider, Post } from '../collision.ts';
import type { Character } from '../contract.ts';
import type { Spot } from '../interact.ts';
import type { Seatable } from '../life-points.ts';
import type { Player } from '../player.ts';
import type { SeatPose } from '../remote-players.ts';
import { SeatBook } from '../../../../shared/src/seats.ts';
import type { FloorClientMsg, FloorServerMsg } from '../../../../shared/src/protocol.ts';
import { yawToByte } from '../../net/presence.ts';
import { isTyping, overlayCount } from '../../ui/keyboard.ts';
import { toast } from '../../ui/kit.ts';
import { lerpAngle, smooth } from './rounds.ts';

/** What sitting needs from the floor socket (FloorLink fits). */
export interface SeatLink {
  readonly you: { id: number } | null;
  readonly players: ReadonlyMap<number, { info: { at: { station: string } | null } }>;
  send(msg: FloorClientMsg): boolean;
  subscribe(fn: (msg: FloorServerMsg) => void): () => void;
}

/** A seat's prompt shows within this of it (m). */
const REACH = 1.2;
/** Seconds to get onto a seat, and off it. */
const ON_S = 0.42;
const OFF_S = 0.32;
/** The walker's radius (player.ts). */
const PLAYER_R = 0.3;
/** Where a sitter stands up to: this far in front of the seat (or behind a stool at a counter). */
const STEP = 0.45;

type Shape = Box | Post;

export class Seating {
  readonly book = new SeatBook();
  private readonly byId = new Map<string, Seatable>();
  private link: SeatLink | null = null;
  private offLink: (() => void) | null = null;
  private mine: Seatable | null = null;
  private glide: { fx: number; fz: number; fh: number; tx: number; tz: number; th: number; t: number; dur: number; sit: boolean } | null = null;
  private readonly aside: Shape[] = [];
  private placed: { x: number; z: number } | null = null;
  private camEase = 0;

  constructor(
    private readonly seats: Seatable[],
    private readonly player: Player,
    private readonly character: Character,
    private readonly col: Collider,
    /** Stations someone plays at right now (a desk chair there isn't free). */
    private readonly playing: () => ReadonlySet<string>,
  ) {
    for (const s of seats) this.byId.set(s.id, s);
    addEventListener('keydown', this.onKey);
  }

  /** The seat you're on, if any. */
  get seated(): Seatable | null {
    return this.mine;
  }

  /** The floor socket to arbitrate through (null: sitting stays on this screen). */
  useLink(link: SeatLink | null): void {
    this.offLink?.();
    this.offLink = null;
    this.link = link;
    this.book.clear();
    if (!link) return;
    this.offLink = link.subscribe((m) => {
      if (m.t === 'hello') {
        this.book.clear();
        for (const p of m.players) if (p.seat) this.book.set(p.id, p.seat);
        // back after a dropped connection: the floor let our seat go, so ask for it again
        if (this.mine) this.claim(this.mine);
      } else if (m.t === 'player' && m.seat !== undefined && m.id !== link.you?.id) {
        this.book.set(m.id, m.seat);
      } else if (m.t === 'leave') {
        this.book.free(m.id);
      } else if (m.t === 'seat.no' && this.mine?.id === m.seat) {
        this.stand({ send: false });
        toast(m.msg);
      }
    });
  }

  /** The prompts: Sit at a free seat in reach, or Stand up while sitting. */
  spots = (p: { x: number; z: number }): Spot[] => {
    if (this.mine) return [{ key: `stand:${this.mine.id}`, x: p.x, z: p.z, d: -1, label: 'Stand up', any: true, use: () => this.stand() }];
    const out: Spot[] = [];
    const busy = this.playing();
    const me = this.link?.you?.id ?? null;
    for (const s of this.seats) {
      const d = Math.hypot(s.x - p.x, s.z - p.z) - 0.35;
      if (d > REACH) continue;
      const holder = this.book.holder(s.id);
      if ((holder !== null && holder !== me) || (s.station && busy.has(s.station))) continue;
      out.push({ key: `sit:${s.id}`, x: s.x, z: s.z, d: Math.max(0, d), label: 'Sit', use: () => this.sit(s) });
    }
    return out;
  };

  /** Where another player is drawn sitting (RemotePlayers' seatFor), if on a seat we know. */
  seatPoseOf(id: number): SeatPose | null {
    const seat = this.book.seatOf(id);
    const s = seat ? this.byId.get(seat) : undefined;
    return s ? { x: s.x, z: s.z, yaw: s.yaw, sit: s.top } : null;
  }

  sit(s: Seatable): void {
    if (this.mine) return;
    const me = this.link?.you?.id ?? null;
    const holder = this.book.holder(s.id);
    if (holder !== null && holder !== me) return;
    this.mine = s;
    this.claim(s);
    this.setAside(s.x, s.z);
    const p = this.player.position;
    this.glide = { fx: p.x, fz: p.z, fh: this.player.heading, tx: s.x, tz: s.z, th: s.yaw, t: 0, dur: ON_S, sit: true };
    this.camEase = 0.9;
  }

  /** Get up. From E or Esc the character steps off the seat; walking off just goes. */
  stand(opts: { send?: boolean; walk?: boolean } = {}): void {
    const s = this.mine;
    if (!s) return;
    this.mine = null;
    this.character.sit?.(null);
    const me = this.link?.you?.id;
    if (me !== undefined) this.book.free(me);
    if (opts.send !== false) this.link?.send({ t: 'stand' });
    this.glide = null;
    if (!opts.walk) {
      const to = this.standSpot(s);
      const p = this.player.position;
      this.glide = { fx: p.x, fz: p.z, fh: this.player.heading, tx: to.x, tz: to.z, th: this.player.heading, t: 0, dur: OFF_S, sit: false };
    }
  }

  /** Every frame, before the walker's own update. */
  update(dt: number): void {
    const p = this.player.position;
    // The walker moved us since last frame: keys or the stick, so up we get (or stepping down
    // stops where it is). Getting on, a walk's last momentum is still dying away: that's no wish.
    const pushed = this.placed !== null && Math.hypot(p.x - this.placed.x, p.z - this.placed.z) > 0.004;
    if (pushed) {
      if (this.glide && !this.glide.sit) this.glide = null;
      else if (this.mine && !this.glide) this.stand({ walk: true });
    }
    const g = this.glide;
    if (g) {
      g.t += dt;
      const k = smooth(g.t / g.dur);
      p.x = g.fx + (g.tx - g.fx) * k;
      p.z = g.fz + (g.tz - g.fz) * k;
      this.player.heading = lerpAngle(g.fh, g.th, k);
      if (g.t >= g.dur) {
        this.glide = null;
        if (g.sit && this.mine) this.character.sit?.(this.mine.top);
      }
    } else if (this.mine) {
      p.x = this.mine.x;
      p.z = this.mine.z;
      this.player.heading = this.mine.yaw;
    }
    this.placed = this.mine || this.glide ? { x: p.x, z: p.z } : null;
    // round behind the sitter and a little above them, unless the mouse turns it first
    if (this.mine && this.camEase > 0) {
      this.camEase -= dt;
      const k = 1 - Math.exp(-dt * 4.5);
      this.player.camYaw = lerpAngle(this.player.camYaw, this.mine.yaw + Math.PI, k);
      this.player.camPitch += (0.36 - this.player.camPitch) * k;
    }
    this.bringBack();
  }

  dispose(): void {
    removeEventListener('keydown', this.onKey);
    this.offLink?.();
    for (const s of this.aside) s.walk = true;
    this.aside.length = 0;
  }

  private claim(s: Seatable): void {
    const me = this.link?.you?.id;
    if (me !== undefined) this.book.set(me, s.id);
    this.link?.send({ t: 'sit', seat: s.id, x: Math.round(s.x * 100), z: Math.round(s.z * 100), r: yawToByte(s.yaw) });
  }

  /** Where to stand up to: in front of the seat, or behind it when a counter is in front. */
  private standSpot(s: Seatable): { x: number; z: number } {
    const fx = Math.sin(s.yaw);
    const fz = Math.cos(s.yaw);
    const front = { x: s.x + fx * STEP, z: s.z + fz * STEP };
    const back = { x: s.x - fx * STEP, z: s.z - fz * STEP };
    return this.blocked(front) <= this.blocked(back) ? front : back;
  }

  /** How many walls, counters or posts (other than those set aside) a walker at p would touch. */
  private blocked(p: { x: number; z: number }): number {
    let n = 0;
    for (const b of this.col.boxes) if (b.walk && overlaps(b, p.x, p.z, PLAYER_R)) n++;
    for (const q of this.col.posts) if (q.walk && overlaps(q, p.x, p.z, PLAYER_R)) n++;
    return n;
  }

  /** Put aside whatever a walker sitting at (x, z) would be pushed out of. */
  private setAside(x: number, z: number): void {
    for (const s of [...this.col.boxes, ...this.col.posts]) {
      if (!s.walk || !overlaps(s, x, z, PLAYER_R + 0.02)) continue;
      s.walk = false;
      this.aside.push(s);
    }
  }

  /** Each piece set aside comes back once the player is clear of it (and not sitting). */
  private bringBack(): void {
    if (this.mine || this.aside.length === 0) return;
    const p = this.player.position;
    for (let i = this.aside.length - 1; i >= 0; i--) {
      const s = this.aside[i]!;
      if (overlaps(s, p.x, p.z, PLAYER_R + 0.01)) continue;
      s.walk = true;
      this.aside.splice(i, 1);
    }
  }

  private onKey = (e: KeyboardEvent): void => {
    // Esc with the mouse free stands you up (with the mouse held, Esc lets it go first)
    if (e.code !== 'Escape' || !this.mine || e.defaultPrevented || isTyping(e) || overlayCount() > 0) return;
    this.stand();
  };
}

function overlaps(s: Shape, x: number, z: number, r: number): boolean {
  if ('hx' in s) {
    const c = Math.cos(s.yaw);
    const n = Math.sin(s.yaw);
    const dx = x - s.cx;
    const dz = z - s.cz;
    const lx = dx * c - dz * n;
    const lz = dx * n + dz * c;
    return Math.hypot(Math.max(0, Math.abs(lx) - s.hx), Math.max(0, Math.abs(lz) - s.hz)) < r;
  }
  return Math.hypot(x - s.cx, z - s.cz) < s.r + r;
}
