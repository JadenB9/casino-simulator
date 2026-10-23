// The first time a new player is out on the floor: four coach marks, one at a time, for the
// things nobody should have to guess: walking (WASD or the stick), sitting down at a table (E, or
// the button), the map, and the HUD's tools. Each moves on by itself when the player does the
// thing (or after a while), any of them can be skipped, and the tour is shown once per browser.
//
// It never gets in the way: it holds no keys and takes no clicks but its own buttons' (with the
// mouse held by the floor it simply moves on by itself), it waits out of sight while a sheet,
// the editor or a dialog is up and while you're at a table, and it points at things by what
// they are (the map's button, the HUD's bar), not where they are; a mark whose thing isn't on
// screen stands in its usual place without an arrow. Not for a browser driven by a script unless
// it asks (AUTO_KEY), so the headless checks walk onto the floor as they always have.

import './guide.css';
import { el } from '../kit.ts';
import { isKey, keyLabel, type KeyAction } from '../keys.ts';
import { isTyping } from '../keyboard.ts';
import { calm } from '../../app/comfort.ts';
import type { Closable, SessionLike } from './deps.ts';
import { glyph, type GlyphName } from './glyphs.ts';
import { keycap } from './parts.ts';
import { overlayCount } from './sheet.ts';
import { pinCard } from './pin.ts';

const DONE_KEY = 'casino.guide';
/** Set (to '1') by a headless check that wants the tour; see autoStarts(). */
const AUTO_KEY = 'casino.guide.auto';

export interface GuideDeps {
  root: HTMLElement;
  session: Pick<SessionLike, 'profile'>;
  /** Out on the floor and free to walk about (not at a table); the tour waits while this is false. */
  free?: () => boolean;
  /** Start whatever the browser remembers or the profile says (the dev page). */
  force?: boolean;
}

interface Mark {
  title: string;
  icon: GlyphName;
  text(touch: boolean): string;
  keys?(touch: boolean): string[];
  /** What it points at, found by what it is; null (or not on screen) leaves the mark unpinned. */
  target?(): HTMLElement | null;
  /** The keys that mean "done that" (any of them pressed moves the tour on). */
  done?: readonly KeyAction[];
  /** How long it stays before moving on by itself, ms. */
  ms: number;
}

const WALK: readonly KeyAction[] = ['forward', 'back', 'left', 'right'];

const MARKS: readonly Mark[] = [
  {
    title: 'Walk the floor',
    icon: 'walk',
    text: (touch) => (touch ? 'Walk with the stick at the bottom left, and drag anywhere else to look around.' : `Walk with these or the arrow keys, and look around with the mouse. Hold ${keyLabel('run')} to run.`),
    keys: (touch) => (touch ? [] : WALK.map((a) => keyLabel(a))),
    done: WALK,
    ms: 15_000,
  },
  {
    title: 'Sit down to play',
    icon: 'chair',
    text: (touch) =>
      touch
        ? 'Walk up to any table or machine and tap the button that comes up at the bottom right.'
        : `Walk up to any table or machine and press ${keyLabel('interact')} when it offers. Esc stands you up again.`,
    keys: (touch) => (touch ? [] : [keyLabel('interact')]),
    done: ['interact'],
    ms: 14_000,
  },
  {
    title: 'The map',
    icon: 'map',
    text: (touch) => `${touch ? 'This button' : `${keyLabel('map')} or this button`} opens a map of the whole casino: every room, what's in it, and who's there.`,
    keys: (touch) => (touch ? [] : [keyLabel('map')]),
    target: () => document.querySelector<HTMLElement>('.hud .map-btn, .hud [aria-label^="Map"]'),
    done: ['map'],
    ms: 12_000,
  },
  {
    title: 'Everything else',
    icon: 'tools',
    text: (touch) =>
      `Up here: emotes, the leaderboards, the boutique, the bar, your daily bonus and settings. Your name opens your profile and stats.${touch ? '' : ' ? lists every key.'}`,
    target: () => document.querySelector<HTMLElement>('.hud .hud-right'),
    ms: 14_000,
  },
];

