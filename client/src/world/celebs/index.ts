// Celebrity visits and the gift box on the floor (shared/src/celebs.ts has the rules, the server's
// floor/celebs.ts decides). The floor tells every client about a visit ahead of time: who, when
// they walk in and a seed. From then on this draws it from the clock alone: the celebrity walking
// their route with two bodyguards at their shoulders, fans joining along the way (crowd.ts),
// stopping to greet the lobby, sign autographs, play a table for show and pose for photos
// (phones flashing), and waving goodbye at the doors. Every client sees the same people in the
// same places doing the same things, because all of it comes from the visit and the server clock.
//
// "E · Talk to <name>" beside them asks the floor for a word. The floor checks you're standing
// there, pays a tip once per visit (a grant) and tells everyone: they turn to you, say their line
// and take a selfie with you, and you get the flash, the shutter and the photo (news.ts).
//
// A gift box shows where the floor left it, turning over a pool of gold light, until someone opens
// it ("E · Open the gift box": the first to get there keeps what's inside) or it runs out.

import * as THREE from 'three';
import { serverNow } from '../../net/clock.ts';
import type { Sfx } from '../../audio/sfx.ts';
import type { FloorClientMsg, FloorServerMsg } from '../../../../shared/src/protocol.ts';
import { OUTFITS, SKIN_TONES, type Body, type Look } from '../../../../shared/src/look.ts';
import {
  CELEBS, GIFT_PROMPT_M, GUARD_LOOK, TALK_PROMPT_M, celebOf, poseOn, routeOfVisit, visitEnd,
  type Celeb, type CelebServerMsg, type GiftBox, type StopKind, type Timeline, type Visit,
} from '../../../../shared/src/celebs.ts';
import type { Characters, Person } from '../characters.ts';
import type { Spot } from '../interact.ts';
import type { Player } from '../player.ts';
import type { NavGrid } from '../life/nav.ts';
import type { Speech } from '../life/speech.ts';
import { Poser } from '../life/pose.ts';
import { lerpAngle } from '../life/rounds.ts';
import type { Motion } from '../life/motions.ts';
import { CELEB_MOTIONS, type CelebMotion } from './motions.ts';
import { followersOf, placeFollower, seeded, type Follower } from './crowd.ts';
import { Flashes, screenFlash } from './flash.ts';
import { GiftModel } from './gift.ts';
import { HappyCard, Notices, Sighting, photoCard } from './news.ts';
import { clockText, happyHour, setHappyHour } from './happy.ts';
import { chime, shutter } from './sound.ts';
import { selfieCamera, takeSelfie, type Snapper } from './selfie.ts';
import { calm } from '../../app/comfort.ts';
import './celebs.css';

/** What this needs from the floor socket (FloorLink has all of it). */
export interface CelebLink {
  readonly you: { id: number } | null;
  readonly players: ReadonlyMap<number, { track: { at(t: number): { x: number; z: number } | null } }>;
  send(msg: FloorClientMsg): boolean;
  subscribe(fn: (msg: FloorServerMsg) => void): () => void;
}

/** The app's side: the balance after a tip, the sounds, and whether you're out on the floor. */
export interface CelebApp {
  money(m: { balance: number; inPlay: number; rev: number }): void;
  sfx: Sfx | null;
  /** Walking the floor (not in the menus, at a table or in a sheet): notices and the card show only then. */
  onFloor(): boolean;
  /** The renderer and scene, for the selfie's picture (none: the photo card goes without one). */
  snapper?: Snapper | null;
}

export interface CelebsDeps {
  root: THREE.Object3D;
  camera: THREE.Camera;
  characters: Characters;
  grid: NavGrid;
  speech: Speech;
  player: Player;
  /** A room's id and name at a point, null outside. */
  roomAt: (x: number, z: number) => { id: string; name: string } | null;
  /** The bartender and the waiters, to call out happy hour (life/). */
  staff?: () => { bartender: { ch: { root: THREE.Object3D } } | null; waiters: readonly { ch: { root: THREE.Object3D }; x: number; z: number }[] };
}

/** What the staff say about happy hour. */
const HAPPY_LINES = {
  start: ['Happy hour! Everything at the bar is half price.', "It's happy hour, folks. Half price on the whole menu.", 'Half price at the bar for the next fifteen minutes.'],
  last: ['Last call on happy hour. A few minutes left at half price.', 'Happy hour ends in a few minutes. Get your orders in.'],
  waiter: ["It's happy hour: half price. Can I get you something?", 'Half price at the bar right now. Something to drink?', 'Happy hour. Everything on the menu is half off.'],
} as const;

