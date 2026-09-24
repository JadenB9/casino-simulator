// What the floor's staff say: a short line in a bubble over the head for a few seconds ("Good
// evening, Jaden."), styled apart from players' chat (a brass edge and the staff's small-caps role
// over it). A new line from the same person replaces the one showing; bubbles far from the camera
// are hidden. Text goes in with textContent only.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { fitOnScreen } from '../onscreen.ts';

/** Metres from the camera beyond which a bubble is hidden. */
const RANGE = 14;
/** The last seconds of a bubble, fading. */
const FADE_S = 0.4;
/** How far over its anchor the bubble's bottom sits (life.css .staff-say-bubble bottom). */
const LIFT = 14;

interface Showing {
  tag: CSS2DObject;
  bubble: HTMLElement;
  left: number;
}

const _cam = new THREE.Vector3();
const _at = new THREE.Vector3();

/** How long a line stays up: long enough to read. */
export function speechSeconds(text: string): number {
  return Math.min(6.5, 2.2 + text.length * 0.055);
}

export class Speech {
  private readonly showing = new Map<THREE.Object3D, Showing>();

  constructor(private readonly camera: THREE.Camera) {}

  /**
   * Put `text` over `root` (a character's root), `y` metres up in its own frame; `role` is a word
   * over the line ("Banker"). Returns how long it stays.
   */
  say(root: THREE.Object3D, text: string, role: string, y = 2.02, secs = speechSeconds(text)): number {
    this.clear(root);
    const outer = document.createElement('div');
    outer.className = 'staff-say';
    const bubble = document.createElement('div');
    bubble.className = 'staff-say-bubble';
    const who = document.createElement('span');
    who.className = 'staff-say-role';
    who.textContent = role;
    const line = document.createElement('span');
    line.className = 'staff-say-text';
    line.textContent = text;
    bubble.append(who, line);
    outer.append(bubble);
    const tag = new CSS2DObject(outer);
    tag.position.set(0, y, 0);
    root.add(tag);
    this.showing.set(root, { tag, bubble, left: secs });
    return secs;
  }

  /** The line showing over `root`, if any. */
  saying(root: THREE.Object3D): string | null {
    return this.showing.get(root)?.bubble.querySelector('.staff-say-text')?.textContent ?? null;
  }

  update(dt: number): void {
    const cam = this.camera.getWorldPosition(_cam);
    for (const [root, s] of this.showing) {
      s.left -= dt;
      if (s.left <= 0) {
        this.clear(root);
        continue;
      }
      if (s.left < FADE_S) s.bubble.classList.add('leaving');
      let shown = root.visible && root.getWorldPosition(_at).distanceTo(cam) <= RANGE;
      for (let o = root.parent; o && shown; o = o.parent) shown = o.visible;
      s.tag.visible = shown;
      // up close the head is at the top of the screen: keep the words on it
      if (shown) fitOnScreen(s.tag, s.bubble, this.camera, LIFT);
    }
  }

  clear(root: THREE.Object3D): void {
    const s = this.showing.get(root);
    if (!s) return;
    // a CSS2DObject takes its element out of the page only when it is itself detached
    s.tag.removeFromParent();
    s.tag.element.remove();
    this.showing.delete(root);
  }

  dispose(): void {
    for (const root of [...this.showing.keys()]) this.clear(root);
  }
}
