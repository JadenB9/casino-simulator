// Drawings for the social pieces, built as SVG elements (the CSP rules out inline style
// attributes and data: URLs, and emoji draw differently on every OS). 24-unit grid, currentColor.
//
// Emote glyphs are solid silhouettes, readable at a glance on the wheel or over a head: bars are
// round-capped strokes (a thick stroke with round caps is a capsule), bodies are filled shapes.
// The HUD icons are line drawings in the menu icons' style (menu/icons.ts).

import type { EmoteId } from '../../../../shared/src/protocol.ts';
import { EMOTE_ITEMS } from '../../../../shared/src/items.ts';

const NS = 'http://www.w3.org/2000/svg';

/** Each emote's name on the wheel: the free six as they've always read, the rest as the boutique names them. */
export const EMOTE_LABELS: Record<EmoteId, string> = {
  ...(Object.fromEntries(EMOTE_ITEMS.map((i) => [i.id, i.name])) as Record<EmoteId, string>),
  wave: 'Wave',
  cheer: 'Cheer',
  clap: 'Clap',
  thumbs: 'Thumbs up',
  shrug: 'Shrug',
  sixseven: 'Six seven',
};

function svg(cls: string): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', cls);
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  return s;
}

function add(s: SVGElement, tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  s.append(e);
  return e;
}

/** A capsule from (x1, y1) to (x2, y2), `w` wide. */
const bar = (s: SVGElement, x1: number, y1: number, x2: number, y2: number, w: number) =>
  add(s, 'path', { d: `M${x1} ${y1}L${x2} ${y2}`, 'stroke-width': w });
/** A thin stroked line or curve (motion marks). */
const line = (s: SVGElement, d: string, w = 1.5) => add(s, 'path', { d, 'stroke-width': w });
const blob = (s: SVGElement, x: number, y: number, w: number, h: number, r: number) => add(s, 'rect', { x, y, width: w, height: h, rx: r, class: 'fill' });
const dot = (s: SVGElement, cx: number, cy: number, r: number) => add(s, 'circle', { cx, cy, r, class: 'fill' });

/** A four-pointed sparkle centred on (x, y). */
function sparkle(s: SVGElement, x: number, y: number, r: number): void {
  const k = r * 0.28;
  add(s, 'path', { d: `M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}Z`, class: 'fill' });
}

/** An open right hand, palm out, fingers up, thumb to the left; about 13 x 17 around (12.5, 12). */
function hand(s: SVGElement): void {
  bar(s, 9, 12, 9, 5.4, 2.3);
  bar(s, 11.6, 12, 11.6, 4.3, 2.3);
  bar(s, 14.2, 12, 14.2, 5, 2.3);
  bar(s, 16.7, 12.6, 16.7, 7.2, 2.1);
  bar(s, 7.9, 14.8, 5.2, 10.9, 2.4);
  blob(s, 7.7, 10.2, 10.2, 9.6, 3.4);
}

