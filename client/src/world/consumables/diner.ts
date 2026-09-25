// You, drinking and eating: Q (or the card's button) takes the next sip or bite of what's in your
// hand, on top of the ones you take now and then anyway; each portion had does what that item does
// (effects.ts): a quicker pace, a sparkle, a tipsy sway of the view with a warm edge (Settings in the
// bar's menu), a full stomach the waiters notice. Finished, a waiter comes to take the empty, or
// you set it down. The card and the chips are hud.ts; the drinking itself, seen by everyone, is
// held.ts.

import * as THREE from 'three';
import { barItem } from '../../../../shared/src/items.ts';
import type { Look } from '../../../../shared/src/look.ts';
import { isTyping, overlayCount } from '../../ui/keyboard.ts';
import { paceBoost } from '../player.ts';
import { Effects } from './effects.ts';
import { glint, heldOrders, setMySway } from './held.ts';
import { DineHud } from './hud.ts';
import { sparksFor } from './particles.ts';
import { drinkFx } from './prefs.ts';
import { acts, planFor, stateAt, type Plan, type State } from './schedule.ts';
import { useSound, type AudioOut } from './sounds.ts';
import { addExtra, addOwnAct, extraAt, firstSeen, now, ownActs, setMyOrder } from './state.ts';

export interface DinerDeps {
  ui: HTMLElement;
  camera: THREE.Camera;
  /** Your character (its place, for the sparkle round you). */
  character: { root: THREE.Object3D };
  /** Your look (what's in your hand) and your name. */
  look(): Look | null;
  /** Put down what you're holding (the bar's drop). */
  drop(): void;
  /** Walking about on the floor: not at a table, not in a menu screen. */
  onFloor(): boolean;
  /** The waiters: one comes to take your empty; they notice a full stomach. */
  waiters?: { collect(model: import('../../../../shared/src/items.ts').BarModel, taken: () => void): boolean; fed: () => boolean } | null;
  sound?: AudioOut | null;
}

interface Mine {
  order: string;
  item: string;
  plan: Plan;
  /** Portions counted toward effects so far. */
  counted: number;
  finished: boolean;
  /** When to ask for the empty to be taken (ms, server clock), and whether a waiter's coming. */
  clearAt: number;
  asked: number;
  handedBack: boolean;
}

/** After finishing, the empty stays in hand this long before a waiter's called (ms): a plate's pat on the belly first. */
const CLEAR_DRINK_MS = 1500;
const CLEAR_FOOD_MS = 3200;
/** A waiter who hasn't come by then: you set it down yourself (ms). */
const WAIT_FOR_WAITER_MS = 30_000;

export class Diner {
  readonly effects = new Effects();
  private readonly hud: DineHud;
  private mine: Mine | null = null;
  private state: State | null = null;
  private clock = 0;
  private glintIn = 0;
  private chipsIn = 0;
  private readonly wobble = { q0: new THREE.Quaternion(), set: new THREE.Quaternion(), on: false };

  constructor(private readonly deps: DinerDeps) {
    this.hud = new DineHud(deps.ui, () => this.sip());
    addEventListener('keydown', this.onKey);
    if (deps.waiters) deps.waiters.fed = () => this.effects.isFed(Date.now());
    useSound(deps.sound ?? null, () => deps.camera.getWorldPosition(new THREE.Vector3()));
  }

  /** Take the next sip or bite now (Q). False when there's nothing to have or one is going. */
  sip(): boolean {
    const m = this.mine;
    const s = this.state;
    if (!m || !s || s.done || s.act || !this.deps.onFloor()) return false;
    const t = now();
    // one of yours already waiting its turn is enough
    if (ownActs(m.order).some((a) => a > t - 200)) return false;
    addOwnAct(m.order, t);
    return true;
  }

  /** What's in your hand as this screen has it (for checks). */
  get current(): { order: string; item: string; state: State | null } | null {
    return this.mine ? { order: this.mine.order, item: this.mine.item, state: this.state } : null;
  }

  update(dt: number): void {
    this.clock += dt;
    const floor = this.deps.onFloor();
    const wall = Date.now();
    const t = now();
    this.track(t, wall);

    // what it does for you
    paceBoost.k = floor ? this.effects.paceNow(wall) : 1;
    const sway = this.effects.sway(wall);
    setMySway(sway);
    const fx = drinkFx() && floor;
    this.hud.show(floor);
    this.hud.warmth(fx ? sway : 0);
    this.sway(fx ? sway : 0);
    if (floor && this.effects.isBubbly(wall)) {
      this.glintIn -= dt;
      const sparks = sparksFor(this.deps.character.root);
      if (this.glintIn <= 0 && sparks) {
        this.glintIn = 0.2;
        glint(sparks, this.deps.character.root.getWorldPosition(new THREE.Vector3()));
      }
    }

    // the card and the chips, a few times a second
    this.chipsIn -= dt;
    if (this.chipsIn <= 0) {
      this.chipsIn = 0.25;
      this.hud.setChips(this.effects.chips(wall));
      this.hud.held(this.mine && this.state ? this.info(this.mine, this.state, t) : null);
    }
  }

