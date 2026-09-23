// Emotes over characters: a round bubble with the gesture's icon floats over the player for a
// few seconds, and the character acts it out if its rig allows (Character.gesture: a wave, a hop
// for a cheer). The icons are drawn as SVG elements in the UI's line style (no emoji: they differ
// on every OS, and the CSP rules out data: URLs). A new emote from the same player replaces the
// one showing.

import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { EmoteId } from '../../../shared/src/protocol.ts';
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

const NS = 'http://www.w3.org/2000/svg';

function glyph(e: EmoteId): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'emote-ico');
  s.setAttribute('aria-hidden', 'true');
  const path = (d: string, fill = false) => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    if (fill) p.setAttribute('class', 'fill');
    s.append(p);
  };
  const head = (cx: number, cy: number) => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', String(cx));
    c.setAttribute('cy', String(cy));
    c.setAttribute('r', '2.2');
    c.setAttribute('class', 'fill');
    s.append(c);
  };
  // pictogram figures, as on wayfinding signs; the thumb is a hand
  switch (e) {
    case 'wave':
      head(11, 4.8);
      path('M11 8.2v6.4M11 14.6l-2.4 6.4M11 14.6l2.4 6.4M11 9l-3 3.8M11 9l3.2-1.4 1.6-4.2');
      path('M18.2 2.6c1 .6 1.6 1.7 1.6 2.9M20.4 1.4c1.6 1 2.5 2.7 2.5 4.6');
      break;
    case 'cheer':
      head(12, 5.4);
      path('M12 8.8v5.8M12 14.6l-3 5.8M12 14.6l3 5.8M12 9.4l-3.2-2-1.2-3.8M12 9.4l3.2-2 1.2-3.8');
      path('M3.6 5.2l1.6.8M3.4 9.2l1.8-.3M20.4 5.2l-1.6.8M20.6 9.2l-1.8-.3');
      break;
    case 'clap':
      head(9, 4.8);
      path('M9 8.2v6.4M9 14.6l-2 6.4M9 14.6l2 6.4M9 9.4l4.6 1.4M9 10.4l4.6.4');
      path('M16.4 7.6l1.4-1.4M17 10.6h2.2M16.4 13.4l1.4 1.4');
      break;
    case 'thumbs':
      path('M7 10v11');
      path('M15 5.9L14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9z');
      break;
    case 'shrug':
      head(12, 4.6);
      path('M12 8v6.6M12 14.6l-1.8 6.4M12 14.6l1.8 6.4M12 8.6l-3.2 2.2-2.6-2.4M12 8.6l3.2 2.2 2.6-2.4');
      path('M4.8 8.2l1.4.2M19.2 8.2l-1.4.2');
      break;
  }
  return s;
}

const LABELS: Record<EmoteId, string> = { wave: 'waves', cheer: 'cheers', clap: 'claps', thumbs: 'gives a thumbs up', shrug: 'shrugs' };

interface Showing {
  tag: CSS2DObject;
  bubble: HTMLElement;
  left: number;
}

export class Emotes {
  private readonly showing = new Map<Character, Showing>();

  /** Put `e` over this character, `y` metres up (and play its gesture, when the character has one). */
  show(ch: Character, e: EmoteId, y = BUBBLE_Y): void {
    this.clear(ch);
    const outer = document.createElement('div');
    outer.className = 'emote';
    const bubble = document.createElement('div');
    bubble.className = `emote-bubble emote-${e}`;
    bubble.setAttribute('role', 'img');
    bubble.setAttribute('aria-label', LABELS[e] ?? e);
    bubble.append(glyph(e));
    outer.append(bubble);
    const tag = new CSS2DObject(outer);
    tag.position.set(0, y, 0);
    ch.root.add(tag);
    this.showing.set(ch, { tag, bubble, left: EMOTE_S });
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

  private clear(ch: Character): void {
    const s = this.showing.get(ch);
    if (!s) return;
    // a CSS2DObject takes its element out of the page only when it is itself detached
    s.tag.removeFromParent();
    s.tag.element.remove();
    this.showing.delete(ch);
  }
}

/** Where emotes for other players find their characters (RemotePlayers fits). */
export interface CharacterSource {
  character(id: number): Character | undefined;
}