export function emoteGlyph(e: EmoteId): SVGSVGElement {
  const s = svg('emo-glyph');
  switch (e) {
    case 'wave':
      // An open hand held up, and the air it moves.
      hand(s);
      line(s, 'M19.7 5.1c.95.85 1.5 2 1.5 3.3');
      line(s, 'M21 2.9c1.4 1.3 2.1 3.1 2.1 5.1');
      line(s, 'M4.6 5.2c-.3-1.1-.1-2.3.6-3.2');
      break;
    case 'cheer':
      // Arms thrown up, with a spark by each hand.
      dot(s, 12, 5.1, 2.5);
      bar(s, 12, 10.2, 12, 14.9, 4.4);
      bar(s, 10.3, 10, 6.4, 4.3, 2.2);
      bar(s, 13.7, 10, 17.6, 4.3, 2.2);
      bar(s, 10.9, 15.6, 9.7, 21.2, 2.4);
      bar(s, 13.1, 15.6, 14.3, 21.2, 2.4);
      sparkle(s, 3.4, 8.8, 1.9);
      sparkle(s, 20.6, 8.8, 1.9);
      break;
    case 'clap':
      // Two open hands leaning in to meet, and the sound of it. The right one is the left
      // mirrored, so both thumbs are on the outside.
      hand(add(s, 'g', { transform: 'translate(7.5 14) rotate(24) scale(0.73) translate(-12.5 -12)' }));
      hand(add(s, 'g', { transform: 'translate(16.5 14) scale(-1 1) rotate(24) scale(0.73) translate(-12.5 -12)' }));
      line(s, 'M12 1.8v2.4');
      line(s, 'M8.4 2.8l1.1 1.9');
      line(s, 'M15.6 2.8l-1.1 1.9');
      break;
    case 'thumbs':
      // A fist, thumb up, and the cuff of a sleeve.
      blob(s, 9.4, 10.4, 3.8, 9.6, 1.8);
      bar(s, 11.2, 11.4, 18.2, 11.4, 2.2);
      bar(s, 11.2, 13.9, 17.8, 13.9, 2.2);
      bar(s, 11.2, 16.4, 17.4, 16.4, 2.2);
      bar(s, 11.2, 18.8, 16.5, 18.8, 2.2);
      bar(s, 11.4, 11, 12.7, 4.3, 2.7);
      blob(s, 4.6, 10.4, 3.1, 9.6, 0.9);
      break;
    case 'shrug':
      // Shoulders up, palms up: who knows.
      dot(s, 12, 6.2, 2.5);
      bar(s, 12, 11.4, 12, 16.2, 4.4);
      add(s, 'path', { d: 'M10.1 11.2L6.8 13.9L4.3 10.6', 'stroke-width': 2.1 });
      add(s, 'path', { d: 'M13.9 11.2L17.2 13.9L19.7 10.6', 'stroke-width': 2.1 });
      bar(s, 2.6, 10.1, 5.4, 10.1, 1.8);
      bar(s, 18.6, 10.1, 21.4, 10.1, 1.8);
      bar(s, 10.9, 16.9, 10.3, 21.4, 2.4);
      bar(s, 13.1, 16.9, 13.7, 21.4, 2.4);
      break;
    case 'sixseven':
      // The numbers themselves, drawn in the same round-capped strokes: a 6 (a loop with its
      // stem curling up out of it) and a 7.
      add(s, 'circle', { cx: 7, cy: 15.3, r: 3.75, 'stroke-width': 2.6 });
      add(s, 'path', { d: 'M3.25 15.3C3.25 9.4 5.5 5 9.7 4.4', 'stroke-width': 2.6 });
      add(s, 'path', { d: 'M13.3 4.6H20.9L15.3 19.5', 'stroke-width': 2.6 });
      break;
    case 'throwback':
      // Side on, bent over with the hands on the knees, the hips pushed back and moving.
      dot(s, 18.4, 7.6, 2.4);
      bar(s, 15.4, 10.4, 8.6, 11.2, 4.4);
      bar(s, 8.4, 12.6, 12.4, 16.4, 2.9);
      bar(s, 12.4, 16.4, 10.4, 21.4, 2.4);
      bar(s, 15.2, 11.6, 12.8, 15.8, 2.1);
      line(s, 'M4.7 8.2c-1 1.3-1.2 3-.5 4.5');
      line(s, 'M2.4 6.6c-1.6 1.9-1.9 4.6-.8 6.9');
      break;
    case 'griddy':
      // Side on: a heel kicked out with the toes up, a hand made into goggles at the eye.
      dot(s, 12.2, 5.2, 2.4);
      bar(s, 11.8, 9.6, 11, 14.4, 4.2);
      bar(s, 12.2, 9.8, 16.2, 9.4, 2.1);
      bar(s, 16.2, 9.4, 15.2, 6.2, 2.1);
      add(s, 'circle', { cx: 15.3, cy: 4.7, r: 1.35, 'stroke-width': 1.3 });
      bar(s, 10.6, 15, 9, 21.4, 2.5);
      bar(s, 11.8, 15, 16.2, 19.6, 2.5);
      bar(s, 16.4, 19.8, 17.6, 17.8, 1.9);
      break;
    case 'floss':
      // Both straight arms swung out to one side, the hips kicked out to the other.
      dot(s, 12, 4.8, 2.4);
      bar(s, 12, 9.2, 12.7, 13.8, 4.4);
      bar(s, 10.5, 9.4, 5.2, 15.2, 2.2);
      bar(s, 13.4, 9.6, 7.9, 17.2, 2.2);
      bar(s, 12, 14.8, 10.4, 21.3, 2.4);
      bar(s, 14.1, 14.6, 15.2, 21.3, 2.4);
      line(s, 'M17.8 11.8c1.2 1 1.8 2.5 1.6 4');
      line(s, 'M20.2 10.2c1.7 1.5 2.5 3.6 2.2 5.8');
      break;
    case 'dab':
      // The face down in the crook of one elbow, the other arm flung out and up the same way.
      dot(s, 9.2, 8.6, 2.4);
      bar(s, 12, 11.6, 12.4, 16.2, 4.4);
      bar(s, 13.8, 10.8, 20.6, 4.2, 2.2);
      bar(s, 10.4, 10.8, 5.6, 7.6, 2.2);
      bar(s, 5.6, 7.6, 11.6, 5.4, 2.2);
      bar(s, 11.2, 16.8, 10.2, 21.5, 2.4);
      bar(s, 13.4, 16.8, 14.6, 21.5, 2.4);
      break;
    case 'robot':
      // A boxy head and body, arms bent square: one up, one down.
      blob(s, 9, 2.4, 6, 5, 1.2);
      bar(s, 12, 1.2, 12, 2.4, 1.2);
      blob(s, 8.5, 8.6, 7, 7.6, 1.2);
      add(s, 'path', { d: 'M8 10.4H4.6V6.6', 'stroke-width': 2.1 });
      add(s, 'path', { d: 'M16 10.4H19.4V14.2', 'stroke-width': 2.1 });
      bar(s, 10.4, 17, 10.4, 21.6, 2.4);
      bar(s, 13.6, 17, 13.6, 21.6, 2.4);
      break;
    case 'backflip':
      // Tucked into a ball inside the arc of the turn, going over backwards.
      dot(s, 10.4, 9.8, 2.2);
      bar(s, 12.6, 11.8, 13.2, 14.4, 4);
      bar(s, 13.6, 15.2, 16.4, 12.8, 2.5);
      bar(s, 16.4, 12.8, 14.6, 10.2, 2.2);
      add(s, 'path', { d: 'M18.8 17.6A8.6 8.6 0 1 1 20.2 8.4', 'stroke-width': 1.7 });
      add(s, 'path', { d: 'M21.9 5.6L21.2 10.4L16.9 8.6Z', class: 'fill' });
      break;
    case 'moneyfan':
      // A fan of notes spread from the hand, each with its portrait oval.
      for (const a of [-42, -14, 14, 42]) {
        add(s, 'path', {
          d: 'M9.6 6.2a1.3 1.3 0 0 1 1.3-1.3h2.2a1.3 1.3 0 0 1 1.3 1.3v11.4a1.3 1.3 0 0 1-1.3 1.3h-2.2a1.3 1.3 0 0 1-1.3-1.3zM12 9.6a1.1 1.6 0 1 0 0 3.2a1.1 1.6 0 1 0 0-3.2z',
          class: 'fill',
          'fill-rule': 'evenodd',
          transform: `rotate(${a} 12 20)`,
        });
      }
      dot(s, 12, 20, 2.2);
      break;
    case 'bow':
      // Side on, folded forward from the hips with a hand to the chest.
      dot(s, 19.4, 13.2, 2.3);
      bar(s, 10.6, 12, 16.8, 11.8, 4.4);
      bar(s, 15.8, 13.4, 14.2, 16.2, 2.1);
      bar(s, 9.8, 13.4, 10.2, 21.5, 2.5);
      bar(s, 11.4, 13.4, 12.8, 21.5, 2.5);
      bar(s, 12.8, 21.5, 14.6, 21.5, 1.8);
      break;
    case 'trophy':
      // A cup with two handles on a stem and a stepped foot.
      add(s, 'path', { d: 'M6.6 3.2H17.4V8.2A5.4 5.4 0 0 1 6.6 8.2Z', class: 'fill' });
      add(s, 'path', { d: 'M6.8 4.8H4.3V6.6A3.4 3.4 0 0 0 7.6 10', 'stroke-width': 1.6 });
      add(s, 'path', { d: 'M17.2 4.8H19.7V6.6A3.4 3.4 0 0 1 16.4 10', 'stroke-width': 1.6 });
      bar(s, 12, 13.4, 12, 17, 2.2);
      blob(s, 8.2, 17, 7.6, 2.4, 0.8);
      blob(s, 6.8, 19.6, 10.4, 2.6, 0.8);
      break;
    case 'moonwalk':
      // Side on in a hat, one foot flat and one on its toes, sliding away from its own trail.
      blob(s, 10.4, 0.9, 4, 2.9, 0.9);
      bar(s, 8.8, 3.9, 16, 3.9, 1.4);
      dot(s, 12.6, 6.4, 2.2);
      bar(s, 12.4, 10.2, 11.8, 14.6, 4);
      bar(s, 12.8, 10.4, 14.8, 13.8, 2);
      bar(s, 11.2, 15.2, 10.2, 21.4, 2.4);
      bar(s, 10.2, 21.4, 12.8, 21.4, 1.8);
      bar(s, 12.6, 15.2, 14.8, 18.2, 2.3);
      bar(s, 14.8, 18.2, 14, 21.2, 2.2);
      line(s, 'M17.6 15.6h3.6');
      line(s, 'M18.6 18.4h3.8');
      line(s, 'M17.8 21.2h4.4');
      break;
  }
  return s;
}

