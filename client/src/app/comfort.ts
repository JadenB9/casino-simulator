// "Reduce flashing & motion": one switch in Settings (and on the login screen) that every effect
// reads. On, the game keeps its light but loses the strobing: no flashing or chasing lights (LED
// sign chases, disco spots, pachinko fever, win flashes), gentler particles, no camera shake or
// tipsy wobble, softer bloom. It defaults to on when the system asks for reduced motion. Kept per
// browser, and it applies at once: nothing waits for a reload.
//
// What calm means for an effect, new ones included:
//  - Nothing flashes. A light that blinks, strobes or alternates holds steady and lit instead
//    (blink()); a win is told by a steady brighter light, the banner and the sound. Nothing on
//    screen swings sharply in brightness more than about once every two seconds.
//  - Chasing bulbs light evenly. Light that travels (a band up a glass, a comet round a ring, a
//    glint) goes at a third of the speed and a third of the strength, or holds still.
//  - Pulses breathe: wave() in place of Math.sin gives a third of the speed and of the swing.
//  - Particles (confetti, sparks, chip showers, coins): a third as many (fewer()), falling for
//    less time; nothing bursts across the screen.
//  - The camera never shakes, wobbles, kicks or zooms suddenly. A glide that is part of a game
//    (to the wheel, onto the dome) stays, eased as it is.
//  - Screen-wide effects (a whole-view flash, a tint that pulses, a vignette throb) don't happen;
//    a tint that fades in and holds is fine.
//  - Bloom keeps CALM_BLOOM of its strength and is never pulsed.
//  - Readable motion stays: scrolling text scrolls, wheels and reels spin, balls roll. Only their
//    flashing goes.
// How to follow it: read calm() each frame, or followCalm(fn) for something set once; shaders take
// calmUniform (1 while calm) as a uniform, the same object everywhere. The page's <body> carries
// the class `calm`, so CSS keys its overrides on `body.calm` (comfort.css holds the shared ones).

import './comfort.css';

const KEY = 'casino.calm';
const listeners = new Set<(on: boolean) => void>();

function initial(): boolean {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === '1') return true;
    if (saved === '0') return false;
  } catch {
    // storage blocked: fall through to the system setting
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let on = initial();

/** For shaders: `{ value: 1 }` while calm, 0 otherwise. Hand this very object in as a uniform. */
export const calmUniform = { value: on ? 1 : 0 };

/** Bloom's strength while calm, as a share of what it would be. */
export const CALM_BLOOM = 0.7;

function paintBody(): void {
  if (typeof document === 'undefined' || !document.body) return;
  document.body.classList.toggle('calm', on);
}
paintBody();

/** Whether flashing and motion should be toned down right now. */
export function calm(): boolean {
  return on;
}

export function setCalm(next: boolean): void {
  if (next === on) return;
  on = next;
  calmUniform.value = on ? 1 : 0;
  try {
    localStorage.setItem(KEY, next ? '1' : '0');
  } catch {
    // not kept, but still applied for this visit
  }
  paintBody();
  for (const fn of listeners) fn(on);
}

/** Hear changes; the returned function stops listening. */
export function onCalm(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** onCalm, called once now as well: for something set up once and changed only when the switch is. */
export function followCalm(fn: (on: boolean) => void): () => void {
  fn(on);
  return onCalm(fn);
}

/** Whether a flash (a strobe, a blink, a whole-view burst) may play at all. */
export function flashAllowed(): boolean {
  return !on;
}

/** `k` while calm, 1 otherwise: a multiplier for a speed, a count or a strength. */
export function calmScale(k: number): number {
  return on ? k : 1;
}

/** A blinking light's state this frame: calm holds it on. */
export function blink(lit: boolean): boolean {
  return on || lit;
}

/**
 * Math.sin for a light that pulses or a thing that sways: calm slows it to a third and takes two
 * thirds of the swing out (so a pulse of 0.5 +- 0.3 becomes a slow 0.5 +- 0.1 breath).
 */
export function wave(phase: number): number {
  return on ? Math.sin(phase / 3) / 3 : Math.sin(phase);
}

/** How many of `n` particles to throw: a third while calm, never none. */
export function fewer(n: number): number {
  return on ? Math.max(1, Math.round(n / 3)) : n;
}
