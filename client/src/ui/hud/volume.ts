// Master volume on top of Sfx's mute. Sfx drives one gain node (0.8, or 0 when muted); this
// scales that level and keeps it across reloads. If Sfx grows its own setVolume, this file
// becomes a thin wrapper around it.

import type { SfxLike } from '../menu/deps.ts';

const KEY = 'casino.volume';
/** Sfx's own unmuted level; the volume setting scales it. */
const BASE = 0.8;

export function savedVolume(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    if (localStorage.getItem(KEY) !== null && Number.isFinite(v)) return Math.min(1, Math.max(0, v));
  } catch {
    /* storage blocked */
  }
  return 1;
}

export function saveVolume(v: number): void {
  try {
    localStorage.setItem(KEY, String(Math.min(1, Math.max(0, v))));
  } catch {
    /* storage blocked */
  }
}

/** Set the master level. Touching `out` creates the audio context, so call this after a gesture. */
export function applyVolume(sfx: SfxLike, v = savedVolume()): void {
  if (sfx.muted) return;
  const out = sfx.out;
  out.gain.setTargetAtTime(BASE * v, out.context.currentTime, 0.04);
}

/** Mute or unmute, keeping the chosen volume (Sfx alone would unmute to full). */
export function setMuted(sfx: SfxLike, muted: boolean): void {
  sfx.setMuted(muted);
  if (!muted) applyVolume(sfx);
}

const ready = new WeakSet<object>();

/** Apply the saved volume once audio unlocks (the first click or key). Safe to call repeatedly. */
export function initVolume(sfx: SfxLike): void {
  if (ready.has(sfx)) return;
  ready.add(sfx);
  const apply = () => {
    removeEventListener('pointerdown', apply);
    removeEventListener('keydown', apply);
    applyVolume(sfx);
  };
  addEventListener('pointerdown', apply);
  addEventListener('keydown', apply);
}
