// Speech bubbles on the floor: a floor chat line floats over whoever said it for a few seconds
// (sayFor: longer lines stay longer), just above the name tag (or, for your own, just above your
// head), and over the emote bubble instead while one is up on the same player (world/emotes.ts
// puts those higher). A new line from the same player replaces the one showing. Bubbles over
// players further than RANGE from the camera are hidden: the chat panel has every line, and a
// crowd of far bubbles is noise. Text goes in with textContent only.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Character } from '../../world/contract.ts';
import { BUBBLE_Y, EMOTE_S, OWN_BUBBLE_Y } from '../../world/emotes.ts';
import { sayFor } from './model.ts';

/** Metres from the camera beyond which a bubble is hidden. */
export const RANGE = 16;
/** Where a player's name tag floats (world/characters.ts NAME_Y); a bubble sits a few px above it. */
const TAG_Y = 2.08;
/** Just over your own head, which has no tag; the follow camera looks at it from close behind. */
const OWN_Y = 1.9;
/** The last seconds of a bubble, fading. */
const FADE_S = 0.4;

interface Showing {
  tag: CSS2DObject;
  bubble: HTMLElement;
  left: number;
  own: boolean;
}

const _cam = new THREE.Vector3();
const _at = new THREE.Vector3();

function inScene(o: THREE.Object3D): boolean {
  let top = o;
  while (top.parent) top = top.parent;
  return (top as THREE.Scene).isScene === true;
}

export class SayBubbles {
  private readonly showing = new Map<Character, Showing>();
  /** When each character's emote bubble comes down, on this clock. */
  private readonly emoteUntil = new Map<Character, number>();
  private clock = 0;

  constructor(private readonly camera?: THREE.Camera) {}

  /** Put `text` over this character; `own` for your own, whose bubble sits lower (no name tag). */
  show(ch: Character, text: string, own: boolean): void {
    this.clear(ch);
    const outer = document.createElement('div');
    outer.className = own ? 'say own' : 'say';
    const bubble = document.createElement('div');
    bubble.className = 'say-bubble';
    const span = document.createElement('span');
    span.className = 'say-text';
    span.textContent = text;
    bubble.append(span);
    outer.append(bubble);
    const tag = new CSS2DObject(outer);
    ch.root.add(tag);
    this.showing.set(ch, { tag, bubble, left: sayFor(text), own });
    this.place(ch);
  }

  /** An emote bubble is going up over this character (FloorLink's emote event). */
  lift(ch: Character): void {
    this.emoteUntil.set(ch, this.clock + EMOTE_S);
    this.place(ch);
  }

  update(dt: number): void {
    this.clock += dt;
    const cam = this.camera?.getWorldPosition(_cam);
    for (const [ch, s] of this.showing) {
      s.left -= dt;
      // Gone with its player (left the floor): take it down now, not when its time is up.
      if (s.left <= 0 || !inScene(ch.root)) {
        this.clear(ch);
        continue;
      }
      if (s.left < FADE_S) s.bubble.classList.add('leaving');
      if (cam) s.tag.visible = ch.root.getWorldPosition(_at).distanceTo(cam) <= RANGE;
      this.place(ch);
    }
    for (const [ch, until] of this.emoteUntil) if (until <= this.clock) this.emoteUntil.delete(ch);
  }

  /** Take every bubble down (chat hidden, leaving the floor). */
  clearAll(): void {
    for (const ch of [...this.showing.keys()]) this.clear(ch);
  }

  dispose(): void {
    this.clearAll();
    this.emoteUntil.clear();
  }

  /** Over the name tag (or head), or over the emote bubble while there is one. */
  private place(ch: Character): void {
    const s = this.showing.get(ch);
    if (!s) return;
    const lifted = (this.emoteUntil.get(ch) ?? 0) > this.clock;
    s.tag.position.y = lifted ? (s.own ? OWN_BUBBLE_Y : BUBBLE_Y) : s.own ? OWN_Y : TAG_Y;
    s.tag.element.classList.toggle('lifted', lifted);
  }

  private clear(ch: Character): void {
    const s = this.showing.get(ch);
    if (!s) return;
    // a CSS2DObject takes its element out of the page only when it is itself detached
    s.tag.removeFromParent();
    s.tag.element.remove();
    this.showing.delete(ch);
  }
}