/** A small padlock for an emote you don't have yet (class "emo-lock"). */
export function lockGlyph(): SVGSVGElement {
  const s = svg('emo-lock');
  add(s, 'path', { d: 'M8.4 11V8a3.6 3.6 0 0 1 7.2 0v3', 'stroke-width': 2.2 });
  blob(s, 6, 10.4, 12, 10, 2);
  return s;
}

export type SocialIconName = 'emotes' | 'leaderboard';

/** Line icons for the HUD buttons, drawn like menu/icons.ts (class "ico"). */
export function socialIcon(name: SocialIconName): SVGSVGElement {
  const s = svg('ico');
  const path = (d: string) => add(s, 'path', { d });
  if (name === 'emotes') {
    // A raised hand: fingers, thumb and palm in one outline; the slits between fingers are the
    // outline running down one finger and back up the next.
    path('M7.6 19.8V14.6L5.2 11.6a1.1 1.1 0 0 1 1.7-1.4l1.6 2V6.4a1 1 0 0 1 2 0v4.8V5.2a1 1 0 0 1 2 0v6V5.8a1 1 0 0 1 2 0v5.8V7.6a1 1 0 0 1 2 0V15c0 2.7-1.8 4.8-4.4 4.8z');
    path('M19.1 4.4c.9.9 1.4 2.1 1.4 3.4');
    path('M20.9 2.6c1.3 1.3 2.1 3.1 2.1 5');
  } else {
    // A podium, first place in the middle, with a star over it.
    path('M3.5 20h17M9.5 20V9.5h5V20M4.5 20v-6.5h5M14.5 20v-4.5h5V20');
    let star = '';
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 1.05 : 2.4;
      star += `${i ? 'L' : 'M'}${(12 + Math.cos(a) * r).toFixed(2)} ${(5.1 + Math.sin(a) * r).toFixed(2)}`;
    }
    path(star + 'Z');
  }
  return s;
}
