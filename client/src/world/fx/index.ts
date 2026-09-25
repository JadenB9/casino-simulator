// The shop's effects and the lobby's statues, played for everyone on the floor. The floor sends
// each effect as it's bought (`fx`), again in the list of what's still playing after every hello
// (`fxs`), and the lobby's statues (`statues`); the world hands them here (world.playFx,
// world.syncFx, world.setStatues). Effects run on server time, so everyone sees the same one at the
// same moment, a busy room's queue starts each at its `at`, and a page that joins late comes in
// part way through.
//
//   fx-confetti    confetti.ts    fx-spotlight   spotlight.ts   fx-round      round.ts
//   fx-rain        rain.ts        fx-sparklers   sparklers.ts   fx-disco      disco.ts
//   fx-marquee     headline.ts (the pit's LED sign)             fx-goldenhour golden.ts
//   fx-takeover    takeover.ts (all of the Headline and Golden Hour, a gobo and fireworks)
//
// Each effect gets a group of its own, drawn only while the room it's in can be seen. Everything
// an effect makes is let go when it ends; what they share (stock.ts) stays with the floor.

import * as THREE from 'three';
import type { EffectReach, FxEvent, Statue } from '../../../../shared/src/items.ts';
import type { Quality } from '../../render/engine3d.ts';
import { serverNow } from '../../net/clock.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { FxSounds } from '../../audio/fx.ts';
import type { Characters, Person } from '../characters.ts';
import type { Collider } from '../collision.ts';
import type { Lighting } from '../lighting.ts';
import type { Mats } from '../materials.ts';
import { roomAt, type FloorPlan } from '../layout.ts';
import type { CharacterSource } from '../emotes.ts';
import type { Marquee } from '../marquee.ts';
import { FxBook, fxKey, phaseOf, reachOf } from './timing.ts';
import { fxRoom, seenFrom } from './scope.ts';
import { FxCaption, captionOf } from './caption.ts';
import { Stock } from './stock.ts';
import { Statues } from './statues.ts';
import { confetti } from './confetti.ts';
import { spotlight } from './spotlight.ts';
import { round } from './round.ts';
import { rain } from './rain.ts';
import { sparklers } from './sparklers.ts';
import { disco, type Hanger } from './disco.ts';
import { golden } from './golden.ts';
import { headline } from './headline.ts';
import { takeover } from './takeover.ts';
import type { Effect, FxView, FxWorld } from './types.ts';
import './fx.css';

export type { Hanger } from './disco.ts';

/** Seconds into an effect after which a page joining counts as late (no opening bang, no burst). */
const LATE_S = 1.2;

export interface FxOptions {
  /** Where effects and statues hang (the floor's root: quality swaps reach them). */
  root: THREE.Object3D;
  plan: FloorPlan;
  camera: THREE.Camera;
  quality(): Quality;
  lighting: Lighting;
  collider: Collider;
  characters: Characters;
  mats: Mats;
  /** Your own character. */
  me: Person;
  ui: HTMLElement;
  sfx?: Sfx;
  /** What hangs from the ceilings (chandeliers, signs), for the mirror ball to keep clear of. */
  hangers: Hanger[];
  /** The casino's own reflections (High), for the gold. */
  env(): THREE.Texture | null;
  /** Every station's model. */
  stations: THREE.Object3D;
}

interface Playing {
  ev: FxEvent;
  effect: Effect;
  group: THREE.Group;
  /** The room it was bought in, and how far it reaches. */
  room: string | null;
  reach: EffectReach;
}

export class FxPlayer {
  readonly group = new THREE.Group();
  readonly statues: Statues;
  readonly stock: Stock;
  private readonly book = new FxBook();
  private readonly playing = new Map<string, Playing>();
  private readonly caption: FxCaption;
  private readonly sounds: FxSounds | null;
  private readonly world: FxWorld;
  private self: () => number | null = () => null;
  private remotes: CharacterSource | null = null;
  private marquee: Marquee | null = null;
  private tallySign: THREE.Mesh | null = null;
  private captionIn = 0;
  private readonly me: Person;
  private readonly warm: THREE.Object3D;

  constructor(private readonly o: FxOptions) {
    this.group.name = 'fx';
    o.root.add(this.group);
    this.me = o.me;
    this.stock = new Stock(o.env);
    this.warm = this.stock.warm(o.quality());
    this.group.add(this.warm);
    this.sounds = o.sfx ? new FxSounds(o.sfx) : null;
    this.caption = new FxCaption(o.ui);
    this.statues = new Statues({ characters: o.characters, plan: o.plan, collider: o.collider, mats: o.mats, quality: o.quality, env: o.env });
    this.group.add(this.statues.group);
    const where = (id: number): THREE.Vector3 | null => {
      if (id === this.self()) return this.me.root.getWorldPosition(new THREE.Vector3());
      const ch = this.remotes?.character(id);
      return ch && ch.root.visible ? ch.root.getWorldPosition(new THREE.Vector3()) : null;
    };
    this.world = {
      root: this.group,
      plan: o.plan,
      camera: o.camera,
      quality: o.quality,
      lighting: o.lighting,
      sounds: this.sounds,
      collider: o.collider,
      characters: o.characters,
      where,
      people: () => o.characters.people(),
      env: o.env,
      stations: o.stations,
      tally: () => this.tallySign,
    };
  }

  /** Who you are on the floor (your effects follow you), and whose characters are whose. */
  useSelf(self: () => number | null): void {
    this.self = self;
  }

  useRemotes(source: CharacterSource | null): void {
    this.remotes = source;
  }