  dispose(): void {
    removeEventListener('keydown', this.onKey);
    paceBoost.k = 1;
    setMySway(0);
    setMyOrder(null);
    this.hud.dispose();
    if (this.deps.waiters) this.deps.waiters.fed = () => false;
    useSound(null, null);
  }

  // ------------------------------------------------------------------------------------------------

  /** Follow the order in your hand: count its portions as they're had, and see the empty off. */
  private track(t: number, wall: number): void {
    const held = this.deps.look()?.held;
    const live = held && barItem(held.item) && held.until > t ? held : null;
    if (live?.order !== this.mine?.order) {
      this.mine = live
        ? { order: live.order, item: live.item, plan: planFor(live.item, live.order, live.until, firstSeen(`${live.order}|${live.item}`, t)), counted: 0, finished: false, clearAt: 0, asked: 0, handedBack: false }
        : null;
      setMyOrder(live?.order ?? null);
    }
    const m = this.mine;
    if (!m) {
      this.state = null;
      return;
    }
    const s = stateAt(m.plan, acts(m.plan, ownActs(m.order)), t);
    this.state = s;
    // what you had while it was yours to have (a latecomer's view of it never counts)
    while (m.counted < s.taken - m.plan.pre) {
      this.effects.portion(m.item, wall, m.counted === 0);
      m.counted++;
    }
    if (s.done && !m.finished) {
      m.finished = true;
      this.effects.finished(m.item, wall);
      m.clearAt = t + (barItem(m.item)?.kind === 'food' ? CLEAR_FOOD_MS : CLEAR_DRINK_MS);
    }
    if (!m.finished || m.handedBack || t < m.clearAt || !this.deps.onFloor()) return;
    if (!m.asked) {
      m.asked = t;
      const model = barItem(m.item)?.model;
      const coming = model && this.deps.waiters?.collect(model, () => this.handBack(m)) === true;
      // nobody free to come: set it down
      if (!coming) this.handBack(m);
    } else if (t - m.asked > WAIT_FOR_WAITER_MS) {
      this.handBack(m);
    }
  }

  /** Hand the empty over (or set it down): the arm goes out with it, then it's gone. */
  private handBack(m: Mine): void {
    if (m.handedBack) return;
    m.handedBack = true;
    addExtra(m.order, { kind: 'give', t0: now() });
    setTimeout(() => {
      if (this.deps.look()?.held?.order === m.order) this.deps.drop();
    }, 900);
  }

  private info(m: Mine, s: State, t: number): { item: string; level: number; action: string | null; note: string } {
    const kind = s.opened ? m.plan.profile.act : (m.plan.profile.opener ?? m.plan.profile.act);
    const action = s.done ? null : (ACTION[kind] ?? 'Sip');
    let note = '';
    const toast = extraAt(m.order, t)?.e.kind === 'toast';
    if (s.done) note = m.handedBack ? '' : 'Finished. A waiter will take it.';
    else if (toast) note = 'Cheers.';
    else if (barItem(m.item)?.kind === 'drink' && this.others()) note = 'Face someone with a drink to toast.';
    return { item: m.item, level: barItem(m.item)?.kind === 'food' ? 1 - s.taken / m.plan.profile.portions : s.level, action, note };
  }

  /** Someone else on the floor has a drink. */
  private others(): boolean {
    for (const h of heldOrders()) if (h.order !== this.mine?.order && h.isDrink) return true;
    return false;
  }

  /** The view sways a little after a few drinks, on top of wherever the camera was put this frame. */
  private sway(k: number): void {
    const cam = this.deps.camera;
    const w = this.wobble;
    // not moved by anyone since last frame: take last frame's sway off first
    if (w.on && cam.quaternion.equals(w.set)) cam.quaternion.copy(w.q0);
    w.on = false;
    if (k <= 0.001) return;
    w.q0.copy(cam.quaternion);
    const c = this.clock;
    cam.rotateZ(0.032 * k * Math.sin(c * 0.83) + 0.01 * k * Math.sin(c * 2.1));
    cam.rotateY(0.012 * k * Math.sin(c * 0.51 + 1));
    cam.rotateX(0.008 * k * Math.sin(c * 0.67 + 2));
    cam.updateMatrixWorld();
    w.set.copy(cam.quaternion);
    w.on = true;
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'KeyQ' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTyping(e) || overlayCount() > 0) return;
    if (this.sip()) e.preventDefault();
  };
}

const ACTION: Record<string, string> = { sip: 'Sip', swig: 'Swig', bite: 'Bite', spray: 'Pop the cork', blow: 'Blow out the candles' };