/** Whether the tour was finished or skipped in this browser. */
export function guideSeen(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === 'done';
  } catch {
    // storage blocked: nothing can remember it, so don't show it at all
    return true;
  }
}

function remember(): void {
  try {
    localStorage.setItem(DONE_KEY, 'done');
  } catch {
    /* private mode: shown again next time */
  }
}

/** Not for a browser a script drives (Playwright sets navigator.webdriver) unless it asks. */
function autoStarts(): boolean {
  if (typeof navigator === 'undefined' || !navigator.webdriver) return true;
  try {
    return localStorage.getItem(AUTO_KEY) === '1';
  } catch {
    return false;
  }
}

/** On screen and drawn: a target the HUD tucked away (under More, or hidden) doesn't count. */
function shown(e: HTMLElement | null): DOMRect | null {
  if (!e || !e.isConnected) return null;
  const r = e.getBoundingClientRect();
  if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return null;
  return getComputedStyle(e).visibility === 'hidden' ? null : r;
}

let running: Closable | null = null;

/**
 * The tour, if this is a new player's first time on the floor (no rounds played, not seen in this
 * browser). Safe to call on every arrival: it starts once, and puts itself away when the HUD goes
 * (back to the menu), to start again next time if it wasn't finished.
 */
export function startGuide(deps: GuideDeps): Closable | null {
  if (running) return running;
  if (!deps.force && (guideSeen() || !autoStarts() || (deps.session.profile?.stats.total.rounds ?? 1) > 0)) return null;
  const touch = document.documentElement.classList.contains('touch-ui') || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);

  const card = el('aside', 'guide-card');
  card.hidden = true;
  const step = el('span', 'guide-step');
  const skip = el('button', 'guide-skip', 'Skip tour');
  skip.type = 'button';
  const top = el('div', 'guide-top');
  top.append(step, skip);
  const ico = el('span', 'guide-ico');
  const title = el('h2', 'guide-title');
  title.id = 'guide-title';
  const text = el('p', 'guide-text');
  text.setAttribute('aria-live', 'polite');
  const keys = el('div', 'guide-keys');
  const words = el('div', 'guide-words');
  words.append(title, text, keys);
  const body = el('div', 'guide-body');
  body.append(ico, words);
  const dots = el('div', 'guide-dots');
  dots.setAttribute('aria-hidden', 'true');
  const pips = MARKS.map(() => el('i', 'guide-dot'));
  dots.append(...pips);
  const next = el('button', 'btn guide-next');
  next.type = 'button';
  const foot = el('div', 'guide-foot');
  foot.append(dots, next);
  const timer = el('i', 'guide-timer');
  const arrow = el('i', 'guide-arrow');
  card.append(top, body, foot, timer, arrow);
  card.setAttribute('aria-labelledby', 'guide-title');
  // the thing it points at, outlined (it lets every click through to it)
  const ring = el('div', 'guide-ring');
  ring.hidden = true;
  deps.root.append(ring, card);

  let at = -1;
  let up = false;
  let left = 0; // ms the current mark has still to stay
  let hudSince = 0;
  let sawHud = false;
  let placed = '';
  let closed = false;

  const paint = () => {
    const m = MARKS[at]!;
    step.textContent = `${at + 1} of ${MARKS.length}`;
    ico.replaceChildren(glyph(m.icon));
    title.textContent = m.title;
    text.textContent = m.text(touch);
    keys.replaceChildren(...(m.keys?.(touch) ?? []).map((k) => keycap(k)));
    keys.hidden = keys.childElementCount === 0;
    pips.forEach((p, i) => p.classList.toggle('on', i <= at));
    next.textContent = at === MARKS.length - 1 ? 'Done' : 'Next';
    // the bar along the foot runs down the mark's time, from where it had got to (while calm, it
    // isn't drawn: the mark still moves on)
    timer.hidden = calm();
    timer.style.animationDuration = `${m.ms}ms`;
    timer.style.animationDelay = `${Math.min(0, left - m.ms)}ms`;
    timer.classList.remove('run');
    void timer.offsetWidth;
    timer.classList.add('run');
    placed = '';
  };

  const go = (i: number) => {
    if (i >= MARKS.length) return finish();
    at = i;
    left = MARKS[i]!.ms;
    if (up) {
      paint();
      place();
    }
  };

  /** Where the card stands: by its target (under it, or over it near the foot), else in its usual place. */
  const place = () => {
    if (!up) return;
    const m = MARKS[at]!;
    const r = shown(m.target?.() ?? null);
    const vw = innerWidth;
    const vh = innerHeight;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    let key = 'free';
    if (r) {
      const { x, y, below, arrow: ax } = pinCard(r, { w: cw, h: ch }, { w: vw, h: vh });
      key = `${x},${y},${below},${ax},${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
      if (key === placed) return;
      card.classList.add('pinned');
      card.classList.toggle('above', !below);
      card.style.translate = `${x}px ${y}px`;
      arrow.style.translate = `${ax}px 0`;
      ring.hidden = false;
      ring.style.translate = `${Math.round(r.left - 4)}px ${Math.round(r.top - 4)}px`;
      ring.style.width = `${Math.round(r.width + 8)}px`;
      ring.style.height = `${Math.round(r.height + 8)}px`;
    } else {
      if (key === placed) return;
      card.classList.remove('pinned', 'above');
      card.style.translate = '';
      ring.hidden = true;
    }
    placed = key;
  };

  const show = (on: boolean) => {
    if (on === up) return;
    up = on;
    card.hidden = !on;
    if (on) {
      paint();
      place();
    } else ring.hidden = true;
  };

  // Every half second: is the HUD up, is anything over the floor, is the mark's time up, has its
  // target moved? Nothing runs per frame, and nothing is written unless it changed.
  const TICK = 500;
  const tick = () => {
    const hud = document.querySelector('.hud');
    if (!hud) {
      // back to the menu, or logged out: away until the next time on the floor
      if (sawHud) close();
      return;
    }
    if (!sawHud) {
      sawHud = true;
      hudSince = performance.now();
    }
    // a moment on the floor first (the daily bonus's sheet comes up then; the tour waits for it)
    if (performance.now() - hudSince < 2200) return;
    const clear = overlayCount() === 0 && (deps.free?.() ?? true) && !document.querySelector('.front, .editor');
    if (at < 0 && clear) go(0);
    show(clear && at >= 0);
    if (!up) return;
    left -= TICK;
    if (left <= 0) go(at + 1);
    else place();
  };
  const timerId = window.setInterval(tick, TICK);

  // doing the thing moves the tour on (a moment later, so the card isn't snatched mid-read)
  let soon = 0;
  const onKey = (e: KeyboardEvent) => {
    // (a W typed into the chat isn't a step)
    if (!up || e.repeat || isTyping(e)) return;
    const m = MARKS[at];
    if (!m?.done?.some((a) => isKey(e, a))) return;
    const was = at;
    clearTimeout(soon);
    soon = window.setTimeout(() => at === was && go(at + 1), m.done === WALK ? 1600 : 400);
  };
  addEventListener('keydown', onKey);
  // on a touch screen, walking is a drag on the stick's side of the screen
  const onTouch = (e: PointerEvent) => {
    if (!up || at !== 0 || e.pointerType === 'mouse' || !(e.target as Element | null)?.closest?.('.touch-layer')) return;
    if (e.clientX > innerWidth / 2) return;
    const was = at;
    clearTimeout(soon);
    soon = window.setTimeout(() => at === was && go(at + 1), 1600);
  };
  addEventListener('pointerdown', onTouch, true);
  const onResize = () => {
    placed = '';
    place();
  };
  addEventListener('resize', onResize);

  next.addEventListener('click', () => go(at + 1));
  skip.addEventListener('click', () => finish());

  function finish(): void {
    remember();
    close();
  }
  function close(): void {
    if (closed) return;
    closed = true;
    running = null;
    clearInterval(timerId);
    clearTimeout(soon);
    removeEventListener('keydown', onKey);
    removeEventListener('pointerdown', onTouch, true);
    removeEventListener('resize', onResize);
    ring.remove();
    card.classList.add('closing');
    setTimeout(() => card.remove(), 220);
  }

  running = { root: card, close };
  return running;
}
