// Two display choices from Settings, kept per browser: the interface size (Accessibility), which
// scales the HUD and the shell's own overlays through --ui-zoom (theme.css), and the frame-rate
// readout (General), a tile of the HUD's status card while the HUD is up.

const SIZE_KEY = 'casino.uiSize';
const FPS_KEY = 'casino.fps';

export type UiSize = 'standard' | 'large' | 'larger';
export const UI_ZOOM: Record<UiSize, number> = { standard: 1, large: 1.15, larger: 1.3 };

const fpsListeners = new Set<(on: boolean) => void>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* kept for this visit only */
  }
}

let size: UiSize = ((s) => (s === 'large' || s === 'larger' ? s : 'standard'))(read(SIZE_KEY));
let fps = read(FPS_KEY) === '1';

function paintSize(): void {
  if (typeof document === 'undefined') return;
  const z = UI_ZOOM[size];
  if (z === 1) document.documentElement.style.removeProperty('--ui-zoom');
  else document.documentElement.style.setProperty('--ui-zoom', String(z));
}
paintSize();

export function uiSize(): UiSize {
  return size;
}

export function setUiSize(s: UiSize): void {
  size = s;
  write(SIZE_KEY, s === 'standard' ? null : s);
  paintSize();
}

export function showFps(): boolean {
  return fps;
}

export function setShowFps(on: boolean): void {
  if (on === fps) return;
  fps = on;
  write(FPS_KEY, on ? '1' : null);
  for (const fn of fpsListeners) fn(on);
}

/**
 * The frame-rate readout while `showFps()` is on, a tile of the HUD's status card: frames a second
 * and the average frame time, written twice a second (never every frame). Returns its removal.
 */
export function mountFps(card: HTMLElement): () => void {
  const box = document.createElement('div');
  box.className = 'hud-stat hud-fps';
  box.setAttribute('aria-hidden', 'true');
  const label = document.createElement('div');
  label.className = 'stat-label';
  label.textContent = 'Frame rate';
  const value = document.createElement('div');
  value.className = 'stat-value money';
  box.append(label, value);
  let raf = 0;
  let frames = 0;
  let since = 0;
  let lastText = '';
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    if (!since) since = now;
    frames++;
    const span = now - since;
    if (span < 500) return;
    const text = `${Math.round((frames * 1000) / span)} · ${(span / frames).toFixed(1)} ms`;
    frames = 0;
    since = now;
    if (text !== lastText) value.textContent = lastText = text;
  };
  const set = (on: boolean) => {
    cancelAnimationFrame(raf);
    frames = 0;
    since = 0;
    if (on) {
      if (!box.isConnected) card.append(box);
      value.textContent = lastText = '…';
      raf = requestAnimationFrame(tick);
    } else box.remove();
  };
  set(fps);
  fpsListeners.add(set);
  return () => {
    fpsListeners.delete(set);
    set(false);
  };
}
