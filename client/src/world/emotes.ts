// Emotes over characters: a round bubble with the gesture's icon floats over the player for a
// few seconds, and the character acts it out (Character.gesture: a wave, a clap, a hop for a
// cheer). The icon is the wheel's own (ui/social/icons.ts), so what you pick is what everyone
// sees; SVG elements, no emoji (they differ on every OS) and no data: URLs (the CSP). A new
// emote from the same player replaces the one showing.
//
// Your own character is out of sight while you sit at a table (the camera is in your seat), so
// there your bubble shows at the foot of the view instead, where you are; everyone else still
// sees your seated character do it. A clap is heard: your own from right here, someone else's
// from where they stand, and only within earshot (audio/claps.ts).

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { EmoteId } from '../../../shared/src/protocol.ts';
import { emoteGlyph } from '../ui/social/icons.ts';
import { Claps, CLAP_RANGE } from '../audio/claps.ts';
import type { Sfx } from '../audio/sfx.ts';
import { CLAP_TIMES } from './characters.ts';
import type { Character } from './contract.ts';

/** Seconds a bubble stays up, the last FADE_S of them fading (on the frame clock, like the gesture). */
export const EMOTE_S = 2.8;
const FADE_S = 0.4;
/** Over another player's name tag (2.08 m). */
export const BUBBLE_Y = 2.46;
/**
 * Over your own head, which has no name tag: the follow camera is close behind you, and a bubble
 * as high as other players' would be off the top of the screen.
 */
export const OWN_BUBBLE_Y = 2.0;
/** A clap is heard from about chest height. */
const CLAP_Y = 1.25;

const LABELS: Partial<Record<EmoteId, string>> = {
  wave: 'waves',
  cheer: 'cheers',
  clap: 'claps',
  thumbs: 'gives a thumbs up',
  shrug: 'shrugs',
  sixseven: 'does the six seven',
};

export interface EmotesDeps {
  /** Where your own bubble goes while you're at a table (the UI root); none: over your character. */
  ui?: HTMLElement;
  /** The game's sounds, for the claps; none: silent. */
  sfx?: Sfx;
  /** Where the listener is (the camera), to leave out claps too far off to hear. */
  ears?: () => THREE.Vector3;
}

export interface EmoteOptions {
  /** Your own character: its claps sound from right here. */
  own?: boolean;
  /** Your own character out of sight (at a table): the bubble shows at the foot of the view. */
  screen?: boolean;
}

interface Showing {
  tag: CSS2DObject | null;
  el: HTMLElement;
  bubble: HTMLElement;
  left: number;
  hush: (() => void) | null;
}

const _at = new THREE.Vector3();

export class Emotes {
  private readonly showing = new Map<Character, Showing>();
  private readonly claps: Claps | null;

  constructor(private readonly deps: EmotesDeps = {}) {
    this.claps = deps.sfx ? new Claps(deps.sfx) : null;
  }

  /** Put `e` over this character, `y` metres up, and play its gesture (when the character has one). */
  show(ch: Character, e: EmoteId, y = BUBBLE_Y, opts: EmoteOptions = {}): void {
    this.clear(ch);
    const outer = document.createElement('div');
    outer.className = 'emote';
    const bubble = document.createElement('div');
    bubble.className = `emote-bubble emote-${e}`;
    bubble.setAttribute('role', 'img');
    bubble.setAttribute('aria-label', LABELS[e] ?? e);
    bubble.append(emoteGlyph(e));
    outer.append(bubble);
    let tag: CSS2DObject | null = null;
    if (opts.screen && this.deps.ui) {
      outer.classList.add('emote-own');
      this.deps.ui.append(outer);
    } else {
      tag = new CSS2DObject(outer);
      tag.position.set(0, y, 0);
      ch.root.add(tag);
    }
    this.showing.set(ch, { tag, el: outer, bubble, left: EMOTE_S, hush: e === 'clap' ? this.clap(ch, opts.own === true) : null });
    ch.gesture?.(e);
  }

  update(dt: number): void {
    for (const [ch, s] of this.showing) {
      s.left -= dt;
      if (s.left <= 0) this.clear(ch);
      else if (s.left < FADE_S) s.bubble.classList.add('leaving');
    }
  }

  dispose(): void {
    for (const ch of [...this.showing.keys()]) this.clear(ch);
  }

  /** The claps, in time with the hands meeting: your own right here, others' from where they stand. */
  private clap(ch: Character, own: boolean): (() => void) | null {
    if (!this.claps) return null;
    if (own) return this.claps.play(CLAP_TIMES, null);
    const at = ch.root.getWorldPosition(_at);
    at.y += CLAP_Y;
    const ears = this.deps.ears?.();
    if (ears && ears.distanceTo(at) > CLAP_RANGE) return null;
    return this.claps.play(CLAP_TIMES, at);
  }

  private clear(ch: Character): void {
    const s = this.showing.get(ch);
    if (!s) return;
    // a CSS2DObject takes its element out of the page only when it is itself detached
    s.tag?.removeFromParent();
    s.el.remove();
    s.hush?.();
    this.showing.delete(ch);
  }
}

/** Where emotes for other players find their characters (RemotePlayers fits). */
export interface CharacterSource {
  character(id: number): Character | undefined;
}
