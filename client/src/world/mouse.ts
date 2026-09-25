// Mouse look settings, kept for next time: how fast the camera turns per pixel of mouse travel
// (1 is the default), whether the floor holds the mouse (Pointer Lock) so moving it always
// looks around (anyone who'd rather keep the cursor turns that off and looks by dragging), and
// whether the floor is seen from behind your character or through its eyes.
// Settings (the sheet), F on the floor and the floor's controller all go through
// setMouseSettings(), so a change reaches the walking player at once.

const SENS_KEY = 'casino.mouse.sensitivity';
const CAPTURE_KEY = 'casino.mouse.capture';
const VIEW_KEY = 'casino.camera.view';

/** Third person (the follow camera behind you) or first person (through your character's eyes). */
export type View = 'third' | 'first';

export const SENS_MIN = 0.25;
export const SENS_MAX = 3;

export interface MouseSettings {
  /** Multiplier on the default turn rate, SENS_MIN..SENS_MAX. */
  sensitivity: number;
  /** The floor holds the mouse (Pointer Lock): moving it looks around, Esc frees the cursor. */
  capture: boolean;
  /** Where the floor is seen from. */
  view: View;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the setting lasts until the page closes */
  }
}

export function clampSensitivity(k: number): number {
  return Number.isFinite(k) ? Math.max(SENS_MIN, Math.min(SENS_MAX, k)) : 1;
}

let current: MouseSettings | null = null;
const listeners = new Set<(m: MouseSettings) => void>();

export function loadMouse(): MouseSettings {
  if (!current) {
    const s = read(SENS_KEY);
    current = { sensitivity: s === null ? 1 : clampSensitivity(Number(s)), capture: read(CAPTURE_KEY) !== '0', view: read(VIEW_KEY) === 'first' ? 'first' : 'third' };
  }
  return { ...current };
}

export function saveMouse(m: MouseSettings): void {
  write(SENS_KEY, String(m.sensitivity));
  write(CAPTURE_KEY, m.capture ? '1' : '0');
  write(VIEW_KEY, m.view);
}

/** Change the settings, save them and tell whoever listens (the floor's controller). */
export function setMouseSettings(o: Partial<MouseSettings>): MouseSettings {
  const was = loadMouse();
  const view: View = o.view === 'first' || o.view === 'third' ? o.view : was.view;
  const next: MouseSettings = { sensitivity: clampSensitivity(o.sensitivity ?? was.sensitivity), capture: o.capture ?? was.capture, view };
  current = next;
  saveMouse(next);
  for (const fn of listeners) fn({ ...next });
  return { ...next };
}

export function onMouseChange(fn: (m: MouseSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
