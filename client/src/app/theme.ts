// Light and dark for the 2D layer: the login and menu, the HUD, sheets and panels, the chat, the
// chip tray and every control over the table. The casino itself keeps its own lighting. The choice
// is the site's, shared with every page on j4den.com: localStorage.theme is "light" or "dark",
// light mode is data-theme="light" on <html>, dark (the default) carries no attribute, and with
// nothing saved the page follows the device. public/theme.js sets the attribute before the first
// paint; this module keeps it current after that, tells the browser's own bar (theme-color), hears
// the device and other tabs change, and lets the few things that draw with their own colours (the
// bank's chart) hear a change. The stylesheets key everything on `:root[data-theme='light']`.

export type Theme = 'light' | 'dark';

const KEY = 'theme';
/** The browser's own bar on a phone, one per theme: the page's background. */
const BAR: Record<Theme, string> = { dark: '#0b0908', light: '#ece4d4' };
const listeners = new Set<(t: Theme) => void>();

function saved(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function device(): Theme {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** The theme on screen now. */
export function theme(): Theme {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function paint(t: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (t === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) m.content = BAR[t];
}

function apply(t: Theme): void {
  if (t === theme()) return;
  paint(t);
  for (const fn of listeners) fn(t);
}

/** Choose, for this browser and every page of the site. Applies at once. */
export function setTheme(t: Theme): void {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // not kept, but still applied for this visit
  }
  apply(t);
}

/** The other one. Returns what it is now. */
export function toggleTheme(): Theme {
  const t = theme() === 'light' ? 'dark' : 'light';
  setTheme(t);
  return t;
}

/** Hear changes; the returned function stops listening. */
export function onTheme(fn: (t: Theme) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** onTheme, called once now as well: for something painted once and repainted only on a change. */
export function followTheme(fn: (t: Theme) => void): () => void {
  fn(theme());
  return onTheme(fn);
}

// The page may have painted before this module ran (theme.js), so its bar colour catches up, and
// from here on: the device's setting while nothing is saved, and another tab's choice (any page of
// the site) as soon as it's made.
paint(theme());
if (typeof matchMedia === 'function') {
  matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', (e) => {
    if (!saved()) apply(e.matches ? 'light' : 'dark');
  });
}
if (typeof addEventListener === 'function') {
  addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) apply(saved() ?? device());
  });
}