/** Drawn out to here (m). */
const RANGE = 32;
/** How long the celebrity looks at someone they're talking to. */
const TALK_S = 4;
/** Word at the door this long before they walk in (not when it's a moment away: the arrival says it). */
const TEASE_MS = 75_000;
const TEASE_MIN_MS = 12_000;
/** An ask with no answer for this long can be asked again. */
const ASK_MS = 5_000;
const HEAD_Y = 1.62;
/** A line's bubble: as high as a player's emote bubble (emotes.ts), clear of the name tag under it. */
const BUBBLE_Y = 2.46;
const WALK_CYCLE = 1.75;

interface Actor {
  ch: Person;
  poser: Poser;
  /** null: the celebrity. */
  f: Follower | null;
  scale: number;
  x: number;
  z: number;
  yaw: number;
  placed: boolean;
  act: { m: Motion; t: number } | null;
  shown: boolean;
  /** When this fan next claps or cheers, and flashes a phone (stop-seconds). */
  cue: number;
  flash: number;
}

/** What a stop's time brings: a gesture, a motion, or a line (from the stop's kind of lines). */
type Beat = { at: number; do: 'wave' | 'cheer' | 'clap' | 'thumbs' | CelebMotion | 'line' | 'table' | 'bye' };

const BEATS: Record<StopKind, Beat[]> = {
  greet: [{ at: 0.4, do: 'wave' }, { at: 1.2, do: 'line' }, { at: 7, do: 'point' }, { at: 12, do: 'thumbs' }, { at: 17, do: 'wave' }],
  sign: [{ at: 1, do: 'line' }, { at: 2.2, do: 'sign' }, { at: 6.5, do: 'sign' }, { at: 11, do: 'sign' }, { at: 16, do: 'point' }, { at: 19, do: 'sign' }, { at: 24, do: 'sign' }, { at: 29, do: 'thumbs' }, { at: 32, do: 'sign' }, { at: 37, do: 'sign' }, { at: 42, do: 'wave' }],
  table: [{ at: 1.5, do: 'table' }, { at: 4, do: 'cheer' }, { at: 12, do: 'clap' }, { at: 18, do: 'table' }, { at: 21, do: 'cheer' }, { at: 30, do: 'thumbs' }, { at: 36, do: 'table' }, { at: 38, do: 'cheer' }],
  pose: [{ at: 0.6, do: 'line' }, { at: 2, do: 'selfie' }, { at: 7, do: 'point' }, { at: 12, do: 'bow' }, { at: 17, do: 'selfie' }, { at: 23, do: 'wave' }, { at: 29, do: 'thumbs' }, { at: 34, do: 'bow' }],
  bye: [{ at: 0.2, do: 'bye' }, { at: 0.4, do: 'wave' }, { at: 4.5, do: 'wave' }],
};

const FAN_TOPS = ['#1c2a44', '#6b1d2a', '#2d3a2a', '#e6e1d6', '#3b2f4f', '#b8762e', '#262626', '#7c8a96', '#a3263a', '#1f4f5f'];
const FAN_BOTTOMS = ['#1e2028', '#2a2622', '#3a3f47', '#14161c', '#4a4038', '#20242c'];
const HAIRS = ['#2b1d14', '#4a3020', '#1b1512', '#6b4226', '#b89660', '#0e0c0b', '#8c8a86', '#7a3b22'];

/** A fan's look, the same on every client for the same visit. */
export function fanLook(seed: number, k: number): Look {
  const r = seeded(seed * 31 + k * 977 + 5);
  const body: Body = r() < 0.5 ? 'f' : 'm';
  const outfits = OUTFITS[body];
  return {
    v: 1,
    body,
    outfit: outfits[Math.floor(r() * outfits.length)]!,
    skin: Math.floor(r() * SKIN_TONES.length),
    hair: HAIRS[Math.floor(r() * HAIRS.length)]!,
    top: FAN_TOPS[Math.floor(r() * FAN_TOPS.length)]!,
    bottom: FAN_BOTTOMS[Math.floor(r() * FAN_BOTTOMS.length)]!,
    shoes: '#141414',
  };
}