  /** The pit's LED sign, for the Headline (the app's floor life owns it). */
  useMarquee(m: Marquee | null): void {
    this.marquee = m;
  }

  /** The slots hall's win meter (the app's floor life owns it), for Own the Night. */
  useTally(mesh: THREE.Mesh | null): void {
    this.tallySign = mesh;
  }

  /** An effect bought just now (the floor's `fx`). */
  play(ev: FxEvent): void {
    this.book.add(ev);
  }

  /** Everything still playing or queued (the floor's `fxs`, after a hello). */
  sync(list: readonly FxEvent[]): void {
    this.book.sync(list, serverNow());
  }

  setStatues(list: readonly Statue[]): Promise<void> {
    return this.statues.set(list);
  }

  /** What's playing now, for the checks. */
  get active(): { fx: string; name: string; at: number; until: number; shown: boolean }[] {
    return [...this.playing.values()].map((p) => ({ fx: p.ev.fx, name: p.ev.name, at: p.ev.at, until: p.ev.until, shown: p.group.visible }));
  }

  /** How far the effects have tinted the room's light (0: not at all), for the checks. */
  get tinted(): number {
    return this.o.lighting.tinted;
  }

  /** Everything known: playing and queued. */
  get known(): FxEvent[] {
    return this.book.list();
  }

  update(dt: number, view: FxView, hideCaption: boolean): void {
    const now = serverNow();
    for (const ev of this.book.list()) {
      const key = fxKey(ev);
      if (this.playing.has(key)) continue;
      const ph = phaseOf(ev, now);
      if (ph.state !== 'play') continue;
      this.start(ev, ph.t > LATE_S);
    }
    for (const [key, p] of this.playing) {
      // one the floor no longer lists (it ended while we were away) winds down now
      const ph = this.book.get(key) ? phaseOf(p.ev, now) : { t: (now - p.ev.at) / 1000, left: 0 };
      // one round its buyer is drawn wherever the buyer's room can be seen (they may have walked on)
      const buyer = p.reach === 'you' ? this.world.where(p.ev.id) : null;
      const room = buyer ? (roomAt(this.o.plan, buyer.x, buyer.z)?.id ?? p.room) : p.room;
      p.group.visible = seenFrom(this.o.plan, p.ev, view.here, view.visible, room);
      let alive = false;
      try {
        alive = p.effect.update(dt, ph.t, ph.left, view);
      } catch (err) {
        console.error(`effect ${p.ev.fx} failed`, err);
      }
      if (!alive) {
        this.playing.delete(key);
        p.effect.dispose();
        p.group.removeFromParent();
      }
    }
    this.book.prune(now);
    this.statues.group.visible = view.here === 'lobby' || view.visible.has('lobby');
    if ((this.captionIn -= dt) <= 0) {
      this.captionIn = 0.25;
      this.caption.set(captionOf(this.book.list(), now, view.here, this.o.plan), hideCaption);
    }
  }

  setQuality(q: Quality): void {
    this.statues.setQuality(q);
  }

  /**
   * Compile the effects' materials again now the casino's reflections exist (the gold takes them
   * up, which changes its shader), so the first coins and the first statue don't stall a frame.
   */
  async rewarm(renderer: THREE.WebGLRenderer, scene: THREE.Scene): Promise<void> {
    const q = this.o.quality();
    this.stock.coin(q);
    const gold = new THREE.Mesh(this.stock.coinGeo, this.statues.gold(q));
    gold.position.y = -100;
    this.warm.add(gold);
    this.warm.visible = true;
    try {
      await renderer.compileAsync(this.warm, this.o.camera, scene);
    } catch {
      /* compiled when first drawn instead */
    } finally {
      this.warm.visible = false;
    }
  }

  dispose(): void {
    for (const p of this.playing.values()) p.effect.dispose();
    this.playing.clear();
    this.statues.dispose();
    this.caption.dispose();
    this.stock.dispose();
    this.group.removeFromParent();
  }

  private start(ev: FxEvent, late: boolean): void {
    const group = new THREE.Group();
    group.name = `fx:${ev.fx}`;
    this.group.add(group);
    const w: FxWorld = { ...this.world, root: group };
    const s = this.stock;
    let effect: Effect | null = null;
    try {
      switch (ev.fx) {
        case 'fx-confetti':
          effect = confetti(w, s, ev, late);
          break;
        case 'fx-spotlight':
          effect = spotlight(w, s, ev, late);
          break;
        case 'fx-round':
          effect = round(w, ev, late);
          break;
        case 'fx-rain':
          effect = rain(w, s, ev, late);
          break;
        case 'fx-sparklers':
          effect = sparklers(w, s, ev, late);
          break;
        case 'fx-disco':
          effect = disco(w, s, ev, late, this.o.hangers);
          break;
        case 'fx-marquee':
          effect = headline(w, ev, late, () => this.marquee);
          break;
        case 'fx-goldenhour':
          effect = golden(w, s, ev, late);
          break;
        case 'fx-takeover':
          effect = takeover(w, s, ev, late, () => this.marquee);
          break;
      }
    } catch (err) {
      console.error(`effect ${ev.fx} failed to start`, err);
    }
    if (!effect) {
      // nothing to draw (a point outside every room): it still counts as started
      effect = { update: (_dt, _t, left) => left > 0, dispose: () => {} };
    }
    this.playing.set(fxKey(ev), { ev, effect, group, room: fxRoom(this.o.plan, ev)?.id ?? null, reach: reachOf(ev.fx) });
  }
}
