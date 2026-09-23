// Mouse look settings, kept for next time: how fast the camera turns per pixel of mouse travel
// (1 is the default) and whether a click on the floor captures the mouse at all. Anyone who'd
// rather keep the cursor turns capture off and still has drag-to-look.

const SENS_KEY = 'casino.mouse.sensitivity';
const CAPTURE_KEY = 'casino.mouse.capture';

export const SENS_MIN = 0.25;
export const SENS_MAX = 3;

export interface MouseSettings {
  /** Multiplier on the default turn rate, SENS_MIN..SENS_MAX. */
  sensitivity: number;
  /** A click on the floor view captures the mouse (Pointer Lock). */
  capture: boolean;
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

export function loadMouse(): MouseSettings {
  const s = read(SENS_KEY);
  return { sensitivity: s === null ? 1 : clampSensitivity(Number(s)), capture: read(CAPTURE_KEY) !== '0' };
}

export function saveMouse(m: MouseSettings): void {
  write(SENS_KEY, String(m.sensitivity));
  write(CAPTURE_KEY, m.capture ? '1' : '0');
}