export class Celebs {
  readonly group = new THREE.Group();
  /** The visit the floor last told us about (planned or going on), and the box waiting to be found. */
  visit: Visit | null = null;
  gift: GiftBox | null = null;
  private link: CelebLink | null = null;
  private offLink: (() => void) | null = null;
  private app: CelebApp | null = null;
  private tl: Timeline | null = null;
  private celeb: Celeb | null = null;
  private followers: Follower[] = [];
  private cast: Actor[] = [];
  private readonly flashes = new Flashes();
  private giftModel: GiftModel | null = null;
  private notices: Notices | null = null;
  private sighting: Sighting | null = null;
  private happyCard: HappyCard | null = null;
  /** Which happy hour (by its start) we've warned of, announced, and called last orders for; which waiters have said it. */
  private readonly happyTold = { soon: 0, start: 0, last: 0 };
  private readonly waiterSaid = new Set<number>();
  private happyIn = 0;
  /** Visits we've already announced, teased, or met the star of (this page's memory). */
  private readonly told = new Set<number>();
  private readonly teased = new Set<number>();
  private readonly met = new Set<number>();
  private asking: { key: string; at: number } | null = null;
  /** The stop the celebrity was at last frame, and how far into it. */
  private lastStop = -1;
  private lastStopT = 0;
  /** Someone they're talking to, and until when (server seconds into the visit). */
  private talk: { id: number; until: number } | null = null;
  private cardIn = 0;
  /** Your selfie: when the phone goes off (performance.now()), the picture once taken, and the tip it goes with. */
  private snap: { at: number; id: number } | null = null;
  private picture: HTMLCanvasElement | null = null;
  private giftShot: { at: number; x: number | null; z: number | null; amount: number } | null = null;
  private photo: { title: string; amount: number; line: string; foot: string; until: number } | null = null;
  private readonly head = new THREE.Vector3();
  private readonly frustum = new THREE.Frustum();
  private readonly vp = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 1.1);
  private readonly box = new THREE.Box3();

  constructor(private readonly deps: CelebsDeps) {
    this.group.name = 'celebs';
    this.group.add(this.flashes.group);
    deps.root.add(this.group);
  }

  /** The floor socket (null: nothing arrives, nothing can be asked). */
  useLink(link: CelebLink | null): void {
    this.offLink?.();
    this.offLink = null;
    this.link = link;
    this.asking = null;
    // (the next socket may be someone else's: the floor says again who has met whom)
    if (!link) this.met.clear();
    if (link) this.offLink = link.subscribe((m) => this.hear(m as unknown as CelebServerMsg));
  }

  useApp(app: CelebApp | null): void {
    this.app = app;
    if (!app) this.sighting?.set(null);
  }

  /** Where the celebrity is being drawn now (for the checks), or null. */
  star(): { x: number; z: number; name: string } | null {
    const a = this.cast.find((c) => c.f === null);
    return a && this.celeb ? { x: a.x, z: a.z, name: this.celeb.name } : null;
  }

  /** "Talk to <name>" beside the celebrity; "Open the gift box" at the box. */
  spots = (p: { x: number; z: number }): Spot[] => {
    const out: Spot[] = [];
    const star = this.star();
    const v = this.visit;
    if (star && v && this.link && !this.met.has(v.id)) {
      const d = Math.hypot(star.x - p.x, star.z - p.z);
      if (d <= TALK_PROMPT_M) out.push({ key: `celeb:${v.id}`, x: star.x, z: star.z, d: Math.max(0, d - (TALK_PROMPT_M - 1.6)), label: `Talk to ${star.name}`, use: () => this.ask(`celeb:${v.id}`, { t: 'celeb.talk', visit: v.id }) });
    }
    const g = this.gift;
    if (g && this.giftModel && this.link && serverNow() < g.until) {
      const d = Math.hypot(g.x - p.x, g.z - p.z);
      if (d <= GIFT_PROMPT_M + 0.3) out.push({ key: `gift:${g.id}`, x: g.x, z: g.z, d: Math.max(0, d - 0.3), label: 'Open the gift box', any: d < 0.6, use: () => this.ask(`gift:${g.id}`, { t: 'gift.open', id: g.id }) });
    }
    return out;
  };

  update(dt: number, rooms: ReadonlySet<string> | null = null, sees: ((room: string, box: THREE.Box3) => boolean) | null = null): void {
    const now = serverNow();
    this.flashes.update(dt);
    this.updateGift(dt, now);
    this.selfie();
    this.happy(dt, now);
    const v = this.visit;
    if (!v || now >= visitEnd(v)) {
      if (this.cast.length) this.clearCast();
      this.sighting?.set(null);
      return;
    }
    const celeb = celebOf(v.celeb);
    if (!celeb) return;
    if (now < v.start) {
      if (v.start - now < TEASE_MS && v.start - now > TEASE_MIN_MS && !this.teased.has(v.id) && this.onFloor()) {
        this.teased.add(v.id);
        this.news().show({ tag: 'Word at the door', title: `${celeb.name} is on the way`, sub: `${celeb.known}. Arriving through the lobby any minute.` });
      }
      return;
    }
    if (!this.cast.length || this.celeb !== celeb) this.build(v, celeb);
    const t = (now - v.start) / 1000;
    this.announce(v, celeb, t);
    this.camera();
    for (const a of this.cast) this.place(a, t, dt);
    this.direct(t, dt);
    for (const a of this.cast) this.show(a, dt, rooms, sees);
    this.cardIn -= dt;
    if (this.cardIn <= 0) {
      this.cardIn = 0.5;
      this.updateCard(v, celeb);
    }
  }

  dispose(): void {
    this.useLink(null);
    this.clearCast();
    this.giftModel?.dispose();
    this.giftModel = null;
    this.flashes.dispose();
    this.notices?.dispose();
    this.sighting?.dispose();
    this.happyCard?.dispose();
    this.group.removeFromParent();
  }

  // --- the floor's news ------------------------------------------------------------------------

  private hear(m: CelebServerMsg): void {
    switch (m.t) {
      case 'celebs':
        this.setVisit(m.visit);
        this.setGift(m.gift);
        if (m.happy) setHappyHour(m.happy);
        break;
      case 'happy':
        setHappyHour(m.happy);
        break;
      case 'celeb':
        this.setVisit(m.visit);
        break;
      case 'celeb.talk':
        this.onTalk(m.visit, m.id, m.line);
        break;
      case 'celeb.tip': {
        this.asking = null;
        this.met.add(m.visit);
        this.app?.money(m);
        const c = this.visit?.id === m.visit ? this.celeb : null;
        if (c) {
          // the photo lands with the flash (onTalk times it), or on its own if the flash never comes
          this.photo = { title: c.name, amount: m.amount, line: `"${c.lines.hello[m.line] ?? ''}"`, foot: m.met === 1 ? 'Your first celebrity. Find the rest.' : `${m.met} of ${CELEBS.length} celebrities met`, until: performance.now() + 3000 };
          this.picture = null;
        }
        break;
      }
      case 'celeb.no':
        this.asking = null;
        if (m.code === 'MET') this.met.add(m.visit);
        this.news().show({ tag: this.celeb?.name ?? 'Celebrity', title: m.msg });
        break;
      case 'gift':
        this.setGift(m.gift);
        if (serverNow() < m.gift.until && this.onFloor()) this.news().show({ tag: 'Gift box', title: 'A gift box has been left somewhere on the floor', sub: 'The first to find it keeps what is inside.' });
        break;
      case 'gift.gone':
        if (this.gift?.id === m.id) this.removeGift(m.name !== null);
        if (m.name && m.name !== this.youName() && this.onFloor()) this.news().show({ tag: 'Gift box', title: `${m.name} found the gift box` });
        break;
      case 'gift.won': {
        this.asking = null;
        this.app?.money(m);
        chime(this.app?.sfx);
        const g = this.gift?.id === m.id ? this.gift : null;
        if (g) this.removeGift(true);
        // a picture of it popping open, from where you stand
        this.giftShot = { at: performance.now() + 280, x: g?.x ?? null, z: g?.z ?? null, amount: m.amount };
        break;
      }
      case 'gift.no':
        this.asking = null;
        this.news().show({ tag: 'Gift box', title: m.msg });
        break;
    }
  }

  private setVisit(v: Visit | null): void {
    if (v && this.visit && v.id === this.visit.id) return;
    if (this.cast.length) this.clearCast();
    this.visit = v;
    this.talk = null;
  }

  private ask(key: string, msg: { t: 'celeb.talk'; visit: number } | { t: 'gift.open'; id: number }): void {
    const now = performance.now();
    if (this.asking && this.asking.key === key && now - this.asking.at < ASK_MS) return;
    if (!this.link?.send(msg as unknown as FloorClientMsg)) return;
    this.asking = { key, at: now };
  }

  // --- the visit ---------------------------------------------------------------------------------

  private build(v: Visit, celeb: Celeb): void {
    this.clearCast();
    this.celeb = celeb;
    this.tl = routeOfVisit(v);
    this.followers = followersOf(v, this.tl);
    this.lastStop = -1;
    const star = this.actor(celeb.look, celeb.name, celeb.scale, null, false);
    star.ch.setPace(0.95, 0.3);
    for (const f of this.followers) {
      const look = f.role === 'guard' ? { ...GUARD_LOOK, skin: (v.seed + f.k * 3) % SKIN_TONES.length } : fanLook(v.seed, f.k);
      const scale = f.role === 'guard' ? 1.06 + f.k * 0.02 : 0.95 + seeded(v.seed + f.k)() * 0.09;
      const a = this.actor(look, '', scale, f, true);
      a.ch.setPace(0.9 + ((f.k * 37) % 20) / 100, (f.k * 0.37) % 1);
      a.cue = 3 + f.k * 1.7;
      a.flash = 1 + f.k * 0.9;
    }
  }

  private actor(look: Look, name: string, scale: number, f: Follower | null, staff: boolean): Actor {
    // the celebrity counts as someone on the floor (heads turn, waiters step round); the crowd doesn't
    const ch = this.deps.characters.create(look, name, { staff });
    ch.root.scale.setScalar(scale);
    ch.root.visible = false;
    this.group.add(ch.root);
    const a: Actor = { ch, poser: new Poser(ch.root), f, scale, x: 0, z: 0, yaw: 0, placed: false, act: null, shown: false, cue: 0, flash: 0 };
    this.cast.push(a);
    return a;
  }

  private clearCast(): void {
    for (const a of this.cast) {
      this.deps.speech.clear(a.ch.root);
      a.ch.dispose();
    }
    this.cast = [];
    this.celeb = null;
    this.tl = null;
  }

  private announce(v: Visit, celeb: Celeb, t: number): void {
    if (this.told.has(v.id) || !this.onFloor()) return;
    this.told.add(v.id);
    const at = poseOn(this.tl!, t);
    const room = this.deps.roomAt(at.x, at.z);
    const fresh = t < 25;
    this.news().show({
      tag: 'Celebrity sighting',
      title: fresh ? `${celeb.name} just walked in through the lobby` : `${celeb.name} is on the floor${room ? `, in the ${room.name}` : ''}`,
      sub: `${celeb.known}. Say hello while they're here.`,
    });
  }

  /** Where each of them is this frame, from the clock. */
  private place(a: Actor, t: number, dt: number): void {
    const tl = this.tl!;
    let x: number;
    let z: number;
    let yaw: number;
    let here = true;
    if (!a.f) {
      const p = poseOn(tl, t);
      x = p.x;
      z = p.z;
      yaw = p.heading;
      // turned to whoever they're talking to
      const who = this.talk && t < this.talk.until ? this.whereIs(this.talk.id) : null;
      if (who && !p.walking) yaw = Math.atan2(who.x - x, who.z - z);
    } else {
      const q = placeFollower(a.f, this.followers, tl, t, this.deps.grid);
      x = q.x;
      z = q.z;
      yaw = q.yaw;
      here = q.here;
    }
    if (!here) {
      a.placed = false;
      a.ch.root.visible = a.shown = false;
      return;
    }
    const moved = a.placed ? Math.hypot(x - a.x, z - a.z) : 0;
    a.ch.setMotion(dt > 0 ? Math.min(1.4, moved / dt / WALK_CYCLE) : 0);
    // a big step (a fan walking up, a reconnect) isn't eased; a turn always is
    a.yaw = a.placed ? lerpAngle(a.yaw, yaw, Math.min(1, dt * 6)) : yaw;
    a.x = x;
    a.z = z;
    a.placed = true;
    a.ch.root.position.set(x, 0, z);
    a.ch.root.rotation.y = a.yaw;
  }

  /** The stop's beats for the celebrity, the fans' cheers and phones, a word with someone. */
  private direct(t: number, dt: number): void {
    const tl = this.tl!;
    const celeb = this.celeb!;
    const star = this.cast.find((a) => !a.f)!;
    const p = poseOn(tl, t);
    const stop = p.stop >= 0 ? tl.route.stops[p.stop]! : null;
    if (p.stop !== this.lastStop) {
      this.lastStop = p.stop;
      this.lastStopT = p.stopT - dt;
    }
    if (stop) {
      for (const b of BEATS[stop.kind]) {
        if (b.at > this.lastStopT && b.at <= p.stopT) this.beat(star, celeb, b, p.stop);
      }
      this.lastStopT = p.stopT;
    }
    // the fans: a cheer or a clap now and then, and phones up for a photo
    for (const a of this.cast) {
      if (!a.f || a.f.role !== 'fan' || !a.shown) continue;
      if (!stop) continue;
      a.cue -= dt;
      if (a.cue <= 0) {
        const r = Math.random();
        a.ch.gesture(r < 0.4 ? 'clap' : r < 0.75 ? 'cheer' : 'wave');
        a.cue = 5 + Math.random() * 6;
      }
      a.flash -= dt;
      // (no phones going off with Reduce flashing & motion on)
      if (a.flash <= 0 && stop.kind !== 'bye' && !calm()) {
        a.flash = stop.kind === 'pose' || stop.kind === 'sign' ? 1.2 + Math.random() * 2.5 : 3 + Math.random() * 5;
        const hx = a.x + Math.sin(a.yaw) * 0.35;
        const hz = a.z + Math.cos(a.yaw) * 0.35;
        this.flashes.pop(hx, HEAD_Y * a.scale + 0.12, hz, 0.34);
      }
    }
    // the head: whoever they're talking to, else you when you're close in front
    const who = this.talk && t < this.talk.until ? this.whereIs(this.talk.id) : null;
    if (who) star.ch.lookAt(this.head.set(who.x, HEAD_Y, who.z));
    else {
      const me = this.deps.player.position;
      const d = Math.hypot(me.x - star.x, me.z - star.z);
      star.ch.lookAt(d < 4.5 && !p.walking ? this.head.set(me.x, HEAD_Y, me.z) : null);
    }
  }

  private beat(star: Actor, celeb: Celeb, b: Beat, stop: number): void {
    const v = this.visit!;
    const pick = (lines: readonly string[], n: number) => lines[(v.seed + stop * 7 + n) % lines.length]!;
    switch (b.do) {
      case 'line':
        this.say(star, pick(celeb.lines.stop, 0));
        break;
      case 'table':
        this.say(star, pick(celeb.lines.table, Math.round(b.at)));
        break;
      case 'bye':
        this.say(star, celeb.lines.bye);
        break;
      case 'wave':
      case 'cheer':
      case 'clap':
      case 'thumbs':
        star.ch.gesture(b.do);
        break;
      default:
        star.act = { m: CELEB_MOTIONS[b.do], t: 0 };
        if (b.do === 'selfie' && !calm()) this.flashes.pop(star.x + Math.sin(star.yaw) * 0.5, 2.1 * star.scale, star.z + Math.cos(star.yaw) * 0.5, 0.3);
    }
  }

  /** A line in a bubble over the head, where players' emote bubbles go: clear of the name tag under it. */
  private say(a: Actor, text: string): void {
    this.deps.speech.say(a.ch.root, text, this.celeb?.name ?? '', BUBBLE_Y);
  }

  /** The floor says the celebrity had a word with someone (maybe you). */
  private onTalk(visit: number, id: number, line: number): void {
    const v = this.visit;
    const star = this.cast.find((a) => !a.f);
    if (!v || v.id !== visit || !star || !this.celeb) return;
    const t = (serverNow() - v.start) / 1000;
    this.talk = { id, until: t + TALK_S };
    this.say(star, this.celeb.lines.hello[line] ?? this.celeb.lines.hello[0]!);
    star.act = { m: CELEB_MOTIONS.selfie, t: 0 };
    if (id === this.link?.you?.id) {
      // your own: the picture is taken at the flash, from the phone's side (selfie())
      this.snap = { at: performance.now() + 1250, id };
      this.deps.player.character.gesture?.('thumbs');
      return;
    }
    setTimeout(() => {
      const who = this.whereIs(id);
      if (who && !calm()) this.flashes.pop(who.x, HEAD_Y + 0.35, who.z, 0.5);
    }, 1300);
  }

  /**
   * Your selfie's moment: the picture from the phone (drawn now, at the start of the frame, before
   * the frame's own drawing replaces it), the flash, the shutter, and the photo card with the tip.
   */
  private selfie(): void {
    const t = performance.now();
    const s = this.snap;
    if (s && t >= s.at) {
      this.snap = null;
      const star = this.star();
      const me = this.deps.player.position;
      const snapper = this.app?.snapper;
      if (star && snapper) {
        const cam = this.deps.camera.position;
        this.picture = takeSelfie(snapper, selfieCamera({ x: star.x, z: star.z }, { x: me.x, z: me.z }, { x: cam.x, z: cam.z }));
      }
      if (!calm()) this.flashes.pop(me.x, HEAD_Y + 0.35, me.z, 0.5);
      screenFlash(this.ui());
      shutter(this.app?.sfx);
      this.showPhoto();
      return;
    }
    // the tip came but the moment didn't (the celebrity out of sight on this screen): the card anyway
    if (this.photo && !this.snap && t >= this.photo.until) this.showPhoto();
    const g = this.giftShot;
    if (g && t >= g.at) {
      this.giftShot = null;
      const snapper = this.app?.snapper;
      let picture: HTMLCanvasElement | null = null;
      if (snapper && g.x !== null && g.z !== null) {
        const me = this.deps.player.position;
        const d = Math.hypot(me.x - g.x, me.z - g.z) || 1;
        const cam = new THREE.PerspectiveCamera(46, 4 / 3, 0.05, 40);
        cam.position.set(g.x + ((me.x - g.x) / d) * 1.05, 0.95, g.z + ((me.z - g.z) / d) * 1.05);
        cam.lookAt(g.x, 0.42, g.z);
        cam.updateMatrixWorld();
        picture = takeSelfie(snapper, cam);
      }
      photoCard(this.ui(), { tag: 'You found', title: 'The gift box', amount: g.amount, foot: 'Another one turns up within the hour.', picture });
    }
  }

  private showPhoto(): void {
    const p = this.photo;
    if (!p) return;
    this.photo = null;
    photoCard(this.ui(), { tag: 'Photo with', title: p.title, amount: p.amount, line: p.line, foot: p.foot, picture: this.picture });
    this.picture = null;
  }

  /** Where a player stands: you, or another player on the floor. */
  private whereIs(id: number): { x: number; z: number } | null {
    if (id === this.link?.you?.id) return { x: this.deps.player.position.x, z: this.deps.player.position.z };
    const p = this.link?.players.get(id)?.track.at(serverNow());
    return p ? { x: p.x / 100, z: p.z / 100 } : null;
  }

  private camera(): void {
    const cam = this.deps.camera as THREE.PerspectiveCamera;
    cam.updateMatrixWorld();
    this.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.vp);
  }

  /** Drawn only in view, near enough and in a room the camera can see into; animated only then. */
  private show(a: Actor, dt: number, rooms: ReadonlySet<string> | null, sees: ((room: string, box: THREE.Box3) => boolean) | null): void {
    if (!a.placed) return;
    const cam = this.deps.camera.position;
    const near = Math.hypot(a.x - cam.x, a.z - cam.z) < RANGE;
    const room = rooms ? this.deps.roomAt(a.x, a.z)?.id : undefined;
    this.box.min.set(a.x - 0.4, 0, a.z - 0.4);
    this.box.max.set(a.x + 0.4, 1.9, a.z + 0.4);
    const seen = !rooms || !room || (rooms.has(room) && (!sees || sees(room, this.box)));
    this.sphere.center.set(a.x, 0.95, a.z);
    const show = near && seen && this.frustum.intersectsSphere(this.sphere);
    if (show !== a.shown) {
      a.shown = show;
      a.ch.root.visible = show;
    }
    if (a.act) {
      a.act.t += dt;
      if (a.act.t >= a.act.m.dur) a.act = null;
    }
    if (!show) return;
    a.poser.restore();
    a.ch.update(dt);
    if (a.act) a.poser.apply(a.act.m.pose(a.act.t));
  }

  private updateCard(v: Visit, celeb: Celeb): void {
    const star = this.star();
    if (!star || !this.onFloor()) {
      this.sighting?.set(null);
      return;
    }
    const me = this.deps.player.position;
    const room = this.deps.roomAt(star.x, star.z);
    (this.sighting ??= new Sighting(this.ui())).set({ name: celeb.name, known: celeb.known, room: room?.name ?? 'On the way out', metres: Math.hypot(star.x - me.x, star.z - me.z), met: this.met.has(v.id) });
  }

  // --- happy hour ------------------------------------------------------------------------------

  /** A word before it starts, the notice and the bartender's call when it does, last orders, the card. */
  private happy(dt: number, now: number): void {
    this.happyIn -= dt;
    if (this.happyIn > 0) return;
    this.happyIn = 0.25;
    const h = happyHour();
    const on = h !== null && now >= h.start && now < h.end;
    const floor = this.onFloor();
    if (h && !on && h.start > now && h.start - now <= 5 * 60_000 && h.start - now > 60_000 && this.happyTold.soon !== h.start && floor) {
      this.happyTold.soon = h.start;
      const m = Math.ceil((h.start - now) / 60_000);
      this.news().show({ tag: 'Happy hour', title: `Happy hour at the bar in ${m} minutes`, sub: 'Everything on the menu at half price for a quarter of an hour.' });
    }
    if (h && on && this.happyTold.start !== h.start) {
      this.happyTold.start = h.start;
      this.waiterSaid.clear();
      if (floor && h.end - now > 60_000) this.news().show({ tag: 'Happy hour', title: 'Everything at the bar is half price', sub: `For the next ${Math.ceil((h.end - now) / 60_000)} minutes. Order at the counter or from any waiter.` });
      this.staffSays('start', h.start);
    }
    if (h && on && h.end - now <= 3 * 60_000 && this.happyTold.last !== h.start) {
      this.happyTold.last = h.start;
      this.staffSays('last', h.start);
    }
    // a waiter passing close by mentions it, once each
    const staff = on ? this.deps.staff?.() : null;
    const me = this.deps.player.position;
    staff?.waiters.forEach((w, i) => {
      if (this.waiterSaid.has(i) || Math.hypot(w.x - me.x, w.z - me.z) > 4.5) return;
      this.waiterSaid.add(i);
      this.deps.speech.say(w.ch.root, HAPPY_LINES.waiter[(Math.floor(h!.start / 60_000) + i) % HAPPY_LINES.waiter.length]!, 'Waiter');
    });
    if (on && floor) (this.happyCard ??= new HappyCard(this.ui())).set(clockText(h!.end - now));
    else this.happyCard?.set(null);
  }

  private staffSays(kind: 'start' | 'last', start: number): void {
    const b = this.deps.staff?.().bartender;
    const lines = HAPPY_LINES[kind];
    if (b) this.deps.speech.say(b.ch.root, lines[Math.floor(start / 60_000) % lines.length]!, 'Bartender');
  }

  // --- the gift box ----------------------------------------------------------------------------

  private setGift(g: GiftBox | null): void {
    if (g && this.gift?.id === g.id) return;
    this.removeGift(false);
    this.gift = g;
    if (!g) return;
    this.giftModel = new GiftModel();
    this.giftModel.root.position.set(g.x, 0, g.z);
    this.group.add(this.giftModel.root);
  }

  private removeGift(opened: boolean): void {
    const m = this.giftModel;
    this.gift = null;
    this.giftModel = null;
    if (!m) return;
    if (!opened) {
      m.dispose();
      return;
    }
    const p = m.root.position;
    if (!calm()) for (let i = 0; i < 4; i++) setTimeout(() => this.flashes.pop(p.x + (Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.5, p.z + (Math.random() - 0.5) * 0.6, 0.3), i * 90);
    // it goes on turning while it opens, then it's gone
    this.opening = m;
    m.open(() => {
      m.dispose();
      if (this.opening === m) this.opening = null;
    });
  }

  private opening: GiftModel | null = null;

  private updateGift(dt: number, now: number): void {
    if (this.gift && now >= this.gift.until) this.removeGift(false);
    this.giftModel?.update(dt);
    this.opening?.update(dt);
  }

  // --- plumbing ----------------------------------------------------------------------------------

  private onFloor(): boolean {
    return this.app?.onFloor() ?? false;
  }

  private youName(): string | null {
    return (this.link?.you as { name?: string } | null)?.name ?? null;
  }

  private news(): Notices {
    return (this.notices ??= new Notices(this.ui()));
  }

  private ui(): HTMLElement {
    return document.getElementById('ui') ?? document.body;
  }
}
